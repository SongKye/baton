import fs from 'node:fs/promises';
import path from 'node:path';

// Catalog fixtures refresh other providers in the background too. Never launch a real CLI.
export async function unavailableCliPath(tmp, names) {
  const bin = path.join(tmp, 'unavailable-bin');
  await fs.mkdir(bin, { recursive: true });
  for (const name of names) await fs.writeFile(path.join(bin, name + (process.platform === 'win32' ? '.cmd' : '')),
    process.platform === 'win32' ? '@exit /b 1\r\n' : '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  return bin + path.delimiter + path.dirname(process.execPath);
}
