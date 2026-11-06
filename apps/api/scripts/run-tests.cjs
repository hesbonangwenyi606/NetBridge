const { readdirSync } = require('node:fs');
const { join } = require('node:path');
const { spawn } = require('node:child_process');

function collect(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? collect(path) : entry.name.endsWith('.spec.js') ? [path] : [];
  });
}

const files = collect('.test-build').sort();
if (!files.length) throw new Error('No compiled tests found');
const child = spawn(process.execPath, ['--test', ...files], { stdio: 'inherit' });
child.once('error', (error) => { console.error(error); process.exitCode = 1; });
child.once('exit', (code) => { process.exitCode = code ?? 1; });
