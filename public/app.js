// Baton — mobile-first PWA front-end (no build step).
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const app = $('#app');

// ---------------------------------------------------------------- utils
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const TOOL = {
  claude: { name: 'Claude', short: 'C' }, codex: { name: 'Codex', short: 'X' }, agy: { name: 'Antigravity', short: 'A' },
  opencode: { name: 'OpenCode', short: 'O' }, cursor: { name: 'Cursor', short: 'U' },
};
const TOOL_IDS = () => Object.keys(TOOL);
/** Tools installed on this machine (falls back to all while state is loading). */
const INSTALLED = () => { const l = (G.state?.tools || []).filter((x) => x.installed).map((x) => x.id); return l.length ? l : TOOL_IDS(); };
const PERM = {
  plan: { label: t('계획만'), desc: t('읽기만 하고 파일은 바꾸지 않아요') },
  auto: { label: t('자동'), desc: t('안전한 작업은 자동 승인 (Antigravity는 파일 수정만)') },
  full: { label: t('전체 허용'), desc: t('모든 명령과 수정을 승인해요. 주의!') },
};
const STATUS = { active: t('진행중'), paused: t('보류'), done: t('완료'), archived: t('보관') };
const ICON = {
  back: '<svg class="i" viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg>',
  more: '<svg class="i" viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/></svg>',
  bell: '<svg class="i" viewBox="0 0 24 24"><path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/></svg>',
  plus: '<svg class="i" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  send: '<svg class="i" viewBox="0 0 24 24"><path d="M12 19V5M5 12l7-7 7 7"/></svg>',
  stop: '<svg class="i" viewBox="0 0 24 24"><rect x="7" y="7" width="10" height="10" rx="1.5" fill="currentColor" stroke="none"/></svg>',
  search: '<svg class="i" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
  chev: '<svg class="i" viewBox="0 0 24 24" style="width:16px;height:16px"><path d="m9 6 6 6-6 6"/></svg>',
  down: '<svg class="i" viewBox="0 0 24 24" style="width:14px;height:14px"><path d="m6 9 6 6 6-6"/></svg>',
  check: '<svg class="i" viewBox="0 0 24 24"><path d="M5 12l5 5L20 7"/></svg>',
  refresh: '<svg class="i" viewBox="0 0 24 24"><path d="M21 12a9 9 0 1 1-2.6-6.4M21 4v5h-5"/></svg>',
  folder: '<svg class="i" viewBox="0 0 24 24" style="width:17px;height:17px"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
  pin: '📌',
  image: '<svg class="i" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 9"/></svg>',
  x: '<svg class="i" viewBox="0 0 24 24" style="width:14px;height:14px"><path d="M6 6l12 12M18 6L6 18"/></svg>',
};

function ago(ts) {
  if (!ts) return '';
  const s = (Date.now() - ts) / 1000;
  if (s < 60) return t('방금');
  if (s < 3600) return t('{n}분 전', { n: Math.floor(s / 60) });
  if (s < 86400) return t('{n}시간 전', { n: Math.floor(s / 3600) });
  const d = Math.floor(s / 86400);
  if (d === 1) return t('어제');
  if (d < 7) return t('{n}일 전', { n: d });
  if (d < 30) return t('{n}주 전', { n: Math.floor(d / 7) });
  if (d < 365) return t('{n}개월 전', { n: Math.floor(d / 30) });
  return t('{n}년 전', { n: Math.floor(d / 365) });
}
function idleClass(days) { return days < 3 ? 'fresh' : days < 14 ? 'warm' : 'cold'; }
function idleText(days) { return days === 0 ? t('오늘') : days === 1 ? t('어제') : t('{n}일째 쉼', { n: days }); }
function shortPath(p) { return String(p || '').replace(/^\/home\/[^/]+/, '~'); }
function projectName(p) { const b = String(p || '').split('/').filter(Boolean).pop() || '~'; return b.replace(/^\d{6}[_-]/, ''); }
function fmtDur(ms) { const s = Math.floor(ms / 1000); return s < 60 ? t('{s}초', { s }) : t('{m}분 {s}초', { m: Math.floor(s / 60), s: s % 60 }); }

const md = (text) => {
  try {
    const html = window.marked.parse(String(text || ''), { breaks: true, gfm: true });
    return window.DOMPurify.sanitize(html, { ADD_ATTR: ['target'] });
  } catch { return esc(text); }
};

