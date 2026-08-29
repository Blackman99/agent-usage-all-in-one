import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { open } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Readable, Writable } from 'node:stream';
import { z } from 'zod';

import {
  grokBillingResponseSchema,
  type GrokBuildBilling,
  type GrokBuildBillingClient
} from './grok-build-connector.js';

interface JsonRpcErrorBody {
  code: number;
  message?: string;
}

interface JsonRpcResponse {
  id: number;
  result?: unknown;
  error?: JsonRpcErrorBody;
}

export interface GrokBillingProcess {
  readonly stdin: Writable;
  readonly stdout: Readable;
  readonly stderr: Readable;
  once(event: 'error', listener: (error: Error) => void): this;
  once(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): this;
  kill(signal?: NodeJS.Signals): boolean;
}

export interface StdioGrokBillingClientOptions {
  command?: string;
  timeoutMs?: number;
  spawnProcess?: (command: string, arguments_: string[]) => GrokBillingProcess;
  readUnifiedLog?: () => Promise<string>;
  refreshBillingLog?: () => Promise<void>;
  clock?: () => Date;
}

export class GrokBillingAdapterError extends Error {
  readonly code:
    | 'grok-client-unavailable'
    | 'grok-client-timeout'
    | 'grok-client-protocol-error'
    | 'grok-client-version-unsupported'
    | 'grok-billing-capability-unsupported'
    | 'grok-billing-unavailable'
    | 'grok-billing-schema-changed';
  readonly recovery: string;

  constructor(
    code: GrokBillingAdapterError['code'],
    message: string,
    recovery: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = 'GrokBillingAdapterError';
    this.code = code;
    this.recovery = recovery;
  }
}

export class StdioGrokBillingClient implements GrokBuildBillingClient {
  readonly #command: string;
  readonly #timeoutMs: number;
  readonly #spawnProcess: NonNullable<StdioGrokBillingClientOptions['spawnProcess']>;
  readonly #readUnifiedLog: NonNullable<StdioGrokBillingClientOptions['readUnifiedLog']>;
  readonly #refreshBillingLog: NonNullable<StdioGrokBillingClientOptions['refreshBillingLog']>;
  readonly #clock: () => Date;

