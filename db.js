/* ============================================================
   ORBIT WEB — IndexedDB wrapper
   Database: orbit-web, version 1
   Stores: users, groups, expenses, settlements, meta
   ============================================================ */
(function (global) {
  'use strict';

  const DB_NAME = 'orbit-web';
  const DB_VERSION = 4;
  // `fin_*` stores hold the personal-finance suite (net worth, budgets, goals,
  // loans, …), kept separate from the expense-splitting stores so the two
  // domains never collide. Accounts/history added in v3; the rest in v4.
  const FIN_STORES = ['fin_accounts', 'fin_nwhistory', 'fin_txns', 'fin_budgets',
    'fin_goals', 'fin_loans', 'fin_investments', 'fin_subs', 'fin_recurring'];
  const STORES = ['users', 'groups', 'expenses', 'settlements', 'meta', 'activity'].concat(FIN_STORES);

  let _db = null;

  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);

      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('users')) {
          db.createObjectStore('users', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('groups')) {
          const s = db.createObjectStore('groups', { keyPath: 'id' });
          s.createIndex('category', 'category', { unique: false });
        }
        if (!db.objectStoreNames.contains('expenses')) {
          const s = db.createObjectStore('expenses', { keyPath: 'id' });
          s.createIndex('groupId', 'groupId', { unique: false });
          s.createIndex('date', 'date', { unique: false });
          s.createIndex('paidBy', 'paidBy', { unique: false });
        }
        if (!db.objectStoreNames.contains('settlements')) {
          const s = db.createObjectStore('settlements', { keyPath: 'id' });
          s.createIndex('fromUser', 'fromUser', { unique: false });
          s.createIndex('toUser', 'toUser', { unique: false });
          s.createIndex('groupId', 'groupId', { unique: false });
        }
        if (!db.objectStoreNames.contains('meta')) {
          db.createObjectStore('meta', { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains('activity')) {
          const s = db.createObjectStore('activity', { keyPath: 'id' });
          s.createIndex('ts', 'ts', { unique: false });
          s.createIndex('entityId', 'entityId', { unique: false });
          s.createIndex('groupId', 'groupId', { unique: false });
        }
        // Personal-finance suite (v3+)
        if (!db.objectStoreNames.contains('fin_accounts')) {
          db.createObjectStore('fin_accounts', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('fin_nwhistory')) {
          // keyed by ISO date so we keep at most one snapshot per day
          db.createObjectStore('fin_nwhistory', { keyPath: 'date' });
        }
        // v4: the rest of the finance suite. id-keyed; txns indexed by date.
        if (!db.objectStoreNames.contains('fin_txns')) {
          const s = db.createObjectStore('fin_txns', { keyPath: 'id' });
          s.createIndex('date', 'date', { unique: false });
          s.createIndex('category', 'category', { unique: false });
        }
        ['fin_budgets', 'fin_goals', 'fin_loans', 'fin_investments', 'fin_subs', 'fin_recurring'].forEach((name) => {
          if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: 'id' });
        });
      };

      req.onsuccess = () => {
        const db = req.result;
        // If another tab tries to upgrade the schema, close our connection so
        // the upgrade isn't blocked. The page can be refreshed to reconnect.
        db.onversionchange = () => { try { db.close(); } catch (_) {} _db = null; };
        resolve(db);
      };
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('IndexedDB blocked. Close other tabs.'));
    });
  }

  function tx(store, mode) {
    if (!_db) throw new Error('OrbitDB not initialised. Call OrbitDB.init() first.');
    return _db.transaction(store, mode).objectStore(store);
  }

  function req2promise(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  // Stamp every entity write with a monotonic `updatedAt` (ms epoch). This is
  // the version field the cloud-sync layer uses for last-write-wins conflict
  // resolution: when two devices edit the same record, the higher updatedAt
  // wins. Skipped for the `meta` key/value store (its values are arbitrary).
  function stamp(store, obj) {
    if (store !== 'meta' && obj && typeof obj === 'object' && !Array.isArray(obj)) {
      obj.updatedAt = Date.now();
    }
    return obj;
  }

  const OrbitDB = {
    async init() {
      if (_db) return _db;
      _db = await openDB();
      return _db;
    },

    isReady() { return !!_db; },

    async getAll(store) {
      return req2promise(tx(store, 'readonly').getAll());
    },

    async get(store, id) {
      return req2promise(tx(store, 'readonly').get(id));
    },

    async put(store, obj) {
      stamp(store, obj);
      await req2promise(tx(store, 'readwrite').put(obj));
      OrbitDB._notify(store);
      return obj;
    },

    async putAll(store, items) {
      // NOTE: putAll is the BULK path used by cloud pull + seed — it must NOT
      // stamp updatedAt, or it would clobber the remote record's version and
      // break last-write-wins. Only single local edits (put/writeTx) bump it.
      const t = _db.transaction(store, 'readwrite');
      const s = t.objectStore(store);
      items.forEach((it) => s.put(it));
      await new Promise((resolve, reject) => {
        t.oncomplete = () => resolve();
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      });
      OrbitDB._notify(store);
      return items;
    },

    async delete(store, id) {
      await req2promise(tx(store, 'readwrite').delete(id));
      OrbitDB._notify(store);
    },

    async deleteMany(store, ids) {
      const t = _db.transaction(store, 'readwrite');
      const s = t.objectStore(store);
      ids.forEach((id) => s.delete(id));
      await new Promise((resolve, reject) => {
        t.oncomplete = () => resolve();
        t.onerror = () => reject(t.error);
      });
      OrbitDB._notify(store);
    },

    // Atomic multi-store write. `ops` is a list of
    //   { store, op: 'put' | 'delete', value }
    // applied inside ONE IndexedDB transaction across all referenced stores —
    // so either every op commits or none do. Use this whenever a single user
    // action must touch >1 store (e.g. an expense + its activity entry); a crash
    // mid-way can no longer leave the stores out of sync.
    async writeTx(ops) {
      if (!_db) throw new Error('OrbitDB not initialised. Call OrbitDB.init() first.');
      if (!ops || !ops.length) return ops;
      const stores = Array.from(new Set(ops.map((o) => o.store)));
      const t = _db.transaction(stores, 'readwrite');
      const done = new Promise((resolve, reject) => {
        t.oncomplete = () => resolve();
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error || new Error('transaction aborted'));
      });
      try {
        ops.forEach((o) => {
          const s = t.objectStore(o.store);
          if (o.op === 'delete') s.delete(o.value);
          else s.put(stamp(o.store, o.value));
        });
      } catch (err) {
        // A synchronous put/delete failure (e.g. missing keyPath, unclonable
        // value) does NOT abort the transaction on its own — already-queued ops
        // would still commit. Abort explicitly so the write is truly all-or-nothing.
        try { t.abort(); } catch (_) {}
        await done.catch(() => {});   // let the abort settle (rolls everything back)
        throw err;
      }
      await done;
      stores.forEach((s) => OrbitDB._notify(s));
      return ops;
    },

    // Pure last-write-wins merge of two record sets by `updatedAt`. Returns the
    // union keyed by `keyField`, keeping the higher-versioned copy of each
    // record (remote wins ties so a freshly-pulled doc takes effect). This is
    // the building block for a non-destructive cloud pull — see README
    // "Cloud sync & conflict strategy".
    mergeByUpdatedAt(localArr, remoteArr, keyField) {
      const key = keyField || 'id';
      const map = new Map();
      (localArr || []).forEach((x) => { if (x && x[key] != null) map.set(x[key], x); });
      (remoteArr || []).forEach((r) => {
        if (!r || r[key] == null) return;
        const cur = map.get(r[key]);
        if (!cur || (r.updatedAt || 0) >= (cur.updatedAt || 0)) map.set(r[key], r);
      });
      return Array.from(map.values());
    },

    async clear(store) {
      await req2promise(tx(store, 'readwrite').clear());
      OrbitDB._notify(store);
    },

    async clearAll() {
      for (const s of STORES) {
        await req2promise(tx(s, 'readwrite').clear());
      }
      for (const s of STORES) OrbitDB._notify(s);
    },

    async queryByIndex(store, index, value) {
      return req2promise(tx(store, 'readonly').index(index).getAll(value));
    },

    async getMeta(key, fallback) {
      const v = await req2promise(tx('meta', 'readonly').get(key));
      return v ? v.value : (fallback === undefined ? null : fallback);
    },

    async setMeta(key, value) {
      await req2promise(tx('meta', 'readwrite').put({ key, value }));
      OrbitDB._notify('meta');
    },

    async exportAll() {
      const out = {};
      for (const s of STORES) {
        out[s] = await OrbitDB.getAll(s);
      }
      return out;
    },

    // Restore a JSON backup produced by exportAll(). Validates structure and
    // rejects a malformed/corrupt file rather than writing garbage. The `meta`
    // store is intentionally NOT restored (it holds the device's API keys /
    // flags). With opts.merge=false (default) each restored store is replaced;
    // with merge=true records are upserted on top of the current data.
    async importAll(data, opts = {}) {
      if (!data || typeof data !== 'object') throw new Error('Not a valid Orbit backup (expected an object).');
      const restorable = ['users', 'groups', 'expenses', 'settlements', 'activity'];
      const present = restorable.filter((s) => Array.isArray(data[s]));
      if (!present.length) throw new Error('Backup has no recognizable data (no users/groups/expenses).');

      const valid = (store, r) => {
        if (!r || typeof r !== 'object' || r.id == null) return false;
        if (store === 'expenses') return typeof r.amount === 'number' && isFinite(r.amount) && Array.isArray(r.splits);
        if (store === 'settlements') return typeof r.amount === 'number' && isFinite(r.amount);
        return true;
      };
      // Validate everything FIRST so a bad record aborts before any write.
      for (const s of present) {
        for (const r of data[s]) {
          if (!valid(s, r)) throw new Error('Backup is corrupt: an invalid ' + s.replace(/s$/, '') + ' record was found.');
        }
      }
      const counts = {};
      for (const s of present) {
        if (!opts.merge) await OrbitDB.clear(s);
        if (data[s].length) await OrbitDB.putAll(s, data[s]);
        counts[s] = data[s].length;
      }
      return { stores: present, counts };
    },

    // Tiny pub/sub for store changes
    _listeners: {},
    on(store, fn) {
      (OrbitDB._listeners[store] = OrbitDB._listeners[store] || []).push(fn);
    },
    off(store, fn) {
      OrbitDB._listeners[store] = (OrbitDB._listeners[store] || []).filter((f) => f !== fn);
    },
    _notify(store) {
      (OrbitDB._listeners[store] || []).forEach((fn) => { try { fn(); } catch (_) {} });
      (OrbitDB._listeners['*'] || []).forEach((fn) => { try { fn(store); } catch (_) {} });
    }
  };

  global.OrbitDB = OrbitDB;
})(window);
