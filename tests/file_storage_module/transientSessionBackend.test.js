import { describe, expect, it } from 'vitest';
import {
  createTransientSessionBackend,
  createRegistry
} from '../../public/js/fileStorageModule.mjs';
import {
  createTransientFixture,
  groundTruthCounts
} from '../../public/tests/file_storage_module/fixtures/groundTruthManifest.js';

const createFakeWindow = () => {
  const listeners = new Map();
  return {
    addEventListener(event, handler) {
      const existing = listeners.get(event) ?? [];
      listeners.set(event, [...existing, handler]);
    },
    dispatch(event) {
      const handlers = listeners.get(event) ?? [];
      handlers.forEach((handler) => handler({ type: event }));
    }
  };
};

describe('createTransientSessionBackend', () => {
  it('stores entry-like objects in memory and reports counts', () => {
    const backend = createTransientSessionBackend({ now: () => 1000 });
    const entries = [
      { name: 'video.mp4', size: 1_024_000 },
      { name: 'photos', isDirectory: true }
    ];

    const result = backend.persistEntries(entries);
    expect(result.ok).toBe(true);
    expect(result.storageType).toBe('transient-session');
    expect(result.counts).toEqual({ files: 1, directories: 1, handles: 2 });

    const stored = backend.getEntries(result.key);
    expect(stored).toHaveLength(2);
    expect(backend.listKeys()).toContain(result.key);
  });

  it('exposes full session metadata for active keys', () => {
    const backend = createTransientSessionBackend();
    const { key } = backend.persistEntries([{ name: 'huge.mov', size: 99_000 }]);

    const session = backend.getSession(key);
    expect(session).toBeTruthy();
    expect(session?.counts).toEqual({ files: 1, directories: 0, handles: 1 });
    expect(backend.getStatus(key)?.status).toBe('active');
  });

  it('cleans up entries on beforeunload and reports expiration', () => {
    const fakeWindow = createFakeWindow();
    const backend = createTransientSessionBackend({
      beforeUnloadTarget: fakeWindow,
      now: () => 5_000
    });
    const { key } = backend.persistEntries([{ name: 'temp.bin', size: 10 }]);

    expect(backend.listKeys()).toContain(key);
    fakeWindow.dispatch('beforeunload');

    expect(backend.listKeys()).toHaveLength(0);
    const status = backend.getStatus(key);
    expect(status?.status).toBe('expired');
    expect(status?.reason).toBe('page-unload');
  });

  it('never writes transient selections to IndexedDB', async () => {
    const registry = createRegistry({
      dbName: `registry-${Math.random().toString(36).slice(2)}`
    });
    const backend = createTransientSessionBackend();

    backend.persistEntries([{ name: 'one-off.txt', size: 1 }]);
    const keys = await registry.listKeys();

    expect(keys).toHaveLength(0);
  });

  it('matches ground-truth counts for serialized browser file inputs', () => {
    const backend = createTransientSessionBackend();
    const entries = createTransientFixture();

    const result = backend.persistEntries(entries);
    expect(result.counts.files).toBe(groundTruthCounts.files);
    expect(result.counts.directories).toBe(groundTruthCounts.directories);
  });
});
