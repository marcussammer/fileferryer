import { describe, expect, it, vi } from 'vitest';
import {
  createNativeHandleBackend,
  createRegistry
} from '../../public/js/fileStorageModule.mjs';
import { groundTruthCounts } from '../../public/tests/file_storage_module/fixtures/groundTruthManifest.js';
import { createFakeNativeHandles } from './helpers/fakeHandles.js';

const deleteDatabase = (name) =>
  new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Database deletion blocked'));
    request.onsuccess = () => resolve();
  });

const createHandleStub = ({
  name = 'handle',
  kind = 'file',
  permissionState = 'granted',
  shouldThrow = false
} = {}) => ({
  kind,
  name,
  permissionState,
  shouldThrow
});

const createTestEnvironment = () => {
  const dbName = `file-storage-${Math.random().toString(36).slice(2)}`;
  const registry = createRegistry({ dbName });
  const permissionRequester = vi.fn(async (handle) => {
    if (handle.shouldThrow) {
      throw new Error('permission failed');
    }
    return handle.permissionState ?? 'unknown';
  });
  const backend = createNativeHandleBackend({
    registry,
    dbName,
    permissionRequester
  });
  return { registry, backend, permissionRequester };
};

describe('createNativeHandleBackend', () => {
  it('persists handles and rehydrates metadata', async () => {
    const { registry, backend } = createTestEnvironment();
    const handles = [
      createHandleStub({ name: 'videos', kind: 'directory' }),
      createHandleStub({ name: 'clip.mp4', kind: 'file' })
    ];

    const result = await backend.persistHandles(handles);
    expect(result.ok).toBe(true);
    expect(result.storageType).toBe('native-handle');
    expect(result.counts).toEqual({ directories: 1, files: 1, handles: 2 });

    const record = await backend.getRecord(result.key);
    expect(record.handleCount).toBe(2);
    expect(record.directoryCount).toBe(1);
    expect(record.fileCount).toBe(1);

    const registryRecord = await registry.getRecord(result.key);
    expect(registryRecord).toBeTruthy();
    expect(registryRecord.storageType).toBe('native-handle');
  });

  it('removes records from both stores', async () => {
    const { registry, backend } = createTestEnvironment();
    const handles = [createHandleStub({ name: 'docs', kind: 'directory' })];
    const { key } = await backend.persistHandles(handles);

    const response = await backend.remove(key);
    expect(response).toEqual({ ok: true, key });
    expect(await backend.getRecord(key)).toBeUndefined();
    expect(await registry.getRecord(key)).toBeUndefined();
  });

  it('requests permissions across all handles and aggregates state', async () => {
    const { backend, permissionRequester } = createTestEnvironment();
    const handles = [
      createHandleStub({ name: 'ok', kind: 'directory', permissionState: 'granted' }),
      createHandleStub({ name: 'needs-permission', kind: 'file', permissionState: 'prompt' }),
      createHandleStub({ name: 'broken', kind: 'file', shouldThrow: true })
    ];

    const { key } = await backend.persistHandles(handles);
    const response = await backend.requestPermissions(key);

    expect(response.ok).toBe(false);
    expect(response.state).toBe('denied');
    expect(response.counts).toEqual({ directories: 1, files: 2, handles: 3 });
    expect(permissionRequester).toHaveBeenCalledTimes(handles.length);
  });

  it('returns missing state when a key is unknown', async () => {
    const { backend } = createTestEnvironment();
    const response = await backend.requestPermissions('nope');

    expect(response.ok).toBe(false);
    expect(response.state).toBe('missing');
    expect(response.reason).toBe('unknown-key');
  });

  it('upgrades databases that are missing the nativeHandles object store', async () => {
    const dbName = `legacy-db-${Math.random().toString(36).slice(2)}`;
    await deleteDatabase(dbName);

    await new Promise((resolve, reject) => {
      const request = indexedDB.open(dbName, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('registry')) {
          db.createObjectStore('registry', { keyPath: 'key' });
        }
      };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        request.result.close();
        resolve();
      };
    });

    const registry = createRegistry({ dbName });
    const backend = createNativeHandleBackend({ registry, dbName });
    const handles = [createHandleStub({ name: 'legacy', kind: 'file' })];

    const result = await backend.persistHandles(handles);
    expect(result.ok).toBe(true);

    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open(dbName);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });

    expect(db.objectStoreNames.contains('nativeHandles')).toBe(true);
    expect(db.version).toBeGreaterThan(1);
    db.close();
  });

  it('rehydrates stored handles and registry metadata across reopen', async () => {
    const dbName = `rehydrate-db-${Math.random().toString(36).slice(2)}`;
    await deleteDatabase(dbName);

    let timestamp = 5_000;
    const now = () => {
      timestamp += 1;
      return timestamp;
    };

    const registry = createRegistry({ dbName, now });
    const backend = createNativeHandleBackend({ registry, dbName, now });
    const handles = [
      createHandleStub({ name: 'family', kind: 'directory' }),
      createHandleStub({ name: 'clip.mov', kind: 'file' })
    ];

    const persisted = await backend.persistHandles(handles);

    const reopenedRegistry = createRegistry({ dbName });
    const reopenedBackend = createNativeHandleBackend({
      registry: reopenedRegistry,
      dbName
    });

    const record = await reopenedBackend.getRecord(persisted.key);
    expect(record).toBeTruthy();
    expect(record.handles).toHaveLength(handles.length);
    expect(record.handles[0].name).toBe(handles[0].name);
    expect(record.handleCount).toBe(persisted.counts.handles);
    expect(record.fileCount).toBe(persisted.counts.files);
    expect(record.directoryCount).toBe(persisted.counts.directories);
    expect(record.createdAt).toBeGreaterThan(5_000);
    expect(record.updatedAt).toBe(record.createdAt);

    const registryRecord = await reopenedRegistry.getRecord(persisted.key);
    expect(registryRecord?.storageType).toBe('native-handle');
    expect(registryRecord?.createdAt).toBe(record.createdAt);
    expect(registryRecord?.updatedAt).toBe(record.updatedAt);

    await reopenedBackend.remove(persisted.key);
  });

  it('captures ground-truth counts for nested directory selections', async () => {
    const { backend } = createTestEnvironment();
    const handles = createFakeNativeHandles();

    const result = await backend.persistHandles(handles);
    expect(result.counts.files).toBe(groundTruthCounts.files);
    expect(result.counts.directories).toBe(groundTruthCounts.directories);

    const record = await backend.getRecord(result.key);
    expect(record?.fileCount).toBe(groundTruthCounts.files);
    expect(record?.directoryCount).toBe(groundTruthCounts.directories);
  });
});
