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
});
