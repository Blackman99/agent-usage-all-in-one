import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  OpenCodeGoConnector,
  type OpenCodeGoAccountClient,
  type OpenCodeGoLocalHistoryClient
} from '../../src/connectors/opencode-go/opencode-go-connector.js';
import {
  OfficialOpenCodeGoClient,
  OpenCodeGoClientError
} from '../../src/connectors/opencode-go/official-opencode-go-client.js';
import { OpenCodeAuthFileReader } from '../../src/connectors/opencode-go/opencode-auth-reader.js';
import { CliOpenCodeLocalHistoryClient } from '../../src/connectors/opencode-go/local-opencode-history-client.js';

const workspaces: string[] = [];

afterEach(async () => {
  await Promise.all(
    workspaces.splice(0).map((workspace) => rm(workspace, { recursive: true, force: true }))
  );
});

describe('OpenCodeGoConnector', () => {
  it('keeps account quota and local model usage in distinct truthful scopes', async () => {
    const accountClient: OpenCodeGoAccountClient = {
      async readUsage() {
        return goUsageFixture;
      }
    };
    const localHistoryClient: OpenCodeGoLocalHistoryClient = {
      async readHistory() {
        return [localSessionFixture];
      }
    };
    const connector = new OpenCodeGoConnector({
      accountClient,
      localHistoryClient,
      clock: () => new Date('2026-08-28T02:00:00.000Z')
    });

    const snapshot = await connector.collect();
    expect(snapshot).toMatchObject({
      provider: { id: 'opencode-go', displayName: 'OpenCode Go' },
      billingDomains: [{ id: 'go-subscription', displayName: 'OpenCode Go subscription' }],
      usageReconciliation: {
        authoritativeIdPrefix: 'opencode-request:',
        retiredIdPrefixes: ['opencode-session:']
      },
      quotaBuckets: [
        {
          id: 'rolling',
          label: '5 hour',
          usedPercent: 25,
          resetsAt: '2026-08-28T05:00:00.000Z',
          status: 'ok',
          scope: 'account-wide',
          limitAmount: 12,
          fallbackStatus: 'unknown',
          authority: 'official-account'
        },
        { id: 'weekly', label: 'Week', usedPercent: 40, limitAmount: 30 },
        { id: 'monthly', label: 'Month', usedPercent: 50, limitAmount: 60 }
      ],
      usage: [
        {
          id: 'opencode-request:v2:684699faaac4917aaf69692cd648693c69e258a8b0c4c25cdce3ec664ca71f4e',
          model: 'opencode-go/deepseek-v4-flash',
          inputTokens: 700,
          outputTokens: 250,
          reasoningTokens: 50,
          cacheReadTokens: 200,
          tokenSemantics: {
            reasoning: 'separate',
            cacheRead: 'separate',
            cacheWrite: 'separate'
          },
          modelAttribution: 'known',
          timePrecision: 'event',
          usageScope: 'this-mac',
          aggregationTemporality: 'delta',
          authority: 'local-observation'
        }
      ],
      costs: [
        expect.objectContaining({
          id: 'opencode-request-cost:v2:684699faaac4917aaf69692cd648693c69e258a8b0c4c25cdce3ec664ca71f4e',
          sourceId:
            'opencode-request:v2:684699faaac4917aaf69692cd648693c69e258a8b0c4c25cdce3ec664ca71f4e',
          kind: 'reported-estimate',
          amount: 0.42,
          authority: 'local-observation',
          model: 'opencode-go/deepseek-v4-flash',
          usageObservationId:
            'opencode-request:v2:684699faaac4917aaf69692cd648693c69e258a8b0c4c25cdce3ec664ca71f4e'
        })
      ]
    });
    expect(snapshot.usage[0]).not.toHaveProperty('totalTokens');
  });

  it('returns local history with an actionable warning when account quota is unavailable', async () => {
    const accountClient: OpenCodeGoAccountClient = {
      async readUsage() {
        throw new OpenCodeGoClientError(
          'go-subscription-required',
          'OpenCode Go subscription is unavailable.',
          'Subscribe to OpenCode Go or reconnect its API key, then refresh.'
        );
      }
    };
    const localHistoryClient: OpenCodeGoLocalHistoryClient = {
      async readHistory() {
        return [localSessionFixture];
      }
    };
    const connector = new OpenCodeGoConnector({ accountClient, localHistoryClient });

    const snapshot = await connector.collect();
    expect(snapshot.quotaBuckets).toEqual([]);
    expect(snapshot.usage).toHaveLength(1);
    expect(snapshot.warnings).toEqual([
      expect.objectContaining({ code: 'go-subscription-required' })
    ]);
  });

  it('does not replace cached local history when the local message read fails', async () => {
    const connector = new OpenCodeGoConnector({
      accountClient: { readUsage: async () => goUsageFixture },
      localHistoryClient: {
        async readHistory() {
          throw new Error('private database detail');
        }
      }
    });

    const snapshot = await connector.collect();

    expect(snapshot.usage).toEqual([]);
    expect(snapshot.costs).toEqual([]);
    expect(snapshot).not.toHaveProperty('usageReconciliation');
    expect(snapshot.warnings).toEqual([
      expect.objectContaining({ code: 'opencode-go-refresh-failed' })
    ]);
  });

  it('keeps request Tokens but omits a reported estimate when source cost is absent', async () => {
    const connector = new OpenCodeGoConnector({
      accountClient: { readUsage: async () => goUsageFixture },
      localHistoryClient: {
        async readHistory() {
          return [{ ...localSessionFixture, cost: null }];
        }
      }
    });

    const snapshot = await connector.collect();

    expect(snapshot.usage).toHaveLength(1);
    expect(snapshot.costs).toEqual([]);
  });
});

