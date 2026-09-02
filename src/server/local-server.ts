import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';

import type { UsageApplication } from '../core/usage-application.js';
import { publicErrorMessage } from '../core/redaction.js';
import { decodeOtlpMetricsProtobuf } from './otlp-protobuf.js';

const SESSION_COOKIE = 'agent_usage_session';
const connectorActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('connect'), secret: z.string().min(1).max(16_384).optional() }),
  z.object({ action: z.literal('skip') }),
  z.object({ action: z.literal('retry') })
]);
const usageQuerySchema = z.object({
  window: z.enum(['24h', '7d', '30d']).default('24h'),
  timeZone: z.string().min(1).max(100).optional(),
  comparisonCurrency: z
    .string()
    .regex(/^[A-Za-z]{3}$/)
    .default('CNY')
});
const monitoringSettingsSchema = z
  .object({
    backgroundCollectionEnabled: z.boolean().optional(),
    intervalMinutes: z.number().int().min(1).max(1_440).optional(),
    notificationsEnabled: z.boolean().optional(),
    startAtLogin: z.boolean().optional()
  })
  .refine((value) => Object.keys(value).length > 0, 'At least one setting is required');
const planSubscriptionSchema = z.object({
  providerId: z.string().min(1),
  billingDomainId: z.string().min(1),
  plan: z
    .object({
      planId: z.string().min(1).nullable(),
      amount: z.number().positive().finite().optional(),
      currency: z.string().length(3).optional(),
      billingPeriod: z.enum(['monthly', 'annual']).optional(),
      anchorDate: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .nullable()
        .optional()
    })
    .nullable()
});
const clearDataSchema = z.object({ deleteProductSecrets: z.boolean().default(false) });
const hardRebuildSchema = z.object({ confirmExpensiveOperation: z.literal(true) });

export interface LocalServerOptions {
  application: UsageApplication;
  host?: '127.0.0.1' | '::1';
  port?: number;
  launchToken?: string;
  apiToken?: string;
  staticDirectory?: string;
}

export interface LocalServer {
  host: string;
  port: number;
  origin: string;
  apiToken: string;
  createLaunchUrl(): string;
  close(): Promise<void>;
}

