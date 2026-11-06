import { test, expect } from '@playwright/test';
import { createWebServer } from '../server.mjs';
import { spawn } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

let db, socket, api, apiExit, web, base;
let apiOutput = '';
const externalDatabase = process.env.NETBRIDGE_TEST_DATABASE_URL;
const schema = `netbridge_browser_${randomUUID().replaceAll('-', '')}`;
const email = 'browser-test@example.com';
const password = 'browser test password 123';

test.beforeAll(async () => {
  test.setTimeout(180000);
  let databaseUrl;
  if (externalDatabase) {
    const url = new URL(externalDatabase);
    url.searchParams.set('schema', schema);
    databaseUrl = url.toString();
    const migration = spawn(process.execPath, [resolve('node_modules/prisma/build/index.js'), 'migrate', 'deploy'], {
      cwd: resolve('apps/api'), env: { ...process.env, DATABASE_URL: databaseUrl }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    migration.stdout.on('data', (chunk) => { output += chunk; });
    migration.stderr.on('data', (chunk) => { output += chunk; });
    const [code] = await once(migration, 'exit');
    if (code !== 0) throw new Error(`Browser database migration failed: ${output}`);
  } else {
    const [{ PGlite }, { PGLiteSocketServer }] = await Promise.all([
      import('@electric-sql/pglite'), import('@electric-sql/pglite-socket'),
    ]);
    db = await PGlite.create();
    const migrations = resolve('apps/api/prisma/migrations');
    for (const migration of readdirSync(migrations, { withFileTypes: true }).filter((entry) => entry.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
      await db.exec(readFileSync(resolve(migrations, migration.name, 'migration.sql'), 'utf8'));
    }
    socket = new PGLiteSocketServer({ db, port: 0, host: '127.0.0.1', maxConnections: 10 });
    await socket.start();
    databaseUrl = `postgresql://postgres:postgres@${socket.getServerConn()}/postgres`;
  }
  const free = createServer(); free.listen(0, '127.0.0.1'); await once(free, 'listening');
  const port = free.address().port;
  await new Promise((resolve) => free.close(resolve));
  api = spawn(process.execPath, ['dist/src/main.js'], {
    cwd: resolve('apps/api'), stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, NODE_ENV: 'test', HOST: '127.0.0.1', PORT: String(port), DATABASE_POOL_MAX: '1', DATABASE_URL: databaseUrl },
  });
  apiExit = once(api, 'exit');
  api.stdout.on('data', (chunk) => { apiOutput = (apiOutput + chunk).slice(-16000); });
  api.stderr.on('data', (chunk) => { apiOutput = (apiOutput + chunk).slice(-16000); });
  let ready = false;
  for (let i = 0; i < 150; i++) {
    if (api.exitCode !== null) throw new Error(apiOutput);
    try { if ((await fetch(`http://127.0.0.1:${port}/v1/health/ready`)).ok) { ready = true; break; } } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (!ready) throw new Error(`API did not start: ${apiOutput}`);
  web = createWebServer({ apiUrl: `http://127.0.0.1:${port}` });
  web.listen(0, '127.0.0.1'); await once(web, 'listening');
  base = `http://127.0.0.1:${web.address().port}`;
});

test.afterAll(async () => {
  await new Promise((resolve) => web ? web.close(resolve) : resolve());
  if (api && api.exitCode === null && api.signalCode === null) api.kill('SIGTERM');
  await apiExit?.catch(() => {});
  await socket?.stop();
  await db?.close();
  if (externalDatabase) {
    if (!/^netbridge_browser_[a-f0-9]{32}$/.test(schema)) throw new Error('Invalid browser test schema');
    const cleanup = new pg.Client({ connectionString: externalDatabase });
    try {
      await cleanup.connect();
      await cleanup.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    } finally { await cleanup.end(); }
  }
});

test.afterEach(async ({}, info) => {
  if (info.status !== info.expectedStatus) console.error(apiOutput);
});

test('owner can register, pair a gateway, approve a device, manage sessions, and sign out', async ({ page, request }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(base);
  await expect(page.getByRole('heading', { name: 'Welcome back.' })).toBeVisible();
  await page.getByRole('button', { name: 'Create an account', exact: true }).click();
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByLabel('Full name', { exact: true }).fill('Test Owner');
  await page.getByLabel('Contact number').fill('+254 712 345 678');
  await page.getByLabel('Confirm password', { exact: true }).fill(password + 'wrong');
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('Passwords do not match.');
  await page.getByLabel('Confirm password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Welcome back.' })).toBeVisible();
  await expect(page.getByLabel('Email address')).toHaveValue(email);
  await expect(page.getByLabel('Password', { exact: true })).toHaveValue('');
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Workspace overview' })).toBeVisible({ timeout: 30000 });
  await expect(page.getByText('API available', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Add gateway', exact: true }).click();
  await page.getByLabel('Gateway name').fill('Home <office>');
  await page.getByRole('dialog').getByRole('button', { name: 'Add gateway', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Pair your gateway' })).toBeVisible();
  const token = await page.getByLabel('Pairing token', { exact: true }).inputValue();
  expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  const paired = await request.post(`${base}/v1/gateway-agent/pair`, { data: { pairingToken: token } });
  expect(paired.status()).toBe(200);
  await page.getByRole('button', { name: 'Done, check status' }).click();
  await expect(page.getByText('Home <office>', { exact: true })).toBeVisible();
  await expect(page.locator('.gateway-card .badge')).toHaveText('Paired');

  await page.getByRole('link', { name: 'Devices', exact: true }).click();
  await page.getByRole('button', { name: 'Add device', exact: true }).click();
  await page.getByLabel('Device name').fill('My phone');
  await page.getByRole('dialog').getByRole('button', { name: 'Add device', exact: true }).click();
  await expect(page.getByRole('cell', { name: 'Pending', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Approve', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Approve device', exact: true }).click();
  await expect(page.getByRole('cell', { name: 'Approved', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Connections', exact: true }).click();
  await page.getByRole('button', { name: 'New session', exact: true }).click();
  await page.getByRole('button', { name: 'Create session', exact: true }).click();
  await expect(page.getByRole('cell', { name: 'Open', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'End session', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'End session', exact: true }).click();
  await expect(page.getByRole('cell', { name: 'Ended', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Overview', exact: true }).click();
  await expect(page.locator('#toasts .toast')).toHaveCount(0, { timeout: 10000 });
  await page.screenshot({ path: 'test-results/netbridge-desktop.png', fullPage: true });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Workspace overview' })).toBeVisible();

  await page.getByRole('link', { name: 'Devices', exact: true }).click();
  await page.getByRole('button', { name: 'Revoke', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Revoke device', exact: true }).click();
  await expect(page.getByRole('cell', { name: 'Revoked', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Gateways', exact: true }).click();
  await page.getByRole('button', { name: 'Revoke Home <office>', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Revoke gateway', exact: true }).click();
  await expect(page.locator('.gateway-card .badge')).toHaveText('Revoked');
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Welcome back.' })).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem('netbridge.session'))).toBeNull();
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill('incorrect password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Invalid email or password');
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Workspace overview' })).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('button', { name: 'Toggle navigation' })).toBeVisible();
  const layout = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth, overflowing: [...document.querySelectorAll('body *')].filter((node) => { const rect = node.getBoundingClientRect(); return rect.width && rect.right > innerWidth + 1; }).slice(0, 8).map((node) => node.tagName + '.' + node.className) }));
  expect(layout.scrollWidth, JSON.stringify(layout)).toBeLessThanOrEqual(layout.width);
  await expect(page.locator('#toasts .toast')).toHaveCount(0, { timeout: 10000 });
  await page.screenshot({ path: 'test-results/netbridge-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Toggle navigation' }).click();
  await page.getByRole('link', { name: 'Connections', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Connections', exact: true })).toBeVisible();
  const session = await page.evaluate(() => sessionStorage.getItem('netbridge.session'));
  expect((await request.post(`${base}/v1/auth/logout`, { headers: { Authorization: `Bearer ${session}` } })).status()).toBe(204);
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Welcome back.' })).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem('netbridge.session'))).toBeNull();
  expect(errors).toEqual([]);
});
