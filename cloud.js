/* ============================================================
   ORBIT WEB — Firebase Auth + Firestore sync layer
   Module script. Loads Firebase v10 modular SDK from gstatic
   and exposes window.OrbitCloud for the rest of the app.

   Data model (per-user copy; future-proof for shared groups):
     orbit/{uid}                         — profile doc (name, email, upi, ...)
     orbit/{uid}/groups/{id}             — group records
     orbit/{uid}/users/{id}              — contact records (friends)
     orbit/{uid}/expenses/{id}           — expense records
     orbit/{uid}/settlements/{id}        — settlement records
     orbit/{uid}/meta/{key}              — meta key/value
   ============================================================ */
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js';
import {
  getAuth, GoogleAuthProvider,
  signInWithPopup, signInWithRedirect, getRedirectResult, signOut,
  onAuthStateChanged, setPersistence,
  browserLocalPersistence, indexedDBLocalPersistence,
  RecaptchaVerifier, signInWithPhoneNumber
} from 'https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js';
import {
  getFirestore, collection, doc,
  getDoc, getDocs, setDoc, deleteDoc, writeBatch
} from 'https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js';

const STORE_COLLECTIONS = ['users', 'groups', 'expenses', 'settlements', 'meta', 'activity'];
const KEY_FIELD = { meta: 'key' }; // others default to 'id'

function isConfigured(cfg) {
  if (!cfg) return false;
  for (const k of ['apiKey', 'authDomain', 'projectId', 'appId']) {
    const v = cfg[k];
    if (!v || /REPLACE_ME/.test(String(v))) return false;
  }
  return true;
}

let _app = null;
let _auth = null;
let _db = null;
let _user = null;
let _ready = false;
let _recaptcha = null;
let _phoneConfirm = null;
const _authListeners = [];

