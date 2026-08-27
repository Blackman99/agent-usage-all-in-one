import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      $core: fileURLToPath(new URL('./src/core', import.meta.url)),
      $server: fileURLToPath(new URL('./src/server', import.meta.url))
    }
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    restoreMocks: true
  }
});
