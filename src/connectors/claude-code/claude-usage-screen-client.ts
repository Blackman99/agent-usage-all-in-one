import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import type { Readable, Writable } from 'node:stream';

import type { ClaudeQuotaClient } from './claude-code-connector.js';

export interface ParsedClaudeQuota {
  id: string;
  label: string;
  usedPercent: number;
  resetsAt: string | null;
}

export class ClaudeUsageAdapterError extends Error {
  readonly code: string;
  readonly recovery: string;

  constructor(code: string, message: string, recovery: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ClaudeUsageAdapterError';
    this.code = code;
    this.recovery = recovery;
  }
}

export interface ClaudeUsageProcess {
  readonly stdin: Writable;
  readonly stdout: Readable;
  readonly stderr: Readable;
  once(event: 'error', listener: (error: Error) => void): this;
  once(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): this;
  kill(signal?: NodeJS.Signals): boolean;
}

export interface ScreenReaderClaudeQuotaClientOptions {
  command?: string;
  expectCommand?: string;
  timeoutMs?: number;
  clock?: () => Date;
  spawnProcess?: (command: string, arguments_: string[]) => ClaudeUsageProcess;
}

export class ScreenReaderClaudeQuotaClient implements ClaudeQuotaClient {
  readonly #command: string;
  readonly #expectCommand: string;
  readonly #timeoutMs: number;
  readonly #clock: () => Date;
  readonly #spawnProcess: NonNullable<ScreenReaderClaudeQuotaClientOptions['spawnProcess']>;

  constructor(options: ScreenReaderClaudeQuotaClientOptions = {}) {
    this.#command = options.command ?? 'claude';
    this.#expectCommand = options.expectCommand ?? '/usr/bin/expect';
    this.#timeoutMs = options.timeoutMs ?? 8_000;
    this.#clock = options.clock ?? (() => new Date());
    this.#spawnProcess =
      options.spawnProcess ??
      ((command, arguments_) =>
        spawn(command, arguments_, {
          stdio: ['pipe', 'pipe', 'pipe']
        }) as ChildProcessWithoutNullStreams);
  }

  async readQuota(): Promise<ParsedClaudeQuota[]> {
    if (!/^[a-zA-Z0-9_./-]+$/.test(this.#command)) {
      throw unavailableError(new Error('Unsafe Claude command path'));
    }
    let child: ClaudeUsageProcess;
    try {
      child = this.#spawnProcess(this.#expectCommand, [
        '-c',
        expectScript(this.#command, Math.max(1, Math.ceil(this.#timeoutMs / 1000)))
      ]);
    } catch (error) {
      throw unavailableError(error);
    }

    return await new Promise<ParsedClaudeQuota[]>((resolve, reject) => {
      let output = '';
      let settled = false;
      const finish = (result: ParsedClaudeQuota[] | Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        child.kill();
        if (result instanceof Error) reject(result);
        else resolve(result);
      };
      const timeout = setTimeout(
        () =>
          finish(
            new ClaudeUsageAdapterError(
              'claude-usage-timeout',
              'Claude Code did not return the usage screen in time.',
              'Open Claude Code, run /usage, then retry.'
            )
          ),
        this.#timeoutMs
      );
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        output += stripTerminalControls(chunk);
        if (
          /__CLAUDE_TRUST_REQUIRED__|Quick safety check|Is this a project you created/i.test(output)
        ) {
          finish(
            new ClaudeUsageAdapterError(
              'claude-workspace-not-trusted',
              'Claude Code has not trusted this workspace.',
              'Open Claude Code in this folder, review the trust prompt, then retry.'
            )
          );
          return;
        }
        if (!/__CLAUDE_USAGE_DONE__|Esc to cancel/i.test(output)) return;
        try {
          finish(parseClaudeUsageScreen(output, this.#clock()));
        } catch (error) {
          finish(error instanceof Error ? error : schemaError(error));
        }
      });
      child.once('error', (error) => finish(unavailableError(error)));
      child.once('exit', () => {
        if (!settled) finish(unavailableError());
      });
    });
  }
}