const OrbitCloud = {
  // ---- Lifecycle ----
  isConfigured() {
    return isConfigured(window.FIREBASE_CONFIG);
  },
  isReady() { return _ready; },
  user() { return _user; },

  async init() {
    if (_app) return;
    if (!OrbitCloud.isConfigured()) {
      // Stay un-initialized; the app shows a setup-needed gate.
      return;
    }
    _app = initializeApp(window.FIREBASE_CONFIG);
    _auth = getAuth(_app);
    _db = getFirestore(_app);
    // IndexedDB persistence is more robust on GitHub Pages and survives
    // third-party-cookie restrictions; fall back to localStorage if it's
    // unavailable (e.g. private mode on older browsers).
    try {
      await setPersistence(_auth, indexedDBLocalPersistence);
    } catch (_) {
      try { await setPersistence(_auth, browserLocalPersistence); } catch (_) {}
    }

    // Pick up any pending redirect-based sign-in (Safari / iOS fallback).
    try {
      const r = await getRedirectResult(_auth);
      if (r && r.user) _user = r.user;
    } catch (_) {}

    await new Promise((resolve) => {
      const off = onAuthStateChanged(_auth, (u) => {
        _user = u || null;
        _ready = true;
        _authListeners.forEach((fn) => { try { fn(_user); } catch (_) {} });
        resolve();
        // keep listener active for subsequent state changes
      });
      OrbitCloud._unsubAuth = off;
    });
  },

  onAuthChange(fn) {
    _authListeners.push(fn);
    // Fire immediately if already known
    if (_ready) { try { fn(_user); } catch (_) {} }
  },

  async signInWithGoogle() {
    if (!_auth) throw new Error('Firebase not configured');
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    try {
      const cred = await signInWithPopup(_auth, provider);
      _user = cred.user;
      return _user;
    } catch (e) {
      const code = e && e.code;
      // Safari ITP / in-app webviews / blocked popups → redirect flow.
      if (code === 'auth/popup-blocked'
        || code === 'auth/popup-closed-by-user'
        || code === 'auth/operation-not-supported-in-this-environment'
        || code === 'auth/cancelled-popup-request') {
        await signInWithRedirect(_auth, provider);
        // Page will reload — control returns via getRedirectResult on init().
        return null;
      }
      throw e;
    }
  },

  // ---- Phone-OTP sign-in (Phase 3) ----
  // Verifies a real phone number so claim-by-phone is trustworthy. Requires
  // the Phone provider enabled in the Firebase console.
  async startPhoneSignIn(phoneNumber, containerId = 'recaptcha-container') {
    if (!_auth) throw new Error('Firebase not configured');
    try { if (_recaptcha) { _recaptcha.clear(); } } catch (_) {}
    _recaptcha = new RecaptchaVerifier(_auth, containerId, { size: 'invisible' });
    _phoneConfirm = await signInWithPhoneNumber(_auth, phoneNumber, _recaptcha);
    return { ok: true };
  },
  async confirmPhoneCode(code) {
    if (!_phoneConfirm) throw new Error('Request a code first');
    const cred = await _phoneConfirm.confirm(code);
    _user = cred.user;
    _phoneConfirm = null;
    return _user;
  },

  async signOut() {
    if (!_auth) return;
    await signOut(_auth);
    _user = null;
  },

  // ---- Sync ----
  // Pull every doc for the current user into IndexedDB. Returns counts per store.
  async pullAll() {
    if (!_user || !_db) return { ok: false, reason: 'not-signed-in' };
    const uid = _user.uid;
    const counts = {};
    for (const store of STORE_COLLECTIONS) {
      const snap = await getDocs(collection(_db, 'orbit', uid, store));
      const items = [];
      snap.forEach((d) => items.push(d.data()));
      counts[store] = items.length;
      if (items.length) {
        await window.OrbitDB.putAll(store, items);
      }
    }
    return { ok: true, counts };
  },

  // Push every IndexedDB doc to Firestore (used for first-time seed).
  async pushAll() {
    if (!_user || !_db) return { ok: false };
    const uid = _user.uid;
    for (const store of STORE_COLLECTIONS) {
      const items = await window.OrbitDB.getAll(store);
      if (!items.length) continue;
      const keyField = KEY_FIELD[store] || 'id';
      // writeBatch caps at 500 ops — chunk if needed.
      for (let i = 0; i < items.length; i += 450) {
        const batch = writeBatch(_db);
        items.slice(i, i + 450).forEach((obj) => {
          const id = String(obj[keyField]);
          batch.set(doc(_db, 'orbit', uid, store, id), obj);
        });
        await batch.commit();
      }
    }
    // Mark profile doc with last-sync metadata
    await setDoc(doc(_db, 'orbit', uid), {
      uid,
      email: _user.email || null,
      displayName: _user.displayName || null,
      photoURL: _user.photoURL || null,
      updatedAt: Date.now()
    }, { merge: true });
    return { ok: true };
  },

  // Mirror a single write. Fire-and-forget (callers shouldn't block on it).
  // Failures are retried once after a short backoff so a brief network blip
  // doesn't cause silent divergence between local and cloud state.
  async write(store, obj) {
    if (!_user || !_db) return;
    const keyField = KEY_FIELD[store] || 'id';
    const id = String(obj[keyField]);
    if (!id) return;
    try {
      await setDoc(doc(_db, 'orbit', _user.uid, store, id), obj);
    } catch (e) {
      // One retry after a short backoff; swallow a persistent failure so this
      // fire-and-forget call never becomes an unhandled promise rejection.
      try {
        await new Promise((r) => setTimeout(r, 600));
        await setDoc(doc(_db, 'orbit', _user.uid, store, id), obj);
      } catch (e2) { console.warn('[cloud] write failed (will retry on next sync):', store, id, e2 && e2.code); }
    }
  },

  async deleteOne(store, id) {
    if (!_user || !_db) return;
    try {
      await deleteDoc(doc(_db, 'orbit', _user.uid, store, String(id)));
    } catch (e) {
      try {
        await new Promise((r) => setTimeout(r, 600));
        await deleteDoc(doc(_db, 'orbit', _user.uid, store, String(id)));
      } catch (e2) { console.warn('[cloud] delete failed (will retry on next sync):', store, id, e2 && e2.code); }
    }
  },

  async clearStore(store) {
    if (!_user || !_db) return;
    const snap = await getDocs(collection(_db, 'orbit', _user.uid, store));
    for (let i = 0; i < snap.docs.length; i += 450) {
      const batch = writeBatch(_db);
      snap.docs.slice(i, i + 450).forEach((d) => batch.delete(d.ref));
      await batch.commit();
    }
  },

  // Returns true if this account has anything in Firestore yet.
  async hasRemoteData() {
    if (!_user || !_db) return false;
    for (const store of STORE_COLLECTIONS) {
      const snap = await getDocs(collection(_db, 'orbit', _user.uid, store));
      if (!snap.empty) return true;
    }
    return false;
  }
};

window.OrbitCloud = OrbitCloud;
// Notify any waiter that the module finished loading.
window.dispatchEvent(new CustomEvent('orbit-cloud-ready'));
