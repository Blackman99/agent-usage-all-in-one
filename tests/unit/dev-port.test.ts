import { describe, expect, it } from 'vitest';

import {
  DEFAULT_DEV_PORT,
  parseDevelopmentPort,
  parsePortFromArgs,
  resolveDevelopmentPort
} from '../../scripts/dev-port.mjs';

describe('development port configuration', () => {
  it('defaults to 0 for random available port allocation', () => {
    expect(DEFAULT_DEV_PORT).toBe(0);
  });

  describe('parseDevelopmentPort', () => {
    it('accepts valid TCP ports as numbers and strings', () => {
      expect(parseDevelopmentPort(0)).toBe(0);
      expect(parseDevelopmentPort(3000)).toBe(3000);
      expect(parseDevelopmentPort('3000')).toBe(3000);
      expect(parseDevelopmentPort('8080')).toBe(8080);
      expect(parseDevelopmentPort(65535)).toBe(65535);
    });

    it('rejects invalid port values', () => {
      expect(() => parseDevelopmentPort(-1)).toThrow(
        'AGENT_USAGE_DEV_PORT must be a valid TCP port'
      );
      expect(() => parseDevelopmentPort(65536)).toThrow(
        'AGENT_USAGE_DEV_PORT must be a valid TCP port'
      );
      expect(() => parseDevelopmentPort(3000.5)).toThrow(
        'AGENT_USAGE_DEV_PORT must be a valid TCP port'
      );
      expect(() => parseDevelopmentPort('abc')).toThrow(
        'AGENT_USAGE_DEV_PORT must be a valid TCP port'
      );
      expect(() => parseDevelopmentPort('invalid', 'CLI --port')).toThrow(
        'CLI --port must be a valid TCP port'
      );
    });
  });

  describe('parsePortFromArgs', () => {
    it('parses --port <port>', () => {
      expect(parsePortFromArgs(['--port', '3000'])).toBe('3000');
      expect(parsePortFromArgs(['--no-open', '--port', '4000'])).toBe('4000');
    });

    it('parses -p <port>', () => {
      expect(parsePortFromArgs(['-p', '3000'])).toBe('3000');
      expect(parsePortFromArgs(['--no-open', '-p', '5000'])).toBe('5000');
    });

    it('parses --port=<port> and -p=<port>', () => {
      expect(parsePortFromArgs(['--port=3000'])).toBe('3000');
      expect(parsePortFromArgs(['-p=8080'])).toBe('8080');
    });

    it('ignores -- separator', () => {
      expect(parsePortFromArgs(['--', '--port', '3000'])).toBe('3000');
      expect(parsePortFromArgs(['--', '-p', '3000'])).toBe('3000');
    });

    it('returns undefined when no port argument is present', () => {
      expect(parsePortFromArgs([])).toBeUndefined();
      expect(parsePortFromArgs(['--no-open', '--demo'])).toBeUndefined();
    });

    it('throws when port argument is missing or invalid', () => {
      expect(() => parsePortFromArgs(['--port'])).toThrow(
        "Option '--port' requires a port argument"
      );
      expect(() => parsePortFromArgs(['-p'])).toThrow("Option '-p' requires a port argument");
      expect(() => parsePortFromArgs(['--port', '--no-open'])).toThrow(
        "Option '--port' requires a port argument"
      );
    });
  });

  describe('resolveDevelopmentPort', () => {
    it('returns default port 0 for dynamic allocation when neither argv nor env is supplied', () => {
      expect(resolveDevelopmentPort({ argv: [], env: {} })).toBe(0);
    });

    it('prioritizes CLI argument over environment variables', () => {
      expect(
        resolveDevelopmentPort({
          argv: ['--port', '4000'],
          env: { AGENT_USAGE_DEV_PORT: '5000', PORT: '6000' }
        })
      ).toBe(4000);
    });

    it('prioritizes AGENT_USAGE_DEV_PORT over PORT environment variable', () => {
      expect(
        resolveDevelopmentPort({
          argv: [],
          env: { AGENT_USAGE_DEV_PORT: '5000', PORT: '6000' }
        })
      ).toBe(5000);
    });

    it('supports PORT environment variable', () => {
      expect(
        resolveDevelopmentPort({
          argv: [],
          env: { PORT: '6000' }
        })
      ).toBe(6000);
    });

    it('supports port 0 for dynamic allocation', () => {
      expect(
        resolveDevelopmentPort({
          argv: [],
          env: { AGENT_USAGE_DEV_PORT: '0' }
        })
      ).toBe(0);
    });
  });
});
