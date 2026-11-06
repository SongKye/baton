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
    // swipe down to dismiss — but never from inside a text field (selecting / scrolling text) or a scrolled area.
    // touchmove is non-passive so a drag on the sheet (or scrim) never scroll-chains into the page behind it.
    let y0 = null, yLast = 0, dragging = false;
    const field = (t) => t.closest?.('input, textarea, select, [contenteditable]');
    const scrolled = (t) => { for (let n = t; n && n !== el; n = n.parentElement) if (n.scrollTop > 0) return true; return false; };
    const canScroll = (t, up) => {
      for (let n = t; n && n !== el; n = n.parentElement) {
        if (n.scrollHeight <= n.clientHeight + 1 || !/(auto|scroll)/.test(getComputedStyle(n).overflowY)) continue;
        if (up ? n.scrollTop + n.clientHeight < n.scrollHeight - 1 : n.scrollTop > 0) return true;
      }
      return false;
    };
    scrim.addEventListener('touchmove', (e) => { if (e.cancelable) e.preventDefault(); }, { passive: false });
    el.addEventListener('touchstart', (e) => {
      const tg = e.target;
      yLast = e.touches[0].clientY;
      y0 = field(tg) || scrolled(tg) ? null : yLast;
      dragging = false;
    }, { passive: true });
    el.addEventListener('touchmove', (e) => {
      const y = e.touches[0].clientY, step = y - yLast; yLast = y;
      if (y0 != null) {
        const dy = y - y0;
        if (!dragging && dy < -6) y0 = null; // moved up first → it's a content scroll, not a dismiss
        else if (dragging || dy > 12) {
          if (!dragging) { dragging = true; el.style.transition = 'none'; }
          if (e.cancelable) e.preventDefault();
          el.style.transform = `translateY(${Math.max(0, dy - 12)}px)`;
          return;
        }
      }
      // not dragging: let inner scrollers / text fields scroll, but never chain the gesture to the page behind
      if (e.cancelable && !field(e.target) && !canScroll(e.target, step < 0)) e.preventDefault();
    }, { passive: false });
    const endDrag = (e) => {
      if (y0 != null && dragging) {
        const dy = e.changedTouches[0].clientY - y0;
        el.style.transition = '';
        el.style.transform = '';
        if (dy > 100) close(undefined);
      }
      y0 = null; dragging = false;
    };
    el.addEventListener('touchend', endDrag);
    el.addEventListener('touchcancel', endDrag);
    onMount?.(el, close);
  });
}
function pick(title, options, current) {
  const body = options.map((o, i) => `<button class="opt-row ${o.danger ? 'danger' : ''}" data-i="${i}"><div class="l"><b>${esc(o.label)}</b>${o.desc ? `<span>${esc(o.desc)}</span>` : ''}</div>${current !== undefined && o.value === current ? `<span class="check">${ICON.check}</span>` : ''}</button>`).join('');
  return sheet({ title, body, onMount: (el, close) => $$('.opt-row', el).forEach((b) => (b.onclick = () => close(options[+b.dataset.i].value))) });
}
function folderPicker(initial, { suggestions = [], allowNew = true } = {}) {
  return sheet({
    title: t('작업 폴더 선택'),
    body: `<p class="small muted">${t('Baton이 실행 중인 컴퓨터의 폴더예요')}</p>
      <div class="folder-tools"><button class="btn sm" data-home>${t('홈 폴더')}</button><button class="btn sm" data-up>${t('상위 폴더')}</button><button class="btn sm" data-path>${t('경로 입력')}</button></div>
      <p class="folder-path" data-current></p>
      <input type="text" data-search placeholder="${t('폴더·프로젝트 이름 검색')}" aria-label="${t('폴더·프로젝트 이름 검색')}">
      <label class="small"><input type="checkbox" data-hidden> ${t('숨김 폴더 표시')}</label>
      <div data-folders aria-live="polite"></div>`,
    footer: `<button class="btn ghost" data-cancel>${t('취소')}</button><button class="btn primary" data-select disabled>${t('이 폴더 선택')}</button>`,
    onMount: (el, close) => {
      let current = null, serial = 0, navigation = 0, timer;
      const list = $('[data-folders]', el), search = $('[data-search]', el), select = $('[data-select]', el);
      const draw = async () => {
        const id = ++serial, q = search.value.trim().toLowerCase();
        if (!current) return;
        let known = suggestions.filter((x) => !q || `${x.label} ${x.value}`.toLowerCase().includes(q));
        {
          try { const r = await api('/api/dirs?q=' + encodeURIComponent(q)); known = [...known, ...r.items.filter((x) => !known.some((k) => k.value === x.path)).map((x) => ({ value: x.path, label: x.name, desc: x.path }))]; }
          catch { /* Browsing the current directory remains available. */ }
        }
        if (id !== serial) return;
        const folders = current.items.filter((x) => ($('[data-hidden]', el).checked || !x.hidden) && (!q || x.name.toLowerCase().includes(q)));
        const rows = [...folders.map((x) => ({ value: x.path, label: x.name, desc: x.path })), ...known.filter((x) => !folders.some((f) => f.path === x.value))];
        list.innerHTML = rows.map((x, i) => `<button class="opt-row" data-folder="${i}"><div class="l"><b>📁 ${esc(x.label)}</b><span>${esc(x.desc || x.value)}</span></div><span>›</span></button>`).join('') || `<p class="small muted">${t('일치하는 폴더가 없어요')}</p>`;
        $$('[data-folder]', el).forEach((b) => b.onclick = () => open(rows[+b.dataset.folder].value));
      };
      const open = async (path) => {
        const id = ++navigation;
        ++serial; clearTimeout(timer); current = null;
        select.disabled = true; search.disabled = true;
        $('[data-up]', el).disabled = true;
        list.textContent = t('불러오는 중…');
        try {
          const d = await api('/api/dirs/browse?path=' + encodeURIComponent(path));
          if (id !== navigation) return;
          current = d; search.value = ''; search.disabled = false;
          $('[data-current]', el).textContent = d.path;
          $('[data-up]', el).disabled = !d.parent;
          select.disabled = false;
          draw();
        } catch (e) {
          if (id !== navigation) return;
          current = null; search.disabled = false; list.textContent = e.message;
          $('[data-current]', el).textContent = path;
          $('[data-up]', el).disabled = true;
        }
      };
      search.oninput = () => { ++serial; clearTimeout(timer); timer = setTimeout(draw, 180); };
      $('[data-hidden]', el).onchange = draw;
      $('[data-home]', el).onclick = () => open('~');
      $('[data-up]', el).onclick = () => current?.parent && open(current.parent);
      $('[data-cancel]', el).onclick = () => close();
      select.onclick = () => current && close(current.path);
      $('[data-path]', el).onclick = async () => {
        const p = await promptSheet(t('폴더 경로'), current?.path || initial);
        if (!p?.trim()) return;
        if (allowNew) {
          try { await api('/api/dirs/browse?path=' + encodeURIComponent(p.trim())); }
          catch (e) { if (e.data?.code !== 'ENOENT') { toast(e.message, true); return; } const yes = await pick(t('폴더를 열 수 없어요'), [{ value: true, label: t('이 경로 사용 (새 폴더는 시작할 때 생성)') }, { value: false, label: t('취소') }]); if (yes) close(p.trim()); return; }
        }
        open(p.trim());
      };
      open(initial || G.state?.defaultCwd || '~');
    },
  });
}

