import assert from 'node:assert/strict';
import { once } from 'node:events';
import http from 'node:http';
import { after, before, test } from 'node:test';
import { createWebServer } from '../server.mjs';

let upstream, web, origin;
before(async () => {
  upstream = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      res.writeHead(req.url.startsWith('/v1/private') ? 401 : 200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ path: req.url, method: req.method, authorization: req.headers.authorization, cookie: req.headers.cookie, body }));
    });
  });
  upstream.listen(0, '127.0.0.1'); await once(upstream, 'listening');
  web = createWebServer({ apiUrl: `http://127.0.0.1:${upstream.address().port}` });
  web.listen(0, '127.0.0.1'); await once(web, 'listening');
  origin = `http://127.0.0.1:${web.address().port}`;
});
after(async () => { await new Promise((resolve) => web.close(resolve)); await new Promise((resolve) => upstream.close(resolve)); });

test('serves the frontend with CSP and prevents access to private files', async () => {
  const response = await fetch(origin);
  assert.equal(response.status, 200);
  assert.ok((await response.text()).includes('NetBridge'));
  assert.ok(response.headers.get('content-security-policy').includes("script-src 'self'"));
  assert.equal(response.headers.get('cache-control'), 'no-store');
  for (const path of ['/.env', '/server.mjs', '/%2e%2e%2fpackage.json', '/%00.js']) assert.equal((await fetch(origin + path)).status, 404);
});

test('proxies authenticated API requests without forwarding cookies', async () => {
  const response = await fetch(origin + '/v1/devices?limit=10', {
    method: 'POST', headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json', Cookie: 'private=value' }, body: '{"name":"Phone"}',
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.authorization, 'Bearer test-token');
  assert.equal(body.path, '/v1/devices?limit=10');
  assert.equal(body.body, '{"name":"Phone"}');
  assert.equal(body.cookie, undefined);
  assert.equal((await fetch(origin + '/v1/private')).status, 401);
});

test('rejects unsupported methods and unsafe upstream configuration', async () => {
  assert.equal((await fetch(origin + '/v1/devices', { method: 'DELETE' })).status, 405);
  assert.throws(() => createWebServer({ apiUrl: 'file:///etc/passwd' }));
  assert.throws(() => createWebServer({ apiUrl: 'http://user:password@example.com' }));
});

test('returns a safe error when the backend is unavailable', async () => {
  const abandoned = http.createServer(); abandoned.listen(0, '127.0.0.1'); await once(abandoned, 'listening');
  const port = abandoned.address().port; await new Promise((resolve) => abandoned.close(resolve));
  const unavailable = createWebServer({ apiUrl: `http://127.0.0.1:${port}` });
  unavailable.listen(0, '127.0.0.1'); await once(unavailable, 'listening');
  try {
    const response = await fetch(`http://127.0.0.1:${unavailable.address().port}/v1/health`);
    assert.equal(response.status, 502);
    assert.equal((await response.json()).message.includes('Cannot reach NetBridge'), true);
  } finally { await new Promise((resolve) => unavailable.close(resolve)); }
});
