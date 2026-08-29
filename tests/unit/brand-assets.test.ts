import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));
const banner = readFileSync(`${repositoryRoot}/static/brand/agent-usage-banner.svg`, 'utf8');
const showcase = readFileSync(`${repositoryRoot}/static/brand/agent-usage-showcase.jpg`);
const englishReadme = readFileSync(`${repositoryRoot}/README.md`, 'utf8');
const chineseReadme = readFileSync(`${repositoryRoot}/README.zh-CN.md`, 'utf8');

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

  it('ships the stitched dashboard showcase from both READMEs', () => {
    expect(showcase.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
    expect(showcase.byteLength).toBeGreaterThan(100_000);
    expect(englishReadme).toContain('(static/brand/agent-usage-showcase.jpg)');
    expect(chineseReadme).toContain('(static/brand/agent-usage-showcase.jpg)');
  });
});
