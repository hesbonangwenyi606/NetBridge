import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';

let app: INestApplication;
let prismaQueryCalled = false;
let prismaQueryShouldFail = false;

before(async () => {
  process.env.DATABASE_URL ??=
    'postgresql://netbridge:netbridge_local@localhost:5432/netbridge?schema=public';
  const [{ Test }, { AppModule }, { PrismaService }] = await Promise.all([
    import('@nestjs/testing'),
    import('../../dist/src/app.module.js'),
    import('../../dist/src/prisma/prisma.service.js'),
  ]);
  const prismaMock = {
    $queryRaw: async (_query: unknown) => {
      prismaQueryCalled = true;
      if (prismaQueryShouldFail) {
        throw new Error('Database unavailable');
      }
      return [{ result: 1 }];
    },
  };
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(PrismaService)
    .useValue(prismaMock)
    .compile();
  assert.strictEqual(moduleRef.get(PrismaService), prismaMock);

  app = moduleRef.createNestApplication();
  const { configureApp } = await import('../../dist/src/configure-app.js');
  configureApp(app);
  await app.init();
});

after(async () => {
  await app?.close();
});

test('health endpoint reports API liveness', async () => {
  const response = await request(app.getHttpServer())
    .get('/v1/health')
    .expect(200);

  assert.deepEqual(response.body, {
    status: 'ok',
    service: 'netbridge-api',
  });
});

test('readiness endpoint reports database readiness', async () => {
  prismaQueryCalled = false;
  prismaQueryShouldFail = false;
  const response = await request(app.getHttpServer())
    .get('/v1/health/ready')
    .expect(200);

  assert.equal(prismaQueryCalled, true);
  assert.deepEqual(response.body, {
    status: 'ok',
    service: 'netbridge-api',
    database: 'ok',
  });
});

test('readiness endpoint returns 503 when the database is unavailable', async () => {
  prismaQueryShouldFail = true;
  try {
    const response = await request(app.getHttpServer())
      .get('/v1/health/ready')
      .expect(503);

    assert.equal(response.body.statusCode, 503);
    assert.equal(response.body.message, 'Database is not ready');
    assert.equal(JSON.stringify(response.body).includes('Database unavailable'), false);
    await request(app.getHttpServer()).get('/v1/health').expect(200);
  } finally {
    prismaQueryShouldFail = false;
  }
});

test('OpenAPI documentation is available', async () => {
  const response = await request(app.getHttpServer())
    .get('/docs-json')
    .expect(200);

  assert.equal(response.body.info.title, 'NetBridge API');
  assert.ok(
    Object.keys(response.body.paths).some((path) => path.endsWith('/health')),
  );
  assert.ok(response.body.paths['/v1/health/ready']);
});

test('unversioned health route is not exposed', async () => {
  await request(app.getHttpServer()).get('/health').expect(404);
});
