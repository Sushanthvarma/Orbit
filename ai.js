/* ============================================================
   ORBIT WEB — AI expense entry + receipt vision (Gemini 2.0 Flash)

   Text:    await OrbitAI.parseExpense(text, { contacts, groups, defaults })
     parsed = { title, amount, currency, category, paidByName, participants[], splitMode, splits? }

   Receipt: await OrbitAI.parseReceipt(imageDataUrl)   // multimodal vision OCR
     parsed = { title, total, currency, category, date, merchant, lines:[{label,amount}] }

   Both return { ok, parsed, raw, error }.

   Key storage: meta['geminiApiKey']. A call without a key (and no shared
   server key) returns { ok:false, error:'needs-key' } so the UI can prompt.
   ============================================================ */
(function (global) {
  'use strict';

  // gemini-flash-latest: a stable ALIAS that always tracks the current fast
  // multimodal (text + vision) model, so we don't 404 when a specific version
  // retires (gemini-2.0-flash was retired by June 2026). Keep in sync with
  // functions/index.js GEMINI_MODEL.
  const MODEL = 'gemini-flash-latest';
  const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models/' + MODEL + ':generateContent';

  const CATS = ['food', 'travel', 'bills', 'shop', 'fun', 'rent', 'transport', 'other'];

  async function getKey() {
    if (!global.OrbitDB) return null;
    const k = await OrbitDB.getMeta('geminiApiKey', null);
    return k || null;
  }
  async function setKey(k) {
    if (!global.OrbitDB) return;
    await OrbitDB.setMeta('geminiApiKey', k || null);
  }
  async function clearKey() { return setKey(null); }

  function buildPrompt(text, ctx) {
    const contacts = (ctx.contacts || []).map((c) => '- ' + c.name + (c.isSelf ? ' (the user themselves)' : '')).join('\n');
    const groups = (ctx.groups || []).map((g) => '- "' + g.name + '" (' + g.currency + ', ' + g.memberCount + ' members)').join('\n');
    const cats = (ctx.categories || CATS).join(', ');
    return [
      'You are an expense-splitting parser. Given a user message, output strict JSON only.',
      '',
      'JSON schema:',
      '{',
      '  "title": string,            // short noun phrase, e.g. "Dinner at Bombay Canteen"',
      '  "amount": number,           // total expense in the chosen currency',
      '  "currency": "INR"|"USD"|"EUR"|"GBP",',
      '  "category": one of: ' + cats + ',',
      '  "paidByName": string,       // name from contacts, or "self" if user paid',
      '  "groupName": string|null,   // best-match group name from list below, or null',
      '  "participants": string[],   // names from contacts who are part of this split (include the payer)',
      '  "splitMode": "equal"|"exact"|"percent"|"shares",',
      '  "splits": [{ "name": string, "value": number }] | null   // required when splitMode != "equal"; value is the amount/percent/share',
      '}',
      '',
      'Defaults: currency INR, category "other", paidByName "self", splitMode "equal".',
      'Rules:',
      '- Match names case-insensitively to the contacts list. If "I", "me", "myself" → "self".',
      '- For percent splits the sum of values must equal 100. For exact, must equal amount.',
      '- For shares, values are integer share counts (e.g. 2 vs 1 = 2:1).',
      '- If the user just says "split with X and Y" with no ratio → splitMode "equal", splits null.',
      '- If you cannot identify a group from the list, set groupName to null.',
      '- Output JSON only. No code fences, no commentary.',
      '',
      'Contacts available:',
      contacts || '(none)',
      '',
      'Groups available:',
      groups || '(none)',
      '',
      'User message:',
      '"' + text.replace(/"/g, '\\"') + '"'
    ].join('\n');
  }

  function buildReceiptPrompt() {
    return [
      'You are a receipt OCR and parser. Read the receipt in the image and output strict JSON only.',
      '',
      'JSON schema:',
      '{',
      '  "merchant": string|null,    // shop / restaurant name',
      '  "title": string,            // short label, e.g. "Dinner at Bombay Canteen" or the merchant name',
      '  "total": number,            // the FINAL amount paid (grand total / amount due), not the subtotal',
      '  "currency": "INR"|"USD"|"EUR"|"GBP",',
      '  "date": string|null,        // YYYY-MM-DD if printed on the receipt, else null',
      '  "category": one of: ' + CATS.join(', ') + ',',
      '  "lineItems": [{ "label": string, "amount": number }]  // individual purchased items, excluding the total/tax lines',
      '}',
      '',
      'Rules:',
      '- "total" is the final payable amount, not the subtotal.',
      '- Amounts are plain numbers — no currency symbols, no thousands separators.',
      '- Infer currency from symbols: ₹ or Rs = INR, $ = USD, € = EUR, £ = GBP. Default INR.',
      '- Keep line-item labels short (the printed item name).',
      '- If the receipt is unreadable, set total 0 and lineItems [].',
      '- Output JSON only. No code fences, no commentary.'
    ].join('\n');
  }

  // Slim the context down to what the server prompt needs (names + group meta),
  // so we never ship internal ids or amounts to the proxy.
  function slimCtx(ctx) {
    return {
      contacts: (ctx.contacts || []).map((c) => ({ name: c.name, isSelf: !!c.isSelf })),
      groups: (ctx.groups || []).map((g) => ({ name: g.name, currency: g.currency, memberCount: g.memberCount })),
      categories: ctx.categories
    };
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // Gemini returns 429 (rate limit / quota) and 503 (overloaded) transiently;
  // a short backoff usually clears the per-minute burst limit.
  const RETRYABLE = new Set([429, 500, 503]);

  // Shared Gemini call with key-scrubbing + retry/backoff. `parts` is the
  // contents[0].parts array (text and/or inlineData). Returns one of:
  //   { ok:true, json }                    — parsed response body
  //   { ok:false, error:'http-429', raw }  — upstream error (key scrubbed)
  //   { ok:false, error:'network', raw }   — fetch threw
  async function geminiGenerate(key, parts) {
    const init = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: { responseMimeType: 'application/json', temperature: 0 }
      })
    };
    try {
      let res;
      for (let attempt = 0; ; attempt++) {
        res = await fetch(ENDPOINT, init);
        if (res.ok || !RETRYABLE.has(res.status) || attempt >= 2) break;
        await sleep(700 * Math.pow(2, attempt)); // 0.7s → 1.4s
      }
      if (!res.ok) {
        const txt = (await res.text().catch(() => '')).split(key).join('***');
        return { ok: false, error: 'http-' + res.status, raw: txt };
      }
      return { ok: true, json: await res.json() };
    } catch (e) {
      return { ok: false, error: 'network', raw: String(e) };
    }
  }

  // Pull the model's text part out of a generateContent response and JSON.parse
  // it (tolerating stray code fences). Returns { ok, parsed } | { ok:false }.
  function parseJsonResponse(json) {
    const partText = json?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    try {
      return { ok: true, parsed: JSON.parse(partText.trim().replace(/^```json\s*|\s*```$/g, '')), raw: partText };
    } catch (_) {
      return { ok: false, error: 'parse', raw: partText };
    }
  }

  // Split a data URL ("data:image/jpeg;base64,….") into { mimeType, data }.
  function splitDataUrl(dataUrl) {
    const m = /^data:([^;]+);base64,(.*)$/i.exec(dataUrl || '');
    if (!m) return null;
    return { mimeType: m[1], data: m[2] };
  }

  async function parseExpense(text, ctx = {}) {
    if (!text || !text.trim()) return { ok: false, error: 'empty-input' };

    // Prefer the SHARED server-side key (signed-in users need no key of their
    // own). Only fall back to a local/per-device key if the proxy is
    // unavailable or no server key is configured.
    if (!ctx.apiKey && global.OrbitGroups && OrbitGroups.isReady && OrbitGroups.isReady() && OrbitGroups.aiParse) {
      try {
        const r = await OrbitGroups.aiParse(text, slimCtx(ctx));
        if (r && r.ok) return { ok: true, parsed: r.parsed, raw: r.raw };
        if (r && r.error && r.error !== 'no-server-key') return { ok: false, error: r.error, raw: r.raw };
      } catch (e) { /* proxy unreachable — fall back to a local key below */ }
    }

    const key = ctx.apiKey || await getKey();
    if (!key) return { ok: false, error: 'needs-key' };

    const r = await geminiGenerate(key, [{ text: buildPrompt(text, ctx) }]);
    if (!r.ok) return r;
    const out = parseJsonResponse(r.json);
    return out.ok ? { ok: true, parsed: out.parsed, raw: out.raw } : out;
  }

  // Normalize a raw vision result into the shape the expense modal consumes.
  function normalizeReceipt(p) {
    p = p || {};
    const total = typeof p.total === 'number' && isFinite(p.total) ? Math.round(p.total * 100) / 100 : null;
    const cur = ['INR', 'USD', 'EUR', 'GBP'].includes(p.currency) ? p.currency : null;
    const lines = Array.isArray(p.lineItems) ? p.lineItems
      .filter((l) => l && (l.label != null) && typeof l.amount === 'number' && isFinite(l.amount))
      .map((l) => ({ label: String(l.label).slice(0, 80), amount: Math.round(l.amount * 100) / 100 })) : [];
    return {
      merchant: p.merchant || null,
      title: (p.title || p.merchant || '').toString().slice(0, 60),
      total,
      currency: cur,
      category: CATS.includes(p.category) ? p.category : null,
      date: typeof p.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(p.date) ? p.date : null,
      lines
    };
  }

  // Multimodal receipt OCR. `image` is a data URL (preferred) or {data,mimeType}.
  // Proxy (shared key) first, then a local key. Caller should fall back to the
  // on-device Tesseract engine when this returns a non-key error or throws.
  async function parseReceipt(image, ctx = {}) {
    const img = typeof image === 'string' ? splitDataUrl(image) : image;
    if (!img || !img.data) return { ok: false, error: 'no-image' };

    if (!ctx.apiKey && global.OrbitGroups && OrbitGroups.isReady && OrbitGroups.isReady() && OrbitGroups.aiOcr) {
      try {
        const r = await OrbitGroups.aiOcr({ data: img.data, mimeType: img.mimeType });
        if (r && r.ok) return { ok: true, parsed: normalizeReceipt(r.parsed), raw: r.raw };
        if (r && r.error && r.error !== 'no-server-key') return { ok: false, error: r.error, raw: r.raw };
      } catch (e) { /* proxy unreachable — fall back to a local key below */ }
    }

    const key = ctx.apiKey || await getKey();
    if (!key) return { ok: false, error: 'needs-key' };

    const r = await geminiGenerate(key, [
      { text: buildReceiptPrompt() },
      { inlineData: { mimeType: img.mimeType || 'image/jpeg', data: img.data } }
    ]);
    if (!r.ok) return r;
    const out = parseJsonResponse(r.json);
    return out.ok ? { ok: true, parsed: normalizeReceipt(out.parsed), raw: out.raw } : out;
  }

  global.OrbitAI = { parseExpense, parseReceipt, getKey, setKey, clearKey };
})(window);
