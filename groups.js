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

let _db = null, _auth = null, _functions = null;

function ensure() {
  if (_db) return true;
  if (!window.FIREBASE_CONFIG) return false;
  const app = getApps().length ? getApps()[0] : initializeApp(window.FIREBASE_CONFIG);
  _auth = getAuth(app);
  _db = getFirestore(app);
  _functions = getFunctions(app, 'asia-south1');
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
    await setDoc(doc(_db, 'users', uid()), {
      uid: uid(),
      name: profile.name || '',
      email: profile.email || '',
      upi: profile.upi || '',
      phone: profile.phone || '',
      photoURL: profile.photoURL || '',
      updatedAt: serverTimestamp()
    }, { merge: true });
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
      members: { [me]: { name: myProfile.name || 'You', upi: myProfile.upi || '', avatar: 'av-c1' } }
    });
    // index on the user side for fast listing
    await setDoc(doc(_db, 'users', me), { groupIds: arrayUnion(id) }, { merge: true });
    return id;
  },
  async renameGroup(groupId, name) {
    if (!ensure()) return;
    await updateDoc(doc(_db, 'groups', groupId), { name });
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
    const base = location.origin + location.pathname;
    return { code, url: base + '#/join/' + code };
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

  // ---- Realtime (ready for Phase C wiring) ----
  // Subscribe to live expense changes for an open group. Returns an
  // unsubscribe fn. UI can call this when a group view mounts.
  onGroupExpenses(groupId, cb) {
    if (!ensure()) return () => {};
    return onSnapshot(collection(_db, 'groups', groupId, 'expenses'),
      (snap) => cb(snap.docs.map((d) => d.data())),
      (err) => console.warn('[OrbitGroups] expense listener error', err));
  },
  onMyGroups(cb) {
    if (!ensure() || !uid()) return () => {};
    return onSnapshot(query(collection(_db, 'groups'), where('memberUids', 'array-contains', uid())),
      (snap) => cb(snap.docs.map((d) => d.data())),
      (err) => console.warn('[OrbitGroups] groups listener error', err));
  }
};

window.OrbitGroups = OrbitGroups;
window.dispatchEvent(new CustomEvent('orbit-groups-ready'));
