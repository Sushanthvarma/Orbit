/* ============================================================
   ORBIT WEB — Application logic
   Vanilla JS desktop SaaS. Hash router, state cache, full CRUD.
   ============================================================ */
(function () {
  'use strict';

  // ===================================================================
  // STATE
  // ===================================================================
  const State = {
    users: [],
    groups: [],
    expenses: [],
    settlements: [],
    activity: [],
    finAccounts: [],
    finNwHistory: [],
    finTxns: [],
    finBudgets: [],
    finGoals: [],
    finLoans: [],
    finInvestments: [],
    finSubs: [],
    finRecurring: [],
    finBase: 'INR',
    selfId: 'u_self',
    theme: 'light',
    route: { name: 'dashboard', params: {}, query: {} },
    sort: {
      dashActivity: { col: 'date', dir: 'desc' },
      expenses: { col: 'date', dir: 'desc' },
      groupExpenses: { col: 'date', dir: 'desc' }
    },
    filters: {
      expenses: { q: '', groupId: '', category: '', from: '', to: '', paidBy: '' }
    },
    selected: { expenses: new Set() },
    activeTab: { group: 'expenses' }
  };

  // ===================================================================
  // HELPERS
  // ===================================================================
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function h(tag, attrs = {}, children = []) {
    const el = document.createElement(tag);
    for (const k in attrs) {
      const v = attrs[k];
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'data') { for (const d in v) el.dataset[d] = v[d]; }
      else el.setAttribute(k, v);
    }
    (Array.isArray(children) ? children : [children]).forEach((c) => {
      if (c == null || c === false) return;
      if (typeof c === 'string' || typeof c === 'number') el.appendChild(document.createTextNode(String(c)));
      else el.appendChild(c);
    });
    // Auto-label icon-only buttons for screen readers. A button whose visible
    // text is empty or a single glyph gets an aria-label from its `title` (or a
    // glyph map). Buttons with real text labels are left untouched.
    if (el.tagName === 'BUTTON' && !el.getAttribute('aria-label')) {
      const txt = (el.textContent || '').trim();
      if (txt === '' || txt.length === 1) {
        const map = { '×': 'Close', '✕': 'Close', '✎': 'Edit', '+': 'Add', '✓': 'Done', '↻': 'Refresh' };
        const lbl = attrs.title || map[txt];
        if (lbl) el.setAttribute('aria-label', lbl);
      }
    }
    // Keyboard activation for whole-row navigations built on non-interactive
    // tags (e.g. <tr class="clickable">, <div class="group-card">). Without
    // this they're mouse-only. Allowlisted by class so we don't turn the modal
    // backdrop or settle rows (which carry their own buttons) into buttons.
    if (attrs.onClick && !attrs.role && attrs.tabindex == null
      && typeof attrs.class === 'string' && /\b(clickable|group-card)\b/.test(attrs.class)
      && !/^(BUTTON|A|INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) {
      el.setAttribute('role', 'button');
      el.setAttribute('tabindex', '0');
      el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); el.click(); } });
    }
    return el;
  }
  function el(html) {
    const t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  }
  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function uid(prefix = 'id') {
    return prefix + '_' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3);
  }
  function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }

  const CURRENCY_SYMBOL = { INR: '₹', EUR: '€', USD: '$', GBP: '£' };
  function fmtMoney(amount, currency = 'INR', signed = false) {
    const sym = CURRENCY_SYMBOL[currency] || '';
    const abs = Math.abs(amount);
    const str = abs.toLocaleString(currency === 'INR' ? 'en-IN' : 'en-US', { maximumFractionDigits: 2, minimumFractionDigits: abs % 1 === 0 ? 0 : 2 });
    const sign = amount < 0 ? '−' : signed ? '+' : '';
    return sign + sym + str;
  }
  function fmtDateShort(iso) {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    const opts = { month: 'short', day: 'numeric' };
    if (d.getFullYear() !== new Date().getFullYear()) opts.year = '2-digit';
    return d.toLocaleDateString('en-US', opts);
  }
  function fmtDateTime(iso) {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }
  function fmtDateRel(iso) {
    const d = new Date(iso);
    const diff = Date.now() - d.getTime();
    const m = Math.round(diff / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return m + 'm ago';
    const hr = Math.round(m / 60);
    if (hr < 24) return hr + 'h ago';
    const day = Math.round(hr / 24);
    if (day < 7) return day + 'd ago';
    return fmtDateShort(iso);
  }
  function toDateInput(iso) {
    const d = new Date(iso || Date.now());
    const tz = d.getTimezoneOffset() * 60000;
    return new Date(d.getTime() - tz).toISOString().slice(0, 10);
  }
  function todayISO() {
    return new Date().toISOString();
  }
  function dateFromInput(s) {
    if (!s) return new Date().toISOString();
    const d = new Date(s + 'T19:00:00');
    return d.toISOString();
  }

  function avatarColor(userId) {
    const u = State.users.find((x) => x.id === userId);
    if (!u) return 1;
    if (u.avatar && u.avatar.startsWith('av-c')) return parseInt(u.avatar.slice(4), 10) || 1;
    const code = userId.split('').reduce((s, c) => s + c.charCodeAt(0), 0);
    return (code % 8) + 1;
  }
  function userInitial(userId) {
    const u = State.users.find((x) => x.id === userId);
    if (!u) return '?';
    return u.name.split(' ').map((s) => s[0]).slice(0, 2).join('').toUpperCase();
  }
  function userName(userId) {
    const u = State.users.find((x) => x.id === userId);
    return u ? (u.isSelf ? 'You' : u.name) : 'Unknown';
  }
  function userNameFull(userId) {
    const u = State.users.find((x) => x.id === userId);
    return u ? u.name : 'Unknown';
  }
  function groupById(id) { return State.groups.find((g) => g.id === id); }
  // Pluralize: plural(1,'person','people') -> "1 person"; plural(3,'group') -> "3 groups".
  function plural(n, one, many) { return n + ' ' + (Math.abs(n) === 1 ? one : (many || one + 's')); }

  // ---- Shared-group helpers (Phase D) -------------------------------
  // A "shared" group is one that also lives in Firestore (groups.js). To
  // keep the two paths from forking we make the local group's id EQUAL the
  // Firestore group id, so realtime echoes merge over the same record and
  // never produce a duplicate card. sharedIdOf() returns the Firestore id
  // (or null for a local-only group).
  function isSharedGroup(g) { return !!(g && (g.shared || g.sharedId)); }
  function sharedIdOf(g) { return g ? (g.sharedId || (g.shared ? g.id : null)) : null; }
  function canShare() { return !!(window.OrbitGroups && OrbitGroups.isReady()); }
  // The app owner — gets a global view of every join across all groups.
  function isFounder() {
    try { return !!(window.OrbitCloud && OrbitCloud.user && OrbitCloud.user() && OrbitCloud.user().email === 'sushanthvarma@gmail.com'); }
    catch (_) { return false; }
  }
  // Only the group's owner may manage its membership (remove people).
  // - A device-local group has no other accounts — the single user owns it.
  // - A shared group is owned by its creator; members who joined can leave
  //   (self), but cannot remove anyone else.
  function myUid() {
    try { const me = window.OrbitCloud && OrbitCloud.user && OrbitCloud.user(); return me ? me.uid : null; }
    catch (_) { return null; }
  }
  // My display name for stamping on activity entries.
  function selfDisplayName() { const me = State.users.find((u) => u.id === State.selfId); return (me && me.name) || 'You'; }
  // Stable actor identity for an activity entry. actorUid (Firebase uid) is what
  // makes "You vs them" resolve correctly on every device — the local actorId is
  // 'u_self' on everyone's device, so it alone can't tell members apart.
  function actorStamp() { const sid = State.selfId; return { actorId: sid, actorUid: myUid() || null, actorName: selfDisplayName() }; }
  // True for "this member is me" — covers both the local self id and the raw
  // Firebase uid, since shared-group rosters key members by uid.
  function isSelfMember(id) {
    return id === State.selfId || (!!myUid() && id === myUid());
  }
  function isGroupOwner(g) {
    if (!isSharedGroup(g)) return true;
    const mine = myUid();
    return !!(mine && g.createdBy && g.createdBy === mine);
  }

  // ---- Identity handles (foundation for email/phone auto-claim) ----
  // A contact's claimable identity is a normalized email or phone. When that
  // person later signs in, their verified handle is matched to these and the
  // ghost contact is claimed (Phase 2). Name is only a display label.
  function normEmail(s) { return (s || '').trim().toLowerCase(); }
  function normPhone(s) {
    let d = (s || '').replace(/[^\d+]/g, '');
    if (d && !d.startsWith('+') && d.length === 10) d = '+91' + d; // India default
    return d;
  }
  function personHandle(u) { return u ? (normEmail(u.email) || normPhone(u.phone) || '') : ''; }

  // Native phone-contacts picker (Contact Picker API). Android Chrome only,
  // secure context + user gesture; unsupported on iOS Safari/desktop, so we
  // feature-detect and only show the button when available.
  function contactsSupported() { return ('contacts' in navigator) && ('ContactsManager' in window); }
  async function pickFromContacts() {
    if (!contactsSupported()) return null;
    try {
      const sel = await navigator.contacts.select(['name', 'tel', 'email'], { multiple: false });
      if (!sel || !sel.length) return null;
      const c = sel[0];
      return {
        name: (c.name && c.name[0]) || '',
        phone: (c.tel && c.tel[0]) || '',
        email: (c.email && c.email[0]) || ''
      };
    } catch (e) { console.warn('[contacts] pick cancelled/failed', e); return null; }
  }

  // Dual-write an expense to its group's Firestore copy when the group is
  // shared. Same id as the local record → realtime merge is idempotent.
  // Best-effort: a cloud failure never blocks the local save.
  // ---- Identity translation across the shared (Firestore) boundary ----------
  // Locally "me" is always 'u_self'. In a shared doc everyone MUST be keyed by a
  // stable Firebase uid, or each device reads the author's rows as its own and
  // balances flip. selfToUid runs on WRITE; on READ we map my-uid back to
  // 'u_self', and legacy 'u_self' (written before this fix) to the doc's author.
  function selfToUid(id) { return id === State.selfId ? (myUid() || id) : id; }
  function remapExpenseIds(e, map) {
    const c = Object.assign({}, e);
    if (c.paidBy) c.paidBy = map(c.paidBy);
    if (Array.isArray(c.payers)) c.payers = c.payers.map((p) => Object.assign({}, p, { userId: map(p.userId) }));
    if (Array.isArray(c.splits)) c.splits = c.splits.map((s) => Object.assign({}, s, { userId: map(s.userId) }));
    return c;
  }
  function remapSettlementIds(s, map) {
    const c = Object.assign({}, s);
    ['fromUser', 'toUser', 'from', 'to'].forEach((k) => { if (c[k]) c[k] = map(c[k]); });
    return c;
  }
  const toSharedExpense = (e) => {
    const c = remapExpenseIds(e, selfToUid);
    // The receipt is stored in Firebase Storage; only its short URL rides on the
    // expense doc (tiny, syncs everywhere). A raw base64 data: URL must NEVER be
    // written into the doc (1 MiB Firestore limit + bloated realtime payloads) —
    // that only happens when the upload failed / user is offline, so strip it.
    if (c.receipt) {
      c.hasReceipt = true;
      if (c.receipt.startsWith('data:')) delete c.receipt;
    }
    return c;
  };
  function fromSharedExpense(e) {
    const my = myUid(); const author = e.createdBy;
    return remapExpenseIds(e, (id) => {
      if (my && id === my) return State.selfId;                         // it's me (the reader)
      if (id === 'u_self') return (author && my && author === my) ? State.selfId : (author || id); // legacy author self
      return id;
    });
  }
  const toSharedSettlement = (s) => remapSettlementIds(s, selfToUid);
  function fromSharedSettlement(s) {
    const my = myUid(); const author = s.createdBy;
    return remapSettlementIds(s, (id) => {
      if (my && id === my) return State.selfId;
      if (id === 'u_self') return (author && my && author === my) ? State.selfId : (author || id);
      return id;
    });
  }

  async function syncExpenseIfShared(obj) {
    const g = groupById(obj.groupId);
    const sid = sharedIdOf(g);
    if (!sid || !canShare()) return;
    try { await OrbitGroups.addExpense(sid, toSharedExpense(obj)); }
    catch (e) { console.warn('[Phase D] shared expense write failed', e); toast('Saved locally — cloud sync will retry', 'neg'); }
  }
  // Upload a freshly-attached base64 receipt to Firebase Storage and replace
  // obj.receipt with the resulting download URL — so the tiny URL is what gets
  // stored locally AND synced. Runs BEFORE the expense is written. On failure
  // (offline / oversize) the local base64 is kept (device-local) and stripped
  // from the synced doc by toSharedExpense. Returns nothing; mutates obj.
  async function uploadReceiptToStorage(obj) {
    const sid = sharedIdOf(groupById(obj.groupId));
    if (!sid || !canShare() || !OrbitGroups.uploadReceipt) return;
    if (!obj.receipt || !obj.receipt.startsWith('data:')) return;   // nothing to upload / already a URL
    try {
      const url = await OrbitGroups.uploadReceipt(sid, obj.id, obj.receipt);
      if (url) obj.receipt = url;
    } catch (e) {
      if (e && e.message === 'receipt-too-large') toast('Receipt is over 2.5 MB — kept on this device only', 'neg');
      else console.warn('[receipt] storage upload failed; keeping local copy', e);
    }
  }
  // When a receipt is removed on edit, delete its Storage file too.
  async function deleteReceiptIfRemoved(obj, prev) {
    const sid = sharedIdOf(groupById(obj.groupId));
    if (!sid || !canShare() || !OrbitGroups.deleteReceiptFile) return;
    if (!obj.receipt && prev && prev.receipt) {
      try { await OrbitGroups.deleteReceiptFile(sid, obj.id); } catch (_) {}
    }
  }
  // Mirror an audit-log event (add/edit/delete/settle) to the shared group feed
  // so every member sees who did what. The author keeps their own LOCAL entry
  // and the feed skips their own echo (see watchGroupActivity), so no double.
  async function mirrorSharedActivity(groupId, action, snapshot, entityId) {
    const g = groupById(groupId);
    const sid = sharedIdOf(g);
    if (!sid || !canShare() || !OrbitGroups.addActivity) return;
    const type = action === 'add' ? 'expense_add' : action === 'edit' ? 'expense_edit'
      : action === 'delete' ? 'expense_delete' : action === 'settle' ? 'settle' : action;
    try {
      await OrbitGroups.addActivity(sid, {
        type, action, entityType: action === 'settle' ? 'settlement' : 'expense',
        entityId: entityId || null, actorUid: myUid() || null, actorName: selfDisplayName(),
        snapshot: snapshot ? { title: snapshot.title || '', amount: snapshot.amount, currency: snapshot.currency || 'INR' } : null
      });
    } catch (e) { console.warn('[activity] shared mirror failed', e); }
  }
  // Mirror a local expense delete to Firestore, else the realtime listener
  // re-adds the row on next snapshot ("zombie expense").
  async function syncDeleteExpenseIfShared(e) {
    const g = groupById(e.groupId);
    const sid = sharedIdOf(g);
    if (!sid || !canShare()) return;
    try { await OrbitGroups.deleteExpense(sid, e.id); }
    catch (err) { console.warn('[Phase D] shared expense delete failed', err); }
    // Remove the receipt image from Storage too, else it lingers (and costs).
    if (OrbitGroups.deleteReceiptFile) { try { await OrbitGroups.deleteReceiptFile(sid, e.id); } catch (_) {} }
  }
  // Convert an existing LOCAL-only group into a shared one. The shared group
  // already exists in Firestore (sharedId); we re-point the local group and
  // all its expenses/settlements onto that id so local id === Firestore id
  // (the invariant the realtime merge relies on) and push history to cloud.
  async function migrateLocalGroupToShared(g, sharedId) {
    const oldId = g.id;
    if (oldId === sharedId) { g.shared = true; g.sharedId = sharedId; await OrbitDB.put('groups', g); return; }
    const exps = State.expenses.filter((e) => e.groupId === oldId);
    for (const e of exps) {
      e.groupId = sharedId;
      await OrbitDB.put('expenses', e);
      try { await OrbitGroups.addExpense(sharedId, toSharedExpense(e)); } catch (_) {}
    }
    State.settlements.filter((s) => s.groupId === oldId).forEach(async (s) => { s.groupId = sharedId; await OrbitDB.put('settlements', s); });
    await OrbitDB.delete('groups', oldId);
    g.id = sharedId; g.shared = true; g.sharedId = sharedId;
    await OrbitDB.put('groups', g);
  }

  function avatar(userId, size = '') {
    const cls = size ? 'avatar avatar-' + size : 'avatar';
    const u = State.users.find((x) => x.id === userId);
    if (u && u.photoURL) {
      const sp = h('span', { class: cls + ' avatar-photo', data: { color: String(avatarColor(userId)) }, title: u.name || '' });
      sp.style.backgroundImage = 'url("' + u.photoURL + '")';
      return sp;
    }
    return h('span', { class: cls, data: { color: String(avatarColor(userId)) } }, userInitial(userId));
  }
  function avatarStack(userIds, max = 4) {
    const stack = h('span', { class: 'avatar-stack' });
    const shown = userIds.slice(0, max);
    shown.forEach((u) => stack.appendChild(avatar(u, 'sm')));
    if (userIds.length > max) {
      stack.appendChild(h('span', { class: 'avatar avatar-sm', style: { background: 'var(--surface-3)', color: 'var(--text-2)' } }, '+' + (userIds.length - max)));
    }
    return stack;
  }

  // ===================================================================
  // BALANCE / COMPUTATION
  // ===================================================================
  // ---- Payers ----
  // An expense may be paid by several people. Multi-payer expenses carry a
  // `payers` array [{userId, amount}]; legacy / single-payer expenses fall back
  // to the single `paidBy` for the whole amount. All balance math reads through
  // these helpers so single- and multi-payer expenses behave identically.
  function expensePayers(exp) {
    if (Array.isArray(exp.payers) && exp.payers.length) return exp.payers;
    return [{ userId: exp.paidBy, amount: exp.amount }];
  }
  function paidByUser(exp, userId) {
    return expensePayers(exp).reduce((s, p) => s + (p.userId === userId ? p.amount : 0), 0);
  }
  function isPayer(exp, userId) { return expensePayers(exp).some((p) => p.userId === userId); }
  function firstPayerId(exp) { return expensePayers(exp)[0].userId; }
  function payerLabel(exp) {
    const ps = expensePayers(exp);
    if (ps.length === 1) return userName(ps[0].userId);
    if (ps.length === 2) return userName(ps[0].userId) + ' & ' + userName(ps[1].userId);
    return ps.length + ' people';
  }

  function expenseAffectsUser(exp, userId) {
    if (isPayer(exp, userId)) return true;
    if ((exp.splits || []).some((s) => s.userId === userId)) return true;
    return false;
  }

  // Returns map { userId: balance } where positive means "they owe you", negative means "you owe them"
  // Filtered to a single user (the self user) — net per other user.
  // Pass `currency` to restrict to one currency (INR/EUR/…) — otherwise the
  // sum mixes currencies numerically (₹ + € as if same unit), which is wrong.
  function computePairBalances(selfId, groupId = null, currency = null) {
    const result = {};
    let exps = groupId ? State.expenses.filter((e) => e.groupId === groupId) : State.expenses;
    let setts = groupId ? State.settlements.filter((s) => s.groupId === groupId) : State.settlements;
    if (currency) {
      exps = exps.filter((e) => (e.currency || 'INR') === currency);
      setts = setts.filter((s) => (s.currency || 'INR') === currency);
    }

    exps.forEach((exp) => {
      const amount = exp.amount || 0;
      if (amount <= 0) return;
      const shareSelf = (exp.splits.find((s) => s.userId === selfId) || {}).amount || 0;
      const fSelf = paidByUser(exp, selfId) / amount;   // fraction of the bill self funded
      // Every other person who is a participant OR a payer in this expense.
      const others = new Set();
      exp.splits.forEach((s) => { if (s.userId !== selfId) others.add(s.userId); });
      expensePayers(exp).forEach((p) => { if (p.userId !== selfId) others.add(p.userId); });
      others.forEach((o) => {
        const shareO = (exp.splits.find((s) => s.userId === o) || {}).amount || 0;
        const fO = paidByUser(exp, o) / amount;
        // self funded fSelf of o's share (o owes self) minus o funded fO of self's share (self owes o)
        const delta = fSelf * shareO - fO * shareSelf;
        if (Math.abs(delta) > 1e-7) result[o] = (result[o] || 0) + delta;
      });
    });

    setts.forEach((s) => {
      // settlement: from pays to. If self paid someone -> reduces what self owes them (positive shift)
      if (s.fromUser === selfId) result[s.toUser] = (result[s.toUser] || 0) + s.amount;
      if (s.toUser === selfId)   result[s.fromUser] = (result[s.fromUser] || 0) - s.amount;
    });

    // Strip zero values
    Object.keys(result).forEach((k) => {
      if (Math.abs(result[k]) < 0.005) delete result[k];
      else result[k] = Math.round(result[k] * 100) / 100;
    });
    return result;
  }

  // Full N×N balance matrix for a group (group currency assumed)
  function computeGroupMatrix(groupId) {
    const g = groupById(groupId);
    if (!g) return null;
    const members = g.members;
    const net = {};
    members.forEach((m) => (net[m] = 0));

    // Only net SAME-currency rows — summing €100 and ₹100 as 200 is wrong. The
    // group balance is in the group's own currency; foreign-currency expenses
    // are tracked separately in the per-currency views.
    const cur = g.currency || 'INR';
    const exps = State.expenses.filter((e) => e.groupId === groupId && (e.currency || cur) === cur);
    const setts = State.settlements.filter((s) => s.groupId === groupId && (s.currency || cur) === cur);

    exps.forEach((exp) => {
      expensePayers(exp).forEach((p) => { net[p.userId] = (net[p.userId] || 0) + p.amount; });
      exp.splits.forEach((s) => { net[s.userId] = (net[s.userId] || 0) - s.amount; });
    });
    setts.forEach((s) => {
      net[s.fromUser] = (net[s.fromUser] || 0) + s.amount;
      net[s.toUser] = (net[s.toUser] || 0) - s.amount;
    });

    Object.keys(net).forEach((k) => { net[k] = Math.round(net[k] * 100) / 100; });
    return { members, net };
  }

  // Push any rounding residual onto the last split so the splits sum EXACTLY to
  // the total (to the paisa). Used by every split mode at save time.
  function reconcileSplits(splits, total) {
    if (!splits.length) return splits;
    const sum = splits.reduce((s, x) => s + x.amount, 0);
    const diff = Math.round((total - sum) * 100) / 100;
    if (Math.abs(diff) >= 0.005) {
      const last = splits[splits.length - 1];
      last.amount = Math.round((last.amount + diff) * 100) / 100;
    }
    return splits;
  }

  // Greedy debt simplification — returns [{from,to,amount,currency}]
  function simplifyDebts(netMap, currency = 'INR') {
    const creditors = [];
    const debtors = [];
    Object.entries(netMap).forEach(([uid, bal]) => {
      if (bal > 0.005) creditors.push({ uid, bal });
      else if (bal < -0.005) debtors.push({ uid, bal: -bal });
    });
    creditors.sort((a, b) => b.bal - a.bal);
    debtors.sort((a, b) => b.bal - a.bal);
    const txs = [];
    let i = 0, j = 0;
    while (i < debtors.length && j < creditors.length) {
      const pay = Math.min(debtors[i].bal, creditors[j].bal);
      const p = Math.round(pay * 100) / 100;
      if (p > 0) txs.push({ from: debtors[i].uid, to: creditors[j].uid, amount: p, currency });
      debtors[i].bal -= p;
      creditors[j].bal -= p;
      if (debtors[i].bal < 0.005) i++;
      if (creditors[j].bal < 0.005) j++;
    }
    return txs;
  }

  function myNetTotal(currency = 'INR') {
    // Net for a single currency (mixed-currency UI shows each split separately).
    return computeNetByCurrency()[currency] || 0;
  }
  function computeNetByCurrency() {
    const out = {};
    State.expenses.forEach((exp) => {
      const cur = exp.currency || 'INR';
      out[cur] = out[cur] || 0;
      const myShare = (exp.splits.find((s) => s.userId === State.selfId) || {}).amount || 0;
      // My net on this expense = what I paid − my share (works for any number of payers).
      out[cur] += (paidByUser(exp, State.selfId) - myShare);
    });
    State.settlements.forEach((s) => {
      const cur = s.currency || 'INR';
      out[cur] = out[cur] || 0;
      if (s.fromUser === State.selfId) out[cur] += s.amount;
      if (s.toUser === State.selfId) out[cur] -= s.amount;
    });
    Object.keys(out).forEach((k) => out[k] = Math.round(out[k] * 100) / 100);
    return out;
  }

  function totalYouOwe(currency = 'INR') {
    const bal = computePairBalances(State.selfId, null, currency);
    let v = 0;
    Object.values(bal).forEach((x) => { if (x < 0) v += -x; });
    return Math.round(v * 100) / 100;
  }
  function totalOwedToYou(currency = 'INR') {
    const bal = computePairBalances(State.selfId, null, currency);
    let v = 0;
    Object.values(bal).forEach((x) => { if (x > 0) v += x; });
    return Math.round(v * 100) / 100;
  }

  // ===================================================================
  // SEARCH / FILTER / SORT
  // ===================================================================
  function filterExpenses(list, f) {
    let r = list.slice();
    if (f.q) {
      const q = f.q.toLowerCase();
      r = r.filter((e) =>
        e.title.toLowerCase().includes(q) ||
        (e.note || '').toLowerCase().includes(q) ||
        expensePayers(e).some((p) => userNameFull(p.userId).toLowerCase().includes(q)) ||
        (groupById(e.groupId)?.name || '').toLowerCase().includes(q)
      );
    }
    if (f.groupId) r = r.filter((e) => e.groupId === f.groupId);
    if (f.category) r = r.filter((e) => e.category === f.category);
    if (f.paidBy) r = r.filter((e) => isPayer(e, f.paidBy));
    if (f.from) r = r.filter((e) => e.date >= new Date(f.from).toISOString());
    if (f.to) r = r.filter((e) => e.date <= new Date(f.to + 'T23:59:59').toISOString());
    return r;
  }
  function greeting() {
    const h = new Date().getHours();
    if (h < 5) return 'Up late';
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    if (h < 22) return 'Good evening';
    return 'Up late';
  }
  function sortRows(rows, sort, getters) {
    const col = sort.col, dir = sort.dir === 'asc' ? 1 : -1;
    const get = getters[col] || ((x) => x[col]);
    return rows.slice().sort((a, b) => {
      const va = get(a), vb = get(b);
      if (va == null) return 1;
      if (vb == null) return -1;
      if (typeof va === 'number') return (va - vb) * dir;
      return String(va).localeCompare(String(vb)) * dir;
    });
  }

  // ===================================================================
  // CATEGORIES
  // ===================================================================
  const CATEGORIES = [
    { id: 'food', label: 'Food & drink' },
    { id: 'travel', label: 'Travel' },
    { id: 'bills', label: 'Bills' },
    { id: 'shop', label: 'Shopping' },
    { id: 'fun', label: 'Entertainment' },
    { id: 'rent', label: 'Rent' },
    { id: 'transport', label: 'Transport' },
    { id: 'other', label: 'Other' }
  ];
  function categoryLabel(id) {
    const c = CATEGORIES.find((c) => c.id === id);
    return c ? c.label : 'Other';
  }

  // ===================================================================
  // ROUTER
  // ===================================================================
  // decodeURIComponent throws on a malformed escape (e.g. a lone "%"); never let
  // a hand-typed/garbled URL break routing.
  function safeDecode(s) { try { return decodeURIComponent(s); } catch (_) { return s; } }
  function parseHash() {
    const hash = location.hash.slice(1) || '/dashboard';
    const [path, queryStr] = hash.split('?');
    const parts = path.split('/').filter(Boolean).map(safeDecode);
    const query = {};
    (queryStr || '').split('&').filter(Boolean).forEach((p) => {
      const [k, v] = p.split('=');
      query[safeDecode(k)] = safeDecode(v || '');
    });
    return { parts, query };
  }
  function navigate(path) {
    // `path` may be "#/x" (from anchor handlers) or "/x" (programmatic).
    const target = path.startsWith('#') ? path.slice(1) : path;
    if (location.hash.slice(1) === target) { render(); return; }
    location.hash = target;
  }
  function route() {
    // A route change should never leave a stale modal (from the previous screen)
    // floating over the new one — close it first.
    try { if ($('#modalRoot').children.length) closeModal(); } catch (_) {}
    const { parts, query } = parseHash();
    const [name, p1, p2] = parts;
    State.route = { name: name || 'dashboard', params: { id: p1, sub: p2 }, query };
    updateSidebarActive();
    renderTopNav();
    render();
  }
  window.addEventListener('hashchange', route);

  // ===================================================================
  // TOP NAVIGATION (revamp) — primary Split/Money tabs + contextual sub-nav
  // ===================================================================
  const NAV_SECTIONS = {
    split: {
      label: 'Split', def: 'dashboard',
      items: [['dashboard', 'Dashboard'], ['groups', 'Groups'], ['expenses', 'Expenses'], ['trips', 'Trips'], ['activity', 'Activity'], ['analytics', 'Analytics'], ['settle', 'Settle up']]
    },
    money: {
      label: 'Money', def: 'networth',
      items: [['networth', 'Net worth'], ['transactions', 'Transactions'], ['budgets', 'Budgets'], ['goals', 'Goals'], ['loans', 'Loans'], ['investments', 'Investments'], ['recurring', 'Recurring'], ['subscriptions', 'Subscriptions'], ['pending', 'Pending'], ['cashflow', 'Cash flow'], ['trends', 'Trends']]
    }
  };
  function sectionForRoute(name) {
    return NAV_SECTIONS.money.items.some((i) => i[0] === name) ? 'money' : 'split';
  }
  function renderTopNav() {
    const name = State.route.name;
    const sec = sectionForRoute(name);
    const prim = $('#navPrimary');
    if (prim) {
      prim.innerHTML = '';
      Object.keys(NAV_SECTIONS).forEach((k) => {
        prim.appendChild(h('button', {
          class: k === sec ? 'active' : '', role: 'tab', 'aria-selected': k === sec ? 'true' : 'false',
          onClick: () => { location.hash = '#/' + NAV_SECTIONS[k].def; }
        }, NAV_SECTIONS[k].label));
      });
    }
    const sub = $('#subnav');
    if (sub) {
      sub.innerHTML = '';
      NAV_SECTIONS[sec].items.forEach(([route, label]) => {
        // Reuse the (hidden) sidebar's SVG icon for this route so the sub-nav
        // is visually labelled and consistent — no duplicated icon markup.
        const src = document.querySelector('.sidebar .nav-item[data-route="' + route + '"] .nav-icon svg');
        const icon = h('span', { class: 'subnav-ic', 'aria-hidden': 'true' });
        if (src) icon.innerHTML = src.outerHTML;
        sub.appendChild(h('a', { class: 'subnav-item' + (route === name ? ' active' : ''), href: '#/' + route }, [icon, h('span', {}, label)]));
      });
    }
  }

  // ===================================================================
  // BREADCRUMBS
  // ===================================================================
  function renderCrumbs() {
    const root = $('#crumbs');
    root.innerHTML = '';
    const map = {
      dashboard: 'Dashboard', groups: 'Groups', expenses: 'Expenses',
      trips: 'Trips', activity: 'Activity', analytics: 'Analytics',
      settle: 'Settle up', profile: 'Profile', join: 'Join group',
      networth: 'Net worth', transactions: 'Transactions', budgets: 'Budgets',
      goals: 'Goals', loans: 'Loans', investments: 'Investments',
      subscriptions: 'Subscriptions', trends: 'Trends',
      recurring: 'Recurring', cashflow: 'Cash flow', pending: 'Pending'
    };
    const name = State.route.name;
    root.appendChild(h('span', { class: 'crumb' }, 'Orbit'));
    root.appendChild(h('span', { class: 'crumb-sep' }, '/'));
    if (name === 'groups' && State.route.params.id) {
      root.appendChild(h('a', { class: 'crumb', href: '#/groups' }, 'Groups'));
      root.appendChild(h('span', { class: 'crumb-sep' }, '/'));
      const g = groupById(State.route.params.id);
      root.appendChild(h('span', { class: 'crumb crumb-current' }, g ? g.name : 'Group'));
    } else {
      root.appendChild(h('span', { class: 'crumb crumb-current' }, map[name] || 'Dashboard'));
    }
  }

  // ===================================================================
  // SIDEBAR
  // ===================================================================
  function updateSidebarActive() {
    $$('.nav-item, .tab-item').forEach((n) => { n.classList.remove('active'); n.removeAttribute('aria-current'); });
    const name = State.route.name;
    // Light up both the desktop sidebar item and the mobile tab-bar item.
    document.querySelectorAll(`.nav-item[data-route="${name}"], .tab-item[data-route="${name}"]`)
      .forEach((el) => { el.classList.add('active'); el.setAttribute('aria-current', 'page'); });
    // Routes that live under the mobile "More" sheet light up that tab.
    const more = document.querySelector('#tabMore');
    if (more && ['expenses', 'settle', 'trips', 'analytics', 'profile'].includes(name)) more.classList.add('active');
  }
  function renderSidebarGroups() {
    const root = $('#sidebarGroups');
    root.innerHTML = '';
    const groups = State.groups.filter((g) => !g.archived).sort((a, b) => {
      // by most-recent activity desc
      const lastA = lastActivityDate(a.id);
      const lastB = lastActivityDate(b.id);
      return (lastB || '').localeCompare(lastA || '');
    });
    groups.slice(0, 8).forEach((g) => {
      const bal = computeGroupBalanceForSelf(g.id);
      const cls = bal > 0.01 ? 'pos' : bal < -0.01 ? 'neg' : 'zero';
      const item = h('a', {
        class: 'nav-item',
        href: '#/groups/' + g.id,
        title: g.name
      }, [
        h('span', { class: 'group-emoji', style: { background: groupColor(g) } }, g.emoji || g.name.slice(0, 2).toUpperCase()),
        h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, g.name),
        h('span', { class: 'group-bal ' + cls }, bal === 0 ? '—' : fmtMoney(bal, g.currency))
      ]);
      root.appendChild(item);
    });
  }
  function groupColor(g) {
    const map = {
      trip: '#1A5564',
      household: '#1F6F4A',
      friends: '#A93020',
      work: '#4A3F8A'
    };
    return map[g.category] || 'var(--accent-2)';
  }
  function lastActivityDate(groupId) {
    let last = '';
    State.expenses.forEach((e) => { if (e.groupId === groupId && e.date > last) last = e.date; });
    State.settlements.forEach((s) => { if (s.groupId === groupId && s.date > last) last = s.date; });
    return last;
  }
  function computeGroupBalanceForSelf(groupId) {
    const g = groupById(groupId);
    const cur = (g && g.currency) || 'INR';   // same-currency only (no €100 = ₹100)
    let v = 0;
    State.expenses.forEach((e) => {
      if (e.groupId !== groupId || (e.currency || cur) !== cur) return;
      const myShare = (e.splits.find((s) => s.userId === State.selfId) || {}).amount || 0;
      v += paidByUser(e, State.selfId) - myShare;
    });
    State.settlements.forEach((s) => {
      if (s.groupId !== groupId || (s.currency || cur) !== cur) return;
      if (s.fromUser === State.selfId) v += s.amount;
      if (s.toUser === State.selfId) v -= s.amount;
    });
    return Math.round(v * 100) / 100;
  }

  function renderMeCard() {
    const root = $('#meCard');
    const me = State.users.find((u) => u.id === State.selfId);
    if (!me) return;
    root.innerHTML = '';
    root.appendChild(avatar(me.id, 'md'));
    root.appendChild(h('div', { class: 'me-meta' }, [
      h('span', { class: 'me-name' }, me.name),
      h('span', { class: 'me-vpa' }, me.upi || me.email)
    ]));
    root.appendChild(h('span', { class: 'me-status', title: 'Online' }));
  }

  // ===================================================================
  // VIEWS
  // ===================================================================
  // Scroll behaviour between renders. Normally a new view scrolls to the top,
  // but switching a tab (or tapping a stat card) shouldn't fling you back up —
  // 'keep' preserves the current scroll, 'tabs' brings the tab strip into view.
  let _scrollIntent = null;
  function keepScrollNext() { const m = $('#main'); _scrollIntent = { type: 'keep', y: m ? m.scrollTop : 0 }; }
  function scrollToTabsNext() { _scrollIntent = { type: 'tabs' }; }
  function goGroupTab(g, t, mode) {
    State.activeTab.group = t;
    if (mode === 'keep') keepScrollNext(); else scrollToTabsNext();
    navigate('#/groups/' + g.id + '?tab=' + t);
  }
  function setMain(node) {
    const main = $('#main');
    main.innerHTML = '';
    main.appendChild(node);
    if (_scrollIntent && _scrollIntent.type === 'keep') {
      main.scrollTop = _scrollIntent.y || 0;
    } else if (_scrollIntent && _scrollIntent.type === 'tabs') {
      main.scrollTop = 0;
      const strip = node.querySelector && node.querySelector('.tabs');
      if (strip) requestAnimationFrame(() => { try { strip.scrollIntoView({ block: 'start', behavior: 'auto' }); } catch (_) {} });
    } else {
      main.scrollTop = 0;
    }
    _scrollIntent = null;
    // Announce the new view to screen readers (SPA route changes are otherwise
    // silent) and move focus to its first heading for keyboard users.
    try {
      const heading = node.querySelector && node.querySelector('h1');
      if (heading) {
        announce(heading.textContent || 'Page updated');
        heading.setAttribute('tabindex', '-1');
      }
    } catch (_) {}
  }
  let _liveRegion = null;
  function announce(msg) {
    if (!_liveRegion) {
      _liveRegion = document.createElement('div');
      _liveRegion.setAttribute('aria-live', 'polite');
      _liveRegion.className = 'sr-only';
      document.body.appendChild(_liveRegion);
    }
    _liveRegion.textContent = '';
    setTimeout(() => { _liveRegion.textContent = msg; }, 30);
  }

  // -------- DASHBOARD --------
  // ---- JOIN a shared group via invite link (#/join/:code) ----
  async function viewJoin(code) {
    const page = h('div', { class: 'page' });
    page.appendChild(h('header', { class: 'page-header' }, [
      h('div', { class: 'title-block' }, [
        h('h1', {}, 'Join group'),
        h('div', { class: 'sub' }, 'You were invited to a shared Orbit group.')
      ])
    ]));
    const card = h('div', { class: 'card', style: { maxWidth: '480px', margin: '24px auto' } });
    const body = h('div', { class: 'card-body', style: { textAlign: 'center', padding: '32px' } });
    card.appendChild(body);
    page.appendChild(card);
    setMain(page);

    if (!code) { body.appendChild(h('p', { class: 'small muted' }, 'This invite link is incomplete. Ask the sender to share it again.')); return; }
    // Remember the code so it survives a sign-in round-trip.
    try { localStorage.setItem('orbit_pending_join', code); } catch (_) {}

    // Reading/accepting an invite requires being signed in. If not, prompt to
    // sign in right here (don't show a confusing "not found").
    const signedIn = window.OrbitCloud && OrbitCloud.user && OrbitCloud.user();
    if (!signedIn || !window.OrbitGroups || !OrbitGroups.isReady()) {
      body.innerHTML = '';
      body.appendChild(h('p', { class: 'small muted', style: { margin: '0 0 16px' } }, 'Sign in to join this group.'));
      const gbtn = h('button', { class: 'btn btn-primary', style: { marginBottom: '10px' } }, 'Sign in with Google');
      gbtn.addEventListener('click', async () => {
        gbtn.disabled = true;
        try { await OrbitCloud.signInWithGoogle(); } catch (e) { gbtn.disabled = false; toast('Sign-in failed: ' + (e.message || e.code || ''), 'neg'); }
      });
      body.appendChild(gbtn);
      body.appendChild(h('div', { class: 'small muted' }, 'After signing in you’ll come straight back here to join.'));
      return;
    }

    body.appendChild(h('div', { class: 'small muted' }, 'Checking your invite…'));
    let inv = null;
    try {
      inv = await OrbitGroups.getInvite(code);
    } catch (e) {
      body.innerHTML = '';
      body.appendChild(h('p', {}, 'Couldn’t load this invite — check your connection and try again.'));
      console.warn('[join] getInvite error', e);
      return;
    }
    if (!inv) {
      body.innerHTML = '';
      body.appendChild(h('p', { style: { marginBottom: '8px' } }, 'This invite link is not valid anymore.'));
      body.appendChild(h('p', { class: 'small muted' }, 'Ask the sender to open the group → Invite → and send you a fresh link.'));
      console.warn('[join] invite not found for code:', code);
      try { localStorage.removeItem('orbit_pending_join'); } catch (_) {}
      return;
    }
    const g = await OrbitGroups.getGroup(inv.groupId).catch(() => null);
    // Already a member? Don't ask them to join again — drop them straight into
    // the group. (Only a member can even read the group doc per the rules, so a
    // readable group with our uid in memberUids is a reliable "already in" signal.)
    const myUid = (OrbitGroups.currentUid && OrbitGroups.currentUid()) || (OrbitCloud.user() && OrbitCloud.user().uid) || null;
    if (g && myUid && Array.isArray(g.memberUids) && g.memberUids.includes(myUid)) {
      try { localStorage.removeItem('orbit_pending_join'); } catch (_) {}
      try { if (typeof RealtimeSync !== 'undefined') RealtimeSync.start(); } catch (_) {}
      toast('You’re already in “' + (g.name || 'this group') + '”.', 'pos');
      navigate('#/groups/' + inv.groupId);
      return;
    }
    body.innerHTML = '';
    body.appendChild(h('div', { class: 'gc-emoji', style: { margin: '0 auto 12px', width: '48px', height: '48px', fontSize: '22px' } }, (g && g.emoji) || 'OR'));
    body.appendChild(h('h2', { style: { margin: '0 0 6px' } }, g ? g.name : 'a shared group'));
    body.appendChild(h('p', { class: 'small muted', style: { margin: '0 0 20px' } }, g ? (plural(g.memberUids ? g.memberUids.length : 1, 'member') + ' · ' + (g.currency || 'INR')) : 'Tap join to be added.'));
    const joinBtn = h('button', { class: 'btn btn-primary' }, 'Join this group');
    joinBtn.addEventListener('click', async () => {
      joinBtn.disabled = true; joinBtn.textContent = 'Joining…';
      try {
        const res = await OrbitGroups.acceptInvite(code);
        try { localStorage.removeItem('orbit_pending_join'); } catch (_) {}
        toast('Joined! Welcome to the group.', 'pos');
        // Pull the newly-shared group so it shows immediately.
        try { if (typeof RealtimeSync !== 'undefined') RealtimeSync.start(); } catch (_) {}
        navigate('#/groups/' + (res && res.groupId ? res.groupId : ''));
      } catch (e) {
        joinBtn.disabled = false; joinBtn.textContent = 'Join this group';
        toast('Could not join: ' + (e.message || e.code || 'error'), 'neg');
        console.warn('[join] acceptInvite error', e);
      }
    });
    body.appendChild(joinBtn);
  }

  function viewDashboard() {
    const page = h('div', { class: 'page' });
    const head = h('header', { class: 'page-header' }, [
      h('div', { class: 'title-block' }, [
        h('h1', {}, greeting() + ', ' + ((State.users.find((u) => u.id === State.selfId)?.name || '').split(' ')[0] || 'there')),
        h('div', { class: 'sub' }, 'Here\'s where you stand across all groups today.')
      ]),
      h('div', { class: 'actions' }, [
        h('button', { class: 'btn btn-ghost btn-sm', onClick: () => openNewGroup() }, '+ New group'),
        h('button', { class: 'btn btn-primary btn-sm', onClick: () => openExpenseModal() }, '+ Add expense')
      ])
    ]);
    page.appendChild(head);

    // KPI cards
    const net = computeNetByCurrency();
    const netINR = net.INR || 0;
    const owe = totalYouOwe();
    const owed = totalOwedToYou();
    const eu = net.EUR || 0;

    // Balance row — reference layout: 2fr / 1fr / 1fr, first card is the
    // dark-gradient hero, all three get live 3D mouse-tilt.
    const netSub = netINR === 0 ? 'You are even' : netINR > 0
      ? (plural(countCreditors(), 'friend owes', 'friends owe') + ' you across ' + plural(State.groups.length, 'group'))
      : 'You owe across ' + plural(countDebtors(), 'person', 'people');
    const netTag = netINR > 0.01 ? 'Net positive' : netINR < -0.01 ? 'Net negative' : 'Even';
    // ★ Living friend-orbit hero — the signature moment, full width.
    page.appendChild(friendOrbitHero(netINR, netSub, netTag));
    // Supporting stats below the hero. Daily-share trend drives the sparklines.
    const series = dailySpendSeries(14);
    const vc = vizColors();
    const kpiGrid = h('div', { class: 'kpi-grid' });
    kpiGrid.appendChild(kpiCard('You are owed', owed, 'INR', 'Across ' + plural(countCreditors(), 'person', 'people'), 'pos', { tilt: true, href: '#/settle', spark: { data: series.map((v) => v * 0.6), color: vc.pos } }));
    kpiGrid.appendChild(kpiCard('You owe', -owe, 'INR', 'Across ' + plural(countDebtors(), 'person', 'people'), 'neg', { tilt: true, href: '#/settle', spark: { data: series.map((v) => v * 0.4), color: vc.neg } }));
    kpiGrid.appendChild(kpiCard('Spent · 28d', spentLast(28), 'INR', 'Last 28 days', '', { tilt: true, href: '#/analytics', spark: { data: series, color: vc.accent } }));
    page.appendChild(kpiGrid);

    // Secondary stat row (EUR / groups) — only when there's a foreign balance.
    if (Math.abs(eu) > 0.01) {
      const sub2 = h('div', { class: 'kpi-grid kpi-grid-3' });
      const euGroup = State.groups.find((g) => g.currency === 'EUR');
      sub2.appendChild(kpiCard('Europe Trip balance', eu, 'EUR', 'Europe Trip 2026', eu > 0 ? 'pos' : 'neg', { tilt: true, href: euGroup ? '#/groups/' + euGroup.id : '#/groups', icon: 'scale' }));
      sub2.appendChild(kpiCard('Active groups', State.groups.length, '', 'Across all workspaces', '', { tilt: true, href: '#/groups', icon: 'target' }));
      sub2.appendChild(kpiCard('Total expenses', State.expenses.length, '', 'Logged so far', '', { tilt: true, href: '#/expenses', icon: 'rupee' }));
      page.appendChild(sub2);
    }

    // Content grid — reference layout: 1fr / 380px (activity + settle/chart).
    const middle = h('div', { class: 'grid-2 content-grid', style: { marginBottom: 'var(--s-5)' } });
    middle.appendChild(panelRecentActivity());
    const rightCol = h('div', { class: 'right-col' });
    rightCol.appendChild(panelSettleNow());
    middle.appendChild(rightCol);
    page.appendChild(middle);

    // Spending chart — full width below the grid so the area chart has room.
    page.appendChild(panelSpendChart28());

    setMain(page);
    // Wire the 3D mouse-tilt after the nodes are in the DOM.
    bindTilt(page);
    // Count the KPI numbers up — once per session so it's a first-impression
    // flourish, not a flicker on every re-render.
    if (!_countDone.has('dashboard')) { _countDone.add('dashboard'); animateCounts(page); }
  }
  // Theme-aware data-viz colors (Editorial Warmth ink vs Midnight Aurora neon).
  function vizColors() {
    return State.theme === 'dark'
      ? { pos: '#4FE3B0', neg: '#FB7185', accent: '#A78BFA' }
      : { pos: '#1F6F4A', neg: '#A93020', accent: '#2A2356' };
  }

  // ★ SIGNATURE MOMENT — the living "friend orbit". You are the glowing core;
  // each friend you have a balance with orbits you as a planet, sized by how
  // much, green if they owe you, red if you owe them. Slow rotation, hover for
  // who/how-much, click to settle. This is the brand made literal — no other
  // splitting app has it. Built from real pair-balances, falls back to a calm
  // "clear orbit" when you're all settled.
  function friendOrbitHero(netINR, netSub, netTag) {
    const cur = 'INR';
    const pair = computePairBalances(State.selfId, null, cur);
    const friends = Object.keys(pair)
      .map((id) => ({ id, v: pair[id], u: State.users.find((x) => x.id === id) }))
      .filter((x) => x.u && Math.abs(x.v) >= 0.01)
      .sort((a, b) => Math.abs(b.v) - Math.abs(a.v))
      .slice(0, 6);
    const self = State.users.find((u) => u.isSelf);
    const initials = (n) => (n || '?').trim().split(/\s+/).map((s) => s[0]).slice(0, 2).join('').toUpperCase();

    const stage = h('div', { class: 'orbit-stage' });
    const radii = [50, 86, 122];
    radii.forEach((r) => stage.appendChild(h('div', { class: 'orbit-track', style: { width: (r * 2) + 'px', height: (r * 2) + 'px' } })));

    const core = h('div', { class: 'orbit-core' }, (self && self.photoURL) ? '' : initials(self ? self.name : 'You'));
    if (self && self.photoURL) { core.classList.add('has-photo'); core.style.backgroundImage = 'url("' + self.photoURL + '")'; }
    stage.appendChild(core);
    stage.appendChild(h('div', { class: 'orbit-core-label' }, 'You'));

    const maxAbs = Math.max.apply(null, friends.map((f) => Math.abs(f.v)).concat(1));
    friends.forEach((f, i) => {
      const ring = i % 3;
      const r = radii[ring];
      const dur = 28 + ring * 9;                         // outer rings drift slower
      const startAngle = (i * 360 / Math.max(1, friends.length)) + ring * 33;
      const delay = (-(startAngle / 360) * dur).toFixed(2) + 's';
      const sz = 32 + Math.round((Math.abs(f.v) / maxAbs) * 22); // 32..54px by amount
      const owe = f.v < 0;
      const orbiter = h('div', { class: 'orbiter', style: {
        width: (r * 2) + 'px', height: (r * 2) + 'px', marginLeft: (-r) + 'px', marginTop: (-r) + 'px',
        animationDuration: dur + 's', animationDelay: delay
      } });
      const planet = h('div', {
        class: 'planet ' + (owe ? 'owe' : 'owed'),
        style: { width: sz + 'px', height: sz + 'px', fontSize: (sz * 0.34).toFixed(0) + 'px', animationDuration: dur + 's', animationDelay: delay },
        role: 'button', tabindex: '0', title: f.u.name
      }, [
        initials(f.u.name),
        h('span', { class: 'planet-tip' }, [
          h('strong', {}, f.u.name),
          h('span', {}, (owe ? 'You owe ' : 'Owes you ') + fmtMoney(Math.abs(f.v), cur))
        ])
      ]);
      const go = () => navigate('#/settle');
      planet.addEventListener('click', go);
      planet.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
      orbiter.appendChild(planet);
      stage.appendChild(orbiter);
    });

    const valNode = h('div', { class: 'kpi-value', 'data-count': String(netINR), 'data-cur': cur }, fmtMoney(netINR, cur, false));
    const left = h('div', { class: 'orbit-hero-text' }, [
      h('div', { class: 'kpi-head' }, [
        h('div', { class: 'kpi-label' }, 'Net position'),
        h('span', { class: 'kpi-tag' }, netTag)
      ]),
      valNode,
      h('div', { class: 'kpi-delta' }, netSub),
      h('button', { class: 'btn orbit-cta', onClick: () => navigate('#/settle') }, [
        h('span', {}, 'Settle up'), uiIcon('arrow-right', 16)
      ])
    ]);

    return h('div', { class: 'orbit-hero' + (friends.length ? '' : ' is-clear'), style: { marginBottom: 'var(--s-5)' } }, [
      h('div', { class: 'orbit-stars' }),
      left,
      h('div', { class: 'orbit-stage-wrap' }, stage)
    ]);
  }

  function kpiCard(label, value, currency, sub, valClass = '', opts = {}) {
    const v = typeof value === 'number' && currency ? fmtMoney(value, currency, false) : String(value);
    const cls = 'kpi' + (opts.hero ? ' kpi-hero tilt' : opts.tilt ? ' tilt' : '');
    const head = opts.tag
      ? h('div', { class: 'kpi-head' }, [
          h('div', { class: 'kpi-label' }, label),
          h('span', { class: 'kpi-tag' }, opts.tag)
        ])
      : h('div', { class: 'kpi-label' }, label);
    // Numeric KPIs carry their target + formatting so they can count up on
    // first mount (see animateCounts). Non-numeric values just render as-is.
    const valAttrs = { class: 'kpi-value ' + (opts.hero ? '' : valClass) };
    if (typeof value === 'number' && isFinite(value)) {
      valAttrs['data-count'] = String(value);
      valAttrs['data-cur'] = currency || '';
    }
    const children = [head, h('div', valAttrs, v)];
    if (opts.spark) {
      // Reference layout: foot = sub on the left, sparkline trend on the right.
      children.push(h('div', { class: 'kpi-foot' }, [
        sub ? h('span', { class: 'kpi-foot-sub' }, sub) : h('span', {}),
        h('span', { class: 'kpi-spark', html: sparklineSVG(opts.spark.data, opts.spark.color) })
      ]));
    } else if (sub) {
      children.push(h('div', { class: 'kpi-delta' }, sub));
    }
    const node = h('div', { class: cls + (opts.href ? ' kpi-link' : '') }, children);
    if (opts.hero) node.appendChild(h('div', { class: 'kpi-orbit', html: orbitOrnamentSVG() }));
    // Faint accent glyph anchors otherwise-empty stat cards (no sparkline).
    if (opts.icon && !opts.hero) node.appendChild(h('div', { class: 'kpi-ic' }, uiIcon(opts.icon, 22)));
    if (opts.href) {
      node.setAttribute('role', 'link');
      node.setAttribute('tabindex', '0');
      node.setAttribute('aria-label', label + ', open');
      node.addEventListener('click', () => navigate(opts.href));
      node.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(opts.href); } });
    }
    return node;
  }
  // Catmull-Rom → cubic-Bézier smoothing: turns a jagged point list into a
  // flowing curve. `tension` ~0.16 reads natural without overshooting. Shared
  // by the KPI sparklines and the full-width area chart so all line viz on the
  // app moves the same, premium way (no more zig-zag "scribble" look).
  function smoothLinePath(pts, tension) {
    if (!pts || !pts.length) return '';
    if (pts.length < 3) return 'M' + pts.map((p) => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' L');
    const t = tension == null ? 0.16 : tension;
    let d = 'M' + pts[0][0].toFixed(1) + ',' + pts[0][1].toFixed(1);
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
      const c1x = p1[0] + (p2[0] - p0[0]) * t, c1y = p1[1] + (p2[1] - p0[1]) * t;
      const c2x = p2[0] - (p3[0] - p1[0]) * t, c2y = p2[1] - (p3[1] - p1[1]) * t;
      d += ' C' + c1x.toFixed(1) + ',' + c1y.toFixed(1) + ' ' + c2x.toFixed(1) + ',' + c2y.toFixed(1) + ' ' + p2[0].toFixed(1) + ',' + p2[1].toFixed(1);
    }
    return d;
  }
  let _sparkSeq = 0;
  // Inline SVG sparkline — smooth curve, soft gradient fill, and a haloed
  // end-cap (the small white-cored dot reads as a "you are here" marker).
  function sparklineSVG(data, color) {
    const safe = (data && data.length) ? data : [0, 0, 0, 0, 0];
    const W = 100, H = 32;
    const max = Math.max.apply(null, safe.concat(1));
    const min = Math.min.apply(null, safe.concat(0));
    const range = (max - min) || 1;
    const step = W / ((safe.length - 1) || 1);
    const pts = safe.map((val, i) => [i * step, H - ((val - min) / range) * H * 0.78 - 4]);
    const line = smoothLinePath(pts);
    const fill = line + ' L' + W + ',' + H + ' L0,' + H + ' Z';
    const last = pts[pts.length - 1];
    const gid = 'spk' + (++_sparkSeq);
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" aria-hidden="true">' +
      '<defs><linearGradient id="' + gid + '" x1="0" x2="0" y1="0" y2="1">' +
      '<stop offset="0%" stop-color="' + color + '" stop-opacity="0.24"/>' +
      '<stop offset="100%" stop-color="' + color + '" stop-opacity="0"/></linearGradient></defs>' +
      '<path d="' + fill + '" fill="url(#' + gid + ')"/>' +
      '<path d="' + line + '" fill="none" stroke="' + color + '" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>' +
      '<circle cx="' + last[0].toFixed(1) + '" cy="' + last[1].toFixed(1) + '" r="3" fill="#fff" stroke="' + color + '" stroke-width="1.5" vector-effect="non-scaling-stroke"/></svg>';
  }

  // Count-up: numeric KPI values ease from 0 to target on first mount, using
  // the SAME formatter so there's never a layout shift. Honors reduced-motion
  // and runs once per route per session (gated by caller) so it stays a
  // first-impression flourish, not a twitch on every re-render.
  function animateCounts(root) {
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const els = Array.from((root || document).querySelectorAll('.kpi-value[data-count]'));
    els.forEach((el) => {
      const target = parseFloat(el.getAttribute('data-count'));
      if (!isFinite(target)) return;
      const cur = el.getAttribute('data-cur') || '';
      const fmt = (n) => cur ? fmtMoney(n, cur, false) : String(Math.round(n));
      if (reduce) { el.textContent = fmt(target); return; }
      const dur = 680, t0 = performance.now();
      const tick = (now) => {
        const p = Math.min(1, (now - t0) / dur);
        const eased = 1 - Math.pow(1 - p, 3); // easeOutCubic
        el.textContent = fmt(target * eased);
        if (p < 1) requestAnimationFrame(tick);
        else el.textContent = fmt(target);
      };
      requestAnimationFrame(tick);
    });
  }
  // Routes whose count-up intro has already played this session.
  const _countDone = new Set();
  // My own daily share over the last N days — drives the KPI sparklines.
  function dailySpendSeries(days) {
    const now = Date.now();
    const buckets = new Array(days).fill(0);
    State.expenses.forEach((e) => {
      if (e.currency && e.currency !== 'INR') return;
      const idx = days - 1 - Math.floor((now - new Date(e.date).getTime()) / 86400000);
      if (idx < 0 || idx >= days) return;
      buckets[idx] += (e.splits.find((s) => s.userId === State.selfId) || {}).amount || 0;
    });
    return buckets;
  }
  // Sum of my own share across expenses in the last N days (dashboard "Spent").
  function spentLast(days) {
    const cutoff = Date.now() - days * 86400000;
    let sum = 0;
    State.expenses.forEach((e) => {
      if (e.currency && e.currency !== 'INR') return;
      if (new Date(e.date).getTime() < cutoff) return;
      sum += (e.splits.find((s) => s.userId === State.selfId) || {}).amount || 0;
    });
    return sum;
  }
  // Decorative iris orbit ring drawn behind the hero card value.
  function orbitOrnamentSVG() {
    // Cream-toned orbit rings + core, sitting on the dark indigo hero card.
    return '<svg width="150" height="150" viewBox="0 0 150 150" fill="none" aria-hidden="true">' +
      '<ellipse cx="75" cy="75" rx="62" ry="22" stroke="rgba(245,239,224,0.30)" stroke-width="1" stroke-dasharray="2 5" transform="rotate(-18 75 75)"/>' +
      '<ellipse cx="75" cy="75" rx="44" ry="16" stroke="rgba(245,239,224,0.45)" stroke-width="1" transform="rotate(-18 75 75)"/>' +
      '<circle cx="75" cy="75" r="9" fill="rgba(245,239,224,0.92)"/>' +
      '<circle cx="124" cy="66" r="3" fill="#F5EFE0"/>' +
      '<circle cx="30" cy="92" r="2.2" fill="rgba(245,239,224,0.7)"/></svg>';
  }
  // Live mouse-tracking 3D tilt (perspective 900px, max ±8deg), reset on leave.
  function bindTilt(root) {
    (root.querySelectorAll ? root.querySelectorAll('.tilt') : []).forEach((el) => {
      el.addEventListener('mousemove', (e) => {
        const r = el.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width - 0.5;
        const y = (e.clientY - r.top) / r.height - 0.5;
        el.style.transition = 'transform 80ms ease-out';
        el.style.transform = `perspective(900px) rotateX(${(-y * 8).toFixed(2)}deg) rotateY(${(x * 8).toFixed(2)}deg) translateZ(6px)`;
      });
      el.addEventListener('mouseleave', () => {
        el.style.transition = 'transform 550ms cubic-bezier(.22,1,.36,1)';
        el.style.transform = '';
      });
    });
  }
  function countCreditors(currency = 'INR') {
    const b = computePairBalances(State.selfId, null, currency);
    return Object.values(b).filter((v) => v > 0.01).length;
  }
  function countDebtors(currency = 'INR') {
    const b = computePairBalances(State.selfId, null, currency);
    return Object.values(b).filter((v) => v < -0.01).length;
  }

  function panelRecentActivity() {
    const card = h('div', { class: 'card' });
    card.appendChild(h('div', { class: 'card-header' }, [
      h('h3', {}, 'Recent activity'),
      h('span', { class: 'sub' }, plural(State.expenses.length, 'expense'))
    ]));
    const sortState = State.sort.dashActivity;
    const sorted = sortRows(State.expenses, sortState, {
      date: (e) => e.date,
      group: (e) => groupById(e.groupId)?.name || '',
      title: (e) => e.title,
      amount: (e) => e.amount,
      myShare: (e) => (e.splits.find((s) => s.userId === State.selfId) || {}).amount || 0,
      paidBy: (e) => payerLabel(e)
    });
    const top = sorted.slice(0, 8);
    const wrap = h('div', { class: 'tbl-wrap' });
    const tbl = h('table', { class: 'tbl tbl-expense' });
    tbl.appendChild(buildThead([
      { key: 'date', label: 'Date' },
      { key: 'group', label: 'Group' },
      { key: 'title', label: 'Description' },
      { key: 'paidBy', label: 'Paid by' },
      { key: 'amount', label: 'Amount', align: 'right' },
      { key: 'myShare', label: 'Your share', align: 'right' }
    ], sortState, (col) => { State.sort.dashActivity = toggleSort(sortState, col); render(); }));
    const tbody = h('tbody');
    if (top.length === 0) {
      tbody.appendChild(h('tr', {}, h('td', { colspan: 6, class: 'tbl-empty' }, 'No activity yet.')));
    } else {
      top.forEach((e) => {
        const g = groupById(e.groupId);
        const myShare = (e.splits.find((s) => s.userId === State.selfId) || {}).amount || 0;
        const tr = h('tr', { class: 'clickable', onClick: () => navigate('#/groups/' + e.groupId) });
        tr.appendChild(h('td', { class: 'col-date', data: { label: 'Date' } }, fmtDateShort(e.date)));
        tr.appendChild(h('td', { data: { label: 'Group' } }, g ? g.name : '—'));
        tr.appendChild(h('td', { class: 'mcol-title' }, h('div', { class: 'desc-cell' }, [
          h('span', { class: 'dot', style: { background: categoryColor(e.category) } }),
          h('div', {}, [
            h('div', { class: 'title' }, [e.title, e.receipt ? h('span', { title: 'Has a receipt', style: { marginLeft: '6px', opacity: '0.5', fontSize: '12px' } }, '📎') : null]),
            h('div', { class: 'note' }, categoryLabel(e.category))
          ])
        ])));
        tr.appendChild(h('td', { data: { label: 'Paid by' } }, h('span', { class: 'who' }, [avatar(firstPayerId(e), 'sm'), payerLabel(e)])));
        tr.appendChild(h('td', { class: 'col-amt', data: { label: 'Amount' } }, fmtMoney(e.amount, e.currency)));
        tr.appendChild(h('td', { class: 'col-amt ' + ((paidByUser(e, State.selfId) - myShare) >= 0 ? 'pos' : 'neg'), data: { label: 'Your share' } }, fmtMoney(myShare, e.currency)));
        tbody.appendChild(tr);
      });
    }
    tbl.appendChild(tbody);
    wrap.appendChild(tbl);
    card.appendChild(wrap);
    card.appendChild(h('div', { class: 'card-foot' }, [
      h('a', { class: 'btn btn-ghost btn-sm', href: '#/expenses' }, 'See all expenses →'),
      h('span', { class: 'small muted' }, 'Click row to open group')
    ]));
    return card;
  }
  function categoryColor(cat) {
    const m = { food:'#A66A14', travel:'#1A5564', bills:'#4A3F8A', shop:'#A93020', fun:'#7A4F1A', rent:'#1F6F4A', transport:'#2A2356', other:'#98917F' };
    return m[cat] || m.other;
  }
  function buildThead(cols, sortState, onSort) {
    const thead = h('thead');
    const tr = h('tr');
    cols.forEach((c) => {
      const isSorted = sortState && sortState.col === c.key;
      const th = h('th', {
        class: (c.align === 'right' ? 'right ' : '') + 'sortable ' + (isSorted ? 'sorted' : ''),
        style: c.align === 'right' ? { textAlign: 'right' } : {},
        onClick: () => onSort(c.key)
      }, [
        c.label,
        h('span', { class: 'sort-arrow' }, isSorted ? (sortState.dir === 'asc' ? '↑' : '↓') : '↕')
      ]);
      tr.appendChild(th);
    });
    thead.appendChild(tr);
    return thead;
  }
  function toggleSort(state, col) {
    if (state.col === col) return { col, dir: state.dir === 'asc' ? 'desc' : 'asc' };
    return { col, dir: 'desc' };
  }

  function panelSettleNow() {
    const card = h('div', { class: 'card' });
    card.appendChild(h('div', { class: 'card-header' }, [
      h('h3', {}, 'Settle now'),
      h('a', { class: 'sub', href: '#/settle' }, 'Open →')
    ]));
    const bal = computePairBalances(State.selfId, null, 'INR');
    const debts = Object.entries(bal).filter(([, v]) => v < -0.01).sort((a, b) => a[1] - b[1]);
    const body = h('div', { class: 'card-body', style: { padding: 0 } });
    if (debts.length === 0) {
      body.appendChild(h('div', { class: 'empty' }, [
        h('div', { class: 'empty-title' }, 'You\'re all settled up'),
        h('div', { class: 'empty-sub' }, 'No outstanding debts. Beautiful.')
      ]));
    } else {
      debts.forEach(([uid, amt]) => {
        const u = State.users.find((x) => x.id === uid);
        if (!u) return;
        const row = h('div', { class: 'owes-row' }, [
          avatar(uid, 'md'),
          h('div', {}, [
            h('div', { class: 'who-name' }, u.name),
            h('div', { class: 'who-sub' }, u.upi || u.email)
          ]),
          h('div', { class: 'amt neg' }, fmtMoney(-amt, 'INR')),
          h('div', { class: 'actions' }, [
            h('button', { class: 'btn-pay', onClick: () => payViaUPI(u, -amt) }, 'Pay'),
            h('button', { class: 'btn-wa', title: 'Message on WhatsApp', onClick: () => remindViaWhatsApp(u, -amt, 'you-owe') }, waIcon()),
            h('button', { class: 'btn-mark', onClick: () => markSettledModal(uid, -amt) }, 'Mark')
          ])
        ]);
        body.appendChild(row);
      });
    }
    card.appendChild(body);
    return card;
  }
  // ---- Device detection ----
  // Coarse pointer + small viewport + mobile UA => treat as a phone, where
  // upi:// intents actually resolve to an installed UPI app.
  function isMobileDevice() {
    const ua = navigator.userAgent || '';
    const uaMobile = /Android|iPhone|iPad|iPod|Mobile|Silk|Kindle|BlackBerry|Opera Mini|IEMobile/i.test(ua);
    const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    const narrow = window.innerWidth <= 920;
    return uaMobile || (coarse && narrow);
  }
  function isAndroid() { return /Android/i.test(navigator.userAgent || ''); }
  // Google BLOCKS OAuth inside embedded webviews (WhatsApp / Instagram / FB /
  // in-app browsers) with "disallowed_useragent". Shared links open there, so
  // detect it and tell the user to open in a real browser instead.
  function isInAppBrowser() {
    const ua = navigator.userAgent || '';
    return /(FBAN|FBAV|Instagram|WhatsApp|Line\/|Snapchat|Twitter|MicroMessenger|; wv\)|GSA\/)/i.test(ua);
  }

  // Build the UPI query string (NPCI params) shared by both link forms.
  function upiQuery(user, amount) {
    return 'pa=' + encodeURIComponent(user.upi) +
      '&pn=' + encodeURIComponent(user.name) +
      '&am=' + Number(amount).toFixed(2) +
      '&cu=INR&tn=' + encodeURIComponent('Orbit settle');
  }
  // Spec-compliant upi:// link — used for the desktop QR and as the iOS target.
  function buildUpiIntent(user, amount) {
    return 'upi://pay?' + upiQuery(user, amount);
  }
  // Android Chrome reliably opens the GPay/PhonePe/Paytm chooser only via an
  // intent:// URL (plain upi:// is often swallowed). scheme=upi routes it to
  // every installed UPI app.
  function buildAndroidUpiIntent(user, amount) {
    return 'intent://pay?' + upiQuery(user, amount) + '#Intent;scheme=upi;end';
  }

  function payViaUPI(user, amount) {
    if (!user) { toast('No recipient on this transfer', 'neg'); return; }
    if (!user.upi) {
      // No UPI saved yet — capture it in a styled in-app modal (not a native
      // browser prompt), then continue to pay once it's entered.
      openUpiCaptureModal(user, amount, () => doPayUPI(user, amount));
      return;
    }
    doPayUPI(user, amount);
  }

  // Fire the actual UPI payment once we have a VPA on the recipient.
  function doPayUPI(user, amount) {
    const url = buildUpiIntent(user, amount);
    if (isMobileDevice()) {
      // Phone: fire the intent so the OS shows the UPI app chooser
      // (GPay / PhonePe / Paytm). Android → intent:// (plain upi:// gets
      // swallowed by Chrome); iOS/others → upi://. Direct top-level
      // navigation is the reliable trigger; the hash route is untouched so
      // Orbit stays put while the OS hands off.
      toast('Opening your UPI app for ' + fmtMoney(amount, 'INR') + '…');
      const target = isAndroid() ? buildAndroidUpiIntent(user, amount) : url;
      try {
        window.location.href = target;
      } catch (_) {
        // Last-ditch fallback: anchor click (covers odd webviews).
        const a = document.createElement('a');
        a.href = target; a.rel = 'noopener'; a.style.display = 'none';
        document.body.appendChild(a);
        try { a.click(); } finally { document.body.removeChild(a); }
      }
    } else {
      // Desktop / laptop: upi:// won't resolve here, so show a QR the user
      // scans with any UPI app on their phone.
      openUpiQrModal(user, amount, url);
    }
  }

  // Inline UPI-ID capture — replaces the native window.prompt(). Validates the
  // name@bank shape, saves it on the recipient (+ syncs if it's you), then runs
  // `onDone` to continue the payment.
  function openUpiCaptureModal(user, amount, onDone) {
    const input = h('input', {
      class: 'input mono', type: 'text', placeholder: 'name@bank',
      autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false',
      inputmode: 'email', 'aria-label': 'UPI ID', style: { width: '100%' }
    });
    const hint = h('div', { class: 'small muted', style: { marginTop: '8px', minHeight: '16px' } }, '');
    const submit = () => {
      const v = (input.value || '').trim();
      if (!v) { input.focus(); return; }
      if (!/^.+@.+$/.test(v)) {
        hint.textContent = 'That doesn’t look like a UPI ID — try name@bank.';
        hint.style.color = 'var(--neg)';
        input.focus();
        return;
      }
      user.upi = v;
      OrbitDB.put('users', user).catch(() => {});
      try { if (user.id === State.selfId && window.OrbitGroups && OrbitGroups.isReady()) OrbitGroups.upsertMyProfile({ upi: v }); } catch (_) {}
      toast('Saved ' + user.name + "'s UPI ID");
      closeModal();
      onDone && onDone();
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); submit(); }
      else if (hint.textContent) { hint.textContent = ''; }
    });
    const body = h('div', { class: 'modal-body' }, [
      h('p', { class: 'small muted', style: { margin: '0 0 12px', lineHeight: '1.5' } }, [
        h('strong', { style: { color: 'var(--text-1)', fontWeight: '600' } }, user.name),
        " doesn't have a UPI ID saved yet. Add it to pay ",
        h('strong', { style: { color: 'var(--text-1)', fontWeight: '600' } }, fmtMoney(amount, 'INR')),
        ' — we’ll remember it for next time.'
      ]),
      input,
      hint
    ]);
    const modal = h('div', { class: 'modal modal-sm' }, [
      h('div', { class: 'modal-head' }, [h('h2', {}, 'Add UPI ID'), h('button', { class: 'close', onClick: closeModal }, '×')]),
      body,
      h('div', { class: 'modal-foot' }, [
        h('button', { class: 'btn btn-ghost btn-sm', onClick: closeModal }, 'Cancel'),
        h('button', { class: 'btn btn-primary btn-sm', onClick: submit }, 'Save & pay ' + fmtMoney(amount, 'INR'))
      ])
    ]);
    openModal(modal);
    setTimeout(() => { try { input.focus(); } catch (_) {} }, 60);
  }

  // Desktop QR modal — renders the UPI intent as a scannable QR via a
  // public chart image service, with a copy-link fallback.
  function openUpiQrModal(user, amount, url) {
    const qrSrc = 'https://api.qrserver.com/v1/create-qr-code/?size=240x240&margin=0&data=' + encodeURIComponent(url);
    const body = h('div', { style: { textAlign: 'center' } }, [
      h('p', { class: 'small muted', style: { margin: '0 0 16px' } },
        'Scan with any UPI app to pay ' + userNameFull(user.id) + ' ' + fmtMoney(amount, 'INR') + '.'),
      h('div', { style: { display: 'inline-flex', padding: '14px', background: '#fff', borderRadius: 'var(--r-4)', boxShadow: 'var(--sh-2)' } },
        h('img', { src: qrSrc, width: '220', height: '220', alt: 'UPI QR code', style: { display: 'block', width: '220px', height: '220px' } })),
      h('div', { class: 'small muted', style: { marginTop: '14px' } }, user.upi)
    ]);
    openInfoModal({ title: 'Pay via UPI', body, actions: [
      { label: 'Copy UPI link', onClick: () => { copyText(url); toast('UPI link copied'); } }
    ] });
  }

  // ---- WhatsApp ----
  function waOpen(text, phone) {
    // phone optional (E.164 digits, no +). Without it, WhatsApp lets the
    // user pick a chat. With it, opens that contact directly.
    const base = phone ? 'https://wa.me/' + String(phone).replace(/[^0-9]/g, '') : 'https://wa.me/';
    const url = base + '?text=' + encodeURIComponent(text);
    window.open(url, '_blank', 'noopener');
  }
  // Remind someone who owes YOU (or that you owe them) to settle, with a
  // prefilled message and a tap-to-pay UPI link.
  function remindViaWhatsApp(user, amount, direction) {
    const me = State.users.find((u) => u.id === State.selfId);
    const amt = fmtMoney(Math.abs(amount), 'INR');
    let msg;
    if (direction === 'owes-you') {
      const payTo = me && me.upi ? ('\nPay me here: upi://pay?pa=' + me.upi + '&pn=' + encodeURIComponent(me.name) + '&am=' + Math.abs(amount).toFixed(2) + '&cu=INR') : '';
      msg = 'Hi ' + user.name + ', a quick reminder — you owe me ' + amt + ' on Orbit.' + payTo + '\n\n— settled via Orbit';
    } else {
      msg = 'Hi ' + user.name + ', settling up ' + amt + ' with you via Orbit now. — ' + (me ? me.name : 'me');
    }
    waOpen(msg, user.phone);
  }
  // Invite a friend onto Orbit.
  function inviteViaWhatsApp(user) {
    const url = location.origin + location.pathname.replace(/index\.html$/, '');
    waOpen(orbitAppInviteText(url, user && user.name), user && user.phone);
  }
  // WhatsApp glyph for settle-row buttons.
  function waIcon() {
    const wrap = document.createElement('span');
    wrap.style.display = 'inline-flex';
    wrap.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38a9.9 9.9 0 0 0 4.79 1.22h.01c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0 0 12.04 2Zm0 18.13a8.2 8.2 0 0 1-4.18-1.15l-.3-.18-3.11.82.83-3.04-.2-.31a8.22 8.22 0 0 1-1.26-4.36c0-4.54 3.7-8.23 8.23-8.23 2.2 0 4.27.86 5.82 2.42a8.18 8.18 0 0 1 2.41 5.82c0 4.54-3.69 8.23-8.23 8.23Zm4.52-6.16c-.25-.12-1.47-.72-1.69-.81-.23-.08-.39-.12-.56.13-.16.25-.64.8-.78.97-.14.16-.29.18-.54.06-.25-.12-1.05-.39-1.99-1.23-.74-.66-1.23-1.47-1.38-1.72-.14-.25-.01-.38.11-.5.11-.11.25-.29.37-.43.13-.14.17-.25.25-.41.08-.17.04-.31-.02-.43-.06-.12-.56-1.34-.76-1.84-.2-.48-.4-.42-.56-.43h-.48c-.16 0-.43.06-.65.31-.22.25-.86.84-.86 2.05 0 1.21.88 2.38 1 2.54.12.17 1.73 2.64 4.19 3.7.59.25 1.04.4 1.4.52.59.19 1.12.16 1.54.1.47-.07 1.47-.6 1.67-1.18.21-.58.21-1.07.14-1.18-.06-.1-.22-.16-.47-.28Z"/></svg>';
    return wrap.firstElementChild;
  }
  // ── Canonical invite copy ────────────────────────────────────────────
  // ONE source of truth for every invite message, so a link shared via
  // WhatsApp, email, copy, or the auto-invite reads identically — same app
  // name, same tagline, same shape. Never inline an invite string elsewhere.
  const ORBIT_TAGLINE = 'Money between friends, settled.';
  function orbitGroupInviteText(groupName, url, toName) {
    return (toName ? 'Hi ' + toName + ',\n\n' : '') +
      'You\'re invited to join the “' + groupName + '” group on Orbit — the app to split & settle shared expenses, UPI-ready.\n\n' +
      'Tap to join (sign in with Google):\n' + url + '\n\n' +
      '— Orbit · ' + ORBIT_TAGLINE;
  }
  function orbitGroupInviteSubject(groupName) {
    return 'Join “' + groupName + '” on Orbit';
  }
  function orbitAppInviteText(url, toName) {
    return (toName ? 'Hey ' + toName + ',\n\n' : '') +
      'I\'m using Orbit to split & settle expenses with friends — UPI-ready, no awkward money chats.\n\n' +
      'Try it:\n' + url + '\n\n' +
      '— Orbit · ' + ORBIT_TAGLINE;
  }
  // Create a shareable invite for a SHARED (multi-user) group and offer to
  // send it via WhatsApp / copy link. Requires the shared-group layer
  // (groups.js) + the group to be a shared group. Local-only groups prompt
  // the user that sharing needs the cloud group.
  async function inviteToGroup(g) {
    if (!window.OrbitGroups || !OrbitGroups.isReady()) {
      toast('Sign in to create a shareable invite.', 'neg');
      return;
    }
    try {
      // If this group only exists locally, create its shared counterpart and
      // migrate the local group + its history onto the shared id.
      const wasId = g.id;
      let sharedId = sharedIdOf(g);
      const existing = sharedId ? await OrbitGroups.getGroup(sharedId).catch(() => null) : null;
      if (!existing) {
        sharedId = await OrbitGroups.createGroup({ name: g.name, currency: g.currency, emoji: g.emoji, category: g.category });
        try { await migrateLocalGroupToShared(g, sharedId); } catch (e) { console.warn('[Phase D] group migrate failed', e); g.sharedId = sharedId; }
      }
      // The group's id may have changed (migration); keep the route in sync.
      if (g.id !== wasId && State.route.name === 'groups' && State.route.params && State.route.params.id === wasId) {
        location.hash = '#/groups/' + g.id;
      }
      const { url } = await OrbitGroups.createInvite(sharedId);
      const body = h('div', {}, [
        h('p', { class: 'small muted', style: { margin: '0 0 14px' } }, 'Anyone who opens this link and signs in joins ' + g.name + '.'),
        h('div', { class: 'input', style: { wordBreak: 'break-all', userSelect: 'all', marginBottom: '14px' } }, url)
      ]);
      const shareMsg = orbitGroupInviteText(g.name, url);
      openInfoModal({ title: 'Invite to ' + g.name, body, actions: [
        { label: 'Copy link', onClick: () => { copyText(url); toast('Invite link copied'); } },
        { label: 'WhatsApp', onClick: () => waOpen(shareMsg) },
        { label: 'Email', onClick: () => {
          location.href = 'mailto:?subject=' + encodeURIComponent(orbitGroupInviteSubject(g.name)) +
            '&body=' + encodeURIComponent(shareMsg);
        } }
      ] });
    } catch (e) {
      toast('Could not create invite: ' + (e.message || e.code || 'error'), 'neg');
    }
  }
  // General app invite — share Orbit itself (not a specific group).
  function inviteToOrbit() {
    const url = location.origin + location.pathname.replace(/index\.html$/, '');
    const msg = orbitAppInviteText(url);
    const body = h('div', {}, [
      h('p', { class: 'small muted', style: { margin: '0 0 14px' } }, 'Share Orbit with friends and family. They sign in and can start splitting in seconds.'),
      h('div', { class: 'input', style: { wordBreak: 'break-all', userSelect: 'all', marginBottom: '14px' } }, url)
    ]);
    openInfoModal({ title: 'Invite friends to Orbit', body, actions: [
      { label: 'Copy link', onClick: () => { copyText(url); toast('Link copied'); } },
      { label: 'WhatsApp', onClick: () => waOpen(msg) },
      { label: 'Email', onClick: () => { location.href = 'mailto:?subject=' + encodeURIComponent('Try Orbit') + '&body=' + encodeURIComponent(msg); } }
    ] });
  }
  function copyText(t) {
    try { navigator.clipboard.writeText(t); } catch (_) {
      const ta = document.createElement('textarea'); ta.value = t; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); } finally { document.body.removeChild(ta); }
    }
  }
  async function markSettledModal(otherUserId, amount) {
    openConfirmModal({
      title: 'Mark as settled?',
      bodyHtml: `Record that you paid <strong>${escapeHtml(userNameFull(otherUserId))}</strong> ${escapeHtml(fmtMoney(amount, 'INR'))} outside Orbit.`,
      confirmText: 'Mark settled',
      onConfirm: async () => {
        await recordSettlementSmart(State.selfId, otherUserId, amount, 'INR');
      }
    });
  }

  function panelSpendChart28() {
    const card = h('div', { class: 'card' });
    let mode = 'day';
    // My INR share over the last 28 days, with each expense kept for grouping.
    const cutoff = Date.now() - 28 * 86400000;
    const mine = State.expenses
      .filter((e) => e.currency === 'INR' && new Date(e.date).getTime() >= cutoff)
      .map((e) => ({ e, my: (e.splits.find((s) => s.userId === State.selfId) || {}).amount || 0 }))
      .filter((x) => x.my > 0);

    const seg = h('div', { class: 'seg' });
    const body = h('div', { class: 'chart-wrap' });

    function renderBody() {
      body.innerHTML = '';
      if (mode === 'day') {
        const data = [];
        const now = new Date();
        for (let i = 27; i >= 0; i--) { const d = new Date(now); d.setDate(d.getDate() - i); d.setHours(0,0,0,0); data.push({ date: new Date(d), value: 0 }); }
        mine.forEach((x) => { const dt = new Date(x.e.date); dt.setHours(0,0,0,0); const bk = data.find((d) => d.date.getTime() === dt.getTime()); if (bk) bk.value += x.my; });
        body.appendChild(areaChart(data, { height: 220, currency: 'INR' }));
      } else if (mode === 'category') {
        const m = {}; mine.forEach((x) => { m[x.e.category] = (m[x.e.category] || 0) + x.my; });
        const slices = Object.entries(m).map(([c, v]) => ({ label: categoryLabel(c), value: v, color: categoryColor(c) })).sort((a, b) => b.value - a.value);
        body.appendChild(donutWithLegend(slices));
      } else if (mode === 'group') {
        const m = {}; mine.forEach((x) => { m[x.e.groupId] = (m[x.e.groupId] || 0) + x.my; });
        const rows = Object.entries(m).map(([gid, v]) => { const g = groupById(gid); return { label: g ? g.name : '—', value: v, color: groupColor(g) }; }).sort((a, b) => b.value - a.value);
        body.appendChild(rows.length ? hbarList(rows) : emptyMini());
      } else { // person — who you spend through (the payer)
        const m = {}; mine.forEach((x) => { m[x.e.paidBy] = (m[x.e.paidBy] || 0) + x.my; });
        const rows = Object.entries(m).map(([pid, v]) => { const u = State.users.find((z) => z.id === pid); return { label: u ? (u.isSelf ? 'You' : u.name) : '—', value: v, color: personColor(pid) }; }).sort((a, b) => b.value - a.value);
        body.appendChild(rows.length ? hbarList(rows) : emptyMini());
      }
    }

    [['day', 'By day'], ['category', 'By category'], ['group', 'By group'], ['person', 'By person']].forEach(([m, l]) => {
      const btn = h('button', { class: mode === m ? 'active' : '', onClick: () => { mode = m; Array.prototype.forEach.call(seg.children, (c) => c.classList.remove('active')); btn.classList.add('active'); renderBody(); } }, l);
      seg.appendChild(btn);
    });

    card.appendChild(h('div', { class: 'card-header' }, [
      h('div', {}, [h('h3', {}, 'Your spending'), h('span', { class: 'sub' }, 'Your share · last 28 days · INR')]),
      seg
    ]));
    card.appendChild(body);
    renderBody();
    return card;
  }
  function emptyMini() { return h('div', { class: 'empty', style: { padding: '32px' } }, 'No spend in the last 28 days.'); }
  function donutWithLegend(slices) {
    if (!slices.length) return emptyMini();
    const wrap = h('div', { class: 'donut-wrap' });
    wrap.appendChild(donutChart(slices, { size: 200, currency: 'INR' }));
    const total = slices.reduce((s, x) => s + x.value, 0) || 1;
    const legend = h('div', { class: 'donut-legend' });
    slices.forEach((s) => legend.appendChild(h('div', { class: 'lg-row' }, [
      h('span', { class: 'lg-dot', style: { background: s.color } }),
      h('span', {}, s.label),
      h('span', { class: 'muted', style: { fontSize: '12px', marginLeft: 'auto' } }, Math.round((s.value / total) * 100) + '%'),
      h('span', { class: 'lg-amt', style: { marginLeft: '12px' } }, fmtMoney(s.value, 'INR'))
    ])));
    wrap.appendChild(legend);
    return wrap;
  }
  // Editorial per-person colour for the "By person" bars.
  function personColor(uid) {
    const palette = ['#2A2356', '#A66A14', '#1F6F4A', '#A93020', '#1A5564', '#4A3F8A', '#7A4F1A', '#355E8A'];
    const idx = State.users.findIndex((u) => u.id === uid);
    return palette[((idx >= 0 ? idx : 0) % palette.length)];
  }
  // Theme-styled feather-ish SVG icons (inherit colour via currentColor).
  function uiIcon(name, size = 16) {
    const P = {
      'trend-up': '<path d="M3 17l6-6 4 4 7-7"/><path d="M16 7h5v5"/>',
      'trend-down': '<path d="M3 7l6 6 4-4 7 7"/><path d="M16 17h5v-5"/>',
      'pie': '<path d="M21.2 15.9A10 10 0 1 1 8 2.8"/><path d="M22 12A10 10 0 0 0 12 2v10z"/>',
      'calendar': '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
      'target': '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.6"/>',
      'scale': '<path d="M12 3v18M7 21h10"/><path d="M5 7h14l-2.4 6.2a2.7 2.7 0 0 1-5.2 0z"/><path d="M5 7l-2.4 6.2a2.7 2.7 0 0 0 5.2 0z"/>',
      'sparkle': '<path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9z"/>',
      'rupee': '<path d="M7 5h10M7 9h10M15.5 5c0 4-3.5 5-6.5 5h-1l8 9"/>',
      'flame': '<path d="M12 22c3.6 0 6.5-2.9 6.5-6.5 0-3.8-3.8-5.8-3.8-9.5-1.9 1-2.9 2.8-2.9 4.6 0-1-.9-2.8-1.9-3.7-1 1.9-1.9 3.8-1.9 5.7 0 4.6 2.8 9.4 5.9 9.4z"/>',
      'alert': '<path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 2 18a2 2 0 0 0 1.7 3h16.6A2 2 0 0 0 22 18L13.7 3.9a2 2 0 0 0-3.4 0z"/>',
      'arrow-right': '<path d="M5 12h14M13 5l7 7-7 7"/>',
      'clock': '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'
    };
    return el(`<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${P[name] || P.sparkle}</svg>`);
  }
  // Monthly budget vs actual card (stored per-device per currency in localStorage).
  function budgetCard(cur, spent) {
    const key = 'orbit_budget_' + cur;
    const budget = parseFloat(localStorage.getItem(key)) || 0;
    const card = h('div', { class: 'card', style: { marginBottom: 'var(--s-5)' } });
    card.appendChild(h('div', { class: 'card-header' }, [
      h('div', {}, [h('h3', {}, 'Monthly budget'), h('span', { class: 'sub' }, 'Your share · ' + cur)]),
      h('button', { class: 'btn btn-ghost btn-sm', onClick: () => openBudgetModal(cur) }, budget ? 'Edit' : 'Set budget')
    ]));
    const bodyEl = h('div', { class: 'card-body' });
    if (!budget) {
      bodyEl.appendChild(h('div', { class: 'small muted' }, 'Set a monthly budget to track spending against a target. Free, private to this device.'));
    } else {
      const over = spent > budget;
      const pct = Math.round(spent / budget * 100);
      bodyEl.appendChild(h('div', { class: 'budget-row' }, [
        h('span', { class: 'budget-spent ' + (over ? 'neg' : '') }, fmtMoney(spent, cur)),
        h('span', { class: 'small muted' }, 'of ' + fmtMoney(budget, cur))
      ]));
      bodyEl.appendChild(h('div', { class: 'budget-track' }, h('div', { class: 'budget-fill ' + (over ? 'over' : pct > 80 ? 'warn' : ''), style: { width: Math.min(100, spent / budget * 100).toFixed(1) + '%' } })));
      bodyEl.appendChild(h('div', { class: 'small ' + (over ? 'neg' : 'muted'), style: { marginTop: '8px', display: 'flex', alignItems: 'center', gap: '6px' } }, [
        over ? uiIcon('alert', 13) : null,
        over ? 'Over budget by ' + fmtMoney(spent - budget, cur) : (fmtMoney(budget - spent, cur) + ' left · ' + pct + '% used')
      ]));
    }
    card.appendChild(bodyEl);
    return card;
  }
  function openBudgetModal(cur) {
    const key = 'orbit_budget_' + cur;
    const cur0 = parseFloat(localStorage.getItem(key)) || '';
    const input = h('input', { class: 'input input-money', type: 'number', min: '0', step: '100', value: cur0, placeholder: '0' });
    const body = h('div', {}, [
      h('div', { class: 'form-row' }, [h('label', {}, 'Monthly budget (' + cur + ')'), input]),
      h('div', { class: 'small muted' }, 'Tracks your share of spending each month against this target.')
    ]);
    const modal = h('div', { class: 'modal modal-sm' }, [
      h('div', { class: 'modal-head' }, [h('h2', {}, 'Monthly budget'), h('button', { class: 'close', onClick: closeModal }, '×')]),
      h('div', { class: 'modal-body' }, body),
      h('div', { class: 'modal-foot' }, [
        cur0 ? h('button', { class: 'btn btn-ghost btn-sm', onClick: () => { localStorage.removeItem(key); closeModal(); render(); } }, 'Remove') : null,
        h('span', { class: 'spacer' }),
        h('button', { class: 'btn btn-ghost btn-sm', onClick: closeModal }, 'Cancel'),
        h('button', { class: 'btn btn-primary btn-sm', onClick: () => { const v = parseFloat(input.value); if (v > 0) localStorage.setItem(key, v); else localStorage.removeItem(key); closeModal(); render(); toast('Budget saved', 'pos'); } }, 'Save')
      ])
    ]);
    openModal(modal);
    setTimeout(() => { try { input.focus(); } catch (_) {} }, 60);
  }
  // Age (in days) of a debt with another person = oldest shared expense that
  // involves you both. Drives the settle-page "stale debt" nudge.
  function debtAge(otherId) {
    let oldest = null;
    State.expenses.forEach((e) => {
      const g = groupById(e.groupId); if (!g || !g.members) return;
      if (!g.members.includes(otherId) || !g.members.includes(State.selfId)) return;
      const involves = (uid) => e.paidBy === uid || (e.payers || []).some((p) => p.userId === uid) || (e.splits || []).some((s) => s.userId === uid);
      if (!involves(otherId) || !involves(State.selfId)) return;
      const t = new Date(e.date).getTime();
      if (oldest === null || t < oldest) oldest = t;
    });
    if (oldest === null) return null;
    return Math.floor((Date.now() - oldest) / 86400000);
  }

  // ---- SVG charts ----
  function areaChart(data, opts = {}) {
    const W = 1080, H = opts.height || 220;
    const padL = 40, padR = 12, padT = 14, padB = 28;
    const max = Math.max(...data.map((d) => d.value), 1);
    const xStep = (W - padL - padR) / Math.max(1, data.length - 1);
    const yScale = (v) => padT + (1 - v / max) * (H - padT - padB);
    const pts = data.map((d, i) => [padL + i * xStep, yScale(d.value)]);
    const pathLine = smoothLinePath(pts);
    const pathArea = pathLine + ` L${(padL + (data.length - 1) * xStep).toFixed(1)},${(H - padB).toFixed(1)} L${padL.toFixed(1)},${(H - padB).toFixed(1)} Z`;

    const ticks = 4;
    const gridLines = [];
    for (let i = 0; i <= ticks; i++) {
      const y = padT + (i / ticks) * (H - padT - padB);
      const val = max * (1 - i / ticks);
      gridLines.push(`<line x1="${padL}" x2="${W - padR}" y1="${y}" y2="${y}" />`);
      gridLines.push(`<text x="${padL - 6}" y="${y + 3}" class="label" text-anchor="end">${fmtMoney(Math.round(val), opts.currency || 'INR')}</text>`);
    }
    // x ticks
    const xLabels = [];
    [0, 7, 14, 21, 27].forEach((i) => {
      const x = padL + i * xStep;
      const d = data[i].date;
      xLabels.push(`<text x="${x}" y="${H - 8}" class="label" text-anchor="middle">${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</text>`);
    });

    const ac = State.theme === 'dark' ? '#4FE3B0' : vizColors().accent;  // mint glow line in dark
    const dotFill = State.theme === 'dark' ? '#0C0B16' : '#fff';
    const svg = `<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
      <defs>
        <linearGradient id="accent-grad" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stop-color="${ac}" stop-opacity="0.32"/>
          <stop offset="100%" stop-color="${ac}" stop-opacity="0"/>
        </linearGradient>
      </defs>
      <g class="grid">${gridLines.join('')}</g>
      <path class="area-fill" d="${pathArea}"/>
      <path class="area-line" d="${pathLine}" stroke="${ac}"/>
      <circle cx="${pts[pts.length - 1][0].toFixed(1)}" cy="${pts[pts.length - 1][1].toFixed(1)}" r="4" fill="${dotFill}" stroke="${ac}" stroke-width="2"/>
      <g>${xLabels.join('')}</g>
    </svg>`;
    return el(svg);
  }
  function donutChart(slices, opts = {}) {
    const size = opts.size || 200;
    const r = size / 2 - 8;
    const cx = size / 2, cy = size / 2;
    const total = slices.reduce((s, x) => s + x.value, 0) || 1;
    let a0 = -Math.PI / 2;
    const paths = slices.map((s) => {
      const a1 = a0 + (s.value / total) * Math.PI * 2;
      const x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0);
      const x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
      const large = a1 - a0 > Math.PI ? 1 : 0;
      const ri = r - 28;
      const x2 = cx + ri * Math.cos(a1), y2 = cy + ri * Math.sin(a1);
      const x3 = cx + ri * Math.cos(a0), y3 = cy + ri * Math.sin(a0);
      const path = `M${x0},${y0} A${r},${r} 0 ${large} 1 ${x1},${y1} L${x2},${y2} A${ri},${ri} 0 ${large} 0 ${x3},${y3} Z`;
      a0 = a1;
      return `<path d="${path}" fill="${s.color}" opacity="0.9"/>`;
    });
    return el(`<svg class="chart" viewBox="0 0 ${size} ${size}" style="max-width:${size}px">${paths.join('')}<text x="${cx}" y="${cy - 4}" text-anchor="middle" class="label" style="font-size:11px;fill:var(--text-3)">Total</text><text x="${cx}" y="${cy + 12}" text-anchor="middle" style="font-family:var(--font-display);font-weight:600;fill:var(--text-1);font-size:14px">${fmtMoney(total, opts.currency || 'INR')}</text></svg>`);
  }
  function barChart(data, opts = {}) {
    const W = 720, H = opts.height || 200;
    const padL = 36, padR = 8, padT = 12, padB = 28;
    const max = Math.max(...data.map((d) => d.value), 1);
    const bw = (W - padL - padR) / data.length;
    const rects = data.map((d, i) => {
      const h2 = (d.value / max) * (H - padT - padB);
      const x = padL + i * bw + 6;
      const y = H - padB - h2;
      return `<rect class="bar" x="${x}" y="${y}" width="${bw - 12}" height="${h2}" rx="3"/>`;
    });
    const labels = data.map((d, i) => `<text x="${padL + i * bw + bw/2}" y="${H - 8}" class="label" text-anchor="middle">${d.label}</text>`);
    // grid
    const gridLines = [];
    for (let i = 0; i <= 4; i++) {
      const y = padT + (i / 4) * (H - padT - padB);
      gridLines.push(`<line x1="${padL}" x2="${W - padR}" y1="${y}" y2="${y}" />`);
      const val = max * (1 - i / 4);
      gridLines.push(`<text x="${padL - 6}" y="${y + 3}" class="label" text-anchor="end">${Math.round(val)}</text>`);
    }
    return el(`<svg class="chart" viewBox="0 0 ${W} ${H}">${`<g class="grid">${gridLines.join('')}</g>` + rects.join('') + labels.join('')}</svg>`);
  }
  // Mini donut — no centred total, smaller. For inline use beside other charts.
  function miniDonut(slices, opts = {}) {
    const size = opts.size || 120;
    const r = size / 2 - 4;
    const ri = r - 16;
    const cx = size / 2, cy = size / 2;
    const total = slices.reduce((s, x) => s + x.value, 0) || 1;
    let a0 = -Math.PI / 2;
    const paths = slices.map((s) => {
      const a1 = a0 + (s.value / total) * Math.PI * 2;
      const x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0);
      const x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
      const large = a1 - a0 > Math.PI ? 1 : 0;
      const x2 = cx + ri * Math.cos(a1), y2 = cy + ri * Math.sin(a1);
      const x3 = cx + ri * Math.cos(a0), y3 = cy + ri * Math.sin(a0);
      const path = `M${x0},${y0} A${r},${r} 0 ${large} 1 ${x1},${y1} L${x2},${y2} A${ri},${ri} 0 ${large} 0 ${x3},${y3} Z`;
      a0 = a1;
      return `<path d="${path}" fill="${s.color}" opacity="0.92"/>`;
    });
    return el(`<svg class="chart" viewBox="0 0 ${size} ${size}" style="max-width:${size}px">${paths.join('')}</svg>`);
  }
  // Horizontal bar list — label + bar + value. Returns a DIV.
  function hbarList(rows, opts = {}) {
    const currency = opts.currency || 'INR';
    const max = Math.max(...rows.map((r) => r.value), 1);
    const root = h('div', { class: 'hbar-list' });
    rows.forEach((r) => {
      const pct = (r.value / max) * 100;
      const row = h('div', { class: 'hbar-row' }, [
        h('span', { class: 'hbar-label' }, r.label),
        h('span', { class: 'hbar-track' }, h('span', { class: 'hbar-fill', style: { width: pct.toFixed(1) + '%', background: r.color || 'var(--accent)' } })),
        h('span', { class: 'hbar-val' }, fmtMoney(r.value, currency))
      ]);
      root.appendChild(row);
    });
    return root;
  }
  // Calendar-style spending heatmap (landscape: weekday columns × week rows, with
  // day-of-month numbers). Fills a wide card far better than a portrait strip.
  // data: [{date:Date, value:number}]
  function heatmapChart(data, opts = {}) {
    const cell = opts.cell || 76;
    const gap = opts.gap || 9;
    const currency = opts.currency || 'INR';
    const max = Math.max(...data.map((d) => d.value), 1);
    const firstDow = (data[0].date.getDay() + 6) % 7; // Mon=0..Sun=6
    const totalSlots = firstDow + data.length;
    const rows = Math.ceil(totalSlots / 7);
    const padT = 26;
    const W = 7 * cell + 6 * gap;
    const H = padT + rows * cell + (rows - 1) * gap;
    const rx = Math.round(cell * 0.22);
    const wd = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const headers = wd.map((l, i) =>
      `<text x="${i * (cell + gap) + cell / 2}" y="${padT - 11}" class="label" text-anchor="middle" style="font-size:11px;letter-spacing:0.04em">${l}</text>`);
    const rects = data.map((d, idx) => {
      const slot = idx + firstDow;
      const col = slot % 7, row = Math.floor(slot / 7);
      const x = col * (cell + gap), y = padT + row * (cell + gap);
      const isToday = d.date.toDateString() === new Date().toDateString();
      const intensity = d.value > 0 ? 0.16 + (d.value / max) * 0.84 : 0;
      const fill = d.value > 0 ? `rgba(42,35,86,${intensity.toFixed(3)})` : 'rgba(42,35,86,0.05)';
      const txt = (d.value > 0 && intensity > 0.5) ? '#F6F2E8' : 'var(--text-3)';
      const tip = `${d.date.toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'})}: ${fmtMoney(d.value, currency)}`;
      const ring = isToday ? `<rect x="${x + 1}" y="${y + 1}" width="${cell - 2}" height="${cell - 2}" rx="${rx}" fill="none" stroke="var(--accent)" stroke-width="2"/>` : '';
      const clickable = opts.onDay ? ` data-date="${d.date.toISOString()}" style="cursor:pointer"` : '';
      return `<g${clickable}><rect x="${x}" y="${y}" width="${cell}" height="${cell}" rx="${rx}" fill="${fill}"><title>${tip}</title></rect>` +
        `<text x="${x + cell / 2}" y="${y + cell / 2 + 4}" text-anchor="middle" style="font-size:13px;font-variant-numeric:tabular-nums;pointer-events:none" fill="${txt}">${d.date.getDate()}</text>${ring}</g>`;
    });
    const svg = el(`<svg class="chart heatmap-svg" viewBox="0 0 ${W} ${H}" style="width:100%;max-width:${W}px">${headers.join('')}${rects.join('')}</svg>`);
    if (opts.onDay) {
      svg.addEventListener('click', (ev) => {
        const g = ev.target.closest && ev.target.closest('[data-date]');
        if (g) opts.onDay(g.getAttribute('data-date'));
      });
    }
    return svg;
  }

  // -------- GROUPS LIST --------
  function viewGroups() {
    const page = h('div', { class: 'page' });
    page.appendChild(h('header', { class: 'page-header' }, [
      h('div', { class: 'title-block' }, [
        h('h1', {}, 'Groups'),
        h('div', { class: 'sub' }, plural(State.groups.length, 'group') + ' · ' + plural(State.expenses.length, 'expense') + ' total')
      ]),
      h('div', { class: 'actions' }, [
        h('button', { class: 'btn btn-primary btn-sm', onClick: openNewGroup }, '+ New group')
      ])
    ]));

    // Toolbar
    const toolbar = h('div', { class: 'toolbar', style: { borderRadius: 'var(--r-3)', border: '1px solid var(--line)', marginBottom: 'var(--s-5)' } });
    const searchInp = h('input', { type: 'search', class: 'filter-input', placeholder: 'Search groups…', style: { width: '260px' } });
    let q = '';
    searchInp.addEventListener('input', (e) => { q = e.target.value.toLowerCase(); renderGrid(); });
    toolbar.appendChild(searchInp);
    const catSel = h('select', { class: 'filter-input' }, [
      h('option', { value: '' }, 'All categories'),
      h('option', { value: 'trip' }, 'Trips'),
      h('option', { value: 'household' }, 'Household'),
      h('option', { value: 'friends' }, 'Friends'),
      h('option', { value: 'work' }, 'Work')
    ]);
    let cat = '';
    catSel.addEventListener('change', (e) => { cat = e.target.value; renderGrid(); });
    toolbar.appendChild(catSel);
    toolbar.appendChild(h('span', { class: 'spacer' }));
    toolbar.appendChild(h('span', { class: 'small muted' }, 'Showing ' + State.groups.length + ' groups'));
    page.appendChild(toolbar);

    const grid = h('div', { class: 'group-grid' });
    page.appendChild(grid);

    function renderGrid() {
      grid.innerHTML = '';
      let groups = State.groups.filter((g) => !g.archived);
      if (q) groups = groups.filter((g) => g.name.toLowerCase().includes(q));
      if (cat) groups = groups.filter((g) => g.category === cat);
      groups.sort((a, b) => (lastActivityDate(b.id) || '').localeCompare(lastActivityDate(a.id) || ''));
      if (groups.length === 0) {
        // Distinguish a true first-run (no groups at all) from a filtered-out
        // result — a new user hasn't "filtered" anything.
        const noneAtAll = State.groups.length === 0;
        const empty = h('div', { class: 'empty', style: { gridColumn: '1 / -1' } }, [
          h('div', { class: 'empty-title' }, noneAtAll ? 'Start your first group' : 'No groups match'),
          h('div', { class: 'empty-sub' }, noneAtAll
            ? 'Create a group for your flat, trip, or friends — then add an expense and settle in a tap.'
            : 'Try changing the search or category filter.')
        ]);
        if (noneAtAll) {
          const cta = h('button', { class: 'btn btn-primary btn-sm', style: { marginTop: '14px' }, onClick: () => openNewGroup() }, '+ New group');
          empty.appendChild(cta);
        }
        grid.appendChild(empty);
        return;
      }
      groups.forEach((g) => grid.appendChild(groupCard(g)));
      grid.appendChild(newGroupPromptCard());
    }
    renderGrid();
    setMain(page);
  }
  // Dashed "Spin up a new group" prompt card that sits at the end of the grid
  // (matches the reference Groups screen).
  function newGroupPromptCard() {
    return h('div', { class: 'group-card new-group-card', onClick: () => openNewGroup() }, [
      h('div', { class: 'ngp-inner' }, [
        h('span', { class: 'ngp-plus' }, '+'),
        h('div', { class: 'ngp-title' }, 'Spin up a new group'),
        h('div', { class: 'ngp-sub' }, 'Add an apartment, a trip, or a recurring crew.')
      ])
    ]);
  }
  function groupCard(g) {
    const bal = computeGroupBalanceForSelf(g.id);
    const balCls = bal > 0.01 ? 'pos' : bal < -0.01 ? 'neg' : 'zero';
    const groupExps = State.expenses.filter((e) => e.groupId === g.id);
    const last = lastActivityDate(g.id);
    const tag = (g.emoji || g.name.slice(0, 1).toUpperCase()) + ' · ' + g.name.toUpperCase();
    return h('div', { class: 'group-card cover-card', onClick: () => navigate('#/groups/' + g.id) }, [
      h('div', { class: 'group-cover', html:
        groupCoverSVG(groupCoverStyle(g), groupCoverColor(g), 'gc-' + g.id) +
        '<span class="gc-cover-tag">' + escapeHtml(tag) + '</span>' }),
      h('div', { class: 'group-body' }, [
        h('div', {}, [
          h('h3', { class: 'group-name' }, g.name),
          h('div', { class: 'gc-desc' }, g.description || categoryLabel(g.category) || 'Shared expenses')
        ]),
        h('div', { class: 'gc-row' }, [
          avatarStack(g.members, 5),
          h('div', { class: 'gc-bal-block' }, [
            h('div', { class: 'gc-bal ' + balCls }, bal === 0 ? '—' : (bal > 0 ? '+' : '−') + fmtMoney(Math.abs(bal), g.currency)),
            h('div', { class: 'small muted' }, bal > 0 ? 'you are owed' : bal < 0 ? 'you owe' : 'settled up')
          ])
        ]),
        h('div', { class: 'gc-foot-row small muted' },
          plural(groupExps.length, 'expense') + (last ? ' · last ' + fmtDateRel(last) : ''))
      ])
    ]);
  }
  // ---- Group cover art (ported from the reference design system) ----
  function groupCoverStyle(g) {
    if (g.cover) return g.cover;
    const byCat = { household: 'sunset', work: 'grid' };
    if (byCat[g.category]) return byCat[g.category];
    const s = String(g.id || g.name || '');
    const hash = s.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
    return (hash % 2) ? 'mountain' : 'wave';
  }
  function groupCoverColor(g) {
    const map = { trip: '#1A5564', household: '#A66A14', friends: '#A93020', work: '#1F6F4A' };
    return map[g.category] || '#A66A14';
  }
  function groupCoverSVG(style, color, uid) {
    uid = (uid || 'c').replace(/[^a-zA-Z0-9_-]/g, '');
    if (style === 'mountain') return '<svg viewBox="0 0 320 180" preserveAspectRatio="xMidYMid slice">' +
      '<defs><linearGradient id="cv-mtn-' + uid + '" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#B7DBDE"/><stop offset="1" stop-color="#6FA9AE"/></linearGradient></defs>' +
      '<rect width="320" height="180" fill="url(#cv-mtn-' + uid + ')"/>' +
      '<polygon points="0,140 80,60 140,110 200,40 280,120 320,90 320,180 0,180" fill="' + color + '" opacity="0.85"/>' +
      '<polygon points="0,160 100,100 180,140 260,90 320,130 320,180 0,180" fill="#143E47" opacity="0.7"/>' +
      '<circle cx="60" cy="50" r="14" fill="#FFF" opacity="0.5"/></svg>';
    if (style === 'wave') return '<svg viewBox="0 0 320 180" preserveAspectRatio="xMidYMid slice">' +
      '<defs><linearGradient id="cv-wv-' + uid + '" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#F5C9C0"/><stop offset="1" stop-color="' + color + '"/></linearGradient></defs>' +
      '<rect width="320" height="180" fill="url(#cv-wv-' + uid + ')"/>' +
      '<path d="M0 100 Q60 70 120 100 T240 100 T360 100 L360 180 L0 180 Z" fill="#E5907D" opacity="0.7"/>' +
      '<path d="M0 130 Q60 105 120 130 T240 130 T360 130 L360 180 L0 180 Z" fill="#7A1A0D" opacity="0.6"/>' +
      '<circle cx="50" cy="40" r="18" fill="#FFE7BF" opacity="0.9"/></svg>';
    if (style === 'grid') return '<svg viewBox="0 0 320 180" preserveAspectRatio="xMidYMid slice">' +
      '<defs><linearGradient id="cv-gr-' + uid + '" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stop-color="#E0E7CF"/><stop offset="1" stop-color="#A4BC85"/></linearGradient></defs>' +
      '<rect width="320" height="180" fill="url(#cv-gr-' + uid + ')"/>' +
      [0,1,2,3,4,5,6,7].map((i) => '<line x1="' + (i*40) + '" y1="0" x2="' + (i*40) + '" y2="180" stroke="' + color + '" stroke-opacity="0.18" stroke-width="1"/>').join('') +
      [0,1,2,3,4].map((i) => '<line x1="0" y1="' + (i*40) + '" x2="320" y2="' + (i*40) + '" stroke="' + color + '" stroke-opacity="0.18" stroke-width="1"/>').join('') +
      '<circle cx="200" cy="80" r="40" fill="' + color + '" opacity="0.7"/><circle cx="200" cy="80" r="24" fill="#FFFCEC" opacity="0.7"/></svg>';
    // sunset (default)
    return '<svg viewBox="0 0 320 180" preserveAspectRatio="xMidYMid slice">' +
      '<defs><linearGradient id="cv-sun-' + uid + '" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#F4D9A7"/><stop offset="0.5" stop-color="#E5A55B"/><stop offset="1" stop-color="' + color + '"/></linearGradient></defs>' +
      '<rect width="320" height="180" fill="url(#cv-sun-' + uid + ')"/>' +
      '<circle cx="240" cy="80" r="26" fill="#FFF3DC" opacity="0.95"/>' +
      '<path d="M0 130 Q80 110 160 122 T320 116 L320 180 L0 180 Z" fill="#7A4F1A" opacity="0.7"/>' +
      '<path d="M0 150 Q90 140 180 148 T320 142 L320 180 L0 180 Z" fill="#3D2A0D" opacity="0.65"/></svg>';
  }

  // -------- GROUP DETAIL --------
  function viewGroupDetail(groupId) {
    const g = groupById(groupId);
    if (!g) { setMain(notFound('Group not found.')); return; }
    const tab = State.route.query.tab || State.activeTab.group || 'expenses';
    State.activeTab.group = tab;

    const page = h('div', { class: 'page' });

    // Top row: back link + group actions
    page.appendChild(h('div', { class: 'detail-top' }, [
      h('a', { class: 'detail-back', href: '#/groups' }, '← Back to groups'),
      h('div', { class: 'actions' }, [
        h('button', { class: 'btn btn-ghost btn-sm', onClick: () => inviteToGroup(g) }, 'Invite'),
        h('button', { class: 'btn btn-ghost btn-sm', onClick: () => openConfirmModal({
          title: 'Archive group?', bodyHtml: 'It’ll be hidden from your groups list. Existing expenses stay, and you can unarchive it from Settings.', confirmText: 'Archive', onConfirm: async () => {
            g.archived = true;
            await OrbitDB.put('groups', g);
            State.groups = State.groups.map((x) => x.id === g.id ? g : x);
            renderSidebarGroups();
            toast('Archived “' + g.name + '”', 'pos');
            navigate('#/groups');
          } }) }, 'Archive'),
        h('button', { class: 'btn btn-primary btn-sm', onClick: () => openExpenseModal({ groupId: g.id }) }, '+ Add expense')
      ])
    ]));

    // Cover-art hero band
    const hero = h('div', { class: 'group-hero' });
    hero.appendChild(h('div', { class: 'group-hero-cover', html: groupCoverSVG(groupCoverStyle(g), groupCoverColor(g), 'gh-' + g.id) }));
    hero.appendChild(h('div', { class: 'group-hero-veil' }));
    hero.appendChild(h('div', { class: 'group-hero-content' }, [
      h('div', { class: 'group-hero-eyebrow' }, (g.description || categoryLabel(g.category) || 'Shared expenses').toUpperCase()),
      h('input', {
        class: 'group-hero-title', value: g.name,
        'aria-label': 'Group name',
        onChange: async (e) => {
          g.name = e.target.value.trim() || g.name;
          await OrbitDB.put('groups', g);
          renderSidebarGroups(); renderCrumbs(); toast('Renamed');
        }
      })
    ]));
    hero.appendChild(h('div', { class: 'group-hero-avatars' }, avatarStack(g.members, 6)));
    page.appendChild(hero);

    // Members chips row
    const chipRow = h('div', { class: 'member-chip-row' });
    // Work out which member is the owner so we can label them clearly — the #1
    // confusion was "who owns this group / why can't I remove anyone".
    let ownerId = null;
    if (!isSharedGroup(g)) ownerId = State.selfId;          // you own local groups
    else if (isGroupOwner(g)) ownerId = State.selfId;       // you created the shared group
    else if (g.members.length === 2) ownerId = g.members.find((m) => !isSelfMember(m)) || null; // the other person owns it
    g.members.forEach((mid) => {
      const u = State.users.find((x) => x.id === mid);
      if (!u) return;
      chipRow.appendChild(h('span', { class: 'member-chip' }, [
        avatar(mid, 'sm'),
        u.name,
        mid === ownerId ? h('span', { class: 'owner-badge', title: 'Group owner' }, 'Owner') : null,
        !isSelfMember(mid) && g.members.length >= 2 && isGroupOwner(g) ? h('span', { class: 'x', title: 'Remove ' + u.name, onClick: (e) => { e.stopPropagation(); removeMemberFromGroup(g, mid); } }, '×') : null
      ]));
    });
    // Only the owner manages membership (matches the remove gate above).
    if (isGroupOwner(g)) chipRow.appendChild(h('button', { class: 'member-chip', onClick: () => openAddMemberModal(g) }, '+ Add'));
    page.appendChild(chipRow);
    // For members who aren't the owner, explain why they can't manage membership.
    if (isSharedGroup(g) && !isGroupOwner(g)) {
      page.appendChild(h('div', { class: 'small muted', style: { margin: '-8px 0 16px' } },
        'Only the group owner can add or remove members. You can leave the group from Settings.'));
    }

    // Stats strip
    const stats = h('div', { class: 'stat-strip' });
    const groupExps = State.expenses.filter((e) => e.groupId === g.id);
    const total = groupExps.reduce((s, e) => s + e.amount, 0);
    const myShare = groupExps.reduce((s, e) => s + (((e.splits || []).find((sp) => sp.userId === State.selfId) || {}).amount || 0), 0);
    const myBal = computeGroupBalanceForSelf(g.id);
    const posCls = myBal > 0 ? 'pos' : myBal < 0 ? 'neg' : '';
    // Each stat card jumps to the tab that explains it — Members → Balances,
    // spend → Expenses, Your position → Settle — so tapping a number is intuitive.
    const statLink = (toTab, children, extra) => h('div', Object.assign({
      class: 'stat stat-link', role: 'link', tabindex: '0',
      onClick: () => goGroupTab(g, toTab, 'tabs'),
      onKeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); goGroupTab(g, toTab, 'tabs'); } }
    }, extra || {}), children);
    // Members → Balances (per-member breakdown)
    stats.appendChild(statLink('balances', [
      h('div', { class: 'stat-label' }, 'Members'),
      h('div', { class: 'stat-members-row' }, [avatarStack(g.members, 4), h('div', { class: 'stat-value' }, String(g.members.length))])
    ]));
    // Total spent → Expenses
    stats.appendChild(statLink('expenses', [
      h('div', { class: 'stat-label' }, 'Total spent'),
      h('div', { class: 'stat-value' }, fmtMoney(total, g.currency)),
      h('div', { class: 'small muted', style: { marginTop: 'auto' } }, plural(groupExps.length, 'expense'))
    ]));
    // Your share → Expenses
    stats.appendChild(statLink('expenses', [h('div', { class: 'stat-label' }, 'Your share'), h('div', { class: 'stat-value' }, fmtMoney(myShare, g.currency))]));
    // Your position → Settle (the Add-expense button stops the card's navigation)
    stats.appendChild(statLink('settle', [
      h('div', { class: 'stat-label' }, 'Your position'),
      h('div', { class: 'stat-value ' + posCls }, myBal === 0 ? '—' : (myBal > 0 ? '+' : '') + fmtMoney(myBal, g.currency)),
      h('button', { class: 'btn btn-sm', style: { marginTop: '10px', alignSelf: 'flex-start' }, onClick: (ev) => { ev.stopPropagation(); openExpenseModal({ groupId: g.id }); } }, '+ Add expense')
    ]));
    page.appendChild(stats);

    // Tabs — switching a tab keeps your scroll position (no fling to the top).
    const tabs = h('div', { class: 'tabs' });
    ['expenses','balances','settle','receipts','settings'].forEach((t) => {
      tabs.appendChild(h('div', { class: 'tab' + (t === tab ? ' active' : ''), onClick: () => goGroupTab(g, t, 'keep') },
        t.charAt(0).toUpperCase() + t.slice(1) + (t === 'expenses' ? ' ' : '')));
    });
    page.appendChild(tabs);

    if (tab === 'balances') page.appendChild(tabBalances(g));
    else if (tab === 'settle') page.appendChild(tabSettleGroup(g));
    else if (tab === 'settings') page.appendChild(tabSettings(g));
    else if (tab === 'receipts') page.appendChild(tabReceipts(g));
    else page.appendChild(tabExpenses(g));   // 'expenses' + any unknown tab → Expenses

    setMain(page);
  }
  // Receipts gallery for a group. The receipt URL lives on each expense (image
  // in Firebase Storage), so we source straight from the group's expenses —
  // works cross-device (synced expenses carry the URL) and for local/offline
  // groups (base64 on the expense). Newest-first, with date + time.
  function tabReceipts(g) {
    const wrap = h('div');
    const head = h('div', { class: 'row', style: { justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '4px' } }, [
      h('h3', { style: { margin: '0' } }, 'Receipts')
    ]);
    const grid = h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '12px', marginTop: '12px' } });
    wrap.appendChild(head);
    wrap.appendChild(grid);

    function whenStr(it) {
      if (it.at) { try { return 'Added ' + new Date(it.at).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }); } catch (_) {} }
      if (it.date) { try { return new Date(it.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }); } catch (_) {} }
      return '';
    }
    function receiptCard(it) {
      return h('div', { class: 'card clickable', style: { padding: '0', overflow: 'hidden' }, onClick: () => openReceiptViewer(it.dataUrl) }, [
        h('img', { src: it.dataUrl, alt: 'Receipt', loading: 'lazy', style: { width: '100%', height: '130px', objectFit: 'cover', display: 'block', background: 'var(--line)' } }),
        h('div', { style: { padding: '10px 12px' } }, [
          h('div', { style: { fontWeight: '600', fontSize: '13px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, it.title || 'Receipt'),
          it.amount != null ? h('div', { class: 'num', style: { fontSize: '13px', marginTop: '2px' } }, fmtMoney(it.amount, it.currency || g.currency)) : null,
          h('div', { class: 'small muted', style: { marginTop: '4px' } }, it.when || '')
        ])
      ]);
    }
    function paint(map) {
      grid.innerHTML = '';
      const items = Array.from(map.values()).sort((a, b) => (b.sortTs || 0) - (a.sortTs || 0));
      if (!items.length) {
        grid.style.display = 'block';
        grid.appendChild(h('div', { class: 'card', style: { textAlign: 'center', padding: '40px 20px' } }, [
          h('div', { style: { fontSize: '15px', fontWeight: '600', marginBottom: '4px' } }, 'No receipts here yet'),
          h('div', { class: 'small muted' }, 'Snap a receipt when you add an expense — they collect here for the whole group.')
        ]));
        return;
      }
      grid.style.display = 'grid';
      items.forEach((it) => grid.appendChild(receiptCard(it)));
    }

    const map = new Map();
    State.expenses.filter((e) => e.groupId === g.id && e.receipt).forEach((e) => {
      const it = { expenseId: e.id, dataUrl: e.receipt, title: e.title, amount: e.amount, currency: e.currency, date: e.date, at: e.updatedAt || null };
      it.sortTs = it.at || (e.date ? Date.parse(e.date) : 0);
      it.when = whenStr(it);
      map.set(e.id, it);
    });
    paint(map);

    return wrap;
  }

  function tabExpenses(g) {
    const wrap = h('div');
    const sortState = State.sort.groupExpenses;
    const rows = sortRows(State.expenses.filter((e) => e.groupId === g.id), sortState, {
      date: (e) => e.date, title: (e) => e.title, category: (e) => e.category,
      amount: (e) => e.amount, paidBy: (e) => payerLabel(e),
      myShare: (e) => (e.splits.find((s) => s.userId === State.selfId) || {}).amount || 0
    });
    const card = h('div', { class: 'card' });
    const tblw = h('div', { class: 'tbl-wrap' });
    const tbl = h('table', { class: 'tbl tbl-expense' });
    tbl.appendChild(buildThead([
      { key: 'date', label: 'Date' },
      { key: 'title', label: 'Description' },
      { key: 'category', label: 'Category' },
      { key: 'paidBy', label: 'Paid by' },
      { key: 'amount', label: 'Total', align: 'right' },
      { key: 'myShare', label: 'Your share', align: 'right' },
      { key: '_a', label: '' }
    ], sortState, (col) => { State.sort.groupExpenses = toggleSort(sortState, col); render(); }));
    const tbody = h('tbody');
    if (rows.length === 0) {
      tbody.appendChild(h('tr', {}, h('td', { colspan: 7, class: 'tbl-empty' }, 'No expenses yet. Add one with the button above.')));
    } else {
      rows.forEach((e) => {
        const myShare = (e.splits.find((s) => s.userId === State.selfId) || {}).amount || 0;
        const tr = h('tr', { class: 'clickable', onClick: () => openExpenseModal({ existing: e }) });
        tr.appendChild(h('td', { class: 'col-date', data: { label: 'Date' } }, fmtDateShort(e.date)));
        tr.appendChild(h('td', { class: 'mcol-title' }, h('div', { class: 'desc-cell' }, [
          h('span', { class: 'dot', style: { background: categoryColor(e.category) } }),
          h('div', {}, [
            h('div', { class: 'title' }, [e.title, e.receipt ? h('span', { title: 'Has a receipt', style: { marginLeft: '6px', opacity: '0.5', fontSize: '12px' } }, '📎') : null]),
            e.note ? h('div', { class: 'note' }, e.note) : null
          ])
        ])));
        tr.appendChild(h('td', { data: { label: 'Category' } }, h('span', { class: 'cat cat-' + e.category }, categoryLabel(e.category))));
        tr.appendChild(h('td', { data: { label: 'Paid by' } }, h('span', { class: 'who' }, [avatar(firstPayerId(e), 'sm'), payerLabel(e)])));
        tr.appendChild(h('td', { class: 'col-amt', data: { label: 'Amount' } }, fmtMoney(e.amount, e.currency)));
        tr.appendChild(h('td', { class: 'col-amt ' + ((paidByUser(e, State.selfId) - myShare) >= 0 ? 'pos' : 'neg'), data: { label: 'Your share' } }, fmtMoney(myShare, e.currency)));
        tr.appendChild(h('td', { class: 'col-actions mcol-actions' }, [
          h('button', { title: 'Edit', onClick: (ev) => { ev.stopPropagation(); openExpenseModal({ existing: e }); } }, '✎'),
          h('button', { title: 'Delete', onClick: (ev) => { ev.stopPropagation(); confirmDeleteExpense(e); } }, '✕')
        ]));
        tbody.appendChild(tr);
      });
    }
    tbl.appendChild(tbody);
    tblw.appendChild(tbl);
    card.appendChild(tblw);
    wrap.appendChild(card);
    return wrap;
  }
  function tabBalances(g) {
    const mat = computeGroupMatrix(g.id);
    const wrap = h('div', { class: 'grid-2' });
    // Matrix
    const card1 = h('div', { class: 'card' }, h('div', { class: 'card-header' }, h('h3', {}, 'Net per member')));
    const tbl = h('table', { class: 'tbl matrix' });
    const thead = h('thead'); const tr = h('tr'); tr.appendChild(h('th', {}, 'Member')); tr.appendChild(h('th', {}, 'Paid')); tr.appendChild(h('th', {}, 'Share')); tr.appendChild(h('th', {}, 'Net'));
    thead.appendChild(tr); tbl.appendChild(thead);
    const tbody = h('tbody');
    const exps = State.expenses.filter((e) => e.groupId === g.id);
    mat.members.forEach((m) => {
      let paid = 0, share = 0;
      exps.forEach((e) => { paid += paidByUser(e, m); const sp = e.splits.find((s) => s.userId === m); if (sp) share += sp.amount; });
      State.settlements.filter((s) => s.groupId === g.id).forEach((s) => { if (s.fromUser === m) paid += s.amount; if (s.toUser === m) share += s.amount; });
      const net = mat.net[m];
      const tr2 = h('tr');
      tr2.appendChild(h('td', {}, h('span', { class: 'who' }, [avatar(m, 'sm'), userName(m)])));
      tr2.appendChild(h('td', {}, fmtMoney(paid, g.currency)));
      tr2.appendChild(h('td', {}, fmtMoney(share, g.currency)));
      tr2.appendChild(h('td', { class: net > 0 ? 'pos' : net < 0 ? 'neg' : 'zero' }, net === 0 ? '—' : fmtMoney(net, g.currency, true)));
      tbody.appendChild(tr2);
    });
    tbl.appendChild(tbody);
    const wrap1 = h('div', { class: 'card-body', style: { padding: 0, overflowX: 'auto' } }, tbl);
    card1.appendChild(wrap1);
    wrap.appendChild(card1);

    // Simplified
    const card2 = h('div', { class: 'card' }, h('div', { class: 'card-header' }, [h('h3', {}, 'Simplified debts'), h('span', { class: 'sub' }, 'Optimised transfers')]));
    const txs = simplifyDebts(mat.net, g.currency);
    const body2 = h('div', { class: 'panel-stack' });
    if (txs.length === 0) body2.appendChild(h('div', { class: 'empty' }, h('div', { class: 'empty-title' }, 'Group is settled')));
    txs.forEach((t) => {
      const row = h('div', { class: 'owes-row' }, [
        avatar(t.from, 'md'),
        h('div', {}, [
          h('div', { class: 'who-name' }, userName(t.from) + ' → ' + userName(t.to)),
          h('div', { class: 'who-sub' }, (State.users.find((x) => x.id === t.to)?.upi || ''))
        ]),
        h('div', { class: 'amt' }, fmtMoney(t.amount, t.currency)),
        h('div', { class: 'actions' }, t.from === State.selfId ? [
          h('button', { class: 'btn-pay', onClick: () => payViaUPI(State.users.find((x) => x.id === t.to), t.amount) }, 'Pay'),
          h('button', { class: 'btn-wa', title: 'Message on WhatsApp', onClick: () => remindViaWhatsApp(State.users.find((x) => x.id === t.to), t.amount, 'you-owe') }, waIcon()),
          h('button', { class: 'btn-mark', onClick: () => recordSettlement(g.id, t.from, t.to, t.amount, t.currency) }, 'Mark')
        ] : [
          h('button', { class: 'btn-mark', onClick: () => recordSettlement(g.id, t.from, t.to, t.amount, t.currency) }, 'Mark')
        ])
      ]);
      body2.appendChild(row);
    });
    card2.appendChild(body2);
    wrap.appendChild(card2);
    return wrap;
  }
  // A shared group that both you and `otherId` belong to (for routing a reminder
  // to their phone). Null if you only share device-local groups.
  function sharedGroupWith(otherId) {
    const g = State.groups.find((x) => isSharedGroup(x) && Array.isArray(x.members) && x.members.includes(otherId) && x.members.includes(State.selfId));
    return g ? g.id : null;
  }
  async function sendReminder(otherUserId, amount, currency, groupId) {
    const otherU = State.users.find((u) => u.id === otherUserId);
    if (!otherU || otherU.isSelf) return;
    const cache = State.reminderCache || {};
    cache['reminder_' + otherUserId] = new Date().toISOString();
    State.reminderCache = cache;
    await OrbitDB.setMeta('reminders', cache);
    if (window.OrbitActivity) await OrbitActivity.log(OrbitDB, {
      ...actorStamp(), action: 'reminder', entityType: 'settlement',
      entityId: null, groupId: groupId || null,
      snapshot: { title: 'Reminded ' + otherU.name + ' to settle ' + fmtMoney(amount, currency), amount, currency },
      meta: { type: 'reminder', toUser: otherUserId, amount, currency }
    });
    // For a SHARED group, push the reminder to the shared feed so it actually
    // lands on the other person's phone (a toast + an activity row there).
    const g = groupId ? groupById(groupId) : null;
    if (g && isSharedGroup(g) && canShare() && OrbitGroups.addActivity) {
      const target = otherU.firebaseUid || (String(otherU.id).indexOf('u_') !== 0 ? otherU.id : null);
      try {
        await OrbitGroups.addActivity(sharedIdOf(g), {
          type: 'reminder', action: 'reminder', entityType: 'settlement',
          actorUid: myUid() || null, actorName: selfDisplayName(), targetUid: target,
          snapshot: { title: 'Reminder to settle ' + fmtMoney(amount, currency), amount, currency }
        });
      } catch (_) {}
    }
    toast('Reminded ' + otherU.name + ' · ' + fmtMoney(amount, currency), 'pos');
    render();
  }

  // Re-entrancy guard: a fast double-tap (or two people marking the same row)
  // must NOT record two settlements — that would over-settle into a phantom
  // reverse debt. Keyed by from:to:currency for the brief window of the write.
  const _settleLock = new Set();

  async function persistSettlement(s) {
    // Settlement + its activity entry committed atomically.
    const ops = [{ store: 'settlements', op: 'put', value: s }];
    let actEntry = null;
    if (window.OrbitActivity) {
      actEntry = OrbitActivity.build({
        ...actorStamp(), action: 'settle', entityType: 'settlement',
        entityId: s.id, groupId: s.groupId, snapshot: s
      });
      ops.push({ store: 'activity', op: 'put', value: actEntry });
    }
    await OrbitDB.writeTx(ops);
    State.settlements.push(s);
    if (actEntry) State.activity = (State.activity || []).concat(actEntry);
    syncSettlementIfShared(s);   // mirror to Firestore when the group is shared
    mirrorSharedActivity(s.groupId, 'settle', { title: 'Settled up', amount: s.amount, currency: s.currency }, s.id);
    maybePurgeSettledGroupReceipts(s.groupId);   // offer to tidy up receipts once square
  }

  // Once a group has NO outstanding debts, OFFER to drop its receipt images —
  // they've served their purpose and this keeps Storage (and cost) lean. The
  // deletion is irreversible, so it's gated behind an explicit confirm rather
  // than done silently.
  function maybePurgeSettledGroupReceipts(groupId) {
    if (!groupId) return;
    const g = groupById(groupId);
    if (!g) return;
    let settled = false;
    try { settled = simplifyDebts(computeGroupMatrix(groupId).net, g.currency).length === 0; }
    catch (_) { return; }
    if (!settled) return;
    const withReceipt = State.expenses.filter((e) => e.groupId === groupId && e.receipt);
    if (!withReceipt.length) return;
    const n = withReceipt.length;
    // Defer: the settlement is usually confirmed FROM a modal whose own
    // closeModal() runs right after this — opening the confirm now would get
    // clobbered. A macrotask lets that modal close first, then we open ours.
    setTimeout(() => openConfirmModal({
      title: 'Group settled — clear receipts?',
      bodyHtml: `Everyone in <strong>${escapeHtml(g.name)}</strong> is squared up. Remove its ${n} receipt${n !== 1 ? 's' : ''} to free up space? <span class="muted">This can’t be undone.</span>`,
      confirmText: 'Remove receipts', danger: true,
      onConfirm: async () => {
        const sid = sharedIdOf(g);
        for (const e of withReceipt) {
          if (sid && canShare() && OrbitGroups.deleteReceiptFile) {
            try { await OrbitGroups.deleteReceiptFile(sid, e.id); } catch (_) {}
          }
          const cleared = { ...e }; delete cleared.receipt; cleared.hasReceipt = false;
          try { await OrbitDB.put('expenses', cleared); } catch (_) {}
          State.expenses = State.expenses.map((x) => x.id === e.id ? cleared : x);
          syncExpenseIfShared(cleared);
        }
        toast(n + ' receipt' + (n !== 1 ? 's' : '') + ' cleared', 'pos');
        render();
      }
    }), 80);
  }

  // Per-group settle (the row already knows its real groupId).
  async function recordSettlement(groupId, fromUser, toUser, amount, currency) {
    const lk = fromUser + ':' + toUser + ':' + (currency || 'INR') + ':' + groupId;
    if (_settleLock.has(lk)) return;
    _settleLock.add(lk);
    try {
      await persistSettlement({
        id: uid('s'), groupId, fromUser, toUser, amount,
        currency: currency || 'INR', method: 'manual', date: todayISO(), note: 'Marked settled'
      });
      toast('Settlement recorded', 'pos');
      render();
    } finally { setTimeout(() => _settleLock.delete(lk), 400); }
  }

  // Global "Smart settle" produces a simplified from→to amount with NO group.
  // Decompose it into the per-group debts it actually pays off so each group's
  // ledger reconciles (otherwise the global view clears while the group view
  // still shows the debt). Any leftover that maps to no shared group is kept as
  // a single un-grouped record.
  function allocateSettlement(fromUser, toUser, amount, currency) {
    const cur = currency || 'INR';
    const records = [];
    let remaining = Math.round(amount * 100) / 100;
    const candidates = State.groups
      .filter((g) => Array.isArray(g.members) && g.members.includes(fromUser) && g.members.includes(toUser))
      .map((g) => {
        const pb = computePairBalances(fromUser, g.id, cur);     // from's perspective
        const owes = Math.round((-(pb[toUser] || 0)) * 100) / 100; // >0 ⇒ from owes to here
        return { id: g.id, owes };
      })
      .filter((x) => x.owes > 0.005)
      .sort((a, b) => b.owes - a.owes);
    for (const c of candidates) {
      if (remaining <= 0.005) break;
      const a = Math.min(c.owes, remaining);
      const amt = Math.round(a * 100) / 100;
      records.push({ id: uid('s'), groupId: c.id, fromUser, toUser, amount: amt, currency: cur, method: 'manual', date: todayISO(), note: 'Marked settled' });
      remaining = Math.round((remaining - amt) * 100) / 100;
    }
    if (remaining > 0.005) {
      records.push({ id: uid('s'), groupId: '', fromUser, toUser, amount: remaining, currency: cur, method: 'manual', date: todayISO(), note: 'Marked settled' });
    }
    return records;
  }

  async function recordSettlementSmart(fromUser, toUser, amount, currency) {
    const cur = currency || 'INR';
    const lk = fromUser + ':' + toUser + ':' + cur + ':*';
    if (_settleLock.has(lk)) return;
    _settleLock.add(lk);
    try {
      const records = allocateSettlement(fromUser, toUser, amount, cur);
      for (const s of records) await persistSettlement(s);
      toast('Settlement recorded', 'pos');
      render();
    } finally { setTimeout(() => _settleLock.delete(lk), 400); }
  }

  // Mirror a settlement to its group's Firestore copy when the group is shared.
  async function syncSettlementIfShared(s) {
    if (!s.groupId) return;
    const g = groupById(s.groupId);
    const sid = sharedIdOf(g);
    if (!sid || !canShare() || !OrbitGroups.addSettlement) return;
    try { await OrbitGroups.addSettlement(sid, toSharedSettlement(s)); }
    catch (e) { console.warn('[Phase D] shared settlement write failed', e); }
  }
  function tabSettleGroup(g) {
    const mat = computeGroupMatrix(g.id);
    const txs = simplifyDebts(mat.net, g.currency);
    const card = h('div', { class: 'card' });
    card.appendChild(h('div', { class: 'card-header' }, [h('h3', {}, 'Pairwise settlements'), h('span', { class: 'sub' }, txs.length + ' transactions to settle')]));
    const body = h('div', { class: 'panel-stack' });
    if (txs.length === 0) body.appendChild(h('div', { class: 'empty' }, [h('div', { class: 'empty-title' }, 'All clear'), h('div', { class: 'empty-sub' }, 'No debts to settle in this group.')]));
    txs.forEach((t) => {
      const toU = State.users.find((x) => x.id === t.to);
      body.appendChild(h('div', { class: 'owes-row' }, [
        avatar(t.from, 'md'),
        h('div', {}, [
          h('div', { class: 'who-name' }, userName(t.from) + ' owes ' + userName(t.to)),
          h('div', { class: 'who-sub' }, toU?.upi || '')
        ]),
        h('div', { class: 'amt neg' }, fmtMoney(t.amount, t.currency)),
        h('div', { class: 'actions' }, [
          t.from === State.selfId && toU?.upi ? h('button', { class: 'btn-pay', onClick: () => payViaUPI(toU, t.amount) }, 'Pay via UPI') : null,
          t.from !== State.selfId ? h('button', { class: 'btn-mark', title: 'Send a reminder to settle', onClick: () => sendReminder(t.from, t.amount, t.currency, g.id) }, 'Remind') : null,
          toU ? h('button', { class: 'btn-wa', title: 'Message on WhatsApp', onClick: () => remindViaWhatsApp(t.from === State.selfId ? toU : State.users.find((x) => x.id === t.from), t.amount, t.from === State.selfId ? 'you-owe' : 'owes-you') }, waIcon()) : null,
          h('button', { class: 'btn-mark', onClick: () => recordSettlement(g.id, t.from, t.to, t.amount, t.currency) }, 'Mark paid')
        ])
      ]));
    });
    card.appendChild(body);
    return card;
  }
  // Remove a member from a group — always behind a confirmation so nobody is
  // dropped by an accidental tap on the "×". For a SHARED group the
  // authoritative change happens server-side (owner-only Cloud Function), which
  // also writes the "X was removed" activity entry every member's feed picks up.
  // For a device-local group we edit locally and log it ourselves.
  function removeMemberFromGroup(g, mid) {
    const u = State.users.find((x) => x.id === mid);
    const name = u ? u.name : 'this member';
    // Surface an unsettled balance so the owner doesn't silently orphan a debt:
    // removing a member keeps their expenses, so a non-zero balance would linger
    // attributed to someone no longer in the roster.
    const mat = computeGroupMatrix(g.id);
    const bal = mat ? Math.round((mat.net[mid] || 0) * 100) / 100 : 0;
    let warn = '';
    if (Math.abs(bal) > 0.01) {
      const amt = fmtMoney(Math.abs(bal), g.currency);
      const dir = bal < 0 ? 'owes the group' : 'is owed by the group';
      warn = `<div style="background:rgba(229,72,77,0.08);border:1px solid rgba(229,72,77,0.32);color:#C0383C;padding:9px 11px;border-radius:9px;margin-bottom:12px;font-size:13px;line-height:1.4"><strong>Heads up:</strong> ${escapeHtml(name)} still ${dir} <strong>${escapeHtml(amt)}</strong>. Removing them leaves that balance unsettled — settle up first if you can.</div>`;
    }
    openConfirmModal({
      title: 'Remove ' + name + '?',
      bodyHtml: warn + `<strong>${escapeHtml(name)}</strong> will be removed from <strong>${escapeHtml(g.name)}</strong>. Their past expenses stay, but they lose access to the group. You can add them back later.`,
      confirmText: 'Remove',
      danger: true,
      onConfirm: () => doRemoveMember(g, mid, name)
    });
  }
  async function doRemoveMember(g, mid, name) {
    // Remove from the LOCAL roster FIRST so the chip disappears immediately and
    // normalizeSharedGroup() won't re-add it as a "local-only" member. This is
    // the fix for "Removed X" toasting but the member staying — without it, a
    // ghost / name-only member is removed from the cloud yet re-derived from the
    // local roster on the next realtime snapshot, so it never actually leaves.
    const removeLocal = () => {
      g.members = g.members.filter((x) => x !== mid);
      g.memberCount = g.members.length;
      State.groups = State.groups.map((x) => x.id === g.id ? g : x);
    };
    const restoreLocal = () => {
      if (!g.members.includes(mid)) g.members.push(mid);
      g.memberCount = g.members.length;
      State.groups = State.groups.map((x) => x.id === g.id ? g : x);
    };

    removeLocal();
    await OrbitDB.put('groups', g);
    render();

    // Mirror to the cloud for shared groups so every member sees the removal.
    if (isSharedGroup(g)) {
      if (!window.OrbitGroups || !OrbitGroups.isReady()) {
        restoreLocal(); await OrbitDB.put('groups', g); render();
        toast('Sign in to manage this shared group', 'neg');
        return;
      }
      try {
        await OrbitGroups.removeMember(sharedIdOf(g), mid);
      } catch (e) {
        console.warn('[group] removeMember (cloud) failed', e);
        restoreLocal(); await OrbitDB.put('groups', g); render();
        toast('Couldn’t remove ' + name + ': ' + (e.message || e.code || 'error'), 'neg');
        return;
      }
    }

    // For a SHARED group the server writes the authoritative "X was removed"
    // event (picked up by every member's feed + the realtime toast), so don't
    // also log a local row / toast — that's the duplicate the owner was seeing.
    if (!isSharedGroup(g)) {
      if (window.OrbitActivity) await OrbitActivity.log(OrbitDB, {
        ...actorStamp(), action: 'remove', entityType: 'member',
        entityId: mid, groupId: g.id, snapshot: { title: 'Removed ' + name }
      });
      toast('Removed ' + name, 'pos');
    }
  }
  function tabSettings(g) {
    const card = h('div', { class: 'card' });
    card.appendChild(h('div', { class: 'card-header' }, h('h3', {}, 'Group settings')));
    const body = h('div', { class: 'card-body' });
    const canEditMeta = !isSharedGroup(g) || isGroupOwner(g);   // only the owner re-configures a shared group
    if (!canEditMeta) {
      // Read-only view for members of a shared group.
      body.appendChild(formRow('Name', h('div', { class: 'small', style: { fontWeight: 600 } }, g.name)));
      body.appendChild(formRow('Currency', h('div', { class: 'small' }, g.currency)));
      body.appendChild(h('div', { class: 'small muted', style: { marginTop: '6px' } }, 'Only the group owner can rename or re-configure this group.'));
    } else {
      body.appendChild(formRow('Name', h('input', { class: 'input', value: g.name, onChange: async (e) => { g.name = e.target.value.trim() || g.name; await OrbitDB.put('groups', g); if (isSharedGroup(g)) { try { await OrbitGroups.renameGroup(sharedIdOf(g), g.name); } catch (_) {} } toast('Saved'); renderSidebarGroups(); } })));
      body.appendChild(formRow('Type', selectInput([
        { v: 'trip', l: 'Trip' }, { v: 'household', l: 'Household' }, { v: 'friends', l: 'Friends' }, { v: 'work', l: 'Work' }
      ], g.category, async (v) => { g.category = v; await OrbitDB.put('groups', g); toast('Saved'); })));
      body.appendChild(formRow('Currency', selectInput([
        { v: 'INR', l: '₹ INR' }, { v: 'EUR', l: '€ EUR' }, { v: 'USD', l: '$ USD' }, { v: 'GBP', l: '£ GBP' }
      ], g.currency, async (v) => { g.currency = v; await OrbitDB.put('groups', g); toast('Saved'); render(); })));
    }
    body.appendChild(h('hr'));
    // Unarchive control (only shown for an archived group, reachable via direct
    // link) so the "you can unarchive from Settings" promise is real.
    if (g.archived) {
      body.appendChild(h('div', { class: 'btn-row', style: { marginBottom: 'var(--s-3)' } }, [
        h('button', { class: 'btn btn-sm', onClick: async () => {
          delete g.archived;
          await OrbitDB.put('groups', g);
          State.groups = State.groups.map((x) => x.id === g.id ? g : x);
          renderSidebarGroups(); toast('Unarchived “' + g.name + '”', 'pos'); render();
        } }, 'Unarchive group')
      ]));
    }
    // Owner model: the creator owns the group and can delete it; a member who
    // joined can only LEAVE (the group stays for everyone else).
    const danger = (isSharedGroup(g) && !isGroupOwner(g))
      ? h('button', { class: 'btn btn-danger btn-sm', onClick: () => leaveGroupConfirm(g) }, 'Leave group')
      : h('button', { class: 'btn btn-danger btn-sm', onClick: () => deleteGroup(g) }, 'Delete group');
    body.appendChild(h('div', { class: 'btn-row' }, [danger]));
    card.appendChild(body);
    return card;
  }
  function formRow(label, control) {
    // Associate the <label> with its control for screen readers: give the
    // control an id (if it doesn't have one) and point the label's `for` at it.
    if (control && control.setAttribute) {
      if (!control.id) control.id = 'fld-' + Math.random().toString(36).slice(2, 8);
      return h('div', { class: 'form-row' }, [h('label', { for: control.id }, label), control]);
    }
    return h('div', { class: 'form-row' }, [h('label', {}, label), control]);
  }
  function selectInput(opts, current, onChange) {
    const sel = h('select', { class: 'select', onChange: (e) => onChange(e.target.value) });
    opts.forEach((o) => {
      const op = h('option', { value: o.v }, o.l);
      if (o.v === current) op.selected = true;
      sel.appendChild(op);
    });
    return sel;
  }
  // A joined member leaving a shared group. The creator can't leave (the
  // server enforces this too) — they delete the group instead. The group and
  // its expenses stay for everyone else; the leaver can rejoin via an invite.
  async function leaveGroupConfirm(g) {
    openConfirmModal({
      title: 'Leave group?',
      bodyHtml: `You'll be removed from <strong>${escapeHtml(g.name)}</strong>. The group stays for everyone else, and you can rejoin later from an invite.`,
      confirmText: 'Leave group',
      danger: true,
      onConfirm: async () => {
        if (!window.OrbitGroups || !OrbitGroups.isReady()) { toast('Sign in to leave this shared group', 'neg'); return; }
        try {
          await OrbitGroups.leaveGroup(sharedIdOf(g));
          State.groups = State.groups.filter((x) => x.id !== g.id);
          try { await OrbitDB.delete('groups', g.id); } catch (_) {}
          renderSidebarGroups();
          toast('You left “' + g.name + '”', 'pos');
          navigate('#/groups');
        } catch (e) {
          toast('Couldn’t leave: ' + (e.message || e.code || 'error'), 'neg');
          console.warn('[group] leaveGroup failed', e);
        }
      }
    });
  }
  async function deleteGroup(g) {
    const shared = isSharedGroup(g);
    openConfirmModal({
      title: 'Delete group?',
      bodyHtml: shared
        ? `<strong>${escapeHtml(g.name)}</strong> will be deleted for <strong>everyone</strong> in the group, along with its expenses. This cannot be undone.`
        : `<strong>${escapeHtml(g.name)}</strong> and all its expenses will be permanently removed. This cannot be undone.`,
      confirmText: 'Delete forever',
      danger: true,
      onConfirm: async () => {
        // Shared group: delete the cloud doc first (owner-only, enforced by
        // rules) so it disappears for every member — not just locally.
        if (shared) {
          const sid = sharedIdOf(g);
          try { if (sid && window.OrbitGroups && OrbitGroups.deleteGroup) await OrbitGroups.deleteGroup(sid); }
          catch (e) { console.warn('[group] cloud delete failed', e); toast('Couldn’t delete in the cloud: ' + (e.message || e.code || 'error'), 'neg'); return; }
        }
        const expIds = State.expenses.filter((e) => e.groupId === g.id).map((e) => e.id);
        await OrbitDB.deleteMany('expenses', expIds);
        const setIds = State.settlements.filter((s) => s.groupId === g.id).map((s) => s.id);
        await OrbitDB.deleteMany('settlements', setIds);
        await OrbitDB.delete('groups', g.id);
        State.expenses = State.expenses.filter((e) => e.groupId !== g.id);
        State.settlements = State.settlements.filter((s) => s.groupId !== g.id);
        State.groups = State.groups.filter((x) => x.id !== g.id);
        renderSidebarGroups();
        toast('Group deleted', 'pos');
        navigate('#/groups');
      }
    });
  }
  function notFound(msg) {
    return h('div', { class: 'page' }, h('div', { class: 'empty' }, [
      h('div', { class: 'empty-title' }, msg),
      h('a', { class: 'btn btn-sm', href: '#/dashboard' }, 'Back to dashboard')
    ]));
  }

  // -------- EXPENSES (all) --------
  function viewExpenses() {
    const page = h('div', { class: 'page' });
    page.appendChild(h('header', { class: 'page-header' }, [
      h('div', { class: 'title-block' }, [h('h1', {}, 'All expenses'), h('div', { class: 'sub' }, 'Across every group')]),
      h('div', { class: 'actions' }, [
        h('button', { class: 'btn btn-ghost btn-sm', onClick: exportCsv }, [svgIcon('download'), 'Export CSV']),
        h('button', { class: 'btn btn-primary btn-sm', onClick: () => openExpenseModal() }, '+ Add expense')
      ])
    ]));

    // Filter toolbar — collapsible on mobile behind a "Filters" toggle.
    const f = State.filters.expenses;
    const toolbar = h('div', { class: 'card filter-card', style: { marginBottom: 'var(--s-3)' } });
    const fCount = ['q', 'groupId', 'category', 'from', 'to', 'paidBy'].filter((k) => f[k]).length;
    const filterToggle = h('button', { class: 'filter-toggle', type: 'button', 'aria-label': 'Toggle filters' }, [
      h('span', {}, 'Filters'),
      fCount ? h('span', { class: 'filter-count' }, String(fCount)) : null,
      h('span', { class: 'spacer' }),
      h('span', { class: 'filter-chev', 'aria-hidden': 'true' }, '▾')
    ]);
    filterToggle.addEventListener('click', () => toolbar.classList.toggle('open'));
    toolbar.appendChild(filterToggle);
    const tb = h('div', { class: 'toolbar filter-body', style: { borderBottom: 0 } });
    const qInp = h('input', { type: 'search', class: 'filter-input', value: f.q, placeholder: 'Search…', style: { width: '220px' } });
    qInp.addEventListener('input', (e) => { f.q = e.target.value; rerender(); });
    tb.appendChild(qInp);
    const gSel = h('select', { class: 'filter-input', onChange: (e) => { f.groupId = e.target.value; rerender(); } });
    gSel.appendChild(h('option', { value: '' }, 'All groups'));
    State.groups.forEach((g) => { const op = h('option', { value: g.id }, g.name); if (g.id === f.groupId) op.selected = true; gSel.appendChild(op); });
    tb.appendChild(gSel);
    const cSel = h('select', { class: 'filter-input', onChange: (e) => { f.category = e.target.value; rerender(); } });
    cSel.appendChild(h('option', { value: '' }, 'All categories'));
    CATEGORIES.forEach((c) => { const op = h('option', { value: c.id }, c.label); if (c.id === f.category) op.selected = true; cSel.appendChild(op); });
    tb.appendChild(cSel);
    const pSel = h('select', { class: 'filter-input', onChange: (e) => { f.paidBy = e.target.value; rerender(); } });
    pSel.appendChild(h('option', { value: '' }, 'Anyone paid'));
    State.users.forEach((u) => { const op = h('option', { value: u.id }, u.name); if (u.id === f.paidBy) op.selected = true; pSel.appendChild(op); });
    tb.appendChild(pSel);
    tb.appendChild(h('label', { class: 'filter-date' }, ['From', h('input', { type: 'date', class: 'filter-input', value: f.from, onChange: (e) => { f.from = e.target.value; rerender(); } })]));
    tb.appendChild(h('label', { class: 'filter-date' }, ['To', h('input', { type: 'date', class: 'filter-input', value: f.to, onChange: (e) => { f.to = e.target.value; rerender(); } })]));
    tb.appendChild(h('span', { class: 'spacer' }));
    tb.appendChild(h('button', { class: 'btn btn-ghost btn-sm', onClick: () => { State.filters.expenses = { q:'', groupId:'', category:'', from:'', to:'', paidBy:'' }; render(); } }, 'Clear filters'));
    toolbar.appendChild(tb);
    page.appendChild(toolbar);

    // Bulk bar (when selected)
    const bulkHolder = h('div');
    page.appendChild(bulkHolder);

    // Table
    const tableCard = h('div', { class: 'card' });
    const tblWrap = h('div', { class: 'tbl-wrap' });
    tableCard.appendChild(tblWrap);
    page.appendChild(tableCard);

    function rerender() {
      bulkHolder.innerHTML = '';
      tblWrap.innerHTML = '';
      const filtered = filterExpenses(State.expenses, State.filters.expenses);
      const sortState = State.sort.expenses;
      const rows = sortRows(filtered, sortState, {
        date: (e) => e.date, group: (e) => groupById(e.groupId)?.name || '',
        title: (e) => e.title, category: (e) => e.category,
        amount: (e) => e.amount, paidBy: (e) => payerLabel(e),
        myShare: (e) => (e.splits.find((s) => s.userId === State.selfId) || {}).amount || 0
      });

      if (State.selected.expenses.size > 0) {
        const bar = h('div', { class: 'bulk-bar' });
        bar.appendChild(h('span', {}, State.selected.expenses.size + ' selected'));
        bar.appendChild(h('span', { class: 'spacer' }));
        bar.appendChild(h('button', { class: 'btn btn-ghost btn-sm', onClick: () => { State.selected.expenses.clear(); rerender(); } }, 'Clear'));
        bar.appendChild(h('button', { class: 'btn btn-danger btn-sm', onClick: () => bulkDelete() }, 'Delete selected'));
        bulkHolder.appendChild(bar);
      }

      const tbl = h('table', { class: 'tbl tbl-expense' });
      const cbAll = h('input', { type: 'checkbox', onChange: (e) => {
        if (e.target.checked) rows.forEach((r) => State.selected.expenses.add(r.id));
        else State.selected.expenses.clear();
        rerender();
      } });
      const thead = h('thead');
      const tr = h('tr');
      tr.appendChild(h('th', { style: { width: '32px' } }, cbAll));
      [
        { key: 'date', label: 'Date' },
        { key: 'group', label: 'Group' },
        { key: 'title', label: 'Description' },
        { key: 'category', label: 'Category' },
        { key: 'paidBy', label: 'Paid by' },
        { key: 'amount', label: 'Total', align: 'right' },
        { key: 'myShare', label: 'Your share', align: 'right' },
        { key: '_a', label: '' }
      ].forEach((c) => {
        const isSorted = sortState.col === c.key;
        const th = h('th', {
          class: (c.align === 'right' ? 'right ' : '') + 'sortable ' + (isSorted ? 'sorted' : ''),
          onClick: () => { State.sort.expenses = toggleSort(sortState, c.key); rerender(); }
        }, [c.label, h('span', { class: 'sort-arrow' }, isSorted ? (sortState.dir === 'asc' ? '↑' : '↓') : '↕')]);
        tr.appendChild(th);
      });
      thead.appendChild(tr); tbl.appendChild(thead);

      const tbody = h('tbody');
      if (rows.length === 0) {
        tbody.appendChild(h('tr', {}, h('td', { colspan: 9, class: 'tbl-empty' },
          State.expenses.length === 0 ? 'No expenses yet — tap “Add expense” to log your first.' : 'No expenses match your filters.')));
      }
      rows.forEach((e) => {
        const g = groupById(e.groupId);
        const myShare = (e.splits.find((s) => s.userId === State.selfId) || {}).amount || 0;
        const checked = State.selected.expenses.has(e.id);
        const tr2 = h('tr', { class: 'clickable' + (checked ? ' selected' : ''), onClick: (ev) => { if (ev.target.type !== 'checkbox') openExpenseModal({ existing: e }); } });
        tr2.appendChild(h('td', { class: 'mcol-hide' }, h('input', { type: 'checkbox', checked, onClick: (ev) => ev.stopPropagation(), onChange: (ev) => { if (ev.target.checked) State.selected.expenses.add(e.id); else State.selected.expenses.delete(e.id); rerender(); } })));
        tr2.appendChild(h('td', { class: 'col-date', data: { label: 'Date' } }, fmtDateShort(e.date)));
        tr2.appendChild(h('td', { data: { label: 'Group' } }, g?.name || '—'));
        tr2.appendChild(h('td', { class: 'mcol-title' }, h('div', { class: 'desc-cell' }, [
          h('span', { class: 'dot', style: { background: categoryColor(e.category) } }),
          h('div', {}, [h('div', { class: 'title' }, [e.title, e.receipt ? h('span', { title: 'Has a receipt', style: { marginLeft: '6px', opacity: '0.5', fontSize: '12px' } }, '📎') : null]), e.note ? h('div', { class: 'note' }, e.note) : null])
        ])));
        tr2.appendChild(h('td', { data: { label: 'Category' } }, h('span', { class: 'cat cat-' + e.category }, categoryLabel(e.category))));
        tr2.appendChild(h('td', { data: { label: 'Paid by' } }, h('span', { class: 'who' }, [avatar(firstPayerId(e), 'sm'), payerLabel(e)])));
        tr2.appendChild(h('td', { class: 'col-amt', data: { label: 'Amount' } }, fmtMoney(e.amount, e.currency)));
        tr2.appendChild(h('td', { class: 'col-amt ' + ((paidByUser(e, State.selfId) - myShare) >= 0 ? 'pos' : 'neg'), data: { label: 'Your share' } }, fmtMoney(myShare, e.currency)));
        tr2.appendChild(h('td', { class: 'col-actions mcol-actions' }, [
          h('button', { title: 'Edit', onClick: (ev) => { ev.stopPropagation(); openExpenseModal({ existing: e }); } }, '✎'),
          h('button', { title: 'Delete', onClick: (ev) => { ev.stopPropagation(); confirmDeleteExpense(e); } }, '✕')
        ]));
        tbody.appendChild(tr2);
      });
      tbl.appendChild(tbody);
      tblWrap.appendChild(tbl);
    }
    rerender();
    setMain(page);

    // Handle ?new=1
    if (State.route.query.new === '1') {
      setTimeout(() => openExpenseModal(), 50);
    }
  }
  async function bulkDelete() {
    const ids = Array.from(State.selected.expenses);
    openConfirmModal({
      title: 'Delete ' + ids.length + ' expenses?', bodyHtml: 'This cannot be undone.', confirmText: 'Delete all', danger: true,
      onConfirm: async () => {
        const removing = State.expenses.filter((e) => ids.includes(e.id));
        await OrbitDB.deleteMany('expenses', ids);
        for (const e of removing) { await syncDeleteExpenseIfShared(e); await mirrorSharedActivity(e.groupId, 'delete', { title: e.title, amount: e.amount, currency: e.currency }, e.id); }   // Phase D: mirror deletes + audit log
        State.expenses = State.expenses.filter((e) => !ids.includes(e.id));
        State.selected.expenses.clear();
        toast(ids.length + ' deleted', 'pos');
        render();
      }
    });
  }
  function confirmDeleteExpense(e) {
    openConfirmModal({
      title: 'Delete expense?', bodyHtml: `<strong>${escapeHtml(e.title)}</strong> · ${escapeHtml(fmtMoney(e.amount, e.currency))}`, confirmText: 'Delete', danger: true,
      onConfirm: async () => {
        // Delete the expense AND record the "delete" activity (with the prior
        // snapshot, so restore works) in ONE atomic transaction.
        const ops = [{ store: 'expenses', op: 'delete', value: e.id }];
        let actEntry = null;
        if (window.OrbitActivity) {
          actEntry = OrbitActivity.build({
            ...actorStamp(), action: 'delete', entityType: 'expense',
            entityId: e.id, groupId: e.groupId, snapshot: null, prev: e
          });
          ops.push({ store: 'activity', op: 'put', value: actEntry });
        }
        await OrbitDB.writeTx(ops);
        if (actEntry) State.activity = (State.activity || []).concat(actEntry);
        await syncDeleteExpenseIfShared(e);   // Phase D: mirror delete to Firestore
        await mirrorSharedActivity(e.groupId, 'delete', { title: e.title, amount: e.amount, currency: e.currency }, e.id);
        State.expenses = State.expenses.filter((x) => x.id !== e.id);
        toast('Expense deleted', 'pos');
        render();
      }
    });
  }
  // CSV cell: quote + escape, AND neutralize spreadsheet formula injection.
  // A cell starting with = + - @ (or tab/CR) is treated as a formula by Excel/
  // Sheets; since titles/names/notes are user- and co-member-controlled, prefix
  // a single quote so the value is rendered as inert text.
  function csvCell(v) {
    let s = String(v == null ? '' : v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return '"' + s.replace(/"/g, '""') + '"';
  }
  function exportCsv() {
    const filtered = filterExpenses(State.expenses, State.filters.expenses);
    const head = ['Date','Group','Description','Category','Currency','Total','Paid by','Your share','Note'];
    const lines = [head.join(',')];
    filtered.forEach((e) => {
      const g = groupById(e.groupId);
      const myShare = (e.splits.find((s) => s.userId === State.selfId) || {}).amount || 0;
      const row = [
        new Date(e.date).toISOString().slice(0,10),
        csvCell(g?.name || ''),
        csvCell(e.title),
        categoryLabel(e.category),
        e.currency,
        e.amount.toFixed(2),
        csvCell(payerLabel(e)),
        myShare.toFixed(2),
        csvCell(e.note || '')
      ];
      lines.push(row.join(','));
    });
    // Prepend UTF-8 BOM so Excel on Windows detects encoding correctly.
    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'orbit-expenses-' + new Date().toISOString().slice(0,10) + '.csv';
    a.click();
    URL.revokeObjectURL(url);
    toast(filtered.length + ' rows exported');
  }
  function svgIcon(name) {
    const map = {
      download: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>',
      plus: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>'
    };
    const sp = el('<span style="display:inline-flex;align-items:center;">' + (map[name] || '') + '</span>');
    return sp;
  }

  // -------- TRIPS --------
  function viewTrips() {
    const page = h('div', { class: 'page' });
    page.appendChild(h('header', { class: 'page-header' }, [
      h('div', { class: 'title-block' }, [h('h1', {}, 'Trips'), h('div', { class: 'sub' }, 'Multi-currency-aware trip groups')]),
      h('div', { class: 'actions' }, [h('button', { class: 'btn btn-primary btn-sm', onClick: openNewGroup }, '+ New trip')])
    ]));

    const trips = State.groups.filter((g) => g.category === 'trip');
    if (trips.length === 0) {
      page.appendChild(h('div', { class: 'empty' }, [h('div', { class: 'empty-title' }, 'No trips yet'), h('div', { class: 'empty-sub' }, 'Tag a group as "Trip" to track it here.')]));
      setMain(page); return;
    }

    // ---- Aggregate strip across all trips ----
    const tripIds = new Set(trips.map((t) => t.id));
    const tripExps = State.expenses.filter((e) => tripIds.has(e.groupId));
    const byCur = {};
    tripExps.forEach((e) => { byCur[e.currency] = (byCur[e.currency] || 0) + e.amount; });
    const myShareTotal = {};
    tripExps.forEach((e) => {
      const my = (e.splits.find((s) => s.userId === State.selfId) || {}).amount || 0;
      myShareTotal[e.currency] = (myShareTotal[e.currency] || 0) + my;
    });
    const summaryStrip = h('div', { class: 'trip-summary', style: { marginBottom: 'var(--s-5)' } });
    summaryStrip.appendChild(h('div', { class: 'stat' }, [
      h('div', { class: 'stat-label' }, 'Active trips'),
      h('div', { class: 'stat-value' }, String(trips.length))
    ]));
    summaryStrip.appendChild(h('div', { class: 'stat' }, [
      h('div', { class: 'stat-label' }, 'Total expenses'),
      h('div', { class: 'stat-value' }, String(tripExps.length))
    ]));
    Object.entries(byCur).forEach(([cur, v]) => {
      summaryStrip.appendChild(h('div', { class: 'stat' }, [
        h('div', { class: 'stat-label' }, 'Volume · ' + cur),
        h('div', { class: 'stat-value' }, fmtMoney(v, cur))
      ]));
    });
    Object.entries(myShareTotal).forEach(([cur, v]) => {
      summaryStrip.appendChild(h('div', { class: 'stat' }, [
        h('div', { class: 'stat-label' }, 'Your share · ' + cur),
        h('div', { class: 'stat-value' }, fmtMoney(v, cur))
      ]));
    });
    page.appendChild(summaryStrip);

    // ---- Per-trip rich cards ----
    trips
      .slice()
      .sort((a, b) => (lastActivityDate(b.id) || '').localeCompare(lastActivityDate(a.id) || ''))
      .forEach((g) => page.appendChild(buildTripCard(g)));

    setMain(page);
  }

  function buildTripCard(g) {
    const exps = State.expenses.filter((e) => e.groupId === g.id);
    const setts = State.settlements.filter((s) => s.groupId === g.id);
    const cur = g.currency;
    const total = exps.reduce((s, e) => s + e.amount, 0);
    const myShare = exps.reduce((s, e) => s + ((e.splits.find((x) => x.userId === State.selfId) || {}).amount || 0), 0);

    // Date range
    const dates = exps.map((e) => new Date(e.date)).sort((a, b) => a - b);
    const dStart = dates[0];
    const dEnd = dates[dates.length - 1];
    const dayKeys = new Set(exps.map((e) => new Date(e.date).toISOString().slice(0, 10)));
    const daysActive = dayKeys.size;
    const dailyAvg = daysActive > 0 ? total / daysActive : 0;

    // Category breakdown
    const catMap = {};
    exps.forEach((e) => { catMap[e.category] = (catMap[e.category] || 0) + e.amount; });
    const catSlices = Object.entries(catMap).map(([c, v]) => ({ label: categoryLabel(c), value: v, color: categoryColor(c) }));
    catSlices.sort((a, b) => b.value - a.value);

    // Daily spend
    const dayMap = {};
    exps.forEach((e) => {
      const k = new Date(e.date).toISOString().slice(0, 10);
      dayMap[k] = (dayMap[k] || 0) + e.amount;
    });
    const dailyData = Object.keys(dayMap).sort().map((k) => ({
      label: new Date(k).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      value: dayMap[k]
    }));

    // Top spenders (who paid most)
    const paidByMap = {};
    exps.forEach((e) => { expensePayers(e).forEach((p) => { paidByMap[p.userId] = (paidByMap[p.userId] || 0) + p.amount; }); });
    const topSpenders = Object.entries(paidByMap).sort((a, b) => b[1] - a[1]);

    // Settle preview from group matrix
    const matrix = computeGroupMatrix(g.id);
    const txs = matrix ? simplifyDebts(matrix.net, cur) : [];

    // ---- Card chrome ----
    const card = h('div', { class: 'trip-card' });

    // Hero band
    const hero = h('div', { class: 'trip-hero' });
    hero.style.background = groupColor(g);
    const heroOverlay = h('div', { class: 'trip-hero-inner' }, [
      h('div', { class: 'trip-hero-left' }, [
        h('span', { class: 'trip-emoji' }, g.emoji || g.name.slice(0, 2).toUpperCase()),
        h('div', {}, [
          h('div', { class: 'trip-name' }, g.name),
          h('div', { class: 'trip-meta-row' }, [
            h('span', { class: 'cur-pill' }, cur),
            h('span', { class: 'trip-meta-dot' }),
            h('span', { class: 'trip-meta' }, dates.length
              ? dStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' – ' + dEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
              : 'No expenses yet'),
            h('span', { class: 'trip-meta-dot' }),
            h('span', { class: 'trip-meta' }, plural(g.members.length, 'member'))
          ])
        ])
      ]),
      h('div', { class: 'trip-hero-right' }, [
        avatarStack(g.members, 5),
        h('a', { class: 'btn btn-ghost btn-sm', href: '#/groups/' + g.id, style: { marginLeft: '12px' } }, 'Open →')
      ])
    ]);
    hero.appendChild(heroOverlay);
    card.appendChild(hero);

    // KPI strip
    const kpi = h('div', { class: 'trip-kpis' });
    kpi.appendChild(tripKpi('Total volume', fmtMoney(total, cur)));
    kpi.appendChild(tripKpi('Your share', fmtMoney(myShare, cur)));
    kpi.appendChild(tripKpi('Days active', String(daysActive)));
    kpi.appendChild(tripKpi('Daily average', fmtMoney(Math.round(dailyAvg), cur)));
    kpi.appendChild(tripKpi('Expenses', String(exps.length)));
    card.appendChild(kpi);

    if (exps.length === 0) {
      card.appendChild(h('div', { class: 'empty', style: { margin: 'var(--s-5)' } }, [
        h('div', { class: 'empty-title' }, 'Quiet on the ' + g.name + '…'),
        h('div', { class: 'empty-sub' }, 'Add your first expense to start tracking this trip.')
      ]));
      return card;
    }

    // Body — daily chart + category mini-donut side by side
    const body = h('div', { class: 'trip-body' });

    const dailyCol = h('div', { class: 'trip-panel' }, [
      h('div', { class: 'trip-panel-head' }, [
        h('span', { class: 'section-title' }, 'Daily spend'),
        h('span', { class: 'small muted' }, daysActive + ' day' + (daysActive === 1 ? '' : 's'))
      ]),
      h('div', { class: 'chart-wrap', style: { padding: '0' } }, barChart(dailyData, { height: 200 }))
    ]);
    body.appendChild(dailyCol);

    const catCol = h('div', { class: 'trip-panel' }, [
      h('div', { class: 'trip-panel-head' }, [
        h('span', { class: 'section-title' }, 'By category'),
        h('span', { class: 'small muted' }, catSlices.length + ' categor' + (catSlices.length === 1 ? 'y' : 'ies'))
      ]),
      h('div', { class: 'trip-cat-body' }, [
        miniDonut(catSlices, { size: 132 }),
        (function () {
          const lg = h('div', { class: 'donut-legend' });
          catSlices.slice(0, 5).forEach((s) => {
            lg.appendChild(h('div', { class: 'lg-row' }, [
              h('span', { class: 'lg-dot', style: { background: s.color } }),
              h('span', {}, s.label),
              h('span', { class: 'lg-amt' }, fmtMoney(s.value, cur))
            ]));
          });
          return lg;
        })()
      ])
    ]);
    body.appendChild(catCol);
    card.appendChild(body);

    // Footer row — settle preview + top spenders
    const foot = h('div', { class: 'trip-foot' });

    const settlePanel = h('div', { class: 'trip-panel' }, [
      h('div', { class: 'trip-panel-head' }, [
        h('span', { class: 'section-title' }, 'Settle preview'),
        h('span', { class: 'small muted' }, txs.length + ' transaction' + (txs.length === 1 ? '' : 's'))
      ])
    ]);
    if (txs.length === 0) {
      settlePanel.appendChild(h('div', { class: 'trip-settled' }, [
        h('span', { class: 'trip-settled-tick' }, '✓'),
        h('span', {}, 'All settled up')
      ]));
    } else {
      const list = h('div', { class: 'panel-stack' });
      txs.slice(0, 3).forEach((t) => {
        list.appendChild(h('div', { class: 'owes-row' }, [
          avatar(t.from, 'sm'),
          h('div', { class: 'who-name', style: { fontSize: '12px' } }, userName(t.from) + ' → ' + userName(t.to)),
          h('div', { class: 'amt' }, fmtMoney(t.amount, cur))
        ]));
      });
      settlePanel.appendChild(list);
      if (txs.length > 3) {
        settlePanel.appendChild(h('a', { class: 'small muted', href: '#/groups/' + g.id, style: { padding: '8px 16px', display: 'block' } }, '+ ' + (txs.length - 3) + ' more · Open trip →'));
      }
    }
    foot.appendChild(settlePanel);

    const spendersPanel = h('div', { class: 'trip-panel' }, [
      h('div', { class: 'trip-panel-head' }, [
        h('span', { class: 'section-title' }, 'Top spenders'),
        h('span', { class: 'small muted' }, 'Who paid')
      ]),
      hbarList(topSpenders.slice(0, 5).map(([uid2, v]) => ({ label: userName(uid2), value: v })), { currency: cur })
    ]);
    foot.appendChild(spendersPanel);

    card.appendChild(foot);
    return card;
  }
  function tripKpi(label, value, cls = '') {
    return h('div', { class: 'trip-kpi' }, [
      h('div', { class: 'trip-kpi-label' }, label),
      h('div', { class: 'trip-kpi-value ' + cls }, value)
    ]);
  }

  // -------- ANALYTICS --------
  function viewAnalytics() {
    const page = h('div', { class: 'page' });
    const monthSel = State.route.query.month || (new Date().toISOString().slice(0, 7));

    // Auto-detect currencies that actually appear in user data, ranked by expense count desc
    const curCounts = {};
    State.expenses.forEach((e) => { curCounts[e.currency] = (curCounts[e.currency] || 0) + 1; });
    const availCurrencies = Object.keys(curCounts).sort((a, b) => curCounts[b] - curCounts[a]);
    if (availCurrencies.length === 0) availCurrencies.push('INR');
    const cur = availCurrencies.includes(State.route.query.cur) ? State.route.query.cur : availCurrencies[0];
    const setCur = (next) => navigate('#/analytics?month=' + monthSel + '&cur=' + next);

    // ---- Header with month + currency segment ----
    const curSeg = h('div', { class: 'seg' });
    availCurrencies.forEach((c) => {
      curSeg.appendChild(h('button', {
        class: c === cur ? 'active' : '',
        onClick: () => setCur(c)
      }, c));
    });
    page.appendChild(h('header', { class: 'page-header' }, [
      h('div', { class: 'title-block' }, [h('h1', {}, 'Analytics'), h('div', { class: 'sub' }, 'Where your money goes')]),
      h('div', { class: 'actions' }, [
        curSeg,
        h('input', { type: 'month', class: 'filter-input', value: monthSel, onChange: (e) => navigate('#/analytics?month=' + e.target.value + '&cur=' + cur) })
      ])
    ]));

    const [yr, mo] = monthSel.split('-').map(Number);
    const inMonth = (iso) => { const d = new Date(iso); return d.getFullYear() === yr && d.getMonth() + 1 === mo; };
    const prevMonth = new Date(yr, mo - 2, 1);
    const inPrev = (iso) => { const d = new Date(iso); return d.getFullYear() === prevMonth.getFullYear() && d.getMonth() === prevMonth.getMonth(); };

    const myShareIn = (e) => (e.splits.find((s) => s.userId === State.selfId) || {}).amount || 0;
    const inCur = (e) => e.currency === cur;
    const monthExps = State.expenses.filter((e) => inMonth(e.date) && inCur(e));
    const prevExps = State.expenses.filter((e) => inPrev(e.date) && inCur(e));
    const total = monthExps.reduce((s, e) => s + myShareIn(e), 0);
    const prevTotal = prevExps.reduce((s, e) => s + myShareIn(e), 0);
    const daysIn = new Date(yr, mo, 0).getDate();
    const avg = total / daysIn;
    const catTotals = {};
    monthExps.forEach((e) => { catTotals[e.category] = (catTotals[e.category] || 0) + myShareIn(e); });
    const topCat = Object.entries(catTotals).sort((a, b) => b[1] - a[1])[0];
    const delta = prevTotal > 0 ? ((total - prevTotal) / prevTotal) * 100 : 0;

    // KPIs — hero "total spend" card spanning 2, then three stat cards.
    const kpis = h('div', { class: 'kpi-grid bal-row' });
    kpis.appendChild(kpiCard('Total your share', total, cur, new Date(yr, mo - 1, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' }), '', { hero: true }));
    kpis.appendChild(kpiCard('Avg per day', avg, cur, daysIn + ' days', '', { tilt: true, icon: 'calendar' }));
    kpis.appendChild(kpiCard('Top category', topCat ? categoryLabel(topCat[0]) : '—', '', topCat ? fmtMoney(topCat[1], cur) : 'No spend', '', { tilt: true, icon: 'pie' }));
    page.appendChild(kpis);
    const kpis2 = h('div', { class: 'kpi-grid kpi-grid-3' });
    kpis2.appendChild(kpiCard('vs last month', Math.abs(delta).toFixed(1) + '%', '', delta > 0 ? 'higher than April' : delta < 0 ? 'lower than April' : 'flat', delta > 0 ? 'neg' : delta < 0 ? 'pos' : '', { tilt: true, icon: delta > 0 ? 'trend-up' : 'trend-down' }));
    kpis2.appendChild(kpiCard('Expenses logged', State.expenses.filter(inCur).length, '', 'In ' + cur, '', { tilt: true, icon: 'rupee' }));
    kpis2.appendChild(kpiCard('Categories', Object.keys(catTotals).length, '', 'Distinct spend types', '', { tilt: true, icon: 'target' }));
    page.appendChild(kpis2);

    // ---- Auto-Insights (pure local computation — no AI / no tokens) ----
    const myPaid = monthExps.reduce((s, e) => s + paidByUser(e, State.selfId), 0);
    const fairness = myPaid - total; // +ve: you fronted more than your share
    const dayBuckets = {};
    monthExps.forEach((e) => { const k = new Date(e.date).toISOString().slice(0, 10); dayBuckets[k] = (dayBuckets[k] || 0) + myShareIn(e); });
    const bigDay = Object.entries(dayBuckets).sort((a, b) => b[1] - a[1])[0];
    const todayD = new Date();
    const isCurMonth = todayD.getFullYear() === yr && todayD.getMonth() + 1 === mo;
    const daysSoFar = isCurMonth ? todayD.getDate() : daysIn;
    const projected = daysSoFar > 0 ? (total / daysSoFar) * daysIn : total;
    const topShare = (topCat && total > 0) ? Math.round(topCat[1] / total * 100) : 0;
    const insightCard = (iconName, head, sub, tone) => h('div', { class: 'insight-card' }, [
      h('span', { class: 'insight-ico ' + (tone || '') }, uiIcon(iconName, 17)),
      h('div', { style: { minWidth: 0 } }, [h('div', { class: 'insight-head' }, head), h('div', { class: 'insight-sub' }, sub)])
    ]);
    const insights = h('div', { class: 'insight-strip' });
    if (monthExps.length === 0) {
      insights.appendChild(insightCard('sparkle', 'No spend this month', 'Add expenses and your insights will appear here automatically.', ''));
    } else {
      if (prevTotal > 0) insights.appendChild(insightCard(delta > 0 ? 'trend-up' : 'trend-down', (delta >= 0 ? 'Up ' : 'Down ') + Math.abs(delta).toFixed(0) + '% vs last month', 'You spent ' + fmtMoney(total, cur) + ' vs ' + fmtMoney(prevTotal, cur) + ' in ' + prevMonth.toLocaleString('en-US', { month: 'long' }) + '.', delta > 0 ? 'neg' : 'pos'));
      else insights.appendChild(insightCard('rupee', fmtMoney(total, cur) + ' this month', 'Your share across ' + plural(monthExps.length, 'expense') + '.', 'accent'));
      if (topCat) insights.appendChild(insightCard('pie', categoryLabel(topCat[0]) + ' is ' + topShare + '% of spend', fmtMoney(topCat[1], cur) + ' — your biggest category this month.', 'accent'));
      if (bigDay) insights.appendChild(insightCard('calendar', 'Biggest day · ' + new Date(bigDay[0]).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), fmtMoney(bigDay[1], cur) + ' spent in a single day.', 'accent'));
      if (isCurMonth && daysSoFar < daysIn) insights.appendChild(insightCard('target', 'On track for ~' + fmtMoney(projected, cur), 'At ' + fmtMoney(total / daysSoFar, cur) + '/day you\'ll reach about that by month-end.', 'accent'));
      else insights.appendChild(insightCard('scale', fairness >= 0 ? 'You fronted ' + fmtMoney(fairness, cur) + ' extra' : 'You under-paid by ' + fmtMoney(-fairness, cur), fairness >= 0 ? 'You paid more than your share — the group owes you for this month.' : 'You paid less than your share this month.', fairness >= 0 ? 'pos' : 'neg'));
    }
    page.appendChild(h('div', { class: 'section-title', style: { margin: '4px 0 10px' } }, 'Insights'));
    page.appendChild(insights);
    page.appendChild(budgetCard(cur, total));

    // ---- Navigable monthly spending calendar (browse any month, tap any day) ----
    const calCard = h('div', { class: 'card', style: { marginBottom: 'var(--s-5)' } });
    // Calendar follows the page's selected month (was always "today", which
    // showed e.g. an empty June while the page was set to May).
    let viewMonth = new Date(yr, mo - 1, 1);
    const calHeader = h('div', { class: 'card-header' });
    const calBody = h('div', { class: 'card-body', style: { display: 'flex', flexDirection: 'column', gap: 'var(--s-3)' } });

    function monthCalData(base) {
      const y = base.getFullYear(), m = base.getMonth();
      const daysIn = new Date(y, m + 1, 0).getDate();
      const arr = [];
      for (let d = 1; d <= daysIn; d++) { const dt = new Date(y, m, d); dt.setHours(0, 0, 0, 0); arr.push({ date: dt, value: 0 }); }
      State.expenses.forEach((e) => {
        if (!inCur(e)) return;
        const my = myShareIn(e); if (my <= 0) return;
        const dt = new Date(e.date);
        if (dt.getFullYear() === y && dt.getMonth() === m) arr[dt.getDate() - 1].value += my;
      });
      return arr;
    }
    function showDayExpenses(date) {
      const y = date.getFullYear(), m = date.getMonth(), dd = date.getDate();
      const items = State.expenses.filter((e) => { const t = new Date(e.date); return t.getFullYear() === y && t.getMonth() === m && t.getDate() === dd; });
      const title = date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
      if (!items.length) { toast('No expenses on ' + title); return; }
      const dayTotal = items.reduce((s, e) => s + e.amount, 0);
      const body = h('div', {}, [
        h('div', { class: 'small muted', style: { marginBottom: '8px' } }, plural(items.length, 'expense') + ' · ' + fmtMoney(dayTotal, items[0].currency) + ' total'),
        h('div', {}, items.map((e) => {
          const g = groupById(e.groupId);
          return h('div', { class: 'row clickable', style: { justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid var(--line)', gap: '12px' }, onClick: () => { closeModal(); openExpenseModal({ existing: e }); } }, [
            h('div', { style: { minWidth: 0 } }, [
              h('div', { style: { fontWeight: 600 } }, e.title),
              h('div', { class: 'small muted' }, (g ? g.name : '—') + ' · ' + payerLabel(e) + ' paid')
            ]),
            h('span', { class: 'col-amt' }, fmtMoney(e.amount, e.currency))
          ]);
        }))
      ]);
      openInfoModal({ title: title, body });
    }
    function renderCal() {
      calHeader.innerHTML = ''; calBody.innerHTML = '';
      const data = monthCalData(viewMonth);
      const total = data.reduce((s, d) => s + d.value, 0);
      const active = data.filter((d) => d.value > 0).length;
      const today = new Date();
      const atCurrent = viewMonth.getFullYear() === today.getFullYear() && viewMonth.getMonth() === today.getMonth();
      calHeader.appendChild(h('div', {}, [
        h('h3', {}, viewMonth.toLocaleString('en-US', { month: 'long', year: 'numeric' })),
        h('span', { class: 'sub' }, 'Your daily spending · tap a day · ' + cur)
      ]));
      calHeader.appendChild(h('div', { class: 'cal-nav' }, [
        h('button', { class: 'icon-btn', title: 'Previous month', onClick: () => { viewMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth() - 1, 1); renderCal(); } }, '‹'),
        h('button', { class: 'icon-btn', title: 'Next month', disabled: atCurrent, onClick: () => { if (atCurrent) return; viewMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 1); renderCal(); } }, '›')
      ]));
      if (active === 0) {
        calBody.appendChild(h('div', { class: 'empty', style: { padding: 'var(--s-7) var(--s-5)' } }, [
          h('div', { class: 'empty-title' }, 'No spending in ' + viewMonth.toLocaleString('en-US', { month: 'long' })),
          h('div', { class: 'empty-sub' }, 'Use the ‹ › arrows to browse a month with activity, or add an expense.')
        ]));
        return;
      }
      calBody.appendChild(heatmapChart(data, { currency: cur, onDay: (iso) => showDayExpenses(new Date(iso)) }));
      calBody.appendChild(h('div', { class: 'heat-foot' }, [
        h('span', { class: 'small muted' }, active + ' active days · ' + fmtMoney(Math.round(total), cur) + ' this month'),
        h('span', { class: 'heat-scale' }, [
          h('span', { class: 'small muted' }, 'Less'),
          h('span', { class: 'heat-swatch', style: { background: 'rgba(42,35,86,0.18)' } }),
          h('span', { class: 'heat-swatch', style: { background: 'rgba(42,35,86,0.40)' } }),
          h('span', { class: 'heat-swatch', style: { background: 'rgba(42,35,86,0.65)' } }),
          h('span', { class: 'heat-swatch', style: { background: 'rgba(42,35,86,0.95)' } }),
          h('span', { class: 'small muted' }, 'More')
        ])
      ]));
    }
    renderCal();
    calCard.appendChild(calHeader);
    calCard.appendChild(calBody);
    page.appendChild(calCard);

    // ---- Charts row: donut + 6-month bar ----
    const charts = h('div', { class: 'grid-2', style: { marginBottom: 'var(--s-5)' } });
    const donutCard = h('div', { class: 'card' });
    donutCard.appendChild(h('div', { class: 'card-header' }, [h('h3', {}, 'By category'), h('span', { class: 'sub' }, 'Your share, this month')]));
    const donutBody = h('div', { class: 'card-body', style: { display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 'var(--s-5)', alignItems: 'center' } });
    const slices = Object.entries(catTotals).map(([c, v]) => ({ label: categoryLabel(c), value: v, color: categoryColor(c) }));
    if (slices.length === 0) donutBody.appendChild(h('div', { class: 'empty' }, 'No spend this month'));
    else {
      donutBody.appendChild(donutChart(slices, { size: 200, currency: cur }));
      const legend = h('div', { class: 'donut-legend' });
      slices.sort((a, b) => b.value - a.value).forEach((s) => {
        legend.appendChild(h('div', { class: 'lg-row' }, [
          h('span', { class: 'lg-dot', style: { background: s.color } }),
          h('span', {}, s.label),
          h('span', { class: 'lg-amt' }, fmtMoney(s.value, cur))
        ]));
      });
      donutBody.appendChild(legend);
    }
    donutCard.appendChild(donutBody);
    charts.appendChild(donutCard);

    const barCard = h('div', { class: 'card' });
    barCard.appendChild(h('div', { class: 'card-header' }, [h('h3', {}, 'Last 6 months'), h('span', { class: 'sub' }, 'Your ' + cur + ' share by month')]));
    const monthsData = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(yr, mo - 1 - i, 1);
      const m = d.getMonth(), y = d.getFullYear();
      const sum = State.expenses.filter((e) => { const dt = new Date(e.date); return dt.getMonth() === m && dt.getFullYear() === y && inCur(e); }).reduce((s, e) => s + myShareIn(e), 0);
      monthsData.push({ label: d.toLocaleString('en-US', { month: 'short' }), value: Math.round(sum) });
    }
    barCard.appendChild(h('div', { class: 'chart-wrap' }, barChart(monthsData, { height: 220 })));
    charts.appendChild(barCard);
    page.appendChild(charts);

    // ---- Pattern row: day-of-week + paid vs share ----
    const patternRow = h('div', { class: 'grid-2', style: { marginBottom: 'var(--s-5)' } });

    // Day-of-week pattern (last 90 days in cur)
    const dowCard = h('div', { class: 'card' });
    dowCard.appendChild(h('div', { class: 'card-header' }, [h('h3', {}, 'Spending pattern'), h('span', { class: 'sub' }, 'By day of week · last 90 days')]));
    const dowSum = [0, 0, 0, 0, 0, 0, 0]; // Mon..Sun
    const dowCount = [0, 0, 0, 0, 0, 0, 0];
    const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 90);
    State.expenses.forEach((e) => {
      if (!inCur(e)) return;
      const d = new Date(e.date); if (d < cutoff) return;
      const dow = (d.getDay() + 6) % 7; // Mon=0
      const my = myShareIn(e);
      dowSum[dow] += my;
      if (my > 0) dowCount[dow]++;
    });
    const dowLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const dowRows = dowSum.map((v, i) => ({
      label: dowLabels[i],
      value: Math.round(v),
      color: (i >= 5) ? 'var(--accent-2)' : 'var(--accent)' // weekend tinted
    }));
    const dowMax = Math.max(...dowSum);
    if (dowMax === 0) {
      dowCard.appendChild(h('div', { class: 'card-body' }, h('div', { class: 'empty' }, 'No spend in last 90 days')));
    } else {
      dowCard.appendChild(h('div', { class: 'card-body' }, hbarList(dowRows, { currency: cur })));
    }
    patternRow.appendChild(dowCard);

    // You paid vs your share (this month)
    const paidCard = h('div', { class: 'card' });
    paidCard.appendChild(h('div', { class: 'card-header' }, [h('h3', {}, 'You paid vs your share'), h('span', { class: 'sub' }, 'This month · ' + cur)]));
    let paidOut = 0; // amount you fronted
    let owedToYou = 0; // what others owe from your payments
    let owedByYou = 0; // what you owe from others' payments
    monthExps.forEach((e) => {
      const my = myShareIn(e);
      const paidSelf = paidByUser(e, State.selfId);
      paidOut += paidSelf;
      const net = paidSelf - my;
      if (net > 0) owedToYou += net; else owedByYou += -net;
    });
    const myShareMonth = total;
    const ratio = (paidOut + myShareMonth) > 0 ? paidOut / (paidOut + myShareMonth) : 0;
    const paidBody = h('div', { class: 'card-body', style: { display: 'flex', flexDirection: 'column', gap: 'var(--s-4)' } });
    paidBody.appendChild(h('div', { class: 'paid-meter' }, [
      h('span', { class: 'paid-meter-paid', style: { flex: String(paidOut || 0.001) }, title: 'You paid' }),
      h('span', { class: 'paid-meter-share', style: { flex: String(myShareMonth || 0.001) }, title: 'Your share' })
    ]));
    paidBody.appendChild(h('div', { class: 'paid-legend' }, [
      h('div', { class: 'paid-row' }, [
        h('span', { class: 'paid-dot paid' }),
        h('span', {}, 'You paid'),
        h('span', { class: 'paid-amt' }, fmtMoney(paidOut, cur))
      ]),
      h('div', { class: 'paid-row' }, [
        h('span', { class: 'paid-dot share' }),
        h('span', {}, 'Your share'),
        h('span', { class: 'paid-amt' }, fmtMoney(myShareMonth, cur))
      ]),
      h('div', { class: 'paid-row sub' }, [
        h('span', { style: { gridColumn: '1 / 3' } }, paidOut > myShareMonth ? 'You\'re owed' : paidOut < myShareMonth ? 'You owe' : 'Balanced'),
        h('span', { class: 'paid-amt ' + (paidOut > myShareMonth ? 'pos' : paidOut < myShareMonth ? 'neg' : '') }, fmtMoney(Math.abs(paidOut - myShareMonth), cur))
      ])
    ]));
    paidCard.appendChild(paidBody);
    patternRow.appendChild(paidCard);
    page.appendChild(patternRow);

    // ---- Top groups + Top friends ----
    const lists = h('div', { class: 'grid-2' });
    const topGroupsCard = h('div', { class: 'card' });
    topGroupsCard.appendChild(h('div', { class: 'card-header' }, h('h3', {}, 'Top groups')));
    const groupSpend = {};
    monthExps.forEach((e) => { groupSpend[e.groupId] = (groupSpend[e.groupId] || 0) + myShareIn(e); });
    const tg = Object.entries(groupSpend).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const tgBody = h('div', { class: 'panel-stack' });
    if (tg.length === 0) tgBody.appendChild(h('div', { class: 'empty' }, 'No data'));
    tg.forEach(([gid, v]) => {
      const g = groupById(gid);
      tgBody.appendChild(h('div', { class: 'owes-row clickable', onClick: () => navigate('#/groups/' + gid) }, [
        h('div', { class: 'gc-emoji', data: { cat: g?.category }, style: { width: '32px', height: '32px', borderRadius: '8px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: '11px', fontWeight: 700, background: groupColor(g) } }, g?.emoji || ''),
        h('div', {}, [h('div', { class: 'who-name' }, g?.name || ''), h('div', { class: 'who-sub' }, plural((g?.members || []).length, 'member'))]),
        h('div', { class: 'amt' }, fmtMoney(v, cur))
      ]));
    });
    topGroupsCard.appendChild(tgBody);
    lists.appendChild(topGroupsCard);

    const topFriendsCard = h('div', { class: 'card' });
    topFriendsCard.appendChild(h('div', { class: 'card-header' }, h('h3', {}, 'Top people you split with')));
    const friendSpend = {};
    monthExps.forEach((e) => {
      e.splits.forEach((sp) => { if (sp.userId !== State.selfId) friendSpend[sp.userId] = (friendSpend[sp.userId] || 0) + sp.amount; });
    });
    const tf = Object.entries(friendSpend).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const tfBody = h('div', { class: 'panel-stack' });
    if (tf.length === 0) tfBody.appendChild(h('div', { class: 'empty' }, 'No data'));
    tf.forEach(([uid2, v]) => {
      tfBody.appendChild(h('div', { class: 'owes-row' }, [
        avatar(uid2, 'md'),
        h('div', {}, [h('div', { class: 'who-name' }, userNameFull(uid2)), h('div', { class: 'who-sub' }, State.users.find((u) => u.id === uid2)?.upi || '')]),
        h('div', { class: 'amt' }, fmtMoney(v, cur))
      ]));
    });
    topFriendsCard.appendChild(tfBody);
    lists.appendChild(topFriendsCard);
    page.appendChild(lists);

    setMain(page);
    bindTilt(page);
  }

  // -------- ACTIVITY --------
  function viewActivity() {
    const page = h('div', { class: 'page' });
    const useReal = State.activity && State.activity.length > 0;
    page.appendChild(h('header', { class: 'page-header' }, [
      h('div', { class: 'title-block' }, [
        h('h1', {}, 'Activity'),
        h('div', { class: 'sub' }, useReal
          ? 'Every change — adds, edits, deletes, settlements. Click any row for details.'
          : 'Chronological feed across every group')
      ]),
      h('div', { class: 'actions' }, [h('button', { class: 'btn btn-primary btn-sm', onClick: () => openExpenseModal() }, '+ Add expense')])
    ]));

    if (useReal) {
      page.appendChild(renderActivityLog());
      setMain(page);
      return;
    }

    const items = [];
    State.expenses.forEach((e) => items.push({ kind: 'expense', date: e.date, data: e }));
    State.settlements.forEach((s) => items.push({ kind: 'settle', date: s.date, data: s }));
    items.sort((a, b) => b.date.localeCompare(a.date));

    // group by day
    const card = h('div', { class: 'card' });
    const feed = h('div', { class: 'feed' });
    let lastDay = '';
    items.forEach((it) => {
      const day = new Date(it.date).toDateString();
      if (day !== lastDay) {
        feed.appendChild(h('div', {
          style: { padding: '8px 16px', background: 'var(--surface-2)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-3)', fontWeight: 600, borderTop: '1px solid var(--line)', borderBottom: '1px solid var(--line)' }
        }, day));
        lastDay = day;
      }
      if (it.kind === 'expense') {
        const e = it.data;
        const g = groupById(e.groupId);
        const myShare = (e.splits.find((s) => s.userId === State.selfId) || {}).amount || 0;
        const recurBadge = e.recurring ? h('span', {
          style: {
            display: 'inline-flex', alignItems: 'center', gap: '3px',
            padding: '1px 6px', marginLeft: '8px', borderRadius: '999px',
            background: 'var(--accent-tint)', color: 'var(--accent)',
            fontSize: '10px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em'
          }
        }, [
          '↻ ' + (e.recurring.parentId ? 'auto' : (window.OrbitRecurring ? OrbitRecurring.freqLabel(e.recurring.freq) : 'repeat'))
        ]) : null;
        feed.appendChild(h('div', { class: 'feed-row clickable', onClick: () => openExpenseModal({ existing: e }) }, [
          h('div', { class: 'feed-icon' }, '₹'),
          h('div', {}, [
            h('div', { class: 'title' }, [e.title, recurBadge]),
            h('div', { class: 'meta' }, [payerLabel(e) + ' paid · ', g?.name || '—', ' · ', fmtDateTime(e.date)])
          ]),
          h('div', { style: { textAlign: 'right' } }, [
            h('div', { class: 'amt' }, fmtMoney(e.amount, e.currency)),
            (() => { const net = paidByUser(e, State.selfId) - myShare; return h('div', { class: 'small ' + (net >= 0 ? 'muted' : '') }, net >= 0 ? '+' + fmtMoney(net, e.currency) : '−' + fmtMoney(-net, e.currency)); })()
          ])
        ]));
      } else {
        const s = it.data;
        feed.appendChild(h('div', { class: 'feed-row kind-settle' }, [
          h('div', { class: 'feed-icon' }, '✓'),
          h('div', {}, [
            h('div', { class: 'title' }, userNameFull(s.fromUser) + ' paid ' + userNameFull(s.toUser)),
            h('div', { class: 'meta' }, [(s.method === 'upi' ? 'UPI · ' : 'Manual · '), groupById(s.groupId)?.name || '—', ' · ', fmtDateTime(s.date)])
          ]),
          h('div', { style: { textAlign: 'right' } }, [h('div', { class: 'amt' }, fmtMoney(s.amount, s.currency))])
        ]));
      }
    });
    if (items.length === 0) feed.appendChild(h('div', { class: 'empty' }, 'No activity yet.'));
    card.appendChild(feed);
    page.appendChild(card);
    setMain(page);
  }

  function renderActivityLog() {
    const card = h('div', { class: 'card' });
    const feed = h('div', { class: 'feed' });
    // For SHARED groups, trust only the synced feed/derived rows — stale local
    // entries (e.g. an old expense logged as "You" before identity sync) are
    // dropped so the feed is correctly attributed and matches the data.
    // Defensive: ts is normally an ISO string but a stray Timestamp/undefined
    // must never crash the whole feed (this was the "Something went sideways").
    const tss = (a) => (typeof a.ts === 'string') ? a.ts : (a && a.ts && a.ts.toDate ? a.ts.toDate().toISOString() : String((a && a.ts) || ''));
    const list = State.activity.slice().sort((a, b) => tss(b).localeCompare(tss(a)));
    let lastDay = '';
    list.forEach((entry) => {
      const day = new Date(entry.ts).toDateString();
      if (day !== lastDay) {
        feed.appendChild(h('div', {
          style: { padding: '8px 16px', background: 'var(--surface-2)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-3)', fontWeight: 600, borderTop: '1px solid var(--line)', borderBottom: '1px solid var(--line)' }
        }, day));
        lastDay = day;
      }
      feed.appendChild(renderActivityRow(entry));
    });
    if (!list.length) feed.appendChild(h('div', { class: 'empty' }, 'No activity yet.'));
    card.appendChild(feed);
    return card;
  }

  function renderActivityRow(entry) {
    // "You" must mean the person READING this — not whoever's local id happens to
    // be 'u_self'. Resolve identity by Firebase uid; fall back to the local self
    // id only for old, non-shared entries that predate actorUid stamping.
    const myFb = myUid();
    const isMe = entry.actorUid
      ? (!!myFb && entry.actorUid === myFb)
      : (!entry.shared && entry.actorId === State.selfId);
    const resolved = State.users.find((u) => u.id === entry.actorId)
      || (entry.actorUid && State.users.find((u) => u.id === entry.actorUid)) || null;
    const actorName = isMe
      ? 'You'
      : ((resolved && !resolved.isSelf && resolved.name) || entry.actorName || (resolved && resolved.name) || 'Someone');
    const g = entry.groupId ? groupById(entry.groupId) : null;
    const snap = entry.snapshot || entry.prev || {};
    const title = snap.title || (entry.action === 'import' ? 'Splitwise import' : (snap.note || entry.entityType));
    const amount = snap.amount;
    const currency = snap.currency || 'INR';
    const isDelete = entry.action === 'delete';

    // Member events (join / remove) read as full sentences — render them plainly
    // (no "Removed · " prefix, no strikethrough) and click through to the group.
    const isMember = entry.entityType === 'member';
    const isJoin = entry.action === 'join';
    const isMemberRemove = isMember && entry.action === 'remove';
    return h('div', { class: 'feed-row clickable', onClick: () => isMember ? (entry.groupId && navigate('#/groups/' + entry.groupId)) : openActivityDetail(entry) }, [
      h('div', { class: 'feed-icon', style: {
        background: isJoin ? 'rgba(0,168,126,0.10)' : (isMemberRemove || isDelete) ? 'rgba(251,113,133,0.10)' : 'var(--surface-3)',
        color: isJoin ? 'var(--pos)' : (isMemberRemove || isDelete) ? 'var(--neg)' : 'var(--text-2)'
      } }, window.OrbitActivity ? OrbitActivity.actionIcon(entry.action) : '·'),
      h('div', {}, [
        h('div', { class: 'title' }, isMember ? [h('span', {}, title)] : [
          (window.OrbitActivity ? OrbitActivity.actionLabel(entry.action) : entry.action) + ' · ',
          h('span', { style: isDelete ? { textDecoration: 'line-through', color: 'var(--text-3)' } : {} }, title)
        ]),
        h('div', { class: 'meta' }, [
          actorName, ' · ',
          g?.name || (entry.entityType === 'settlement' ? 'Settlement' : '—'), ' · ',
          fmtDateTime(entry.ts)
        ])
      ]),
      h('div', { style: { textAlign: 'right' } }, [
        amount != null ? h('div', { class: 'amt tabular' }, fmtMoney(amount, currency)) : null,
        entry.action === 'import' && entry.meta
          ? h('div', { class: 'small muted' }, entry.meta.expenses + ' expenses')
          : null
      ])
    ]);
  }

  function openActivityDetail(entry) {
    const modal = h('div', { class: 'modal modal-md' });
    modal.appendChild(h('div', { class: 'modal-head' }, [
      h('h2', {}, (window.OrbitActivity ? OrbitActivity.actionLabel(entry.action) : entry.action) + ' — ' + (entry.entityType)),
      h('button', { class: 'close', onClick: closeModal }, '×')
    ]));
    const body = h('div', { class: 'modal-body' });

    const actor = State.users.find((u) => u.id === entry.actorId);
    body.appendChild(h('div', { class: 'small muted', style: { marginBottom: '12px' } },
      (actor?.name || 'Someone') + ' · ' + new Date(entry.ts).toLocaleString()));

    if (entry.action === 'edit' && window.OrbitActivity && entry.prev && entry.snapshot) {
      const changes = OrbitActivity.diff(entry.prev, entry.snapshot);
      if (changes.length) {
        body.appendChild(h('div', { class: 'section-title', style: { marginBottom: '8px' } }, 'Changes'));
        const t = h('table', { class: 'tbl', style: { width: '100%' } });
        const tb = h('tbody');
        changes.forEach((c) => {
          tb.appendChild(h('tr', {}, [
            h('td', { style: { padding: '6px 10px', color: 'var(--text-2)', fontWeight: 500, width: '120px' } }, c.field),
            h('td', { style: { padding: '6px 10px', color: 'var(--neg)' } }, fmtDiffVal(c.before)),
            h('td', { style: { padding: '6px 10px', color: 'var(--text-3)', width: '20px' } }, '→'),
            h('td', { style: { padding: '6px 10px', color: 'var(--pos)' } }, fmtDiffVal(c.after))
          ]));
        });
        t.appendChild(tb);
        body.appendChild(t);
      } else {
        body.appendChild(h('div', { class: 'small muted' }, 'No field-level changes detected.'));
      }
    } else if (entry.snapshot || entry.prev) {
      const snap = entry.snapshot || entry.prev;
      const t = h('table', { class: 'tbl', style: { width: '100%' } });
      const tb = h('tbody');
      Object.keys(snap).forEach((k) => {
        if (k === 'id' || k === 'splits' || k === 'history') return;
        tb.appendChild(h('tr', {}, [
          h('td', { style: { padding: '6px 10px', color: 'var(--text-2)', fontWeight: 500, width: '120px' } }, k),
          h('td', { style: { padding: '6px 10px', fontFamily: 'JetBrains Mono, monospace', fontSize: '12px' } }, fmtDiffVal(snap[k]))
        ]));
      });
      t.appendChild(tb);
      body.appendChild(t);
    }

    modal.appendChild(body);
    const footActions = [h('button', { class: 'btn btn-ghost btn-sm', onClick: closeModal }, 'Close')];
    if (entry.action === 'delete' && entry.entityType === 'expense' && entry.prev) {
      footActions.unshift(h('button', { class: 'btn btn-primary btn-sm', onClick: () => restoreFromActivity(entry) }, 'Restore expense'));
    }
    modal.appendChild(h('div', { class: 'modal-foot' }, [h('span', { class: 'spacer' }), ...footActions]));
    openModal(modal);
  }

  function fmtDiffVal(v) {
    if (v == null) return '—';
    if (typeof v === 'number') return String(v);
    if (typeof v === 'string') return v.length > 60 ? v.slice(0, 60) + '…' : v;
    try { return JSON.stringify(v); } catch (_) { return String(v); }
  }

  async function restoreFromActivity(entry) {
    if (!entry.prev) return;
    const restored = { ...entry.prev };
    await OrbitDB.put('expenses', restored);
    State.expenses.push(restored);
    if (window.OrbitActivity) await OrbitActivity.log(OrbitDB, {
      ...actorStamp(), action: 'restore', entityType: 'expense',
      entityId: restored.id, groupId: restored.groupId, snapshot: restored
    });
    closeModal();
    toast('Restored "' + (restored.title || 'expense') + '"', 'pos');
    render();
  }

  // -------- SETTLE --------
  function viewSettle() {
    const page = h('div', { class: 'page' });
    page.appendChild(h('header', { class: 'page-header' }, [
      h('div', { class: 'title-block' }, [h('h1', {}, 'Smart settle'), h('div', { class: 'sub' }, 'Optimised, minimum-transaction settlement across all your groups')]),
      h('div', { class: 'actions' }, [h('button', { class: 'btn btn-ghost btn-sm', onClick: () => render() }, '↻ Recompute')])
    ]));

    // Combined net (per currency)
    const byCur = {};
    State.expenses.forEach((e) => {
      const cur = e.currency || 'INR';
      byCur[cur] = byCur[cur] || {};
      const net = byCur[cur];
      expensePayers(e).forEach((p) => { net[p.userId] = (net[p.userId] || 0) + p.amount; });
      e.splits.forEach((s) => { net[s.userId] = (net[s.userId] || 0) - s.amount; });
    });
    State.settlements.forEach((s) => {
      const cur = s.currency || 'INR';
      byCur[cur] = byCur[cur] || {};
      const net = byCur[cur];
      net[s.fromUser] = (net[s.fromUser] || 0) + s.amount;
      net[s.toUser] = (net[s.toUser] || 0) - s.amount;
    });

    // For each currency, simplify and list
    Object.entries(byCur).forEach(([cur, net]) => {
      Object.keys(net).forEach((k) => { net[k] = Math.round(net[k] * 100) / 100; if (Math.abs(net[k]) < 0.01) delete net[k]; });
      const txs = simplifyDebts(net, cur);
      if (txs.length === 0) return;
      // filter to only those involving self
      const involve = txs.filter((t) => t.from === State.selfId || t.to === State.selfId);
      if (involve.length === 0) return;
      const card = h('div', { class: 'card', style: { marginBottom: 'var(--s-4)' } });
      card.appendChild(h('div', { class: 'card-header' }, [
        h('h3', {}, 'Settlements in ' + cur),
        h('span', { class: 'sub' }, plural(involve.length, 'transaction'))
      ]));
      const body = h('div', { class: 'panel-stack' });
      involve.forEach((t) => {
        const isOwed = t.to === State.selfId;
        const other = isOwed ? t.from : t.to;
        const otherU = State.users.find((x) => x.id === other);
        const reminderKey = 'reminder_' + other;
        const lastRem = State.reminderCache ? State.reminderCache[reminderKey] : null;
        const remRecent = lastRem && (Date.now() - new Date(lastRem).getTime() < 24 * 3600 * 1000);
        const age = debtAge(other);
        const stale = age !== null && age > 14;
        body.appendChild(h('div', { class: 'owes-row' + (stale ? ' owes-row-stale' : '') }, [
          avatar(other, 'md'),
          h('div', { style: { minWidth: 0 } }, [
            h('div', { class: 'who-name' }, [
              isOwed ? otherU?.name + ' owes you' : 'You owe ' + otherU?.name,
              stale ? h('span', { class: 'chip chip-warn stale-chip' }, [uiIcon('clock', 11), 'Stale']) : null
            ]),
            h('div', { class: 'who-sub' }, [
              otherU?.upi || otherU?.email || '',
              age !== null ? h('span', { style: { marginLeft: '8px', color: stale ? 'var(--warn)' : 'var(--text-3)' } }, '· ' + (age === 0 ? 'today' : plural(age, 'day') + ' old')) : null,
              remRecent ? h('span', { style: { marginLeft: '8px', color: 'var(--accent)', fontSize: '11px' } }, '· reminded ' + fmtDateRel(lastRem)) : null
            ])
          ]),
          h('div', { class: 'amt ' + (isOwed ? 'pos' : 'neg') }, fmtMoney(t.amount, cur)),
          h('div', { class: 'actions' }, [
            isOwed ? h('button', {
              class: 'btn-mark', disabled: remRecent,
              title: remRecent ? 'Reminder sent recently — give them a beat' : 'Send a nudge',
              onClick: () => sendReminder(other, t.amount, cur, sharedGroupWith(other))
            }, remRecent ? 'Reminded' : 'Remind') : null,
            !isOwed && otherU?.upi ? h('button', { class: 'btn-pay', onClick: () => payViaUPI(otherU, t.amount) }, 'Pay via UPI') : null,
            otherU ? h('button', { class: 'btn-wa', title: 'Message on WhatsApp', onClick: () => remindViaWhatsApp(otherU, t.amount, isOwed ? 'owes-you' : 'you-owe') }, waIcon()) : null,
            h('button', { class: 'btn-mark', onClick: (ev) => { ev.currentTarget.disabled = true; recordSettlementSmart(t.from, t.to, t.amount, cur); } }, 'Mark paid')
          ])
        ]));
      });
      card.appendChild(body);
      page.appendChild(card);
    });

    if (page.children.length === 1) {
      page.appendChild(h('div', { class: 'empty' }, [
        h('div', { class: 'empty-title' }, 'You\'re all settled up.'),
        h('div', { class: 'empty-sub' }, 'No outstanding balances across any group. ✨')
      ]));
    }

    setMain(page);
  }

  // Clean slate: remove the sample/demo data (Goa Trip, Flatmates, seed people,
  // their expenses + the old local activity) while KEEPING your real shared
  // groups (they re-sync from the cloud) and your own profile.
  async function clearDemoData() {
    const localGroups = State.groups.filter((g) => !isSharedGroup(g));
    const localIds = new Set(localGroups.map((g) => g.id));
    // Members to keep = self + everyone in a real shared group.
    const keep = new Set([State.selfId]);
    State.groups.filter((g) => isSharedGroup(g)).forEach((g) => (g.members || []).forEach((m) => keep.add(m)));
    try {
      await OrbitDB.deleteMany('expenses', State.expenses.filter((e) => localIds.has(e.groupId)).map((e) => e.id));
      await OrbitDB.deleteMany('settlements', State.settlements.filter((s) => localIds.has(s.groupId)).map((s) => s.id));
      for (const a of (State.activity || [])) { try { await OrbitDB.delete('activity', a.id); } catch (_) {} }   // wipe all local activity (shared re-syncs)
      for (const g of localGroups) { try { await OrbitDB.delete('groups', g.id); } catch (_) {} }
      for (const u of State.users.filter((u) => !u.isSelf && !keep.has(u.id))) { try { await OrbitDB.delete('users', u.id); } catch (_) {} }
      // Also clear the Money (personal-finance) sample data — every record the
      // demo seeded carries demo:true, so user-added finance data is preserved.
      await clearFinanceDemo();
      try { await OrbitDB.setMeta('demoCleared', '1'); } catch (_) {}
    } catch (e) { console.warn('[clearDemo] failed', e); }
    State.expenses = State.expenses.filter((e) => !localIds.has(e.groupId));
    State.settlements = State.settlements.filter((s) => !localIds.has(s.groupId));
    State.activity = [];
    State.groups = State.groups.filter((g) => isSharedGroup(g));
    State.users = State.users.filter((u) => u.isSelf || keep.has(u.id));
    renderSidebarGroups();
    toast('Demo data cleared — your real data remains', 'pos');
    navigate('#/dashboard');
  }

  // Remove all demo-seeded finance records (demo:true) across every fin_* store.
  const FIN_DEMO_STORES = [
    ['fin_accounts', 'finAccounts'], ['fin_investments', 'finInvestments'], ['fin_loans', 'finLoans'],
    ['fin_txns', 'finTxns'], ['fin_budgets', 'finBudgets'], ['fin_goals', 'finGoals'],
    ['fin_subs', 'finSubs'], ['fin_recurring', 'finRecurring'], ['fin_nwhistory', 'finNwHistory']
  ];
  async function clearFinanceDemo() {
    for (const [store, stateKey] of FIN_DEMO_STORES) {
      const all = await OrbitDB.getAll(store);
      const keyField = store === 'fin_nwhistory' ? 'date' : 'id';
      for (const rec of all) { if (rec && rec.demo) { try { await OrbitDB.delete(store, rec[keyField]); } catch (_) {} } }
      State[stateKey] = (State[stateKey] || []).filter((r) => !(r && r.demo));
    }
  }

  // -------- ADMIN (founder only): everyone who's signed in --------
  function viewAdmin() {
    const page = h('div', { class: 'page' });
    if (!isFounder()) {
      page.appendChild(h('header', { class: 'page-header' }, h('div', { class: 'title-block' }, h('h1', {}, 'Not available'))));
      page.appendChild(h('div', { class: 'empty' }, [h('div', { class: 'empty-title' }, 'Admin is founder-only'), h('a', { class: 'btn btn-sm', href: '#/dashboard' }, 'Back to dashboard')]));
      setMain(page); return;
    }
    page.appendChild(h('header', { class: 'page-header' }, [
      h('div', { class: 'title-block' }, [h('h1', {}, 'Admin'), h('div', { class: 'sub' }, 'Everyone signed in to Orbit')]),
      h('div', { class: 'actions' }, [h('button', { class: 'btn btn-sm', onClick: () => viewAdmin() }, 'Refresh')])
    ]));
    const card = h('div', { class: 'card' });
    const body = h('div', { class: 'card-body' });
    body.appendChild(h('div', { class: 'small muted' }, 'Loading users…'));
    card.appendChild(body); page.appendChild(card); setMain(page);
    (async () => {
      const users = (window.OrbitGroups && OrbitGroups.listAllUsers) ? await OrbitGroups.listAllUsers() : [];
      const groups = (window.OrbitGroups && OrbitGroups.listAllGroups) ? await OrbitGroups.listAllGroups() : [];
      body.innerHTML = '';
      if (!users.length) { body.appendChild(h('div', { class: 'empty' }, h('div', { class: 'empty-title' }, 'No users yet'))); return; }
      const tsOf = (u) => { const ts = u.updatedAt; if (ts && ts.seconds != null) return ts.seconds * 1000; if (typeof ts === 'string') return new Date(ts).getTime(); if (ts && ts.toDate) return ts.toDate().getTime(); return 0; };
      const fmtSeen = (u) => { const ms = tsOf(u); return ms ? fmtDateRel(new Date(ms).toISOString()) : '—'; };
      // ---- Founder stats ----
      const now = Date.now(); const wk = 7 * 864e5;
      const activeWeek = users.filter((u) => now - tsOf(u) < wk).length;
      const activeDay = users.filter((u) => now - tsOf(u) < 864e5).length;
      const memberships = groups.reduce((s, g) => s + ((g.memberUids || []).length), 0);
      const avgSize = groups.length ? (memberships / groups.length) : 0;
      const biggest = groups.slice().sort((a, b) => (b.memberUids || []).length - (a.memberUids || []).length)[0];
      // most-connected user (in the most groups)
      const inGroups = {}; groups.forEach((g) => (g.memberUids || []).forEach((m) => { inGroups[m] = (inGroups[m] || 0) + 1; }));
      const topUid = Object.keys(inGroups).sort((a, b) => inGroups[b] - inGroups[a])[0];
      const topUser = users.find((u) => u.uid === topUid);
      const stat = (label, val, sub) => h('div', { class: 'kpi tilt' }, [h('div', { class: 'kpi-label' }, label), h('div', { class: 'kpi-value' }, String(val)), sub ? h('div', { class: 'kpi-delta' }, sub) : null]);
      const grid1 = h('div', { class: 'kpi-grid bal-row', style: { marginBottom: 'var(--s-3)' } });
      grid1.appendChild(stat('Total users', users.length, activeWeek + ' active this week'));
      grid1.appendChild(stat('Total groups', groups.length, avgSize ? avgSize.toFixed(1) + ' people/group avg' : ''));
      grid1.appendChild(stat('Active today', activeDay, 'signed in < 24h'));
      body.appendChild(grid1);
      const grid2 = h('div', { class: 'kpi-grid kpi-grid-3', style: { marginBottom: 'var(--s-4)' } });
      grid2.appendChild(stat('Total memberships', memberships, 'across all groups'));
      grid2.appendChild(stat('Biggest group', biggest ? (biggest.memberUids || []).length : 0, biggest ? (biggest.name || '—') : '—'));
      grid2.appendChild(stat('Most connected', topUser ? (inGroups[topUid]) : 0, topUser ? (topUser.name || topUser.email || '—') : '—'));
      body.appendChild(grid2);
      body.appendChild(h('hr'));
      // ---- User roster ----
      const fmtSeen2 = fmtSeen;
      users.sort((a, b) => tsOf(b) - tsOf(a));
      body.appendChild(h('div', { class: 'small muted', style: { margin: '10px 0' } }, users.length + ' signed-in ' + (users.length === 1 ? 'user' : 'users')));
      users.forEach((u) => {
        const av = h('span', { class: 'avatar avatar-md', data: { color: '1' } }, (u.name || u.email || '?').slice(0, 1).toUpperCase());
        if (u.photoURL) { av.classList.add('avatar-photo'); av.style.backgroundImage = 'url("' + u.photoURL + '")'; av.textContent = ''; }
        body.appendChild(h('div', { class: 'owes-row' }, [
          av,
          h('div', { style: { minWidth: 0 } }, [
            h('div', { class: 'who-name' }, u.name || '(no name)'),
            h('div', { class: 'who-sub' }, [(u.email || 'no email'), u.phone ? h('span', { style: { marginLeft: '8px' } }, '· ' + u.phone) : null])
          ]),
          h('div', { class: 'small muted', style: { marginLeft: 'auto', textAlign: 'right' } }, [h('div', {}, 'last seen'), h('div', { style: { fontWeight: 600 } }, fmtSeen(u))])
        ]));
      });
    })();
  }

  // -------- PROFILE --------
  function viewProfile() {
    const page = h('div', { class: 'page' });
    page.appendChild(h('header', { class: 'page-header' }, [
      h('div', { class: 'title-block' }, [h('h1', {}, 'Profile & settings'), h('div', { class: 'sub' }, 'Account, preferences, data')]),
      h('div', { class: 'actions' }, [
        h('button', { class: 'btn btn-primary btn-sm', onClick: inviteToOrbit }, 'Invite friends'),
        h('button', { class: 'btn btn-ghost btn-sm', onClick: exportAllJson }, 'Export JSON'),
        h('button', { class: 'btn btn-ghost btn-sm', onClick: restoreFromJson }, 'Restore JSON'),
        h('button', { class: 'btn btn-danger btn-sm', onClick: confirmDeleteAll }, 'Wipe all data')
      ])
    ]));

    let me = State.users.find((u) => u.id === State.selfId);
    const fbUser = (window.OrbitCloud && OrbitCloud.user) ? OrbitCloud.user() : null;

    // Defensive: if we render Profile before ensureSelfUserMatchesAuth has
    // run (e.g. right after a wipe), synthesize a stub so the page renders.
    if (!me) {
      me = {
        id: State.selfId || 'u_self',
        name: fbUser?.displayName || 'You',
        email: fbUser?.email || '',
        upi: '', phone: '', isSelf: true, avatar: 'av-c1'
      };
    }

    if (fbUser) {
      const idCard = h('div', { class: 'card', style: { marginBottom: 'var(--s-4)' } });
      idCard.appendChild(h('div', { class: 'card-header' }, [
        h('h3', {}, 'Signed in'),
        h('span', { class: 'sub' }, 'Synced to Firebase')
      ]));
      idCard.appendChild(h('div', { class: 'card-body identity-row' }, [
        fbUser.photoURL
          ? h('img', { class: 'identity-photo', src: fbUser.photoURL, alt: '' })
          : avatar(me ? me.id : 'u_self', 'lg'),
        h('div', { class: 'identity-meta' }, [
          h('div', { class: 'identity-name' }, fbUser.displayName || (me && me.name) || 'You'),
          h('div', { class: 'identity-email' }, fbUser.email || ''),
          h('div', { class: 'identity-uid' }, 'uid · ' + fbUser.uid.slice(0, 12) + '…')
        ]),
        h('button', { class: 'btn btn-ghost btn-sm', onClick: signOutFromProfile, style: { marginLeft: 'auto' } }, 'Sign out')
      ]));
      page.appendChild(idCard);
    }

    // Founder-only: link to the admin roster of everyone signed in.
    if (isFounder()) {
      const cAdmin = h('div', { class: 'card', style: { marginBottom: 'var(--s-4)' } });
      const cAdminBody = h('div', { class: 'card-body', style: { display: 'flex', alignItems: 'center', gap: '12px' } });
      cAdminBody.appendChild(h('div', { style: { flex: '1 1 auto' } }, [
        h('div', { style: { fontWeight: 600 } }, 'Admin'),
        h('div', { class: 'small muted' }, 'See everyone who has signed in to Orbit')
      ]));
      cAdminBody.appendChild(h('button', { class: 'btn btn-primary btn-sm', onClick: () => navigate('#/admin') }, 'Open admin →'));
      cAdmin.appendChild(cAdminBody);
      page.appendChild(cAdmin);
    }

    const grid = h('div', { class: 'grid-2' });
    // Account card
    const cAcc = h('div', { class: 'card' });
    cAcc.appendChild(h('div', { class: 'card-header' }, h('h3', {}, 'Account')));
    const cAccBody = h('div', { class: 'card-body' });
    const realEmail = (me.email && !/(^you@example\.com$|@example\.com$)/i.test(me.email)) ? me.email : ((fbUser && fbUser.email) || me.email || '');
    // One saver for every profile field: persists locally AND publishes to your
    // shared profile so co-members see your real name / email / UPI. Fields
    // auto-save when you tap out — this confirms it inline + with a toast.
    async function saveMe(inputEl) {
      await OrbitDB.put('users', me);
      try { if (window.OrbitGroups && OrbitGroups.isReady()) await OrbitGroups.upsertMyProfile({ name: me.name, email: me.email, upi: me.upi, photoURL: me.photoURL }); } catch (_) {}
      renderMeCard();
      if (inputEl) { inputEl.classList.add('saved-flash'); setTimeout(() => inputEl.classList.remove('saved-flash'), 900); }
      toast('Saved ✓', 'pos');
    }
    cAccBody.appendChild(h('div', { class: 'small muted', style: { marginBottom: '10px' } }, 'Changes save automatically as you type.'));
    cAccBody.appendChild(h('div', { style: { display: 'flex', alignItems: 'center', gap: 'var(--s-4)', marginBottom: 'var(--s-4)' } }, [
      avatar(me.id, 'lg'),
      h('div', {}, [
        h('div', { style: { fontSize: '15px', fontWeight: 600 } }, me.name || 'You'),
        h('div', { class: 'small muted' }, realEmail || '—')
      ])
    ]));
    cAccBody.appendChild(formRow('Display name', h('input', { class: 'input', value: me.name || '', onChange: async (e) => { me.name = e.target.value.trim(); await saveMe(e.target); } })));
    cAccBody.appendChild(formRow('Email', h('input', { class: 'input', type: 'email', value: realEmail, placeholder: 'name@email.com', onChange: async (e) => { me.email = e.target.value.trim(); await saveMe(e.target); } })));
    const realPhone = /^\+?91[- ]?99999[- ]?00001$/.test((me.phone || '').replace(/\s/g, '')) ? '' : (me.phone || '');
    cAccBody.appendChild(formRow('Phone', h('input', { class: 'input', type: 'tel', value: realPhone, placeholder: '+91 9xxxxxxxxx', onChange: async (e) => { me.phone = e.target.value.trim(); await saveMe(e.target); } })));
    cAcc.appendChild(cAccBody);
    grid.appendChild(cAcc);

    // UPI / preferences
    const cPref = h('div', { class: 'card' });
    cPref.appendChild(h('div', { class: 'card-header' }, h('h3', {}, 'UPI & preferences')));
    const cPrefBody = h('div', { class: 'card-body' });
    const realUpi = (me.upi && me.upi.toLowerCase() !== 'you@upi') ? me.upi : '';
    cPrefBody.appendChild(formRow('Primary UPI VPA', h('input', { class: 'input mono', value: realUpi, placeholder: 'yourname@bank', onChange: async (e) => { me.upi = e.target.value.trim(); await saveMe(e.target); } })));
    cPrefBody.appendChild(formRow('Default currency', selectInput([
      { v: 'INR', l: '₹ INR' }, { v: 'EUR', l: '€ EUR' }, { v: 'USD', l: '$ USD' }, { v: 'GBP', l: '£ GBP' }
    ], me.defaultCurrency || 'INR', async (v) => { me.defaultCurrency = v; await OrbitDB.put('users', me); toast('Saved'); })));
    // Cream-light is the only theme — toggle removed.
    cPref.appendChild(cPrefBody);
    grid.appendChild(cPref);
    page.appendChild(grid);

    // Data / clean slate
    const cClean = h('div', { class: 'card', style: { marginTop: 'var(--s-4)' } });
    cClean.appendChild(h('div', { class: 'card-header' }, h('h3', {}, 'Data')));
    const cCleanBody = h('div', { class: 'card-body' });
    cCleanBody.appendChild(h('div', { class: 'small muted', style: { marginBottom: '12px' } },
      'Remove the sample data (Goa Trip, Flatmates and the demo people). Your real shared groups and balances stay — they re-sync from the cloud.'));
    cCleanBody.appendChild(h('button', { class: 'btn btn-danger btn-sm', onClick: () => openConfirmModal({
      title: 'Clear demo data?',
      bodyHtml: 'This removes the sample groups, demo people and old local activity from <strong>this device</strong>. Your real shared groups (the ones with people you invited) are kept. This can’t be undone.',
      confirmText: 'Clear demo data',
      danger: true,
      onConfirm: () => clearDemoData()
    }) }, 'Start fresh — clear demo data'));
    cClean.appendChild(cCleanBody);
    page.appendChild(cClean);

    // Recurring expenses panel
    const tmpls = window.OrbitRecurring ? OrbitRecurring.templates(State.expenses) : [];
    if (tmpls.length) {
      const cRec = h('div', { class: 'card', style: { marginTop: 'var(--s-4)' } });
      cRec.appendChild(h('div', { class: 'card-header' }, [
        h('h3', {}, 'Recurring expenses'),
        h('span', { class: 'sub' }, tmpls.length + ' active')
      ]));
      const recBody = h('div', { class: 'card-body', style: { padding: 0 } });
      tmpls.forEach((t) => {
        const g = groupById(t.groupId);
        const next = t.recurring.nextDue ? new Date(t.recurring.nextDue) : null;
        const active = t.recurring.active !== false;
        recBody.appendChild(h('div', { class: 'owes-row', style: { padding: '12px 16px', borderBottom: '1px solid var(--line)' } }, [
          h('div', { style: { width: '32px', height: '32px', borderRadius: '8px', background: 'var(--surface-3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '14px' } }, '↻'),
          h('div', {}, [
            h('div', { class: 'who-name' }, t.title),
            h('div', { class: 'who-sub' }, (g?.name || '—') + ' · ' + OrbitRecurring.freqLabel(t.recurring.freq) +
              (next ? ' · next ' + next.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''))
          ]),
          h('div', { class: 'amt tabular' }, fmtMoney(t.amount, t.currency)),
          h('div', { class: 'actions' }, [
            h('button', { class: 'btn btn-ghost btn-sm', onClick: async () => {
              t.recurring.active = !active;
              await OrbitDB.put('expenses', t);
              State.expenses = State.expenses.map((e) => e.id === t.id ? t : e);
              toast(active ? 'Paused' : 'Resumed', 'pos');
              render();
            } }, active ? 'Pause' : 'Resume'),
            h('button', { class: 'btn btn-ghost btn-sm', onClick: async () => {
              t.recurring = null;
              await OrbitDB.put('expenses', t);
              State.expenses = State.expenses.map((e) => e.id === t.id ? t : e);
              toast('Stopped repeating', 'pos');
              render();
            } }, 'Stop')
          ])
        ]));
      });
      cRec.appendChild(recBody);
      page.appendChild(cRec);
    }

    // People card — contact roster + duplicate reconciliation. The number that
    // matters here is "duplicates": the same human saved twice (e.g. once by
    // Gmail, once by phone-with-a-different-email). Merging keeps their balances
    // together instead of split across two ghosts.
    const contacts = State.users.filter((u) => !u.isSelf);
    const dupPairs = window.OrbitIdentity ? OrbitIdentity.findDuplicatePairs(State.users) : [];
    const cPeople = h('div', { class: 'card', style: { marginTop: 'var(--s-4)' } });
    cPeople.appendChild(h('div', { class: 'card-header' }, h('h3', {}, 'People')));
    const peopleBody = h('div', { class: 'card-body' });
    peopleBody.appendChild(h('div', { class: 'small muted', style: { marginBottom: 'var(--s-3)' } },
      contacts.length + ' saved ' + (contacts.length === 1 ? 'contact' : 'contacts') +
      (dupPairs.length ? ' · ' + dupPairs.length + ' possible ' + (dupPairs.length === 1 ? 'duplicate' : 'duplicates') + ' to review' : ' · no duplicates found')));
    peopleBody.appendChild(h('div', { class: 'btn-row' }, [
      h('button', { class: 'btn btn-sm' + (dupPairs.length ? ' btn-primary' : ''), onClick: openDuplicateReview },
        dupPairs.length ? 'Review duplicates (' + dupPairs.length + ')' : 'Review duplicates')
    ]));
    cPeople.appendChild(peopleBody);
    page.appendChild(cPeople);

    // Data card
    const cData = h('div', { class: 'card', style: { marginTop: 'var(--s-4)' } });
    cData.appendChild(h('div', { class: 'card-header' }, h('h3', {}, 'Data')));
    const dataBody = h('div', { class: 'card-body' });
    dataBody.appendChild(h('div', { class: 'small muted', style: { marginBottom: 'var(--s-3)' } }, 'Orbit stores everything locally in your browser and syncs to Firebase. Export a snapshot for backup, or migrate from another app.'));
    dataBody.appendChild(h('div', { class: 'btn-row' }, [
      h('button', { class: 'btn btn-primary btn-sm', onClick: openSplitwiseImportModal }, 'Import from Splitwise'),
      h('button', { class: 'btn btn-sm', onClick: () => exportReport('pdf') }, 'Export PDF'),
      h('button', { class: 'btn btn-sm', onClick: () => exportReport('xlsx') }, 'Export Excel'),
      h('button', { class: 'btn btn-sm', onClick: exportAllJson }, 'Download JSON'),
      h('button', { class: 'btn btn-sm', onClick: loadDemo }, 'Load demo data'),
      h('button', { class: 'btn btn-sm', onClick: resetToSeed }, 'Clear to empty'),
      h('button', { class: 'btn btn-danger btn-sm', onClick: confirmDeleteAll }, 'Wipe all data')
    ]));
    cData.appendChild(dataBody);
    page.appendChild(cData);

    const legalFoot = h('div', { style: { textAlign: 'center', margin: 'var(--s-6) 0 0', fontSize: '12.5px', color: 'var(--text-3)' } }, [
      h('a', { href: '/privacy.html', style: { color: 'var(--text-2)', fontWeight: '500' } }, 'Privacy Policy'),
      ' · ',
      h('a', { href: '/terms.html', style: { color: 'var(--text-2)', fontWeight: '500' } }, 'Terms of Service')
    ]);
    page.appendChild(legalFoot);

    const credit = h('div', { style: { textAlign: 'center', margin: 'var(--s-2) 0 var(--s-4)', fontSize: '12.5px', color: 'var(--text-3)' } }, [
      'Orbit · Built by ',
      h('a', { href: 'https://www.linkedin.com/in/sushanthvarmasl/', target: '_blank', rel: 'noopener', style: { color: 'var(--accent)', fontWeight: '600' } }, 'Sushanth Varma ↗')
    ]);
    page.appendChild(credit);

    setMain(page);
  }
  async function signOutFromProfile() {
    openConfirmModal({
      title: 'Sign out of Orbit?',
      bodyHtml: 'Your data stays safely synced in Firebase. Sign back in any time to restore it.',
      confirmText: 'Sign out',
      onConfirm: async () => {
        try { await OrbitCloud.signOut(); } catch (e) { toast('Sign-out failed', 'neg'); }
      }
    });
  }
  function buildExportPayload() {
    const u = (id) => State.users.find((x) => x.id === id);
    const g = (id) => State.groups.find((x) => x.id === id);
    const groups = State.groups.map((gr) => ({
      id: gr.id, name: gr.name, currency: gr.currency,
      members: gr.members.map((mid) => ({ id: mid, name: u(mid)?.name || 'Unknown' }))
    }));
    const expenses = State.expenses.slice()
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((e) => ({
        date: e.date,
        group: g(e.groupId)?.name || '—',
        title: e.title,
        category: categoryLabel(e.category),
        currency: e.currency,
        amount: e.amount,
        paidBy: payerLabel(e),
        splits: (e.splits || []).map((s) => ({ user: u(s.userId)?.name || 'Unknown', amount: s.amount })),
        note: e.note || ''
      }));
    const settlements = State.settlements.slice()
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((s) => ({
        date: s.date,
        group: g(s.groupId)?.name || '—',
        fromUser: u(s.fromUser)?.name || 'Unknown',
        toUser: u(s.toUser)?.name || 'Unknown',
        amount: s.amount, currency: s.currency,
        method: s.method || 'manual', note: s.note || ''
      }));
    // Per-currency balances so ₹ and € are never summed into one number.
    const currencies = Array.from(new Set(State.expenses.map((e) => e.currency || 'INR')));
    const balances = [];
    currencies.forEach((cur) => {
      const pair = computePairBalances(State.selfId, null, cur);
      Object.entries(pair).forEach(([uid, amt]) => {
        balances.push({ otherName: u(uid)?.name || 'Unknown', amount: amt, currency: cur });
      });
    });
    const me = u(State.selfId);
    return {
      meta: { exportedAt: new Date().toISOString(), exporterName: me?.name || '' },
      groups, expenses, settlements, balances
    };
  }

  async function exportReport(kind) {
    if (!window.OrbitExport) { toast('Exporter not loaded', 'neg'); return; }
    toast('Preparing ' + kind.toUpperCase() + '…');
    try {
      const payload = buildExportPayload();
      if (kind === 'pdf') await OrbitExport.downloadPDF(payload);
      else await OrbitExport.downloadXLSX(payload);
      toast(kind.toUpperCase() + ' downloaded', 'pos');
    } catch (e) {
      console.error(e);
      toast('Export failed: ' + (e.message || e), 'neg');
    }
  }

  // Restore a previously-exported JSON snapshot. Validates the file, confirms
  // (it replaces current data), then reloads State + re-renders.
  function restoreFromJson() {
    const input = h('input', { type: 'file', accept: 'application/json,.json', style: { display: 'none' } });
    input.addEventListener('change', async (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      let data;
      try { data = JSON.parse(await file.text()); }
      catch (_) { toast('That file isn’t valid JSON', 'neg'); return; }
      openConfirmModal({
        title: 'Restore from backup?',
        bodyHtml: 'This <strong>replaces</strong> your current groups, expenses, settlements and activity with the contents of this file. Export a backup first if you’re unsure.',
        confirmText: 'Restore',
        danger: true,
        onConfirm: async () => {
          try {
            const res = await OrbitDB.importAll(data);
            await loadAll();
            try { State.activity = await OrbitDB.getAll('activity'); } catch (_) {}
            render();
            const n = Object.values(res.counts || {}).reduce((s, x) => s + x, 0);
            toast('Restored ' + n + ' records', 'pos');
          } catch (err) {
            console.error('[restore] failed', err);
            toast(err.message || 'Restore failed', 'neg');
          }
        }
      });
    });
    document.body.appendChild(input);
    input.click();
    setTimeout(() => { try { input.remove(); } catch (_) {} }, 10000);
  }
  async function exportAllJson() {
    const data = await OrbitDB.exportAll();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'orbit-export-' + new Date().toISOString().slice(0, 10) + '.json';
    a.click();
    URL.revokeObjectURL(url);
    toast('Snapshot downloaded', 'pos');
  }

  // ===================================================================
  // SPLITWISE CSV IMPORT
  // ===================================================================
  function openSplitwiseImportModal() {
    if (!window.OrbitImport) { toast('Importer not loaded', 'neg'); return; }

    const state = { parsed: null, mapping: {}, groupName: '', targetGroupId: '__new__', file: null };

    const modal = h('div', { class: 'modal modal-lg' });
    modal.appendChild(h('div', { class: 'modal-head' }, [
      h('h2', {}, 'Import from Splitwise'),
      h('button', { class: 'close', onClick: closeModal }, '×')
    ]));
    const body = h('div', { class: 'modal-body' });
    const footStatus = h('span', { class: 'small muted' }, '');
    const importBtn = h('button', { class: 'btn btn-primary btn-sm', disabled: true, onClick: () => runImport() }, 'Import');
    const foot = h('div', { class: 'modal-foot' }, [
      footStatus,
      h('span', { class: 'spacer' }),
      h('button', { class: 'btn btn-ghost btn-sm', onClick: closeModal }, 'Cancel'),
      importBtn
    ]);

    // Step 1: file picker / drop zone
    const dropZone = h('div', {
      style: {
        border: '1px dashed var(--line-strong)', borderRadius: '10px', padding: '32px 20px',
        textAlign: 'center', background: 'var(--surface-2)', cursor: 'pointer'
      }
    }, [
      h('div', { style: { fontSize: '14px', fontWeight: 600, marginBottom: '6px' } }, 'Drop your Splitwise CSV here'),
      h('div', { class: 'small muted' }, 'In Splitwise: open a group → ⋯ menu → Export as spreadsheet. Then drop the .csv here.'),
      h('div', { style: { marginTop: '12px' } }, [
        h('button', { class: 'btn btn-sm', onClick: () => filePicker.click() }, 'Choose file…')
      ])
    ]);
    const filePicker = h('input', { type: 'file', accept: '.csv,text/csv', style: { display: 'none' } });
    filePicker.addEventListener('change', (e) => onFile(e.target.files[0]));
    dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.style.background = 'var(--surface-3)'; });
    dropZone.addEventListener('dragleave', () => { dropZone.style.background = 'var(--surface-2)'; });
    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.style.background = 'var(--surface-2)';
      if (e.dataTransfer.files[0]) onFile(e.dataTransfer.files[0]);
    });
    body.appendChild(dropZone);
    body.appendChild(filePicker);

    const preview = h('div', { style: { marginTop: '16px' } });
    body.appendChild(preview);

    modal.appendChild(body);
    modal.appendChild(foot);
    openModal(modal);

    async function onFile(file) {
      if (!file) return;
      state.file = file;
      footStatus.textContent = 'Parsing ' + file.name + '…';
      try {
        const text = await file.text();
        const r = OrbitImport.parseSplitwiseCSV(text);
        state.parsed = r;
        renderPreview();
      } catch (e) {
        console.error(e);
        toast('Failed to parse CSV: ' + e.message, 'neg');
        footStatus.textContent = '';
      }
    }

    function renderPreview() {
      preview.innerHTML = '';
      const r = state.parsed;
      if (!r) return;
      if (r.errors.length) {
        preview.appendChild(h('div', { class: 'small', style: { color: 'var(--neg)', marginBottom: '8px' } },
          r.errors.join(' ')));
        importBtn.disabled = true;
        return;
      }

      // Summary
      const summary = h('div', { style: { display: 'flex', gap: '12px', marginBottom: '12px' } }, [
        statTile('Expenses', r.totals.expenseCount),
        statTile('Settlements', r.totals.settlementCount),
        statTile('People', r.people.length),
        statTile('Skipped', r.totals.rowsSkipped)
      ]);
      preview.appendChild(summary);

      // Target group
      const tgRow = h('div', { class: 'form-row' });
      tgRow.appendChild(h('label', {}, 'Import into'));
      const tgSel = h('select', { class: 'select', onChange: (e) => {
        state.targetGroupId = e.target.value;
        groupNameInput.style.display = e.target.value === '__new__' ? '' : 'none';
      } });
      tgSel.appendChild(h('option', { value: '__new__' }, '＋ Create new group'));
      State.groups.forEach((g) => tgSel.appendChild(h('option', { value: g.id }, g.name)));
      const defaultName = (state.file?.name || 'Imported group').replace(/\.csv$/i, '').replace(/_/g, ' ');
      state.groupName = defaultName;
      const groupNameInput = h('input', {
        class: 'input', value: defaultName, placeholder: 'New group name',
        style: { marginTop: '6px' },
        onInput: (e) => { state.groupName = e.target.value; }
      });
      tgRow.appendChild(h('div', {}, [tgSel, groupNameInput]));
      preview.appendChild(tgRow);

      // People mapping
      preview.appendChild(h('div', { class: 'section-title', style: { marginTop: '16px' } }, 'Match people'));
      const peopleTable = h('table', { class: 'tbl', style: { width: '100%' } });
      const peopleBody = h('tbody');
      r.people.forEach((p) => {
        const tr = h('tr');
        tr.appendChild(h('td', { style: { padding: '6px 10px' } }, p.rawName));
        const sel = h('select', { class: 'select', onChange: (e) => { state.mapping[p.rawName] = e.target.value; } });
        sel.appendChild(h('option', { value: '__new__' }, '＋ Create new contact'));
        // Try to auto-match by name
        let autoMatched = null;
        State.users.forEach((u) => {
          const op = h('option', { value: u.id }, u.name + (u.isSelf ? ' (you)' : ''));
          sel.appendChild(op);
          if (!autoMatched && u.name.toLowerCase() === p.rawName.toLowerCase()) {
            autoMatched = u.id;
            op.selected = true;
          }
        });
        // Auto-map first occurrence of self if name matches signed-in
        const me = State.users.find((u) => u.isSelf);
        if (!autoMatched && me && (p.rawName.toLowerCase() === (me.name || '').toLowerCase() ||
            p.rawName.toLowerCase() === 'you')) {
          Array.from(sel.options).forEach((o) => { if (o.value === me.id) o.selected = true; });
          autoMatched = me.id;
        }
        state.mapping[p.rawName] = autoMatched || '__new__';
        tr.appendChild(h('td', { style: { padding: '6px 10px' } }, sel));
        peopleBody.appendChild(tr);
      });
      peopleTable.appendChild(peopleBody);
      preview.appendChild(peopleTable);

      if (r.warnings.length) {
        preview.appendChild(h('div', { class: 'small muted', style: { marginTop: '12px' } },
          r.warnings.length + ' warning' + (r.warnings.length > 1 ? 's' : '') + ' — multi-payer rows simplified to single-payer.'));
      }

      footStatus.textContent = 'Ready to import ' + (r.totals.expenseCount + r.totals.settlementCount) + ' rows';
      importBtn.disabled = false;
    }

    function statTile(label, val) {
      return h('div', { style: {
        flex: 1, padding: '10px 12px', background: 'var(--surface-2)', borderRadius: '8px',
        border: '1px solid var(--line)'
      } }, [
        h('div', { class: 'small muted', style: { textTransform: 'uppercase', letterSpacing: '0.06em', fontSize: '10px' } }, label),
        h('div', { class: 'tabular', style: { fontSize: '20px', fontWeight: 600, marginTop: '2px' } }, String(val))
      ]);
    }

    async function runImport() {
      const r = state.parsed;
      if (!r) return;
      importBtn.disabled = true;
      footStatus.textContent = 'Importing…';

      // 1. Resolve users
      const nameToId = {};
      for (const p of r.people) {
        const m = state.mapping[p.rawName];
        if (m && m !== '__new__') {
          nameToId[p.rawName] = m;
        } else {
          const newId = uid('u');
          const u = {
            id: newId,
            name: p.rawName,
            handle: '@' + p.rawName.toLowerCase().replace(/[^a-z0-9]/g, ''),
            email: '', upi: '', avatar: 'av-c' + (((Object.keys(nameToId).length) % 8) + 1),
            isSelf: false, phone: ''
          };
          await OrbitDB.put('users', u);
          State.users.push(u);
          nameToId[p.rawName] = newId;
        }
      }

      // 2. Resolve target group
      let groupId;
      if (state.targetGroupId === '__new__') {
        const memberIds = Object.values(nameToId);
        const me = State.users.find((u) => u.isSelf);
        if (me && !memberIds.includes(me.id)) memberIds.unshift(me.id);
        const g = {
          id: uid('g'),
          name: state.groupName || 'Imported group',
          category: 'friends',
          currency: r.expenses[0]?.currency || r.settlements[0]?.currency || 'INR',
          members: memberIds,
          createdAt: new Date().toISOString(),
          emoji: 'IM',
          banner: 'friends'
        };
        await OrbitDB.put('groups', g);
        State.groups.push(g);
        groupId = g.id;
      } else {
        groupId = state.targetGroupId;
        // Ensure imported people are members of the picked group
        const g = State.groups.find((x) => x.id === groupId);
        if (g) {
          const adds = Object.values(nameToId).filter((id) => !g.members.includes(id));
          if (adds.length) {
            g.members = g.members.concat(adds);
            await OrbitDB.put('groups', g);
          }
        }
      }

      // 3. Insert expenses
      let added = 0;
      for (const ex of r.expenses) {
        const paidBy = nameToId[ex.paidByName];
        if (!paidBy) continue;
        const splits = ex.splits.map((s) => ({ userId: nameToId[s.rawName], amount: s.amount }))
          .filter((s) => s.userId);
        const obj = {
          id: uid('e'),
          groupId,
          title: ex.title,
          amount: ex.amount,
          currency: ex.currency,
          paidBy,
          splitMode: 'exact',
          splits,
          category: ex.category,
          date: OrbitImport.toISODate(ex.__rawDate),
          note: 'Imported from Splitwise'
        };
        await OrbitDB.put('expenses', obj);
        State.expenses.push(obj);
        added++;
      }

      // 4. Insert settlements
      let addedSet = 0;
      for (const st of r.settlements) {
        const fromUser = nameToId[st.fromName];
        const toUser = nameToId[st.toName];
        if (!fromUser || !toUser) continue;
        const s = {
          id: uid('s'),
          groupId,
          fromUser, toUser,
          amount: st.amount,
          currency: st.currency,
          method: 'manual',
          date: OrbitImport.toISODate(st.__rawDate),
          note: st.note || 'Imported from Splitwise'
        };
        await OrbitDB.put('settlements', s);
        State.settlements.push(s);
        addedSet++;
      }

      if (window.OrbitActivity) await OrbitActivity.log(OrbitDB, {
        ...actorStamp(), action: 'import', entityType: 'group',
        entityId: groupId, groupId,
        meta: { expenses: added, settlements: addedSet, source: 'splitwise-csv' }
      });
      closeModal();
      toast('Imported ' + added + ' expense' + (added !== 1 ? 's' : '') +
            (addedSet ? ' + ' + addedSet + ' settlement' + (addedSet !== 1 ? 's' : '') : '') + ' ✓', 'pos');
      render();
    }
  }
  function confirmDeleteAll() {
    openConfirmModal({
      title: 'Wipe all data?', bodyHtml: 'Clears <strong>your own data</strong> on this device and your account. Shared groups stay with their other members. There is no undo.', confirmText: 'Wipe everything', danger: true,
      onConfirm: async () => {
        await OrbitDB.clearAll();
        await OrbitDB.setMeta('seeded', false);
        // Also clear the cloud copy, else enterApp re-pulls it on next load.
        try { if (window.OrbitCloud && OrbitCloud.user()) { for (const s of ['users','groups','expenses','settlements','activity','meta','fin_accounts','fin_investments','fin_loans','fin_txns','fin_budgets','fin_goals','fin_subs','fin_recurring','fin_nwhistory']) await OrbitCloud.clearStore(s); } } catch (_) {}
        toast('All data cleared');
        location.reload();
      }
    });
  }
  async function resetToSeed() {
    openConfirmModal({
      title: 'Clear all data?', danger: true,
      bodyHtml: 'This removes every group, expense and friend, leaving you with a clean, empty Orbit. This cannot be undone.',
      confirmText: 'Clear everything',
      onConfirm: async () => {
        await OrbitDB.clearAll();
        await OrbitDB.setMeta('seeded', false);
        try { if (window.OrbitCloud && OrbitCloud.user()) { for (const s of ['users','groups','expenses','settlements','activity','meta','fin_accounts','fin_investments','fin_loans','fin_txns','fin_budgets','fin_goals','fin_subs','fin_recurring','fin_nwhistory']) await OrbitCloud.clearStore(s); } } catch (_) {}
        location.reload();
      }
    });
  }
  async function loadDemo() {
    openConfirmModal({
      title: 'Load demo data?', bodyHtml: 'Adds the sample Indian dataset (groups, friends, expenses) so you can explore. You can clear it afterwards.', confirmText: 'Load demo',
      onConfirm: async () => {
        if (window.loadDemoData) await loadDemoData();
        try { if (window.OrbitCloud && OrbitCloud.user()) await OrbitCloud.pushAll(); } catch (_) {}
        location.reload();
      }
    });
  }
  function setTheme(t) {
    State.theme = t;
    document.documentElement.dataset.theme = t;
    // localStorage drives the no-flash bootstrap in index.html; meta keeps it
    // in the synced store too.
    try { localStorage.setItem('orbit_theme', t); } catch (_) {}
    OrbitDB.setMeta('theme', t);
    const m = document.querySelector('meta[name=theme-color]');
    if (m) m.setAttribute('content', t === 'dark' ? '#0C0B16' : '#F6F2E8');
    render();   // re-render so theme-aware chart/spark colors repaint
  }

  // ===================================================================
  // MODALS
  // ===================================================================
  let _modalReturnFocus = null;
  let _modalKeydown = null;
  function closeModal() {
    const root = $('#modalRoot');
    if (_modalKeydown) { document.removeEventListener('keydown', _modalKeydown, true); _modalKeydown = null; }
    root.innerHTML = '';
    document.body.style.overflow = '';
    const app = $('#app');
    if (app) { app.removeAttribute('aria-hidden'); app.removeAttribute('inert'); }
    // Restore focus to whatever opened the modal (keyboard users land back where
    // they were instead of on <body>).
    if (_modalReturnFocus && document.contains(_modalReturnFocus)) { try { _modalReturnFocus.focus(); } catch (_) {} }
    _modalReturnFocus = null;
  }
  function openModal(content) {
    const root = $('#modalRoot');
    _modalReturnFocus = document.activeElement;
    root.innerHTML = '';
    // Dialog semantics so AT announces it as a modal and labels it by its heading.
    content.setAttribute('role', 'dialog');
    content.setAttribute('aria-modal', 'true');
    const head = content.querySelector('h1,h2,h3');
    if (head) {
      if (!head.id) head.id = 'modal-title-' + Math.random().toString(36).slice(2, 7);
      content.setAttribute('aria-labelledby', head.id);
    }
    const backdrop = h('div', { class: 'modal-backdrop', onClick: (e) => { if (e.target === backdrop) closeModal(); } });
    backdrop.appendChild(content);
    root.appendChild(backdrop);
    document.body.style.overflow = 'hidden';
    // Make the rest of the page inert so Tab can't escape behind the modal.
    const app = $('#app');
    if (app) { app.setAttribute('aria-hidden', 'true'); app.setAttribute('inert', ''); }

    const focusables = () => Array.from(content.querySelectorAll(
      'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'
    )).filter((el) => el.offsetParent !== null || el === document.activeElement);
    // Trap Tab; handle Escape here (capture phase) so it works even while typing
    // in a field — the global shortcut handler used to swallow it.
    _modalKeydown = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeModal(); return; }
      if (e.key !== 'Tab') return;
      const f = focusables();
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', _modalKeydown, true);
    // Initial focus: first field, else first focusable, else the dialog.
    setTimeout(() => {
      const target = content.querySelector('input,textarea,select') || focusables()[0] || content;
      if (target && target.focus) { try { target.focus(); } catch (_) {} }
    }, 30);
  }
  // Read a File/Blob into a data URL. Fallback for when OrbitOCR (which has a
  // downscaling version) hasn't loaded; this stores the image as-is.
  function fileToDataURL(fileOrBlob) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = () => reject(fr.error || new Error('Could not read file'));
      fr.readAsDataURL(fileOrBlob);
    });
  }

  // Lightweight image lightbox. Appended to <body> as its own overlay so it
  // layers ON TOP of an open modal (e.g. the expense editor) and closing it
  // returns to that modal rather than dismissing it.
  function openReceiptViewer(src) {
    if (!src) return;
    const overlay = h('div', {
      style: {
        position: 'fixed', inset: '0', zIndex: '4000',
        background: 'rgba(10,10,15,0.78)', backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px'
      }
    });
    const img = h('img', {
      src, alt: 'Receipt',
      style: { maxWidth: '100%', maxHeight: '100%', borderRadius: '12px', boxShadow: '0 24px 60px rgba(0,0,0,0.5)' }
    });
    function close() {
      overlay.remove();
      document.removeEventListener('keydown', onKey, true);
    }
    function onKey(e) { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } }
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    img.addEventListener('click', close);
    document.addEventListener('keydown', onKey, true);
    overlay.appendChild(img);
    document.body.appendChild(overlay);
  }

  function openGeminiKeyModal() {
    return new Promise((resolve) => {
      let resolved = false;
      const input = h('input', {
        class: 'input mono',
        type: 'password',
        placeholder: 'AIzaSy…',
        autocomplete: 'off',
        spellcheck: 'false',
        style: { width: '100%' }
      });
      const finish = (v) => { if (resolved) return; resolved = true; closeModal(); resolve(v); };
      const modal = h('div', { class: 'modal modal-sm' }, [
        h('div', { class: 'modal-head' }, [
          h('h2', {}, 'Add your Gemini API key'),
          h('button', { class: 'close', onClick: () => finish(null) }, '×')
        ]),
        h('div', { class: 'modal-body' }, [
          h('p', { class: 'small muted', style: { margin: '0 0 12px' } },
            'Orbit uses Google Gemini for natural-language expense parsing. The key is stored only in your browser and synced to your private Firestore — never sent anywhere else.'),
          h('p', { class: 'small', style: { margin: '0 0 16px' } }, [
            'Get a free key at ',
            h('a', { href: 'https://aistudio.google.com/apikey', target: '_blank', rel: 'noopener', style: { color: 'var(--accent)' } }, 'aistudio.google.com/apikey'),
            ' — no card required.'
          ]),
          input
        ]),
        h('div', { class: 'modal-foot' }, [
          h('button', { class: 'btn btn-ghost btn-sm', onClick: () => finish(null) }, 'Cancel'),
          h('button', { class: 'btn btn-primary btn-sm', onClick: async () => {
            const k = input.value.trim();
            if (!k) { input.focus(); return; }
            await OrbitAI.setKey(k);
            finish(k);
          } }, 'Save key')
        ])
      ]);
      openModal(modal);
      setTimeout(() => input.focus(), 50);
      input.addEventListener('keydown', async (ev) => {
        if (ev.key === 'Enter') {
          const k = input.value.trim();
          if (!k) return;
          await OrbitAI.setKey(k);
          finish(k);
        }
      });
    });
  }

  function openConfirmModal({ title, bodyHtml, confirmText = 'Confirm', danger = false, onConfirm }) {
    const modal = h('div', { class: 'modal modal-sm confirm-modal' }, [
      h('div', { class: 'modal-head' }, [h('h2', {}, title), h('button', { class: 'close', onClick: closeModal }, '×')]),
      h('div', { class: 'modal-body' }, h('div', { class: 'confirm-text', html: bodyHtml })),
      h('div', { class: 'modal-foot' }, [
        h('button', { class: 'btn btn-ghost btn-sm', onClick: closeModal }, 'Cancel'),
        h('button', { class: 'btn ' + (danger ? 'btn-danger' : 'btn-primary') + ' btn-sm', onClick: async () => { await onConfirm(); closeModal(); } }, confirmText)
      ])
    ]);
    openModal(modal);
  }

  // Generic info modal — title + arbitrary body node + optional action buttons.
  function openInfoModal({ title, body, actions = [] }) {
    const foot = h('div', { class: 'modal-foot' }, [
      ...actions.map((a) => h('button', { class: 'btn btn-ghost btn-sm', onClick: () => { a.onClick && a.onClick(); } }, a.label)),
      h('button', { class: 'btn btn-primary btn-sm', onClick: closeModal }, 'Done')
    ]);
    const modal = h('div', { class: 'modal modal-sm' }, [
      h('div', { class: 'modal-head' }, [h('h2', {}, title), h('button', { class: 'close', onClick: closeModal }, '\u00d7')]),
      h('div', { class: 'modal-body' }, body),
      foot
    ]);
    openModal(modal);
  }

  // ===================================================================
  // IDENTITY RESOLUTION (owner-side) — see identity.js
  // Decide "same person or new person?" when adding someone, without ever
  // silently merging two different humans. Exact handle = certain reuse;
  // same-name-but-new-handle = ASK; otherwise create. Backed by OrbitIdentity.
  // ===================================================================

  // Promise-based single-choice modal. `options` = [{ label, sub?, value,
  // primary? }]. Resolves to the chosen value, or null on cancel/backdrop.
  function openChoice({ title, message, options, cancelLabel = 'Cancel' }) {
    return new Promise((resolve) => {
      let done = false;
      const finish = (v) => { if (done) return; done = true; closeModal(); resolve(v); };
      const modal = h('div', { class: 'modal modal-sm' }, [
        h('div', { class: 'modal-head' }, [h('h2', {}, title), h('button', { class: 'close', onClick: () => finish(null) }, '×')])
      ]);
      const body = h('div', { class: 'modal-body' });
      if (message) body.appendChild(h('p', { class: 'small muted', style: { marginTop: 0 } }, message));
      const list = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '4px' } });
      options.forEach((o) => {
        list.appendChild(h('button', {
          class: 'btn' + (o.primary ? ' btn-primary' : ''),
          style: { width: '100%', justifyContent: 'flex-start', textAlign: 'left', flexDirection: 'column', alignItems: 'flex-start', gap: '2px', padding: '10px 12px', height: 'auto' },
          onClick: () => finish(o.value)
        }, [
          h('span', { style: { fontWeight: 600 } }, o.label),
          o.sub ? h('span', { class: 'small muted' }, o.sub) : null
        ]));
      });
      body.appendChild(list);
      modal.appendChild(body);
      modal.appendChild(h('div', { class: 'modal-foot' }, [
        h('button', { class: 'btn btn-ghost btn-sm', onClick: () => finish(null) }, cancelLabel)
      ]));
      openModal(modal);
    });
  }

  // Short human label of the handles a contact is known by, e.g.
  // "ashwini@gmail.com · +91 98765 43210". Used in the "same person?" prompt.
  function handleSummary(u) {
    if (!window.OrbitIdentity) return u.email || u.phone || 'no email/phone';
    const { emails, phones } = OrbitIdentity.handlesOf(u);
    const all = emails.concat(phones);
    return all.length ? all.join(' · ') : 'no email/phone';
  }

  // Resolve a typed/picked person to a contact id, creating, reusing, or — when
  // it's genuinely ambiguous (same name, different handle) — ASKING first.
  // Returns the contact id, or null if the user cancelled the prompt.
  async function resolvePersonContact(candidate, opts = {}) {
    const nm = (candidate.name || '').trim();
    const ne = normEmail(candidate.email), np = normPhone(candidate.phone);
    const ident = window.OrbitIdentity;

    // Fallback (module missing): legacy exact-name reuse.
    if (!ident) {
      const ex = State.users.find((u) => !u.isSelf && u.name.toLowerCase() === nm.toLowerCase());
      if (ex) return ex.id;
      const u = { id: uid('u'), name: nm, isSelf: false, avatar: 'av-c' + ((State.users.length % 8) + 1), email: ne, phone: np, upi: '' };
      await OrbitDB.put('users', u); State.users.push(u); return u.id;
    }

    // Absorb any new handle the user typed into an existing contact + persist.
    const reuse = async (existing) => {
      const merged = ident.absorbHandles(existing, { email: ne, phone: np });
      const changed = JSON.stringify(merged) !== JSON.stringify(existing);
      if (changed) { Object.assign(existing, merged); await OrbitDB.put('users', existing); }
      return existing.id;
    };
    const createNew = async () => {
      const u = { id: uid('u'), name: nm, isSelf: false, avatar: 'av-c' + ((State.users.length % 8) + 1), email: ne, phone: np, upi: '' };
      await OrbitDB.put('users', u); State.users.push(u); return u.id;
    };

    const allowPrompt = opts.allowPrompt !== false;
    const r = ident.resolve({ name: nm, email: ne, phone: np }, State.users, { excludeIds: opts.excludeIds || [] });
    if (r.kind === 'exact') return reuse(r.user);
    if (r.kind === 'ambiguous' && !allowPrompt) {
      // Caller can't host a prompt (e.g. inline field inside another modal).
      // Fall back to the long-standing safe default: reuse the first same-name
      // contact for a name-only add; the duplicate can be merged later.
      return reuse(r.candidates[0]);
    }
    if (r.kind === 'ambiguous') {
      // Same name, but the handle is new/different — could be the same person or
      // a namesake. Let the owner decide; never guess.
      const options = r.candidates.map((c) => ({
        label: 'Same as ' + c.name, sub: handleSummary(c), value: c.id, primary: false
      }));
      options.push({ label: 'No — add as a new person', sub: nm + (ne || np ? ' · ' + [ne, np].filter(Boolean).join(' · ') : ''), value: '__new__', primary: true });
      const choice = await openChoice({
        title: 'Is this someone you already have?',
        message: 'You already have ' + (r.candidates.length > 1 ? 'people' : 'someone') + ' named “' + nm + '”. Linking keeps their balances together; a new person stays separate.',
        options
      });
      if (choice === null) return null;            // cancelled
      if (choice === '__new__') return createNew();
      const picked = State.users.find((u) => u.id === choice);
      return picked ? reuse(picked) : createNew();
    }
    return createNew();
  }

  // Apply a non-destructive merge of two local contacts (drop -> keep): unions
  // handles and relabels every expense / settlement / group membership in ONE
  // IndexedDB transaction, then reloads State. Amounts are untouched, so
  // balances are identical before and after. Mirrors the cloud claimPending()
  // rewrite for the local ledger.
  async function applyContactMerge(keepId, dropId) {
    if (!window.OrbitIdentity) { toast('Identity module not loaded', 'neg'); return false; }
    const plan = OrbitIdentity.planMerge(keepId, dropId, {
      users: State.users, groups: State.groups, expenses: State.expenses, settlements: State.settlements
    });
    await OrbitDB.writeTx(plan.ops);
    // Mirror the relabel to the cloud (best-effort) so a synced device agrees.
    try {
      if (window.OrbitCloud && OrbitCloud.isReady && OrbitCloud.isReady()) {
        for (const op of plan.ops) {
          if (op.op === 'delete') OrbitCloud.deleteOne(op.store, op.value);
          else OrbitCloud.write(op.store, op.value);
        }
      }
    } catch (_) {}
    try {
      State.users = await OrbitDB.getAll('users');
      State.groups = await OrbitDB.getAll('groups');
      State.expenses = await OrbitDB.getAll('expenses');
      State.settlements = await OrbitDB.getAll('settlements');
    } catch (_) {}
    return plan.touched;
  }

  // Count how much ledger a contact touches — shown in the merge prompt so the
  // owner keeps the record that already carries history.
  function contactFootprint(id) {
    const groups = State.groups.filter((g) => Array.isArray(g.members) && g.members.includes(id)).length;
    const expenses = State.expenses.filter((e) => e.paidBy === id ||
      (Array.isArray(e.splits) && e.splits.some((s) => s && s.userId === id))).length;
    return { groups, expenses };
  }

  // Review + merge likely-duplicate contacts (same human saved twice). This is
  // the cleanup half of identity resolution: resolve() stops NEW duplicates;
  // this reconciles the ones already in the book.
  function openDuplicateReview() {
    const modal = h('div', { class: 'modal modal-md' });
    modal.appendChild(h('div', { class: 'modal-head' }, [
      h('h2', {}, 'Review duplicate people'),
      h('button', { class: 'close', onClick: closeModal }, '×')
    ]));
    const body = h('div', { class: 'modal-body' });
    modal.appendChild(body);
    modal.appendChild(h('div', { class: 'modal-foot' }, [h('button', { class: 'btn btn-ghost btn-sm', onClick: closeModal }, 'Done')]));

    function fp(id) { const f = contactFootprint(id); return f.groups + ' group' + (f.groups === 1 ? '' : 's') + ' · ' + f.expenses + ' expense' + (f.expenses === 1 ? '' : 's'); }
    function personCell(u) {
      return h('div', { style: { display: 'flex', gap: '10px', alignItems: 'center', minWidth: 0 } }, [
        avatar(u.id, 'sm'),
        h('div', { style: { minWidth: 0 } }, [
          h('div', { style: { fontWeight: 600 } }, u.name + (u.isSelf ? ' (you)' : '')),
          h('div', { class: 'small muted', style: { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, handleSummary(u)),
          h('div', { class: 'small muted' }, fp(u.id))
        ])
      ]);
    }

    function paint() {
      body.innerHTML = '';
      const pairs = window.OrbitIdentity ? OrbitIdentity.findDuplicatePairs(State.users) : [];
      if (!pairs.length) {
        body.appendChild(h('div', { style: { textAlign: 'center', padding: '24px 8px', color: 'var(--text-3)' } }, [
          h('div', { style: { fontSize: '15px', fontWeight: 600, color: 'var(--text-2)' } }, 'No duplicates found'),
          h('div', { class: 'small muted', style: { marginTop: '4px' } }, 'Everyone in your book looks distinct.')
        ]));
        return;
      }
      body.appendChild(h('p', { class: 'small muted', style: { marginTop: 0 } },
        'These look like the same person saved twice. Merging unions their emails/phones and moves every expense, settlement and group onto one record — balances are preserved exactly.'));
      pairs.forEach((pair) => {
        const reason = pair.reason === 'handle' ? 'Shares an email or phone' : 'Same name';
        const card = h('div', { class: 'card', style: { marginTop: '10px' } }, [
          h('div', { class: 'card-body', style: { display: 'flex', flexDirection: 'column', gap: '10px' } }, [
            h('div', { class: 'small', style: { color: 'var(--text-3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', fontSize: '11px' } }, reason),
            personCell(pair.a),
            personCell(pair.b),
            h('div', { class: 'btn-row' }, [
              h('button', { class: 'btn btn-primary btn-sm', onClick: () => doMerge(pair.a, pair.b) }, 'Merge'),
              h('button', { class: 'btn btn-ghost btn-sm', onClick: () => { /* skip: just leave them */ toast('Left separate'); } }, 'Not the same')
            ])
          ])
        ]);
        body.appendChild(card);
      });
    }

    async function doMerge(a, b) {
      // Decide which record survives. Self always survives; otherwise let the
      // owner pick, defaulting to the one with the larger ledger footprint.
      let keep, drop;
      if (a.isSelf) { keep = a; drop = b; }
      else if (b.isSelf) { keep = b; drop = a; }
      else {
        const choice = await openChoice({
          title: 'Which record to keep?',
          message: 'The other one is merged in and removed. All its expenses move over — nothing is lost.',
          options: [
            { label: 'Keep ' + a.name, sub: handleSummary(a) + ' · ' + fp(a.id), value: a.id, primary: true },
            { label: 'Keep ' + b.name, sub: handleSummary(b) + ' · ' + fp(b.id), value: b.id }
          ]
        });
        if (choice === null) { openDuplicateReview(); return; } // reopen list after cancel
        keep = choice === a.id ? a : b;
        drop = choice === a.id ? b : a;
      }
      try {
        const touched = await applyContactMerge(keep.id, drop.id);
        toast('Merged into ' + keep.name + (touched ? ' · ' + touched.expenses + ' expenses moved' : ''), 'pos');
      } catch (e) {
        console.warn('[identity] merge failed', e);
        toast('Couldn’t merge: ' + (e.message || 'error'), 'neg');
      }
      // openChoice closed the modal; reopen a fresh review reflecting the merge.
      openDuplicateReview();
    }

    paint();
    openModal(modal);
  }

  // ---- New group modal ----
  // The signed-in user's saved default currency (Profile → preferences), used
  // to pre-select the currency on new groups/expenses. Falls back to INR.
  function selfDefaultCurrency() {
    const me = State.users.find((u) => u.isSelf);
    return (me && me.defaultCurrency) || 'INR';
  }
  function openNewGroup() {
    const data = { name: '', category: 'friends', currency: selfDefaultCurrency(), members: [State.selfId], newMember: '', shared: false };
    const modal = h('div', { class: 'modal modal-lg' });
    modal.appendChild(h('div', { class: 'modal-head' }, [h('h2', {}, 'Create a group'), h('button', { class: 'close', onClick: closeModal }, '×')]));
    const body = h('div', { class: 'modal-body' });
    body.appendChild(formRow('Group name', h('input', { class: 'input input-lg', placeholder: 'e.g. Goa weekend, Flatmates…', onInput: (e) => { data.name = e.target.value; } })));
    body.appendChild(h('div', { class: 'input-row' }, [
      formRow('Type', selectInput([
        { v: 'friends', l: 'Friends' }, { v: 'trip', l: 'Trip' }, { v: 'household', l: 'Household' }, { v: 'work', l: 'Work' }
      ], 'friends', (v) => { data.category = v; })),
      formRow('Default currency', selectInput([
        { v: 'INR', l: '₹ INR' }, { v: 'EUR', l: '€ EUR' }, { v: 'USD', l: '$ USD' }, { v: 'GBP', l: '£ GBP' }
      ], 'INR', (v) => { data.currency = v; }))
    ]));

    // Members section
    body.appendChild(h('div', { class: 'section-title', style: { marginTop: 'var(--s-4)' } }, 'Members'));
    const memList = h('div', { class: 'member-list' });
    function renderMems() {
      memList.innerHTML = '';
      data.members.forEach((mid) => {
        const u = State.users.find((x) => x.id === mid);
        if (!u) return;
        memList.appendChild(h('div', { class: 'member-row checked' }, [
          h('span', { class: 'cb' }, '✓'),
          avatar(mid, 'sm'),
          h('span', { class: 'name' }, u.name + (u.isSelf ? ' (you)' : '')),
          !u.isSelf ? h('button', { class: 'btn btn-ghost btn-sm', onClick: () => { data.members = data.members.filter((x) => x !== mid); renderMems(); } }, 'Remove') : null
        ]));
      });
    }
    renderMems();
    body.appendChild(memList);

    // ── Add members — two clean paths, no redundancy ──
    // 1) "Add from contacts" (mobile): one tap captures name + phone + email,
    //    so the person can auto-claim their share when they sign in.
    // 2) A single name field that autocompletes your already-saved contacts
    //    (datalist) and creates a new one if the name is new.
    function addMemberById(id) { if (id && !data.members.includes(id)) { data.members.push(id); renderMems(); } }
    async function addByName(nm) {
      const v = (nm || '').trim();
      if (!v) return;
      // Resolve to an existing contact (reuse) or create — and if there are
      // multiple same-name contacts, ask which one rather than guessing.
      // Match against all contacts; addMemberById dedups if already picked.
      const id = await resolvePersonContact({ name: v }, { allowPrompt: false });
      if (id) addMemberById(id);
    }
    if (contactsSupported()) {
      const pickBtn = h('button', { class: 'btn', style: { marginTop: '8px', width: '100%', justifyContent: 'center', gap: '8px' } }, [
        h('span', { html: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="3" width="16" height="18" rx="3"/><circle cx="12" cy="10" r="2.6"/><path d="M8 17c0-2 1.8-3 4-3s4 1 4 3"/></svg>' }),
        'Add from contacts'
      ]);
      pickBtn.addEventListener('click', async () => {
        const c = await pickFromContacts();
        if (!c || !c.name) return;
        const u = { id: uid('u'), name: c.name, isSelf: false, avatar: 'av-c' + ((State.users.length % 8) + 1), email: normEmail(c.email), phone: normPhone(c.phone), upi: '' };
        await OrbitDB.put('users', u);
        State.users.push(u);
        addMemberById(u.id);
        toast('Added ' + c.name);
      });
      body.appendChild(pickBtn);
    }
    const dlId = 'ng-saved-contacts';
    const dl = h('datalist', { id: dlId });
    State.users.filter((u) => !u.isSelf).forEach((u) => dl.appendChild(h('option', { value: u.name })));
    body.appendChild(dl);
    const addRow = h('div', { style: { display: 'flex', gap: '8px', marginTop: '8px' } });
    const nameInp = h('input', { class: 'input', list: dlId, placeholder: contactsSupported() ? 'or add by name' : 'Add by name', style: { flex: '1 1 auto', minWidth: 0 } });
    nameInp.addEventListener('keydown', async (e) => { if (e.key === 'Enter') { e.preventDefault(); await addByName(nameInp.value); nameInp.value = ''; } });
    addRow.appendChild(nameInp);
    addRow.appendChild(h('button', { class: 'btn btn-sm', style: { flexShrink: 0 }, onClick: async () => { await addByName(nameInp.value); nameInp.value = ''; } }, 'Add'));
    body.appendChild(addRow);

    // Shared (multi-user) toggle — only when signed in to the cloud layer.
    // On, the group is created in Firestore too, so members you invite see
    // it live on their own devices. Off, it stays on this device only.
    if (canShare()) {
      body.appendChild(h('div', { class: 'section-title', style: { marginTop: 'var(--s-4)' } }, 'Sharing'));
      const sw = orbitSwitch(data.shared, (on) => { data.shared = on; });
      const row = h('label', { class: 'share-toggle' }, [
        h('div', {}, [
          h('div', { class: 'share-toggle-title' }, 'Sync with members'),
          h('div', { class: 'small muted' }, 'Create a shared group in the cloud so people you invite see it live. Off keeps it on this device.')
        ]),
        sw
      ]);
      body.appendChild(row);
    }

    modal.appendChild(body);
    modal.appendChild(h('div', { class: 'modal-foot' }, [
      h('button', { class: 'btn btn-ghost btn-sm', onClick: closeModal }, 'Cancel'),
      h('button', { class: 'btn btn-primary btn-sm', onClick: async (ev) => {
        if (!data.name.trim()) { toast('Name required', 'neg'); return; }
        if (data.members.length < 2) { toast('At least 2 members required', 'neg'); return; }
        const g = {
          id: uid('g'), name: data.name.trim(),
          category: data.category, currency: data.currency,
          members: data.members, createdAt: todayISO(),
          emoji: data.name.trim().slice(0, 2).toUpperCase(),
          banner: data.category
        };
        // Shared: create the Firestore group first and adopt ITS id as the
        // local id, so the realtime echo merges onto this same record.
        if (data.shared && canShare()) {
          const btn = ev.currentTarget; btn.disabled = true; btn.textContent = 'Creating…';
          try {
            const sharedId = await OrbitGroups.createGroup({ name: g.name, currency: g.currency, emoji: g.emoji, category: g.category });
            g.id = sharedId; g.shared = true; g.sharedId = sharedId;
            // Stamp the creator locally so ownership (e.g. who can remove
            // members) is recognised immediately, before the realtime echo.
            g.createdBy = OrbitGroups.currentUid();
            // Register every added member who has an email/phone as a claimable
            // ghost, so they auto-link to their share when they sign in.
            for (const mid of data.members) {
              if (mid === State.selfId) continue;
              const m = State.users.find((x) => x.id === mid);
              if (m && (m.email || m.phone)) {
                try { await OrbitGroups.addGhostToGroup(sharedId, { ghostId: mid, name: m.name, email: m.email, phone: m.phone }); }
                catch (e) { console.warn('[Phase 2] ghost register failed', e); }
              }
            }
          } catch (e) {
            console.warn('[Phase D] shared group create failed', e);
            toast('Couldn’t create a shared group — saved on this device only', 'neg');
            g.shared = false; g.sharedId = null;
          } finally { btn.disabled = false; btn.textContent = 'Create group'; }
        }
        await OrbitDB.put('groups', g);
        State.groups.push(g);
        closeModal();
        renderSidebarGroups();
        toast(g.shared ? 'Shared group created' : 'Group created', 'pos');
        navigate('#/groups/' + g.id);
        // Offer to send invite links right after creating a shared group.
        if (g.shared) setTimeout(() => inviteToGroup(g), 350);
      } }, 'Create group')
    ]));
    openModal(modal);
  }

  // Mobile "More" sheet — the bottom tab bar only has 5 slots, so the nav
  // destinations that don't fit (Expenses, Settle up, Trips, Analytics,
  // Profile) live here, plus a quick "New group" action.
  function openMoreMenu() {
    const items = [
      { route: 'expenses', label: 'Expenses', icon: 'E' },
      { route: 'settle', label: 'Settle up', icon: 'S' },
      { route: 'trips', label: 'Trips', icon: 'T' },
      { route: 'analytics', label: 'Analytics', icon: 'N' },
      { route: 'profile', label: 'Profile', icon: 'P' }
    ];
    const modal = h('div', { class: 'modal modal-sm' });
    modal.appendChild(h('div', { class: 'modal-head' }, [h('h2', {}, 'More'), h('button', { class: 'close', onClick: closeModal }, '×')]));
    const body = h('div', { class: 'modal-body' });
    const list = h('div', { class: 'more-list' });
    items.forEach((it) => {
      list.appendChild(h('button', { class: 'more-item' + (State.route.name === it.route ? ' active' : ''), onClick: () => { closeModal(); navigate('#/' + it.route); } }, [
        h('span', { class: 'more-icon' }, it.icon),
        h('span', { class: 'more-label' }, it.label)
      ]));
    });
    body.appendChild(list);
    // Money section — reach the personal-finance screens from the bottom nav too.
    body.appendChild(h('div', { class: 'nav-label', style: { marginTop: '14px', marginBottom: '6px' } }, 'Money'));
    const moneyList = h('div', { class: 'more-list' });
    [['networth', 'Net worth', '₹'], ['transactions', 'Transactions', '⇄'], ['budgets', 'Budgets', '◐'], ['pending', 'Pending', '⏳'], ['trends', 'Trends', '📈']].forEach(([route, label, icon]) => {
      moneyList.appendChild(h('button', { class: 'more-item' + (State.route.name === route ? ' active' : ''), onClick: () => { closeModal(); navigate('#/' + route); } }, [
        h('span', { class: 'more-icon' }, icon), h('span', { class: 'more-label' }, label)
      ]));
    });
    body.appendChild(moneyList);
    body.appendChild(h('button', { class: 'btn btn-primary', style: { width: '100%', marginTop: '14px', justifyContent: 'center' }, onClick: () => { closeModal(); openNewGroup(); } }, '+ New group'));
    body.appendChild(h('button', { class: 'btn', style: { width: '100%', marginTop: '8px', justifyContent: 'center' }, onClick: () => { closeModal(); inviteToOrbit(); } }, 'Invite friends to Orbit'));
    modal.appendChild(body);
    openModal(modal);
  }

  // Minimal token-compliant switch. Returns a button[role=switch]; calls
  // onChange(bool) on toggle. Iris accent when on, 999 radius.
  function orbitSwitch(initial, onChange) {
    let on = !!initial;
    const btn = h('button', { type: 'button', class: 'orbit-switch' + (on ? ' on' : ''), role: 'switch', 'aria-checked': String(on) }, [
      h('span', { class: 'orbit-switch-knob' })
    ]);
    btn.addEventListener('click', () => {
      on = !on;
      btn.classList.toggle('on', on);
      btn.setAttribute('aria-checked', String(on));
      onChange(on);
    });
    return btn;
  }

  function openAddMemberModal(group) {
    const data = { picked: '', newName: '', newEmail: '', newPhone: '' };
    const modal = h('div', { class: 'modal modal-sm' }, [
      h('div', { class: 'modal-head' }, [h('h2', {}, 'Add member'), h('button', { class: 'close', onClick: closeModal }, '×')])
    ]);
    const body = h('div', { class: 'modal-body' });
    // Saved contacts autocomplete in the name field (no separate dropdown).
    const dlId = 'am-saved-contacts';
    const dl = h('datalist', { id: dlId });
    State.users.filter((u) => !u.isSelf && !group.members.includes(u.id)).forEach((u) => dl.appendChild(h('option', { value: u.name })));
    body.appendChild(dl);
    const nameInp = h('input', { class: 'input', list: dlId, placeholder: 'Name', onInput: (e) => { data.newName = e.target.value; } });
    const emailInp = h('input', { class: 'input', type: 'email', placeholder: 'name@email.com', onInput: (e) => { data.newEmail = e.target.value; } });
    const phoneInp = h('input', { class: 'input', type: 'tel', placeholder: '+91 98765 43210', onInput: (e) => { data.newPhone = e.target.value; } });
    // Mobile: pull a person straight from the phone's address book.
    if (contactsSupported()) {
      const pickBtn = h('button', { class: 'btn btn-sm', style: { width: '100%', justifyContent: 'center', gap: '8px', marginBottom: '12px' } }, [
        h('span', { html: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="3" width="16" height="18" rx="3"/><circle cx="12" cy="10" r="2.6"/><path d="M8 17c0-2 1.8-3 4-3s4 1 4 3"/></svg>' }),
        'Add from contacts'
      ]);
      pickBtn.addEventListener('click', async () => {
        const c = await pickFromContacts();
        if (!c) return;
        data.newName = c.name || ''; data.newEmail = c.email || ''; data.newPhone = c.phone || '';
        nameInp.value = data.newName; emailInp.value = data.newEmail; phoneInp.value = data.newPhone;
      });
      body.appendChild(pickBtn);
    }
    body.appendChild(formRow('Or new person', nameInp));
    // Email / phone make this person claimable when they sign in (so the
    // expenses you tag them in become really theirs). Optional but recommended.
    body.appendChild(formRow('Email (optional)', emailInp));
    body.appendChild(formRow('Phone (optional)', phoneInp));
    body.appendChild(h('div', { class: 'small muted', style: { marginTop: '-4px' } }, 'Add an email or phone so they auto-join and their tagged expenses become really theirs. Without one, they can only join via an invite link.'));
    modal.appendChild(body);
    modal.appendChild(h('div', { class: 'modal-foot' }, [
      h('button', { class: 'btn btn-ghost btn-sm', onClick: closeModal }, 'Cancel'),
      h('button', { class: 'btn btn-primary btn-sm', onClick: async () => {
        const nm = data.newName.trim();
        if (!nm) { toast('Add a name', 'neg'); return; }
        // Identity resolution: reuse on an exact email/phone match, ASK on a
        // same-name-but-different-handle clash, else create. Returns null if
        // the "is this the same person?" prompt was cancelled.
        // Resolve against ALL contacts (incl. ones already in this group) so a
        // re-add of an existing member is detected as that member (-> "already
        // in this group") instead of spawning a duplicate. The group-membership
        // check below handles the already-added case.
        const userId = await resolvePersonContact(
          { name: nm, email: data.newEmail, phone: data.newPhone }
        );
        if (!userId) return; // cancelled — leave the add untouched
        if (group.members.includes(userId)) { toast('Already in this group'); closeModal(); return; }
        group.members.push(userId);
        await OrbitDB.put('groups', group);
        // Shared group: the person needs a real path into the cloud group.
        //  - With an email/phone → register a claimable ghost so they
        //    auto-link the moment they sign in (and WhatsApp them the invite).
        //  - Without either → they can't auto-link, so an invite LINK is the
        //    only reliable way in. Surface the share flow instead of silently
        //    leaving a dead local-only name.
        const sid = sharedIdOf(group);
        let inviteUrl = null, needsInvite = false, addedDirectly = false;
        if (sid && canShare()) {
          const m = State.users.find((x) => x.id === userId);
          if (m && (m.email || m.phone)) {
            // 1) Already an Orbit user? Add them straight in — no invite needed.
            try {
              const res = await OrbitGroups.addExistingUser(sid, { email: m.email, phone: m.phone });
              if (res && res.found) addedDirectly = true;
            } catch (e) { console.warn('[add] addExistingUser failed', e); }
            if (addedDirectly) {
              // The real uid arrives via realtime; drop the local placeholder so
              // we don't end up with a duplicate member row.
              group.members = group.members.filter((x) => x !== userId);
              await OrbitDB.put('groups', group);
            } else {
              // 2) Not on Orbit yet → claimable ghost + invite so they auto-link
              //    the moment they sign in.
              try { await OrbitGroups.addGhostToGroup(sid, { ghostId: userId, name: m.name, email: m.email, phone: m.phone }); }
              catch (e) { console.warn('[Phase 2] addGhostToGroup failed', e); }
              if (m.phone) {
                try {
                  const inv = await OrbitGroups.createInvite(sid); inviteUrl = inv.url;
                  waOpen(orbitGroupInviteText(group.name, inv.url, m.name), m.phone);
                } catch (_) {}
              }
            }
          } else {
            needsInvite = true;
          }
        }
        closeModal();
        // Re-sync State from the persisted store BEFORE rendering. The global
        // OrbitDB.on('*') listener reloads State asynchronously and can race the
        // render below, intermittently dropping the just-added member chip.
        // Awaiting the authoritative read here makes the new chip render reliably.
        try {
          State.users = await OrbitDB.getAll('users');
          State.groups = await OrbitDB.getAll('groups');
        } catch (_) {}
        if (addedDirectly) {
          toast('Added ' + nm + ' — they’re in the group', 'pos');
        } else if (needsInvite) {
          toast('Add an email or phone to auto-link them — or send this invite', 'warn');
          inviteToGroup(group);   // open the share-link flow so they can actually join
        } else {
          toast(inviteUrl ? 'Added — invite sent' : 'Added');
        }
        render();
      } }, 'Add')
    ]));
    openModal(modal);
  }

  // ---- Add / Edit Expense modal ----
  // ===================================================================
  // AI QUICK ADD (Gemini)
  // ===================================================================
  function openAIQuickAdd() {
    if (!window.OrbitAI) { toast('AI module not loaded', 'neg'); return; }

    const modal = h('div', { class: 'modal modal-md' });
    modal.appendChild(h('div', { class: 'modal-head' }, [
      h('h2', {}, [
        h('span', { style: { color: 'var(--accent)', marginRight: '6px' } }, '✦'),
        'Quick add with AI'
      ]),
      h('button', { class: 'close', onClick: closeModal }, '×')
    ]));
    const body = h('div', { class: 'modal-body' });

    const examples = [
      'Split ₹4,200 dinner at Bombay Canteen with Rohan and Priya',
      'I paid ₹9,000 for Goa villa, split with Rohan, Priya, Arjun, Ananya — 60/40 between me and the rest',
      'Uber 600 with Rohan equal',
      'Lunch 1500, I owe Priya 60%'
    ];

    body.appendChild(h('div', { class: 'small muted', style: { marginBottom: '10px' } },
      'Describe the expense in plain English. AI extracts amount, currency, payer, split.'));

    const inp = h('textarea', {
      class: 'textarea', rows: 3,
      placeholder: 'e.g. ' + examples[0],
      style: { fontSize: '15px', lineHeight: '1.4' }
    });
    body.appendChild(inp);

    const exRow = h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '10px' } });
    examples.forEach((ex) => {
      exRow.appendChild(h('button', {
        class: 'btn btn-ghost btn-sm',
        style: { fontSize: '11px', padding: '4px 10px', borderRadius: '999px', textAlign: 'left' },
        onClick: () => { inp.value = ex; inp.focus(); }
      }, ex.length > 50 ? ex.slice(0, 50) + '…' : ex));
    });
    body.appendChild(exRow);

    // Voice input via Web Speech API
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const voiceBtn = SR ? h('button', { class: 'btn btn-sm', onClick: () => startVoice() }, '🎙 Voice') : null;

    const status = h('div', { class: 'small muted', style: { marginTop: '12px', minHeight: '18px' } }, '');
    body.appendChild(status);

    modal.appendChild(body);
    const parseBtn = h('button', { class: 'btn btn-primary btn-sm', onClick: () => runParse() }, 'Parse');
    modal.appendChild(h('div', { class: 'modal-foot' }, [
      voiceBtn,
      h('span', { class: 'spacer' }),
      h('button', { class: 'btn btn-ghost btn-sm', onClick: closeModal }, 'Cancel'),
      parseBtn
    ]));
    openModal(modal);
    setTimeout(() => inp.focus(), 60);

    function startVoice() {
      const r = new SR();
      r.lang = 'en-IN'; r.interimResults = true; r.continuous = false;
      status.textContent = 'Listening…';
      r.onresult = (ev) => {
        const t = Array.from(ev.results).map((res) => res[0].transcript).join('');
        inp.value = t;
      };
      r.onend = () => { status.textContent = ''; };
      r.onerror = (ev) => { status.textContent = 'Voice error: ' + ev.error; };
      r.start();
    }

    async function runParse() {
      const text = inp.value.trim();
      if (!text) { status.textContent = 'Describe an expense first.'; return; }
      parseBtn.disabled = true;
      status.innerHTML = '<span style="color: var(--accent)">✦</span> Parsing…';
      try {
        const ctx = {
          contacts: State.users.map((u) => ({ name: u.name, isSelf: u.isSelf })),
          groups: State.groups.map((g) => ({ name: g.name, currency: g.currency, memberCount: g.members.length })),
          categories: ['food','travel','bills','shop','fun','rent','transport','other']
        };
        // Try the SHARED server key first (no prompt). Only if there's no shared
        // key AND no personal key do we offer the key modal as a last resort.
        let r = await OrbitAI.parseExpense(text, ctx);
        if (!r.ok && r.error === 'needs-key') {
          const key = await openGeminiKeyModal();
          if (!key) { status.textContent = 'Quick add isn’t set up yet — ask the group owner, or add your own key.'; parseBtn.disabled = false; return; }
          r = await OrbitAI.parseExpense(text, Object.assign({ apiKey: key }, ctx));
        }
        // Rate-limit / overload (429/503) and transient network drops are worth
        // one automatic retry — the shared key's per-minute burst window often
        // clears within a couple of seconds.
        // A "credits depleted / billing" 429 is a hard wall, not a transient
        // burst — don't waste a retry on it, and say so plainly.
        const isBilling = (e) => e === 'http-429' && /deplet|billing|prepay|credit|quota/i.test(r.raw || '');
        const retryable = (e) => (e === 'http-429' || e === 'http-503' || e === 'http-500' || e === 'network') && !isBilling(e);
        if (!r.ok && retryable(r.error)) {
          status.innerHTML = '<span style="color: var(--accent)">✦</span> AI is busy — retrying…';
          await new Promise((res) => setTimeout(res, 2500));
          r = await OrbitAI.parseExpense(text, ctx);
        }
        if (!r.ok) {
          if (r.error === 'parse') status.textContent = 'AI returned unparseable JSON. Try rephrasing.';
          else if (r.error === 'resource-exhausted') status.textContent = 'Daily AI limit reached — try again tomorrow.';
          else if (isBilling(r.error)) status.textContent = 'AI is out of credits. Top up Gemini billing to re-enable Quick add.';
          else if (r.error === 'http-429') status.textContent = 'AI is rate-limited right now. Wait ~30s and try again.';
          else if (r.error === 'http-503' || r.error === 'http-500') status.textContent = 'AI is temporarily unavailable. Try again shortly.';
          else if (r.error === 'network') status.textContent = 'Network issue reaching the AI. Check your connection.';
          else if (r.error && r.error.indexOf('http-') === 0) status.textContent = 'AI service error (' + r.error + ').';
          else status.textContent = 'Couldn’t parse that — try rephrasing.';
          parseBtn.disabled = false;
          return;
        }
        closeModal();
        openExpenseModalFromAI(r.parsed);
      } catch (e) {
        status.textContent = 'Error: ' + e.message;
        parseBtn.disabled = false;
      }
    }
  }

  function openExpenseModalFromAI(parsed) {
    // Map AI output → existing expense modal's initial data shape
    const matchUser = (rawName) => {
      if (!rawName) return null;
      const n = String(rawName).trim().toLowerCase();
      if (n === 'self' || n === 'me' || n === 'i' || n === 'myself' || n === 'you') return State.selfId;
      const exact = State.users.find((u) => u.name.toLowerCase() === n);
      if (exact) return exact.id;
      const startsWith = State.users.find((u) => u.name.toLowerCase().startsWith(n));
      if (startsWith) return startsWith.id;
      return null;
    };

    const matchGroup = (name) => {
      if (!name) return null;
      const n = String(name).trim().toLowerCase();
      const exact = State.groups.find((g) => g.name.toLowerCase() === n);
      if (exact) return exact.id;
      const fuzzy = State.groups.find((g) => g.name.toLowerCase().includes(n) || n.includes(g.name.toLowerCase()));
      return fuzzy ? fuzzy.id : null;
    };

    // Find or pick a group: explicit > inferred from participant overlap > first
    let groupId = matchGroup(parsed.groupName);
    const participantIds = (parsed.participants || []).map(matchUser).filter(Boolean);
    if (!groupId && participantIds.length) {
      const best = State.groups
        .map((g) => ({ g, overlap: participantIds.filter((p) => g.members.includes(p)).length }))
        .sort((a, b) => b.overlap - a.overlap)[0];
      if (best && best.overlap >= 2) groupId = best.g.id;
    }
    if (!groupId) groupId = State.groups[0]?.id || '';

    const paidBy = matchUser(parsed.paidByName) || State.selfId;

    // Pre-populate as an editable expense
    const seed = {
      id: '',
      groupId,
      title: parsed.title || 'AI expense',
      amount: parsed.amount || 0,
      currency: parsed.currency || (groupById(groupId)?.currency || 'INR'),
      paidBy,
      splitMode: parsed.splitMode || 'equal',
      splits: [],
      category: parsed.category || 'other',
      date: toDateInput(todayISO()),
      note: 'Created via AI quick-add'
    };
    if (parsed.splits && parsed.splits.length) {
      seed.splits = parsed.splits.map((s) => ({
        userId: matchUser(s.name),
        amount: Number(s.value) || 0
      })).filter((s) => s.userId);
    }
    // prefill keeps the modal in "Add expense" mode (not edit)
    openExpenseModal({ prefill: seed });
    toast('AI parsed — review and save', 'pos');
  }

  function openExpenseModal({ existing = null, groupId = '', prefill = null } = {}) {
    // Can't split an expense with no group. Rather than show an unusable modal
    // with an empty Group/Paid-by dropdown, guide the user to create one first.
    if (!existing && !State.groups.length) {
      const modal = h('div', { class: 'modal modal-sm' }, [
        h('div', { class: 'modal-head' }, [h('h2', {}, 'Create a group first'), h('button', { class: 'close', onClick: closeModal }, '×')]),
        h('div', { class: 'modal-body' }, [
          h('div', { class: 'sub', style: { marginBottom: '14px' } }, 'Expenses are split inside a group (e.g. "Flatmates", "Goa Trip"). Create one and you can add the expense right after.'),
          h('button', { class: 'btn btn-primary btn-block', onClick: () => { closeModal(); openNewGroup(); } }, '＋ Create a group'),
          State.users.length ? h('button', { class: 'btn btn-ghost btn-block', style: { marginTop: '8px' }, onClick: () => { closeModal(); if (window.loadDemoData) loadDemoData().then(() => location.reload()); } }, 'Or load sample data') : null
        ]),
        h('div', { class: 'modal-foot' }, [h('button', { class: 'btn btn-ghost btn-sm', onClick: closeModal }, 'Cancel')])
      ]);
      openModal(modal);
      return;
    }
    const initial = existing || prefill || {
      id: '',
      groupId: groupId || State.groups[0]?.id || '',
      title: '',
      amount: 0,
      currency: selfDefaultCurrency(),
      paidBy: State.selfId,
      splitMode: 'equal',
      splits: [],
      category: 'food',
      date: toDateInput(todayISO()),
      note: ''
    };
    const data = { ...initial };
    if (data.date && data.date.length > 10) data.date = toDateInput(data.date);
    if (!Array.isArray(data.splits)) data.splits = [];
    // Editing an expense that already has multiple payers → open in multi mode.
    if (Array.isArray(data.payers) && data.payers.length > 1) { data.paidBy = '__multi'; data.payers = data.payers.map((p) => ({ ...p })); }
    else data.payers = null;
    const multiActive = () => data.paidBy === '__multi';
    let selectedMembers = data.splits.length ? data.splits.map((s) => s.userId) : (groupById(data.groupId)?.members || []).slice();

    function currentGroup() { return groupById(data.groupId); }
    if (currentGroup()) data.currency = currentGroup().currency;

    const modal = h('div', { class: 'modal modal-lg' });
    modal.appendChild(h('div', { class: 'modal-head' }, [
      h('h2', {}, existing ? 'Edit expense' : 'Add expense'),
      h('button', { class: 'close', onClick: closeModal }, '×')
    ]));

    const body = h('div', { class: 'modal-body' });

    // Receipt: upload + preview + best-effort OCR.
    const ocrInput = h('input', { type: 'file', accept: 'image/*', style: { display: 'none' } });
    ocrInput.addEventListener('change', (e) => { const f = e.target.files[0]; if (f) onReceiptChosen(f); e.target.value = ''; });
    const ocrStatus = h('div', { class: 'small muted', style: { marginTop: '4px', minHeight: '14px' } }, '');
    const chooseBtn = h('button', { class: 'btn btn-sm', onClick: () => ocrInput.click() }, data.receipt ? 'Replace' : 'Choose image');
    const thumbWrap = h('div', { style: { marginTop: '8px' } });

    function renderReceiptThumb() {
      thumbWrap.innerHTML = '';
      chooseBtn.textContent = data.receipt ? 'Replace' : 'Choose image';
      if (!data.receipt) { thumbWrap.style.display = 'none'; return; }
      thumbWrap.style.display = 'block';
      const img = h('img', {
        src: data.receipt, alt: 'Attached receipt',
        style: {
          width: '88px', height: '88px', objectFit: 'cover', borderRadius: '10px',
          border: '1px solid var(--line)', cursor: 'zoom-in', display: 'block'
        }
      });
      img.addEventListener('click', () => openReceiptViewer(data.receipt));
      const remove = h('button', {
        class: 'btn btn-ghost btn-sm',
        onClick: () => { data.receipt = ''; renderReceiptThumb(); ocrStatus.textContent = ''; }
      }, 'Remove');
      thumbWrap.appendChild(h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px' } }, [
        img,
        h('div', {}, [h('div', { class: 'small muted', style: { marginBottom: '4px' } }, 'Tap to enlarge'), remove])
      ]));
    }

    const ocrBanner = h('div', {
      style: {
        display: 'flex', alignItems: 'center', gap: '12px',
        padding: '10px 14px', marginBottom: '12px',
        background: 'var(--accent-tint)', border: '1px solid var(--accent-line)',
        borderRadius: '10px'
      }
    }, [
      h('div', { style: { fontSize: '18px' } }, '📷'),
      h('div', { style: { flex: 1 } }, [
        h('div', { style: { fontSize: '13px', fontWeight: 600 } }, 'Add a receipt'),
        h('div', { class: 'small muted' }, 'Attach a photo — Orbit reads the total and line items for you.'),
        ocrStatus
      ]),
      chooseBtn
    ]);
    body.appendChild(ocrBanner);
    body.appendChild(thumbWrap);
    body.appendChild(ocrInput);
    renderReceiptThumb();

    async function onReceiptChosen(file) {
      // Validate the upload before doing any work.
      if (!/^image\//.test(file.type || '')) { ocrStatus.textContent = 'Please choose an image file (JPG/PNG).'; return; }
      if (file.size > 12 * 1024 * 1024) { ocrStatus.textContent = 'Image is too large (max 12 MB). Try a smaller photo.'; return; }

      // 1) Attach first — store a downscaled copy so the upload succeeds even
      //    if OCR can't read the image. This is the "upload receipt" path.
      ocrStatus.textContent = 'Attaching…';
      try {
        data.receipt = window.OrbitOCR && OrbitOCR.fileToDataURL
          ? await OrbitOCR.fileToDataURL(file)
          : await fileToDataURL(file);
        renderReceiptThumb();
      } catch (_) {
        ocrStatus.textContent = 'Could not read that image. Try another photo.';
        return;
      }
      // Hard 2.5 MB cap on the stored/uploaded image. Downscaling normally keeps
      // it far smaller; reject anything still over so it can't be stored/synced.
      const approxBytes = Math.floor((data.receipt.length - (data.receipt.indexOf(',') + 1)) * 0.75);
      if (approxBytes > 2.5 * 1024 * 1024) {
        data.receipt = '';
        renderReceiptThumb();
        ocrStatus.textContent = 'Receipt image is over 2.5 MB. Try a smaller or clearer photo.';
        return;
      }

      // 2) Read the receipt. AI vision (Gemini) first — it handles crumpled,
      //    angled, low-light photos far better — then fall back to the on-device
      //    Tesseract engine when AI is unavailable (offline / no key / failed).
      //    Either way the attached receipt is already saved.
      let applied = false;
      if (window.OrbitAI && OrbitAI.parseReceipt) {
        ocrStatus.textContent = 'Reading receipt with AI…';
        try {
          const ai = await OrbitAI.parseReceipt(data.receipt);
          if (ai.ok) applied = applyExtracted(ai.parsed, 'AI');
        } catch (_) { /* fall through to Tesseract */ }
      }
      if (!applied && window.OrbitOCR) {
        ocrStatus.textContent = 'Reading receipt…';
        try {
          const r = await OrbitOCR.recognize(file, {
            onProgress: (m) => { ocrStatus.textContent = 'Reading receipt · ' + Math.round(m.progress * 100) + '%'; }
          });
          applied = applyExtracted({ total: r.total, currency: r.currency, lines: r.lines }, null);
        } catch (e) {
          ocrStatus.textContent = 'Receipt attached · couldn’t auto-read it. Enter amounts manually.';
          return;
        }
      }
      if (!applied && !window.OrbitOCR && !window.OrbitAI) ocrStatus.textContent = 'Receipt attached.';
    }

    // Fill the form from an extracted receipt (AI or Tesseract share this shape:
    // { total, currency, title?, lines:[{label, amount, isTaxOrFee?}] }). Returns
    // true if it found anything usable (a total or line items).
    function applyExtracted(x, sourceLabel) {
      x = x || {};
      const lines = x.lines || [];
      const hasTotal = x.total != null && x.total > 0;
      if (hasTotal) { data.amount = x.total; amountInput.value = x.total; }
      if (x.currency) { data.currency = x.currency; currencySel.value = x.currency; }
      if (x.title && !data.title) { data.title = String(x.title).slice(0, 60); titleInput.value = data.title; }
      else if (!data.title && lines.length) {
        const firstReal = lines.find((l) => !l.isTaxOrFee) || lines[0];
        if (firstReal && firstReal.label) { data.title = String(firstReal.label).slice(0, 60); titleInput.value = data.title; }
      }
      // Category + date come from AI vision (Tesseract doesn't surface them).
      if (x.category && CATEGORIES.some((c) => c.id === x.category)) { data.category = x.category; catSel.value = x.category; }
      if (x.date && /^\d{4}-\d{2}-\d{2}$/.test(x.date)) { data.date = x.date; dateInput.value = x.date; }
      renderMemberList();
      refreshFxHint();
      if (lines.length) {
        const lineSummary = lines.map((l) => '· ' + l.label + ' ' + l.amount).join('\n');
        noteInput.value = (noteInput.value ? noteInput.value + '\n\n' : '') +
          'Line items (from receipt):\n' + lineSummary;
        data.note = noteInput.value;
      }
      const n = lines.length;
      const src = sourceLabel ? ' (' + sourceLabel + ')' : '';
      ocrStatus.textContent = (hasTotal || n)
        ? 'Receipt read' + src + ' · ' + n + ' item' + (n !== 1 ? 's' : '') + (hasTotal ? ' · total ' + x.total : '')
        : 'Receipt attached · couldn’t read amounts — enter them manually.';
      return hasTotal || n > 0;
    }

    // Top row: title + amount
    const titleInput = h('input', { class: 'input input-lg', value: data.title, placeholder: 'e.g. Dinner at Bombay Canteen', onInput: (e) => { data.title = e.target.value; } });
    body.appendChild(formRow('What was it for?', titleInput));
    const fxHint = h('div', { class: 'small muted', style: { marginTop: '4px', minHeight: '14px' } }, '');
    async function refreshFxHint() {
      if (!window.OrbitFX) { fxHint.textContent = ''; return; }
      const g = currentGroup();
      if (!g || !data.amount || data.currency === g.currency) { fxHint.textContent = ''; return; }
      fxHint.textContent = 'Converting…';
      try {
        const r = await OrbitFX.rate(data.amount, data.currency, g.currency);
        fxHint.innerHTML = '≈ ' + OrbitFX.format(r.converted, g.currency) +
          ' <span style="color:var(--text-3)">· @ ' + r.rate.toFixed(4) + (r.stale ? ' (offline rate)' : '') + '</span>';
      } catch (_) { fxHint.textContent = ''; }
    }
    const amountInput = h('input', { class: 'input input-money', type: 'number', step: '0.01', value: data.amount || '', placeholder: '0.00', onInput: (e) => { data.amount = parseFloat(e.target.value) || 0; renderMemberList(); refreshFxHint(); } });
    // Kept as named refs so a receipt scan (AI/OCR) can drive them visually.
    const currencySel = selectInput([
      { v: 'INR', l: '₹ INR' }, { v: 'EUR', l: '€ EUR' }, { v: 'USD', l: '$ USD' }, { v: 'GBP', l: '£ GBP' }
    ], data.currency, (v) => { data.currency = v; refreshFxHint(); });
    const dateInput = h('input', { type: 'date', class: 'input', value: data.date, onInput: (e) => { data.date = e.target.value; } });
    body.appendChild(h('div', { class: 'input-row-3' }, [
      h('div', {}, [formRow('Amount', amountInput), fxHint]),
      formRow('Currency', currencySel),
      formRow('Date', dateInput)
    ]));

    // Group / paid by / category
    const grpSel = h('select', { class: 'select', onChange: (e) => {
      if (e.target.value === '__newgroup') { closeModal(); openNewGroup(); return; }
      data.groupId = e.target.value;
      const g = currentGroup();
      if (g) { data.currency = g.currency; selectedMembers = g.members.slice(); renderMemberList(); }
      refreshFxHint();
    } });
    State.groups.forEach((g) => { const op = h('option', { value: g.id }, g.name); if (g.id === data.groupId) op.selected = true; grpSel.appendChild(op); });
    grpSel.appendChild(h('option', { value: '__newgroup' }, '＋ Create a group…'));
    const paidSel = h('select', { class: 'select', onChange: (e) => {
      if (e.target.value === '__multi') { data.paidBy = '__multi'; payersWrap.style.display = ''; renderPayers(); }
      else { data.paidBy = e.target.value; data.payers = null; payersWrap.style.display = 'none'; }
    } });
    function refreshPaidBy() {
      paidSel.innerHTML = '';
      const g = currentGroup();
      (g?.members || []).forEach((mid) => {
        const u = State.users.find((x) => x.id === mid);
        if (!u) return;
        const op = h('option', { value: mid }, u.name + (u.isSelf ? ' (you)' : ''));
        if (mid === data.paidBy) op.selected = true;
        paidSel.appendChild(op);
      });
      // Multiple-payer option (e.g. you + a friend each paid part of the bill).
      const mop = h('option', { value: '__multi' }, 'Multiple people…');
      if (multiActive()) mop.selected = true;
      paidSel.appendChild(mop);
    }
    refreshPaidBy();

    // Per-member "who paid how much" panel — shown only in multi-payer mode.
    const payersWrap = h('div', { class: 'payers-wrap', style: { display: multiActive() ? '' : 'none' } });
    function renderPayers() {
      payersWrap.innerHTML = '';
      const members = (currentGroup()?.members) || [];
      if (!Array.isArray(data.payers)) data.payers = [];
      payersWrap.appendChild(h('div', { class: 'small muted', style: { margin: '2px 0 6px' } }, 'How much did each person pay?'));
      const hint = h('div', { class: 'small muted', style: { marginTop: '4px' } }, '');
      function updatePayHint() {
        const sum = (data.payers || []).reduce((s, p) => s + (p.amount || 0), 0);
        hint.textContent = 'Paid: ' + fmtMoney(sum, data.currency) + ' / ' + fmtMoney(data.amount || 0, data.currency);
        hint.style.color = Math.abs(sum - (data.amount || 0)) < 0.05 ? 'var(--positive)' : 'var(--text-3)';
      }
      members.forEach((mid) => {
        const u = State.users.find((x) => x.id === mid); if (!u) return;
        const cur = data.payers.find((p) => p.userId === mid);
        const inp = h('input', { class: 'input', type: 'number', step: '0.01', min: '0', value: cur ? cur.amount : '', placeholder: '0.00', style: { width: '120px' } });
        inp.addEventListener('input', (e) => {
          const v = parseFloat(e.target.value) || 0;
          const ex = data.payers.find((p) => p.userId === mid);
          if (ex) ex.amount = v; else data.payers.push({ userId: mid, amount: v });
          updatePayHint();
        });
        payersWrap.appendChild(h('div', { class: 'member-row' }, [
          avatar(mid, 'sm'),
          h('span', { class: 'name' }, u.name + (u.isSelf ? ' (you)' : '')),
          h('div', { class: 'share-input' }, inp)
        ]));
      });
      payersWrap.appendChild(hint);
      updatePayHint();
    }
    if (multiActive()) renderPayers();
    // Keep paid-by options + payer panel in sync when the group changes.
    grpSel.addEventListener('change', () => { refreshPaidBy(); if (multiActive()) renderPayers(); });

    const catSel = h('select', { class: 'select', onChange: (e) => { data.category = e.target.value; } });
    CATEGORIES.forEach((c) => { const op = h('option', { value: c.id }, c.label); if (c.id === data.category) op.selected = true; catSel.appendChild(op); });

    body.appendChild(h('div', { class: 'input-row-3' }, [
      formRow('Group', grpSel),
      formRow('Paid by', paidSel),
      formRow('Category', catSel)
    ]));
    body.appendChild(payersWrap);

    // Split mode tabs
    const splitSeg = h('div', { class: 'seg' }, [
      ...['equal','exact','percent','shares'].map((m) => h('button', { class: data.splitMode === m ? 'active' : '', onClick: (ev) => { data.splitMode = m; $$('.seg button', splitSeg).forEach((b) => b.classList.remove('active')); ev.currentTarget.classList.add('active'); seedDefaults(); renderMemberList(); } }, m.charAt(0).toUpperCase() + m.slice(1)))
    ]);
    body.appendChild(h('div', { class: 'form-row' }, [
      h('label', {}, 'Split among members'),
      h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' } }, [
        splitSeg,
        h('span', { class: 'small muted', id: 'splitSumHint' }, '')
      ])
    ]));

    // Member list with checkboxes + per-mode input
    const memList = h('div', { class: 'member-list' });
    body.appendChild(memList);

    // ---- Smart split engine ----------------------------------------------
    // `touched` = members the user has explicitly typed a value for. Everyone
    // else auto-absorbs the remainder so a split always reconciles. In a 2-way
    // percent split, typing 25 for one person instantly makes the other 75.
    const splitInputs = {};
    const splitAmtSpans = {};   // mid -> live "= ₹X" computed-amount label
    let touched = new Set();
    if (existing && data.splits && data.splits.length) data.splits.forEach((s) => touched.add(s.userId));
    const splitTotal = () => data.splitMode === 'percent' ? 100 : (data.splitMode === 'exact' ? (parseFloat(data.amount) || 0) : 0);
    const splitRound = (x) => data.splitMode === 'percent' ? Math.round(x) : Math.round(x * 100) / 100;
    const valFor = (mid) => { const s = data.splits.find((x) => x.userId === mid); return s ? s.amount : 0; };
    const setVal = (mid, v) => { const s = data.splits.find((x) => x.userId === mid); if (s) s.amount = v; else data.splits.push({ userId: mid, amount: v }); };
    function rebalance() {
      if (data.splitMode !== 'percent' && data.splitMode !== 'exact') { updateSplitHint(); return; }
      const sel = selectedMembers.slice();
      const untouched = sel.filter((m) => !touched.has(m));
      if (!untouched.length) { updateSplitHint(); return; }
      const touchedSum = sel.filter((m) => touched.has(m)).reduce((a, m) => a + valFor(m), 0);
      let rem = splitRound(splitTotal() - touchedSum); if (rem < 0) rem = 0;
      const n = untouched.length; let acc = 0;
      untouched.forEach((m, i) => {
        const v = i === n - 1 ? splitRound(rem - acc) : splitRound(rem / n);
        acc += v; setVal(m, v);
        if (splitInputs[m]) splitInputs[m].value = v;
      });
      updateSplitHint();
    }
    // When switching modes, lay down a sensible equal starting point (equal %,
    // equal amount, 1 share each) instead of a wall of zeros.
    function seedDefaults() {
      touched = new Set();
      if (data.splitMode === 'shares') { selectedMembers.forEach((m) => setVal(m, valFor(m) > 0 ? valFor(m) : 1)); return; }
      if (data.splitMode === 'equal') return;
      const total = splitTotal(); const n = selectedMembers.length || 1; let acc = 0;
      selectedMembers.forEach((m, i) => { const v = i === selectedMembers.length - 1 ? splitRound(total - acc) : splitRound(total / n); acc += v; setVal(m, v); });
    }

    // Helpers
    function memberRow(mid) {
      const u = State.users.find((x) => x.id === mid);
      if (!u) return null;
      const isChecked = selectedMembers.includes(mid);
      const split = data.splits.find((s) => s.userId === mid);
      const row = h('div', { class: 'member-row' + (isChecked ? ' checked' : '') });
      const toggle = () => {
        if (selectedMembers.includes(mid)) { selectedMembers = selectedMembers.filter((x) => x !== mid); touched.delete(mid); }
        else { selectedMembers.push(mid); if (data.splitMode === 'shares') setVal(mid, 1); }
        renderMemberList();
      };
      row.appendChild(h('span', {
        class: 'cb',
        role: 'checkbox',
        tabindex: '0',
        'aria-checked': isChecked ? 'true' : 'false',
        'aria-label': 'Split with ' + u.name + (u.isSelf ? ' (you)' : ''),
        onClick: toggle,
        onKeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } }
      }, isChecked ? '✓' : ''));
      row.appendChild(avatar(mid, 'sm'));
      row.appendChild(h('span', { class: 'name' }, u.name + (u.isSelf ? ' (you)' : '')));
      if (data.splitMode === 'equal') {
        const per = isChecked && selectedMembers.length > 0 ? data.amount / selectedMembers.length : 0;
        row.appendChild(h('span', { class: 'small muted tabular', style: { width: '110px', textAlign: 'right' } }, isChecked ? fmtMoney(per, data.currency) : '—'));
      } else if (!isChecked) {
        row.appendChild(h('span', { class: 'small muted tabular', style: { width: '110px', textAlign: 'right' } }, '—'));
      } else {
        const isPct = data.splitMode === 'percent';
        const inp = h('input', { class: 'input', type: 'number', step: isPct ? '1' : '0.01', min: '0', value: split?.amount ?? 0 });
        splitInputs[mid] = inp;
        inp.addEventListener('input', (e) => {
          touched.add(mid);
          setVal(mid, parseFloat(e.target.value) || 0);
          rebalance();
        });
        const unit = isPct ? h('span', { class: 'share-unit' }, '%') : (data.splitMode === 'shares' ? h('span', { class: 'share-unit' }, '×') : null);
        // Show what this share/percent actually costs the person, live.
        const amtSpan = (data.splitMode === 'percent' || data.splitMode === 'shares') ? h('span', { class: 'share-amt' }, '') : null;
        if (amtSpan) splitAmtSpans[mid] = amtSpan;
        row.appendChild(h('div', { class: 'share-input' }, [inp, unit, amtSpan]));
      }
      return row;
    }
    // Show each person's resulting ₹ next to their share/percent input, live.
    function updateComputedAmounts() {
      const amt = parseFloat(data.amount) || 0;
      const totShares = selectedMembers.reduce((x, m) => x + valFor(m), 0) || 1;
      selectedMembers.forEach((m) => {
        const span = splitAmtSpans[m]; if (!span) return;
        let v = 0;
        if (data.splitMode === 'percent') v = amt * valFor(m) / 100;
        else if (data.splitMode === 'shares') v = amt * valFor(m) / totShares;
        span.textContent = '= ' + fmtMoney(Math.round(v * 100) / 100, data.currency);
      });
    }
    function updateSplitHint() {
      updateComputedAmounts();
      const hint = $('#splitSumHint', body);
      if (!hint) return;
      hint.classList.remove('hint-ok', 'hint-warn', 'hint-err');
      if (data.splitMode === 'equal') { hint.textContent = selectedMembers.length + '-way equal split'; hint.classList.add('hint-ok'); return; }
      const sum = selectedMembers.reduce((x, m) => x + valFor(m), 0);
      if (data.splitMode === 'shares') { hint.textContent = 'Total ' + sum + ' shares'; return; }
      const total = splitTotal();
      const fmt = (x) => data.splitMode === 'percent' ? Math.round(x) + '%' : fmtMoney(x, data.currency);
      const left = splitRound(total - sum);
      const eps = data.splitMode === 'percent' ? 0.5 : 0.011;
      if (Math.abs(left) <= eps) { hint.textContent = '✓ ' + fmt(sum) + ' split'; hint.classList.add('hint-ok'); }
      else if (left > 0) { hint.textContent = fmt(left) + ' left to assign'; hint.classList.add('hint-warn'); }
      else { hint.textContent = fmt(-left) + ' over'; hint.classList.add('hint-err'); }
    }
    function renderMemberList() {
      memList.innerHTML = '';
      for (const k in splitInputs) delete splitInputs[k];
      for (const k in splitAmtSpans) delete splitAmtSpans[k];
      const g = currentGroup();
      (g?.members || []).forEach((mid) => { const r = memberRow(mid); if (r) memList.appendChild(r); });
      rebalance();
    }
    renderMemberList();

    // Recurring controls
    if (!data.recurring) data.recurring = (existing && existing.recurring) ? { ...existing.recurring } : null;
    const recurOn = !!(data.recurring && data.recurring.active !== false && data.recurring.freq);
    const recurFreqSel = h('select', { class: 'select', style: { maxWidth: '180px' }, onChange: (e) => {
      data.recurring = { freq: e.target.value, active: true, anchorDate: dateFromInput(data.date) };
    } });
    [['weekly','Weekly'], ['fortnightly','Every 2 weeks'], ['monthly','Monthly'], ['yearly','Yearly']].forEach(([v, l]) => {
      const op = h('option', { value: v }, l);
      if (recurOn && data.recurring.freq === v) op.selected = true;
      recurFreqSel.appendChild(op);
    });
    if (!recurOn) recurFreqSel.style.display = 'none';
    const recurCb = h('input', { type: 'checkbox', style: { marginRight: '8px' } });
    recurCb.checked = recurOn;
    recurCb.addEventListener('change', (e) => {
      if (e.target.checked) {
        data.recurring = { freq: recurFreqSel.value || 'monthly', active: true, anchorDate: dateFromInput(data.date) };
        recurFreqSel.style.display = '';
      } else {
        data.recurring = null;
        recurFreqSel.style.display = 'none';
      }
    });
    body.appendChild(h('div', { class: 'form-row' }, [
      h('label', {}, 'Repeat'),
      h('div', { style: { display: 'flex', alignItems: 'center', gap: '12px' } }, [
        h('label', { style: { display: 'flex', alignItems: 'center', cursor: 'pointer', fontSize: '13px' } }, [recurCb, 'Repeat on a schedule']),
        recurFreqSel
      ])
    ]));

    const noteInput = h('textarea', { class: 'textarea', placeholder: 'A receipt detail, table number, anything…', onInput: (e) => { data.note = e.target.value; } }, data.note || '');
    body.appendChild(formRow('Note (optional)', noteInput));

    modal.appendChild(body);
    modal.appendChild(h('div', { class: 'modal-foot' }, [
      existing ? h('button', { class: 'btn btn-danger btn-sm', onClick: () => { confirmDeleteExpense(existing); closeModal(); } }, 'Delete') : null,
      h('span', { class: 'spacer' }),
      h('button', { class: 'btn btn-ghost btn-sm', onClick: closeModal }, 'Cancel'),
      h('button', { class: 'btn btn-primary btn-sm', onClick: () => saveExpense() }, existing ? 'Save changes' : 'Add expense')
    ]));
    openModal(modal);

    let _saving = false;
    async function saveExpense() {
      // Double-submit guard: rapid taps / double-clicks must not create
      // duplicate expenses. The flag is only set AFTER validation passes, so a
      // rejected submit can still be retried.
      if (_saving) return;
      if (!data.title.trim()) { toast('Description required', 'neg'); return; }
      if (!isFinite(data.amount) || data.amount <= 0) { toast('Enter a valid amount greater than 0', 'neg'); return; }
      if (data.amount > 1e12) { toast('Amount is too large', 'neg'); return; }
      if (!data.groupId) { toast('Pick a group', 'neg'); return; }
      if (selectedMembers.length === 0) { toast('Pick at least one member', 'neg'); return; }
      // Reject negative exact/percent/share inputs (a negative split is never valid).
      if (data.splitMode !== 'equal') {
        const bad = data.splits.filter((s) => selectedMembers.includes(s.userId)).some((s) => s.amount < 0);
        if (bad) { toast('Split values cannot be negative', 'neg'); return; }
      }

      // Build splits according to mode. EVERY mode reconciles its rounding
      // residual onto the last split so sum(splits) === amount to the paisa —
      // otherwise the group ledger never nets to zero (a phantom 0.01 lingers).
      let splits = [];
      if (data.splitMode === 'equal') {
        const per = Math.round((data.amount / selectedMembers.length) * 100) / 100;
        splits = selectedMembers.map((uid2) => ({ userId: uid2, amount: per }));
      } else if (data.splitMode === 'exact') {
        splits = data.splits.filter((s) => selectedMembers.includes(s.userId)).map((s) => ({ userId: s.userId, amount: s.amount }));
        const sum = splits.reduce((s, x) => s + x.amount, 0);
        if (Math.abs(sum - data.amount) > 0.05) { toast('Exact splits must sum to ' + fmtMoney(data.amount, data.currency), 'neg'); return; }
      } else if (data.splitMode === 'percent') {
        const items = data.splits.filter((s) => selectedMembers.includes(s.userId));
        const sumP = items.reduce((s, x) => s + x.amount, 0);
        if (Math.abs(sumP - 100) > 0.5) { toast('Percents must sum to 100', 'neg'); return; }
        splits = items.map((s) => ({ userId: s.userId, amount: Math.round((data.amount * s.amount / 100) * 100) / 100 }));
      } else {
        const items = data.splits.filter((s) => selectedMembers.includes(s.userId));
        const totalShares = items.reduce((s, x) => s + x.amount, 0);
        if (totalShares <= 0) { toast('Provide share counts', 'neg'); return; }
        splits = items.map((s) => ({ userId: s.userId, amount: Math.round((data.amount * s.amount / totalShares) * 100) / 100 }));
      }
      reconcileSplits(splits, data.amount);

      // Resolve payer(s). Single payer → just data.paidBy. Multiple payers →
      // validate the entered amounts add up to the total, reconcile the rounding
      // residual, and store a `payers` array. paidBy is set to the largest payer
      // so legacy/display code that reads a single paidBy still works.
      let payers = null;
      let paidBy = data.paidBy;
      if (data.paidBy === '__multi') {
        payers = (data.payers || []).filter((p) => p.amount > 0).map((p) => ({ userId: p.userId, amount: Math.round(p.amount * 100) / 100 }));
        if (!payers.length) { toast('Enter how much each person paid', 'neg'); return; }
        if (payers.some((p) => p.amount < 0)) { toast('Payments cannot be negative', 'neg'); return; }
        const psum = payers.reduce((s, p) => s + p.amount, 0);
        if (Math.abs(psum - data.amount) > 0.05) { toast('Payments must add up to ' + fmtMoney(data.amount, data.currency), 'neg'); return; }
        reconcileSplits(payers, data.amount);
        payers.sort((a, b) => b.amount - a.amount);
        paidBy = payers[0].userId;
      }

      _saving = true;   // all validation passed — lock against duplicate submits
      const obj = {
        id: existing?.id || uid('e'),
        groupId: data.groupId,
        title: data.title.trim(),
        amount: data.amount,
        currency: data.currency,
        paidBy,
        splitMode: data.splitMode,
        splits,
        category: data.category,
        date: dateFromInput(data.date),
        note: data.note || ''
      };
      if (data.receipt) obj.receipt = data.receipt;
      if (payers) obj.payers = payers;
      if (data.recurring && data.recurring.freq) {
        const anchor = data.recurring.anchorDate || obj.date;
        obj.recurring = {
          freq: data.recurring.freq,
          active: true,
          anchorDate: anchor,
          nextDue: window.OrbitRecurring ? OrbitRecurring.addInterval(anchor, data.recurring.freq) : anchor,
          parentId: null,
          lastSpawnedAt: null
        };
      }
      const prevSnapshot = existing ? State.expenses.find((e) => e.id === existing.id) : null;
      // Upload a newly-attached receipt to Storage FIRST, so obj.receipt becomes
      // a tiny URL that both the local write and the cloud sync store (the heavy
      // base64 never lands in Firestore). No-op for local groups / already-a-URL.
      await uploadReceiptToStorage(obj);
      // Write the expense AND its activity entry in one atomic transaction so a
      // crash can't save the expense while losing its history (or vice versa).
      const ops = [{ store: 'expenses', op: 'put', value: obj }];
      let actEntry = null;
      if (window.OrbitActivity) {
        actEntry = OrbitActivity.build({
          ...actorStamp(), action: existing ? 'edit' : 'add', entityType: 'expense',
          entityId: obj.id, groupId: obj.groupId, snapshot: obj, prev: prevSnapshot
        });
        ops.push({ store: 'activity', op: 'put', value: actEntry });
      }
      try {
        await OrbitDB.writeTx(ops);
        if (existing) State.expenses = State.expenses.map((e) => e.id === obj.id ? obj : e);
        else State.expenses.push(obj);
        if (actEntry) State.activity = (State.activity || []).concat(actEntry);
        await syncExpenseIfShared(obj);   // Phase D: mirror to Firestore if group is shared
        await deleteReceiptIfRemoved(obj, prevSnapshot);   // clean up Storage if receipt was removed
        await mirrorSharedActivity(obj.groupId, existing ? 'edit' : 'add', obj, obj.id);
        closeModal();
        toast(existing ? 'Expense updated' : 'Expense added', 'pos');
        render();
      } catch (e) {
        _saving = false;   // release the lock so the user can retry a failed save
        console.error('saveExpense failed', e);
        toast('Could not save — please try again', 'neg');
      }
    }
  }

  // ===================================================================
  // TOAST
  // ===================================================================
  function toast(msg, type = '') {
    const root = $('#toastRoot');
    const t = h('div', { class: 'toast ' + type }, msg);
    root.appendChild(t);
    setTimeout(() => {
      t.style.transition = 'opacity 200ms ease, transform 200ms ease';
      t.style.opacity = '0';
      t.style.transform = 'translateY(4px)';
      setTimeout(() => t.remove(), 220);
    }, 2400);
  }

  // ===================================================================
  // GLOBAL SEARCH
  // ===================================================================
  function bindGlobalSearch() {
    const inp = $('#globalSearch');
    inp.addEventListener('input', (e) => {
      const q = e.target.value.trim();
      State.filters.expenses.q = q;
      // Search is global: from any screen, typing routes to Expenses (the
      // searchable list) and applies the filter, so it never silently no-ops.
      if (State.route.name === 'expenses') {
        render();
      } else if (q) {
        navigate('#/expenses');
        // keep focus + caret in the search box after the route re-render
        setTimeout(() => { const s = $('#globalSearch'); if (s) { s.focus(); s.value = q; } }, 0);
      }
    });
    document.addEventListener('keydown', (e) => {
      const tag = e.target.tagName;
      // Don't hijack typing. Buttons/links are excluded too so pressing the
      // shortcut letter while a button is focused doesn't surprise-navigate.
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
        || tag === 'BUTTON' || tag === 'A' || e.target.isContentEditable) return;
      if (e.metaKey || e.ctrlKey || e.altKey) {
        if (e.key === 'Escape') closeModal();
        return;
      }
      if (e.key === '/') { e.preventDefault(); inp.focus(); inp.select(); }
      else if (e.key === 'n') { e.preventDefault(); openExpenseModal(); }
      else if (e.key === 'q') { e.preventDefault(); openAIQuickAdd(); }
      else if (e.key === 'g') { e.preventDefault(); navigate('#/groups'); }
      else if (e.key === 'd') { e.preventDefault(); navigate('#/dashboard'); }
      else if (e.key === 'Escape') { closeModal(); }
    });
  }

  // ===================================================================
  // RENDER DISPATCH
  // ===================================================================
  function render() {
    try { renderCrumbs(); } catch (e) { console.error('renderCrumbs', e); }
    try { renderSidebarGroups(); } catch (e) { console.error('renderSidebarGroups', e); }
    try { renderMeCard(); } catch (e) { console.error('renderMeCard', e); }
    const name = State.route.name;
    try {
      if (name === 'dashboard') viewDashboard();
      else if (name === 'groups' && State.route.params.id) viewGroupDetail(State.route.params.id);
      else if (name === 'groups') viewGroups();
      else if (name === 'expenses') viewExpenses();
      else if (name === 'trips') viewTrips();
      else if (name === 'analytics') viewAnalytics();
      else if (name === 'activity') viewActivity();
      else if (name === 'settle') viewSettle();
      else if (name === 'networth') viewNetWorth();
      else if (name === 'transactions') viewTransactions();
      else if (name === 'budgets') viewBudgets();
      else if (name === 'goals') viewGoals();
      else if (name === 'loans') viewLoans();
      else if (name === 'investments') viewInvestments();
      else if (name === 'subscriptions') viewSubscriptions();
      else if (name === 'recurring') viewRecurring();
      else if (name === 'pending') viewPending();
      else if (name === 'cashflow') viewCashflow();
      else if (name === 'trends') viewTrends();
      else if (name === 'profile') viewProfile();
      else if (name === 'admin') viewAdmin();
      else if (name === 'join') viewJoin(State.route.params.id);
      else viewDashboard();
    } catch (e) {
      console.error('Render failed for route ' + name, e);
      // Don't leave a blank screen — show a recovery card.
      const page = h('div', { class: 'page' }, [
        h('div', { class: 'card', style: { padding: '32px', textAlign: 'center', margin: '40px auto', maxWidth: '480px' } }, [
          h('h2', { style: { margin: '0 0 8px' } }, 'Something went sideways'),
          h('p', { class: 'small muted', style: { margin: '0 0 20px' } }, 'We hit a snag rendering this page. The error is in your browser console — please share it if it persists.'),
          h('div', { style: { display: 'flex', gap: '8px', justifyContent: 'center' } }, [
            h('button', { class: 'btn btn-primary btn-sm', onClick: () => { State.route.name = 'dashboard'; location.hash = '#/dashboard'; } }, 'Back to dashboard'),
            h('button', { class: 'btn btn-ghost btn-sm', onClick: () => location.reload() }, 'Reload')
          ])
        ])
      ]);
      setMain(page);
    }
  }

  // ===================================================================
  // LOGIN GATE
  // ===================================================================
  function renderLoginGate({ mode }) {
    const gate = $('#loginGate');
    const app = $('#app');
    if (!gate || !app) return;
    gate.innerHTML = '';
    gate.hidden = false;
    app.style.display = 'none';

    const card = h('div', { class: 'login-card' });

    const gateMark = h('span', { 'aria-hidden': 'true', style: { width: '46px', height: '46px', display: 'inline-flex', flexShrink: '0' } });
    gateMark.innerHTML = '<svg viewBox="0 0 32 32" fill="none"><circle cx="16" cy="16" r="9.5" fill="none" stroke="#34B87A" stroke-width="5"/></svg>';
    const wm = h('span', { class: 'brand-name brand-wm', style: { fontSize: '38px' } });
    wm.innerHTML = 'Orbit<span class="brand-dot">.</span>';
    card.appendChild(h('div', { style: { display: 'inline-flex', alignItems: 'center', gap: '10px', marginBottom: '4px' } }, [gateMark, wm]));

    const headline = h('h1', {});
    headline.innerHTML = 'Money between friends, <span class="em">settled.</span>';
    card.appendChild(headline);

    card.appendChild(h('p', { class: 'sub' }, 'Track shared expenses, split intelligently, settle in one tap. Sign in to sync your ledger across devices.'));

    if (mode === 'setup-required') {
      card.appendChild(h('div', {
        style: {
          background: 'var(--warn-soft)', border: '1px solid rgba(245,166,35,0.30)',
          borderRadius: '12px', padding: '14px 16px', margin: '6px 0 4px',
          textAlign: 'left'
        }
      }, [
        h('div', { style: { fontSize: '13px', fontWeight: 600, color: 'var(--text-1)', marginBottom: '4px' } }, 'Firebase setup required'),
        h('div', { style: { fontSize: '12.5px', color: 'var(--text-2)', lineHeight: '1.5' } }, [
          'Edit ',
          h('code', { class: 'mono' }, 'firebase-config.js'),
          ' with your project credentials, then reload. See ',
          h('code', { class: 'mono' }, 'FIREBASE-SETUP.md'),
          ' for step-by-step instructions.'
        ])
      ]));
    } else if (isInAppBrowser()) {
      // Google refuses OAuth in embedded webviews — don't show a button that
      // will just fail. Tell them how to get a working browser.
      card.appendChild(h('div', {
        style: {
          background: 'var(--warn-soft)', border: '1px solid rgba(245,166,35,0.30)',
          borderRadius: '12px', padding: '14px 16px', margin: '6px 0 4px', textAlign: 'left'
        }
      }, [
        h('div', { style: { fontSize: '13.5px', fontWeight: 600, color: 'var(--text-1)', marginBottom: '6px' } }, 'Open in your browser to sign in'),
        h('div', { style: { fontSize: '12.5px', color: 'var(--text-2)', lineHeight: '1.5' } },
          'Google sign-in doesn’t work inside in-app browsers (like WhatsApp or Instagram). Tap the ••• menu and choose “Open in Chrome / Safari”, then sign in there.')
      ]));
      const copyBtn = h('button', { class: 'btn', style: { marginTop: '12px' } }, 'Copy link');
      copyBtn.addEventListener('click', () => { copyText(location.href); toast('Link copied — paste it in your browser'); });
      card.appendChild(copyBtn);
    } else {
      const signInBtn = h('button', { class: 'login-google', id: 'btnGoogleSignIn' }, [
        h('span', { style: { display: 'inline-flex' }, html: googleSvg() }),
        h('span', {}, 'Continue with Google')
      ]);
      card.appendChild(signInBtn);
      signInBtn.addEventListener('click', async () => {
        signInBtn.disabled = true;
        signInBtn.classList.add('loading');
        try {
          await OrbitCloud.signInWithGoogle();
        } catch (err) {
          signInBtn.disabled = false;
          signInBtn.classList.remove('loading');
          toast(err.code === 'auth/popup-closed-by-user' ? 'Sign-in cancelled' : ('Sign-in failed: ' + (err.message || err.code)), 'neg');
        }
      });

      // ---- Phone-OTP alternative (Phase 3) ----
      card.appendChild(h('div', { class: 'login-or' }, 'or'));
      const phoneToggle = h('button', { class: 'btn', style: { width: '100%', justifyContent: 'center' } }, 'Continue with phone');
      card.appendChild(phoneToggle);
      card.appendChild(h('div', { id: 'recaptcha-container' }));   // invisible reCAPTCHA mounts here

      const phoneBox = h('div', { style: { display: 'none', marginTop: '12px', textAlign: 'left' } });
      const phoneInp = h('input', { class: 'input', type: 'tel', placeholder: '+91 98765 43210', style: { marginBottom: '10px' } });
      const codeInp = h('input', { class: 'input', inputmode: 'numeric', autocomplete: 'one-time-code', placeholder: '6-digit code', style: { marginBottom: '10px', display: 'none' } });
      const actBtn = h('button', { class: 'btn btn-primary', style: { width: '100%', justifyContent: 'center' } }, 'Send code');
      const phoneStatus = h('div', { class: 'small muted', style: { marginTop: '10px' } });
      phoneBox.appendChild(phoneInp); phoneBox.appendChild(codeInp); phoneBox.appendChild(actBtn); phoneBox.appendChild(phoneStatus);
      card.appendChild(phoneBox);

      phoneToggle.addEventListener('click', () => {
        signInBtn.style.display = 'none'; phoneToggle.style.display = 'none';
        phoneBox.style.display = 'block'; phoneInp.focus();
      });
      let stage = 'number';
      actBtn.addEventListener('click', async () => {
        if (stage === 'number') {
          let num = (phoneInp.value || '').replace(/[^\d+]/g, '');
          if (num && !num.startsWith('+')) num = num.length === 10 ? '+91' + num : '+' + num;
          if (num.replace(/\D/g, '').length < 8) { phoneStatus.textContent = 'Enter a valid number with country code (e.g. +91…).'; return; }
          actBtn.disabled = true; actBtn.textContent = 'Sending…'; phoneStatus.textContent = '';
          try {
            await OrbitCloud.startPhoneSignIn(num, 'recaptcha-container');
            stage = 'code'; codeInp.style.display = 'block'; phoneInp.disabled = true;
            actBtn.textContent = 'Verify & sign in'; phoneStatus.textContent = 'Code sent to ' + num; codeInp.focus();
          } catch (e) {
            phoneStatus.textContent = 'Could not send code: ' + (e.message || e.code || 'error');
            actBtn.textContent = 'Send code';
          } finally { actBtn.disabled = false; }
        } else {
          const code = (codeInp.value || '').trim();
          if (code.length < 6) { phoneStatus.textContent = 'Enter the 6-digit code.'; return; }
          actBtn.disabled = true; actBtn.textContent = 'Verifying…';
          try {
            await OrbitCloud.confirmPhoneCode(code);   // onAuthChange → enterApp takes over
          } catch (e) {
            phoneStatus.textContent = 'Wrong or expired code. Try again.';
            actBtn.textContent = 'Verify & sign in'; actBtn.disabled = false;
          }
        }
      });
    }

    card.appendChild(h('div', { class: 'login-fine' }, 'Local-first ledger · We never hold money · Settle via UPI · End-to-end yours.'));
    const legal = h('div', { class: 'login-fine', style: { marginTop: '8px' } }, [
      'By continuing you agree to our ',
      h('a', { href: '/terms.html', style: { color: 'var(--text-2)', fontWeight: '500' } }, 'Terms'),
      ' and ',
      h('a', { href: '/privacy.html', style: { color: 'var(--text-2)', fontWeight: '500' } }, 'Privacy Policy'),
      '.'
    ]);
    card.appendChild(legal);
    const credit = h('div', { class: 'login-fine', style: { marginTop: '8px' } });
    credit.appendChild(h('a', { href: 'https://www.linkedin.com/in/sushanthvarmasl/', target: '_blank', rel: 'noopener', style: { color: 'var(--text-3)', fontWeight: '500' } }, 'Built by Sushanth Varma ↗'));
    card.appendChild(credit);
    gate.appendChild(card);
  }
  function hideLoginGate() {
    const gate = $('#loginGate');
    const app = $('#app');
    if (gate) { gate.hidden = true; gate.innerHTML = ''; }
    if (app) app.style.display = '';
  }
  function googleSvg() {
    return '<svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">' +
      '<path d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.13 4.13 0 0 1-1.8 2.71v2.26h2.92c1.71-1.58 2.68-3.9 2.68-6.61z" fill="#4285F4"/>' +
      '<path d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.83.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.95v2.33A9 9 0 0 0 9 18z" fill="#34A853"/>' +
      '<path d="M3.97 10.72A5.4 5.4 0 0 1 3.68 9c0-.6.1-1.18.29-1.72V4.95H.95A9 9 0 0 0 0 9c0 1.45.35 2.83.95 4.05l3.02-2.33z" fill="#FBBC05"/>' +
      '<path d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58A9 9 0 0 0 9 0 9 9 0 0 0 .95 4.95l3.02 2.33C4.68 5.16 6.66 3.58 9 3.58z" fill="#EA4335"/>' +
      '</svg>';
  }

  // ===================================================================
  // CLOUD SYNC — write-through monkey-patch on OrbitDB
  // ===================================================================
  function installCloudWriteThrough() {
    const origPut = OrbitDB.put.bind(OrbitDB);
    const origPutAll = OrbitDB.putAll.bind(OrbitDB);
    const origDelete = OrbitDB.delete.bind(OrbitDB);
    const origDeleteMany = OrbitDB.deleteMany.bind(OrbitDB);
    const origClear = OrbitDB.clear.bind(OrbitDB);
    const origSetMeta = OrbitDB.setMeta.bind(OrbitDB);
    const origWriteTx = OrbitDB.writeTx.bind(OrbitDB);

    OrbitDB.put = async (store, obj) => {
      const r = await origPut(store, obj);
      if (OrbitCloud && OrbitCloud.user()) OrbitCloud.write(store, obj).catch((e) => console.warn('Cloud write failed', e));
      return r;
    };
    // Atomic multi-store writes must mirror to the cloud too — otherwise an
    // expense saved via writeTx (P2.1) would never reach Firestore.
    OrbitDB.writeTx = async (ops) => {
      const r = await origWriteTx(ops);
      if (OrbitCloud && OrbitCloud.user()) {
        for (const o of ops) {
          if (o.op === 'delete') OrbitCloud.deleteOne(o.store, o.value).catch((e) => console.warn('Cloud write failed', e));
          else OrbitCloud.write(o.store, o.value).catch((e) => console.warn('Cloud write failed', e));
        }
      }
      return r;
    };
    OrbitDB.putAll = async (store, items) => {
      const r = await origPutAll(store, items);
      if (OrbitCloud && OrbitCloud.user()) {
        for (const obj of items) OrbitCloud.write(store, obj).catch((e) => console.warn('Cloud write failed', e));
      }
      return r;
    };
    OrbitDB.delete = async (store, id) => {
      const r = await origDelete(store, id);
      if (OrbitCloud && OrbitCloud.user()) OrbitCloud.deleteOne(store, id).catch((e) => console.warn('Cloud delete failed', e));
      return r;
    };
    OrbitDB.deleteMany = async (store, ids) => {
      const r = await origDeleteMany(store, ids);
      if (OrbitCloud && OrbitCloud.user()) {
        for (const id of ids) OrbitCloud.deleteOne(store, id).catch((e) => console.warn('Cloud delete failed', e));
      }
      return r;
    };
    OrbitDB.clear = async (store) => {
      const r = await origClear(store);
      if (OrbitCloud && OrbitCloud.user()) OrbitCloud.clearStore(store).catch((e) => console.warn('Cloud clear failed', e));
      return r;
    };
    OrbitDB.setMeta = async (key, value) => {
      const r = await origSetMeta(key, value);
      if (OrbitCloud && OrbitCloud.user()) OrbitCloud.write('meta', { key, value }).catch((e) => console.warn('Cloud meta failed', e));
      return r;
    };
  }

  // ===================================================================
  // BOOT
  // ===================================================================
  async function loadAll() {
    State.users = await OrbitDB.getAll('users');
    State.groups = await OrbitDB.getAll('groups');
    State.expenses = await OrbitDB.getAll('expenses');
    State.settlements = await OrbitDB.getAll('settlements');
    try { State.activity = await OrbitDB.getAll('activity'); } catch (_) { State.activity = []; }
    try { State.finAccounts = await OrbitDB.getAll('fin_accounts'); } catch (_) { State.finAccounts = []; }
    try { State.finNwHistory = await OrbitDB.getAll('fin_nwhistory'); } catch (_) { State.finNwHistory = []; }
    try { State.finTxns = await OrbitDB.getAll('fin_txns'); } catch (_) { State.finTxns = []; }
    try { State.finBudgets = await OrbitDB.getAll('fin_budgets'); } catch (_) { State.finBudgets = []; }
    try { State.finGoals = await OrbitDB.getAll('fin_goals'); } catch (_) { State.finGoals = []; }
    try { State.finLoans = await OrbitDB.getAll('fin_loans'); } catch (_) { State.finLoans = []; }
    try { State.finInvestments = await OrbitDB.getAll('fin_investments'); } catch (_) { State.finInvestments = []; }
    try { State.finSubs = await OrbitDB.getAll('fin_subs'); } catch (_) { State.finSubs = []; }
    try { State.finRecurring = await OrbitDB.getAll('fin_recurring'); } catch (_) { State.finRecurring = []; }
    State.finBase = await OrbitDB.getMeta('finBase', 'INR');
    State.reminderCache = await OrbitDB.getMeta('reminders', {});
    State.selfId = await OrbitDB.getMeta('selfUserId', 'u_self');
    // The no-flash bootstrap in index.html already applied the theme from
    // localStorage / OS preference; honor that so we don't repaint a flash.
    State.theme = document.documentElement.getAttribute('data-theme')
      || (await OrbitDB.getMeta('theme', 'light'));
    document.documentElement.dataset.theme = State.theme;
    try { localStorage.setItem('orbit_theme', State.theme); } catch (_) {}
  }

  function waitForCloud() {
    return new Promise((resolve) => {
      if (window.OrbitCloud) return resolve();
      window.addEventListener('orbit-cloud-ready', () => resolve(), { once: true });
      // Safety fallback — modules usually load within a few hundred ms
      setTimeout(() => resolve(), 5000);
    });
  }

  let _appBound = false;
  function bindAppOnce() {
    if (_appBound) return;
    _appBound = true;
    $('#newExpenseTop').addEventListener('click', () => openExpenseModal());
    const sideNew = $('#sidebarNewExpense');
    if (sideNew) sideNew.addEventListener('click', () => openExpenseModal());
    const tabAdd = $('#tabAdd');
    // Context-aware add: on a Money screen the bottom "+" quick-adds a personal
    // transaction; on Split screens it adds a group expense.
    if (tabAdd) tabAdd.addEventListener('click', () => { if (sectionForRoute(State.route.name) === 'money') openFinanceQuickAdd(); else openExpenseModal(); });
    const tabMore = $('#tabMore');
    if (tabMore) tabMore.addEventListener('click', openMoreMenu);             // mobile "More" sheet
    const aiBtn = $('#aiQuickTop');
    if (aiBtn) aiBtn.addEventListener('click', () => { if (sectionForRoute(State.route.name) === 'money') openFinanceQuickAdd(); else openAIQuickAdd(); });
    const themeBtn = $('#themeToggle');
    if (themeBtn) themeBtn.addEventListener('click', () => setTheme(State.theme === 'dark' ? 'light' : 'dark'));
    $('#meAvatar').addEventListener('click', () => navigate('#/profile'));
    $('#sidebarNewGroup').addEventListener('click', openNewGroup);
    bindGlobalSearch();
    OrbitDB.on('*', async (store) => {
      if (store === 'meta') return;
      State[store] = await OrbitDB.getAll(store);
    });
  }

  // Bounded wait so a hung Firestore call can't strand the user on a blank
  // page. Resolves to a sentinel { __timeout: true } instead of throwing so
  // the caller can branch cleanly.
  function withTimeout(promise, ms, label) {
    return new Promise((resolve) => {
      let done = false;
      const t = setTimeout(() => {
        if (done) return;
        done = true;
        console.warn('[Orbit] ' + label + ' timed out after ' + ms + 'ms');
        resolve({ __timeout: true });
      }, ms);
      Promise.resolve(promise).then(
        (v) => { if (done) return; done = true; clearTimeout(t); resolve(v); },
        (e) => { if (done) return; done = true; clearTimeout(t); console.warn('[Orbit] ' + label + ' failed', e); resolve({ __error: e }); }
      );
    });
  }

  async function enterApp(fullSync = true) {
    console.log('[Orbit] enterApp: start (fullSync=' + fullSync + ')');
    // Repeat auth fire for the same uid (token refresh): skip the destructive
    // clear+pull so we never clobber un-pushed local edits; just re-sync the
    // self profile and re-render.
    if (!fullSync) {
      // App is already running and realtime keeps it fresh — just re-sync the
      // self profile in case it changed. No clear/pull, no reload, no flicker.
      try { await ensureSelfUserMatchesAuth(); } catch (e) { console.warn('[Orbit] ensureSelfUserMatchesAuth (light) failed', e); }
      return;
    }
    // Cloud sync block — wrapped in try/catch + per-call timeouts so a hung
    // or failed Firestore round-trip drops the user into local-only mode
    // with a visible toast, never an empty shell.
    let cloudOk = true;
    try {
      console.log('[Orbit] enterApp: hasRemoteData...');
      const remote = await withTimeout(OrbitCloud.hasRemoteData(), 10000, 'hasRemoteData');
      if (remote && remote.__timeout) throw new Error('hasRemoteData timed out');
      if (remote && remote.__error) throw remote.__error;
      const hasRemote = !!remote;
      console.log('[Orbit] enterApp: hasRemote=' + hasRemote);

      if (hasRemote) {
        await OrbitDB.clearAll();
        const pulled = await withTimeout(OrbitCloud.pullAll(), 15000, 'pullAll');
        if (pulled && pulled.__timeout) throw new Error('pullAll timed out');
        if (pulled && pulled.__error) throw pulled.__error;
        console.log('[Orbit] enterApp: pullAll done', pulled);
      } else {
        await seedIfNeeded();
        const pushed = await withTimeout(OrbitCloud.pushAll(), 15000, 'pushAll');
        if (pushed && pushed.__timeout) throw new Error('pushAll timed out');
        if (pushed && pushed.__error) throw pushed.__error;
        console.log('[Orbit] enterApp: pushAll done');
      }
    } catch (e) {
      cloudOk = false;
      console.error('[Orbit] Cloud sync failed, falling back to local-only mode', e);
      // Make sure there's *something* to render. If we cleared local state
      // and the pull never landed, seed so the dashboard isn't empty.
      try {
        const existing = await OrbitDB.getAll('users');
        if (!existing.length) await seedIfNeeded();
      } catch (_) {}
    }

    try {
      await ensureSelfUserMatchesAuth();
    } catch (e) {
      console.warn('[Orbit] ensureSelfUserMatchesAuth failed', e);
    }
    await loadAll();
    try {
      if (window.OrbitRecurring) {
        const r = await OrbitRecurring.processRecurring(OrbitDB, State);
        if (r.spawned > 0) toast(r.spawned + ' recurring expense' + (r.spawned > 1 ? 's' : '') + ' added', 'pos');
      }
    } catch (e) { console.warn('Recurring engine failed', e); }
    try { await finProcessRecurring(); } catch (e) { console.warn('Finance recurring failed', e); }
    try { if (('Notification' in window) && Notification.permission === 'granted') await checkFinReminders(false); } catch (_) {}

    console.log('[Orbit] enterApp: rendering shell');
    hideLoginGate();
    bindAppOnce();
    route();
    maybeStartRealtime();  // Phase C: begin live shared-group sync

    // Phase 2: claim any pending ghost placeholders invited under my verified
    // email/phone. The Cloud Function rewrites splits ghost->uid; RealtimeSync
    // listeners pick up the changes live, so no manual refresh needed.
    if (window.OrbitGroups && OrbitGroups.isReady()) {
      OrbitGroups.claimPending().then((r) => {
        if (r && r.claimed && r.claimed.length) {
          toast('Linked you into ' + r.claimed.length + ' shared group' + (r.claimed.length > 1 ? 's' : ''), 'pos');
        }
      }).catch(() => {});
    }

    // Recover a pending invite the user opened while signed out (the hash can
    // be lost across the redirect sign-in flow). Send them to the join screen.
    try {
      const pj = localStorage.getItem('orbit_pending_join');
      if (pj) {
        localStorage.removeItem('orbit_pending_join');
        if (!/#\/join\//.test(location.hash)) { location.hash = '#/join/' + pj; }
        else { route(); }
      }
    } catch (_) {}

    if (!cloudOk) {
      toast('Sync unavailable — working offline. Changes save locally.', 'warn');
    }
  }

  async function ensureSelfUserMatchesAuth() {
    const fbUser = OrbitCloud.user();
    if (!fbUser) return;
    const users = await OrbitDB.getAll('users');
    let self = users.find((u) => u.isSelf);
    if (!self) {
      self = {
        id: 'u_self',
        name: fbUser.displayName || (fbUser.email || '').split('@')[0] || 'You',
        handle: '@' + ((fbUser.email || 'me').split('@')[0]),
        email: fbUser.email || '',
        upi: '',
        avatar: 'av-c1',
        isSelf: true,
        phone: ''
      };
    } else {
      // Keep our local profile but ensure email + name match the signed-in
      // Google account. The seed default ("You") gets replaced with the real
      if (!self.email || /@example\.com$/i.test(self.email)) self.email = fbUser.email || self.email || '';
      if (fbUser.displayName && (!self.name || self.name === 'You')) {
        self.name = fbUser.displayName;
      }
    }
    self.firebaseUid = fbUser.uid;
    self.photoURL = fbUser.photoURL || self.photoURL || '';
    await OrbitDB.put('users', self);
    await OrbitDB.setMeta('selfUserId', self.id);
    State.selfId = self.id;

    // Reflect the real signed-in user in the top-bar avatar (was hardcoded "S").
    try {
      const av = document.querySelector('#meAvatar .avatar');
      if (av) {
        av.setAttribute('data-user', self.id);
        if (self.photoURL) {
          av.classList.add('avatar-photo');
          av.style.backgroundImage = 'url("' + self.photoURL + '")';
          av.textContent = '';
        } else {
          av.classList.remove('avatar-photo');
          av.style.backgroundImage = '';
          av.textContent = (self.name || 'You').trim().split(/\s+/).map((s) => s[0]).slice(0, 2).join('').toUpperCase() || 'Y';
          av.setAttribute('data-color', (self.avatar && self.avatar.startsWith('av-c')) ? self.avatar.slice(4) : '1');
        }
      }
    } catch (_) {}

    // Publish a shared profile so co-members see our real name/UPI instead of
    // "New member"/"You" in shared groups.
    try {
      if (window.OrbitGroups && OrbitGroups.isReady()) {
        await OrbitGroups.upsertMyProfile({ name: self.name, email: self.email, upi: self.upi, photoURL: self.photoURL });
      }
    } catch (e) { console.warn('[Orbit] upsertMyProfile failed', e); }
  }

  async function boot() {
    // Invite links use ?join=CODE (survives messenger link parsing). Normalize
    // it into the #/join/CODE route + stash it so it survives sign-in.
    try {
      const jc = new URLSearchParams(location.search).get('join');
      if (jc) {
        localStorage.setItem('orbit_pending_join', jc);
        history.replaceState(null, '', location.pathname + '#/join/' + jc);
      }
    } catch (_) {}
    // Tag the <html> with device type so CSS + JS can adapt layout/behavior.
    try {
      document.documentElement.classList.toggle('is-mobile', isMobileDevice());
      document.documentElement.classList.toggle('is-desktop', !isMobileDevice());
    } catch (_) {}
    await OrbitDB.init();
    await waitForCloud();

    if (!OrbitCloud || !OrbitCloud.isConfigured()) {
      // Show setup-required gate. Bind theme from local IndexedDB so it still looks right.
      State.theme = await OrbitDB.getMeta('theme', 'light');
      document.documentElement.dataset.theme = State.theme;
      renderLoginGate({ mode: 'setup-required' });
      return;
    }

    await OrbitCloud.init();
    installCloudWriteThrough();

    // Track whether we've EVER seen a signed-in user this session. Used to
    // distinguish a real sign-out from a transient null on cold-boot before
    // Firebase has read the persisted session from IndexedDB.
    let _seenSignedIn = false;
    let _signOutTimer = null;
    let _syncedUid = null;   // uid we've already done the full clear+pull resync for

    OrbitCloud.onAuthChange(async (user) => {
      console.log('[Orbit] onAuthChange:', user ? `signed in as ${user.email}` : 'no user');
      if (_signOutTimer) { clearTimeout(_signOutTimer); _signOutTimer = null; }

      if (user) {
        _seenSignedIn = true;
        // Firebase re-fires onAuthChange on every token refresh / tab focus with
        // the SAME uid. Only do the destructive clear+pull resync the FIRST time
        // we see a given uid — otherwise a token refresh wipes un-pushed local
        // edits (offline data loss). Repeat fires just re-sync identity + render.
        const firstForUid = _syncedUid !== user.uid;
        _syncedUid = user.uid;
        try {
          await enterApp(firstForUid);
        } catch (e) {
          console.error('[Orbit] Boot after sign-in failed', e);
          toast('Sync failed: ' + (e.message || e.code), 'neg');
        }
        return;
      }

      // user is null. Two cases:
      //  (a) Cold boot, Firebase hasn't loaded persisted session yet — wait
      //      a moment for it to resolve before treating this as a sign-out.
      //  (b) Genuine sign-out (we already saw a signed-in state, or wait
      //      timed out) — clear local state and redirect to landing.
      const handleSignOut = async () => {
        console.log('[Orbit] handling sign-out (seenSignedIn=' + _seenSignedIn + ')');
        try { RealtimeSync.stop(); } catch (_) {}
        await OrbitDB.clearAll();
        State.users = []; State.groups = []; State.expenses = []; State.settlements = [];
        const params = new URLSearchParams(location.search);
        // If this is an invite link, DON'T bounce to landing (that drops the
        // #/join/CODE). Stash the code and show the sign-in gate in place so
        // the invitee lands on the join screen right after authenticating.
        const joinMatch = (location.hash || '').match(/#\/join\/([^/?#]+)/);
        if (joinMatch) {
          try { localStorage.setItem('orbit_pending_join', joinMatch[1]); } catch (_) {}
          renderLoginGate({ mode: 'signed-out' });
        } else if (params.get('stay') === '1') {
          renderLoginGate({ mode: 'signed-out' });
        } else {
          location.replace('./landing.html');
        }
      };

      if (_seenSignedIn) {
        // Real sign-out — act immediately.
        await handleSignOut();
      } else {
        // Possibly a transient cold-boot null. Wait up to 1.5s for a
        console.log('[Orbit] null on cold boot — waiting for late auth resolve');
        _signOutTimer = setTimeout(() => {
          _signOutTimer = null;
          if (!_seenSignedIn) handleSignOut();
        }, 1500);
      }
    });
  }

  // ===================================================================
  // PHASE C — REALTIME SHARED-GROUP SYNC
  // Live mirror of the shared (multi-user) groups + their expenses into
  // local State, so when any member writes, every other member's open
  // screen updates within ~1s. Additive: legacy local groups are untouched;
  // shared records are merged by id. Listeners are torn down on sign-out.
  // ===================================================================
  const RealtimeSync = (function () {
    let _groupsUnsub = null;
    const _expenseUnsubs = {};   // groupId -> unsubscribe
    const _settlementUnsubs = {}; // groupId -> unsubscribe (shared settlements)
    const _activityUnsubs = {};  // groupId -> unsubscribe (member-joined feed)
    let _adminUnsub = null;      // founder-only global join feed
    let _adminSeen = null;
    let _remindSeen = null;      // reminders already toasted to me
    let _started = false;
    let _prevMembers = {};       // groupId -> Set(memberUids) for join detection

    function mergeById(arr, incoming) {
      // Replace/insert incoming by id; keep records not in this set.
      const map = new Map(arr.map((x) => [x.id, x]));
      incoming.forEach((x) => map.set(x.id, x));
      return Array.from(map.values());
    }

    // Firestore groups carry members as an OBJECT map keyed by uid + a
    // memberUids array. The rest of the app expects members to be an ARRAY
    // of LOCAL user ids. Normalize here so renderers never see the cloud
    // shape (otherwise group.members.includes(...) throws). Also ensures a
    // local user record exists for each member uid.
    function ensureMemberStub(uidKey, info) {
      const myUid = (window.OrbitGroups && OrbitGroups.currentUid && OrbitGroups.currentUid()) || null;
      if (myUid && uidKey === myUid) return State.selfId;     // the signed-in user IS self
      let u = State.users.find((x) => x.id === uidKey);
      if (!u) {
        u = {
          id: uidKey, name: (info && info.name) || 'Member', isSelf: false,
          avatar: (info && info.avatar) || ('av-c' + ((State.users.length % 8) + 1)),
          email: '', upi: (info && info.upi) || '', photoURL: (info && info.photoURL) || '', pending: true
        };
        State.users.push(u);
      }
      return u.id;
    }
    // Collapse entries that are clearly the SAME person — matched by a single
    // unique identity: email first, else phone, else name. Keeps one
    // representative, preferring a real joined account (Firebase uid) or self
    // over a local/ghost stub. This is what stops the same human (e.g. a
    // name-added ghost + their joined account) showing up twice.
    function identityKey(id) {
      const u = State.users.find((x) => x.id === id);
      if (!u) return 'id:' + id;
      const email = (u.email || '').trim().toLowerCase();
      if (email) return 'e:' + email;
      const phone = (u.phone || '').replace(/[^\d+]/g, '');
      if (phone) return 'p:' + phone;
      return 'n:' + (u.name || '').trim().toLowerCase();
    }
    function dedupeMemberIds(ids) {
      const rank = (id) => isSelfMember(id) ? 3 : (String(id).indexOf('u_') === 0 ? 1 : 2);
      const best = new Map();   // key -> winning id
      ids.forEach((id) => {
        const k = identityKey(id);
        if (!best.has(k) || rank(id) > rank(best.get(k))) best.set(k, id);
      });
      const used = new Set(); const out = [];
      ids.forEach((id) => {
        const k = identityKey(id);
        if (!used.has(k)) { used.add(k); out.push(best.get(k)); }
      });
      return out;
    }
    // Email is the canonical identity. When a name-only contact and a real
    // joined account share an email, they're the SAME person — collapse them and
    // REWRITE every split / payer / settlement / roster id from the loser to the
    // winner (prefer self > joined uid > local stub) so no debt is orphaned or
    // double-counted. Returns true if anything changed.
    function reconcileByEmail() {
      const norm = (e) => (e || '').trim().toLowerCase();
      const isPlaceholder = (e) => !e || /@example\.com$/.test(e);
      const byEmail = new Map();
      State.users.forEach((u) => { const em = norm(u.email); if (isPlaceholder(em)) return; if (!byEmail.has(em)) byEmail.set(em, []); byEmail.get(em).push(u); });
      const rank = (u) => u.isSelf ? 3 : (String(u.id).indexOf('u_') === 0 ? 1 : 2);
      const remap = {};   // loserId -> winnerId
      byEmail.forEach((list) => {
        if (list.length < 2) return;
        const winner = list.slice().sort((a, b) => rank(b) - rank(a))[0];
        list.forEach((u) => { if (u.id !== winner.id) remap[u.id] = winner.id; });
      });
      const loserIds = Object.keys(remap);
      if (!loserIds.length) return false;
      const map = (id) => remap[id] || id;
      // Rewrite expense ids.
      State.expenses.forEach((e) => {
        let t = false;
        if (e.paidBy && remap[e.paidBy]) { e.paidBy = remap[e.paidBy]; t = true; }
        if (Array.isArray(e.payers)) e.payers.forEach((p) => { if (remap[p.userId]) { p.userId = remap[p.userId]; t = true; } });
        if (Array.isArray(e.splits)) e.splits.forEach((s) => { if (remap[s.userId]) { s.userId = remap[s.userId]; t = true; } });
        if (t && !e.shared) OrbitDB.put('expenses', e).catch(() => {});
      });
      // Rewrite settlement ids.
      State.settlements.forEach((s) => {
        let t = false;
        ['from', 'to', 'fromUser', 'toUser'].forEach((k) => { if (s[k] && remap[s[k]]) { s[k] = remap[s[k]]; t = true; } });
        if (t && !s.shared) OrbitDB.put('settlements', s).catch(() => {});
      });
      // Rewrite group rosters (de-dup after remap).
      State.groups.forEach((g) => {
        if (!Array.isArray(g.members)) return;
        const nm = [...new Set(g.members.map(map))];
        if (nm.length !== g.members.length || nm.some((m, i) => m !== g.members[i])) { g.members = nm; if (!isSharedGroup(g)) OrbitDB.put('groups', g).catch(() => {}); }
      });
      // Drop the loser stubs (only local ones from IndexedDB).
      const losers = new Set(loserIds);
      State.users = State.users.filter((u) => !losers.has(u.id));
      loserIds.forEach((id) => { if (String(id).indexOf('u_') === 0) OrbitDB.delete('users', id).catch(() => {}); });
      return true;
    }
    function normalizeSharedGroup(g) {
      const membersObj = g.members && !Array.isArray(g.members) ? g.members : {};
      const memberUids = g.memberUids || [];
      // Authoritative roster = EVERYONE the cloud group knows about — both
      // joined accounts (memberUids) and invited/ghost members (keys of the
      // members map). Deriving from the cloud, not the local list, means every
      // device (owner AND each joined member) sees the same complete roster.
      const cloudIds = Array.from(new Set([...memberUids, ...Object.keys(membersObj)]));
      const cloudMembers = cloudIds.map((mu) => ensureMemberStub(mu, membersObj[mu]));
      const existing = groupById(g.id);
      // Keep any purely-local members the owner added (e.g. name-only contacts
      // that never reached the cloud) so their view doesn't lose anyone, but
      // never drop cloud members from a joined member's view again.
      const localOnly = (existing && Array.isArray(existing.members))
        ? existing.members.filter((id) => !cloudMembers.includes(id) && !isSelfMember(id)) : [];
      const members = dedupeMemberIds([...cloudMembers, ...localOnly]);
      // Firestore createdAt is a Timestamp object — convert to an ISO string so
      // the UI's date formatters don't render "Invalid Date".
      let createdAt = (existing && existing.createdAt) || null;
      if (g.createdAt) {
        if (typeof g.createdAt === 'string') createdAt = g.createdAt;
        else if (typeof g.createdAt.toDate === 'function') createdAt = g.createdAt.toDate().toISOString();
        else if (g.createdAt.seconds != null) createdAt = new Date(g.createdAt.seconds * 1000).toISOString();
      }
      return Object.assign({}, existing || {}, {
        id: g.id, name: g.name,
        currency: g.currency || (existing && existing.currency) || 'INR',
        emoji: g.emoji || (existing && existing.emoji) || (g.name || '').slice(0, 2).toUpperCase(),
        category: g.category || (existing && existing.category) || 'friends',
        banner: (existing && existing.banner) || g.category || 'friends',
        members, memberCount: members.length,
        createdAt: createdAt || todayISO(),
        shared: true, sharedId: g.id, createdBy: g.createdBy
      });
    }
    function softRerender() {
      // Only re-render if the user is looking at something that shows
      // shared data (dashboard / groups / a group / expenses / settle).
      const n = State.route.name;
      if (['dashboard', 'groups', 'expenses', 'settle', 'activity', 'analytics'].includes(n) ||
          (n === 'groups' && State.route.params.id)) {
        try { render(); } catch (e) { console.warn('[Realtime] rerender failed', e); }
      }
      try { renderSidebarGroups(); } catch (_) {}
    }

    function watchGroupExpenses(groupId) {
      if (_expenseUnsubs[groupId] || !window.OrbitGroups) return;
      _expenseUnsubs[groupId] = OrbitGroups.onGroupExpenses(groupId, (expenses) => {
        // Translate shared ids back to local 'u_self', tag, then merge.
        const tagged = expenses.map((e) => Object.assign({ shared: true }, fromSharedExpense(e)));
        // The snapshot is authoritative for this group → drop local shared rows
        // the server no longer has (fixes "zombie" expenses after a co-member
        // deletes). Guarded on a non-empty snapshot so a cached/offline empty
        // emission can't wipe the group.
        if (tagged.length) {
          const liveIds = new Set(tagged.map((e) => e.id));
          State.expenses = State.expenses.filter((e) => !(e.shared && e.groupId === groupId) || liveIds.has(e.id));
        }
        State.expenses = mergeById(State.expenses, tagged);
        softRerender();
      });
    }

    // Live shared settlements — without this, "Mark paid" writes to Firestore but
    // the other device never reads it, so a cleared debt never clears for them.
    function watchGroupSettlements(groupId) {
      if (_settlementUnsubs[groupId] || !window.OrbitGroups || !OrbitGroups.onGroupSettlements) return;
      _settlementUnsubs[groupId] = OrbitGroups.onGroupSettlements(groupId, (settlements) => {
        const tagged = settlements.map((s) => Object.assign({ shared: true }, fromSharedSettlement(s)));
        if (tagged.length) {
          const liveIds = new Set(tagged.map((s) => s.id));
          State.settlements = State.settlements.filter((s) => !(s.shared && s.groupId === groupId) || liveIds.has(s.id));
        }
        State.settlements = mergeById(State.settlements, tagged);
        softRerender();
      });
    }

    // Persistent "X joined" entries for the Activity feed (server-written).
    function watchGroupActivity(groupId) {
      if (_activityUnsubs[groupId] || !window.OrbitGroups || !OrbitGroups.onGroupActivity) return;
      _activityUnsubs[groupId] = OrbitGroups.onGroupActivity(groupId, (items) => {
        const joins = items.filter((x) => x.type === 'member_joined').map((x) => ({
          id: groupId + '_' + x.id,
          actorId: x.actorUid,
          action: 'join',
          entityType: 'member',
          groupId,
          snapshot: { title: (x.actorName || 'Someone') + ' joined the group' },
          ts: x._ts || new Date().toISOString(),
          shared: true
        }));
        const removals = items.filter((x) => x.type === 'member_removed').map((x) => ({
          id: groupId + '_' + x.id,
          actorId: x.actorUid,
          action: 'remove',
          entityType: 'member',
          groupId,
          snapshot: { title: (x.targetName || 'A member') + ' was removed from the group' },
          ts: x._ts || new Date().toISOString(),
          shared: true
        }));
        // Expense/settlement audit events from co-members. Skip my OWN echoes —
        // I already have a richer local entry — so the feed never double-counts.
        const my = myUid();
        const ACT = { expense_add: 'add', expense_edit: 'edit', expense_delete: 'delete', settle: 'settle', reminder: 'reminder' };
        const ledger = items.filter((x) => ACT[x.type] && x.actorUid !== my).map((x) => ({
          id: groupId + '_' + x.id,
          actorId: x.actorUid, actorUid: x.actorUid, actorName: x.actorName,
          action: ACT[x.type],
          entityType: x.entityType || (x.type === 'settle' ? 'settlement' : 'expense'),
          entityId: x.entityId || null,
          groupId,
          snapshot: x.snapshot || {},
          meta: x.targetUid ? { targetUid: x.targetUid } : null,
          ts: x._ts || new Date().toISOString(),
          shared: true
        }));
        // A reminder aimed at ME → pop a toast (once) so it actually nudges.
        if (!_remindSeen) { try { _remindSeen = new Set(JSON.parse(localStorage.getItem('orbit_remind_seen') || '[]')); } catch (_) { _remindSeen = new Set(); } }
        items.filter((x) => x.type === 'reminder' && x.targetUid && x.targetUid === my).forEach((x) => {
          const k = groupId + '_' + x.id;
          if (_remindSeen.has(k)) return;
          _remindSeen.add(k);
          try { localStorage.setItem('orbit_remind_seen', JSON.stringify([..._remindSeen])); } catch (_) {}
          const amt = (x.snapshot && x.snapshot.amount != null) ? fmtMoney(x.snapshot.amount, x.snapshot.currency || 'INR') : '';
          toast('🔔 ' + (x.actorName || 'Someone') + ' reminded you to settle ' + amt, 'neg');
        });
        const entries = joins.concat(removals).concat(ledger);
        if (entries.length) { State.activity = mergeById(State.activity, entries); softRerender(); }
      });
    }

    // Pull real profile photos (and names) for shared-group members so their
    // avatars show their Google picture everywhere instead of initials. Cached
    // per-uid so we only fetch each member once per session.
    const _photoFetched = new Set();
    async function hydrateMemberPhotos(groups) {
      if (!window.OrbitGroups || typeof OrbitGroups.getProfile !== 'function') return;
      const ids = new Set();
      (groups || []).forEach((g) => (g.members || []).forEach((m) => ids.add(m)));
      let changed = false;
      for (const id of ids) {
        if (_photoFetched.has(id)) continue;
        _photoFetched.add(id);
        const u = State.users.find((x) => x.id === id);
        if (!u || u.isSelf) continue;
        if (String(id).indexOf('u_') === 0) continue;   // local/ghost id, not a real account
        try {
          const prof = await OrbitGroups.getProfile(id);
          if (!prof) continue;
          let upd = false;
          if (prof.photoURL && prof.photoURL !== u.photoURL) { u.photoURL = prof.photoURL; upd = true; }
          if (prof.name && (u.name === 'Member' || !u.name)) { u.name = prof.name; upd = true; }
          if (prof.upi && !u.upi) { u.upi = prof.upi; upd = true; }
          if (prof.email && !u.email) { u.email = prof.email; upd = true; }   // email = canonical identity
          if (upd) { changed = true; try { await OrbitDB.put('users', u); } catch (_) {} }
        } catch (_) {}
      }
      // Now that members carry real emails, collapse any duplicate person
      // (a name-only contact + their joined account that share an email).
      if (reconcileByEmail()) changed = true;
      if (changed) softRerender();
    }

    return {
      start() {
        if (_started) return;
        if (!window.OrbitGroups || !OrbitGroups.isReady()) return;
        _started = true;
        console.log('[Realtime] starting shared-group listeners');
        // Live list of my shared groups.
        _groupsUnsub = OrbitGroups.onMyGroups(async (groups) => {
          // Notify when a NEW member appears in a group — even across sessions.
          // We persist the last-seen member set per group in localStorage, so
          // when you reopen the app after someone joined while you were away,
          // you still get told. Works for every existing member.
          const myUid = (window.OrbitGroups && OrbitGroups.currentUid && OrbitGroups.currentUid()) || null;
          groups.forEach((g) => {
            const now = g.memberUids || [];
            const key = 'orbit_members_' + g.id;
            let prev = _prevMembers[g.id];
            if (!prev) {
              try { const s = JSON.parse(localStorage.getItem(key) || 'null'); if (Array.isArray(s)) prev = new Set(s); } catch (_) {}
            }
            if (prev) {
              now.forEach((mu) => {
                if (!prev.has(mu) && mu !== myUid) {
                  const nm = (g.members && g.members[mu] && g.members[mu].name) || 'Someone';
                  toast(nm + ' joined “' + (g.name || 'the group') + '”', 'pos');
                }
              });
              // Someone in the previous roster is gone — they were removed (or left).
              prev.forEach((mu) => {
                if (!now.includes(mu) && mu !== myUid) {
                  const nm = (g.members && g.members[mu] && g.members[mu].name) || userName(mu) || 'A member';
                  toast(nm + ' was removed from “' + (g.name || 'the group') + '”', 'neg');
                }
              });
            }
            _prevMembers[g.id] = new Set(now);
            try { localStorage.setItem(key, JSON.stringify(now)); } catch (_) {}
          });
          const tagged = groups.map((g) => normalizeSharedGroup(g));
          State.groups = mergeById(State.groups, tagged);
          // Persist shared groups locally so they render instantly on the next
          // reload — even before realtime reconnects. This is why a joined
          // group no longer vanishes on re-login.
          for (const g of tagged) { try { await OrbitDB.put('groups', g); } catch (_) {} }
          // Reconcile: drop any locally-cached SHARED group the server no longer
          // lists for me (I left it, or was removed) so it doesn't linger. The
          // `_prevMembers[g.id]` guard means we only delete a group we've SEEN
          // in a prior snapshot — a freshly-created group still awaiting its
          // first realtime echo is never reconciled away.
          const liveIds = new Set(tagged.map((g) => g.id));
          const stale = State.groups.filter((g) => isSharedGroup(g) && !liveIds.has(g.id) && _prevMembers[g.id]);
          for (const g of stale) {
            State.groups = State.groups.filter((x) => x.id !== g.id);
            try { await OrbitDB.delete('groups', g.id); } catch (_) {}
            try { localStorage.removeItem('orbit_members_' + g.id); } catch (_) {}
            delete _prevMembers[g.id];
          }
          // (Re)subscribe to each shared group's expenses + activity feed.
          tagged.forEach((g) => { watchGroupExpenses(g.id); watchGroupSettlements(g.id); watchGroupActivity(g.id); });
          softRerender();
          hydrateMemberPhotos(tagged);   // fetch members' Google photos in the background
        });

        // Founder: global feed of EVERY join across the whole app.
        if (isFounder() && OrbitGroups.onAdminFeed) {
          _adminUnsub = OrbitGroups.onAdminFeed((items) => {
            const myUid2 = (OrbitGroups.currentUid && OrbitGroups.currentUid()) || null;
            const joins = items.filter((x) => x.type === 'join' && x.uid !== myUid2);  // don't notify the founder about their own joins
            if (!_adminSeen) {
              try { _adminSeen = new Set(JSON.parse(localStorage.getItem('orbit_admin_seen') || '[]')); } catch (_) { _adminSeen = new Set(); }
            }
            const firstEver = _adminSeen.size === 0 && !localStorage.getItem('orbit_admin_seen');
            const fresh = joins.filter((x) => !_adminSeen.has(x.id));
            if (!firstEver) fresh.slice(0, 6).forEach((x) => toast((x.name || 'Someone') + ' joined “' + (x.groupName || 'a group') + '”', 'pos'));
            joins.forEach((x) => _adminSeen.add(x.id));
            try { localStorage.setItem('orbit_admin_seen', JSON.stringify([..._adminSeen])); } catch (_) {}
            const entries = joins.map((x) => ({
              id: 'admin_' + x.id, actorId: x.uid, action: 'join', entityType: 'member', groupId: x.groupId,
              snapshot: { title: (x.name || 'Someone') + ' joined ' + (x.groupName || 'a group') + (x.email ? ' · ' + x.email : '') },
              ts: x._ts || new Date().toISOString(), shared: true
            }));
            if (entries.length) { State.activity = mergeById(State.activity, entries); softRerender(); }
          });
        }
      },
      stop() {
        if (_groupsUnsub) { try { _groupsUnsub(); } catch (_) {} _groupsUnsub = null; }
        if (_adminUnsub) { try { _adminUnsub(); } catch (_) {} _adminUnsub = null; }
        Object.values(_expenseUnsubs).forEach((u) => { try { u(); } catch (_) {} });
        for (const k in _expenseUnsubs) delete _expenseUnsubs[k];
        Object.values(_activityUnsubs).forEach((u) => { try { u(); } catch (_) {} });
        for (const k in _activityUnsubs) delete _activityUnsubs[k];
        _prevMembers = {};
        _started = false;
      }
    };
  })();

  // Kick off realtime once the shared-group layer is ready AND the user is
  // signed in. groups.js dispatches 'orbit-groups-ready' on load; auth may
  // resolve later, so also retry from the existing auth callback path.
  function maybeStartRealtime() {
    try {
      if (window.OrbitGroups && OrbitGroups.isReady()) RealtimeSync.start();
    } catch (_) {}
  }
  window.addEventListener('orbit-groups-ready', () => setTimeout(maybeStartRealtime, 300));

  // ===================================================================
  // PERSONAL FINANCE — NET WORTH  (vertical slice of the FinEase merge)
  // ===================================================================
  function finCurrencies() {
    return (window.OrbitFX && OrbitFX.SUPPORTED) || ['INR', 'USD', 'EUR', 'GBP'];
  }

  function viewNetWorth() {
    const F = window.OrbitFinance;
    const accounts = State.finAccounts || [];
    const finEmptyAll = !State.finAccounts.length && !State.finTxns.length && !State.finLoans.length
      && !State.finInvestments.length && !State.finGoals.length && !State.finBudgets.length && !State.finSubs.length && !State.finRecurring.length;
    const page = h('div', { class: 'page' });
    page.appendChild(h('header', { class: 'page-header' }, [
      h('div', { class: 'title-block' }, [
        h('h1', {}, 'Net worth'),
        h('div', { class: 'sub' }, 'Everything you own and owe, in one place.')
      ]),
      finEmptyAll ? null : h('div', { class: 'actions' }, [
        h('button', { class: 'btn btn-ghost btn-sm', onClick: () => openFinExportMenu() }, '⤓ Export'),
        h('button', { class: 'btn btn-primary btn-sm', onClick: () => openFinAccountModal() }, '+ Add account')
      ])
    ]));

    // First-run: a welcoming, guided start instead of a wall of ₹0 cards.
    if (finEmptyAll) {
      page.appendChild(finWelcomeCard());
      setMain(page); bindTilt(page);
      return;
    }

    // Lead with the headline number — KPI row first (incl. your live Splitwise position).
    const al = F.assetsLiabilities(accounts, finBase());
    const owed = totalOwedToYou(finBase());   // friends owe you (asset)
    const owe = totalYouOwe(finBase());        // you owe friends (liability)
    const fullNet = F.computeNetWorth(finData(), finBase());
    const grid = h('div', { class: 'kpi-grid bal-row' });
    grid.appendChild(kpiCard('Net worth', Math.round(fullNet), finBase(), 'Everything you own & owe', fullNet >= 0 ? 'pos' : 'neg', { hero: true, tilt: true }));
    grid.appendChild(kpiCard('Assets', Math.round(al.assets + F.investmentsTotal(State.finInvestments, finBase()) + owed), finBase(), 'Accounts + investments + owed to you', 'pos', { tilt: true }));
    grid.appendChild(kpiCard('Liabilities', Math.round(al.liabilities + F.loansOutstandingTotal(State.finLoans, finBase()) + owe), finBase(), 'Cards + loans + you owe', 'neg', { tilt: true }));
    page.appendChild(grid);
    page.appendChild(financialVitalsRow());

    // Smart insights (data-driven), below the headline figures.
    const insights = F.generateInsights(finData(), (n) => finMoney(n));
    if (insights.length) {
      const ic = h('div', { class: 'card', style: { marginTop: 'var(--s-5)', marginBottom: 'var(--s-5)' } });
      ic.appendChild(finSectionTitle('bolt', 'Smart insights'));
      const levelColor = { good: 'var(--accent,#2f8f5b)', warn: 'var(--warning,#b8860b)', bad: 'var(--danger,#c0392b)', info: 'var(--info,#2a7de1)' };
      insights.slice(0, 6).forEach((it) => ic.appendChild(h('div', { style: { display: 'flex', gap: '10px', alignItems: 'flex-start', padding: '8px 0', borderTop: '1px solid var(--border)' } }, [
        h('span', { style: { fontSize: '16px' } }, it.icon),
        h('span', { style: { borderLeft: '3px solid ' + (levelColor[it.level] || levelColor.info), paddingLeft: '10px' } }, it.text)
      ])));
      page.appendChild(ic);
    }

    // Splitwise position — unified in, links straight to Settle up.
    if (owed > 0.005 || owe > 0.005) {
      const sw = h('div', { class: 'card clickable', style: { marginTop: 'var(--s-3)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }, onClick: () => { location.hash = '#/settle'; } }, [
        h('div', {}, [
          h('div', { class: 'section-title', style: { margin: 0 } }, '↔ Splitwise balance'),
          h('div', { class: 'sub', style: { fontSize: '12px' } }, 'From your groups & settlements · counts toward net worth')
        ]),
        h('div', { style: { display: 'flex', gap: '20px', textAlign: 'right' } }, [
          h('div', {}, [h('div', { class: 'sub', style: { fontSize: '11px' } }, 'Owed to you'), h('div', { class: 'pos', style: { fontWeight: '600' } }, finMoney(owed))]),
          h('div', {}, [h('div', { class: 'sub', style: { fontSize: '11px' } }, 'You owe'), h('div', { class: 'neg', style: { fontWeight: '600' } }, finMoney(owe))])
        ])
      ]);
      page.appendChild(sw);
    }

    // Other-currency balances, if any (mirrors the dashboard's EUR row).
    const byCur = F.netWorthByCurrency(accounts);
    const others = Object.keys(byCur).filter((c) => c !== finBase() && Math.abs(byCur[c]) > 0.005);
    if (others.length) {
      const row = h('div', { class: 'kpi-grid kpi-grid-3', style: { marginTop: 'var(--s-3)' } });
      others.forEach((c) => row.appendChild(kpiCard(c + ' balance', byCur[c], c, 'Held in ' + c, byCur[c] >= 0 ? 'pos' : 'neg', { tilt: true })));
      page.appendChild(row);
    }

    // Accounts list
    const card = h('div', { class: 'card', style: { marginTop: 'var(--s-5)' } });
    card.appendChild(finSectionTitle('bank', 'Accounts'));
    if (!accounts.length) {
      card.appendChild(h('div', { class: 'empty' }, [
        h('div', { class: 'empty-title' }, 'No accounts yet'),
        h('div', { class: 'empty-sub' }, 'Add a bank account, card, or investment to start tracking your net worth.')
      ]));
    } else {
      accounts.slice().sort((a, b) => (Math.abs(parseFloat(b.balance) || 0)) - (Math.abs(parseFloat(a.balance) || 0)))
        .forEach((a) => card.appendChild(finAccountRow(a)));
    }
    page.appendChild(card);

    setMain(page);
    bindTilt(page);
  }

  function finAccountRow(a) {
    const F = window.OrbitFinance;
    const typeLabel = (F.ACCOUNT_TYPES.find((t) => t.key === a.type) || {}).label || a.type;
    const liability = F.accountSign(a.type) < 0;
    return h('div', {
      class: 'clickable',
      style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--s-3)', padding: '12px 4px', borderTop: '1px solid var(--border)' }
    }, [
      h('div', { style: { minWidth: 0 } }, [
        h('div', { style: { fontWeight: '600' } }, a.name || 'Account'),
        h('div', { class: 'sub', style: { fontSize: '12px' } }, typeLabel + ' · ' + (a.currency || 'INR'))
      ]),
      h('div', { style: { display: 'flex', alignItems: 'center', gap: 'var(--s-3)' } }, [
        h('div', { class: liability ? 'neg' : 'pos', style: { fontVariantNumeric: 'tabular-nums', fontWeight: '600' } },
          (liability ? '−' : '') + fmtMoney(Math.abs(parseFloat(a.balance) || 0), a.currency || 'INR')),
        h('button', { class: 'btn btn-ghost btn-sm', title: 'Edit', onClick: (e) => { e.stopPropagation(); openFinAccountModal(a); } }, 'Edit'),
        h('button', { class: 'btn btn-ghost btn-sm', title: 'Delete', onClick: (e) => { e.stopPropagation(); deleteFinAccount(a); } }, '🗑')
      ])
    ]);
  }

  function openFinAccountModal(existing) {
    const F = window.OrbitFinance;
    const editing = !!existing;
    const a = existing || { name: '', type: 'savings', balance: '', currency: 'INR' };

    const nameInput = h('input', { class: 'input', value: a.name || '', placeholder: 'e.g., HDFC Savings' });
    const typeSel = h('select', { class: 'select' },
      F.ACCOUNT_TYPES.map((t) => h('option', { value: t.key, selected: t.key === a.type ? '' : null }, t.label)));
    const balInput = h('input', { class: 'input', type: 'number', step: '0.01', value: a.balance === '' ? '' : a.balance, placeholder: '50000' });
    const curSel = h('select', { class: 'select' },
      finCurrencies().map((c) => h('option', { value: c, selected: c === (a.currency || 'INR') ? '' : null }, c)));

    const modal = h('div', { class: 'modal modal-sm' }, [
      h('div', { class: 'modal-head' }, [
        h('h2', {}, editing ? 'Edit account' : 'Add account'),
        h('button', { class: 'close', onClick: closeModal }, '×')
      ]),
      h('div', { class: 'modal-body' }, [
        formRow('Account name', nameInput),
        h('div', { class: 'input-row' }, [formRow('Type', typeSel), formRow('Currency', curSel)]),
        formRow('Current balance', balInput)
      ]),
      h('div', { class: 'modal-foot' }, [
        editing ? h('button', { class: 'btn btn-ghost btn-sm', onClick: () => deleteFinAccount(a) }, 'Delete') : null,
        h('button', { class: 'btn btn-ghost btn-sm', onClick: closeModal }, 'Cancel'),
        h('button', {
          class: 'btn btn-primary btn-sm', onClick: () => {
            const name = nameInput.value.trim();
            const balance = parseFloat(balInput.value);
            if (!name) { toast('Give the account a name', 'neg'); nameInput.focus(); return; }
            if (isNaN(balance)) { toast('Enter a valid balance', 'neg'); balInput.focus(); return; }
            saveFinAccount({
              id: a.id || uid('fa'),
              name, type: typeSel.value, currency: curSel.value, balance
            });
          }
        }, editing ? 'Save' : 'Add account')
      ])
    ]);
    openModal(modal);
  }

  async function saveFinAccount(acct) {
    await OrbitDB.put('fin_accounts', acct);
    State.finAccounts = await OrbitDB.getAll('fin_accounts');
    await snapshotFinNetWorth();
    closeModal();
    toast('Account saved', 'pos');
    if (State.route.name === 'networth') render();
  }

  async function deleteFinAccount(acct) {
    if (!confirm('Delete "' + (acct.name || 'this account') + '"?')) return;
    await OrbitDB.delete('fin_accounts', acct.id);
    State.finAccounts = await OrbitDB.getAll('fin_accounts');
    await snapshotFinNetWorth();
    closeModal();
    toast('Account deleted');
    if (State.route.name === 'networth') render();
  }

  // Record today's net-worth snapshot (one per day) for the future Trends chart.
  async function snapshotFinNetWorth() {
    try {
      const net = window.OrbitFinance.computeNetWorth(finData(), finBase());
      const updated = window.OrbitFinance.snapshotNetWorth(State.finNwHistory, net);
      const today = updated[updated.length - 1];
      if (today) await OrbitDB.put('fin_nwhistory', today);
      State.finNwHistory = updated;
    } catch (_) {}
  }

  // ---- shared finance helpers ----
  function finBase() { return State.finBase || 'INR'; }
  // Personal-finance money is shown to whole units (no paise) for a clean,
  // consistent read across KPIs and lists; stored values keep full precision.
  function finMoney(amt, cur) { return fmtMoney(Math.round(parseFloat(amt) || 0), cur || finBase()); }

  // ---- UNIFICATION: Splitwise <-> personal finance, derived (no duplicates) ----
  // Map Orbit's expense categories onto the finance category taxonomy.
  const ORBIT_CAT_TO_FIN = { food: 'food', travel: 'transport', bills: 'utilities', shop: 'shopping', fun: 'entertainment', rent: 'housing', transport: 'transport', other: 'other' };

  // Your TRUE spending from shared expenses = your split share of each expense
  // (not the full bill, not what you paid). Returned as read-only virtual
  // transactions so they flow into budgets / categories / trends / insights
  // without ever being stored — the Splitwise ledger stays the single source.
  function finVirtualTxns() {
    const base = finBase();
    return (State.expenses || []).map((e) => {
      if ((e.currency || 'INR') !== base) return null;
      const share = (Array.isArray(e.splits) ? (e.splits.find((s) => s && s.userId === State.selfId) || {}).amount : 0) || 0;
      if (share <= 0) return null;
      return { id: 'split_' + e.id, type: 'expense', amount: share, date: e.date,
        category: ORBIT_CAT_TO_FIN[e.category] || 'other', description: e.title || 'Shared expense',
        source: 'split', _ro: true };
    }).filter(Boolean);
  }
  // Real personal transactions + derived split-share transactions, merged.
  function finAllTxns() { return (State.finTxns || []).concat(finVirtualTxns()); }
  // Your net Splitwise position in the base currency (owed to you − you owe).
  function finSplitwiseNet() { try { return computeNetByCurrency()[finBase()] || 0; } catch (_) { return 0; } }

  function finData() {
    return {
      accounts: State.finAccounts, investments: State.finInvestments, loans: State.finLoans,
      txns: finAllTxns(), budgets: State.finBudgets, goals: State.finGoals,
      subs: State.finSubs, nwHistory: State.finNwHistory, recurring: State.finRecurring,
      splitwiseNet: finSplitwiseNet()
    };
  }
  const FIN_ROUTES = ['networth', 'transactions', 'budgets', 'goals', 'loans', 'investments', 'subscriptions', 'trends', 'recurring', 'cashflow', 'pending'];
  function finRerender() { if (FIN_ROUTES.includes(State.route.name)) render(); }
  async function finReload(store, key) { try { State[key] = await OrbitDB.getAll(store); } catch (_) {} }
  function finProgressBar(pct, color) {
    const bar = h('div', { style: { background: 'var(--surface-2, rgba(0,0,0,0.06))', borderRadius: '999px', height: '8px', overflow: 'hidden', margin: '8px 0' } });
    bar.appendChild(h('div', { style: { height: '100%', width: Math.max(0, Math.min(100, pct)) + '%', background: color, borderRadius: '999px', transition: 'width .3s' } }));
    return bar;
  }
  function finPageHeader(title, sub, addLabel, onAdd) {
    return h('header', { class: 'page-header' }, [
      h('div', { class: 'title-block' }, [h('h1', {}, title), h('div', { class: 'sub' }, sub)]),
      h('div', { class: 'actions' }, [onAdd ? h('button', { class: 'btn btn-primary btn-sm', onClick: onAdd }, addLabel) : null])
    ]);
  }
  // Cohesive monochrome icon set (24×24 stroke icons matching the nav), so the
  // finance UI reads consistently across OSes instead of relying on emoji.
  const FIN_ICON_PATHS = {
    wallet: '<path d="M3 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2H5a2 2 0 0 0 0 4h14v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><circle cx="16" cy="13" r="1.2" fill="currentColor" stroke="none"/>',
    receipt: '<path d="M5 3v18l2-1.4 2 1.4 2-1.4 2 1.4 2-1.4 2 1.4V3l-2 1.4L14 3l-2 1.4L10 3 8 4.4z"/><path d="M8 9h8M8 13h6"/>',
    chart: '<path d="M4 19V5"/><path d="M4 19h16"/><path d="M8 16l3-4 3 2 4-6"/>',
    target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.5"/>',
    bank: '<path d="M3 10l9-6 9 6"/><path d="M5 10v8M19 10v8M9 10v8M15 10v8"/><path d="M3 20h18"/>',
    repeat: '<path d="M21 12a9 9 0 1 1-3-6.7L21 7"/><path d="M21 3v4h-4"/>',
    bolt: '<path d="M13 2 4 14h6l-1 8 9-12h-6z"/>',
    pie: '<path d="M12 3v9l8 2A9 9 0 1 0 12 3z"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 9h18M8 3v4M16 3v4"/>',
    tag: '<path d="M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9z"/><circle cx="7.5" cy="7.5" r="1.4"/>',
    card: '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M3 10h18M7 15h4"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    coins: '<ellipse cx="9" cy="6" rx="6" ry="3"/><path d="M3 6v6c0 1.7 2.7 3 6 3s6-1.3 6-3V6"/><path d="M9 12c-3.3 0-6-1.3-6-3"/><ellipse cx="16" cy="15" rx="5" ry="2.6"/><path d="M11 15v4c0 1.4 2.2 2.5 5 2.5s5-1.1 5-2.5v-4"/>',
    sparkle: '<path d="M12 3l1.6 5L19 9.5l-5.4 1.5L12 16l-1.6-5L5 9.5 10.4 8z"/>'
  };
  function finIcon(name, size, color) {
    const wrap = document.createElement('span');
    wrap.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;color:' + (color || 'var(--accent,#34B87A)');
    wrap.innerHTML = '<svg width="' + (size || 18) + '" height="' + (size || 18) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' + (FIN_ICON_PATHS[name] || FIN_ICON_PATHS.coins) + '</svg>';
    return wrap;
  }

  // Welcoming first-run card for the Money section (shown when there's no data).
  function finWelcomeCard() {
    const chip = (icon, label) => h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', padding: '11px 13px', border: '1px solid var(--border)', borderRadius: 'var(--r-4,10px)' } }, [finIcon(icon, 18), h('span', { style: { fontWeight: '600', fontSize: '13px' } }, label)]);
    const card = h('div', { class: 'card', style: { textAlign: 'center', padding: '34px 20px' } }, [
      h('div', { style: { display: 'inline-flex', padding: '14px', borderRadius: '50%', background: 'var(--accent-soft,rgba(52,184,122,0.12))' } }, finIcon('coins', 30)),
      h('h2', { style: { fontFamily: 'var(--font-display)', margin: '14px 0 6px', fontSize: '24px' } }, 'Your money, all in one place'),
      h('div', { class: 'sub', style: { maxWidth: '460px', margin: '0 auto 20px' } }, 'Track net worth, spending, budgets, goals, loans and subscriptions — and see how your group expenses fit in. Everything syncs across your devices.'),
      h('div', { style: { display: 'flex', gap: '10px', justifyContent: 'center', flexWrap: 'wrap', marginBottom: '22px' } }, [
        h('button', { class: 'btn btn-primary', onClick: () => loadFinanceDemo() }, 'Explore with sample data'),
        h('button', { class: 'btn btn-ghost', onClick: () => openFinAccountModal() }, '+ Add your first account')
      ]),
      h('div', { class: 'grid-cols-3', style: { maxWidth: '560px', margin: '0 auto', gap: '10px', textAlign: 'left' } }, [
        chip('receipt', 'Every transaction'), chip('target', 'Budgets & goals'), chip('chart', 'Net worth & trends'),
        chip('bank', 'Loans & EMIs'), chip('repeat', 'Subscriptions'), chip('bolt', 'Quick add by typing')
      ])
    ]);
    return card;
  }

  function finEmpty(title, sub, withSeed, icon) {
    const kids = [
      h('div', { style: { display: 'inline-flex', padding: '12px', borderRadius: '50%', background: 'var(--surface-2,rgba(127,127,127,0.08))', marginBottom: '10px' } }, finIcon(icon || 'coins', 24, 'var(--text-3,#94a3b8)')),
      h('div', { class: 'empty-title' }, title), h('div', { class: 'empty-sub' }, sub)
    ];
    if (withSeed) kids.push(h('div', { style: { marginTop: '12px' } }, h('button', { class: 'btn btn-ghost btn-sm', onClick: () => loadFinanceDemo() }, 'Load sample data')));
    return h('div', { class: 'empty fin-empty' }, kids);
  }

  // ---- SAMPLE DATA: one-click populate every Money screen (opt-in, like Orbit's
  // "Load demo data"). Fixed ids so re-running overwrites instead of duplicating.
  async function loadFinanceDemo() {
    const dISO = (days) => { const d = new Date(); d.setDate(d.getDate() - days); return d.toISOString(); };
    const dDate = (days) => dISO(days).slice(0, 10);
    const monthStart = (m) => { const d = new Date(); d.setMonth(d.getMonth() + m, 1); return d.toISOString().slice(0, 10); };
    const yearsAgo = (y) => { const d = new Date(); d.setFullYear(d.getFullYear() - y); return d.toISOString().slice(0, 10); };

    const accounts = [
      { id: 'fa_hdfc', name: 'HDFC Savings', type: 'savings', balance: 240000, currency: 'INR' },
      { id: 'fa_icici', name: 'ICICI Salary', type: 'checking', balance: 85000, currency: 'INR' },
      { id: 'fa_cash', name: 'Cash', type: 'cash', balance: 6000, currency: 'INR' },
      { id: 'fa_home', name: 'Home (property)', type: 'other', balance: 6500000, currency: 'INR' },
      { id: 'fa_amex', name: 'HDFC Credit Card', type: 'credit', balance: 18500, currency: 'INR' }
    ];
    const investments = [
      { id: 'fi_nifty', fundName: 'Nifty 50 Index Fund', platform: 'Zerodha', category: 'equity', currentValue: 320000, currency: 'INR' },
      { id: 'fi_ppfas', fundName: 'Parag Parikh Flexi Cap', platform: 'Groww', category: 'equity', currentValue: 180000, currency: 'INR' },
      { id: 'fi_gold', fundName: 'Sovereign Gold Bond', platform: 'Zerodha', category: 'gold', currentValue: 95000, currency: 'INR' },
      { id: 'fi_liquid', fundName: 'Liquid Fund', platform: 'Direct', category: 'liquid', currentValue: 60000, currency: 'INR' }
    ];
    const loans = [
      { id: 'fl_home', name: 'Home Loan', emi: 38000, principal: 4200000, interestRate: 8.5, startDate: yearsAgo(2), endDate: '2044-01-01', currency: 'INR' },
      { id: 'fl_car', name: 'Car Loan', emi: 15500, principal: 480000, interestRate: 9.2, startDate: yearsAgo(1), endDate: '2029-06-01', currency: 'INR' }
    ];
    const txns = [
      { id: 'ft_sal', type: 'income', amount: 120000, date: dDate(3), category: 'salary', description: 'Monthly salary', account: 'ICICI Salary' },
      { id: 'ft_gro', type: 'expense', amount: 4200, date: dDate(2), category: 'food', description: 'BigBasket groceries', account: 'HDFC Savings' },
      { id: 'ft_fuel', type: 'expense', amount: 3000, date: dDate(2), category: 'transport', description: 'Fuel', account: '' },
      { id: 'ft_elec', type: 'expense', amount: 2400, date: dDate(1), category: 'utilities', description: 'Electricity bill', account: 'HDFC Savings' },
      { id: 'ft_dine', type: 'expense', amount: 1800, date: dDate(1), category: 'food', description: 'Dinner out', account: '' },
      { id: 'ft_amz', type: 'expense', amount: 2600, date: dDate(0), category: 'shopping', description: 'Amazon order', account: 'HDFC Credit Card' },
      { id: 'ft_xfer', type: 'transfer', amount: 20000, date: dDate(4), description: 'Move to savings', fromAccount: 'ICICI Salary', toAccount: 'HDFC Savings' }
    ];
    const budgets = [
      { id: 'fb_food', category: 'food', amount: 15000 },
      { id: 'fb_transport', category: 'transport', amount: 8000 },
      { id: 'fb_shopping', category: 'shopping', amount: 10000 },
      { id: 'fb_entertainment', category: 'entertainment', amount: 5000 }
    ];
    const goals = [
      { id: 'fg_ef', name: 'Emergency Fund', target: 300000, saved: 140000, targetDate: null, monthlyContribution: 20000 },
      { id: 'fg_goa', name: 'Goa Trip', target: 80000, saved: 25000, targetDate: monthStart(6), monthlyContribution: 10000 }
    ];
    const subs = [
      { id: 'fs_net', name: 'Netflix', amount: 649, cycle: 'monthly', nextRenewal: dDate(-9), category: 'entertainment' },
      { id: 'fs_spot', name: 'Spotify', amount: 119, cycle: 'monthly', nextRenewal: dDate(-3), category: 'entertainment' },
      { id: 'fs_prime', name: 'Amazon Prime', amount: 1499, cycle: 'yearly', nextRenewal: dDate(-120), category: 'shopping' },
      { id: 'fs_icloud', name: 'iCloud+', amount: 75, cycle: 'monthly', nextRenewal: dDate(-20), category: 'cloud' }
    ];
    const recurring = [
      { id: 'fr_rent', type: 'expense', amount: 28000, description: 'Monthly Rent', category: 'housing', frequency: 'monthly', nextDate: monthStart(1), account: 'HDFC Savings', active: true },
      { id: 'fr_sal', type: 'income', amount: 120000, description: 'Salary', category: 'salary', frequency: 'monthly', nextDate: monthStart(1), account: 'ICICI Salary', active: true }
    ];

    // Tag every seeded record so "Clear demo data" can remove exactly the
    // sample finance data and leave anything the user added themselves intact.
    const put = async (store, arr) => { for (const r of arr) await OrbitDB.put(store, { ...r, demo: true }); };
    await put('fin_accounts', accounts);
    await put('fin_investments', investments);
    await put('fin_loans', loans);
    await put('fin_txns', txns);
    await put('fin_budgets', budgets);
    await put('fin_goals', goals);
    await put('fin_subs', subs);
    await put('fin_recurring', recurring);

    await finReload('fin_accounts', 'finAccounts');
    await finReload('fin_investments', 'finInvestments');
    await finReload('fin_loans', 'finLoans');
    await finReload('fin_txns', 'finTxns');
    await finReload('fin_budgets', 'finBudgets');
    await finReload('fin_goals', 'finGoals');
    await finReload('fin_subs', 'finSubs');
    await finReload('fin_recurring', 'finRecurring');

    // Seed ~6 months of net-worth history so Trends looks alive.
    const nwNow = window.OrbitFinance.computeNetWorth(finData(), finBase());
    for (let i = 6; i >= 0; i--) {
      const d = new Date(); d.setMonth(d.getMonth() - i, 1);
      await OrbitDB.put('fin_nwhistory', { date: d.toISOString().slice(0, 10), netWorth: Math.round(nwNow * (1 - i * 0.035)), demo: true });
    }
    await finReload('fin_nwhistory', 'finNwHistory');

    toast('Sample finance data loaded', 'pos');
    finRerender();
  }
  window.loadFinanceDemo = loadFinanceDemo;

  // ===== TRANSACTIONS =====
  let _txnMonth = null; // {y, m}; null = current
  let _txnFilter = { q: '', type: 'all', category: 'all', account: 'all', method: 'all', status: 'all', period: 'month' };
  let _txnSelected = new Set();
  function txnFilterActive() { return _txnFilter.q || ['type', 'category', 'account', 'method', 'status'].some((k) => _txnFilter[k] !== 'all'); }
  function txnMonthYM() {
    if (_txnMonth) return _txnMonth;
    const n = new Date(); return { y: n.getFullYear(), m: n.getMonth() };
  }
  // Resolve the set of transactions for the current period + filters.
  function txnPeriodRange() {
    const now = new Date();
    if (_txnFilter.period === 'all') return null;
    if (_txnFilter.period === 'year') return { from: new Date(now.getFullYear(), 0, 1), to: new Date(now.getFullYear(), 11, 31, 23, 59, 59) };
    if (_txnFilter.period === '3mo') return { from: new Date(now.getFullYear(), now.getMonth() - 2, 1), to: new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59) };
    const { y, m } = txnMonthYM();
    return { from: new Date(y, m, 1), to: new Date(y, m + 1, 0, 23, 59, 59) };
  }
  function currentTxnList() {
    const F = window.OrbitFinance;
    let list = finAllTxns();
    const range = txnPeriodRange();
    if (range) list = list.filter((t) => { const d = new Date(t.date); return d >= range.from && d <= range.to; });
    list = F.filterTransactions(list, _txnFilter);
    return list.sort((a, b) => new Date(b.date) - new Date(a.date));
  }

  function viewTransactions() {
    const F = window.OrbitFinance;
    const { y, m } = txnMonthYM();
    const monthLabel = new Date(y, m, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    const page = h('div', { class: 'page' });
    page.appendChild(h('header', { class: 'page-header' }, [
      h('div', { class: 'title-block' }, [h('h1', {}, 'Transactions'), h('div', { class: 'sub' }, 'Every transaction, in full detail. Search, filter, tag, import.')]),
      h('div', { class: 'actions' }, [
        h('button', { class: 'btn btn-ghost btn-sm', onClick: () => openTxnImport() }, '⤒ Import CSV'),
        h('button', { class: 'btn btn-ghost btn-sm', onClick: () => openFinanceQuickAdd() }, '⚡ Quick add'),
        h('button', { class: 'btn btn-primary btn-sm', onClick: () => openTxnModal() }, '+ Add transaction')
      ])
    ]));

    // Summary for the selected month (always month-based so KPIs stay meaningful)
    const summary = F.monthlyTransactions(finAllTxns(), y, m);
    const grid = h('div', { class: 'kpi-grid' });
    grid.appendChild(kpiCard('Income', Math.round(summary.income), finBase(), monthLabel, 'pos', { tilt: true }));
    grid.appendChild(kpiCard('Expenses', Math.round(summary.expense), finBase(), monthLabel, 'neg', { tilt: true }));
    grid.appendChild(kpiCard('Net', Math.round(summary.net), finBase(), 'Income − expenses', summary.net >= 0 ? 'pos' : 'neg', { tilt: true }));
    page.appendChild(grid);

    // ---- Filter bar ----
    const opt = (val, label, sel) => h('option', { value: val, selected: val === sel ? '' : null }, label);
    const mkSel = (key, items) => { const s = h('select', { class: 'select', style: { minWidth: '120px' }, onChange: (e) => { _txnFilter[key] = e.target.value; render(); } }, items.map((it) => opt(it[0], it[1], _txnFilter[key]))); return s; };
    const search = h('input', { class: 'input', type: 'search', value: _txnFilter.q, placeholder: '🔍 Search description, payee, tag, notes…', style: { flex: 1, minWidth: '200px' } });
    search.addEventListener('input', () => { _txnFilter.q = search.value; clearTimeout(viewTransactions._t); viewTransactions._t = setTimeout(() => render(), 200); });
    const catItems = [['all', 'All categories']].concat(Object.keys({ ...F.TXN_EXPENSE_CATEGORIES, ...F.TXN_INCOME_CATEGORIES }).map((k) => [k, F.txnCategoryLabel(k)]));
    const acctItems = [['all', 'All accounts']].concat(State.finAccounts.map((a) => [a.name, a.name]));
    const methodItems = [['all', 'Any method']].concat(Object.keys(F.PAYMENT_METHODS).map((k) => [k, F.PAYMENT_METHODS[k]]));
    // Collapsible filter facets — on desktop they sit inline; on mobile they
    // hide behind a "Filters" toggle so the bar stays short (and never sticky-
    // overlaps the ledger). The body is an opaque card, not a glass overlay.
    const activeCount = ['type', 'category', 'account', 'method', 'status'].filter((kk) => _txnFilter[kk] !== 'all').length + (_txnFilter.period !== 'month' ? 1 : 0);
    const facets = h('div', { class: 'txn-filters-body' }, [
      mkSel('period', [['month', 'This month'], ['3mo', 'Last 3 months'], ['year', 'This year'], ['all', 'All time']]),
      mkSel('type', [['all', 'All types'], ['expense', 'Expense'], ['income', 'Income'], ['transfer', 'Transfer']]),
      mkSel('category', catItems),
      mkSel('account', acctItems),
      mkSel('method', methodItems),
      mkSel('status', [['all', 'Any status'], ['cleared', 'Cleared'], ['pending', 'Pending']])
    ]);
    const filterCard = h('div', { class: 'card txn-filter-card', style: { marginTop: 'var(--s-3)', padding: '10px 12px' } });
    const toggleBtn = h('button', { class: 'btn btn-ghost btn-sm txn-filter-toggle', onClick: () => filterCard.classList.toggle('open') }, [
      finIcon('tag', 14, 'currentColor'), h('span', {}, 'Filters' + (activeCount ? ' · ' + activeCount : ''))
    ]);
    const clearBtn = (txnFilterActive() || _txnFilter.period !== 'month') ? h('button', { class: 'btn btn-ghost btn-sm', onClick: () => { _txnFilter = { q: '', type: 'all', category: 'all', account: 'all', method: 'all', status: 'all', period: 'month' }; render(); } }, 'Clear') : null;
    filterCard.appendChild(h('div', { class: 'txn-filter-top', style: { display: 'flex', gap: '8px', alignItems: 'center' } }, [search, toggleBtn, clearBtn]));
    filterCard.appendChild(facets);
    if (activeCount) filterCard.classList.add('open');
    page.appendChild(filterCard);

    // Month nav (only when period = month)
    if (_txnFilter.period === 'month') {
      page.appendChild(h('div', { style: { display: 'flex', alignItems: 'center', gap: 'var(--s-3)', marginTop: 'var(--s-3)' } }, [
        h('button', { class: 'btn btn-ghost btn-sm', title: 'Previous month', onClick: () => { _txnMonth = { y: m === 0 ? y - 1 : y, m: m === 0 ? 11 : m - 1 }; render(); } }, '‹'),
        h('div', { style: { fontWeight: '600', minWidth: '160px', textAlign: 'center' } }, monthLabel),
        h('button', { class: 'btn btn-ghost btn-sm', title: 'Next month', onClick: () => { _txnMonth = { y: m === 11 ? y + 1 : y, m: m === 11 ? 0 : m + 1 }; render(); } }, '›')
      ]));
    }

    // ---- Bulk-action bar ----
    const rows = currentTxnList();
    const selectable = rows.filter((t) => t.source !== 'split');
    if (_txnSelected.size) {
      page.appendChild(h('div', { class: 'card', style: { marginTop: 'var(--s-3)', padding: '8px 12px', display: 'flex', alignItems: 'center', gap: '10px', background: 'rgba(52,184,122,0.10)' } }, [
        h('strong', {}, _txnSelected.size + ' selected'),
        h('button', { class: 'btn btn-ghost btn-sm', onClick: () => bulkRecategorize() }, 'Recategorize'),
        h('button', { class: 'btn btn-ghost btn-sm', onClick: () => bulkTag() }, 'Tag'),
        h('button', { class: 'btn btn-ghost btn-sm', onClick: () => bulkDelete() }, '🗑 Delete'),
        h('button', { class: 'btn btn-ghost btn-sm', style: { marginLeft: 'auto' }, onClick: () => { _txnSelected.clear(); render(); } }, 'Clear selection')
      ]));
    }

    const card = h('div', { class: 'card', style: { marginTop: 'var(--s-3)' } });
    card.appendChild(h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } }, [
      h('div', { class: 'section-title', style: { margin: 0 } }, 'Ledger · ' + rows.length + ' ' + (rows.length === 1 ? 'transaction' : 'transactions')),
      selectable.length ? h('button', { class: 'btn btn-ghost btn-sm', onClick: () => { const allSel = selectable.every((t) => _txnSelected.has(t.id)); _txnSelected = new Set(allSel ? [] : selectable.map((t) => t.id)); render(); } }, selectable.every((t) => _txnSelected.has(t.id)) ? 'Deselect all' : 'Select all') : null
    ]));
    if (!rows.length) card.appendChild(finEmpty('No matching transactions', txnFilterActive() ? 'Try clearing filters.' : 'Add income, an expense, a transfer, or import a statement.', !txnFilterActive()));
    else rows.forEach((t) => card.appendChild(txnRow(t)));
    page.appendChild(card);
    setMain(page); bindTilt(page);
  }

  function txnRow(t) {
    const F = window.OrbitFinance;
    const isSplit = t.source === 'split';
    const pending = (t.status === 'pending');
    let amtEl, metaParts;
    if (t.type === 'transfer') {
      amtEl = h('div', { style: { fontWeight: '600', color: 'var(--text-2)', fontVariantNumeric: 'tabular-nums' } }, '⇄ ' + finMoney(t.amount));
      metaParts = ['Transfer · ' + (t.fromAccount || '?') + ' → ' + (t.toAccount || '?')];
    } else {
      const inc = t.type === 'income';
      amtEl = h('div', { class: inc ? 'pos' : 'neg', style: { fontWeight: '600', fontVariantNumeric: 'tabular-nums' } }, (inc ? '+' : '−') + finMoney(t.amount));
      metaParts = [F.txnCategoryLabel(t.category)];
      if (isSplit) metaParts.push('your share');
      else {
        if (t.payee) metaParts.unshift(t.payee);
        if (t.method) metaParts.push((F.METHOD_ICON[t.method] || '') + ' ' + (F.PAYMENT_METHODS[t.method] || t.method));
        if (t.account) metaParts.push(t.account);
      }
    }
    const badges = h('span', { style: { display: 'inline-flex', gap: '4px', marginLeft: '6px' } }, [
      pending ? h('span', { class: 'sub', style: { fontSize: '10px', padding: '1px 6px', borderRadius: '999px', background: 'rgba(184,134,11,0.18)', color: 'var(--warning,#b8860b)' } }, 'PENDING') : null,
      t.attachment ? h('span', { title: 'Has receipt', style: { fontSize: '11px' } }, '📎') : null,
      ...((t.tags || []).slice(0, 3).map((tg) => h('span', { class: 'sub', style: { fontSize: '10px', padding: '1px 6px', borderRadius: '999px', background: 'rgba(127,127,127,0.14)' } }, '#' + tg)))
    ]);
    const left = h('div', { style: { minWidth: 0, flex: 1, cursor: 'pointer' }, onClick: () => openTxnDetail(t) }, [
      h('div', { style: { fontWeight: '600' } }, [t.description || '(no description)', badges]),
      h('div', { class: 'sub', style: { fontSize: '12px' } }, metaParts.join(' · ') + ' · ' + fmtDateShort(t.date))
    ]);
    const checkbox = isSplit ? h('span', { class: 'sub', style: { fontSize: '11px', padding: '2px 8px', borderRadius: '999px', background: 'rgba(127,127,127,0.12)' } }, '↔ Split')
      : h('input', { type: 'checkbox', checked: _txnSelected.has(t.id) ? '' : null, style: { width: '16px', height: '16px' }, onChange: (e) => { if (e.target.checked) _txnSelected.add(t.id); else _txnSelected.delete(t.id); render(); } });
    return h('div', { style: { display: 'flex', alignItems: 'center', gap: 'var(--s-3)', padding: '11px 4px', borderTop: '1px solid var(--border)' } }, [
      checkbox, left, amtEl
    ]);
  }

  function openTxnDetail(t) {
    const F = window.OrbitFinance;
    const row = (k, v) => v ? h('div', { style: { display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderTop: '1px solid var(--border)' } }, [h('span', { class: 'sub' }, k), h('span', { style: { fontWeight: '500', textAlign: 'right' } }, v)]) : null;
    const isSplit = t.source === 'split';
    const modal = h('div', { class: 'modal modal-sm' }, [
      h('div', { class: 'modal-head' }, [h('h2', {}, t.description || 'Transaction'), h('button', { class: 'close', onClick: closeModal }, '×')]),
      h('div', { class: 'modal-body' }, [
        h('div', { class: t.type === 'income' ? 'pos' : t.type === 'transfer' ? '' : 'neg', style: { fontSize: '26px', fontWeight: '700', marginBottom: '10px' } }, (t.type === 'income' ? '+' : t.type === 'transfer' ? '⇄ ' : '−') + finMoney(t.amount)),
        row('Type', t.type[0].toUpperCase() + t.type.slice(1)),
        row('Date', fmtDateShort(t.date)),
        t.type !== 'transfer' ? row('Category', F.txnCategoryLabel(t.category)) : null,
        t.payee ? row('Payee', t.payee) : null,
        t.method ? row('Method', (F.METHOD_ICON[t.method] || '') + ' ' + (F.PAYMENT_METHODS[t.method] || t.method)) : null,
        t.account ? row('Account', t.account) : null,
        t.fromAccount ? row('From → To', t.fromAccount + ' → ' + t.toAccount) : null,
        row('Status', (t.status || 'cleared') === 'pending' ? '⏳ Pending' : '✓ Cleared'),
        (t.tags || []).length ? row('Tags', t.tags.map((x) => '#' + x).join(' ')) : null,
        t.notes ? row('Notes', t.notes) : null,
        isSplit ? row('Source', 'Shared expense (auto)') : null,
        t.attachment ? h('img', { src: t.attachment, style: { maxWidth: '100%', marginTop: '10px', borderRadius: '8px', border: '1px solid var(--border)' } }) : null
      ]),
      h('div', { class: 'modal-foot' }, isSplit
        ? [h('button', { class: 'btn btn-ghost btn-sm', onClick: () => { closeModal(); location.hash = '#/settle'; } }, 'Open in Split'), h('button', { class: 'btn btn-ghost btn-sm', onClick: closeModal }, 'Close')]
        : [
          h('button', { class: 'btn btn-ghost btn-sm', onClick: () => { closeModal(); deleteFin('fin_txns', 'finTxns', t.id, 'Transaction'); } }, '🗑 Delete'),
          h('button', { class: 'btn btn-ghost btn-sm', onClick: () => { closeModal(); openTxnModal(t); } }, 'Edit'),
          h('button', { class: 'btn btn-primary btn-sm', onClick: closeModal }, 'Close')
        ])
    ]);
    openModal(modal);
  }

  function openTxnModal(existing) {
    const F = window.OrbitFinance;
    const editing = !!existing;
    const t = existing || { type: 'expense', amount: '', date: toDateInput(Date.now()), category: 'other', description: '', payee: '', method: '', account: '', notes: '', fromAccount: '', toAccount: '', tags: [], status: 'cleared', attachment: '' };
    const accountOpts = (placeholder) => [placeholder ? h('option', { value: '' }, placeholder) : null].concat(State.finAccounts.map((a) => h('option', { value: a.name }, a.name)));

    const typeSel = h('select', { class: 'select' }, ['expense', 'income', 'transfer'].map((x) => h('option', { value: x, selected: x === t.type ? '' : null }, x[0].toUpperCase() + x.slice(1))));
    const amt = h('input', { class: 'input', type: 'number', step: '0.01', value: t.amount, placeholder: '1500' });
    const date = h('input', { class: 'input', type: 'date', value: toDateInput(t.date) });
    const desc = h('input', { class: 'input', value: t.description || '', placeholder: 'e.g., Grocery run at BigBasket' });
    const payee = h('input', { class: 'input', value: t.payee || '', placeholder: 'Merchant / who' });
    const catSel = h('select', { class: 'select' });
    const methodSel = h('select', { class: 'select' }, [h('option', { value: '' }, '— Method —')].concat(Object.keys(F.PAYMENT_METHODS).map((k) => h('option', { value: k, selected: k === t.method ? '' : null }, F.PAYMENT_METHODS[k]))));
    const acct = h('select', { class: 'select' }, accountOpts('— None —'));
    const fromAcct = h('select', { class: 'select' }, accountOpts(null));
    const toAcct = h('select', { class: 'select' }, accountOpts(null));
    const statusSel = h('select', { class: 'select' }, [['cleared', 'Cleared'], ['pending', 'Pending']].map(([v, l]) => h('option', { value: v, selected: v === (t.status || 'cleared') ? '' : null }, l)));
    const tagsInp = h('input', { class: 'input', value: (t.tags || []).join(', '), placeholder: 'comma, separated, tags' });
    const notes = h('input', { class: 'input', value: t.notes || '', placeholder: 'Optional note' });
    let attachmentData = t.attachment || '';
    const fileInp = h('input', { type: 'file', accept: 'image/*', style: { fontSize: '12px' } });
    const fileHint = h('span', { class: 'sub', style: { fontSize: '11px' } }, attachmentData ? '📎 attached' : '');
    fileInp.addEventListener('change', async (e) => {
      const f = e.target.files[0]; if (!f) return;
      try {
        // Downscale so the receipt stays small enough to sync to Firestore
        // (1MB doc limit). OrbitOCR's version resizes to ~1280px @ 0.72 quality.
        attachmentData = (window.OrbitOCR && OrbitOCR.fileToDataURL) ? await OrbitOCR.fileToDataURL(f, 1000, 0.6) : await fileToDataURL(f);
        if (attachmentData.length > 900000) { toast('Receipt too large even after compression — skipped', 'neg'); attachmentData = ''; fileHint.textContent = ''; return; }
        fileHint.textContent = '📎 attached (' + Math.round(attachmentData.length / 1024) + ' KB)';
      } catch (_) { toast('Could not read image', 'neg'); }
    });
    if (t.account) acct.value = t.account;
    if (t.fromAccount) fromAcct.value = t.fromAccount;
    if (t.toAccount) toAcct.value = t.toAccount;

    function fillCats() {
      const map = typeSel.value === 'income' ? F.TXN_INCOME_CATEGORIES : F.TXN_EXPENSE_CATEGORIES;
      catSel.innerHTML = '';
      Object.keys(map).forEach((k) => catSel.appendChild(h('option', { value: k, selected: k === t.category ? '' : null }, map[k])));
    }
    const catRow = formRow('Category', catSel);
    const acctRow = formRow('Account', acct);
    const payeeRow = formRow('Payee', payee);
    const methodRow = formRow('Method', methodSel);
    const transferRow = h('div', { class: 'input-row' }, [formRow('From', fromAcct), formRow('To', toAcct)]);
    function applyType() {
      const isT = typeSel.value === 'transfer';
      [catRow, acctRow, payeeRow, methodRow].forEach((r) => r.style.display = isT ? 'none' : '');
      transferRow.style.display = isT ? '' : 'none';
      // Default the two transfer accounts to DIFFERENT accounts so the obvious
      // path isn't a same-account no-op.
      if (isT && !t.fromAccount && State.finAccounts.length > 1 && fromAcct.value === toAcct.value) toAcct.value = State.finAccounts[1].name;
      if (!isT) fillCats();
    }
    typeSel.addEventListener('change', applyType);
    desc.addEventListener('input', () => { if (editing) return; const g = F.guessCategory(desc.value, typeSel.value); if (g) catSel.value = g; });
    fillCats(); applyType();

    const modal = h('div', { class: 'modal modal-sm' }, [
      h('div', { class: 'modal-head' }, [h('h2', {}, editing ? 'Edit transaction' : 'Add transaction'), h('button', { class: 'close', onClick: closeModal }, '×')]),
      h('div', { class: 'modal-body' }, [
        h('div', { class: 'input-row' }, [formRow('Type', typeSel), formRow('Amount', amt)]),
        h('div', { class: 'input-row' }, [formRow('Date', date), formRow('Status', statusSel)]),
        catRow, transferRow,
        formRow('Description', desc),
        h('div', { class: 'input-row' }, [payeeRow, methodRow]),
        acctRow,
        formRow('Tags', tagsInp),
        formRow('Notes', notes),
        formRow('Receipt', h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } }, [fileInp, fileHint]))
      ]),
      h('div', { class: 'modal-foot' }, [
        h('button', { class: 'btn btn-ghost btn-sm', onClick: closeModal }, 'Cancel'),
        h('button', {
          class: 'btn btn-primary btn-sm', onClick: async () => {
            const amount = Math.round((parseFloat(amt.value) || 0) * 100) / 100; // clean to 2dp
            if (isNaN(amount) || amount <= 0) { toast('Enter a valid amount', 'neg'); amt.focus(); return; }
            // A transfer between the same account is a no-op — guard it.
            if (typeSel.value === 'transfer' && fromAcct.value && toAcct.value && fromAcct.value === toAcct.value) {
              toast('Transfer needs two different accounts', 'neg'); return;
            }
            const tags = tagsInp.value.split(',').map((s) => s.trim()).filter(Boolean);
            const rec = { id: t.id || uid('tx'), type: typeSel.value, amount, date: date.value || toDateInput(Date.now()), description: desc.value.trim(), notes: notes.value.trim(), status: statusSel.value, tags, attachment: attachmentData || null };
            if (typeSel.value === 'transfer') { rec.category = 'transfer'; rec.fromAccount = fromAcct.value; rec.toAccount = toAcct.value; }
            else { rec.category = catSel.value; rec.account = acct.value || null; rec.payee = payee.value.trim(); rec.method = methodSel.value || null; }
            await OrbitDB.put('fin_txns', rec);
            await finReload('fin_txns', 'finTxns');
            closeModal(); toast('Transaction saved', 'pos'); finRerender();
          }
        }, editing ? 'Save' : 'Add')
      ])
    ]);
    openModal(modal);
  }

  // ===== BULK ACTIONS =====
  function selectedTxns() { return State.finTxns.filter((t) => _txnSelected.has(t.id)); }
  async function bulkDelete() {
    const n = _txnSelected.size; if (!n || !confirm('Delete ' + n + ' transaction' + (n > 1 ? 's' : '') + '?')) return;
    for (const id of _txnSelected) await OrbitDB.delete('fin_txns', id);
    _txnSelected.clear(); await finReload('fin_txns', 'finTxns'); toast(n + ' deleted'); finRerender();
  }
  function bulkRecategorize() {
    const F = window.OrbitFinance;
    const sel = h('select', { class: 'select' }, Object.keys(F.TXN_EXPENSE_CATEGORIES).map((k) => h('option', { value: k }, F.TXN_EXPENSE_CATEGORIES[k])));
    const modal = h('div', { class: 'modal modal-sm' }, [
      h('div', { class: 'modal-head' }, [h('h2', {}, 'Recategorize ' + _txnSelected.size), h('button', { class: 'close', onClick: closeModal }, '×')]),
      h('div', { class: 'modal-body' }, [formRow('New category', sel)]),
      h('div', { class: 'modal-foot' }, [h('button', { class: 'btn btn-ghost btn-sm', onClick: closeModal }, 'Cancel'),
        h('button', { class: 'btn btn-primary btn-sm', onClick: async () => { for (const t of selectedTxns()) { t.category = sel.value; await OrbitDB.put('fin_txns', t); } _txnSelected.clear(); await finReload('fin_txns', 'finTxns'); closeModal(); toast('Recategorized', 'pos'); finRerender(); } }, 'Apply')])
    ]);
    openModal(modal);
  }
  function bulkTag() {
    const inp = h('input', { class: 'input', placeholder: 'tag to add' });
    const modal = h('div', { class: 'modal modal-sm' }, [
      h('div', { class: 'modal-head' }, [h('h2', {}, 'Tag ' + _txnSelected.size), h('button', { class: 'close', onClick: closeModal }, '×')]),
      h('div', { class: 'modal-body' }, [formRow('Add tag', inp)]),
      h('div', { class: 'modal-foot' }, [h('button', { class: 'btn btn-ghost btn-sm', onClick: closeModal }, 'Cancel'),
        h('button', { class: 'btn btn-primary btn-sm', onClick: async () => { const tag = inp.value.trim(); if (!tag) return; for (const t of selectedTxns()) { t.tags = Array.from(new Set((t.tags || []).concat(tag))); await OrbitDB.put('fin_txns', t); } _txnSelected.clear(); await finReload('fin_txns', 'finTxns'); closeModal(); toast('Tagged', 'pos'); finRerender(); } }, 'Apply')])
    ]);
    openModal(modal);
  }

  // ===== CSV IMPORT =====
  function openTxnImport() {
    const F = window.OrbitFinance;
    const fileInp = h('input', { type: 'file', accept: '.csv,text/csv' });
    const preview = h('div', { style: { marginTop: '10px' } });
    let drafts = [];
    fileInp.addEventListener('change', (e) => {
      const f = e.target.files[0]; if (!f) return;
      const reader = new FileReader();
      reader.onload = () => {
        const parsed = F.parseTxnCSV(reader.result);
        drafts = F.dedupeTxns(parsed, State.finTxns);
        preview.innerHTML = '';
        preview.appendChild(h('div', { class: 'sub', style: { marginBottom: '6px' } }, parsed.length + ' rows · ' + drafts.length + ' new (after de-duplication)'));
        drafts.slice(0, 6).forEach((d) => preview.appendChild(h('div', { class: 'sub', style: { fontSize: '12px', padding: '3px 0' } }, fmtDateShort(d.date) + ' · ' + d.description + ' · ' + (d.type === 'income' ? '+' : '−') + finMoney(d.amount) + ' · ' + F.txnCategoryLabel(d.category))));
        if (drafts.length > 6) preview.appendChild(h('div', { class: 'sub', style: { fontSize: '12px' } }, '…and ' + (drafts.length - 6) + ' more'));
      };
      reader.readAsText(f);
    });
    const modal = h('div', { class: 'modal modal-sm' }, [
      h('div', { class: 'modal-head' }, [h('h2', {}, 'Import transactions (CSV)'), h('button', { class: 'close', onClick: closeModal }, '×')]),
      h('div', { class: 'modal-body' }, [
        h('div', { class: 'sub', style: { fontSize: '12px', marginBottom: '8px' } }, 'Upload a bank/statement CSV. Expects a Date, Description and Amount (or Debit/Credit) column. Categories are auto-guessed; duplicates are skipped.'),
        fileInp, preview
      ]),
      h('div', { class: 'modal-foot' }, [
        h('button', { class: 'btn btn-ghost btn-sm', onClick: closeModal }, 'Cancel'),
        h('button', { class: 'btn btn-primary btn-sm', onClick: async () => {
          if (!drafts.length) { toast('Nothing new to import', ''); return; }
          for (const d of drafts) await OrbitDB.put('fin_txns', { id: uid('tx'), type: d.type, amount: d.amount, date: d.date, category: d.category, description: d.description, status: 'cleared', source: 'import' });
          await finReload('fin_txns', 'finTxns');
          closeModal(); toast('Imported ' + drafts.length + ' transactions', 'pos'); finRerender();
        } }, 'Import')
      ])
    ]);
    openModal(modal);
  }

  // ===== BUDGETS =====
  function viewBudgets() {
    const F = window.OrbitFinance;
    const rows = F.computeBudgets(State.finBudgets, finAllTxns());
    const totalBudget = rows.reduce((s, r) => s + r.limit, 0);
    const totalActual = rows.reduce((s, r) => s + r.actual, 0);
    const page = h('div', { class: 'page' });
    page.appendChild(finPageHeader('Budgets', 'Set monthly category budgets and track actual spend.', '+ Add budget', () => openBudgetModal()));
    const grid = h('div', { class: 'kpi-grid' });
    grid.appendChild(kpiCard('Budgeted', Math.round(totalBudget), finBase(), 'Per month', '', { tilt: true }));
    grid.appendChild(kpiCard('Spent', Math.round(totalActual), finBase(), 'This month', totalActual > totalBudget ? 'neg' : 'pos', { tilt: true }));
    grid.appendChild(kpiCard('Remaining', Math.round(totalBudget - totalActual), finBase(), 'Left to spend', (totalBudget - totalActual) < 0 ? 'neg' : 'pos', { tilt: true }));
    page.appendChild(grid);
    const card = h('div', { class: 'card', style: { marginTop: 'var(--s-5)' } });
    card.appendChild(finSectionTitle('target', 'Category budgets'));
    if (!rows.length) card.appendChild(finEmpty('No budgets yet', 'Add a category budget to track spending against a limit.', true));
    else rows.forEach((r) => {
      const color = r.over ? 'var(--danger, #c0392b)' : r.pct >= 80 ? 'var(--warning, #b8860b)' : 'var(--accent, #2f8f5b)';
      const block = h('div', { style: { padding: '12px 4px', borderTop: '1px solid var(--border)' } }, [
        h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } }, [
          h('div', { style: { fontWeight: '600' } }, F.txnCategoryLabel(r.category)),
          h('div', { style: { display: 'flex', gap: 'var(--s-3)' } }, [
            h('button', { class: 'btn btn-ghost btn-sm', onClick: () => openBudgetModal(r) }, 'Edit'),
            h('button', { class: 'btn btn-ghost btn-sm', onClick: () => deleteFin('fin_budgets', 'finBudgets', r.id, 'Budget') }, '🗑')
          ])
        ]),
        finProgressBar(r.pct, color),
        h('div', { class: 'sub', style: { fontSize: '12px' } }, finMoney(r.actual) + ' of ' + finMoney(r.limit) + ' (' + r.pct.toFixed(0) + '%) · ' + (r.over ? 'over by ' + finMoney(-r.remaining) : finMoney(r.remaining) + ' left'))
      ]);
      card.appendChild(block);
    });
    page.appendChild(card);
    setMain(page); bindTilt(page);
  }
  function openBudgetModal(existing) {
    const F = window.OrbitFinance;
    const editing = !!existing;
    const b = existing || { category: 'food', amount: '' };
    const catSel = h('select', { class: 'select' }, Object.keys(F.TXN_EXPENSE_CATEGORIES).map((k) => h('option', { value: k, selected: k === b.category ? '' : null }, F.TXN_EXPENSE_CATEGORIES[k])));
    const amt = h('input', { class: 'input', type: 'number', step: '0.01', value: b.amount, placeholder: '20000' });
    const modal = h('div', { class: 'modal modal-sm' }, [
      h('div', { class: 'modal-head' }, [h('h2', {}, editing ? 'Edit budget' : 'Add budget'), h('button', { class: 'close', onClick: closeModal }, '×')]),
      h('div', { class: 'modal-body' }, [formRow('Category', catSel), formRow('Monthly limit', amt)]),
      h('div', { class: 'modal-foot' }, [
        h('button', { class: 'btn btn-ghost btn-sm', onClick: closeModal }, 'Cancel'),
        h('button', {
          class: 'btn btn-primary btn-sm', onClick: async () => {
            const amount = parseFloat(amt.value);
            if (isNaN(amount) || amount <= 0) { toast('Enter a valid limit', 'neg'); return; }
            // one budget per category
            const dupe = State.finBudgets.find((x) => x.category === catSel.value && x.id !== (b.id || ''));
            const rec = { id: b.id || (dupe ? dupe.id : uid('bg')), category: catSel.value, amount };
            await OrbitDB.put('fin_budgets', rec);
            await finReload('fin_budgets', 'finBudgets');
            closeModal(); toast('Budget saved', 'pos'); finRerender();
          }
        }, editing ? 'Save' : 'Add')
      ])
    ]);
    openModal(modal);
  }

  // ===== GOALS =====
  function viewGoals() {
    const F = window.OrbitFinance;
    const page = h('div', { class: 'page' });
    page.appendChild(finPageHeader('Goals', 'Save toward what matters and track your progress.', '+ Add goal', () => openGoalModal()));
    if (!State.finGoals.length) {
      const card = h('div', { class: 'card' });
      card.appendChild(finEmpty('No goals yet', 'Set a savings goal with a target amount and date.', true, 'target'));
      page.appendChild(card); setMain(page); return;
    }
    const grid = h('div', { class: 'card-grid' });
    State.finGoals.forEach((g) => {
      const c = F.computeGoal(g);
      const color = c.complete ? 'var(--accent, #2f8f5b)' : c.pct >= 50 ? 'var(--info, #2a7de1)' : 'var(--warning, #b8860b)';
      let eta;
      if (c.complete) eta = 'Goal reached!';
      else if (c.monthsToGoal !== null) eta = '~' + c.monthsToGoal + ' mo at ' + finMoney(c.contribution) + '/mo';
      else if (c.requiredMonthly !== null) eta = 'Need ' + finMoney(c.requiredMonthly) + '/mo to hit date';
      else eta = 'Set a contribution or target date';
      const ring = h('div', { style: { color, flexShrink: 0 } }, finRing(c.pct, 84, color));
      grid.appendChild(h('div', { class: 'card', style: { padding: '18px' } }, [
        h('div', { style: { display: 'flex', alignItems: 'center', gap: '16px' } }, [
          ring,
          h('div', { style: { minWidth: 0, flex: 1 } }, [
            h('div', { style: { fontWeight: '700', fontSize: '16px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, g.name),
            h('div', { style: { fontWeight: '600', marginTop: '2px' } }, finMoney(c.saved)),
            h('div', { class: 'sub', style: { fontSize: '12px' } }, 'of ' + finMoney(c.target)),
            g.targetDate ? h('div', { class: 'sub', style: { fontSize: '11px', marginTop: '4px', display: 'flex', alignItems: 'center', gap: '4px' } }, [finIcon('calendar', 12, 'var(--text-3)'), fmtDateShort(g.targetDate)]) : null
          ])
        ]),
        h('div', { class: 'sub', style: { fontSize: '12px', marginTop: '10px' } }, eta),
        h('div', { style: { display: 'flex', gap: '6px', marginTop: '12px' } }, [
          h('button', { class: 'btn btn-primary btn-sm', style: { flex: 1, justifyContent: 'center' }, onClick: () => contributeGoal(g) }, '+ Contribute'),
          h('button', { class: 'btn btn-ghost btn-sm', onClick: () => openGoalModal(g) }, 'Edit'),
          h('button', { class: 'btn btn-ghost btn-sm', onClick: () => deleteFin('fin_goals', 'finGoals', g.id, 'Goal') }, '🗑')
        ])
      ]));
    });
    page.appendChild(grid);
    setMain(page);
  }
  async function contributeGoal(g) {
    const input = prompt('Add contribution to "' + g.name + '" (' + finMoney(g.saved || 0) + ' saved):', '');
    if (input === null) return;
    const amount = parseFloat(input);
    if (isNaN(amount) || amount === 0) return;
    g.saved = Math.max(0, (parseFloat(g.saved) || 0) + amount);
    await OrbitDB.put('fin_goals', g);
    await finReload('fin_goals', 'finGoals');
    toast('Contribution added', 'pos'); finRerender();
  }
  function openGoalModal(existing) {
    const editing = !!existing;
    const g = existing || { name: '', target: '', saved: 0, targetDate: '', monthlyContribution: 0 };
    const name = h('input', { class: 'input', value: g.name || '', placeholder: 'e.g., Emergency Fund' });
    const target = h('input', { class: 'input', type: 'number', step: '0.01', value: g.target, placeholder: '500000' });
    const saved = h('input', { class: 'input', type: 'number', step: '0.01', value: g.saved || 0, placeholder: '0' });
    const tdate = h('input', { class: 'input', type: 'date', value: g.targetDate ? toDateInput(g.targetDate) : '' });
    const contrib = h('input', { class: 'input', type: 'number', step: '0.01', value: g.monthlyContribution || 0, placeholder: '10000' });
    const modal = h('div', { class: 'modal modal-sm' }, [
      h('div', { class: 'modal-head' }, [h('h2', {}, editing ? 'Edit goal' : 'Add goal'), h('button', { class: 'close', onClick: closeModal }, '×')]),
      h('div', { class: 'modal-body' }, [
        formRow('Goal name', name),
        h('div', { class: 'input-row' }, [formRow('Target amount', target), formRow('Already saved', saved)]),
        h('div', { class: 'input-row' }, [formRow('Target date', tdate), formRow('Monthly contribution', contrib)])
      ]),
      h('div', { class: 'modal-foot' }, [
        h('button', { class: 'btn btn-ghost btn-sm', onClick: closeModal }, 'Cancel'),
        h('button', {
          class: 'btn btn-primary btn-sm', onClick: async () => {
            if (!name.value.trim()) { toast('Name your goal', 'neg'); return; }
            const tgt = parseFloat(target.value);
            if (isNaN(tgt) || tgt <= 0) { toast('Enter a target amount', 'neg'); return; }
            const rec = { id: g.id || uid('gl'), name: name.value.trim(), target: tgt, saved: parseFloat(saved.value) || 0, targetDate: tdate.value || null, monthlyContribution: parseFloat(contrib.value) || 0 };
            await OrbitDB.put('fin_goals', rec);
            await finReload('fin_goals', 'finGoals');
            closeModal(); toast('Goal saved', 'pos'); finRerender();
          }
        }, editing ? 'Save' : 'Add')
      ])
    ]);
    openModal(modal);
  }

  // ===== INVESTMENTS =====
  const INV_CATEGORIES = { equity: 'Equity', debt: 'Debt', liquid: 'Liquid', hybrid: 'Hybrid', gold: 'Gold', crypto: 'Crypto', other: 'Other' };
  function viewInvestments() {
    const F = window.OrbitFinance;
    const total = F.investmentsTotal(State.finInvestments, finBase());
    const page = h('div', { class: 'page' });
    page.appendChild(finPageHeader('Investments', 'Track your portfolio value across platforms.', '+ Add holding', () => openInvestmentModal()));
    const grid = h('div', { class: 'kpi-grid' });
    grid.appendChild(kpiCard('Portfolio value', Math.round(total), finBase(), plural(State.finInvestments.length, 'holding'), 'pos', { tilt: true }));
    Object.keys(INV_CATEGORIES).slice(0, 2).forEach((k) => {
      const v = State.finInvestments.filter((i) => i.category === k).reduce((s, i) => s + (parseFloat(i.currentValue) || 0), 0);
      if (v > 0) grid.appendChild(kpiCard(INV_CATEGORIES[k], Math.round(v), finBase(), '', '', { tilt: true }));
    });
    page.appendChild(grid);

    // Allocation donut by category (only when there's something to show).
    const ALLOC_COLORS = { equity: '#34B87A', debt: '#2a7de1', liquid: '#7c5cff', hybrid: '#b8860b', gold: '#e0a32e', crypto: '#E0654A', other: '#8892b0' };
    const allocMap = {};
    State.finInvestments.forEach((i) => { const k = i.category || 'other'; allocMap[k] = (allocMap[k] || 0) + (parseFloat(i.currentValue) || 0); });
    const allocSegs = Object.keys(allocMap).filter((k) => allocMap[k] > 0).map((k) => ({ key: k, label: INV_CATEGORIES[k] || k, value: allocMap[k], color: ALLOC_COLORS[k] || '#8892b0' })).sort((a, b) => b.value - a.value);
    if (allocSegs.length) {
      const allocCard = h('div', { class: 'card', style: { marginTop: 'var(--s-5)' } });
      allocCard.appendChild(finSectionTitle('pie', 'Asset allocation'));
      const legend = h('div', { style: { flex: 1, minWidth: '200px' } }, allocSegs.map((s) => h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', padding: '5px 0' } }, [
        h('span', { style: { width: '10px', height: '10px', borderRadius: '3px', background: s.color, flexShrink: 0 } }),
        h('span', { style: { flex: 1, fontSize: '13px' } }, s.label),
        h('span', { style: { fontWeight: '600', fontSize: '13px' } }, finMoney(s.value)),
        h('span', { class: 'sub', style: { fontSize: '12px', minWidth: '38px', textAlign: 'right' } }, Math.round((s.value / total) * 100) + '%')
      ])));
      allocCard.appendChild(h('div', { style: { display: 'flex', alignItems: 'center', gap: '24px', flexWrap: 'wrap', marginTop: '8px' } }, [
        h('div', { style: { color: 'var(--text-1)', flexShrink: 0 } }, finDonut(allocSegs, 168, { top: 'Total', bottom: finMoneyShort(total) })),
        legend
      ]));
      page.appendChild(allocCard);
    }

    const card = h('div', { class: 'card', style: { marginTop: 'var(--s-5)' } });
    card.appendChild(finSectionTitle('chart', 'Holdings'));
    const holdList = h('div', { class: 'fin-2col' });
    if (!State.finInvestments.length) card.appendChild(finEmpty('No holdings', 'Add a mutual fund, stock, or other investment.', true, 'chart'));
    else { card.appendChild(holdList); State.finInvestments.slice().sort((a, b) => (parseFloat(b.currentValue) || 0) - (parseFloat(a.currentValue) || 0)).forEach((i) => {
      holdList.appendChild(h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--s-3)', padding: '12px 4px', borderTop: '1px solid var(--border)' } }, [
        h('div', {}, [h('div', { style: { fontWeight: '600' } }, i.fundName), h('div', { class: 'sub', style: { fontSize: '12px' } }, (INV_CATEGORIES[i.category] || i.category) + (i.platform ? ' · ' + i.platform : ''))]),
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 'var(--s-3)' } }, [
          h('div', { class: 'pos', style: { fontWeight: '600' } }, finMoney(i.currentValue, i.currency)),
          h('button', { class: 'btn btn-ghost btn-sm', onClick: () => openInvestmentModal(i) }, 'Edit'),
          h('button', { class: 'btn btn-ghost btn-sm', onClick: () => deleteFin('fin_investments', 'finInvestments', i.id, 'Holding') }, '🗑')
        ])
      ]));
    }); }
    page.appendChild(card);
    setMain(page); bindTilt(page);
  }
  function openInvestmentModal(existing) {
    const editing = !!existing;
    const i = existing || { fundName: '', platform: '', category: 'equity', currentValue: '', currency: finBase() };
    const name = h('input', { class: 'input', value: i.fundName || '', placeholder: 'e.g., Nifty 50 Index Fund' });
    const platform = h('input', { class: 'input', value: i.platform || '', placeholder: 'e.g., Zerodha, Groww' });
    const catSel = h('select', { class: 'select' }, Object.keys(INV_CATEGORIES).map((k) => h('option', { value: k, selected: k === i.category ? '' : null }, INV_CATEGORIES[k])));
    const val = h('input', { class: 'input', type: 'number', step: '0.01', value: i.currentValue, placeholder: '150000' });
    const curSel = h('select', { class: 'select' }, finCurrencies().map((c) => h('option', { value: c, selected: c === (i.currency || finBase()) ? '' : null }, c)));
    const modal = h('div', { class: 'modal modal-sm' }, [
      h('div', { class: 'modal-head' }, [h('h2', {}, editing ? 'Edit holding' : 'Add holding'), h('button', { class: 'close', onClick: closeModal }, '×')]),
      h('div', { class: 'modal-body' }, [
        formRow('Name', name), formRow('Platform', platform),
        h('div', { class: 'input-row' }, [formRow('Category', catSel), formRow('Currency', curSel)]),
        formRow('Current value', val)
      ]),
      h('div', { class: 'modal-foot' }, [
        h('button', { class: 'btn btn-ghost btn-sm', onClick: closeModal }, 'Cancel'),
        h('button', {
          class: 'btn btn-primary btn-sm', onClick: async () => {
            if (!name.value.trim()) { toast('Name the holding', 'neg'); return; }
            const v = parseFloat(val.value);
            if (isNaN(v)) { toast('Enter a value', 'neg'); return; }
            const rec = { id: i.id || uid('iv'), fundName: name.value.trim(), platform: platform.value.trim(), category: catSel.value, currentValue: v, currency: curSel.value };
            await OrbitDB.put('fin_investments', rec);
            await finReload('fin_investments', 'finInvestments');
            await snapshotFinNetWorth();
            closeModal(); toast('Holding saved', 'pos'); finRerender();
          }
        }, editing ? 'Save' : 'Add')
      ])
    ]);
    openModal(modal);
  }

  // ===== SUBSCRIPTIONS =====
  const SUB_CATEGORIES = { entertainment: 'Entertainment', productivity: 'Productivity', utilities: 'Utilities', health: 'Health & Fitness', news: 'News & Media', cloud: 'Cloud & Storage', other: 'Other' };
  function viewSubscriptions() {
    const F = window.OrbitFinance;
    const totals = F.computeSubscriptions(State.finSubs);
    const page = h('div', { class: 'page' });
    page.appendChild(h('header', { class: 'page-header' }, [
      h('div', { class: 'title-block' }, [h('h1', {}, 'Subscriptions'), h('div', { class: 'sub' }, 'See every recurring subscription and what it really costs.')]),
      h('div', { class: 'actions' }, [
        h('button', { class: 'btn btn-ghost btn-sm', onClick: () => enableFinReminders() }, '🔔 Reminders'),
        h('button', { class: 'btn btn-primary btn-sm', onClick: () => openSubModal() }, '+ Add subscription')
      ])
    ]));
    const grid = h('div', { class: 'kpi-grid' });
    grid.appendChild(kpiCard('Active', totals.count, '', 'Subscriptions', '', { tilt: true }));
    grid.appendChild(kpiCard('Monthly cost', Math.round(totals.monthly), finBase(), 'Per month', 'neg', { tilt: true }));
    grid.appendChild(kpiCard('Annual cost', Math.round(totals.yearly), finBase(), 'Per year', 'neg', { tilt: true }));
    page.appendChild(grid);
    const card = h('div', { class: 'card', style: { marginTop: 'var(--s-5)' } });
    card.appendChild(finSectionTitle('repeat', 'Subscriptions'));
    const subList = h('div', { class: 'fin-2col' });
    if (!State.finSubs.length) card.appendChild(finEmpty('No subscriptions', 'Add streaming, software, or membership subscriptions.', true, 'repeat'));
    else { card.appendChild(subList); State.finSubs.slice().sort((a, b) => new Date(a.nextRenewal || '2099-12-31') - new Date(b.nextRenewal || '2099-12-31')).forEach((s) => {
      const soon = s.nextRenewal && (new Date(s.nextRenewal) - new Date()) <= 7 * 86400000 && (new Date(s.nextRenewal) - new Date()) >= -86400000;
      subList.appendChild(h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--s-3)', padding: '12px 4px', borderTop: '1px solid var(--border)' } }, [
        h('div', {}, [
          h('div', { style: { fontWeight: '600' } }, [s.name, soon ? h('span', { style: { marginLeft: '8px', fontSize: '11px', color: 'var(--danger,#c0392b)' } }, '· renews soon') : null]),
          h('div', { class: 'sub', style: { fontSize: '12px' } }, finMoney(s.amount) + '/' + s.cycle + ' · ' + finMoney(F.subMonthlyCost(s)) + '/mo' + (s.nextRenewal ? ' · 🗓 ' + fmtDateShort(s.nextRenewal) : ''))
        ]),
        h('div', { style: { display: 'flex', gap: 'var(--s-3)' } }, [
          h('button', { class: 'btn btn-ghost btn-sm', onClick: () => openSubModal(s) }, 'Edit'),
          h('button', { class: 'btn btn-ghost btn-sm', onClick: () => deleteFin('fin_subs', 'finSubs', s.id, 'Subscription') }, '🗑')
        ])
      ]));
    }); }
    page.appendChild(card);
    setMain(page); bindTilt(page);
  }
  function openSubModal(existing) {
    const editing = !!existing;
    const s = existing || { name: '', amount: '', cycle: 'monthly', nextRenewal: '', category: 'entertainment' };
    const name = h('input', { class: 'input', value: s.name || '', placeholder: 'e.g., Netflix' });
    const amt = h('input', { class: 'input', type: 'number', step: '0.01', value: s.amount, placeholder: '499' });
    const cycle = h('select', { class: 'select' }, ['monthly', 'yearly', 'quarterly', 'weekly'].map((c) => h('option', { value: c, selected: c === s.cycle ? '' : null }, c[0].toUpperCase() + c.slice(1))));
    const renew = h('input', { class: 'input', type: 'date', value: s.nextRenewal ? toDateInput(s.nextRenewal) : '' });
    const catSel = h('select', { class: 'select' }, Object.keys(SUB_CATEGORIES).map((k) => h('option', { value: k, selected: k === s.category ? '' : null }, SUB_CATEGORIES[k])));
    const modal = h('div', { class: 'modal modal-sm' }, [
      h('div', { class: 'modal-head' }, [h('h2', {}, editing ? 'Edit subscription' : 'Add subscription'), h('button', { class: 'close', onClick: closeModal }, '×')]),
      h('div', { class: 'modal-body' }, [
        formRow('Name', name),
        h('div', { class: 'input-row' }, [formRow('Amount', amt), formRow('Billing cycle', cycle)]),
        h('div', { class: 'input-row' }, [formRow('Next renewal', renew), formRow('Category', catSel)])
      ]),
      h('div', { class: 'modal-foot' }, [
        h('button', { class: 'btn btn-ghost btn-sm', onClick: closeModal }, 'Cancel'),
        h('button', {
          class: 'btn btn-primary btn-sm', onClick: async () => {
            if (!name.value.trim()) { toast('Name it', 'neg'); return; }
            const a = parseFloat(amt.value);
            if (isNaN(a) || a <= 0) { toast('Enter an amount', 'neg'); return; }
            const rec = { id: s.id || uid('sb'), name: name.value.trim(), amount: a, cycle: cycle.value, nextRenewal: renew.value || null, category: catSel.value };
            await OrbitDB.put('fin_subs', rec);
            await finReload('fin_subs', 'finSubs');
            closeModal(); toast('Subscription saved', 'pos'); finRerender();
          }
        }, editing ? 'Save' : 'Add')
      ])
    ]);
    openModal(modal);
  }

  // ===== LOANS + DEBT PAYOFF =====
  let _debtStrategy = 'avalanche', _debtExtra = 0;
  function viewLoans() {
    const F = window.OrbitFinance;
    const page = h('div', { class: 'page' });
    page.appendChild(finPageHeader('Loans', 'Track EMIs, real outstanding, and your payoff plan.', '+ Add loan', () => openLoanModal()));
    const card = h('div', { class: 'card' });
    card.appendChild(finSectionTitle('bank', 'Active loans'));
    if (!State.finLoans.length) card.appendChild(finEmpty('No loans', 'Add a loan to see its amortized outstanding and payoff timeline.', true));
    else State.finLoans.forEach((l) => {
      const out = F.loanOutstanding(l, new Date());
      const monthsLeft = F.monthsBetween(new Date(), new Date(l.endDate));
      card.appendChild(h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--s-3)', padding: '12px 4px', borderTop: '1px solid var(--border)' } }, [
        h('div', {}, [
          h('div', { style: { fontWeight: '600' } }, l.name),
          h('div', { class: 'sub', style: { fontSize: '12px' } }, 'EMI ' + finMoney(l.emi, l.currency) + '/mo · Outstanding ' + finMoney(out, l.currency) + ' · ' + (parseFloat(l.interestRate) || 0) + '% · ' + monthsLeft + ' mo left')
        ]),
        h('div', { style: { display: 'flex', gap: 'var(--s-3)' } }, [
          h('button', { class: 'btn btn-ghost btn-sm', onClick: () => openLoanModal(l) }, 'Edit'),
          h('button', { class: 'btn btn-ghost btn-sm', onClick: () => deleteFin('fin_loans', 'finLoans', l.id, 'Loan') }, '🗑')
        ])
      ]));
    });
    page.appendChild(card);

    // Debt payoff planner
    const active = State.finLoans.filter((l) => F.loanOutstanding(l, new Date()) > 0 && (parseFloat(l.emi) || 0) > 0);
    if (active.length) {
      const planCard = h('div', { class: 'card', style: { marginTop: 'var(--s-5)' } });
      planCard.appendChild(finSectionTitle('bolt', 'Debt payoff planner'));
      const stratSel = h('select', { class: 'select' }, [
        h('option', { value: 'avalanche', selected: _debtStrategy === 'avalanche' ? '' : null }, 'Avalanche — highest interest first'),
        h('option', { value: 'snowball', selected: _debtStrategy === 'snowball' ? '' : null }, 'Snowball — smallest balance first')
      ]);
      const extra = h('input', { class: 'input', type: 'number', step: '0.01', value: _debtExtra || 0, placeholder: '0' });
      const result = h('div', { style: { marginTop: 'var(--s-3)' } });
      function recompute() {
        _debtStrategy = stratSel.value; _debtExtra = parseFloat(extra.value) || 0;
        const chosen = F.simulateDebtPayoff(State.finLoans, _debtStrategy, _debtExtra);
        const ava = F.simulateDebtPayoff(State.finLoans, 'avalanche', _debtExtra);
        const snow = F.simulateDebtPayoff(State.finLoans, 'snowball', _debtExtra);
        const saved = Math.abs(ava.totalInterest - snow.totalInterest);
        result.innerHTML = '';
        if (chosen.impossible) { result.appendChild(h('div', { class: 'neg' }, '⚠️ With current EMIs these never fully clear — add an extra payment.')); return; }
        const g = h('div', { class: 'kpi-grid kpi-grid-3' });
        g.appendChild(kpiCard('Debt-free in', Math.floor(chosen.months / 12) + 'y ' + (chosen.months % 12) + 'm', '', '', '', {}));
        g.appendChild(kpiCard('Total interest', Math.round(chosen.totalInterest), finBase(), 'Over the full term', '', {}));
        // Only surface the avalanche-vs-snowball saving when it's actually non-zero.
        g.appendChild(saved >= 1
          ? kpiCard('Avalanche saves', Math.round(saved), finBase(), 'vs snowball order', 'pos', {})
          : kpiCard('Strategy', 'Optimised', '', 'Highest-rate first', '', {}));
        result.appendChild(g);
        result.appendChild(h('div', { class: 'sub', style: { marginTop: '8px', fontSize: '12px' } }, 'Order: ' + chosen.order.join(' → ')));
      }
      stratSel.addEventListener('change', recompute);
      extra.addEventListener('input', recompute);
      planCard.appendChild(h('div', { class: 'input-row' }, [formRow('Strategy', stratSel), formRow('Extra monthly payment', extra)]));
      planCard.appendChild(result);
      page.appendChild(planCard);
      setMain(page); recompute();
    } else {
      setMain(page);
    }
  }
  function openLoanModal(existing) {
    const editing = !!existing;
    const l = existing || { name: '', emi: '', principal: '', interestRate: '', startDate: toDateInput(Date.now()), endDate: '', currency: finBase() };
    const name = h('input', { class: 'input', value: l.name || '', placeholder: 'e.g., Home Loan' });
    const emi = h('input', { class: 'input', type: 'number', step: '0.01', value: l.emi, placeholder: '45000' });
    const principal = h('input', { class: 'input', type: 'number', step: '0.01', value: l.principal, placeholder: '5000000' });
    const rate = h('input', { class: 'input', type: 'number', step: '0.01', value: l.interestRate, placeholder: '8.5' });
    const start = h('input', { class: 'input', type: 'date', value: l.startDate ? toDateInput(l.startDate) : '' });
    const end = h('input', { class: 'input', type: 'date', value: l.endDate ? toDateInput(l.endDate) : '' });
    const curSel = h('select', { class: 'select' }, finCurrencies().map((c) => h('option', { value: c, selected: c === (l.currency || finBase()) ? '' : null }, c)));
    const modal = h('div', { class: 'modal modal-md' }, [
      h('div', { class: 'modal-head' }, [h('h2', {}, editing ? 'Edit loan' : 'Add loan'), h('button', { class: 'close', onClick: closeModal }, '×')]),
      h('div', { class: 'modal-body' }, [
        formRow('Loan name', name),
        h('div', { class: 'input-row' }, [formRow('Monthly EMI', emi), formRow('Balance at start date', principal)]),
        h('div', { class: 'input-row' }, [formRow('Interest rate (%)', rate), formRow('Currency', curSel)]),
        h('div', { class: 'input-row' }, [formRow('Start date', start), formRow('End date', end)])
      ]),
      h('div', { class: 'modal-foot' }, [
        h('button', { class: 'btn btn-ghost btn-sm', onClick: closeModal }, 'Cancel'),
        h('button', {
          class: 'btn btn-primary btn-sm', onClick: async () => {
            if (!name.value.trim()) { toast('Name the loan', 'neg'); return; }
            const rec = { id: l.id || uid('ln'), name: name.value.trim(), emi: parseFloat(emi.value) || 0, principal: parseFloat(principal.value) || 0, interestRate: parseFloat(rate.value) || 0, startDate: start.value || null, endDate: end.value || null, currency: curSel.value };
            await OrbitDB.put('fin_loans', rec);
            await finReload('fin_loans', 'finLoans');
            await snapshotFinNetWorth();
            closeModal(); toast('Loan saved', 'pos'); finRerender();
          }
        }, editing ? 'Save' : 'Add')
      ])
    ]);
    openModal(modal);
  }

  // ===== TRENDS (SVG charts with axes, gridlines, value labels) =====
  const SVGNS = 'http://www.w3.org/2000/svg';
  function svgEl(tag, attrs, text) { const e = document.createElementNS(SVGNS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (text != null) e.textContent = text; return e; }
  // Compact money for axis ticks: ₹1.2L, ₹3.4Cr, ₹45K, etc.
  function finMoneyShort(n) {
    const s = n < 0 ? '−' : ''; const a = Math.abs(n); const cur = finBase();
    const sym = (window.OrbitFX && OrbitFX.format) ? OrbitFX.format(0, cur).replace(/[\d.,\s]/g, '') : '₹';
    if (cur === 'INR') {
      if (a >= 1e7) return s + sym + (a / 1e7).toFixed(a >= 1e8 ? 0 : 1) + 'Cr';
      if (a >= 1e5) return s + sym + (a / 1e5).toFixed(a >= 1e6 ? 0 : 1) + 'L';
      if (a >= 1e3) return s + sym + Math.round(a / 1e3) + 'K';
      return s + sym + Math.round(a);
    }
    if (a >= 1e6) return s + sym + (a / 1e6).toFixed(1) + 'M';
    if (a >= 1e3) return s + sym + Math.round(a / 1e3) + 'K';
    return s + sym + Math.round(a);
  }
  function niceTicks(min, max, count) {
    const span = (max - min) || 1; const raw = span / count;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = (raw / mag >= 5 ? 10 : raw / mag >= 2 ? 5 : raw / mag >= 1 ? 2 : 1) * mag;
    const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step;
    const ticks = []; for (let v = lo; v <= hi + step / 2; v += step) ticks.push(v);
    return { ticks, lo, hi };
  }
  function finLineChart(history, w, hgt) {
    w = w || 760; hgt = hgt || 260;
    const pad = { l: 52, r: 12, t: 14, b: 26 };
    const pts = (history || []).slice(-90);
    if (pts.length < 2) return h('div', { class: 'sub', style: { padding: '24px', textAlign: 'center' } }, 'Net worth history builds up as you use the app — check back soon.');
    const vals = pts.map((p) => p.netWorth);
    const { ticks, lo, hi } = niceTicks(Math.min(...vals), Math.max(...vals), 4);
    const span = (hi - lo) || 1;
    const x = (i) => pad.l + (i / (pts.length - 1)) * (w - pad.l - pad.r);
    const y = (v) => pad.t + (1 - (v - lo) / span) * (hgt - pad.t - pad.b);
    const svg = svgEl('svg', { viewBox: '0 0 ' + w + ' ' + hgt, width: '100%', height: hgt });
    // gridlines + Y ticks
    const grid = svgEl('g', { class: 'fin-grid' }); const axis = svgEl('g', { class: 'fin-axis' });
    ticks.forEach((v) => { const yy = y(v); grid.appendChild(svgEl('line', { x1: pad.l, y1: yy, x2: w - pad.r, y2: yy })); axis.appendChild(svgEl('text', { x: pad.l - 8, y: yy + 3, 'text-anchor': 'end' }, finMoneyShort(v))); });
    // X labels (first, middle, last)
    [0, Math.floor(pts.length / 2), pts.length - 1].forEach((i) => axis.appendChild(svgEl('text', { x: x(i), y: hgt - 8, 'text-anchor': i === 0 ? 'start' : i === pts.length - 1 ? 'end' : 'middle' }, (pts[i].date || '').slice(5))));
    svg.appendChild(grid);
    const line = pts.map((p, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(p.netWorth).toFixed(1)).join(' ');
    svg.appendChild(svgEl('path', { d: line + ' L' + x(pts.length - 1).toFixed(1) + ' ' + y(lo) + ' L' + x(0).toFixed(1) + ' ' + y(lo) + ' Z', fill: 'rgba(52,184,122,0.12)', stroke: 'none' }));
    svg.appendChild(svgEl('path', { d: line, fill: 'none', stroke: '#34B87A', 'stroke-width': '2.5', 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
    if (pts.length <= 14) pts.forEach((p, i) => svg.appendChild(svgEl('circle', { cx: x(i), cy: y(p.netWorth), r: 3, fill: '#34B87A' })));
    // last value callout
    const last = pts[pts.length - 1];
    svg.appendChild(svgEl('circle', { cx: x(pts.length - 1), cy: y(last.netWorth), r: 4, fill: '#34B87A', stroke: '#fff', 'stroke-width': '2' }));
    svg.appendChild(axis);
    return svg;
  }
  function finBarChart(trends, w, hgt) {
    w = w || 760; hgt = hgt || 280;
    const pad = { l: 52, r: 12, t: 14, b: 28 };
    const peak = Math.max(1, ...trends.map((t) => Math.max(t.income, t.expense)));
    const { ticks, hi } = niceTicks(0, peak, 4);
    const svg = svgEl('svg', { viewBox: '0 0 ' + w + ' ' + hgt, width: '100%', height: hgt });
    const plotH = hgt - pad.t - pad.b, baseY = hgt - pad.b;
    const grid = svgEl('g', { class: 'fin-grid' }); const axis = svgEl('g', { class: 'fin-axis' });
    ticks.forEach((v) => { const yy = baseY - (v / hi) * plotH; grid.appendChild(svgEl('line', { x1: pad.l, y1: yy, x2: w - pad.r, y2: yy })); axis.appendChild(svgEl('text', { x: pad.l - 8, y: yy + 3, 'text-anchor': 'end' }, finMoneyShort(v))); });
    svg.appendChild(grid);
    const groupW = (w - pad.l - pad.r) / trends.length;
    const barW = Math.min(13, groupW / 3);
    trends.forEach((t, i) => {
      const gx = pad.l + i * groupW + groupW / 2;
      const ih = (t.income / hi) * plotH, eh = (t.expense / hi) * plotH;
      svg.appendChild(svgEl('rect', { x: gx - barW - 1, y: baseY - ih, width: barW, height: Math.max(0, ih), rx: 2, fill: '#34B87A' }));
      svg.appendChild(svgEl('rect', { x: gx + 1, y: baseY - eh, width: barW, height: Math.max(0, eh), rx: 2, fill: '#E0654A' }));
      if (i % (trends.length > 8 ? 2 : 1) === 0) axis.appendChild(svgEl('text', { x: gx, y: hgt - 9, 'text-anchor': 'middle' }, t.label));
    });
    svg.appendChild(axis);
    return svg;
  }
  // Circular progress ring with a centred label (used by Goals cards).
  function finRing(pct, size, color, centerText) {
    size = size || 92; const sw = 9; const r = (size - sw) / 2; const cx = size / 2; const circ = 2 * Math.PI * r;
    const p = Math.min(100, Math.max(0, pct || 0));
    const svg = svgEl('svg', { width: size, height: size, viewBox: '0 0 ' + size + ' ' + size });
    svg.appendChild(svgEl('circle', { cx, cy: cx, r, fill: 'none', stroke: 'var(--line,rgba(127,127,127,0.16))', 'stroke-width': sw }));
    svg.appendChild(svgEl('circle', { cx, cy: cx, r, fill: 'none', stroke: color, 'stroke-width': sw, 'stroke-linecap': 'round', 'stroke-dasharray': circ, 'stroke-dashoffset': circ * (1 - p / 100), transform: 'rotate(-90 ' + cx + ' ' + cx + ')' }));
    svg.appendChild(svgEl('text', { x: cx, y: cx, 'text-anchor': 'middle', 'dominant-baseline': 'central', 'font-size': size * 0.24, 'font-weight': '700', fill: 'currentColor' }, centerText != null ? centerText : Math.round(p) + '%'));
    return svg;
  }
  // Donut chart from [{label,value,color}] with a centred caption.
  function finDonut(segments, size, caption) {
    size = size || 168; const sw = 28; const r = (size - sw) / 2; const cx = size / 2; const circ = 2 * Math.PI * r;
    const total = segments.reduce((s, x) => s + (x.value || 0), 0) || 1;
    const svg = svgEl('svg', { width: size, height: size, viewBox: '0 0 ' + size + ' ' + size });
    svg.appendChild(svgEl('circle', { cx, cy: cx, r, fill: 'none', stroke: 'var(--line,rgba(127,127,127,0.12))', 'stroke-width': sw }));
    let offset = 0;
    segments.forEach((seg) => {
      const len = circ * ((seg.value || 0) / total);
      if (len <= 0) return;
      svg.appendChild(svgEl('circle', { cx, cy: cx, r, fill: 'none', stroke: seg.color, 'stroke-width': sw, 'stroke-dasharray': len + ' ' + (circ - len), 'stroke-dashoffset': -offset, transform: 'rotate(-90 ' + cx + ' ' + cx + ')' }));
      offset += len;
    });
    if (caption) {
      svg.appendChild(svgEl('text', { x: cx, y: cx - 6, 'text-anchor': 'middle', 'dominant-baseline': 'central', 'font-size': '11', fill: 'var(--text-3,#94a3b8)' }, caption.top || ''));
      svg.appendChild(svgEl('text', { x: cx, y: cx + 10, 'text-anchor': 'middle', 'dominant-baseline': 'central', 'font-size': '15', 'font-weight': '700', fill: 'currentColor' }, caption.bottom || ''));
    }
    return svg;
  }
  // Consistent section heading with a leading icon.
  function finSectionTitle(icon, text) {
    return h('div', { class: 'section-title', style: { display: 'flex', alignItems: 'center', gap: '8px' } }, [finIcon(icon, 16), h('span', {}, text)]);
  }
  function viewTrends() {
    const F = window.OrbitFinance;
    const page = h('div', { class: 'page' });
    page.appendChild(finPageHeader('Trends', 'How your net worth and cash flow move over time.', null, null));
    const c1 = h('div', { class: 'card' });
    c1.appendChild(finSectionTitle('chart', 'Net worth over time'));
    c1.appendChild(finLineChart(State.finNwHistory));
    page.appendChild(c1);
    const trends = F.computeTrends(finAllTxns(), 12);
    const c2 = h('div', { class: 'card', style: { marginTop: 'var(--s-5)' } });
    c2.appendChild(finSectionTitle('chart', 'Income vs expenses · 12 months'));
    if (trends.some((t) => t.income || t.expense)) {
      c2.appendChild(finBarChart(trends));
      c2.appendChild(h('div', { class: 'sub', style: { display: 'flex', gap: '16px', fontSize: '12px', marginTop: '8px' } }, [
        h('span', {}, '🟢 Income'), h('span', {}, '🔴 Expenses')
      ]));
    } else c2.appendChild(finEmpty('No transaction history', 'Add transactions to see monthly income vs expense trends.'));
    page.appendChild(c2);

    // ---- Spending analytics: merchant / method / tag (this month) ----
    const now = new Date();
    const allT = finAllTxns();
    const merchants = F.payeeBreakdown(allT, now.getFullYear(), now.getMonth());
    const methods = F.methodBreakdown(allT, now.getFullYear(), now.getMonth());
    const tags = F.tagBreakdown(allT, now.getFullYear(), now.getMonth());
    const monthLbl = now.toLocaleDateString('en-US', { month: 'long' });
    const colcards = h('div', { class: 'grid-cols-3', style: { marginTop: 'var(--s-5)' } }, [
      breakdownCard('coins', 'Top merchants · ' + monthLbl, merchants, 'No spending yet'),
      breakdownCard('card', 'By payment method · ' + monthLbl, methods, 'Set a method on transactions'),
      breakdownCard('tag', 'By tag · ' + monthLbl, tags, 'Tag transactions to see this')
    ]);
    page.appendChild(colcards);
    setMain(page);
  }
  // Horizontal-bar breakdown list (label · bar · amount), top 8.
  function breakdownCard(icon, title, items, emptyMsg) {
    const card = h('div', { class: 'card' });
    card.appendChild(h('div', { class: 'section-title', style: { display: 'flex', alignItems: 'center', gap: '8px' } }, [finIcon(icon, 16), h('span', {}, title)]));
    if (!items.length) { card.appendChild(h('div', { class: 'sub', style: { fontSize: '12px', padding: '8px 0' } }, emptyMsg)); return card; }
    const max = items[0].amount || 1;
    items.slice(0, 8).forEach((it) => {
      card.appendChild(h('div', { style: { padding: '6px 0' } }, [
        h('div', { style: { display: 'flex', justifyContent: 'space-between', fontSize: '13px', marginBottom: '3px' } }, [
          h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '60%' } }, (it.icon ? it.icon + ' ' : '') + it.label),
          h('span', { style: { fontWeight: '600', fontVariantNumeric: 'tabular-nums' } }, finMoney(it.amount))
        ]),
        h('div', { style: { background: 'rgba(127,127,127,0.12)', borderRadius: '999px', height: '6px', overflow: 'hidden' } },
          h('div', { style: { height: '100%', width: Math.max(3, (it.amount / max) * 100) + '%', background: 'var(--accent,#34B87A)', borderRadius: '999px' } }))
      ]));
    });
    return card;
  }

  // ===== FINANCIAL VITALS (health / runway / savings rate) =====
  function financialVitalsRow() {
    const m = window.OrbitFinance.financialMetrics(finData(), finBase());
    const hClass = m.healthScore >= 80 ? 'pos' : m.healthScore >= 50 ? '' : 'neg';
    const rClass = m.runway >= 6 ? 'pos' : m.runway >= 3 ? '' : 'neg';
    const sClass = m.savingsRate >= 20 ? 'pos' : m.savingsRate >= 0 ? '' : 'neg';
    const grid = h('div', { class: 'kpi-grid kpi-grid-3', style: { marginTop: 'var(--s-3)' } });
    grid.appendChild(kpiCard('Health score', m.healthScore + '/100', '', m.healthScore >= 80 ? 'Excellent' : m.healthScore >= 60 ? 'Good' : m.healthScore >= 40 ? 'Fair' : 'Needs work', hClass, { tilt: true }));
    grid.appendChild(kpiCard('Runway', (m.runway >= 999 ? '∞' : m.runway.toFixed(1)) + ' mo', '', 'Months at current burn', rClass, { tilt: true }));
    grid.appendChild(kpiCard('Savings rate', m.savingsRate.toFixed(0) + '%', '', 'Surplus ÷ income', sClass, { tilt: true }));
    return grid;
  }

  // ===== CASH FLOW (24-month projection) =====
  function viewCashflow() {
    const F = window.OrbitFinance;
    const page = h('div', { class: 'page' });
    page.appendChild(finPageHeader('Cash flow', 'A 24-month forecast from your recurring income, bills, EMIs & subscriptions.', null, null));
    const proj = F.cashflowProjection(finData(), 24, finBase());
    const firstNeg = proj.find((p) => p.closing < 0);

    const c1 = h('div', { class: 'card' });
    c1.appendChild(finSectionTitle('chart', 'Projected balance · next 24 months'));
    if (firstNeg) c1.appendChild(h('div', { class: 'neg', style: { marginBottom: '8px', fontSize: '13px' } }, '⚠️ Balance goes negative around ' + firstNeg.label + ' — review recurring outflows.'));
    c1.appendChild(finLineChart(proj.map((p) => ({ date: p.label, netWorth: p.closing }))));
    page.appendChild(c1);

    const c2 = h('div', { class: 'card', style: { marginTop: 'var(--s-5)' } });
    c2.appendChild(finSectionTitle('calendar', 'Month-by-month'));
    proj.slice(0, 12).forEach((p) => {
      c2.appendChild(h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--s-3)', padding: '10px 4px', borderTop: '1px solid var(--border)', background: p.closing < 0 ? 'rgba(220,60,60,0.06)' : 'transparent' } }, [
        h('div', { style: { fontWeight: '600', minWidth: '70px' } }, p.label),
        h('div', { class: 'sub', style: { fontSize: '12px', flex: 1 } }, '+' + finMoney(p.income) + ' · −' + finMoney(p.expense + p.emi)),
        h('div', { class: p.closing >= 0 ? 'pos' : 'neg', style: { fontWeight: '600', fontVariantNumeric: 'tabular-nums' } }, finMoney(p.closing))
      ]));
    });
    page.appendChild(c2);
    setMain(page);
  }

  // ===== RECURRING (auto-posting rules) =====
  const REC_FREQ = ['monthly', 'weekly', 'biweekly', 'quarterly', 'yearly'];
  // Post any due recurring rules into the ledger, advancing their schedule.
  async function finProcessRecurring() {
    try {
      const res = window.OrbitFinance.dueRecurring(State.finRecurring);
      if (!res.posts.length) return 0;
      for (const p of res.posts) { p.id = uid('tx'); await OrbitDB.put('fin_txns', p); }
      for (const r of res.rules) await OrbitDB.put('fin_recurring', r);
      await finReload('fin_txns', 'finTxns');
      await finReload('fin_recurring', 'finRecurring');
      return res.posts.length;
    } catch (_) { return 0; }
  }
  function viewRecurring() {
    const F = window.OrbitFinance;
    const page = h('div', { class: 'page' });
    page.appendChild(finPageHeader('Recurring', 'Rules that auto-post into your ledger each cycle — salary, rent, bills.', '+ Add rule', () => openRecurringModal()));
    const card = h('div', { class: 'card' });
    card.appendChild(finSectionTitle('repeat', 'Recurring rules'));
    if (!State.finRecurring.length) card.appendChild(finEmpty('No recurring rules', 'Add salary, rent or a bill and it posts itself every cycle.', true));
    else State.finRecurring.forEach((r) => {
      const active = r.active !== false;
      card.appendChild(h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--s-3)', padding: '12px 4px', borderTop: '1px solid var(--border)', opacity: active ? 1 : 0.55 } }, [
        h('div', {}, [
          h('div', { style: { fontWeight: '600' } }, r.description + (active ? '' : ' · paused')),
          h('div', { class: 'sub', style: { fontSize: '12px' } }, [
            h('span', { class: r.type === 'income' ? 'pos' : 'neg' }, (r.type === 'income' ? '+' : '−') + finMoney(r.amount)),
            ' · ' + F.txnCategoryLabel(r.category) + ' · ' + r.frequency + ' · next ' + fmtDateShort(r.nextDate)
          ])
        ]),
        h('div', { style: { display: 'flex', gap: 'var(--s-3)' } }, [
          h('button', { class: 'btn btn-ghost btn-sm', onClick: async () => { r.active = !active; await OrbitDB.put('fin_recurring', r); await finReload('fin_recurring', 'finRecurring'); finRerender(); } }, active ? 'Pause' : 'Resume'),
          h('button', { class: 'btn btn-ghost btn-sm', onClick: () => openRecurringModal(r) }, 'Edit'),
          h('button', { class: 'btn btn-ghost btn-sm', onClick: () => deleteFin('fin_recurring', 'finRecurring', r.id, 'Rule') }, '🗑')
        ])
      ]));
    });
    page.appendChild(card);
    setMain(page);
  }
  function openRecurringModal(existing) {
    const F = window.OrbitFinance;
    const editing = !!existing;
    const r = existing || { type: 'expense', amount: '', description: '', category: 'housing', frequency: 'monthly', nextDate: toDateInput(Date.now()), account: '' };
    const typeSel = h('select', { class: 'select' }, ['expense', 'income'].map((x) => h('option', { value: x, selected: x === r.type ? '' : null }, x[0].toUpperCase() + x.slice(1))));
    const amt = h('input', { class: 'input', type: 'number', step: '0.01', value: r.amount, placeholder: '28000' });
    const desc = h('input', { class: 'input', value: r.description || '', placeholder: 'e.g., Monthly Rent' });
    const catSel = h('select', { class: 'select' });
    const freqSel = h('select', { class: 'select' }, REC_FREQ.map((f) => h('option', { value: f, selected: f === r.frequency ? '' : null }, f[0].toUpperCase() + f.slice(1))));
    const next = h('input', { class: 'input', type: 'date', value: r.nextDate ? toDateInput(r.nextDate) : '' });
    function fillCats() { const map = typeSel.value === 'income' ? F.TXN_INCOME_CATEGORIES : F.TXN_EXPENSE_CATEGORIES; catSel.innerHTML = ''; Object.keys(map).forEach((k) => catSel.appendChild(h('option', { value: k, selected: k === r.category ? '' : null }, map[k]))); }
    typeSel.addEventListener('change', fillCats); fillCats();
    const modal = h('div', { class: 'modal modal-sm' }, [
      h('div', { class: 'modal-head' }, [h('h2', {}, editing ? 'Edit rule' : 'Add recurring rule'), h('button', { class: 'close', onClick: closeModal }, '×')]),
      h('div', { class: 'modal-body' }, [
        h('div', { class: 'input-row' }, [formRow('Type', typeSel), formRow('Amount', amt)]),
        formRow('Description', desc),
        h('div', { class: 'input-row' }, [formRow('Category', catSel), formRow('Frequency', freqSel)]),
        formRow('Next date', next)
      ]),
      h('div', { class: 'modal-foot' }, [
        h('button', { class: 'btn btn-ghost btn-sm', onClick: closeModal }, 'Cancel'),
        h('button', { class: 'btn btn-primary btn-sm', onClick: async () => {
          if (!desc.value.trim()) { toast('Describe the rule', 'neg'); return; }
          const a = parseFloat(amt.value); if (isNaN(a) || a <= 0) { toast('Enter an amount', 'neg'); return; }
          const rec = { id: r.id || uid('rc'), type: typeSel.value, amount: a, description: desc.value.trim(), category: catSel.value, frequency: freqSel.value, nextDate: next.value || toDateInput(Date.now()), account: r.account || null, active: r.active !== false };
          await OrbitDB.put('fin_recurring', rec);
          await finReload('fin_recurring', 'finRecurring');
          await finProcessRecurring();
          closeModal(); toast('Rule saved', 'pos'); finRerender();
        } }, editing ? 'Save' : 'Add')
      ])
    ]);
    openModal(modal);
  }

  // ===== NATURAL-LANGUAGE QUICK ADD (intelligent) =====
  // Type "paid 1200 for fuel" → a categorized transaction. Parses locally
  // (instant, offline) and refines with OrbitAI when a key is configured.
  function openFinanceQuickAdd() {
    const F = window.OrbitFinance;
    const input = h('input', { class: 'input', placeholder: 'e.g. paid 1200 for fuel · received 50000 salary · 250 coffee' });
    const preview = h('div', { style: { marginTop: '10px', minHeight: '40px' } });
    let parsed = null;
    function renderPreview(aiTag) {
      preview.innerHTML = '';
      if (!parsed) { preview.appendChild(h('div', { class: 'sub', style: { fontSize: '13px' } }, 'Type a transaction in plain English and I\'ll categorize it.')); return; }
      const inc = parsed.type === 'income';
      preview.appendChild(h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 'var(--r-4,10px)' } }, [
        h('span', { class: inc ? 'pos' : 'neg', style: { fontWeight: '700', fontSize: '16px' } }, (inc ? '+' : '−') + finMoney(parsed.amount)),
        h('span', { style: { flex: 1 } }, [
          h('div', { style: { fontWeight: '600' } }, parsed.description),
          h('div', { class: 'sub', style: { fontSize: '12px' } }, (inc ? 'Income' : 'Expense') + ' · ' + F.txnCategoryLabel(parsed.category) + (aiTag ? ' · ✨ AI' : ''))
        ])
      ]));
    }
    let timer = null;
    input.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => { parsed = F.parseFinanceText(input.value); renderPreview(false); }, 120);
    });
    renderPreview(false);
    const modal = h('div', { class: 'modal modal-sm' }, [
      h('div', { class: 'modal-head' }, [h('h2', {}, '⚡ Quick add'), h('button', { class: 'close', onClick: closeModal }, '×')]),
      h('div', { class: 'modal-body' }, [formRow('What happened?', input), preview]),
      h('div', { class: 'modal-foot' }, [
        h('button', { class: 'btn btn-ghost btn-sm', onClick: closeModal }, 'Cancel'),
        h('button', { class: 'btn btn-primary btn-sm', onClick: async () => {
          parsed = F.parseFinanceText(input.value);
          if (!parsed || !parsed.amount) { toast('Couldn\'t find an amount — try "paid 500 for lunch"', 'neg'); input.focus(); return; }
          // Best-effort AI refinement (only if a key/proxy is available; never blocks).
          try {
            if (window.OrbitAI && OrbitAI.parseExpense) {
              const r = await Promise.race([OrbitAI.parseExpense(input.value), new Promise((res) => setTimeout(() => res(null), 2500))]);
              if (r && r.ok && r.parsed) {
                if (r.parsed.amount) parsed.amount = r.parsed.amount;
                if (r.parsed.category && ORBIT_CAT_TO_FIN[r.parsed.category]) parsed.category = ORBIT_CAT_TO_FIN[r.parsed.category];
                if (r.parsed.title) parsed.description = r.parsed.title;
              }
            }
          } catch (_) {}
          const rec = { id: uid('tx'), type: parsed.type, amount: parsed.amount, date: toDateInput(Date.now()), category: parsed.category, description: parsed.description, account: null, notes: '' };
          await OrbitDB.put('fin_txns', rec);
          await finReload('fin_txns', 'finTxns');
          closeModal(); toast('Added: ' + finMoney(parsed.amount) + ' · ' + F.txnCategoryLabel(parsed.category), 'pos');
          if (sectionForRoute(State.route.name) !== 'money') location.hash = '#/transactions'; else finRerender();
        } }, 'Add transaction')
      ])
    ]);
    openModal(modal);
    setTimeout(() => input.focus(), 40);
  }

  // ===== EXPORT (CSV + printable PDF) =====
  function finExportCSV() {
    const csv = window.OrbitFinance.buildFinanceCSV(finData());
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'orbit-finance-' + new Date().toISOString().slice(0, 10) + '.csv';
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    toast('CSV exported', 'pos');
  }
  function finExportPDF() {
    const F = window.OrbitFinance;
    const m = F.financialMetrics(finData(), finBase());
    const today = new Date().toLocaleDateString();
    const row = (a) => '<tr>' + a.map((c) => '<td>' + c + '</td>').join('') + '</tr>';
    const budgetRows = F.computeBudgets(State.finBudgets, finAllTxns()).map((b) => row([F.txnCategoryLabel(b.category), finMoney(b.limit), finMoney(b.actual), b.pct.toFixed(0) + '%'])).join('') || row(['—', '', '', '']);
    const goalRows = State.finGoals.map((g) => { const c = F.computeGoal(g); return row([g.name, finMoney(c.saved), finMoney(c.target), c.pct.toFixed(0) + '%']); }).join('') || row(['—', '', '', '']);
    const win = window.open('', '_blank');
    if (!win) { toast('Allow popups to export PDF', 'neg'); return; }
    win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Orbit finance report</title>
      <style>body{font-family:Arial,Helvetica,sans-serif;color:#1a1f3a;margin:32px}h1{color:#34B87A;margin-bottom:0}.s{color:#777;margin-top:4px}h2{border-bottom:2px solid #ddd;padding-bottom:4px;margin-top:26px;font-size:15px}.g{display:flex;flex-wrap:wrap;gap:14px;margin:12px 0}.k{border:1px solid #e0e0e0;border-radius:8px;padding:10px 14px;min-width:130px}.k .l{font-size:11px;color:#777;text-transform:uppercase}.k .v{font-size:18px;font-weight:bold}table{width:100%;border-collapse:collapse;margin-top:8px;font-size:13px}td,th{text-align:left;padding:6px 10px;border-bottom:1px solid #eee}</style>
      </head><body>
      <h1>Orbit — Finance report</h1><div class="s">Generated ${today} · base ${finBase()}</div>
      <h2>Vitals</h2><div class="g">
      <div class="k"><div class="l">Net worth</div><div class="v">${finMoney(m.netWorth)}</div></div>
      <div class="k"><div class="l">Health</div><div class="v">${m.healthScore}/100</div></div>
      <div class="k"><div class="l">Runway</div><div class="v">${m.runway >= 999 ? '∞' : m.runway.toFixed(1)} mo</div></div>
      <div class="k"><div class="l">Savings rate</div><div class="v">${m.savingsRate.toFixed(0)}%</div></div>
      <div class="k"><div class="l">Monthly burn</div><div class="v">${finMoney(m.monthlyBurn)}</div></div></div>
      <h2>Budgets</h2><table><tr><th>Category</th><th>Limit</th><th>Spent</th><th>Used</th></tr>${budgetRows}</table>
      <h2>Goals</h2><table><tr><th>Goal</th><th>Saved</th><th>Target</th><th>Progress</th></tr>${goalRows}</table>
      </body></html>`);
    win.document.close(); win.focus();
    setTimeout(() => { try { win.print(); } catch (_) {} }, 400);
  }
  function openFinExportMenu() {
    const modal = h('div', { class: 'modal modal-sm' }, [
      h('div', { class: 'modal-head' }, [h('h2', {}, 'Export finance data'), h('button', { class: 'close', onClick: closeModal }, '×')]),
      h('div', { class: 'modal-body' }, [
        h('button', { class: 'btn btn-block', style: { marginBottom: '8px' }, onClick: () => { closeModal(); finExportCSV(); } }, '📄 Download CSV (spreadsheet)'),
        h('button', { class: 'btn btn-block', onClick: () => { closeModal(); finExportPDF(); } }, '🖨️ Print / save as PDF')
      ]),
      h('div', { class: 'modal-foot' }, [h('button', { class: 'btn btn-ghost btn-sm', onClick: closeModal }, 'Close')])
    ]);
    openModal(modal);
  }

  // ===== BILL / RENEWAL REMINDERS =====
  async function checkFinReminders(announce) {
    const items = window.OrbitFinance.remindersDue(finData());
    if (!items.length) { if (announce) toast('No bills or renewals due in the next 3 days', ''); return; }
    const granted = ('Notification' in window) && Notification.permission === 'granted';
    if (granted) items.forEach((it) => { try { new Notification('Orbit reminder', { body: it.name + ' — ' + finMoney(it.amount) + ' due ' + fmtDateShort(it.date) }); } catch (_) {} });
    toast('🔔 ' + items.length + ' ' + (items.length === 1 ? 'bill/renewal' : 'bills/renewals') + ' due within 3 days', 'warn');
  }
  function enableFinReminders() {
    if (!('Notification' in window)) { toast('Notifications not supported here', 'neg'); return; }
    Notification.requestPermission().then((perm) => {
      if (perm === 'granted') { OrbitDB.setMeta('finReminders', true); toast('Reminders on — you\'ll be notified of bills due soon', 'pos'); checkFinReminders(false); }
      else toast('Reminder permission denied', 'neg');
    });
  }

  // ===== PENDING — upcoming & unpaid (bills, recurring, renewals) =====
  function viewPending() {
    const F = window.OrbitFinance;
    const now = new Date();
    const soon = new Date(now.getTime() + 30 * 86400000);
    const page = h('div', { class: 'page' });
    page.appendChild(finPageHeader('Pending', 'Everything coming up or unpaid — bills, recurring charges and renewals. Mark a transaction "Pending" to track it here.', '+ Add bill', () => openTxnModal()));

    // 1) Pending transactions (status = pending)
    const pendingTxns = State.finTxns.filter((t) => t.status === 'pending').sort((a, b) => new Date(a.date) - new Date(b.date));
    const dueTotal = pendingTxns.filter((t) => t.type !== 'income').reduce((s, t) => s + (parseFloat(t.amount) || 0), 0);
    // 2) Upcoming recurring expense rules (next 30 days)
    const upRecur = (State.finRecurring || []).filter((r) => r.active !== false && r.type === 'expense' && r.nextDate && new Date(r.nextDate) <= soon).sort((a, b) => new Date(a.nextDate) - new Date(b.nextDate));
    // 3) Upcoming subscription renewals (next 30 days)
    const upSubs = (State.finSubs || []).filter((s) => s.nextRenewal && new Date(s.nextRenewal) >= now && new Date(s.nextRenewal) <= soon).sort((a, b) => new Date(a.nextRenewal) - new Date(b.nextRenewal));

    const grid = h('div', { class: 'kpi-grid' });
    grid.appendChild(kpiCard('Unpaid bills', Math.round(dueTotal), finBase(), plural(pendingTxns.length, 'pending item'), 'neg', { tilt: true }));
    grid.appendChild(kpiCard('Recurring due', upRecur.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0), finBase(), 'Next 30 days', 'neg', { tilt: true }));
    grid.appendChild(kpiCard('Renewals', upSubs.reduce((s, x) => s + (parseFloat(x.amount) || 0), 0), finBase(), plural(upSubs.length, 'renewal'), 'neg', { tilt: true }));
    page.appendChild(grid);

    const rowItem = (title, sub, amount, accent, action) => h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--s-3)', padding: '12px 4px', borderTop: '1px solid var(--border)' } }, [
      h('div', { style: { minWidth: 0 } }, [h('div', { style: { fontWeight: '600' } }, title), h('div', { class: 'sub', style: { fontSize: '12px' } }, sub)]),
      h('div', { style: { display: 'flex', alignItems: 'center', gap: 'var(--s-3)' } }, [h('div', { class: accent, style: { fontWeight: '600' } }, finMoney(amount)), action].filter(Boolean))
    ]);

    const card = h('div', { class: 'card', style: { marginTop: 'var(--s-5)' } });
    card.appendChild(finSectionTitle('clock', 'Unpaid bills'));
    if (!pendingTxns.length) card.appendChild(h('div', { class: 'sub', style: { fontSize: '12px', padding: '8px 0' } }, 'Nothing unpaid. Mark a transaction "Pending" to track a bill here.'));
    else pendingTxns.forEach((t) => card.appendChild(rowItem(
      t.description || 'Bill', F.txnCategoryLabel(t.category) + ' · due ' + fmtDateShort(t.date), t.amount, t.type === 'income' ? 'pos' : 'neg',
      h('button', { class: 'btn btn-primary btn-sm', onClick: async () => { t.status = 'cleared'; await OrbitDB.put('fin_txns', t); await finReload('fin_txns', 'finTxns'); toast('Marked paid', 'pos'); finRerender(); } }, '✓ Paid')
    )));
    page.appendChild(card);

    if (upRecur.length) {
      const c = h('div', { class: 'card', style: { marginTop: 'var(--s-3)' } });
      c.appendChild(finSectionTitle('repeat', 'Recurring · next 30 days'));
      upRecur.forEach((r) => c.appendChild(rowItem(r.description, F.txnCategoryLabel(r.category) + ' · ' + r.frequency + ' · ' + fmtDateShort(r.nextDate), r.amount, 'neg', h('a', { class: 'btn btn-ghost btn-sm', href: '#/recurring' }, 'Manage'))));
      page.appendChild(c);
    }
    if (upSubs.length) {
      const c = h('div', { class: 'card', style: { marginTop: 'var(--s-3)' } });
      c.appendChild(finSectionTitle('repeat', 'Renewals · next 30 days'));
      upSubs.forEach((s) => c.appendChild(rowItem(s.name, 'Renews ' + fmtDateShort(s.nextRenewal), s.amount, 'neg', h('a', { class: 'btn btn-ghost btn-sm', href: '#/subscriptions' }, 'Manage'))));
      page.appendChild(c);
    }
    setMain(page); bindTilt(page);
  }

  // ===== generic finance delete =====
  async function deleteFin(store, stateKey, id, label) {
    if (!confirm('Delete this ' + (label || 'item').toLowerCase() + '?')) return;
    await OrbitDB.delete(store, id);
    await finReload(store, stateKey);
    if (store === 'fin_loans' || store === 'fin_investments') await snapshotFinNetWorth();
    closeModal && closeModal();
    toast((label || 'Item') + ' deleted'); finRerender();
  }


  window.addEventListener('DOMContentLoaded', boot);
  window.OrbitApp = { State, render };
  // Test hook (pure money/logic functions) — used by the headless QA harness to
  // unit-test the real implementations rather than a reimplementation. Safe to
  // ship: read-only helpers, no secrets.
  window.OrbitApp.__test = {
    computePairBalances, computeNetByCurrency, simplifyDebts, reconcileSplits,
    totalOwedToYou, totalYouOwe, allocateSettlement, recordSettlement,
    recordSettlementSmart, computeGroupMatrix, csvCell,
    expensePayers, paidByUser, payerLabel, isSharedGroup,
    finData, finVirtualTxns, finAllTxns, finSplitwiseNet, clearFinanceDemo, clearDemoData
  };
})();
