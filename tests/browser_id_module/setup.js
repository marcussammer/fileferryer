import { beforeEach } from 'vitest';
import browserIdModule from '../../public/js/browserIdModule.mjs';

const clearStorage = (store) => {
  if (!store || typeof store.clear !== 'function') {
    return;
  }
  try {
    store.clear();
  } catch {
    // ignore
  }
};

const clearDocumentCookies = () => {
  if (typeof document === 'undefined' || !document.cookie) {
    return;
  }
  try {
    document.cookie
      .split(';')
      .map((entry) => entry.trim())
      .filter(Boolean)
      .forEach((cookie) => {
        const [name] = cookie.split('=');
        if (!name) {
          return;
        }
        document.cookie = `${name}=; expires=${new Date(0).toUTCString()}; path=/`;
      });
  } catch {
    // ignore cookie clearing issues in non-browser environments
  }
};

beforeEach(() => {
  browserIdModule.resetCache();
  clearStorage(globalThis.localStorage);
  clearStorage(globalThis.sessionStorage);
  clearDocumentCookies();
});
