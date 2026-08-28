import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));
const banner = readFileSync(`${repositoryRoot}/static/brand/agent-usage-banner.svg`, 'utf8');

describe('brand assets', () => {
  it('keeps the README banner self-contained with byte-identical audited Provider marks', () => {
    for (const asset of ['openai.svg', 'claude.svg', 'opencode-light.svg', 'grok-light.svg']) {
      const match = banner.match(
        new RegExp(`data-provider-asset="${asset}" href="data:image/svg\\+xml;base64,([^"]+)"`)
      );

      expect(match, `${asset} should be embedded in the banner`).not.toBeNull();
      expect(Buffer.from(match![1], 'base64')).toEqual(
        readFileSync(`${repositoryRoot}/static/brands/${asset}`)
      );
    }

    expect(banner).not.toContain('href="../brands/');
    expect(banner).toContain('id="future-providers"');
  });
});
