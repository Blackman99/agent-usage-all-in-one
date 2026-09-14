import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { clampPercent, percentFromUsedAndLimit } from '../../core/quota-normalization.js';

export class CursorUsageAdapterError extends Error {
  readonly code: string;
  readonly recovery: string;

  constructor(code: string, message: string, recovery: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'CursorUsageAdapterError';
    this.code = code;
    this.recovery = recovery;
  }
}

export type ParsedCursorOnDemand =
  | { kind: 'fixed'; usedAmount: number; limitAmount: number; currency: 'USD'; usedPercent: number }
  | { kind: 'unlimited'; usedAmount: number; currency: 'USD' }
  | { kind: 'disabled' };

export type ParsedCursorUsage =
  | {
      kind: 'meters';
      included: { usedPercent: number };
      onDemand: ParsedCursorOnDemand | null;
      resetLabel: string | null;
    }
  | { kind: 'unmetered' };

export interface CursorUsageSession {
  command: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
}

export interface ScreenReaderCursorQuotaClientOptions {
  command?: string;
  timeoutMs?: number;
  environment?: NodeJS.ProcessEnv;
  runSession?: (session: CursorUsageSession) => Promise<string>;
}

const NOT_LOGGED_IN = /Not logged in\. Run \/login first/i;
const UNMETERED_PLAN = /Usage details are not available for this plan in the CLI/i;
const SPEND_CHART = /Personal spend for the current billing period/i;
const STANDARD_TABLE = /Monthly plan and on-demand usage/i;
const RESET_LINE = /^(Resets\s+.+)$/i;

export function parseCursorUsageScreen(text: string): ParsedCursorUsage {
  const normalized = collapseVerticalLetters(stripTerminalControls(text));
  const lines = normalized
    .split(/\r?\n/)
    .map((line) => collapseSpaces(line))
    .filter(Boolean);
  const body = `${lines.join('\n')}\n${collapseSpaces(normalized)}`;

  if (NOT_LOGGED_IN.test(body)) {
    throw new CursorUsageAdapterError(
      'cursor-not-logged-in',
      'Cursor Agent CLI is not signed in.',
      'Run agent login, then retry.'
    );
  }
  if (UNMETERED_PLAN.test(body) || SPEND_CHART.test(body)) {
    return { kind: 'unmetered' };
  }

  const included = findIncludedPercent(lines);
  if (included === null) {
    if (STANDARD_TABLE.test(body) || UNMETERED_PLAN.test(body) || SPEND_CHART.test(body)) {
      return { kind: 'unmetered' };
    }
    throw new CursorUsageAdapterError(
      'cursor-usage-unparsed',
      'Cursor /usage did not print Included usage.',
      'Open agent, run /usage, then retry after updating Cursor Agent CLI.'
    );
  }

  return {
    kind: 'meters',
    included: { usedPercent: included },
    onDemand: parseOnDemand(lines),
    resetLabel: lines.find((line) => RESET_LINE.test(line)) ?? null
  };
}

function findIncludedPercent(lines: string[]): number | null {
  for (const line of lines) {
    const compact = line.match(/^Included:\s*(\d+(?:\.\d+)?)%\s+used/i);
    if (compact) return clampPercent(Number(compact[1]));
    const table = line.match(/^Included\s+(\d+(?:\.\d+)?)%\s+used/i);
    if (table) return clampPercent(Number(table[1]));
  }
  return null;
}

function parseOnDemand(lines: string[]): ParsedCursorOnDemand | null {
  const joined = lines.join('\n');
  if (/On-demand usage is off/i.test(joined) || /On-Demand:\s*Disabled/i.test(joined)) {
    return { kind: 'disabled' };
  }
  if (/On-demand limit unavailable/i.test(joined)) {
    return null;
  }

  for (const line of lines) {
    const pair =
      line.match(/On-Demand[:\s]+(\$[\d,]+(?:\.\d+)?)\s*\/\s*(\$[\d,]+(?:\.\d+)?)/i) ??
      line.match(/^On-Demand\s+(\$[\d,]+(?:\.\d+)?)\s*\/\s*(\$[\d,]+(?:\.\d+)?)/i);
    if (pair) {
      const usedAmount = parseUsd(pair[1]);
      const limitAmount = parseUsd(pair[2]);
      const usedPercent = percentFromUsedAndLimit(usedAmount, limitAmount);
      if (usedAmount === null || limitAmount === null || usedPercent === null) continue;
      return { kind: 'fixed', usedAmount, limitAmount, currency: 'USD', usedPercent };
    }
    const unlimited = line.match(/On-Demand[:\s]+(\$[\d,]+(?:\.\d+)?)(?:\s*$)/i);
    if (unlimited && /No monthly limit|No personal limit/i.test(joined)) {
      const usedAmount = parseUsd(unlimited[1]);
      if (usedAmount === null) continue;
      return { kind: 'unlimited', usedAmount, currency: 'USD' };
    }
  }
  return null;
}

function parseUsd(value: string): number | null {
  const amount = Number(value.replace(/[$,]/g, ''));
  return Number.isFinite(amount) ? amount : null;
}

