import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/cli.ts'],
  format: ['esm'],
  target: 'node24',
  platform: 'node',
  external: ['node:sqlite'],
  outDir: 'dist',
  clean: false,
  sourcemap: true,
  splitting: false,
  esbuildOptions(options) {
    options.supported = {
      ...options.supported,
      'node-colon-prefix-import': true,
      'node-colon-prefix-require': true
    };
  }
});