function promptSheet(title, value = '', { multiline = false, placeholder = '', okLabel = '' } = {}) {
  const field = multiline ? `<textarea placeholder="${esc(placeholder)}">${esc(value)}</textarea>` : `<input type="text" value="${esc(value)}" placeholder="${esc(placeholder)}">`;
  return sheet({
    title, body: `<div style="padding:0 8px">${field}</div>`, footer: `<button class="btn ghost" data-x>${t('취소')}</button><button class="btn primary" data-ok>${okLabel || t('저장')}</button>`,
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
    normalizeAgyCatalog(G.state.catalogs?.agy);
    for (const x of G.state.tools || []) if (TOOL[x.id]) TOOL[x.id].installed = x.installed;
    updateRunPill(G.state.runs);
    deskCardsPoll(G.state.lastEventId);
  } catch (e) { /* offline */ }
}

// ---------------------------------------------------------------- desktop notification cards (bottom-right)
const DESK_MQ = matchMedia('(min-width: 900px) and (hover: hover) and (pointer: fine)');
const deskCardsOn = () => DESK_MQ.matches && localStorage.getItem('baton.deskCards') !== '0';
// With push on, the service worker shows an OS notification whenever no Baton tab is focused,
// so cards only cover events that happened while this tab had focus (no duplicates).
const desk = { floor: null, focusedSince: document.hasFocus() ? 0 : Infinity, pushOn: false, busy: false };
addEventListener('focus', () => { desk.focusedSince = Date.now(); });
addEventListener('blur', () => { desk.focusedSince = Infinity; });
async function deskCardsPoll(lastId) {
  if (lastId == null) return;
  if (desk.floor == null || !deskCardsOn()) { desk.floor = lastId; return; }
  if (lastId <= desk.floor || desk.busy) return;
  desk.busy = true;
  try {
    const { items } = await api(`/api/events/after/${desk.floor}`);
    for (const ev of items) {
      desk.floor = Math.max(desk.floor, ev.id);
      // Already looking at that session, or the OS notification covered it while this tab was in the background.
      if (ev.url && ev.url !== '/#/' && location.hash && ev.url.endsWith(location.hash)) continue;
      if (desk.pushOn && ev.ts < desk.focusedSince) continue;
      if (Date.now() - ev.ts > 10 * 60 * 1000 || ev.quiet) continue; // muted session/project: inbox only
      deskCard(ev);
    }
    desk.floor = Math.max(desk.floor, lastId);
  } catch { /* offline */ } finally { desk.busy = false; }
}
function deskCard(ev) {
  let wrap = $('#deskcards');
  if (!wrap) { wrap = document.createElement('div'); wrap.id = 'deskcards'; wrap.className = 'deskcards'; document.body.append(wrap); }
  while (wrap.children.length >= 4) wrap.firstElementChild.remove();
  const el = document.createElement('a');
  el.className = `deskcard k-${esc(ev.kind || '')}`;
  el.href = ev.url || '#/';
  el.innerHTML = `<img src="/icon-192.png?v=2" alt=""><div class="b"><div class="tt">${esc(ev.title || 'Baton')}</div>${ev.body ? `<div class="bd">${esc(ev.body)}</div>` : ''}</div><button class="x" aria-label="${t('닫기')}">${ICON.x}</button>`;
  const close = () => { el.classList.add('out'); setTimeout(() => el.remove(), 220); };
  el.querySelector('.x').onclick = (e) => { e.preventDefault(); e.stopPropagation(); close(); };
  el.addEventListener('click', () => setTimeout(close, 50));
  let timer = setTimeout(close, 8000);
  el.onmouseenter = () => clearTimeout(timer);
  el.onmouseleave = () => { timer = setTimeout(close, 4000); };
  wrap.append(el);
}

function updateRunPill(runs) {
  const prev = G.lastRunIds;
  const nowIds = new Set(runs.map((r) => r.id));
  // A run disappeared from "running" -> it finished; tell the user if they're elsewhere.
  for (const id of prev) {
    if (!nowIds.has(id)) {
      const r = G.runs.find((x) => x.id === id);
      if (r && !deskCardsOn() && !(location.hash.includes(encodeURIComponent(r.sessionId || '__')))) toast(`${t('✅ 응답 완료:')} ${r.title || r.prompt || ''}`.slice(0, 60));
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
  [/^#\/mcp$/, viewMcps, 'tools'],
  [/^#\/mcp\/(.+)$/, viewMcp, 'tools'],
  [/^#\/cleanup$/, viewCleanup, 'tools'],
  [/^#\/trash$/, viewTrash, 'tools'],
  [/^#\/scheduled$/, viewScheduled, 'tools'],
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
  if (s.notify < 0) flags.push(`<span class="flag bell" title="${t('알림 꺼짐')}">🔕</span>`);
  const preview = s.lastReply || s.lastPrompt || s.firstPrompt || '';
  return `<a class="srow" href="#/s/${s.tool}/${encodeURIComponent(s.id)}">
    <div class="tool-avatar ${s.tool}">${TOOL[s.tool].short}${s.live ? `<i class="live-dot ${s.running || s.terminal === 'busy' ? 'busy' : ''}"></i>` : ''}</div>
    <div class="body">
      <div class="t">${s.pinned ? '<span>📌</span>' : ''}<span class="tt">${esc(s.title)}</span>${s.unseen ? '<i class="unseen"></i>' : ''}</div>
      <div class="m"><span>${TOOL[s.tool].name}</span>${showProject && s.project ? `<span>· ${esc(projectName(s.project))}</span>` : ''}<span>· ${ago(s.updated)}</span>${flags.join('')}</div>
      ${preview ? `<div class="p">${esc(preview)}</div>` : ''}
    </div><span class="srow-more" role="button" tabindex="0" aria-label="${t('세션 메뉴')}">${ICON.more}</span></a>`;
}
/** Session rows have a ⋯ button: open the session menu right from the list, without entering the chat. */
function onRowMore(e) {
  const b = e.target.closest?.('.srow-more'); if (!b) return;
  if (e.type === 'keydown' && e.key !== 'Enter' && e.key !== ' ') return;
  e.preventDefault(); e.stopPropagation();
  const a = b.closest('a.srow'); if (a) sessionMenuFromHref(a.getAttribute('href'));
}
document.addEventListener('click', onRowMore, true);
document.addEventListener('keydown', onRowMore, true);
/** Checkbox row for bulk selection (Sessions tab, project page). Running sessions can't be selected. */
function selRow(s, { showProject = true } = {}) {
  return `<label class="srow ckrow"><input type="checkbox" data-k="${esc(s.key)}" ${s.live ? 'disabled' : ''}>
    <div class="body"><div class="t"><span class="tt">${esc(s.title)}</span></div><div class="m"><span class="tool-badge ${s.tool}">${TOOL[s.tool].name}</span>${showProject ? `<span>${esc(projectName(s.project || s.cwd))}</span>` : ''}<span>· ${ago(s.updated)}</span>${s.live ? `<span class="flag warn">${t('실행 중')}</span>` : ''}</div></div></label>`;
}
/** Bulk "move to trash" for the selected session keys; true when it went ahead. */
async function trashMany(keys) {
  if (!keys.length) return false;
  const ok = await pick(t('{n}개 세션을 휴지통으로 옮길까요?', { n: keys.length }), [{ value: true, label: t('옮기기'), desc: t('30일 안에는 휴지통에서 되살릴 수 있어요'), danger: true }, { value: false, label: t('취소') }]);
  if (!ok) return false;
  const r = await api('/api/sessions/trash', { body: { keys } });
  toast(t('{n}개를 휴지통으로 옮겼어요', { n: r.moved }));
  return true;
}
function toolDots(tools) { return `<span class="tooldots">${Object.keys(tools || {}).map((k) => `<i class="${k}"></i>`).join('')}</span>`; }
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
async function viewHome(_, params) {
  const hour = new Date().getHours();
  const greet = hour < 6 ? t('늦은 밤이에요 🌙') : hour < 12 ? t('좋은 아침이에요 ☀️') : hour < 18 ? t('오후도 힘내요 🏃') : t('오늘 하루 수고했어요 🌆');
  const v = shell({ title: 'Baton', sub: greet });
  $('.topbar h1').classList.add('home-brand');
  $('.topbar h1').insertAdjacentHTML('afterbegin', '<span class="baton-mark" aria-hidden="true"></span>');
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
  const up = G.state?.update;
  if (up?.newer && store.get('update.dismissed', '') !== up.latest) {
    parts.unshift(`<div class="section"><div class="banner update-banner"><span>🎉 ${t('Baton v{v}이 나왔어요', { v: esc(up.latest) })} <span class="muted">· ${t('지금 v{c}', { c: esc(up.current) })}</span></span>
      <button class="btn sm primary" id="upopen">${t('업데이트')}</button><button class="icon-btn" id="upx" aria-label="${t('닫기')}">${ICON.x}</button></div></div>`);
  }
  v.innerHTML = parts.join('');
  $$('[data-snooze]', v).forEach((b) => (b.onclick = () => snoozeFlow(b.dataset.snooze, () => render())));
  $('#upopen', v) && ($('#upopen', v).onclick = () => updateSheet());
  $('#upx', v) && ($('#upx', v).onclick = () => { store.set('update.dismissed', up.latest); $('#upx', v).closest('.section').remove(); });
  if (params?.get('update')) updateSheet();
  homeUsageCard();
}

/** "What's new" + update in place (git installs) or download link (zip installs). */
async function updateSheet({ check = false } = {}) {
  let d;
  try { d = await api(check ? '/api/update/check' : '/api/update', check ? { method: 'POST' } : undefined); }
  catch (e) { toast(e.message, true); return; }
  if (G.state) G.state.update = { current: d.current, latest: d.latest, newer: d.newer };
  if (!d.newer) {
    toast(d.error ? t('새 버전을 확인하지 못했어요 ({e})', { e: d.error }) : t('최신 버전이에요 (v{v})', { v: d.current }), Boolean(d.error));
    return;
  }
  const i = d.install || {};
  const how = i.canAuto ? `<p class="small muted">${t('버튼을 누르면 새 버전을 받고(git pull) 필요한 패키지를 설치한 뒤 Baton을 다시 켜요. 대화 기록과 설정은 그대로예요.')}</p>`
    : i.kind === 'git' ? `<p class="small warn-text">${i.dirty ? t('Baton 폴더에 고친 파일이 있어서 자동으로 업데이트하지 않아요.') : t('지금 {b} 브랜치라 자동으로 업데이트하지 않아요.', { b: esc(i.branch || '?') })}</p><p class="small muted">${t('터미널에서 직접 실행하세요:')}</p><code class="copy" data-copy="git pull --ff-only && npm ci --omit=dev">git pull --ff-only && npm ci --omit=dev</code>`
      : `<p class="small muted">${t('zip으로 설치했어요. 새 zip을 받아 압축을 풀고, 기존 data 폴더를 옮긴 뒤 설치 스크립트를 다시 실행하세요.')}</p>`;
  await sheet({
    title: `🎉 Baton v${esc(d.latest)}`,
    body: `<div class="update-sheet"><p class="small muted">${t('지금 쓰는 버전: v{c}', { c: esc(d.current) })}${d.publishedAt ? ` · ${t('{when} 출시', { when: ago(d.publishedAt) })}` : ''}</p>
      <div class="card md-card msg-ai update-notes">${d.notes ? md(d.notes) : `<p>${t('바뀐 점은 릴리스 페이지에서 볼 수 있어요')}</p>`}</div>${how}<div class="jobbox" hidden></div></div>`,
    footer: `<a class="btn ghost" href="${esc(d.url)}" target="_blank" rel="noopener">${t('릴리스 페이지')} ↗</a>${i.canAuto ? `<button class="btn primary" data-up>${t('지금 업데이트')}</button>` : d.zip ? `<a class="btn primary" href="${esc(d.zip)}">${t('zip 받기')}</a>` : ''}`,
    onMount: (el) => {
      $$('code.copy', el).forEach((c) => (c.onclick = () => { navigator.clipboard?.writeText(c.dataset.copy); toast(t('복사했어요')); }));
      const b = $('[data-up]', el);
      if (!b) return;
      b.onclick = async () => {
        b.disabled = true;
        try {
          const { job } = await api('/api/setup/jobs', { body: { action: 'update' } });
          runJobBox($('.jobbox', el), job, async (ev) => {
            if (!ev.ok) { b.disabled = false; toast(t('업데이트하지 못했어요. 로그를 확인해주세요'), true); return; }
            b.textContent = t('다시 켜는 중…');
            await api('/api/update/restart', { method: 'POST' }).catch(() => {});
            // wait for the new server, then reload into the new version
            for (let k = 0; k < 60; k++) {
              await new Promise((r) => setTimeout(r, 2000));
              try { const st = await api('/api/state'); if (st.version === d.latest) { location.reload(); return; } } catch { /* restarting */ }
            }
            toast(t('다시 켜지지 않았어요. PC에서 Baton을 직접 실행해주세요'), true);
          });
        } catch (e) { toast(e.message, true); b.disabled = false; }
      };
    },
  });
}

// ---------------------------------------------------------------- PROJECTS
async function viewProjects(_, params) {
  const v = shell({ title: t('프로젝트') });
  let filter = params.get('f') || store.get('pfilter', 'active');
  v.innerHTML = '<div class="skeleton" style="height:300px;margin-top:10px"></div>';
  const d = await api('/api/projects');
  let query = '';
  const dozing = new Set(d.dozing);
  const counts = { active: 0, dozing: dozing.size, paused: 0, done: 0, archived: 0, all: d.items.length };
  for (const p of d.items) counts[p.status] = (counts[p.status] || 0) + 1;
  const draw = () => {
    store.set('pfilter', filter);
    const items = d.items.filter((p) => filter === 'all' || (filter === 'dozing' ? dozing.has(p.id) : p.status === filter));
    const labels = { active: t('진행중'), dozing: t('💤 잠자는'), paused: t('보류'), done: t('완료'), archived: t('보관'), all: t('전체') };
    v.innerHTML = `<div class="chips" style="margin-bottom:12px">${Object.keys(labels).map((k) => `<button class="chip ${k === filter ? 'on' : ''}" data-f="${k}">${labels[k]} <span class="n">${counts[k] || 0}</span></button>`).join('')}</div>
      ${filter === 'dozing' ? `<div class="banner" style="margin-bottom:10px">${t('한동안 손대지 않은 프로젝트예요. 이어서 할지, 보류할지 정리해두면 머리가 가벼워져요.')}</div>` : ''}
      <input class="project-search" type="search" placeholder="${t('프로젝트 이름·경로 검색')}" aria-label="${t('프로젝트 이름·경로 검색')}" value="${esc(query)}">
      <div class="list" data-project-list>${items.filter((p) => `${p.name} ${p.id}`.toLowerCase().includes(query.toLowerCase())).map(projectRow).join('') || `<div class="empty"><b>${t('비어 있어요')}</b></div>`}</div>`;
    $('.project-search', v).oninput = (e) => { query = e.target.value; $('[data-project-list]', v).innerHTML = items.filter((p) => `${p.name} ${p.id}`.toLowerCase().includes(query.toLowerCase())).map(projectRow).join('') || `<div class="empty">${t('비어 있어요')}</div>`; };
    $$('[data-f]', v).forEach((b) => (b.onclick = () => { filter = b.dataset.f; draw(); }));
  };
  draw();
}

async function viewProject([id]) {
  const v = shell({ title: '…', fab: false });
  const head = $('.topbar');
  head.insertAdjacentHTML('afterbegin', `<a class="icon-btn" href="#/projects" style="margin-left:-10px">${ICON.back}</a>`);
  v.innerHTML = '<div class="skeleton" style="height:160px;margin-top:10px"></div>';
  let showAuto = false, selecting = false, noteEditing = false, reloadAfterNote = false;
  const sel = new Set();
  G.cleanup = () => document.body.classList.remove('selecting');
  const load = async () => {
    if (noteEditing) { reloadAfterNote = true; return; } // don't wipe a memo that's being typed
    const d = await api(`/api/projects/${encodeURIComponent(id)}${showAuto ? '?automated=1' : ''}`);
    const p = d.project;
    $('.topbar h1').textContent = p.name;
    // load() re-runs after every edit — update the header in place instead of appending again.
    let sub = head.querySelector('h1 + .sub');
    if (!sub) { $('.topbar h1').insertAdjacentHTML('afterend', '<div class="sub"></div>'); sub = head.querySelector('h1 + .sub'); }
    sub.textContent = p.path;
    head.querySelector('.icon-btn[href="#/inbox"]')?.replaceWith(Object.assign(document.createElement('button'), { className: 'icon-btn', id: 'pmore', innerHTML: ICON.more }));
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
      ${p.muted ? `<div class="section"><div class="banner">🔕 ${t('이 프로젝트는 알림이 꺼져 있어요')} <button class="btn sm" id="punmute">${t('다시 켜기')}</button></div></div>` : ''}
      <div class="section" id="pnote"><div class="section-h"><h2>${t('메모')}</h2></div>
        ${p.note ? `<button class="card memo" id="pnotecard" title="${t('눌러서 고치기')}">${esc(p.note)}</button>`
          : `<button class="memo-empty" id="pnotecard">📝 ${t('메모 남기기')}<span>${t('다음에 돌아왔을 때 볼 메모')}</span></button>`}</div>
      <div class="section"><div class="section-h"><h2>${t('세션')}</h2><span class="count">${human.length}${p.autoSessions ? ` · ${t('자동 {n}', { n: p.autoSessions })}` : ''}</span>
        <button class="more" id="autotoggle">${showAuto ? t('자동 실행 숨기기') : (p.autoSessions ? t('자동 실행 보기') : '')}</button>
        ${d.sessions.length ? `<button class="more" id="pselbtn">${selecting ? t('완료') : t('선택')}</button>` : ''}</div>
        <div class="card list" id="plist">${d.sessions.slice(0, 40).map((s) => (selecting ? selRow(s, { showProject: false }) : sessionRow(s, { showProject: false }))).join('') || `<div class="empty">${t('세션이 없어요')}</div>`}</div>
        <div style="display:flex;gap:8px;margin-top:10px">
          ${latest ? `<a class="btn block" href="#/s/${latest.tool}/${encodeURIComponent(latest.id)}">${t('최근 세션 열기')}</a>` : ''}
          <a class="btn block primary" href="#/new?cwd=${encodeURIComponent(p.path)}">${t('새 세션')}</a>
        </div>
      </div>
      <div class="section" id="pmcp"></div>
      ${gitHtml}
      <div class="bulkbar" id="pbar" ${selecting ? '' : 'hidden'}><button class="btn sm ghost" id="pall">${t('전체 선택')}</button><span>${t('{n}개 선택', { n: '<b id="pcount">0</b>' })}</span><button class="btn primary danger-fill" id="ptrash">${t('휴지통으로')}</button></div>`;
    loadProjectMcp($('#pmcp'), p.path);
    // memo: tap it to edit right there
    const editNote = () => {
      if (noteEditing) return;
      noteEditing = true;
      const box = $('#pnote');
      box.innerHTML = `<div class="section-h"><h2>${t('메모')}</h2></div>
        <div class="card memo-edit"><textarea id="pnotetxt" placeholder="${t('예) 결제 붙이기 전에 약관 먼저 정리')}" maxlength="2000">${esc(p.note || '')}</textarea>
          <div class="memo-act"><span class="small muted">${t('Ctrl+Enter로 저장')}</span><button class="btn sm ghost" data-nx>${t('취소')}</button><button class="btn sm primary" data-nok>${t('저장')}</button></div></div>`;
      const ta = $('#pnotetxt', box);
      const fit = () => { ta.style.height = 'auto'; ta.style.height = `${Math.min(ta.scrollHeight + 2, innerHeight * 0.6)}px`; };
      fit(); ta.oninput = fit;
      ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length);
      const finish = async (save) => {
        if (save && ta.value !== (p.note || '')) {
          try { await api(`/api/projects/${encodeURIComponent(id)}/meta`, { body: { note: ta.value } }); toast(t('메모를 저장했어요')); }
          catch (e) { toast(e.message, true); return; }
        }
        noteEditing = false; reloadAfterNote = false; load();
      };
      $('[data-nok]', box).onclick = () => finish(true);
      $('[data-nx]', box).onclick = () => finish(false);
      ta.onkeydown = (e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); finish(true); }
        else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
      };
    };
    $('#pnotecard').onclick = editNote;
    $('#punmute') && ($('#punmute').onclick = async () => { await api(`/api/projects/${encodeURIComponent(id)}/meta`, { body: { muted: false } }); toast(t('알림을 다시 켰어요')); load(); });
    // session list: ⋯ / long-press menu, or checkboxes for bulk trash
    const shown = d.sessions.slice(0, 40);
    const drawBar = () => { $('#pcount').textContent = sel.size; $('#ptrash').disabled = !sel.size; };
    if (!selecting) attachLongPress($('#plist'));
    $$('[data-k]', v).forEach((c) => { c.checked = sel.has(c.dataset.k); c.onchange = () => { c.checked ? sel.add(c.dataset.k) : sel.delete(c.dataset.k); drawBar(); }; });
    drawBar();
    $('#pselbtn') && ($('#pselbtn').onclick = () => { selecting = !selecting; sel.clear(); document.body.classList.toggle('selecting', selecting); load(); });
    $('#pall').onclick = () => {
      const ok = shown.filter((s) => !s.live);
      const all = ok.every((s) => sel.has(s.key));
      for (const s of ok) all ? sel.delete(s.key) : sel.add(s.key);
      $$('[data-k]', v).forEach((c) => { c.checked = sel.has(c.dataset.k); }); drawBar();
    };
    $('#ptrash').onclick = async () => {
      if (!(await trashMany([...sel]))) return;
      sel.clear(); selecting = false; document.body.classList.remove('selecting'); load();
    };
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
        { value: 'note', label: p.note ? t('메모 고치기') : t('메모 남기기'), desc: t('다음에 돌아왔을 때 볼 메모 (메모를 눌러도 고칠 수 있어요)') },
        { value: 'mute', label: p.muted ? t('🔔 이 프로젝트 알림 다시 켜기') : t('🔕 이 프로젝트 알림 끄기'), desc: p.muted ? t('세션 응답이 끝날 때마다 다시 알려줘요') : t('이 프로젝트의 모든 세션은 끝나도 알리지 않아요 (알림함에는 남아요)') },
        { value: 'snooze', label: t('알림 미루기 / 상태 정리') },
      ]);
      if (act === 'pin') await api(`/api/projects/${encodeURIComponent(id)}/meta`, { body: { pinned: !p.pinned } });
      else if (act === 'rename') { const n = await promptSheet(t('프로젝트 이름'), p.name); if (n !== undefined) await api(`/api/projects/${encodeURIComponent(id)}/meta`, { body: { name: n } }); }
      else if (act === 'note') { $('#pnote').scrollIntoView({ behavior: 'smooth', block: 'center' }); return editNote(); }
      else if (act === 'mute') { await api(`/api/projects/${encodeURIComponent(id)}/meta`, { body: { muted: !p.muted } }); toast(p.muted ? t('알림을 다시 켰어요') : t('이 프로젝트 알림을 껐어요')); }
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
    $$('[data-k]', v).forEach((c) => { c.checked = sel.has(c.dataset.k); c.onchange = () => { c.checked ? sel.add(c.dataset.k) : sel.delete(c.dataset.k); drawBar(); }; });
    drawBar();
  };
  const drawBar = () => { $('#sbar').hidden = !selecting; $('#scount').textContent = sel.size; $('#strash').disabled = !sel.size; };
  $('#selbtn').onclick = () => { selecting = !selecting; sel.clear(); $('#selbtn').textContent = selecting ? t('완료') : t('선택'); document.body.classList.toggle('selecting', selecting); draw(); };
  $('#sall').onclick = () => { const all = items.filter((s) => !s.live).every((s) => sel.has(s.key)); for (const s of items) if (!s.live) all ? sel.delete(s.key) : sel.add(s.key); draw(); };
  $('#strash').onclick = async () => {
    if (!(await trashMany([...sel]))) return;
    sel.clear(); await reload();
  };
  G.cleanup = () => document.body.classList.remove('selecting');
  const reload = async () => { store.set('sfilter', f); drawChips(); offset = 0; await fetchPage(); draw(); };
  let searchTimer;
  $('#sq').oninput = (e) => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { q = e.target.value.trim(); sessionStorage.setItem('sq', q); reload(); }, 220); };
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
    { value: 'notify', label: s.notify < 0 ? t('🔔 이 세션 알림 다시 켜기') : t('🔕 이 세션 알림 끄기'), desc: s.notify < 0 ? t('응답이 끝날 때마다 다시 알려줘요') : t('응답이 끝나도 폰·PC로 알리지 않아요 (알림함에는 남아요)') },
    { value: 'schedule', label: t('⏰ 메시지 예약'), desc: t('한도가 풀리면 바로, 또는 정한 시각에 이 세션으로 보내요') },
    { value: 'newhere', label: t('➕ 이 프로젝트에서 새 세션'), desc: t('같은 폴더에서 원하는 CLI로 새 작업을 시작해요 (맥락은 넘기지 않아요)') },
    { value: 'mcp', label: t('🔌 MCP 서버 보기'), desc: t('이 세션이 불러오는 MCP와 실제로 호출한 도구') },
    { value: 'move', label: t('📁 작업 폴더 옮기기'), desc: s.moved ? t('지금: {p}', { p: s.cwd }) : t('실제 작업하는 프로젝트 폴더로 이 세션을 옮겨요') },
    { value: 'handoff', label: t('🔀 다른 CLI로 이어가기'), desc: t('토큰이 부족할 때 다른 도구가 이 세션을 이어받아요') },
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
  else if (act === 'notify') { await meta({ notify: s.notify < 0 ? 0 : -1 }); toast(s.notify < 0 ? t('알림을 다시 켰어요') : t('이 세션 알림을 껐어요')); }
  else if (act === 'newhere') { await newSessionHere(s); return; }
  else if (act === 'schedule') { if (await scheduleSheet(s)) after?.(); return; }
  else if (act === 'mcp') { await mcpSessionSheet(s); return; }
  else if (act === 'move') { if (await moveSessionSheet(s)) after?.(); return; }
  else if (act === 'handoff') { const d = await api(`/api/sessions/${s.tool}/${encodeURIComponent(s.id)}?limit=1&seen=0`).catch(() => ({})); await handoffSheet(s, d.links); return; }
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
/** mcp__context7__resolve-library-id -> "🔌 context7 · resolve-library-id" (escaped HTML). */
function toolLabel(name) {
  const m = /^mcp__(.+?)__(.+)$/.exec(String(name || ''));
  if (!m) return esc(name);
  const server = m[1].startsWith('claude_ai_') ? `claude.ai ${m[1].slice(10).replace(/_/g, ' ')}` : m[1];
  return `🔌 ${esc(server)} <span class="muted">· ${esc(m[2])}</span>`;
}
function toolsHtml(items, open = false) {
  const tools = items.filter((x) => x.role === 'tool');
  const thinks = items.filter((x) => x.role === 'thinking');
  if (!tools.length && thinks.length) {
    return thinks.map((th) => `<details class="thinking"><summary>${t('💭 생각 과정')}</summary><div class="tx">${esc(th.text)}</div></details>`).join('');
  }
  const names = [...new Set(tools.map((x) => x.tool.name.replace(/^mcp__(.+?)__(.+)$/, (m, a, b) => `${a.replace(/^claude_ai_/, '')}.${b}`)))];
  const errs = tools.filter((x) => x.tool.error).length;
  return `<details class="tools" ${open ? 'open' : ''}><summary><span>${t('🔧 도구 {n}회', { n: tools.length })}</span><span class="names">${esc(names.slice(0, 4).join(', '))}${errs ? ` · ${t('오류 {n}', { n: errs })}` : ''}</span><span class="chev">${ICON.chev}</span></summary>
    ${items.map((it) => it.role === 'thinking'
      ? `<details class="tool-item"><summary><span class="tn">${t('💭 생각')}</span><span class="ts">${esc(it.text.slice(0, 100))}</span></summary><pre>${esc(it.text)}</pre></details>`
      : `<details class="tool-item ${it.tool.error ? 'err' : ''}"><summary><span class="tn">${toolLabel(it.tool.name)}</span><span class="ts">${esc(it.tool.summary || '')}</span></summary>
        ${it.tool.input ? `<div class="lbl">${t('입력')}</div><pre>${esc(typeof it.tool.input === 'string' ? it.tool.input : JSON.stringify(it.tool.input, null, 2))}</pre>` : ''}
        ${it.tool.output ? `<div class="lbl">${t('결과')}</div><pre>${esc(it.tool.output)}</pre>` : ''}</details>`).join('')}
  </details>`;
}
function msgsHtml(msgs) {
  return groupMessages(msgs).map((g) => {
    if (g.kind === 'tools') return toolsHtml(g.items);
    const m = g.m;
    if (m.role === 'user') {
      // Baton handoff prompts: show a compact marker + the user's actual request
      const h = String(m.text).match(/^(?:You are continuing a session handed over from (.+?) \(|While you were paused, this work continued in another agent \((.+?)\))[\s\S]*?`([^`]+)`[\s\S]*?User's request: ([\s\S]*)$/);
      if (h) return `<div class="handoff-mark">🔀 ${t('{name}에서 넘겨받음', { name: esc(h[1] || h[2]) })} · <code>${esc(h[3])}</code></div><div class="msg-user">${esc(h[4].trim())}</div>`;
      return `<div class="msg-user">${esc(m.text)}${m.images ? `<div class="imgs">${t('🖼 사진 {n}장', { n: m.images })}</div>` : ''}</div>`;
    }
    if (m.role === 'assistant') return `<div class="msg-ai">${md(m.text)}</div>`;
    return `<div class="msg-sys">${esc(m.text)}</div>`;
  }).join('');
}

/**
 * "Question + list of choices" at the end of a reply -> { question, options } for quick-reply buttons.
 * For CLIs whose question tool doesn't reach Baton (Codex exec, Antigravity -p): they ask in plain text.
 * Deliberately strict, so a summary list followed by "shall I commit?" does not turn into buttons.
 */
function parseChoices(text) {
  const raw = String(text || '').replace(/\r/g, '');
  if (/```\s*$/.test(raw.trim())) return null;
  const lines = raw.split('\n').map((l) => l.trim());
  while (lines.length && !lines[lines.length - 1]) lines.pop();
  const OPT = /^(?:[-*•]|\d{1,2}[.)]|[A-Ha-h][.)]|\([A-Ha-h1-9]\))\s+(.+)$/;
  const CHOOSE = /골라|고르|선택|어느|어떤|어떻게|중에|중 하나|which|choose|pick|select|prefer|or\b|또는|아니면/i;
  const strip = (x) => x.replace(/\*\*|__|`/g, '').trim();
  let end = lines.length, tail = null;
  if (end && !OPT.test(lines[end - 1])) { tail = lines[end - 1]; end--; while (end && !lines[end - 1]) end--; }
  const opts = [];
  let i = end;
  while (i > 0 && OPT.test(lines[i - 1])) { opts.unshift(lines[i - 1].match(OPT)[1]); i--; }
  if (opts.length < 2 || opts.length > 6 || opts.some((o) => o.length > 120)) return null;
  let j = i;
  while (j > 0 && !lines[j - 1]) j--;
  const before = j > 0 ? lines[j - 1] : '';
  const isQ = (x) => /[?？]\**\s*$|[:：]\**\s*$/.test(x);
  const q = tail ? (isQ(tail) && CHOOSE.test(tail) ? tail : null) : (isQ(before) ? before : null);
  if (!q || q.length > 240) return null;
  return { question: strip(q), options: opts.map(choiceOf) };
}

/**
 * Several "question + choices" blocks at the end of a reply -> [{ question, options }] (2+ questions), else null.
 * CLIs without a question tool that reaches Baton ask like this:
 *   1. Which database?        **Auth:** which provider?
 *      - Postgres             a) Google
 *      - SQLite               b) GitHub
 * Every block must be a real question (ends with "?", or ":" plus a choosing word) with 2-6 options.
 */
function parseQuestions(text) {
  const raw = String(text || '').replace(/\r/g, '');
  if (/```\s*$/.test(raw.trim())) return null;
  const lines = raw.split('\n').map((l) => l.trim());
  while (lines.length && !lines[lines.length - 1]) lines.pop();
  const OPT = /^(?:[-*•]|\d{1,2}[.)]|[A-Ha-h][.)]|\([A-Ha-h1-9]\))\s+(.+)$/;
  const CHOOSE = /골라|고르|선택|어느|어떤|어떻게|중에|중 하나|which|choose|pick|select|prefer|또는|아니면/i;
  const strip = (x) => x.replace(/\*\*|__|`/g, '').trim();
  const qText = (x) => strip(x).replace(/^#{1,6}\s+/, '').replace(/^(?:Q\s*)?\d{1,2}[.)]\s+|^(?:Q|질문)\s*\d{1,2}\s*[.:)]\s*/i, '').trim();
  const isQ = (x) => { const y = qText(x); return y.length > 1 && y.length <= 240 && (/[?？]$/.test(y) || (/[:：]$/.test(y) && CHOOSE.test(y))); };
  // up to two closing lines ("Tell me and I'll start") after the last block
  let end = lines.length, tail = 0;
  while (end && (!lines[end - 1] || (!OPT.test(lines[end - 1]) && !isQ(lines[end - 1]) && tail < 2))) { if (lines[end - 1]) tail++; end--; }
  const blocks = [];
  let i = end;
  for (;;) {
    const opts = [];
    while (i > 0 && OPT.test(lines[i - 1]) && !isQ(lines[i - 1])) { opts.unshift(lines[i - 1].match(OPT)[1]); i--; }
    let j = i;
    while (j > 0 && !lines[j - 1]) j--;
    if (opts.length < 2 || opts.length > 6 || opts.some((o) => o.length > 120) || !j || !isQ(lines[j - 1])) break;
    blocks.unshift({ question: qText(lines[j - 1]), options: opts.map(choiceOf) });
    i = j - 1;
    while (i > 0 && !lines[i - 1]) i--;
  }
  return blocks.length >= 2 ? blocks : null;
}
/** "**Postgres** — reliable, needs a server" -> { label: 'Postgres', full: '…' } */
function choiceOf(o) {
  const x = o.replace(/\*\*|__|`/g, '').trim();
  const m = x.match(/^(.{1,50}?)\s+(?:—|–|-|:)\s+.+$/);
  return { label: (m ? m[1] : x).replace(/^[A-Ha-h1-9][.)]\s+/, '').replace(/[.。]$/, ''), full: x };
}
/** The pager for questions asked in plain text; the answers go back as one ordinary message. */
function textAskCard(qs, sendText) {
  const card = askPager(qs.map((q) => ({ question: q.question, header: '', multiSelect: false, options: q.options.map((o) => ({ label: o.label, description: o.full !== o.label ? o.full : '' })) })), {
    onSubmit: async (ans) => {
      if (!ans) { card.remove(); return true; }
      const msg = qs.map((q, i) => (ans[q.question] ? `${i + 1}. ${q.question}\n→ ${ans[q.question]}` : '')).filter(Boolean).join('\n\n');
      const ok = await sendText(msg);
      if (ok) card.remove();
      return ok;
    },
  });
  card.classList.add('ask-text-card');
  return card;
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
// Normalize catalogs from servers started before model/effort grouping was added.
function normalizeAgyCatalog(cat) {
  if (!cat?.models) return;
  const clean = (label) => label?.replace(/\s*\((minimal|low|medium|high|xhigh|max)\)$/i, '');
  const groups = new Map();
  const models = [];
  for (const original of cat.models) {
    const m = { ...original, label: clean(original.label), short: clean(original.short) };
    const match = m.id.match(/-(minimal|low|medium|high|xhigh|max)$/);
    if (!match || m.variants) { models.push(m); continue; }
    const base = m.id.slice(0, -match[0].length);
    let group = groups.get(base);
    if (!group) {
      group = { ...m, desc: base, defaultEffort: match[1], efforts: [], variants: {} };
      groups.set(base, group);
      models.push(group);
    }
    group.efforts.push(match[1]);
    group.variants[match[1]] = m.id;
  }
  const order = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
  for (const group of groups.values()) group.efforts.sort((a, b) => order.indexOf(a) - order.indexOf(b));
  const defaultGroup = models.find((m) => Object.values(m.variants || {}).includes(cat.defaults?.model));
  if (defaultGroup) {
    const defaultOption = models.find((m) => !m.id);
    if (defaultOption) defaultOption.efforts = defaultGroup.efforts;
  }
  cat.models = models;
}
function effectiveOpts(tool, p) {
  const cat = G.state?.catalogs?.[tool] || { models: [{ id: '', label: t('기본값') }], efforts: [''], defaults: {} };
  const model = cat.models.find((m) => m.id === p.model || Object.values(m.variants || {}).includes(p.model)) || (p.model ? { id: p.model, label: p.model, short: p.model } : cat.models[0]);
  const variantEffort = Object.entries(model?.variants || {}).find(([, id]) => id === p.model)?.[0];
  const defEffort = variantEffort || model?.defaultEffort || cat.defaults?.effort || null;
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
    if (k === 'model') {
      const opts = cat.models.map((m) => ({ value: m.id, label: m.label, desc: m.desc }));
      if (p.model && !cat.models.some((m) => m.id === p.model || Object.values(m.variants || {}).includes(p.model))) opts.push({ value: p.model, label: p.model, desc: t('직접 입력한 모델') });
      opts.push({ value: '__custom', label: t('✏️ 모델 ID 직접 입력'), desc: t('사내 게이트웨이·Bedrock 추론 프로필·사내 LLM 모델 이름 등') });
      v = await pick(t('모델'), opts, model?.id || p.model);
      if (v === '__custom') { v = await promptSheet(t('모델 ID'), p.model || '', { placeholder: 'us.anthropic.claude-sonnet-4-5-20250929-v1:0' }); if (v === undefined || v === null) return; v = v.trim(); }
    }
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
    p[k] = v;
    if (tool === 'agy' && (k === 'model' || k === 'effort')) {
      const selected = effectiveOpts(tool, p).model;
      if (selected?.efforts?.length && p.effort && !selected.efforts.includes(p.effort)) p.effort = '';
      if (p.model && selected?.variants?.[p.effort]) p.model = selected.variants[p.effort];
    }
    store.set(`prefs:${tool}`, p); drawOpts(tool);
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
  let lastI = -1, es = null, closed = false, started = Date.now(), thinking = false, rafPending = false, waiting = false;
  const asks = new Map();
  const status = document.createElement('div');
  status.className = 'live-status';
  el.append(status);
  const timer = setInterval(() => drawStatus(), 1000);
  function drawStatus() {
    status.innerHTML = `<div class="spinner"></div><span>${waiting ? t('답을 기다리는 중') : thinking ? t('생각하는 중') : t('응답 중')}</span><span class="timer">${fmtDur(Date.now() - started)}</span><button class="btn sm ghost stop">${t('중지')}</button>`;
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
    } else if (ev.t === 'mcp') {
      // only speak up when something is wrong — a healthy MCP list would just be noise
      const bad = (ev.servers || []).filter((x) => /fail|auth/i.test(x.status || ''));
      if (bad.length) {
        const n = document.createElement('div');
        n.className = 'mcp-note';
        n.innerHTML = `🔌 ${t('MCP 연결 문제:')} ${bad.map((x) => `<b>${esc(x.name)}</b> (${esc(/auth/i.test(x.status) ? t('인증 필요') : t('연결 실패'))})`).join(', ')}`;
        el.insertBefore(n, status);
      }
    } else if (ev.t === 'ask') {
      thinking = false;
      const card = askCard(runId, ev);
      el.insertBefore(card, status);
      asks.set(ev.requestId, card);
      waiting = true; drawStatus();
      setTimeout(() => card.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 50);
    } else if (ev.t === 'ask_done') {
      asks.get(ev.requestId)?.answered(ev.answers);
      waiting = false; drawStatus();
    } else if (ev.t === 'done') {
      for (const c of asks.values()) c.answered?.(undefined);
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

/**
 * Questions from the agent, one per page: tap an option (a single choice moves on by itself) or type your own,
 * then a review page and 「제출」. A lone single-choice question is still answered with one tap.
 * onSubmit({ [question]: "label" | "a, b" | "free text" } | null = skipped) resolves true when it went through.
 */
function askPager(qs, { onSubmit, top = `❓ ${t('AI가 물어봐요')}` }) {
  const n = qs.length;
  const pick = qs.map(() => new Set());
  const other = qs.map(() => '');
  const quick = n === 1 && !qs[0].multiSelect;
  let step = 0; // 0..n-1 = a question, n = review page (only when there are several)
  let busy = false, advance = null;
  const card = document.createElement('div');
  card.className = 'ask-card';
  const answerOf = (i) => {
    const labels = [...pick[i]].map((j) => qs[i].options[j].label);
    if (other[i].trim()) labels.push(other[i].trim());
    return labels.join(', ');
  };
  const answers = () => Object.fromEntries(qs.map((q, i) => [q.question, answerOf(i)]).filter(([, v]) => v));
  const done = (i) => Boolean(pick[i].size || other[i].trim());
  const reach = () => { const k = qs.findIndex((_, i) => !done(i)); return k < 0 ? n : k; }; // furthest page you may jump to
  const submit = async (ans) => {
    if (busy) return;
    busy = true; clearTimeout(advance);
    $$('button, input', card).forEach((x) => { x.disabled = true; });
    const ok = await onSubmit(ans).catch(() => false);
    busy = false;
    if (!ok && card.isConnected && !card.classList.contains('done')) draw();
  };
  const go = (i) => { clearTimeout(advance); step = Math.max(0, Math.min(i, n > 1 ? n : 0)); draw(); };
  const optHtml = (q, i) => q.options.map((o, j) => `<button class="ask-opt ${pick[i].has(j) ? 'on' : ''}" data-o="${j}"><b>${esc(o.label)}</b>${o.description && o.description.trim().toLowerCase() !== o.label.trim().toLowerCase() ? `<span>${esc(o.description)}</span>` : ''}</button>`).join('');
  const syncButtons = () => {
    const nx = $('[data-next]', card); if (nx) nx.disabled = !done(step);
    const sd = $('[data-send]', card);
    if (sd) { sd.disabled = !qs.every((_, i) => done(i)); if (quick) sd.hidden = !other[0].trim(); }
  };
  function draw() {
    const review = n > 1 && step === n;
    const steps = n > 1 ? `<div class="ask-steps">${qs.map((q, i) => `<button class="ask-dot${i === step ? ' on' : ''}${done(i) ? ' ok' : ''}" data-go="${i}" ${i > reach() ? 'disabled' : ''} aria-label="${esc(q.header || String(i + 1))}"></button>`).join('')}<span>${review ? t('답 확인') : `${step + 1} / ${n}`}</span></div>` : '';
    let body;
    if (review) {
      body = `<div class="ask-review">${qs.map((q, i) => `<button class="ask-ans" data-go="${i}"><span>${esc(q.question)}</span><b>${esc(answerOf(i))}</b></button>`).join('')}</div>
        <div class="small muted">${t('고칠 답을 누르면 그 질문으로 돌아가요')}</div>`;
    } else {
      const q = qs[step];
      body = `<div class="ask-q">
        ${q.header ? `<span class="ask-h">${esc(q.header)}</span>` : ''}<div class="ask-text">${esc(q.question)}</div>
        ${q.multiSelect ? `<div class="small muted">${t('여러 개 골라도 돼요')}</div>` : ''}
        <div class="ask-opts">${optHtml(q, step)}</div>
        <input class="ask-other" placeholder="${t('직접 입력…')}" autocomplete="off" value="${esc(other[step])}">
      </div>`;
    }
    const prev = n > 1 && step > 0 ? `<button class="btn sm ghost" data-prev>${t('이전')}</button>` : '';
    const fwd = n === 1 || review
      ? `<button class="btn sm primary" data-send>${n > 1 ? t('제출') : t('답하기')}</button>`
      : `<button class="btn sm primary" data-next>${step === n - 1 ? t('확인') : t('다음')}</button>`;
    card.innerHTML = `<div class="ask-top">${top}</div>${steps}${body}
      <div class="ask-act"><button class="btn sm ghost" data-skip>${t('건너뛰기')}</button><span class="sp"></span>${prev}${fwd}</div>`;
    syncButtons();
    $$('[data-go]', card).forEach((x) => (x.onclick = () => go(Number(x.dataset.go))));
    $('[data-prev]', card) && ($('[data-prev]', card).onclick = () => go(step - 1));
    $('[data-next]', card) && ($('[data-next]', card).onclick = () => done(step) && go(step + 1));
    $('[data-send]', card) && ($('[data-send]', card).onclick = () => submit(answers()));
    $('[data-skip]', card).onclick = () => submit(null);
    if (review) return;
    const i = step, q = qs[i], inp = $('.ask-other', card);
    $$('.ask-opt', card).forEach((x) => (x.onclick = () => {
      const j = Number(x.dataset.o);
      if (q.multiSelect) { pick[i].has(j) ? pick[i].delete(j) : pick[i].add(j); }
      else { pick[i] = new Set([j]); other[i] = ''; inp.value = ''; }
      $$('.ask-opt', card).forEach((y) => y.classList.toggle('on', pick[i].has(Number(y.dataset.o))));
      syncButtons();
      if (quick) return submit(answers());
      // single choice with more questions to go: show the tap, then turn the page
      if (!q.multiSelect && n > 1) { clearTimeout(advance); advance = setTimeout(() => { if (step === i) go(i + 1); }, 220); }
    }));
    inp.oninput = () => {
      other[i] = inp.value;
      if (!q.multiSelect && inp.value.trim()) { pick[i].clear(); $$('.ask-opt', card).forEach((y) => y.classList.remove('on')); }
      syncButtons();
    };
    inp.onkeydown = (e) => {
      if (e.key !== 'Enter' || e.isComposing || !done(i)) return;
      e.preventDefault();
      if (n > 1) go(i + 1); else submit(answers());
    };
  }
  draw();
  return card;
}

/** Claude Code AskUserQuestion during a live run: the answer goes back to the CLI on stdin. */
function askCard(runId, ev) {
  const card = askPager(ev.questions || [], {
    onSubmit: async (ans) => {
      try { await api(`/api/runs/${runId}/answer`, { body: { requestId: ev.requestId, answers: ans } }); return true; }
      catch (e) { toast(e.message, true); return false; }
    },
  });
  card.answered = (ans) => {
    card.classList.add('done');
    const rows = ans === undefined ? `<div class="small muted">${t('응답이 끝나서 닫혔어요')}</div>`
      : !ans ? `<div class="small muted">${t('건너뛰었어요')}</div>`
        : Object.entries(ans).map(([q, a]) => `<div class="ask-ans"><span>${esc(q)}</span><b>${esc(a)}</b></div>`).join('');
    card.innerHTML = `<div class="ask-top">✓ ${t('AI의 질문')}</div>${rows}`;
    card.answered = () => {};
  };
  return card;
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
  let live = null, session = null, start = 0, busy = false, links = { from: [], to: [] };
  const msgsEl = $('#msgs'), scroll = $('#scroll');
  G.cleanup = () => { live?.close(); cleanVV(); };

  const load = async ({ keepScroll = false } = {}) => {
    const d = await api(`/api/sessions/${tool}/${encodeURIComponent(id)}`);
    session = d.session; start = d.start; links = d.links || links;
    $('#ctitle').textContent = session.title;
    $('#csub').innerHTML = `<span class="tool-badge ${tool}">${TOOL[tool].name}</span><span>${esc(projectName(session.project || session.cwd))}</span>${session.model ? `<span>· ${esc(session.model)}</span>` : ''}${session.notify < 0 ? `<span class="flag bell">${t('🔕 알림 꺼짐')}</span>` : ''}<span id="cmcp"></span>`;
    mcpChip(session);
    $('#back').setAttribute('href', session.project ? `#/p/${encodeURIComponent(session.project)}` : '#/sessions');
    const banner = session.terminal ? `<div class="banner warn" style="margin-bottom:4px">${t('⚠️ 이 세션은 PC 터미널에서도 열려 있어요. 여기서 보내면 기록이 갈라질 수 있으니 PC 쪽이 쉬고 있을 때 보내세요.')}</div>` : '';
    msgsEl.innerHTML = `${start > 0 ? `<button class="btn sm ghost load-older" id="older">${t('이전 대화 더 보기')}</button>` : ''}${banner}<div id="hobanners"></div>${msgsHtml(d.messages)}<div id="schedbanners"></div>`;
    api('/api/limits').catch(() => ({})).then((lim) => {
      const hb = $('#hobanners'); if (!hb) return;
      api(`/api/scheduled?key=${encodeURIComponent(`${tool}:${id}`)}`).then((sd) => {
        const box = $('#schedbanners'); if (!box) return;
        box.innerHTML = scheduledBanner(sd.items || []);
        $$('[data-sched-cancel]', box).forEach((b) => (b.onclick = async () => { await api(`/api/scheduled/${b.dataset.schedCancel}/cancel`, { method: 'POST' }); toast(t('예약을 취소했어요')); load({ keepScroll: true }); }));
      }).catch(() => {});
      hb.innerHTML = (session.moved ? `<div class="banner">📁 ${t('작업 폴더: {p} (원래 {o})', { p: esc(session.cwd), o: esc(session.origCwd || '') })}</div>` : '') + handoffBanners(session, links, lim);
      $$('[data-handoff]', hb).forEach((b) => (b.onclick = () => handoffSheet(session, links)));
      $$('[data-newhere]', hb).forEach((b) => (b.onclick = () => newSessionHere(session)));
    });
    if (!d.messages.length) msgsEl.insertAdjacentHTML('beforeend', `<div class="empty">${t('표시할 대화가 없어요')}</div>`);
    // the reply ended with a question and choices -> tap to answer
    const lastMsg = d.messages[d.messages.length - 1];
    const asked = !busy && !live && lastMsg?.role === 'assistant';
    const mq = asked ? parseQuestions(lastMsg.text) : null;
    const ch = asked && !mq ? parseChoices(lastMsg.text) : null;
    const lastAi = [...$$('.msg-ai', msgsEl)].pop();
    if (mq && lastAi) lastAi.after(textAskCard(mq, (text) => send(text, composerPrefs(tool), [])));
    if (ch && lastAi) {
      lastAi.insertAdjacentHTML('afterend', `<div class="quick-replies"><span>💬 ${t('눌러서 바로 답하기')}</span><div class="qr-opts">${ch.options.map((o, k) => `<button class="btn sm" data-qr-i="${k}" title="${esc(o.full)}">${esc(o.label)}</button>`).join('')}</div></div>`);
      $$('[data-qr-i]', msgsEl).forEach((b) => (b.onclick = async () => {
        const box = b.closest('.quick-replies');
        $$('button', box).forEach((x) => { x.disabled = true; });
        if (await send(ch.options[Number(b.dataset.qrI)].label, composerPrefs(tool), [])) box.remove();
        else $$('button', box).forEach((x) => { x.disabled = false; });
      }));
    }
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
        if (ev.limited) {
          msgsEl.insertAdjacentHTML('beforeend', `<div class="done-card denied"><div>⏳ ${t('{name} 사용 한도에 걸린 것 같아요. 다른 CLI가 이 세션을 이어받아 계속할 수 있어요.', { name: TOOL[tool].name })}</div>
            <div class="row"><button class="btn sm primary" data-sched-now>${t('⏰ 한도 풀리면 보내기')}</button><button class="btn sm" data-handoff-now>${t('다른 CLI로 이어가기')}</button></div></div>`);
          $$('[data-handoff-now]', msgsEl).forEach((b) => (b.onclick = () => handoffSheet(session, links, { reason: t('한도에 걸렸어요. 어디서 이어갈까요?') })));
          $$('[data-sched-now]', msgsEl).forEach((b) => (b.onclick = async () => { if (await scheduleSheet(session)) load({ keepScroll: true }); }));
        } else if (ev.denied?.length) showDenied(ev.denied);
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

/** Small "🔌 MCP n" chip in the chat header: how many servers this CLI loads here; red when one failed. */
async function mcpChip(session) {
  const cwd = session.cwd || session.project;
  if (!cwd) return;
  try {
    const d = await api(`/api/mcp/effective?cwd=${encodeURIComponent(cwd)}&tool=${session.tool}&session=${encodeURIComponent(`${session.tool}:${session.id}`)}`);
    const x = d.tools[session.tool];
    const el = $('#cmcp');
    if (!x || !el) return;
    const on = x.servers.filter((s) => s.enabled === true);
    if (!on.length) return;
    const bad = on.some((s) => s.status && (s.status.status === 'fail' || s.status.status === 'auth'));
    const used = on.filter((s) => s.sessionUses).length;
    el.outerHTML = `<button class="flag mcpchip ${bad ? 'bad' : used ? 'used' : ''}" id="cmcp" title="${t('이 세션의 MCP')}">🔌 ${used ? t('MCP {m}/{n}', { m: used, n: on.length }) : t('MCP {n}', { n: on.length })}</button>`;
    $('#cmcp').onclick = () => mcpSessionSheet(session);
  } catch { /* optional */ }
}

async function viewNew(_, params) {
  const cleanVV = setupViewport();
  let tool = params.get('tool') || store.get('newtool', INSTALLED()[0] || 'claude');
  if (!INSTALLED().includes(tool)) tool = INSTALLED()[0] || 'claude';
  let cwd = params.get('cwd') || G.state?.settings?.defaultCwd || store.get('newcwd', G.state?.defaultCwd || '~');
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
    const selected = await folderPicker(cwd);
    if (!selected) return;
    cwd = selected;
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
    showLive(run, text, imgs);
    return true;
  };
  const showLive = (run, text, imgs = []) => {
    $('.newbar')?.remove();
    const msgs = $('#msgs');
    msgs.innerHTML = (params.get('from') ? `<div class="banner link">↩ ${t('{name} 세션을 이어받는 중', { name: TOOL[params.get('from').split(':')[0]]?.name || '' })}</div>` : '') + userBubble(text, imgs);
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
  };
  G.cleanup = cleanVV;
  render2();
  if (params.get('attach')) showLive({ id: params.get('attach') }, params.get('label') || t('이어서 진행해줘'));
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

// Remember expanded groups during navigation and settings rerenders.
const settingsExpanded = new Set();
function organizeSettings(view) {
  const sections = Object.fromEntries($$('[data-settings]', view).map(el => [el.dataset.settings, el]));
  const setup = sections.general.querySelector('a');
  setup.classList.add('settings-setup', 'card');
  view.prepend(setup);
  const language = sections.general.querySelector('.setting');
  const languageSelect = language.querySelector('select');
  languageSelect.setAttribute('aria-label', 'Language');
  sections.appearance.append(language);
  sections.general.remove();
  const groups = [
    ['appearance', t('화면 · 언어'), t('색상 테마와 화면 밝기, 표시 언어'), ICON.image, ['appearance']],
    ['workspace', t('작업 · 세션'), t('기본 폴더, 실행 권한과 세션 관리'), ICON.folder, ['workspace', 'sessions']],
    ['notifications', t('알림 · 리마인더'), t('응답 알림과 잠자는 프로젝트 챙기기'), ICON.bell, ['notifications', 'reminders']],
    ['ai', t('AI 브리핑'), t('요약에 사용할 도구와 모델'), ICON.send, ['ai']],
    ['advanced', t('고급 · 회사 환경'), t('CLI 연결과 환경 변수'), ICON.more, ['advanced']],
  ];
  const list = document.createElement('div');
  list.className = 'settings-groups';
  setup.after(list);
  for (const [id, title, description, icon, keys] of groups) {
    const group = document.createElement('details');
    group.className = 'settings-group card';
    group.dataset.group = id;
    group.open = settingsExpanded.has(id);
    group.innerHTML = `<summary><span class="settings-group-icon" aria-hidden="true">${icon}</span><span class="settings-group-label"><b>${title}</b><span ${id === 'appearance' ? 'data-theme-summary' : ''}>${description}</span></span><span class="settings-chevron" aria-hidden="true">${ICON.chev}</span></summary><div class="settings-group-content"></div>`;
    const content = group.querySelector('.settings-group-content');
    for (const key of keys) {
      const section = sections[key];
      if (keys.length === 1) section.querySelector('.section-h')?.remove();
      content.append(section);
    }
    group.addEventListener('toggle', () => {
      if (group.open) settingsExpanded.add(id);
      else settingsExpanded.delete(id);
    });
    list.append(group);
  }
}

async function viewSettings() {
  const v = shell({ title: t('설정'), fab: false });
  v.classList.add('settings-view');
  const s = await api('/api/settings');
  const ps = await pushStatus().catch(() => ({ supported: false }));
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const isIOS = /iPhone|iPad/.test(navigator.userAgent);
  const sw = (k) => `<label class="switch"><input type="checkbox" data-k="${k}" ${s[k] ? 'checked' : ''}><i></i></label>`;
  const hours = Array.from({ length: 24 }, (_, h) => `<option value="${h}" ${s.nudgeHour === h ? 'selected' : ''}>${hourLabel(h)}</option>`).join('');
  const briefModels = (G.state?.catalogs?.[s.briefTool]?.models || []).map((m) => `<option value="${esc(m.id)}" ${m.id === s.briefModel ? 'selected' : ''}>${esc(m.label)}</option>`).join('');
  v.innerHTML = `
    <div class="section" data-settings="general"><div class="card">
      <a class="setting" href="#/setup"><div class="l"><b>🚀 ${t('시작하기 · 도구 설치/연동')}</b><span>${t('Claude Code·Codex·Antigravity·OpenCode·Cursor 설치, 로그인, 폰 연결, 자동 시작')}</span></div><span class="muted">›</span></a>
      <div class="setting"><div class="l"><b>Language · 언어</b></div><select data-k="lang" data-reload><option value="en" ${s.lang !== 'ko' ? 'selected' : ''}>English</option><option value="ko" ${s.lang === 'ko' ? 'selected' : ''}>한국어</option></select></div>
    </div></div>
    <div class="section" data-settings="appearance"><div class="section-h"><h2 id="appearance-title">${t('테마')}</h2></div>
      <div class="card appearance-card"><p class="small muted">${t('이 기기에만 적용돼요. 선택하면 바로 바뀌어요.')}</p>
        <h3 class="theme-group-title" id="palette-title">${t('색상 테마')}</h3>
        <div class="palette-options" role="group" aria-labelledby="palette-title">
          ${[
            ['default', t('기본'), t('따뜻한 중성색과 차분한 녹색')],
            ['forest', 'Forest', t('종이 위의 차분한 숲')],
            ['nord', 'Nord', t('시원한 북유럽 블루')],
            ['dracula', 'Dracula', t('보랏빛으로 선명하게')],
            ['tokyo', 'Tokyo Night', t('도시의 푸른 밤')],
            ['monokai', 'Monokai', t('올리브와 라임의 대비')],
            ['rose', 'Rosé Pine', t('부드러운 로즈와 잉크')],
          ].map(([value, name, description]) => `<label class="palette-option">
            <input type="radio" name="palette" value="${value}" ${window.BatonTheme.palette() === value ? 'checked' : ''}>
            <span class="palette-card"><span class="palette-preview" data-palette-preview="${value}" aria-hidden="true"><i></i><span><b></b><em></em><em></em><small></small></span></span>
              <span class="palette-name">${name}<span class="palette-check" aria-hidden="true">✓</span></span><span class="palette-description">${description}</span>
            </span>
          </label>`).join('')}
        </div>
        <h3 class="theme-group-title" id="mode-title">${t('화면 밝기')}</h3>
        <div class="appearance-options" role="group" aria-labelledby="mode-title">
          ${[['system', t('기기 설정에 맞춤')], ['light', t('라이트')], ['dark', t('다크')]].map(([value, label]) => `<label class="appearance-option">
            <input type="radio" name="appearance" value="${value}" ${window.BatonTheme.get() === value ? 'checked' : ''}>
            <span class="appearance-preview ${value}" aria-hidden="true"><i></i><span><b></b><b></b></span></span>
            <span class="appearance-label">${label}</span>
          </label>`).join('')}
        </div>
      </div>
    </div>
    <div class="section" data-settings="workspace"><div class="section-h"><h2>${t('작업 폴더')}</h2></div><div class="card">
      <div class="setting"><div class="l"><b>${t('기본 작업 폴더')}</b><span>${esc(s.defaultCwd || G.state?.defaultCwd || '~')}</span><span>${t('Baton 실행 계정의 홈 폴더 기준이에요. workspace가 있으면 자동 선택하며, 폴더를 자동 생성하지 않아요.')}</span></div><button class="btn sm" id="default-folder">${t('변경')}</button></div>
    </div></div>
    <div class="section" data-settings="advanced"><div class="section-h"><h2>🏢 ${t('회사 환경 · CLI 환경 변수')}</h2></div><div class="card" id="envbox"><div class="skeleton" style="height:60px;margin:14px"></div></div></div>
    <div class="section" data-settings="notifications"><div class="section-h"><h2>${t('알림')}</h2></div><div class="card">
      ${!ps.supported || (isIOS && !standalone) ? `<div class="setting"><div class="l"><b>${t('홈 화면에 추가해야 알림을 받을 수 있어요')}</b><span>${t('Safari 공유 버튼 → 「홈 화면에 추가」 → 추가된 Baton 앱에서 이 화면을 다시 열어주세요')}</span></div></div>`
        : `<div class="setting"><div class="l"><b>${t('푸시 알림')}</b><span>${ps.sub ? t('이 기기에서 켜져 있어요') : t('응답 완료·잠자는 프로젝트 알림을 받아요')}</span></div>
            ${ps.sub ? `<button class="btn sm" id="ptest">${t('테스트')}</button><button class="btn sm ghost" id="poff">${t('끄기')}</button>` : `<button class="btn sm primary" id="pon">${t('켜기')}</button>`}</div>`}
      <div class="setting"><div class="l"><b>${t('응답 완료 알림')}</b><span>${t('세션 응답이 끝날 때마다 알려줘요 (PC 터미널 포함). 세션·프로젝트 ⋯ 메뉴에서 따로 끌 수 있어요')}</span></div>${sw('notifyOnRunDone')}</div>
      <div class="setting"><div class="l"><b>${t('새 버전 알림')}</b><span>${t('Baton 새 버전이 나오면 한 번 알려줘요 (GitHub에서 하루 몇 번 확인)')}</span></div>${sw('updateCheck')}</div>
      ${DESK_MQ.matches ? `<div class="setting"><div class="l"><b>${t('데스크톱 화면 알림')}</b><span>${t('이 PC에서 Baton을 보고 있으면 화면 우측 하단에 알림 카드를 띄워요')}</span></div><label class="switch"><input type="checkbox" id="deskcards-sw" ${deskCardsOn() ? 'checked' : ''}><i></i></label></div>` : ''}
    </div></div>
    <div class="section" data-settings="reminders"><div class="section-h"><h2>${t('잊혀가는 프로젝트 챙기기 💤')}</h2></div><div class="card">
      <div class="setting"><div class="l"><b>${t('하루 한 번 넛지')}</b><span>${t('멈춰 있는 프로젝트 하나를 골라 다음 할 일과 함께 알려줘요')}</span></div>${sw('nudgeEnabled')}</div>
      <div class="setting"><div class="l"><b>${t('알림 시간')}</b></div><select data-k="nudgeHour" data-num>${hours}</select></div>
      <div class="setting"><div class="l"><b>${t('며칠 쉬면 「잠자는」 프로젝트?')}</b></div><select data-k="staleDays" data-num>${[3, 5, 7, 10, 14, 21].map((n) => `<option ${s.staleDays === n ? 'selected' : ''} value="${n}">${n}${t('일')}</option>`).join('')}</select></div>
      <div class="setting"><div class="l"><b>${t('같은 프로젝트 다시 알림 간격')}</b></div><select data-k="nudgeCooldownDays" data-num>${[3, 5, 7, 10, 14, 30].map((n) => `<option ${s.nudgeCooldownDays === n ? 'selected' : ''} value="${n}">${n}${t('일')}</option>`).join('')}</select></div>
      <div class="setting"><div class="l"><b>${t('이만큼 지나면 알림 그만')}</b><span>${t('너무 오래된 건 보관 대상으로 봐요')}</span></div><select data-k="forgetDays" data-num>${[60, 90, 180, 365].map((n) => `<option ${s.forgetDays === n ? 'selected' : ''} value="${n}">${n}${t('일')}</option>`).join('')}</select></div>
      <div class="setting"><div class="l"><b>${t('지금 한 번 받아보기')}</b><span>${t('브리핑을 만들고 알림을 보내요 (최대 30초)')}</span></div><button class="btn sm" id="nudgenow">${t('보내기')}</button></div>
    </div></div>
    <div class="section" data-settings="ai"><div class="section-h"><h2>${t('AI 브리핑')}</h2></div><div class="card">
      <div class="setting"><div class="l"><b>${t('요약에 쓸 도구')}</b><span>${t('가볍고 빠른 모델을 추천해요')}</span></div><select data-k="briefTool">${INSTALLED().map((k) => [k, TOOL[k]]).map(([k, tl]) => `<option value="${k}" ${s.briefTool === k ? 'selected' : ''}>${tl.name}</option>`).join('')}</select></div>
      <div class="setting"><div class="l"><b>${t('모델')}</b></div><select data-k="briefModel">${briefModels}</select></div>
    </div></div>
    <div class="section" data-settings="sessions"><div class="section-h"><h2>${t('세션')}</h2></div><div class="card">
      <div class="setting"><div class="l"><b>${t('자동 실행 세션도 보기')}</b><span>${t('스크립트·서브에이전트가 만든 세션 (codex exec, agy -p 등)')}</span></div>${sw('showAutomated')}</div>
      <div class="setting"><div class="l"><b>${t('기본 권한')}</b></div><select data-k="defaultPerm">${Object.entries(PERM).map(([k, p]) => `<option value="${k}" ${s.defaultPerm === k ? 'selected' : ''}>${p.label}</option>`).join('')}</select></div>
      <a class="setting" href="#/usage"><div class="l"><b>${t('사용량 · 한도')}</b><span>${t('CLI별 남은 한도와 토큰 사용량')}</span></div><span class="muted">›</span></a>
      <div class="setting"><div class="l"><b>${t('목록 새로고침')}</b><span>${t('세션 파일을 다시 읽어요')}</span></div><button class="btn sm" id="reindex">${ICON.refresh}</button></div>
    </div></div>
    <p class="small muted" style="text-align:center;margin-top:24px">${t('Baton · 바이브코딩 이어달리기 🏃‍♂️')} · v${esc(G.state?.version || '')}<br>${esc(G.state?.home || '')} · <a href="#" id="upcheck">${t('새 버전 확인')}</a></p>`;
  organizeSettings(v);
  $('#upcheck', v) && ($('#upcheck', v).onclick = (e) => { e.preventDefault(); updateSheet({ check: true }); });
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
  $$('[name="appearance"]', v).forEach(input => {
    input.onchange = () => window.BatonTheme.set(input.value);
  });
  $$('[name="palette"]', v).forEach(input => {
    input.onchange = () => window.BatonTheme.setPalette(input.value);
  });
  window.BatonTheme.refresh();
  $('#default-folder').onclick = async () => {
    const cwd = await folderPicker(s.defaultCwd || G.state?.defaultCwd || '~', { allowNew: false });
    if (!cwd) return;
    try { await api('/api/settings', { body: { defaultCwd: cwd } }); store.set('newcwd', cwd); await loadState(); viewSettings(); }
    catch (e) { toast(e.message, true); }
  };
  $('#pon') && ($('#pon').onclick = async () => { try { await enablePush(); viewSettings(); } catch (e) { toast(e.message, true); } });
  $('#poff') && ($('#poff').onclick = async () => { const sub = ps.sub; await api('/api/push/unsubscribe', { body: { endpoint: sub.endpoint } }); await sub.unsubscribe(); toast(t('알림을 껐어요')); viewSettings(); });
  $('#deskcards-sw') && ($('#deskcards-sw').onchange = (e) => {
    localStorage.setItem('baton.deskCards', e.target.checked ? '1' : '0');
    if (e.target.checked) deskCard({ kind: 'test', title: t('🏃 Baton 알림 테스트'), body: t('이 위치에 알림이 떠요'), url: '#/settings' });
  });
  $('#ptest') && ($('#ptest').onclick = async () => { const r = await api('/api/push/test', { method: 'POST' }); toast(t('{n}개 기기로 보냈어요', { n: r.sent })); });
  $('#nudgenow').onclick = async (e) => {
    e.target.disabled = true; e.target.innerHTML = '<div class="spinner"></div>';
    try { const r = await api('/api/nudge/now', { method: 'POST' }); toast(r.nudge ? t('보냈어요! 알림을 확인해보세요') : t('지금은 잠자는 프로젝트가 없어요 👏')); }
    catch (err) { toast(err.message, true); }
    e.target.disabled = false; e.target.textContent = t('보내기');
  };
  $('#reindex').onclick = async () => { await api('/api/refresh', { method: 'POST' }); toast(t('새로 읽었어요')); };
  envSection(v);
}

/** Company setups: which backend each CLI uses, env imported from the login shell, extra variables. */
async function envSection(v) {
  const box = $('#envbox', v);
  if (!box) return;
  const d = await api('/api/env');
  const pc = d.providers.claude, px = d.providers.codex;
  box.innerHTML = `
    <div class="setting"><div class="l"><b>Claude Code</b><span>${esc(pc.label)}${pc.region ? ` · ${esc(pc.region)}` : ''}${pc.baseUrl ? ` · ${esc(pc.baseUrl)}` : ''}${pc.models?.main ? ` · ${esc(pc.models.main)}` : ''}</span></div></div>
    <div class="setting"><div class="l"><b>Codex</b><span>${esc(px.label)}${px.baseUrl ? ` · ${esc(px.baseUrl)}` : ''}${px.envKey ? ` · ${esc(px.envKey)} ${px.envKeySet ? '✓' : t('(설정 안 됨)')}` : ''}</span></div></div>
    <div class="setting col"><div class="l"><b>${t('터미널 설정 가져오기')}</b>
      <span>${d.shellError ? t('로그인 셸을 읽지 못했어요: {e}', { e: esc(d.shellError) }) : d.shell ? t('{shell}의 환경 변수를 Baton이 실행하는 CLI에 그대로 넘겨요 (Bedrock·프록시 설정 등)', { shell: esc(d.shell) }) : t('Windows에서는 사용자 환경 변수를 그대로 써요')}</span></div>
      ${d.imported.length ? `<div class="envkeys">${d.imported.map((k) => `<code>${esc(k)}</code>`).join(' ')}</div>` : ''}</div>
    <div class="setting col"><div class="l"><b>${t('추가 환경 변수')}</b><span>${t('KEY=VALUE 한 줄에 하나. 셸에 없는 값만 넣으면 돼요. 비밀 값은 저장 후 __KEEP__로 가려져요.')}</span></div>
      <textarea id="envtext" rows="5" spellcheck="false" placeholder="CLAUDE_CODE_USE_BEDROCK=1&#10;AWS_PROFILE=company&#10;AWS_REGION=us-east-1&#10;HTTPS_PROXY=http://proxy.company:8080">${esc(d.extraText)}</textarea>
      <div class="pact"><button class="btn sm primary" id="envsave">${t('저장')}</button><span class="small muted">${t('CLAUDE_CONFIG_DIR·CODEX_HOME 같은 경로는 Baton을 다시 시작해야 적용돼요')}</span></div></div>`;
  $('#envsave', box).onclick = async () => {
    try { await api('/api/env', { body: { text: $('#envtext', box).value } }); toast(t('저장했어요')); await loadState(); envSection(v); }
    catch (e) { toast(e.message, true); }
  };
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
  const n = String(id).replace(/^.*\//, '').replace(/^(?:us|eu|apac|global|jp|au)\./, '').replace(/^anthropic\./, '').replace(/-v\d+(?::\d+)?$/, '').replace(/@\d{8}$/, '');
  const c = n.match(/^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?/);
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
  if (L?.noLimits) {
    return `<div class="card limit-card">${head}<p class="small" style="margin:8px 0 0;line-height:1.5">${t('{p} 사용 중 — 구독 한도가 없는 방식이에요. 사용량과 비용은 그 계정(회사 클라우드·API) 기준으로 확인하세요. 토큰 사용량은 아래에서 볼 수 있어요.', { p: esc(L.provider || L.plan || '') })}</p></div>`;
  }
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
      if (lim[tid]?.noLimits) return `<div><span class="tool-badge ${tid}">${TOOL[tid].name}</span><b class="small">${esc(lim[tid].provider || '')}</b>
        <span class="small muted">${t('한도 없음')} · ${t('오늘 {n}', { n: fmtTok(tokTotal(d.tools[tid]?.periods.today || {})) })}</span></div>`;
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
    ${card('#/mcp', '🔌', t('MCP 서버'), t('에이전트가 물고 있는 MCP와 실제 호출 기록'), 'tc-mcp')}
    ${card('#/usage', '📊', t('사용량 · 한도'), t('CLI별 남은 한도와 토큰'), 'tc-usage')}
    ${card('#/scheduled', '⏰', t('예약 메시지'), t('한도가 풀리면 보낼 메시지'), 'tc-sched')}
    ${card('#/cleanup', '🧹', t('세션 정리'), t('테스트·자동 실행·"hi" 세션 한 번에 지우기'), 'tc-clean')}
    ${card('#/trash', '🗑️', t('휴지통'), t('지운 세션 되살리기 (30일 보관)'), 'tc-trash')}
  </div>`;
  api('/api/ports').then((d) => { const n = d.ports.filter((p) => p.mine && !p.baton).length; $('#tc-ports') && ($('#tc-ports').textContent = t('내 서버 {n}개 실행 중', { n })); }).catch(() => {});
  api('/api/mcp').then((d) => { const on = d.servers.filter((x) => x.enabled === true && x.scope !== 'unlisted').length, used = d.servers.filter((x) => x.uses).length; $('#tc-mcp') && ($('#tc-mcp').textContent = t('{n}개 설정 · 최근 30일 {m}개 사용', { n: on, m: used })); }).catch(() => {});
  api('/api/cleanup').then((d) => { $('#tc-clean') && ($('#tc-clean').textContent = t('정리 후보 {n}개', { n: d.items.length })); }).catch(() => {});
  api('/api/scheduled').then((d) => { $('#tc-sched') && ($('#tc-sched').textContent = d.items.length ? t('{n}개 대기 중 · 다음: {when}', { n: d.items.length, when: whenFull(d.items[0].runAt) }) : t('대기 중인 예약 없음')); }).catch(() => {});
  api('/api/trash').then((d) => { $('#tc-trash') && ($('#tc-trash').textContent = d.items.length ? t('{n}개 보관 중 · 30일 뒤 완전 삭제', { n: d.items.length }) : t('비어 있어요')); }).catch(() => {});
}

// Every whitespace-separated term must appear somewhere in the fields (case-insensitive).
const matchQ = (q, ...fields) => {
  const terms = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  const hay = fields.filter((x) => x != null && x !== '' && x !== false).join(' ').toLowerCase();
  return terms.every((w) => hay.includes(w));
};
const searchBox = (id, value, placeholder) => `<label class="search">${ICON.search}<input id="${id}" type="search" placeholder="${placeholder}" aria-label="${placeholder}" value="${esc(value)}" autocomplete="off"></label>`;

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
  const sysRow = (p) => `<div class="srow"><div class="body"><div class="t"><b>:${p.port}</b>&nbsp;<span class="muted">${esc(p.page?.title || '')}</span></div><div class="m">${p.local ? t('이 PC 전용') : t('외부 접속 가능')} · ${esc(p.addrs.join(', '))}</div></div></div>`;
  let q = sessionStorage.getItem('pq') || '';
  const hit = (p) => matchQ(q, `:${p.port}`, p.page?.title, p.name, p.cwd, p.project && projectName(p.project), p.project, p.cmd, p.agent?.title, p.agent && TOOL[p.agent.tool]?.name, p.addrs?.join(' '));
  v.innerHTML = `${searchBox('pq', q, t('포트·이름·폴더·명령 검색'))}<div id="plist"></div>
    <p class="small muted" style="text-align:center;line-height:1.6">${t('「폰에서 열 수 있게」는 Tailscale로 내 기기에만 공유해요 (인터넷 공개 아님)')}<br>${t('Vite 같은 개발 서버는 외부 주소를 막을 수 있어요 →')} <code>server.allowedHosts</code> ${t('설정 필요')}</p>`;
  const bind = (el) => {
    $$('[data-share]', el).forEach((b) => (b.onclick = async () => {
      b.disabled = true;
      try { const r = await api(`/api/ports/${b.dataset.share}/share`, { method: 'POST' }); toast(t('공유했어요')); if (r.url) window.open(r.url, '_blank'); render(); }
      catch (e) { toast(e.message, true); b.disabled = false; }
    }));
    $$('[data-unshare]', el).forEach((b) => (b.onclick = async () => { await api(`/api/ports/${b.dataset.unshare}/unshare`, { method: 'POST' }).catch((e) => toast(e.message, true)); render(); }));
    $$('[data-stop]', el).forEach((b) => (b.onclick = async () => {
      const ok = await pick(t(':{port} 서버를 멈출까요?', { port: b.dataset.port }), [{ value: true, label: t('멈추기'), desc: t('프로세스 {pid}에 종료 신호를 보내요', { pid: b.dataset.stop }), danger: true }, { value: false, label: t('취소') }]);
      if (!ok) return;
      try { await api(`/api/pids/${b.dataset.stop}/stop`, { method: 'POST' }); toast(t('멈췄어요')); setTimeout(render, 800); } catch (e) { toast(e.message, true); }
    }));
  };
  const draw = () => {
    const el = $('#plist');
    if (!el) return;
    const searching = Boolean(q.trim()), m = mine.filter(hit), sy = sys.filter(hit);
    el.innerHTML = searching && !m.length && !sy.length
      ? `<div class="empty"><b>${t('검색 결과가 없어요')}</b></div>`
      : `<div class="section"><div class="section-h"><h2>${t('내 서버')}</h2><span class="count">${m.length}</span></div>
      ${m.length ? m.map(portCard).join('') : `<div class="card empty"><b>${searching ? t('검색 결과가 없어요') : t('실행 중인 서버가 없어요')}</b></div>`}</div>
    ${sy.length ? `<div class="section"><details class="sysports"${searching ? ' open' : ''}><summary>${t('시스템 서비스 {n}개', { n: sy.length })}</summary>
      <div class="card list">${sy.map(sysRow).join('')}</div></details></div>` : ''}`;
    bind(el);
  };
  $('#pq').oninput = (e) => { q = e.target.value; sessionStorage.setItem('pq', q); draw(); };
  $('#prefresh').onclick = () => render();
  draw();
}

// ---------------------------------------------------------------- SKILLS
async function viewSkills(_, params) {
  const v = shell({ title: t('스킬'), fab: false });
  v.innerHTML = '<div class="section"><div class="skeleton" style="height:300px"></div></div>';
  const d = await api('/api/skills');
  const f = store.get('skfilter', { tool: '', used: false });
  let q = sessionStorage.getItem('skq') || '';
  const draw = () => {
    let list = d.skills.filter((s) => (!f.tool || s.tool === f.tool) && (!f.used || s.uses)
      && matchQ(q, s.name, s.alias, s.kind === 'command' && `/${s.name}`, s.description, s.scopeLabel, s.pathShort, TOOL[s.tool]?.name));
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
    $('#sklist').innerHTML = `<p class="small muted" style="margin:4px 2px 12px">${q.trim() ? `${t('{n}개 찾음', { n: list.length })} · ` : ''}${t('전체 {n}개 · 최근 30일 동안 {m}개가 실제로 쓰였어요', { n: d.skills.length, m: used30 })}</p>`
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
  v.innerHTML = `${searchBox('skq', q, t('스킬 이름·설명·위치 검색'))}<div class="chips" id="skf"></div><div id="sklist"></div>`;
  $('#skq').oninput = (e) => { q = e.target.value; sessionStorage.setItem('skq', q); draw(); };
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

// ---------------------------------------------------------------- MCP
const MCP_ST = { ok: ['ok', t('연결됨')], fail: ['fail', t('연결 실패')], auth: ['auth', t('인증 필요')], pending: ['pend', t('연결 중')], unknown: ['pend', t('상태 모름')] };
const mcpDot = (st) => (st ? `<i class="mcp-dot ${(MCP_ST[st.status] || MCP_ST.unknown)[0]}" title="${esc((MCP_ST[st.status] || MCP_ST.unknown)[1])} · ${esc(ago(st.at))}"></i>` : '');
const mcpTransport = (s) => (s.transport === 'stdio' ? t('로컬 실행') : s.transport && s.transport !== '?' ? s.transport.toUpperCase() : '');
const mcpTarget = (s) => (s.url ? s.url : s.command ? [s.command, ...(s.args || [])].join(' ') : '');
const mcpFlags = (s) => [
  s.enabled === false ? `<span class="flag">${t('꺼짐')}</span>` : s.enabled === 'pending' ? `<span class="flag warn">${t('승인 대기')}</span>` : '',
  s.status?.status === 'fail' ? `<span class="flag err">${t('연결 실패')}</span>` : s.status?.status === 'auth' ? `<span class="flag warn">${t('인증 필요')}</span>` : '',
].join('');
/** One row per server. `opts.session` highlights calls made in that session; `opts.here` labels usage as "in this project". */
function mcpRow(s, { session = false, here = false } = {}) {
  const top = (s.tools || []).slice(0, 3).map((x) => `${esc(x.name)}${x.n > 1 ? ` ×${x.n}` : ''}`).join(', ');
  const usage = session && s.sessionUses ? `<span class="flag run">${t('이 세션 {n}회', { n: s.sessionUses })}</span>` : s.uses ? `<span class="flag run">${t('{n}회', { n: s.uses })}</span>` : '';
  const target = mcpTarget(s);
  const meta = !s.lastUsed ? t('최근 30일 호출 없음') : here ? t('이 프로젝트에서 마지막 사용 {when}', { when: ago(s.lastUsed) }) : t('마지막 사용 {when}', { when: ago(s.lastUsed) });
  return `<a class="srow mcprow ${s.enabled === true ? '' : 'off'}" href="#/mcp/${s.id}">
    <div class="body"><div class="t">${mcpDot(s.status)}<span class="tt">${esc(s.name)}</span>${usage}${mcpFlags(s)}</div>
      ${target ? `<div class="p mono">${esc(target)}</div>` : ''}
      <div class="m">${mcpTransport(s) ? `<span class="flag">${esc(mcpTransport(s))}</span>` : ''}${s.why ? `<span>${esc(s.why)}</span>` : `<span>${meta}</span>`}${top ? `<span>· ${top}</span>` : ''}</div></div></a>`;
}

async function viewMcps() {
  const v = shell({ title: t('MCP 서버'), fab: false, right: `<button class="icon-btn" id="madd" aria-label="${t('추가')}">${ICON.plus}</button><button class="icon-btn" id="mcheck" aria-label="${t('연결 확인')}">${ICON.refresh}</button>` });
  v.innerHTML = '<div class="section"><div class="skeleton" style="height:300px"></div></div>';
  $('#madd').onclick = () => mcpQuickSheet();
  let d = await api('/api/mcp');
  const f = store.get('mcpfilter', { tool: '', used: false });
  let q = sessionStorage.getItem('mcpq') || '';
  const draw = () => {
    const list = d.servers.filter((s) => (!f.tool || s.tool === f.tool) && (!f.used || s.uses)
      && matchQ(q, s.name, s.scopeLabel, mcpTarget(s), s.fileShort, TOOL[s.tool]?.name, ...(s.tools || []).map((x) => x.name)));
    const groups = new Map();
    for (const s of list) { const k = `${s.tool}|${s.scopeLabel}`; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(s); }
    const order = { local: 0, project: 1, user: 2, cloud: 3, plugin: 4, managed: 5, builtin: 6, unlisted: 7 };
    const keys = [...groups.keys()].sort((a, b) => {
      const ga = groups.get(a), gb = groups.get(b);
      const ua = Math.max(0, ...ga.map((x) => x.lastUsed || 0)), ub = Math.max(0, ...gb.map((x) => x.lastUsed || 0));
      return (order[ga[0].scope] - order[gb[0].scope]) || (ub - ua);
    });
    const used = d.servers.filter((s) => s.uses).length;
    $('#mcplist').innerHTML = `<p class="small muted" style="margin:4px 2px 12px">${q.trim() ? `${t('{n}개 찾음', { n: list.length })} · ` : ''}${t('전체 {n}개 · 최근 30일 동안 {m}개가 실제로 호출됐어요', { n: d.servers.length, m: used })}</p>`
      + (keys.length ? keys.map((k) => {
        const items = groups.get(k).sort((a, b) => (b.lastUsed || 0) - (a.lastUsed || 0) || a.name.localeCompare(b.name));
        const [tool, label] = k.split('|');
        return `<div class="section"><div class="section-h"><h2><span class="tool-badge ${tool}">${TOOL[tool].name}</span> ${esc(label)}</h2><span class="count">${items.length}</span></div>
          <div class="card list">${items.map((s) => mcpRow(s)).join('')}</div></div>`;
      }).join('') : `<div class="empty"><b>${d.servers.length ? t('조건에 맞는 MCP 서버가 없어요') : t('설정된 MCP 서버가 없어요')}</b>${d.servers.length ? '' : t('CLI에 MCP를 추가하면 여기에 나타나요 (예: claude mcp add …)')}</div>`)
      + `<p class="small muted" style="text-align:center;line-height:1.6;margin-top:16px">${t('호출 기록은 Claude Code와 Codex 세션에서 읽어요')}<br>${t('↻ 버튼은 claude mcp list로 실제 연결 상태와 claude.ai 커넥터를 확인해요')}</p>`;
  };
  v.innerHTML = `${searchBox('mcpq', q, t('서버 이름·도구·명령·위치 검색'))}<div class="chips" id="mcpf"></div><div id="mcplist"></div>`;
  $('#mcpq').oninput = (e) => { q = e.target.value; sessionStorage.setItem('mcpq', q); draw(); };
  const chips = () => {
    const has = new Set(d.servers.map((s) => s.tool));
    $('#mcpf').innerHTML = [['', t('전체')], ...TOOL_IDS().filter((k) => has.has(k) || INSTALLED().includes(k)).map((k) => [k, TOOL[k].name])].map(([k, l]) => `<button class="chip ${f.tool === k ? 'on' : ''}" data-t="${k}">${l}</button>`).join('')
      + `<button class="chip ${f.used ? 'on' : ''}" id="mcpused">${t('쓰인 것만')}</button>`;
    $$('[data-t]', v).forEach((b) => (b.onclick = () => { f.tool = b.dataset.t; store.set('mcpfilter', f); chips(); draw(); }));
    $('#mcpused').onclick = () => { f.used = !f.used; store.set('mcpfilter', f); chips(); draw(); };
  };
  $('#mcheck').onclick = async () => {
    const b = $('#mcheck'); b.disabled = true; b.classList.add('spin');
    try {
      const r = await api('/api/mcp/check', { body: { tool: 'claude' } });
      if (r.error) toast(r.error, true); else if (r.supported) toast(t('연결 상태를 확인했어요'));
      d = await api('/api/mcp?fresh=1'); chips(); draw();
    } catch (e) { toast(e.message, true); }
    b.disabled = false; b.classList.remove('spin');
  };
  chips(); draw();
}

async function viewMcp([id]) {
  const v = shell({ title: t('MCP 서버'), fab: false, right: `<a class="icon-btn" href="#/mcp" aria-label="${t('목록')}">${ICON.back}</a>` });
  const s = await api(`/api/mcp/${encodeURIComponent(id)}`);
  const kv = (k, val) => (val ? `<div class="kv"><b>${k}</b><code>${val}</code></div>` : '');
  const scopeHelp = {
    user: t('이 CLI가 어느 폴더에서 작업하든 항상 불러와요'),
    local: t('이 프로젝트 폴더에서만, 이 컴퓨터의 나에게만 적용돼요 (git에 올라가지 않아요)'),
    project: t('이 프로젝트 폴더(와 하위 폴더)에서 작업할 때 불러와요. 설정 파일을 커밋하면 팀원도 같이 써요'),
    plugin: t('플러그인이 켜져 있으면 모든 폴더에서 불러와요'),
    managed: t('회사 관리자가 배포한 설정이라 여기서 바꿀 수 없어요'),
    cloud: t('claude.ai 계정에 연결한 커넥터예요. 로그인한 모든 Claude Code에서 쓸 수 있어요'),
    builtin: t('CLI에 들어 있는 서버예요'),
    unlisted: t('세션 기록에는 있지만 지금 설정 파일에서는 찾지 못했어요 (지워졌거나 다른 곳에서 추가됐어요)'),
  };
  const sessions = s.sessions.length
    ? `<div class="card list">${s.sessions.map((x) => { const [tool, sid] = x.key.split(/:(.+)/); return `<a class="srow" href="#/s/${tool}/${encodeURIComponent(sid)}"><div class="tool-avatar ${tool}">${TOOL[tool]?.short || '?'}</div><div class="body"><div class="t"><span class="tt">${esc(x.cwd ? projectName(x.cwd) : sid.slice(0, 8))}</span></div><div class="m"><span>${ago(x.ts)}</span><span>· ${t('{n}회', { n: x.n })}</span></div></div></a>`; }).join('')}</div>`
    : `<div class="card empty"><b>${t('최근 30일 동안 호출된 적이 없어요')}</b>${s.tool === 'claude' || s.tool === 'codex' ? t('필요 없는 서버라면 꺼두면 컨텍스트(토큰)를 아낄 수 있어요') : t('이 CLI는 호출 기록을 아직 읽지 못해요')}</div>`;
  v.innerHTML = `
    <div class="section"><h1 class="sk-title">${mcpDot(s.status)} ${esc(s.name)}</h1>
      <div class="m mcp-meta"><span class="tool-badge ${s.tool}">${TOOL[s.tool].name}</span><span class="flag">${esc(s.scopeLabel)}</span>${mcpTransport(s) ? `<span class="flag">${esc(mcpTransport(s))}</span>` : ''}${mcpFlags(s)}</div>
      <p class="sk-desc">${esc(scopeHelp[s.scope] || '')}${s.why ? `<br><b>${esc(s.why)}</b>` : ''}</p>
      ${s.status ? `<p class="small muted">${t('마지막 확인: {st} · {when}', { st: (MCP_ST[s.status.status] || MCP_ST.unknown)[1], when: ago(s.status.at) })}${s.status.detail && s.status.status !== 'ok' ? ` — ${esc(s.status.detail)}` : ''}</p>` : ''}
      <div class="card sk-path">
        ${kv(t('실행 명령'), s.command ? esc([s.command, ...(s.args || [])].join(' ')) : '')}
        ${kv('URL', s.url ? esc(s.url) : '')}
        ${kv(t('환경 변수'), s.envKeys?.length ? esc(s.envKeys.join(', ')) + ` <span class="muted">(${t('값은 숨김')})</span>` : '')}
        ${kv(t('헤더'), s.headerKeys?.length ? esc(s.headerKeys.join(', ')) + ` <span class="muted">(${t('값은 숨김')})</span>` : '')}
        ${kv(t('허용 도구'), s.toolsAllow?.length ? esc(s.toolsAllow.join(', ')) : '')}
        ${kv(t('막은 도구'), s.toolsDeny?.length ? esc(s.toolsDeny.join(', ')) : '')}
        ${kv(t('설정 파일'), s.fileShort ? esc(s.fileShort) : '')}
        ${s.projectShort ? kv(t('프로젝트'), `<a href="#/p/${encodeURIComponent(s.project)}">${esc(s.projectShort)}</a>`) : ''}
      </div>
      ${s.twins?.length ? `<p class="small muted">${t('같은 이름이 다른 곳에도 설정돼 있어요:')} ${s.twins.map((x) => `<a href="#/mcp/${x.id}">${esc(x.scopeLabel)}</a>`).join(', ')}</p>` : ''}
    </div>
    ${s.tools.length ? `<div class="section"><div class="section-h"><h2>${t('호출한 도구')}</h2><span class="count">${t('{n}회', { n: s.uses })}</span></div>
      <div class="card list">${s.tools.map((x) => `<div class="srow"><div class="body"><div class="t"><span class="tt mono">${esc(x.name)}</span><span class="flag run">${t('{n}회', { n: x.n })}</span></div></div></div>`).join('')}</div></div>` : ''}
    <div class="section"><div class="section-h"><h2>${t('쓴 세션')}</h2><span class="count">${s.sessions.length}</span></div>${sessions}</div>
    ${['user', 'local', 'project'].includes(s.scope) && s.file ? `<div class="section"><div class="pact">
      <button class="btn sm" id="mcopy">${t('다른 CLI에도 추가')}</button>
      ${s.scope === 'user' || s.tool === 'claude' ? `<button class="btn sm ghost danger" id="mrm">${t('삭제')}</button>` : ''}</div></div>` : ''}`;
  $('#mcopy', v) && ($('#mcopy', v).onclick = async () => {
    const targets = INSTALLED().filter((k) => k !== s.tool || s.scope !== 'user');
    const tools = await sheet({
      title: t('{name}을(를) 다른 CLI에도 추가', { name: s.name }),
      body: `<div class="pwform"><p class="small muted">${t('설정(키·토큰 포함)을 그대로 복사해서 각 CLI의 전역 설정에 넣어요.')}</p><div class="chips">${targets.map((k) => `<label class="chip check"><input type="checkbox" data-tool="${k}" ${k !== s.tool ? 'checked' : ''}>${TOOL[k].name}</label>`).join('')}</div></div>`,
      footer: `<button class="btn ghost" data-x>${t('취소')}</button><button class="btn primary" data-ok>${t('추가')}</button>`,
      onMount: (el, close) => {
        $('[data-x]', el).onclick = () => close(undefined);
        $('[data-ok]', el).onclick = () => close($$('[data-tool]', el).filter((c) => c.checked).map((c) => c.dataset.tool));
      },
    });
    if (!tools?.length) return;
    try {
      const r = await api('/api/mcp/copy', { body: { id: s.id, tools } });
      const bad = r.results.filter((x) => !x.ok);
      if (bad.length) toast(bad.map((x) => `${TOOL[x.tool].name}: ${x.error}`).join(' · '), true);
      else toast(t('✅ {name} 추가했어요 · {list}', { name: r.name, list: r.results.map((x) => TOOL[x.tool].name).join(', ') }));
    } catch (e) { toast(e.message, true); }
  });
  $('#mrm', v) && ($('#mrm', v).onclick = async () => {
    if (!confirm(t('{name}을(를) {tool} 설정에서 지울까요? (파일은 백업해둬요)', { name: s.name, tool: TOOL[s.tool].name }))) return;
    try { await api('/api/mcp/remove', { body: { id: s.id } }); toast(t('지웠어요')); location.hash = '#/mcp'; }
    catch (e) { toast(e.message, true); }
  });
}

/** Pick a preset (or custom) and add it. */
async function mcpQuickSheet() {
  const [{ presets }, rep] = await Promise.all([api('/api/mcp/presets'), api('/api/mcp').catch(() => ({ servers: [] }))]);
  const where = (id) => [...new Set(rep.servers.filter((x) => x.name === id && x.scope === 'user').map((x) => x.tool))];
  const id = await pick(t('어떤 MCP를 추가할까요?'), [...presets.map((p) => ({ value: p.id, label: `${p.icon} ${p.name}${where(p.id).length ? ' ✓' : ''}`, desc: p.desc })), { value: '__custom', label: `✏️ ${t('직접 추가')}`, desc: t('실행 명령이나 URL을 알고 있을 때') }]);
  if (!id) return;
  await mcpAddSheet(id === '__custom' ? null : presets.find((p) => p.id === id), id === '__custom' ? [] : where(id), () => render());
}

/** "Which MCP servers does each CLI load here?" — used on the project page and in the chat sheet. */
function mcpEffectiveHtml(d, { session = false, only } = {}) {
  const tools = Object.entries(d.tools).filter(([k]) => !only || k === only);
  return tools.map(([tool, x]) => {
    const on = x.servers.filter((s) => s.enabled === true);
    const rest = x.servers.filter((s) => s.enabled !== true);
    return `<div class="mcp-tool">
      <div class="mcp-th"><span class="tool-badge ${tool}">${TOOL[tool].name}</span><span class="small muted">${on.length ? t('{n}개 불러옴', { n: on.length }) : t('MCP 없음')}${x.checkedAt ? ` · ${t('확인 {when}', { when: ago(x.checkedAt) })}` : ''}</span>
        ${tool === 'claude' ? `<button class="btn sm ghost" data-mcpcheck="${tool}">${t('연결 확인')}</button>` : ''}</div>
      ${x.servers.length ? `<div class="card list">${[...on, ...rest].map((s) => mcpRow(s, { session, here: true })).join('')}</div>` : ''}
    </div>`;
  }).join('') || `<div class="card empty"><b>${t('설치된 CLI가 없어요')}</b></div>`;
}
function bindMcpCheck(el, cwd, reload) {
  $$('[data-mcpcheck]', el).forEach((b) => (b.onclick = async (e) => {
    e.preventDefault();
    b.disabled = true; b.textContent = t('확인 중…');
    try { const r = await api('/api/mcp/check', { body: { tool: b.dataset.mcpcheck, cwd } }); if (r.error) toast(r.error, true); }
    catch (err) { toast(err.message, true); }
    reload();
  }));
}
async function loadProjectMcp(box, cwd) {
  if (!box) return;
  const draw = async () => {
    try {
      const d = await api(`/api/mcp/effective?cwd=${encodeURIComponent(cwd)}`);
      const total = Object.values(d.tools).reduce((n, x) => n + x.servers.filter((s) => s.enabled === true).length, 0);
      box.innerHTML = `<div class="section-h"><h2>${t('MCP 서버')}</h2><span class="count">${total}</span><a class="more" href="#/mcp">${t('전체 ›')}</a></div>
        <p class="small muted" style="margin:-4px 2px 8px">${t('이 폴더에서 작업할 때 각 CLI가 불러오는 MCP예요')}</p>${mcpEffectiveHtml(d)}`;
      bindMcpCheck(box, cwd, draw);
    } catch { box.remove(); }
  };
  await draw();
}
async function mcpSessionSheet(session) {
  const cwd = session.cwd || session.project;
  const body = `<div id="mcpsheet"><div class="skeleton" style="height:120px"></div></div>`;
  return sheet({
    title: t('이 세션의 MCP'), body,
    onMount: async (el) => {
      const box = $('#mcpsheet', el);
      const draw = async () => {
        try {
          const d = await api(`/api/mcp/effective?cwd=${encodeURIComponent(cwd)}&tool=${session.tool}&session=${encodeURIComponent(`${session.tool}:${session.id}`)}`);
          const x = d.tools[session.tool];
          box.innerHTML = `<p class="small muted" style="margin:0 2px 10px">${t('{name}가 {p} 폴더에서 불러오는 MCP예요', { name: TOOL[session.tool].name, p: esc(shortPath(cwd)) })}${x && !x.tracked ? `<br>${t('이 CLI는 호출 기록을 아직 읽지 못해요')}` : ''}</p>${mcpEffectiveHtml(d, { session: true, only: session.tool })}`;
          bindMcpCheck(box, cwd, draw);
        } catch (e) { box.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
      };
      draw();
    },
  });
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
  v.classList.add('setup-view');
  v.innerHTML = '<div class="section"><div class="skeleton" style="height:120px"></div></div><div class="section"><div class="skeleton" style="height:320px"></div></div>';
  const st = await api('/api/setup?fresh=1');
  const ok = (b) => `<span class="pill ${b ? 'ok' : 'no'}">${b ? '✓' : '✕'}</span>`;
  const ready = (x) => x.installed && (x.loggedIn || x.optionalLogin);
  const anyReady = st.tools.some(ready);
  const ts = st.tailscale;
  const pcOk = st.node.ok && st.git.installed;
  const phoneOk = Boolean(ts.url);
  const remote = !st.local;
  const steps = [
    ['pc', t('컴퓨터 준비'), pcOk],
    ['ai', t('AI 연결'), anyReady],
    ['mcp', t('도구 붙이기'), null],
    ['phone', t('폰 연결'), phoneOk || remote],
    ['auto', t('자동 시작'), st.autostart.enabled],
  ];
  const stepH = (i, id, title, sub, optional) => `<div class="section-h step-h" id="step-${id}"><h2><span class="stepnum ${steps[i][2] ? 'done' : ''}">${steps[i][2] ? '✓' : i + 1}</span>${title}${optional ? ` <span class="opt">${t('선택')}</span>` : ''}</h2></div>${sub ? `<p class="small muted step-sub">${sub}</p>` : ''}`;

  const toolCard = (x) => {
    const state = !x.installed ? 'missing' : x.loggedIn ? 'ready' : x.optionalLogin ? 'ready' : 'login';
    const badge = x.provider && x.installed ? `<span class="pill ${x.loggedIn ? 'ok' : 'warn'}">${esc(x.provider)}</span>` : state === 'ready' ? `<span class="pill ok">${x.loggedIn ? t('사용 준비 완료') : t('설치됨')}</span>`
      : state === 'login' ? `<span class="pill warn">${t('로그인 필요')}</span>` : `<span class="pill">${t('설치 안 됨')}</span>`;
    const btns = [];
    if (!x.installed && x.canInstall) btns.push(`<button class="btn sm primary" data-job="install" data-tool="${x.id}">${t('원클릭 설치')}</button>`);
    if (x.installed && !x.loggedIn && x.loginKind !== 'terminal') btns.push(`<button class="btn sm ${state === 'login' ? 'primary' : ''}" data-job="login" data-tool="${x.id}">${t('구독 계정으로 로그인')}</button>`);
    if (x.installed && (x.loggedIn || x.optionalLogin)) btns.push(`<button class="btn sm ghost" data-test="${x.id}">${t('연결 테스트')}</button>`);
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
  const toolStrip = () => `<div class="tool-strip">${st.tools.map((x) => `<span class="ts-item ${ready(x) ? 'on' : x.installed ? 'half' : ''}"><span class="tool-avatar ${x.id}">${esc(TOOL[x.id]?.short || '?')}</span>${esc(x.name)}<em>${ready(x) ? (x.provider ? esc(x.provider) : '✓') : x.installed ? t('로그인 필요') : t('없음')}</em></span>`).join('')}</div>`;

  const AI_MODES = [
    ['sub', '🎟', t('구독 계정'), t('Claude Pro·Max, ChatGPT Plus, Google, Cursor')],
    ['key', '🔑', t('API 키'), t('키를 붙여넣으면 맞는 도구에 알아서 연결해요')],
    ['company', '🏢', t('회사 계정'), t('Amazon Bedrock · Google Vertex · 사내 게이트웨이')],
    ['local', '🖥', t('내 컴퓨터·서버의 모델'), t('Ollama · LM Studio · vLLM 같은 자체 서빙')],
  ];
  let aiMode = sessionStorage.getItem('setup.ai') || 'sub';

  const phoneSteps = () => {
    const isPhone = /iPhone|iPad|Android/.test(navigator.userAgent);
    const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
    const phones = ts.phones || [];
    const li = (done, title, body) => `<li class="pstep ${done ? 'done' : ''}"><span class="pdot">${done ? '✓' : ''}</span><div><b>${title}</b>${body ? `<div class="pbody">${body}</div>` : ''}</div></li>`;
    if (remote) {
      return `<div class="card pad"><div class="banner ok-banner">✅ ${t('이 기기는 Baton에 연결돼 있어요')}</div><ol class="psteps">
        ${li(standalone, t('홈 화면에 추가하기'), standalone ? t('앱처럼 열려 있어요') : isPhone && /iPhone|iPad/.test(navigator.userAgent) ? t('Safari 아래쪽 공유 버튼 → 「홈 화면에 추가」. 아이폰은 이렇게 해야 알림을 받을 수 있어요') : t('Chrome ⋮ 메뉴 → 「앱 설치」 또는 「홈 화면에 추가」'))}
        ${li(false, t('알림 켜기'), `${t('응답이 끝나면 폰이 울려요')} <a class="btn sm" href="#/settings">${t('설정에서 켜기')} ›</a>`)}
      </ol></div>`;
    }
    const tsInstall = st.os === 'linux' || st.os === 'wsl' ? `<code class="copy" data-copy="curl -fsSL https://tailscale.com/install.sh | sh">curl -fsSL https://tailscale.com/install.sh | sh</code>` : '';
    const tsLogin = st.os === 'linux' || st.os === 'wsl' ? `<code class="copy" data-copy="sudo tailscale up">sudo tailscale up</code>` : t('Tailscale 앱을 열고 로그인하세요 (Google·Microsoft·GitHub 계정)');
    return `<div class="card pad"><ol class="psteps">
      ${li(ts.installed && ts.online, t('이 PC에 Tailscale 설치·로그인'), ts.installed && ts.online ? esc(ts.host || '') : `${t('내 기기끼리만 연결되는 무료 앱이에요. 인터넷에 공개되지 않아요.')}<div class="pact">${!ts.installed ? `<a class="btn sm primary" href="https://tailscale.com/download" target="_blank" rel="noopener">${t('다운로드')} ↗</a>` : ''}</div>${!ts.installed ? tsInstall : tsLogin}`)}
      ${li(phones.length > 0, t('폰에도 Tailscale 앱 설치 → 같은 계정으로 로그인'), phones.length ? phones.map((p) => esc(`${p.name} (${p.os})`)).join(', ')
        : `<div class="qrrow"><div class="qr" data-qr="https://tailscale.com/download"></div><span>${t('폰 카메라로 찍으면 앱 설치 페이지가 열려요. 설치 후 PC와 같은 계정으로 로그인하세요.')}</span></div>`)}
      ${li(Boolean(ts.url), t('Baton을 내 기기에 공유'), ts.url ? `<div class="qrrow"><div class="qr big" data-qr="${esc(ts.url)}"></div><span><b>${t('폰 카메라로 이 QR을 찍으세요')}</b><br>${t('Tailscale이 켜진 내 기기에서만 열려요')}<br><code class="copy" data-copy="${esc(ts.url)}">${esc(ts.url)}</code></span></div>`
        : ts.online ? `<button class="btn sm primary" data-job="tailscale-share">${t('내 기기에 공유')}</button><div class="jobbox" hidden data-for="tailscale-share"></div>` : t('위 단계를 먼저 끝내주세요'))}
      ${li(false, t('폰에서 마무리: 홈 화면에 추가 + 알림 켜기'), t('아이폰: Safari 공유 버튼 → 「홈 화면에 추가」 → 추가된 앱의 설정에서 알림 켜기. 안드로이드: Chrome ⋮ → 「앱 설치」'))}
    </ol></div>`;
  };

  v.innerHTML = `
    <div class="section setup-hero">
      <h2>${remote ? t('Baton 설정 🏃') : t('PC에서 한 번만 설정하면 돼요 🏃')}</h2>
      <p class="muted">${remote ? t('지금 폰(다른 기기)에서 보고 있어요. 설치·로그인은 Baton이 켜진 PC에서 실행되고, 로그인 링크는 이 기기에서 열려요.') : t('AI 도구를 연결하고, 원하면 폰에서도 이어서 쓸 수 있게 해요. 5분이면 끝나요.')}</p>
      <div class="stepbar">${steps.map(([id, title, done], i) => `<a href="#step-${id}" data-jump="${id}" class="${done ? 'done' : ''}"><i>${done ? '✓' : i + 1}</i>${esc(title)}</a>`).join('')}</div>
      <div class="setting lang-row"><div class="l"><b>Language · 언어</b></div>
        <select id="slang"><option value="en" ${LANG === 'en' ? 'selected' : ''}>English</option><option value="ko" ${LANG === 'ko' ? 'selected' : ''}>한국어</option></select></div>
    </div>

    <div class="section">${stepH(0, 'pc', t('컴퓨터 준비'), pcOk ? t('필요한 건 다 있어요') : t('AI 도구를 돌리는 데 필요한 것들이에요'))}
      <details class="card env" ${pcOk ? '' : 'open'}><summary class="setting"><div class="l"><b>${esc(OS_LABEL[st.os] || st.os)} · Node.js v${esc(st.node.version)}${st.git.installed ? ` · Git v${esc(st.git.version || '')}` : ''}</b></div>${ok(pcOk)}</summary>
      <div class="setting"><div class="l"><b>Node.js</b><span>v${esc(st.node.version)}${st.node.ok ? '' : ` — ${t('22.13 이상이 필요해요')}`}</span></div>${ok(st.node.ok)}</div>
      <div class="setting"><div class="l"><b>Git</b><span>${st.git.installed ? `v${esc(st.git.version || '')}` : t('AI 도구가 코드 변경을 관리할 때 필요해요')}</span></div>
        ${st.git.installed ? ok(true) : st.git.canInstall ? `<button class="btn sm primary" data-job="git">${t('설치')}</button>` : `<code class="copy" data-copy="${esc(st.git.hint || '')}">${esc(st.git.hint || '')}</code>`}</div>
      ${st.os === 'windows' ? `<div class="setting"><div class="l"><b>${t('WSL 추천')}</b><span>${t('Codex·Antigravity는 WSL(리눅스)에서 가장 잘 동작해요. WSL 안에서 Baton을 실행하면 모든 도구를 쓸 수 있어요.')}</span></div><a class="btn sm ghost" href="https://learn.microsoft.com/windows/wsl/install" target="_blank" rel="noopener">${t('안내')} ↗</a></div>` : ''}
      <div class="jobbox" hidden data-for="git"></div>
    </details></div>

    <div class="section">${stepH(1, 'ai', t('AI 연결'), t('AI를 어떻게 쓰고 있나요? 하나만 있어도 충분해요.'))}
      <div class="choice-grid" id="aimodes">${AI_MODES.map(([id, icon, title, desc]) => `<button class="choice ${aiMode === id ? 'on' : ''}" data-mode="${id}"><span class="ci">${icon}</span><b>${title}</b><span>${desc}</span></button>`).join('')}</div>
      <div id="aipanel"></div></div>

    <div class="section">${stepH(2, 'mcp', t('AI에 도구 붙이기 (MCP)'), t('브라우저 조작, 최신 문서 검색, GitHub·노션 연동 같은 능력을 더해줘요. 고르면 설치된 CLI 모두에 한 번에 추가해요.'), true)}
      <div id="mcppresets"><div class="skeleton" style="height:140px"></div></div></div>

    <div class="section">${stepH(3, 'phone', t('폰에서 쓰기'), remote ? '' : t('PC에서 돌아가는 AI를 밖에서도 폰으로 이어서 써요. 순서대로 따라 하면 돼요.'), true)}${phoneSteps()}</div>

    <div class="section">${stepH(4, 'auto', t('자동 시작'), '', true)}<div class="card">
      <div class="setting"><div class="l"><b>${t('컴퓨터를 켜면 Baton도 켜기')}</b><span>${st.autostart.supported ? (st.autostart.enabled ? t('켜져 있어요') : t('폰에서 언제든 접속하려면 켜두세요')) : t('이 환경에서는 지원하지 않아요 (systemd 없음). 터미널에서 npm start로 실행하세요.')}</span></div>
        ${st.autostart.supported ? `<button class="btn sm ${st.autostart.enabled ? 'ghost' : 'primary'}" data-job="${st.autostart.enabled ? 'autostart-off' : 'autostart-on'}">${st.autostart.enabled ? t('끄기') : t('켜기')}</button>` : ''}</div>
      <div class="jobbox" hidden data-for="autostart"></div>
    </div></div>

    <div class="section"><button class="btn block ${anyReady ? 'primary' : 'ghost'}" id="sdone">${anyReady ? t('대시보드로 가기 →') : t('나중에 할게요')}</button></div>`;

  // ---- AI panel
  const drawAi = () => {
    const box = $('#aipanel', v);
    $$('#aimodes .choice', v).forEach((b) => b.classList.toggle('on', b.dataset.mode === aiMode));
    if (aiMode === 'sub') {
      box.innerHTML = `<p class="small muted panel-help">${t('도구를 설치하고 구독 계정으로 로그인하세요. 설치하면 그 도구의 세션이 자동으로 Baton에 나타나요.')}</p><div class="setup-tools">${st.tools.map(toolCard).join('')}</div>`;
    } else if (aiMode === 'key') {
      box.innerHTML = `<div class="card pad"><label class="field"><span>${t('API 키 붙여넣기')}</span><input type="password" id="akey" placeholder="sk-ant-… · sk-… · sk-or-… · gsk_…" autocomplete="off" spellcheck="false"></label>
        <div id="akeyout" class="small muted">${t('Anthropic(Claude), OpenAI, OpenRouter, Groq 키를 알아봐요. 키는 이 PC의 CLI 설정 파일에만 저장돼요.')}</div></div>${toolStrip()}`;
      $('#akey', box).oninput = (e) => keyDetect(e.target.value.trim(), $('#akeyout', box));
    } else if (aiMode === 'company') {
      const c = (id, title, desc) => { const x = st.tools.find((y) => y.id === id); return `<div class="setting"><div class="l"><b>${title}</b><span>${desc}</span></div>${x?.installed ? `<button class="btn sm primary" data-connect="${id}">${t('연결')}</button>` : `<button class="btn sm" data-job="install" data-tool="${id}">${t('먼저 설치')}</button>`}</div>`; };
      box.innerHTML = `<p class="small muted panel-help">${t('회사 IT에서 받은 정보(주소·키·리전)를 그대로 넣으면 돼요. CLI 자체 설정 파일에 저장해서 터미널에서도 똑같이 동작해요.')}</p>
        <div class="card">${c('claude', 'Claude Code', t('Amazon Bedrock · Google Vertex · LLM 게이트웨이(LiteLLM 등) · Anthropic API 키'))}
        ${c('codex', 'Codex', t('Azure OpenAI · 사내 게이트웨이 · OpenAI API 키'))}
        <a class="setting" href="#/settings"><div class="l"><b>${t('프록시·인증서 같은 환경 변수')}</b><span>${t('회사 네트워크에서 HTTPS_PROXY, NODE_EXTRA_CA_CERTS 등이 필요하면 설정 → 회사 환경에서 넣어요')}</span></div><span class="muted">›</span></a>
        <div class="jobbox" hidden></div></div>${toolStrip()}`;
    } else {
      box.innerHTML = `<div class="card pad" id="llmscan"><div class="row-h"><b>${t('이 PC에서 실행 중인 모델 서버')}</b><button class="btn sm ghost" id="llmre">${t('다시 찾기')}</button></div><div id="llmlist"><div class="skeleton" style="height:60px"></div></div></div>${toolStrip()}`;
      const scan = async () => {
        const list = $('#llmlist', box);
        list.innerHTML = `<div class="small muted">${t('찾는 중…')}</div>`;
        const d = await api('/api/setup/local-llms').catch(() => ({ servers: [] }));
        list.innerHTML = d.servers.length ? d.servers.map((s, i) => `<div class="llm" data-i="${i}"><div class="l"><b>${esc(s.name)}</b><span class="mono">${esc(s.baseUrl)}</span></div>
            ${s.models.length ? `<select data-model>${s.models.map((m) => `<option>${esc(m)}</option>`).join('')}</select>` : `<input data-model placeholder="${t('모델 이름')}">`}
            <div class="pact"><button class="btn sm primary" data-llm="opencode">${t('OpenCode로 연결')}</button><button class="btn sm ghost" data-llm="claude">Claude Code</button><button class="btn sm ghost" data-llm="codex">Codex</button></div></div>`).join('')
            + `<p class="small muted">${t('OpenCode가 로컬 모델과 가장 잘 맞아요. Claude Code는 서버가 Anthropic API를, Codex는 Responses API를 지원해야 해요 (연결 후 바로 테스트해요).')}</p>`
          : `<div class="empty-mini"><b>${t('실행 중인 모델 서버를 못 찾았어요')}</b><span>${t('Ollama를 설치하고 모델을 받아두면 (예: ollama pull qwen3-coder) 여기서 바로 보여요.')}</span>
            <div class="pact"><a class="btn sm" href="https://ollama.com/download" target="_blank" rel="noopener">${t('Ollama 받기')} ↗</a><button class="btn sm ghost" data-connect="opencode">${t('주소 직접 입력')}</button></div></div>`;
        $$('[data-llm]', list).forEach((b) => (b.onclick = () => {
          const row = b.closest('.llm'), s = d.servers[Number(row.dataset.i)], model = $('[data-model]', row).value.trim();
          const tool = b.dataset.llm;
          if (!st.tools.find((x) => x.id === tool)?.installed) { toast(t('{name}를 먼저 설치해주세요 (구독 계정 탭)', { name: TOOL[tool].name }), true); return; }
          const base = tool === 'claude' ? s.baseUrl.replace(/\/v1$/, '') : s.baseUrl;
          connectSheet(tool, () => setTimeout(render, 400), { kind: tool === 'claude' ? 'gateway' : 'server', values: { name: s.name, baseUrl: base, model } });
        }));
        bindSetupButtons(list);
      };
      $('#llmre', box).onclick = scan;
      scan();
    }
    bindSetupButtons(box);
  };
  // ---- API key detection
  const keyDetect = (key, out) => {
    const has = (id) => st.tools.find((x) => x.id === id)?.installed;
    const go = (label, tool, opts) => `<div class="keyhit"><span>✓ ${label}</span>${has(tool) ? `<button class="btn sm primary" data-keygo="${tool}" data-opts='${esc(JSON.stringify(opts))}'>${t('{name}에 연결', { name: TOOL[tool].name })}</button>` : `<button class="btn sm" data-job="install" data-tool="${tool}">${t('{name} 설치', { name: TOOL[tool].name })}</button>`}</div>`;
    if (!key) { out.innerHTML = t('Anthropic(Claude), OpenAI, OpenRouter, Groq 키를 알아봐요. 키는 이 PC의 CLI 설정 파일에만 저장돼요.'); return; }
    if (/^sk-ant-/.test(key)) out.innerHTML = go(t('Anthropic 키예요'), 'claude', { kind: 'apikey' });
    else if (/^sk-or-/.test(key)) out.innerHTML = go(t('OpenRouter 키예요 — 수백 개 모델을 OpenCode로 쓸 수 있어요'), 'opencode', { kind: 'server', values: { name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1' } });
    else if (/^gsk_/.test(key)) out.innerHTML = go(t('Groq 키예요'), 'opencode', { kind: 'server', values: { name: 'Groq', baseUrl: 'https://api.groq.com/openai/v1' } });
    else if (/^sk-/.test(key)) out.innerHTML = go(t('OpenAI 키예요'), 'codex', { kind: 'apikey' });
    else if (/^AIza/.test(key)) out.innerHTML = `<span class="warn-text">${t('Google AI 키는 지금 CLI 연동을 지원하지 않아요. Antigravity는 Google 계정 로그인으로 써요.')}</span>`;
    else out.innerHTML = `<span>${t('어느 회사 키인지 모르겠어요. 골라주세요:')}</span><div class="pact"><button class="btn sm" data-keygo="claude" data-opts='{"kind":"apikey"}'>Anthropic</button><button class="btn sm" data-keygo="codex" data-opts='{"kind":"apikey"}'>OpenAI</button><button class="btn sm" data-keygo="opencode" data-opts='{"kind":"server"}'>${t('기타 (OpenAI 호환)')}</button></div>`;
    $$('[data-keygo]', out).forEach((b) => (b.onclick = async () => {
      const opts = JSON.parse(b.dataset.opts);
      const tool = b.dataset.keygo;
      if (!has(tool)) { toast(t('{name}를 먼저 설치해주세요 (구독 계정 탭)', { name: TOOL[tool].name }), true); return; }
      if (opts.kind === 'apikey') {
        b.disabled = true;
        try { const r = await api('/api/setup/connect', { body: { tool, kind: 'apikey', fields: { apiKey: key } } }); toast(t('저장했어요: {file}', { file: r.file })); await testConnectionUi(tool); render(); }
        catch (e) { toast(e.message, true); b.disabled = false; }
      } else connectSheet(tool, () => setTimeout(render, 400), { kind: opts.kind, values: { ...(opts.values || {}), apiKey: key } });
    }));
    bindSetupButtons(out);
  };

  // ---- MCP presets
  const drawMcp = async () => {
    const box = $('#mcppresets', v);
    if (!box) return;
    const [{ presets }, rep] = await Promise.all([api('/api/mcp/presets'), api('/api/mcp').catch(() => ({ servers: [] }))]);
    const where = (id) => [...new Set(rep.servers.filter((s) => s.name === id && s.scope === 'user').map((s) => s.tool))];
    const all = store.get('setup.mcpall', false);
    const list = all ? presets : presets.slice(0, 6);
    box.innerHTML = `<div class="preset-grid">${list.map((p) => { const w = where(p.id); return `<button class="preset ${w.length ? 'added' : ''}" data-preset="${p.id}">
        <span class="pi">${p.icon}</span><span class="pb"><b>${esc(p.name)}</b><span>${esc(p.desc)}</span>
        <span class="ptags">${w.length ? `<em class="ok">✓ ${w.map((x) => esc(TOOL[x]?.name || x)).join(', ')}</em>` : ''}${p.oauth ? `<em>${t('로그인 필요')}</em>` : ''}${p.fields.some((f) => f.secret && !f.optional) ? `<em>${t('토큰 필요')}</em>` : ''}${p.missing ? `<em class="warn">${t('{x} 필요', { x: p.missing })}</em>` : ''}</span></span></button>`; }).join('')}</div>
      <div class="pact center">${!all ? `<button class="btn sm ghost" id="mcpmore">${t('더 보기 ({n})', { n: presets.length - list.length })}</button>` : ''}<button class="btn sm ghost" id="mcpcustom">${t('직접 추가')}</button><a class="btn sm ghost" href="#/mcp">${t('설치된 MCP 보기')} ›</a></div>`;
    $$('[data-preset]', box).forEach((b) => (b.onclick = () => mcpAddSheet(presets.find((p) => p.id === b.dataset.preset), where(b.dataset.preset), drawMcp)));
    $('#mcpmore', box) && ($('#mcpmore', box).onclick = () => { store.set('setup.mcpall', true); drawMcp(); });
    $('#mcpcustom', box).onclick = () => mcpAddSheet(null, [], drawMcp);
  };

  function bindSetupButtons(root) {
    $$('code.copy', root).forEach((c) => (c.onclick = () => { navigator.clipboard?.writeText(c.dataset.copy); toast(t('복사했어요')); }));
    $$('[data-connect]', root).forEach((b) => (b.onclick = () => connectSheet(b.dataset.connect, () => setTimeout(render, 400))));
    $$('[data-test]', root).forEach((b) => (b.onclick = async () => { b.disabled = true; await testConnectionUi(b.dataset.test); b.disabled = false; }));
    $$('[data-job]', root).forEach((b) => (b.onclick = async () => {
      const action = b.dataset.job, tool = b.dataset.tool || null;
      const box = (tool && $(`[data-tool-card="${tool}"] .jobbox`, v)) || $(`.jobbox[data-for="${action.replace(/-(on|off)$/, '')}"]`, v) || b.closest('.card, .section')?.querySelector('.jobbox') || (() => { const d = document.createElement('div'); d.className = 'jobbox'; b.after(d); return d; })();
      b.disabled = true;
      try {
        const { job } = await api('/api/setup/jobs', { body: { action, tool } });
        runJobBox(box, job, () => { b.disabled = false; setTimeout(() => render(), 600); });
      } catch (e) { toast(e.message, true); b.disabled = false; }
    }));
    $$('.qr[data-qr]', root).forEach(async (q) => { try { q.innerHTML = (await api(`/api/qr?text=${encodeURIComponent(q.dataset.qr)}`)).svg; } catch { q.remove(); } });
  }

  $('#surefresh').onclick = () => render();
  $('#slang').onchange = async (e) => { await api('/api/settings', { body: { lang: e.target.value } }); location.reload(); };
  $('#sdone').onclick = async () => { await api('/api/settings', { body: { setupDone: true } }); await loadState(); location.hash = '#/'; };
  $$('[data-jump]', v).forEach((a) => (a.onclick = (e) => { e.preventDefault(); $(`#step-${a.dataset.jump}`, v)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }));
  $$('#aimodes .choice', v).forEach((b) => (b.onclick = () => { aiMode = b.dataset.mode; sessionStorage.setItem('setup.ai', aiMode); drawAi(); }));
  bindSetupButtons(v);
  drawAi();
  drawMcp().catch(() => { $('#mcppresets', v).innerHTML = ''; });
}

/** Add an MCP server (preset or custom) to the chosen CLIs. */
async function mcpAddSheet(p, already = [], after) {
  const installed = INSTALLED();
  const field = (f) => `<label><span>${esc(f.label)}</span><input data-f="${f.k}" type="${f.secret ? 'password' : 'text'}" placeholder="${esc(f.ph || '')}" value="${esc(f.value || '')}" autocomplete="off" spellcheck="false"></label>`;
  const body = `<div class="pwform connect-form">
    ${p ? `<p class="small muted">${esc(p.desc)}</p><p class="small mono muted">${esc(p.target)}</p>${p.oauth ? `<p class="small">🔐 ${t('처음 쓸 때 로그인이 필요해요. Claude Code는 터미널에서 claude → /mcp, Codex는 codex mcp login {name}', { name: p.id })}</p>` : ''}${p.missing ? `<p class="small warn-text">${t('이 서버는 {x}가 필요해요. 먼저 설치해주세요.', { x: p.missing })}</p>` : ''}${p.fields.map(field).join('')}`
      : `<label><span>${t('이름')}</span><input data-f="name" placeholder="my-server" autocomplete="off"></label>
         <label><span>${t('실행 명령 또는 URL')}</span><input data-f="target" placeholder="npx -y @scope/server  ·  https://example.com/mcp" autocomplete="off" spellcheck="false"></label>
         <label><span>${t('환경 변수 / 헤더 (한 줄에 하나, KEY=값)')}</span><textarea data-f="pairs" placeholder="API_KEY=…"></textarea></label>`}
    <div class="field"><span>${t('어느 CLI에 추가할까요?')}</span><div class="chips">${installed.map((k) => `<label class="chip check"><input type="checkbox" data-tool="${k}" ${already.includes(k) ? '' : 'checked'}>${TOOL[k].name}${already.includes(k) ? ' ✓' : ''}</label>`).join('')}</div></div>
    <p class="small muted">${t('각 CLI의 전역 설정에 저장돼서 모든 폴더에서 쓸 수 있어요. 기존 파일은 백업해둬요.')}</p></div>`;
  const r = await sheet({
    title: p ? `${p.icon} ${p.name}` : t('MCP 서버 직접 추가'), body,
    footer: `<button class="btn ghost" data-x>${t('취소')}</button><button class="btn primary" data-ok>${t('추가')}</button>`,
    onMount: (el, close) => {
      $('[data-x]', el).onclick = () => close(undefined);
      $('[data-ok]', el).onclick = async () => {
        const vals = Object.fromEntries($$('[data-f]', el).map((i) => [i.dataset.f, i.value]));
        const tools = $$('[data-tool]', el).filter((c) => c.checked).map((c) => c.dataset.tool);
        const b = $('[data-ok]', el); b.disabled = true; b.textContent = t('추가하는 중…');
        try {
          const isUrl = /^https?:\/\//i.test(vals.target || '');
          const req = p ? { preset: p.id, values: vals, tools } : { custom: { name: vals.name, target: vals.target, [isUrl ? 'headers' : 'env']: vals.pairs }, tools };
          close(await api('/api/mcp/add', { body: req }));
        } catch (e) { toast(e.message, true); b.disabled = false; b.textContent = t('추가'); }
      };
    },
  });
  if (!r) return;
  const bad = r.results.filter((x) => !x.ok);
  if (!bad.length) toast(t('✅ {name} 추가했어요 · {list}', { name: r.name, list: r.results.map((x) => TOOL[x.tool].name).join(', ') }));
  else toast(bad.map((x) => `${TOOL[x.tool].name}: ${x.error}`).join(' · '), true);
  after?.();
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

// ---------------------------------------------------------------- HANDOFF (continue a session in another CLI)
/** Highest current usage % for a tool from /api/limits (null if unknown). */
function toolUsage(lim, id) {
  const ws = (lim?.[id]?.windows || []).filter((w) => w.usedPercent != null && !(w.resetsAt && w.resetsAt < Date.now()));
  if (!ws.length) return null;
  return ws.reduce((a, w) => (w.usedPercent > a.usedPercent ? w : a));
}

/**
 * Sheet: pick where to continue `session` — another installed CLI (new session with a handoff note),
 * or back to a linked session it came from. Then send.
 */
async function handoffSheet(session, links = { from: [], to: [] }, { reason = '' } = {}) {
  const lim = await api('/api/limits').catch(() => ({}));
  const others = INSTALLED().filter((id) => id !== session.tool);
  const scored = others.map((id) => ({ id, u: toolUsage(lim, id) })).sort((a, b) => (a.u?.usedPercent ?? 50) - (b.u?.usedPercent ?? 50));
  const best = scored[0]?.id;
  const back = (links.from || []).find((l) => l.tool !== session.tool);
  const options = [];
  if (back) options.push({ value: `back:${back.tool}:${back.id}`, label: t('↩ 원래 {name} 세션으로 돌아가기', { name: TOOL[back.tool]?.name || back.tool }), desc: back.title || '' });
  for (const { id, u } of scored) {
    const usage = u ? t('{label} {p}% 사용', { label: u.weekly ? t('주간') : t('5시간'), p: u.usedPercent }) : t('한도 정보 없음');
    options.push({ value: `new:${id}`, label: `${TOOL[id].name}${id === best ? ` · ${t('추천')}` : ''}`, desc: `${usage} · ${t('새 세션에서 이어서')}` });
  }
  if (!options.length) { toast(t('다른 CLI가 설치되어 있지 않아요. 시작하기에서 설치할 수 있어요'), true); return; }
  const pickV = await pick(reason || t('어느 CLI에서 이어갈까요?'), options);
  if (!pickV) return;
  const [kind, toTool, ...rest] = pickV.split(':');
  const toSessionId = kind === 'back' ? rest.join(':') : null;
  // how to carry the context over: the source agent summarizes itself (like /compact) or Baton extracts it
  let mode = 'extract';
  if (['claude', 'codex'].includes(session.tool)) {
    const srcU = toolUsage(lim, session.tool);
    const exhausted = Boolean(reason) || (srcU && srcU.usedPercent >= 98);
    const opts = [
      { value: 'summary', label: t('{name}가 직접 요약 (compact처럼)', { name: TOOL[session.tool].name }) + (exhausted ? '' : ` · ${t('추천')}`), desc: t('대화 전체를 아는 원래 CLI가 결정·시도·현재 상태를 정리해요. 가장 정확하지만 원래 CLI 토큰을 한 번 써요 (30~90초). 실패하면 자동 정리로 넘어가요') },
      { value: 'extract', label: t('기록에서 자동 정리 (토큰 0)') + (exhausted ? ` · ${t('추천')}` : ''), desc: t('이미 한도에 걸렸을 때. 세션 기록·할 일 목록·파일·git에서 Baton이 뽑아요') },
    ];
    if (exhausted) opts.reverse();
    const m = await pick(t('맥락을 어떻게 넘길까요?'), opts);
    if (!m) return;
    mode = m;
  }
  const msg = await promptSheet(t('{name}에게 보낼 메시지', { name: TOOL[toTool].name }), t('이어서 진행해줘'), { multiline: true, okLabel: t('넘기기') });
  if (msg === undefined || msg === null) return;
  const prefs = composerPrefs(toTool);
  let r;
  if (mode === 'summary') toast(t('{name}가 지금까지를 정리하는 중… (최대 2분)', { name: TOOL[session.tool].name }));
  try {
    r = await api('/api/handoff', { body: { fromTool: session.tool, fromId: session.id, toTool, toSessionId, prompt: msg, model: prefs.model, effort: prefs.effort, perm: prefs.perm, mode } });
  } catch (e) { toast(e.message, true); return; }
  if (r.summaryFailed) toast(t('원래 CLI가 요약하지 못해서 기록에서 자동 정리했어요'), true);
  else toast(t('{name}로 넘겼어요 · 정리 노트: {note}', { name: TOOL[toTool].name, note: r.note }));
  if (toSessionId) location.hash = `#/s/${toTool}/${encodeURIComponent(toSessionId)}`;
  else location.hash = `#/new?tool=${toTool}&attach=${r.run.id}&from=${encodeURIComponent(`${session.tool}:${session.id}`)}&label=${encodeURIComponent(msg)}`;
}

/** Move a session to the folder it really works in (suggested from the files it edited). */
async function moveSessionSheet(s) {
  const d = await api(`/api/sessions/${s.tool}/${encodeURIComponent(s.id)}/folders`);
  const opts = d.suggestions.filter((x) => x.short !== d.current).map((x) => ({ value: x.short, label: projectName(x.short), desc: `${x.short} · ${t('이 세션이 {n}번 작업한 폴더', { n: x.uses })}` }));
  if (d.moved) opts.push({ value: d.original, label: t('↩ 원래 폴더로 되돌리기'), desc: d.original });
  const cwd = await folderPicker(d.current, { suggestions: opts, allowNew: false });
  if (!cwd) return false;
  try {
    const r = await api(`/api/sessions/${s.tool}/${encodeURIComponent(s.id)}/move`, { body: { cwd } });
    const msg = {
      moved: t('{p}로 옮겼어요. Baton과 터미널(claude --resume) 모두 새 폴더 기준이에요', { p: cwd }),
      pending: t('{p}로 옮겼어요. 지금 실행 중이라 터미널 목록은 끝나면 자동으로 옮길게요', { p: cwd }),
      same: t('{p}로 옮겼어요', { p: cwd }),
      unsupported: t('{p}로 옮겼어요. Baton에서 이어가면 새 폴더에서 작업해요', { p: cwd }),
    }[r.terminal] || t('{p}로 옮겼어요', { p: cwd });
    toast(msg);
    return true;
  } catch (e) { toast(e.message, true); return false; }
}

/** New session in the same project folder with any installed CLI (no context carried over). */
async function newSessionHere(session) {
  const lim = await api('/api/limits').catch(() => ({}));
  const scored = INSTALLED().map((id) => ({ id, u: toolUsage(lim, id) }));
  const best = [...scored].filter((x) => x.u).sort((a, b) => a.u.usedPercent - b.u.usedPercent)[0]?.id;
  const opts = scored.map(({ id, u }) => ({
    value: id,
    label: `${TOOL[id].name}${id === session.tool ? ` · ${t('지금 CLI')}` : ''}${id === best && id !== session.tool ? ` · ${t('여유 많음')}` : ''}`,
    desc: u ? t('{label} {p}% 사용', { label: u.weekly ? t('주간') : t('5시간'), p: u.usedPercent }) : t('한도 정보 없음'),
  }));
  const tool = await pick(t('어떤 CLI로 새 세션을 열까요?'), opts);
  if (!tool) return;
  const cwd = session.cwd || session.project || '~';
  location.hash = `#/new?cwd=${encodeURIComponent(cwd)}&tool=${tool}`;
}

/** Banners in a chat: where this session came from / continued to, and a nudge when its CLI is near the limit. */
function handoffBanners(session, links, lim) {
  const out = [];
  for (const l of links.from || []) out.push(`<a class="banner link" href="#/s/${l.tool}/${encodeURIComponent(l.id)}">↩ ${t('{name} 세션에서 이어받았어요', { name: TOOL[l.tool]?.name || l.tool })}${l.title ? ` · ${esc(l.title)}` : ''}</a>`);
  for (const l of (links.to || []).slice(0, 2)) out.push(`<a class="banner link" href="#/s/${l.tool}/${encodeURIComponent(l.id)}">→ ${t('{name}에서 이어서 진행 중', { name: TOOL[l.tool]?.name || l.tool })}${l.title ? ` · ${esc(l.title)}` : ''}</a>`);
  const u = toolUsage(lim, session.tool);
  if (u && u.usedPercent >= 80 && INSTALLED().some((id) => id !== session.tool)) {
    out.push(`<div class="banner warn">⚡ ${t('{name} {label} 한도 {p}% 사용', { name: TOOL[session.tool].name, label: u.weekly ? t('주간') : t('5시간'), p: u.usedPercent })}
      <button class="btn sm" data-newhere>${t('새 세션')}</button><button class="btn sm" data-handoff>${t('이어가기')}</button></div>`);
  }
  return out.join('');
}

// ---------------------------------------------------------------- CONNECT (API keys, Bedrock, Vertex, gateways, own servers)
const CONNECT = {
  claude: [
    { kind: 'apikey', label: () => t('Anthropic API 키'), desc: () => t('console.anthropic.com에서 만든 키로 사용량만큼 결제'),
      fields: [{ k: 'apiKey', label: 'API key', type: 'password', ph: 'sk-ant-…' }] },
    { kind: 'bedrock', label: () => 'Amazon Bedrock', desc: () => t('회사 AWS 계정으로. 이 PC에 AWS 자격 증명(aws configure / SSO)이 있어야 해요'),
      fields: [{ k: 'region', label: 'AWS region', ph: 'us-east-1', value: 'us-east-1' }, { k: 'profile', label: t('AWS 프로필 (선택)'), ph: 'default' }, { k: 'model', label: t('모델 ID 또는 추론 프로필 (선택)'), ph: 'us.anthropic.claude-sonnet-4-5-20250929-v1:0' }] },
    { kind: 'vertex', label: () => 'Google Vertex AI', desc: () => t('회사 GCP 계정으로. gcloud auth application-default login이 되어 있어야 해요'),
      fields: [{ k: 'project', label: 'GCP project id', ph: 'my-project' }, { k: 'region', label: 'Region', ph: 'us-east5', value: 'us-east5' }, { k: 'model', label: t('모델 ID (선택)'), ph: 'claude-sonnet-4-5@20250929' }] },
    { kind: 'gateway', label: () => t('LLM 게이트웨이 · 내 서버'), desc: () => t('Anthropic Messages API(/v1/messages)를 지원하는 주소. LiteLLM 등으로 사내 모델·자체 서빙 모델을 연결할 때'),
      fields: [{ k: 'baseUrl', label: 'Base URL', ph: 'https://llm.company.com' }, { k: 'apiKey', label: t('토큰 (선택)'), type: 'password' }, { k: 'model', label: t('모델 이름'), ph: 'my-model' }] },
    { kind: 'subscription', label: () => t('Claude 구독으로 되돌리기'), desc: () => t('위 설정을 지우고 claude.ai 로그인으로 (필요하면 로그인 버튼을 눌러주세요)'), fields: [] },
  ],
  codex: [
    { kind: 'apikey', label: () => t('OpenAI API 키'), desc: () => t('platform.openai.com 키로 사용량만큼 결제 (codex login --with-api-key)'),
      fields: [{ k: 'apiKey', label: 'API key', type: 'password', ph: 'sk-…' }] },
    { kind: 'server', label: () => t('내 서버 · 사내 게이트웨이 · Azure OpenAI'), desc: () => t('OpenAI Responses API(/v1/responses)를 지원해야 해요. chat 전용 서버는 LiteLLM 같은 프록시를 앞에 두세요'),
      fields: [{ k: 'name', label: t('이름'), ph: 'Company LLM', value: 'Custom server' }, { k: 'baseUrl', label: 'Base URL', ph: 'https://llm.company.com/v1' }, { k: 'apiKey', label: t('API 키 (선택)'), type: 'password' }, { k: 'model', label: t('모델 이름'), ph: 'gpt-oss-120b' }] },
    { kind: 'subscription', label: () => t('ChatGPT 계정으로 되돌리기'), desc: () => t('Baton이 추가한 사용자 지정 서버 설정을 끄고 기본(OpenAI)으로'), fields: [] },
  ],
  opencode: [
    { kind: 'server', label: () => t('OpenAI 호환 서버 (Ollama·vLLM·LM Studio 등)'), desc: () => t('chat completions(/v1/chat/completions)만 지원해도 돼요. 자체 서빙 모델에 가장 잘 맞아요'),
      fields: [{ k: 'name', label: t('이름'), ph: 'Local LLM', value: 'Local LLM' }, { k: 'baseUrl', label: 'Base URL', ph: 'http://localhost:11434/v1' }, { k: 'apiKey', label: t('API 키 (선택)'), type: 'password' }, { k: 'model', label: t('모델 이름'), ph: 'qwen2.5-coder:32b' }] },
  ],
};

async function connectSheet(tool, after, preset = {}) {
  const opts = CONNECT[tool];
  if (!opts) return;
  const kind = preset.kind || await pick(t('{name}를 어떻게 연결할까요?', { name: TOOL[tool].name }), opts.map((o) => ({ value: o.kind, label: o.label(), desc: o.desc() })));
  if (!kind) return;
  const o = opts.find((x) => x.kind === kind);
  if (!o) return;
  const pre = preset.values || {};
  let fields = {};
  if (o.fields.length) {
    const hasProbe = o.fields.some((f) => f.k === 'baseUrl') && o.fields.some((f) => f.k === 'model');
    fields = await sheet({
      title: o.label(),
      body: `<div class="pwform connect-form"><p class="small muted">${esc(o.desc())}</p>${o.fields.map((f) => `<label><span>${esc(f.label)}</span>
        <input data-f="${f.k}" type="${f.type || 'text'}" placeholder="${esc(f.ph || '')}" value="${esc(pre[f.k] ?? f.value ?? '')}" autocomplete="off" spellcheck="false" ${f.k === 'model' && hasProbe ? 'list="cmodels"' : ''}></label>
        ${f.k === 'model' && hasProbe ? `<datalist id="cmodels"></datalist><div class="small muted" id="cprobe">${t('주소를 넣으면 쓸 수 있는 모델 목록을 불러와요')}</div>` : ''}`).join('')}
        <p class="small muted">${t('CLI 자체 설정 파일에 저장돼서 터미널에서도 똑같이 동작해요. 기존 파일은 백업해둬요.')}</p></div>`,
      footer: `<button class="btn ghost" data-x>${t('취소')}</button><button class="btn primary" data-ok>${t('연결')}</button>`,
      onMount: (el, close) => {
        $('[data-x]', el).onclick = () => close(undefined);
        $('[data-ok]', el).onclick = () => close(Object.fromEntries($$('[data-f]', el).map((i) => [i.dataset.f, i.value])));
        if (!hasProbe) return;
        const val = (k) => $(`[data-f="${k}"]`, el)?.value.trim() || '';
        let seq = 0;
        const probe = async () => {
          const base = val('baseUrl');
          if (!/^https?:\/\/./i.test(base)) return;
          const my = ++seq, out = $('#cprobe', el);
          out.textContent = t('모델 목록을 불러오는 중…');
          const r = await api('/api/setup/probe', { body: { baseUrl: base, apiKey: val('apiKey') } }).catch((e) => ({ ok: false, error: e.message }));
          if (my !== seq) return;
          if (r.ok) {
            $('#cmodels', el).innerHTML = r.models.map((m) => `<option value="${esc(m)}">`).join('');
            const mi = $('[data-f="model"]', el);
            if (!mi.value && r.models.length === 1) mi.value = r.models[0];
            out.innerHTML = `✓ ${t('모델 {n}개를 찾았어요. 모델 칸을 누르면 골라요', { n: r.models.length })}`;
          } else out.innerHTML = `<span class="warn-text">${esc(r.error)}</span>`;
        };
        let timer;
        $$('[data-f="baseUrl"], [data-f="apiKey"]', el).forEach((i) => (i.oninput = () => { clearTimeout(timer); timer = setTimeout(probe, 600); }));
        probe();
      },
    });
    if (!fields) return;
  }
  try {
    const r = await api('/api/setup/connect', { body: { tool, kind, fields } });
    toast(t('저장했어요: {file}', { file: r.file }));
  } catch (e) { toast(e.message, true); return; }
  await testConnectionUi(tool);
  after?.();
}

async function testConnectionUi(tool) {
  toast(t('{name} 연결을 확인하는 중…', { name: TOOL[tool].name }));
  try {
    const r = await api('/api/setup/test', { body: { tool } });
    if (r.ok) toast(t('✅ 연결됐어요 ({s}초) · 답: {reply}', { s: (r.ms / 1000).toFixed(1), reply: r.reply.slice(0, 40) }));
    else toast(t('⚠️ 연결 실패: {e}', { e: r.error.slice(0, 160) }), true);
    return r;
  } catch (e) { toast(e.message, true); return null; }
}

// ---------------------------------------------------------------- SCHEDULED MESSAGES
function whenFull(ms) {
  const d = new Date(ms);
  return d.toLocaleString(LOCALE, { month: 'numeric', day: 'numeric', weekday: 'short', hour: 'numeric', minute: '2-digit' });
}

/** Queue a message for `session`: when its CLI's limit resets, or at a chosen time. */
async function scheduleSheet(session, { prompt = '' } = {}) {
  const r = await api(`/api/scheduled/reset/${session.tool}`).catch(() => ({}));
  const opts = [];
  if (r.reset) opts.push({ value: 'reset', label: t('⏳ 한도가 풀리면 바로'), desc: t('{when} · {label} 초기화 직후', { when: whenFull(r.reset.at), label: r.reset.label }) });
  opts.push({ value: 'time', label: t('🕐 시간 정해서'), desc: t('원하는 날짜·시각에 보내요') });
  const when = await pick(t('언제 보낼까요?'), opts);
  if (!when) return false;
  let at = null;
  if (when === 'time') {
    const def = new Date(Date.now() + 3600_000); def.setSeconds(0, 0);
    const local = new Date(def.getTime() - def.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    const v = await sheet({
      title: t('보낼 시각'),
      body: `<div class="pwform"><input type="datetime-local" id="schedat" value="${local}"></div>`,
      footer: `<button class="btn ghost" data-x>${t('취소')}</button><button class="btn primary" data-ok>${t('다음')}</button>`,
      onMount: (el, close) => { $('[data-x]', el).onclick = () => close(undefined); $('[data-ok]', el).onclick = () => close($('#schedat', el).value); },
    });
    if (!v) return false;
    at = new Date(v).getTime();
  }
  const msg = await promptSheet(t('보낼 메시지'), prompt || t('계속해줘. 한도 때문에 멈춘 작업을 이어서 진행해줘.'), { multiline: true, okLabel: t('예약') });
  if (!msg || !msg.trim()) return false;
  const prefs = composerPrefs(session.tool);
  try {
    const { item } = await api('/api/scheduled', { body: { tool: session.tool, sessionId: session.id, prompt: msg.trim(), model: prefs.model, effort: prefs.effort, perm: prefs.perm, when, at } });
    toast(t('⏰ {when}에 보낼게요', { when: whenFull(item.runAt) }));
    return true;
  } catch (e) { toast(e.message, true); return false; }
}

function scheduledBanner(items) {
  return items.filter((x) => x.status === 'pending').map((x) => `<div class="banner sched">⏰ <span>${t('{when}에 보낼 예정', { when: whenFull(x.runAt) })}${x.whenType === 'reset' ? ` · ${t('한도 초기화 후')}` : ''}<br><b>${esc(clip1(x.prompt, 80))}</b></span>
    <button class="btn sm ghost" data-sched-cancel="${x.id}">${t('취소')}</button></div>`).join('');
}
const clip1 = (s, n) => (String(s).length > n ? `${String(s).slice(0, n - 1)}…` : String(s));

async function viewScheduled() {
  const v = shell({ title: t('예약 메시지'), fab: false });
  const d = await api('/api/scheduled?all=1');
  const pending = d.items.filter((x) => x.status === 'pending');
  const done = d.items.filter((x) => x.status !== 'pending').slice(-20).reverse();
  const row = (x) => `<a class="srow" href="#/s/${x.tool}/${encodeURIComponent(x.sessionId)}"><div class="tool-avatar ${x.tool}">${TOOL[x.tool]?.short || '?'}</div>
    <div class="body"><div class="t"><span class="tt">${esc(x.title || x.sessionId)}</span></div>
    <div class="m"><span>${x.status === 'pending' ? t('{when}에 보낼 예정', { when: whenFull(x.runAt) }) : x.status === 'sent' ? t('보냈어요') : x.status === 'canceled' ? t('취소됨') : t('실패: {e}', { e: esc(x.error || '') })}</span></div>
    <div class="p">${esc(x.prompt)}</div></div>${x.status === 'pending' ? `<button class="btn sm ghost" data-sched-cancel="${x.id}">${t('취소')}</button>` : ''}</a>`;
  v.innerHTML = `${pending.length ? `<div class="card list">${pending.map(row).join('')}</div>` : `<div class="empty" style="padding-top:12vh"><b>${t('예약된 메시지가 없어요')}</b>${t('대화 화면 ⋯ 메뉴나 한도 초과 안내에서 예약할 수 있어요')}</div>`}
    ${done.length ? `<div class="section"><div class="section-h"><h2>${t('지난 예약')}</h2></div><div class="card list">${done.map(row).join('')}</div></div>` : ''}`;
  $$('[data-sched-cancel]', v).forEach((b) => (b.onclick = async (e) => { e.preventDefault(); await api(`/api/scheduled/${b.dataset.schedCancel}/cancel`, { method: 'POST' }); toast(t('예약을 취소했어요')); render(); }));
}

// ---------------------------------------------------------------- boot
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
navigator.serviceWorker?.addEventListener('message', (e) => {
  if (e.data?.type === 'navigate' && e.data.url) location.href = e.data.url;
  if (e.data?.type === 'desk-cards?') e.ports[0]?.postMessage({ cards: deskCardsOn() && document.visibilityState === 'visible' });
});
pushStatus().then((p) => { desk.pushOn = Boolean(p.sub); }).catch(() => {});
(async () => {
  $$('[data-t]', $('#tabbar')).forEach((el) => { el.textContent = t(el.dataset.t); });
  await loadState();
  // first run: nothing set up yet -> onboarding
  if (G.state && !G.state.settings?.setupDone && !(G.state.tools || []).some((x) => x.installed) && !location.hash.startsWith('#/setup')) location.hash = '#/setup';
  render();
})();
