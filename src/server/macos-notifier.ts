import { spawn } from 'node:child_process';

import type { LocalNotification, LocalNotifier } from '../core/types.js';

export class MacOsNotifier implements LocalNotifier {
  async notify(event: LocalNotification): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(
        '/usr/bin/osascript',
        [
          '-e',
          'on run argv\ndisplay notification (item 2 of argv) with title (item 1 of argv)\nend run',
          '--',
          event.title,
          event.message
        ],
        { stdio: 'ignore' }
      );
      child.once('error', reject);
      child.once('close', (code) => (code === 0 ? resolve() : reject(new Error('notify failed'))));
    });
  }
}