function expectScript(command: string, timeoutSeconds: number): string {
  return `log_user 1
set timeout 1
spawn {${command}} --safe-mode --ax-screen-reader
expect {
  -re {Quick safety check|Is this a project you created} {
    puts "\\n__CLAUDE_TRUST_REQUIRED__"
    exit 20
  }
  timeout {}
  eof { exit 22 }
}
send -- "/usage\\r"
set timeout ${timeoutSeconds}
expect {
  -re {Quick safety check|Is this a project you created} {
    puts "\\n__CLAUDE_TRUST_REQUIRED__"
    exit 20
  }
  -re {Esc to cancel} {
    puts "\\n__CLAUDE_USAGE_DONE__"
    send -- "\\033"
    after 100
    send -- "/exit\\r"
    after 100
    exit 0
  }
  timeout {
    puts "\\n__CLAUDE_USAGE_TIMEOUT__"
    exit 21
  }
  eof { exit 22 }
}`;
}

export function parseClaudeUsageScreen(text: string, now: Date): ParsedClaudeQuota[] {
  const lines = stripTerminalControls(text)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const quotas: ParsedClaudeQuota[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/(\d+(?:\.\d+)?)%\s+used/i);
    if (!match) continue;
    const heading = findHeading(lines, index);
    if (!heading) continue;
    const resetLine = lines.slice(index + 1, index + 4).find((line) => /^Resets\b/i.test(line));
    quotas.push({
      id: slugify(heading),
      label: displayLabel(heading),
      usedPercent: Number(match[1]),
      resetsAt: resetLine ? parseReset(resetLine, now) : null
    });
  }
  if (quotas.length === 0) {
    throw new ClaudeUsageAdapterError(
      'claude-subscription-quota-unavailable',
      'Claude Code subscription quota is unavailable.',
      'Sign in with a Claude subscription, open Claude Code, and run /usage.'
    );
  }
  return quotas;
}

function findHeading(lines: string[], percentIndex: number): string | null {
  for (let index = percentIndex - 1; index >= Math.max(0, percentIndex - 3); index -= 1) {
    const line = lines[index];
    if (/^(Plan usage|Settings|Usage|Session|Resets)/i.test(line)) continue;
    if (/^[━─█▁▂▃▄▅▆▇\s]+$/.test(line)) continue;
    return line;
  }
  return null;
}

function displayLabel(heading: string): string {
  if (/^(5[- ]hour limit|current session)$/i.test(heading)) return '5 hour';
  const weekly = heading.match(/^Weekly\s*[·—-]\s*(.+)$/i);
  return weekly ? `Week · ${weekly[1]}` : heading;
}

function parseReset(line: string, now: Date): string | null {
  const relative = line.match(/Resets\s+in\s+(?:(\d+)d\s*)?(?:(\d+)h\s*)?(?:(\d+)m)?/i);
  if (relative) {
    const milliseconds =
      (Number(relative[1] ?? 0) * 24 * 60 +
        Number(relative[2] ?? 0) * 60 +
        Number(relative[3] ?? 0)) *
      60_000;
    return new Date(now.getTime() + milliseconds).toISOString();
  }
  const value = line
    .replace(/^Resets\s+/i, '')
    .replace(/\s*\([^)]+\)\s*$/, '')
    .trim();
  const withYear = /\b\d{4}\b/.test(value) ? value : `${value}, ${now.getFullYear()}`;
  const timestamp = Date.parse(withYear);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function stripTerminalControls(value: string): string {
  return (
    value
      // OSC and CSI are protocol control sequences emitted by the official terminal UI.
      // eslint-disable-next-line no-control-regex
      .replace(/\u001B\][^\u0007]*(?:\u0007|\u001B\\)/g, '')
      // eslint-disable-next-line no-control-regex
      .replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, '')
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
  );
}

function unavailableError(cause?: unknown): ClaudeUsageAdapterError {
  return new ClaudeUsageAdapterError(
    'claude-usage-client-unavailable',
    'Claude Code usage client is unavailable.',
    'Install or update Claude Code, then retry.',
    { cause }
  );
}

function schemaError(cause?: unknown): ClaudeUsageAdapterError {
  return new ClaudeUsageAdapterError(
    'claude-usage-schema-changed',
    'Claude Code returned an unsupported usage screen.',
    'Update Agent Usage and Claude Code, then retry.',
    { cause }
  );
}
