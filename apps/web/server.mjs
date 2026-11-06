import http from 'node:http';
import https from 'node:https';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, extname, sep } from 'node:path';

const directory = fileURLToPath(new URL('.', import.meta.url));
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };

export function createWebServer({ apiUrl = process.env.API_URL ?? 'http://127.0.0.1:3000', root = resolve(directory, 'public') } = {}) {
  const upstream = new URL(apiUrl);
  if (!['http:', 'https:'].includes(upstream.protocol) || upstream.username || upstream.password || upstream.pathname !== '/') {
    throw new Error('API_URL must be an HTTP(S) origin without credentials or a path');
  }
  return http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'");
    const fail = (status, message) => {
      if (res.headersSent || res.destroyed) return;
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message }));
    };
    let url;
    try { url = new URL(req.url, 'http://localhost'); } catch { return fail(400, 'Invalid URL'); }
    if (url.pathname === '/v1' || url.pathname.startsWith('/v1/')) {
      if (!['GET', 'POST'].includes(req.method)) return fail(405, 'Method not allowed');
      if (Number(req.headers['content-length'] ?? 0) > 102400) return fail(413, 'Request body is too large');
      const target = new URL(upstream);
      target.pathname = url.pathname;
      target.search = url.search;
      const headers = {};
      for (const name of ['accept', 'authorization', 'content-type', 'content-length']) {
        if (req.headers[name]) headers[name] = req.headers[name];
      }
      const proxy = (target.protocol === 'https:' ? https : http).request(target, { method: req.method, headers }, (response) => {
        if (res.destroyed) return response.destroy();
        for (const name of ['content-type', 'x-request-id', 'retry-after']) {
          if (response.headers[name]) res.setHeader(name, response.headers[name]);
        }
        res.writeHead(response.statusCode ?? 502);
        response.on('error', () => res.destroy());
        response.pipe(res);
      });
      proxy.setTimeout(15000, () => proxy.destroy(new Error('Upstream timeout')));
      proxy.on('error', () => fail(502, 'Cannot reach NetBridge. Check that the API is running and try again.'));
      req.on('aborted', () => proxy.destroy());
      res.on('close', () => { if (!res.writableFinished) proxy.destroy(); });
      let bytes = 0;
      req.on('data', (chunk) => {
        bytes += chunk.length;
        if (bytes > 102400) { fail(413, 'Request body is too large'); proxy.destroy(); }
      });
      req.pipe(proxy);
      return;
    }
    if (!['GET', 'HEAD'].includes(req.method)) return fail(405, 'Method not allowed');
    let path;
    try { path = decodeURIComponent(url.pathname); } catch { return fail(400, 'Invalid URL'); }
    const file = resolve(root, `.${path === '/' ? '/index.html' : path}`);
    if (!file.startsWith(`${resolve(root)}${sep}`) || !types[extname(file)]) return fail(404, 'Not found');
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'Content-Type': types[extname(file)] });
      res.end(req.method === 'HEAD' ? undefined : body);
    } catch { fail(404, 'Not found'); }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.WEB_PORT ?? 5173);
  const host = process.env.WEB_HOST ?? '127.0.0.1';
  const server = createWebServer({ root: resolve(directory, process.argv.includes('--production') ? 'dist' : 'public') });
  server.listen(port, host, () => console.log(`NetBridge frontend: http://${host}:${server.address().port}`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10000).unref();
  });
}
