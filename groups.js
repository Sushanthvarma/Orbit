/* ============================================================
   ORBIT WEB — Shared multi-user group layer (Phase A)
   Module script. Adds the SHARED data model (real Splitwise-style
   groups multiple accounts belong to) ON TOP of the existing
   per-user cloud.js. Nothing here touches the legacy orbit/{uid}
   tree — it reads/writes the new top-level collections:

     users/{uid}                       profile (name, email, upi, photoURL)
     groups/{groupId}                  shared group (memberUids[] = access)
     groups/{groupId}/expenses/{id}
     groups/{groupId}/settlements/{id}
     invites/{inviteCode}              pending invite -> groupId

   Exposes window.OrbitGroups. Realtime listeners (onSnapshot) and the
   invite-accept Cloud Function are Phase B/C — this module gives the
   schema, the writes, and one-shot reads so the UI can be wired now.
   ============================================================ */
import { initializeApp, getApps } from 'https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js';
import {
  getFirestore, collection, doc, getDoc, getDocs, setDoc, updateDoc,
  deleteDoc, query, where, arrayUnion, serverTimestamp, onSnapshot, writeBatch
} from 'https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js';
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.4/firebase-functions.js';
import { getStorage, ref as storageRef, uploadString, getDownloadURL, deleteObject } from 'https://www.gstatic.com/firebasejs/10.12.4/firebase-storage.js';

let _db = null, _auth = null, _functions = null, _storage = null;

