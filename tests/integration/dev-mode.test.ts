import { spawn, type ChildProcess } from 'node:child_process';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

const workspaces: string[] = [];
const children: ChildProcess[] = [];

afterEach(async () => {
  await Promise.all(children.splice(0).map(stopChild));
  await Promise.all(
    workspaces.splice(0).map((workspace) => rm(workspace, { force: true, recursive: true }))
  );
});

describe('one-command development mode', () => {
  it('starts the daemon and Vite with an authenticated full-stack launch URL', async () => {
    const home = await mkdtemp(join(tmpdir(), 'agent-usage-dev-mode-'));
    workspaces.push(home);
    const packageJson = JSON.parse(await readFile('package.json', 'utf8')) as {
      scripts: Record<string, string>;
    };
    expect(packageJson.scripts.dev).toBe('node scripts/dev.mjs');
    const child = spawn(process.execPath, ['scripts/dev.mjs', '--no-open'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        AGENT_USAGE_DEMO: '1',
        AGENT_USAGE_DEV_HOME: home,
        AGENT_USAGE_DEV_PORT: '0',
        NO_COLOR: '1'
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    children.push(child);

    const launchUrl = await waitForLaunchUrl(child);
    const launch = await fetch(launchUrl, { redirect: 'manual' });
    expect(launch.status).toBe(303);
    expect(launch.headers.get('location')).toBe('/');
    const cookie = launch.headers.getSetCookie()[0]?.split(';')[0];
    expect(cookie).toContain('agent_usage_session=');

    const origin = new URL(launchUrl).origin;
    const page = await fetch(`${origin}/`, { headers: { cookie } });
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('data-sveltekit-preload-data');

    await waitForProcessing(origin, cookie!, 'usage');
    const overview = await fetch(`${origin}/api/overview`, { headers: { cookie } });
    expect(overview.status).toBe(200);
    expect(await overview.json()).toMatchObject({
      providers: [{ id: 'demo', displayName: 'Demo Agent' }]
    });

    const crossOriginRefresh = await fetch(`${origin}/api/refresh`, {
      method: 'POST',
      headers: { cookie, origin: 'http://127.0.0.1:65534' }
    });
    expect(crossOriginRefresh.status).toBe(403);
    expect(crossOriginRefresh.headers.get('access-control-allow-origin')).toBeNull();

    const refresh = await fetch(`${origin}/api/refresh`, {
      method: 'POST',
      headers: { cookie, origin }
    });
    expect(refresh.status).toBe(204);

    await stopChild(child);
    children.splice(children.indexOf(child), 1);
    await expect(access(join(home, 'daemon.json'))).rejects.toThrow();
  }, 30_000);

  it('stops cleanly when interrupted during startup', async () => {
    const home = await mkdtemp(join(tmpdir(), 'agent-usage-dev-stop-'));
    workspaces.push(home);
    const child = spawn(process.execPath, ['scripts/dev.mjs', '--no-open'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        AGENT_USAGE_DEV_HOME: home,
        AGENT_USAGE_DEV_PORT: '0',
        NO_COLOR: '1'
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    children.push(child);
    let output = '';
    child.stdout?.setEncoding('utf8').on('data', (chunk) => (output += chunk));
    child.stderr?.setEncoding('utf8').on('data', (chunk) => (output += chunk));
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));

    const startedStoppingAt = Date.now();
    await stopChild(child);
    children.splice(children.indexOf(child), 1);

    expect(Date.now() - startedStoppingAt).toBeLessThan(3_000);
    expect(output).not.toContain('Agent Usage dev:');
    await expect(access(join(home, 'daemon.json'))).rejects.toThrow();
  }, 10_000);

  it('removes persisted demo data when development restarts without demo mode', async () => {
    const home = await mkdtemp(join(tmpdir(), 'agent-usage-dev-demo-cleanup-'));
    workspaces.push(home);
    const demoChild = spawn(process.execPath, ['scripts/dev.mjs', '--no-open'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        AGENT_USAGE_DEMO: '1',
        AGENT_USAGE_DEV_HOME: home,
        AGENT_USAGE_DEV_PORT: '0',
        NO_COLOR: '1'
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    children.push(demoChild);

    const demoLaunchUrl = await waitForLaunchUrl(demoChild);
    const demoSession = await authenticatedSession(demoLaunchUrl);
    await waitForProcessing(demoSession.origin, demoSession.cookie, 'usage');
    await expect(providerIds(demoSession.origin, demoSession.cookie)).resolves.toContain('demo');
    await stopChild(demoChild);
    children.splice(children.indexOf(demoChild), 1);

    const cleanEnvironment = { ...process.env };
    delete cleanEnvironment.AGENT_USAGE_DEMO;
    const normalChild = spawn(process.execPath, ['scripts/dev.mjs', '--no-open'], {
      cwd: process.cwd(),
      env: {
        ...cleanEnvironment,
        AGENT_USAGE_DEV_HOME: home,
        AGENT_USAGE_DEV_PORT: '0',
        NO_COLOR: '1'
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    children.push(normalChild);

    const normalLaunchUrl = await waitForLaunchUrl(normalChild);
    const normalSession = await authenticatedSession(normalLaunchUrl);
    await waitForProcessing(normalSession.origin, normalSession.cookie, 'usage');
    await expect(providerIds(normalSession.origin, normalSession.cookie)).resolves.not.toContain(
      'demo'
    );
  }, 30_000);
});

async function authenticatedSession(
  launchUrl: string
): Promise<{ origin: string; cookie: string }> {
  const launch = await fetch(launchUrl, { redirect: 'manual' });
  const cookie = launch.headers.getSetCookie()[0]?.split(';')[0];
  if (!cookie) throw new Error('Development launch did not set a session cookie');
  return { origin: new URL(launchUrl).origin, cookie };
}

async function providerIds(origin: string, cookie: string): Promise<string[]> {
  const response = await fetch(`${origin}/api/overview`, { headers: { cookie } });
  const overview = (await response.json()) as { providers: Array<{ id: string }> };
  return overview.providers.map((provider) => provider.id);
}

async function waitForLaunchUrl(child: ChildProcess): Promise<string> {
  return await new Promise((resolve, reject) => {
    let output = '';
    const timeout = setTimeout(() => {
      reject(new Error(`Development server did not print a launch URL. Output:\n${output}`));
    }, 15_000);
    const inspect = (chunk: Buffer | string) => {
      output += chunk.toString();
      const match = output.match(/Agent Usage dev:\s+(http:\/\/\S+)/);
      if (!match) return;
      clearTimeout(timeout);
      resolve(match[1]);
    };
    child.stdout?.on('data', inspect);
    child.stderr?.on('data', inspect);
    child.once('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`Development server exited with ${code}. Output:\n${output}`));
    });
  });
}

async function waitForProcessing(
  origin: string,
  cookie: string,
  module: 'discovery' | 'usage' | 'pricing' | 'retention'
): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const response = await fetch(`${origin}/api/processing`, { headers: { cookie } });
    const body = (await response.json()) as {
      modules: Record<string, { state: string }>;
    };
    if (body.modules[module]?.state === 'ready') return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 25));
  }
  throw new Error(`Processing module ${module} did not become ready`);
}

async function stopChild(child: ChildProcess): Promise<void> {
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
    }, 5_000);
    child.once('exit', () => {
      clearTimeout(timeout);
      resolve();
    });
    if (!child.kill('SIGTERM')) {
      clearTimeout(timeout);
      resolve();
    }
  });
}
