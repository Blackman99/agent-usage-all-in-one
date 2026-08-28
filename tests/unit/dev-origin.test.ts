import { describe, expect, it } from 'vitest';

import { validateLoopbackOrigin } from '../../scripts/dev-origin.mjs';

describe('development daemon origin validation', () => {
  it('accepts only exact HTTP loopback origins', () => {
    expect(validateLoopbackOrigin('http://127.0.0.1:54321')).toBe('http://127.0.0.1:54321');
    expect(validateLoopbackOrigin('http://[::1]:54321')).toBe('http://[::1]:54321');

    for (const value of [
      'https://127.0.0.1:54321',
      'http://example.com:54321',
      'http://127.0.0.1:54321/api',
      'http://user:password@127.0.0.1:54321'
    ]) {
      expect(() => validateLoopbackOrigin(value)).toThrow(
        'Development daemon origin must be an HTTP loopback origin'
      );
    }
  });
});
