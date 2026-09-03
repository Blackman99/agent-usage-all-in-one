import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  OFFICIAL_PRICING_CATALOG,
  customModelRateToCatalogEntry,
  deriveRetailEquivalentCosts,
  mergeCatalogWithCustomRates
} from '$core/retail-pricing.js';
import type { ConnectorSnapshot, CustomModelRate, UsageObservation } from '$core/types.js';
import { SqliteUsageRepository } from '$server/sqlite-usage-repository.js';

describe('Custom model rates', () => {
  let tempDir: string;
  let repository: SqliteUsageRepository;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'agent-usage-custom-rates-test-'));
    repository = new SqliteUsageRepository(join(tempDir, 'test.db'));
  });

  afterEach(async () => {
    repository.close();
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('Repository persistence', () => {
    it('saves, retrieves, updates, and deletes custom model rates', () => {
      expect(repository.getCustomModelRates()).toEqual([]);

      const rate1: CustomModelRate = {
        id: 'rate-1',
        providerId: 'dsh',
        billingDomainId: null,
        model: 'my-custom-llm',
        ratesPerMillion: {
          input: 1.5,
          output: 4.5,
          cacheRead: 0.2
        },
        updatedAt: '2026-09-02T12:00:00.000Z'
      };

      repository.saveCustomModelRate(rate1);
      const loaded = repository.getCustomModelRates();
      expect(loaded).toHaveLength(1);
      expect(loaded[0]).toEqual(rate1);
      expect(repository.getCustomModelRate('rate-1')).toEqual(rate1);
      expect(repository.getCustomModelRate('non-existent')).toBeNull();

      // Update rate with same provider, domain, and case-insensitive model
      const updatedRate: CustomModelRate = {
        id: 'rate-1-new-id',
        providerId: 'dsh',
        billingDomainId: null,
        model: 'MY-CUSTOM-LLM',
        ratesPerMillion: {
          input: 2.0,
          output: 6.0,
          cacheRead: 0.3
        },
        updatedAt: '2026-09-02T13:00:00.000Z'
      };

      repository.saveCustomModelRate(updatedRate);
      const afterUpdate = repository.getCustomModelRates();
      expect(afterUpdate).toHaveLength(1);
      expect(afterUpdate[0]?.ratesPerMillion.input).toBe(2.0);
      expect(afterUpdate[0]?.ratesPerMillion.output).toBe(6.0);

      // Delete the rate
      const deleted = repository.deleteCustomModelRate(afterUpdate[0]?.id ?? 'rate-1');
      expect(deleted).toBe(true);
      expect(repository.getCustomModelRates()).toEqual([]);
    });

    it('converts custom model rate into catalog entry', () => {
      const rate: CustomModelRate = {
        id: 'rate-convert',
        providerId: 'dsh',
        billingDomainId: null,
        model: 'deepseek-v4-custom',
        ratesPerMillion: {
          input: 1.0,
          output: 3.0,
          cacheRead: 0.1
        },
        updatedAt: '2026-09-02T10:00:00.000Z'
      };

      const entry = customModelRateToCatalogEntry(rate);
      expect(entry.id).toBe('custom-rate-rate-convert');
      expect(entry.billingDomainId).toBe('*');
      expect(entry.contextTier).toBe('custom-rate');
      expect(entry.ratesPerMillion.input).toBe(1.0);
      expect(entry.ratesPerMillion.output).toBe(3.0);
      expect(entry.ratesPerMillion['cache-read']).toBe(0.1);
    });
  });

  describe('Pricing calculation with custom rates', () => {
    function dshSnapshot(observation: UsageObservation): ConnectorSnapshot {
      return {
        provider: { id: 'dsh', displayName: 'dsh' },
        billingDomains: [{ id: observation.billingDomainId, displayName: 'Custom Route' }],
        quotaBuckets: [],
        usage: [observation],
        costs: [],
        warnings: [],
        observedAt: '2026-09-02T12:00:00.000Z'
      };
    }

    function observation(overrides: Partial<UsageObservation> = {}): UsageObservation {
      return {
        id: 'obs-1',
        billingDomainId: 'custom-endpoint-route',
        model: 'custom-coder-v1',
        sessionId: 'session-123',
        observedAt: '2026-09-02T10:00:00.000Z',
        inputTokens: 100_000,
        outputTokens: 20_000,
        reasoningTokens: 5_000,
        cacheReadTokens: 10_000,
        cacheWriteTokens: 0,
        tokenSemantics: {
          reasoning: 'included-in-output',
          cacheRead: 'separate',
          cacheWrite: 'separate'
        },
        modelAttribution: 'known',
        timePrecision: 'event',
        usageScope: 'this-mac',
        aggregationTemporality: 'delta',
        authority: 'local-observation',
        ...overrides
      };
    }

    it('remains unpriced when no custom rate matches the custom endpoint model', () => {
      const snap = dshSnapshot(observation());
      const result = deriveRetailEquivalentCosts(snap, OFFICIAL_PRICING_CATALOG);

      expect(result.costs).toHaveLength(0);
      expect(result.decisions[0]?.status).toBe('unavailable');
      expect(result.decisions[0]?.reason).toBe('model-unrecognized');
    });

    it('prices a custom endpoint model when a wildcard custom rate is configured', () => {
      const customRate: CustomModelRate = {
        id: 'rate-custom-1',
        providerId: 'dsh',
        billingDomainId: null, // wildcard across routes
        model: 'custom-coder-v1',
        ratesPerMillion: {
          input: 2.0,
          output: 8.0,
          cacheRead: 0.5
        },
        updatedAt: '2026-09-02T00:00:00.000Z'
      };

      const catalog = mergeCatalogWithCustomRates(OFFICIAL_PRICING_CATALOG, [customRate]);
      const snap = dshSnapshot(observation());
      const result = deriveRetailEquivalentCosts(snap, catalog);

      expect(result.decisions[0]?.status).toBe('priced');
      expect(result.costs).toHaveLength(1);

      const cost = result.costs[0];
      expect(cost?.authority).toBe('estimate');
      expect(cost?.kind).toBe('retail-equivalent');
      // input: 100_000 * 2.0 / 1M = 0.20
      // output: 20_000 * 8.0 / 1M = 0.16
      // cacheRead: 10_000 * 0.5 / 1M = 0.005
      // total = 0.365
      expect(cost?.amount).toBeCloseTo(0.365, 5);
      expect(cost?.lineItems).toEqual([
        { tokenKind: 'input', tokens: 100_000, ratePerMillion: 2.0, amount: 0.2 },
        { tokenKind: 'output', tokens: 20_000, ratePerMillion: 8.0, amount: 0.16 },
        { tokenKind: 'cache-read', tokens: 10_000, ratePerMillion: 0.5, amount: 0.005 }
      ]);
    });

    it('prioritizes user custom rates over official catalog rates', () => {
      // deepseek-v4-flash is in OFFICIAL_PRICING_CATALOG under deepseek-official
      const customOverrideRate: CustomModelRate = {
        id: 'rate-override',
        providerId: 'dsh',
        billingDomainId: 'deepseek-official',
        model: 'deepseek-v4-flash',
        ratesPerMillion: {
          input: 10.0,
          output: 20.0,
          cacheRead: 1.0
        },
        updatedAt: '2026-09-02T00:00:00.000Z'
      };

      const catalog = mergeCatalogWithCustomRates(OFFICIAL_PRICING_CATALOG, [customOverrideRate]);
      const snap = dshSnapshot(
        observation({
          billingDomainId: 'deepseek-official',
          model: 'deepseek-v4-flash'
        })
      );
      const result = deriveRetailEquivalentCosts(snap, catalog);

      expect(result.decisions[0]?.status).toBe('priced');
      expect(result.costs[0]?.priceSnapshot?.contextTier).toBe('custom-rate');
      // input: 100k * 10/1M = 1.0, output: 20k * 20/1M = 0.4, cacheRead: 10k * 1/1M = 0.01 -> total 1.41
      expect(result.costs[0]?.amount).toBeCloseTo(1.41, 5);
    });
  });
});
