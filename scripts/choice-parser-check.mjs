#!/usr/bin/env node
// Regression checks for public/choice-parser.js (FAQ false-positive filtering + real choice detection).
import assert from 'node:assert/strict';
import { parseChoices, parseQuestions } from '../public/choice-parser.js';

const detect = (text) => {
  const multi = parseQuestions(text);
  if (multi) return { kind: 'multi', questions: multi };
  const single = parseChoices(text);
  if (single) return { kind: 'single', ...single };
  return null;
};

// 1. Original reported Antigravity Playwright FAQ (3 numbered self-answered blocks) -> must NOT show any choice card
const originalFaq = `### \`playwright-core\`가 무엇이고, 설치하면 뭐가 좋은가요?

1. **어떤 도구인가요?**
   - Microsoft가 만든 브라우저 자동화 라이브러리(Playwright)의 핵심 패키지입니다.
   - 사람이 직접 크롬을 열어 클릭해 보는 대신, 테스트 스크립트가 화면 없는 Chromium 브라우저를 띄워 페이지 접속·클릭·스크롤·실시간 스트리밍(SSE) 재연결·콘솔 에러 여부를 자동으로 검사합니다.
2. **Baton에서는 어디에 쓰이나요?**
   - \`npm test\`: 서버 API, CLI 파서, 메모리, 문법, 번역(i18n) 같은 **로직/백엔드 검증**
   - \`npm run test:browser\`: \`playwright-core\`로 **실제 브라우저를 띄워 프론트엔드 화면과 스트리밍 재연결을 검증**
3. **내 PC에 설치하면 뭐가 좋고, 꼭 설치해야 하나요?**
   - **꼭 설치할 필요는 없습니다.** GitHub에 PR을 올리면 GitHub Actions CI가 알아서 Chromium 브라우저 테스트를 돌려줍니다.
   - 다만 앞으로 대시보드 UI를 자주 고치면서 로컬 PC에서 테스트하고 싶을 때 설치해 두면 편합니다.
   - 지금처럼 로컬에서 확인하고 CI로 검증하는 방식이면 굳이 설치하지 않으셔도 기능상 빠지는 것은 전혀 없습니다!`;
assert.equal(detect(originalFaq), null, 'original Antigravity FAQ must not trigger question card');

// 2. Review case #1: User-directed "무엇인가요?" / "What is your ...?" with short answer candidates -> MUST show buttons
const userOsKo = `사용 중인 운영체제는 무엇인가요?
- Windows
- macOS`;
const rOsKo = detect(userOsKo);
assert.equal(rOsKo?.kind, 'single');
assert.equal(rOsKo.question, '사용 중인 운영체제는 무엇인가요?');
assert.deepEqual(rOsKo.options.map((o) => o.label), ['Windows', 'macOS']);

const userPlatformEn = `What is your target platform?
- Android
- iOS`;
const rPlatEn = detect(userPlatformEn);
assert.equal(rPlatEn?.kind, 'single');
assert.equal(rPlatEn.question, 'What is your target platform?');
assert.deepEqual(rPlatEn.options.map((o) => o.label), ['Android', 'iOS']);

// 3. Review case #2: Explicit A./B. markers with declarative Korean sentences -> MUST show buttons
const letterChoices = `어느 쪽으로 진행할까요?
A. 지금 배포합니다.
B. 다음 배포까지 기다립니다.`;
const rLetter = detect(letterChoices);
assert.equal(rLetter?.kind, 'single');
assert.equal(rLetter.question, '어느 쪽으로 진행할까요?');
assert.deepEqual(rLetter.options.map((o) => o.label), ['지금 배포합니다', '다음 배포까지 기다립니다']);

