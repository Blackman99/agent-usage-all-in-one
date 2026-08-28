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
  environment?: NodeJS.ProcessEnv;
  spawnProcess?: (
    command: string,
    arguments_: string[],
    options: { env: NodeJS.ProcessEnv }
  ) => ClaudeUsageProcess;
}

export class ScreenReaderClaudeQuotaClient implements ClaudeQuotaClient {
  readonly #command: string;
  readonly #expectCommand: string;
  readonly #timeoutMs: number;
  readonly #clock: () => Date;
  readonly #environment: NodeJS.ProcessEnv;
  readonly #spawnProcess: NonNullable<ScreenReaderClaudeQuotaClientOptions['spawnProcess']>;

  constructor(options: ScreenReaderClaudeQuotaClientOptions = {}) {
    this.#command = options.command ?? 'claude';
    this.#expectCommand = options.expectCommand ?? '/usr/bin/expect';
    this.#timeoutMs = options.timeoutMs ?? 24_000;
    this.#clock = options.clock ?? (() => new Date());
    this.#environment = subscriptionEnvironment(options.environment ?? process.env);
    this.#spawnProcess =
      options.spawnProcess ??
      ((command, arguments_, spawnOptions) =>
        spawn(command, arguments_, {
          ...spawnOptions,
          stdio: ['pipe', 'pipe', 'pipe']
        }) as ChildProcessWithoutNullStreams);
  }

