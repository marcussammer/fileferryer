import { describe, expect, it, vi } from 'vitest';
import {
  createNativeHandleBackend,
  createRegistry
} from '../../public/js/fileStorageModule.mjs';

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
});
