// IndexedDB-backed store for EPUB file bytes. We use IndexedDB rather than
// localStorage because EPUBs commonly exceed localStorage's ~5MB cap.
// All operations swallow errors and return safe defaults so the app continues
// to work if storage is unavailable (private mode, quota exceeded, etc.).

const DB_NAME = 'epub-reader-files';
const DB_VERSION = 1;
const STORE = 'epubs';

let dbPromise = null;

const getDb = () => {
  if (typeof indexedDB === 'undefined') return Promise.reject(new Error('IndexedDB unavailable'));
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => {
      const db = req.result;
      // Defensive: if the store somehow doesn't exist (stale DB from a prior
      // buggy build), delete and reopen so a fresh schema is created.
      if (!db.objectStoreNames.contains(STORE)) {
        db.close();
        dbPromise = null;
        const delReq = indexedDB.deleteDatabase(DB_NAME);
        delReq.onsuccess = () => resolve(getDb());
        delReq.onerror = () => reject(delReq.error);
        return;
      }
      resolve(db);
    };
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
};

export const saveEpubBlob = async (bookId, blob) => {
  if (!bookId || !blob) return false;
  try {
    const db = await getDb();
    return await new Promise((resolve) => {
      let tx;
      try {
        tx = db.transaction(STORE, 'readwrite');
      } catch {
        resolve(false);
        return;
      }
      tx.objectStore(STORE).put(blob, bookId);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
      tx.onabort = () => resolve(false);
    });
  } catch {
    return false;
  }
};

export const getEpubBlob = async (bookId) => {
  if (!bookId) return null;
  try {
    const db = await getDb();
    return await new Promise((resolve) => {
      let tx;
      try {
        tx = db.transaction(STORE, 'readonly');
      } catch {
        resolve(null);
        return;
      }
      const req = tx.objectStore(STORE).get(bookId);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  } catch {
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
      tx.oncomplete = () => resolve(true);
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
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    });
  } catch {
    return [];
  }
};