  async readQuota(): Promise<ParsedClaudeQuota[]> {
    if (!/^[a-zA-Z0-9_./-]+$/.test(this.#command)) {
      throw unavailableError(new Error('Unsafe Claude command path'));
    }
    let child: ClaudeUsageProcess;
    try {
      const [firstScreenTimeoutSeconds, redrawTimeoutSeconds] = usageTimeoutSeconds(
        this.#timeoutMs
      );
      child = this.#spawnProcess(
        this.#expectCommand,
        ['-c', expectScript(this.#command, firstScreenTimeoutSeconds, redrawTimeoutSeconds)],
        { env: this.#environment }
      );
    } catch (error) {
      throw unavailableError(error);
    }

    return await new Promise<ParsedClaudeQuota[]>((resolve, reject) => {
      let output = '';
      let settled = false;
      const finish = (result: ParsedClaudeQuota[] | Error, terminate = true) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (terminate) child.kill();
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
        if (!/__CLAUDE_USAGE_DONE__/i.test(output)) return;
        try {
          finish(parseClaudeUsageScreen(output, this.#clock()), false);
        } catch (error) {
          finish(error instanceof Error ? error : schemaError(error));
        }
      });
      child.once('error', (error) => finish(unavailableError(error)));
      child.once('exit', (code, signal) => {
        if (settled) return;
        if (output.trim()) {
          try {
            finish(parseClaudeUsageScreen(output, this.#clock()));
            return;
          } catch (error) {
            if (error instanceof ClaudeUsageAdapterError) {
              finish(error);
              return;
            }
          }
        }
        finish(
          unavailableError(new Error(`Claude Code exited with ${String(code)} (${String(signal)})`))
        );
      });
    });
  }
}

function subscriptionEnvironment(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const subscriptionEnvironment = { ...environment };
  for (const key of [
    'ANTHROPIC_API_KEY',
    'ANTHROPIC_AUTH_TOKEN',
    'ANTHROPIC_BASE_URL',
    'ANTHROPIC_MODEL',
    'CLAUDE_CODE_USE_BEDROCK',
    'CLAUDE_CODE_USE_VERTEX',
    'CLAUDE_CODE_USE_FOUNDRY'
  ]) {
    delete subscriptionEnvironment[key];
  }
  return subscriptionEnvironment;
}

function usageTimeoutSeconds(timeoutMs: number): [number, number] {
  const usableSeconds = Math.max(2, Math.floor((timeoutMs - 2_000) / 1_000));
  const firstScreenTimeoutSeconds = Math.max(1, Math.min(8, usableSeconds - 1));
  return [firstScreenTimeoutSeconds, Math.max(1, usableSeconds - firstScreenTimeoutSeconds)];
}

function expectScript(
  command: string,
  firstScreenTimeoutSeconds: number,
  redrawTimeoutSeconds: number
): string {
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
set timeout ${firstScreenTimeoutSeconds}
expect {
  -re {Quick safety check|Is this a project you created} {
    puts "\\n__CLAUDE_TRUST_REQUIRED__"
    exit 20
  }
  -re {Esc to cancel} {
    set timeout ${redrawTimeoutSeconds}
    expect {
      -re {Current week \\(Fable\\)} {
        expect {
          -re {Esc to cancel} {}
          timeout {}
          eof { exit 22 }
        }
      }
      timeout {}
      eof { exit 22 }
    }
    send -- "\\033"
    after 100
    send -- "/exit\\r"
    after 500
    puts "\\n__CLAUDE_USAGE_DONE__"
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
    .replace(/Esc to cancel/gi, '\n')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const quotas = new Map<string, ParsedClaudeQuota>();
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/(\d+(?:\.\d+)?)%\s+used/i);
    if (!match) continue;
    const heading = findHeading(lines, index);
    if (!heading || /^Refreshing/i.test(heading)) continue;
    const resetLine = lines.slice(index + 1, index + 4).find((line) => /^Resets\b/i.test(line));
    const id = slugify(heading);
    quotas.set(id, {
      id,
      label: displayLabel(heading),
      usedPercent: Number(match[1]),
      resetsAt: resetLine ? parseReset(resetLine, now) : null
    });
  }
  if (quotas.size === 0) {
    throw new ClaudeUsageAdapterError(
      'claude-subscription-quota-unavailable',
      'Claude Code subscription quota is unavailable.',
      'Sign in with a Claude subscription, open Claude Code, and run /usage.'
    );
  }
  return [...quotas.values()];
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
  const currentWeek = heading.match(/^Current week\s*\((.+)\)$/i);
  if (currentWeek) {
    if (/^all models$/i.test(currentWeek[1])) return 'Week · All models';
    if (/^fable(?: only)?$/i.test(currentWeek[1])) return 'Week · Fable only';
    return `Week · ${currentWeek[1]}`;
  }
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
  const timeZone = line.match(/\(([^)]+)\)\s*$/)?.[1];
  const value = line
    .replace(/^Resets\s+/i, '')
    .replace(/\s*\([^)]+\)\s*$/, '')
    .trim();
  if (timeZone) {
    const zoned = parseZonedReset(value, timeZone, now);
    if (zoned) return zoned.toISOString();
  }
  const withYear = /\b\d{4}\b/.test(value) ? value : `${value}, ${now.getFullYear()}`;
  const timestamp = Date.parse(withYear);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function parseZonedReset(value: string, timeZone: string, now: Date): Date | null {
  try {
    const nowParts = dateTimeParts(now, timeZone);
    const timeOnly = value.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i);
    if (timeOnly) {
      const hour = hour24(Number(timeOnly[1]), timeOnly[3]);
      const minute = Number(timeOnly[2] ?? 0);
      let reset = zonedDateTime(
        nowParts.year,
        nowParts.month,
        nowParts.day,
        hour,
        minute,
        timeZone
      );
      if (reset.getTime() <= now.getTime()) {
        const tomorrow = new Date(Date.UTC(nowParts.year, nowParts.month - 1, nowParts.day + 1));
        reset = zonedDateTime(
          tomorrow.getUTCFullYear(),
          tomorrow.getUTCMonth() + 1,
          tomorrow.getUTCDate(),
          hour,
          minute,
          timeZone
        );
      }
      return reset;
    }

    const dated = value.match(
      /^([A-Za-z]+)\s+(\d{1,2})(?:,\s*|\s+)(?:(\d{4})(?:,\s*|\s+))?(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i
    );
    if (!dated) return null;
    const month = monthNumber(dated[1]);
    if (month === null) return null;
    let year = Number(dated[3] ?? nowParts.year);
    const resetForYear = (candidateYear: number) =>
      zonedDateTime(
        candidateYear,
        month,
        Number(dated[2]),
        hour24(Number(dated[4]), dated[6]),
        Number(dated[5] ?? 0),
        timeZone
      );
    let reset = resetForYear(year);
    if (!dated[3] && reset.getTime() <= now.getTime()) {
      year += 1;
      reset = resetForYear(year);
    }
    return reset;
  } catch {
    return null;
  }
}

function zonedDateTime(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string
): Date {
  const target = Date.UTC(year, month - 1, day, hour, minute);
  let timestamp = target;
  for (let iteration = 0; iteration < 3; iteration += 1) {
    const represented = dateTimeParts(new Date(timestamp), timeZone);
    const representedTimestamp = Date.UTC(
      represented.year,
      represented.month - 1,
      represented.day,
      represented.hour,
      represented.minute
    );
    timestamp += target - representedTimestamp;
  }
  return new Date(timestamp);
}

function dateTimeParts(
  date: Date,
  timeZone: string
): { year: number; month: number; day: number; hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((candidate) => candidate.type === type)?.value);
  return {
    year: part('year'),
    month: part('month'),
    day: part('day'),
    hour: part('hour'),
    minute: part('minute')
  };
}

function hour24(hour: number, meridiem: string): number {
  return (hour % 12) + (/pm/i.test(meridiem) ? 12 : 0);
}

function monthNumber(value: string): number | null {
  const index = [
    'jan',
    'feb',
    'mar',
    'apr',
    'may',
    'jun',
    'jul',
    'aug',
    'sep',
    'oct',
    'nov',
    'dec'
  ].indexOf(value.slice(0, 3).toLowerCase());
  return index === -1 ? null : index + 1;
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
