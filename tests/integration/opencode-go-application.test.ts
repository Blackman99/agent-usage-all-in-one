import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { OpenCodeGoConnector } from '../../src/connectors/opencode-go/opencode-go-connector.js';
import { UsageApplication } from '$core/usage-application.js';
import { startLocalServer, type LocalServer } from '$server/local-server.js';
import { SqliteUsageRepository } from '$server/sqlite-usage-repository.js';

const workspaces: string[] = [];
const servers: LocalServer[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  await Promise.all(
    workspaces.splice(0).map((workspace) => rm(workspace, { recursive: true, force: true }))
  );
});

describe('OpenCode Go application path', () => {
  it('refreshes account quota and idempotent local history through the authenticated HTTP API', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'opencode-go-application-'));
    workspaces.push(workspace);
    const repository = new SqliteUsageRepository(join(workspace, 'usage.sqlite'));
    repository.saveConnectorStatus({
      id: 'opencode-go',
      state: 'connected',
      installed: true,
      binaryPath: '/usr/local/bin/opencode',
      officialCredentialPresent: true,
      errorCode: null,
      lastDiscoveredAt: '2026-08-28T02:00:00.000Z',
      secretReference: null
    });
    const connector = new OpenCodeGoConnector({
      accountClient: {
        async readUsage() {
          return {
            usage: {
              rolling: {
                status: 'ok',
                percent: 25,
                resetsAt: '2026-08-28T05:00:00.000Z'
              },
              weekly: {
                status: 'ok',
                percent: 40,
                resetsAt: '2026-09-01T00:00:00.000Z'
              },
              monthly: {
                status: 'ok',
                percent: 50,
                resetsAt: '2026-09-28T00:00:00.000Z'
              }
            }
          };
        }
      },
      localHistoryClient: {
        async readHistory() {
          return [
            {
              id: '2026-08-28:opencode-go/deepseek-v4-flash',
              model: 'opencode-go/deepseek-v4-flash',
              cost: 0.42,
              inputTokens: 700,
              outputTokens: 250,
              reasoningTokens: 50,
              cacheReadTokens: 200,
              cacheWriteTokens: 0,
              observedAtMs: Date.parse('2026-08-28T00:00:00.000Z')
            }
          ];
        }
      },
      clock: () => new Date('2026-08-28T02:00:00.000Z')
    });
    const application = new UsageApplication({
      repository,
      connectors: [connector],
      clock: () => new Date('2026-08-28T02:00:00.000Z')
    });
    const server = await startLocalServer({ application, apiToken: 'test-token' });
    servers.push(server);

    for (let index = 0; index < 2; index += 1) {
      const refresh = await fetch(`${server.origin}/api/refresh`, {
        method: 'POST',
        headers: { authorization: 'Bearer test-token' }
      });
      expect(refresh.status).toBe(204);
    }
    const response = await fetch(`${server.origin}/api/overview`, {
      headers: { authorization: 'Bearer test-token' }
    });
    expect(await response.json()).toMatchObject({
      providers: [
        {
          id: 'opencode-go',
          health: { status: 'healthy' },
          quotaBuckets: [
            expect.objectContaining({
              id: 'monthly',
              scope: 'account-wide',
              limitAmount: 60,
              fallbackStatus: 'unknown'
            }),
            expect.objectContaining({ id: 'rolling', label: '5 hour' }),
            expect.objectContaining({ id: 'weekly', label: 'Week' })
          ],
          tokenTotals: {
            total: 1200,
            input: 700,
            output: 250,
            reasoning: 50,
            cacheRead: 200
          },
          tokenEvidence: {
            recordedTokens: 1200,
            unclassifiedTokens: 0,
            classificationCoverage: 1,
            totalDerivations: ['categorized'],
            timePrecisions: ['day'],
            usageScopes: ['this-mac']
          },
          tokenAuthority: 'local-observation'
        }
      ]
    });
    repository.close();
  });
});
