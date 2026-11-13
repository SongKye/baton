import assert from 'node:assert/strict';
import fs from 'node:fs';
import { checkVersion, checkResume, checkTranscript, failureCategory, collectShape, compareShapes, needsReview, shouldAttemptFix, reportPassed, reportMatchesCheckout } from './lib-compat-contracts.mjs';
import { createRunEvents } from '../server/run-events.js';

assert.equal(checkVersion({ code: 0, stdout: 'cli 1.2.3', stderr: '' }, '1.2.3'), '1.2.3');
for (const result of [{ code: 1, stdout: '1.2.3' }, { code: 0, stdout: '1.2.4' }, { code: 0, stdout: '?' }]) {
  assert.throws(() => checkVersion(result, '1.2.3'), /version mismatch/);
}
checkResume({ sessionId: 'same', text: 'nonce' }, 'same', 'nonce');
assert.throws(() => checkResume({ sessionId: 'new', text: 'nonce' }, 'same', 'nonce'));
assert.throws(() => checkResume({ sessionId: 'same', text: 'BATONSMOKETWO' }, 'same', 'nonce'));
const messages = [{ role: 'user', text: 'first' }, { role: 'assistant', text: 'BATONSMOKEONE' }, { role: 'user', text: 'second' }, { role: 'assistant', text: 'nonce' }];
checkTranscript(messages, 'first', 'second', 'nonce');
assert.throws(() => checkTranscript(messages.toReversed(), 'first', 'second', 'nonce'));
assert.throws(() => checkTranscript(messages.filter((m) => m.text !== 'second'), 'first', 'second', 'nonce'));

for (const [message, category] of [['HTTP 401', 'auth'], ['invalid API key', 'auth'], ['usage limit exceeded', 'quota'], ['429', 'quota'], ['fetch failed', 'network'], ['ETIMEDOUT', 'network'], ['unexpected event', 'unknown']]) assert.equal(failureCategory(new Error(message)), category);
const test = { expectedVersion: '1.2.3', checkOk: true, report: { version: '1.2.3', steps: [{ ok: false, category: 'contract' }] } };
assert.equal(shouldAttemptFix(test), true);
for (const category of ['auth', 'quota', 'network', 'unknown', 'environment']) {
  assert.equal(shouldAttemptFix({ ...test, report: { ...test.report, steps: [...test.report.steps, { ok: false, category }] } }), false);
}
assert.equal(shouldAttemptFix({ ...test, expectedVersion: '1.2.4' }), false);
assert.equal(shouldAttemptFix({ ...test, report: null }), false);
assert.equal(reportPassed({ ok: true, version: '1.2.3', steps: [] }, '1.2.3'), false);
assert.equal(reportPassed({ ok: true, version: '1.2.3', steps: [{ name: 'one-shot', ok: true }] }, '1.2.3'), false);
const checkout = { revision: 'test-commit', platform: 'linux', arch: 'x64' };
const provenance = { ...checkout, dirty: false };
assert.equal(reportMatchesCheckout(provenance, checkout), true);
for (const change of [{ dirty: true }, { dirty: undefined }, { revision: 'old-commit' }, { platform: 'darwin' }, { arch: 'arm64' }]) {
  assert.equal(reportMatchesCheckout({ ...provenance, ...change }, checkout), false);
}

const shape = (events) => {
  const stream = new Set(), types = {};
  for (const e of events) collectShape(e, e.type, stream, types);
  return { version: '1.2.3', stream: [...stream], file: [], types };
};
const base = shape([{ type: 'done', count: 1, list: [{ name: 'x' }] }, { type: 'tool', name: 'read' }]);
assert.equal(needsReview(compareShapes(base, base)), false);
const changed = compareShapes(base, shape([{ type: 'done', count: '1', list: [] }]));
assert.deepEqual(changed.missingKinds, ['tool']);
assert(changed.changed.some((p) => p.includes('count: number -> string')));
assert(!changed.removed.some((p) => p.includes('list[].name')), 'empty arrays do not imply removed fields');
assert.equal(needsReview(changed), true);
assert.equal(needsReview(compareShapes(null, base)), true);

// More than two memory-window rollovers: replay must remain exact, including UTF-8 and an old question.
const log = createRunEvents();
try {
  for (let i = 0; i < 43000; i++) log.append(i === 1 ? { t: 'ask', requestId: 'q' } : { t: 'text', text: `한글 😀 ${i}` });
  assert(log.events.length <= 20000);
  assert.deepEqual([...log.replay()].map((e) => e.i), Array.from({ length: 43000 }, (_, i) => i));
  for (const from of [0, 1, 4999, 5000, 19999, 20000, 25001, 42999, 43000]) {
    const replay = [...log.replay(from)];
    assert.equal(replay.length, 43000 - from);
    if (replay.length) assert.equal(replay[0].i, from);
  }
  assert.equal([...log.replay(1)][0].requestId, 'q');
  assert.equal([...log.replay(19999)][0].text, '한글 😀 19999');
} finally { log.dispose(); }
// A partially written archive must not lose or duplicate uncommitted events.
const small = createRunEvents({ limit: 3, batch: 2 });
const append = fs.appendFileSync;
let writes = 0;
try {
  fs.appendFileSync = (file, data, options) => {
    if (++writes === 2) { append(file, data.slice(0, 5), options); throw new Error('simulated full disk'); }
    return append(file, data, options);
  };
  for (let i = 0; i < 8; i++) small.append({ t: 'text', text: String(i) });
  assert.deepEqual([...small.replay()].map((e) => e.i), [0, 1, 2, 3, 4, 5, 6, 7]);
} finally { fs.appendFileSync = append; small.dispose(); }
console.log('PASS: version/context/transcript contracts, failure routing, schema types/kinds, lossless replay across rollovers');
