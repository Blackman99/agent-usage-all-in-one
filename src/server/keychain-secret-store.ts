import { spawn } from 'node:child_process';

import type { SecretStore } from '../core/onboarding-types.js';

const SERVICE = 'dev.agent-usage.secrets';
const ITEM_NOT_FOUND = 44;

export interface SecurityCommandResult {
  exitCode: number;
  output?: string;
}

export type SecurityCommandRunner = (
  arguments_: string[],
  input?: string
) => Promise<SecurityCommandResult>;

export class MacOsKeychainSecretStore implements SecretStore {
  readonly #run: SecurityCommandRunner;
  readonly #service: string;

  constructor(run: SecurityCommandRunner = runSecurityCommand, options: { service?: string } = {}) {
    this.#run = run;
    this.#service = options.service ?? SERVICE;
  }

  async set(reference: string, value: string): Promise<void> {
    const result = await this.#run(
      ['add-generic-password', '-U', '-a', reference, '-s', this.#service, '-w'],
      `${value}\n`
    );
    if (result.exitCode !== 0)
      throw new Error(`Keychain write failed with code ${result.exitCode}`);
  }

  async has(reference: string): Promise<boolean> {
    const result = await this.#run(['find-generic-password', '-a', reference, '-s', this.#service]);
    if (result.exitCode === 0) return true;
    if (result.exitCode === ITEM_NOT_FOUND) return false;
    throw new Error(`Keychain lookup failed with code ${result.exitCode}`);
  }

  async get(reference: string): Promise<string | null> {
    const result = await this.#run([
      'find-generic-password',
      '-a',
      reference,
      '-s',
      this.#service,
      '-w'
    ]);
    if (result.exitCode === ITEM_NOT_FOUND) return null;
    if (result.exitCode !== 0) {
      throw new Error(`Keychain read failed with code ${result.exitCode}`);
    }
    return result.output?.replace(/\r?\n$/, '') ?? null;
  }

  async delete(reference: string): Promise<void> {
    const result = await this.#run([
      'delete-generic-password',
      '-a',
      reference,
      '-s',
      this.#service
    ]);
    if (result.exitCode !== 0 && result.exitCode !== ITEM_NOT_FOUND) {
      throw new Error(`Keychain delete failed with code ${result.exitCode}`);
    }
  }
}

async function runSecurityCommand(
  arguments_: string[],
  input?: string
): Promise<SecurityCommandResult> {
  return await new Promise((resolveResult, reject) => {
    const child = spawn('/usr/bin/security', arguments_, {
      stdio: ['pipe', 'pipe', 'ignore']
    });
    let output = '';
    child.stdout.setEncoding('utf8').on('data', (chunk) => (output += chunk));
    child.once('error', reject);
    child.once('close', (exitCode) => resolveResult({ exitCode: exitCode ?? 1, output }));
    if (input) child.stdin.end(input);
    else child.stdin.end();
  });
}