export async function startLocalServer(options: LocalServerOptions): Promise<LocalServer> {
  const host = options.host ?? '127.0.0.1';
  const launchTokens = new Set([options.launchToken ?? secureToken()]);
  const browserSessions = new Set<string>();
  const apiToken = options.apiToken ?? secureToken();
  let origin = '';

  const server = createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url ?? '/', origin || `http://${host}`);

      if (request.method === 'GET' && requestUrl.pathname === '/launch') {
        const token = requestUrl.searchParams.get('token');
        if (!token || !launchTokens.delete(token)) {
          sendText(response, 403, 'Invalid or expired launch token');
          return;
        }
        const session = secureToken();
        browserSessions.add(session);
        response.writeHead(303, {
          location: '/',
          'set-cookie': `${SESSION_COOKIE}=${session}; Path=/; HttpOnly; SameSite=Strict`
        });
        response.end();
        return;
      }

      const authentication = authenticate(request, apiToken, browserSessions);
      if (requestUrl.pathname.startsWith('/api/') && authentication === 'none') {
        sendJson(response, 401, { error: 'unauthorized' });
        return;
      }

      if (request.method === 'GET' && requestUrl.pathname === '/api/health') {
        response.writeHead(204, { 'cache-control': 'no-store' });
        response.end();
        return;
      }

      if (request.method === 'GET' && requestUrl.pathname === '/api/processing') {
        sendJson(response, 200, options.application.getProcessingStatus());
        return;
      }

      if (request.method === 'POST' && requestUrl.pathname === '/api/rebuild') {
        if (!validMutationOrigin(authentication, request, origin)) {
          sendJson(response, 403, { error: 'invalid-origin' });
          return;
        }
        const input = hardRebuildSchema.safeParse(await readJsonBody(request));
        if (!input.success) {
          sendJson(response, 400, { error: 'explicit-confirmation-required' });
          return;
        }
        void options.application.startHardRebuild();
        sendJson(response, 202, { accepted: true });
        return;
      }

      if (request.method === 'POST' && requestUrl.pathname === '/v1/metrics') {
        if (authentication !== 'api-token') {
          sendJson(response, 401, { error: 'api-token-required' });
          return;
        }
        await options.application.ingestTelemetry(
          'claude-code',
          await readJsonBody(request, 1_000_000)
        );
        sendJson(response, 200, { partialSuccess: {} });
        return;
      }

      if (request.method === 'POST' && requestUrl.pathname === '/grok/v1/metrics') {
        if (authentication !== 'api-token') {
          sendJson(response, 401, { error: 'api-token-required' });
          return;
        }
        const body = await readBody(request, 1_000_000);
        const contentType = request.headers['content-type'] ?? '';
        const payload = contentType.includes('application/json')
          ? JSON.parse(body.toString('utf8'))
          : decodeOtlpMetricsProtobuf(body);
        await options.application.ingestTelemetry('grok', payload);
        sendOtlpProtobuf(response, 200);
        return;
      }

      if (request.method === 'GET' && requestUrl.pathname === '/api/overview/providers') {
        sendJson(response, 200, await options.application.getAgentProviderIndex());
        return;
      }

      if (request.method === 'GET' && requestUrl.pathname.startsWith('/api/overview/providers/')) {
        const providerId = decodeURIComponent(
          requestUrl.pathname.slice('/api/overview/providers/'.length)
        );
        const provider = await options.application.getProviderOverview(
          providerId,
          parseUsageQuery(requestUrl)
        );
        if (!provider) {
          sendJson(response, 404, { error: 'provider-not-found' });
          return;
        }
        sendJson(response, 200, provider);
        return;
      }

      if (request.method === 'GET' && requestUrl.pathname === '/api/overview') {
        const query = parseUsageQuery(requestUrl);
        sendJson(response, 200, await options.application.getOverview(query));
        return;
      }

      if (request.method === 'POST' && requestUrl.pathname === '/api/refresh') {
        if (authentication === 'browser' && request.headers.origin !== origin) {
          sendJson(response, 403, { error: 'invalid-origin' });
          return;
        }
        if (requestUrl.searchParams.get('background') === 'true') {
          void options.application.startBackgroundProcessing({
            userInitiated: requestUrl.searchParams.get('mode') !== 'automatic'
          });
          sendJson(response, 202, { accepted: true });
          return;
        }
        await options.application.refresh({
          userInitiated: requestUrl.searchParams.get('mode') !== 'automatic'
        });
        response.writeHead(204);
        response.end();
        return;
      }

      if (request.method === 'GET' && requestUrl.pathname === '/api/connectors') {
        sendJson(response, 200, await options.application.getConnectorStatuses());
        return;
      }

      if (request.method === 'GET' && requestUrl.pathname === '/api/doctor') {
        sendJson(response, 200, await options.application.getDiagnostics());
        return;
      }

      if (request.method === 'GET' && requestUrl.pathname === '/api/export') {
        const query = parseUsageQuery(requestUrl);
        const format = z.enum(['json', 'csv']).parse(requestUrl.searchParams.get('format'));
        const artifact = await options.application.exportUsage({
          ...query,
          format,
          includeAccountIdentifiers:
            requestUrl.searchParams.get('includeAccountIdentifiers') === 'true'
        });
        response.writeHead(200, {
          'content-type': artifact.contentType,
          'content-disposition': `attachment; filename="${artifact.filename}"`,
          'cache-control': 'no-store'
        });
        response.end(artifact.body);
        return;
      }

      if (request.method === 'GET' && requestUrl.pathname === '/api/retention') {
        sendJson(response, 200, await options.application.getRetentionStatus());
        return;
      }

      if (request.method === 'POST' && requestUrl.pathname === '/api/retention/compact') {
        if (!validMutationOrigin(authentication, request, origin)) {
          sendJson(response, 403, { error: 'invalid-origin' });
          return;
        }
        sendJson(response, 200, await options.application.compactRetention());
        return;
      }

      if (request.method === 'DELETE' && requestUrl.pathname === '/api/data') {
        if (!validMutationOrigin(authentication, request, origin)) {
          sendJson(response, 403, { error: 'invalid-origin' });
          return;
        }
        const input = clearDataSchema.parse(await readJsonBody(request));
        sendJson(response, 200, await options.application.clearData(input));
        return;
      }

      if (request.method === 'GET' && requestUrl.pathname === '/api/plans') {
        sendJson(response, 200, await options.application.getPlanSettings());
        return;
      }

      if (request.method === 'PATCH' && requestUrl.pathname === '/api/plans') {
        if (!validMutationOrigin(authentication, request, origin)) {
          sendJson(response, 403, { error: 'invalid-origin' });
          return;
        }
        const input = planSubscriptionSchema.parse(await readJsonBody(request));
        sendJson(response, 200, await options.application.updatePlanSubscription(input));
        return;
      }

      if (request.method === 'GET' && requestUrl.pathname === '/api/monitoring') {
        sendJson(response, 200, await options.application.getMonitoringStatus());
        return;
      }

      if (request.method === 'PATCH' && requestUrl.pathname === '/api/monitoring/settings') {
        if (!validMutationOrigin(authentication, request, origin)) {
          sendJson(response, 403, { error: 'invalid-origin' });
          return;
        }
        const changes = monitoringSettingsSchema.parse(await readJsonBody(request));
        sendJson(response, 200, await options.application.updateMonitoringSettings(changes));
        return;
      }

      if (request.method === 'POST' && requestUrl.pathname === '/api/connectors/discover') {
        if (!validMutationOrigin(authentication, request, origin)) {
          sendJson(response, 403, { error: 'invalid-origin' });
          return;
        }
        sendJson(response, 200, await options.application.discoverConnectors());
        return;
      }

      const connectorActionMatch = requestUrl.pathname.match(
        /^\/api\/connectors\/([^/]+)\/action$/
      );
      if (request.method === 'POST' && connectorActionMatch) {
        if (!validMutationOrigin(authentication, request, origin)) {
          sendJson(response, 403, { error: 'invalid-origin' });
          return;
        }
        const input = connectorActionSchema.parse(await readJsonBody(request));
        sendJson(
          response,
          200,
          await options.application.configureConnector(
            decodeURIComponent(connectorActionMatch[1]),
            input
          )
        );
        return;
      }

      if (request.method === 'POST' && requestUrl.pathname === '/api/launch-token') {
        if (authentication !== 'api-token') {
          sendJson(response, 403, { error: 'api-token-required' });
          return;
        }
        const token = secureToken();
        launchTokens.add(token);
        sendJson(response, 200, { url: `${origin}/launch?token=${encodeURIComponent(token)}` });
        return;
      }

      if (request.method === 'GET') {
        await serveStatic(response, requestUrl.pathname, options.staticDirectory);
        return;
      }

      sendJson(response, 404, { error: 'not-found' });
    } catch (error) {
      respondWithFailure(response, error);
    }
  });

  await new Promise<void>((resolveListening, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 0, host, () => {
      server.off('error', reject);
      resolveListening();
    });
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
    throw new Error('Local server did not expose a TCP address');
  }
  const port = address.port;
  origin = `http://${host}:${port}`;

  return {
    host,
    port,
    origin,
    apiToken,
    createLaunchUrl() {
      const token = secureToken();
      launchTokens.add(token);
      return `${origin}/launch?token=${encodeURIComponent(token)}`;
    },
    async close() {
      if (!server.listening) return;
      await new Promise<void>((resolveClose, reject) => {
        server.close((error) => (error ? reject(error) : resolveClose()));
      });
    }
  };
}