describe('OfficialOpenCodeGoClient', () => {
  it('reads the official usage endpoint with an in-place auth key', async () => {
    const request = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      expect(init?.headers).toEqual({ authorization: 'Bearer test-go-key' });
      return new Response(JSON.stringify(goUsageFixture), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    });
    const client = new OfficialOpenCodeGoClient({
      authReader: { readGoApiKey: async () => 'test-go-key' },
      fetch: request
    });

    await expect(client.readUsage()).resolves.toEqual(goUsageFixture);
    expect(request).toHaveBeenCalledWith(
      'https://opencode.ai/zen/go/v1/usage',
      expect.objectContaining({ method: 'GET' })
    );
  });

  it.each([
    { status: 401, code: 'go-authentication-failed' },
    { status: 403, code: 'go-subscription-required' },
    { status: 404, code: 'go-usage-endpoint-unsupported' }
  ])('normalizes HTTP $status without retaining response content', async ({ status, code }) => {
    const client = new OfficialOpenCodeGoClient({
      authReader: { readGoApiKey: async () => 'test-go-key' },
      fetch: async () => new Response('secret server detail', { status })
    });

    await expect(client.readUsage()).rejects.toMatchObject({ code });
  });
});

describe('OpenCodeAuthFileReader', () => {
  it('reads only the official opencode-go API-key entry', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'opencode-auth-fixture-'));
    workspaces.push(workspace);
    const authPath = join(workspace, 'auth.json');
    await writeFile(
      authPath,
      JSON.stringify({
        anthropic: { type: 'api', key: 'not-this-key' },
        'opencode-go': { type: 'api', key: 'go-key' }
      }),
      { mode: 0o600 }
    );

    await expect(new OpenCodeAuthFileReader(authPath).readGoApiKey()).resolves.toBe('go-key');
  });
});

