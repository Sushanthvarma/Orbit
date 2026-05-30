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
    const opts = { month: 'short', day: 'numeric' };
    if (d.getFullYear() !== new Date().getFullYear()) opts.year = '2-digit';
    return d.toLocaleDateString('en-US', opts);
  }
  function fmtDateTime(iso) {
    const d = new Date(iso);
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

  // ---- Shared-group helpers (Phase D) -------------------------------
  // A "shared" group is one that also lives in Firestore (groups.js). To
  // keep the two paths from forking we make the local group's id EQUAL the
  // Firestore group id, so realtime echoes merge over the same record and
  // never produce a duplicate card. sharedIdOf() returns the Firestore id
  // (or null for a local-only group).
  function isSharedGroup(g) { return !!(g && (g.shared || g.sharedId)); }
  function sharedIdOf(g) { return g ? (g.sharedId || (g.shared ? g.id : null)) : null; }
  function canShare() { return !!(window.OrbitGroups && OrbitGroups.isReady()); }

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

  // Dual-write an expense to its group's Firestore copy when the group is
  // shared. Same id as the local record → realtime merge is idempotent.
  // Best-effort: a cloud failure never blocks the local save.
  async function syncExpenseIfShared(obj) {
    const g = groupById(obj.groupId);
    const sid = sharedIdOf(g);
    if (!sid || !canShare()) return;
    try { await OrbitGroups.addExpense(sid, obj); }
    catch (e) { console.warn('[Phase D] shared expense write failed', e); toast('Saved locally — cloud sync will retry', 'neg'); }
  }
  // Mirror a local expense delete to Firestore, else the realtime listener
  // re-adds the row on next snapshot ("zombie expense").
  async function syncDeleteExpenseIfShared(e) {
    const g = groupById(e.groupId);
    const sid = sharedIdOf(g);
    if (!sid || !canShare()) return;
    try { await OrbitGroups.deleteExpense(sid, e.id); }
    catch (err) { console.warn('[Phase D] shared expense delete failed', err); }
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
      try { await OrbitGroups.addExpense(sharedId, e); } catch (_) {}
    }
    State.settlements.filter((s) => s.groupId === oldId).forEach(async (s) => { s.groupId = sharedId; await OrbitDB.put('settlements', s); });
    await OrbitDB.delete('groups', oldId);
    g.id = sharedId; g.shared = true; g.sharedId = sharedId;
    await OrbitDB.put('groups', g);
  }

  function avatar(userId, size = '') {
    const cls = size ? 'avatar avatar-' + size : 'avatar';
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
  function expenseAffectsUser(exp, userId) {
    if (exp.paidBy === userId) return true;
    if ((exp.splits || []).some((s) => s.userId === userId)) return true;
    return false;
  }

  // Returns map { userId: balance } where positive means "they owe you", negative means "you owe them"
  // Filtered to a single user (the self user) — net per other user.
  function computePairBalances(selfId, groupId = null) {
    const result = {};
    const exps = groupId ? State.expenses.filter((e) => e.groupId === groupId) : State.expenses;
    const setts = groupId ? State.settlements.filter((s) => s.groupId === groupId) : State.settlements;

    exps.forEach((exp) => {
      const myShare = (exp.splits.find((s) => s.userId === selfId) || {}).amount || 0;
      if (exp.paidBy === selfId) {
        exp.splits.forEach((s) => {
          if (s.userId !== selfId) {
            result[s.userId] = (result[s.userId] || 0) + s.amount;
          }
        });
      } else if (myShare > 0) {
        result[exp.paidBy] = (result[exp.paidBy] || 0) - myShare;
      }
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

    const exps = State.expenses.filter((e) => e.groupId === groupId);
    const setts = State.settlements.filter((s) => s.groupId === groupId);

    exps.forEach((exp) => {
      net[exp.paidBy] = (net[exp.paidBy] || 0) + exp.amount;
      exp.splits.forEach((s) => { net[s.userId] = (net[s.userId] || 0) - s.amount; });
    });
    setts.forEach((s) => {
      net[s.fromUser] = (net[s.fromUser] || 0) + s.amount;
      net[s.toUser] = (net[s.toUser] || 0) - s.amount;
    });

    Object.keys(net).forEach((k) => { net[k] = Math.round(net[k] * 100) / 100; });
    return { members, net };
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
    // Net across INR-priced groups only (mixed-currency aware UI shows split).
    const bal = computePairBalances(State.selfId);
    let net = 0;
    Object.entries(bal).forEach(([uid, v]) => { net += v; });
    // Adjust: above is global without currency awareness.
    // Re-implement per-currency:
    return computeNetByCurrency()[currency] || 0;
  }
  function computeNetByCurrency() {
    const out = {};
    State.expenses.forEach((exp) => {
      const cur = exp.currency || 'INR';
      out[cur] = out[cur] || 0;
      const myShare = (exp.splits.find((s) => s.userId === State.selfId) || {}).amount || 0;
      if (exp.paidBy === State.selfId) out[cur] += (exp.amount - myShare);
      else if (myShare > 0) out[cur] -= myShare;
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
    const bal = computePairBalances(State.selfId);
    let v = 0;
    Object.values(bal).forEach((x) => { if (x < 0) v += -x; });
    return Math.round(v * 100) / 100;
  }
  function totalOwedToYou(currency = 'INR') {
    const bal = computePairBalances(State.selfId);
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
        userNameFull(e.paidBy).toLowerCase().includes(q) ||
        (groupById(e.groupId)?.name || '').toLowerCase().includes(q)
      );
    }
    if (f.groupId) r = r.filter((e) => e.groupId === f.groupId);
    if (f.category) r = r.filter((e) => e.category === f.category);
    if (f.paidBy) r = r.filter((e) => e.paidBy === f.paidBy);
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
  function parseHash() {
    const hash = location.hash.slice(1) || '/dashboard';
    const [path, queryStr] = hash.split('?');
    const parts = path.split('/').filter(Boolean);
    const query = {};
    (queryStr || '').split('&').filter(Boolean).forEach((p) => {
      const [k, v] = p.split('=');
      query[decodeURIComponent(k)] = decodeURIComponent(v || '');
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
    const { parts, query } = parseHash();
    const [name, p1, p2] = parts;
    State.route = { name: name || 'dashboard', params: { id: p1, sub: p2 }, query };
    updateSidebarActive();
    render();
  }
  window.addEventListener('hashchange', route);

  // ===================================================================
  // BREADCRUMBS
  // ===================================================================
  function renderCrumbs() {
    const root = $('#crumbs');
    root.innerHTML = '';
    const map = {
      dashboard: 'Dashboard', groups: 'Groups', expenses: 'Expenses',
      trips: 'Trips', activity: 'Activity', analytics: 'Analytics',
      settle: 'Settle up', profile: 'Profile', join: 'Join group'
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
    $$('.nav-item, .tab-item').forEach((n) => n.classList.remove('active'));
    const name = State.route.name;
    // Light up both the desktop sidebar item and the mobile tab-bar item.
    document.querySelectorAll(`.nav-item[data-route="${name}"], .tab-item[data-route="${name}"]`)
      .forEach((el) => el.classList.add('active'));
    // Routes that live under the mobile "More" sheet light up that tab.
    const more = document.querySelector('#tabMore');
    if (more && ['expenses', 'settle', 'trips', 'analytics', 'profile'].includes(name)) more.classList.add('active');
  }
  function renderSidebarGroups() {
    const root = $('#sidebarGroups');
    root.innerHTML = '';
    const groups = State.groups.slice().sort((a, b) => {
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
      trip: 'linear-gradient(135deg,#38BDF8,#0369A1)',
      household: 'linear-gradient(135deg,#34D399,#059669)',
      friends: 'linear-gradient(135deg,#F472B6,#BE185D)',
      work: 'linear-gradient(135deg,#A78BFA,#6D28D9)'
    };
    return map[g.category] || 'var(--surface-3)';
  }
  function lastActivityDate(groupId) {
    let last = '';
    State.expenses.forEach((e) => { if (e.groupId === groupId && e.date > last) last = e.date; });
    State.settlements.forEach((s) => { if (s.groupId === groupId && s.date > last) last = s.date; });
    return last;
  }
  function computeGroupBalanceForSelf(groupId) {
    let v = 0;
    State.expenses.forEach((e) => {
      if (e.groupId !== groupId) return;
      const myShare = (e.splits.find((s) => s.userId === State.selfId) || {}).amount || 0;
      if (e.paidBy === State.selfId) v += e.amount - myShare;
      else if (myShare > 0) v -= myShare;
    });
    State.settlements.forEach((s) => {
      if (s.groupId !== groupId) return;
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
  function setMain(node) {
    const main = $('#main');
    main.innerHTML = '';
    main.appendChild(node);
    main.scrollTop = 0;
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

    if (!window.OrbitGroups) {
      body.appendChild(h('p', { class: 'small muted' }, 'Shared groups are still loading. Refresh and open the link again.'));
      return;
    }
    if (!code) { body.appendChild(h('p', { class: 'small muted' }, 'This invite link is incomplete.')); return; }

    body.appendChild(h('div', { class: 'small muted' }, 'Checking your invite…'));
    try {
      const inv = await OrbitGroups.getInvite(code);
      if (!inv) { body.innerHTML = ''; body.appendChild(h('p', {}, 'This invite was not found or has expired.')); return; }
      const g = await OrbitGroups.getGroup(inv.groupId).catch(() => null);
      body.innerHTML = '';
      body.appendChild(h('div', { class: 'gc-emoji', style: { margin: '0 auto 12px', width: '48px', height: '48px', fontSize: '22px' } }, (g && g.emoji) || 'OR'));
      body.appendChild(h('h2', { style: { margin: '0 0 6px' } }, g ? g.name : 'a shared group'));
      body.appendChild(h('p', { class: 'small muted', style: { margin: '0 0 20px' } }, g ? ((g.memberUids ? g.memberUids.length : 1) + ' members · ' + (g.currency || 'INR')) : 'Tap join to be added.'));
      const joinBtn = h('button', { class: 'btn btn-primary' }, 'Join this group');
      joinBtn.addEventListener('click', async () => {
        joinBtn.disabled = true; joinBtn.textContent = 'Joining…';
        try {
          const res = await OrbitGroups.acceptInvite(code);
          toast('Joined! Welcome to the group.', 'pos');
          navigate('#/groups/' + (res && res.groupId ? res.groupId : ''));
        } catch (e) {
          joinBtn.disabled = false; joinBtn.textContent = 'Join this group';
          toast('Could not join: ' + (e.message || e.code || 'error'), 'neg');
        }
      });
      body.appendChild(joinBtn);
    } catch (e) {
      body.innerHTML = '';
      body.appendChild(h('p', {}, 'Could not load this invite. ' + (e.message || '')));
    }
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
    const kpiGrid = h('div', { class: 'kpi-grid bal-row' });
    const netSub = netINR === 0 ? 'You are even' : netINR > 0
      ? (countCreditors() + ' friends owe you across ' + State.groups.length + ' groups')
      : 'You owe across ' + countDebtors() + ' people';
    kpiGrid.appendChild(kpiCard('Net position', netINR, 'INR', netSub, '', { hero: true }));
    kpiGrid.appendChild(kpiCard('You are owed', owed, 'INR', 'Across ' + countCreditors() + ' people', 'pos', { tilt: true }));
    kpiGrid.appendChild(kpiCard('You owe', -owe, 'INR', 'Across ' + countDebtors() + ' people', 'neg', { tilt: true }));
    page.appendChild(kpiGrid);

    // Secondary stat row (EUR / groups) — only when there's a foreign balance.
    if (Math.abs(eu) > 0.01) {
      const sub2 = h('div', { class: 'kpi-grid kpi-grid-3' });
      sub2.appendChild(kpiCard('Europe Trip balance', eu, 'EUR', 'Europe Trip 2026', eu > 0 ? 'pos' : 'neg', { tilt: true }));
      sub2.appendChild(kpiCard('Active groups', State.groups.length, '', 'Across all workspaces', '', { tilt: true }));
      sub2.appendChild(kpiCard('Total expenses', State.expenses.length, '', 'Logged so far', '', { tilt: true }));
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
  }
  function kpiCard(label, value, currency, sub, valClass = '', opts = {}) {
    const v = typeof value === 'number' && currency ? fmtMoney(value, currency, false) : String(value);
    const cls = 'kpi' + (opts.hero ? ' kpi-hero tilt' : opts.tilt ? ' tilt' : '');
    const node = h('div', { class: cls }, [
      h('div', { class: 'kpi-label' }, label),
      h('div', { class: 'kpi-value ' + (opts.hero ? '' : valClass) }, v),
      sub ? h('div', { class: 'kpi-delta' }, sub) : null
    ]);
    if (opts.hero) node.appendChild(h('div', { class: 'kpi-orbit', html: orbitOrnamentSVG() }));
    return node;
  }
  // Decorative iris orbit ring drawn behind the hero card value.
  function orbitOrnamentSVG() {
    return '<svg width="150" height="150" viewBox="0 0 150 150" fill="none" aria-hidden="true">' +
      '<ellipse cx="75" cy="75" rx="60" ry="24" stroke="rgba(180,168,255,0.5)" stroke-width="1.2" transform="rotate(-18 75 75)"/>' +
      '<ellipse cx="75" cy="75" rx="40" ry="58" stroke="rgba(138,124,255,0.4)" stroke-width="1.2" transform="rotate(22 75 75)"/>' +
      '<circle cx="118" cy="58" r="3.5" fill="#B4A8FF"/>' +
      '<circle cx="34" cy="98" r="2.5" fill="rgba(180,168,255,0.7)"/></svg>';
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
  function countCreditors() {
    const b = computePairBalances(State.selfId);
    return Object.values(b).filter((v) => v > 0.01).length;
  }
  function countDebtors() {
    const b = computePairBalances(State.selfId);
    return Object.values(b).filter((v) => v < -0.01).length;
  }

  function panelRecentActivity() {
    const card = h('div', { class: 'card' });
    card.appendChild(h('div', { class: 'card-header' }, [
      h('h3', {}, 'Recent activity'),
      h('span', { class: 'sub' }, State.expenses.length + ' expenses')
    ]));
    const sortState = State.sort.dashActivity;
    const sorted = sortRows(State.expenses, sortState, {
      date: (e) => e.date,
      group: (e) => groupById(e.groupId)?.name || '',
      title: (e) => e.title,
      amount: (e) => e.amount,
      myShare: (e) => (e.splits.find((s) => s.userId === State.selfId) || {}).amount || 0,
      paidBy: (e) => userNameFull(e.paidBy)
    });
    const top = sorted.slice(0, 8);
    const wrap = h('div', { class: 'tbl-wrap' });
    const tbl = h('table', { class: 'tbl' });
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
        tr.appendChild(h('td', { class: 'col-date' }, fmtDateShort(e.date)));
        tr.appendChild(h('td', {}, g ? g.name : '—'));
        tr.appendChild(h('td', {}, h('div', { class: 'desc-cell' }, [
          h('span', { class: 'dot', style: { background: categoryColor(e.category) } }),
          h('div', {}, [
            h('div', { class: 'title' }, e.title),
            h('div', { class: 'note' }, categoryLabel(e.category))
          ])
        ])));
        tr.appendChild(h('td', {}, h('span', { class: 'who' }, [avatar(e.paidBy, 'sm'), userName(e.paidBy)])));
        tr.appendChild(h('td', { class: 'col-amt' }, fmtMoney(e.amount, e.currency)));
        tr.appendChild(h('td', { class: 'col-amt ' + (e.paidBy === State.selfId ? 'pos' : 'neg') }, fmtMoney(myShare, e.currency)));
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
    const m = { food:'#F59E0B', travel:'#38BDF8', bills:'#A78BFA', shop:'#F472B6', fun:'#FBBF24', rent:'#34D399', transport:'#FB923C', other:'#94A3B8' };
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
    const bal = computePairBalances(State.selfId);
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

  // Build a spec-compliant UPI intent URL.
  function buildUpiIntent(user, amount) {
    return 'upi://pay?pa=' + encodeURIComponent(user.upi) +
      '&pn=' + encodeURIComponent(user.name) +
      '&am=' + Number(amount).toFixed(2) +
      '&cu=INR&tn=' + encodeURIComponent('Orbit settle');
  }

  function payViaUPI(user, amount) {
    if (!user || !user.upi) {
      toast('No UPI ID on file for ' + (user ? user.name : 'this person'), 'neg');
      return;
    }
    const url = buildUpiIntent(user, amount);
    if (isMobileDevice()) {
      // Phone: fire the intent — Android shows the UPI app chooser
      // (GPay / PhonePe / Paytm); the user picks their app.
      const a = document.createElement('a');
      a.href = url; a.rel = 'noopener'; a.style.display = 'none';
      document.body.appendChild(a);
      toast('Opening your UPI app for ' + fmtMoney(amount, 'INR') + '…');
      try { a.click(); } finally { document.body.removeChild(a); }
    } else {
      // Desktop / laptop: upi:// won't resolve here, so show a QR the user
      // scans with any UPI app on their phone.
      openUpiQrModal(user, amount, url);
    }
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
    const me = State.users.find((u) => u.id === State.selfId);
    const msg = 'Hey' + (user && user.name ? ' ' + user.name : '') + '! I\'m using Orbit to split & settle expenses. Join me: ' +
      location.origin + location.pathname + '\n\n— ' + (me ? me.name : 'me');
    waOpen(msg, user && user.phone);
  }
  // WhatsApp glyph for settle-row buttons.
  function waIcon() {
    const wrap = document.createElement('span');
    wrap.style.display = 'inline-flex';
    wrap.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38a9.9 9.9 0 0 0 4.79 1.22h.01c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0 0 12.04 2Zm0 18.13a8.2 8.2 0 0 1-4.18-1.15l-.3-.18-3.11.82.83-3.04-.2-.31a8.22 8.22 0 0 1-1.26-4.36c0-4.54 3.7-8.23 8.23-8.23 2.2 0 4.27.86 5.82 2.42a8.18 8.18 0 0 1 2.41 5.82c0 4.54-3.69 8.23-8.23 8.23Zm4.52-6.16c-.25-.12-1.47-.72-1.69-.81-.23-.08-.39-.12-.56.13-.16.25-.64.8-.78.97-.14.16-.29.18-.54.06-.25-.12-1.05-.39-1.99-1.23-.74-.66-1.23-1.47-1.38-1.72-.14-.25-.01-.38.11-.5.11-.11.25-.29.37-.43.13-.14.17-.25.25-.41.08-.17.04-.31-.02-.43-.06-.12-.56-1.34-.76-1.84-.2-.48-.4-.42-.56-.43h-.48c-.16 0-.43.06-.65.31-.22.25-.86.84-.86 2.05 0 1.21.88 2.38 1 2.54.12.17 1.73 2.64 4.19 3.7.59.25 1.04.4 1.4.52.59.19 1.12.16 1.54.1.47-.07 1.47-.6 1.67-1.18.21-.58.21-1.07.14-1.18-.06-.1-.22-.16-.47-.28Z"/></svg>';
    return wrap.firstElementChild;
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
      const shareMsg = 'Join our \'' + g.name + '\' group on Orbit to split & settle expenses: ' + url;
      openInfoModal({ title: 'Invite to ' + g.name, body, actions: [
        { label: 'Copy link', onClick: () => { copyText(url); toast('Invite link copied'); } },
        { label: 'WhatsApp', onClick: () => waOpen(shareMsg) },
        { label: 'Email', onClick: () => {
          const subject = encodeURIComponent('Join “' + g.name + '” on Orbit');
          const mailBody = encodeURIComponent('Hi,\n\nI\'m using Orbit to split & settle our shared expenses. Tap this link, sign in with Google, and you\'ll join our “' + g.name + '” group:\n\n' + url + '\n\n— sent from Orbit');
          location.href = 'mailto:?subject=' + subject + '&body=' + mailBody;
        } }
      ] });
    } catch (e) {
      toast('Could not create invite: ' + (e.message || e.code || 'error'), 'neg');
    }
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
        const s = {
          id: uid('s'), groupId: '', fromUser: State.selfId, toUser: otherUserId,
          amount, currency: 'INR', method: 'manual', date: todayISO(), note: 'Manual settle'
        };
        await OrbitDB.put('settlements', s);
        State.settlements.push(s);
        toast('Settled with ' + userNameFull(otherUserId), 'pos');
        render();
      }
    });
  }

  function panelSpendChart28() {
    const card = h('div', { class: 'card' });
    card.appendChild(h('div', { class: 'card-header' }, [
      h('h3', {}, 'Your spending — last 28 days'),
      h('span', { class: 'sub' }, 'Your share, INR only')
    ]));
    const data = [];
    const now = new Date();
    for (let i = 27; i >= 0; i--) {
      const d = new Date(now); d.setDate(d.getDate() - i); d.setHours(0,0,0,0);
      data.push({ date: new Date(d), value: 0 });
    }
    State.expenses.forEach((e) => {
      if (e.currency !== 'INR') return;
      const my = (e.splits.find((s) => s.userId === State.selfId) || {}).amount || 0;
      if (my <= 0) return;
      const dt = new Date(e.date); dt.setHours(0,0,0,0);
      data.forEach((d) => { if (d.date.getTime() === dt.getTime()) d.value += my; });
    });
    card.appendChild(h('div', { class: 'chart-wrap' }, areaChart(data, { height: 220, currency: 'INR' })));
    return card;
  }

  // ---- SVG charts ----
  function areaChart(data, opts = {}) {
    const W = 1080, H = opts.height || 220;
    const padL = 40, padR = 12, padT = 14, padB = 28;
    const max = Math.max(...data.map((d) => d.value), 1);
    const xStep = (W - padL - padR) / Math.max(1, data.length - 1);
    const yScale = (v) => padT + (1 - v / max) * (H - padT - padB);
    const pts = data.map((d, i) => [padL + i * xStep, yScale(d.value)]);
    const pathLine = 'M' + pts.map((p) => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' L');
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

    const svg = `<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
      <defs>
        <linearGradient id="accent-grad" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stop-color="#6B5BFF" stop-opacity="0.45"/>
          <stop offset="100%" stop-color="#6B5BFF" stop-opacity="0"/>
        </linearGradient>
      </defs>
      <g class="grid">${gridLines.join('')}</g>
      <path class="area-fill" d="${pathArea}"/>
      <path class="area-line" d="${pathLine}"/>
      ${pts.map((p, i) => `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="2.2" fill="#6B5BFF"/>`).join('')}
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
  // 28-day heatmap — GitHub-style. data: [{date:Date, value:number}]
  function heatmapChart(data, opts = {}) {
    const cell = opts.cell || 16;
    const gap = opts.gap || 4;
    const currency = opts.currency || 'INR';
    const max = Math.max(...data.map((d) => d.value), 1);
    const firstDow = (data[0].date.getDay() + 6) % 7; // Mon=0..Sun=6
    const totalSlots = firstDow + data.length;
    const cols = Math.ceil(totalSlots / 7);
    const padL = 28, padT = 16;
    const W = padL + cols * (cell + gap);
    const H = padT + 7 * (cell + gap);
    const dayLabels = ['M','','W','','F','',''];
    const rowLabels = dayLabels.map((l, i) =>
      l ? `<text x="${padL - 8}" y="${padT + i * (cell + gap) + cell - 3}" class="label" text-anchor="end" style="font-size:9px">${l}</text>` : ''
    );
    // Month tick at first cell of each new month
    const monthTicks = [];
    let seenMonth = -1;
    const cells = data.map((d, idx) => {
      const pos = idx + firstDow;
      const col = Math.floor(pos / 7);
      const row = pos % 7;
      const x = padL + col * (cell + gap);
      const y = padT + row * (cell + gap);
      const m = d.date.getMonth();
      if (row === 0 && m !== seenMonth) {
        seenMonth = m;
        monthTicks.push(`<text x="${x}" y="${padT - 4}" class="label" style="font-size:9px">${d.date.toLocaleString('en-US',{month:'short'})}</text>`);
      }
      const isToday = d.date.toDateString() === new Date().toDateString();
      const intensity = d.value > 0 ? 0.18 + (d.value / max) * 0.82 : 0;
      const fill = d.value > 0 ? `rgba(107,91,255,${intensity.toFixed(3)})` : 'var(--surface-2)';
      const stroke = isToday ? 'var(--accent-2)' : 'var(--line-soft)';
      const tip = `${d.date.toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'})}: ${fmtMoney(d.value, currency)}`;
      return `<rect x="${x}" y="${y}" width="${cell}" height="${cell}" rx="3" fill="${fill}" stroke="${stroke}" stroke-width="0.75"><title>${tip}</title></rect>`;
    });
    return el(`<svg class="chart heatmap-svg" viewBox="0 0 ${W} ${H}" style="max-height:${H}px">${rowLabels.join('')}${monthTicks.join('')}${cells.join('')}</svg>`);
  }

  // -------- GROUPS LIST --------
  function viewGroups() {
    const page = h('div', { class: 'page' });
    page.appendChild(h('header', { class: 'page-header' }, [
      h('div', { class: 'title-block' }, [
        h('h1', {}, 'Groups'),
        h('div', { class: 'sub' }, State.groups.length + ' groups · ' + State.expenses.length + ' total expenses')
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
      let groups = State.groups.slice();
      if (q) groups = groups.filter((g) => g.name.toLowerCase().includes(q));
      if (cat) groups = groups.filter((g) => g.category === cat);
      groups.sort((a, b) => (lastActivityDate(b.id) || '').localeCompare(lastActivityDate(a.id) || ''));
      if (groups.length === 0) {
        grid.appendChild(h('div', { class: 'empty', style: { gridColumn: '1 / -1' } }, [
          h('div', { class: 'empty-title' }, 'No groups match'),
          h('div', { class: 'empty-sub' }, 'Try changing filters or create a new group.')
        ]));
        return;
      }
      groups.forEach((g) => grid.appendChild(groupCard(g)));
    }
    renderGrid();
    setMain(page);
  }
  function groupCard(g) {
    const bal = computeGroupBalanceForSelf(g.id);
    const balCls = bal > 0.01 ? 'pos' : bal < -0.01 ? 'neg' : 'zero';
    const groupExps = State.expenses.filter((e) => e.groupId === g.id);
    const total = groupExps.reduce((s, e) => s + e.amount, 0);
    const maxExp = Math.max(1, ...State.groups.map((x) => State.expenses.filter((e) => e.groupId === x.id).length));
    const pct = Math.max(8, Math.round((groupExps.length / maxExp) * 100));
    return h('div', { class: 'group-card', onClick: () => navigate('#/groups/' + g.id) }, [
      h('div', { class: 'gc-head' }, [
        h('div', { class: 'gc-emoji', data: { cat: g.category } }, g.emoji || g.name.slice(0, 2).toUpperCase()),
        h('div', { style: { minWidth: 0 } }, [
          h('div', { class: 'gc-name' }, g.name),
          h('div', { class: 'gc-meta' }, [
            h('span', { class: 'cur-pill' }, g.currency),
            ' · ' + g.members.length + ' members · ' + groupExps.length + ' expenses'
          ])
        ])
      ]),
      avatarStack(g.members, 5),
      h('div', { class: 'gc-foot' }, [
        h('div', {}, [
          h('div', { class: 'small muted' }, 'Total spend'),
          h('div', { class: 'tabular' }, fmtMoney(total, g.currency))
        ]),
        h('div', { class: 'right' }, [
          h('div', { class: 'small muted' }, bal > 0 ? 'You are owed' : bal < 0 ? 'You owe' : 'Settled'),
          h('div', { class: 'gc-bal ' + balCls }, bal === 0 ? '—' : fmtMoney(Math.abs(bal), g.currency))
        ])
      ]),
      h('div', { class: 'gc-bar' }, h('div', { class: 'gc-fill ' + balCls, style: { width: pct + '%' } }))
    ]);
  }

  // -------- GROUP DETAIL --------
  function viewGroupDetail(groupId) {
    const g = groupById(groupId);
    if (!g) { setMain(notFound('Group not found.')); return; }
    const tab = State.route.query.tab || State.activeTab.group || 'expenses';
    State.activeTab.group = tab;

    const page = h('div', { class: 'page' });
    const head = h('header', { class: 'page-header' }, [
      h('div', { class: 'title-block', style: { flex: 1, minWidth: 0 } }, [
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 'var(--s-3)' } }, [
          h('div', { class: 'gc-emoji', data: { cat: g.category }, style: { width: '36px', height: '36px', borderRadius: '10px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, color: '#fff', background: groupColor(g) } }, g.emoji || g.name.slice(0, 2).toUpperCase()),
          h('input', {
            class: 'inline-edit', value: g.name,
            onChange: async (e) => {
              g.name = e.target.value.trim() || g.name;
              await OrbitDB.put('groups', g);
              renderSidebarGroups(); renderCrumbs(); toast('Renamed');
            }
          })
        ]),
        h('div', { class: 'sub', style: { marginTop: '6px' } }, [
          h('span', { class: 'cur-pill' }, g.currency),
          ' · ' + g.members.length + ' members · created ' + fmtDateShort(g.createdAt)
        ])
      ]),
      h('div', { class: 'actions' }, [
        h('button', { class: 'btn btn-ghost btn-sm', onClick: () => inviteToGroup(g) }, 'Invite'),
        h('button', { class: 'btn btn-ghost btn-sm', onClick: () => openConfirmModal({
          title: 'Archive group?', bodyHtml: 'You can restore later. Existing expenses stay.', confirmText: 'Archive', onConfirm: async () => { toast('Archived (demo)'); } }) }, 'Archive'),
        h('button', { class: 'btn btn-primary btn-sm', onClick: () => openExpenseModal({ groupId: g.id }) }, '+ Add expense')
      ])
    ]);
    page.appendChild(head);

    // Members chips row
    const chipRow = h('div', { class: 'member-chip-row' });
    g.members.forEach((mid) => {
      const u = State.users.find((x) => x.id === mid);
      if (!u) return;
      chipRow.appendChild(h('span', { class: 'member-chip' }, [
        avatar(mid, 'sm'),
        u.name,
        mid !== State.selfId && g.members.length > 2 ? h('span', { class: 'x', title: 'Remove', onClick: async (e) => { e.stopPropagation(); g.members = g.members.filter((x) => x !== mid); await OrbitDB.put('groups', g); render(); toast('Removed ' + u.name); } }, '×') : null
      ]));
    });
    chipRow.appendChild(h('button', { class: 'member-chip', onClick: () => openAddMemberModal(g) }, '+ Add'));
    page.appendChild(chipRow);

    // Stats strip
    const stats = h('div', { class: 'stat-strip' });
    const groupExps = State.expenses.filter((e) => e.groupId === g.id);
    const total = groupExps.reduce((s, e) => s + e.amount, 0);
    const myShare = groupExps.reduce((s, e) => s + (((e.splits || []).find((sp) => sp.userId === State.selfId) || {}).amount || 0), 0);
    const myBal = computeGroupBalanceForSelf(g.id);
    stats.appendChild(h('div', {}, [h('div', { class: 'stat-label' }, 'Total spend'), h('div', { class: 'stat-value' }, fmtMoney(total, g.currency))]));
    stats.appendChild(h('div', {}, [h('div', { class: 'stat-label' }, 'Your share'), h('div', { class: 'stat-value' }, fmtMoney(myShare, g.currency))]));
    stats.appendChild(h('div', {}, [h('div', { class: 'stat-label' }, 'Your balance'), h('div', { class: 'stat-value ' + (myBal > 0 ? 'pos' : myBal < 0 ? 'neg' : '') }, myBal === 0 ? '—' : fmtMoney(myBal, g.currency))]));
    stats.appendChild(h('div', {}, [h('div', { class: 'stat-label' }, 'Expenses'), h('div', { class: 'stat-value' }, String(groupExps.length))]));
    page.appendChild(stats);

    // Tabs
    const tabs = h('div', { class: 'tabs' });
    ['expenses','balances','settle','settings'].forEach((t) => {
      tabs.appendChild(h('div', { class: 'tab' + (t === tab ? ' active' : ''), onClick: () => { State.activeTab.group = t; navigate('#/groups/' + g.id + '?tab=' + t); } },
        t.charAt(0).toUpperCase() + t.slice(1) + (t === 'expenses' ? ' ' : '')));
    });
    page.appendChild(tabs);

    if (tab === 'expenses') page.appendChild(tabExpenses(g));
    else if (tab === 'balances') page.appendChild(tabBalances(g));
    else if (tab === 'settle') page.appendChild(tabSettleGroup(g));
    else page.appendChild(tabSettings(g));

    setMain(page);
  }
  function tabExpenses(g) {
    const wrap = h('div');
    const sortState = State.sort.groupExpenses;
    const rows = sortRows(State.expenses.filter((e) => e.groupId === g.id), sortState, {
      date: (e) => e.date, title: (e) => e.title, category: (e) => e.category,
      amount: (e) => e.amount, paidBy: (e) => userNameFull(e.paidBy),
      myShare: (e) => (e.splits.find((s) => s.userId === State.selfId) || {}).amount || 0
    });
    const card = h('div', { class: 'card' });
    const tblw = h('div', { class: 'tbl-wrap' });
    const tbl = h('table', { class: 'tbl' });
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
        tr.appendChild(h('td', { class: 'col-date' }, fmtDateShort(e.date)));
        tr.appendChild(h('td', {}, h('div', { class: 'desc-cell' }, [
          h('span', { class: 'dot', style: { background: categoryColor(e.category) } }),
          h('div', {}, [
            h('div', { class: 'title' }, e.title),
            e.note ? h('div', { class: 'note' }, e.note) : null
          ])
        ])));
        tr.appendChild(h('td', {}, h('span', { class: 'cat cat-' + e.category }, categoryLabel(e.category))));
        tr.appendChild(h('td', {}, h('span', { class: 'who' }, [avatar(e.paidBy, 'sm'), userName(e.paidBy)])));
        tr.appendChild(h('td', { class: 'col-amt' }, fmtMoney(e.amount, e.currency)));
        tr.appendChild(h('td', { class: 'col-amt ' + (e.paidBy === State.selfId ? 'pos' : 'neg') }, fmtMoney(myShare, e.currency)));
        tr.appendChild(h('td', { class: 'col-actions' }, [
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
    const tbl = h('table', { class: 'matrix' });
    const thead = h('thead'); const tr = h('tr'); tr.appendChild(h('th', {}, 'Member')); tr.appendChild(h('th', {}, 'Paid')); tr.appendChild(h('th', {}, 'Share')); tr.appendChild(h('th', {}, 'Net'));
    thead.appendChild(tr); tbl.appendChild(thead);
    const tbody = h('tbody');
    const exps = State.expenses.filter((e) => e.groupId === g.id);
    mat.members.forEach((m) => {
      let paid = 0, share = 0;
      exps.forEach((e) => { if (e.paidBy === m) paid += e.amount; const sp = e.splits.find((s) => s.userId === m); if (sp) share += sp.amount; });
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
  async function sendReminder(otherUserId, amount, currency) {
    const otherU = State.users.find((u) => u.id === otherUserId);
    if (!otherU || otherU.isSelf) return;
    const cache = State.reminderCache || {};
    cache['reminder_' + otherUserId] = new Date().toISOString();
    State.reminderCache = cache;
    await OrbitDB.setMeta('reminders', cache);
    if (window.OrbitActivity) await OrbitActivity.log(OrbitDB, {
      actorId: State.selfId, action: 'settle', entityType: 'settlement',
      entityId: null, groupId: null,
      snapshot: null, prev: null,
      meta: { type: 'reminder', toUser: otherUserId, amount, currency, note: 'Reminder sent' }
    });
    toast('Reminded ' + (otherU.isSelf ? 'you' : otherU.name) + ' · ' + fmtMoney(amount, currency), 'pos');
    render();
  }

  async function recordSettlement(groupId, fromUser, toUser, amount, currency) {
    const s = { id: uid('s'), groupId, fromUser, toUser, amount, currency, method: 'manual', date: todayISO(), note: 'Marked settled' };
    await OrbitDB.put('settlements', s);
    State.settlements.push(s);
    if (window.OrbitActivity) OrbitActivity.log(OrbitDB, {
      actorId: State.selfId, action: 'settle', entityType: 'settlement',
      entityId: s.id, groupId: s.groupId, snapshot: s
    });
    toast('Settlement recorded', 'pos');
    render();
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
          toU ? h('button', { class: 'btn-wa', title: 'Message on WhatsApp', onClick: () => remindViaWhatsApp(toU, t.amount, t.from === State.selfId ? 'you-owe' : 'owes-you') }, waIcon()) : null,
          h('button', { class: 'btn-mark', onClick: () => recordSettlement(g.id, t.from, t.to, t.amount, t.currency) }, 'Mark paid')
        ])
      ]));
    });
    card.appendChild(body);
    return card;
  }
  function tabSettings(g) {
    const card = h('div', { class: 'card' });
    card.appendChild(h('div', { class: 'card-header' }, h('h3', {}, 'Group settings')));
    const body = h('div', { class: 'card-body' });
    body.appendChild(formRow('Name', h('input', { class: 'input', value: g.name, onChange: async (e) => { g.name = e.target.value.trim() || g.name; await OrbitDB.put('groups', g); toast('Saved'); renderSidebarGroups(); } })));
    body.appendChild(formRow('Type', selectInput([
      { v: 'trip', l: 'Trip' }, { v: 'household', l: 'Household' }, { v: 'friends', l: 'Friends' }, { v: 'work', l: 'Work' }
    ], g.category, async (v) => { g.category = v; await OrbitDB.put('groups', g); toast('Saved'); })));
    body.appendChild(formRow('Currency', selectInput([
      { v: 'INR', l: '₹ INR' }, { v: 'EUR', l: '€ EUR' }, { v: 'USD', l: '$ USD' }, { v: 'GBP', l: '£ GBP' }
    ], g.currency, async (v) => { g.currency = v; await OrbitDB.put('groups', g); toast('Saved'); })));
    body.appendChild(h('hr'));
    body.appendChild(h('div', { class: 'btn-row' }, [
      h('button', { class: 'btn btn-danger btn-sm', onClick: () => deleteGroup(g) }, 'Delete group')
    ]));
    card.appendChild(body);
    return card;
  }
  function formRow(label, control) {
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
  async function deleteGroup(g) {
    openConfirmModal({
      title: 'Delete group?',
      bodyHtml: `<strong>${escapeHtml(g.name)}</strong> and all its expenses will be permanently removed. This cannot be undone.`,
      confirmText: 'Delete forever',
      danger: true,
      onConfirm: async () => {
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

    // Filter toolbar
    const f = State.filters.expenses;
    const toolbar = h('div', { class: 'card', style: { marginBottom: 'var(--s-3)' } });
    const tb = h('div', { class: 'toolbar', style: { borderBottom: 0 } });
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
    tb.appendChild(h('input', { type: 'date', class: 'filter-input', value: f.from, onChange: (e) => { f.from = e.target.value; rerender(); } }));
    tb.appendChild(h('input', { type: 'date', class: 'filter-input', value: f.to, onChange: (e) => { f.to = e.target.value; rerender(); } }));
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
        amount: (e) => e.amount, paidBy: (e) => userNameFull(e.paidBy),
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

      const tbl = h('table', { class: 'tbl' });
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
        tbody.appendChild(h('tr', {}, h('td', { colspan: 9, class: 'tbl-empty' }, 'No expenses match your filters.')));
      }
      rows.forEach((e) => {
        const g = groupById(e.groupId);
        const myShare = (e.splits.find((s) => s.userId === State.selfId) || {}).amount || 0;
        const checked = State.selected.expenses.has(e.id);
        const tr2 = h('tr', { class: 'clickable' + (checked ? ' selected' : ''), onClick: (ev) => { if (ev.target.type !== 'checkbox') openExpenseModal({ existing: e }); } });
        tr2.appendChild(h('td', {}, h('input', { type: 'checkbox', checked, onClick: (ev) => ev.stopPropagation(), onChange: (ev) => { if (ev.target.checked) State.selected.expenses.add(e.id); else State.selected.expenses.delete(e.id); rerender(); } })));
        tr2.appendChild(h('td', { class: 'col-date' }, fmtDateShort(e.date)));
        tr2.appendChild(h('td', {}, g?.name || '—'));
        tr2.appendChild(h('td', {}, h('div', { class: 'desc-cell' }, [
          h('span', { class: 'dot', style: { background: categoryColor(e.category) } }),
          h('div', {}, [h('div', { class: 'title' }, e.title), e.note ? h('div', { class: 'note' }, e.note) : null])
        ])));
        tr2.appendChild(h('td', {}, h('span', { class: 'cat cat-' + e.category }, categoryLabel(e.category))));
        tr2.appendChild(h('td', {}, h('span', { class: 'who' }, [avatar(e.paidBy, 'sm'), userName(e.paidBy)])));
        tr2.appendChild(h('td', { class: 'col-amt' }, fmtMoney(e.amount, e.currency)));
        tr2.appendChild(h('td', { class: 'col-amt ' + (e.paidBy === State.selfId ? 'pos' : 'neg') }, fmtMoney(myShare, e.currency)));
        tr2.appendChild(h('td', { class: 'col-actions' }, [
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
        for (const e of removing) await syncDeleteExpenseIfShared(e);   // Phase D: mirror deletes
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
        // Log BEFORE delete so the snapshot is preserved for restore
        if (window.OrbitActivity) await OrbitActivity.log(OrbitDB, {
          actorId: State.selfId, action: 'delete', entityType: 'expense',
          entityId: e.id, groupId: e.groupId, snapshot: null, prev: e
        });
        await OrbitDB.delete('expenses', e.id);
        await syncDeleteExpenseIfShared(e);   // Phase D: mirror delete to Firestore
        State.expenses = State.expenses.filter((x) => x.id !== e.id);
        toast('Expense deleted', 'pos');
        render();
      }
    });
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
        '"' + (g?.name || '').replace(/"/g, '""') + '"',
        '"' + e.title.replace(/"/g, '""') + '"',
        categoryLabel(e.category),
        e.currency,
        e.amount.toFixed(2),
        '"' + userNameFull(e.paidBy).replace(/"/g, '""') + '"',
        myShare.toFixed(2),
        '"' + (e.note || '').replace(/"/g, '""') + '"'
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
    exps.forEach((e) => { paidByMap[e.paidBy] = (paidByMap[e.paidBy] || 0) + e.amount; });
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
            h('span', { class: 'trip-meta' }, g.members.length + ' members')
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
    kpis.appendChild(kpiCard('Avg per day', avg, cur, daysIn + ' days', '', { tilt: true }));
    kpis.appendChild(kpiCard('Top category', topCat ? categoryLabel(topCat[0]) : '—', '', topCat ? fmtMoney(topCat[1], cur) : 'No spend', '', { tilt: true }));
    page.appendChild(kpis);
    const kpis2 = h('div', { class: 'kpi-grid kpi-grid-3' });
    kpis2.appendChild(kpiCard('vs last month', Math.abs(delta).toFixed(1) + '%', '', delta > 0 ? 'higher than April' : delta < 0 ? 'lower than April' : 'flat', delta > 0 ? 'neg' : delta < 0 ? 'pos' : '', { tilt: true }));
    kpis2.appendChild(kpiCard('Expenses logged', State.expenses.filter(inCur).length, '', 'In ' + cur, '', { tilt: true }));
    kpis2.appendChild(kpiCard('Categories', Object.keys(catTotals).length, '', 'Distinct spend types', '', { tilt: true }));
    page.appendChild(kpis2);

    // ---- 28-day heatmap (all available data in cur) ----
    const heatCard = h('div', { class: 'card', style: { marginBottom: 'var(--s-5)' } });
    heatCard.appendChild(h('div', { class: 'card-header' }, [
      h('h3', {}, 'Last 28 days'),
      h('span', { class: 'sub' }, 'Your share · ' + cur)
    ]));
    const heatData = [];
    const now = new Date(); now.setHours(0, 0, 0, 0);
    for (let i = 27; i >= 0; i--) {
      const d = new Date(now); d.setDate(d.getDate() - i);
      heatData.push({ date: d, value: 0 });
    }
    State.expenses.forEach((e) => {
      if (!inCur(e)) return;
      const my = myShareIn(e); if (my <= 0) return;
      const dt = new Date(e.date); dt.setHours(0, 0, 0, 0);
      const t = dt.getTime();
      heatData.forEach((d) => { if (d.date.getTime() === t) d.value += my; });
    });
    const heatBody = h('div', { class: 'card-body', style: { display: 'flex', flexDirection: 'column', gap: 'var(--s-3)' } });
    heatBody.appendChild(heatmapChart(heatData, { currency: cur, cell: 18, gap: 5 }));
    const heatMax = Math.max(...heatData.map((d) => d.value), 1);
    const heatTotal = heatData.reduce((s, d) => s + d.value, 0);
    const activeDays = heatData.filter((d) => d.value > 0).length;
    heatBody.appendChild(h('div', { class: 'heat-foot' }, [
      h('span', { class: 'small muted' }, activeDays + ' active days · ' + fmtMoney(Math.round(heatTotal), cur) + ' total'),
      h('span', { class: 'heat-scale' }, [
        h('span', { class: 'small muted' }, 'Less'),
        h('span', { class: 'heat-swatch', style: { background: 'rgba(107,91,255,0.18)' } }),
        h('span', { class: 'heat-swatch', style: { background: 'rgba(107,91,255,0.40)' } }),
        h('span', { class: 'heat-swatch', style: { background: 'rgba(107,91,255,0.65)' } }),
        h('span', { class: 'heat-swatch', style: { background: 'rgba(107,91,255,0.95)' } }),
        h('span', { class: 'small muted' }, 'More')
      ])
    ]));
    heatCard.appendChild(heatBody);
    page.appendChild(heatCard);

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
      if (e.paidBy === State.selfId) {
        paidOut += e.amount;
        owedToYou += (e.amount - my);
      } else if (my > 0) {
        owedByYou += my;
      }
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
        h('div', {}, [h('div', { class: 'who-name' }, g?.name || ''), h('div', { class: 'who-sub' }, g?.members.length + ' members')]),
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
            background: 'rgba(107,91,255,0.12)', color: 'var(--accent)',
            fontSize: '10px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em'
          }
        }, [
          '↻ ' + (e.recurring.parentId ? 'auto' : (window.OrbitRecurring ? OrbitRecurring.freqLabel(e.recurring.freq) : 'repeat'))
        ]) : null;
        feed.appendChild(h('div', { class: 'feed-row clickable', onClick: () => openExpenseModal({ existing: e }) }, [
          h('div', { class: 'feed-icon' }, '₹'),
          h('div', {}, [
            h('div', { class: 'title' }, [e.title, recurBadge]),
            h('div', { class: 'meta' }, [userNameFull(e.paidBy) + ' paid · ', g?.name || '—', ' · ', fmtDateTime(e.date)])
          ]),
          h('div', { style: { textAlign: 'right' } }, [
            h('div', { class: 'amt' }, fmtMoney(e.amount, e.currency)),
            h('div', { class: 'small ' + (e.paidBy === State.selfId ? 'muted' : '') }, e.paidBy === State.selfId ? '+' + fmtMoney(e.amount - myShare, e.currency) : '−' + fmtMoney(myShare, e.currency))
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
    const list = State.activity.slice().sort((a, b) => b.ts.localeCompare(a.ts));
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
    const actor = State.users.find((u) => u.id === entry.actorId);
    const actorName = actor ? (actor.isSelf ? 'You' : actor.name) : 'Someone';
    const g = entry.groupId ? groupById(entry.groupId) : null;
    const snap = entry.snapshot || entry.prev || {};
    const title = snap.title || (entry.action === 'import' ? 'Splitwise import' : (snap.note || entry.entityType));
    const amount = snap.amount;
    const currency = snap.currency || 'INR';
    const isDelete = entry.action === 'delete';

    return h('div', { class: 'feed-row clickable', onClick: () => openActivityDetail(entry) }, [
      h('div', { class: 'feed-icon', style: {
        background: isDelete ? 'rgba(251,113,133,0.10)' : 'var(--surface-3)',
        color: isDelete ? 'var(--neg)' : 'var(--text-2)'
      } }, window.OrbitActivity ? OrbitActivity.actionIcon(entry.action) : '·'),
      h('div', {}, [
        h('div', { class: 'title' }, [
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
      actorId: State.selfId, action: 'restore', entityType: 'expense',
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
      net[e.paidBy] = (net[e.paidBy] || 0) + e.amount;
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
        h('span', { class: 'sub' }, involve.length + ' transactions')
      ]));
      const body = h('div', { class: 'panel-stack' });
      involve.forEach((t) => {
        const isOwed = t.to === State.selfId;
        const other = isOwed ? t.from : t.to;
        const otherU = State.users.find((x) => x.id === other);
        const reminderKey = 'reminder_' + other;
        const lastRem = State.reminderCache ? State.reminderCache[reminderKey] : null;
        const remRecent = lastRem && (Date.now() - new Date(lastRem).getTime() < 24 * 3600 * 1000);
        body.appendChild(h('div', { class: 'owes-row' }, [
          avatar(other, 'md'),
          h('div', {}, [
            h('div', { class: 'who-name' }, isOwed ? otherU?.name + ' owes you' : 'You owe ' + otherU?.name),
            h('div', { class: 'who-sub' }, [
              otherU?.upi || otherU?.email || '',
              remRecent ? h('span', { style: { marginLeft: '8px', color: 'var(--accent)', fontSize: '11px' } }, '· reminded ' + fmtDateRel(lastRem)) : null
            ])
          ]),
          h('div', { class: 'amt ' + (isOwed ? 'pos' : 'neg') }, fmtMoney(t.amount, cur)),
          h('div', { class: 'actions' }, [
            isOwed ? h('button', {
              class: 'btn-mark', disabled: remRecent,
              title: remRecent ? 'Reminder sent recently — give them a beat' : 'Send a nudge',
              onClick: () => sendReminder(other, t.amount, cur)
            }, remRecent ? 'Reminded' : 'Remind') : null,
            !isOwed && otherU?.upi ? h('button', { class: 'btn-pay', onClick: () => payViaUPI(otherU, t.amount) }, 'Pay via UPI') : null,
            otherU ? h('button', { class: 'btn-wa', title: 'Message on WhatsApp', onClick: () => remindViaWhatsApp(otherU, t.amount, isOwed ? 'owes-you' : 'you-owe') }, waIcon()) : null,
            h('button', { class: 'btn-mark', onClick: () => recordSettlement(t.groupId || '', t.from, t.to, t.amount, cur) }, 'Mark paid')
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

  // -------- PROFILE --------
  function viewProfile() {
    const page = h('div', { class: 'page' });
    page.appendChild(h('header', { class: 'page-header' }, [
      h('div', { class: 'title-block' }, [h('h1', {}, 'Profile & settings'), h('div', { class: 'sub' }, 'Account, preferences, data')]),
      h('div', { class: 'actions' }, [
        h('button', { class: 'btn btn-ghost btn-sm', onClick: exportAllJson }, 'Export JSON'),
        h('button', { class: 'btn btn-danger btn-sm', onClick: confirmDeleteAll }, 'Delete account')
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

    const grid = h('div', { class: 'grid-2' });
    // Account card
    const cAcc = h('div', { class: 'card' });
    cAcc.appendChild(h('div', { class: 'card-header' }, h('h3', {}, 'Account')));
    const cAccBody = h('div', { class: 'card-body' });
    cAccBody.appendChild(h('div', { style: { display: 'flex', alignItems: 'center', gap: 'var(--s-4)', marginBottom: 'var(--s-4)' } }, [
      avatar(me.id, 'lg'),
      h('div', {}, [
        h('div', { style: { fontSize: '15px', fontWeight: 600 } }, me.name || 'You'),
        h('div', { class: 'small muted' }, me.email || '—')
      ])
    ]));
    cAccBody.appendChild(formRow('Display name', h('input', { class: 'input', value: me.name || '', onChange: async (e) => { me.name = e.target.value.trim(); await OrbitDB.put('users', me); renderMeCard(); toast('Saved'); } })));
    cAccBody.appendChild(formRow('Email', h('input', { class: 'input', value: me.email || '', onChange: async (e) => { me.email = e.target.value.trim(); await OrbitDB.put('users', me); toast('Saved'); } })));
    cAccBody.appendChild(formRow('Phone', h('input', { class: 'input', value: me.phone || '', onChange: async (e) => { me.phone = e.target.value.trim(); await OrbitDB.put('users', me); toast('Saved'); } })));
    cAcc.appendChild(cAccBody);
    grid.appendChild(cAcc);

    // UPI / preferences
    const cPref = h('div', { class: 'card' });
    cPref.appendChild(h('div', { class: 'card-header' }, h('h3', {}, 'UPI & preferences')));
    const cPrefBody = h('div', { class: 'card-body' });
    cPrefBody.appendChild(formRow('Primary UPI VPA', h('input', { class: 'input mono', value: me.upi || '', placeholder: 'you@bank', onChange: async (e) => { me.upi = e.target.value.trim(); await OrbitDB.put('users', me); renderMeCard(); toast('UPI VPA saved'); } })));
    cPrefBody.appendChild(formRow('Default currency', selectInput([
      { v: 'INR', l: '₹ INR' }, { v: 'EUR', l: '€ EUR' }, { v: 'USD', l: '$ USD' }, { v: 'GBP', l: '£ GBP' }
    ], 'INR', () => toast('Saved'))));
    // Cream-light is the only theme — toggle removed.
    cPref.appendChild(cPrefBody);
    grid.appendChild(cPref);
    page.appendChild(grid);

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
        paidBy: u(e.paidBy)?.name || 'Unknown',
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
    const pair = computePairBalances(State.selfId);
    const balances = Object.entries(pair).map(([uid, amt]) => ({
      otherName: u(uid)?.name || 'Unknown',
      amount: amt,
      currency: 'INR'
    }));
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
        actorId: State.selfId, action: 'import', entityType: 'group',
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
      title: 'Wipe all data?', bodyHtml: 'This permanently deletes every group, expense, and settlement from this device <strong>and the cloud</strong>. There is no undo.', confirmText: 'Wipe everything', danger: true,
      onConfirm: async () => {
        await OrbitDB.clearAll();
        await OrbitDB.setMeta('seeded', false);
        // Also clear the cloud copy, else enterApp re-pulls it on next load.
        try { if (window.OrbitCloud && OrbitCloud.user()) { for (const s of ['users','groups','expenses','settlements','activity','meta']) await OrbitCloud.clearStore(s); } } catch (_) {}
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
        try { if (window.OrbitCloud && OrbitCloud.user()) { for (const s of ['users','groups','expenses','settlements','activity','meta']) await OrbitCloud.clearStore(s); } } catch (_) {}
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
    OrbitDB.setMeta('theme', t);
    render();
  }

  // ===================================================================
  // MODALS
  // ===================================================================
  function closeModal() {
    const root = $('#modalRoot');
    root.innerHTML = '';
    document.body.style.overflow = '';
  }
  function openModal(content) {
    const root = $('#modalRoot');
    root.innerHTML = '';
    const backdrop = h('div', { class: 'modal-backdrop', onClick: (e) => { if (e.target === backdrop) closeModal(); } });
    backdrop.appendChild(content);
    root.appendChild(backdrop);
    document.body.style.overflow = 'hidden';
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

  // ---- New group modal ----
  function openNewGroup() {
    const data = { name: '', category: 'friends', currency: 'INR', members: [State.selfId], newMember: '', shared: false };
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

    // Add new member: pick from existing OR by name
    const addRow = h('div', { style: { display: 'flex', gap: '8px', marginTop: '8px' } });
    const select = h('select', { class: 'select' });
    select.appendChild(h('option', { value: '' }, 'Add an existing person…'));
    State.users.filter((u) => !data.members.includes(u.id)).forEach((u) => select.appendChild(h('option', { value: u.id }, u.name)));
    select.addEventListener('change', (e) => { if (e.target.value) { data.members.push(e.target.value); renderMems(); e.target.value=''; } });
    addRow.appendChild(select);
    const nameInp = h('input', { class: 'input', placeholder: 'or type a new name', style: { flex: '0 0 220px' } });
    addRow.appendChild(nameInp);
    addRow.appendChild(h('button', { class: 'btn btn-sm', onClick: async () => {
      const nm = nameInp.value.trim();
      if (!nm) return;
      const u = { id: uid('u'), name: nm, isSelf: false, avatar: 'av-c' + ((State.users.length % 8) + 1), email: '', upi: '' };
      await OrbitDB.put('users', u);
      State.users.push(u);
      data.members.push(u.id);
      nameInp.value = '';
      renderMems();
    } }, 'Add'));
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
    body.appendChild(h('button', { class: 'btn btn-primary', style: { width: '100%', marginTop: '14px', justifyContent: 'center' }, onClick: () => { closeModal(); openNewGroup(); } }, '+ New group'));
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
    const others = State.users.filter((u) => !group.members.includes(u.id));
    if (others.length) {
      const sel = h('select', { class: 'select' });
      sel.appendChild(h('option', { value: '' }, 'Choose existing person…'));
      others.forEach((u) => sel.appendChild(h('option', { value: u.id }, u.name)));
      sel.addEventListener('change', (e) => { data.picked = e.target.value; });
      body.appendChild(formRow('From contacts', sel));
    }
    body.appendChild(formRow('Or new person', h('input', { class: 'input', placeholder: 'Name', onInput: (e) => { data.newName = e.target.value; } })));
    // Email / phone make this person claimable when they sign in (so the
    // expenses you tag them in become really theirs). Optional but recommended.
    body.appendChild(formRow('Email (optional)', h('input', { class: 'input', type: 'email', placeholder: 'name@email.com', onInput: (e) => { data.newEmail = e.target.value; } })));
    body.appendChild(formRow('Phone (optional)', h('input', { class: 'input', type: 'tel', placeholder: '+91 98765 43210', onInput: (e) => { data.newPhone = e.target.value; } })));
    body.appendChild(h('div', { class: 'small muted', style: { marginTop: '-4px' } }, 'Adding an email or phone lets them claim their share when they join Orbit.'));
    modal.appendChild(body);
    modal.appendChild(h('div', { class: 'modal-foot' }, [
      h('button', { class: 'btn btn-ghost btn-sm', onClick: closeModal }, 'Cancel'),
      h('button', { class: 'btn btn-primary btn-sm', onClick: async () => {
        let userId = data.picked;
        if (!userId && data.newName.trim()) {
          const u = {
            id: uid('u'), name: data.newName.trim(), isSelf: false,
            avatar: 'av-c' + ((State.users.length % 8) + 1),
            email: normEmail(data.newEmail), phone: normPhone(data.newPhone), upi: ''
          };
          await OrbitDB.put('users', u);
          State.users.push(u);
          userId = u.id;
        }
        if (!userId) { toast('Pick or name a member', 'neg'); return; }
        group.members.push(userId);
        await OrbitDB.put('groups', group);
        // Shared group + the member has an email/phone → register a claimable
        // ghost so they auto-link when they sign in (Phase 2 auto-claim).
        const sid = sharedIdOf(group);
        if (sid && canShare()) {
          const m = State.users.find((x) => x.id === userId);
          if (m && (m.email || m.phone)) {
            try { await OrbitGroups.addGhostToGroup(sid, { ghostId: userId, name: m.name, email: m.email, phone: m.phone }); }
            catch (e) { console.warn('[Phase 2] addGhostToGroup failed', e); }
          }
        }
        closeModal();
        toast('Added');
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

    async function ensureKey() {
      const existing = await OrbitAI.getKey();
      if (existing) return existing;
      return await openGeminiKeyModal();
    }

    async function runParse() {
      const text = inp.value.trim();
      if (!text) { status.textContent = 'Describe an expense first.'; return; }
      const key = await ensureKey();
      if (!key) { status.textContent = 'API key required to parse.'; return; }
      parseBtn.disabled = true;
      status.innerHTML = '<span style="color: var(--accent)">✦</span> Parsing…';
      try {
        const ctx = {
          apiKey: key,
          contacts: State.users.map((u) => ({ name: u.name, isSelf: u.isSelf })),
          groups: State.groups.map((g) => ({ name: g.name, currency: g.currency, memberCount: g.members.length })),
          categories: ['food','travel','bills','shop','fun','rent','transport','other']
        };
        const r = await OrbitAI.parseExpense(text, ctx);
        if (!r.ok) {
          if (r.error === 'needs-key') status.textContent = 'No API key set.';
          else if (r.error === 'parse') status.textContent = 'AI returned unparseable JSON. Try rephrasing.';
          else if (r.error?.startsWith('http-')) status.textContent = 'API error: ' + r.error + '. Check your key.';
          else status.textContent = 'Failed: ' + r.error;
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
    const initial = existing || prefill || {
      id: '',
      groupId: groupId || State.groups[0]?.id || '',
      title: '',
      amount: 0,
      currency: 'INR',
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
    let selectedMembers = data.splits.length ? data.splits.map((s) => s.userId) : (groupById(data.groupId)?.members || []).slice();

    function currentGroup() { return groupById(data.groupId); }
    if (currentGroup()) data.currency = currentGroup().currency;

    const modal = h('div', { class: 'modal modal-lg' });
    modal.appendChild(h('div', { class: 'modal-head' }, [
      h('h2', {}, existing ? 'Edit expense' : 'Add expense'),
      h('button', { class: 'close', onClick: closeModal }, '×')
    ]));

    const body = h('div', { class: 'modal-body' });

    // Receipt scan banner
    const ocrInput = h('input', { type: 'file', accept: 'image/*', style: { display: 'none' } });
    ocrInput.addEventListener('change', (e) => { if (e.target.files[0]) runOcrFlow(e.target.files[0]); });
    const ocrStatus = h('div', { class: 'small muted', style: { marginTop: '4px', minHeight: '14px' } }, '');
    const ocrBanner = h('div', {
      style: {
        display: 'flex', alignItems: 'center', gap: '12px',
        padding: '10px 14px', marginBottom: '12px',
        background: 'rgba(107,91,255,0.06)', border: '1px solid rgba(107,91,255,0.18)',
        borderRadius: '10px'
      }
    }, [
      h('div', { style: { fontSize: '18px' } }, '📷'),
      h('div', { style: { flex: 1 } }, [
        h('div', { style: { fontSize: '13px', fontWeight: 600 } }, 'Scan a receipt'),
        h('div', { class: 'small muted' }, 'OCR detects line items + total. Then tap-assign per person.'),
        ocrStatus
      ]),
      h('button', { class: 'btn btn-sm', onClick: () => ocrInput.click() }, 'Choose image')
    ]);
    body.appendChild(ocrBanner);
    body.appendChild(ocrInput);

    async function runOcrFlow(file) {
      if (!window.OrbitOCR) { ocrStatus.textContent = 'OCR module not loaded'; return; }
      ocrStatus.textContent = 'Loading OCR engine…';
      try {
        const r = await OrbitOCR.recognize(file, {
          onProgress: (m) => { ocrStatus.textContent = (m.status || 'Working') + ' · ' + Math.round(m.progress * 100) + '%'; }
        });
        ocrStatus.textContent = r.lines.length + ' line item' + (r.lines.length !== 1 ? 's' : '') +
          (r.total != null ? ' · total ' + r.total : '');
        if (r.total != null && r.total > 0) {
          data.amount = r.total;
          amountInput.value = r.total;
        }
        if (r.currency) {
          data.currency = r.currency;
        }
        if (r.lines.length && !data.title) {
          // First non-tax item often = name; fallback to "Receipt"
          const firstReal = r.lines.find((x) => !x.isTaxOrFee);
          if (firstReal) {
            data.title = firstReal.label.slice(0, 60);
            titleInput.value = data.title;
          }
        }
        renderMemberList();
        // Show line items for tap-assign in note
        if (r.lines.length) {
          const lineSummary = r.lines.map((l) => '· ' + l.label + ' ' + l.amount).join('\n');
          noteInput.value = (noteInput.value ? noteInput.value + '\n\n' : '') +
            'Line items (from receipt):\n' + lineSummary;
          data.note = noteInput.value;
        }
      } catch (e) {
        ocrStatus.textContent = 'OCR failed: ' + e.message;
      }
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
    body.appendChild(h('div', { class: 'input-row-3' }, [
      h('div', {}, [formRow('Amount', amountInput), fxHint]),
      formRow('Currency', selectInput([
        { v: 'INR', l: '₹ INR' }, { v: 'EUR', l: '€ EUR' }, { v: 'USD', l: '$ USD' }, { v: 'GBP', l: '£ GBP' }
      ], data.currency, (v) => { data.currency = v; refreshFxHint(); })),
      formRow('Date', h('input', { type: 'date', class: 'input', value: data.date, onInput: (e) => { data.date = e.target.value; } }))
    ]));

    // Group / paid by / category
    const grpSel = h('select', { class: 'select', onChange: (e) => {
      data.groupId = e.target.value;
      const g = currentGroup();
      if (g) { data.currency = g.currency; selectedMembers = g.members.slice(); renderMemberList(); }
      refreshFxHint();
    } });
    State.groups.forEach((g) => { const op = h('option', { value: g.id }, g.name); if (g.id === data.groupId) op.selected = true; grpSel.appendChild(op); });
    const paidSel = h('select', { class: 'select', onChange: (e) => { data.paidBy = e.target.value; } });
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
    }
    refreshPaidBy();
    grpSel.addEventListener('change', refreshPaidBy);

    const catSel = h('select', { class: 'select', onChange: (e) => { data.category = e.target.value; } });
    CATEGORIES.forEach((c) => { const op = h('option', { value: c.id }, c.label); if (c.id === data.category) op.selected = true; catSel.appendChild(op); });

    body.appendChild(h('div', { class: 'input-row-3' }, [
      formRow('Group', grpSel),
      formRow('Paid by', paidSel),
      formRow('Category', catSel)
    ]));

    // Split mode tabs
    const splitSeg = h('div', { class: 'seg' }, [
      ...['equal','exact','percent','shares'].map((m) => h('button', { class: data.splitMode === m ? 'active' : '', onClick: (ev) => { data.splitMode = m; $$('.seg button', splitSeg).forEach((b) => b.classList.remove('active')); ev.currentTarget.classList.add('active'); renderMemberList(); } }, m.charAt(0).toUpperCase() + m.slice(1)))
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

    // Helpers
    function memberRow(mid) {
      const u = State.users.find((x) => x.id === mid);
      if (!u) return null;
      const isChecked = selectedMembers.includes(mid);
      const split = data.splits.find((s) => s.userId === mid);
      const row = h('div', { class: 'member-row' + (isChecked ? ' checked' : '') });
      row.appendChild(h('span', { class: 'cb', onClick: () => {
        if (isChecked) selectedMembers = selectedMembers.filter((x) => x !== mid);
        else selectedMembers.push(mid);
        renderMemberList();
      } }, isChecked ? '✓' : ''));
      row.appendChild(avatar(mid, 'sm'));
      row.appendChild(h('span', { class: 'name' }, u.name + (u.isSelf ? ' (you)' : '')));
      if (data.splitMode === 'equal') {
        const per = isChecked && selectedMembers.length > 0 ? data.amount / selectedMembers.length : 0;
        row.appendChild(h('span', { class: 'small muted tabular', style: { width: '110px', textAlign: 'right' } }, isChecked ? fmtMoney(per, data.currency) : '—'));
      } else {
        const inp = h('input', { class: 'input', type: 'number', step: '0.01', value: split?.amount ?? 0, disabled: !isChecked });
        inp.addEventListener('input', (e) => {
          const v = parseFloat(e.target.value) || 0;
          const existing2 = data.splits.find((s) => s.userId === mid);
          if (existing2) existing2.amount = v;
          else data.splits.push({ userId: mid, amount: v });
          updateSplitHint();
        });
        row.appendChild(h('div', { class: 'share-input' }, inp));
      }
      return row;
    }
    function updateSplitHint() {
      const hint = $('#splitSumHint', body);
      if (!hint) return;
      if (data.splitMode === 'equal') { hint.textContent = selectedMembers.length + ' way split'; return; }
      const sum = data.splits.filter((s) => selectedMembers.includes(s.userId)).reduce((x, s) => x + s.amount, 0);
      if (data.splitMode === 'exact') hint.textContent = 'Sum: ' + fmtMoney(sum, data.currency) + ' / ' + fmtMoney(data.amount, data.currency);
      else if (data.splitMode === 'percent') hint.textContent = sum.toFixed(0) + '%';
      else hint.textContent = 'Shares: ' + sum;
    }
    function renderMemberList() {
      memList.innerHTML = '';
      const g = currentGroup();
      (g?.members || []).forEach((mid) => { const r = memberRow(mid); if (r) memList.appendChild(r); });
      updateSplitHint();
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

    async function saveExpense() {
      if (!data.title.trim()) { toast('Description required', 'neg'); return; }
      if (!(data.amount > 0)) { toast('Amount must be > 0', 'neg'); return; }
      if (!data.groupId) { toast('Pick a group', 'neg'); return; }
      if (selectedMembers.length === 0) { toast('Pick at least one member', 'neg'); return; }

      // Build splits according to mode
      let splits = [];
      if (data.splitMode === 'equal') {
        const per = Math.round((data.amount / selectedMembers.length) * 100) / 100;
        splits = selectedMembers.map((uid2) => ({ userId: uid2, amount: per }));
        const sum = splits.reduce((s, x) => s + x.amount, 0);
        if (splits.length) splits[splits.length - 1].amount = Math.round((splits[splits.length - 1].amount + (data.amount - sum)) * 100) / 100;
      } else if (data.splitMode === 'exact') {
        splits = data.splits.filter((s) => selectedMembers.includes(s.userId));
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

      const obj = {
        id: existing?.id || uid('e'),
        groupId: data.groupId,
        title: data.title.trim(),
        amount: data.amount,
        currency: data.currency,
        paidBy: data.paidBy,
        splitMode: data.splitMode,
        splits,
        category: data.category,
        date: dateFromInput(data.date),
        note: data.note || ''
      };
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
      await OrbitDB.put('expenses', obj);
      if (existing) State.expenses = State.expenses.map((e) => e.id === obj.id ? obj : e);
      else State.expenses.push(obj);
      await syncExpenseIfShared(obj);   // Phase D: mirror to Firestore if group is shared
      if (window.OrbitActivity) OrbitActivity.log(OrbitDB, {
        actorId: State.selfId,
        action: existing ? 'edit' : 'add',
        entityType: 'expense',
        entityId: obj.id,
        groupId: obj.groupId,
        snapshot: obj,
        prev: prevSnapshot
      });
      closeModal();
      toast(existing ? 'Expense updated' : 'Expense added', 'pos');
      render();
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
      if (State.route.name === 'expenses') {
        State.filters.expenses.q = q;
        render();
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
      else if (name === 'profile') viewProfile();
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

    const gateMark = h('span', { class: 'brand-mark', 'aria-hidden': 'true', style: { width: '36px', height: '36px', borderRadius: '11px' } });
    gateMark.innerHTML = '<svg viewBox="0 0 32 32" fill="none"><g transform="translate(16 16)"><ellipse rx="12" ry="5.6" fill="none" stroke="#fff" stroke-width="1.8" opacity=".82" transform="rotate(-35)"/><ellipse rx="12" ry="5.6" fill="none" stroke="#8A7CFF" stroke-width="1.8" opacity=".8" transform="rotate(35)"/><circle r="3.8" fill="#fff"/></g></svg>';
    card.appendChild(h('div', { style: { display: 'inline-flex', alignItems: 'center', gap: '12px', marginBottom: '4px' } }, [
      gateMark,
      h('span', { class: 'brand-name', style: { fontSize: '20px' } }, 'Orbit')
    ]));

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
    }

    card.appendChild(h('div', { class: 'login-fine' }, 'Local-first ledger · We never hold money · Settle via UPI · End-to-end yours.'));
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

    OrbitDB.put = async (store, obj) => {
      const r = await origPut(store, obj);
      if (OrbitCloud && OrbitCloud.user()) OrbitCloud.write(store, obj).catch((e) => console.warn('Cloud write failed', e));
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
    State.reminderCache = await OrbitDB.getMeta('reminders', {});
    State.selfId = await OrbitDB.getMeta('selfUserId', 'u_self');
    State.theme = await OrbitDB.getMeta('theme', 'light');
    document.documentElement.dataset.theme = State.theme;
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
    const tabAdd = $('#tabAdd');
    if (tabAdd) tabAdd.addEventListener('click', () => openExpenseModal());   // mobile tab-bar add
    const tabMore = $('#tabMore');
    if (tabMore) tabMore.addEventListener('click', openMoreMenu);             // mobile "More" sheet
    const aiBtn = $('#aiQuickTop');
    if (aiBtn) aiBtn.addEventListener('click', () => openAIQuickAdd());
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

  async function enterApp() {
    console.log('[Orbit] enterApp: start');
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
      if (!self.email) self.email = fbUser.email || self.email || '';
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
        av.textContent = (self.name || 'You').trim().split(/\s+/).map((s) => s[0]).slice(0, 2).join('').toUpperCase() || 'Y';
        av.setAttribute('data-color', (self.avatar && self.avatar.startsWith('av-c')) ? self.avatar.slice(4) : '1');
        av.setAttribute('data-user', self.id);
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

    OrbitCloud.onAuthChange(async (user) => {
      console.log('[Orbit] onAuthChange:', user ? `signed in as ${user.email}` : 'no user');
      if (_signOutTimer) { clearTimeout(_signOutTimer); _signOutTimer = null; }

      if (user) {
        _seenSignedIn = true;
        try {
          await enterApp();
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
        if (params.get('stay') === '1') {
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
    let _started = false;

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
          email: '', upi: (info && info.upi) || '', pending: true
        };
        State.users.push(u);
      }
      return u.id;
    }
    function normalizeSharedGroup(g) {
      const memberUids = g.memberUids || Object.keys(g.members || {});
      const membersObj = g.members && !Array.isArray(g.members) ? g.members : {};
      const cloudMembers = memberUids.map((mu) => ensureMemberStub(mu, membersObj[mu]));
      const existing = groupById(g.id);
      // On the creator's device the local group already holds the full
      // member list they picked; the cloud copy only has people who've
      // actually joined. Keep whichever is richer so we don't lose members.
      const members = (existing && Array.isArray(existing.members) && existing.members.length >= cloudMembers.length)
        ? existing.members : cloudMembers;
      return Object.assign({}, existing || {}, {
        id: g.id, name: g.name,
        currency: g.currency || (existing && existing.currency) || 'INR',
        emoji: g.emoji || (existing && existing.emoji) || (g.name || '').slice(0, 2).toUpperCase(),
        category: g.category || (existing && existing.category) || 'friends',
        banner: (existing && existing.banner) || g.category || 'friends',
        members, memberCount: memberUids.length,
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
        // Tag shared expenses so we can tell them apart, then merge.
        const tagged = expenses.map((e) => Object.assign({ shared: true }, e));
        State.expenses = mergeById(State.expenses, tagged);
        softRerender();
      });
    }

    return {
      start() {
        if (_started) return;
        if (!window.OrbitGroups || !OrbitGroups.isReady()) return;
        _started = true;
        console.log('[Realtime] starting shared-group listeners');
        // Live list of my shared groups.
        _groupsUnsub = OrbitGroups.onMyGroups((groups) => {
          const tagged = groups.map((g) => normalizeSharedGroup(g));
          State.groups = mergeById(State.groups, tagged);
          // (Re)subscribe to each shared group's expenses.
          tagged.forEach((g) => watchGroupExpenses(g.id));
          softRerender();
        });
      },
      stop() {
        if (_groupsUnsub) { try { _groupsUnsub(); } catch (_) {} _groupsUnsub = null; }
        Object.values(_expenseUnsubs).forEach((u) => { try { u(); } catch (_) {} });
        for (const k in _expenseUnsubs) delete _expenseUnsubs[k];
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

  window.addEventListener('DOMContentLoaded', boot);
  window.OrbitApp = { State, render };
})();
