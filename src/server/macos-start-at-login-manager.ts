import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import type { StartAtLoginManager } from '../core/types.js';

const LABEL = 'dev.agent-usage.daemon';

export interface MacOsStartAtLoginManagerOptions {
  userHome: string;
  executable: string;
  cliPath: string;
  applicationHome: string;
}

export class MacOsStartAtLoginManager implements StartAtLoginManager {
  readonly #path: string;
  readonly #options: MacOsStartAtLoginManagerOptions;

  constructor(options: MacOsStartAtLoginManagerOptions) {
    this.#options = options;
    this.#path = join(options.userHome, 'Library', 'LaunchAgents', `${LABEL}.plist`);
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
  const arguments_ = [
    options.executable,
    options.cliPath,
    '--home',
    options.applicationHome,
    'serve'
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${LABEL}</string>
<key>ProgramArguments</key><array>${arguments_.map((value) => `<string>${escapeXml(value)}</string>`).join('')}</array>
<key>RunAtLoad</key><true/>
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
