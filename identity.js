/* ============================================================
   ORBIT WEB — Identity resolution (owner-side)
   ------------------------------------------------------------
   The hard problem: one human shows up under many handles —
   a Gmail login, a Yahoo address saved in your phone, a phone
   number. Splitwise-style apps must decide "same person or new
   person?" *without ever silently merging the wrong two humans*.

   This module is the OWNER-SIDE half of that. It keeps your local
   contacts (the `users` store) clean by:
     • letting one contact carry MANY handles (emails[] + phones[]),
       so gmail + yahoo + phone all resolve to one person;
     • resolving a freshly-typed/picked person against your contacts
       with ranked CONFIDENCE — an exact handle match is certain and
       auto-reuses; a mere same-name match is AMBIGUOUS and must be
       confirmed, never assumed;
     • planning a non-destructive MERGE of two contacts that relabels
       every expense / settlement / group-membership id (a pure
       relabel — amounts are never touched, balances are preserved),
       mirroring the cloud claimPending() rewrite but locally.

   Pure + framework-free: every function takes plain arrays and
   returns plain data, so it's trivially testable and never reaches
   into app state. app.js does the IndexedDB writes from the plan.

   The cloud-side identity INDEX (mapping a user's many verified
   handles -> one uid, so an INVITEE auto-claims regardless of which
   handle they were invited under) is a separate, deploy-gated piece.
   ============================================================ */
