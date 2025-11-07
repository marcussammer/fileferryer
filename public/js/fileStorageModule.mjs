const DEFAULT_DB_NAME = 'file-storage-module';
const DEFAULT_STORE_NAME = 'registry';
const DEFAULT_NATIVE_HANDLE_STORE_NAME = 'nativeHandles';
const DEFAULT_DB_VERSION = 1;
const DEFAULT_STORAGE_TYPE = 'uninitialized';
const NATIVE_HANDLE_STORAGE_TYPE = 'native-handle';

const STORE_DEFINITIONS = new Map([
  [DEFAULT_STORE_NAME, { keyPath: 'key' }],
  [DEFAULT_NATIVE_HANDLE_STORE_NAME, { keyPath: 'key' }]
]);

const ensureStores = (db, requestedStore) => {
  const stores = new Map(STORE_DEFINITIONS);

  if (requestedStore && !stores.has(requestedStore)) {
    stores.set(requestedStore, { keyPath: 'key' });
  }

  stores.forEach((options, name) => {
    if (!db.objectStoreNames.contains(name)) {
      db.createObjectStore(name, options);
    }
  });
};

const defaultOpenDatabase = ({ name, version, storeName }) =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open(name, version);

    request.onerror = () => reject(request.error);
    request.onupgradeneeded = () => {
      const db = request.result;
      ensureStores(db, storeName);
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

const isFileSystemHandle = (candidate) =>
  Boolean(
    candidate &&
      typeof candidate === 'object' &&
      typeof candidate.kind === 'string' &&
      typeof candidate.name === 'string'
  );

const summarizeHandles = (handles = []) =>
  handles.reduce(
    (acc, handle) => {
      if (handle.kind === 'directory') {
        acc.directories += 1;
      } else {
        acc.files += 1;
      }
      acc.handles += 1;
      return acc;
    },
    { files: 0, directories: 0, handles: 0 }
  );

const normalizePermissionState = (state) =>
  state === 'granted' || state === 'denied' || state === 'prompt'
    ? state
    : 'unknown';

const aggregatePermissionState = (states) => {
  if (!states.length) {
    return 'unknown';
  }
  if (states.every((state) => state === 'granted')) {
    return 'granted';
  }
  if (states.some((state) => state === 'denied')) {
    return 'denied';
  }
  if (states.some((state) => state === 'prompt')) {
    return 'prompt';
  }
  return 'unknown';
};

const requestHandlePermission = async (handle, mode) => {
  if (typeof handle?.requestPermission === 'function') {
    return normalizePermissionState(await handle.requestPermission({ mode }));
  }
  if (typeof handle?.queryPermission === 'function') {
    return normalizePermissionState(await handle.queryPermission({ mode }));
  }
  return 'unknown';
};

export const createNativeHandleBackend = (options = {}) => {
  const {
    registry,
    dbName = DEFAULT_DB_NAME,
    storeName = DEFAULT_NATIVE_HANDLE_STORE_NAME,
    dbVersion = DEFAULT_DB_VERSION,
    openDatabase = defaultOpenDatabase,
    now = () => Date.now(),
    permissionRequester = requestHandlePermission
  } = options;

  if (!registry) {
    throw new Error('createNativeHandleBackend requires a registry instance');
  }

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

  const persistHandles = async (handles, metadata = {}) => {
    if (!Array.isArray(handles) || handles.length === 0) {
      throw new Error('persistHandles requires a non-empty handles array');
    }

    const invalidHandle = handles.find((handle) => !isFileSystemHandle(handle));
    if (invalidHandle) {
      throw new Error(
        `persistHandles expected FileSystem handles but received ${typeof invalidHandle}`
      );
    }

    const key = metadata.key ?? registry.generateKey();
    const createdAt = metadata.createdAt ?? now();
    const summary = summarizeHandles(handles);
    const record = {
      key,
      handles,
      createdAt,
      updatedAt: metadata.updatedAt ?? createdAt,
      fileCount: summary.files,
      directoryCount: summary.directories,
      handleCount: summary.handles
    };

    await withStore('readwrite', (store) => {
      const request = store.put(record);
      return toRequestPromise(request);
    });

    try {
      await registry.registerKey(key, {
        storageType: NATIVE_HANDLE_STORAGE_TYPE,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt
      });
    } catch (error) {
      await withStore('readwrite', (store) => {
        const request = store.delete(key);
        return toRequestPromise(request);
      }).catch(() => {});
      throw error;
    }

    return {
      ok: true,
      key,
      storageType: NATIVE_HANDLE_STORAGE_TYPE,
      counts: summary,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt
    };
  };

  const getRecord = async (key) =>
    withStore('readonly', (store) => toRequestPromise(store.get(key)));

  const getHandles = async (key) => {
    const record = await getRecord(key);
    return record?.handles ?? null;
  };

  const remove = async (key) => {
    if (!key) {
      return { ok: false, reason: 'missing-key' };
    }

    await withStore('readwrite', (store) => {
      const request = store.delete(key);
      return toRequestPromise(request);
    });
    await registry.removeKey(key);

    return { ok: true, key };
  };

  const requestPermissions = async (key, options = {}) => {
    const record = await getRecord(key);
    if (!record) {
      return { ok: false, state: 'missing', reason: 'unknown-key' };
    }

    const mode = options.mode ?? 'read';
    const results = [];

    for (const handle of record.handles) {
      try {
        results.push(await permissionRequester(handle, mode));
      } catch {
        results.push('denied');
      }
    }

    const state = aggregatePermissionState(results);

    return {
      ok: state === 'granted',
      key,
      state,
      counts: {
        files: record.fileCount ?? 0,
        directories: record.directoryCount ?? 0,
        handles: record.handleCount ?? record.handles.length
      }
    };
  };

  return {
    ensureDb,
    persistHandles,
    getRecord,
    getHandles,
    remove,
    requestPermissions
  };
};

const registry = createRegistry();
const nativeHandles = createNativeHandleBackend({ registry });

const fileStorageModule = {
  registry,
  nativeHandles,
  async init() {
    await Promise.all([registry.ensureDb(), nativeHandles.ensureDb()]);
    return registry;
  }
};

export default fileStorageModule;
