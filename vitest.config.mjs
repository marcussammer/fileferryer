import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'happy-dom',
    setupFiles: [
      'tests/file_storage_module/setup.js',
      'tests/browser_id_module/setup.js'
    ],
    include: [
      'tests/file_storage_module/**/*.test.js',
      'tests/browser_id_module/**/*.test.js'
    ],
    globals: true,
    pool: 'threads',
    poolOptions: {
      threads: {
        singleThread: true,
        isolate: true
      }
    }
  }
});
