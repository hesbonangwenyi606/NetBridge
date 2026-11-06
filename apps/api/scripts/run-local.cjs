const { resolve } = require('node:path');
const { readFileSync, readdirSync, mkdirSync } = require('node:fs');
const { spawn } = require('node:child_process');
const { PGlite } = require('@electric-sql/pglite');
const { PGLiteSocketServer } = require('@electric-sql/pglite-socket');

process.chdir(resolve(__dirname, '../../..'));
(async () => {
  mkdirSync('.local', { recursive: true });
  const db = await PGlite.create(resolve('.local/postgres'));
  await db.exec('CREATE TABLE IF NOT EXISTS public._local_migrations (name text PRIMARY KEY)');
  for (const entry of readdirSync('apps/api/prisma/migrations', { withFileTypes: true }).filter(x => x.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    const applied = await db.query('SELECT name FROM public._local_migrations WHERE name=$1', [entry.name]);
    if (!applied.rows.length) {
      await db.exec('BEGIN');
      try {
        await db.exec(readFileSync(resolve('apps/api/prisma/migrations', entry.name, 'migration.sql'), 'utf8'));
        await db.query('INSERT INTO public._local_migrations VALUES ($1)', [entry.name]);
        await db.exec('COMMIT');
      } catch (error) { await db.exec('ROLLBACK'); throw error; }
    }
  }
  const server = new PGLiteSocketServer({ db, host: '127.0.0.1', port: 5433, maxConnections: 10 });
  await server.start();
  const api = spawn(process.execPath, ['apps/api/dist/src/main.js'], { env: { ...process.env, NODE_ENV: 'development', HOST: '127.0.0.1', PORT: '3000', DATABASE_POOL_MAX: '1', DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:5433/postgres?schema=public' }, stdio: 'inherit' });
  const web = spawn(process.execPath, ['apps/web/server.mjs'], { env: { ...process.env, WEB_HOST: '127.0.0.1', WEB_PORT: '5173', API_URL: 'http://127.0.0.1:3000' }, stdio: 'inherit' });
  let stopping = false;
  const stop = async (code = 0) => {
    if (stopping) return;
    stopping = true;
    api.kill(); web.kill();
    await server.stop(); await db.close(); process.exit(code);
  };
  for (const child of [api, web]) {
    child.on('error', error => { console.error(error); void stop(1); });
    child.on('exit', code => { if (!stopping) void stop(code || 1); });
  }
  process.on('SIGINT', () => void stop());
  process.on('SIGTERM', () => void stop());
  console.log('NetBridge local app: http://127.0.0.1:5173 (database: .local/postgres)');
})().catch(error => { console.error(error); process.exit(1); });
