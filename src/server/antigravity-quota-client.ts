import { readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { QuotaBucket } from '../core/types.js';
import { ANTIGRAVITY_PRIMARY_BILLING_DOMAIN_ID } from '../connectors/antigravity/antigravity-connector.js';

export interface AntigravityQuotaClientOptions {
  logRoots?: string[];
  ports?: number[];
  fetchFn?: typeof fetch;
  timeoutMs?: number;
}

interface RawQuotaBucket {
  bucketId?: string;
  displayName?: string;
  description?: string;
  window?: string;
  remainingFraction?: number;
  remainingAmount?: number;
  resetTime?: string;
}

interface RawQuotaGroup {
  displayName?: string;
  description?: string;
  buckets?: RawQuotaBucket[];
}

interface RawQuotaResponse {
  response?: {
    groups?: RawQuotaGroup[];
    description?: string;
  };
}

export class AntigravityQuotaClient {
  readonly #logRoots: string[];
  readonly #ports?: number[];
  readonly #fetchFn: typeof fetch;
  readonly #timeoutMs: number;

  constructor(options: AntigravityQuotaClientOptions = {}) {
    this.#logRoots = options.logRoots ?? [
      join(homedir(), '.gemini/antigravity-cli/log'),
      join(homedir(), '.gemini/antigravity/log')
    ];
    this.#ports = options.ports;
    this.#fetchFn = options.fetchFn ?? globalThis.fetch;
    this.#timeoutMs = options.timeoutMs ?? 1500;
  }

  async readQuota(): Promise<QuotaBucket[] | null> {
    const candidatePorts = this.#ports ?? this.discoverCandidatePorts();
    if (candidatePorts.length === 0) {
      return null;
    }

    for (const port of candidatePorts) {
      const quota = await this.queryPort(port);
      if (quota) {
        return quota;
      }
    }

    return null;
  }

  discoverCandidatePorts(): number[] {
    const ports: number[] = [];
    const httpPortRegex = /Language server listening on random port at (\d+) for HTTP/g;

    for (const root of this.#logRoots) {
      try {
        const files = readdirSync(root)
          .filter((file) => file.endsWith('.log'))
          .sort()
          .reverse()
          .slice(0, 5);

        for (const file of files) {
          const filePath = join(root, file);
          try {
            const content = readFileSync(filePath, 'utf8');
            let match: RegExpExecArray | null;
            while ((match = httpPortRegex.exec(content)) !== null) {
              ports.push(Number(match[1]));
            }
          } catch {
            // Ignore unreadable individual log file
          }
        }
      } catch {
        // Ignore unreadable log root directory
      }
    }

    // Return unique ports, newest first
    return [...new Set(ports.reverse())];
  }

  private async queryPort(port: number): Promise<QuotaBucket[] | null> {
    try {
      const url = `http://127.0.0.1:${port}/exa.language_server_pb.LanguageServerService/RetrieveUserQuotaSummary`;
      const response = await this.#fetchFn(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Connect-Protocol-Version': '1'
        },
        body: JSON.stringify({}),
        signal: AbortSignal.timeout(this.#timeoutMs)
      });

      if (!response.ok) {
        return null;
      }

      const body = (await response.json()) as RawQuotaResponse;
      const groups = body.response?.groups;
      if (!Array.isArray(groups) || groups.length === 0) {
        return null;
      }

      return mapQuotaGroups(groups);
    } catch {
      return null;
    }
  }
}

export function mapQuotaGroups(groups: RawQuotaGroup[]): QuotaBucket[] {
  const buckets: QuotaBucket[] = [];

  for (const group of groups) {
    const isGemini = /gemini/i.test(group.displayName ?? '');
    const isClaudeOrGpt = /claude|gpt/i.test(group.displayName ?? '');

    for (const rawBucket of group.buckets ?? []) {
      const windowStr = (rawBucket.window ?? '').toLowerCase();
      const displayStr = (rawBucket.displayName ?? '').toLowerCase();

      const is5h = windowStr === '5h' || /5[- ]?hour/i.test(displayStr);
      const isWeekly = windowStr === 'weekly' || /week/i.test(displayStr);

      let durationMinutes: number;
      let windowName: string;
      if (is5h) {
        durationMinutes = 300;
        windowName = '5 hour';
      } else if (isWeekly) {
        durationMinutes = 10_080;
        windowName = 'Week';
      } else {
        continue;
      }

      let label = windowName;
      if (!isGemini) {
        if (isClaudeOrGpt) {
          label = `Claude / GPT · ${windowName}`;
        } else if (group.displayName) {
          label = `${group.displayName} · ${windowName}`;
        }
      }

      const usedPercent =
        typeof rawBucket.remainingFraction === 'number'
          ? Math.max(0, Math.min(100, Math.round((1 - rawBucket.remainingFraction) * 100)))
          : null;

      buckets.push({
        id: rawBucket.bucketId || `${isGemini ? 'gemini' : '3p'}-${windowStr}`,
        billingDomainId: ANTIGRAVITY_PRIMARY_BILLING_DOMAIN_ID,
        label,
        usedPercent,
        windowDurationMinutes: durationMinutes,
        resetsAt: rawBucket.resetTime ?? null,
        authority: 'official-client',
        scope: 'account-wide'
      });
    }
  }

  return buckets;
}
