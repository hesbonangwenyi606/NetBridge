import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import type { INestApplication } from '@nestjs/common';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import request from 'supertest';

let app: INestApplication;
let db: PGlite;
let server: PGLiteSocketServer;
let prisma: import('../../dist/src/prisma/prisma.service').PrismaService;
const password = 'correct horse battery staple';
const externalDatabase = process.env.NETBRIDGE_TEST_DATABASE_URL;
const testSchema = `netbridge_test_${randomUUID().replaceAll('-', '')}`;
let isolatedUrl: string;

async function deployMigrations(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'deploy'], {
      env: { ...process.env, DATABASE_URL: isolatedUrl }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString(); });
    child.stderr.on('data', (chunk: Buffer) => { output += chunk.toString(); });
    child.once('error', reject);
    child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`Migration deployment failed (${code}): ${output}`)));
  });
}

before(async () => {
  if (externalDatabase) {
    const url = new URL(externalDatabase);
    url.searchParams.set('schema', testSchema);
    isolatedUrl = url.toString();
    process.env.DATABASE_URL = isolatedUrl;
    await deployMigrations();
    await deployMigrations(); // Verify deployment is idempotent.
  } else {
  db = await PGlite.create();
  const migrations = resolve('prisma/migrations');
  for (const directory of readdirSync(migrations, { withFileTypes: true }).filter((item) => item.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    await db.exec(readFileSync(join(migrations, directory.name, 'migration.sql'), 'utf8'));
  }
  server = new PGLiteSocketServer({ db, host: '127.0.0.1', port: 0, maxConnections: 10 });
  await server.start();
  process.env.DATABASE_URL = `postgresql://postgres:postgres@${server.getServerConn()}/postgres`;
  }
  const [{ Test }, { AppModule }, { PrismaService }, { configureApp }] = await Promise.all([
    import('@nestjs/testing'), import('../../dist/src/app.module.js'),
    import('../../dist/src/prisma/prisma.service.js'), import('../../dist/src/configure-app.js'),
  ]);
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  prisma = moduleRef.get(PrismaService);
  app = moduleRef.createNestApplication();
  configureApp(app);
  await app.init();
});

after(async () => {
  try { await app?.close(); }
  finally {
    if (externalDatabase && isolatedUrl) {
      assert.match(testSchema, /^netbridge_test_[a-f0-9]{32}$/);
      const [{ PrismaClient }, { PrismaPg }] = await Promise.all([
        import('../../dist/generated/prisma/client.js'), import('@prisma/adapter-pg'),
      ]);
      const cleanup = new PrismaClient({ adapter: new PrismaPg({ connectionString: isolatedUrl }) });
      try { await cleanup.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${testSchema}" CASCADE`); }
      finally { await cleanup.$disconnect(); }
    }
    await server?.stop();
    await db?.close();
  }
});

test('MVP management lifecycle with PostgreSQL persistence', async (t) => {
  const http = () => request(app.getHttpServer());
  let ownerToken: string;
  let otherToken: string;
  let ownerId: string;
  let gatewayId: string;
  let pairingToken: string;
  let gatewayToken: string;
  let deviceId: string;
  let connectionId: string;

  await t.test('registration validates input, normalizes email, hashes passwords, and rejects duplicates', async () => {
    await http().post('/v1/auth/register').send({ email: 'bad', password: 'short' }).expect(400);
    await http().post('/v1/auth/register').send({ email: 'a@example.com', password, ownerId: randomUUID() }).expect(400);
    const registered = await http().post('/v1/auth/register').send({ email: ' Owner@Example.com ', password }).expect(201);
    ownerId = registered.body.id;
    assert.equal(registered.body.email, 'owner@example.com');
    assert.equal(registered.body.passwordHash, undefined);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: ownerId } });
    assert.notEqual(user.passwordHash, password);
    assert.match(user.passwordHash, /^scrypt:/);
    await http().post('/v1/auth/register').send({ email: 'owner@example.com', password }).expect(409);
    await http().post('/v1/auth/register').send({ email: 'other@example.com', password }).expect(201);
  });

  await t.test('login rejects bad credentials, issues hashed expiring tokens, and protects routes', async () => {
    await http().post('/v1/auth/login').send({ email: 'owner@example.com', password: 'wrong password long enough' }).expect(401);
    await http().post('/v1/auth/login').send({ email: 'missing@example.com', password }).expect(401);
    const login = await http().post('/v1/auth/login').send({ email: 'OWNER@example.com', password }).expect(200);
    ownerToken = login.body.accessToken;
    otherToken = (await http().post('/v1/auth/login').send({ email: 'other@example.com', password }).expect(200)).body.accessToken;
    assert.equal(login.body.tokenType, 'Bearer');
    assert.ok(new Date(login.body.expiresAt).getTime() > Date.now());
    const sessions = await prisma.authSession.findMany({ where: { userId: ownerId } });
    assert.equal(sessions.length, 1);
    assert.notEqual(sessions[0].tokenHash, ownerToken);
    await http().get('/v1/auth/me').expect(401);
    await http().get('/v1/devices').set('Authorization', 'Bearer invalid').expect(401);
    const me = await http().get('/v1/auth/me').auth(ownerToken, { type: 'bearer' }).expect(200);
    assert.equal(me.body.id, ownerId);
    assert.equal(me.body.passwordHash, undefined);
    assert.equal(me.headers['cache-control'], 'no-store');
    await http().get('/v1/dashboard').expect(401);
    const summary = await http().get('/v1/dashboard').auth(ownerToken, { type: 'bearer' }).expect(200);
    assert.deepEqual(summary.body, { pairedGateways: 0, approvedDevices: 0, activeConnections: 0, pendingDevices: 0 });
  });

  await t.test('gateway pairing expires, rotates, is single-use, and keeps secrets out of lists', async () => {
    const created = await http().post('/v1/gateways').auth(ownerToken, { type: 'bearer' }).send({ name: ' Home ' }).expect(201);
    gatewayId = created.body.id;
    pairingToken = created.body.pairingToken;
    assert.equal(created.body.name, 'Home');
    const stored = await prisma.gateway.findUniqueOrThrow({ where: { id: gatewayId } });
    assert.notEqual(stored.pairingTokenHash, pairingToken);
    await prisma.gateway.update({ where: { id: gatewayId }, data: { pairingExpiresAt: new Date(0) } });
    await http().post('/v1/gateway-agent/pair').send({ pairingToken }).expect(401);
    const renewed = await http().post(`/v1/gateways/${gatewayId}/pairing-token`).auth(ownerToken, { type: 'bearer' }).expect(200);
    await http().post('/v1/gateway-agent/pair').send({ pairingToken }).expect(401);
    pairingToken = renewed.body.pairingToken;
    const paired = await http().post('/v1/gateway-agent/pair').send({ pairingToken }).expect(200);
    gatewayToken = paired.body.gatewayToken;
    assert.equal(paired.body.status, 'PAIRED');
    await http().post('/v1/gateway-agent/pair').send({ pairingToken }).expect(401);
    await http().post('/v1/gateway-agent/heartbeat').auth(gatewayToken, { type: 'bearer' }).expect(200);
    await http().post('/v1/gateway-agent/heartbeat').auth(ownerToken, { type: 'bearer' }).expect(401);
    await http().get('/v1/auth/me').auth(gatewayToken, { type: 'bearer' }).expect(401);
    await http().post(`/v1/gateways/${gatewayId}/pairing-token`).auth(ownerToken, { type: 'bearer' }).expect(409);
    const list = await http().get('/v1/gateways').auth(ownerToken, { type: 'bearer' }).expect(200);
    assert.equal(list.body.items.length, 1);
    for (const key of ['pairingToken', 'pairingTokenHash', 'credentialHash', 'gatewayToken']) assert.equal(list.body.items[0][key], undefined);
  });

  await t.test('ownership checks hide another account resources and prevent cross-account sessions', async () => {
    await http().get(`/v1/gateways/${gatewayId}`).auth(otherToken, { type: 'bearer' }).expect(404);
    await http().post(`/v1/gateways/${gatewayId}/revoke`).auth(otherToken, { type: 'bearer' }).expect(404);
    await http().post(`/v1/gateways/${gatewayId}/pairing-token`).auth(otherToken, { type: 'bearer' }).expect(404);
    assert.deepEqual((await http().get('/v1/gateways').auth(otherToken, { type: 'bearer' }).expect(200)).body.items, []);
    const created = await http().post('/v1/devices').auth(ownerToken, { type: 'bearer' }).send({ name: 'Phone', platform: 'android' }).expect(201);
    deviceId = created.body.id;
    assert.equal(created.body.status, 'PENDING');
    assert.deepEqual((await http().get('/v1/dashboard').auth(ownerToken, { type: 'bearer' }).expect(200)).body,
      { pairedGateways: 1, approvedDevices: 0, activeConnections: 0, pendingDevices: 1 });
    assert.deepEqual((await http().get('/v1/dashboard').auth(otherToken, { type: 'bearer' }).expect(200)).body,
      { pairedGateways: 0, approvedDevices: 0, activeConnections: 0, pendingDevices: 0 });
    await http().get(`/v1/devices/${deviceId}`).auth(otherToken, { type: 'bearer' }).expect(404);
    await http().post(`/v1/devices/${deviceId}/approve`).auth(otherToken, { type: 'bearer' }).expect(404);
    await http().post(`/v1/devices/${deviceId}/revoke`).auth(otherToken, { type: 'bearer' }).expect(404);
    await http().post('/v1/connections').auth(otherToken, { type: 'bearer' }).send({ deviceId, gatewayId }).expect(404);
    await http().post('/v1/connections').auth(ownerToken, { type: 'bearer' }).send({ deviceId, gatewayId }).expect(409);
  });

  await t.test('approval allows one active session and ending is idempotent', async () => {
    await http().post(`/v1/devices/${deviceId}/approve`).auth(ownerToken, { type: 'bearer' }).expect(200);
    const created = await http().post('/v1/connections').auth(ownerToken, { type: 'bearer' }).send({ deviceId, gatewayId }).expect(201);
    connectionId = created.body.id;
    // Verify the SQL invariant also rejects writes bypassing the API service.
    await assert.rejects(prisma.connection.create({ data: { deviceId, gatewayId } }), { code: 'P2002' });
    await http().post('/v1/connections').auth(ownerToken, { type: 'bearer' }).send({ deviceId, gatewayId }).expect(409);
    await http().get(`/v1/connections/${connectionId}`).auth(otherToken, { type: 'bearer' }).expect(404);
    await http().post(`/v1/connections/${connectionId}/end`).auth(otherToken, { type: 'bearer' }).expect(404);
    assert.deepEqual((await http().get('/v1/connections').auth(otherToken, { type: 'bearer' }).expect(200)).body.items, []);
    const ended = await http().post(`/v1/connections/${connectionId}/end`).auth(ownerToken, { type: 'bearer' }).expect(200);
    assert.equal(ended.body.status, 'ENDED');
    assert.ok(ended.body.endedAt);
    const repeated = await http().post(`/v1/connections/${connectionId}/end`).auth(ownerToken, { type: 'bearer' }).expect(200);
    assert.equal(repeated.body.endedAt, ended.body.endedAt);
    connectionId = (await http().post('/v1/connections').auth(ownerToken, { type: 'bearer' }).send({ deviceId, gatewayId }).expect(201)).body.id;
  });

  await t.test('device revocation ends sessions and cannot be reversed', async () => {
    await http().post(`/v1/devices/${deviceId}/revoke`).auth(ownerToken, { type: 'bearer' }).expect(200);
    assert.equal((await http().get(`/v1/connections/${connectionId}`).auth(ownerToken, { type: 'bearer' }).expect(200)).body.status, 'ENDED');
    await http().post(`/v1/devices/${deviceId}/approve`).auth(ownerToken, { type: 'bearer' }).expect(409);
    await http().post('/v1/connections').auth(ownerToken, { type: 'bearer' }).send({ deviceId, gatewayId }).expect(409);
  });

  await t.test('gateway revocation invalidates its credential and ends sessions', async () => {
    const device = await http().post('/v1/devices').auth(ownerToken, { type: 'bearer' }).send({ name: 'Tablet', platform: 'android' }).expect(201);
    await http().post(`/v1/devices/${device.body.id}/approve`).auth(ownerToken, { type: 'bearer' }).expect(200);
    const pending = await http().post('/v1/gateways').auth(ownerToken, { type: 'bearer' }).send({ name: 'Unpaired gateway' }).expect(201);
    await http().post('/v1/connections').auth(ownerToken, { type: 'bearer' }).send({ deviceId: device.body.id, gatewayId: pending.body.id }).expect(409);
    await http().post(`/v1/gateways/${pending.body.id}/revoke`).auth(ownerToken, { type: 'bearer' }).expect(200);
    await http().post('/v1/gateway-agent/pair').send({ pairingToken: pending.body.pairingToken }).expect(401);
    const active = await http().post('/v1/connections').auth(ownerToken, { type: 'bearer' }).send({ deviceId: device.body.id, gatewayId }).expect(201);
    await http().post(`/v1/gateways/${gatewayId}/revoke`).auth(ownerToken, { type: 'bearer' }).expect(200);
    await http().post('/v1/gateway-agent/heartbeat').auth(gatewayToken, { type: 'bearer' }).expect(401);
    assert.equal((await http().get(`/v1/connections/${active.body.id}`).auth(ownerToken, { type: 'bearer' }).expect(200)).body.status, 'ENDED');
    await http().post('/v1/connections').auth(ownerToken, { type: 'bearer' }).send({ deviceId: device.body.id, gatewayId }).expect(409);
  });

  await t.test('pagination is bounded and validates identifiers and filters', async () => {
    const first = await http().get('/v1/devices?limit=1').auth(ownerToken, { type: 'bearer' }).expect(200);
    assert.equal(first.body.items.length, 1);
    assert.ok(first.body.nextCursor);
    const second = await http().get(`/v1/devices?limit=1&cursor=${first.body.nextCursor}`).auth(ownerToken, { type: 'bearer' }).expect(200);
    assert.notEqual(first.body.items[0].id, second.body.items[0].id);
    assert.equal(second.body.nextCursor, null);
    await http().get('/v1/devices?limit=101').auth(ownerToken, { type: 'bearer' }).expect(400);
    await http().get('/v1/devices?ownerId=anything').auth(ownerToken, { type: 'bearer' }).expect(400);
    await http().get('/v1/devices/not-a-uuid').auth(ownerToken, { type: 'bearer' }).expect(400);
  });

  await t.test('real database readiness and OpenAPI describe the management API', async () => {
    const ready = await http().get('/v1/health/ready').expect(200);
    assert.equal(ready.body.database, 'ok');
    const docs = await http().get('/docs-json').expect(200);
    for (const path of ['/v1/auth/register', '/v1/gateways', '/v1/devices', '/v1/connections']) assert.ok(docs.body.paths[path]);
    assert.ok(docs.body.components.securitySchemes.bearer);
  });

  await t.test('PostgreSQL serializes concurrent pairing, session creation, and revocation', { skip: !externalDatabase }, async () => {
    const gateway = await http().post('/v1/gateways').auth(ownerToken, { type: 'bearer' }).send({ name: 'Concurrent gateway' }).expect(201);
    const paired = await Promise.all([1, 2].map(() => http().post('/v1/gateway-agent/pair').send({ pairingToken: gateway.body.pairingToken })));
    assert.deepEqual(paired.map((result) => result.status).sort(), [200, 401]);
    const device = await http().post('/v1/devices').auth(ownerToken, { type: 'bearer' }).send({ name: 'Concurrent phone', platform: 'android' }).expect(201);
    await http().post(`/v1/devices/${device.body.id}/approve`).auth(ownerToken, { type: 'bearer' }).expect(200);
    const body = { gatewayId: gateway.body.id, deviceId: device.body.id };
    const created = await Promise.all([1, 2].map(() => http().post('/v1/connections').auth(ownerToken, { type: 'bearer' }).send(body)));
    assert.deepEqual(created.map((result) => result.status).sort(), [201, 409]);
    const active = created.find((result) => result.status === 201)!;
    await http().post(`/v1/connections/${active.body.id}/end`).auth(ownerToken, { type: 'bearer' }).expect(200);
    const [connection, revoked] = await Promise.all([
      http().post('/v1/connections').auth(ownerToken, { type: 'bearer' }).send(body),
      http().post(`/v1/devices/${device.body.id}/revoke`).auth(ownerToken, { type: 'bearer' }),
    ]);
    assert.ok([201, 409].includes(connection.status));
    assert.equal(revoked.status, 200);
    assert.equal(await prisma.connection.count({ where: { deviceId: device.body.id, status: 'ACTIVE' } }), 0);
  });

  await t.test('expired sessions fail and logout revokes the current token', async () => {
    const other = await prisma.user.findUniqueOrThrow({ where: { email: 'other@example.com' } });
    await prisma.authSession.updateMany({ where: { userId: other.id }, data: { expiresAt: new Date(0) } });
    await http().get('/v1/auth/me').auth(otherToken, { type: 'bearer' }).expect(401);
    await http().post('/v1/auth/logout').auth(ownerToken, { type: 'bearer' }).expect(204);
    await http().get('/v1/auth/me').auth(ownerToken, { type: 'bearer' }).expect(401);
  });

  await t.test('authentication attempts are rate limited', async () => {
    let limited = false;
    for (let attempt = 0; attempt < 25; attempt++) {
      const response = await http().post('/v1/auth/login').send({ email: 'owner@example.com', password: 'incorrect password' });
      if (response.status === 429) { limited = true; break; }
      assert.equal(response.status, 401);
    }
    assert.equal(limited, true);
  });
});