  constructor(options: StdioGrokBillingClientOptions = {}) {
    this.#command = options.command ?? 'grok';
    this.#timeoutMs = options.timeoutMs ?? 8_000;
    this.#spawnProcess =
      options.spawnProcess ??
      ((command, arguments_) =>
        spawn(command, arguments_, {
          stdio: ['pipe', 'pipe', 'pipe']
        }) as ChildProcessWithoutNullStreams);
    this.#readUnifiedLog =
      options.readUnifiedLog ??
      (() =>
        readLogTail(
          join(process.env.GROK_HOME ?? join(homedir(), '.grok'), 'logs', 'unified.jsonl')
        ));
    this.#refreshBillingLog =
      options.refreshBillingLog ??
      (options.readUnifiedLog
        ? async () => undefined
        : () => refreshBillingLogViaDashboard(this.#command, this.#timeoutMs));
    this.#clock = options.clock ?? (() => new Date());
  }

  async readBilling(): Promise<GrokBuildBilling> {
    let process: GrokBillingProcess;
    try {
      process = this.#spawnProcess(this.#command, ['agent', '--no-leader', 'stdio']);
    } catch (error) {
      const fallback = await this.#readFreshLogFallback();
      if (fallback) return fallback;
      throw unavailableError(error);
    }

    process.stderr.resume();
    const peer = new JsonLinePeer(process, this.#timeoutMs);
    try {
      const initialized = await peer.request('initialize', {
        protocolVersion: 1,
        clientCapabilities: {},
        clientInfo: { name: 'agent-usage', version: '0.1.0' }
      });
      const version = z
        .object({ protocolVersion: z.number() })
        .passthrough()
        .safeParse(initialized);
      if (!version.success || version.data.protocolVersion !== 1) {
        throw new GrokBillingAdapterError(
          'grok-client-version-unsupported',
          'Grok Build returned an unsupported ACP version.',
          'Update Grok Build and Agent Usage, then retry.'
        );
      }

      const result = await peer.request('x.ai/billing', {});
      const billing = grokBillingResponseSchema.safeParse(result);
      if (!billing.success) {
        throw new GrokBillingAdapterError(
          'grok-billing-schema-changed',
          'Grok Build returned an unsupported billing schema.',
          'Open Grok Build and run /usage, then update Agent Usage.',
          { cause: billing.error }
        );
      }
      return billing.data;
    } catch (error) {
      const fallback = await this.#readFreshLogFallback();
      if (fallback) return fallback;
      if (error instanceof GrokBillingAdapterError) throw error;
      if (error instanceof JsonRpcError && error.code === -32601) {
        throw new GrokBillingAdapterError(
          'grok-billing-capability-unsupported',
          'This Grok Build version does not expose billing through ACP.',
          'Open Grok Build and run /usage, then update Grok Build before retrying.',
          { cause: error }
        );
      }
      if (error instanceof JsonRpcError) {
        throw new GrokBillingAdapterError(
          'grok-billing-unavailable',
          'Grok Build subscription billing is unavailable.',
          'Run grok login, open Grok Build, and run /usage before retrying.',
          { cause: error }
        );
      }
      throw unavailableError(error);
    } finally {
      peer.close();
    }
  }

  async #readLogFallback(): Promise<GrokBuildBilling | null> {
    try {
      return parseLatestBillingLog(await this.#readUnifiedLog());
    } catch {
      return null;
    }
  }

  async #readFreshLogFallback(): Promise<GrokBuildBilling | null> {
    const cached = await this.#readLogFallback();
    if (cached && billingIsFresh(cached, this.#clock())) return cached;
    try {
      await this.#refreshBillingLog();
    } catch {
      return cached;
    }
    return (await this.#readLogFallback()) ?? cached;
  }
}

const GROK_BILLING_FRESHNESS_MS = 5 * 60 * 1_000;

function billingIsFresh(billing: GrokBuildBilling, now: Date): boolean {
  if (!billing.sourceObservedAt) return false;
  const observedAt = Date.parse(billing.sourceObservedAt);
  if (!Number.isFinite(observedAt)) return false;
  return now.getTime() - observedAt <= GROK_BILLING_FRESHNESS_MS;
}

async function refreshBillingLogViaDashboard(command: string, timeoutMs: number): Promise<void> {
  if (process.platform !== 'darwin') return;
  const refreshTimeoutMs = Math.min(timeoutMs, 6_000);
  const expectScript = [
    `set timeout ${Math.max(1, Math.ceil(refreshTimeoutMs / 1_000))}`,
    'log_user 0',
    'set command $env(AGENT_USAGE_GROK_REFRESH_COMMAND)',
    'spawn -noecho $command dashboard',
    `after ${Math.min(2_000, Math.max(250, refreshTimeoutMs - 1_000))}`,
    'send "\\021\\021"',
    'expect eof'
  ].join('\n');
  await new Promise<void>((resolve) => {
    const dashboard = spawn('/usr/bin/expect', ['-c', expectScript], {
      env: {
        ...process.env,
        AGENT_USAGE_GROK_REFRESH_COMMAND: command,
        TERM: process.env.TERM ?? 'xterm-256color'
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    dashboard.stdout.resume();
    dashboard.stderr.resume();
    let settled = false;
    const stopTimer = setTimeout(() => {
      dashboard.kill('SIGTERM');
      finish();
    }, refreshTimeoutMs);
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(stopTimer);
      resolve();
    };
    dashboard.once('error', finish);
    dashboard.once('exit', finish);
  });
}

function parseLatestBillingLog(text: string): GrokBuildBilling | null {
  const lines = text.split(/\r?\n/);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index].trim();
    if (!line) continue;
    let record: unknown;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    const entry = z
      .object({
        ts: z.string(),
        msg: z.string(),
        ctx: z.unknown()
      })
      .safeParse(record);
    if (!entry.success || entry.data.msg !== 'billing: fetched credits config') continue;
    const billing = grokBillingResponseSchema.safeParse({
      ...(typeof entry.data.ctx === 'object' && entry.data.ctx !== null ? entry.data.ctx : {}),
      sourceObservedAt: entry.data.ts
    });
    if (billing.success) return billing.data;
  }
  return null;
}

async function readLogTail(path: string): Promise<string> {
  const maximumBytes = 2 * 1024 * 1024;
  const handle = await open(path, 'r');
  try {
    const stats = await handle.stat();
    const length = Math.min(stats.size, maximumBytes);
    const start = Math.max(0, stats.size - length);
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, start);
    const text = buffer.toString('utf8');
    if (start === 0) return text;
    const firstNewline = text.indexOf('\n');
    return firstNewline === -1 ? '' : text.slice(firstNewline + 1);
  } finally {
    await handle.close();
  }
}

class JsonRpcError extends Error {
  readonly code: number;

  constructor(body: JsonRpcErrorBody) {
    super(body.message ?? `Grok ACP error ${body.code}`);
    this.name = 'JsonRpcError';
    this.code = body.code;
  }
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

class JsonLinePeer {
  readonly #process: GrokBillingProcess;
  readonly #timeoutMs: number;
  readonly #pending = new Map<number, PendingRequest>();
  #nextId = 1;
  #buffer = '';
  #closed = false;

  constructor(process: GrokBillingProcess, timeoutMs: number) {
    this.#process = process;
    this.#timeoutMs = timeoutMs;
    process.stdout.setEncoding('utf8');
    process.stdout.on('data', (chunk: string) => this.#consume(chunk));
    process.once('error', (error) => this.#fail(unavailableError(error)));
    process.once('exit', (code, signal) => {
      if (this.#closed) return;
      this.#fail(
        new GrokBillingAdapterError(
          'grok-client-unavailable',
          'Grok Build exited before billing was returned.',
          'Run grok login, then update or restart Grok Build.',
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
          new GrokBillingAdapterError(
            'grok-client-timeout',
            'Grok Build did not return billing in time.',
            'Open Grok Build and run /usage, then retry.'
          )
        );
      }, this.#timeoutMs);
      this.#pending.set(id, { resolve, reject, timeout });
      this.#process.stdin.write(
        `${JSON.stringify({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) })}\n`
      );
    });
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(unavailableError(new Error('Grok ACP connection closed')));
    }
    this.#pending.clear();
    this.#process.kill();
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
    let response: JsonRpcResponse;
    try {
      response = JSON.parse(line) as JsonRpcResponse;
    } catch (error) {
      this.#fail(
        new GrokBillingAdapterError(
          'grok-client-protocol-error',
          'Grok Build returned an invalid ACP message.',
          'Update Grok Build and Agent Usage, then retry.',
          { cause: error }
        )
      );
      return;
    }
    if (typeof response.id !== 'number') return;
    const pending = this.#pending.get(response.id);
    if (!pending) return;
    clearTimeout(pending.timeout);
    this.#pending.delete(response.id);
    if (response.error) pending.reject(new JsonRpcError(response.error));
    else pending.resolve(response.result);
  }

  #fail(error: Error): void {
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.#pending.clear();
  }
}

function unavailableError(cause: unknown): GrokBillingAdapterError {
  return new GrokBillingAdapterError(
    'grok-client-unavailable',
    'Grok Build billing capability is unavailable.',
    'Install or update Grok Build, run grok login, then retry.',
    { cause }
  );
}