type Authentication = 'none' | 'browser' | 'api-token';

function parseUsageQuery(requestUrl: URL) {
  return usageQuerySchema.parse({
    window: requestUrl.searchParams.get('window') ?? undefined,
    timeZone: requestUrl.searchParams.get('timeZone') ?? undefined,
    comparisonCurrency: requestUrl.searchParams.get('currency') ?? undefined
  });
}

function authenticate(
  request: IncomingMessage,
  apiToken: string,
  browserSessions: Set<string>
): Authentication {
  if (request.headers.authorization === `Bearer ${apiToken}`) return 'api-token';
  const cookies = parseCookies(request.headers.cookie);
  const session = cookies.get(SESSION_COOKIE);
  return session && browserSessions.has(session) ? 'browser' : 'none';
}

function validMutationOrigin(
  authentication: Authentication,
  request: IncomingMessage,
  origin: string
): boolean {
  return authentication === 'api-token' || request.headers.origin === origin;
}

async function readJsonBody(request: IncomingMessage, maximumBytes = 20_000): Promise<unknown> {
  return JSON.parse((await readBody(request, maximumBytes)).toString('utf8'));
}

async function readBody(request: IncomingMessage, maximumBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maximumBytes) throw new Error('Request body is too large');
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

function parseCookies(header: string | undefined): Map<string, string> {
  const result = new Map<string, string>();
  for (const part of header?.split(';') ?? []) {
    const separator = part.indexOf('=');
    if (separator === -1) continue;
    result.set(part.slice(0, separator).trim(), part.slice(separator + 1).trim());
  }
  return result;
}

