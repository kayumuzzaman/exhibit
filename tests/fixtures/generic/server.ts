import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import {
  createServer,
  request as httpRequest,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Canary values that must never appear in panel text, exports, storage, or
 * console output. Privacy specs assert their absence after real capture.
 */
export const FIXTURE_SECRETS = {
  apiKey: 'sk_live_exhibitE2eApiKeyCanary0001',
  authorization: 'Bearer exhibit.e2e.authorization.canary.0001',
  cookie: 'exhibit_e2e_cookie_canary_0001',
  password: 'exhibit-e2e-password-canary-0001',
  queryToken: 'exhibit-e2e-query-token-canary-0001',
  responseToken: 'exhibit-e2e-response-token-canary-0001',
} as const;

export const FIXTURE_PROFILE = {
  displayName: 'Ada',
  email: 'ada@exhibit.test',
  id: 'profile-0001',
} as const;

const PUBLIC_DIR = fileURLToPath(new URL('./public', import.meta.url));
const HARNESS_PREFIX = '/panel';
const LARGE_BODY_FIELD_COUNT = 12_000;
const SLOW_RESPONSE_MS = 1_200;
const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};

export type GenericFixtureOptions = Readonly<{
  /** Directory holding the built panel harness, served under `/panel/`. */
  harnessDir?: string;
  /**
   * Origin of the Next.js fixture. Requests under `/next/` are proxied there so
   * the panel harness and the Next page share one browsing origin.
   */
  nextOrigin?: string;
}>;

export type FixtureServer = Readonly<{
  origin: string;
  port: number;
  close(): Promise<void>;
}>;

function contentType(path: string): string {
  return CONTENT_TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream';
}

function sendJson(
  response: ServerResponse,
  status: number,
  payload: unknown,
  headers: Readonly<Record<string, string | readonly string[]>> = {},
): void {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...headers,
  });
  response.end(body);
}

function sendText(
  response: ServerResponse,
  status: number,
  type: string,
  body: string,
  headers: Readonly<Record<string, string | readonly string[]>> = {},
): void {
  response.writeHead(status, {
    'content-type': type,
    'cache-control': 'no-store',
    ...headers,
  });
  response.end(body);
}

async function readRequestBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** Resolves a request path inside `root`, refusing traversal outside it. */
function safeFilePath(root: string, requestPath: string): string | null {
  const relative = normalize(decodeURIComponent(requestPath)).replace(
    /^(\.\.[/\\])+/u,
    '',
  );
  const candidate = resolve(
    root,
    `.${relative.startsWith('/') ? relative : `/${relative}`}`,
  );
  return candidate === root || candidate.startsWith(`${root}/`) ? candidate : null;
}

async function sendFile(
  response: ServerResponse,
  filePath: string,
  headers: Readonly<Record<string, string | readonly string[]>> = {},
): Promise<boolean> {
  try {
    const info = await stat(filePath);
    if (!info.isFile()) return false;
    response.writeHead(200, {
      'content-type': contentType(filePath),
      'content-length': String(info.size),
      'cache-control': 'no-store',
      ...headers,
    });
    await new Promise<void>((resolveStream, rejectStream) => {
      const stream = createReadStream(filePath);
      stream.on('error', rejectStream);
      stream.on('end', () => resolveStream());
      stream.pipe(response);
    });
    return true;
  } catch {
    return false;
  }
}

function largeProfilePayload(): Record<string, string> {
  const payload: Record<string, string> = {};
  for (let index = 0; index < LARGE_BODY_FIELD_COUNT; index += 1) {
    payload[`field${index}`] = `value-${index}-${'x'.repeat(40)}`;
  }
  return payload;
}

function flightPayload(partial: boolean): string {
  const rows = [
    '0:{"name":"ProfilePage","props":{"displayName":"Ada"}}',
    '1:["$","div",null,{"children":"Ada"}]',
  ];
  return partial ? `${rows.join('\n')}\n2:{"unterminated":` : `${rows.join('\n')}\n`;
}

function pngBytes(): Buffer {
  return Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64',
  );
}

