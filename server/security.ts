import type { MiddlewareHandler } from 'hono';

// The server only listens on 127.0.0.1, but any website open in the browser can
// still try to send requests to 127.0.0.1:4317. Two checks stop that:
//  - Host must be our own address (defeats DNS-rebinding tricks).
//  - Origin, when present, must be our own page (defeats cross-site requests).
// No CORS headers are ever sent, so other origins can't read responses either.

export function allowedHosts(port: number, dev: boolean): Set<string> {
  const hosts = [`127.0.0.1:${port}`, `localhost:${port}`];
  if (dev) hosts.push('127.0.0.1:5317', 'localhost:5317');
  return new Set(hosts);
}

export function localOnly(port: number, dev: boolean): MiddlewareHandler {
  const hosts = allowedHosts(port, dev);
  const origins = new Set([...hosts].map((h) => `http://${h}`));
  return async (c, next) => {
    const host = c.req.header('host') ?? '';
    if (!hosts.has(host)) return c.text('Forbidden host', 403);

    const origin = c.req.header('origin');
    if (origin && !origins.has(origin)) return c.text('Forbidden origin', 403);

    if (c.req.header('sec-fetch-site') === 'cross-site') return c.text('Forbidden', 403);

    await next();
  };
}
