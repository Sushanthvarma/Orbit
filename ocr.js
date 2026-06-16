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
  // Point corePath at the package DIRECTORY (note the trailing slash), NOT a
  // specific .wasm.js file. Tesseract then feature-detects WASM SIMD and loads
  // the SIMD core where supported, the plain core where not. Hard-coding the
  // `-simd` build forced SIMD and broke OCR on browsers/webviews without it
  // (notably some mobile environments) — the engine failed to start at all.
  const TESS_CORE = 'https://cdn.jsdelivr.net/npm/tesseract.js-core@' + TESS_CORE_VER + '/';
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

  // ---- Image helpers ------------------------------------------------------
  // Load a File/Blob into a decoded HTMLImageElement.
  function fileToImage(fileOrBlob) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(fileOrBlob);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read image')); };
      img.src = url;
    });
  }

  // Downscale a receipt photo to a compact JPEG data URL. Reused both for
  // storing the attached receipt and (loosely) for sizing the OCR input.
  // Default cap keeps it well under Firestore's 1 MB doc limit when synced.
  async function fileToDataURL(fileOrBlob, maxDim = 1280, quality = 0.72) {
    const img = await fileToImage(fileOrBlob);
    let w = img.naturalWidth || img.width;
    let h = img.naturalHeight || img.height;
    const longest = Math.max(w, h);
    const scale = longest > maxDim ? maxDim / longest : 1;
    w = Math.max(1, Math.round(w * scale));
    h = Math.max(1, Math.round(h * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    canvas.getContext('2d').drawImage(img, 0, 0, w, h);
    return canvas.toDataURL('image/jpeg', quality);
  }

  // Pre-process for OCR: right-size, grayscale, then stretch contrast so faint
  // thermal-printer text turns crisp black-on-white. Tesseract is far more
  // accurate on a clean high-contrast grayscale than on a raw phone photo.
  function preprocess(img, maxDim = 1800) {
    let w = img.naturalWidth || img.width;
    let h = img.naturalHeight || img.height;
    const longest = Math.max(w, h);
    let scale = 1;
    if (longest > maxDim) scale = maxDim / longest;            // shrink huge photos
    else if (longest < 1000) scale = Math.min(2, 1000 / longest); // gently enlarge tiny ones
    w = Math.max(1, Math.round(w * scale));
    h = Math.max(1, Math.round(h * scale));

    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, w, h);
    const imgData = ctx.getImageData(0, 0, w, h);
    const d = imgData.data;

    // Pass 1 — luminance + min/max for contrast stretch.
    const gray = new Uint8ClampedArray(d.length / 4);
    let min = 255, max = 0;
    for (let i = 0, j = 0; i < d.length; i += 4, j++) {
      const g = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) | 0;
      gray[j] = g;
      if (g < min) min = g;
      if (g > max) max = g;
    }
    const range = Math.max(1, max - min);

    // Pass 2 — stretch to full 0..255 range.
    for (let i = 0, j = 0; i < d.length; i += 4, j++) {
      let v = (gray[j] - min) * 255 / range;
      v = v < 0 ? 0 : v > 255 ? 255 : v;
      d[i] = d[i + 1] = d[i + 2] = v;
    }
    ctx.putImageData(imgData, 0, 0);
    return canvas;
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

    // Clean the image up before handing it to the engine. If anything goes
    // wrong (decode failure, tainted canvas) we fall back to the raw file
    // rather than failing the scan outright.
    let input = fileOrBlob;
    if (opts.preprocess !== false) {
      try { input = preprocess(await fileToImage(fileOrBlob), opts.maxDim); }
      catch (_) { input = fileOrBlob; }
    }

    // Use the worker API so we can set the page-segmentation mode. PSM 4
    // ("single column of text of variable sizes") matches receipt layout far
    // better than the default auto mode and dramatically cuts garbled lines.
    let worker;
    try {
      worker = await Tesseract.createWorker(lang, 1, {
        workerPath: TESS_WORKER,
        corePath: TESS_CORE,
        langPath: TESS_LANG,
        logger: (m) => { if (m && typeof m.progress === 'number') onProgress(m); }
      });
      await worker.setParameters({
        tessedit_pageseg_mode: '4',
        preserve_interword_spaces: '1'
      });
      const result = await worker.recognize(input);
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
    } finally {
      if (worker) { try { await worker.terminate(); } catch (_) {} }
    }
  }

  global.OrbitOCR = { recognize, extractLines, detectCurrency, fileToDataURL };
})(window);
