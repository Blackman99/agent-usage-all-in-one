import { spawn } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import { connect as tcpConnect, createServer as createTcpServer } from 'node:net';
import { join, resolve } from 'node:path';

import { validateLoopbackOrigin } from './dev-origin.mjs';

const projectRoot = resolve(import.meta.dirname, '..');
const tsxImport = import.meta.resolve('tsx');
const developmentHome = resolve(
  process.env.AGENT_USAGE_DEV_HOME ?? join(projectRoot, '.agent-usage-dev')
);
const shouldOpen = !process.argv.includes('--no-open');

let daemon = null;
let vite = null;
let shuttingDown = false;
let stopDevelopment;
let requestedExitCode = 0;
const stopController = new AbortController();
const stopped = new Promise((resolveStopped) => {
  stopDevelopment = resolveStopped;
});

process.once('SIGINT', () => requestStop(0));
process.once('SIGTERM', () => requestStop(0));

try {
  await mkdir(developmentHome, { recursive: true, mode: 0o700 });
  daemon = spawn(
    process.execPath,
    ['--import', tsxImport, 'src/cli.ts', '--home', developmentHome, 'serve'],
    {
      cwd: projectRoot,
      env: {
        ...process.env,
        AGENT_USAGE_DAEMON: '1',
        AGENT_USAGE_KEYCHAIN_SERVICE: 'dev.agent-usage.secrets.development',
        AGENT_USAGE_LAUNCH_AGENT_LABEL: 'dev.agent-usage.daemon.development',
        AGENT_USAGE_NODE_IMPORT: tsxImport
      },
      stdio: ['ignore', 'inherit', 'inherit']
    }
  );
  daemon.once('exit', (code, signal) => {
    if (stopController.signal.aborted) return;
    process.stderr.write(
      `Agent Usage daemon stopped unexpectedly (${signal ?? `exit ${code ?? 1}`}).\n`
    );
    requestStop(code ?? 1);
  });

  const daemonState = await waitForDaemon(developmentHome, daemon, stopController.signal);
  throwIfStopping();
  const vitePort = await selectDevelopmentPort(process.env.AGENT_USAGE_DEV_PORT);
  const viteOrigin = `http://127.0.0.1:${vitePort}/`;
  vite = spawn(
    process.execPath,
    [
      join(projectRoot, 'node_modules', 'vite', 'bin', 'vite.js'),
      '--host',
      '127.0.0.1',
      '--port',
      String(vitePort),
      '--strictPort'
    ],
    {
      cwd: projectRoot,
      env: {
        ...process.env,
        AGENT_USAGE_DEV_DAEMON_ORIGIN: daemonState.origin,
        AGENT_USAGE_DEV_PORT: String(vitePort)
      },
      stdio: ['ignore', 'inherit', 'inherit']
    }
  );
  vite.once('exit', (code, signal) => {
    if (stopController.signal.aborted) return;
    process.stderr.write(`Vite stopped unexpectedly (${signal ?? `exit ${code ?? 1}`}).\n`);
    requestStop(code ?? 1);
  });
  await waitForVite(viteOrigin, vite, stopController.signal);
  throwIfStopping();

  const launchResponse = await fetch(`${daemonState.origin}/api/launch-token`, {
    method: 'POST',
    headers: { authorization: `Bearer ${daemonState.apiToken}` },
    signal: stopController.signal
  });
  throwIfStopping();
  if (!launchResponse.ok) {
    throw new Error(`Unable to create the development launch URL (HTTP ${launchResponse.status})`);
  }
  const daemonLaunch = new URL((await launchResponse.json()).url);
  const launchUrl = new URL('/launch', viteOrigin);
  launchUrl.search = daemonLaunch.search;

  throwIfStopping();
  process.stdout.write(`\nAgent Usage dev: ${launchUrl.toString()}\n`);
  process.stdout.write(`Development data: ${developmentHome}\n\n`);
  if (shouldOpen) {
    const { default: open } = await import('open');
    await open(launchUrl.toString());
  }

  const exitCode = await stopped;
  process.exitCode = exitCode;
} catch (error) {
  if (stopController.signal.aborted) {
    process.exitCode = requestedExitCode;
  } else {
    process.stderr.write(
      `Agent Usage dev failed: ${error instanceof Error ? error.message : 'Unexpected error'}\n`
    );
    process.exitCode = 1;
  }
} finally {
  await shutdown();
}

