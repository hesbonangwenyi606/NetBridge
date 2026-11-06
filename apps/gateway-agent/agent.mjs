import { readFile, mkdir, writeFile, rename, unlink, access } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { setTimeout as delay } from 'node:timers/promises';

export function apiOrigin(value) {
  const url = new URL(value);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Use an HTTPS API origin, or http://127.0.0.1:3000 for local development.');
  }
  return url.origin;
}
export async function request(origin, path, { token, body, signal } = {}) {
  let response;
  try {
    response = await fetch(`${apiOrigin(origin)}/v1${path}`, {
      method: 'POST', redirect: 'error', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000),
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch { throw new Error('Cannot reach NetBridge. Start the local app or check the API address.'); }
  if (!response.ok) {
    const error = new Error(response.status === 401 ? 'Credential expired, invalid, or revoked. Generate a new pairing token for a pending gateway.' : `NetBridge returned HTTP ${response.status}.`);
    error.status = response.status;
    throw error;
  }
  return response.status === 204 ? null : response.json();
}
function protect(value, decrypt = false) {
  if (process.platform !== 'win32') return value;
  const command = decrypt
    ? "$v=[Console]::In.ReadToEnd(); $s=ConvertTo-SecureString $v; $p=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($s); try {[Console]::Write([Runtime.InteropServices.Marshal]::PtrToStringBSTR($p))} finally {[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($p)}"
    : "$v=[Console]::In.ReadToEnd(); [Console]::Write((ConvertTo-SecureString -String $v -AsPlainText -Force | ConvertFrom-SecureString))";
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { input: value, encoding: 'utf8', windowsHide: true, timeout: 15000 });
  if (result.error || result.status !== 0) throw new Error('Windows credential encryption failed. Run the agent as the Windows user who paired it.');
  return result.stdout.trim();
}
export async function saveConfig(path, config) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const stored = { version: 1, apiUrl: apiOrigin(config.apiUrl), gatewayId: config.gatewayId, gatewayName: config.gatewayName, protection: process.platform === 'win32' ? 'windows-dpapi' : 'file-permissions', credential: protect(config.gatewayToken) };
  const temporary = `${path}.${process.pid}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(stored, null, 2), { mode: 0o600, flag: 'wx' });
    await rename(temporary, path);
  } finally { await unlink(temporary).catch(() => {}); }
}
export async function loadConfig(path) {
  const config = JSON.parse(await readFile(path, 'utf8'));
  if (config.version !== 1 || !config.gatewayId || !config.credential) throw new Error('Invalid agent configuration. Pair again.');
  if (config.protection === 'windows-dpapi' && process.platform !== 'win32') throw new Error('This credential belongs to a Windows user. Pair this computer separately.');
  const gatewayToken = config.protection === 'windows-dpapi' ? protect(config.credential, true) : config.credential;
  return { apiUrl: apiOrigin(config.apiUrl), gatewayId: config.gatewayId, gatewayName: config.gatewayName, gatewayToken };
}
export async function pair(origin, pairingToken, configPath) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(pairingToken)) throw new Error('Paste a fresh 43-character pairing token from NetBridge.');
  try { await access(configPath); throw new Error('This agent is already configured. Use a different --config path to pair another gateway.'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  // Check encryption and disk access before consuming the one-time token.
  protect('credential-storage-check');
  await mkdir(dirname(configPath), { recursive: true, mode: 0o700 });
  const probe = `${configPath}.probe`;
  await writeFile(probe, '', { flag: 'wx', mode: 0o600 }); await unlink(probe);
  const result = await request(origin, '/gateway-agent/pair', { body: { pairingToken } });
  if (!result.id || !/^[A-Za-z0-9_-]{43}$/.test(result.gatewayToken)) throw new Error('Invalid pairing response.');
  await saveConfig(configPath, { apiUrl: origin, gatewayId: result.id, gatewayName: result.name, gatewayToken: result.gatewayToken });
  return result.id;
}
export async function run(config, { signal, interval = 30000, log = console.log } = {}) {
  while (!signal?.aborted) {
    try {
      await request(config.apiUrl, '/gateway-agent/heartbeat', { token: config.gatewayToken, signal });
      log(`Heartbeat accepted at ${new Date().toLocaleTimeString()}.`);
    } catch (error) {
      if (signal?.aborted) return;
      if (error.status === 401 || error.status === 403) throw error;
      log('API unavailable; retrying in 30 seconds.');
    }
    try { await delay(interval, undefined, { signal }); } catch { return; }
  }
}
async function secretPrompt() {
  if (!process.stdin.isTTY) {
    let text = ''; for await (const chunk of process.stdin) text += chunk;
    return text.trim();
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  process.stdout.write('Paste the pairing token (hidden), then press Enter: ');
  rl._writeToOutput = () => {};
  return new Promise(resolve => rl.question('', answer => { rl.close(); process.stdout.write('\n'); resolve(answer.trim()); }));
}
async function main() {
  const [command = 'help', ...args] = process.argv.slice(2);
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!['--api', '--config'].includes(args[i]) || !args[i + 1]) throw new Error('Options: --api ORIGIN --config FILE');
    options[args[i]] = args[i + 1];
  }
  const configPath = resolve(options['--config'] || '.local/gateway-agent/config.json');
  if (command === 'pair') {
    const origin = apiOrigin(options['--api'] || 'http://127.0.0.1:3000');
    await pair(origin, await secretPrompt(), configPath);
    console.log('Home PC paired. Credential saved securely. Run npm run gateway:start to send heartbeats.');
  } else if (command === 'start') {
    const config = await loadConfig(configPath);
    const controller = new AbortController();
    process.once('SIGINT', () => controller.abort()); process.once('SIGTERM', () => controller.abort());
    console.log('NetBridge gateway agent running. Ctrl+C stops it. Pairing does not enable a VPN.');
    await run(config, { signal: controller.signal });
  } else if (command === 'status') {
    const config = await loadConfig(configPath);
    await request(config.apiUrl, '/gateway-agent/heartbeat', { token: config.gatewayToken });
    console.log('Gateway credential accepted; NetBridge is reachable.');
  } else {
    console.log('Commands: pair | start | status. Options: --api ORIGIN --config FILE.\nPairing token is read from a hidden prompt or stdin, never a command argument.');
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.code === 'ENOENT' ? 'No agent configuration found. Run npm run gateway:pair first.' : error.message); process.exitCode = 1; });
}
