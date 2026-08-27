import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
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

  constructor(options: StdioGrokBillingClientOptions = {}) {
    this.#command = options.command ?? 'grok';
    this.#timeoutMs = options.timeoutMs ?? 8_000;
    this.#spawnProcess =
      options.spawnProcess ??
      ((command, arguments_) =>
        spawn(command, arguments_, {
          stdio: ['pipe', 'pipe', 'pipe']
        }) as ChildProcessWithoutNullStreams);
  }

  async readBilling(): Promise<GrokBuildBilling> {
    let process: GrokBillingProcess;
    try {
      process = this.#spawnProcess(this.#command, ['agent', '--no-leader', 'stdio']);
    } catch (error) {
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

      const result = await peer.request('x.ai/billing');
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
