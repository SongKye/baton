// Plain-text question & choice detector for CLIs whose question tool does not reach Baton
// (Codex exec, Antigravity -p, etc.).
//
// Two-stage design:
//   1. Segment trailing "(heading + 2..6 option items)" blocks strictly by structural boundaries
//      first, so a filtered-out FAQ block in the middle can never be swallowed as options of
//      an earlier question.
//   2. Evaluate each block with unified heading normalization, considering BOTH the question
//      intent (user-directed / choice prompt vs rhetorical FAQ heading) and the option format
//      (explicit A./B. markers, labeled choices, concise candidates vs declarative sentences).

const OPT_RE = /^([-*•]|\d{1,2}[.)]|[A-Ha-h][.)]|\([A-Ha-h1-9]\))\s+(.+)$/;
const CHOOSE_RE = /골라|고르|선택|어느|중에|중 하나|\b(?:which|choose|pick|select|prefer)\b/i;
// Tail questions (list first, closing question after) must explicitly refer back to the preceding list.
const TAIL_LIST_REF_RE = /(?:이\s*중(?:에|에서)?|위\s*(?:(?:두|세|네|\d+\s*개)\s*)?(?:목록|항목|옵션|후보|방안|안)?\s*중(?:에|에서)?|위(?:의)?\s*(?:목록|항목|옵션|후보|방안)\s*에서|중\s*하나|\bwhich\s+(?:one|option|of\s+(?:these|them|those|the\s+above))\b|\b(?:choose|pick|select)\s+(?:one|from\s+(?:these|the\s+above|above))\b|\bof\s+(?:these|the\s+above)\b)/i;
const USER_ASKED_RE = /할까요|볼까요|좋을까요|원하시|원해|고르|골라|선택|어느|어떻게\s*할|진행할까요|바꿀까요|쓸까요|넣을까요|배포할까요|사용\s*중|쓰고\s*계|쓰시는|원하시는|목표|대상|타깃|타겟|환경은|버전은|이름은|경로는|\b(?:choose|pick|select|prefer|target|should\s+i|shall\s+i|do\s+you|would\s+you)\b|\byour\s+(?:target|platform|os|environment|setup|preference|choice|stack|editor|ide|browser|version|path|branch|region|db|database)\b/i;
const FAQ_KO_RE = /(?:무엇인가요|뭐가\s*좋|뭔가요|인가요|쓰이나요|동작하나요|작동하나요|그런가요|발생하나요|차이인가요|필요한가요|해야\s*하나요|포함되나요|지원하나요|가능한가요)\s*[?？]$/;
const FAQ_EN_RE = /^(?:(?:what|why|where)\s+(?:is|are|does|can|gets?|do)\b|how\s+(?:does|do|it|to)\b|when\s+(?:is|does|to)\b|which\b.*\b(?:is|are|was|were)\b)/i;
const EXPLICIT_MARKER_RE = /^(?:[A-Ha-h][.)]|\([A-Ha-h1-9]\))$/;
const EXPLICIT_OPT_PREFIX_RE = /^(?:안|옵션|방안|선택지|option|choice)\s*[A-Za-z0-9]/i;
const DECL_KO_RE = /(?:입니다|합니다|됩니다|있습니다|없습니다|겠습니다|드립니다|않습니다|못합니다|필요합니다|가능합니다|지원합니다|동작합니다|제공합니다|의미합니다|사용합니다|보여줍니다|해줍니다|했습니다|됐습니다|였습니다|예요|에요|어요|아요|해요|돼요|줘요|네요|군요|죠|이다|한다|된다|있다|없다)[.!?。]?$/;

