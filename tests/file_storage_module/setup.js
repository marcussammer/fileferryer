import 'fake-indexeddb/auto';
import { beforeEach } from 'vitest';

// Ensure each test operates on a clean set of globals.
beforeEach(() => {
  if ('__fileStorageTestRegistry' in globalThis) {
    delete globalThis.__fileStorageTestRegistry;
  }
});
