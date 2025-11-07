import { expect } from '@esm-bundle/chai';

const createHandleStub = (name, kind = 'directory') => ({
  name,
  kind
});

describe('file storage module smoke', () => {
  it('persists native handles, lists them, and removes them', async () => {
    const { default: fileStorageModule } = await import(
      '../js/fileStorageModule.mjs'
    );

    await fileStorageModule.init();

    const fakeHandles = [
      createHandleStub('photos', 'directory'),
      createHandleStub('videos', 'directory'),
      createHandleStub('clip.mp4', 'file')
    ];

    const persisted = await fileStorageModule.nativeHandles.persistHandles(
      fakeHandles
    );
    expect(persisted.ok).to.equal(true);
    expect(persisted.storageType).to.equal('native-handle');

    const keys = await fileStorageModule.registry.listKeys();
    expect(keys).to.include(persisted.key);

    const removal = await fileStorageModule.nativeHandles.remove(persisted.key);
    expect(removal.ok).to.equal(true);

    const finalKeys = await fileStorageModule.registry.listKeys();
    expect(finalKeys).to.not.include(persisted.key);
  });
});
