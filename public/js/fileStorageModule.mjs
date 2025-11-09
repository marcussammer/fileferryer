const DEFAULT_DB_NAME = 'file-storage-module';
const DEFAULT_STORE_NAME = 'registry';
const DEFAULT_NATIVE_HANDLE_STORE_NAME = 'nativeHandles';
const DEFAULT_DB_VERSION = 1;
const DEFAULT_STORAGE_TYPE = 'uninitialized';
const NATIVE_HANDLE_STORAGE_TYPE = 'native-handle';
const TRANSIENT_STORAGE_TYPE = 'transient-session';

const STORE_DEFINITIONS = new Map([
  [DEFAULT_STORE_NAME, { keyPath: 'key' }],
  [DEFAULT_NATIVE_HANDLE_STORE_NAME, { keyPath: 'key' }]
]);

const closeDatabase = (db) => {
  try {
    if (db && typeof db.close === 'function') {
      db.close();
    }
  } catch {
    // Ignore close failures; IndexedDB will eventually release the handle.
  }
};

const attachVersionChangeAutoClose = (db) => {
  if (!db || typeof db.close !== 'function') {
    return;
  }
  const handler = () => {
    closeDatabase(db);
  };
  if (typeof db.addEventListener === 'function') {
    db.addEventListener('versionchange', handler);
  } else {
    db.onversionchange = handler;
  }
};

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

const MAX_DB_MIGRATION_ATTEMPTS = 3;

