/* ============================================================
   ORBIT WEB — IndexedDB wrapper
   Database: orbit-web, version 1
   Stores: users, groups, expenses, settlements, meta
   ============================================================ */
(function (global) {
  'use strict';

  const DB_NAME = 'orbit-web';
  const DB_VERSION = 2;
  const STORES = ['users', 'groups', 'expenses', 'settlements', 'meta', 'activity'];

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
      await req2promise(tx(store, 'readwrite').put(obj));
      OrbitDB._notify(store);
      return obj;
    },

    async putAll(store, items) {
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