/**
 * @typedef {{ origin: string, apiToken: string }} DevelopmentDaemonState
 */

async function waitForDaemon(home, child, signal) {
  const statePath = join(home, 'daemon.json');
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    if (signal.aborted) throw new Error('Development startup stopped');
    if (child.exitCode !== null) throw new Error(`Local daemon exited with ${child.exitCode}`);
    try {
      const state = parseDaemonState(JSON.parse(await readFile(statePath, 'utf8')));
      if (await daemonIsHealthy(state)) {
        return state;
      }
    } catch {
      // The daemon is still starting or replacing a stale state file.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  }
  throw new Error('Local daemon did not become ready');
}

/**
 * @param {unknown} value
 * @returns {DevelopmentDaemonState}
 */
function parseDaemonState(value) {
  if (!value || typeof value !== 'object') throw new Error('Development daemon state is invalid');
  const candidate = /** @type {{ origin?: unknown, apiToken?: unknown }} */ (value);
  if (typeof candidate.origin !== 'string' || typeof candidate.apiToken !== 'string') {
    throw new Error('Development daemon state is invalid');
  }
  return {
    origin: validateLoopbackOrigin(candidate.origin),
    apiToken: candidate.apiToken
  };
}

async function daemonIsHealthy(state) {
  if (!(await portIsListening(state.origin))) return false;
  try {
    const response = await fetch(`${state.origin}/api/health`, {
      headers: { authorization: `Bearer ${state.apiToken}` },
      signal: AbortSignal.timeout(5_000)
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForVite(origin, child, signal) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (signal.aborted) throw new Error('Development startup stopped');
    if (child.exitCode !== null) throw new Error(`Vite exited with ${child.exitCode}`);
    if (await portIsListening(origin)) {
      try {
        const response = await fetch(origin, { signal: AbortSignal.timeout(5_000) });
        if (response.ok) return;
      } catch {
        // Vite is listening but is not serving the page yet.
      }
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  }
  throw new Error('Vite did not become ready');
}

// Readiness is polled over a plain socket rather than a request that is abandoned half a second
// later. An aborted request can throw from inside the HTTP client's own socket callbacks, where
// no `try` around the `await` reaches it, and one such throw ends the whole development run.
async function portIsListening(origin) {
  const { hostname, port } = new URL(origin);
  return await new Promise((resolveListening) => {
    const socket = tcpConnect({ host: hostname, port: Number(port) });
    const settle = (listening) => {
      socket.destroy();
      resolveListening(listening);
    };
    socket.setTimeout(500, () => settle(false));
    socket.once('connect', () => settle(true));
    socket.once('error', () => settle(false));
  });
}

async function selectDevelopmentPort(input) {
  const requested = Number(input ?? 5173);
  if (!Number.isInteger(requested) || requested < 0 || requested > 65_535) {
    throw new Error('AGENT_USAGE_DEV_PORT must be a valid TCP port');
  }
  if (requested === 0) return await availablePort(0);
  for (let candidate = requested; candidate < Math.min(65_536, requested + 20); candidate += 1) {
    if (await portIsAvailable(candidate)) return candidate;
  }
  throw new Error(`No development port is available near ${requested}`);
}

async function availablePort(port) {
  return await new Promise((resolvePort, reject) => {
    const server = createTcpServer();
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Unable to reserve a development port'));
        return;
      }
      server.close((error) => (error ? reject(error) : resolvePort(address.port)));
    });
  });
}

async function portIsAvailable(port) {
  try {
    await availablePort(port);
    return true;
  } catch {
    return false;
  }
}

function requestStop(exitCode) {
  requestedExitCode = exitCode;
  stopController.abort();
  stopDevelopment(exitCode);
}

function throwIfStopping() {
  if (stopController.signal.aborted) throw new Error('Development startup stopped');
}

async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  await Promise.all([terminateChild(vite), terminateChild(daemon)]);
}

async function terminateChild(child) {
  if (!child) return;
  await new Promise((resolveExit) => {
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
    }, 5_000);
    child.once('exit', () => {
      clearTimeout(timeout);
      resolveExit();
    });
    if (!child.kill('SIGTERM')) {
      clearTimeout(timeout);
      resolveExit();
    }
  });
}
