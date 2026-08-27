import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { ConnectorDefinition } from '$core/onboarding-types.js';
import { PathDiscoveryProbe } from '$server/path-discovery-probe.js';
import {
  MacOsKeychainSecretStore,
  type SecurityCommandRunner
} from '$server/keychain-secret-store.js';

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
    const store = new MacOsKeychainSecretStore(runner);

    await store.set('connector:xai-api', 'fake-secret-value');
    expect(await store.has('connector:xai-api')).toBe(true);
    await store.delete('connector:xai-api');

    expect(calls[0].arguments_.at(-1)).toBe('-w');
    expect(calls[0].arguments_).not.toContain('fake-secret-value');
    expect(calls[0].input).toBe('fake-secret-value\n');
    expect(JSON.stringify(calls.map((call) => call.arguments_))).not.toContain('fake-secret-value');
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