// 4. Review case #3: Mixed real question + middle FAQ + real question -> exactly 2 questions, NO bleed of FAQ into Q1
const mixedMiddleFaq = `1. 어느 환경에 배포할까요?
- 개발
- 운영
2. 캐시란 무엇인가요?
- 임시 저장소
- 빠른 조회
3. 어느 지역에 배포할까요?
- 서울
- 도쿄`;
const rMixed = detect(mixedMiddleFaq);
assert.equal(rMixed?.kind, 'multi');
assert.equal(rMixed.questions.length, 2);
assert.equal(rMixed.questions[0].question, '어느 환경에 배포할까요?');
assert.deepEqual(rMixed.questions[0].options.map((o) => o.label), ['개발', '운영']);
assert.equal(rMixed.questions[1].question, '어느 지역에 배포할까요?');
assert.deepEqual(rMixed.questions[1].options.map((o) => o.label), ['서울', '도쿄']);

// 5. Review case #4: Markdown heading prefix ("### ") must normalize identically to plain heading
const mdHeadingFaq = `### What is included?
- Offline support
- Cloud sync`;
const plainFaq = `What is included?
- Offline support
- Cloud sync`;
assert.equal(detect(mdHeadingFaq), null, 'markdown-headed FAQ must not trigger buttons');
assert.equal(detect(plainFaq), null, 'plain FAQ must not trigger buttons');

// 6. Standard multi-question prompts (EN & KO) remain intact
const multiEn = `1. Which database should I use?
   - **Postgres** — reliable, needs a server
   - **SQLite** — zero setup, single file
2. **Auth:** which provider?
   a) Google
   b) GitHub`;
const rMultiEn = detect(multiEn);
assert.equal(rMultiEn?.kind, 'multi');
assert.equal(rMultiEn.questions.length, 2);
assert.deepEqual(rMultiEn.questions[0].options.map((o) => o.label), ['Postgres', 'SQLite']);
assert.deepEqual(rMultiEn.questions[1].options.map((o) => o.label), ['Google', 'GitHub']);

const multiKo = `1. 어느 데이터베이스를 쓸까요?
- 안 A: Postgres
- 안 B: SQLite
2. 인증 방식은 어떤 걸 원하시나요?
- Google OAuth
- GitHub OAuth`;
const rMultiKo = detect(multiKo);
assert.equal(rMultiKo?.kind, 'multi');
assert.equal(rMultiKo.questions.length, 2);
assert.deepEqual(rMultiKo.questions[0].options.map((o) => o.label), ['안 A: Postgres', '안 B: SQLite']);
assert.deepEqual(rMultiKo.questions[1].options.map((o) => o.label), ['Google OAuth', 'GitHub OAuth']);

// 7. Tail questions: only trigger when explicitly referring back to the preceding list.
// Note: generic tail questions like "Which database do you prefer?" without a list reference now intentionally
// return null to prevent false positives on status/summary lists (use "Which of these ..." instead).
const explicitTailChoice = `- Postgres
- SQLite

Which of these databases do you prefer?`;
const rTail = detect(explicitTailChoice);
assert.equal(rTail?.kind, 'single');
assert.deepEqual(rTail.options.map((o) => o.label), ['Postgres', 'SQLite']);

assert.equal(detect(`- Postgres\n- SQLite\n\nWhich database do you prefer?`), null, 'generic tail question without list reference must stay null');
assert.equal(detect(`- Fixed login\n- Updated tests\n\nShall I commit?`), null);
assert.equal(detect(`어떻게 진행할까요?\n- 변경 사항을 커밋했습니다.\n- 테스트도 통과했습니다.`), null);
assert.equal(detect(`1. 어느 환경에 배포할까요?\n- 개발\n- 운영\n\`\`\`\nend\n\`\`\``), null);

// 8. Trailing FAQ after a real question must not resurrect stale buttons
const trailingFaq = `1. 어느 환경에 배포할까요?
- 개발
- 운영
2. 캐시란 무엇인가요?
- 임시 저장소
- 빠른 조회`;
assert.equal(detect(trailingFaq), null);

