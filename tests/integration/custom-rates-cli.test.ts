import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { UsageApplication } from '$core/usage-application.js';
import { startLocalServer, type LocalServer } from '$server/local-server.js';
import { SqliteUsageRepository } from '$server/sqlite-usage-repository.js';

const workspaces: string[] = [];
const servers: LocalServer[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  await Promise.all(
    workspaces.splice(0).map((workspace) => rm(workspace, { force: true, recursive: true }))
  );
});

async function runCli(
  arguments_: string[]
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolveRun, reject) => {
    const processInstance = spawn(
      process.execPath,
      ['--import', 'tsx', join(process.cwd(), 'src/cli.ts'), ...arguments_],
      {
        cwd: process.cwd(),
        env: { ...process.env, NO_COLOR: '1' }
      }
    );
    let stdout = '';
    let stderr = '';
    processInstance.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    processInstance.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    processInstance.on('error', reject);
    processInstance.on('close', (exitCode) => {
      resolveRun({ exitCode: exitCode ?? 0, stdout, stderr });
    });
  });
}

describe('agent-usage rates CLI and HTTP API', () => {
  it('manages custom model rates via CLI and HTTP endpoints', async () => {
    const home = await mkdtemp(join(tmpdir(), 'agent-usage-rates-cli-'));
    workspaces.push(home);
    const repository = new SqliteUsageRepository(join(home, 'usage.sqlite'));
    const application = new UsageApplication({
      repository,
      connectors: [],
      clock: () => new Date('2026-09-02T12:00:00.000Z')
    });
    const server = await startLocalServer({ application, apiToken: 'test-token' });
    servers.push(server);

    await writeFile(
      join(home, 'daemon.json'),
      JSON.stringify({ pid: process.pid, origin: server.origin, apiToken: server.apiToken }),
      { mode: 0o600 }
    );

    // 1. List initially empty
    const listEmpty = await runCli(['--home', home, 'rates', 'list', '--json']);
    expect(listEmpty.exitCode).toBe(0);
    expect(JSON.parse(listEmpty.stdout)).toEqual([]);

    // 2. Set a custom model rate via CLI
    const setResult = await runCli([
      '--home',
      home,
      'rates',
      'set',
      'custom-qwen-coder',
      '--provider',
      'dsh',
      '--input',
      '1.5',
      '--output',
      '4.5',
      '--cache-read',
      '0.2'
    ]);
    expect(setResult.exitCode).toBe(0);
    expect(setResult.stdout).toContain('Custom model rate configured for custom-qwen-coder');

    // 3. List via CLI shows the rate
    const listConfigured = await runCli(['--home', home, 'rates', 'list', '--json']);
    expect(listConfigured.exitCode).toBe(0);
    const rates = JSON.parse(listConfigured.stdout) as Array<{
      id: string;
      providerId: string;
      model: string;
      ratesPerMillion: { input: number; output: number; cacheRead: number };
    }>;
    expect(rates).toHaveLength(1);
    expect(rates[0]?.model).toBe('custom-qwen-coder');
    expect(rates[0]?.ratesPerMillion.input).toBe(1.5);
    expect(rates[0]?.ratesPerMillion.output).toBe(4.5);
    expect(rates[0]?.ratesPerMillion.cacheRead).toBe(0.2);

    // 4. Also check HTTP API directly
    const httpResponse = await fetch(`${server.origin}/api/custom-rates`, {
      headers: { authorization: `Bearer ${server.apiToken}` }
    });
    expect(httpResponse.ok).toBe(true);
    const httpData = (await httpResponse.json()) as { rates: typeof rates };
    expect(httpData.rates).toHaveLength(1);
    expect(httpData.rates[0]?.id).toBe(rates[0]?.id);

    // 4b. Check GET by ID via HTTP API
    const rateId = rates[0]!.id;
    const getByIdResponse = await fetch(
      `${server.origin}/api/custom-rates/${encodeURIComponent(rateId)}`,
      {
        headers: { authorization: `Bearer ${server.apiToken}` }
      }
    );
    expect(getByIdResponse.ok).toBe(true);
    const getByIdData = (await getByIdResponse.json()) as { rate: (typeof rates)[0] };
    expect(getByIdData.rate.id).toBe(rateId);
    expect(getByIdData.rate.model).toBe('custom-qwen-coder');

    // 4c. Check CLI rates get
    const getCliResult = await runCli(['--home', home, 'rates', 'get', rateId, '--json']);
    expect(getCliResult.exitCode).toBe(0);
    const getCliData = JSON.parse(getCliResult.stdout) as (typeof rates)[0];
    expect(getCliData.id).toBe(rateId);

    // 4d. Update rate via PUT HTTP API
    const putResponse = await fetch(
      `${server.origin}/api/custom-rates/${encodeURIComponent(rateId)}`,
      {
        method: 'PUT',
        headers: {
          authorization: `Bearer ${server.apiToken}`,
          'content-type': 'application/json',
          origin: server.origin
        },
        body: JSON.stringify({
          providerId: 'dsh',
          model: 'custom-qwen-coder',
          inputRate: 2.5,
          outputRate: 7.5,
          cacheReadRate: 0.5
        })
      }
    );
    expect(putResponse.ok).toBe(true);
    const putData = (await putResponse.json()) as { rate: (typeof rates)[0] };
    expect(putData.rate.id).toBe(rateId);
    expect(putData.rate.ratesPerMillion.input).toBe(2.5);
    expect(putData.rate.ratesPerMillion.output).toBe(7.5);
    expect(putData.rate.ratesPerMillion.cacheRead).toBe(0.5);

    // 4e. Update rate via CLI rates set with --id
    const updateCliResult = await runCli([
      '--home',
      home,
      'rates',
      'set',
      'custom-qwen-coder',
      '--provider',
      'dsh',
      '--id',
      rateId,
      '--input',
      '3.0',
      '--output',
      '9.0',
      '--cache-read',
      '0.8'
    ]);
    expect(updateCliResult.exitCode).toBe(0);
    expect(updateCliResult.stdout).toContain(
      `Custom model rate configured for custom-qwen-coder (ID: ${rateId})`
    );

    const verifyUpdated = await runCli(['--home', home, 'rates', 'get', rateId, '--json']);
    const updatedData = JSON.parse(verifyUpdated.stdout) as (typeof rates)[0];
    expect(updatedData.ratesPerMillion.input).toBe(3.0);
    expect(updatedData.ratesPerMillion.output).toBe(9.0);
    expect(updatedData.ratesPerMillion.cacheRead).toBe(0.8);

    // 5. Delete the rate via CLI
    const deleteResult = await runCli(['--home', home, 'rates', 'delete', rateId]);
    expect(deleteResult.exitCode).toBe(0);
    expect(deleteResult.stdout).toContain(`Deleted custom model rate ${rateId}`);

    // 6. List is empty again
    const listAfterDelete = await runCli(['--home', home, 'rates', 'list', '--json']);
    expect(listAfterDelete.exitCode).toBe(0);
    expect(JSON.parse(listAfterDelete.stdout)).toEqual([]);

    repository.close();
  });
});
