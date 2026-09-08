import { describe, expect, it } from 'vitest';

import {
  createDefaultRateDraft,
  formatRateDomain,
  formatRatePerMillion,
  isRateDraftValid,
  resolveRateProviderChoice,
  shouldOpenAddRateForm,
  type CustomRateDraft
} from '../../src/lib/custom-rates-presentation.js';

describe('custom rates presentation & collapsible form logic', () => {
  const defaultProviders = [
    { id: 'codex', label: 'Codex' },
    { id: 'claude-code', label: 'Claude Code' },
    { id: 'opencode', label: 'OpenCode' }
  ];

  describe('shouldOpenAddRateForm', () => {
    it('defaults to false for plain rates tab or null targets', () => {
      expect(shouldOpenAddRateForm(null)).toBe(false);
      expect(shouldOpenAddRateForm(undefined)).toBe(false);
      expect(shouldOpenAddRateForm('rates')).toBe(false);
      expect(shouldOpenAddRateForm('connections')).toBe(false);
    });

    it('returns true when target is rates:add or when configured draft exists', () => {
      expect(shouldOpenAddRateForm('rates:add')).toBe(true);
      expect(shouldOpenAddRateForm('rates', true)).toBe(true);
      expect(shouldOpenAddRateForm(null, true)).toBe(true);
      expect(shouldOpenAddRateForm('rate:custom-1', false)).toBe(false);
    });
  });

  describe('createDefaultRateDraft', () => {
    it('creates an empty rate draft with default 0 cache read rate', () => {
      const draft = createDefaultRateDraft();
      expect(draft).toEqual({
        providerId: 'codex',
        billingDomainId: '',
        model: '',
        inputRate: '',
        outputRate: '',
        cacheReadRate: '0'
      });
    });

    it('merges partial overrides into the draft', () => {
      const draft = createDefaultRateDraft({
        providerId: 'claude-code',
        billingDomainId: 'bedrock',
        model: 'claude-3-5-sonnet',
        inputRate: '3.0',
        outputRate: '15.0'
      });
      expect(draft).toEqual({
        providerId: 'claude-code',
        billingDomainId: 'bedrock',
        model: 'claude-3-5-sonnet',
        inputRate: '3.0',
        outputRate: '15.0',
        cacheReadRate: '0'
      });
    });
  });

  describe('resolveRateProviderChoice', () => {
    it('returns provider id when provider matches default options', () => {
      expect(resolveRateProviderChoice('codex', defaultProviders)).toBe('codex');
      expect(resolveRateProviderChoice('claude-code', defaultProviders)).toBe('claude-code');
    });

    it('returns custom when provider is not in default options', () => {
      expect(resolveRateProviderChoice('custom-llm', defaultProviders)).toBe('custom');
      expect(resolveRateProviderChoice('unknown-provider', defaultProviders)).toBe('custom');
    });
  });

  describe('formatRateDomain', () => {
    it('returns wildcard label when domain is empty, null, or wildcard', () => {
      const wildcard = 'All routes (wildcard)';
      expect(formatRateDomain(null, wildcard)).toBe(wildcard);
      expect(formatRateDomain(undefined, wildcard)).toBe(wildcard);
      expect(formatRateDomain('', wildcard)).toBe(wildcard);
      expect(formatRateDomain('*', wildcard)).toBe(wildcard);
    });

    it('returns domain id when present and not wildcard', () => {
      expect(formatRateDomain('api.custom.com', 'wildcard')).toBe('api.custom.com');
    });
  });

  describe('formatRatePerMillion', () => {
    it('formats rates as dollars per million tokens', () => {
      expect(formatRatePerMillion(2)).toBe('$2/M');
      expect(formatRatePerMillion(0.5)).toBe('$0.5/M');
      expect(formatRatePerMillion(15.25)).toBe('$15.25/M');
      expect(formatRatePerMillion(0)).toBe('$0/M');
    });
  });

  describe('isRateDraftValid', () => {
    it('validates a correct draft with standard provider choice', () => {
      const draft: CustomRateDraft = {
        providerId: 'codex',
        billingDomainId: '',
        model: 'gpt-4o',
        inputRate: '2.5',
        outputRate: '10.0',
        cacheReadRate: '0'
      };
      expect(isRateDraftValid(draft, 'codex')).toBe(true);
    });

    it('rejects when model name is missing or whitespace', () => {
      const draft: CustomRateDraft = {
        providerId: 'codex',
        billingDomainId: '',
        model: '   ',
        inputRate: '2.5',
        outputRate: '10.0',
        cacheReadRate: '0'
      };
      expect(isRateDraftValid(draft, 'codex')).toBe(false);
    });

    it('requires providerId when providerChoice is custom', () => {
      const draft: CustomRateDraft = {
        providerId: '   ',
        billingDomainId: '',
        model: 'custom-model',
        inputRate: '1.0',
        outputRate: '2.0',
        cacheReadRate: '0'
      };
      expect(isRateDraftValid(draft, 'custom')).toBe(false);

      draft.providerId = 'my-provider';
      expect(isRateDraftValid(draft, 'custom')).toBe(true);
    });

    it('rejects non-numeric or negative input or output rates', () => {
      const base: CustomRateDraft = {
        providerId: 'codex',
        billingDomainId: '',
        model: 'gpt-4o',
        inputRate: '2.5',
        outputRate: '10.0',
        cacheReadRate: '0'
      };

      expect(isRateDraftValid({ ...base, inputRate: '' }, 'codex')).toBe(false);
      expect(isRateDraftValid({ ...base, inputRate: 'abc' }, 'codex')).toBe(false);
      expect(isRateDraftValid({ ...base, inputRate: '-1' }, 'codex')).toBe(false);
      expect(isRateDraftValid({ ...base, outputRate: '' }, 'codex')).toBe(false);
      expect(isRateDraftValid({ ...base, outputRate: 'xyz' }, 'codex')).toBe(false);
      expect(isRateDraftValid({ ...base, outputRate: '-5' }, 'codex')).toBe(false);
    });
  });
});
