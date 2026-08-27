import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { z } from 'zod';

const authFileSchema = z.record(
  z.string(),
  z
    .object({
      type: z.string(),
      key: z.string().optional()
    })
    .passthrough()
);

export interface OpenCodeGoAuthReader {
  readGoApiKey(): Promise<string>;
}

export class OpenCodeAuthFileReader implements OpenCodeGoAuthReader {
  readonly #path: string;

  constructor(path = join(homedir(), '.local', 'share', 'opencode', 'auth.json')) {
    this.#path = path;
  }

  async readGoApiKey(): Promise<string> {
    let parsed: z.infer<typeof authFileSchema>;
    try {
      parsed = authFileSchema.parse(JSON.parse(await readFile(this.#path, 'utf8')));
    } catch (error) {
      throw new OpenCodeAuthError(
        'opencode-go-key-unavailable',
        'OpenCode Go API key is unavailable.',
        'Run opencode providers login and connect OpenCode Go, then retry.',
        { cause: error }
      );
    }
    const entry = parsed['opencode-go'];
    if (entry?.type !== 'api' || !entry.key) {
      throw new OpenCodeAuthError(
        'opencode-go-key-unavailable',
        'OpenCode Go API key is unavailable.',
        'Run opencode providers login and connect OpenCode Go, then retry.'
      );
    }
    return entry.key;
  }
}

export class OpenCodeAuthError extends Error {
  readonly code: string;
  readonly recovery: string;

  constructor(code: string, message: string, recovery: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'OpenCodeAuthError';
    this.code = code;
    this.recovery = recovery;
  }
}
