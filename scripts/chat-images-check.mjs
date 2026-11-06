// Regression checks for lazy transcript images, without external dependencies or private sessions.
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { eachClaudeRecord, claudeImageRefs, readClaudeImage } from '../server/sources/claude-images.js';

const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'baton-images-'));
const file = path.join(dir, 'session.jsonl');
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
const image = { type: 'image', source: { type: 'base64', media_type: 'image/png', data: png } };
const user = (content, extra = {}) => ({ type: 'user', message: { content }, ...extra });
try {
  const entries = [user([{ type: 'text', text: '한글 😀' }, image, image]), user([image]),
    user([{ type: 'image', source: { type: 'url', url: 'http://127.0.0.1/private' } }]),
    user([{ ...image, source: { ...image.source, media_type: 'image/svg+xml' } }]),
    user([image], { isMeta: true }), user([image], { isSidechain: true }),
    user([{ type: 'tool_result', content: 'result' }, image]),
    user([{ type: 'text', text: 'x'.repeat(180000) }, image])];
  await fsp.writeFile(file, 'invalid json\r\n\r\n' + entries.map(JSON.stringify).join('\r\n'));
  const records = [];
  await eachClaudeRecord(file, (entry, record) => records.push({ entry, refs: claudeImageRefs(entry, record) }));
  assert.equal(records.length, entries.length);
  assert.deepEqual(records.map((r) => r.refs.length), [2, 1, 0, 0, 0, 0, 0, 1]);
  for (const ref of records.flatMap((r) => r.refs)) {
    const result = await readClaudeImage(file, ref);
    assert.equal(result.mime, 'image/png');
    assert.deepEqual(result.data, Buffer.from(png, 'base64'));
  }
  assert.ok(!JSON.stringify(records.map((r) => r.refs)).includes(png));
  for (const ref of ['../../etc/passwd', '-1.10.0.'+'a'.repeat(24), '0.999999999.0.'+'a'.repeat(24), records[0].refs[0].replace(/\.0\./, '.999.')]) {
    assert.equal(await readClaudeImage(file, ref), null);
  }
  const oldRef = records[0].refs[0];
  await fsp.writeFile(file, (await fsp.readFile(file, 'utf8')).replace('한글', '변경'));
  assert.equal(await readClaudeImage(file, oldRef), null, 'rewritten record must not serve stale image');
  await fsp.unlink(file);
  assert.equal(await readClaudeImage(file, oldRef), null);
  console.log('chat images: UTF-8/CRLF, multiple and image-only messages, large records, unsafe sources, stale refs and missing files OK');
} finally { await fsp.rm(dir, { recursive: true, force: true }); }
