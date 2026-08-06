const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const port = 29511;
const server = http.createServer((_request, response) => {
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  response.end('<!doctype html><html><head><title>Firefox Magnetar smoke</title></head><body><a href="magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567&dn=Firefox%20Smoke">Firefox Smoke</a></body></html>');
});

async function main() {
  await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
  let output = '';
  const npxCli = 'C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npx-cli.js';
  const runner = spawn(process.execPath, [npxCli,
    '--yes',
    'web-ext@8.5.0',
    'run',
    '--source-dir', path.join(root, 'dist', 'dev', 'firefox'),
    '--firefox', 'C:\\Program Files\\Mozilla Firefox\\firefox.exe',
    '--start-url', `http://127.0.0.1:${port}/`,
    '--no-reload',
    '--no-input',
    '--verbose',
    '--args=--headless',
  ], { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  runner.stdout.on('data', chunk => { output += chunk.toString(); });
  runner.stderr.on('data', chunk => { output += chunk.toString(); });
  try {
    const started = Date.now();
    while (Date.now() - started < 25000 && !/Installed|temporary add-on|Extension ready|WebExt run target ready/i.test(output)) {
      if (runner.exitCode !== null) break;
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    assert.match(output, /Installed|temporary add-on|Extension ready|WebExt run target ready/i, output || 'Firefox produced no web-ext output');
    console.log('Firefox temporary add-on load smoke passed.');
  } finally {
    server.closeAllConnections?.();
    server.close();
    if (runner.pid && runner.exitCode === null) {
      runner.kill();
      await new Promise(resolve => setTimeout(resolve, 500));
      if (runner.exitCode === null) {
        if (process.platform === 'win32') spawn('taskkill', ['/PID', String(runner.pid), '/T', '/F'], { windowsHide: true, detached: true, stdio: 'ignore' }).unref();
        else runner.kill('SIGKILL');
      }
    }
    runner.stdout.destroy();
    runner.stderr.destroy();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