function ensure() {
  if (_db) return true;
  if (!window.FIREBASE_CONFIG) return false;
  const app = getApps().length ? getApps()[0] : initializeApp(window.FIREBASE_CONFIG);
  _auth = getAuth(app);
  _db = getFirestore(app);
  _functions = getFunctions(app, 'asia-south1');
  _storage = getStorage(app);
  return true;
}
function uid() { return _auth && _auth.currentUser ? _auth.currentUser.uid : null; }
function rid(prefix) { return prefix + '_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4); }

const OrbitGroups = {
  isReady() { return ensure() && !!uid(); },
  currentUid() { return uid(); },

  // ---- Profile (top-level users/{uid}) ----
  async upsertMyProfile(profile) {
    if (!ensure() || !uid()) return;
    // Normalize handles so owner-side lookups (addExistingUser) match reliably.
    let phone = (profile.phone || '').replace(/[^\d+]/g, '');
    if (phone && !phone.startsWith('+') && phone.length === 10) phone = '+91' + phone;
    await setDoc(doc(_db, 'users', uid()), {
      uid: uid(),
      name: profile.name || '',
      email: (profile.email || '').trim().toLowerCase(),
      upi: profile.upi || '',
      phone,
      photoURL: profile.photoURL || '',
      updatedAt: serverTimestamp()
    }, { merge: true });
  },
  // Founder-only: every signed-in user (the admin roster). Rules permit the
  // list only for the founder email; everyone else gets permission-denied.
  async listAllUsers() {
    if (!ensure() || !uid()) return [];
    try { const snap = await getDocs(collection(_db, 'users')); return snap.docs.map((d) => d.data()); }
    catch (e) { console.warn('[OrbitGroups] listAllUsers denied/failed', e); return []; }
  },
  // Founder-only: every group in the app (for admin stats).
  async listAllGroups() {
    if (!ensure() || !uid()) return [];
    try { const snap = await getDocs(collection(_db, 'groups')); return snap.docs.map((d) => d.data()); }
    catch (e) { console.warn('[OrbitGroups] listAllGroups denied/failed', e); return []; }
  },
  async getProfile(theUid) {
    if (!ensure()) return null;
    const s = await getDoc(doc(_db, 'users', theUid));
    return s.exists() ? s.data() : null;
  },

  // ---- Groups ----
  // Create a shared group with the caller as creator + first member.
  async createGroup({ name, currency = 'INR', emoji = '', category = 'friends' }) {
    if (!ensure() || !uid()) throw new Error('Not signed in');
    const id = rid('g');
    const me = uid();
    const myProfile = (await this.getProfile(me)) || {};
    await setDoc(doc(_db, 'groups', id), {
      id, name, currency, emoji, category,
      createdBy: me,
      createdAt: serverTimestamp(),
      memberUids: [me],
      members: { [me]: { name: myProfile.name || 'You', upi: myProfile.upi || '', avatar: 'av-c1', photoURL: myProfile.photoURL || '' } }
    });
    // index on the user side for fast listing
    await setDoc(doc(_db, 'users', me), { groupIds: arrayUnion(id) }, { merge: true });
    return id;
  },
  async renameGroup(groupId, name) {
    if (!ensure()) return;
    await updateDoc(doc(_db, 'groups', groupId), { name });
  },
  // Owner-only (enforced by rules): delete the shared group doc so it disappears
  // for every member. (Subcollection docs are left orphaned but become
  // unreadable once the parent is gone.)
  async deleteGroup(groupId) {
    if (!ensure() || !uid()) return;
    await deleteDoc(doc(_db, 'groups', groupId));
  },
  async getGroup(groupId) {
    if (!ensure()) return null;
    const s = await getDoc(doc(_db, 'groups', groupId));
    return s.exists() ? s.data() : null;
  },
  // One-shot list of the groups I belong to (uses users/{uid}.groupIds).
  async listMyGroups() {
    if (!ensure() || !uid()) return [];
    const meSnap = await getDoc(doc(_db, 'users', uid()));
    const ids = (meSnap.exists() && meSnap.data().groupIds) || [];
    const out = [];
    for (const gid of ids) {
      const g = await this.getGroup(gid);
      if (g) out.push(g);
    }
    return out;
  },

  // ---- Expenses (shared, under the group) ----
  async addExpense(groupId, expense) {
    if (!ensure() || !uid()) throw new Error('Not signed in');
    const id = expense.id || rid('e');
    await setDoc(doc(_db, 'groups', groupId, 'expenses', id), {
      ...expense, id, groupId, createdBy: uid(), createdAt: serverTimestamp()
    });
    return id;
  },

  // ---- Receipt images (Firebase Storage: receipts/{groupId}/{expenseId}.jpg) ----
  // The image lives in Storage; only its short download URL is stored on the
  // expense doc, so it syncs cross-device cheaply (no base64 bloat). Hard 2.5 MB
  // cap (also enforced by storage.rules). Returns the public download URL.
  RECEIPT_MAX_BYTES: 2.5 * 1024 * 1024,
  async uploadReceipt(groupId, expenseId, dataUrl) {
    if (!ensure() || !uid()) throw new Error('Not signed in');
    const s = String(dataUrl || '');
    const comma = s.indexOf(',');
    const approxBytes = comma >= 0 ? Math.floor((s.length - comma - 1) * 0.75) : s.length;
    if (approxBytes > this.RECEIPT_MAX_BYTES) throw new Error('receipt-too-large');
    const r = storageRef(_storage, `receipts/${groupId}/${expenseId}.jpg`);
    await uploadString(r, s, 'data_url');
    return await getDownloadURL(r);
  },
  async deleteReceiptFile(groupId, expenseId) {
    if (!ensure() || !uid()) return;
    try { await deleteObject(storageRef(_storage, `receipts/${groupId}/${expenseId}.jpg`)); }
    catch (e) { /* object-not-found is fine */ }
  },
  async deleteExpense(groupId, expenseId) {
    if (!ensure()) return;
    await deleteDoc(doc(_db, 'groups', groupId, 'expenses', expenseId));
  },
  async listExpenses(groupId) {
    if (!ensure()) return [];
    const snap = await getDocs(collection(_db, 'groups', groupId, 'expenses'));
    return snap.docs.map((d) => d.data());
  },

  // ---- Settlements (shared) ----
  async addSettlement(groupId, settlement) {
    if (!ensure() || !uid()) throw new Error('Not signed in');
    const id = settlement.id || rid('s');
    await setDoc(doc(_db, 'groups', groupId, 'settlements', id), {
      ...settlement, id, groupId, createdBy: uid(), createdAt: serverTimestamp()
    });
    return id;
  },
  async listSettlements(groupId) {
    if (!ensure()) return [];
    const snap = await getDocs(collection(_db, 'groups', groupId, 'settlements'));
    return snap.docs.map((d) => d.data());
  },

  // ---- Invites ----
  // Create a shareable invite for a group I'm a member of. Returns the
  // join URL the inviter can send (e.g. via the WhatsApp share already built).
  async createInvite(groupId) {
    if (!ensure() || !uid()) throw new Error('Not signed in');
    const code = rid('inv');
    await setDoc(doc(_db, 'invites', code), {
      code, groupId, invitedBy: uid(),
      status: 'pending',
      createdAt: serverTimestamp(),
      expiresAt: Date.now() + 1000 * 60 * 60 * 24 * 14 // 14 days
    });
    // Query-param form survives messenger link parsing better than a #hash.
    // boot() normalizes ?join=CODE back into the #/join/CODE route.
    const base = location.origin + location.pathname;
    return { code, url: base + '?join=' + code };
  },
  async getInvite(code) {
    if (!ensure()) return null;
    const s = await getDoc(doc(_db, 'invites', code));
    return s.exists() ? s.data() : null;
  },
  // Accept an invite via the trusted Cloud Function (Phase B). The function
  // validates the code server-side and adds the caller to the group's
  // member list — membership cannot be forged from the client.
  async acceptInvite(code) {
    if (!ensure() || !uid()) throw new Error('Sign in to join this group');
    const call = httpsCallable(_functions, 'acceptInvite');
    const res = await call({ code });
    return res.data; // { ok, groupId }
  },
  async leaveGroup(groupId) {
    if (!ensure() || !uid()) throw new Error('Not signed in');
    const call = httpsCallable(_functions, 'leaveGroup');
    const res = await call({ groupId });
    return res.data;
  },
  // Owner-only: remove ANOTHER member from a shared group. Membership can't
  // be changed from the client (rules forbid it) — this goes through the
  // trusted Cloud Function, which also logs the removal to the group feed.
  async removeMember(groupId, memberUid) {
    if (!ensure() || !uid()) throw new Error('Not signed in');
    const call = httpsCallable(_functions, 'removeMember');
    const res = await call({ groupId, memberUid });
    return res.data;
  },
  // Quick add NL parsing via the SHARED server-side Gemini key — no per-user
  // key needed. Returns { ok, parsed, raw } | { ok:false, error }.
  async aiParse(text, ctx) {
    if (!ensure() || !uid()) throw new Error('Not signed in');
    const call = httpsCallable(_functions, 'aiParse');
    const res = await call({ text, ctx: ctx || {} });
    return res.data;
  },
  // Receipt vision OCR via the SHARED server-side Gemini key. `image` is
  // { data: base64, mimeType }. Returns { ok, parsed, raw } | { ok:false, error }.
  async aiOcr(image) {
    if (!ensure() || !uid()) throw new Error('Not signed in');
    const call = httpsCallable(_functions, 'aiOcr');
    const res = await call({ image: image || {} });
    return res.data;
  },
  // Owner-only: if email/phone belongs to an existing Orbit account, add them
  // straight into the group (no invite). Returns { ok, found, uid?, name? }.
  async addExistingUser(groupId, { email, phone }) {
    if (!ensure() || !uid()) throw new Error('Not signed in');
    const call = httpsCallable(_functions, 'addExistingUser');
    const res = await call({ groupId, email: email || '', phone: phone || '' });
    return res.data;
  },

  // ---- Identity: ghost members + auto-claim (Phase 2) ----
  // Add a "ghost" placeholder (a person invited by email/phone who hasn't
  // signed in yet) to a shared group, and drop a claim ticket addressed to
  // their handle. When they sign in, claimPending() links them automatically.
  async addGhostToGroup(groupId, ghost) {
    if (!ensure() || !uid()) throw new Error('Not signed in');
    const email = (ghost.email || '').trim().toLowerCase();
    let phone = (ghost.phone || '').replace(/[^\d+]/g, '');
    if (phone && !phone.startsWith('+') && phone.length === 10) phone = '+91' + phone;
    await setDoc(doc(_db, 'groups', groupId), {
      members: { [ghost.ghostId]: { name: ghost.name || 'Invited', email, phone, ghost: true } }
    }, { merge: true });
    // A claim ticket per handle, so the person links whether they sign in via
    // Google (verified email) or phone-OTP (verified number).
    const handles = [email, phone].filter(Boolean);
    for (const handle of handles) {
      await setDoc(doc(_db, 'pendingClaims', handle, 'tickets', ghost.ghostId + '__' + groupId), {
        groupId, ghostId: ghost.ghostId, name: ghost.name || '', invitedBy: uid(), createdAt: serverTimestamp()
      });
    }
    return handles[0] || '';
  },
  // Claim any pending placeholders for my verified identity. Trusted Cloud
  // Function does the membership add + split rewrite. Returns { ok, claimed:[groupId] }.
  async claimPending() {
    if (!ensure() || !uid()) return { ok: false, claimed: [] };
    try {
      const call = httpsCallable(_functions, 'claimPending');
      const res = await call({});
      return res.data;
    } catch (e) {
      console.warn('[OrbitGroups] claimPending failed', e);
      return { ok: false, claimed: [], error: e.message || e.code };
    }
  },

  // ---- Realtime (ready for Phase C wiring) ----
  // Subscribe to live expense changes for an open group. Returns an
  // unsubscribe fn. UI can call this when a group view mounts.
  onGroupExpenses(groupId, cb) {
    if (!ensure()) return () => {};
    return onSnapshot(collection(_db, 'groups', groupId, 'expenses'),
      (snap) => cb(snap.docs.map((d) => d.data())),
      (err) => console.warn('[OrbitGroups] expense listener error', err));
  },
  // Append a shared audit-log entry (expense added/edited/deleted, settlement)
  // so EVERY member sees who did what — not just the device that did it.
  async addActivity(groupId, entry) {
    if (!ensure() || !uid()) return null;
    const id = rid('act');
    await setDoc(doc(_db, 'groups', groupId, 'activity', id),
      Object.assign({}, entry, { id, actorUid: entry.actorUid || uid(), createdAt: serverTimestamp() }));
    return id;
  },
  // Live shared settlements for a group (mirror of onGroupExpenses).
  onGroupSettlements(groupId, cb) {
    if (!ensure()) return () => {};
    return onSnapshot(collection(_db, 'groups', groupId, 'settlements'),
      (snap) => cb(snap.docs.map((d) => d.data())),
      (err) => console.warn('[OrbitGroups] settlement listener error', err));
  },
  onMyGroups(cb) {
    if (!ensure() || !uid()) return () => {};
    return onSnapshot(query(collection(_db, 'groups'), where('memberUids', 'array-contains', uid())),
      (snap) => cb(snap.docs.map((d) => d.data())),
      (err) => console.warn('[OrbitGroups] groups listener error', err));
  },
  // Founder-only: live global feed of every join across the app.
  onAdminFeed(cb) {
    if (!ensure() || !uid()) return () => {};
    return onSnapshot(collection(_db, 'adminFeed'),
      (snap) => cb(snap.docs.map((d) => {
        const x = d.data();
        const ts = (x.at && x.at.toDate) ? x.at.toDate().toISOString() : null;
        return Object.assign({ id: d.id, _ts: ts }, x);
      })),
      (err) => console.warn('[OrbitGroups] adminFeed listener error', err));
  },
  // Live group activity (e.g. "member joined") for the persistent feed.
  onGroupActivity(groupId, cb) {
    if (!ensure()) return () => {};
    return onSnapshot(collection(_db, 'groups', groupId, 'activity'),
      (snap) => cb(snap.docs.map((d) => {
        const x = d.data();
        const ts = (x.createdAt && x.createdAt.toDate) ? x.createdAt.toDate().toISOString() : null;
        return Object.assign({ id: d.id, _ts: ts }, x);
      })),
      (err) => console.warn('[OrbitGroups] activity listener error', err));
  }
};

window.OrbitGroups = OrbitGroups;
window.dispatchEvent(new CustomEvent('orbit-groups-ready'));
