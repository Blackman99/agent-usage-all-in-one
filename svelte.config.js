import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

export default {
  preprocess: vitePreprocess(),
  kit: {
    alias: {
      $core: 'src/core',
      $server: 'src/server'
    },
    adapter: adapter({
      fallback: 'index.html',
      pages: 'dist/web',
      assets: 'dist/web'
    })
  }
};
