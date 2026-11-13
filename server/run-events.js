// Keep event ids stable and preserve replay after the in-memory window rolls over.
// Archives exist only for this server process / run lifetime, with private permissions.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';

const archives = new Set();
process.once('exit', () => {
  for (const dir of archives) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* shutdown */ } }
});

export function createRunEvents({ limit = 20000, batch = 5000 } = {}) {
  const events = [];
  let next = 0, dir = null, archive = null, archivedBytes = 0, archiveFailed = false;
  return {
    events,
    append(ev) {
      ev.i = next++;
      events.push(ev);
      if (events.length > limit && !archiveFailed) {
        try {
          if (!dir) {
            dir = fs.mkdtempSync(path.join(os.tmpdir(), 'baton-run-events-'));
            archives.add(dir);
            archive = path.join(dir, 'events.jsonl');
          }
          const data = events.slice(0, batch).map((e) => JSON.stringify(e) + '\n').join('');
          fs.appendFileSync(archive, data, { mode: 0o600 });
          archivedBytes += Buffer.byteLength(data);
          events.splice(0, batch);
        } catch (e) {
          // Keep unarchived events in memory; never silently lose a reply on a full disk.
          archiveFailed = true;
          console.warn('[run-events] keeping events in memory:', e.message);
        }
      }
    },
    *replay(from = 0) {
      from = Number.isSafeInteger(from) && from >= 0 ? from : 0;
      if (archivedBytes && from < (events[0]?.i ?? next)) {
        const fd = fs.openSync(archive, 'r');
        const buffer = Buffer.alloc(64 * 1024), decoder = new StringDecoder('utf8');
        let pending = '', read = 0;
        try {
          let n;
          while (read < archivedBytes && (n = fs.readSync(fd, buffer, 0, Math.min(buffer.length, archivedBytes - read), null)) > 0) {
            read += n;
            pending += decoder.write(buffer.subarray(0, n));
            let end;
            while ((end = pending.indexOf('\n')) >= 0) {
              const ev = JSON.parse(pending.slice(0, end));
              pending = pending.slice(end + 1);
              if (ev.i >= from) yield ev;
            }
          }
        } finally { fs.closeSync(fd); }
      }
      for (const ev of events) if (ev.i >= from) yield ev;
    },
    dispose() {
      if (dir) { fs.rmSync(dir, { recursive: true, force: true }); archives.delete(dir); }
      dir = archive = null;
    },
  };
}
