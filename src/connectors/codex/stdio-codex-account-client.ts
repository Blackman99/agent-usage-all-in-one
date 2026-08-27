import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import type { Readable, Writable } from 'node:stream';

import {
  codexRateLimitsSchema,
  codexTokenUsageSchema,
  type CodexAccountClient,
  type CodexAccountPayload
} from './codex-connector.js';

interface CodexRpcErrorBody {
  code: number;
  message?: string;
}

interface CodexRpcResponse {
  id: number;
  result?: unknown;
  error?: CodexRpcErrorBody;
}

export interface CodexAppServerProcess {
  readonly stdin: Writable;
  readonly stdout: Readable;
  readonly stderr: Readable;
  once(event: 'error', listener: (error: Error) => void): this;
  once(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): this;
  kill(signal?: NodeJS.Signals): boolean;
}

export interface StdioCodexAccountClientOptions {
  command?: string;
  timeoutMs?: number;
  spawnProcess?: (command: string, arguments_: string[]) => CodexAppServerProcess;
}

export class CodexAppServerError extends Error {
  readonly code:
    | 'app-server-unavailable'
    | 'app-server-timeout'
    | 'app-server-method-unsupported'
    | 'codex-account-unavailable'
    | 'app-server-protocol-error'
    | 'app-server-schema-changed';
  readonly recovery: string;

  constructor(
    code: CodexAppServerError['code'],
    message: string,
    recovery: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = 'CodexAppServerError';
    this.code = code;
    this.recovery = recovery;
  }
}

export class StdioCodexAccountClient implements CodexAccountClient {
  readonly #command: string;
  readonly #timeoutMs: number;
  readonly #spawnProcess: NonNullable<StdioCodexAccountClientOptions['spawnProcess']>;

  constructor(options: StdioCodexAccountClientOptions = {}) {
    this.#command = options.command ?? 'codex';
    this.#timeoutMs = options.timeoutMs ?? 5_000;
    this.#spawnProcess =
      options.spawnProcess ??
      ((command, arguments_) =>
        spawn(command, arguments_, {
          stdio: ['pipe', 'pipe', 'pipe']
        }) as ChildProcessWithoutNullStreams);
  }

  async readAccount(): Promise<CodexAccountPayload> {
    let process: CodexAppServerProcess;
    try {
      process = this.#spawnProcess(this.#command, ['app-server', '--stdio']);
    } catch (error) {
      throw unavailableError(error);
    }

    const peer = new JsonLinePeer(process, this.#timeoutMs);
    try {
      await peer.request('initialize', {
        clientInfo: { name: 'agent-usage', version: '0.1.0' },
        capabilities: { experimentalApi: true, requestAttestation: false }
      });
      peer.notify('initialized');

      const rateLimitsResult = await peer.request('account/rateLimits/read');
      let rateLimits;
      try {
        rateLimits = codexRateLimitsSchema.parse(rateLimitsResult);
      } catch (error) {
        throw schemaError(error);
      }

      let tokenUsage = null;
      try {
        const tokenUsageResult = await peer.request('account/usage/read');
        tokenUsage = codexTokenUsageSchema.parse(tokenUsageResult);
      } catch (error) {
        if (!(error instanceof CodexRpcError && error.code === -32601)) {
          if (error instanceof CodexRpcError) throw accountError(error);
          if (error instanceof CodexAppServerError) throw error;
          throw schemaError(error);
        }
      }

      return { rateLimits, tokenUsage };
    } catch (error) {
      if (error instanceof CodexAppServerError) throw error;
      if (error instanceof CodexRpcError) {
        if (error.code === -32601) {
          throw new CodexAppServerError(
            'app-server-method-unsupported',
            'This Codex version does not expose account usage.',
            'Update Codex, then run agent-usage discover and refresh.',
            { cause: error }
          );
        }
        throw accountError(error);
      }
      throw unavailableError(error);
    } finally {
      peer.close();
    }
  }
}

class CodexRpcError extends Error {
  readonly code: number;

