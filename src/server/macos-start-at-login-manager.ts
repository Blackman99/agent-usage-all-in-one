import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';

import type { StartAtLoginManager } from '../core/types.js';

const LABEL = 'dev.agent-usage.daemon';

export interface MacOsStartAtLoginManagerOptions {
  userHome: string;
  executable: string;
  cliPath: string;
  applicationHome: string;
  label?: string;
  nodeImport?: string;
  environmentVariables?: Record<string, string>;
}

export class MacOsStartAtLoginManager implements StartAtLoginManager {
  readonly #path: string;
  readonly #options: MacOsStartAtLoginManagerOptions;

  constructor(options: MacOsStartAtLoginManagerOptions) {
    const label = validateLaunchAgentLabel(options.label ?? LABEL);
    if (options.nodeImport) validateNodeImport(options.nodeImport);
    this.#options = { ...options, label };
    this.#path = join(options.userHome, 'Library', 'LaunchAgents', `${label}.plist`);
  }

  async setEnabled(enabled: boolean): Promise<void> {
    if (!enabled) {
      await rm(this.#path, { force: true });
      return;
    }
    await mkdir(dirname(this.#path), { recursive: true, mode: 0o700 });
    await writeFile(this.#path, launchAgentPlist(this.#options), { mode: 0o600 });
  }

  async isEnabled(): Promise<boolean> {
    try {
      const { access } = await import('node:fs/promises');
      await access(this.#path);
      return true;
    } catch {
      return false;
    }
  }
}

function launchAgentPlist(options: MacOsStartAtLoginManagerOptions): string {
  const label = options.label ?? LABEL;
  const arguments_ = [
    options.executable,
    ...(options.nodeImport ? ['--import', options.nodeImport] : []),
    options.cliPath,
    '--home',
    options.applicationHome,
    'serve'
  ];
  const environmentVariables = Object.entries(options.environmentVariables ?? {});
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${escapeXml(label)}</string>
<key>ProgramArguments</key><array>${arguments_.map((value) => `<string>${escapeXml(value)}</string>`).join('')}</array>
${environmentVariables.length > 0 ? `<key>EnvironmentVariables</key><dict>${environmentVariables.map(([key, value]) => `<key>${escapeXml(key)}</key><string>${escapeXml(value)}</string>`).join('')}</dict>\n` : ''}<key>RunAtLoad</key><true/>
<key>KeepAlive</key><false/>
</dict></plist>\n`;
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function validateLaunchAgentLabel(label: string): string {
  if (!/^[A-Za-z0-9.-]+$/.test(label)) {
    throw new Error('LaunchAgent label may contain only letters, numbers, dots, and hyphens');
  }
  return label;
}

function validateNodeImport(nodeImport: string): void {
  if (isAbsolute(nodeImport)) return;
  try {
    if (new URL(nodeImport).protocol === 'file:') return;
  } catch {
    // Fall through to the actionable validation error.
  }
  throw new Error('Node import must be an absolute path or file URL');
}
