/**
 * Default port used for local development (0 = dynamically allocated random port).
 */
export const DEFAULT_DEV_PORT = 0;

/**
 * Validates and converts an input into a valid TCP port number (0-65535).
 *
 * @param {unknown} value
 * @param {string} [context]
 * @returns {number}
 */
export function parseDevelopmentPort(value, context = 'AGENT_USAGE_DEV_PORT') {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error(`${context} must be a valid TCP port`);
  }
  return port;
}

/**
 * Extracts a port argument from CLI arguments.
 * Supports `--port <val>`, `-p <val>`, `--port=<val>`, `-p=<val>`.
 *
 * @param {string[]} [args]
 * @returns {string | undefined}
 */
export function parsePortFromArgs(args = []) {
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--') continue;
    if (arg === '--port' || arg === '-p') {
      const next = args[i + 1];
      if (next !== undefined && !next.startsWith('-')) {
        return next;
      }
      throw new Error(`Option '${arg}' requires a port argument`);
    }
    if (arg.startsWith('--port=')) {
      return arg.slice('--port='.length);
    }
    if (arg.startsWith('-p=')) {
      return arg.slice('-p='.length);
    }
  }
  return undefined;
}

/**
 * Resolves the requested development port by checking CLI arguments,
 * environment variables (`AGENT_USAGE_DEV_PORT`, `PORT`), and finally the default port (0 for random available port).
 *
 * @param {{ argv?: string[], env?: Record<string, string | undefined> }} [options]
 * @returns {number}
 */
export function resolveDevelopmentPort({ argv = process.argv.slice(2), env = process.env } = {}) {
  const argPort = parsePortFromArgs(argv);
  if (argPort !== undefined) {
    return parseDevelopmentPort(argPort, 'CLI --port');
  }
  const envPort = env.AGENT_USAGE_DEV_PORT ?? env.PORT;
  if (envPort !== undefined && envPort !== '') {
    return parseDevelopmentPort(envPort, 'AGENT_USAGE_DEV_PORT');
  }
  return DEFAULT_DEV_PORT;
}
