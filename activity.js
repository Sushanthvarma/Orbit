/* ============================================================
   ORBIT WEB — Activity log + edit history

   Schema of an activity entry (IndexedDB store 'activity'):
     {
       id: 'a_xxx',
       ts: ISO,
       actorId: 'u_self',
       action: 'add' | 'edit' | 'delete' | 'settle' | 'import' | 'restore',
       entityType: 'expense' | 'settlement' | 'group',
       entityId: string,
       groupId: string | null,
       snapshot: object | null,    // current state
       prev: object | null,        // previous state (for edits / restores)
       meta: object | null         // free-form (e.g. {count: 27} for imports)
     }

   We log via OrbitActivity.log({...}). Reads via OrbitDB.getAll('activity').
   The store is per-user (cloud.js mirrors it to orbit/{uid}/activity).
   ============================================================ */
(function (global) {
  'use strict';

  function newId() {
    return 'a_' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3);
  }

  // Lightweight clone — strips reactive nonsense and lets us serialize safely.
  function snap(obj) {
    if (obj == null) return null;
    try { return JSON.parse(JSON.stringify(obj)); }
    catch (_) { return null; }
  }

  // Field diff between two snapshots — returns array of {field, before, after}.
  function diff(prev, next) {
    if (!prev || !next) return [];
    const fields = new Set([...Object.keys(prev), ...Object.keys(next)]);
    const out = [];
    for (const k of fields) {
      if (k === 'id' || k === 'history') continue;
      const a = prev[k], b = next[k];
      const same = JSON.stringify(a) === JSON.stringify(b);
      if (!same) out.push({ field: k, before: a, after: b });
    }
    return out;
  }

  async function log(OrbitDB, entry) {
    if (!OrbitDB) return null;
    const e = {
      id: newId(),
      ts: new Date().toISOString(),
      actorId: entry.actorId || 'u_self',
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId || null,
      groupId: entry.groupId || null,
      snapshot: snap(entry.snapshot),
      prev: snap(entry.prev),
      meta: entry.meta || null
    };
    try { await OrbitDB.put('activity', e); } catch (err) { console.warn('Activity log failed', err); }
    return e;
  }

  function actionLabel(a) {
    return ({
      add: 'Added',
      edit: 'Edited',
      delete: 'Deleted',
      settle: 'Settled',
      import: 'Imported',
      restore: 'Restored'
    })[a] || a;
  }

  function actionIcon(a) {
    return ({
      add: '＋',
      edit: '✎',
      delete: '×',
      settle: '✓',
      import: '⇪',
      restore: '↺'
    })[a] || '·';
  }

  global.OrbitActivity = { log, diff, snap, actionLabel, actionIcon, newId };
})(window);
