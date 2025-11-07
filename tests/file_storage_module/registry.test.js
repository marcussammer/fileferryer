import { describe, expect, it, vi } from 'vitest';
import {
  createRegistry,
  generateRegistryKey
} from '../../public/js/fileStorageModule.mjs';

describe('generateRegistryKey', () => {
  it('returns unique keys with the fs- prefix', () => {
    const keyA = generateRegistryKey();
    const keyB = generateRegistryKey();

    expect(keyA).toMatch(/^fs-/);
    expect(keyB).toMatch(/^fs-/);
    expect(keyA).not.toEqual(keyB);
  });
});

describe('createRegistry', () => {
  it('defers IndexedDB initialization until needed', async () => {
    const openDatabase = vi.fn(async () => ({
      transaction: vi.fn()
    }));

    const registry = createRegistry({ openDatabase });
    expect(openDatabase).not.toHaveBeenCalled();

    await registry.ensureDb();
    expect(openDatabase).toHaveBeenCalledTimes(1);

    await registry.ensureDb();
    expect(openDatabase).toHaveBeenCalledTimes(1);
  });

  it('persists registered keys to IndexedDB', async () => {
    const registry = createRegistry();
    const record = await registry.registerKey(undefined, {
      storageType: 'native-handle'
    });

    const keys = await registry.listKeys();
    expect(keys).toContain(record.key);

    const persisted = await registry.getRecord(record.key);
    expect(persisted).toBeTruthy();
    expect(persisted.storageType).toBe('native-handle');
  });
});
