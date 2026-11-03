const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
(async () => {
  const root = fs.mkdtempSync(path.resolve('.pi-tmp-launcher '));
  let frontendPid;
  try {
    fs.mkdirSync(path.join(root, 'backend'), { recursive: true });
    fs.mkdirSync(path.join(root, 'venv/bin'), { recursive: true });
    fs.mkdirSync(path.join(root, 'frontend/node_modules/vite/bin'), { recursive: true });
    fs.copyFileSync(path.resolve('start-dev.sh'), path.join(root, 'start-dev.sh'));
    // Mock interpreter: answers the launcher's "can it import the backend deps" probe,
    // then plays the failing backend service (exit 7).
    fs.writeFileSync(path.join(root, 'venv/bin/python'), '#!/usr/bin/env bash\nif [ "$1" = "-c" ]; then exit 0; fi\nexec node -e "setTimeout(() => process.exit(7), 750)"\n', { mode: 0o755 });
    fs.writeFileSync(path.join(root, 'frontend/node_modules/vite/bin/vite.js'), 'require("node:fs").writeFileSync("frontend.pid", String(process.pid)); setInterval(() => {}, 1000);');
    const child = spawn('bash', [path.join(root, 'start-dev.sh').replaceAll('\\', '/')], { cwd: path.resolve('frontend'), stdio: 'pipe' });
    let output = '';
    child.stdout.on('data', (data) => { output += data; });
    child.stderr.on('data', (data) => { output += data; });
    const timer = setTimeout(() => child.kill('SIGKILL'), 10000);
    const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('close', resolve); });
    clearTimeout(timer);
    assert.equal(code, 7, output);
    frontendPid = Number(fs.readFileSync(path.join(root, 'frontend/frontend.pid'), 'utf8'));
    let alive = true;
    try { process.kill(frontendPid, 0); } catch { alive = false; }
    assert.equal(alive, false, 'The remaining server must stop when the other exits');
    console.log('PASS: launcher handles spaces, runs from another directory, propagates failure, and stops the remaining server (mock services; no notebook data opened).');
  } finally {
    if (frontendPid) { try { process.kill(frontendPid); } catch {} }
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
