import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig, type ProxyOptions } from 'vite';
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

export default defineConfig({
  plugins: [sveltekit()],
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
