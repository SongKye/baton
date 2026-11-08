// Cross-platform regression coverage for independent installations and restarts.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { EventEmitter } from 'node:events';
import { defaultPort, listenerConfig, listen } from '../server/listener.js';

// The sandbox may prohibit socket creation. This mode exercises the same suite
// with simulated network events; CI always runs it against real sockets.
if (process.argv.includes('--simulate')) {
  const sockets = new Map();
  let ephemeral = 30000;
  http.createServer = (handler) => {
    const s = new EventEmitter();
    s.listen = (port, host, cb) => {
      port ||= ephemeral++;
      queueMicrotask(() => {
        if (sockets.has(port)) return s.emit('error', Object.assign(new Error('busy'), { code: 'EADDRINUSE' }));
        s.port = port;
        sockets.set(port, { handler, s });
        s.emit('listening');
        cb?.();
      });
      return s;
    };
    s.address = () => ({ port: s.port });
    s.closeAllConnections = () => {};
    s.close = (cb) => { if (sockets.get(s.port)?.s === s) sockets.delete(s.port); cb?.(); };
    return s;
  };
  globalThis.fetch = async (url) => {
    const socket = sockets.get(Number(new URL(url).port));
    if (!socket) throw new Error('connection refused');
    let body;
    socket.handler({}, { setHeader() {}, end(value) { body = value; } });
    return { ok: true, json: async () => JSON.parse(body) };
  };
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'baton-listener-'));
const servers = [];
const server = (id = 'unrelated') => {
  const s = http.createServer((req, res) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ id })); });
  servers.push(s);
  return s;
};
const close = (s) => new Promise((resolve) => { s.closeAllConnections(); s.close(resolve); });
try {
  assert.equal(defaultPort('win32'), 7421);
  assert.equal(defaultPort('linux'), 7420);
  assert.notEqual(listenerConfig(root, 'win32', '').id, listenerConfig(root, 'linux', '').id);
  for (const port of ['0', '65536', '-1', 'abc', '1.5']) assert.throws(() => listenerConfig(root, 'linux', port), /BATON_PORT/);
  const blocker = server();
  await new Promise((resolve, reject) => { blocker.once('error', reject); blocker.listen(0, '127.0.0.1', resolve); });
  const busy = blocker.address().port;
  await assert.rejects(listen(server(), listenerConfig(root, 'linux', String(busy))), /another server/);
  const cfg = { ...listenerConfig(root, 'linux', ''), port: busy };
  const first = server(cfg.id);
  const chosen = await listen(first, cfg);
  assert.equal(chosen.existing, false);
  assert.notEqual(chosen.port, busy);
  assert.equal(chosen.port % 2, 0);
  assert.equal(listenerConfig(root, 'linux', '').port, chosen.port);
  const duplicate = await listen(server(cfg.id), listenerConfig(root, 'linux', ''));
  assert.deepEqual(duplicate, { port: chosen.port, existing: true });
  await close(first);
  const restarted = await listen(server(cfg.id), listenerConfig(root, 'linux', ''));
  assert.deepEqual(restarted, chosen);
  const win = listenerConfig(root, 'win32', '');
  const windows = await listen(server(win.id), win);
  assert.equal(windows.port % 2, 1);
  assert.notEqual(windows.port, chosen.port);
  assert.equal(listenerConfig(root, 'win32', '').port, windows.port);
  fs.writeFileSync(win.file, 'broken');
  assert.equal(listenerConfig(root, 'win32', '').port, 7421);
  // Model a listener appearing after the HTTP probe: bind must still retry.
  if (process.argv.includes('--simulate')) {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      if (Number(new URL(url).port) === busy) throw new Error('not HTTP');
      return originalFetch(url);
    };
    await assert.rejects(listen(server(), listenerConfig(root, 'linux', String(busy))), /unavailable/);
    const retry = await listen(server('retry'), { ...cfg, id: 'retry' });
    assert.notEqual(retry.port, busy);
    assert.notEqual(retry.port, chosen.port);
    globalThis.fetch = originalFetch;
  }
  console.log('✓ defaults, validation, collision, identity, persistence, restart, Windows/WSL separation');
} finally {
  await Promise.all(servers.map(close));
  fs.rmSync(root, { recursive: true, force: true });
}