(function (global) {
  'use strict';

  // ---- Handle normalization (single source of truth) ----
  // app.js and groups.js historically each had their own copy; these are
  // the canonical versions. Email -> trimmed lowercase. Phone -> digits
  // (+country), defaulting a bare 10-digit number to India (+91) to match
  // how the cloud layer keys claim tickets.
  function normEmail(s) { return (s || '').trim().toLowerCase(); }
  function normPhone(s) {
    let d = (s || '').replace(/[^\d+]/g, '');
    if (d && !d.startsWith('+') && d.length === 10) d = '+91' + d; // India default
    return d;
  }
  function normName(s) { return (s || '').trim().replace(/\s+/g, ' ').toLowerCase(); }

  // Every email + phone a contact is known by, normalized + de-duped.
  // Supports both the legacy single-handle shape ({email, phone}) and the
  // multi-handle shape ({emails:[], phones:[]}) so old records keep working.
  function handlesOf(u) {
    if (!u) return { emails: [], phones: [] };
    const emails = new Set();
    const phones = new Set();
    [u.email].concat(u.emails || []).forEach((e) => { const v = normEmail(e); if (v) emails.add(v); });
    [u.phone].concat(u.phones || []).forEach((p) => { const v = normPhone(p); if (v) phones.add(v); });
    return { emails: Array.from(emails), phones: Array.from(phones) };
  }

  // Flat set of all handles (emails + phones) for quick overlap tests.
  function handleSet(u) {
    const { emails, phones } = handlesOf(u);
    return new Set(emails.concat(phones));
  }

  // Do two contacts share at least one concrete handle? (definitive same-person)
  function shareHandle(a, b) {
    const sb = handleSet(b);
    for (const h of handleSet(a)) if (sb.has(h)) return true;
    return false;
  }

  /**
   * resolve(candidate, contacts, opts) — decide who a person is.
   *
   *   candidate : { name, email, phone }  (raw, unnormalized is fine)
   *   contacts  : array of existing user/contact records (incl. self)
   *   opts.excludeIds : ids to ignore (e.g. members already in the group)
   *
   * Returns one of:
   *   { kind: 'exact',     user, reason }      // a handle matched — certain
   *   { kind: 'ambiguous', candidates[], reason } // same name, NO shared handle — ASK
   *   { kind: 'none' }                          // genuinely new person
   *
   * Priority: a shared email/phone beats everything (two humans don't share
   * a verified handle). Name-only is never treated as certain — that's the
   * "two different Priyas" trap, so it's surfaced for explicit confirmation.
   */
  function resolve(candidate, contacts, opts) {
    opts = opts || {};
    const exclude = new Set(opts.excludeIds || []);
    const pool = (contacts || []).filter((u) => u && !u.isSelf && !exclude.has(u.id));

    const cEmail = normEmail(candidate && candidate.email);
    const cPhone = normPhone(candidate && candidate.phone);
    const cName = normName(candidate && candidate.name);

    // 1) Exact handle match — definitive.
    if (cEmail || cPhone) {
      const hit = pool.find((u) => {
        const hs = handleSet(u);
        return (cEmail && hs.has(cEmail)) || (cPhone && hs.has(cPhone));
      });
      if (hit) {
        return { kind: 'exact', user: hit, reason: cEmail && handleSet(hit).has(cEmail) ? 'email' : 'phone' };
      }
    }

    // 2) Same name, but NO shared handle — could be the same person under a new
    //    handle, or a different person who shares a name. Don't guess: ask.
    if (cName) {
      const sameName = pool.filter((u) => normName(u.name) === cName);
      if (sameName.length) {
        // If the candidate brought a NEW handle that none of them have, it's a
        // genuine ambiguity worth confirming. If the candidate has no handle at
        // all, reusing the lone same-name contact is the long-standing, safe
        // behavior (a name-only contact is just a label).
        const candidateHasHandle = !!(cEmail || cPhone);
        if (!candidateHasHandle && sameName.length === 1) {
          return { kind: 'exact', user: sameName[0], reason: 'name-only' };
        }
        return { kind: 'ambiguous', candidates: sameName, reason: candidateHasHandle ? 'name-new-handle' : 'name' };
      }
    }

    return { kind: 'none' };
  }

  // Scan a contact list for likely duplicates (for a "review duplicates" tool).
  // Pairs are grouped when they share a handle OR share a normalized name.
  // Returns [{ a, b, reason }]. Self is included so a self/ghost dupe surfaces.
  function findDuplicatePairs(contacts) {
    const pool = (contacts || []).filter(Boolean);
    const out = [];
    for (let i = 0; i < pool.length; i++) {
      for (let j = i + 1; j < pool.length; j++) {
        const a = pool[i], b = pool[j];
        if (shareHandle(a, b)) out.push({ a, b, reason: 'handle' });
        else if (normName(a.name) && normName(a.name) === normName(b.name)) out.push({ a, b, reason: 'name' });
      }
    }
    return out;
  }

  // Fold a candidate's handles into an existing contact record, returning a NEW
  // record (callers persist it). Keeps the primary email/phone fields populated
  // for the cloud lookups that still read them, and accumulates the rest in
  // emails[]/phones[] so nothing is lost.
  function absorbHandles(into, candidate) {
    const merged = Object.assign({}, into);
    const cEmail = normEmail(candidate && candidate.email);
    const cPhone = normPhone(candidate && candidate.phone);
    const h = handlesOf(merged);
    const emails = new Set(h.emails);
    const phones = new Set(h.phones);
    if (cEmail) emails.add(cEmail);
    if (cPhone) phones.add(cPhone);
    const eArr = Array.from(emails), pArr = Array.from(phones);
    merged.email = merged.email && normEmail(merged.email) ? normEmail(merged.email) : (eArr[0] || '');
    merged.phone = merged.phone && normPhone(merged.phone) ? normPhone(merged.phone) : (pArr[0] || '');
    if (eArr.length > 1) merged.emails = eArr; else if (eArr.length) merged.emails = eArr;
    if (pArr.length > 1) merged.phones = pArr; else if (pArr.length) merged.phones = pArr;
    return merged;
  }

  /**
   * planMerge(keepId, dropId, data) — non-destructive contact merge.
   *
   *   data = { users, groups, expenses, settlements }  (plain arrays)
   *
   * Produces a list of OrbitDB.writeTx ops that:
   *   • union dropId's handles into the keep contact;
   *   • replace dropId with keepId in every group's members[] (dedup);
   *   • relabel dropId -> keepId in every expense (paidBy, splits[].userId,
   *     payers[].userId) and settlement (fromUser/toUser/fromUid/toUid);
   *   • delete the dropped contact.
   *
   * Amounts are never altered — this is a pure id relabel, so balances are
   * identical before and after. Returns { ops, touched } or throws on bad ids.
   */
  function planMerge(keepId, dropId, data) {
    if (!keepId || !dropId || keepId === dropId) throw new Error('planMerge: need two distinct ids');
    const users = data.users || [], groups = data.groups || [],
      expenses = data.expenses || [], settlements = data.settlements || [];
    const keep = users.find((u) => u.id === keepId);
    const drop = users.find((u) => u.id === dropId);
    if (!keep) throw new Error('planMerge: keep contact not found');
    if (!drop) throw new Error('planMerge: drop contact not found');
    if (keep.isSelf && drop.isSelf) throw new Error('planMerge: cannot merge self into self');
    // Never let "self" be the one deleted — flip so self is always kept.
    if (drop.isSelf) return planMerge(dropId, keepId, data);

    const ops = [];
    const touched = { groups: 0, expenses: 0, settlements: 0 };

    // 1) Union handles (+ fill blank name) onto the keep contact.
    const mergedKeep = absorbHandles(keep, { email: drop.email, phone: drop.phone });
    (drop.emails || []).forEach((e) => { const m = absorbHandles(mergedKeep, { email: e }); Object.assign(mergedKeep, m); });
    (drop.phones || []).forEach((p) => { const m = absorbHandles(mergedKeep, { phone: p }); Object.assign(mergedKeep, m); });
    if (!mergedKeep.name && drop.name) mergedKeep.name = drop.name;
    if (!mergedKeep.upi && drop.upi) mergedKeep.upi = drop.upi;
    ops.push({ store: 'users', op: 'put', value: mergedKeep });

    // 2) Group memberships.
    groups.forEach((g) => {
      if (!Array.isArray(g.members) || g.members.indexOf(dropId) === -1) return;
      const next = [];
      g.members.forEach((m) => {
        const id = (m === dropId) ? keepId : m;
        if (next.indexOf(id) === -1) next.push(id);
      });
      ops.push({ store: 'groups', op: 'put', value: Object.assign({}, g, { members: next }) });
      touched.groups++;
    });

    // 3) Expenses — relabel payer, splits, payers.
    expenses.forEach((e) => {
      let changed = false;
      const next = Object.assign({}, e);
      if (e.paidBy === dropId) { next.paidBy = keepId; changed = true; }
      if (Array.isArray(e.splits)) {
        next.splits = e.splits.map((s) => (s && s.userId === dropId ? (changed = true, Object.assign({}, s, { userId: keepId })) : s));
      }
      if (Array.isArray(e.payers)) {
        next.payers = e.payers.map((p) => (p && p.userId === dropId ? (changed = true, Object.assign({}, p, { userId: keepId })) : p));
      }
      if (changed) { ops.push({ store: 'expenses', op: 'put', value: next }); touched.expenses++; }
    });

    // 4) Settlements — relabel both legacy (fromUser/toUser) and uid fields.
    settlements.forEach((s) => {
      let changed = false;
      const next = Object.assign({}, s);
      ['fromUser', 'toUser', 'fromUid', 'toUid'].forEach((k) => {
        if (s[k] === dropId) { next[k] = keepId; changed = true; }
      });
      if (changed) { ops.push({ store: 'settlements', op: 'put', value: next }); touched.settlements++; }
    });

    // 5) Drop the absorbed contact last.
    ops.push({ store: 'users', op: 'delete', value: dropId });

    return { ops, touched, keepId, dropId };
  }

  global.OrbitIdentity = {
    normEmail, normPhone, normName,
    handlesOf, handleSet, shareHandle,
    resolve, findDuplicatePairs, absorbHandles, planMerge
  };
})(window);