const store = {
  get(k, d) { try { const v = localStorage.getItem('baton:' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('baton:' + k, JSON.stringify(v)); } catch { /* private mode */ } },
};

async function api(path, opts = {}) {
  const init = { method: opts.method || (opts.body ? 'POST' : 'GET'), headers: {} };
  if (opts.body !== undefined) { init.headers['content-type'] = 'application/json'; init.body = JSON.stringify(opts.body); }
  const r = await fetch(path, init);
  let j = null;
  try { j = await r.json(); } catch { /* empty */ }
  if (!r.ok) { const e = new Error(j?.error || t('요청 실패 ({code})', { code: r.status })); e.data = j; e.status = r.status; throw e; }
  return j;
}

function toast(msg, err = false) {
  const el = document.createElement('div');
  el.className = 'toast' + (err ? ' err' : '');
  el.textContent = msg;
  $('#toasts').append(el);
  setTimeout(() => { el.style.transition = 'opacity .3s'; el.style.opacity = '0'; setTimeout(() => el.remove(), 300); }, err ? 4200 : 2400);
}

// ---------------------------------------------------------------- bottom sheets
function sheet({ title, body, footer, onMount }) {
  return new Promise((resolve) => {
    const scrim = document.createElement('div'); scrim.className = 'scrim';
    const el = document.createElement('div'); el.className = 'sheet';
    el.innerHTML = `<div class="grab"></div>${title ? `<div class="sh">${esc(title)}</div>` : ''}<div class="sb">${body || ''}</div>${footer ? `<div class="sf">${footer}</div>` : ''}`;
    document.body.append(scrim, el);
    requestAnimationFrame(() => { scrim.classList.add('show'); el.classList.add('show'); });
    let done = false;
    const close = (v) => {
      if (done) return; done = true;
      scrim.classList.remove('show'); el.classList.remove('show');
      setTimeout(() => { scrim.remove(); el.remove(); }, 250);
      resolve(v);
    };
    scrim.onclick = () => close(undefined);
    // swipe down to dismiss
    let y0 = null;
    el.addEventListener('touchstart', (e) => { if (el.querySelector('.sb').scrollTop <= 0) y0 = e.touches[0].clientY; }, { passive: true });
    el.addEventListener('touchmove', (e) => { if (y0 != null) { const dy = e.touches[0].clientY - y0; if (dy > 0) el.style.transform = `translateY(${dy}px)`; } }, { passive: true });
    el.addEventListener('touchend', (e) => { if (y0 != null) { const dy = e.changedTouches[0].clientY - y0; el.style.transform = ''; if (dy > 90) close(undefined); } y0 = null; });
    onMount?.(el, close);
  });
}
function pick(title, options, current) {
  const body = options.map((o, i) => `<button class="opt-row ${o.danger ? 'danger' : ''}" data-i="${i}"><div class="l"><b>${esc(o.label)}</b>${o.desc ? `<span>${esc(o.desc)}</span>` : ''}</div>${current !== undefined && o.value === current ? `<span class="check">${ICON.check}</span>` : ''}</button>`).join('');
  return sheet({ title, body, onMount: (el, close) => $$('.opt-row', el).forEach((b) => (b.onclick = () => close(options[+b.dataset.i].value))) });
}
function promptSheet(title, value = '', { multiline = false, placeholder = '' } = {}) {
  const field = multiline ? `<textarea placeholder="${esc(placeholder)}">${esc(value)}</textarea>` : `<input type="text" value="${esc(value)}" placeholder="${esc(placeholder)}">`;
  return sheet({
    title, body: `<div style="padding:0 8px">${field}</div>`, footer: `<button class="btn ghost" data-x>${t('취소')}</button><button class="btn primary" data-ok>${t('저장')}</button>`,
    onMount: (el, close) => {
      const f = $('input,textarea', el); setTimeout(() => f.focus(), 250);
      $('[data-x]', el).onclick = () => close(undefined);
      $('[data-ok]', el).onclick = () => close(f.value);
      f.onkeydown = (e) => { if (e.key === 'Enter' && !multiline) close(f.value); };
    },
  });
}

// ---------------------------------------------------------------- global state
const G = { state: null, runs: [], lastRunIds: new Set(), cleanup: null, skipHash: null };

async function loadState() {
  try {
    G.state = await api('/api/state');
    for (const x of G.state.tools || []) if (TOOL[x.id]) TOOL[x.id].installed = x.installed;
    updateRunPill(G.state.runs);
  } catch (e) { /* offline */ }
}

function updateRunPill(runs) {
  const prev = G.lastRunIds;
  const nowIds = new Set(runs.map((r) => r.id));
  // A run disappeared from "running" -> it finished; tell the user if they're elsewhere.
  for (const id of prev) {
    if (!nowIds.has(id)) {
      const r = G.runs.find((x) => x.id === id);
      if (r && !(location.hash.includes(encodeURIComponent(r.sessionId || '__')))) toast(`${t('✅ 응답 완료:')} ${r.title || r.prompt || ''}`.slice(0, 60));
    }
  }
  G.lastRunIds = nowIds;
  G.runs = runs;
  let pill = $('#runpill');
  if (!runs.length) { pill?.remove(); return; }
  if (!pill) { pill = document.createElement('a'); pill.id = 'runpill'; pill.className = 'runpill'; document.body.append(pill); }
  const r = runs[0];
  pill.href = r.sessionId ? `#/s/${r.tool}/${encodeURIComponent(r.sessionId)}` : '#/';
  pill.innerHTML = `<div class="spinner"></div><span>${runs.length > 1 ? t('{n}개 응답 중', { n: runs.length }) : esc(r.title || r.prompt || t('응답 중'))}</span>`;
}

setInterval(() => { if (document.visibilityState === 'visible') loadState(); }, 5000);

// ---------------------------------------------------------------- router
const routes = [
  [/^#?\/?$/, viewHome, 'home'],
  [/^#\/projects$/, viewProjects, 'projects'],
  [/^#\/p\/(.+)$/, viewProject, 'projects'],
  [/^#\/sessions$/, viewSessions, 'sessions'],
  [/^#\/s\/([a-z]+)\/(.+)$/, viewChat, null],
  [/^#\/setup$/, viewSetup, 'settings'],
  [/^#\/new$/, viewNew, null],
  [/^#\/settings$/, viewSettings, 'settings'],
  [/^#\/inbox$/, viewInbox, 'home'],
  [/^#\/usage$/, viewUsage, 'tools'],
  [/^#\/tools$/, viewTools, 'tools'],
  [/^#\/ports$/, viewPorts, 'tools'],
  [/^#\/skills$/, viewSkills, 'tools'],
  [/^#\/skill\/(.+)$/, viewSkill, 'tools'],
  [/^#\/cleanup$/, viewCleanup, 'tools'],
  [/^#\/trash$/, viewTrash, 'tools'],
];

async function render() {
  const raw = location.hash || '#/';
  if (G.skipHash && G.skipHash === raw) { G.skipHash = null; return; }
  const [hash, qs] = raw.split('?');
  const params = new URLSearchParams(qs || '');
  if (G.cleanup) { try { G.cleanup(); } catch { /* ignore */ } G.cleanup = null; }
  G.navCount = (G.navCount || 0) + 1;
  for (const [re, fn, tab] of routes) {
    const m = hash.match(re);
    if (!m) continue;
    document.body.classList.toggle('chat-mode', tab === null);
    $$('#tabbar a').forEach((a) => a.classList.toggle('on', a.dataset.tab === tab));
    window.scrollTo(0, 0);
    try { await fn(m.slice(1).map(decodeURIComponent), params); }
    catch (e) { console.error(e); app.innerHTML = `<div class="empty" style="padding-top:30vh"><b>${t('불러오지 못했어요')}</b>${esc(e.message)}<br><br><button class="btn" onclick="location.reload()">${t('다시 시도')}</button></div>`; }
    return;
  }
  location.hash = '#/';
}
window.addEventListener('hashchange', render);

function shell({ title, sub = '', right = '', fab = true }) {
  const unread = G.state?.unread || 0;
  app.innerHTML = `
    <header class="topbar">
      <div style="flex:1;min-width:0"><h1>${title}</h1>${sub ? `<div class="sub">${sub}</div>` : ''}</div>
      ${right}
      <a class="icon-btn" href="#/inbox" aria-label="${t('알림')}">${ICON.bell}${unread ? `<span class="badge-dot">${unread > 9 ? '9+' : unread}</span>` : ''}</a>
    </header>
    <main class="view" id="view"></main>
    ${fab ? `<a class="fab" href="#/new">${ICON.plus}${t('새 세션')}</a>` : ''}`;
  return $('#view');
}

// ---------------------------------------------------------------- shared row renderers
function sessionRow(s, { showProject = true } = {}) {
  const flags = [];
  if (s.running) flags.push(`<span class="flag run">${t('응답 중')}</span>`);
  else if (s.terminal) flags.push(`<span class="flag warn">${s.terminal === 'busy' ? t('PC에서 작업 중') : t('PC에서 열림')}</span>`);
  if (s.automated) flags.push(`<span class="flag">${t('자동')}</span>`);
  if (s.notify) flags.push('<span class="flag bell">🔔</span>');
  const preview = s.lastReply || s.lastPrompt || s.firstPrompt || '';
  return `<a class="srow" href="#/s/${s.tool}/${encodeURIComponent(s.id)}">
    <div class="tool-avatar ${s.tool}">${TOOL[s.tool].short}${s.live ? `<i class="live-dot ${s.running || s.terminal === 'busy' ? 'busy' : ''}"></i>` : ''}</div>
    <div class="body">
      <div class="t">${s.pinned ? '<span>📌</span>' : ''}<span class="tt">${esc(s.title)}</span>${s.unseen ? '<i class="unseen"></i>' : ''}</div>
      <div class="m"><span>${TOOL[s.tool].name}</span>${showProject && s.project ? `<span>· ${esc(projectName(s.project))}</span>` : ''}<span>· ${ago(s.updated)}</span>${flags.join('')}</div>
      ${preview ? `<div class="p">${esc(preview)}</div>` : ''}
    </div></a>`;
}
function toolDots(tools) { return `<span class="tooldots">${Object.keys(tools || {}).map((t) => `<i class="${t}"></i>`).join('')}</span>`; }
function projectRow(p) {
  const line = p.brief?.oneLiner || p.lastSession?.title || '';
  return `<a class="card prow" href="#/p/${encodeURIComponent(p.id)}">
    <div class="top"><span class="name">${p.pinned ? '📌 ' : ''}${esc(p.name)}</span>${p.status !== 'active' ? `<span class="status-chip ${p.status}">${STATUS[p.status]}</span>` : ''}${p.live ? '<i class="live-dot"></i>' : ''}<span class="idle ${idleClass(p.idleDays)}">${idleText(p.idleDays)}</span></div>
    ${line ? `<div class="line">${esc(line)}</div>` : ''}
    ${p.brief?.progress != null ? `<div class="progress"><i style="width:${p.brief.progress}%"></i></div>` : ''}
    <div class="meta">${toolDots(p.tools)}<span>${t('세션 {n}', { n: p.sessions })}${p.autoSessions ? ` · ${t('자동 {n}', { n: p.autoSessions })}` : ''}</span><span class="path">${esc(p.path)}</span></div>
  </a>`;
}
function dozeCard(p) {
  const next = p.brief?.next?.title;
  return `<div class="card doze">
    <div class="top"><span class="name">${esc(p.name)}</span><span class="days ${p.idleDays > 21 ? 'old' : ''}">💤 ${t('{n}일', { n: p.idleDays })}</span></div>
    <div class="next">${next ? `${t('다음 할 일:')} <b>${esc(next)}</b>` : esc(p.brief?.oneLiner || p.lastSession?.title || t('최근 기록을 정리해볼까요?'))}</div>
    <div class="acts">
      <a class="btn sm primary" href="#/p/${encodeURIComponent(p.id)}">${t('이어하기')}</a>
      <button class="btn sm" data-snooze="${esc(p.id)}">${t('나중에')}</button>
    </div></div>`;
}
async function snoozeFlow(id, after) {
  const v = await pick(t('이 프로젝트를 어떻게 할까요?'), [
    { value: 3, label: t('3일 뒤에 다시 알려줘') },
    { value: 14, label: t('2주 동안 보류') },
    { value: 'paused', label: t('보류 (알림 끄기)'), desc: t('프로젝트 목록 「보류」에서 다시 꺼낼 수 있어요') },
    { value: 'done', label: t('완료했어요 🎉') },
    { value: 'archived', label: t('그만둘래요 (보관)') },
  ]);
  if (v === undefined) return;
  const body = typeof v === 'number' ? { snoozeDays: v } : { status: v };
  await api(`/api/projects/${encodeURIComponent(id)}/meta`, { body });
  toast(typeof v === 'number' ? t('{n}일 뒤에 다시 알려드릴게요', { n: v }) : t('「{s}」로 옮겼어요', { s: STATUS[v] }));
  after?.();
}

// ---------------------------------------------------------------- HOME
async function viewHome() {
  const hour = new Date().getHours();
  const greet = hour < 6 ? t('늦은 밤이에요 🌙') : hour < 12 ? t('좋은 아침이에요 ☀️') : hour < 18 ? t('오후도 힘내요 🏃') : t('오늘 하루 수고했어요 🌆');
  const v = shell({ title: 'Baton', sub: greet });
  v.innerHTML = '<div class="section"><div class="skeleton" style="height:70px"></div></div><div class="section"><div class="skeleton" style="height:200px"></div></div>';
  const d = await api('/api/home');
  const badge = $('#doze-badge'); badge.hidden = !d.dozing.length; badge.textContent = d.dozing.length;
  const parts = [];
  parts.push(`<div class="stats">
    <div class="card stat"><div class="v">${d.stats.week}</div><div class="l">${t('이번 주 세션')}</div></div>
    <div class="card stat"><div class="v">${d.stats.weekProjects}</div><div class="l">${t('이번 주 프로젝트')}</div></div>
    <div class="card stat"><div class="v">${d.dozing.length}</div><div class="l">${t('잠자는 프로젝트')}</div></div>
  </div>`);
  parts.push('<div class="section" id="home-usage"><div class="skeleton" style="height:84px"></div></div>');
  if (d.live.length) {
    parts.push(`<div class="section"><div class="section-h"><h2>${t('지금 진행 중')}</h2><span class="count">${d.live.length}</span></div>
      <div class="card list">${d.live.map((s) => sessionRow(s)).join('')}</div></div>`);
  }
  if (d.pinned.length) {
    parts.push(`<div class="section"><div class="section-h"><h2>${t('📌 고정')}</h2></div><div class="card list">${d.pinned.map((s) => sessionRow(s)).join('')}</div></div>`);
  }
  parts.push(`<div class="section"><div class="section-h"><h2>${t('이어서 하기')}</h2><a class="more" href="#/sessions">${t('전체 보기')}</a></div>
    ${d.recent.length ? `<div class="card list">${d.recent.slice(0, 6).map((s) => sessionRow(s)).join('')}</div>` : `<div class="card empty"><b>${t('아직 세션이 없어요')}</b>${t('오른쪽 아래 「새 세션」으로 시작해보세요')}</div>`}</div>`);
  if (d.dozing.length) {
    parts.push(`<div class="section"><div class="section-h"><h2>${t('잠자는 프로젝트 💤')}</h2><span class="count">${d.dozing.length}</span><a class="more" href="#/projects?f=dozing">${t('모두')}</a></div>
      <div class="hscroll">${d.dozing.map(dozeCard).join('')}</div></div>`);
  }
  if (d.activeProjects.length) {
    parts.push(`<div class="section"><div class="section-h"><h2>${t('최근 프로젝트')}</h2><a class="more" href="#/projects">${t('전체')}</a></div>
      <div class="list">${d.activeProjects.slice(0, 4).map(projectRow).join('')}</div></div>`);
  }
  v.innerHTML = parts.join('');
  $$('[data-snooze]', v).forEach((b) => (b.onclick = () => snoozeFlow(b.dataset.snooze, () => render())));
  homeUsageCard();
}

// ---------------------------------------------------------------- PROJECTS
async function viewProjects(_, params) {
  const v = shell({ title: t('프로젝트') });
  let filter = params.get('f') || store.get('pfilter', 'active');
  v.innerHTML = '<div class="skeleton" style="height:300px;margin-top:10px"></div>';
  const d = await api('/api/projects');
  const dozing = new Set(d.dozing);
  const counts = { active: 0, dozing: dozing.size, paused: 0, done: 0, archived: 0, all: d.items.length };
  for (const p of d.items) counts[p.status] = (counts[p.status] || 0) + 1;
  const draw = () => {
    store.set('pfilter', filter);
    const items = d.items.filter((p) => filter === 'all' || (filter === 'dozing' ? dozing.has(p.id) : p.status === filter));
    const labels = { active: t('진행중'), dozing: t('💤 잠자는'), paused: t('보류'), done: t('완료'), archived: t('보관'), all: t('전체') };
    v.innerHTML = `<div class="chips" style="margin-bottom:12px">${Object.keys(labels).map((k) => `<button class="chip ${k === filter ? 'on' : ''}" data-f="${k}">${labels[k]} <span class="n">${counts[k] || 0}</span></button>`).join('')}</div>
      ${filter === 'dozing' ? `<div class="banner" style="margin-bottom:10px">${t('한동안 손대지 않은 프로젝트예요. 이어서 할지, 보류할지 정리해두면 머리가 가벼워져요.')}</div>` : ''}
      <div class="list">${items.map(projectRow).join('') || `<div class="empty"><b>${t('비어 있어요')}</b></div>`}</div>`;
    $$('[data-f]', v).forEach((b) => (b.onclick = () => { filter = b.dataset.f; draw(); }));
  };
  draw();
}

async function viewProject([id]) {
  const v = shell({ title: '…', fab: false });
  const head = $('.topbar');
  head.insertAdjacentHTML('afterbegin', `<a class="icon-btn" href="#/projects" style="margin-left:-10px">${ICON.back}</a>`);
  v.innerHTML = '<div class="skeleton" style="height:160px;margin-top:10px"></div>';
  let showAuto = false;
  const load = async () => {
    const d = await api(`/api/projects/${encodeURIComponent(id)}${showAuto ? '?automated=1' : ''}`);
    const p = d.project;
    $('.topbar h1').textContent = p.name;
    $('.topbar h1').insertAdjacentHTML('afterend', `<div class="sub">${esc(p.path)}</div>`);
    head.querySelector('.icon-btn[href="#/inbox"]').outerHTML = `<button class="icon-btn" id="pmore">${ICON.more}</button>`;
    const human = d.sessions.filter((s) => !s.automated);
    const latest = human[0] || d.sessions[0];
    const b = d.brief;
    const briefHtml = b ? `
      <div class="card brief">
        ${d.briefStale ? `<div class="banner warn">${t('브리핑 이후 새 활동이 있어요')} <button class="btn sm" data-brief="1">${t('업데이트')}</button></div>` : ''}
        ${b.what ? `<div class="what">${esc(b.what)}</div>` : ''}
        <div class="one">${esc(b.oneLiner)}</div>
        ${b.progress != null ? `<div class="phase"><span>${esc(b.phase || '')}</span><div class="progress"><i style="width:${b.progress}%"></i></div><span>${b.progress}%</span></div>` : ''}
        ${b.next?.length ? `<div><h3>${t('다음 할 일')}</h3>${b.next.map((n, i) => `
          <div class="next-item"><div class="nt"><span class="num">${i + 1}</span><span>${esc(n.title)}</span></div>
            ${n.why ? `<div class="why">${esc(n.why)}</div>` : ''}
            ${n.prompt ? `<div class="np">${esc(n.prompt)}</div>` : ''}
            <div style="display:flex;gap:6px"><button class="btn sm primary" data-go="${i}">${t('▶ 이 내용으로 이어가기')}</button></div>
          </div>`).join('')}</div>` : ''}
        ${b.lastDone?.length ? `<div><h3>${t('최근에 한 일')}</h3><ul>${b.lastDone.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}
        ${b.openQuestions?.length ? `<div><h3>${t('결정이 필요한 것')}</h3><ul>${b.openQuestions.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}
        ${b.resumeTip ? `<div class="tip">💡 ${esc(b.resumeTip)}</div>` : ''}
        <div class="small muted" style="display:flex;align-items:center;gap:8px">${t('AI 브리핑')} · ${ago(b.created)} <button class="btn sm ghost" style="margin-left:auto" data-brief="force">${t('다시 정리')}</button></div>
      </div>` : `
      <div class="card brief" style="align-items:flex-start">
        <div class="one">${t('어디까지 했더라? 🤔')}</div>
        <div class="muted small">${t('최근 세션 대화·git 기록·문서를 읽고, 한 일과 다음 할 일을 정리해드려요. (20초 정도 걸려요)')}</div>
        <button class="btn primary" data-brief="1">${t('AI로 정리하기')}</button>
      </div>`;
    const git = d.git;
    const gitHtml = git ? `<div class="section"><div class="section-h"><h2>Git</h2><span class="count">${esc(git.branch || '')}${git.dirty ? ` · ${t('미커밋 {n}개', { n: git.dirty })}` : ''}</span></div>
      <div class="card" style="padding:6px 14px">${git.commits.slice(0, 6).map((c) => `<div class="commit"><span class="h">${esc(c.hash)}</span><span class="s">${esc(c.subject)}</span><span class="d">${ago(c.ts)}</span></div>`).join('') || `<div class="muted small" style="padding:8px 0">${t('커밋이 아직 없어요')}</div>`}</div></div>` : '';
    v.innerHTML = `
      <div class="section" style="margin-top:8px">
        <div class="seg" id="pstatus">${Object.entries(STATUS).map(([k, l]) => `<button class="${p.status === k ? 'on' : ''}" data-st="${k}">${l}</button>`).join('')}</div>
        ${p.snoozeUntil && p.snoozeUntil > Date.now() ? `<div class="banner" style="margin-top:8px">⏰ ${t('{date}까지 알림을 쉬어요', { date: new Date(p.snoozeUntil).toLocaleDateString(LOCALE) })}</div>` : ''}
      </div>
      <div class="section" id="briefbox">${d.briefPending ? `<div class="card brief"><div class="phase"><div class="spinner"></div>${t('정리하는 중이에요…')}</div></div>` : briefHtml}</div>
      ${p.note ? `<div class="section"><div class="section-h"><h2>${t('메모')}</h2></div><div class="card" style="padding:12px 14px;white-space:pre-wrap;font-size:14px">${esc(p.note)}</div></div>` : ''}
      <div class="section"><div class="section-h"><h2>${t('세션')}</h2><span class="count">${human.length}${p.autoSessions ? ` · ${t('자동 {n}', { n: p.autoSessions })}` : ''}</span>
        <button class="more" id="autotoggle">${showAuto ? t('자동 실행 숨기기') : (p.autoSessions ? t('자동 실행 보기') : '')}</button></div>
        <div class="card list">${d.sessions.slice(0, 40).map((s) => sessionRow(s, { showProject: false })).join('') || `<div class="empty">${t('세션이 없어요')}</div>`}</div>
        <div style="display:flex;gap:8px;margin-top:10px">
          ${latest ? `<a class="btn block" href="#/s/${latest.tool}/${encodeURIComponent(latest.id)}">${t('최근 세션 열기')}</a>` : ''}
          <a class="btn block primary" href="#/new?cwd=${encodeURIComponent(p.path)}">${t('새 세션')}</a>
        </div>
      </div>
      ${gitHtml}`;
    $$('[data-st]', v).forEach((btn) => (btn.onclick = async () => {
      await api(`/api/projects/${encodeURIComponent(id)}/meta`, { body: { status: btn.dataset.st, snoozeDays: 0 } });
      toast(t('「{s}」로 바꿨어요', { s: STATUS[btn.dataset.st] })); load();
    }));
    $$('[data-brief]', v).forEach((btn) => (btn.onclick = async () => {
      $('#briefbox').innerHTML = `<div class="card brief"><div class="phase"><div class="spinner"></div>${t('세션 기록과 git을 읽고 정리하는 중이에요… (20초 정도)')}</div></div>`;
      try { await api(`/api/projects/${encodeURIComponent(id)}/brief${btn.dataset.brief === 'force' ? '?force=1' : ''}`, { method: 'POST' }); }
      catch (e) { toast(e.message, true); }
      load();
    }));
    $$('[data-go]', v).forEach((btn) => (btn.onclick = async () => {
      const n = b.next[+btn.dataset.go];
      const opts = [];
      if (latest) opts.push({ value: 'latest', label: `${t('최근 세션에서 이어가기')}`, desc: `${TOOL[latest.tool].name} · ${latest.title}` });
      for (const id of INSTALLED()) opts.push({ value: id, label: t('새 {name} 세션', { name: TOOL[id].name }) });
      const where = await pick(t('어디서 이어갈까요?'), opts);
      if (!where) return;
      const text = n.prompt || n.title;
      if (where === 'latest') { sessionStorage.setItem(`draft:${latest.tool}:${latest.id}`, text); location.hash = `#/s/${latest.tool}/${encodeURIComponent(latest.id)}`; }
      else { sessionStorage.setItem('draft:new', text); location.hash = `#/new?cwd=${encodeURIComponent(p.path)}&tool=${where}`; }
    }));
    $('#autotoggle').onclick = () => { showAuto = !showAuto; load(); };
    $('#pmore').onclick = async () => {
      const act = await pick(p.name, [
        { value: 'pin', label: p.pinned ? t('고정 해제') : t('📌 상단 고정') },
        { value: 'rename', label: t('이름 바꾸기') },
        { value: 'note', label: t('메모 남기기'), desc: t('다음에 돌아왔을 때 볼 메모') },
        { value: 'snooze', label: t('알림 미루기 / 상태 정리') },
      ]);
      if (act === 'pin') await api(`/api/projects/${encodeURIComponent(id)}/meta`, { body: { pinned: !p.pinned } });
      else if (act === 'rename') { const n = await promptSheet(t('프로젝트 이름'), p.name); if (n !== undefined) await api(`/api/projects/${encodeURIComponent(id)}/meta`, { body: { name: n } }); }
      else if (act === 'note') { const n = await promptSheet(t('메모'), p.note || '', { multiline: true, placeholder: t('예) 결제 붙이기 전에 약관 먼저 정리') }); if (n !== undefined) await api(`/api/projects/${encodeURIComponent(id)}/meta`, { body: { note: n } }); }
      else if (act === 'snooze') return snoozeFlow(id, load);
      else return;
      load();
    };
    // If a brief is generating in the background, poll until done.
    if (d.briefPending) setTimeout(load, 4000);
  };
  await load();
}

// ---------------------------------------------------------------- SESSIONS
async function viewSessions() {
  const v = shell({ title: t('세션'), right: `<button class="btn sm ghost" id="selbtn">${t('선택')}</button>` });
  let selecting = false;
  const sel = new Set();
  const f = store.get('sfilter', { tool: '', automated: false, hidden: false });
  let q = sessionStorage.getItem('sq') || '';
  let offset = 0, items = [], total = 0;
  v.innerHTML = `
    <label class="search">${ICON.search}<input id="sq" type="search" placeholder="${t('제목·대화 내용·폴더 검색')}" value="${esc(q)}" autocomplete="off"></label>
    <div class="chips" id="sf"></div>
    <div id="slist" style="margin-top:12px"></div>
    <div class="bulkbar" id="sbar" hidden><button class="btn sm ghost" id="sall">${t('전체 선택')}</button><span>${t('{n}개 선택', { n: '<b id="scount">0</b>' })}</span><button class="btn primary danger-fill" id="strash">${t('휴지통으로')}</button></div>`;
  const drawChips = () => {
    $('#sf').innerHTML = [['', t('전체')], ['claude', 'Claude'], ['codex', 'Codex'], ['agy', 'Antigravity']]
      .map(([k, l]) => `<button class="chip ${f.tool === k ? 'on' : ''}" data-tool="${k}">${l}</button>`).join('')
      + `<button class="chip ${f.automated ? 'on' : ''}" data-tg="automated">${t('자동 실행 포함')}</button><button class="chip ${f.hidden ? 'on' : ''}" data-tg="hidden">${t('숨긴 세션')}</button><a class="chip" href="#/cleanup">${t('🧹 정리하기')}</a>`;
    $$('[data-tool]', v).forEach((b) => (b.onclick = () => { f.tool = b.dataset.tool; reload(); }));
    $$('[data-tg]', v).forEach((b) => (b.onclick = () => { f[b.dataset.tg] = !f[b.dataset.tg]; reload(); }));
  };
  const fetchPage = async () => {
    const sp = new URLSearchParams({ offset, limit: 50 });
    if (q) sp.set('q', q);
    if (f.tool) sp.set('tool', f.tool);
    if (f.automated) sp.set('automated', '1');
    if (f.hidden) sp.set('hidden', '1');
    const d = await api('/api/sessions?' + sp);
    total = d.total; items = offset ? items.concat(d.items) : d.items;
  };
  const draw = () => {
    $('#slist').innerHTML = items.length
      ? `<div class="small muted" style="margin:0 2px 8px">${t('{n}개', { n: total })}</div><div class="card list">${items.map((s) => (selecting ? selRow(s) : sessionRow(s))).join('')}</div>
         ${items.length < total ? `<button class="btn block ghost" id="smore" style="margin-top:10px">${t('더 보기')}</button>` : ''}`
      : `<div class="empty"><b>${q ? t('검색 결과가 없어요') : t('세션이 없어요')}</b>${f.automated ? '' : t('자동 실행 세션은 「자동 실행 포함」을 켜면 보여요')}</div>`;
    const more = $('#smore'); if (more) more.onclick = async () => { offset += 50; await fetchPage(); draw(); };
    if (!selecting) attachLongPress($('#slist'));
    $$('[data-k]', v).forEach((c) => (c.onchange = () => { c.checked ? sel.add(c.dataset.k) : sel.delete(c.dataset.k); drawBar(); }));
    drawBar();
  };
  const selRow = (s) => `<label class="srow ckrow"><input type="checkbox" data-k="${esc(s.key)}" ${sel.has(s.key) ? 'checked' : ''} ${s.live ? 'disabled' : ''}>
    <div class="body"><div class="t"><span class="tt">${esc(s.title)}</span></div><div class="m"><span class="tool-badge ${s.tool}">${TOOL[s.tool].name}</span><span>${esc(projectName(s.project || s.cwd))}</span><span>· ${ago(s.updated)}</span>${s.live ? `<span class="flag warn">${t('실행 중')}</span>` : ''}</div></div></label>`;
  const drawBar = () => { $('#sbar').hidden = !selecting; $('#scount').textContent = sel.size; $('#strash').disabled = !sel.size; };
  $('#selbtn').onclick = () => { selecting = !selecting; sel.clear(); $('#selbtn').textContent = selecting ? t('완료') : t('선택'); document.body.classList.toggle('selecting', selecting); draw(); };
  $('#sall').onclick = () => { const all = items.filter((s) => !s.live).every((s) => sel.has(s.key)); for (const s of items) if (!s.live) all ? sel.delete(s.key) : sel.add(s.key); draw(); };
  $('#strash').onclick = async () => {
    const keys = [...sel];
    const ok = await pick(t('{n}개 세션을 휴지통으로 옮길까요?', { n: keys.length }), [{ value: true, label: t('옮기기'), desc: t('30일 안에는 휴지통에서 되살릴 수 있어요'), danger: true }, { value: false, label: t('취소') }]);
    if (!ok) return;
    const r = await api('/api/sessions/trash', { body: { keys } });
    toast(t('{n}개를 휴지통으로 옮겼어요', { n: r.moved }));
    sel.clear(); await reload();
  };
  G.cleanup = () => document.body.classList.remove('selecting');
  const reload = async () => { store.set('sfilter', f); drawChips(); offset = 0; await fetchPage(); draw(); };
  let t;
  $('#sq').oninput = (e) => { clearTimeout(t); t = setTimeout(() => { q = e.target.value.trim(); sessionStorage.setItem('sq', q); reload(); }, 220); };
  await reload();
}

function attachLongPress(root) {
  let timer = null, fired = false;
  root.addEventListener('touchstart', (e) => {
    const a = e.target.closest('a.srow'); if (!a) return;
    fired = false;
    timer = setTimeout(() => { fired = true; navigator.vibrate?.(10); sessionMenuFromHref(a.getAttribute('href')); }, 480);
  }, { passive: true });
  ['touchend', 'touchmove', 'touchcancel'].forEach((ev) => root.addEventListener(ev, () => clearTimeout(timer), { passive: true }));
  root.addEventListener('click', (e) => { if (fired) { e.preventDefault(); fired = false; } }, true);
  root.addEventListener('contextmenu', (e) => { const a = e.target.closest('a.srow'); if (a) { e.preventDefault(); sessionMenuFromHref(a.getAttribute('href')); } });
}
async function sessionMenuFromHref(href) {
  const m = href.match(/#\/s\/(\w+)\/(.+)$/); if (!m) return;
  const tool = m[1], id = decodeURIComponent(m[2]);
  const d = await api(`/api/sessions/${tool}/${encodeURIComponent(id)}?limit=1&seen=0`);
  await sessionMenu(d.session, () => render());
}
async function sessionMenu(s, after, { onTrashed } = {}) {
  const act = await pick(s.title, [
    { value: 'notify', label: s.notify ? `${t('🔔 끝나면 알림')} · ${s.notify === 2 ? t('매번') : t('한 번')}` : t('🔔 끝나면 폰으로 알림'), desc: t('PC 터미널에서 돌리는 중이어도 알려줘요') },
    { value: 'pin', label: s.pinned ? t('고정 해제') : t('📌 고정') },
    { value: 'rename', label: t('이름 바꾸기') },
    { value: 'project', label: t('프로젝트 보기'), desc: shortPath(s.project || s.cwd) },
    { value: 'hide', label: s.hidden ? t('숨김 해제') : t('목록에서 숨기기') },
    { value: 'trash', label: t('🗑 휴지통으로'), desc: t('세션 파일을 휴지통으로 옮겨요 (30일 안에 되살리기 가능)'), danger: true },
  ]);
  const meta = (body) => api(`/api/sessions/${s.tool}/${encodeURIComponent(s.id)}/meta`, { body });
  if (act === 'pin') { await meta({ pinned: !s.pinned }); toast(s.pinned ? t('고정을 풀었어요') : t('고정했어요')); }
  else if (act === 'hide') { await meta({ hidden: !s.hidden }); toast(s.hidden ? t('다시 보이게 했어요') : t('숨겼어요 (세션 탭 「숨긴 세션」에서 볼 수 있어요)')); }
  else if (act === 'rename') { const n = await promptSheet(t('세션 이름 (Baton에서만 보여요)'), s.title); if (n === undefined) return; await meta({ title: n || null }); }
  else if (act === 'project') { if (s.project) location.hash = `#/p/${encodeURIComponent(s.project)}`; return; }
  else if (act === 'notify') { await notifyMenu(s); }
  else if (act === 'trash') { if (await trashOne(s)) { if (onTrashed) onTrashed(); else after?.(); } return; }
  else return;
  after?.();
}

// ---------------------------------------------------------------- CHAT
function groupMessages(msgs) {
  const out = [];
  for (const m of msgs) {
    if (m.role === 'tool' || m.role === 'thinking') {
      const last = out[out.length - 1];
      if (last?.kind === 'tools') last.items.push(m);
      else out.push({ kind: 'tools', items: [m] });
    } else out.push({ kind: 'msg', m });
  }
  return out;
}
function toolsHtml(items, open = false) {
  const tools = items.filter((x) => x.role === 'tool');
  const thinks = items.filter((x) => x.role === 'thinking');
  if (!tools.length && thinks.length) {
    return thinks.map((th) => `<details class="thinking"><summary>${t('💭 생각 과정')}</summary><div class="tx">${esc(th.text)}</div></details>`).join('');
  }
  const names = [...new Set(tools.map((x) => x.tool.name))];
  const errs = tools.filter((x) => x.tool.error).length;
  return `<details class="tools" ${open ? 'open' : ''}><summary><span>${t('🔧 도구 {n}회', { n: tools.length })}</span><span class="names">${esc(names.slice(0, 4).join(', '))}${errs ? ` · ${t('오류 {n}', { n: errs })}` : ''}</span><span class="chev">${ICON.chev}</span></summary>
    ${items.map((it) => it.role === 'thinking'
      ? `<details class="tool-item"><summary><span class="tn">${t('💭 생각')}</span><span class="ts">${esc(it.text.slice(0, 100))}</span></summary><pre>${esc(it.text)}</pre></details>`
      : `<details class="tool-item ${it.tool.error ? 'err' : ''}"><summary><span class="tn">${esc(it.tool.name)}</span><span class="ts">${esc(it.tool.summary || '')}</span></summary>
        ${it.tool.input ? `<div class="lbl">${t('입력')}</div><pre>${esc(typeof it.tool.input === 'string' ? it.tool.input : JSON.stringify(it.tool.input, null, 2))}</pre>` : ''}
        ${it.tool.output ? `<div class="lbl">${t('결과')}</div><pre>${esc(it.tool.output)}</pre>` : ''}</details>`).join('')}
  </details>`;
}
function msgsHtml(msgs) {
  return groupMessages(msgs).map((g) => {
    if (g.kind === 'tools') return toolsHtml(g.items);
    const m = g.m;
    if (m.role === 'user') return `<div class="msg-user">${esc(m.text)}${m.images ? `<div class="imgs">${t('🖼 사진 {n}장', { n: m.images })}</div>` : ''}</div>`;
    if (m.role === 'assistant') return `<div class="msg-ai">${md(m.text)}</div>`;
    return `<div class="msg-sys">${esc(m.text)}</div>`;
  }).join('');
}

function composerPrefs(tool) {
  return store.get(`prefs:${tool}`, { model: '', effort: '', perm: G.state?.settings?.defaultPerm || 'auto' });
}
function composerHtml(tool, isNew = false) {
  return `<div class="composer"><div class="inner"><div class="box">
    <div class="thumbs" id="thumbs" hidden></div>
    <textarea id="input" rows="1" placeholder="${isNew ? t('{name}에게 첫 메시지…', { name: TOOL[tool].name }) : t('{name}에게 이어서 물어보기…', { name: TOOL[tool].name })}" enterkeyhint="enter"></textarea>
    <div class="row"><button class="attach" id="attach" aria-label="${t('사진 첨부')}">${ICON.image}</button><input type="file" id="file" accept="image/*" multiple hidden><div class="opts" id="opts"></div><button class="send" id="send" disabled aria-label="${t('보내기')}">${ICON.send}</button></div>
  </div></div></div>`;
}
const EFFORT_DESC = { minimal: t('최소 · 가장 빠름'), low: t('낮음 · 빠르고 저렴'), medium: t('보통'), high: t('높음 · 더 깊게 생각'), xhigh: t('매우 높음'), max: t('최대 · 가장 느리고 토큰 많이 씀') };
function effectiveOpts(tool, p) {
  const cat = G.state?.catalogs?.[tool] || { models: [{ id: '', label: t('기본값') }], efforts: [''], defaults: {} };
  const model = cat.models.find((m) => m.id === p.model) || (p.model ? { id: p.model, label: p.model, short: p.model } : cat.models[0]);
  const defEffort = model?.defaultEffort || cat.defaults?.effort || null;
  return { cat, model, defEffort, effort: p.effort || defEffort };
}
function drawOpts(tool) {
  const p = composerPrefs(tool);
  const { cat, model, defEffort, effort } = effectiveOpts(tool, p);
  const mShort = model?.short || model?.label || t('기본');
  const mTag = !p.model ? ` <i class="def">${t('기본')}</i>` : ['fable', 'opus', 'sonnet', 'haiku'].includes(p.model) ? ` <i class="def">${t('최신')}</i>` : '';
  $('#opts').innerHTML = `
    <button class="opt" data-o="model">${esc(mShort)}${mTag}</button>
    <button class="opt" data-o="effort">${t('노력')} ${esc(effort || '?')}${!p.effort ? ` <i class="def">${t('기본')}</i>` : ''}</button>
    <button class="opt perm-${p.perm}" data-o="perm">${PERM[p.perm]?.label || t('자동')}</button>`;
  $$('#opts [data-o]').forEach((b) => (b.onclick = async () => {
    const k = b.dataset.o;
    let v;
    if (k === 'model') v = await pick(t('모델'), cat.models.map((m) => ({ value: m.id, label: m.label, desc: m.desc })), p.model);
    else if (k === 'effort') {
      const allowed = model?.efforts;
      const list = cat.efforts.filter((e) => !e || !allowed || allowed.includes(e));
      const src = tool === 'codex' && cat.defaults?.effortSource === 'config' ? t('~/.codex/config.toml 설정값')
        : tool === 'agy' ? t('모델 이름에 들어 있는 값') : t('실제 실행에서 확인된 값');
      v = await pick(t('추론 노력 (effort)'), list.map((e) => (e
        ? { value: e, label: e, desc: EFFORT_DESC[e] }
        : { value: '', label: `${t('기본값 ·')} ${defEffort || t('알 수 없음')}`, desc: src })), p.effort);
    } else v = await pick(t('권한'), Object.entries(PERM).map(([id, x]) => ({ value: id, label: x.label, desc: x.desc })), p.perm);
    if (v === undefined) return;
    p[k] = v; store.set(`prefs:${tool}`, p); drawOpts(tool);
  }));
}

function setupViewport() {
  const vv = window.visualViewport;
  const apply = () => {
    const h = vv ? vv.height : window.innerHeight;
    document.documentElement.style.setProperty('--vvh', `${h}px`);
    document.body.classList.toggle('kb-open', vv ? window.innerHeight - vv.height > 120 : false);
    if (vv) window.scrollTo(0, 0);
  };
  apply();
  vv?.addEventListener('resize', apply);
  vv?.addEventListener('scroll', apply);
  return () => { vv?.removeEventListener('resize', apply); vv?.removeEventListener('scroll', apply); document.documentElement.style.setProperty('--vvh', '100dvh'); };
}

/** Live run renderer. Appends a streaming block to `container`. */
function liveRun(container, runId, { onSession, onDone } = {}) {
  const el = document.createElement('div');
  el.className = 'live';
  el.style.cssText = 'display:flex;flex-direction:column;gap:12px';
  container.append(el);
  const segs = []; // {type:'text', text, el} | {type:'tools', items, el}
  let lastI = -1, es = null, closed = false, started = Date.now(), thinking = false, rafPending = false;
  const status = document.createElement('div');
  status.className = 'live-status';
  el.append(status);
  const timer = setInterval(() => drawStatus(), 1000);
  function drawStatus() {
    status.innerHTML = `<div class="spinner"></div><span>${thinking ? t('생각하는 중') : t('응답 중')}</span><span class="timer">${fmtDur(Date.now() - started)}</span><button class="btn sm ghost stop">${t('중지')}</button>`;
    $('.stop', status).onclick = async () => { await api(`/api/runs/${runId}/stop`, { method: 'POST' }).catch(() => {}); };
  }
  drawStatus();
  const scroll = () => { const sc = container.closest('.chat-scroll'); if (sc && sc.scrollHeight - sc.scrollTop - sc.clientHeight < 220) sc.scrollTop = sc.scrollHeight; };
  const flush = () => {
    rafPending = false;
    for (const s of segs) {
      if (!s.dirty) continue;
      s.dirty = false;
      if (s.type === 'text') { s.el.innerHTML = md(s.text); s.el.classList.toggle('typing-caret', s === segs[segs.length - 1] && !s.ended); }
      else { const wasOpen = s.el.querySelector('details.tools')?.open; s.el.innerHTML = toolsHtml(s.items, wasOpen); }
    }
    scroll();
  };
  const mark = (s) => { s.dirty = true; if (!rafPending) { rafPending = true; requestAnimationFrame(flush); } };
  const lastSeg = () => segs[segs.length - 1];
  const handle = (ev) => {
    if (ev.i != null) lastI = ev.i;
    if (ev.t === 'session') onSession?.(ev.id);
    else if (ev.t === 'thinking') { thinking = true; drawStatus(); }
    else if (ev.t === 'text') {
      thinking = false;
      let s = lastSeg();
      if (!s || s.type !== 'text' || s.ended) { s = { type: 'text', text: '', el: Object.assign(document.createElement('div'), { className: 'msg-ai' }) }; el.insertBefore(s.el, status); segs.push(s); }
      s.text += ev.text; mark(s);
    } else if (ev.t === 'text_end') { const s = lastSeg(); if (s?.type === 'text') { s.ended = true; mark(s); } }
    else if (ev.t === 'tool') {
      thinking = false;
      let s = lastSeg();
      if (!s || s.type !== 'tools') { s = { type: 'tools', items: [], el: document.createElement('div') }; el.insertBefore(s.el, status); segs.push(s); }
      s.items.push({ role: 'tool', tool: { name: ev.name, summary: ev.summary } }); mark(s);
    } else if (ev.t === 'tool_done') {
      const s = lastSeg(); if (s?.type === 'tools') { const it = [...s.items].reverse().find((x) => x.tool && x.tool.done == null); if (it) { it.tool.done = true; it.tool.error = ev.error; } }
    } else if (ev.t === 'done') {
      finish(ev);
    }
  };
  const finish = (ev) => {
    if (closed) return; closed = true;
    clearInterval(timer); es?.close(); status.remove();
    for (const s of segs) if (s.type === 'text') s.el.classList.remove('typing-caret');
    onDone?.(ev, el);
  };
  const connect = () => {
    if (closed) return;
    es = new EventSource(`/api/runs/${runId}/stream?from=${lastI + 1}`);
    es.addEventListener('meta', (e) => { try { const m = JSON.parse(e.data); started = m.startedAt || started; } catch { /* ignore */ } });
    es.onmessage = (e) => { try { handle(JSON.parse(e.data)); } catch (err) { console.warn(err); } };
    es.onerror = () => {
      es.close();
      if (closed) return;
      // The server ends the stream after `done`; if we got here otherwise, retry.
      setTimeout(async () => {
        if (closed) return;
        try { const { runs } = await api('/api/runs'); const r = runs.find((x) => x.id === runId); if (!r || r.status !== 'running') { if (!r) finish({ t: 'done', ok: true, lost: true }); else connect(); return; } } catch { /* offline */ }
        connect();
      }, 1500);
    };
  };
  connect();
  const onVis = () => { if (document.visibilityState === 'visible' && !closed && es?.readyState === 2) connect(); };
  document.addEventListener('visibilitychange', onVis);
  return { close: () => { closed = true; clearInterval(timer); es?.close(); document.removeEventListener('visibilitychange', onVis); } };
}

function chatLayout({ backHref, title, subHtml, tool, extraHead = '', banner = '', isNew = false }) {
  app.innerHTML = `<div class="chat">
    <div class="chat-head">
      <a class="icon-btn" href="${backHref}" id="back">${ICON.back}</a>
      <div class="ttl"><div class="a" id="ctitle">${esc(title)}</div><div class="b" id="csub">${subHtml}</div></div>
      ${extraHead}
    </div>
    ${banner}
    <div class="chat-scroll" id="scroll"><div class="msgs" id="msgs"></div></div>
    ${composerHtml(tool, isNew)}
  </div>`;
  $('#back').onclick = (e) => { e.preventDefault(); if (G.navCount > 1) history.back(); else location.hash = $('#back').getAttribute('href'); };
}

/** Downscale a picked photo (iPhone photos are 4-12MB) to <=1600px and return {url, mime, data}. */
async function shrinkImage(file) {
  const url0 = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url0; });
    const max = 1600;
    const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.round(img.naturalWidth * k), h = Math.round(img.naturalHeight * k);
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    c.getContext('2d').drawImage(img, 0, 0, w, h);
    const mime = file.type === 'image/png' && file.size < 1.5e6 ? 'image/png' : 'image/jpeg';
    const url = c.toDataURL(mime, 0.85);
    return { url, mime, data: url.slice(url.indexOf(',') + 1) };
  } finally { URL.revokeObjectURL(url0); }
}
const userBubble = (text, imgs = []) => `<div class="msg-user">${imgs.length ? `<div class="uimgs">${imgs.map((a) => `<img src="${a.url}" alt="">`).join('')}</div>` : ''}${esc(text)}</div>`;
const imgPayload = (imgs) => (imgs?.length ? imgs.map((a) => ({ mime: a.mime, data: a.data })) : undefined);

function wireComposer(tool, onSend, draftKey) {
  const ta = $('#input'), btn = $('#send');
  let atts = [];
  const fit = () => { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, window.innerHeight * 0.38) + 'px'; btn.disabled = !ta.value.trim() && !atts.length; };
  const drawThumbs = () => {
    const el = $('#thumbs');
    el.hidden = !atts.length;
    el.innerHTML = atts.map((a, i) => `<div class="thumb"><img src="${a.url}" alt=""><button data-i="${i}" aria-label="${t('빼기')}">${ICON.x}</button></div>`).join('');
    $$('button', el).forEach((b) => (b.onclick = () => { atts.splice(+b.dataset.i, 1); drawThumbs(); fit(); }));
  };
  $('#attach').onclick = () => $('#file').click();
  $('#file').onchange = async (e) => {
    const files = [...e.target.files].slice(0, 8 - atts.length);
    e.target.value = '';
    for (const f of files) {
      try { atts.push(await shrinkImage(f)); } catch { toast(t('{name}을(를) 읽지 못했어요', { name: f.name }), true); }
    }
    if (files.length && atts.length >= 8) toast(t('사진은 8장까지 첨부할 수 있어요'));
    drawThumbs(); fit();
  };
  const draft = sessionStorage.getItem(draftKey) || store.get(draftKey, '');
  if (draft) { ta.value = draft; sessionStorage.removeItem(draftKey); }
  ta.oninput = () => { fit(); store.set(draftKey, ta.value); };
  ta.onkeydown = (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); btn.click(); } };
  btn.onclick = async () => {
    const imgs = atts.slice();
    const text = ta.value.trim() || (imgs.length ? t('이 사진을 봐줘.') : '');
    if (!text) return;
    btn.disabled = true;
    const ok = await onSend(text, composerPrefs(tool), imgs);
    if (ok) { ta.value = ''; atts = []; drawThumbs(); store.set(draftKey, ''); fit(); ta.blur(); } else btn.disabled = false;
  };
  drawOpts(tool);
  fit();
  return { setBusy(b) { ta.placeholder = b ? t('응답이 끝나면 이어서 보낼 수 있어요') : t('{name}에게 이어서 물어보기…', { name: TOOL[tool].name }); } };
}

async function viewChat([tool, id]) {
  const cleanVV = setupViewport();
  const key = `${tool}:${id}`;
  chatLayout({ backHref: '#/', title: t('불러오는 중…'), subHtml: `<span class="tool-badge ${tool}">${TOOL[tool].name}</span>`, tool, extraHead: `<button class="icon-btn" id="cmore">${ICON.more}</button>` });
  let live = null, session = null, start = 0, busy = false;
  const msgsEl = $('#msgs'), scroll = $('#scroll');
  G.cleanup = () => { live?.close(); cleanVV(); };

  const load = async ({ keepScroll = false } = {}) => {
    const d = await api(`/api/sessions/${tool}/${encodeURIComponent(id)}`);
    session = d.session; start = d.start;
    $('#ctitle').textContent = session.title;
    $('#csub').innerHTML = `<span class="tool-badge ${tool}">${TOOL[tool].name}</span><span>${esc(projectName(session.project || session.cwd))}</span>${session.model ? `<span>· ${esc(session.model)}</span>` : ''}${session.notify ? `<span class="flag bell">${t('🔔 끝나면 알림')}</span>` : ''}`;
    $('#back').setAttribute('href', session.project ? `#/p/${encodeURIComponent(session.project)}` : '#/sessions');
    const banner = session.terminal ? `<div class="banner warn" style="margin-bottom:4px">${t('⚠️ 이 세션은 PC 터미널에서도 열려 있어요. 여기서 보내면 기록이 갈라질 수 있으니 PC 쪽이 쉬고 있을 때 보내세요.')}</div>` : '';
    msgsEl.innerHTML = `${start > 0 ? `<button class="btn sm ghost load-older" id="older">${t('이전 대화 더 보기')}</button>` : ''}${banner}${msgsHtml(d.messages)}`;
    if (!d.messages.length) msgsEl.insertAdjacentHTML('beforeend', `<div class="empty">${t('표시할 대화가 없어요')}</div>`);
    const older = $('#older');
    if (older) older.onclick = async () => {
      const h0 = scroll.scrollHeight;
      const o = await api(`/api/sessions/${tool}/${encodeURIComponent(id)}?before=${start}&seen=0`);
      start = o.start; older.remove();
      msgsEl.insertAdjacentHTML('afterbegin', `${start > 0 ? `<button class="btn sm ghost load-older" id="older">${t('이전 대화 더 보기')}</button>` : ''}${msgsHtml(o.messages)}`);
      scroll.scrollTop = scroll.scrollHeight - h0;
      $('#older') && ($('#older').onclick = older.onclick);
    };
    if (!keepScroll) requestAnimationFrame(() => { scroll.scrollTop = scroll.scrollHeight; });
    if (d.run && !live) attachRun(d.run.id);
  };

  const attachRun = (runId, promptText, imgs) => {
    busy = true; comp.setBusy(true);
    if (promptText) msgsEl.insertAdjacentHTML('beforeend', userBubble(promptText, imgs));
    live = liveRun(msgsEl, runId, {
      onDone: async (ev, el) => {
        live = null; busy = false; comp.setBusy(false);
        await load({ keepScroll: true });
        scroll.scrollTop = scroll.scrollHeight;
        if (ev.denied?.length) showDenied(ev.denied);
        else if (ev.ok === false && ev.error) msgsEl.insertAdjacentHTML('beforeend', `<div class="done-card err">⚠️ ${esc(ev.error)}</div>`);
        loadState();
      },
    });
    requestAnimationFrame(() => { scroll.scrollTop = scroll.scrollHeight; });
  };

  const showDenied = (denied) => {
    msgsEl.insertAdjacentHTML('beforeend', `<div class="done-card denied"><div>${t('🔒 권한이 없어 실행하지 못한 작업이 있어요:')} <b>${esc(denied.join(', '))}</b></div>
      <div class="row"><button class="btn sm primary" id="retryfull">${t('전체 허용으로 「계속해」 보내기')}</button></div></div>`);
    $('#retryfull').onclick = () => send(t('계속해. 방금 권한 때문에 막힌 작업을 이어서 진행해줘.'), { ...composerPrefs(tool), perm: 'full' });
    scroll.scrollTop = scroll.scrollHeight;
  };

  const send = async (text, prefs, imgs) => {
    if (busy) { toast(t('아직 응답 중이에요'), true); return false; }
    try {
      const { run } = await api('/api/run', { body: { tool, sessionId: id, prompt: text, model: prefs.model, effort: prefs.effort, perm: prefs.perm, images: imgPayload(imgs) } });
      $('.empty', msgsEl)?.remove();
      attachRun(run.id, text, imgs);
      loadState();
      return true;
    } catch (e) {
      if (e.data?.runId) { toast(t('이미 응답 중이에요 — 이어서 보여드릴게요')); attachRun(e.data.runId); return false; }
      toast(e.message, true); return false;
    }
  };
  const comp = wireComposer(tool, send, `draft:${key}`);
  $('#cmore').onclick = () => session && sessionMenu(session, () => load({ keepScroll: true }), { onTrashed: () => { if (G.navCount > 1) history.back(); else location.hash = '#/sessions'; } });
  await load();
  const onVis = () => { if (document.visibilityState === 'visible' && !live) load({ keepScroll: true }); };
  document.addEventListener('visibilitychange', onVis);
  const prev = G.cleanup; G.cleanup = () => { prev(); document.removeEventListener('visibilitychange', onVis); };
}

async function viewNew(_, params) {
  const cleanVV = setupViewport();
  let tool = params.get('tool') || store.get('newtool', INSTALLED()[0] || 'claude');
  if (!INSTALLED().includes(tool)) tool = INSTALLED()[0] || 'claude';
  let cwd = params.get('cwd') || store.get('newcwd', G.state?.defaultCwd || '~');
  const render2 = () => {
    chatLayout({ backHref: '#/', title: t('새 세션'), subHtml: `<span>${t('프로젝트 폴더와 도구를 고르고 첫 메시지를 보내세요')}</span>`, tool, isNew: true });
    $('.chat-head').insertAdjacentHTML('afterend', `<div class="newbar">
      <div class="seg" id="ntool">${INSTALLED().map((k) => `<button class="${k === tool ? 'on' : ''}" data-t="${k}">${TOOL[k].name}</button>`).join('')}<a class="seg-add" href="#/setup" title="${t('도구 추가')}">+</a></div>
      <button class="dirpick" id="ndir">${ICON.folder}<span class="v">${esc(cwd)}</span>${ICON.down}</button>
    </div>`);
    $('#msgs').innerHTML = `<div class="empty" style="padding-top:12vh"><b>${t('무엇을 만들어볼까요? 🏃')}</b>${t('보낸 뒤에는 이 화면에서 바로 대화가 이어져요')}</div>`;
    $$('#ntool [data-t]').forEach((b) => (b.onclick = () => { tool = b.dataset.t; store.set('newtool', tool); keepDraft(); render2(); }));
    $('#ndir').onclick = pickDir;
    wireComposer(tool, send, 'draft:new');
  };
  const keepDraft = () => { const ta = $('#input'); if (ta?.value) sessionStorage.setItem('draft:new', ta.value); };
  const pickDir = async () => {
    const d = await api('/api/dirs');
    const opts = d.items.map((x) => ({ value: x.path, label: x.known ? `${x.name}` : x.path, desc: x.known ? `${x.path} · ${ago(x.lastActivity)}` : t('폴더') }));
    opts.unshift({ value: '__custom', label: t('✏️ 직접 입력 (새 폴더 만들기 가능)') });
    const v = await pick(t('어느 폴더에서 작업할까요?'), opts, cwd);
    if (v === undefined) return;
    if (v === '__custom') { const p = await promptSheet(t('폴더 경로'), cwd, { placeholder: '~/workspace/my-new-idea' }); if (!p) return; cwd = p.trim(); }
    else cwd = v;
    store.set('newcwd', cwd); keepDraft(); render2();
  };
  const send = async (text, prefs, imgs) => {
    let body = { tool, cwd, prompt: text, model: prefs.model, effort: prefs.effort, perm: prefs.perm, images: imgPayload(imgs) };
    let run;
    try { ({ run } = await api('/api/run', { body })); }
    catch (e) {
      if (e.data?.code === 'NO_DIR') {
        const ok = await pick(`${cwd} ${t('폴더가 없어요')}`, [{ value: true, label: t('새로 만들고 시작하기') }, { value: false, label: t('취소') }]);
        if (!ok) return false;
        ({ run } = await api('/api/run', { body: { ...body, mkdir: true } }));
      } else { toast(e.message, true); return false; }
    }
    $('.newbar')?.remove();
    const msgs = $('#msgs');
    msgs.innerHTML = userBubble(text, imgs);
    $('#ctitle').textContent = text.slice(0, 60);
    $('#csub').innerHTML = `<span class="tool-badge ${tool}">${TOOL[tool].name}</span><span>${esc(projectName(cwd))}</span>`;
    let sid = null;
    const live = liveRun(msgs, run.id, {
      onSession: (id) => {
        sid = id;
        const h = `#/s/${tool}/${encodeURIComponent(id)}`;
        G.skipHash = h; history.replaceState(null, '', h);
      },
      onDone: () => { if (sid) { G.skipHash = null; render(); } },
    });
    G.cleanup = () => { live.close(); cleanVV(); };
    loadState();
    return true;
  };
  G.cleanup = cleanVV;
  render2();
}

// ---------------------------------------------------------------- SETTINGS
function urlB64ToUint8(b64) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}
async function pushStatus() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return { supported: false };
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  return { supported: true, sub, permission: Notification.permission };
}
async function enablePush() {
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') { toast(t('알림 권한이 거부됐어요. 설정 앱에서 허용해주세요'), true); return; }
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8(G.state.vapidPublicKey) });
  await api('/api/push/subscribe', { body: sub.toJSON() });
  toast(t('알림을 켰어요 🔔'));
}

async function viewSettings() {
  const v = shell({ title: t('설정'), fab: false });
  const s = await api('/api/settings');
  const ps = await pushStatus().catch(() => ({ supported: false }));
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const isIOS = /iPhone|iPad/.test(navigator.userAgent);
  const sw = (k) => `<label class="switch"><input type="checkbox" data-k="${k}" ${s[k] ? 'checked' : ''}><i></i></label>`;
  const hours = Array.from({ length: 24 }, (_, h) => `<option value="${h}" ${s.nudgeHour === h ? 'selected' : ''}>${hourLabel(h)}</option>`).join('');
  const briefModels = (G.state?.catalogs?.[s.briefTool]?.models || []).map((m) => `<option value="${esc(m.id)}" ${m.id === s.briefModel ? 'selected' : ''}>${esc(m.label)}</option>`).join('');
  v.innerHTML = `
    <div class="section"><div class="card">
      <a class="setting" href="#/setup"><div class="l"><b>🚀 ${t('시작하기 · 도구 설치/연동')}</b><span>${t('Claude Code·Codex·Antigravity·OpenCode·Cursor 설치, 로그인, 폰 연결, 자동 시작')}</span></div><span class="muted">›</span></a>
      <div class="setting"><div class="l"><b>Language · 언어</b></div><select data-k="lang" data-reload><option value="en" ${s.lang !== 'ko' ? 'selected' : ''}>English</option><option value="ko" ${s.lang === 'ko' ? 'selected' : ''}>한국어</option></select></div>
    </div></div>
    <div class="section"><div class="section-h"><h2>${t('알림')}</h2></div><div class="card">
      ${!ps.supported || (isIOS && !standalone) ? `<div class="setting"><div class="l"><b>${t('홈 화면에 추가해야 알림을 받을 수 있어요')}</b><span>${t('Safari 공유 버튼 → 「홈 화면에 추가」 → 추가된 Baton 앱에서 이 화면을 다시 열어주세요')}</span></div></div>`
        : `<div class="setting"><div class="l"><b>${t('푸시 알림')}</b><span>${ps.sub ? t('이 기기에서 켜져 있어요') : t('응답 완료·잠자는 프로젝트 알림을 받아요')}</span></div>
            ${ps.sub ? `<button class="btn sm" id="ptest">${t('테스트')}</button><button class="btn sm ghost" id="poff">${t('끄기')}</button>` : `<button class="btn sm primary" id="pon">${t('켜기')}</button>`}</div>`}
      <div class="setting"><div class="l"><b>${t('응답 완료 알림')}</b><span>${t('보고 있지 않은 세션의 응답이 끝나면 알려줘요')}</span></div>${sw('notifyOnRunDone')}</div>
    </div></div>
    <div class="section"><div class="section-h"><h2>${t('잊혀가는 프로젝트 챙기기 💤')}</h2></div><div class="card">
      <div class="setting"><div class="l"><b>${t('하루 한 번 넛지')}</b><span>${t('멈춰 있는 프로젝트 하나를 골라 다음 할 일과 함께 알려줘요')}</span></div>${sw('nudgeEnabled')}</div>
      <div class="setting"><div class="l"><b>${t('알림 시간')}</b></div><select data-k="nudgeHour" data-num>${hours}</select></div>
      <div class="setting"><div class="l"><b>${t('며칠 쉬면 「잠자는」 프로젝트?')}</b></div><select data-k="staleDays" data-num>${[3, 5, 7, 10, 14, 21].map((n) => `<option ${s.staleDays === n ? 'selected' : ''} value="${n}">${n}${t('일')}</option>`).join('')}</select></div>
      <div class="setting"><div class="l"><b>${t('같은 프로젝트 다시 알림 간격')}</b></div><select data-k="nudgeCooldownDays" data-num>${[3, 5, 7, 10, 14, 30].map((n) => `<option ${s.nudgeCooldownDays === n ? 'selected' : ''} value="${n}">${n}${t('일')}</option>`).join('')}</select></div>
      <div class="setting"><div class="l"><b>${t('이만큼 지나면 알림 그만')}</b><span>${t('너무 오래된 건 보관 대상으로 봐요')}</span></div><select data-k="forgetDays" data-num>${[60, 90, 180, 365].map((n) => `<option ${s.forgetDays === n ? 'selected' : ''} value="${n}">${n}${t('일')}</option>`).join('')}</select></div>
      <div class="setting"><div class="l"><b>${t('지금 한 번 받아보기')}</b><span>${t('브리핑을 만들고 알림을 보내요 (최대 30초)')}</span></div><button class="btn sm" id="nudgenow">${t('보내기')}</button></div>
    </div></div>
    <div class="section"><div class="section-h"><h2>${t('AI 브리핑')}</h2></div><div class="card">
      <div class="setting"><div class="l"><b>${t('요약에 쓸 도구')}</b><span>${t('가볍고 빠른 모델을 추천해요')}</span></div><select data-k="briefTool">${INSTALLED().map((k) => [k, TOOL[k]]).map(([k, tl]) => `<option value="${k}" ${s.briefTool === k ? 'selected' : ''}>${tl.name}</option>`).join('')}</select></div>
      <div class="setting"><div class="l"><b>${t('모델')}</b></div><select data-k="briefModel">${briefModels}</select></div>
    </div></div>
    <div class="section"><div class="section-h"><h2>${t('세션')}</h2></div><div class="card">
      <div class="setting"><div class="l"><b>${t('자동 실행 세션도 보기')}</b><span>${t('스크립트·서브에이전트가 만든 세션 (codex exec, agy -p 등)')}</span></div>${sw('showAutomated')}</div>
      <div class="setting"><div class="l"><b>${t('기본 권한')}</b></div><select data-k="defaultPerm">${Object.entries(PERM).map(([k, p]) => `<option value="${k}" ${s.defaultPerm === k ? 'selected' : ''}>${p.label}</option>`).join('')}</select></div>
      <a class="setting" href="#/usage"><div class="l"><b>${t('사용량 · 한도')}</b><span>${t('CLI별 남은 한도와 토큰 사용량')}</span></div><span class="muted">›</span></a>
      <div class="setting"><div class="l"><b>${t('목록 새로고침')}</b><span>${t('세션 파일을 다시 읽어요')}</span></div><button class="btn sm" id="reindex">${ICON.refresh}</button></div>
    </div></div>
    <p class="small muted" style="text-align:center;margin-top:24px">${t('Baton · 바이브코딩 이어달리기 🏃‍♂️')}<br>${esc(G.state?.home || '')}</p>`;
  $$('[data-k]', v).forEach((el) => (el.onchange = async () => {
    const k = el.dataset.k;
    const val = el.type === 'checkbox' ? el.checked : el.dataset.num !== undefined ? Number(el.value) : el.value;
    const patch = { [k]: val };
    if (k === 'briefTool') patch.briefModel = '';
    await api('/api/settings', { body: patch });
    if (el.dataset.reload !== undefined) { location.reload(); return; }
    await loadState();
    toast(t('저장했어요'));
    if (k === 'briefTool') viewSettings();
  }));
  $('#pon') && ($('#pon').onclick = async () => { try { await enablePush(); viewSettings(); } catch (e) { toast(e.message, true); } });
  $('#poff') && ($('#poff').onclick = async () => { const sub = ps.sub; await api('/api/push/unsubscribe', { body: { endpoint: sub.endpoint } }); await sub.unsubscribe(); toast(t('알림을 껐어요')); viewSettings(); });
  $('#ptest') && ($('#ptest').onclick = async () => { const r = await api('/api/push/test', { method: 'POST' }); toast(t('{n}개 기기로 보냈어요', { n: r.sent })); });
  $('#nudgenow').onclick = async (e) => {
    e.target.disabled = true; e.target.innerHTML = '<div class="spinner"></div>';
    try { const r = await api('/api/nudge/now', { method: 'POST' }); toast(r.nudge ? t('보냈어요! 알림을 확인해보세요') : t('지금은 잠자는 프로젝트가 없어요 👏')); }
    catch (err) { toast(err.message, true); }
    e.target.disabled = false; e.target.textContent = t('보내기');
  };
  $('#reindex').onclick = async () => { await api('/api/refresh', { method: 'POST' }); toast(t('새로 읽었어요')); };
}

async function viewInbox() {
  const v = shell({ title: t('알림'), fab: false });
  const d = await api('/api/events');
  v.innerHTML = d.items.length ? `<div class="card" style="margin-top:8px">${d.items.map((e) => `<a class="ev ${e.read ? '' : 'unread'}" href="${esc(e.url || '#/')}"><div class="b"><div class="tt">${esc(e.title)}</div>${e.body ? `<div class="bd">${esc(e.body)}</div>` : ''}<div class="tm">${ago(e.ts)}</div></div></a>`).join('')}</div>`
    : `<div class="empty" style="padding-top:20vh"><b>${t('알림이 없어요')}</b>${t('응답 완료나 잠자는 프로젝트 소식이 여기에 쌓여요')}</div>`;
  if (d.unread) { await api('/api/events/read', { method: 'POST' }); if (G.state) G.state.unread = 0; $('.badge-dot')?.remove(); }
}

// ---------------------------------------------------------------- USAGE
function fmtTok(n) {
  n = n || 0;
  if (n < 1000) return String(n);
  if (n < 1e6) return `${(n / 1e3).toFixed(n < 1e4 ? 1 : 0)}K`;
  if (n < 1e9) return `${(n / 1e6).toFixed(n < 1e7 ? 1 : 0)}M`;
  return `${(n / 1e9).toFixed(2)}B`;
}
const tokTotal = (u) => (u.input || 0) + (u.cacheWrite || 0) + (u.cacheRead || 0) + (u.output || 0);
function modelName(tool, id) {
  const m = G.state?.catalogs?.[tool]?.models?.find((x) => x.id === id);
  if (m && m.id) return m.short || m.label;
  const c = String(id).match(/^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?/);
  return c ? `${c[1][0].toUpperCase()}${c[1].slice(1)} ${c[2]}${c[3] ? '.' + c[3] : ''}` : id;
}
async function viewUsage(_, params) {
  const period = params.get('p') || 'd7';
  const v = shell({ title: t('사용량'), fab: false, right: `<button class="icon-btn" id="ulrefresh" aria-label="${t('새로고침')}">${ICON.refresh}</button>` });
  v.innerHTML = '<div class="section"><div class="skeleton" style="height:220px"></div></div><div class="section"><div class="skeleton" style="height:260px"></div></div>';
  const [lim, d] = await Promise.all([api('/api/limits').catch(() => ({})), api('/api/usage')]);
  const P = { today: t('오늘'), d7: t('7일'), d30: t('30일') };
  const parts = [];

  parts.push(`<div class="section"><div class="section-h"><h2>${t('사용 한도')}</h2></div>`);
  for (const tool of INSTALLED()) if (lim[tool]) parts.push(limitCard(tool, lim[tool]));
  parts.push('</div>');

  parts.push(`<div class="section"><div class="section-h"><h2>${t('토큰 사용량')}</h2></div><div class="seg" id="pseg">${Object.entries(P).map(([k, l]) => `<button data-p="${k}" class="${k === period ? 'on' : ''}">${l}</button>`).join('')}</div></div>`);
  for (const tool of INSTALLED()) {
    const td = d.tools[tool];
    if (!td) continue;
    const u = td.periods[period];
    const tot = tokTotal(u);
    const seg = (k, cls) => (tot && u[k] ? `<i class="${cls}" style="width:${(u[k] / tot) * 100}%"></i>` : '');
    const max = Math.max(1, ...td.daily.map(tokTotal));
    const fresh = (x) => (x.input || 0) + (x.cacheWrite || 0) + (x.output || 0);
    const bars = td.daily.map((x) => `<div class="col"><i class="cr" style="height:${(x.cacheRead / max) * 100}%"></i><i class="nw" style="height:${(fresh(x) / max) * 100}%"></i></div>`).join('');
    parts.push(`<div class="section"><div class="card usage-card">
      <div class="uh"><span class="tool-badge ${tool}">${TOOL[tool].name}</span><span class="big">${fmtTok(tot)}</span><span class="muted small">${t('토큰')} · ${P[period]}</span></div>
      ${tot ? `<div class="stack">${seg('input', 'in')}${seg('cacheWrite', 'cw')}${seg('cacheRead', 'cr')}${seg('output', 'out')}</div>
      <div class="legend">
        <span><i class="in"></i>${t('입력')} <b>${fmtTok(u.input)}</b></span>
        ${u.cacheWrite ? `<span><i class="cw"></i>${t('캐시 쓰기')} <b>${fmtTok(u.cacheWrite)}</b></span>` : ''}
        <span><i class="cr"></i>${t('캐시 읽기')} <b>${fmtTok(u.cacheRead)}</b></span>
        <span><i class="out"></i>${t('출력')} <b>${fmtTok(u.output)}</b></span>
      </div>
      <div class="models">${u.models.map((m) => `<div class="mrow"><span>${esc(modelName(tool, m.model))}</span><span class="muted small">${t('출력')} ${fmtTok(m.output)}</span><b>${fmtTok(tokTotal(m))}</b></div>`).join('')}</div>`
        : `<p class="muted small" style="margin:8px 0">${t('{p} 동안 사용 기록이 없어요', { p: P[period] })}</p>`}
      <div class="spark">${bars}</div><div class="spark-l"><span>${td.daily[0].day.slice(5).replace('-', '/')}</span><span>${t('최근 14일')}</span><span>${t('오늘')}</span></div>
    </div></div>`);
  }
  parts.push(`<p class="small muted" style="text-align:center;line-height:1.6">${t('막대: 진한 색 = 새로 처리한 토큰, 연한 색 = 캐시 읽기')}<br>${t('캐시 읽기는 이미 읽은 내용을 재사용한 것이라 한도에 훨씬 적게 반영돼요')}<br>${t('토큰은 세션 기록에서 계산')} · ${d.scanning ? t('다시 계산 중…') : t('{when} 업데이트', { when: ago(d.computedAt) })}</p>`);
  v.innerHTML = parts.join('');
  $$('#pseg button', v).forEach((b) => (b.onclick = () => { location.hash = `#/usage?p=${b.dataset.p}`; }));
  $('#ulrefresh').onclick = async (e) => {
    e.currentTarget.classList.add('spin');
    await api('/api/limits?force=1').catch(() => {});
    render();
  };
}

/** "5:30 PM" today -> "Resets at 5:30 PM"; tomorrow / weekday variants. */
function resetText(ms) {
  if (!ms) return '';
  if (ms <= Date.now()) return t('초기화됨');
  const d = new Date(ms), n = new Date();
  const time = d.toLocaleTimeString(LOCALE, { hour: 'numeric', minute: '2-digit' });
  const days = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - new Date(n.getFullYear(), n.getMonth(), n.getDate())) / 864e5);
  if (days === 0) return t('{time}에 초기화', { time });
  if (days === 1) return t('내일 {time}에 초기화', { time });
  return t('({day}) {time}에 초기화', { day: d.toLocaleDateString(LOCALE, { weekday: 'short' }), time });
}
function whenText(ms) {
  const d = new Date(ms), n = new Date();
  const time = d.toLocaleTimeString(LOCALE, { hour: 'numeric', minute: '2-digit' });
  const days = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - new Date(n.getFullYear(), n.getMonth(), n.getDate())) / 864e5);
  return days === 0 ? time : days === 1 ? t('내일 {time}', { time }) : `${d.toLocaleDateString(LOCALE, { weekday: 'short' })} ${time}`;
}

/** One-line verdict from the weekly window's pace (used % vs. elapsed % of the window). */
function paceText(windows) {
  const live = windows.filter((w) => w.usedPercent != null && !(w.resetsAt && w.resetsAt < Date.now()));
  const hot = live.filter((w) => !w.weekly && w.usedPercent >= 80).sort((a, b) => b.usedPercent - a.usedPercent)[0];
  if (hot) return { lvl: 'hi', text: t('{label} 한도가 거의 찼어요. {reset}돼요.', { label: hot.label, reset: resetText(hot.resetsAt) }) };
  const wk = live.filter((w) => w.weekly && w.resetsAt).sort((a, b) => b.usedPercent - a.usedPercent)[0];
  if (!wk) return { lvl: '', text: t('여유 있어요.') };
  const span = 7 * 864e5;
  const elapsed = Math.min(1, Math.max(0.02, 1 - (wk.resetsAt - Date.now()) / span));
  const u = wk.usedPercent;
  if (u >= 95) return { lvl: 'hi', text: t('주간 한도를 거의 다 썼어요. {reset}돼요.', { reset: resetText(wk.resetsAt) }) };
  const ratio = u / (elapsed * 100);
  if (ratio < 0.85) return { lvl: '', text: t('순조로워요. 초기화 전까지 여유 있게 쓸 수 있어요.') };
  if (ratio < 1.1) return { lvl: 'mid', text: t('적당한 속도예요. 지금 페이스면 초기화 즈음 딱 맞게 써요.') };
  const perMs = u / (elapsed * span);
  const hitAt = Date.now() + (100 - u) / perMs;
  return { lvl: 'hi', text: t('빠르게 쓰고 있어요. 이 속도면 {when}쯤 한도에 닿아요.', { when: whenText(hitAt) }) };
}

function limitCard(tool, L) {
  const head = `<div class="lh"><span class="tool-badge ${tool}">${TOOL[tool].name}</span>${L?.plan ? `<span class="plan">${esc(String(L.plan).toUpperCase())}</span>` : ''}</div>`;
  if (!L || !L.windows?.length) {
    return `<div class="card limit-card">${head}<p class="muted small" style="margin:6px 0 0">${t('한도 정보를 가져오지 못했어요')}${L?.error ? ` · ${esc(L.error)}` : ''}</p></div>`;
  }
  const pace = paceText(L.windows);
  const rows = L.windows.map((w) => {
    const reset = w.resetsAt && w.resetsAt < Date.now();
    const p = reset ? 0 : (w.usedPercent ?? 0);
    const lvl = p >= 85 ? 'hi' : p >= 60 ? 'mid' : '';
    return `<div class="lrow"><div class="lt"><b>${esc(w.label)}</b><span>${t('{p}% 사용됨', { p })}</span></div>
      <div class="bar ${lvl}"><i style="width:${Math.max(p, 0.5)}%"></i></div>
      <div class="lr">${esc(resetText(w.resetsAt))}${w.sub && !/^\d/.test(w.sub) && w.sub.length <= 48 ? ` · ${esc(w.sub)}` : ''}</div></div>`;
  }).join('');
  const stale = L.error ? `<p class="small stale">⚠️ ${esc(L.error)} · ${t('{when} 기준', { when: ago(L.fetchedAt) })}</p>` : '';
  return `<div class="card limit-card">${head}<p class="pace ${pace.lvl}">${esc(pace.text)}</p>${rows}${stale}</div>`;
}

async function homeUsageCard() {
  const el = $('#home-usage');
  if (!el) return;
  try {
    const [lim, d] = await Promise.all([api('/api/limits').catch(() => ({})), api('/api/usage')]);
    const cell = (tid) => {
      const ws = (lim[tid]?.windows || []).filter((w) => !(w.resetsAt && w.resetsAt < Date.now()));
      const top = ws.sort((a, b) => (b.usedPercent ?? 0) - (a.usedPercent ?? 0))[0];
      const p = top?.usedPercent ?? null;
      const lvl = p >= 85 ? 'hi' : p >= 60 ? 'mid' : '';
      return `<div><span class="tool-badge ${tid}">${TOOL[tid].name}</span>
        <b>${p == null ? '–' : `${p}%`}</b>
        <div class="bar ${lvl}"><i style="width:${Math.max(p || 0, 0.5)}%"></i></div>
        <span class="small muted">${top ? `${esc(top.weekly ? t('주간') : t('5시간'))} · ` : ''}${t('오늘 {n}', { n: fmtTok(tokTotal(d.tools[tid]?.periods.today || {})) })}</span></div>`;
    };
    el.innerHTML = `<a class="card usage-mini" href="#/usage">
      <div class="h"><b>${t('사용 한도')}</b><span class="more">${t('자세히 ›')}</span></div>
      <div class="row">${INSTALLED().slice(0, 4).map(cell).join('')}</div>
    </a>`;
  } catch { el.remove(); }
}

// ---------------------------------------------------------------- TOOLS hub
async function viewTools() {
  const v = shell({ title: t('도구'), fab: false });
  const card = (href, icon, title, sub, id) => `<a class="card tool-card" href="${href}"><div class="ti">${icon}</div><div class="tb"><b>${title}</b><span id="${id}">${sub}</span></div><span class="muted">›</span></a>`;
  v.innerHTML = `<div class="section tool-grid">
    ${card('#/ports', '🖥️', t('서빙 중인 포트'), t('불러오는 중…'), 'tc-ports')}
    ${card('#/skills', '🧩', t('스킬'), t('어떤 스킬이 어디 있고 언제 쓰였는지'), 'tc-skills')}
    ${card('#/usage', '📊', t('사용량 · 한도'), t('CLI별 남은 한도와 토큰'), 'tc-usage')}
    ${card('#/cleanup', '🧹', t('세션 정리'), t('테스트·자동 실행·"hi" 세션 한 번에 지우기'), 'tc-clean')}
    ${card('#/trash', '🗑️', t('휴지통'), t('지운 세션 되살리기 (30일 보관)'), 'tc-trash')}
  </div>`;
  api('/api/ports').then((d) => { const n = d.ports.filter((p) => p.mine && !p.baton).length; $('#tc-ports') && ($('#tc-ports').textContent = t('내 서버 {n}개 실행 중', { n })); }).catch(() => {});
  api('/api/cleanup').then((d) => { $('#tc-clean') && ($('#tc-clean').textContent = t('정리 후보 {n}개', { n: d.items.length })); }).catch(() => {});
  api('/api/trash').then((d) => { $('#tc-trash') && ($('#tc-trash').textContent = d.items.length ? t('{n}개 보관 중 · 30일 뒤 완전 삭제', { n: d.items.length }) : t('비어 있어요')); }).catch(() => {});
}

// ---------------------------------------------------------------- PORTS
async function viewPorts() {
  const v = shell({ title: t('서빙 중인 포트'), fab: false, right: `<button class="icon-btn" id="prefresh" aria-label="${t('새로고침')}">${ICON.refresh}</button>` });
  v.innerHTML = '<div class="section"><div class="skeleton" style="height:300px"></div></div>';
  const d = await api('/api/ports');
  const mine = d.ports.filter((p) => p.mine);
  const sys = d.ports.filter((p) => !p.mine);
  const portCard = (p) => {
    const title = p.page?.title || (p.page?.kind === 'api' ? t('API 서버') : p.page?.kind === 'tcp' ? t('HTTP 아님') : '');
    const reach = p.phoneUrl
      ? `<a class="btn sm primary" href="${esc(p.phoneUrl)}" target="_blank" rel="noopener">${t('폰에서 열기 ↗')}</a>`
      : p.page && p.page.kind !== 'tcp' ? `<button class="btn sm" data-share="${p.port}">${t('폰에서 열 수 있게')}</button>` : '';
    const unshare = p.tailnetServe?.length && ![443, 8443].includes(p.tailnetServe[0].port) && !p.baton ? `<button class="btn sm ghost" data-unshare="${p.tailnetServe[0].port}">${t('공유 끄기')}</button>` : '';
    return `<div class="card port-card ${p.baton ? 'baton' : ''}">
      <div class="ph"><span class="pnum">:${p.port}</span><div class="pt"><b>${esc(title || p.name || t('알 수 없음'))}</b><span>${esc(p.name || '')}${p.startedAt ? ` · ${t('{when}부터 실행 중', { when: ago(p.startedAt) })}` : ''}</span></div></div>
      ${p.project ? `<a class="pline" href="#/p/${encodeURIComponent(p.project)}">📁 ${esc(projectName(p.project))} <span class="muted">${esc(p.cwd || '')}</span></a>` : p.cwd ? `<div class="pline">📁 ${esc(p.cwd)}</div>` : ''}
      ${p.agent ? `<a class="pline" href="#/s/${p.agent.tool}/${encodeURIComponent(p.agent.id)}"><span class="tool-badge ${p.agent.tool}">${TOOL[p.agent.tool].name}</span> ${t('「{title}」 세션이 띄움', { title: esc(p.agent.title || '') })}</a>` : ''}
      <div class="pline small muted">${p.local ? t('🔒 이 PC에서만 접속 (127.0.0.1)') : t('🌐 테일넷에서 접속 가능')}${p.tailnetServe?.length ? ` · ${p.tailnetServe.some((x) => x.funnel) ? t('⚠️ 인터넷 공개(Funnel)') : t('테일넷 공유 중')}` : ''}</div>
      ${p.cmd ? `<details class="pcmd"><summary>${t('실행 명령')}</summary><code>${esc(p.cmd)}</code></details>` : ''}
      ${p.baton ? '' : `<div class="pact">${reach}${unshare}<button class="btn sm ghost danger" data-stop="${p.pid}" data-port="${p.port}">${t('중지')}</button></div>`}
    </div>`;
  };
  v.innerHTML = `
    <div class="section"><div class="section-h"><h2>${t('내 서버')}</h2><span class="count">${mine.length}</span></div>
      ${mine.length ? mine.map(portCard).join('') : `<div class="card empty"><b>${t('실행 중인 서버가 없어요')}</b></div>`}</div>
    ${sys.length ? `<div class="section"><details class="sysports"><summary>${t('시스템 서비스 {n}개', { n: sys.length })}</summary>
      <div class="card list">${sys.map((p) => `<div class="srow"><div class="body"><div class="t"><b>:${p.port}</b>&nbsp;<span class="muted">${esc(p.page?.title || '')}</span></div><div class="m">${p.local ? t('이 PC 전용') : t('외부 접속 가능')} · ${esc(p.addrs.join(', '))}</div></div></div>`).join('')}</div></details></div>` : ''}
    <p class="small muted" style="text-align:center;line-height:1.6">${t('「폰에서 열 수 있게」는 Tailscale로 내 기기에만 공유해요 (인터넷 공개 아님)')}<br>${t('Vite 같은 개발 서버는 외부 주소를 막을 수 있어요 →')} <code>server.allowedHosts</code> ${t('설정 필요')}</p>`;
  $('#prefresh').onclick = () => render();
  $$('[data-share]', v).forEach((b) => (b.onclick = async () => {
    b.disabled = true;
    try { const r = await api(`/api/ports/${b.dataset.share}/share`, { method: 'POST' }); toast(t('공유했어요')); if (r.url) window.open(r.url, '_blank'); render(); }
    catch (e) { toast(e.message, true); b.disabled = false; }
  }));
  $$('[data-unshare]', v).forEach((b) => (b.onclick = async () => { await api(`/api/ports/${b.dataset.unshare}/unshare`, { method: 'POST' }).catch((e) => toast(e.message, true)); render(); }));
  $$('[data-stop]', v).forEach((b) => (b.onclick = async () => {
    const ok = await pick(t(':{port} 서버를 멈출까요?', { port: b.dataset.port }), [{ value: true, label: t('멈추기'), desc: t('프로세스 {pid}에 종료 신호를 보내요', { pid: b.dataset.stop }), danger: true }, { value: false, label: t('취소') }]);
    if (!ok) return;
    try { await api(`/api/pids/${b.dataset.stop}/stop`, { method: 'POST' }); toast(t('멈췄어요')); setTimeout(render, 800); } catch (e) { toast(e.message, true); }
  }));
}

// ---------------------------------------------------------------- SKILLS
async function viewSkills(_, params) {
  const v = shell({ title: t('스킬'), fab: false });
  v.innerHTML = '<div class="section"><div class="skeleton" style="height:300px"></div></div>';
  const d = await api('/api/skills');
  const f = store.get('skfilter', { tool: '', used: false });
  const draw = () => {
    let list = d.skills.filter((s) => (!f.tool || s.tool === f.tool) && (!f.used || s.uses));
    const groups = new Map();
    for (const s of list) {
      const k = `${s.tool}|${s.scopeLabel}`;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(s);
    }
    const order = { project: 0, global: 1, synced: 2, plugin: 3, builtin: 4, unlisted: 5 };
    const keys = [...groups.keys()].sort((a, b) => {
      const ga = groups.get(a)[0], gb = groups.get(b)[0];
      const ua = Math.max(0, ...groups.get(a).map((x) => x.lastUsed || 0)), ub = Math.max(0, ...groups.get(b).map((x) => x.lastUsed || 0));
      return (order[ga.scope] - order[gb.scope]) || (ub - ua);
    });
    const used30 = d.skills.filter((s) => s.uses).length;
    $('#sklist').innerHTML = `<p class="small muted" style="margin:4px 2px 12px">${t('전체 {n}개 · 최근 30일 동안 {m}개가 실제로 쓰였어요', { n: d.skills.length, m: used30 })}</p>`
      + (keys.length ? keys.map((k) => {
        const items = groups.get(k).sort((a, b) => (b.lastUsed || 0) - (a.lastUsed || 0) || a.name.localeCompare(b.name));
        const [tool, label] = k.split('|');
        return `<div class="section"><div class="section-h"><h2><span class="tool-badge ${tool}">${TOOL[tool].name}</span> ${esc(label)}</h2><span class="count">${items.length}</span></div>
          <div class="card list">${items.map((s) => `<a class="srow skrow" href="#/skill/${s.id}">
            <div class="body"><div class="t"><span class="tt">${s.kind === 'command' ? '/' : ''}${esc(s.name)}</span>${s.uses ? `<span class="flag run">${t('{n}회', { n: s.uses })}</span>` : ''}</div>
            ${s.description ? `<div class="p">${esc(s.description)}</div>` : ''}
            <div class="m">${s.lastUsed ? `<span>${t('마지막 사용 {when}', { when: ago(s.lastUsed) })}</span>` : `<span>${t('최근 30일 사용 기록 없음')}</span>`}</div></div></a>`).join('')}</div></div>`;
      }).join('') : `<div class="empty"><b>${t('조건에 맞는 스킬이 없어요')}</b></div>`);
  };
  v.innerHTML = `<div class="chips" id="skf"></div><div id="sklist"></div>`;
  const chips = () => {
    $('#skf').innerHTML = [['', t('전체')], ['claude', 'Claude'], ['codex', 'Codex'], ['agy', 'Antigravity']].map(([k, l]) => `<button class="chip ${f.tool === k ? 'on' : ''}" data-t="${k}">${l}</button>`).join('')
      + `<button class="chip ${f.used ? 'on' : ''}" id="skused">${t('쓰인 것만')}</button>`;
    $$('[data-t]', v).forEach((b) => (b.onclick = () => { f.tool = b.dataset.t; store.set('skfilter', f); chips(); draw(); }));
    $('#skused').onclick = () => { f.used = !f.used; store.set('skfilter', f); chips(); draw(); };
  };
  chips(); draw();
}

async function viewSkill([id]) {
  const v = shell({ title: t('스킬'), fab: false, right: `<a class="icon-btn" href="#/skills" aria-label="${t('목록')}">${ICON.back}</a>` });
  const s = await api(`/api/skills/${encodeURIComponent(id)}`);
  const sessions = s.sessions.length
    ? `<div class="card list">${s.sessions.map((x) => { const [tool, sid] = x.key.split(/:(.+)/); return `<a class="srow" href="#/s/${tool}/${encodeURIComponent(sid)}"><div class="tool-avatar ${tool}">${TOOL[tool]?.short || '?'}</div><div class="body"><div class="t"><span class="tt">${esc(x.cwd ? projectName(x.cwd) : sid.slice(0, 8))}</span></div><div class="m"><span>${ago(x.ts)}</span><span>· ${x.n}${t('회')}</span></div></div></a>`; }).join('')}</div>`
    : `<div class="card empty"><b>${t('최근 30일 동안 쓰인 적이 없어요')}</b>${t('설명(description)이 요청과 잘 맞아야 에이전트가 골라 써요')}</div>`;
  v.innerHTML = `
    <div class="section"><h1 class="sk-title">${s.kind === 'command' ? '/' : ''}${esc(s.name)}</h1>
      <div class="m" style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px"><span class="tool-badge ${s.tool}">${TOOL[s.tool].name}</span><span class="flag">${esc(s.scopeLabel)}</span>${s.kind === 'command' ? `<span class="flag">${t('슬래시 명령어')}</span>` : ''}</div>
      ${s.description ? `<p class="sk-desc">${esc(s.description)}</p>` : ''}
      ${s.pathShort ? `<div class="card sk-path"><b>${t('위치')}</b><code>${esc(s.pathShort)}</code>${s.files?.length ? `<span class="small muted">${t('같은 폴더:')} ${s.files.map(esc).join(', ')}</span>` : ''}</div>` : ''}
      <p class="small muted">${s.scope === 'project' ? t('이 프로젝트 폴더에서 작업할 때만 에이전트가 볼 수 있어요') : s.scope === 'unlisted' ? t('디스크에서 찾지 못한 스킬이에요 (CLI 내장이거나 지워졌어요)') : t('모든 폴더에서 에이전트가 볼 수 있어요')}</p>
    </div>
    <div class="section"><div class="section-h"><h2>${t('쓰인 세션')}</h2><span class="count">${t('{n}회', { n: s.uses })}</span></div>${sessions}</div>
    ${s.content ? `<div class="section"><div class="section-h"><h2>${s.kind === 'command' ? t('명령어 내용') : 'SKILL.md'}</h2></div><div class="card md-card msg-ai">${md(s.content.replace(/^---[\s\S]*?---\s*/, ''))}</div></div>` : ''}`;
}

// ---------------------------------------------------------------- CLEANUP / TRASH
async function viewCleanup() {
  const v = shell({ title: t('세션 정리'), fab: false });
  v.innerHTML = '<div class="section"><div class="skeleton" style="height:300px"></div></div>';
  const d = await api('/api/cleanup');
  const REASON = { '테스트 폴더': t('테스트용 폴더에서 만든 세션'), '짧은 한마디': t('"hi" 같은 한 줄로 끝난 대화'), '빈 대화': t('대화 내용이 거의 없음'), '테스트 메시지': t('AI가 테스트로 보낸 메시지'), '자동 실행': t('스크립트·다른 AI가 CLI로 호출한 세션') };
  const order = [t('테스트 폴더'), t('테스트 메시지'), t('짧은 한마디'), t('빈 대화'), t('자동 실행')];
  const sel = new Set(d.items.filter((s) => s.reason !== t('자동 실행')).map((s) => s.key));
  const groups = order.map((r) => [r, d.items.filter((s) => s.reason === r)]).filter(([, l]) => l.length);
  const shown = {};
  const draw = () => {
    $('#cl').innerHTML = groups.length ? groups.map(([r, list]) => {
      const n = shown[r] || 30;
      const all = list.every((s) => sel.has(s.key));
      return `<div class="section"><div class="section-h"><label class="ck"><input type="checkbox" data-all="${r}" ${all ? 'checked' : ''}><h2>${t(r)}</h2></label><span class="count">${list.length}</span></div>
        <p class="small muted" style="margin:-4px 2px 8px">${REASON[r]}${r === t('자동 실행') ? t(' · 지우면 프로젝트 활동 기록에서도 빠져요') : ''}</p>
        <div class="card list">${list.slice(0, n).map((s) => `<label class="srow ckrow"><input type="checkbox" data-k="${esc(s.key)}" ${sel.has(s.key) ? 'checked' : ''}>
          <div class="body"><div class="t"><span class="tt">${esc(s.title)}</span></div><div class="m"><span class="tool-badge ${s.tool}">${TOOL[s.tool].name}</span><span>${esc(projectName(s.project || s.cwd))}</span><span>· ${ago(s.updated)}</span></div></div></label>`).join('')}
        ${list.length > n ? `<button class="btn block ghost" data-more="${r}">${t('{n}개 더 보기', { n: list.length - n })}</button>` : ''}</div></div>`;
    }).join('') : `<div class="empty" style="padding-top:20vh"><b>${t('정리할 세션이 없어요 ✨')}</b></div>`;
    $('#clbar').hidden = !sel.size;
    $('#clcount').textContent = sel.size;
    $$('[data-k]', v).forEach((c) => (c.onchange = () => { c.checked ? sel.add(c.dataset.k) : sel.delete(c.dataset.k); draw(); }));
    $$('[data-all]', v).forEach((c) => (c.onchange = () => { for (const s of d.items.filter((x) => x.reason === c.dataset.all)) c.checked ? sel.add(s.key) : sel.delete(s.key); draw(); }));
    $$('[data-more]', v).forEach((b) => (b.onclick = () => { shown[b.dataset.more] = (shown[b.dataset.more] || 30) + 200; draw(); }));
  };
  v.innerHTML = `<div id="cl"></div><div class="bulkbar" id="clbar" hidden><span>${t('{n}개 선택', { n: '<b id="clcount">0</b>' })}</span><button class="btn primary danger-fill" id="cldo">${t('휴지통으로')}</button></div>`;
  draw();
  $('#cldo').onclick = async () => {
    const keys = [...sel];
    const ok = await pick(t('{n}개 세션을 휴지통으로 옮길까요?', { n: keys.length }), [{ value: true, label: t('옮기기'), desc: t('30일 안에는 휴지통에서 되살릴 수 있어요'), danger: true }, { value: false, label: t('취소') }]);
    if (!ok) return;
    $('#cldo').disabled = true; $('#cldo').innerHTML = '<div class="spinner"></div>';
    const r = await api('/api/sessions/trash', { body: { keys } });
    toast(t('{n}개를 휴지통으로 옮겼어요', { n: r.moved }) + (r.errors.length ? ` · ${t('{n}개는 건너뜀', { n: r.errors.length })}` : ''));
    render();
  };
}

async function viewTrash() {
  const v = shell({ title: t('휴지통'), fab: false });
  const d = await api('/api/trash');
  v.innerHTML = d.items.length ? `
    <p class="small muted" style="margin:4px 2px 12px">${t('지운 지 30일이 지나면 완전히 삭제돼요')}</p>
    <div class="card list">${d.items.map((s) => `<div class="srow"><div class="tool-avatar ${s.tool}">${TOOL[s.tool].short}</div>
      <div class="body"><div class="t"><span class="tt">${esc(s.title || s.id)}</span></div><div class="m"><span>${esc(projectName(s.project || ''))}</span><span>· ${t('{when} 지움', { when: ago(s.deletedAt) })}</span></div></div>
      <button class="btn sm" data-restore="${esc(s.key)}">${t('되살리기')}</button></div>`).join('')}</div>
    <button class="btn block ghost danger" id="tempty" style="margin-top:16px">${t('휴지통 비우기 ({n}개 완전 삭제)', { n: d.items.length })}</button>`
    : `<div class="empty" style="padding-top:20vh"><b>${t('휴지통이 비어 있어요')}</b></div>`;
  $$('[data-restore]', v).forEach((b) => (b.onclick = async () => { await api('/api/trash/restore', { body: { keys: [b.dataset.restore] } }); toast(t('되살렸어요')); render(); }));
  $('#tempty') && ($('#tempty').onclick = async () => {
    const ok = await pick(t('휴지통을 비울까요?'), [{ value: true, label: t('{n}개 완전 삭제', { n: d.items.length }), desc: t('되돌릴 수 없어요'), danger: true }, { value: false, label: t('취소') }]);
    if (!ok) return;
    await api('/api/trash/empty', { method: 'POST' }); toast(t('비웠어요')); render();
  });
}

async function notifyMenu(s, after) {
  const v = await pick(t('응답이 끝나면 폰으로 알림'), [
    { value: 1, label: t('🔔 다음 한 번만'), desc: t('이번 작업이 끝나면 알려주고 꺼져요') },
    { value: 2, label: t('🔔 끝날 때마다'), desc: t('PC 터미널에서 돌려도 매번 알려줘요') },
    { value: 0, label: t('알림 끄기') },
  ], s.notify || 0);
  if (v === undefined) return;
  await api(`/api/sessions/${s.tool}/${encodeURIComponent(s.id)}/meta`, { body: { notify: v } });
  toast(v ? t('끝나면 알려드릴게요') : t('알림을 껐어요'));
  after?.();
}
async function trashOne(s, after) {
  const ok = await pick(t('「{title}」을(를) 휴지통으로 옮길까요?', { title: s.title }), [{ value: true, label: t('휴지통으로'), desc: t('30일 안에는 되살릴 수 있어요'), danger: true }, { value: false, label: t('취소') }]);
  if (!ok) return false;
  const r = await api('/api/sessions/trash', { body: { keys: [`${s.tool}:${s.id}`] } });
  if (r.errors.length) { toast(r.errors[0], true); return false; }
  toast(t('휴지통으로 옮겼어요'));
  after?.();
  return true;
}

// ---------------------------------------------------------------- SETUP (onboarding)
const OS_LABEL = { windows: 'Windows', macos: 'macOS', linux: 'Linux', wsl: 'WSL (Windows Subsystem for Linux)' };

async function viewSetup() {
  const v = shell({ title: t('시작하기'), fab: false, right: `<button class="icon-btn" id="surefresh" aria-label="${t('새로고침')}">${ICON.refresh}</button>` });
  v.innerHTML = '<div class="section"><div class="skeleton" style="height:120px"></div></div><div class="section"><div class="skeleton" style="height:320px"></div></div>';
  const st = await api('/api/setup?fresh=1');
  const ok = (b) => `<span class="pill ${b ? 'ok' : 'no'}">${b ? '✓' : '✕'}</span>`;
  const anyReady = st.tools.some((x) => x.installed && (x.loggedIn || x.optionalLogin));
  const toolCard = (x) => {
    const state = !x.installed ? 'missing' : x.loggedIn ? 'ready' : x.optionalLogin ? 'ready' : 'login';
    const badge = state === 'ready' ? `<span class="pill ok">${x.loggedIn ? t('사용 준비 완료') : t('설치됨')}</span>`
      : state === 'login' ? `<span class="pill warn">${t('로그인 필요')}</span>` : `<span class="pill">${t('설치 안 됨')}</span>`;
    const btns = [];
    if (!x.installed && x.canInstall) btns.push(`<button class="btn sm primary" data-job="install" data-tool="${x.id}">${t('원클릭 설치')}</button>`);
    if (x.installed && !x.loggedIn && x.loginKind !== 'terminal') btns.push(`<button class="btn sm ${state === 'login' ? 'primary' : ''}" data-job="login" data-tool="${x.id}">${t('로그인')}</button>`);
    btns.push(`<a class="btn sm ghost" href="${esc(x.docs)}" target="_blank" rel="noopener">${t('문서')} ↗</a>`);
    return `<div class="card setup-tool" data-tool-card="${x.id}">
      <div class="sh"><span class="tool-avatar ${x.id}">${esc(TOOL[x.id]?.short || x.name[0])}</span>
        <div class="st"><b>${esc(x.name)}</b><span>${esc(x.vendor)}${x.version ? ` · v${esc(x.version)}` : ''}</span></div>${badge}</div>
      ${x.note ? `<p class="small muted">${esc(x.note)}</p>` : ''}
      ${!x.installed && x.installCmd ? `<details class="pcmd"><summary>${t('실행될 명령')}</summary><code>${esc(x.installCmd)}</code></details>` : ''}
      ${!x.installed && !x.canInstall ? `<p class="small warn-text">${t('이 OS에서는 자동 설치를 지원하지 않아요. 문서를 참고해주세요.')}</p>` : ''}
      ${x.installed && !x.loggedIn && x.loginKind === 'terminal' ? `<p class="small muted">${t('터미널에서 이 명령을 실행해 로그인하세요:')}</p><code class="copy" data-copy="${esc(x.loginCmd)}">${esc(x.loginCmd)}</code>` : ''}
      <div class="pact">${btns.join('')}</div>
      <div class="jobbox" hidden></div>
    </div>`;
  };
  const ts = st.tailscale;
  v.innerHTML = `
    <div class="section setup-hero">
      <h2>${t('바이브코딩 준비를 끝내볼게요 🏃')}</h2>
      <p class="muted">${t('Baton은 여러 AI 코딩 도구의 세션을 한곳에서 이어가게 해줘요. 쓰고 싶은 도구를 설치하고 로그인만 하면 바로 연동돼요.')}</p>
      <div class="setting lang-row"><div class="l"><b>Language · 언어</b></div>
        <select id="slang"><option value="en" ${LANG === 'en' ? 'selected' : ''}>English</option><option value="ko" ${LANG === 'ko' ? 'selected' : ''}>한국어</option></select></div>
    </div>

    <div class="section"><div class="section-h"><h2>1. ${t('내 컴퓨터')}</h2></div><div class="card env">
      <div class="setting"><div class="l"><b>${t('운영체제')}</b><span>${esc(OS_LABEL[st.os] || st.os)} · ${esc(st.arch)}</span></div>${ok(true)}</div>
      <div class="setting"><div class="l"><b>Node.js</b><span>v${esc(st.node.version)}${st.node.ok ? '' : ` — ${t('22.13 이상이 필요해요')}`}</span></div>${ok(st.node.ok)}</div>
      <div class="setting"><div class="l"><b>Git</b><span>${st.git.installed ? `v${esc(st.git.version || '')}` : t('AI 도구가 코드 변경을 관리할 때 필요해요')}</span></div>
        ${st.git.installed ? ok(true) : st.git.canInstall ? `<button class="btn sm primary" data-job="git">${t('설치')}</button>` : `<code class="copy" data-copy="${esc(st.git.hint || '')}">${esc(st.git.hint || '')}</code>`}</div>
      ${st.os === 'windows' ? `<div class="setting"><div class="l"><b>${t('WSL 추천')}</b><span>${t('Codex·Antigravity는 WSL(리눅스)에서 가장 잘 동작해요. WSL 안에서 Baton을 실행하면 모든 도구를 쓸 수 있어요.')}</span></div><a class="btn sm ghost" href="https://learn.microsoft.com/windows/wsl/install" target="_blank" rel="noopener">${t('안내')} ↗</a></div>` : ''}
      <div class="jobbox" hidden data-for="git"></div>
    </div></div>

    <div class="section"><div class="section-h"><h2>2. ${t('AI 코딩 도구')}</h2><span class="count">${st.tools.filter((x) => x.installed).length}/${st.tools.length}</span></div>
      <p class="small muted" style="margin:-4px 2px 10px">${t('하나만 있어도 충분해요. 설치하면 그 도구의 세션이 자동으로 Baton에 나타나요.')}</p>
      <div class="setup-tools">${st.tools.map(toolCard).join('')}</div></div>

    <div class="section"><div class="section-h"><h2>3. ${t('폰에서 쓰기 (선택)')}</h2></div><div class="card">
      <div class="setting"><div class="l"><b>Tailscale</b><span>${!ts.installed ? t('내 기기끼리만 연결되는 무료 VPN이에요. PC와 폰에 설치하면 밖에서도 Baton을 열 수 있어요.') : ts.url ? t('폰에서 이 주소로 열 수 있어요: {url}', { url: ts.url }) : ts.online ? t('켜져 있어요. 아래 버튼으로 Baton을 내 기기에 공유하세요.') : t('설치돼 있지만 로그인이 필요해요 (tailscale up)')}</span></div>
        ${!ts.installed ? `<a class="btn sm" href="https://tailscale.com/download" target="_blank" rel="noopener">${t('다운로드')} ↗</a>`
          : ts.url ? `<a class="btn sm ghost" href="${esc(ts.url)}" target="_blank" rel="noopener">${t('열기')} ↗</a>`
          : ts.online ? `<button class="btn sm primary" data-job="tailscale-share">${t('내 기기에 공유')}</button>` : ''}</div>
      <div class="jobbox" hidden data-for="tailscale-share"></div>
    </div></div>

    <div class="section"><div class="section-h"><h2>4. ${t('자동 시작 (선택)')}</h2></div><div class="card">
      <div class="setting"><div class="l"><b>${t('컴퓨터를 켜면 Baton도 켜기')}</b><span>${st.autostart.supported ? (st.autostart.enabled ? t('켜져 있어요') : t('로그인할 때 Baton을 백그라운드로 실행해요')) : t('이 환경에서는 지원하지 않아요 (systemd 없음). 터미널에서 npm start로 실행하세요.')}</span></div>
        ${st.autostart.supported ? `<button class="btn sm ${st.autostart.enabled ? 'ghost' : 'primary'}" data-job="${st.autostart.enabled ? 'autostart-off' : 'autostart-on'}">${st.autostart.enabled ? t('끄기') : t('켜기')}</button>` : ''}</div>
      <div class="jobbox" hidden data-for="autostart"></div>
    </div></div>

    <div class="section"><button class="btn block ${anyReady ? 'primary' : 'ghost'}" id="sdone">${anyReady ? t('대시보드로 가기 →') : t('나중에 할게요')}</button></div>`;

  $('#surefresh').onclick = () => render();
  $('#slang').onchange = async (e) => { await api('/api/settings', { body: { lang: e.target.value } }); location.reload(); };
  $('#sdone').onclick = async () => { await api('/api/settings', { body: { setupDone: true } }); await loadState(); location.hash = '#/'; };
  $$('code.copy', v).forEach((c) => (c.onclick = () => { navigator.clipboard?.writeText(c.dataset.copy); toast(t('복사했어요')); }));
  $$('[data-job]', v).forEach((b) => (b.onclick = async () => {
    const action = b.dataset.job, tool = b.dataset.tool || null;
    const box = tool ? $(`[data-tool-card="${tool}"] .jobbox`, v) : $(`.jobbox[data-for="${action.replace(/-(on|off)$/, '')}"]`, v);
    b.disabled = true;
    try {
      const { job } = await api('/api/setup/jobs', { body: { action, tool } });
      runJobBox(box, job, () => { b.disabled = false; setTimeout(() => render(), 600); });
    } catch (e) { toast(e.message, true); b.disabled = false; }
  }));
}

/** Streams a setup job into a box: live log, sign-in link button, device code, and a code/answer input. */
function runJobBox(box, job, onEnd) {
  box.hidden = false;
  box.innerHTML = `<div class="jhead"><div class="spinner"></div><b>${esc(job.label)}</b><button class="btn sm ghost" data-stop>${t('중지')}</button></div>
    <div class="jlinks"></div><pre class="jlog"></pre>
    <form class="jinput" hidden><input type="text" placeholder="${t('코드나 답을 붙여넣고 Enter')}" autocomplete="off"><button class="btn sm">${t('보내기')}</button></form>`;
  const log = $('.jlog', box), links = $('.jlinks', box), form = $('.jinput', box);
  $('[data-stop]', box).onclick = () => api(`/api/setup/jobs/${job.id}/stop`, { method: 'POST' });
  form.onsubmit = async (e) => {
    e.preventDefault();
    const inp = $('input', form);
    if (!inp.value.trim()) return;
    await api(`/api/setup/jobs/${job.id}/input`, { body: { text: inp.value.trim() } });
    inp.value = '';
  };
  const es = new EventSource(`/api/setup/jobs/${job.id}/stream`);
  es.onmessage = (m) => {
    const ev = JSON.parse(m.data);
    if (ev.t === 'line') {
      log.textContent += `${ev.text}\n`;
      log.scrollTop = log.scrollHeight;
      if (/paste|code|코드|enter|입력/i.test(ev.text)) form.hidden = false;
    } else if (ev.t === 'url') {
      links.insertAdjacentHTML('beforeend', `<a class="btn sm primary" href="${esc(ev.url)}" target="_blank" rel="noopener">${t('로그인 페이지 열기')} ↗</a>`);
      form.hidden = false;
    } else if (ev.t === 'code') {
      links.insertAdjacentHTML('beforeend', `<div class="devcode"><span>${t('이 코드를 입력하세요')}</span><b>${esc(ev.code)}</b></div>`);
    } else if (ev.t === 'end') {
      es.close();
      $('.jhead', box).innerHTML = `<b>${ev.ok ? '✅' : '⚠️'} ${esc(job.label)} — ${ev.ok ? t('완료') : t('실패 (코드 {code})', { code: ev.code })}</b>`;
      form.hidden = true;
      onEnd?.(ev);
    }
  };
  es.onerror = () => { /* the server closes the stream at the end */ };
}

// ---------------------------------------------------------------- boot
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
navigator.serviceWorker?.addEventListener('message', (e) => { if (e.data?.type === 'navigate' && e.data.url) location.href = e.data.url; });
(async () => {
  $$('[data-t]', $('#tabbar')).forEach((el) => { el.textContent = t(el.dataset.t); });
  await loadState();
  // first run: nothing set up yet -> onboarding
  if (G.state && !G.state.settings?.setupDone && !(G.state.tools || []).some((x) => x.installed) && !location.hash.startsWith('#/setup')) location.hash = '#/setup';
  render();
})();
