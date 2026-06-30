// IndexedDB-backed store for the actual EPUB file bytes.

const DB_NAME = 'epub-reader-files';
const DB_VERSION = 1;
const STORE = 'epubs';

const DEBUG = true;
const log = (...args) => DEBUG && console.log('[blobStore]', ...args);

let dbPromise = null;

const getDb = () => {
  if (typeof indexedDB === 'undefined') {
    log('IndexedDB unavailable');
    return Promise.reject(new Error('IndexedDB unavailable'));
  }
  if (dbPromise) return dbPromise;
  log('getDb: opening database', DB_NAME, 'v' + DB_VERSION);
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (ev) => {
      log('getDb: onupgradeneeded oldVersion=' + ev.oldVersion + ' newVersion=' + ev.newVersion);
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
        log('getDb: created object store', STORE);
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      log(
        'getDb: db open success. objectStoreNames=[' +
          Array.from(db.objectStoreNames).join(', ') +
          ']'
      );
      // Defensive: if the store somehow doesn't exist (stale DB from a prior
      // buggy build), reject so the caller can recover.
      if (!db.objectStoreNames.contains(STORE)) {
        log('getDb: WARNING — store missing in v' + DB_VERSION + ', deleting DB');
        db.close();
        dbPromise = null;
        const delReq = indexedDB.deleteDatabase(DB_NAME);
        delReq.onsuccess = () => {
          log('getDb: stale DB deleted; reopening');
          resolve(getDb());
        };
        delReq.onerror = () => reject(delReq.error);
        return;
      }
      resolve(db);
    };
    req.onerror = () => {
      log('getDb: open error', req.error);
      reject(req.error);
    };
    req.onblocked = () => log('getDb: open blocked');
  });
  return dbPromise;
};

export const saveEpubBlob = async (bookId, blob) => {
  log('save: ENTER bookId="' + bookId + '" hasBlob=' + !!blob);
  if (!bookId || !blob) return false;
  try {
    const db = await getDb();
    log('save: got db, starting transaction');
    const ok = await new Promise((resolve) => {
      let tx;
      try {
        tx = db.transaction(STORE, 'readwrite');
      } catch (e) {
        log('save: db.transaction THREW', e);
        resolve(false);
        return;
      }
      const req = tx.objectStore(STORE).put(blob, bookId);
      req.onerror = () => log('save: put req error', req.error);
      req.onsuccess = () => log('save: put req success');
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => {
        log('save: tx error', tx.error);
        resolve(false);
      };
      tx.onabort = () => {
        log('save: tx abort', tx.error);
        resolve(false);
      };
    });
    log('save: EXIT bookId="' + bookId + '" size=' + (blob.size ?? '?') + ' → ' + (ok ? 'OK' : 'FAIL'));
    return ok;
  } catch (err) {
    log('save: exception', err);
    return false;
  }
};

export const getEpubBlob = async (bookId) => {
  log('get: ENTER bookId="' + bookId + '"');
  if (!bookId) return null;
  try {
    const db = await getDb();
    log('get: got db, starting transaction');
    const result = await new Promise((resolve) => {
      let tx;
      try {
        tx = db.transaction(STORE, 'readonly');
      } catch (e) {
        log('get: db.transaction THREW', e);
        resolve(null);
        return;
      }
      const req = tx.objectStore(STORE).get(bookId);
      req.onsuccess = () => {
        log('get: req success, result=', req.result ? `Blob(size=${req.result.size})` : 'null');
        resolve(req.result || null);
      };
      req.onerror = () => {
        log('get: req error', req.error);
        resolve(null);
      };
      tx.onerror = () => log('get: tx error', tx.error);
      tx.onabort = () => log('get: tx abort', tx.error);
      tx.oncomplete = () => log('get: tx complete');
    });
    log('get: EXIT bookId="' + bookId + '" → ' + (result ? 'FOUND' : 'MISS'));
    return result;
  } catch (err) {
    log('get: exception', err);
    return null;
  }
};

export const deleteEpubBlob = async (bookId) => {
  if (!bookId) return false;
  try {
    const db = await getDb();
    return await new Promise((resolve) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(bookId);
      tx.oncomplete = () => {
        log('delete: bookId="' + bookId + '" OK');
        resolve(true);
      };
      tx.onerror = () => resolve(false);
    });
  } catch {
    return false;
  }
};

export const listEpubBlobKeys = async () => {
  try {
    const db = await getDb();
    return await new Promise((resolve) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).getAllKeys();
      req.onsuccess = () => {
        log('listKeys:', req.result);
        resolve(req.result || []);
      };
      req.onerror = () => resolve([]);
    });
  } catch (err) {
    log('listKeys: exception', err);
    return [];
  }
};
