import { constants } from 'node:fs';
import { access } from 'node:fs/promises';
import { delimiter, isAbsolute, join, resolve } from 'node:path';

import type {
  ConnectorDefinition,
  DiscoveryInspection,
  DiscoveryProbe
} from '../core/onboarding-types.js';

export interface PathDiscoveryProbeOptions {
  path?: string;
  home?: string;
}

export class PathDiscoveryProbe implements DiscoveryProbe {
  readonly #path: string;
  readonly #home: string;

  constructor(options: PathDiscoveryProbeOptions = {}) {
    this.#path = options.path ?? process.env.PATH ?? '';
    this.#home = options.home ?? process.env.HOME ?? '';
  }

  async inspect(definition: ConnectorDefinition): Promise<DiscoveryInspection> {
    const binaryPath = definition.command ? await this.#findExecutable(definition.command) : null;
    const officialCredentialPresent = await anyPathExists(
      (definition.officialCredentialPaths ?? []).map((path) =>
        isAbsolute(path) ? path : resolve(this.#home, path)
      )
    );
    return {
      installed: definition.command === null || binaryPath !== null,
      binaryPath,
      officialCredentialPresent
    };
  }

  async #findExecutable(command: string): Promise<string | null> {
    if (command.includes('/')) return (await isExecutable(command)) ? resolve(command) : null;
    for (const directory of this.#path.split(delimiter).filter(Boolean)) {
      const candidate = join(directory, command);
      if (await isExecutable(candidate)) return candidate;
    }
    return null;
  }
}

async function isExecutable(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function anyPathExists(paths: string[]): Promise<boolean> {
  for (const path of paths) {
    try {
      await access(path, constants.F_OK);
      return true;
    } catch {
      // Existence checks intentionally do not open or read official credential files.
    }
  }
  return false;
}
