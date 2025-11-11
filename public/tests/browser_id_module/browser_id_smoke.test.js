import { expect } from '@esm-bundle/chai';

describe('browser ID module smoke', () => {
  it('resolves tab identity and logs no console errors', async () => {
    const errors = [];
    const originalError = console.error;
    console.error = (...args) => {
      errors.push(args);
      originalError.apply(console, args);
    };

    try {
      const module = await import('../../js/browserIdModule.mjs');
      expect(module?.default).to.be.an('object');
      const ids = await module.default.getTabIdentity({ collisionWindowMs: 0 });
      expect(ids).to.have.property('browserId');
      expect(ids).to.have.property('tabId');
      expect(errors).to.have.length(0);
    } finally {
      console.error = originalError;
    }
  });
});