const defaultOpenDatabase = async ({ name, version, storeName }) => {
  let currentVersion = version;

  for (let attempt = 0; attempt < MAX_DB_MIGRATION_ATTEMPTS; attempt += 1) {
    let db;
    try {
      db = await new Promise((resolve, reject) => {
        const hasExplicitVersion =
          typeof currentVersion === 'number' && !Number.isNaN(currentVersion);
        const request = hasExplicitVersion
          ? indexedDB.open(name, currentVersion)
          : indexedDB.open(name);

        request.onerror = () => reject(request.error);
        request.onblocked = () =>
          reject(
            Object.assign(
              new Error('IndexedDB upgrade blocked by another open connection'),
              { name: 'BlockedError' }
            )
          );
        request.onupgradeneeded = () => {
          const upgradeDb = request.result;
          ensureStores(upgradeDb, storeName);
        };
        request.onsuccess = () => {
          const result = request.result;
          attachVersionChangeAutoClose(result);
          resolve(result);
        };
      });
    } catch (error) {
      if (error?.name === 'VersionError' || error?.name === 'BlockedError') {
        currentVersion = undefined;
        continue;
      }
      throw error;
    }

    const hasRequestedStore =
      !storeName || db.objectStoreNames.contains(storeName);
    if (hasRequestedStore) {
      return db;
    }

    const nextVersion =
      typeof currentVersion === 'number' && currentVersion >= db.version
        ? currentVersion + 1
        : db.version + 1;
    currentVersion = nextVersion;
    closeDatabase(db);
  }

  throw new Error(
    `Failed to provision object store "${storeName}" for database "${name}".`
  );
};

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

  const withStore = async (mode, run, retryCount = 0) => {
    const db = await ensureDb();
    let tx;
    try {
      tx = db.transaction(storeName, mode);
    } catch (error) {
      if (
        error?.name === 'NotFoundError' &&
        retryCount + 1 < MAX_DB_MIGRATION_ATTEMPTS
      ) {
        dbPromise = undefined;
        closeDatabase(db);
        return withStore(mode, run, retryCount + 1);
      }
      throw error;
    }
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

const isAsyncIterable = (candidate) =>
  Boolean(candidate && typeof candidate[Symbol.asyncIterator] === 'function');

const createDirectoryIterator = (directoryHandle) => {
  if (!directoryHandle) {
    return null;
  }
  if (typeof directoryHandle.values === 'function') {
    const iterator = directoryHandle.values();
    if (isAsyncIterable(iterator)) {
      return iterator;
    }
  }
  if (typeof directoryHandle.entries === 'function') {
    const iterator = directoryHandle.entries();
    if (isAsyncIterable(iterator)) {
      return {
        async *[Symbol.asyncIterator]() {
          for await (const [, child] of iterator) {
            yield child;
          }
        }
      };
    }
  }
  if (isAsyncIterable(directoryHandle)) {
    return directoryHandle;
  }
  return null;
};

const summarizeDirectoryChildren = async (directoryHandle, context) => {
  const summary = { files: 0, directories: 0 };
  const iterator = createDirectoryIterator(directoryHandle);

  if (!iterator) {
    return summary;
  }

  for await (const entry of iterator) {
    if (!isFileSystemHandle(entry)) {
      continue;
    }
    if (entry.kind === 'file') {
      summary.files += 1;
    } else if (entry.kind === 'directory') {
      summary.directories += 1;
      if (!context.seen.has(entry)) {
        context.seen.add(entry);
        const nested = await summarizeDirectoryChildren(entry, context);
        summary.files += nested.files;
        summary.directories += nested.directories;
      }
    }
  }

  return summary;
};

const summarizeHandles = async (handles = []) => {
  const summary = { files: 0, directories: 0, handles: 0 };
  const context = { seen: new Set() };

  for (const handle of handles) {
    if (!isFileSystemHandle(handle)) {
      continue;
    }
    summary.handles += 1;

    if (handle.kind === 'file') {
      summary.files += 1;
      continue;
    }

    if (handle.kind === 'directory') {
      summary.directories += 1;
      if (!context.seen.has(handle)) {
        context.seen.add(handle);
        const nested = await summarizeDirectoryChildren(handle, context);
        summary.files += nested.files;
        summary.directories += nested.directories;
      }
    }
  }

  return summary;
};

const normalizeSelectionInput = (input) => {
  if (input == null) {
    return [];
  }
  if (Array.isArray(input)) {
    return input;
  }
  if (
    typeof input.length === 'number' ||
    typeof input[Symbol.iterator] === 'function'
  ) {
    return Array.from(input);
  }
  return [input];
};

const isPureNativeSelection = (items = []) =>
  items.length > 0 && items.every((item) => isFileSystemHandle(item));

const hasMissingEntries = (freshCounts = {}, storedCounts = {}) => {
  const storedFiles = storedCounts.fileCount ?? storedCounts.files;
  const storedDirectories =
    storedCounts.directoryCount ?? storedCounts.directories;
  const missingFiles =
    typeof storedFiles === 'number' && freshCounts.files < storedFiles;
  const missingDirectories =
    typeof storedDirectories === 'number' &&
    freshCounts.directories < storedDirectories;
  return missingFiles || missingDirectories;
};

const mergeUniqueKeys = (primary = [], secondary = []) => {
  if (!secondary.length) {
    return primary.slice();
  }
  const seen = new Set(primary);
  const merged = primary.slice();
  for (const key of secondary) {
    if (!seen.has(key)) {
      merged.push(key);
      seen.add(key);
    }
  }
  return merged;
};

const isFileLike = (candidate) =>
  Boolean(
    candidate &&
      typeof candidate === 'object' &&
      typeof candidate.name === 'string' &&
      (typeof candidate.size === 'number' ||
        typeof candidate.lastModified === 'number' ||
        typeof candidate.type === 'string')
  );

const isEntryLike = (candidate) =>
  Boolean(
    candidate &&
      typeof candidate === 'object' &&
      (typeof candidate.kind === 'string' ||
        typeof candidate.fullPath === 'string' ||
        typeof candidate.path === 'string' ||
        typeof candidate.isFile === 'boolean' ||
        typeof candidate.isDirectory === 'boolean')
  );

const isTransientEntry = (candidate) => isFileLike(candidate) || isEntryLike(candidate);

const normalizeTransientEntries = (input) => {
  if (!input) {
    return [];
  }
  if (Array.isArray(input)) {
    return input;
  }
  if (typeof input.length === 'number' || typeof input[Symbol.iterator] === 'function') {
    return Array.from(input);
  }
  return [];
};

const deriveDirectorySegments = (entry) => {
  const rawPath =
    (typeof entry?.webkitRelativePath === 'string' &&
      entry.webkitRelativePath.length > 0 &&
      entry.webkitRelativePath) ||
    (typeof entry?.fullPath === 'string' && entry.fullPath) ||
    (typeof entry?.path === 'string' && entry.path) ||
    '';

  if (!rawPath.includes('/')) {
    return [];
  }

  const normalized = rawPath.replace(/\\/g, '/');
  const parts = normalized.split('/').filter(Boolean);
  if (!parts.length) {
    return [];
  }

  parts.pop(); // Remove terminal file segment.
  if (!parts.length) {
    return ['__root__'];
  }

  const directories = [];
  for (let i = 0; i < parts.length; i += 1) {
    directories.push(parts.slice(0, i + 1).join('/'));
  }
  return directories;
};

const isDirectoryLike = (entry) =>
  entry?.kind === 'directory' || entry?.isDirectory === true;

const isFileLikeEntry = (entry) =>
  entry?.kind === 'file' ||
  entry?.isFile === true ||
  isFileLike(entry || {});

const summarizeTransientEntries = (entries = []) => {
  const derivedDirectories = new Set();
  const summary = entries.reduce(
    (acc, entry) => {
      if (isDirectoryLike(entry)) {
        acc.directories += 1;
      } else if (isFileLikeEntry(entry)) {
        acc.files += 1;
        deriveDirectorySegments(entry).forEach((segment) =>
          derivedDirectories.add(segment)
        );
      } else {
        acc.files += 1;
      }
      acc.handles += 1;
      return acc;
    },
    { files: 0, directories: 0, handles: 0 }
  );

  if (derivedDirectories.size) {
    summary.directories += derivedDirectories.size;
  }

  return summary;
};

const DEFAULT_TRANSIENT_EXPIRATION_MESSAGE =
  'Transient selections live only in memory. Keep this tab open; reloading clears them.';

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

  const withStore = async (mode, run, retryCount = 0) => {
    const db = await ensureDb();
    let tx;
    try {
      tx = db.transaction(storeName, mode);
    } catch (error) {
      if (
        error?.name === 'NotFoundError' &&
        retryCount + 1 < MAX_DB_MIGRATION_ATTEMPTS
      ) {
        dbPromise = undefined;
        closeDatabase(db);
        return withStore(mode, run, retryCount + 1);
      }
      throw error;
    }
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
    const summary = await summarizeHandles(handles);
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

export const createTransientSessionBackend = (options = {}) => {
  const {
    keyFactory = generateRegistryKey,
    now = () => Date.now(),
    expirationMessage = DEFAULT_TRANSIENT_EXPIRATION_MESSAGE,
    beforeUnloadTarget = globalThis
  } = options;

  if (typeof keyFactory !== 'function') {
    throw new Error('createTransientSessionBackend requires a keyFactory function');
  }

  const sessions = new Map();
  const expiredSessions = new Map();
  let unloadListenerAttached = false;

  const expireAll = (reason = 'expired') => {
    if (!sessions.size) {
      return { count: 0 };
    }

    const expiredAt = now();
    for (const session of sessions.values()) {
      expiredSessions.set(session.key, {
        status: 'expired',
        reason,
        key: session.key,
        expiredAt,
        message: session.expires.message
      });
    }
    const count = sessions.size;
    sessions.clear();
    return { count };
  };

  const ensureBeforeUnloadListener = () => {
    if (unloadListenerAttached) {
      return;
    }
    if (
      beforeUnloadTarget &&
      typeof beforeUnloadTarget.addEventListener === 'function'
    ) {
      const handler = () => {
        expireAll('page-unload');
      };
      beforeUnloadTarget.addEventListener('beforeunload', handler);
      unloadListenerAttached = true;
    }
  };

  const persistEntries = (rawEntries, metadata = {}) => {
    const entries = normalizeTransientEntries(rawEntries);
    if (!entries.length) {
      throw new Error('persistEntries requires a non-empty entries array');
    }

    const invalidEntry = entries.find((entry) => !isTransientEntry(entry));
    if (invalidEntry) {
      throw new Error('persistEntries expected File or entry-like objects');
    }

    const key = metadata.key ?? keyFactory();
    const createdAt = metadata.createdAt ?? now();
    const storedEntries = entries.map((entry) => entry);
    const counts = summarizeTransientEntries(storedEntries);
    const session = {
      key,
      entries: storedEntries,
      createdAt,
      updatedAt: metadata.updatedAt ?? createdAt,
      counts,
      expires: {
        reason: 'page-unload',
        message: expirationMessage
      }
    };

    sessions.set(key, session);
    expiredSessions.delete(key);
    ensureBeforeUnloadListener();

    return {
      ok: true,
      key,
      storageType: TRANSIENT_STORAGE_TYPE,
      counts,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      expires: { ...session.expires }
    };
  };

  const expireSession = (key, reason = 'expired') => {
    const session = sessions.get(key);
    if (!session) {
      return { ok: false, reason: 'unknown-key' };
    }

    sessions.delete(key);
    expiredSessions.set(key, {
      status: 'expired',
      reason,
      key,
      expiredAt: now(),
      message: session.expires.message
    });

    return { ok: true, key, reason };
  };

  const getEntries = (key) => {
    const session = sessions.get(key);
    return session ? session.entries.slice() : null;
  };

  const getSession = (key) => {
    const session = sessions.get(key);
    if (!session) {
      return null;
    }
    return {
      key: session.key,
      counts: { ...session.counts },
      expires: { ...session.expires },
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      entries: session.entries.slice()
    };
  };

  const listKeys = () => Array.from(sessions.keys());

  const getStatus = (key) => {
    if (sessions.has(key)) {
      const session = sessions.get(key);
      return {
        status: 'active',
        key,
        expires: { ...session.expires },
        createdAt: session.createdAt,
        updatedAt: session.updatedAt
      };
    }
    if (expiredSessions.has(key)) {
      return expiredSessions.get(key);
    }
    return { status: 'missing', reason: 'unknown-key', key };
  };

  const remove = (key) => {
    const removedActive = sessions.delete(key);
    const removedExpired = expiredSessions.delete(key);
    if (removedActive || removedExpired) {
      return { ok: true, key };
    }
    return { ok: false, reason: 'unknown-key' };
  };

  return {
    persistEntries,
    getEntries,
    getSession,
    listKeys,
    expireSession,
    expireAll,
    getStatus,
    remove
  };
};

const registry = createRegistry();
const nativeHandles = createNativeHandleBackend({ registry });
const transientSessions = createTransientSessionBackend();

const resolveStorageLookup = async (key) => {
  if (!key) {
    return { ok: false, reason: 'missing-key' };
  }

  const registryRecord = await registry.getRecord(key);
  if (registryRecord) {
    return {
      ok: true,
      key,
      storageType: registryRecord.storageType ?? DEFAULT_STORAGE_TYPE,
      source: 'registry',
      record: registryRecord
    };
  }

  const session = transientSessions.getSession(key);
  if (session) {
    return {
      ok: true,
      key,
      storageType: TRANSIENT_STORAGE_TYPE,
      source: 'transient-session',
      session
    };
  }

  const status = transientSessions.getStatus(key);
  if (status?.status === 'expired') {
    return {
      ok: false,
      key,
      storageType: TRANSIENT_STORAGE_TYPE,
      reason: 'transient-expired',
      status
    };
  }

  return { ok: false, key, reason: 'unknown-key' };
};

const recountNativeHandles = async (key) => {
  const record = await nativeHandles.getRecord(key);
  if (!record) {
    return { ok: false, reason: 'unknown-key' };
  }

  let counts;
  try {
    counts = await summarizeHandles(record.handles);
  } catch (error) {
    return { ok: false, reason: 'traversal-error', error };
  }

  const partial = hasMissingEntries(counts, record);
  return {
    ok: true,
    counts,
    partial,
    reason: partial ? 'entries-missing' : undefined,
    record
  };
};

const summarizeTransientSession = (session) => ({
  counts: summarizeTransientEntries(session.entries),
  expires: { ...session.expires },
  createdAt: session.createdAt,
  updatedAt: session.updatedAt
});

const fileStorageModule = {
  registry,
  nativeHandles,
  transientSessions,
  async init() {
    await Promise.all([registry.ensureDb(), nativeHandles.ensureDb()]);
    return registry;
  },
  async add(selection, metadata = {}) {
    const normalized = normalizeSelectionInput(selection);
    if (!normalized.length) {
      return { ok: false, reason: 'no-selection' };
    }

    try {
      if (isPureNativeSelection(normalized)) {
        return await nativeHandles.persistHandles(normalized, metadata);
      }
      return transientSessions.persistEntries(normalized, metadata);
    } catch (error) {
      return { ok: false, reason: 'storage-failure', error };
    }
  },
  async listKeys(options = {}) {
    const registryKeys = await registry.listKeys();
    if (options.includeTransient === false) {
      return registryKeys;
    }
    const transientKeys = transientSessions.listKeys();
    return mergeUniqueKeys(registryKeys, transientKeys);
  },
  async getStorageType(key) {
    const lookup = await resolveStorageLookup(key);
    if (!lookup.ok) {
      return lookup;
    }
    return {
      ok: true,
      key,
      storageType: lookup.storageType,
      source: lookup.source
    };
  },
  async exists(key, options = {}) {
    const lookup = await resolveStorageLookup(key);
    if (!lookup.ok) {
      if (lookup.reason === 'transient-expired') {
        return {
          ok: true,
          exists: false,
          storageType: lookup.storageType,
          reason: lookup.reason
        };
      }
      return { ok: true, exists: false, reason: lookup.reason };
    }

    if (lookup.storageType === NATIVE_HANDLE_STORAGE_TYPE) {
      const record = await nativeHandles.getRecord(key);
      if (!record) {
        return { ok: true, exists: false, reason: 'unknown-key' };
      }
      if (options.verifyPermissions) {
        const response = await nativeHandles.requestPermissions(key, {
          mode: options.mode ?? 'read'
        });
        if (!response.ok) {
          const reason =
            response.state === 'missing' ? 'unknown-key' : 'permission-denied';
          return { ok: true, exists: false, reason, state: response.state };
        }
      }
      return { ok: true, exists: true, storageType: lookup.storageType };
    }

    if (lookup.storageType === TRANSIENT_STORAGE_TYPE) {
      const session = lookup.session ?? transientSessions.getSession(key);
      if (!session) {
        return {
          ok: true,
          exists: false,
          storageType: lookup.storageType,
          reason: 'transient-expired'
        };
      }
      return {
        ok: true,
        exists: true,
        storageType: lookup.storageType,
        expires: { ...session.expires }
      };
    }

    return { ok: false, exists: false, reason: 'unsupported-storage' };
  },
  async getFileCount(key) {
    const lookup = await resolveStorageLookup(key);
    if (!lookup.ok) {
      return {
        ok: false,
        reason: lookup.reason,
        storageType: lookup.storageType
      };
    }

    if (lookup.storageType === NATIVE_HANDLE_STORAGE_TYPE) {
      const recount = await recountNativeHandles(key);
      if (!recount.ok) {
        return {
          ok: false,
          reason: recount.reason,
          storageType: lookup.storageType,
          error: recount.error
        };
      }
      return {
        ok: true,
        key,
        storageType: lookup.storageType,
        counts: recount.counts,
        partial: recount.partial,
        reason: recount.partial ? recount.reason : undefined
      };
    }

    if (lookup.storageType === TRANSIENT_STORAGE_TYPE) {
      const session = lookup.session ?? transientSessions.getSession(key);
      if (!session) {
        return {
          ok: false,
          reason: 'transient-expired',
          storageType: lookup.storageType
        };
      }
      const summary = summarizeTransientSession(session);
      return {
        ok: true,
        key,
        storageType: lookup.storageType,
        counts: summary.counts,
        partial: false,
        expires: summary.expires
      };
    }

    return { ok: false, reason: 'unsupported-storage' };
  },
  async remove(key) {
    const lookup = await resolveStorageLookup(key);
    if (!lookup.ok) {
      if (lookup.reason === 'transient-expired') {
        transientSessions.remove(key);
        return { ok: true, key, reason: lookup.reason };
      }
      return { ok: false, reason: lookup.reason };
    }

    if (lookup.storageType === NATIVE_HANDLE_STORAGE_TYPE) {
      return nativeHandles.remove(key);
    }
    if (lookup.storageType === TRANSIENT_STORAGE_TYPE) {
      const result = transientSessions.remove(key);
      if (!result.ok) {
        return { ok: false, reason: result.reason };
      }
      return result;
    }
    return { ok: false, reason: 'unsupported-storage' };
  },
  async requestPermissions(key, options) {
    const lookup = await resolveStorageLookup(key);
    if (!lookup.ok) {
      return {
        ok: false,
        reason: lookup.reason,
        storageType: lookup.storageType
      };
    }
    if (lookup.storageType !== NATIVE_HANDLE_STORAGE_TYPE) {
      return {
        ok: false,
        reason: 'unsupported-storage',
        storageType: lookup.storageType
      };
    }
    return nativeHandles.requestPermissions(key, options);
  }
};

export default fileStorageModule;
