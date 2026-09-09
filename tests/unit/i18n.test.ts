import { describe, expect, it } from 'vitest';

import { catalogs, detectLocale, translate } from '../../src/lib/i18n.js';

describe('internationalization catalogs', () => {
  it('keeps English and Simplified Chinese keys complete and detects Chinese locales', () => {
    expect(Object.keys(catalogs['zh-CN']).sort()).toEqual(Object.keys(catalogs.en).sort());
    expect(detectLocale('zh-Hans-CN')).toBe('zh-CN');
    expect(detectLocale('en-US')).toBe('en');
    expect(translate('zh-CN', 'privacy')).toBe('隐私与数据');
    expect(translate('en', 'diagnosticsNav')).toBe('Diagnostics');
    expect(translate('zh-CN', 'diagnosticsNav')).toBe('系统诊断');
    expect(translate('en', 'customRateAddToggle')).toBe('+ Add Rate');
    expect(translate('zh-CN', 'customRateAddToggle')).toBe('+ 添加费率');
    expect(translate('en', 'usageWallHeading')).toBe('{tokens} recorded Tokens in the last year');
    expect(translate('zh-CN', 'usageWallHeading')).toBe('过去一年 {tokens} 已记录 Token');
    expect(translate('en', 'usageWallEmptyDay')).toBe('No usage on {date}');
    expect(translate('zh-CN', 'usageWallEmptyDay')).toBe('{date}无用量');
    expect(translate('en', 'usageWallUsedDay')).toBe('{tokens} recorded Tokens on {date}');
    expect(translate('zh-CN', 'usageWallUsedDay')).toBe('{date} {tokens} 已记录 Token');
    expect(translate('en', 'usageWallLess')).toBe('Less');
    expect(translate('zh-CN', 'usageWallLess')).toBe('少');
    expect(translate('en', 'usageWallMore')).toBe('More');
    expect(translate('zh-CN', 'usageWallMore')).toBe('多');
    expect(translate('en', 'usageWallWeekdayMon')).toBe('Mon');
    expect(translate('zh-CN', 'usageWallWeekdayMon')).toBe('一');
    expect(translate('en', 'usageWallWeekdayWed')).toBe('Wed');
    expect(translate('zh-CN', 'usageWallWeekdayWed')).toBe('三');
    expect(translate('en', 'usageWallWeekdayFri')).toBe('Fri');
    expect(translate('zh-CN', 'usageWallWeekdayFri')).toBe('五');
  });
});