function collapseSpaces(line: string): string {
  return line.replace(/\s+/g, ' ').trim();
}

/** Ink can paint labels one character per line; join those runs before matching. */
function collapseVerticalLetters(text: string): string {
  const lines = text.split(/\r?\n/);
  const collapsed: string[] = [];
  let run = '';
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 1 && /[\w%$.:/-]/.test(trimmed)) {
      run += trimmed;
      continue;
    }
    if (run) {
      collapsed.push(run);
      run = '';
    }
    collapsed.push(line);
  }
  if (run) collapsed.push(run);
  return collapsed.join('\n');
}

function stripTerminalControls(value: string): string {
  return (
    value
      // eslint-disable-next-line no-control-regex
      .replace(/\u001B\][^\u0007]*(?:\u0007|\u001B\\)/g, '')
      // eslint-disable-next-line no-control-regex
      .replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, '')
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
  );
}

export class ScreenReaderCursorQuotaClient {
  readonly #command: string;
  readonly #timeoutMs: number;
  readonly #environment: NodeJS.ProcessEnv;
  readonly #runSession: (session: CursorUsageSession) => Promise<string>;

  constructor(options: ScreenReaderCursorQuotaClientOptions = {}) {
    this.#command = options.command ?? 'agent';
    this.#timeoutMs = options.timeoutMs ?? 24_000;
    this.#environment = cursorUsageEnvironment(options.environment ?? process.env);
    this.#runSession = options.runSession ?? runCursorUsagePtySession;
  }

  async readUsage(): Promise<ParsedCursorUsage> {
    if (!/^[a-zA-Z0-9_./-]+$/.test(this.#command)) {
      throw unavailableError(new Error('Unsafe Cursor command path'));
    }
    const cwd = await mkdtemp(join(tmpdir(), 'agent-usage-cursor-'));
    try {
      const output = await this.#runSession({
        command: this.#command,
        cwd,
        env: this.#environment,
        timeoutMs: this.#timeoutMs
      });
      if (NOT_LOGGED_IN.test(output)) {
        throw new CursorUsageAdapterError(
          'cursor-not-logged-in',
          'Cursor Agent CLI is not signed in.',
          'Run agent login, then retry.'
        );
      }
      return parseCursorUsageScreen(output);
    } catch (error) {
      if (error instanceof CursorUsageAdapterError) throw error;
      throw unavailableError(error);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  }
}

export function cursorUsageEnvironment(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return {
    ...environment,
    LC_ALL: 'en_US.UTF-8',
    LANG: 'en_US.UTF-8',
    INK_SCREEN_READER: 'true'
  };
}

const CURSOR_USAGE_PTY_DRIVER = `#!/usr/bin/env python3
import os, pty, select, sys, time
def collect(fd, seconds):
    data = b""
    deadline = time.time() + seconds
    while time.time() < deadline:
        ready, _, _ = select.select([fd], [], [], max(0.0, deadline - time.time()))
        if not ready:
            continue
        try:
            chunk = os.read(fd, 8192)
        except OSError:
            break
        if not chunk:
            break
        data += chunk
    return data
def write_keys(fd, payload):
    try:
        os.write(fd, payload)
        return True
    except OSError:
        return False
command = sys.argv[1]
pid, fd = pty.fork()
if pid == 0:
    os.execvp(command, [command, "--trust", "--mode", "ask"])
captured = collect(fd, 2.5)
if write_keys(fd, b"/"):
    captured += collect(fd, 0.6)
if write_keys(fd, b"usage"):
    captured += collect(fd, 1.6)
if write_keys(fd, bytes([13])):
    captured += collect(fd, 10.0)
if write_keys(fd, bytes([27])):
    captured += collect(fd, 0.5)
try:
    os.kill(pid, 9)
except OSError:
    pass
sys.stdout.buffer.write(captured)
`;

async function runCursorUsagePtySession(session: CursorUsageSession): Promise<string> {
  const driver = join(session.cwd, 'run-cursor-usage-pty.py');
  await writeFile(driver, CURSOR_USAGE_PTY_DRIVER, { mode: 0o700 });
  return new Promise((resolve, reject) => {
    const child = spawn('python3', [driver, session.command], {
      cwd: session.cwd,
      env: {
        ...session.env,
        TERM: session.env.TERM ?? 'xterm-256color',
        COLUMNS: '120',
        LINES: '40'
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let output = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(
        new CursorUsageAdapterError(
          'cursor-usage-timeout',
          'Cursor Agent CLI did not return the usage screen in time.',
          'Open agent, run /usage, then retry.'
        )
      );
    }, session.timeoutMs);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      output += chunk;
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      if (output.trim()) resolve(output);
      else reject(new Error(stderr.trim() || `Cursor usage driver exited ${String(code)}`));
    });
  });
}

function unavailableError(cause?: unknown): CursorUsageAdapterError {
  return new CursorUsageAdapterError(
    'cursor-quota-adapter-failed',
    'Cursor subscription quota is unavailable.',
    'Open agent, run /usage, then retry.',
    cause instanceof Error ? { cause } : undefined
  );
}