async function handleApi(
  url: URL,
  request: IncomingMessage,
  response: ServerResponse,
  hangingSockets: Set<ServerResponse>,
): Promise<boolean> {
  const path = url.pathname;

  if (path === '/ready') {
    sendJson(response, 200, { ready: true });
    return true;
  }

  if (path === '/api/profile' && request.method === 'GET') {
    sendJson(response, 200, { ...FIXTURE_PROFILE, source: 'rest' });
    return true;
  }

  if (path === '/api/profile' && request.method === 'POST') {
    const body = await readRequestBody(request);
    let displayName: string = FIXTURE_PROFILE.displayName;
    try {
      const parsed: unknown = JSON.parse(body);
      const value =
        parsed !== null && typeof parsed === 'object'
          ? (parsed as Record<string, unknown>).displayName
          : undefined;
      if (typeof value === 'string' && value !== '') displayName = value;
    } catch {
      // Deterministic default is used when the fixture posts a non-JSON body.
    }
    sendJson(
      response,
      200,
      { ok: true, displayName, id: FIXTURE_PROFILE.id },
      { 'set-cookie': `fixture_session=${FIXTURE_SECRETS.cookie}; Path=/` },
    );
    return true;
  }

  if (path === '/graphql') {
    await readRequestBody(request);
    sendJson(response, 200, {
      data: { profile: { ...FIXTURE_PROFILE, __typename: 'Profile' } },
    });
    return true;
  }

  if (path === '/api/form' && request.method === 'POST') {
    const body = await readRequestBody(request);
    const fields = [...new URLSearchParams(body).keys()].sort();
    sendJson(response, 200, { ok: true, fields });
    return true;
  }

  if (path === '/api/upload' && request.method === 'POST') {
    const body = await readRequestBody(request);
    const names = [...body.matchAll(/name="([^"]+)"/gu)].map((match) => match[1] ?? '');
    sendJson(response, 200, { ok: true, parts: names.sort() });
    return true;
  }

  if (path === '/api/redirect') {
    response.writeHead(302, {
      location: '/api/profile',
      'cache-control': 'no-store',
    });
    response.end();
    return true;
  }

  if (path === '/api/error') {
    sendJson(response, 500, { error: 'fixture-server-error' });
    return true;
  }

  if (path === '/api/not-found') {
    sendJson(response, 404, { error: 'fixture-missing' });
    return true;
  }

  if (path === '/api/slow') {
    await new Promise((done) => setTimeout(done, SLOW_RESPONSE_MS));
    sendJson(response, 200, { ok: true, slow: true });
    return true;
  }

  if (path === '/api/cacheable') {
    sendJson(
      response,
      200,
      { ok: true, cacheable: true },
      { 'cache-control': 'public, max-age=600', etag: '"fixture-cacheable"' },
    );
    return true;
  }

  if (path === '/api/service-worker-data') {
    sendJson(response, 200, { ok: true, servedBy: 'network' });
    return true;
  }

  if (path === '/api/stream') {
    response.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store',
    });
    response.write('data: one\n\n');
    setTimeout(() => {
      response.write('data: two\n\n');
      response.end();
    }, 40);
    return true;
  }

  if (path === '/api/binary') {
    const bytes = pngBytes();
    response.writeHead(200, {
      'content-type': 'image/png',
      'content-length': String(bytes.byteLength),
      'cache-control': 'no-store',
    });
    response.end(bytes);
    return true;
  }

  if (path === '/api/download') {
    sendText(response, 200, 'text/plain; charset=utf-8', 'fixture download body\n', {
      'content-disposition': 'attachment; filename="fixture.txt"',
    });
    return true;
  }

  if (path === '/api/large') {
    sendJson(response, 200, largeProfilePayload());
    return true;
  }

  if (path === '/api/flight' || path === '/api/flight-partial') {
    sendText(
      response,
      200,
      'text/x-component; charset=utf-8',
      flightPayload(path === '/api/flight-partial'),
    );
    return true;
  }

  if (path === '/api/secret') {
    const body = await readRequestBody(request);
    sendJson(
      response,
      200,
      {
        ok: true,
        accessToken: FIXTURE_SECRETS.responseToken,
        apiKey: FIXTURE_SECRETS.apiKey,
        echoedBodyLength: body.length,
      },
      {
        'set-cookie': `fixture_secret=${FIXTURE_SECRETS.cookie}; Path=/`,
        'x-fixture-authorization-echo': FIXTURE_SECRETS.authorization,
      },
    );
    return true;
  }

  if (path === '/api/hang') {
    hangingSockets.add(response);
    response.on('close', () => hangingSockets.delete(response));
    return true;
  }

  return false;
}