// 9. Re-review contrast cases (PR #125): 4 non-button cases vs 3 button cases
// 9a. Reported "현재 상태" status summary + inline A/B closing question -> null
const reportedStatusReply = `### 현재 상태
- **PR #125**: Ready 전환 및 리뷰 답변 코멘트 등록 완료 (커밋 \`922b314\`)
- **CI**: 5/5 전부 통과 (\`Ubuntu\`, \`macOS\`, \`Windows\`, \`Chromium\` 브라우저 테스트)

Codex 재리뷰를 먼저 보실까요, 아니면 바로 머지할까요?`;
assert.equal(detect(reportedStatusReply), null, 'status report + inline A/B question must not show buttons');

// 9b. Unrelated tail questions ("Which branch..." / "editor?" matching old or\b) -> null
assert.equal(detect(`- 로그인 수정\n- 문서 정리\n\nWhich branch should I deploy?`), null, 'unrelated Which tail question must stay null');
assert.equal(detect(`- 로그인 수정\n- 문서 정리\n\nCan I open the editor?`), null, 'editor? must not match or\\b');

// 9c. Informational "Which platforms are supported?" FAQ vs user-directed "Which platform should I target?"
assert.equal(detect(`### Which platforms are supported?\n- Windows\n- macOS`), null, 'informational Which FAQ must stay null');
const rTarget = detect(`Which platform should I target?\n- Windows\n- macOS`);
assert.equal(rTarget?.kind, 'single');
assert.deepEqual(rTarget.options.map((o) => o.label), ['Windows', 'macOS']);

// 9d. Candidate list + explicit back-referencing tail question -> 2 buttons preserved
const deployCandidates = `### 배포 후보
- 스테이징
- 프로덕션

이 중에서 어느 환경에 배포할까요?`;
const rDeploy = detect(deployCandidates);
assert.equal(rDeploy?.kind, 'single');
assert.equal(rDeploy.question, '이 중에서 어느 환경에 배포할까요?');
assert.deepEqual(rDeploy.options.map((o) => o.label), ['스테이징', '프로덕션']);

// 9e. Question-first list with "CI:" / "문서:" labels -> 2 buttons preserved (no brittle key blacklist)
const changeFirst = `어떤 변경부터 진행할까요?
- CI: 테스트 추가
- 문서: 설치 안내 수정`;
const rChange = detect(changeFirst);
assert.equal(rChange?.kind, 'single');
assert.equal(rChange.question, '어떤 변경부터 진행할까요?');
assert.deepEqual(rChange.options.map((o) => o.label), ['CI: 테스트 추가', '문서: 설치 안내 수정']);

// 10. Strict mode (used for turns where structured ask tooling was already provided to the CLI):
//     plain bullets are ignored, while explicit markers (`A./B.`, `안 A/안 B`) remain supported.
const detectStrict = (text) => {
  const multi = parseQuestions(text, { strict: true });
  if (multi) return { kind: 'multi', questions: multi };
  const single = parseChoices(text, { strict: true });
  if (single) return { kind: 'single', ...single };
  return null;
};
assert.equal(detectStrict(userOsKo), null, 'strict mode must suppress plain-bullet guesses');
assert.equal(detectStrict(deployCandidates), null, 'strict mode must suppress plain-bullet tail guesses');
assert.equal(detectStrict(changeFirst), null, 'strict mode must suppress plain-bullet labeled guesses');
const rStrictLetter = detectStrict(letterChoices);
assert.equal(rStrictLetter?.kind, 'single');
assert.deepEqual(rStrictLetter.options.map((o) => o.label), ['지금 배포합니다', '다음 배포까지 기다립니다']);
const strictKoreanPlan = `어느 안으로 진행할까요?
- 안 A: Postgres
- 안 B: SQLite`;
const rStrictPlan = detectStrict(strictKoreanPlan);
assert.equal(rStrictPlan?.kind, 'single');
assert.deepEqual(rStrictPlan.options.map((o) => o.label), ['안 A: Postgres', '안 B: SQLite']);

console.log('PASS: choice-parser regression suite (FAQ filtering, user prompts, A/B markers, mixed boundaries, tail references, strict mode, markdown headings)');
