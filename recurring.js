/* ============================================================
   ORBIT WEB — Recurring expenses engine

   Schema added to expense objects (optional):
     recurring: {
       freq: 'weekly' | 'fortnightly' | 'monthly' | 'yearly',
       anchorDate: ISO,          // first occurrence date
       nextDue: ISO,             // when the NEXT clone should fire
       active: boolean,
       parentId: string|null,    // for cloned children — id of template
       lastSpawnedAt: ISO|null
     }

   The "template" expense lives in `expenses` like any other; we just check
   its recurring.nextDue on app boot. When due, we clone it (without the
   recurring field) and advance nextDue.

   Children (spawned clones) carry recurring.parentId so they can be
   filtered out of the template list.
   ============================================================ */
(function (global) {
  'use strict';

  function addInterval(iso, freq) {
    const d = new Date(iso);
    if (freq === 'weekly') {
      d.setDate(d.getDate() + 7);
    } else if (freq === 'fortnightly') {
      d.setDate(d.getDate() + 14);
    } else if (freq === 'yearly') {
      // Feb 29 + 1 year must land on Feb 28 (not Mar 1) in a non-leap year.
      const day = d.getDate();
      d.setFullYear(d.getFullYear() + 1);
      if (d.getDate() !== day) d.setDate(0); // overflowed → clamp to last day of intended month
    } else {
      // Monthly. JS setMonth on a day that doesn't exist in the target month
      // rolls FORWARD (Jan 31 + 1mo → Mar 3), silently skipping February. Clamp
      // to the last day of the intended month instead (Jan 31 → Feb 28/29).
      const day = d.getDate();
      d.setMonth(d.getMonth() + 1);
      if (d.getDate() !== day) d.setDate(0);
    }
    return d.toISOString();
  }

  function freqLabel(freq) {
    return ({ weekly: 'Weekly', fortnightly: 'Every 2 weeks', monthly: 'Monthly', yearly: 'Yearly' })[freq] || 'Monthly';
  }

  // Generate a fresh id for clones. App.js's uid() is preferred when available.
  function newId() {
    if (typeof global.uid === 'function') return global.uid('e');
    return 'e_' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3);
  }

  // Templates = parent expenses that own a recurring schedule.
  function templates(expenses) {
    return (expenses || []).filter((e) => e.recurring && e.recurring.freq && !e.recurring.parentId);
  }

  // Children = clones produced by the engine.
  function children(expenses, parentId) {
    return (expenses || []).filter((e) => e.recurring && e.recurring.parentId === parentId);
  }

  // Run on boot. Returns { spawned: number, advanced: number }.
  async function processRecurring(OrbitDB, State) {
    if (!OrbitDB || !State) return { spawned: 0, advanced: 0 };
    const now = Date.now();
    const templ = templates(State.expenses);
    let spawned = 0;
    let advanced = 0;

    for (const t of templ) {
      if (!t.recurring.active) continue;
      if (!t.recurring.nextDue) {
        const anchor = t.recurring.anchorDate || t.date;
        const anchorMs = new Date(anchor).getTime();
        if (!isFinite(anchorMs)) continue; // refuse to corrupt nextDue with NaN
        t.recurring.nextDue = addInterval(anchor, t.recurring.freq);
        await OrbitDB.put('expenses', t);
        advanced++;
        continue;
      }
      if (!isFinite(new Date(t.recurring.nextDue).getTime())) continue;

      let nextDue = t.recurring.nextDue;
      // Spawn as many clones as are overdue (e.g., if user was offline two months).
      // Cap at 12 to prevent runaway.
      let safety = 12;
      while (new Date(nextDue).getTime() <= now && safety-- > 0) {
        const clone = {
          ...JSON.parse(JSON.stringify(t)),
          id: newId(),
          date: nextDue,
          recurring: { freq: t.recurring.freq, parentId: t.id, active: true }
        };
        delete clone.recurring.nextDue;
        delete clone.recurring.anchorDate;
        await OrbitDB.put('expenses', clone);
        State.expenses.push(clone);
        spawned++;
        nextDue = addInterval(nextDue, t.recurring.freq);
      }

      if (nextDue !== t.recurring.nextDue) {
        t.recurring.nextDue = nextDue;
        t.recurring.lastSpawnedAt = new Date().toISOString();
        await OrbitDB.put('expenses', t);
        State.expenses = State.expenses.map((e) => e.id === t.id ? t : e);
        advanced++;
      }
    }
    return { spawned, advanced };
  }

  global.OrbitRecurring = {
    processRecurring,
    addInterval,
    freqLabel,
    templates,
    children
  };
})(window);
