import { spawn } from 'node:child_process';

export interface CursorAboutClientOptions {
  command?: string;
  timeoutMs?: number;
  environment?: NodeJS.ProcessEnv;
  runCommand?: (
    command: string,
    arguments_: string[],
    options: { env: NodeJS.ProcessEnv; timeoutMs: number }
  ) => Promise<string>;
}

export class CursorAboutAccountClient {
  readonly #command: string;
  readonly #timeoutMs: number;
  readonly #environment: NodeJS.ProcessEnv;
  readonly #runCommand: NonNullable<CursorAboutClientOptions['runCommand']>;

  constructor(options: CursorAboutClientOptions = {}) {
    this.#command = options.command ?? 'agent';
    this.#timeoutMs = options.timeoutMs ?? 8_000;
    this.#environment = {
      ...(options.environment ?? process.env),
      LC_ALL: 'en_US.UTF-8',
      LANG: 'en_US.UTF-8'
    };
    this.#runCommand = options.runCommand ?? runCaptured;
  }

  async readAccountIdentifier(): Promise<string | null> {
    if (!/^[a-zA-Z0-9_./-]+$/.test(this.#command)) return null;
    try {
      const stdout = await this.#runCommand(this.#command, ['about', '--format', 'json'], {
        env: this.#environment,
        timeoutMs: this.#timeoutMs
      });
      const parsed = JSON.parse(stdout) as { userEmail?: unknown };
      return typeof parsed.userEmail === 'string' && parsed.userEmail.trim()
        ? parsed.userEmail.trim()
        : null;
    } catch {
      return null;
    }
  }
}

function runCaptured(
  command: string,
  arguments_: string[],
  options: { env: NodeJS.ProcessEnv; timeoutMs: number }
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, arguments_, {
      env: options.env,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('agent about timed out'));
    }, options.timeoutMs);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout);
      else reject(new Error(`agent about exited ${String(code)}`));
    });
  });
}