const stripMd = (x) => String(x || '').replace(/\*\*|__|`/g, '').trim();

/** Normalize a heading line identically across single-question and multi-question paths. */
export function normalizeHeading(line) {
  return stripMd(line)
    .replace(/^#{1,6}\s+/, '')
    .replace(/^(?:Q\s*)?\d{1,2}[.)]\s+|^(?:Q|질문)\s*\d{1,2}\s*[.:)]\s*/i, '')
    .trim();
}

/** True when `line` is a structural block heading boundary (independent of FAQ filtering). */
function isStructuralHeading(line) {
  if (!line) return false;
  if (/^#{1,6}\s+/.test(line)) return true;
  const s = stripMd(line);
  const norm = normalizeHeading(line);
  if (norm.length <= 1 || norm.length > 240) return false;
  if (/[?？]$/.test(s)) return true;
  if (/[:：]$/.test(s) && !/^[-*•]\s+/.test(line)) return true;
  return false;
}

/** True when a normalized heading looks like a rhetorical/informational FAQ rather than a user prompt. */
export function isRhetoricalFaq(heading) {
  const s = normalizeHeading(heading);
  if (USER_ASKED_RE.test(s)) return false;
  if (FAQ_KO_RE.test(s)) return true;
  if (FAQ_EN_RE.test(s)) return true;
  return false;
}

/** Parse one option line while preserving its original list marker (`-`, `1.`, `A.`, etc.). */
function parseOptionLine(line) {
  const m = line.match(OPT_RE);
  if (!m) return null;
  return { marker: m[1], text: m[2] };
}

/** True when an option item has an explicit choice marker (`A.`, `B.`, `(1)`, `안 A`, `Option 1`). */
export function isExplicitChoiceOpt(opt) {
  const marker = typeof opt === 'string' ? '' : (opt.marker || '');
  const raw = typeof opt === 'string' ? opt : (opt.text || '');
  if (EXPLICIT_MARKER_RE.test(marker)) return true;
  const x = stripMd(raw);
  return EXPLICIT_OPT_PREFIX_RE.test(x) || /^[A-Ha-h1-9][.)]\s+/.test(x);
}

/**
 * True when an option item looks like a declarative explanation sentence rather than a choice.
 * Preserves explicit choice markers (`A.`, `B.`, `(1)`, `안 A`, `Option 1`) and `shortLabel — desc` items.
 */
export function isExplanationOpt(opt) {
  if (isExplicitChoiceOpt(opt)) return false;
  const raw = typeof opt === 'string' ? opt : (opt.text || '');
  const x = stripMd(raw);
  const labeled = x.match(/^(.{1,40}?)\s*(?:—|–|:)\s+.+$/);
  if (labeled && !/[.!?。]/.test(labeled[1])) return false;
  if (DECL_KO_RE.test(x)) return true;
  if (x.length > 55 && /[.!?。]$/.test(x)) return true;
  return false;
}

/** "**Postgres** — reliable, needs a server" -> { label: 'Postgres', full: '…' } */
export function choiceOf(opt) {
  const raw = typeof opt === 'string' ? opt : (opt.text || '');
  const x = stripMd(raw);
  const m = x.match(/^(.{1,50}?)\s+(?:—|–|-|:)\s+.+$/);
  return { label: (m ? m[1] : x).replace(/^[A-Ha-h1-9][.)]\s+/, '').replace(/[.。]$/, ''), full: x };
}

/** Validate a normalized heading + its option items together. */
function isValidBlock(heading, opts, { allowColonWithChoose = true, requireListRef = false, strict = false } = {}) {
  if (!heading || heading.length <= 1 || heading.length > 240) return false;
  const endsQ = /[?？]$/.test(heading);
  const endsColon = /[:：]$/.test(heading);
  if (requireListRef) {
    if (!(endsQ || endsColon) || !TAIL_LIST_REF_RE.test(heading)) return false;
  } else if (!endsQ) {
    if (!(allowColonWithChoose && endsColon && CHOOSE_RE.test(heading))) return false;
  }
  if (opts.length < 2 || opts.length > 6) return false;
  if (opts.some((o) => o.text.length > 120)) return false;
  if (isRhetoricalFaq(heading)) return false;
  if (strict && !opts.every(isExplicitChoiceOpt)) return false;
  if (opts.some(isExplanationOpt)) return false;
  return true;
}

/**
 * Stage 1: extract contiguous trailing structural "(heading + 2..6 options)" blocks.
 * Boundaries are determined purely structurally so FAQ headings never leak into adjacent option lists.
 */
function extractTrailingBlocks(lines, { maxTailLines = 2 } = {}) {
  let end = lines.length;
  let tail = 0;
  while (end > 0) {
    const line = lines[end - 1];
    if (!line) { end--; continue; }
    if (OPT_RE.test(line) || isStructuralHeading(line) || tail >= maxTailLines) break;
    tail++;
    end--;
  }
  const blocks = [];
  let i = end;
  for (;;) {
    const opts = [];
    while (i > 0) {
      const line = lines[i - 1];
      if (isStructuralHeading(line)) break;
      const opt = parseOptionLine(line);
      if (!opt) break;
      opts.unshift(opt);
      i--;
    }
    let j = i;
    while (j > 0 && !lines[j - 1]) j--;
    if (opts.length < 2 || opts.length > 6 || !j || !isStructuralHeading(lines[j - 1])) break;
    blocks.unshift({
      rawHeading: lines[j - 1],
      heading: normalizeHeading(lines[j - 1]),
      opts,
    });
    i = j - 1;
    while (i > 0 && !lines[i - 1]) i--;
  }
  return blocks;
}

/**
 * "Question + list of choices" at the end of a reply -> { question, options } for quick-reply buttons.
 * Deliberately strict, so a summary list followed by "shall I commit?" or an FAQ explanation does not turn into buttons.
 */
export function parseChoices(text, { strict = false } = {}) {
  const raw = String(text || '').replace(/\r/g, '');
  if (/```\s*$/.test(raw.trim())) return null;
  const lines = raw.split('\n').map((l) => l.trim());
  while (lines.length && !lines[lines.length - 1]) lines.pop();
  if (!lines.length) return null;

  // Case 1: Options list followed by a closing question that explicitly refers back to the list
  // (e.g. "이 중에서 어느 환경에 배포할까요?", "Which of these databases do you prefer?").
  const last = lines[lines.length - 1];
  if (!OPT_RE.test(last)) {
    let i = lines.length - 1;
    while (i > 0 && !lines[i - 1]) i--;
    const opts = [];
    while (i > 0) {
      const line = lines[i - 1];
      if (isStructuralHeading(line)) break;
      const opt = parseOptionLine(line);
      if (!opt) break;
      opts.unshift(opt);
      i--;
    }
    const tailHeading = normalizeHeading(last);
    if (isValidBlock(tailHeading, opts, { requireListRef: true, strict })) {
      return { question: tailHeading, options: opts.map(choiceOf) };
    }
  }

  // Case 2: Trailing "Heading + Options" block (only check the final block so an ending FAQ never falls back to an older block)
  const blocks = extractTrailingBlocks(lines, { maxTailLines: 0 });
  if (!blocks.length) return null;
  const block = blocks[blocks.length - 1];
  if (!isValidBlock(block.heading, block.opts, { allowColonWithChoose: true, strict })) return null;
  return { question: block.heading, options: block.opts.map(choiceOf) };
}

/**
 * Several "question + choices" blocks at the end of a reply -> [{ question, options }] (2+ questions), else null.
 * Structural block boundaries are resolved first, then each block is validated independently so FAQ blocks
 * in between are dropped cleanly without contaminating neighboring questions.
 */
export function parseQuestions(text, { strict = false } = {}) {
  const raw = String(text || '').replace(/\r/g, '');
  if (/```\s*$/.test(raw.trim())) return null;
  const lines = raw.split('\n').map((l) => l.trim());
  while (lines.length && !lines[lines.length - 1]) lines.pop();
  if (!lines.length) return null;

  const blocks = extractTrailingBlocks(lines, { maxTailLines: 2 });
  const valid = blocks
    .filter((b) => isValidBlock(b.heading, b.opts, { allowColonWithChoose: true, strict }))
    .map((b) => ({ question: b.heading, options: b.opts.map(choiceOf) }));
  return valid.length >= 2 ? valid : null;
}
