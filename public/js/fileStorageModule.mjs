const DEFAULT_DB_NAME = 'file-storage-module';
const DEFAULT_STORE_NAME = 'registry';
const DEFAULT_DB_VERSION = 1;
const DEFAULT_STORAGE_TYPE = 'uninitialized';

const defaultOpenDatabase = ({ name, version, storeName }) =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open(name, version);

    request.onerror = () => reject(request.error);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(storeName)) {
        db.createObjectStore(storeName, { keyPath: 'key' });
      }
    };
    request.onsuccess = () => resolve(request.result);
  });

const toRequestPromise = (request) =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

export const generateRegistryKey = () => {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
    return `fs-${globalThis.crypto.randomUUID()}`;
  }

  const random = Math.random().toString(36).slice(2);
  const timestamp = Date.now().toString(36);
  return `fs-${random}${timestamp}`;
};

export const createRegistry = (options = {}) => {
  const {
    dbName = DEFAULT_DB_NAME,
    storeName = DEFAULT_STORE_NAME,
    dbVersion = DEFAULT_DB_VERSION,
    openDatabase = defaultOpenDatabase,
    now = () => Date.now(),
    keyFactory = generateRegistryKey
  } = options;

  let dbPromise;

  const ensureDb = () => {
    if (!dbPromise) {
      dbPromise = openDatabase({
        name: dbName,
        version: dbVersion,
        storeName
      });
    }
    return dbPromise;
  };

  const withStore = async (mode, run) => {
    const db = await ensureDb();
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    const resultPromise = Promise.resolve(run(store, tx));

    return new Promise((resolve, reject) => {
      tx.oncomplete = () => {
        resultPromise.then(resolve).catch(reject);
      };
      tx.onerror = () =>
        reject(tx.error ?? new Error('IndexedDB transaction failed'));
      tx.onabort = () =>
        reject(tx.error ?? new Error('IndexedDB transaction aborted'));
    });
  };

  const registerKey = async (key, metadata = {}) => {
    const newKey = key ?? keyFactory();
    const record = {
      key: newKey,
      storageType: metadata.storageType ?? DEFAULT_STORAGE_TYPE,
      createdAt: metadata.createdAt ?? now(),
      updatedAt: metadata.updatedAt ?? now()
    };

    await withStore('readwrite', (store) => {
      const request = store.put(record);
      return toRequestPromise(request);
    });

    return record;
  };

  const listKeys = async () =>
    withStore('readonly', (store) => toRequestPromise(store.getAllKeys()));

  const getRecord = async (key) =>
    withStore('readonly', (store) => toRequestPromise(store.get(key)));

  const removeKey = async (key) =>
    withStore('readwrite', (store) =>
      toRequestPromise(store.delete(key)).then(() => true)
    );

  const clear = async () =>
    withStore('readwrite', (store) =>
      toRequestPromise(store.clear()).then(() => true)
    );

  return {
    ensureDb,
    registerKey,
    listKeys,
    getRecord,
    removeKey,
    clear,
    generateKey: () => keyFactory(),
    describe: () => ({ dbName, storeName, dbVersion })
  };
};

const registry = createRegistry();

const fileStorageModule = {
  registry,
  async init() {
    await registry.ensureDb();
    return registry;
  }
};

export default fileStorageModule;
