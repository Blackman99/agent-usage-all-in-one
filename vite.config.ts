import { writeFileSync } from 'node:fs';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig, type Plugin, type ProxyOptions } from 'vite';
import { validateLoopbackOrigin } from './scripts/dev-origin.mjs';

const daemonOrigin = process.env.AGENT_USAGE_DEV_DAEMON_ORIGIN
  ? validateLoopbackOrigin(process.env.AGENT_USAGE_DEV_DAEMON_ORIGIN)
  : undefined;
const requestedDevelopmentPort = Number(process.env.AGENT_USAGE_DEV_PORT ?? 5173);
const developmentPort = Number.isFinite(requestedDevelopmentPort) ? requestedDevelopmentPort : 5173;
const developmentOrigin = `http://127.0.0.1:${developmentPort}`;

function daemonProxy(target: string): ProxyOptions {
  return {
    target,
    changeOrigin: true,
    configure(proxy) {
      proxy.on('proxyReq', (proxyRequest, request) => {
        if (request.headers.origin === developmentOrigin) {
          proxyRequest.setHeader('origin', target);
        }
      });
    }
  };
}

function packageNameFromModuleId(moduleId: string): string | null {
  const normalized = moduleId.split('?')[0].replaceAll('\\', '/');
  const marker = '/node_modules/';
  const dependencyPath = normalized.slice(normalized.lastIndexOf(marker) + marker.length);
  if (!normalized.includes(marker) || dependencyPath.startsWith('.pnpm/')) return null;
  const parts = dependencyPath.split('/');
  return parts[0].startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

function bundledDependencyManifest(): Plugin {
  return {
    name: 'agent-usage-bundled-dependency-manifest',
    generateBundle(outputOptions) {
      if (!outputOptions.dir?.replaceAll('\\', '/').includes('/output/client')) return;
      const packages = [
        ...new Set(
          [...this.getModuleIds()]
            .map(packageNameFromModuleId)
            .filter((name): name is string => name !== null)
        )
      ].sort();
      if (packages.length === 0) {
        throw new Error('Browser build did not expose any bundled dependencies.');
      }
      writeFileSync(
        new URL('./BUNDLED_DEPENDENCIES.json', import.meta.url),
        `${JSON.stringify({ packages }, null, 2)}\n`
      );
    }
  };
}

export default defineConfig({
  plugins: [sveltekit(), bundledDependencyManifest()],
  server: {
    host: '127.0.0.1',
    port: developmentPort,
    cors: {
      origin(origin, callback) {
        callback(null!, origin === developmentOrigin ? developmentOrigin : false);
      }
    },
    proxy: daemonOrigin
      ? {
          '/api': daemonProxy(daemonOrigin),
          '/launch': daemonProxy(daemonOrigin)
        }
      : undefined
  }
});
