/* ============================================================
   ORBIT WEB — AI natural-language expense entry (Gemini 1.5 Flash)

   Call: await OrbitAI.parseExpense(text, { contacts, groups, defaults })
   Returns: { ok, parsed, raw, error }
     parsed = { title, amount, currency, category, paidByName, participants[], splitMode, splits? }

   Key storage: meta['geminiApiKey']. First call without a key returns
   { ok:false, error:'needs-key' } so the UI can prompt.
   ============================================================ */
(function (global) {
  'use strict';

  const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent';

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
    const cats = (ctx.categories || ['food','travel','bills','shop','fun','rent','transport','other']).join(', ');
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

  async function parseExpense(text, ctx = {}) {
    const key = ctx.apiKey || await getKey();
    if (!key) return { ok: false, error: 'needs-key' };
    if (!text || !text.trim()) return { ok: false, error: 'empty-input' };

    const prompt = buildPrompt(text, ctx);
    let body;
    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: 'application/json', temperature: 0 }
        })
      });
      if (!res.ok) {
        // Scrub any echo of the key from the error body before surfacing it.
        const txt = (await res.text().catch(() => '')).split(key).join('***');
        return { ok: false, error: 'http-' + res.status, raw: txt };
      }
      body = await res.json();
    } catch (e) {
      return { ok: false, error: 'network', raw: String(e) };
    }

    const partText = body?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    let parsed;
    try {
      parsed = JSON.parse(partText.trim().replace(/^```json\s*|\s*```$/g, ''));
    } catch (_) {
      return { ok: false, error: 'parse', raw: partText };
    }
    return { ok: true, parsed, raw: partText };
  }

  global.OrbitAI = { parseExpense, getKey, setKey, clearKey };
})(window);
