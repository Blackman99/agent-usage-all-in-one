import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';

import { z } from 'zod';

import type {
  OpenCodeGoLocalHistoryClient,
  OpenCodeLocalSession
} from './opencode-go-connector.js';

const localSessionSchema = z.object({
  id: z.string(),
  model: z.string().startsWith('opencode-go/'),
  cost: z.number().finite().nonnegative(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  reasoningTokens: z.number().int().nonnegative(),
  cacheReadTokens: z.number().int().nonnegative(),
  cacheWriteTokens: z.number().int().nonnegative(),
  observedAtMs: z.number().int().nonnegative()
});
const localSessionsSchema = z.array(localSessionSchema);

type ExecFileResult = { stdout: string; stderr: string };
type ExecFile = (command: string, arguments_: string[]) => Promise<ExecFileResult>;

export interface CliOpenCodeLocalHistoryClientOptions {
  command?: string;
  execFile?: ExecFile;
}

export class OpenCodeLocalHistoryError extends Error {
  readonly code: string;
  readonly recovery: string;

  constructor(code: string, message: string, recovery: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'OpenCodeLocalHistoryError';
    this.code = code;
    this.recovery = recovery;
  }
}

export class CliOpenCodeLocalHistoryClient implements OpenCodeGoLocalHistoryClient {
  readonly #command: string;
  readonly #execFile: ExecFile;

  constructor(options: CliOpenCodeLocalHistoryClientOptions = {}) {
    this.#command = options.command ?? 'opencode';
    this.#execFile =
      options.execFile ??
      (promisify(execFileCallback) as unknown as (
        command: string,
        arguments_: string[]
      ) => Promise<ExecFileResult>);
  }

  async readHistory(): Promise<OpenCodeLocalSession[]> {
    const query = `WITH normalized AS (
      SELECT
        date(time_updated / 1000, 'unixepoch') AS day,
        CASE
          WHEN json_valid(model)
            THEN json_extract(model, '$.providerID') || '/' || json_extract(model, '$.id')
          ELSE model
        END AS model,
        cost,
        tokens_input,
        tokens_output,
        tokens_reasoning,
        tokens_cache_read,
        tokens_cache_write,
        time_updated
      FROM session
      WHERE (
        json_valid(model) AND json_extract(model, '$.providerID') = 'opencode-go'
      ) OR model LIKE 'opencode-go/%'
    )
    SELECT
      day || ':' || model AS id,
      model,
      SUM(cost) AS cost,
      SUM(tokens_input) AS inputTokens,
      SUM(tokens_output) AS outputTokens,
      SUM(tokens_reasoning) AS reasoningTokens,
      SUM(tokens_cache_read) AS cacheReadTokens,
      SUM(tokens_cache_write) AS cacheWriteTokens,
      CAST(strftime('%s', day) AS INTEGER) * 1000 AS observedAtMs
    FROM normalized
    WHERE day >= date('now', '-90 days')
    GROUP BY day, model
    ORDER BY day DESC, model`;
    let stdout: string;
    try {
      ({ stdout } = await this.#execFile(this.#command, ['db', '--format', 'json', query]));
    } catch (error) {
      throw new OpenCodeLocalHistoryError(
        'opencode-local-history-unavailable',
        'OpenCode local session history is unavailable.',
        'Update OpenCode and run opencode stats to verify local history.',
        { cause: error }
      );
    }
    try {
      return localSessionsSchema.parse(JSON.parse(stdout));
    } catch (error) {
      throw new OpenCodeLocalHistoryError(
        'opencode-cli-schema-changed',
        'The installed OpenCode CLI has an unsupported local history schema.',
        'Update Agent Usage or OpenCode, then retry.',
        { cause: error }
      );
    }
  }
}
