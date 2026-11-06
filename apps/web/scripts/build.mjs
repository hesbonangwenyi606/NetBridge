import { cp, mkdir, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const result = spawnSync(process.execPath, ['--check', `${root}/public/app.js`], { stdio: 'inherit' });
if (result.status !== 0) process.exit(result.status ?? 1);
await rm(`${root}/dist`, { recursive: true, force: true });
await mkdir(`${root}/dist`, { recursive: true });
await cp(`${root}/public`, `${root}/dist`, { recursive: true });
console.log('NetBridge web built to apps/web/dist');