async function serveStatic(
  response: ServerResponse,
  pathname: string,
  staticDirectory: string | undefined
): Promise<void> {
  if (!staticDirectory) {
    sendHtml(
      response,
      200,
      '<!doctype html><html><head><title>Agent Usage</title></head><body><main id="app">Agent Usage</main></body></html>'
    );
    return;
  }

  const root = resolve(staticDirectory);
  const requested = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const normalized = normalize(requested);
  const candidate = resolve(join(root, normalized));
  const indexFile = join(root, 'index.html');
  const file =
    candidate.startsWith(`${root}/`) && existsSync(candidate) && statSync(candidate).isFile()
      ? candidate
      : indexFile;

  if (!existsSync(file)) {
    sendText(response, 404, 'Dashboard assets are not built');
    return;
  }
  const extension = extname(file);
  response.writeHead(200, {
    'content-type': contentType(extension),
    'cache-control': extension === '.html' ? 'no-store' : 'public, max-age=31536000, immutable'
  });
  createReadStream(file).pipe(response);
}

function contentType(extension: string): string {
  switch (extension) {
    case '.html':
      return 'text/html; charset=utf-8';
    case '.js':
      return 'text/javascript; charset=utf-8';
    case '.css':
      return 'text/css; charset=utf-8';
    case '.svg':
      return 'image/svg+xml';
    case '.json':
      return 'application/json; charset=utf-8';
    default:
      return 'application/octet-stream';
  }
}

function secureToken(): string {
  return randomBytes(32).toString('base64url');
}

// The body is encoded before the first byte of the response is written. A payload that
// cannot be encoded then fails while the failure path can still answer with a status,
// instead of leaving a started response that only accepts an unrecoverable second write.
function sendJson(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  });
  response.end(payload);
}

// A request must never end the daemon. Once a response has started, its status is already
// on the wire and a second write throws, so the only remaining signal is an aborted body.
function respondWithFailure(response: ServerResponse, error: unknown): void {
  const message = publicErrorMessage(error);
  if (response.headersSent || response.writableEnded) {
    process.stderr.write(`Agent Usage: a started response failed to finish: ${message}\n`);
    response.destroy();
    return;
  }
  try {
    sendJson(response, 500, { error: 'internal-error', message });
  } catch {
    process.stderr.write(`Agent Usage: a request failed without a reportable reason.\n`);
    response.destroy();
  }
}

function sendOtlpProtobuf(response: ServerResponse, status: number): void {
  response.writeHead(status, {
    'content-type': 'application/x-protobuf',
    'cache-control': 'no-store'
  });
  response.end(Buffer.alloc(0));
}

function sendText(response: ServerResponse, status: number, body: string): void {
  response.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' });
  response.end(body);
}

function sendHtml(response: ServerResponse, status: number, body: string): void {
  response.writeHead(status, { 'content-type': 'text/html; charset=utf-8' });
  response.end(body);
}
