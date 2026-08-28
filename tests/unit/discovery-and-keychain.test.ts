import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { ConnectorDefinition } from '$core/onboarding-types.js';
import { PathDiscoveryProbe } from '$server/path-discovery-probe.js';
import {
  MacOsKeychainSecretStore,
  type SecurityCommandRunner
} from '$server/keychain-secret-store.js';
import { MacOsStartAtLoginManager } from '$server/macos-start-at-login-manager.js';

const workspaces: string[] = [];

afterEach(async () => {
  await Promise.all(
    workspaces.splice(0).map((workspace) => rm(workspace, { force: true, recursive: true }))
  );
});

describe('PathDiscoveryProbe', () => {
  it('finds an executable and detects but never reads an official credential path', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'agent-usage-discovery-'));
    workspaces.push(workspace);
    const binaryDirectory = join(workspace, 'bin');
    const credentialPath = join(workspace, '.codex', 'auth.json');
    await mkdir(binaryDirectory, { recursive: true });
    await mkdir(join(workspace, '.codex'), { recursive: true });
    const binaryPath = join(binaryDirectory, 'codex');
    await writeFile(binaryPath, '#!/bin/sh\nexit 0\n');
    await chmod(binaryPath, 0o755);
    await writeFile(credentialPath, 'credential-content-must-not-be-read');
    const probe = new PathDiscoveryProbe({
      path: binaryDirectory,
      home: workspace
    });

    expect(
      await probe.inspect({ ...definition, officialCredentialPaths: ['.codex/auth.json'] })
    ).toEqual({
      installed: true,
      binaryPath,
      officialCredentialPresent: true
    });
  });

  it('treats a credential-only connector as installable without a local binary', async () => {
    const probe = new PathDiscoveryProbe({ path: '' });
    expect(
      await probe.inspect({
        ...definition,
        id: 'xai-api',
        command: null,
        credentialOwner: 'agent-usage'
      })
    ).toEqual({
      installed: true,
      binaryPath: null,
      officialCredentialPresent: false
    });
  });
});

describe('MacOsKeychainSecretStore', () => {
  it('writes secrets over stdin and never places them in process arguments', async () => {
    const calls: Array<{ arguments_: string[]; input?: string }> = [];
    const runner: SecurityCommandRunner = async (arguments_, input) => {
      calls.push({ arguments_, input });
      return { exitCode: arguments_[0] === 'find-generic-password' ? 0 : 0 };
    };
    const store = new MacOsKeychainSecretStore(runner, {
      service: 'dev.agent-usage.secrets.development'
    });

    await store.set('connector:xai-api', 'fake-secret-value');
    expect(await store.has('connector:xai-api')).toBe(true);
    await store.delete('connector:xai-api');

    expect(calls[0].arguments_.at(-1)).toBe('-w');
    expect(
      calls.every((call) => call.arguments_.includes('dev.agent-usage.secrets.development'))
    ).toBe(true);
    expect(calls[0].arguments_).not.toContain('fake-secret-value');
    expect(calls[0].input).toBe('fake-secret-value\n');
    expect(JSON.stringify(calls.map((call) => call.arguments_))).not.toContain('fake-secret-value');
  });
});

describe('MacOsStartAtLoginManager', () => {
  it('isolates a development launch agent under its configured label', async () => {
    const userHome = await mkdtemp(join(tmpdir(), 'agent-usage-launch-agent-'));
    workspaces.push(userHome);
    const manager = new MacOsStartAtLoginManager({
      userHome,
      executable: '/usr/local/bin/node',
      cliPath: '/workspace/src/cli.ts',
      applicationHome: '/workspace/.agent-usage-dev',
      label: 'dev.agent-usage.daemon.development',
      nodeImport: 'file:///workspace/node_modules/tsx/dist/loader.mjs',
      environmentVariables: {
        AGENT_USAGE_DAEMON: '1',
        AGENT_USAGE_KEYCHAIN_SERVICE: 'dev.agent-usage.secrets.development',
        AGENT_USAGE_LAUNCH_AGENT_LABEL: 'dev.agent-usage.daemon.development'
      }
    });

    await manager.setEnabled(true);

    const plist = await readFile(
      join(userHome, 'Library', 'LaunchAgents', 'dev.agent-usage.daemon.development.plist'),
      'utf8'
    );
    expect(plist).toContain('<key>Label</key><string>dev.agent-usage.daemon.development</string>');
    expect(plist).toContain(
      '<string>/usr/local/bin/node</string><string>--import</string><string>file:///workspace/node_modules/tsx/dist/loader.mjs</string>'
    );
    expect(plist).toContain(
      '<key>AGENT_USAGE_KEYCHAIN_SERVICE</key><string>dev.agent-usage.secrets.development</string>'
    );
    expect(plist).toContain(
      '<key>AGENT_USAGE_LAUNCH_AGENT_LABEL</key><string>dev.agent-usage.daemon.development</string>'
    );
    expect(await manager.isEnabled()).toBe(true);
  });

  it('rejects path-traversing labels and relative Node imports', () => {
    const options = {
      userHome: '/Users/example',
      executable: '/usr/local/bin/node',
      cliPath: '/workspace/src/cli.ts',
      applicationHome: '/workspace/.agent-usage-dev'
    };

    expect(() => new MacOsStartAtLoginManager({ ...options, label: '../../outside' })).toThrow(
      'LaunchAgent label'
    );
    expect(() => new MacOsStartAtLoginManager({ ...options, nodeImport: 'tsx' })).toThrow(
      'Node import'
    );
  });
});

const definition: ConnectorDefinition = {
  id: 'codex',
  displayName: 'Codex',
  command: 'codex',
  permissionDescription: 'Read official client usage.',
  credentialOwner: 'official-client',
  experimental: false,
  expectedCoverage: ['quota', 'tokens']
};
