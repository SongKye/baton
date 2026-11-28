// Offline checks for server/memory.js: L0/L1/L2 lifecycle, monotonic seq & revocation deltas,
// Korean+English Smart Recall, secret redaction, 4k inline budget, cleanPrompt, reference logs, and opt-outs.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { HOME, cleanPrompt } from '../server/util.js';
import { patchProjectMeta, updateSettings } from '../server/store.js';
import { buildHandoffNote } from '../server/handoff.js';
import { forceRefresh } from '../server/indexer.js';
import {
  memoryProject,
  isMemoryEnabled,
  redactSecrets,
  isWorthExtracting,
  parseMemoryJson,
  clipItemText,
  applyMemoryOps,
  recordTurn,
  withMemory,
  listMemory,
  addMemoryItem,
  deleteMemoryItem,
  runDream,
  saveSessionToMemory,
  flushAllMemory,
  configureMemory,
  recallRelevant,
} from '../server/memory.js';

const tmpBase = fs.mkdtempSync(path.join(HOME, 'baton-mem-test-'));
const proj1 = path.join(tmpBase, 'app-one');
const proj2 = path.join(tmpBase, 'app-two');
fs.mkdirSync(path.join(proj1, '.git'), { recursive: true });
fs.mkdirSync(path.join(proj2, '.git'), { recursive: true });

