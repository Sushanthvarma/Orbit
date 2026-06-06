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

  // Structural deep-equal that ignores object-key ordering — so a field
  // re-serialised with a different key order does not appear "changed".
  function eq(a, b) {
    if (a === b) return true;
    if (a == null || b == null) return a === b;
    if (typeof a !== typeof b) return false;
    if (typeof a !== 'object') return a === b;
    if (Array.isArray(a)) {
      if (!Array.isArray(b) || a.length !== b.length) return false;
      for (let i = 0; i < a.length; i++) if (!eq(a[i], b[i])) return false;
      return true;
    }
    if (Array.isArray(b)) return false;
    const ka = Object.keys(a), kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    for (const k of ka) if (!eq(a[k], b[k])) return false;
    return true;
  }

  // Field diff between two snapshots — returns array of {field, before, after}.
  function diff(prev, next) {
    if (!prev || !next) return [];
    const fields = new Set([...Object.keys(prev), ...Object.keys(next)]);
    const out = [];
    for (const k of fields) {
      if (k === 'id' || k === 'history' || k === 'updatedAt') continue;
      if (!eq(prev[k], next[k])) out.push({ field: k, before: prev[k], after: next[k] });
    }
    return out;
  }

  // Build a persistable activity entry WITHOUT writing it — so callers can
  // include it in an atomic multi-store OrbitDB.writeTx alongside the entity it
  // describes (expense/settlement), keeping the feed and the data in lock-step.
  function build(entry) {
    return {
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
  }

  async function log(OrbitDB, entry) {
    if (!OrbitDB) return null;
    const e = build(entry);
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
      restore: 'Restored',
      join: 'Joined',
      remove: 'Removed'
    })[a] || a;
  }

  function actionIcon(a) {
    return ({
      add: '＋',
      edit: '✎',
      delete: '×',
      settle: '✓',
      import: '⇪',
      restore: '↺',
      join: '👋',
      remove: '−'
    })[a] || '·';
  }

  global.OrbitActivity = { log, build, diff, snap, actionLabel, actionIcon, newId };
})(window);
