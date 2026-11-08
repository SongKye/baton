// Keep native Windows and WSL in separate default port lanes, even when NAT
// hides the other OS's listeners. Persist the selected port for future launches.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

export const defaultPort = (platform = process.platform) => platform === 'win32' ? 7421 : 7420;
export function validPort(value) {
  return /^\d+$/.test(String(value)) && Number(value) >= 1 && Number(value) <= 65535;
}
export function listenerConfig(root, platform = process.platform, explicit = process.env.BATON_PORT) {
  const file = path.join(root, 'data', `listener-${platform}.json`);
  let saved;
  try { saved = JSON.parse(fs.readFileSync(file, 'utf8')).port; } catch { /* first launch */ }
  if (explicit && !validPort(explicit)) throw new Error('BATON_PORT must be an integer from 1 to 65535');
  const id = crypto.createHash('sha256').update(JSON.stringify([fs.realpathSync(root), platform, os.hostname(), os.homedir()])).digest('hex');
  return { file, id, platform, explicit: Boolean(explicit), port: Number(explicit || (validPort(saved) && saved) || defaultPort(platform)) };
}
async function identify(host, port, id) {
  try {
    const hostname = host === '0.0.0.0' ? '127.0.0.1' : host === '::' ? '[::1]' : host.includes(':') ? `[${host}]` : host;
    const r = await fetch(`http://${hostname}:${port}/api/instance`, { signal: AbortSignal.timeout(800), redirect: 'error' });
    try { return r.ok && (await r.json()).id === id ? 'same' : 'other'; } catch { return 'other'; }
  } catch { return false; }
}
function bind(server, port, host) {
  return new Promise((resolve, reject) => {
    const error = (e) => { server.off('listening', ready); reject(e); };
    const ready = () => { server.off('error', error); resolve(); };
    server.once('error', error);
    server.once('listening', ready);
    server.listen(port, host);
  });
}
export async function listen(server, config, host = '127.0.0.1') {
  const candidates = config.explicit ? [config.port] : [...new Set([config.port, ...Array.from({ length: 100 }, (_, i) => defaultPort(config.platform) + i * 2)])];
  for (const port of candidates) {
    // A forwarded WSL listener may be reachable even when a Windows bind would succeed.
    const peer = await identify(host, port, config.id);
    if (peer === 'same') return { port, existing: true };
    if (peer === 'other') {
      if (config.explicit) throw new Error(`BATON_PORT=${port} is already used by another server. Unset BATON_PORT to select a free port automatically.`);
      continue;
    }
    try { await bind(server, port, host); }
    catch (e) {
      if (!['EADDRINUSE', 'EACCES'].includes(e.code)) throw e;
      if (await identify(host, port, config.id) === 'same') return { port, existing: true };
      if (config.explicit) throw new Error(`BATON_PORT=${port} is unavailable (${e.code}). Unset BATON_PORT to select a free port automatically.`);
      continue;
    }
    try {
      fs.mkdirSync(path.dirname(config.file), { recursive: true });
      const temp = `${config.file}.${process.pid}.tmp`;
      fs.writeFileSync(temp, JSON.stringify({ port }) + '\n');
      fs.renameSync(temp, config.file);
    } catch (e) {
      await new Promise((resolve) => server.close(resolve));
      throw e;
    }
    return { port, existing: false };
  }
  throw new Error('No available Baton port found. Set BATON_PORT to an available port.');
}
