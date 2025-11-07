import { expect } from '@esm-bundle/chai';

describe('file storage module smoke', () => {
  it('initializes the registry and writes a key', async () => {
    const { default: fileStorageModule } = await import('../js/fileStorageModule.mjs');

    const registry = await fileStorageModule.init();
    const { key } = await registry.registerKey(undefined, {
      storageType: 'test-smoke'
    });

    const record = await registry.getRecord(key);
    expect(record).to.deep.include({ key, storageType: 'test-smoke' });
  });
});
