import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { z } from 'zod';

export const daemonStateSchema = z.object({
  pid: z.number().int().positive(),
  origin: z.string().url(),
  apiToken: z.string().min(1)
});

export type DaemonState = z.infer<typeof daemonStateSchema>;

export async function readDaemonState(home: string): Promise<DaemonState> {
  const content = await readFile(join(home, 'daemon.json'), 'utf8');
  return daemonStateSchema.parse(JSON.parse(content));
}

export async function writeDaemonState(home: string, state: DaemonState): Promise<void> {
  await mkdir(home, { recursive: true, mode: 0o700 });
  const temporaryPath = join(home, `daemon.${process.pid}.tmp`);
  const statePath = join(home, 'daemon.json');
  await writeFile(temporaryPath, JSON.stringify(state), { mode: 0o600 });
  await rename(temporaryPath, statePath);
}
