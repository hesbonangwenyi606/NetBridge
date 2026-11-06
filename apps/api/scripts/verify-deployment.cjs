const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { createServer } = require('node:net');
const { resolve } = require('node:path');
const { randomUUID } = require('node:crypto');
const { readFileSync, readdirSync } = require('node:fs');
const { setTimeout: delay } = require('node:timers/promises');
const { PGlite } = require('@electric-sql/pglite');
const { PGLiteSocketServer } = require('@electric-sql/pglite-socket');

process.chdir(resolve(__dirname, '..'));

async function availablePort() {
  const socket = createServer();
  socket.listen(0, '127.0.0.1');
  await once(socket, 'listening');
  const port = socket.address().port;
  await new Promise((resolve, reject) => socket.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function verify() {
  let db, databaseServer, api, apiExit;
  let apiOutput = '';
  try {
    db = await PGlite.create();
    databaseServer = new PGLiteSocketServer({ db, port: 0, host: '127.0.0.1', maxConnections: 10 });
    await databaseServer.start();
    const schema = `netbridge_verify_${randomUUID().replaceAll('-', '')}`;
    const databaseUrl = `postgresql://postgres:postgres@${databaseServer.getServerConn()}/postgres?schema=${schema}`;
    const env = { ...process.env, NODE_ENV: 'test', DATABASE_URL: databaseUrl, HOST: '127.0.0.1', PORT: String(await availablePort()) };
    await db.exec(`CREATE SCHEMA "${schema}"; SET search_path TO "${schema}"`);
    for (const migration of readdirSync('prisma/migrations', { withFileTypes: true }).filter((entry) => entry.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
      await db.exec(readFileSync(resolve('prisma/migrations', migration.name, 'migration.sql'), 'utf8'));
    }
    console.log('PASS: committed SQL migrations applied to an isolated embedded PostgreSQL schema');
    console.log('Prisma CLI deployment and concurrency are checked separately against real PostgreSQL.');

    api = spawn(process.execPath, ['dist/src/main.js'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    api.stdout.on('data', (chunk) => { apiOutput = (apiOutput + chunk).slice(-16000); });
    api.stderr.on('data', (chunk) => { apiOutput = (apiOutput + chunk).slice(-16000); });
    apiExit = once(api, 'exit');
    const base = `http://127.0.0.1:${env.PORT}/v1`;
    const get = (path) => fetch(`${base}${path}`, { signal: AbortSignal.timeout(15000) });
    async function waitFor(path, expected) {
      const deadline = Date.now() + 120000;
      while (Date.now() < deadline) {
        if (api.exitCode !== null || api.signalCode !== null) throw new Error(`API exited: ${apiOutput}`);
        try {
          const response = await get(path);
          if (response.status === expected) return;
        } catch {}
        await delay(300);
      }
      throw new Error(`Timed out waiting for ${path} HTTP ${expected}: ${apiOutput}`);
    }
    await waitFor('/health/ready', 200);
    const credentials = { email: 'deployment@example.com', password: 'deployment verification password' };
    const registered = await fetch(`${base}/auth/register`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(credentials), signal: AbortSignal.timeout(15000),
    });
    assert.equal(registered.status, 201);
    const persisted = await db.query(`SELECT count(*)::int AS count FROM "${schema}"."User"`);
    assert.equal(persisted.rows[0].count, 1);
    const publicTable = await db.query(`SELECT to_regclass('public."User"') AS name`);
    assert.equal(publicTable.rows[0].name, null);
    console.log('PASS: compiled API startup, readiness, and persistence in configured schema');

    await databaseServer.stop();
    assert.equal((await get('/health')).status, 200);
    await waitFor('/health/ready', 503);
    await databaseServer.start();
    await waitFor('/health/ready', 200);
    console.log('PASS: database outage returns 503, liveness stays 200, and readiness recovers');

    api.kill('SIGTERM');
    const timeout = setTimeout(() => api.kill('SIGKILL'), 15000);
    try { await apiExit; } finally { clearTimeout(timeout); }
    console.log(process.platform === 'win32'
      ? 'PASS: API process termination (graceful SIGTERM requires Linux/container verification)'
      : 'PASS: API terminates on SIGTERM');
    api = undefined;
  } catch (error) {
    if (apiOutput) console.error(apiOutput);
    throw error;
  } finally {
    if (api) { api.kill('SIGKILL'); await apiExit?.catch(() => {}); }
    await databaseServer?.stop();
    await db?.close();
  }
}

verify().catch((error) => { console.error(error); process.exitCode = 1; });
