import { describe, expect, it } from 'vitest';

import { catalogs, detectLocale, translate } from '../../src/lib/i18n.js';

describe('internationalization catalogs', () => {
  it('keeps English and Simplified Chinese keys complete and detects Chinese locales', () => {
    expect(Object.keys(catalogs['zh-CN']).sort()).toEqual(Object.keys(catalogs.en).sort());
    expect(detectLocale('zh-Hans-CN')).toBe('zh-CN');
    expect(detectLocale('en-US')).toBe('en');
    expect(translate('zh-CN', 'privacy')).toBe('隐私与数据');
  });
});
