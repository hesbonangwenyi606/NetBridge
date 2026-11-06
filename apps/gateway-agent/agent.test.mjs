import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import http from 'node:http';
import { apiOrigin, pair, loadConfig, request, run } from './agent.mjs';

test('credentials cannot be sent to insecure remote or credential-bearing origins', () => {
  assert.equal(apiOrigin('http://127.0.0.1:3000'), 'http://127.0.0.1:3000');
  assert.equal(apiOrigin('https://example.com'), 'https://example.com');
  for (const value of ['http://192.168.1.1', 'https://user:pass@example.com', 'https://example.com/v1', 'https://example.com/?token=secret']) assert.throws(() => apiOrigin(value));
});

test('agent persists credentials, resumes heartbeats, and stops on revocation without leaking tokens', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'netbridge-agent-'));
  const path = join(directory, 'config.json');
  const pairingToken = 'p'.repeat(43), gatewayToken = 'g'.repeat(43);
  let paired = false, revoked = false, heartbeats = 0;
  const server = http.createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/v1/gateway-agent/pair') {
      assert.equal(JSON.parse(body).pairingToken, pairingToken);
      if (paired) { res.writeHead(401); res.end('{}'); return; }
      paired = true; res.end(JSON.stringify({ id:'test-gateway', name:'Home PC', gatewayToken }));
    } else {
      assert.equal(req.headers.authorization, `Bearer ${gatewayToken}`);
      heartbeats++;
      res.writeHead(revoked ? 401 : 200); res.end(JSON.stringify({status:'ok'}));
    }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal(await pair(origin, pairingToken, path), 'test-gateway');
    const config = await loadConfig(path);
    assert.equal(config.gatewayToken, gatewayToken);
    const stored = await readFile(path, 'utf8');
    assert.ok(!stored.includes(pairingToken));
    if (process.platform === 'win32') assert.ok(!stored.includes(gatewayToken));
    await assert.rejects(pair(origin, pairingToken, path), /already configured/);
    await assert.rejects(pair(origin, pairingToken, join(directory,'replay.json')), /invalid/);
    const controller = new AbortController(), logs=[];
    await run(config, {signal:controller.signal, interval:1, log:message=>{logs.push(message);controller.abort()}});
    assert.equal(heartbeats, 1);
    assert.ok(!logs.join().includes(gatewayToken));
    revoked = true;
    await assert.rejects(run(config, {interval:1}), /revoked/);
    assert.equal(heartbeats, 2);
  } finally { await new Promise(resolve=>server.close(resolve)); await rm(directory,{recursive:true,force:true}); }
});

test('agent pairs with the running NetBridge API and revocation rejects its stored credential', {skip:!process.env.NETBRIDGE_AGENT_TEST_API}, async () => {
  const origin = apiOrigin(process.env.NETBRIDGE_AGENT_TEST_API);
  const credentials = {email:`agent-test-${Date.now()}@example.com`,password:'Agent integration test password'};
  const account = await request(origin, '/auth/register', {body:credentials});
  assert.ok(account.id);
  const {accessToken} = await request(origin, '/auth/login', {body:credentials});
  const gateway = await request(origin, '/gateways', {token:accessToken, body:{name:'Agent integration test'}});
  const directory = await mkdtemp(join(tmpdir(),'netbridge-real-agent-'));
  try {
    const path = join(directory,'config.json');
    assert.equal(await pair(origin,gateway.pairingToken,path),gateway.id);
    const config = await loadConfig(path);
    await request(origin,'/gateway-agent/heartbeat',{token:config.gatewayToken});
    await request(origin,`/gateways/${gateway.id}/revoke`,{token:accessToken});
    await assert.rejects(request(origin,'/gateway-agent/heartbeat',{token:config.gatewayToken}), /revoked/);
    await request(origin,'/auth/logout',{token:accessToken});
  } finally {await rm(directory,{recursive:true,force:true});}
});