try {
  // Verify real projectRoot rejects literal /tmp throwaways
  assert.equal(memoryProject('/tmp/throwaway-run'), null, '/tmp must be excluded by default');
  // Inside check.mjs, HOME itself lives under os.tmpdir(); map test projects explicitly while keeping HOME/workspace checks real.
  configureMemory({
    projectRootFn: (abs) => {
      if (abs === proj1 || abs.startsWith(proj1 + path.sep)) return proj1;
      if (abs === proj2 || abs.startsWith(proj2 + path.sep)) return proj2;
      if (abs === HOME || abs === path.join(HOME, 'workspace')) return abs;
      return null;
    },
  });

  // 1. Project eligibility & exclusions
  assert.equal(memoryProject(HOME), null, 'HOME must be excluded');
  assert.equal(memoryProject(path.join(HOME, 'workspace')), null, '~/workspace container must be excluded');
  assert.equal(memoryProject(path.join(proj1, '.claude', 'worktrees', 'wt1')), null, 'agent worktrees must be excluded');
  assert.equal(memoryProject(proj1), proj1, 'real project root must be accepted');
  assert.equal(isMemoryEnabled(proj1), true, 'enabled by default');

  // 2. Secret redaction
  const redacted = redactSecrets('key sk-ant-api03-1234567890abcdef1234567890 gh ghp_1234567890abcdefghij1234567890 Bearer eyJhbGciOiJIUzI1NiJ9.abcdef1234567890 API_KEY=mySecretPassword99');
  assert.ok(!redacted.includes('sk-ant-api03'), 'Anthropic key redacted');
  assert.ok(!redacted.includes('ghp_1234567890'), 'GitHub token redacted');
  assert.ok(!redacted.includes('eyJhbGciOiJIUzI1NiJ9'), 'Bearer token redacted');
  assert.ok(!redacted.includes('mySecretPassword99'), 'API_KEY assignment redacted');

  // 3. 0-token pre-filter & malformed JSON handling
  assert.equal(isWorthExtracting([{ userText: '응 고마워', reply: '네!', files: [], qaPairs: [] }]), false, 'trivial ack skipped');
  assert.equal(isWorthExtracting([{ userText: '로그인은 JWT로 하자', reply: '알겠습니다.', files: [], qaPairs: [] }]), true, 'decision signal passes');
  assert.equal(isWorthExtracting([{ userText: '수정해줘', reply: '완료', files: ['server/auth.js'], qaPairs: [] }]), false, 'bare file edit with no explanation skipped');
  assert.equal(isWorthExtracting([{ userText: '로그인 화면 손봐줘', reply: '세션 만료 처리를 고쳤습니다. '.repeat(30), files: ['server/auth.js'], qaPairs: [] }]), true, 'file edit with a real explanation passes');
  assert.equal(isWorthExtracting([{ userText: 'support 페이지 report 버튼 prefix 정리', reply: '변경하고 해결했습니다.', files: [], qaPairs: [] }]), false, 'support/report/prefix are not port/fix signals');
  assert.equal(isWorthExtracting([{ userText: '왜 안 돼?', reply: 'root cause는 캐시 키 충돌입니다.', files: [], qaPairs: [] }]), true, 'lesson in the reply passes');
  assert.equal(isWorthExtracting([{ userText: '골라줘', reply: '완료', files: [], qaPairs: ['Q: Auth? -> A: JWT'] }]), true, 'AskUserQuestion answer passes');
  assert.equal(parseMemoryJson('not valid json at all'), null, 'broken JSON ignored');
  const longItem = `${'가'.repeat(150)}로 결정했다. ${'나'.repeat(150)} 때문이다. ${'다'.repeat(150)}`;
  const parsedLong = parseMemoryJson(JSON.stringify({ add: [{ kind: 'decision', text: longItem }] })).add[0].text;
  assert.ok(parsedLong.endsWith('때문이다.'), 'over-long item is cut at a sentence end, not mid-word');
  assert.ok(parsedLong.length <= 400, 'item stays within the hard limit');
  const mid = `${'a'.repeat(330)} 까지 이어지는 설명`;
  assert.equal(parseMemoryJson(JSON.stringify({ add: [{ kind: 'gotcha', text: mid }] })).add[0].text, mid, '330-char item is no longer cut at 260');
  assert.ok(clipItemText('x'.repeat(500)).endsWith('…') && clipItemText('x'.repeat(500)).length === 400, 'no sentence end -> hard clip with ellipsis');
  assert.deepEqual(parseMemoryJson('Sure:\n{"add":[{"kind":"convention","text":"Use tabs","tags":["style","tabs"]}],"update":[],"remove":[]}').add[0].kind, 'feedback', 'kind alias normalized');

  // 4. L0 instant bridge + AskUserQuestion capture BEFORE L1 runs
  configureMemory({
    debounceMs: 60_000,
    oneShotFn: async () => JSON.stringify({
      add: [{ kind: 'decision', text: '로그인 인증은 세션 쿠키 대신 JWT 토큰 사용', tags: 'auth jwt 로그인 인증' }],
      update: [],
      remove: [],
    }),
  });

  recordTurn({
    tool: 'claude',
    sessionId: 'claude-sess-1',
    cwd: proj1,
    status: 'done',
    prompt: '인증 방식 결정하자',
    events: [
      { t: 'ask', requestId: 'q1', questions: [{ question: '인증 방식은?' }] },
      { t: 'ask_done', requestId: 'q1', answers: { '인증 방식은?': 'JWT' } },
      { t: 'tool', name: 'Edit', summary: 'server/auth.js' },
      { t: 'text', text: 'JWT 인증 구조로 결정했고 server/auth.js에 반영했습니다.' },
      { t: 'done', ok: true, result: 'JWT 인증 구조로 결정했고 server/auth.js에 반영했습니다.' },
    ],
  });

  // Immediately open a fresh Codex session (<1s after Claude finished, before L1 debounce fires)
  const immediate = await withMemory({ tool: 'codex', sessionId: null, cwd: proj1, prompt: '로그인 어떻게 하기로 했지?' });
  assert.ok(immediate.wirePrompt.startsWith('로그인 어떻게 하기로 했지?\n\n<baton-memory>'), 'trailing <baton-memory> preserves user prompt prefix');
  assert.ok(immediate.wirePrompt.includes('JWT'), 'L0 instant bridge carries AskUserQuestion/reply details immediately');
  assert.ok(immediate.wirePrompt.includes('server/auth.js'), 'L0 carries touched file');
  assert.ok(immediate.memoryEvent && immediate.memoryEvent.from.includes('claude'), 'memory event reports source CLI');

  // 5. Flush L1 extraction -> DB + .baton/memory.md mirror
  await flushAllMemory();
  const listed = listMemory(proj1);
  assert.equal(listed.items.length, 1, 'L1 extracted 1 item');
  assert.equal(listed.items[0].kind, 'decision');
  assert.ok(fs.existsSync(path.join(proj1, '.baton', '.gitignore')), '.baton/.gitignore created');
  assert.ok(fs.existsSync(path.join(proj1, '.baton', 'memory.md')), '.baton/memory.md mirrored');
  assert.ok(fs.existsSync(path.join(proj1, '.baton', 'memory', 'decisions.md')), 'topic file mirrored');

  // 6. Delta sync, self-exclusion, zero-token no-op, and revocation (removed=1) delta
  const codexTurn1 = await withMemory({ tool: 'codex', sessionId: 'codex-s1', cwd: proj1, prompt: '작업 시작할게' });
  assert.ok(codexTurn1.wirePrompt.includes('JWT'), 'first turn sees extracted decision');
  codexTurn1.markSeen('codex-s1');

  const codexTurn2Noop = await withMemory({ tool: 'codex', sessionId: 'codex-s1', cwd: proj1, prompt: '다음 파일 보자' });
  assert.equal(codexTurn2Noop.wirePrompt, '다음 파일 보자', 'no changes -> 0 extra tokens');
  assert.equal(codexTurn2Noop.memoryEvent, null);

  // Self-turn must NOT echo back to same session
  configureMemory({ oneShotFn: async () => JSON.stringify({ add: [{ kind: 'state', text: 'Codex own work', tags: 'self' }], update: [], remove: [] }) });
  recordTurn({
    tool: 'codex', sessionId: 'codex-s1', cwd: proj1, status: 'done',
    prompt: '진행 중 상태 저장 테스트',
    events: [{ t: 'tool', name: 'Edit', summary: 'a.js' }, { t: 'text', text: '작업 완료했습니다.' }],
  });
  await flushAllMemory();
  const codexTurn3Self = await withMemory({ tool: 'codex', sessionId: 'codex-s1', cwd: proj1, prompt: '계속 진행해' });
  assert.equal(codexTurn3Self.memoryEvent, null, 'own session changes are excluded from delta');

  // Revoke the JWT item -> continuing Codex session MUST receive revocation delta!
  const jwtId = listed.items[0].id;
  await deleteMemoryItem(proj1, jwtId);
  const codexTurn4Revoked = await withMemory({ tool: 'codex', sessionId: 'codex-s1', cwd: proj1, prompt: '인증 이어서 하자' });
  assert.ok(codexTurn4Revoked.wirePrompt.includes('No longer applies / revoked'), 'continuing session notified of revoked memory');
  assert.ok(codexTurn4Revoked.wirePrompt.includes('JWT'), 'revoked item text included');
  codexTurn4Revoked.markSeen('codex-s1');

  // 7. Project move resets mem_seen scope
  await addMemoryItem(proj2, { kind: 'decision', text: 'Project two uses PostgreSQL', pinned: true });
  const movedTurn = await withMemory({ tool: 'codex', sessionId: 'codex-s1', cwd: proj2, prompt: 'DB 뭐 쓰지?' });
  assert.ok(movedTurn.wirePrompt.includes('Project two uses PostgreSQL'), 'moved session receives new project full memory');

  // 8. 4k inline budget + Korean 2-char stem & 2-char acronym Smart Recall
  const oldTarget = await addMemoryItem(proj1, {
    kind: 'gotcha',
    text: '결제 웹훅 검증은 raw body 필요, 포트는 5173 유지, DB는 SQLite 사용',
    tags: '결제 웹훅 포트 DB sqlite stripe',
    pinned: false,
  });
  // Push oldTarget out of top core slice with 28 long filler items
  for (let i = 0; i < 28; i++) {
    await addMemoryItem(proj1, {
      kind: 'decision',
      text: `Filler architectural note number ${i}: keep module boundaries clean and deterministic across builds (${'x'.repeat(110)})`,
      tags: `filler${i}`,
      pinned: false,
    });
  }
  const recallCheck = recallRelevant(proj1, '결제 포트 DB 문제 고쳐줘');
  assert.ok(recallCheck.memories.some((m) => m.id === oldTarget.id), 'Smart Recall matches 2-char Korean stems (결제/포트) and 2-char acronym (DB)');

  const bigTurn = await withMemory({ tool: 'agy', sessionId: null, cwd: proj1, prompt: '결제 포트 DB 점검해줘' });
  const memBlock = bigTurn.wirePrompt.slice(bigTurn.wirePrompt.indexOf('<baton-memory>'));
  assert.ok(memBlock.length <= 4000, `inline block must stay <= 4000 chars (got ${memBlock.length})`);
  assert.ok(memBlock.includes('raw body'), 'Smart Recall surfaces pushed-out relevant older memory inside 4k cap');

  // 9. L2 Auto-Dream consolidation + pinned protection
  const pinnedItem = await addMemoryItem(proj1, { kind: 'feedback', text: '한국어 UI는 항상 해요체를 사용한다', pinned: true });
  const autoDup = await addMemoryItem(proj1, { kind: 'state', text: '임시 완료된 상태', pinned: false });
  configureMemory({
    oneShotFn: async () => JSON.stringify({
      update: [{ id: pinnedItem.id, text: 'MALICIOUS OVERWRITE ATTEMPT' }],
      remove: [pinnedItem.id, autoDup.id],
      add: [],
    }),
  });
  const dreamRes = await runDream(proj1);
  assert.equal(dreamRes.ok, true);
  const afterDream = listMemory(proj1);
  const survivingPin = afterDream.items.find((x) => x.id === pinnedItem.id);
  assert.ok(survivingPin, 'pinned item must survive Dream consolidation');
  assert.equal(survivingPin.text, '한국어 UI는 항상 해요체를 사용한다', 'pinned item text must not be altered by Dream');
  assert.ok(!afterDream.items.some((x) => x.id === autoDup.id), 'non-pinned item removed by Dream');
  assert.ok(afterDream.stats.lastDreamAt > 0, 'lastDreamAt recorded');

  // 10. cleanPrompt (paired + truncated preview fallback) & buildHandoffNote reference mode
  assert.equal(cleanPrompt('사용자 요청\n\n<baton-memory>\nShared project memory\n</baton-memory>'), '사용자 요청');
  assert.equal(cleanPrompt('사용자 요청\n\n<baton-memory>\ntruncated agy preview without closing tag'), '사용자 요청');
  const refNote = await buildHandoffNote(
    { tool: 'claude', id: 'abcdef123456', title: 'Auth work', cwd: proj1, project: proj1, updated: Date.now() },
    [{ role: 'user', text: 'Auth check' }, { role: 'assistant', text: 'Checked auth.' }],
    { budget: 4000, mode: 'reference' },
  );
  assert.ok(refNote.includes('Session log (reference only)'), 'reference mode has neutral header');
  assert.ok(!refNote.includes('You are taking over'), 'reference mode omits takeover directive');

  // 11. Manual session-level save from chat ⋯ menu (AI summarizes conversation automatically)
  const slug = proj1.replace(/[^a-zA-Z0-9]/g, '-');
  const claudeDir = path.join(HOME, '.claude', 'projects', slug);
  fs.mkdirSync(claudeDir, { recursive: true });
  const manualSid = 'manual-save-sess';
  const ts = new Date().toISOString();
  fs.writeFileSync(path.join(claudeDir, `${manualSid}.jsonl`), [
    JSON.stringify({ type: 'user', cwd: proj1, timestamp: ts, isSidechain: false, message: { role: 'user', content: '캐시는 Redis 말고 인메모리 LRU로 가자' } }),
    JSON.stringify({ type: 'assistant', cwd: proj1, timestamp: ts, isSidechain: false, message: { role: 'assistant', content: [{ type: 'text', text: '네, 인메모리 LRU 캐시로 구현하겠습니다.' }] } }),
  ].join('\n') + '\n');
  await forceRefresh();
  configureMemory({
    oneShotFn: async ({ prompt }) => {
      assert.ok(prompt.includes('인메모리 LRU'), 'session transcript passed to AI extractor');
      return JSON.stringify({ add: [{ kind: 'decision', text: '캐시는 Redis 대신 인메모리 LRU 사용', tags: 'cache lru redis 캐시' }], update: [], remove: [] });
    },
  });
  const savedManual = await saveSessionToMemory('claude', manualSid);
  assert.equal(savedManual.ok, true);
  assert.equal(savedManual.changed, 1);
  assert.ok(listMemory(proj1).items.some((x) => x.text.includes('인메모리 LRU')), 'manual session save stored extracted memory');

  // 12. Project-level OFF & Global OFF
  patchProjectMeta(proj1, { memory_off: 1 });
  assert.equal(isMemoryEnabled(proj1), false);
  await assert.rejects(() => saveSessionToMemory('claude', manualSid), { code: 'DISABLED' }, 'manual save respects project memory_off');
  const offProj = await withMemory({ tool: 'codex', sessionId: null, cwd: proj1, prompt: '안녕하세요' });
  assert.equal(offProj.wirePrompt, '안녕하세요');
  assert.equal(offProj.memoryEvent, null);

  patchProjectMeta(proj1, { memory_off: 0 });
  updateSettings({ sharedMemory: false });
  assert.equal(isMemoryEnabled(proj1), false);
  const offGlobal = await withMemory({ tool: 'codex', sessionId: null, cwd: proj1, prompt: '안녕하세요' });
  assert.equal(offGlobal.wirePrompt, '안녕하세요');
  assert.equal(offGlobal.memoryEvent, null);
  updateSettings({ sharedMemory: true });

  console.log('memory-check: OK');
} finally {
  fs.rmSync(tmpBase, { recursive: true, force: true });
}
