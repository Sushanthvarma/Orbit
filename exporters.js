/* ============================================================
   ORBIT WEB — Exporters (PDF + Excel)

   Lazy-loads vendor libs from CDN on first use so the cold-start
   cost is only paid by users who actually export.

   Public API on window.OrbitExport:
     await downloadPDF(payload)
     await downloadXLSX(payload)
   where payload is built by buildPayload(State).
   ============================================================ */
(function (global) {
  'use strict';

  const CDN = {
    jsPDF:       'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js',
    jsPDFAuto:   'https://cdn.jsdelivr.net/npm/jspdf-autotable@3.8.2/dist/jspdf.plugin.autotable.min.js',
    xlsx:        'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js'
  };

  const _loaded = {};
  function loadScript(url) {
    if (_loaded[url]) return _loaded[url];
    _loaded[url] = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = url; s.async = true;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('Failed to load ' + url));
      document.head.appendChild(s);
    });
    return _loaded[url];
  }

  async function loadPDF() {
    await loadScript(CDN.jsPDF);
    await loadScript(CDN.jsPDFAuto);
  }
  async function loadXLSX() {
    await loadScript(CDN.xlsx);
  }

  // ----- Payload shape (decoupled from the app) -----
  // {
  //   meta: { exportedAt: ISO, exporterName: string },
  //   groups: [{id, name, currency, members: [{id,name}]}],
  //   expenses: [{date, group, title, category, currency, amount, paidBy, splits:[{user, amount}]}],
  //   settlements: [{date, group, fromUser, toUser, amount, currency, method}],
  //   balances: [{otherName, amount, currency}]   // self-vs-other net
  // }

  function fmtDate(iso) {
    if (!iso) return '';
    return new Date(iso).toISOString().slice(0, 10);
  }

  // -------------------- PDF --------------------
  async function downloadPDF(payload, opts = {}) {
    await loadPDF();
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'pt', format: 'a4' });

    // --- Cover header ---
    const W = doc.internal.pageSize.getWidth();
    doc.setFillColor(10, 11, 15);
    doc.rect(0, 0, W, 70, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(20);
    doc.text('Orbit', 40, 36);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(165, 171, 188);
    doc.text('Money between friends, settled.', 40, 54);
    doc.setFontSize(9);
    doc.text('Exported ' + fmtDate(payload.meta.exportedAt) + (payload.meta.exporterName ? ' · ' + payload.meta.exporterName : ''), W - 40, 36, { align: 'right' });

    let y = 100;
    doc.setTextColor(0, 0, 0);

    // --- Balance summary ---
    if (payload.balances && payload.balances.length) {
      doc.setFont('helvetica', 'bold'); doc.setFontSize(13);
      doc.text('Balance summary', 40, y); y += 6;
      doc.autoTable({
        startY: y + 8,
        head: [['Person', 'Net', 'Currency']],
        body: payload.balances.map((b) => [b.otherName, b.amount.toFixed(2), b.currency]),
        styles: { fontSize: 9, cellPadding: 4 },
        headStyles: { fillColor: [25, 28, 37], textColor: 255 },
        margin: { left: 40, right: 40 }
      });
      y = doc.lastAutoTable.finalY + 20;
    }

    // --- Expenses per group ---
    const byGroup = {};
    payload.expenses.forEach((e) => {
      (byGroup[e.group] = byGroup[e.group] || []).push(e);
    });
    Object.keys(byGroup).forEach((gn) => {
      if (y > 700) { doc.addPage(); y = 60; }
      doc.setFont('helvetica', 'bold'); doc.setFontSize(12);
      doc.text(gn, 40, y);
      const totals = {};
      byGroup[gn].forEach((e) => { totals[e.currency] = (totals[e.currency] || 0) + e.amount; });
      const totalsStr = Object.entries(totals).map(([c, v]) => v.toFixed(2) + ' ' + c).join(' · ');
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
      doc.setTextColor(110, 117, 137);
      doc.text(byGroup[gn].length + ' expenses · ' + totalsStr, 40, y + 14);
      doc.setTextColor(0, 0, 0);
      doc.autoTable({
        startY: y + 22,
        head: [['Date', 'Description', 'Category', 'Paid by', 'Amount']],
        body: byGroup[gn].map((e) => [
          fmtDate(e.date), e.title, e.category, e.paidBy,
          e.amount.toFixed(2) + ' ' + e.currency
        ]),
        styles: { fontSize: 8.5, cellPadding: 3 },
        headStyles: { fillColor: [25, 28, 37], textColor: 255 },
        columnStyles: { 4: { halign: 'right' } },
        margin: { left: 40, right: 40 }
      });
      y = doc.lastAutoTable.finalY + 24;
    });

    // --- Settlements ---
    if (payload.settlements && payload.settlements.length) {
      if (y > 700) { doc.addPage(); y = 60; }
      doc.setFont('helvetica', 'bold'); doc.setFontSize(12);
      doc.text('Settlements', 40, y);
      doc.autoTable({
        startY: y + 14,
        head: [['Date', 'Group', 'From', 'To', 'Amount', 'Method']],
        body: payload.settlements.map((s) => [
          fmtDate(s.date), s.group, s.fromUser, s.toUser,
          s.amount.toFixed(2) + ' ' + s.currency, s.method || 'manual'
        ]),
        styles: { fontSize: 8.5, cellPadding: 3 },
        headStyles: { fillColor: [25, 28, 37], textColor: 255 },
        columnStyles: { 4: { halign: 'right' } },
        margin: { left: 40, right: 40 }
      });
    }

    // Footer + save
    const totalPages = doc.getNumberOfPages();
    for (let i = 1; i <= totalPages; i++) {
      doc.setPage(i);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
      doc.setTextColor(165, 171, 188);
      doc.text('Orbit · Page ' + i + ' of ' + totalPages, W - 40, doc.internal.pageSize.getHeight() - 20, { align: 'right' });
    }
    const fname = (opts.filename || 'orbit-' + fmtDate(payload.meta.exportedAt) + '.pdf');
    doc.save(fname);
  }

  // -------------------- XLSX --------------------
  async function downloadXLSX(payload, opts = {}) {
    await loadXLSX();
    const XLSX = window.XLSX;
    const wb = XLSX.utils.book_new();

    // Sheet 1: Summary
    const summary = [
      ['Orbit export'],
      ['Exported at', payload.meta.exportedAt],
      ['Exporter', payload.meta.exporterName || ''],
      [],
      ['Balance summary'],
      ['Person', 'Net amount', 'Currency'],
      ...payload.balances.map((b) => [b.otherName, b.amount, b.currency])
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summary), 'Summary');

    // Sheet 2: Groups
    const groupRows = [
      ['Group ID', 'Name', 'Currency', 'Members'],
      ...payload.groups.map((g) => [g.id, g.name, g.currency, g.members.map((m) => m.name).join(', ')])
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(groupRows), 'Groups');

    // Sheet 3: Expenses
    const expRows = [
      ['Date', 'Group', 'Title', 'Category', 'Currency', 'Amount', 'Paid by', 'Split details', 'Note'],
      ...payload.expenses.map((e) => [
        fmtDate(e.date), e.group, e.title, e.category, e.currency, e.amount, e.paidBy,
        e.splits.map((s) => s.user + ':' + s.amount.toFixed(2)).join(' / '),
        e.note || ''
      ])
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(expRows), 'Expenses');

    // Sheet 4: Settlements
    const setRows = [
      ['Date', 'Group', 'From', 'To', 'Amount', 'Currency', 'Method', 'Note'],
      ...payload.settlements.map((s) => [
        fmtDate(s.date), s.group, s.fromUser, s.toUser, s.amount, s.currency, s.method || 'manual', s.note || ''
      ])
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(setRows), 'Settlements');

    const fname = (opts.filename || 'orbit-' + fmtDate(payload.meta.exportedAt) + '.xlsx');
    XLSX.writeFile(wb, fname);
  }

  global.OrbitExport = { downloadPDF, downloadXLSX };
})(window);
