import { describe, expect, it } from 'vitest';

import { EcbExchangeRateProvider } from '$server/ecb-exchange-rate-provider.js';

describe('ECB exchange-rate provider', () => {
  it('derives auditable currency-to-CNY rates from official EUR reference rates', async () => {
    const provider = new EcbExchangeRateProvider({
      url: 'https://official.example/ecb.xml',
      fetch: async () =>
        new Response(
          `<Envelope><Cube><Cube time='2026-08-27'><Cube currency='USD' rate='1.2'/><Cube currency='CNY' rate='8.4'/></Cube></Cube></Envelope>`,
          { status: 200 }
        )
    });

    expect(await provider.readRates()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'ecb:2026-08-27:USD:CNY',
          baseCurrency: 'USD',
          quoteCurrency: 'CNY',
          rate: 7,
          observedAt: '2026-08-27T00:00:00.000Z',
          source: expect.stringContaining('https://official.example/ecb.xml')
        })
      ])
    );
  });

  it('fails closed when the official payload lacks CNY', async () => {
    const provider = new EcbExchangeRateProvider({
      fetch: async () =>
        new Response(`<Cube time='2026-08-27'><Cube currency='USD' rate='1.2'/></Cube>`)
    });
    await expect(provider.readRates()).rejects.toThrow('CNY');
  });
});
