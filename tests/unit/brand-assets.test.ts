import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));
const showcase = readFileSync(`${repositoryRoot}/static/brand/agent-usage-showcase.jpg`);
const englishReadme = readFileSync(`${repositoryRoot}/README.md`, 'utf8');
const chineseReadme = readFileSync(`${repositoryRoot}/README.zh-CN.md`, 'utf8');

describe('brand assets', () => {
  it('uses the stitched dashboard showcase as the only README banner', () => {
    expect(showcase.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
    expect(showcase.byteLength).toBeGreaterThan(100_000);
    expect(
      englishReadme.startsWith(
        '![Agent Usage dashboard showcase](static/brand/agent-usage-showcase.jpg)\n'
      )
    ).toBe(true);
    expect(
      chineseReadme.startsWith(
        '![Agent Usage 仪表盘功能展示](static/brand/agent-usage-showcase.jpg)\n'
      )
    ).toBe(true);
    expect(englishReadme.match(/agent-usage-showcase\.jpg/g)).toHaveLength(1);
    expect(chineseReadme.match(/agent-usage-showcase\.jpg/g)).toHaveLength(1);
    expect(englishReadme).not.toContain('agent-usage-banner.svg');
    expect(chineseReadme).not.toContain('agent-usage-banner.svg');
    expect(existsSync(`${repositoryRoot}/static/brand/agent-usage-banner.svg`)).toBe(false);
  });

  it('keeps the official Cursor 2D cube marks byte-for-byte', () => {
    const light = readFileSync(`${repositoryRoot}/static/brands/cursor-light.svg`);
    const dark = readFileSync(`${repositoryRoot}/static/brands/cursor-dark.svg`);
    expect(createHash('sha256').update(light).digest('hex')).toBe(
      'c483c02f78eb2619778fdd959e72a9adfac4844854472cd2653d4cbfd60e4d71'
    );
    expect(createHash('sha256').update(dark).digest('hex')).toBe(
      'cd0e3e5d8991a4cdd4577f8896cd063105207665165c73e25a1ff918dd367eb7'
    );
  });
});
