/* ============================================================
   ORBIT WEB — Importers (Splitwise CSV)
   Pure parser. UI lives in app.js (openImportModal).

   Splitwise CSV export format (May 2026):
     Date,Description,Category,Cost,Currency,<Person1>,<Person2>,...
     2026-05-12,Dinner,Food and drink,2400.00,INR,800.00,-1200.00,400.00
     2026-05-20,Total balance,,,,800.00,-1200.00,400.00

   Per-person column = signed net for that row.
     Positive = group owes that person (they paid more than their share).
     Negative = that person owes group (paid less than their share).
   Columns sum to ~0 for a single expense row.

   Convention used here:
     - paidBy = person with largest positive column (single-payer heuristic).
     - share_i = (paid_amount_for_i) − (column_i)
                 paid_amount_for_payer = Cost; others = 0.
   Multi-payer expenses are flattened to single-payer; flagged in `warnings`.

   Special rows:
     - Description matches /^Total balance$/i              → skip (running totals).
     - Category in {Payment, Settle up}                    → emit as settlement.
     - Empty / header rows                                 → skip.
   ============================================================ */
(function (global) {
  'use strict';

  // -------- CSV parsing (RFC 4180 — handles quoted fields, escaped quotes) --------
  function parseCSV(text) {
    // Strip UTF-8 BOM — Splitwise CSV exports always start with one.
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    const rows = [];
    let row = [];
    let field = '';
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      const next = text[i + 1];
      if (inQuotes) {
        if (ch === '"' && next === '"') { field += '"'; i++; }
        else if (ch === '"') { inQuotes = false; }
        else { field += ch; }
      } else {
        if (ch === '"') { inQuotes = true; }
        else if (ch === ',') { row.push(field); field = ''; }
        else if (ch === '\r') { /* skip */ }
        else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
        else { field += ch; }
      }
    }
    if (field.length || row.length) { row.push(field); rows.push(row); }
    return rows.filter((r) => r.length > 1 || (r.length === 1 && r[0].trim().length));
  }

  // -------- Normalisation helpers --------
  function parseAmount(s) {
    if (s == null) return 0;
    const v = String(s).replace(/[,\s₹$€£]/g, '').trim();
    if (!v) return 0;
    const n = parseFloat(v);
    return isFinite(n) ? Math.round(n * 100) / 100 : 0;
  }
  function normHeader(s) {
    return String(s || '').trim().toLowerCase();
  }
  function isFooterRow(desc) {
    const d = (desc || '').trim().toLowerCase();
    return d === 'total balance' || d === 'totals' || d.startsWith('total ');
  }
  function isSettlementRow(category, desc) {
    const c = (category || '').trim().toLowerCase();
    if (c === 'payment' || c === 'settle up' || c === 'settlement') return true;
    const d = (desc || '').trim().toLowerCase();
    return d.startsWith('payment from ') || d.startsWith('settle up');
  }

  // Map raw Splitwise category labels to Orbit category ids.
  const CATEGORY_MAP = {
    'food and drink': 'food', 'food & drink': 'food', 'restaurants': 'food', 'groceries': 'food',
    'dining out': 'food', 'liquor': 'food',
    'transportation': 'transport', 'taxi': 'transport', 'parking': 'transport', 'gas/fuel': 'transport',
    'flight': 'travel', 'flights': 'travel', 'hotel': 'travel', 'hotels': 'travel', 'travel': 'travel',
    'car rental': 'travel', 'public transit': 'transport',
    'rent': 'rent', 'mortgage': 'rent', 'housing': 'rent',
    'utilities': 'bills', 'electricity': 'bills', 'water': 'bills', 'gas': 'bills',
    'internet': 'bills', 'mobile': 'bills', 'phone': 'bills', 'tv/phone/internet': 'bills',
    'general': 'other', 'other': 'other', 'uncategorized': 'other',
    'entertainment': 'fun', 'games': 'fun', 'movies': 'fun', 'music': 'fun', 'sports': 'fun',
    'shopping': 'shop', 'clothing': 'shop', 'electronics': 'shop', 'gifts': 'shop',
    'household supplies': 'shop'
  };
  function mapCategory(raw) {
    const k = (raw || '').trim().toLowerCase();
    return CATEGORY_MAP[k] || 'other';
  }

  // -------- Main parse --------
  // Returns: { ok, expenses, settlements, people, warnings, errors, totals }
  function parseSplitwiseCSV(text) {
    const out = {
      ok: false,
      expenses: [],
      settlements: [],
      people: [],         // [{rawName, share: signedSum}] for review UI
      warnings: [],
      errors: [],
      totals: { expenseCount: 0, settlementCount: 0, rowsSeen: 0, rowsSkipped: 0 }
    };

    const rows = parseCSV(text);
    if (rows.length < 2) {
      out.errors.push('CSV looks empty.');
      return out;
    }

    const header = rows[0].map(normHeader);
    const dateIdx = header.indexOf('date');
    const descIdx = header.findIndex((h) => h === 'description' || h === 'title');
    const catIdx  = header.indexOf('category');
    const costIdx = header.indexOf('cost');
    const curIdx  = header.indexOf('currency');

    if (dateIdx < 0 || descIdx < 0 || costIdx < 0) {
      out.errors.push('CSV missing required columns. Expected at least Date, Description, Cost. Got: ' + rows[0].join(', '));
      return out;
    }

    // Person columns = everything after Currency (or after Cost if no Currency col).
    const firstPersonIdx = curIdx >= 0 ? curIdx + 1 : costIdx + 1;
    const personHeaders = rows[0].slice(firstPersonIdx).map((s) => String(s || '').trim()).filter(Boolean);
    if (personHeaders.length < 1) {
      out.errors.push('No person columns detected after Currency. Re-export from Splitwise → group → Export as CSV.');
      return out;
    }

    // Track per-person aggregate (for the review UI sanity-check).
    const personAgg = {};
    personHeaders.forEach((n) => { personAgg[n] = 0; });

    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      if (!row || row.every((c) => !String(c || '').trim())) continue;
      out.totals.rowsSeen++;

      const date = (row[dateIdx] || '').trim();
      const desc = (row[descIdx] || '').trim();
      const cat  = catIdx >= 0 ? (row[catIdx] || '').trim() : '';
      const costRaw = row[costIdx] || '';
      const cost = parseAmount(costRaw);
      const cur  = curIdx >= 0 ? ((row[curIdx] || 'INR').trim().toUpperCase() || 'INR') : 'INR';

      if (isFooterRow(desc)) { out.totals.rowsSkipped++; continue; }
      if (!date || (!desc && cost === 0)) { out.totals.rowsSkipped++; continue; }

      const colVals = personHeaders.map((_, i) => parseAmount(row[firstPersonIdx + i]));

      // Settlement?
      if (isSettlementRow(cat, desc)) {
        // Settlement: exactly one person has +amount, one has −amount.
        let toIdx = -1, fromIdx = -1, amt = 0;
        for (let i = 0; i < colVals.length; i++) {
          if (colVals[i] > amt) { amt = colVals[i]; toIdx = i; }
        }
        for (let i = 0; i < colVals.length; i++) {
          if (colVals[i] < 0 && (fromIdx < 0 || colVals[i] < colVals[fromIdx])) fromIdx = i;
        }
        if (toIdx >= 0 && fromIdx >= 0) {
          out.settlements.push({
            __rawDate: date,
            __rawCost: cost,
            currency: cur,
            amount: Math.abs(amt),
            fromName: personHeaders[fromIdx],
            toName: personHeaders[toIdx],
            note: desc || 'Imported from Splitwise'
          });
          out.totals.settlementCount++;
        } else {
          out.warnings.push('Settlement row "' + desc + '" could not be parsed (date ' + date + ').');
          out.totals.rowsSkipped++;
        }
        continue;
      }

      // Expense
      if (cost <= 0) { out.totals.rowsSkipped++; continue; }

      // Single-payer heuristic: payer is the column with the largest positive value.
      let payerIdx = -1;
      let payerNet = -Infinity;
      for (let i = 0; i < colVals.length; i++) {
        if (colVals[i] > payerNet) { payerNet = colVals[i]; payerIdx = i; }
      }
      if (payerIdx < 0) { out.totals.rowsSkipped++; continue; }

      // Build splits: share_i = (paid_i) − (column_i); paid_i = cost only for payer.
      const splits = [];
      for (let i = 0; i < colVals.length; i++) {
        const paid = i === payerIdx ? cost : 0;
        const share = Math.round((paid - colVals[i]) * 100) / 100;
        if (share > 0.005) {
          splits.push({ rawName: personHeaders[i], amount: share });
        }
      }

      // Multi-payer detection: any non-payer column positive.
      const positives = colVals.filter((v, i) => i !== payerIdx && v > 0.005).length;
      if (positives > 0) {
        out.warnings.push('Row "' + desc + '" (' + date + ') has multiple payers — imported as single-payer with ' + personHeaders[payerIdx] + '.');
      }

      out.expenses.push({
        __rawDate: date,
        title: desc || 'Expense',
        amount: cost,
        currency: cur,
        category: mapCategory(cat),
        paidByName: personHeaders[payerIdx],
        splits,          // [{rawName, amount}]
        note: ''
      });
      out.totals.expenseCount++;

      // Aggregate per person
      for (let i = 0; i < colVals.length; i++) personAgg[personHeaders[i]] += colVals[i];
    }

    out.people = personHeaders.map((n) => ({ rawName: n, net: Math.round(personAgg[n] * 100) / 100 }));
    out.ok = out.expenses.length > 0 || out.settlements.length > 0;
    if (!out.ok && !out.errors.length) out.errors.push('No expenses or settlements found in CSV.');
    return out;
  }

  // Convert raw ISO-ish date string to ISO 8601. Splitwise uses YYYY-MM-DD.
  function toISODate(raw) {
    if (!raw) return new Date().toISOString();
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return new Date(raw + 'T12:00:00').toISOString();
    const d = new Date(raw);
    return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
  }

  global.OrbitImport = {
    parseSplitwiseCSV,
    toISODate,
    mapCategory
  };
})(window);