describe('CliOpenCodeLocalHistoryClient', () => {
  it('reads the official local database path without retaining source message ids', async () => {
    const calls: string[][] = [];
    const databaseReads: Array<{ path: string; query: string }> = [];
    const client = new CliOpenCodeLocalHistoryClient({
      command: '/usr/local/bin/opencode',
      execFile: async (_command, arguments_) => {
        calls.push(arguments_);
        return { stdout: '/private/opencode.db\n', stderr: '' };
      },
      readDatabase(path, query) {
        databaseReads.push({ path, query });
        return [localMessageRowFixture];
      }
    });

    const history = await client.readHistory();
    expect(history).toEqual([localSessionFixture]);
    expect(calls).toEqual([['db', 'path']]);
    expect(databaseReads).toHaveLength(1);
    expect(databaseReads[0].path).toBe('/private/opencode.db');
    expect(databaseReads[0].query).toContain('FROM message');
    expect(databaseReads[0].query).toContain("json_extract(data, '$.providerID') AS providerId");
    expect(databaseReads[0].query).toContain("json_extract(data, '$.tokens.input')");
    expect(databaseReads[0].query).toContain(
      "json_extract(data, '$.time.completed') AS completedAtMs"
    );
    expect(databaseReads[0].query).not.toContain(
      "WHERE json_extract(data, '$.providerID') = 'opencode-go'"
    );
    expect(JSON.stringify(history)).not.toContain('message-secret-123');
  });

  it('fails closed when the installed CLI schema has drifted', async () => {
    const client = new CliOpenCodeLocalHistoryClient({
      execFile: async () => ({ stdout: '/private/opencode.db\n', stderr: '' }),
      readDatabase: () => [{ unexpected: true }]
    });

    await expect(client.readHistory()).rejects.toMatchObject({
      code: 'opencode-cli-schema-changed'
    });
  });

  it('fails closed instead of treating a missing Token category as zero', async () => {
    const client = new CliOpenCodeLocalHistoryClient({
      execFile: async () => ({ stdout: '/private/opencode.db\n', stderr: '' }),
      readDatabase: () => [{ ...localMessageRowFixture, cacheWriteTokens: null }]
    });

    await expect(client.readHistory()).rejects.toMatchObject({
      code: 'opencode-cli-schema-changed'
    });
  });

  it('fails closed when selector fields drift instead of returning authoritative empty history', async () => {
    const client = new CliOpenCodeLocalHistoryClient({
      execFile: async () => ({ stdout: '/private/opencode.db\n', stderr: '' }),
      readDatabase: () => [{ ...localMessageRowFixture, role: 'agent' }]
    });

    await expect(client.readHistory()).rejects.toMatchObject({
      code: 'opencode-cli-schema-changed'
    });
  });
});

const goUsageFixture = {
  usage: {
    rolling: { status: 'ok' as const, percent: 25, resetsAt: '2026-08-28T05:00:00.000Z' },
    weekly: { status: 'ok' as const, percent: 40, resetsAt: '2026-09-01T00:00:00.000Z' },
    monthly: {
      status: 'rate-limited' as const,
      percent: 50,
      resetsAt: '2026-09-28T00:00:00.000Z'
    }
  }
};

const localSessionFixture = {
  id: 'v2:684699faaac4917aaf69692cd648693c69e258a8b0c4c25cdce3ec664ca71f4e',
  model: 'opencode-go/deepseek-v4-flash',
  cost: 0.42,
  inputTokens: 700,
  outputTokens: 250,
  reasoningTokens: 50,
  cacheReadTokens: 200,
  cacheWriteTokens: 0,
  observedAtMs: Date.parse('2026-08-28T00:00:00.000Z')
};

const localMessageRowFixture = {
  sourceId: 'message-secret-123',
  role: 'assistant',
  providerId: 'opencode-go',
  modelId: 'deepseek-v4-flash',
  completedAtMs: Date.parse('2026-08-28T00:00:01.000Z'),
  cost: localSessionFixture.cost,
  inputTokens: localSessionFixture.inputTokens,
  outputTokens: localSessionFixture.outputTokens,
  reasoningTokens: localSessionFixture.reasoningTokens,
  cacheReadTokens: localSessionFixture.cacheReadTokens,
  cacheWriteTokens: localSessionFixture.cacheWriteTokens,
  observedAtMs: localSessionFixture.observedAtMs
};
