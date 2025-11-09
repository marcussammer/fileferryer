import { expect } from '@esm-bundle/chai';

describe('file storage module smoke (sanity only)', () => {
  it('initializes without throwing and logs no errors', async () => {
    const consoleErrors = [];
    const originalError = console.error;
    console.error = (...args) => {
      consoleErrors.push(args);
      originalError.apply(console, args);
    };

    try {
      const module = await import('../../js/fileStorageModule.mjs');
      expect(module?.default).to.be.an('object');
      await module.default.init();
      expect(consoleErrors).to.have.length(0);
    } finally {
      console.error = originalError;
    }
  });
});
