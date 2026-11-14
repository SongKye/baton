// Assertions and reporting policy shared by live checks and offline regression tests.
export function requireContract(ok, message) {
  if (!ok) throw Object.assign(new Error(message), { category: 'contract' });
}

export function checkVersion(result, expected) {
  const version = `${result.stdout} ${result.stderr}`.match(/\d+\.\d+\.\d+(?:[-+][\w.-]+)?/)?.[0];
  if (result.code !== 0 || !version || (expected && version !== expected)) {
    throw Object.assign(new Error(`CLI version mismatch: expected ${expected || 'a readable version'}, got ${version || '?'} (exit ${result.code})`), { category: 'environment' });
  }
  return version;
}

export function checkResume(result, sessionId, secret) {
  requireContract(result.sessionId === sessionId, `resume changed session id: ${sessionId} -> ${result.sessionId}`);
  requireContract(result.text.includes(secret), 'resumed session did not recall the value from the previous turn');
}

export function checkTranscript(messages, first, second, secret) {
  const expected = [['user', first], ['assistant', 'BATONSMOKEONE'], ['user', second], ['assistant', secret]];
  let cursor = -1;
  for (const [role, text] of expected) {
    const index = messages.findIndex((m, i) => i > cursor && m.role === role && String(m.text || '').includes(text));
    requireContract(index >= 0, `transcript is missing an ordered ${role} turn: ${text}`);
    cursor = index;
  }
}

export function failureCategory(error) {
  if (error?.category) return error.category;
  if (['NOAUTH', 'EXPIRED'].includes(error?.code)) return 'auth';
  const text = `${error?.code || ''} ${String(error?.message || error)}`;
  if (/\b(401|403)\b|unauthorized|unauthenticated|not logged in|oauth.*expired|invalid.*(?:api.?key|token)|sign.?in required/i.test(text)) return 'auth';
  if (/\b429\b|rate.?limit|quota|usage limit|out of (?:credits|tokens)|limit (?:reached|exceeded)/i.test(text)) return 'quota';
  if (/\b(?:50[0234]|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT)\b|fetch failed|timed? ?out|timeout|no reply within/i.test(text)) return 'network';
  return 'unknown'; // An unclassified failure is not evidence of a CLI regression.
}

export function shouldAttemptFix(test) {
  if (!test.report || test.report.skipped || test.report.version !== test.expectedVersion) return false;
  const failures = test.report.steps.filter((s) => !s.ok);
  return failures.every((s) => s.category === 'contract') && (!test.checkOk || failures.length > 0);
}

export function reportPassed(report, expectedVersion) {
  const required = ['CLI flags', 'new session', 'resume session', 'session list', 'transcript', 'trash and restore', 'plan preserves files', 'file edit', 'command execution', 'everyday work (auto)', 'one-shot', 'model list'];
  if (report?.tool === 'claude') required.push('question and answer');
  if (report?.tool === 'codex' && report.platform !== 'win32') required.push('permission sandbox'); // model-free sandbox probe
  if (['claude', 'codex', 'agy'].includes(report?.tool)) required.push('limits');
  return Boolean(report?.ok && !report.skipped && report.version && (!expectedVersion || report.version === expectedVersion)
    && Array.isArray(report.steps) && report.steps.every((s) => s.ok)
    && required.every((name) => report.steps.some((s) => s.name === name && s.ok)));
}

export function reportMatchesCheckout(report, { revision, platform, arch }) {
  return Boolean(revision && report?.revision === revision && report.dirty === false
    && report.platform === platform && report.arch === arch);
}

export function needsReview(drift) {
  return !drift?.baseline || Boolean(drift.untypedBaseline || drift.removed?.length || drift.changed?.length || drift.missingKinds?.length);
}

const typeOf = (v) => v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v;
const dynamicKey = (k) => /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(k) || (/\d/.test(k) && /[-_.]/.test(k) && k.length > 6) || /^\d+$/.test(k);

export function collectShape(value, kind, paths, types, prefix = '', depth = 0) {
  if (depth > 8 || value === null || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const item of value.slice(0, 50)) collectShape(item, kind, paths, types, `${prefix}[]`, depth + 1);
    return;
  }
  for (const [key, v] of Object.entries(value)) {
    const p = `${prefix ? prefix + '.' : ''}${dynamicKey(key) ? '*' : key}`;
    const full = `${kind} ${p}`;
    paths.add(full);
    types[full] ||= [];
    if (!types[full].includes(typeOf(v))) types[full].push(typeOf(v));
    types[full].sort();
    collectShape(v, kind, paths, types, p, depth + 1);
  }
}

export function compareShapes(base, shapes) {
  if (!base) return { baseline: null, added: [], removed: [], changed: [], missingKinds: [] };
  const now = new Set([...shapes.stream, ...shapes.file]);
  const before = new Set([...(base.stream || []), ...(base.file || [])]);
  const kinds = new Set([...now].map((p) => p.split(' ')[0]));
  const filled = (p) => {
    for (let i = p.indexOf('[]'); i >= 0; i = p.indexOf('[]', i + 2)) {
      if (![...now].some((x) => x.startsWith(p.slice(0, i + 2)))) return false;
    }
    return true;
  };
  return {
    baseline: base.version,
    untypedBaseline: !base.types,
    removed: [...before].filter((p) => !now.has(p) && kinds.has(p.split(' ')[0]) && filled(p)),
    added: [...now].filter((p) => !before.has(p)),
    changed: Object.entries(base.types || {}).filter(([p, old]) => {
      const current = shapes.types?.[p]?.filter((t) => t !== 'null');
      return current?.length && old.some((t) => t !== 'null') && current.some((t) => !old.includes(t));
    }).map(([p, old]) => `${p}: ${old.join('|')} -> ${shapes.types[p].join('|')}`),
    // Absence can be nondeterministic; request review, do not call it a contract failure.
    missingKinds: [...new Set([...before].map((p) => p.split(' ')[0]))].filter((k) => !kinds.has(k)),
  };
}
