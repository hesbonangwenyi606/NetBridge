import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import { createRequestLogger, RequestLog } from '../../dist/src/logging/request-logging.middleware';

test('logger captures rejected requests once with their final status and no secrets', () => {
  const entries: RequestLog[] = [];
  const headers: Record<string, string> = {};
  const response = Object.assign(new EventEmitter(), {
    statusCode: 200, writableFinished: false,
    setHeader: (name: string, value: string) => { headers[name] = value; },
  });
  const request = { method: 'GET', route: { path: '/v1/devices/:id' }, url: '/v1/devices/secret?token=secret', headers: { authorization: 'Bearer secret' } };
  let nextCalled = false;
  createRequestLogger((entry) => entries.push(entry))(request, response, () => { nextCalled = true; });
  assert.equal(nextCalled, true);
  response.statusCode = 401;
  response.writableFinished = true;
  response.emit('finish');
  response.emit('close');
  assert.equal(entries.length, 1);
  assert.equal(entries[0].statusCode, 401);
  assert.equal(entries[0].path, '/v1/devices/:id');
  assert.equal(entries[0].requestId, headers['X-Request-Id']);
  assert.equal(JSON.stringify(entries).includes('secret'), false);
});

test('logger records aborted requests and hides unmatched paths', () => {
  const entries: RequestLog[] = [];
  const response = Object.assign(new EventEmitter(), {
    statusCode: 200, writableFinished: false, setHeader: () => {},
  });
  createRequestLogger((entry) => entries.push(entry))({ method: 'POST' }, response, () => {});
  response.emit('close');
  assert.equal(entries[0].statusCode, 499);
  assert.equal(entries[0].path, '[unmatched]');
});
