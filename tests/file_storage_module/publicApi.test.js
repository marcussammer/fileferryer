import { beforeEach, describe, expect, it } from 'vitest';
import fileStorageModule from '../../public/js/fileStorageModule.mjs';

const directoryState = new Map();
let directoryCounter = 0;

class DynamicDirectoryHandle {
  constructor(token) {
    this.kind = 'directory';
    this.name = token;
    this.token = token;
  }

  values() {
    const entries = directoryState.get(this.token) ?? [];
    return {
      async *[Symbol.asyncIterator]() {
        for (const entry of entries) {
          yield entry;
        }
      }
    };
  }
}

const createDirectoryHandle = (children = []) => {
  directoryCounter += 1;
  const token = `dir-${directoryCounter}`;
  const handle = new DynamicDirectoryHandle(token);
  directoryState.set(token, children);
  return handle;
};

class PermissionedFileHandle {
  constructor({ name = 'file.bin', state = 'granted' } = {}) {
    this.kind = 'file';
    this.name = name;
    this.state = state;
  }

  async requestPermission() {
    return this.state;
  }
}

const createPermissionedHandle = (options = {}) =>
  new PermissionedFileHandle(options);

const createTransientEntry = (name = 'temp.bin', size = 1) => ({
  name,
  size
});

const resetModuleState = async () => {
  await fileStorageModule.init();
  const existingKeys = await fileStorageModule.registry.listKeys();
  for (const key of existingKeys) {
    await fileStorageModule.nativeHandles.remove(key);
  }
  fileStorageModule.transientSessions.expireAll('test-reset');
  directoryState.clear();
};

beforeEach(resetModuleState);

describe('fileStorageModule public API', () => {
  it('adds native handles and reports their storage type', async () => {
    const directory = createDirectoryHandle([
      { kind: 'file', name: 'video.mp4' }
    ]);

    const result = await fileStorageModule.add([directory]);
    expect(result.ok).toBe(true);
    expect(result.storageType).toBe('native-handle');

    const keys = await fileStorageModule.listKeys();
    expect(keys).toContain(result.key);

    const storage = await fileStorageModule.getStorageType(result.key);
    expect(storage.ok).toBe(true);
    expect(storage.storageType).toBe('native-handle');
  });

  it('adds transient selections when native handles are unavailable', async () => {
    const result = await fileStorageModule.add([
      createTransientEntry('one.txt'),
      createTransientEntry('two.txt')
    ]);

    expect(result.ok).toBe(true);
    expect(result.storageType).toBe('transient-session');

    const keys = await fileStorageModule.listKeys();
    expect(keys).toContain(result.key);

    const storage = await fileStorageModule.getStorageType(result.key);
    expect(storage.storageType).toBe('transient-session');
  });

  it('lists registry keys plus active transient sessions', async () => {
    const native = await fileStorageModule.add([createDirectoryHandle([])]);
    const transient = await fileStorageModule.add([createTransientEntry('temp.bin')]);

    const keys = await fileStorageModule.listKeys();
    expect(keys).toEqual(expect.arrayContaining([native.key, transient.key]));
  });

  it('verifies permissions when exists() is called with verifyPermissions', async () => {
    const handle = createPermissionedHandle({ state: 'denied' });
    const { key } = await fileStorageModule.add([handle]);

    const stored = await fileStorageModule.nativeHandles.getRecord(key);
    expect(stored).toBeTruthy();

    const exists = await fileStorageModule.exists(key, {
      verifyPermissions: true,
      mode: 'read'
    });

    expect(exists.exists).toBe(false);
    expect(exists.reason).toBe('permission-denied');
  });

  it('returns unsupported reasons when requesting permissions for transient keys', async () => {
    const { key } = await fileStorageModule.add([createTransientEntry('temp.bin')]);
    const response = await fileStorageModule.requestPermissions(key);

    expect(response.ok).toBe(false);
    expect(response.reason).toBe('unsupported-storage');
  });

  it('reports partial results when native counts drop below stored totals', async () => {
    const directory = createDirectoryHandle([
      { kind: 'file', name: 'alpha.mov' },
      { kind: 'file', name: 'beta.mov' }
    ]);

    const registryRecord = await fileStorageModule.registry.registerKey(undefined, {
      storageType: 'native-handle'
    });

    const mockRecord = {
      key: registryRecord.key,
      handles: [directory],
      fileCount: 2,
      directoryCount: 1,
      handleCount: 1
    };

    const originalGetRecord = fileStorageModule.nativeHandles.getRecord;
    fileStorageModule.nativeHandles.getRecord = async (key) =>
      key === registryRecord.key ? mockRecord : originalGetRecord.call(fileStorageModule.nativeHandles, key);

    try {
      const baseline = await fileStorageModule.getFileCount(registryRecord.key);
      expect(baseline.counts.files).toBe(2);

      directoryState.set(directory.token, [{ kind: 'file', name: 'alpha.mov' }]);

      const counts = await fileStorageModule.getFileCount(registryRecord.key);
      expect(counts.ok).toBe(true);
      expect(counts.partial).toBe(true);
      expect(counts.reason).toBe('entries-missing');
      expect(counts.counts.files).toBe(1);
    } finally {
      fileStorageModule.nativeHandles.getRecord = originalGetRecord;
    }
  });

  it('removes both native and transient selections through the public remove()', async () => {
    const native = await fileStorageModule.add([createDirectoryHandle([])]);
    const transient = await fileStorageModule.add([createTransientEntry('temp.bin')]);

    const nativeRemoval = await fileStorageModule.remove(native.key);
    expect(nativeRemoval.ok).toBe(true);

    const transientRemoval = await fileStorageModule.remove(transient.key);
    expect(transientRemoval.ok).toBe(true);

    const remainingKeys = await fileStorageModule.listKeys();
    expect(remainingKeys).not.toContain(native.key);
    expect(remainingKeys).not.toContain(transient.key);
  });
});
