import type { ExchangeRateProvider, ExchangeRateSnapshot } from '../core/types.js';

const DEFAULT_URL = 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml';
const SOURCE = 'European Central Bank euro foreign exchange reference rates';

export interface EcbExchangeRateProviderOptions {
  fetch?: typeof fetch;
  url?: string;
}

export class EcbExchangeRateProvider implements ExchangeRateProvider {
  readonly #fetch: typeof fetch;
  readonly #url: string;

  constructor(options: EcbExchangeRateProviderOptions = {}) {
    this.#fetch = options.fetch ?? fetch;
    this.#url = options.url ?? DEFAULT_URL;
  }

  async readRates(): Promise<ExchangeRateSnapshot[]> {
    const response = await this.#fetch(this.#url, { signal: AbortSignal.timeout(5_000) });
    if (!response.ok) throw new Error(`ECB reference rates returned HTTP ${response.status}`);
    const xml = await response.text();
    const date = xml.match(/<Cube\s+time=['"](\d{4}-\d{2}-\d{2})['"]/i)?.[1];
    if (!date) throw new Error('ECB reference rate date is unavailable');
    const euroRates = new Map<string, number>([['EUR', 1]]);
    for (const match of xml.matchAll(
      /<Cube\s+currency=['"]([A-Z]{3})['"]\s+rate=['"]([0-9.]+)['"]\s*\/?\s*>/gi
    )) {
      const rate = Number(match[2]);
      if (Number.isFinite(rate) && rate > 0) euroRates.set(match[1].toUpperCase(), rate);
    }
    const cnyPerEuro = euroRates.get('CNY');
    if (!cnyPerEuro) throw new Error('ECB CNY reference rate is unavailable');
    const observedAt = `${date}T00:00:00.000Z`;
    return [...euroRates.entries()]
      .filter(([currency]) => currency !== 'CNY')
      .map(([currency, unitsPerEuro]) => ({
        id: `ecb:${date}:${currency}:CNY`,
        baseCurrency: currency,
        quoteCurrency: 'CNY',
        rate: Number((cnyPerEuro / unitsPerEuro).toPrecision(12)),
        observedAt,
        source: `${SOURCE} (${this.#url})`
      }));
  }
}