  constructor(error: CodexRpcErrorBody) {
    super(error.message ?? `Codex app-server RPC error ${error.code}`);
    this.name = 'CodexRpcError';
    this.code = error.code;
  }
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

class JsonLinePeer {
  readonly #process: CodexAppServerProcess;
  readonly #timeoutMs: number;
  readonly #pending = new Map<number, PendingRequest>();
  #nextId = 1;
  #buffer = '';
  #closed = false;

  constructor(process: CodexAppServerProcess, timeoutMs: number) {
    this.#process = process;
    this.#timeoutMs = timeoutMs;
    process.stdout.setEncoding('utf8');
    process.stdout.on('data', (chunk: string) => this.#consume(chunk));
    process.once('error', (error) => this.#fail(unavailableError(error)));
    process.once('exit', (code, signal) => {
      if (this.#closed) return;
      this.#fail(
        new CodexAppServerError(
          'app-server-unavailable',
          'Codex app-server exited before the usage request completed.',
          'Run codex login, then agent-usage discover and refresh.',
          { cause: new Error(`exit=${String(code)} signal=${String(signal)}`) }
        )
      );
    });
  }

  request(method: string, params?: unknown): Promise<unknown> {
    const id = this.#nextId++;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.#pending.delete(id);
        reject(
          new CodexAppServerError(
            'app-server-timeout',
            'Codex app-server did not respond in time.',
            'Retry refresh. If it persists, restart or update Codex.'
          )
        );
      }, this.#timeoutMs);
      this.#pending.set(id, { resolve, reject, timeout });
      this.#write({ id, method, ...(params === undefined ? {} : { params }) });
    });
  }

  notify(method: string, params?: unknown): void {
    this.#write({ method, ...(params === undefined ? {} : { params }) });
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(
        new CodexAppServerError(
          'app-server-unavailable',
          'Codex app-server connection closed.',
          'Retry refresh.'
        )
      );
    }
    this.#pending.clear();
    this.#process.kill();
  }

  #write(message: object): void {
    this.#process.stdin.write(`${JSON.stringify(message)}\n`);
  }

  #consume(chunk: string): void {
    this.#buffer += chunk;
    let newline = this.#buffer.indexOf('\n');
    while (newline !== -1) {
      const line = this.#buffer.slice(0, newline).trim();
      this.#buffer = this.#buffer.slice(newline + 1);
      if (line) this.#consumeLine(line);
      newline = this.#buffer.indexOf('\n');
    }
  }

  #consumeLine(line: string): void {
    let message: CodexRpcResponse;
    try {
      message = JSON.parse(line) as CodexRpcResponse;
    } catch (error) {
      this.#fail(
        new CodexAppServerError(
          'app-server-protocol-error',
          'Codex app-server returned an invalid protocol message.',
          'Update Codex and Agent Usage, then retry.',
          { cause: error }
        )
      );
      return;
    }
    if (typeof message.id !== 'number') return;
    const pending = this.#pending.get(message.id);
    if (!pending) return;
    clearTimeout(pending.timeout);
    this.#pending.delete(message.id);
    if (message.error) pending.reject(new CodexRpcError(message.error));
    else pending.resolve(message.result);
  }

  #fail(error: Error): void {
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.#pending.clear();
  }
}

function unavailableError(cause: unknown): CodexAppServerError {
  return new CodexAppServerError(
    'app-server-unavailable',
    'Codex app-server is unavailable.',
    'Install or update Codex, then run agent-usage discover.',
    { cause }
  );
}

function accountError(cause: unknown): CodexAppServerError {
  return new CodexAppServerError(
    'codex-account-unavailable',
    'Codex account usage is unavailable.',
    'Run codex login, then refresh Agent Usage.',
    { cause }
  );
}

function schemaError(cause: unknown): CodexAppServerError {
  return new CodexAppServerError(
    'app-server-schema-changed',
    'Codex returned an unsupported account-usage schema.',
    'Update Agent Usage and Codex, then retry.',
    { cause }
  );
}
