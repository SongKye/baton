// Keep image bytes out of chat JSON. Read just the referenced transcript record on demand.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { createHash } from 'node:crypto';

const MAX_RECORD = 128 * 1024 * 1024;
const MAX_IMAGE = 12 * 1024 * 1024;
const MIMES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const digest = (raw) => createHash('sha256').update(raw).digest('hex').slice(0, 24);

// Byte offsets stay correct for UTF-8, CRLF, malformed lines and an unterminated last line.
export async function eachClaudeRecord(file, fn) {
  let pieces = [], length = 0, offset = 0;
  const emit = () => {
    if (length <= MAX_RECORD) {
      const raw = Buffer.concat(pieces, length);
      let entry;
      try { entry = JSON.parse(raw.toString('utf8')); } catch { /* incomplete / malformed record */ }
      if (entry) fn(entry, { offset, length, raw });
    }
    offset += length; pieces = []; length = 0;
  };
  for await (const chunk of fs.createReadStream(file)) {
    let start = 0;
    while (start < chunk.length) {
      const newline = chunk.indexOf(10, start);
      const end = newline < 0 ? chunk.length : newline + 1;
      length += end - start;
      if (length <= MAX_RECORD) pieces.push(chunk.subarray(start, end));
      else pieces = [];
      start = end;
      if (newline >= 0) emit();
    }
  }
  if (length) emit();
}

function imageParts(entry) {
  if (entry.type !== 'user' || entry.isSidechain || entry.isMeta || entry.isCompactSummary) return [];
  const content = entry.message?.content;
  if (!Array.isArray(content) || content.some((p) => p?.type === 'tool_result')) return [];
  return content.filter((p) => p?.type === 'image');
}
function supported(part) {
  const source = part?.source;
  return source?.type === 'base64' && MIMES.has(source.media_type) && typeof source.data === 'string'
    && source.data.length > 0 && source.data.length <= Math.ceil(MAX_IMAGE / 3) * 4;
}
export function claudeImageRefs(entry, record) {
  const parts = imageParts(entry);
  if (!parts.some(supported)) return [];
  const hash = digest(record.raw);
  return parts.flatMap((part, index) => supported(part) ? [`${record.offset}.${record.length}.${index}.${hash}`] : []);
}

export async function readClaudeImage(file, ref) {
  const match = /^(\d+)\.(\d+)\.(\d+)\.([a-f0-9]{24})$/.exec(ref);
  if (!match) return null;
  const [, off, len, idx, hash] = match;
  const offset = Number(off), length = Number(len), index = Number(idx);
  if (![offset, length, index].every(Number.isSafeInteger) || length < 1 || length > MAX_RECORD) return null;
  let handle;
  try {
    handle = await fsp.open(file, 'r');
    const stat = await handle.stat();
    if (!stat.isFile() || offset > stat.size - length) return null;
    const raw = Buffer.alloc(length);
    let read = 0;
    while (read < length) {
      const { bytesRead } = await handle.read(raw, read, length - read, offset + read);
      if (!bytesRead) return null;
      read += bytesRead;
    }
    if (digest(raw) !== hash) return null; // rewritten transcript: never serve a different image
    const part = imageParts(JSON.parse(raw.toString('utf8')))[index];
    if (!supported(part)) return null;
    const data = Buffer.from(part.source.data, 'base64');
    if (!data.length || data.length > MAX_IMAGE) return null;
    return { data, mime: part.source.media_type };
  } catch { return null; }
  finally { await handle?.close(); }
}