/** Streams a `/next/*` request to the Next fixture and back, preserving headers. */
function proxyToNext(
  nextOrigin: string,
  request: IncomingMessage,
  response: ServerResponse,
): void {
  const target = new URL(request.url ?? '/', nextOrigin);
  // Next rejects Server Actions whose Origin disagrees with Host, so the proxy
  // presents a consistent upstream identity.
  const headers = {
    ...request.headers,
    host: target.host,
    ...(request.headers.origin === undefined ? {} : { origin: nextOrigin }),
  };
  const upstream = httpRequest(
    {
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port,
      method: request.method ?? 'GET',
      path: `${target.pathname}${target.search}`,
      headers,
    },
    (upstreamResponse) => {
      response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
      upstreamResponse.pipe(response);
    },
  );
  upstream.on('error', () => {
    if (!response.headersSent) {
      sendJson(response, 502, { error: 'next-fixture-unreachable' });
    } else {
      response.end();
    }
  });
  request.pipe(upstream);
}

/**
 * Deterministic HTTP fixture bound to `127.0.0.1` on an OS-assigned port. Every
 * socket is destroyed during teardown so no port or process survives a run.
 */
export async function startGenericFixture(
  options: GenericFixtureOptions = {},
): Promise<FixtureServer> {
  const sockets = new Set<Socket>();
  const hanging = new Set<ServerResponse>();
  const harnessDir =
    options.harnessDir === undefined ? null : resolve(options.harnessDir);

  const server = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      if (
        options.nextOrigin !== undefined &&
        (url.pathname === '/next' || url.pathname.startsWith('/next/'))
      ) {
        proxyToNext(options.nextOrigin, request, response);
        return;
      }
      response.setHeader('x-fixture', 'exhibit-generic');
      try {
        if (await handleApi(url, request, response, hanging)) return;

        if (url.pathname === '/sw.js') {
          const served = await sendFile(response, join(PUBLIC_DIR, 'sw.js'), {
            'service-worker-allowed': '/',
          });
          if (served) return;
        } else if (
          harnessDir !== null &&
          url.pathname.startsWith(`${HARNESS_PREFIX}/`)
        ) {
          const relative = url.pathname.slice(HARNESS_PREFIX.length);
          const target = safeFilePath(
            harnessDir,
            relative === '/' ? '/index.html' : relative,
          );
          if (target !== null && (await sendFile(response, target))) return;
          const fallback = join(harnessDir, 'index.html');
          if (await sendFile(response, fallback)) return;
        } else {
          const target = safeFilePath(
            PUBLIC_DIR,
            url.pathname === '/' ? '/index.html' : url.pathname,
          );
          if (target !== null && (await sendFile(response, target))) return;
        }

        sendJson(response, 404, { error: 'fixture-route-missing', path: url.pathname });
      } catch {
        if (!response.headersSent) {
          sendJson(response, 500, { error: 'fixture-handler-failed' });
        } else {
          response.end();
        }
      }
    })();
  });

  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });

  await new Promise<void>((ready) => server.listen(0, '127.0.0.1', ready));
  const address = server.address() as AddressInfo;

  return {
    origin: `http://127.0.0.1:${address.port}`,
    port: address.port,
    async close() {
      for (const response of hanging) response.destroy();
      hanging.clear();
      for (const socket of sockets) socket.destroy();
      sockets.clear();
      await new Promise<void>((done) => server.close(() => done()));
    },
  };
}

/**
 * Separate origin without CORS headers, used to observe a blocked cross-origin
 * request without weakening the generic fixture.
 */
export async function startThirdPartyFixture(): Promise<FixtureServer> {
  const sockets = new Set<Socket>();
  const server = createServer((_request, response) => {
    sendJson(response, 200, { ok: true, origin: 'third-party' });
  });

  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });

  await new Promise<void>((ready) => server.listen(0, '127.0.0.1', ready));
  const address = server.address() as AddressInfo;

  return {
    origin: `http://127.0.0.1:${address.port}`,
    port: address.port,
    async close() {
      for (const socket of sockets) socket.destroy();
      sockets.clear();
      await new Promise<void>((done) => server.close(() => done()));
    },
  };
}

export async function readFixtureAsset(name: string): Promise<string> {
  return readFile(join(PUBLIC_DIR, name), 'utf8');
}
