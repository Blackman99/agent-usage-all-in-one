import { execFile as execFileCallback } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';

import { z } from 'zod';

import type {
  OpenCodeGoLocalHistoryClient,
  OpenCodeLocalRequest
} from './opencode-go-connector.js';

const localMessageRowSchema = z.object({
  sourceId: z.string().min(1),
  role: z.enum(['user', 'assistant']),
  providerId: z.string().min(1).nullable(),
  modelId: z.string().min(1).nullable(),
  completedAtMs: z.number().int().nonnegative().nullable(),
  cost: z.number().finite().nonnegative().nullable(),
  inputTokens: z.number().int().nonnegative().nullable(),
  outputTokens: z.number().int().nonnegative().nullable(),
  reasoningTokens: z.number().int().nonnegative().nullable(),
  cacheReadTokens: z.number().int().nonnegative().nullable(),
  cacheWriteTokens: z.number().int().nonnegative().nullable(),
  observedAtMs: z.number().int().nonnegative()
});
const localMessageRowsSchema = z.array(localMessageRowSchema);
const completedAssistantRowSchema = localMessageRowSchema.extend({
  role: z.literal('assistant'),
  providerId: z.string().min(1),
  modelId: z.string().min(1),
  completedAtMs: z.number().int().nonnegative(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  reasoningTokens: z.number().int().nonnegative(),
  cacheReadTokens: z.number().int().nonnegative(),
  cacheWriteTokens: z.number().int().nonnegative()
});

type ExecFileResult = { stdout: string; stderr: string };
type ExecFile = (command: string, arguments_: string[]) => Promise<ExecFileResult>;
type ReadDatabase = (path: string, query: string) => unknown[];
const MAX_PATH_OUTPUT_BYTES = 1024 * 1024;
const { DatabaseSync } = createRequire(import.meta.url)(
  'node:sqlite'
) as typeof import('node:sqlite');

export interface CliOpenCodeLocalHistoryClientOptions {
  command?: string;
  execFile?: ExecFile;
  readDatabase?: ReadDatabase;
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
  readonly #readDatabase: ReadDatabase;

  constructor(options: CliOpenCodeLocalHistoryClientOptions = {}) {
    this.#command = options.command ?? 'opencode';
    this.#execFile = options.execFile ?? executeOpenCode;
    this.#readDatabase = options.readDatabase ?? readDatabase;
  }

  async readHistory(): Promise<OpenCodeLocalRequest[]> {
    let databasePath: string;
    try {
      const { stdout } = await this.#execFile(this.#command, ['db', 'path']);
      databasePath = stdout.trim();
      if (!databasePath) throw new Error('OpenCode returned an empty database path.');
    } catch (error) {
      throw unavailableHistory(error);
    }
    let rawRows: unknown[];
    try {
      rawRows = this.#readDatabase(databasePath, HISTORY_QUERY);
    } catch (error) {
      throw unavailableHistory(error);
    }
    let completedAssistantRows: Array<z.infer<typeof completedAssistantRowSchema>>;
    try {
      const messageRows = localMessageRowsSchema.parse(rawRows);
      const assistantRows = messageRows.filter((row) => row.role === 'assistant');
      if (assistantRows.length > 0 && assistantRows.every((row) => row.completedAtMs === null)) {
        throw new Error('No completed assistant message uses the expected schema.');
      }
      completedAssistantRows = assistantRows
        .filter((row) => row.completedAtMs !== null)
        .map((row) => completedAssistantRowSchema.parse(row));
    } catch (error) {
      throw new OpenCodeLocalHistoryError(
        'opencode-cli-schema-changed',
        'The installed OpenCode CLI has an unsupported local history schema.',
        'Update Agent Usage or OpenCode, then retry.',
        { cause: error }
      );
    }
    return completedAssistantRows
      .filter((row) => row.providerId === 'opencode-go')
      .filter(hasCategorizedTokens)
      .map((row) => ({
        id: `v2:${createHash('sha256').update(row.sourceId).digest('hex')}`,
        model: `${row.providerId}/${row.modelId}`,
        cost: row.cost,
        inputTokens: row.inputTokens,
        outputTokens: row.outputTokens,
        reasoningTokens: row.reasoningTokens,
        cacheReadTokens: row.cacheReadTokens,
        cacheWriteTokens: row.cacheWriteTokens,
        observedAtMs: row.observedAtMs
      }));
  }
}

const HISTORY_QUERY = `SELECT
      id AS sourceId,
      json_extract(data, '$.role') AS role,
      json_extract(data, '$.providerID') AS providerId,
      json_extract(data, '$.modelID') AS modelId,
      json_extract(data, '$.time.completed') AS completedAtMs,
      json_extract(data, '$.cost') AS cost,
      json_extract(data, '$.tokens.input') AS inputTokens,
      json_extract(data, '$.tokens.output') AS outputTokens,
      json_extract(data, '$.tokens.reasoning') AS reasoningTokens,
      json_extract(data, '$.tokens.cache.read') AS cacheReadTokens,
      json_extract(data, '$.tokens.cache.write') AS cacheWriteTokens,
      COALESCE(json_extract(data, '$.time.created'), time_created) AS observedAtMs
    FROM message
    WHERE date(COALESCE(json_extract(data, '$.time.created'), time_created) / 1000, 'unixepoch')
        >= date('now', '-90 days')
    ORDER BY observedAtMs DESC, sourceId`;

function hasCategorizedTokens(row: z.infer<typeof completedAssistantRowSchema>): boolean {
  return (
    row.inputTokens +
      row.outputTokens +
      row.reasoningTokens +
      row.cacheReadTokens +
      row.cacheWriteTokens >
    0
  );
}

function readDatabase(path: string, query: string): unknown[] {
  const database: DatabaseSyncType = new DatabaseSync(path, { readOnly: true });
  try {
    return database.prepare(query).all() as unknown[];
  } finally {
    database.close();
  }
}

function unavailableHistory(cause: unknown): OpenCodeLocalHistoryError {
  return new OpenCodeLocalHistoryError(
    'opencode-local-history-unavailable',
    'OpenCode local message history is unavailable.',
    'Update OpenCode and run opencode stats to verify local history.',
    { cause }
  );
}

function executeOpenCode(command: string, arguments_: string[]): Promise<ExecFileResult> {
  return new Promise((resolve, reject) => {
    execFileCallback(
      command,
      arguments_,
      { encoding: 'utf8', maxBuffer: MAX_PATH_OUTPUT_BYTES },
      (error, stdout, stderr) => {
        if (error) {
          reject(error);
          return;
        }
        resolve({ stdout, stderr });
      }
    );
  });
}
