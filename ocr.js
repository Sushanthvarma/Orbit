/* ============================================================
   ORBIT WEB — Receipt OCR (Tesseract.js)

   Public API:
     await OrbitOCR.recognize(file)
       → { text, lines: [{raw,label,amount}], total, currency, rawWords }

   Tesseract.js is lazy-loaded from CDN on first call to avoid the
   ~10 MB cost for users who never scan a receipt.

   Line-item extraction is heuristic — works well on well-printed
   receipts. Each "line" with a trailing currency-formatted number
   becomes a (label, amount) tuple. Total row detected by keywords
   like "TOTAL", "GRAND TOTAL", "AMOUNT DUE".
   ============================================================ */
(function (global) {
  'use strict';

  const TESS_VER = '5.1.0';
  const TESS_CORE_VER = '5.0.0';
  const TESS_CDN = 'https://cdn.jsdelivr.net/npm/tesseract.js@' + TESS_VER + '/dist/tesseract.min.js';
  const TESS_WORKER = 'https://cdn.jsdelivr.net/npm/tesseract.js@' + TESS_VER + '/dist/worker.min.js';
  const TESS_CORE = 'https://cdn.jsdelivr.net/npm/tesseract.js-core@' + TESS_CORE_VER + '/tesseract-core-simd.wasm.js';
  const TESS_LANG = 'https://tessdata.projectnaptha.com/4.0.0';
  let _loaded = null;
  function loadTesseract() {
    if (_loaded) return _loaded;
    _loaded = new Promise((resolve, reject) => {
      if (window.Tesseract) return resolve(window.Tesseract);
      const s = document.createElement('script');
      s.src = TESS_CDN; s.async = true;
      s.onload = () => resolve(window.Tesseract);
      s.onerror = () => reject(new Error('Failed to load Tesseract.js'));
      document.head.appendChild(s);
    });
    return _loaded;
  }

  // Greedy currency detection — return ISO code or null.
  function detectCurrency(text) {
    if (/₹|INR\b|Rs\.|RUPEES/i.test(text)) return 'INR';
    if (/€|EUR\b/.test(text)) return 'EUR';
    if (/£|GBP\b/.test(text)) return 'GBP';
    if (/\$|USD\b/i.test(text)) return 'USD';
    return null;
  }

  // Match a number at the END of a line. Accepts 1,234.56 and 1234.56 and 1234.
  const TRAILING_AMOUNT = /(?:[₹€£$]\s*)?(-?\d{1,3}(?:[,\s]\d{3})*(?:\.\d{1,2})?|-?\d+(?:\.\d{1,2})?)\s*$/;

  function parseAmount(s) {
    if (!s) return null;
    const n = parseFloat(String(s).replace(/[,\s]/g, ''));
    return isFinite(n) ? Math.round(n * 100) / 100 : null;
  }

  function extractLines(rawText) {
    const lines = rawText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const items = [];
    let total = null;
    let totalLine = null;

    for (const raw of lines) {
      const m = raw.match(TRAILING_AMOUNT);
      if (!m) continue;
      const amt = parseAmount(m[1]);
      if (amt == null) continue;
      const label = raw.slice(0, raw.length - m[0].length).replace(/[:\-—.\s]+$/, '').trim();
      if (!label) continue;

      // Total-row detection
      const lower = label.toLowerCase();
      const isTotal = /\b(total|grand total|amount\s+due|net\s+payable|to\s+pay|sub\s*total)\b/.test(lower);
      if (isTotal) {
        if (total == null || /grand|net|due|to pay/.test(lower)) { total = amt; totalLine = label; }
        continue;
      }
      // Skip discount / tax marker rows if we want only items
      if (/\b(discount|cgst|sgst|igst|gst|service\s*charge|tip|tax)\b/i.test(label)) {
        items.push({ raw, label, amount: amt, isTaxOrFee: true });
        continue;
      }

      items.push({ raw, label, amount: amt });
    }

    // If no explicit total found, sum line items
    if (total == null && items.length) {
      total = Math.round(items.reduce((s, x) => s + x.amount, 0) * 100) / 100;
    }
    return { lines: items, total, totalLine };
  }

  async function recognize(fileOrBlob, opts = {}) {
    const Tesseract = await loadTesseract();
    const onProgress = opts.onProgress || (() => {});
    const lang = opts.lang || 'eng';

    const result = await Tesseract.recognize(fileOrBlob, lang, {
      workerPath: TESS_WORKER,
      corePath: TESS_CORE,
      langPath: TESS_LANG,
      logger: (m) => {
        if (m && typeof m.progress === 'number') onProgress(m);
      }
    });

    const text = result?.data?.text || '';
    const ex = extractLines(text);
    return {
      text,
      lines: ex.lines,
      total: ex.total,
      totalLine: ex.totalLine,
      currency: detectCurrency(text),
      rawWords: result?.data?.words || []
    };
  }

  global.OrbitOCR = { recognize, extractLines, detectCurrency };
})(window);
