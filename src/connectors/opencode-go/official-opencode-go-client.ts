import { z } from 'zod';

import type { OpenCodeGoAccountClient } from './opencode-go-connector.js';
import type { OpenCodeGoAuthReader } from './opencode-auth-reader.js';

const usageWindowSchema = z.object({
  status: z.enum(['ok', 'rate-limited']),
  percent: z.number().finite().nonnegative(),
  resetsAt: z.string().datetime()
});

export const openCodeGoUsageSchema = z.object({
  usage: z.object({
    rolling: usageWindowSchema,
    weekly: usageWindowSchema,
    monthly: usageWindowSchema
  })
});

export type OpenCodeGoUsageResponse = z.infer<typeof openCodeGoUsageSchema>;

export interface OfficialOpenCodeGoClientOptions {
  authReader: OpenCodeGoAuthReader;
  fetch?: typeof fetch;
  endpoint?: string;
  timeoutMs?: number;
}

export class OpenCodeGoClientError extends Error {
  readonly code: string;
  readonly recovery: string;

  constructor(code: string, message: string, recovery: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'OpenCodeGoClientError';
    this.code = code;
    this.recovery = recovery;
  }
}

export class OfficialOpenCodeGoClient implements OpenCodeGoAccountClient {
  readonly #authReader: OpenCodeGoAuthReader;
  readonly #fetch: typeof fetch;
  readonly #endpoint: string;
  readonly #timeoutMs: number;

  constructor(options: OfficialOpenCodeGoClientOptions) {
    this.#authReader = options.authReader;
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#endpoint = options.endpoint ?? 'https://opencode.ai/zen/go/v1/usage';
    this.#timeoutMs = options.timeoutMs ?? 8_000;
  }

  async readUsage(): Promise<OpenCodeGoUsageResponse> {
    const apiKey = await this.#authReader.readGoApiKey();
    let response: Response;
    try {
      response = await this.#fetch(this.#endpoint, {
        method: 'GET',
        headers: { authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(this.#timeoutMs)
      });
    } catch (error) {
      throw new OpenCodeGoClientError(
        'go-usage-endpoint-unavailable',
        'OpenCode Go usage endpoint is unavailable.',
        'Check the network and retry refresh.',
        { cause: error }
      );
    }
    if (!response.ok) throw httpError(response.status);
    try {
      return openCodeGoUsageSchema.parse(await response.json());
    } catch (error) {
      throw new OpenCodeGoClientError(
        'go-usage-schema-changed',
        'OpenCode Go returned an unsupported usage schema.',
        'Update Agent Usage, then retry.',
        { cause: error }
      );
    }
  }
}

function httpError(status: number): OpenCodeGoClientError {
  if (status === 401) {
    return new OpenCodeGoClientError(
      'go-authentication-failed',
      'OpenCode Go authentication failed.',
      'Reconnect OpenCode Go in the official client, then retry.'
    );
  }
  if (status === 403) {
    return new OpenCodeGoClientError(
      'go-subscription-required',
      'OpenCode Go subscription is unavailable.',
      'Subscribe to OpenCode Go or reconnect its API key, then refresh.'
    );
  }
  if (status === 404 || status === 405) {
    return new OpenCodeGoClientError(
      'go-usage-endpoint-unsupported',
      'This OpenCode Go account endpoint is unsupported.',
      'Update OpenCode and Agent Usage, then retry.'
    );
  }
  if (status === 429) {
    return new OpenCodeGoClientError(
      'go-usage-endpoint-rate-limited',
      'OpenCode Go usage refresh is rate-limited.',
      'Wait before refreshing again.'
    );
  }
  return new OpenCodeGoClientError(
    'go-usage-endpoint-unavailable',
    'OpenCode Go usage endpoint is unavailable.',
    'Retry refresh later.'
  );
}
