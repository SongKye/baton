// Baton — mobile-first PWA front-end (no build step).
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const app = $('#app');
app.addEventListener('error', (event) => {
  if (event.target.matches?.('.uimgs a img')) event.target.closest('a').hidden = true;
}, true);

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
/** Line glyphs (same stroke style as ICON) for lists and cards that used to use emoji. */
const GLYPH = {
  book: '<path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H11v16H5.5A1.5 1.5 0 0 1 4 18.5z"/><path d="M20 5.5A1.5 1.5 0 0 0 18.5 4H13v16h5.5a1.5 1.5 0 0 0 1.5-1.5z"/>',
  browser: '<rect x="3" y="4.5" width="18" height="15" rx="2.5"/><path d="M3 9h18M6.5 6.8h.01M9 6.8h.01"/>',
  wrench: '<path d="M14.5 6.5a4 4 0 0 0 5 5l-8.8 8.8a2.1 2.1 0 0 1-3-3L16.5 8.5"/><path d="M14.5 6.5 17 4l3 3-2.5 2.5"/>',
  branch: '<circle cx="6" cy="5.5" r="2.2"/><circle cx="6" cy="18.5" r="2.2"/><circle cx="18" cy="8" r="2.2"/><path d="M6 7.7v8.6"/><path d="M18 10.2c0 4-6 3.3-11 6.6"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
  doc: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>',
  database: '<ellipse cx="12" cy="6" rx="7" ry="2.8"/><path d="M5 6v12c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8V6"/><path d="M5 12c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8"/>',
  steps: '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/>',
  globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.5 2.6 3.5 5.4 3.5 8.5s-1 5.9-3.5 8.5c-2.5-2.6-3.5-5.4-3.5-8.5s1-5.9 3.5-8.5z"/>',
  ruler: '<path d="M4 15.5 15.5 4 20 8.5 8.5 20z"/><path d="m8 11.5 1.8 1.8M11 8.5l1.8 1.8M14 5.5l1.8 1.8"/>',
  alert: '<path d="M12 4 21 19.5H3z"/><path d="M12 10v4.2M12 17h.01"/>',
  pen: '<path d="M12 20h8"/><path d="M16.5 4.5a2.1 2.1 0 0 1 3 3L8 19l-4 1 1-4z"/>',
  plug: '<path d="M9 3v4M15 3v4"/><path d="M6 7h12v4a6 6 0 0 1-12 0z"/><path d="M12 17v4"/>',
  edit: '<path d="M16.5 4.5a2.1 2.1 0 0 1 3 3L8 19l-4 1 1-4z"/>',
  spark: '<path d="M12 3.5l2.4 5 5.4.6-4 3.7 1.1 5.4L12 15.5l-4.9 2.7 1.1-5.4-4-3.7 5.4-.6z"/>',
  card: '<rect x="3" y="5.5" width="18" height="13" rx="2.5"/><path d="M3 10h18M7 15h3"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 8.5-8.5M16 7l2.5 2.5M14 9l2 2"/>',
  building: '<path d="M5 21V5a1.5 1.5 0 0 1 1.5-1.5h7A1.5 1.5 0 0 1 15 5v16M15 10h3.5A1.5 1.5 0 0 1 20 11.5V21M3 21h18"/><path d="M8.5 7.5h3M8.5 11h3M8.5 14.5h3"/>',
  server: '<rect x="3.5" y="4" width="17" height="7" rx="2"/><rect x="3.5" y="13" width="17" height="7" rx="2"/><path d="M7 7.5h.01M7 16.5h.01"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/>',
  checkCircle: '<circle cx="12" cy="12" r="8.5"/><path d="m8.5 12.2 2.4 2.4 4.6-4.8"/>',
  bell: '<path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/>',
  bellOff: '<path d="M8.7 3.7A6 6 0 0 1 18 8c0 2.6.4 4.6 1 6M17 17H3s3-2 3-9c0-.5 0-1 .2-1.4"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0M3 3l18 18"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  hourglass: '<path d="M6.5 3.5h11M6.5 20.5h11M7.5 3.5c0 4.5 4.5 5.5 4.5 8.5s-4.5 4-4.5 8.5M16.5 3.5c0 4.5-4.5 5.5-4.5 8.5s4.5 4 4.5 8.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  shuffle: '<path d="M16 3.5h4.5V8M20.5 3.5 14 10M4 20l6.5-6.5M16 20.5h4.5V16M14.5 14.5l6 6M4 4l4.5 4.5"/>',
  pin: '<path d="M9 3.5h6M10 3.5v5L7 12.5h10l-3-4v-5M12 12.5V20.5"/>',
  trash: '<path d="M4 7h16M9.5 7V4.5h5V7"/><path d="M6.5 7l1 12.5a1.5 1.5 0 0 0 1.5 1.5h6a1.5 1.5 0 0 0 1.5-1.5l1-12.5"/><path d="M10 11v6M14 11v6"/>',
  eyeOff: '<path d="M3 3l18 18M10.6 5.6A9.6 9.6 0 0 1 12 5.5c5 0 8.5 4.5 9.5 6.5-.5 1-1.5 2.4-2.9 3.7M6.5 6.9C4.6 8.2 3.2 10.2 2.5 12c1 2 4.5 6.5 9.5 6.5 1.6 0 3-.4 4.3-1.1"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
  wrenchSm: '<path d="M14.5 6.5a4 4 0 0 0 5 5l-8.8 8.8a2.1 2.1 0 0 1-3-3L16.5 8.5"/><path d="M14.5 6.5 17 4l3 3-2.5 2.5"/>',
  thought: '<path d="M4 11.5C4 7.4 7.6 4.5 12 4.5s8 2.9 8 7-3.6 7-8 7c-1 0-2-.1-2.9-.4L5 19.5l1.1-3.3C4.8 15 4 13.4 4 11.5z"/>',
  rocket: '<path d="M14 4.5c3-1 5.5-1 5.5-1s0 2.5-1 5.5c-1 3-4 6-7.5 7.5L8.5 14C10 10.5 11 5.5 14 4.5z"/><path d="M8.5 14 5 13l2.5-3.5h3.5M10 15.5l1 3.5 3.5-2.5v-3.5"/><circle cx="15" cy="9" r="1.3"/>',
};
const glyph = (name, cls = '') => `<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true">${GLYPH[name] || GLYPH.plug}</svg>`;
const TOOL_ICON = {
  ports: '<svg class="i" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/><path d="m8 8.5 2 1.5-2 1.5M12.5 11.5H16"/></svg>',
  repos: '<svg class="i" viewBox="0 0 24 24"><circle cx="6" cy="5.5" r="2.2"/><circle cx="6" cy="18.5" r="2.2"/><circle cx="18" cy="8" r="2.2"/><path d="M6 7.7v8.6"/><path d="M18 10.2c0 4-6 3.3-11 6.6"/></svg>',
  skills: '<svg class="i" viewBox="0 0 24 24"><path d="M12 3.5l2.4 5 5.4.6-4 3.7 1.1 5.4L12 15.5l-4.9 2.7 1.1-5.4-4-3.7 5.4-.6z"/></svg>',
  mcp: '<svg class="i" viewBox="0 0 24 24"><path d="M9 3v4M15 3v4"/><path d="M6 7h12v4a6 6 0 0 1-12 0z"/><path d="M12 17v4"/></svg>',
  usage: '<svg class="i" viewBox="0 0 24 24"><path d="M4 20h16"/><rect x="5" y="11" width="3.5" height="6" rx="1"/><rect x="10.25" y="6" width="3.5" height="11" rx="1"/><rect x="15.5" y="13" width="3.5" height="4" rx="1"/></svg>',
  sched: '<svg class="i" viewBox="0 0 24 24"><circle cx="12" cy="13" r="7.5"/><path d="M12 9v4l2.5 2"/><path d="M4.5 4.5 7 3M19.5 4.5 17 3"/></svg>',
  clean: '<svg class="i" viewBox="0 0 24 24"><path d="M12 3.5l1.6 4.4L18 9.5l-4.4 1.6L12 15.5l-1.6-4.4L6 9.5l4.4-1.6z"/><path d="M18.5 15l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8zM5.5 15.5l.6 1.4 1.4.6-1.4.6-.6 1.4-.6-1.4-1.4-.6 1.4-.6z"/></svg>',
  trash: '<svg class="i" viewBox="0 0 24 24"><path d="M4 7h16M9.5 7V4.5h5V7"/><path d="M6.5 7l1 12.5a1.5 1.5 0 0 0 1.5 1.5h6a1.5 1.5 0 0 0 1.5-1.5l1-12.5"/><path d="M10 11v6M14 11v6"/></svg>',
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
// Open sheets, oldest first: Escape closes only the topmost one.
const sheetStack = [];
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
      const at = sheetStack.indexOf(close); if (at >= 0) sheetStack.splice(at, 1);
      document.removeEventListener('keydown', onKey, true);
      scrim.classList.remove('show'); el.classList.remove('show');
      setTimeout(() => { scrim.remove(); el.remove(); }, 250);
      resolve(v);
    };
    // Capture phase so an Escape inside a sheet's text field closes the sheet, not some handler behind it.
    const onKey = (e) => {
      if (e.key !== 'Escape' || e.isComposing || sheetStack[sheetStack.length - 1] !== close) return;
      e.preventDefault(); e.stopPropagation();
      close(undefined);
    };
    sheetStack.push(close);
    document.addEventListener('keydown', onKey, true);
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
  const body = options.map((o, i) => `<button class="opt-row ${o.danger ? 'danger' : ''}" data-i="${i}">${o.icon ? `<span class="oi">${o.icon}</span>` : ''}<div class="l"><b>${esc(o.label)}</b>${o.desc ? `<span>${esc(o.desc)}</span>` : ''}</div>${current !== undefined && o.value === current ? `<span class="check">${ICON.check}</span>` : ''}</button>`).join('');
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
        list.innerHTML = rows.map((x, i) => `<button class="opt-row" data-folder="${i}"><span class="oi">${glyph('folder')}</span><div class="l"><b>${esc(x.label)}</b><span>${esc(x.desc || x.value)}</span></div><span>›</span></button>`).join('') || `<p class="small muted">${t('일치하는 폴더가 없어요')}</p>`;
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
// Same breakpoint as the Studio desktop layout (studio.css, 760px).
const DESK_MQ = matchMedia('(min-width: 760px) and (hover: hover) and (pointer: fine)');
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
  el.innerHTML = `<img src="/icon-handoff-192-v1.png" alt=""><div class="b"><div class="tt">${esc(ev.title || 'Baton')}</div>${ev.body ? `<div class="bd">${esc(ev.body)}</div>` : ''}</div><button class="x" aria-label="${t('닫기')}">${ICON.x}</button>`;
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
  drawRunPill();
}
/** Pill for runs you're not looking at (on desktop it stays visible inside a chat too). */
function drawRunPill() {
  const onScreen = (r) => $(`.live[data-run="${CSS.escape(String(r.id))}"]`) || (r.sessionId && location.hash.startsWith(`#/s/${r.tool}/${encodeURIComponent(r.sessionId)}`));
  const runs = (G.runs || []).filter((r) => !onScreen(r));
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
  [/^#\/s\/([a-z]+)\/(.+)$/, viewChat, null, 'sessions'],
  [/^#\/setup$/, viewSetup, 'settings'],
  [/^#\/new$/, viewNew, null, 'sessions'],
  [/^#\/settings$/, viewSettings, 'settings'],
  [/^#\/inbox$/, viewInbox, 'home'],
  [/^#\/usage$/, viewUsage, 'tools'],
  [/^#\/tools$/, viewTools, 'tools'],
  [/^#\/ports$/, viewPorts, 'tools'],
  [/^#\/repos$/, viewRepos, 'tools'],
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
  const navCount = G.navCount;
  for (const [re, fn, tab, sideTab] of routes) {
    const m = hash.match(re);
    if (!m) continue;
    // tab === null → full-screen chat (mobile hides the tab bar); the desktop sidebar still marks where you are.
    document.body.classList.toggle('chat-mode', tab === null);
    $$('#tabbar a').forEach((a) => a.classList.toggle('on', a.dataset.tab === (tab ?? sideTab)));
    window.scrollTo(0, 0);
    try { await fn(m.slice(1).map(decodeURIComponent), params); drawRunPill(); }
    catch (e) { console.error(e); if (navCount === G.navCount) app.innerHTML = `<div class="empty" style="padding-top:30vh"><b>${t('불러오지 못했어요')}</b>${esc(e.message)}<br><br><button class="btn" onclick="location.reload()">${t('다시 시도')}</button></div>`; }
    return;
  }
  location.hash = '#/';
}
window.addEventListener('hashchange', render);

// ---------------------------------------------------------------- pull to refresh (touch only)
// List screens don't poll, and the installed app has no browser pull-to-refresh (body has overscroll-behavior: none).
// Pulling down from the very top re-renders the current screen; in a chat that means the chat's own scroller.
(() => {
  const PULL = 70, MAX = 110;
  let y0 = null, x0 = 0, dy = 0, pulling = false, busy = false, ind = null;
  const scroller = () => (document.body.classList.contains('chat-mode') ? $('#scroll') : null);
  const atTop = () => { const s = scroller(); return s ? s.scrollTop <= 0 : (window.scrollY || document.documentElement.scrollTop) <= 0; };
  const indicator = () => {
    if (!ind) { ind = document.createElement('div'); ind.className = 'ptr'; ind.innerHTML = '<div class="spinner"></div>'; document.body.append(ind); }
    return ind;
  };
  const show = (d) => {
    const el = indicator(), p = Math.min(1, d / PULL);
    el.style.transition = 'none';
    el.style.opacity = String(p);
    el.style.transform = `translate(-50%, ${Math.min(d, MAX) * 0.6}px) rotate(${p * 270}deg)`;
    el.classList.toggle('ready', d >= PULL);
  };
  const hide = () => { if (!ind) return; ind.style.transition = ''; ind.style.opacity = '0'; ind.style.transform = 'translate(-50%, 0)'; ind.classList.remove('ready', 'busy'); };
  document.addEventListener('touchstart', (e) => {
    y0 = null; pulling = false; dy = 0;
    if (busy || sheetStack.length || e.touches.length !== 1) return;
    if (e.target.closest?.('input, textarea, select, [contenteditable], .sheet, .scrim, .composer')) return;
    if (!atTop()) return;
    y0 = e.touches[0].clientY; x0 = e.touches[0].clientX;
  }, { passive: true });
  document.addEventListener('touchmove', (e) => {
    if (y0 == null) return;
    const t0 = e.touches[0], ddy = t0.clientY - y0, ddx = t0.clientX - x0;
    if (!pulling) {
      if (ddy < -4 || Math.abs(ddx) > Math.abs(ddy) + 4) { y0 = null; return; } // scrolling up or sideways
      if (ddy < 10 || !atTop()) return;
      pulling = true;
    }
    dy = ddy - 10;
    if (e.cancelable) e.preventDefault(); // no rubber-band while pulling
    show(dy);
  }, { passive: false });
  const end = async () => {
    const go = pulling && dy >= PULL;
    y0 = null; pulling = false; dy = 0;
    if (!go) { hide(); return; }
    busy = true;
    const el = indicator();
    el.style.transition = ''; el.style.opacity = '1'; el.style.transform = 'translate(-50%, 42px)';
    el.classList.add('busy');
    try { await Promise.all([render(), loadState()]); } finally { busy = false; hide(); }
  };
  document.addEventListener('touchend', end);
  document.addEventListener('touchcancel', () => { y0 = null; pulling = false; dy = 0; hide(); });
})();

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
  else if (s.terminal && s.background) flags.push(`<span class="flag warn">${t('백그라운드에서 작업 중')}</span>`);
  else if (s.terminal) flags.push(`<span class="flag warn">${s.terminal === 'busy' ? t('PC에서 작업 중') : t('PC에서 열림')}</span>`);
  if (s.automated) flags.push(`<span class="flag">${t('자동')}</span>`);
  else if (s.delegated) flags.push(`<span class="flag" title="${t('다른 도구가 백그라운드로 실행한 세션')}">${t('위임됨')}</span>`);
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
document.addEventListener('wheel', (e) => {
  const h = e.target.closest?.('.hscroll');
  if (!h || e.ctrlKey || e.shiftKey || Math.abs(e.deltaX) >= Math.abs(e.deltaY)) return;
  if (h.scrollWidth <= h.clientWidth + 1 || getComputedStyle(h).overflowX === 'visible') return;
  const max = h.scrollWidth - h.clientWidth;
  // At either end, let the page scroll on as usual.
  if ((e.deltaY < 0 && h.scrollLeft <= 0) || (e.deltaY > 0 && h.scrollLeft >= max - 1)) return;
  e.preventDefault();
  h.scrollLeft += e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
}, { passive: false });
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
async function hideMany(keys, hidden = true) {
  if (!keys.length) return false;
  await api('/api/sessions/hide', { body: { keys, hidden } });
  toast(hidden ? t('{n}개를 숨겼어요 (세션 탭 「숨긴 세션」에서 볼 수 있어요)', { n: keys.length }) : t('{n}개를 다시 보이게 했어요', { n: keys.length }));
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
  const manual = i.manual || 'git pull --ff-only && npm ci --omit=dev';
  // restartOnly: the new version is already downloaded, only the running Baton is old.
  const mode = i.restartOnly ? 'restart' : i.canAuto ? 'update' : i.kind === 'git' ? 'manual' : 'zip';
  const how = mode === 'restart' ? `<p class="small muted">${t('새 버전(v{v})은 이미 받아져 있어요. 다시 켜기만 하면 적용돼요.', { v: esc(i.onDisk || d.latest) })}</p>`
    : mode === 'update' ? `<p class="small muted">${t('버튼을 누르면 새 버전을 받고 필요한 패키지를 설치한 뒤 Baton을 다시 켜요. 대화 기록과 설정은 그대로예요.')}</p>`
    : mode === 'manual' ? `<p class="small warn-text">${i.dirty ? t('Baton 폴더에 고친 파일이 있어서 자동으로 업데이트하지 않아요.') : t('지금 {b} 브랜치라 자동으로 업데이트하지 않아요.', { b: esc(i.branch || '?') })}</p><p class="small muted">${t('터미널에서 직접 실행하세요:')}</p><code class="copy" data-copy="${esc(manual)}">${esc(manual)}</code><p class="small muted">${t('실행한 뒤 아래 「다시 켜기」를 누르면 새 버전으로 켜져요.')}</p>`
      : `<p class="small muted">${t('zip으로 설치했어요. 새 zip을 받아 압축을 풀고, 기존 data 폴더를 옮긴 뒤 설치 스크립트를 다시 실행하세요.')}</p>`;
  await sheet({
    title: `🎉 Baton v${esc(d.latest)}`,
    body: `<div class="update-sheet"><p class="small muted">${t('지금 쓰는 버전: v{c}', { c: esc(d.current) })}${d.publishedAt ? ` · ${t('{when} 출시', { when: ago(d.publishedAt) })}` : ''}</p>
      <div class="card md-card msg-ai update-notes">${d.notes ? md(d.notes) : `<p>${t('바뀐 점은 릴리스 페이지에서 볼 수 있어요')}</p>`}</div>${how}<div class="jobbox" hidden></div></div>`,
    footer: `<a class="btn ghost" href="${esc(d.url)}" target="_blank" rel="noopener">${t('릴리스 페이지')} ↗</a>${mode === 'update' ? `<button class="btn primary" data-up>${t('지금 업데이트')}</button>`
      : mode === 'restart' || mode === 'manual' ? `<button class="btn primary" data-restart>${t('다시 켜기')}</button>`
      : d.zip ? `<a class="btn primary" href="${esc(d.zip)}">${t('zip 받기')}</a>` : ''}`,
    onMount: (el) => {
      $$('code.copy', el).forEach((c) => (c.onclick = () => { navigator.clipboard?.writeText(c.dataset.copy); toast(t('복사했어요')); }));
      const r = $('[data-restart]', el);
      // manual: only wait for the new version if the terminal command already brought it in
      if (r) r.onclick = () => restartBaton(r, { version: mode === 'restart' ? i.onDisk : undefined });
      const b = $('[data-up]', el);
      if (!b) return;
      b.onclick = async () => {
        b.disabled = true;
        try {
          const { job } = await api('/api/setup/jobs', { body: { action: 'update' } });
          runJobBox($('.jobbox', el), job, async (ev) => {
            if (!ev.ok) { b.disabled = false; toast(t('업데이트하지 못했어요. 로그를 확인해주세요'), true); return; }
            await restartBaton(b, { version: d.latest });
          });
        } catch (e) { toast(e.message, true); b.disabled = false; }
      };
    },
  });
}

/** Restart the Baton server, wait until the new process answers (and runs `version`, if given), then reload. */
async function restartBaton(btn, { version } = {}) {
  const before = G.state?.boot;
  const label = btn?.textContent;
  if (btn) { btn.disabled = true; btn.textContent = t('다시 켜는 중…'); }
  await api('/api/update/restart', { method: 'POST' }).catch(() => {});
  for (let k = 0; k < 60; k++) {
    await new Promise((r) => setTimeout(r, 2000));
    try {
      const st = await api('/api/state');
      if (st.boot !== before && (!version || st.version === version)) { location.reload(); return; }
    } catch { /* restarting */ }
  }
  toast(t('다시 켜지지 않았어요. PC에서 Baton을 직접 실행해주세요'), true);
  if (btn) { btn.disabled = false; btn.textContent = label; }
}

/** Settings → Baton card: current version, latest release, an 업데이트 button that is only enabled when
 *  there is something to update to (opens the sheet: update → restart → reload), and a restart button. */
let versionCheckedAt = 0;
function versionCard(box) {
  const draw = (checking = false) => {
    const up = G.state?.update || {};
    const status = checking ? t('새 버전을 확인하는 중…')
      : up.newer ? t('최신 버전: v{v}', { v: esc(up.latest) })
      : up.latest ? t('최신 버전이에요') : t('새 버전을 확인하지 못했어요');
    box.innerHTML = `<div class="setting ${up.newer ? 'update-row' : ''}"><div class="l"><b>Baton v${esc(G.state?.version || '')}</b><span>${up.newer ? '🎉 ' : ''}${status}</span></div>
        <button class="btn sm ${up.newer ? 'primary' : ''}" data-v="update" ${up.newer && !checking ? '' : 'disabled'}>${t('업데이트')}</button></div>
      <div class="setting"><div class="l"><b>${t('Baton 다시 켜기')}</b><span>${t('Baton 서버를 껐다 켜요. 터미널에서 직접 업데이트했거나 뭔가 이상할 때 눌러보세요.')}</span></div><button class="btn sm" data-v="restart">${t('다시 켜기')}</button></div>`;
    $('[data-v="update"]', box).onclick = () => updateSheet();
    $('[data-v="restart"]', box).onclick = (e) => {
      const n = G.state?.runs?.length || 0;
      if (n && !confirm(t('지금 실행 중인 작업이 {n}개 있어요. 다시 켜면 멈출 수 있어요. 계속할까요?', { n }))) return;
      restartBaton(e.currentTarget);
    };
  };
  draw();
  // Ask GitHub when Settings opens (at most every 5 minutes), so the button reflects the real latest release.
  if (Date.now() - versionCheckedAt < 5 * 60_000) return;
  versionCheckedAt = Date.now();
  draw(true);
  api('/api/update/check', { method: 'POST' })
    .then((d) => { if (G.state) G.state.update = { current: d.current, latest: d.latest, newer: d.newer }; })
    .catch(() => {})
    .finally(() => { if (box.isConnected) draw(); });
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
  let selecting = false, noteEditing = false, reloadAfterNote = false;
  const PAGE = 40;
  let limit = PAGE; // grows with 「더 보기」 and survives reloads (status change, memo save…)
  const sel = new Set();
  G.cleanup = () => document.body.classList.remove('selecting');
  const load = async () => {
    if (noteEditing) { reloadAfterNote = true; return; } // don't wipe a memo that's being typed
    const d = await api(`/api/projects/${encodeURIComponent(id)}`);
    const p = d.project;
    $('.topbar h1').textContent = p.name;
    // load() re-runs after every edit — update the header in place instead of appending again.
    let sub = head.querySelector('h1 + .sub');
    if (!sub) { $('.topbar h1').insertAdjacentHTML('afterend', '<div class="sub"></div>'); sub = head.querySelector('h1 + .sub'); }
    sub.textContent = p.path;
    head.querySelector('.icon-btn[href="#/inbox"]')?.replaceWith(Object.assign(document.createElement('button'), { className: 'icon-btn', id: 'pmore', innerHTML: ICON.more }));
    const human = d.sessions.filter((s) => !s.automated);
    const listHtml = () => d.sessions.slice(0, limit).map((s) => (selecting ? selRow(s, { showProject: false }) : sessionRow(s, { showProject: false }))).join('') || `<div class="empty">${t('세션이 없어요')}</div>`;
    const moreLabel = () => `${t('더 보기')} · ${t('{n}개 남음', { n: Math.max(0, d.sessions.length - limit) })}`;
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
    const repo = (d.services || []).find((x) => REPO_KINDS.has(x.kind));
    const srvHtml = d.servers?.length ? `<div class="section" id="psrv"><div class="section-h"><h2>${t('개발 서버')}</h2><span class="count">${d.servers.filter((x) => x.running).length}/${d.servers.length}</span><a class="more" href="#/ports">${t('전체 ›')}</a></div>
      <div class="card list">${d.servers.map((x) => serverRow(x, { showProject: false })).join('')}</div></div>` : '';
    const gitHtml = git ? `<div class="section"><div class="section-h"><h2>Git</h2>${repo ? `<a class="more" href="${esc(repo.url)}" target="_blank" rel="noopener">${esc(repo.name)} ↗</a>` : ''}<span class="count">${esc(git.branch || '')}${git.dirty ? ` · ${t('미커밋 {n}개', { n: git.dirty })}` : ''}</span></div>
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
      ${srvHtml}
      ${servicesHtml(d.services)}
      <div class="section"><div class="section-h"><h2>${t('세션')}</h2><span class="count">${d.sessions.length}${p.autoSessions ? ` · ${t('자동 {n}', { n: p.autoSessions })}` : ''}</span>
        ${d.sessions.length ? `<button class="more" id="pselbtn">${selecting ? t('완료') : t('선택')}</button>` : ''}</div>
        <div class="card list" id="plist">${listHtml()}</div>
        <button class="btn block ghost" id="psmore" style="margin-top:10px;${d.sessions.length > limit ? '' : 'display:none'}">${moreLabel()}</button>
        <div style="display:flex;gap:8px;margin-top:10px">
          ${latest ? `<a class="btn block" href="#/s/${latest.tool}/${encodeURIComponent(latest.id)}">${t('최근 세션 열기')}</a>` : ''}
          <a class="btn block primary" href="#/new?cwd=${encodeURIComponent(p.path)}">${t('새 세션')}</a>
        </div>
      </div>
      <div class="section" id="pmcp"></div>
      ${gitHtml}
      <div class="bulkbar" id="pbar" ${selecting ? '' : 'hidden'}><button class="btn sm ghost" id="pall">${t('전체 선택')}</button><span>${t('{n}개 선택', { n: '<b id="pcount">0</b>' })}</span><button class="btn sm" id="phide">${t('숨기기')}</button><button class="btn primary danger-fill" id="ptrash">${t('휴지통으로')}</button></div>`;
    loadProjectMcp($('#pmcp'), p.path);
    if ($('#psrv')) bindServers($('#psrv'), () => load());
    bindServices($('#psvc'), p.id, () => load());
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
    const shown = () => d.sessions.slice(0, limit);
    const drawBar = () => { $('#pcount').textContent = sel.size; $('#ptrash').disabled = !sel.size; $('#phide').disabled = !sel.size; };
    if (!selecting) attachLongPress($('#plist'));
    const bindChecks = () => $$('#plist [data-k]', v).forEach((c) => { c.checked = sel.has(c.dataset.k); c.onchange = () => { c.checked ? sel.add(c.dataset.k) : sel.delete(c.dataset.k); drawBar(); }; });
    bindChecks();
    drawBar();
    $('#psmore').onclick = () => {
      limit += PAGE;
      $('#plist').innerHTML = listHtml();
      $('#psmore').style.display = d.sessions.length > limit ? '' : 'none'; // .btn's display beats [hidden]
      $('#psmore').textContent = moreLabel();
      bindChecks();
    };
    $('#pselbtn') && ($('#pselbtn').onclick = () => { selecting = !selecting; sel.clear(); document.body.classList.toggle('selecting', selecting); load(); });
    $('#pall').onclick = () => {
      const ok = shown().filter((s) => !s.live);
      const all = ok.every((s) => sel.has(s.key));
      for (const s of ok) all ? sel.delete(s.key) : sel.add(s.key);
      $$('[data-k]', v).forEach((c) => { c.checked = sel.has(c.dataset.k); }); drawBar();
    };
    $('#ptrash').onclick = async () => {
      if (!(await trashMany([...sel]))) return;
      sel.clear(); selecting = false; document.body.classList.remove('selecting'); load();
    };
    $('#phide').onclick = async () => {
      if (!(await hideMany([...sel]))) return;
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
    $('#pmore').onclick = async () => {
      const act = await pick(p.name, [
        { value: 'pin', icon: glyph('pin'), label: p.pinned ? t('고정 해제') : t('상단 고정') },
        { value: 'rename', icon: glyph('edit'), label: t('이름 바꾸기') },
        { value: 'note', icon: glyph('doc'), label: p.note ? t('메모 고치기') : t('메모 남기기'), desc: t('다음에 돌아왔을 때 볼 메모 (메모를 눌러도 고칠 수 있어요)') },
        { value: 'mute', icon: glyph(p.muted ? 'bell' : 'bellOff'), label: p.muted ? t('이 프로젝트 알림 다시 켜기') : t('이 프로젝트 알림 끄기'), desc: p.muted ? t('세션 응답이 끝날 때마다 다시 알려줘요') : t('이 프로젝트의 모든 세션은 끝나도 알리지 않아요 (알림함에는 남아요)') },
        { value: 'snooze', icon: glyph('clock'), label: t('알림 미루기 / 상태 정리') },
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
  const f = { tool: '', hidden: false, ...store.get('sfilter', {}) };
  delete f.automated; // automated sessions are always listed now
  const seenTools = new Set();
  let q = sessionStorage.getItem('sq') || '';
  let offset = 0, items = [], total = 0;
  v.innerHTML = `
    <label class="search">${ICON.search}<input id="sq" type="search" placeholder="${t('제목·대화 내용·폴더 검색')}" value="${esc(q)}" autocomplete="off"></label>
    <div class="chips" id="sf"></div>
    <div id="slist" style="margin-top:12px"></div>
    <div class="bulkbar" id="sbar" hidden><button class="btn sm ghost" id="sall">${t('전체 선택')}</button><span>${t('{n}개 선택', { n: '<b id="scount">0</b>' })}</span><button class="btn sm" id="shide"></button><button class="btn primary danger-fill" id="strash">${t('휴지통으로')}</button></div>`;
  const drawChips = () => {
    $('#sf').innerHTML = [['', t('전체')], ...TOOL_IDS().filter((k) => k === f.tool || seenTools.has(k) || INSTALLED().includes(k)).map((k) => [k, TOOL[k].name])]
      .map(([k, l]) => `<button class="chip ${f.tool === k ? 'on' : ''}" data-tool="${k}">${l}</button>`).join('')
      + `<button class="chip ${f.hidden ? 'on' : ''}" data-tg="hidden">${t('숨긴 세션')}</button><a class="chip" href="#/cleanup">${t('🧹 정리하기')}</a>`;
    $$('[data-tool]', v).forEach((b) => (b.onclick = () => { f.tool = b.dataset.tool; reload(); }));
    $$('[data-tg]', v).forEach((b) => (b.onclick = () => { f[b.dataset.tg] = !f[b.dataset.tg]; reload(); }));
  };
  const fetchPage = async () => {
    const sp = new URLSearchParams({ offset, limit: 50 });
    if (q) sp.set('q', q);
    if (f.tool) sp.set('tool', f.tool);
    if (f.hidden) sp.set('hidden', '1');
    const d = await api('/api/sessions?' + sp);
    total = d.total; items = offset ? items.concat(d.items) : d.items;
    for (const s of d.items) seenTools.add(s.tool); // history from a CLI that's since been uninstalled still gets a chip
  };
  const draw = () => {
    $('#slist').innerHTML = items.length
      ? `<div class="small muted" style="margin:0 2px 8px">${t('{n}개', { n: total })}</div><div class="card list">${items.map((s) => (selecting ? selRow(s) : sessionRow(s))).join('')}</div>
         ${items.length < total ? `<button class="btn block ghost" id="smore" style="margin-top:10px">${t('더 보기')}</button>` : ''}`
      : `<div class="empty"><b>${q ? t('검색 결과가 없어요') : f.hidden ? t('숨긴 세션이 없어요') : t('세션이 없어요')}</b></div>`;
    const more = $('#smore'); if (more) more.onclick = async () => { offset += 50; await fetchPage(); draw(); };
    if (!selecting) attachLongPress($('#slist'));
    $$('[data-k]', v).forEach((c) => { c.checked = sel.has(c.dataset.k); c.onchange = () => { c.checked ? sel.add(c.dataset.k) : sel.delete(c.dataset.k); drawBar(); }; });
    drawBar();
  };
  const drawBar = () => { $('#sbar').hidden = !selecting; $('#scount').textContent = sel.size; $('#strash').disabled = !sel.size; $('#shide').disabled = !sel.size; $('#shide').textContent = f.hidden ? t('다시 보이기') : t('숨기기'); };
  $('#selbtn').onclick = () => { selecting = !selecting; sel.clear(); $('#selbtn').textContent = selecting ? t('완료') : t('선택'); document.body.classList.toggle('selecting', selecting); draw(); };
  $('#sall').onclick = () => { const all = items.filter((s) => !s.live).every((s) => sel.has(s.key)); for (const s of items) if (!s.live) all ? sel.delete(s.key) : sel.add(s.key); draw(); };
  $('#strash').onclick = async () => {
    if (!(await trashMany([...sel]))) return;
    sel.clear(); await reload();
  };
  $('#shide').onclick = async () => {
    if (!(await hideMany([...sel], !f.hidden))) return;
    sel.clear(); await reload();
  };
  G.cleanup = () => document.body.classList.remove('selecting');
  const reload = async () => { store.set('sfilter', f); drawChips(); offset = 0; await fetchPage(); drawChips(); draw(); };
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
    { value: 'notify', icon: glyph(s.notify < 0 ? 'bell' : 'bellOff'), label: s.notify < 0 ? t('이 세션 알림 다시 켜기') : t('이 세션 알림 끄기'), desc: s.notify < 0 ? t('응답이 끝날 때마다 다시 알려줘요') : t('응답이 끝나도 폰·PC로 알리지 않아요 (알림함에는 남아요)') },
    { value: 'schedule', icon: glyph('clock'), label: t('메시지 예약'), desc: t('한도가 풀리면 바로, 또는 정한 시각에 이 세션으로 보내요') },
    { value: 'newhere', icon: glyph('plus'), label: t('이 프로젝트에서 새 세션'), desc: t('같은 폴더에서 원하는 CLI로 새 작업을 시작해요 (맥락은 넘기지 않아요)') },
    { value: 'mcp', icon: glyph('plug'), label: t('MCP 서버 보기'), desc: t('이 세션이 불러오는 MCP와 실제로 호출한 도구') },
    { value: 'move', icon: glyph('folder'), label: t('작업 폴더 옮기기'), desc: s.moved ? t('지금: {p}', { p: s.cwd }) : t('실제 작업하는 프로젝트 폴더로 이 세션을 옮겨요') },
    { value: 'handoff', icon: glyph('shuffle'), label: t('다른 CLI로 이어가기'), desc: t('토큰이 부족할 때 다른 도구가 이 세션을 이어받아요') },
    { value: 'pin', icon: glyph('pin'), label: s.pinned ? t('고정 해제') : t('고정') },
    { value: 'rename', icon: glyph('edit'), label: t('이름 바꾸기') },
    { value: 'project', icon: glyph('folder'), label: t('프로젝트 보기'), desc: shortPath(s.project || s.cwd) },
    { value: 'hide', icon: glyph('eyeOff'), label: s.hidden ? t('숨김 해제') : t('목록에서 숨기기') },
    { value: 'trash', icon: glyph('trash'), label: t('휴지통으로'), desc: t('세션 파일을 휴지통으로 옮겨요 (30일 안에 되살리기 가능)'), danger: true },
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
/** mcp__context7__resolve-library-id -> plug icon + "context7 · resolve-library-id" (escaped HTML). */
function toolLabel(name) {
  const m = /^mcp__(.+?)__(.+)$/.exec(String(name || ''));
  if (!m) return esc(name);
  const server = m[1].startsWith('claude_ai_') ? `claude.ai ${m[1].slice(10).replace(/_/g, ' ')}` : m[1];
  return `${glyph('plug', 'inl')}${esc(server)} <span class="muted">· ${esc(m[2])}</span>`;
}
function toolsHtml(items, open = false) {
  const tools = items.filter((x) => x.role === 'tool');
  const thinks = items.filter((x) => x.role === 'thinking');
  if (!tools.length && thinks.length) {
    return thinks.map((th) => `<details class="thinking"><summary>${glyph('thought', 'inl')}${t('생각 과정')}</summary><div class="tx">${esc(th.text)}</div></details>`).join('');
  }
  const names = [...new Set(tools.map((x) => x.tool.name.replace(/^mcp__(.+?)__(.+)$/, (m, a, b) => `${a.replace(/^claude_ai_/, '')}.${b}`)))];
  const errs = tools.filter((x) => x.tool.error).length;
  return `<details class="tools" ${open ? 'open' : ''}><summary><span>${glyph('wrenchSm', 'inl')}${t('도구 {n}회', { n: tools.length })}</span><span class="names">${esc(names.slice(0, 4).join(', '))}${errs ? ` · ${t('오류 {n}', { n: errs })}` : ''}</span><span class="chev">${ICON.chev}</span></summary>
    ${items.map((it) => it.role === 'thinking'
      ? `<details class="tool-item"><summary><span class="tn">${glyph('thought', 'inl')}${t('생각')}</span><span class="ts">${esc(it.text.slice(0, 100))}</span></summary><pre>${esc(it.text)}</pre></details>`
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
      const handoff = h ? `<div class="handoff-mark">🔀 ${t('{name}에서 넘겨받음', { name: esc(h[1] || h[2]) })} · <code>${esc(h[3])}</code></div>` : '';
      const photos = (m.imageUrls || []).filter((url) => /^\/api\/sessions\/claude\/[^/]+\/images\/[\d.a-f]+$/.test(url));
      return `${handoff}<div class="msg-user">${photos.length ? `<div class="uimgs">${photos.map((url) => `<a href="${esc(url)}" target="_blank" rel="noopener"><img src="${esc(url)}" loading="lazy" decoding="async" width="84" height="84" alt="${t('첨부 이미지')}"></a>`).join('')}</div>` : ''}${esc(h ? h[4].trim() : m.text)}${m.images ? `<div class="imgs">${t('🖼 사진 {n}장', { n: m.images })}</div>` : ''}</div>`;
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
// Mouse + keyboard machine: Enter sends, Shift+Enter breaks the line. Touch keeps Enter as a newline.
const DESK_KEYS = matchMedia('(hover: hover) and (pointer: fine)');
const sendHint = () => (DESK_KEYS.matches ? t('Enter로 보내기 · Shift+Enter로 줄바꿈') : t('Ctrl+Enter로 보내기'));
function composerHtml(tool, isNew = false) {
  return `<div class="composer"><div class="inner"><div class="mention" id="mention" role="listbox" hidden></div><div class="box">
    <div class="thumbs" id="thumbs" hidden></div>
    <textarea id="input" rows="1" placeholder="${isNew ? t('{name}에게 첫 메시지…', { name: TOOL[tool].name }) : t('{name}에게 이어서 물어보기…', { name: TOOL[tool].name })}" enterkeyhint="${DESK_KEYS.matches ? 'send' : 'enter'}"></textarea>
    <div class="row"><button class="attach" id="attach" aria-label="${t('사진 첨부')}" title="${t('사진 첨부 · 붙여넣기나 끌어다 놓기도 돼요')}">${ICON.image}</button><input type="file" id="file" accept="image/*" multiple hidden><div class="opts" id="opts"></div><button class="send" id="send" disabled aria-label="${t('보내기')}" title="${t('보내기')} (${sendHint()})">${ICON.send}</button></div>
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
      opts.push({ value: '__custom', icon: glyph('edit'), label: t('모델 ID 직접 입력'), desc: t('사내 게이트웨이·Bedrock 추론 프로필·사내 LLM 모델 이름 등') });
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
  el.dataset.run = runId; // lets the run pill skip the run that's already on screen
  el.style.cssText = 'display:flex;flex-direction:column;gap:12px';
  container.append(el);
  drawRunPill();
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
      // only speak up when something is wrong — a healthy MCP list would just be noise.
      // claude.ai connectors that were never authorized (Gmail/Calendar/Drive come attached to the
      // account) report needs-auth on every run; that isn't a problem until you use one, so the MCP
      // panel shows it and the chat stays quiet
      const bad = (ev.servers || []).filter((x) => /fail|auth/i.test(x.status || '') && !(/auth/i.test(x.status) && /^claude\.ai /.test(x.name || '')));
      if (bad.length) {
        const n = document.createElement('div');
        n.className = 'mcp-note';
        n.innerHTML = `${glyph('plug', 'inl')}${t('MCP 연결 문제:')} ${bad.map((x) => `<b>${esc(x.name)}</b> (${esc(/auth/i.test(x.status) ? t('인증 필요') : t('연결 실패'))})`).join(', ')}`;
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

// ---------------------------------------------------------------- @ picker
// Type @ to search this chat's files, folders and skills; picking one just writes text into the prompt.
const MENTION_CACHE = new Map();
const mentionScore = (text, q) => {
  if (!q) return 0;
  const s = text.toLowerCase();
  const base = s.replace(/\/$/, '').split('/').pop();
  if (base.startsWith(q)) return 0;
  if (base.includes(q)) return 1;
  if (s.includes(q)) return 2;
  let i = 0;
  for (const c of s) if (c === q[i]) i++;
  return i === q.length ? 3 : -1;
};
// Each CLI's own way to ask for a skill; the ones without one get a plain sentence.
const skillText = (tool, name) => (tool === 'claude' ? `/${name}` : tool === 'codex' ? `$${name}` : t('「{name}」 스킬을 써서', { name }));
// another CLI's skill: this CLI can't load it by name, so point the agent at the file
const borrowText = (p) => t('`{path}` 스킬 파일을 읽고 그대로 따라서', { path: p });
const mcpText = (name) => t('「{name}」 MCP를 써서', { name });
const mentionPath = (p) => (/\s/.test(p) ? `@"${p}"` : `@${p}`);

function wireMention(tool, ta, ctx, onChange) {
  const box = $('#mention');
  if (!box || !ctx) return { key: () => false };
  let items = [], sel = 0, tok = null, seq = 0;
  const cacheKey = () => `${tool}|${JSON.stringify(ctx())}`;
  const load = async () => {
    const k = cacheKey();
    const hit = MENTION_CACHE.get(k);
    if (hit?.pending) return hit.pending;
    if (hit && Date.now() - hit.at < 30000) return hit.data;
    const pending = api(`/api/mention?${new URLSearchParams({ tool, ...ctx() })}`).then((d) => ({ others: [], mcp: [], ...d })).catch(() => ({ files: [], dirs: [], skills: [], others: [], mcp: [] }));
    MENTION_CACHE.set(k, { pending });
    const data = await pending;
    MENTION_CACHE.set(k, { at: Date.now(), data });
    return data;
  };
  const close = () => { box.hidden = true; items = []; tok = null; seq++; };
  const token = () => {
    if (ta.selectionStart !== ta.selectionEnd) return null;
    const before = ta.value.slice(0, ta.selectionStart);
    const m = before.match(/(^|\s)@([^\s@]*)$/); // only after a space or at line start, so emails don't trigger it
    return m ? { start: before.length - m[2].length - 1, end: ta.selectionStart, q: m[2] } : null;
  };
  const draw = (d) => {
    const q = tok.q.toLowerCase();
    let list;
    if (!q) {
      list = [...d.skills.slice(0, 4).map((x) => ({ x, kind: 'skill' })), ...d.others.slice(0, 2).map((x) => ({ x, kind: 'other' })), ...d.mcp.slice(0, 2).map((x) => ({ x, kind: 'mcp' })),
        ...d.dirs.filter((x) => !x.slice(0, -1).includes('/')).map((x) => ({ x, kind: 'dir' })),
        ...d.files.filter((x) => !x.includes('/')).map((x) => ({ x, kind: 'file' }))];
    } else {
      const rank = (arr, kind, text) => arr.map((x) => ({ x, kind, s: mentionScore(text(x), q) })).filter((r) => r.s >= 0);
      const order = { skill: 0, other: 1, mcp: 2, dir: 3, file: 4 };
      list = [...rank(d.skills, 'skill', (x) => x.name), ...rank(d.others, 'other', (x) => x.name), ...rank(d.mcp, 'mcp', (x) => x.name), ...rank(d.dirs, 'dir', (x) => x), ...rank(d.files, 'file', (x) => x)]
        .sort((a, b) => a.s - b.s || order[a.kind] - order[b.kind] || (typeof a.x !== 'string' ? 0 : a.x.length - b.x.length));
    }
    items = list.slice(0, 10);
    sel = Math.min(sel, Math.max(0, items.length - 1));
    const empty = d.truncated && !d.files.length ? t('이 폴더는 너무 커서 파일 목록을 보여주지 않아요') : t('찾는 파일·폴더·스킬·MCP가 없어요');
    box.innerHTML = !items.length ? `<div class="mention-empty">${empty}</div>` : items.map((r, i) => {
      const sk = r.kind === 'skill' || r.kind === 'other' || r.kind === 'mcp';
      const icon = glyph(r.kind === 'mcp' ? 'plug' : sk ? 'spark' : r.kind === 'dir' ? 'folder' : 'file');
      const path0 = sk ? '' : r.x.replace(/\/$/, '');
      const name = sk ? r.x.name : path0.split('/').pop() + (r.kind === 'dir' ? '/' : '');
      const sub = r.kind === 'mcp' ? t('MCP 서버') : r.kind === 'other' ? `${t('{name} 스킬', { name: TOOL[r.x.from]?.name || r.x.from })}${r.x.description ? ` · ${r.x.description}` : ''}`
        : sk ? (r.x.description || t('스킬')) : path0.includes('/') ? path0.slice(0, path0.lastIndexOf('/') + 1) : '';
      return `<div class="mention-item${i === sel ? ' on' : ''}" role="option" data-i="${i}"><span class="mi">${icon}</span><b>${esc(name)}</b><span class="ms">${esc(sub)}</span></div>`;
    }).join('');
    box.hidden = false;
    box.querySelector('.on')?.scrollIntoView({ block: 'nearest' });
  };
  const update = async () => {
    const next = token();
    if (!next) { if (tok) close(); return; }
    if (next.q !== tok?.q) sel = 0;
    tok = next;
    const my = ++seq;
    if (!MENTION_CACHE.get(cacheKey())?.data) { box.innerHTML = `<div class="mention-empty">${t('찾는 중…')}</div>`; box.hidden = false; }
    const d = await load();
    if (my !== seq) return; // typed on or closed meanwhile
    draw(d);
  };
  const choose = (i) => {
    const r = items[i];
    if (!r || !tok) return;
    const v = ta.value;
    const head = v.slice(0, tok.start), tail = v.slice(tok.end);
    let caret;
    if (r.kind !== 'dir' && r.kind !== 'file') {
      // skills / MCP go to the front of the prompt, where Claude Code (/name) and Codex ($name) look for skills
      const ins = r.kind === 'skill' ? skillText(tool, r.x.name) : r.kind === 'other' ? borrowText(r.x.path) : mcpText(r.x.name);
      const tl = /\s$/.test(head) || !head ? tail.replace(/^[ \t]+/, '') : tail;
      const rest = head + tl;
      const already = rest === ins || rest.startsWith(ins + ' ');
      ta.value = already ? rest : `${ins} ${rest}`;
      caret = (already ? 0 : ins.length + 1) + head.length;
    } else {
      const ins = mentionPath(r.x) + ' ';
      ta.value = head + ins + tail.replace(/^ /, '');
      caret = head.length + ins.length;
    }
    close();
    ta.focus();
    ta.setSelectionRange(caret, caret);
    onChange(); // resize + save the draft (setting .value doesn't fire input)
  };
  box.addEventListener('pointerdown', (e) => e.preventDefault()); // keep the textarea (and phone keyboard) focused
  box.addEventListener('click', (e) => { const el = e.target.closest('[data-i]'); if (el) choose(+el.dataset.i); });
  ta.addEventListener('input', update);
  ta.addEventListener('click', update);
  ta.addEventListener('blur', () => setTimeout(() => { if (document.activeElement !== ta) close(); }, 150));
  return {
    /** keydown while the list is open; true = handled (never while an IME is composing) */
    key(e) {
      if (box.hidden || e.isComposing || e.keyCode === 229) return false;
      if (e.key === 'Escape') { close(); e.preventDefault(); e.stopPropagation(); return true; }
      if (!items.length) return false;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        sel = (sel + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length;
        $$('.mention-item', box).forEach((el, i) => el.classList.toggle('on', i === sel));
        box.querySelector('.on')?.scrollIntoView({ block: 'nearest' });
        e.preventDefault(); return true;
      }
      if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') { e.preventDefault(); choose(sel); return true; }
      return false;
    },
  };
}

function wireComposer(tool, onSend, draftKey, mentionCtx) {
  const ta = $('#input'), btn = $('#send');
  let atts = [];
  const fit = () => { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, window.innerHeight * 0.38) + 'px'; btn.disabled = !ta.value.trim() && !atts.length; };
  const drawThumbs = () => {
    const el = $('#thumbs');
    el.hidden = !atts.length;
    el.innerHTML = atts.map((a, i) => `<div class="thumb"><img src="${a.url}" alt=""><button data-i="${i}" aria-label="${t('빼기')}">${ICON.x}</button></div>`).join('');
    $$('button', el).forEach((b) => (b.onclick = () => { atts.splice(+b.dataset.i, 1); drawThumbs(); fit(); }));
  };
  // Same path for the file picker, clipboard paste and drag & drop: images only, 8 max.
  const addFiles = async (list) => {
    const imgs = [...list].filter((f) => f && f.type?.startsWith('image/'));
    if (!imgs.length) return false;
    const files = imgs.slice(0, Math.max(0, 8 - atts.length));
    for (const f of files) {
      try { atts.push(await shrinkImage(f)); } catch { toast(t('{name}을(를) 읽지 못했어요', { name: f.name || 'image' }), true); }
    }
    if (imgs.length > files.length || (files.length && atts.length >= 8)) toast(t('사진은 8장까지 첨부할 수 있어요'));
    drawThumbs(); fit();
    return true;
  };
  $('#attach').onclick = () => $('#file').click();
  $('#file').onchange = async (e) => {
    const files = [...e.target.files];
    e.target.value = '';
    await addFiles(files);
  };
  const clipImages = (dt) => {
    if (!dt) return [];
    const files = [...(dt.files || [])].filter((f) => f.type.startsWith('image/'));
    if (files.length) return files;
    return [...(dt.items || [])].filter((it) => it.kind === 'file' && it.type.startsWith('image/')).map((it) => it.getAsFile()).filter(Boolean);
  };
  ta.addEventListener('paste', (e) => {
    const files = clipImages(e.clipboardData);
    if (!files.length) return; // plain text paste stays native
    e.preventDefault();
    addFiles(files);
  });
  const chat = ta.closest('.chat');
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
  if (chat) {
    let depth = 0;
    const off = () => { depth = 0; chat.classList.remove('dropping'); };
    chat.addEventListener('dragenter', (e) => { if (!hasFiles(e)) return; e.preventDefault(); depth++; chat.classList.add('dropping'); });
    chat.addEventListener('dragover', (e) => { if (!hasFiles(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
    chat.addEventListener('dragleave', (e) => { if (!hasFiles(e)) return; if (--depth <= 0) off(); });
    chat.addEventListener('drop', async (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault(); off();
      if (!(await addFiles(e.dataTransfer.files))) toast(t('사진 파일만 첨부할 수 있어요'), true);
      else ta.focus();
    });
  }
  const draft = sessionStorage.getItem(draftKey) || store.get(draftKey, '');
  if (draft) { ta.value = draft; sessionStorage.removeItem(draftKey); }
  ta.oninput = () => { fit(); store.set(draftKey, ta.value); };
  const mention = wireMention(tool, ta, mentionCtx, ta.oninput);
  ta.onkeydown = (e) => {
    if (mention.key(e)) return;
    if (e.key !== 'Enter' || e.isComposing || e.keyCode === 229) return; // IME (Korean/Japanese) is still composing
    const send = e.metaKey || e.ctrlKey || (DESK_KEYS.matches && !e.shiftKey && !e.altKey);
    if (!send) return; // Shift+Enter on desktop, plain Enter on touch → newline
    e.preventDefault();
    if (!btn.disabled) btn.click();
  };
  btn.onclick = async () => {
    const imgs = atts.slice();
    const text = ta.value.trim() || (imgs.length ? t('이 사진을 봐줘.') : '');
    if (!text) return;
    btn.disabled = true;
    const ok = await onSend(text, composerPrefs(tool), imgs);
    if (ok) { ta.value = ''; atts = []; drawThumbs(); store.set(draftKey, ''); fit(); if (!DESK_KEYS.matches) ta.blur(); } else btn.disabled = false;
  };
  drawOpts(tool);
  fit();
  return { setBusy(b) { ta.placeholder = b ? t('응답이 끝나면 이어서 보낼 수 있어요') : t('{name}에게 이어서 물어보기…', { name: TOOL[tool].name }); } };
}

async function viewChat([tool, id]) {
  const cleanVV = setupViewport();
  const key = `${tool}:${id}`;
  const navCount = G.navCount;
  chatLayout({ backHref: '#/', title: t('불러오는 중…'), subHtml: `<span class="tool-badge ${tool}">${TOOL[tool].name}</span>`, tool, extraHead: `<button class="icon-btn" id="cmore">${ICON.more}</button>` });
  let live = null, session = null, start = 0, busy = false, links = { from: [], to: [] };
  const msgsEl = $('#msgs'), scroll = $('#scroll');
  G.cleanup = () => { live?.close(); cleanVV(); };

  const load = async ({ keepScroll = false } = {}) => {
    const d = await api(`/api/sessions/${tool}/${encodeURIComponent(id)}`);
    if (navCount !== G.navCount || !msgsEl.isConnected) return;
    session = d.session; start = d.start; links = d.links || links;
    $('#ctitle').textContent = session.title;
    $('#csub').innerHTML = `<span class="tool-badge ${tool}">${TOOL[tool].name}</span><span>${esc(projectName(session.project || session.cwd))}</span>${session.model ? `<span>· ${esc(session.model)}</span>` : ''}${session.notify < 0 ? `<span class="flag bell">${t('🔕 알림 꺼짐')}</span>` : ''}<span id="cmcp"></span>`;
    mcpChip(session);
    $('#back').setAttribute('href', session.project ? `#/p/${encodeURIComponent(session.project)}` : '#/sessions');
    const banner = !session.terminal ? ''
      : session.background ? `<div class="banner warn" style="margin-bottom:4px">${t('⏳ 다른 도구가 백그라운드에서 이 세션을 실행 중이에요. 진행 상황은 여기서 볼 수 있고, 끝난 뒤에 보내면 이어서 작업할 수 있어요.')}</div>`
      : `<div class="banner warn" style="margin-bottom:4px">${t('⚠️ 이 세션은 PC 터미널에서도 열려 있어요. 여기서 보내면 기록이 갈라질 수 있으니 PC 쪽이 쉬고 있을 때 보내세요.')}</div>`;
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
  const comp = wireComposer(tool, send, `draft:${key}`, () => ({ session: id }));
  $('#cmore').onclick = () => session && sessionMenu(session, () => load({ keepScroll: true }), { onTrashed: () => { if (G.navCount > 1) history.back(); else location.hash = '#/sessions'; } });
  await load();
  if (navCount !== G.navCount || !msgsEl.isConnected) return;
  const onVis = () => { if (document.visibilityState === 'visible' && !live) load({ keepScroll: true }); };
  document.addEventListener('visibilitychange', onVis);
  // Another tool is running this session in the background: follow along (stops once that process exits).
  let following = false;
  const follow = setInterval(async () => {
    if (following || live || document.visibilityState !== 'visible' || !session?.terminal || !session.background) return;
    following = true;
    const atBottom = scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 80;
    try { await load({ keepScroll: true }); if (atBottom) scroll.scrollTop = scroll.scrollHeight; } catch { /* next tick */ } finally { following = false; }
  }, 5000);
  const prev = G.cleanup; G.cleanup = () => { prev(); clearInterval(follow); document.removeEventListener('visibilitychange', onVis); };
}

/** Small "MCP n" chip in the chat header: how many servers this CLI loads here; red when one failed. */
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
    el.outerHTML = `<button class="flag mcpchip ${bad ? 'bad' : used ? 'used' : ''}" id="cmcp" title="${t('이 세션의 MCP')}">${glyph('plug', 'inl')}${used ? t('MCP {m}/{n}', { m: used, n: on.length }) : t('MCP {n}', { n: on.length })}</button>`;
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
    wireComposer(tool, send, 'draft:new', () => ({ cwd }));
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
    <div class="section" data-settings="advanced"><div class="section-h"><h2>${t('회사 환경 · CLI 환경 변수')}</h2></div><div class="card" id="envbox"><div class="skeleton" style="height:60px;margin:14px"></div></div></div>
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
      <div class="setting"><div class="l"><b>${t('기본 권한')}</b></div><select data-k="defaultPerm">${Object.entries(PERM).map(([k, p]) => `<option value="${k}" ${s.defaultPerm === k ? 'selected' : ''}>${p.label}</option>`).join('')}</select></div>
      <a class="setting" href="#/usage"><div class="l"><b>${t('사용량 · 한도')}</b><span>${t('CLI별 남은 한도와 토큰 사용량')}</span></div><span class="muted">›</span></a>
      <div class="setting"><div class="l"><b>${t('목록 새로고침')}</b><span>${t('세션 파일을 다시 읽어요')}</span></div><button class="btn sm" id="reindex">${ICON.refresh}</button></div>
    </div></div>
    <div class="section" data-settings="version"><div class="section-h"><h2>${t('Baton 버전 · 업데이트')}</h2></div><div class="card" id="verbox"></div></div>
    <p class="small muted" style="text-align:center;margin-top:24px">${t('Baton · 바이브코딩 이어달리기 🏃‍♂️')} · v${esc(G.state?.version || '')}<br>${esc(G.state?.home || '')}</p>`;
  organizeSettings(v);
  versionCard($('#verbox', v));
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
      <div class="row">${INSTALLED().map(cell).join('')}</div>
    </a>`;
  } catch { el.remove(); }
}

// ---------------------------------------------------------------- TOOLS hub
async function viewTools() {
  const v = shell({ title: t('도구'), fab: false });
  const card = (href, icon, title, sub, id) => `<a class="card tool-card" href="${href}"><div class="ti">${icon}</div><div class="tb"><b>${title}</b><span id="${id}">${sub}</span></div><span class="muted">›</span></a>`;
  v.innerHTML = `<div class="section tool-grid">
    ${card('#/ports', TOOL_ICON.ports, t('서빙 중인 포트'), t('불러오는 중…'), 'tc-ports')}
    ${card('#/repos', TOOL_ICON.repos, t('Git 저장소'), t('프로젝트에 연결된 저장소와 그 저장소를 쓰는 프로젝트'), 'tc-repos')}
    ${card('#/skills', TOOL_ICON.skills, t('스킬'), t('어떤 스킬이 어디 있고 언제 쓰였는지'), 'tc-skills')}
    ${card('#/mcp', TOOL_ICON.mcp, t('MCP 서버'), t('에이전트가 물고 있는 MCP와 실제 호출 기록'), 'tc-mcp')}
    ${card('#/usage', TOOL_ICON.usage, t('사용량 · 한도'), t('CLI별 남은 한도와 토큰'), 'tc-usage')}
    ${card('#/scheduled', TOOL_ICON.sched, t('예약 메시지'), t('한도가 풀리면 보낼 메시지'), 'tc-sched')}
    ${card('#/cleanup', TOOL_ICON.clean, t('세션 정리'), t('테스트·자동 실행·"hi" 세션 한 번에 지우기'), 'tc-clean')}
    ${card('#/trash', TOOL_ICON.trash, t('휴지통'), t('지운 세션 되살리기 (30일 보관)'), 'tc-trash')}
  </div>`;
  api('/api/ports').then((d) => { const sv = d.servers || [], on = sv.filter((s) => s.running).length, off = sv.length - on; $('#tc-ports') && ($('#tc-ports').textContent = t('개발 서버 {n}개 실행 중', { n: on }) + (off ? ` · ${t('꺼진 서버 {n}개', { n: off })}` : '')); }).catch(() => {});
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

// ---------------------------------------------------------------- DEV SERVERS (remembered per project)
// Registered servers stay listed when they're off, so they can be started again with one tap.
function serverState(s) {
  if (s.running) return { cls: 'on', text: s.startedAt ? t('실행 중 · {when}부터', { when: ago(s.startedAt) }) : t('실행 중') };
  if (s.starting) return { cls: 'wait', text: t('켜는 중…') };
  if (s.busyBy) return { cls: 'warn', text: t(':{port} 포트를 {name}이(가) 쓰는 중', { port: s.port, name: s.busyBy }) };
  if (s.enabled && s.lastError) return { cls: 'warn', text: t('켜지 못했어요') };
  if (s.enabled) return { cls: 'warn', text: t('멈춰 있어요') };
  return { cls: 'off', text: t('꺼둠') };
}
function serverRow(s, { showProject = true } = {}) {
  const st = serverState(s);
  const open = s.running && s.web ? [
    ON_THIS_PC ? `<a class="btn sm${s.phoneUrl ? '' : ' primary'}" href="http://localhost:${s.port}" target="_blank" rel="noopener">${t('열기')} ↗</a>` : '',
    s.phoneUrl ? `<a class="btn sm primary" href="${esc(s.phoneUrl)}" target="_blank" rel="noopener">${t('폰에서 열기 ↗')}</a>` : s.local ? `<button class="btn sm" data-share="${s.port}">${t('폰에서 열 수 있게')}</button>` : '',
  ].join('') : '';
  const toggle = s.running || s.starting
    ? `<button class="btn sm ghost" data-srv-stop="${s.id}">⏸ ${t('끄기')}</button>`
    : `<button class="btn sm${s.enabled ? ' primary' : ''}" data-srv-start="${s.id}">▶ ${t('켜기')}</button>`;
  return `<div class="srv ${st.cls}">
    <span class="srv-dot ${st.cls}" aria-hidden="true"></span>
    <div class="body">
      <div class="t"><b class="pn">:${s.port}</b><span class="tt">${showProject ? `<a href="#/p/${encodeURIComponent(s.project)}">${esc(projectName(s.project))}</a>` : esc(projectName(s.project))}${s.title && s.title !== projectName(s.project) ? ` <span class="muted">· ${esc(s.title)}</span>` : ''}</span>${s.portShared ? `<span class="flag warn">${t('포트 겹침')}</span>` : ''}</div>
      <div class="m"><span class="st ${st.cls}">${esc(st.text)}</span> · ${esc(s.cwd)}</div>
      <div class="m"><code>${esc(s.label || s.cmd)}</code></div>
      ${s.agent ? `<div class="m"><a href="#/s/${s.agent.tool}/${encodeURIComponent(s.agent.id)}"><span class="tool-badge ${s.agent.tool}">${TOOL[s.agent.tool]?.name || s.agent.tool}</span> ${t('「{title}」 세션이 띄움', { title: esc(s.agent.title || '') })}</a></div>` : ''}
      <div class="pact">${open}${toggle}<button class="btn sm ghost" data-srv-logs="${s.id}">${t('로그')}</button><button class="btn sm ghost danger" data-srv-rm="${s.id}" data-port="${s.port}">${t('삭제')}</button></div>
    </div>
  </div>`;
}
function bindServers(el, reload) {
  const act = (sel, fn) => $$(sel, el).forEach((b) => (b.onclick = async () => {
    b.disabled = true;
    try { await fn(b); } catch (e) { toast(e.message, true); }
    setTimeout(reload, 1500);
  }));
  act('[data-srv-start]', async (b) => { const r = await api(`/api/servers/${b.dataset.srvStart}/start`, { method: 'POST' }); toast(r.already ? t('이미 실행 중이에요') : t('켜는 중이에요…')); setTimeout(reload, 4000); });
  act('[data-srv-stop]', async (b) => { await api(`/api/servers/${b.dataset.srvStop}/stop`, { method: 'POST' }); toast(t('껐어요. 목록에는 남아 있어요')); });
  $$('[data-srv-rm]', el).forEach((b) => (b.onclick = async () => {
    const ok = await pick(t(':{port} 서버를 목록에서 삭제할까요?', { port: b.dataset.port }), [
      { value: true, label: t('삭제'), desc: t('실행 중이면 멈추고, 다시 자동 등록하지 않아요'), danger: true },
      { value: false, label: t('취소') }]);
    if (!ok) return;
    try { await api(`/api/servers/${b.dataset.srvRm}/remove`, { method: 'POST' }); toast(t('삭제했어요')); } catch (e) { toast(e.message, true); }
    setTimeout(reload, 800);
  }));
  $$('[data-srv-logs]', el).forEach((b) => (b.onclick = async () => {
    let text = '';
    try { text = (await api(`/api/servers/${b.dataset.srvLogs}/logs`)).text; } catch (e) { text = e.message; }
    sheet({ title: t('서버 로그'), body: `<pre class="logbox">${esc(text.trim() || t('Baton이 켠 뒤로 남은 로그가 없어요'))}</pre>` });
  }));
  $$('[data-share]', el).forEach((b) => (b.onclick = async () => {
    b.disabled = true;
    try { const r = await api(`/api/ports/${b.dataset.share}/share`, { method: 'POST' }); toast(t('공유했어요')); if (r.url) window.open(r.url, '_blank'); reload(); }
    catch (e) { toast(e.message, true); b.disabled = false; }
  }));
}

// ---------------------------------------------------------------- LINKED SERVICES (dashboards)
// Service logos from Simple Icons (CC0, simpleicons.org). Empty colour = draw in the text colour (dark brand marks).
const BRAND = {
  github: ['', 'M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12'],
  gitlab: ['#FC6D26', 'm23.6004 9.5927-.0337-.0862L20.3.9814a.851.851 0 0 0-.3362-.405.8748.8748 0 0 0-.9997.0539.8748.8748 0 0 0-.29.4399l-2.2055 6.748H7.5375l-2.2057-6.748a.8573.8573 0 0 0-.29-.4412.8748.8748 0 0 0-.9997-.0537.8585.8585 0 0 0-.3362.4049L.4332 9.5015l-.0325.0862a6.0657 6.0657 0 0 0 2.0119 7.0105l.0113.0087.03.0213 4.976 3.7264 2.462 1.8633 1.4995 1.1321a1.0085 1.0085 0 0 0 1.2197 0l1.4995-1.1321 2.4619-1.8633 5.006-3.7489.0125-.01a6.0682 6.0682 0 0 0 2.0094-7.003z'],
  bitbucket: ['#0052CC', 'M.778 1.213a.768.768 0 00-.768.892l3.263 19.81c.084.5.515.868 1.022.873H19.95a.772.772 0 00.77-.646l3.27-20.03a.768.768 0 00-.768-.891zM14.52 15.53H9.522L8.17 8.466h7.561z'],
  git: ['#F03C2E', 'M13.09 23.549a1.54 1.54 0 0 1-2.18 0L.451 13.089a1.54 1.54 0 0 1 0-2.179l7.191-7.19 2.733 2.733a1.85 1.85 0 0 0 .964 2.326v6.66a1.849 1.849 0 1 0 1.54 0V8.957l2.508 2.508a1.85 1.85 0 1 0 1.09-1.09l-2.634-2.634a1.85 1.85 0 0 0-2.378-2.377L8.73 2.63 10.91.451a1.54 1.54 0 0 1 2.179 0l10.459 10.46a1.54 1.54 0 0 1 0 2.179z'],
  vercel: ['', 'm12 1.608 12 20.784H0Z'],
  firebase: ['#DD2C00', 'M19.455 8.369c-.538-.748-1.778-2.285-3.681-4.569-.826-.991-1.535-1.832-1.884-2.245a146 146 0 0 0-.488-.576l-.207-.245-.113-.133-.022-.032-.01-.005L12.57 0l-.609.488c-1.555 1.246-2.828 2.851-3.681 4.64-.523 1.064-.864 2.105-1.043 3.176-.047.241-.088.489-.121.738-.209-.017-.421-.028-.632-.033-.018-.001-.035-.002-.059-.003a7.46 7.46 0 0 0-2.28.274l-.317.089-.163.286c-.765 1.342-1.198 2.869-1.252 4.416-.07 2.01.477 3.954 1.583 5.625 1.082 1.633 2.61 2.882 4.42 3.611l.236.095.071.025.003-.001a9.59 9.59 0 0 0 2.941.568q.171.006.342.006c1.273 0 2.513-.249 3.69-.742l.008.004.313-.145a9.63 9.63 0 0 0 3.927-3.335c1.01-1.49 1.577-3.234 1.641-5.042.075-2.161-.643-4.304-2.133-6.371m-7.083 6.695c.328 1.244.264 2.44-.191 3.558-1.135-1.12-1.967-2.352-2.475-3.665-.543-1.404-.87-2.74-.974-3.975.48.157.922.366 1.315.622 1.132.737 1.914 1.902 2.325 3.461zm.207 6.022c.482.368.99.712 1.513 1.028-.771.21-1.565.302-2.369.273a8 8 0 0 1-.373-.022c.458-.394.869-.823 1.228-1.279zm1.347-6.431c-.516-1.957-1.527-3.437-3.002-4.398-.647-.421-1.385-.741-2.194-.95.011-.134.026-.268.043-.4.014-.113.03-.216.046-.313.133-.689.332-1.37.589-2.025.099-.25.206-.499.321-.74l.004-.008c.177-.358.376-.719.61-1.105l.092-.152-.003-.001c.544-.851 1.197-1.627 1.942-2.311l.288.341c.672.796 1.304 1.548 1.878 2.237 1.291 1.549 2.966 3.583 3.612 4.48 1.277 1.771 1.893 3.579 1.83 5.375-.049 1.395-.461 2.755-1.195 3.933-.694 1.116-1.661 2.05-2.8 2.708-.636-.318-1.559-.839-2.539-1.599.79-1.575.952-3.28.479-5.072zm-2.575 5.397c-.725.939-1.587 1.55-2.09 1.856-.081-.029-.163-.06-.243-.093l-.065-.026c-1.49-.616-2.747-1.656-3.635-3.01-.907-1.384-1.356-2.993-1.298-4.653.041-1.19.338-2.327.882-3.379.316-.07.638-.114.96-.131l.084-.002c.162-.003.324-.003.478 0 .227.011.454.035.677.07.073 1.513.445 3.145 1.105 4.852.637 1.644 1.694 3.162 3.144 4.515z'],
  supabase: ['#3FCF8E', 'M11.9 1.036c-.015-.986-1.26-1.41-1.874-.637L.764 12.05C-.33 13.427.65 15.455 2.409 15.455h9.579l.113 7.51c.014.985 1.259 1.408 1.873.636l9.262-11.653c1.093-1.375.113-3.403-1.645-3.403h-9.642z'],
  netlify: ['#00C7B7', 'M6.49 19.04h-.23L5.13 17.9v-.23l1.73-1.71h1.2l.15.15v1.2L6.5 19.04ZM5.13 6.31V6.1l1.13-1.13h.23L8.2 6.68v1.2l-.15.15h-1.2L5.13 6.31Zm9.96 9.09h-1.65l-.14-.13v-3.83c0-.68-.27-1.2-1.1-1.23-.42 0-.9 0-1.43.02l-.07.08v4.96l-.14.14H8.9l-.13-.14V8.73l.13-.14h3.7a2.6 2.6 0 0 1 2.61 2.6v4.08l-.13.14Zm-8.37-2.44H.14L0 12.82v-1.64l.14-.14h6.58l.14.14v1.64l-.14.14Zm17.14 0h-6.58l-.14-.14v-1.64l.14-.14h6.58l.14.14v1.64l-.14.14ZM11.05 6.55V1.64l.14-.14h1.65l.14.14v4.9l-.14.14h-1.65l-.14-.13Zm0 15.81v-4.9l.14-.14h1.65l.14.13v4.91l-.14.14h-1.65l-.14-.14Z'],
  cloudflare: ['#F38020', 'M16.5088 16.8447c.1475-.5068.0908-.9707-.1553-1.3154-.2246-.3164-.6045-.499-1.0615-.5205l-8.6592-.1123a.1559.1559 0 0 1-.1333-.0713c-.0283-.042-.0351-.0986-.021-.1553.0278-.084.1123-.1484.2036-.1562l8.7359-.1123c1.0351-.0489 2.1601-.8868 2.5537-1.9136l.499-1.3013c.0215-.0561.0293-.1128.0147-.168-.5625-2.5463-2.835-4.4453-5.5499-4.4453-2.5039 0-4.6284 1.6177-5.3876 3.8614-.4927-.3658-1.1187-.5625-1.794-.499-1.2026.119-2.1665 1.083-2.2861 2.2856-.0283.31-.0069.6128.0635.894C1.5683 13.171 0 14.7754 0 16.752c0 .1748.0142.3515.0352.5273.0141.083.0844.1475.1689.1475h15.9814c.0909 0 .1758-.0645.2032-.1553l.12-.4268zm2.7568-5.5634c-.0771 0-.1611 0-.2383.0112-.0566 0-.1054.0415-.127.0976l-.3378 1.1744c-.1475.5068-.0918.9707.1543 1.3164.2256.3164.6055.498 1.0625.5195l1.8437.1133c.0557 0 .1055.0263.1329.0703.0283.043.0351.1074.0214.1562-.0283.084-.1132.1485-.204.1553l-1.921.1123c-1.041.0488-2.1582.8867-2.5527 1.914l-.1406.3585c-.0283.0713.0215.1416.0986.1416h6.5977c.0771 0 .1474-.0489.169-.126.1122-.4082.1757-.837.1757-1.2803 0-2.6025-2.125-4.727-4.7344-4.727'],
  fly: ['', 'M11.987 0c-2.45-.01-5.002.925-6.541 2.897-1.17 1.502-1.664 3.474-1.49 5.356.29 2.112 1.476 3.96 2.676 5.672a41.5 41.5 0 0 0 4.216 4.831c-1.063.832-1.943 2.286-1.357 3.644.821 2.32 4.665 2.05 5.122-.372.39-1.288-.694-2.533-1.428-3.309 2.388-2.431 4.706-5.036 6.17-8.145.595-1.32.902-2.802.614-4.24-.28-2.341-1.823-4.473-3.967-5.46C14.76.266 13.364.016 11.987 0m-.236 1.577v15.534C9.881 13.483 7.724 9.266 8.73 5.069c.35-1.539 1.253-3.309 3.02-3.492m1.996.04c1.534.357 3.031 1.096 3.906 2.48 1.3 1.93 1.318 4.55.1 6.521-1.268 2.395-3.06 4.463-4.916 6.415 1.472-2.974 3.074-6.106 3.182-9.5-.043-2.08-.438-4.612-2.272-5.916M11.97 20.103c.848.342 1.597 1.983.153 2.173-.664.15-1.367-.599-.995-1.222.213-.355.488-.73.842-.95'],
  render: ['', 'M18.263.007c-3.121-.147-5.744 2.109-6.192 5.082-.018.138-.045.272-.067.405-.696 3.703-3.936 6.507-7.827 6.507-1.388 0-2.691-.356-3.825-.979a.2024.2024 0 0 0-.302.178V24H12v-8.999c0-1.656 1.338-3 2.987-3h2.988c3.382 0 6.103-2.817 5.97-6.244-.12-3.084-2.61-5.603-5.682-5.75'],
  railway: ['', 'M.113 10.27A13.026 13.026 0 000 11.48h18.23c-.064-.125-.15-.237-.235-.347-3.117-4.027-4.793-3.677-7.19-3.78-.8-.034-1.34-.048-4.524-.048-1.704 0-3.555.005-5.358.01-.234.63-.459 1.24-.567 1.737h9.342v1.216H.113v.002zm18.26 2.426H.009c.02.326.05.645.094.961h16.955c.754 0 1.179-.429 1.315-.96zm-17.318 4.28s2.81 6.902 10.93 7.024c4.855 0 9.027-2.883 10.92-7.024H1.056zM11.988 0C7.5 0 3.593 2.466 1.531 6.108l4.75-.005v-.002c3.71 0 3.849.016 4.573.047l.448.016c1.563.052 3.485.22 4.996 1.364.82.621 2.007 1.99 2.712 2.965.654.902.842 1.94.396 2.934-.408.914-1.289 1.458-2.353 1.458H.391s.099.42.249.886h22.748A12.026 12.026 0 0024 12.005C24 5.377 18.621 0 11.988 0z'],
  expo: ['', 'M0 20.084c.043.53.23 1.063.718 1.778.58.849 1.576 1.315 2.303.567.49-.505 5.794-9.776 8.35-13.29a.761.761 0 011.248 0c2.556 3.514 7.86 12.785 8.35 13.29.727.748 1.723.282 2.303-.567.57-.835.728-1.42.728-2.046 0-.426-8.26-15.798-9.092-17.078-.8-1.23-1.044-1.498-2.397-1.542h-1.032c-1.353.044-1.597.311-2.398 1.542C8.267 3.991.33 18.758 0 19.77Z'],
  ghpages: ['', 'M14.088 13.126h-.296V9.858h.998c.815 0 1.094.47 1.094.98s-.28.98-1.094.98h-.701v1.308zm0-1.582h.74a.642.642 0 0 0 .733-.705.642.642 0 0 0-.732-.706h-.741zm2.881-.37a1.913 1.913 0 0 0-.653.11v-.262a1.756 1.756 0 0 1 .653-.118c.654 0 .824.297.824.732v1.49h-.17l-.066-.174a1.143 1.143 0 0 1-.657.218.663.663 0 0 1-.763-.702c0-.37.205-.645.776-.68l.575-.035v-.122c0-.318-.113-.457-.519-.457zm-.078.85c-.31.03-.445.192-.445.445 0 .196.048.431.462.431a1.056 1.056 0 0 0 .58-.174v-.758zm1.86.493a.252.252 0 0 0-.083.16c0 .11.053.158.166.17l.74.088c.41.044.598.205.598.584 0 .532-.532.74-1.133.74-.61 0-.976-.178-.976-.657a.609.609 0 0 1 .449-.575v-.005a.321.321 0 0 1-.14-.287.392.392 0 0 1 .166-.297.746.746 0 0 1-.349-.714c0-.449.192-.82.85-.82a1.36 1.36 0 0 1 .349.044h.74v.165l-.365.105a.908.908 0 0 1 .126.505c0 .449-.192.82-.85.82a1.397 1.397 0 0 1-.288-.027zm.127.588c-.288.065-.532.2-.532.48 0 .322.244.413.693.413.435 0 .845-.109.845-.48 0-.221-.105-.309-.37-.34zm.727-1.381c0-.288-.056-.554-.566-.554-.51 0-.567.266-.567.554 0 .288.057.553.567.553.51 0 .566-.266.566-.554zm1.637-.82c.74 0 .828.506.828 1.133v.14h-1.438c.018.379.118.723.61.723a1.665 1.665 0 0 0 .719-.122v.261a1.765 1.765 0 0 1-.719.131c-.736 0-.915-.505-.915-1.133s.179-1.133.915-1.133zm-.61 1.024h1.133c0-.387-.022-.753-.523-.753-.506 0-.597.36-.61.753zm2.601-.052c.619.057.767.266.767.623 0 .336-.213.671-.876.671a2.147 2.147 0 0 1-.649-.109V12.8a1.924 1.924 0 0 0 .654.1c.453 0 .575-.192.575-.397 0-.2-.061-.34-.492-.374-.632-.057-.763-.28-.763-.58 0-.31.2-.645.815-.645a1.627 1.627 0 0 1 .627.11v.26a1.799 1.799 0 0 0-.631-.1c-.432 0-.523.162-.523.376 0 .19.078.29.496.326zm-20.787-.659H1.38a.05.05 0 0 0-.05.05v.522a.05.05 0 0 0 .05.05h.416v.649a1.267 1.267 0 0 1-.351.032c-.305 0-.731-.112-.731-1.048s.443-1.06.86-1.06a1.69 1.69 0 0 1 .614.094.05.05 0 0 0 .06-.05l.12-.504a.047.047 0 0 0-.02-.039 1.715 1.715 0 0 0-.903-.165C.73 9.748 0 10.05 0 11.508s.837 1.675 1.542 1.675a1.736 1.736 0 0 0 .938-.25.043.043 0 0 0 .016-.038v-1.628a.05.05 0 0 0-.05-.05zm5.545-1.294a.05.05 0 0 0-.05-.05H7.34a.05.05 0 0 0-.05.05v1.161h-.936V9.923a.05.05 0 0 0-.05-.05h-.6a.05.05 0 0 0-.05.05v3.145a.05.05 0 0 0 .05.05h.6a.05.05 0 0 0 .05-.05v-1.345h.937l-.002 1.345a.05.05 0 0 0 .05.05h.603a.05.05 0 0 0 .05-.05zm-4.389.412a.388.388 0 1 0-.387.392.39.39 0 0 0 .387-.392zm-.042 2.068v-1.451a.05.05 0 0 0-.05-.05h-.6a.057.057 0 0 0-.051.056v2.08c0 .06.038.079.087.079h.54c.06 0 .074-.03.074-.08zm6.764-1.497h-.597a.05.05 0 0 0-.05.05v1.542a.673.673 0 0 1-.367.11c-.215 0-.272-.097-.272-.307v-1.344a.05.05 0 0 0-.05-.05h-.604a.05.05 0 0 0-.05.05v1.446c0 .626.348.779.828.779a1.398 1.398 0 0 0 .71-.217 1.274 1.274 0 0 0 .022.128.052.052 0 0 0 .044.027l.385-.002a.05.05 0 0 0 .05-.05v-2.112a.05.05 0 0 0-.05-.05zm1.662-.07a1.121 1.121 0 0 0-.569.15V9.923a.05.05 0 0 0-.05-.05h-.602a.05.05 0 0 0-.05.05v3.145a.05.05 0 0 0 .05.05h.418a.05.05 0 0 0 .044-.027.973.973 0 0 0 .025-.144 1.08 1.08 0 0 0 .713.233c.548 0 .862-.278.862-1.248s-.502-1.095-.841-1.095zm-.235 1.771a.716.716 0 0 1-.347-.1v-.996a.793.793 0 0 1 .308-.1c.215-.019.422.046.422.558 0 .54-.094.647-.383.639zm-6.475-1.706h-.45l-.002-.595c0-.023-.011-.034-.037-.034h-.615c-.024 0-.036.01-.036.033v.615l-.33.08a.05.05 0 0 0-.035.048v.387a.05.05 0 0 0 .05.05h.315v.93c0 .692.484.76.812.76a1.375 1.375 0 0 0 .357-.06.046.046 0 0 0 .028-.044l.001-.426a.05.05 0 0 0-.05-.05c-.026 0-.094.01-.163.01-.221 0-.296-.102-.296-.236v-.884h.451a.05.05 0 0 0 .05-.05v-.484a.05.05 0 0 0-.05-.05z'],
  itch: ['#FA5C5C', 'M3.13 1.338C2.08 1.96.02 4.328 0 4.95v1.03c0 1.303 1.22 2.45 2.325 2.45 1.33 0 2.436-1.102 2.436-2.41 0 1.308 1.07 2.41 2.4 2.41 1.328 0 2.362-1.102 2.362-2.41 0 1.308 1.137 2.41 2.466 2.41h.024c1.33 0 2.466-1.102 2.466-2.41 0 1.308 1.034 2.41 2.363 2.41 1.33 0 2.4-1.102 2.4-2.41 0 1.308 1.106 2.41 2.435 2.41C22.78 8.43 24 7.282 24 5.98V4.95c-.02-.62-2.082-2.99-3.13-3.612-3.253-.114-5.508-.134-8.87-.133-3.362 0-7.945.053-8.87.133zm6.376 6.477a2.74 2.74 0 0 1-.468.602c-.5.49-1.19.795-1.947.795a2.786 2.786 0 0 1-1.95-.795c-.182-.178-.32-.37-.446-.59-.127.222-.303.412-.486.59a2.788 2.788 0 0 1-1.95.795c-.092 0-.187-.025-.264-.052-.107 1.113-.152 2.176-.168 2.95v.005l-.006 1.167c.02 2.334-.23 7.564 1.03 8.85 1.952.454 5.545.662 9.15.663 3.605 0 7.198-.21 9.15-.664 1.26-1.284 1.01-6.514 1.03-8.848l-.006-1.167v-.004c-.016-.775-.06-1.838-.168-2.95-.077.026-.172.052-.263.052a2.788 2.788 0 0 1-1.95-.795c-.184-.178-.36-.368-.486-.59-.127.22-.265.412-.447.59a2.786 2.786 0 0 1-1.95.794c-.76 0-1.446-.303-1.948-.793a2.74 2.74 0 0 1-.468-.602 2.738 2.738 0 0 1-.463.602 2.787 2.787 0 0 1-1.95.794h-.16a2.787 2.787 0 0 1-1.95-.793 2.738 2.738 0 0 1-.464-.602zm-2.004 2.59v.002c.795.002 1.5 0 2.373.953.687-.072 1.406-.108 2.125-.107.72 0 1.438.035 2.125.107.873-.953 1.578-.95 2.372-.953.376 0 1.876 0 2.92 2.934l1.123 4.028c.832 2.995-.266 3.068-1.636 3.07-2.03-.075-3.156-1.55-3.156-3.025-1.124.184-2.436.276-3.748.277-1.312 0-2.624-.093-3.748-.277 0 1.475-1.125 2.95-3.156 3.026-1.37-.004-2.468-.077-1.636-3.072l1.122-4.027c1.045-2.934 2.545-2.934 2.92-2.934zM12 12.714c-.002.002-2.14 1.964-2.523 2.662l1.4-.056v1.22c0 .056.56.033 1.123.007.562.026 1.124.05 1.124-.008v-1.22l1.4.055C14.138 14.677 12 12.713 12 12.713z'],
};
const SERVICE = {
  github: 'GitHub', gitlab: 'GitLab', bitbucket: 'Bitbucket', git: 'Git', vercel: 'Vercel', firebase: 'Firebase',
  supabase: 'Supabase', netlify: 'Netlify', cloudflare: 'Cloudflare', fly: 'Fly.io', render: 'Render', railway: 'Railway',
  expo: 'Expo', ghpages: 'GitHub Pages', itch: 'itch.io',
};
const LINK_ICON = '<svg class="brand" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>';
const brandIcon = (kind) => {
  const b = BRAND[kind];
  return b ? `<svg class="brand" viewBox="0 0 24 24" role="img" aria-label="${esc(SERVICE[kind] || kind)}" fill="${b[0] || 'currentColor'}"><path d="${b[1]}"/></svg>` : LINK_ICON;
};
const REPO_KINDS = new Set(['github', 'gitlab', 'bitbucket', 'git']);
function servicesHtml(list) {
  list = list || [];
  const row = (s) => {
    const label = s.custom ? s.name : SERVICE[s.kind] || s.kind;
    const name = !s.custom && s.name && s.name !== label ? s.name : '';
    let host = '';
    try { host = new URL(s.url).hostname.replace(/^www\./, ''); } catch { /* keep empty */ }
    const where = s.custom ? `${esc(host)} · ${t('직접 추가')}` : `${s.detail ? `${esc(s.detail)} · ` : ''}${t('{file}에서 찾음', { file: esc(s.source) })}`;
    return `<div class="svc"><span class="si">${brandIcon(s.kind)}</span><div class="body"><b>${esc(label)}</b>${name ? ` <span class="muted">${esc(name)}</span>` : ''}
        <div class="m">${where}</div></div>
      <div class="pact">${s.site ? `<a class="btn sm" href="${esc(s.site)}" target="_blank" rel="noopener">${t('사이트')} ↗</a>` : ''}<a class="btn sm primary" href="${esc(s.url)}" target="_blank" rel="noopener">${s.custom ? t('열기') : REPO_KINDS.has(s.kind) ? t('저장소') : t('대시보드')} ↗</a>${s.custom ? `<button class="btn sm ghost" data-link-rm="${esc(s.linkId)}" aria-label="${t('링크 삭제')}">✕</button>` : ''}</div></div>`;
  };
  return `<div class="section" id="psvc"><div class="section-h"><h2>${t('연결된 서비스')}</h2><span class="count">${list.length}</span><button class="more" data-link-add>+ ${t('링크 추가')}</button></div>
    ${list.length ? `<div class="card list">${list.map(row).join('')}</div>` : `<p class="small muted">${t('자동으로 찾은 서비스가 없어요. 쓰는 대시보드가 있으면 링크를 추가해두세요.')}</p>`}</div>`;
}
function bindServices(el, root, reload) {
  if (!el) return;
  $$('[data-link-rm]', el).forEach((b) => (b.onclick = async () => {
    try { await api(`/api/projects/${encodeURIComponent(root)}/links/${b.dataset.linkRm}/remove`, { method: 'POST' }); toast(t('삭제했어요')); reload(); } catch (e) { toast(e.message, true); }
  }));
  const add = $('[data-link-add]', el);
  if (add) add.onclick = () => sheet({
    title: t('링크 추가'),
    body: `<p class="small muted">${t('자동으로 못 찾은 서비스(배포 사이트, 관리 콘솔, 기획 문서…)의 주소를 이 프로젝트에 붙여둬요.')}</p>
      <label class="fld"><span>${t('이름')}</span><input type="text" data-ln placeholder="${t('예) 운영 사이트, AWS 콘솔')}" maxlength="60"></label>
      <label class="fld"><span>${t('주소')}</span><input type="url" data-lu placeholder="https://" inputmode="url" autocomplete="off"></label>`,
    footer: `<button class="btn ghost" data-x>${t('취소')}</button><button class="btn primary" data-ok>${t('추가')}</button>`,
    onMount: (sh, close) => {
      const u = $('[data-lu]', sh);
      setTimeout(() => $('[data-ln]', sh).focus(), 250);
      $('[data-x]', sh).onclick = () => close();
      const ok = async () => {
        try { await api(`/api/projects/${encodeURIComponent(root)}/links`, { body: { name: $('[data-ln]', sh).value, url: u.value } }); close(); toast(t('추가했어요')); reload(); }
        catch (e) { toast(e.message, true); }
      };
      $('[data-ok]', sh).onclick = ok;
      u.onkeydown = (e) => { if (e.key === 'Enter' && !e.isComposing) ok(); };
    },
  });
}

// ---------------------------------------------------------------- GIT REPOS (every remote used by a project)
async function viewRepos() {
  const v = shell({ title: t('Git 저장소'), fab: false });
  v.innerHTML = '<div class="section"><div class="skeleton" style="height:300px"></div></div>';
  const d = await api('/api/repos');
  let q = sessionStorage.getItem('rq') || '';
  const kindOf = (host) => (/github/.test(host || '') ? 'github' : /gitlab/.test(host || '') ? 'gitlab' : /bitbucket/.test(host || '') ? 'bitbucket' : 'git');
  const badge = (r) => r.mine ? `<span class="flag run">${t('내 저장소')}</span>` : r.org ? `<span class="flag run">${t('내 조직')} · ${esc(r.owner)}</span>` : d.login ? `<span class="flag">${t('외부 저장소')}</span>` : '';
  const repoCard = (r) => `<div class="card repo">
      <div class="rh"><span class="si">${brandIcon(kindOf(r.host))}</span>
        <div class="body"><b>${esc(r.slug)}</b><div class="m">${esc(r.host || '')}${badge(r) ? ` · ${badge(r)}` : ''}</div></div>
        ${r.web ? `<a class="btn sm primary" href="${esc(r.web)}" target="_blank" rel="noopener">${t('열기')} ↗</a>` : ''}</div>
      <div class="rp">${r.projects.map((p) => `<a class="rpp" href="#/p/${encodeURIComponent(p.id)}">📁 <b>${esc(p.name)}</b> <span class="muted">${esc(p.path)}${p.remote !== 'origin' ? ` · ${esc(p.remote)}` : ''}</span>${p.worktree ? ` <span class="flag">${t('워크트리')}</span>` : ''}</a>`).join('')}</div>
    </div>`;
  const draw = () => {
    const repos = d.repos.filter((r) => matchQ(q, r.slug, r.host, ...r.projects.map((p) => `${p.name} ${p.path}`)));
    const local = d.noRemote.filter((p) => matchQ(q, p.name, p.path));
    $('#rlist').innerHTML = `<div class="section"><div class="section-h"><h2>${t('연결된 저장소')}</h2><span class="count">${repos.length}</span></div>
        ${repos.length ? `<div class="port-grid">${repos.map(repoCard).join('')}</div>` : `<div class="card empty"><b>${t('원격 저장소가 연결된 프로젝트가 없어요')}</b></div>`}</div>
      ${local.length ? `<div class="section"><div class="section-h"><h2>${t('원격 저장소 없음')}</h2><span class="count">${local.length}</span></div>
        <p class="small muted">${t('git은 쓰지만 GitHub 같은 원격 저장소에 연결되지 않은 프로젝트예요. 이 PC에만 있어요.')}</p>
        <div class="card list">${local.map((p) => `<a class="srow" href="#/p/${encodeURIComponent(p.id)}"><div class="body"><div class="t">📁 ${esc(p.name)}</div><div class="m">${esc(p.path)}</div></div></a>`).join('')}</div></div>` : ''}`;
  };
  v.innerHTML = `${searchBox('rq', q, t('저장소·프로젝트 검색'))}<div id="rlist"></div>
    <p class="small muted" style="text-align:center;line-height:1.6">${t('Baton 프로젝트 폴더의 git remote를 모은 목록이에요')}<br>${
      d.via === 'gh' ? t('「내 저장소」는 GitHub CLI(gh)에 로그인한 {login} 계정{orgs} 기준이에요', { login: esc(d.login), orgs: d.orgs?.length ? t('과 소속 조직 {n}곳', { n: d.orgs.length }) : '' })
      : d.via === 'git' ? t('「내 저장소」는 git 설정의 github.user({login}) 기준이에요', { login: esc(d.login) })
      : t('GitHub CLI(gh)에 로그인하면 내 저장소와 외부 저장소를 구분해서 보여줘요')}</p>`;
  $('#rq').oninput = (e) => { q = e.target.value; sessionStorage.setItem('rq', q); draw(); };
  draw();
}

// ---------------------------------------------------------------- PORTS
const ON_THIS_PC = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(location.hostname);
async function viewPorts() {
  const v = shell({ title: t('서빙 중인 포트'), fab: false, right: `<button class="icon-btn" id="prefresh" aria-label="${t('새로고침')}">${ICON.refresh}</button>` });
  v.innerHTML = '<div class="section"><div class="skeleton" style="height:300px"></div></div>';
  const d = await api('/api/ports');
  const servers = d.servers || [];
  const claimed = new Set(servers.filter((s) => s.running).map((s) => s.port));
  const mine = d.ports.filter((p) => p.mine && !claimed.has(p.port));
  const sys = d.ports.filter((p) => !p.mine);
  const portCard = (p) => {
    const title = p.page?.title || (p.page?.kind === 'api' ? t('API 서버') : p.page?.kind === 'tcp' ? t('HTTP 아님') : '');
    const web = p.page && p.page.kind !== 'tcp';
    // Browsing Baton on this PC: the server is one click away on localhost.
    const openHere = web && ON_THIS_PC ? `<a class="btn sm${p.phoneUrl ? '' : ' primary'}" href="http://localhost:${p.port}" target="_blank" rel="noopener">${t('열기')} ↗</a>` : '';
    const reach = openHere + (p.phoneUrl
      ? `<a class="btn sm primary" href="${esc(p.phoneUrl)}" target="_blank" rel="noopener">${t('폰에서 열기 ↗')}</a>`
      : web ? `<button class="btn sm" data-share="${p.port}">${t('폰에서 열 수 있게')}</button>` : '');
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
    const sv = servers.filter((s) => matchQ(q, `:${s.port}`, s.title, s.cmd, s.label, s.cwd, projectName(s.project), s.project));
    el.innerHTML = searching && !m.length && !sy.length && !sv.length
      ? `<div class="empty"><b>${t('검색 결과가 없어요')}</b></div>`
      : `${sv.length || !searching ? `<div class="section" id="srvsec"><div class="section-h"><h2>${t('개발 서버')}</h2><span class="count">${t('켜짐 {on} · 전체 {n}', { on: sv.filter((s) => s.running).length, n: sv.length })}</span></div>
      <p class="small muted">${t('Baton이 기억하는 서버예요. 켜둔 서버는 PC나 Baton을 다시 켜도 자동으로 다시 떠요. 꺼도 목록에 남아요.')}</p>
      ${sv.length ? `<div class="card list">${sv.map((s) => serverRow(s)).join('')}</div>` : `<div class="card empty"><b>${t('아직 기억하는 서버가 없어요')}</b><span>${t('에이전트나 터미널에서 개발 서버를 띄우면 자동으로 여기에 추가돼요')}</span></div>`}</div>` : ''}
      ${m.length ? `<div class="section"><details class="sysports"${searching ? ' open' : ''}><summary>${t('기타 프로그램 {n}개', { n: m.length })} <span class="muted small">· ${t('개발 서버가 아닌, 이 PC에서 포트를 연 프로그램')}</span></summary>
        <div class="port-grid" style="margin-top:10px">${m.map(portCard).join('')}</div></details></div>` : ''}
    ${sy.length ? `<div class="section"><details class="sysports"${searching ? ' open' : ''}><summary>${t('시스템 서비스 {n}개', { n: sy.length })}</summary>
      <div class="card list">${sy.map(sysRow).join('')}</div></details></div>` : ''}`;
    bind(el);
    if ($('#srvsec')) bindServers($('#srvsec'), render);
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
    const has = new Set(d.skills.map((s) => s.tool));
    $('#skf').innerHTML = [['', t('전체')], ...TOOL_IDS().filter((k) => k === f.tool || has.has(k) || INSTALLED().includes(k)).map((k) => [k, TOOL[k].name])].map(([k, l]) => `<button class="chip ${f.tool === k ? 'on' : ''}" data-t="${k}">${l}</button>`).join('')
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
  const id = await pick(t('어떤 MCP를 추가할까요?'), [...presets.map((p) => ({ value: p.id, icon: glyph(p.icon), label: `${p.name}${where(p.id).length ? ' ✓' : ''}`, desc: p.desc })), { value: '__custom', icon: glyph('edit'), label: t('직접 추가'), desc: t('실행 명령이나 URL을 알고 있을 때') }]);
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
        <p class="small muted" style="margin:-4px 2px 8px">${REASON[r]}${r === t('자동 실행') ? t(' · 목록에서만 빼려면 「숨기기」, 지우면 프로젝트 활동 기록에서도 빠져요') : ''}</p>
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
  v.innerHTML = `<div id="cl"></div><div class="bulkbar" id="clbar" hidden><span>${t('{n}개 선택', { n: '<b id="clcount">0</b>' })}</span><button class="btn sm" id="clhide">${t('숨기기')}</button><button class="btn primary danger-fill" id="cldo">${t('휴지통으로')}</button></div>`;
  draw();
  $('#clhide').onclick = async () => {
    $('#clhide').disabled = true;
    if (await hideMany([...sel])) render();
    else $('#clhide').disabled = false;
  };
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

  const LOGIN_LABEL = { claude: t('Claude 계정으로 로그인'), codex: t('ChatGPT 계정으로 로그인'), agy: t('Google 계정으로 로그인'), cursor: t('Cursor 계정으로 로그인') };
  const LOGIN_HINT = {
    claude: t('Pro·Max 구독 계정으로 바로 연결돼요. 버튼을 누르고 「로그인 페이지 열기」에서 승인한 뒤, 화면에 나온 코드를 붙여넣으면 끝이에요. API 키는 필요 없어요.'),
    codex: t('ChatGPT Plus·Pro 계정으로 바로 연결돼요. 로그인 페이지를 열고 화면에 보이는 코드를 입력하면 끝이에요.'),
    agy: t('Google 계정으로 바로 연결돼요. 로그인 페이지를 열어 승인하면 끝이에요.'),
    cursor: t('Cursor 계정으로 바로 연결돼요. 로그인 페이지를 열어 승인하면 끝이에요.'),
  };
  const toolCard = (x) => {
    const state = !x.installed ? 'missing' : x.loggedIn ? 'ready' : x.optionalLogin ? 'ready' : 'login';
    const badge = x.provider && x.installed ? `<span class="pill ${x.loggedIn ? 'ok' : 'warn'}">${esc(x.provider)}</span>` : state === 'ready' ? `<span class="pill ok">${x.loggedIn ? t('사용 준비 완료') : t('설치됨')}</span>`
      : state === 'login' ? `<span class="pill warn">${x.loginExpired ? t('로그인 만료') : t('로그인 필요')}</span>` : `<span class="pill">${t('설치 안 됨')}</span>`;
    const btns = [];
    if (!x.installed && x.canInstall) btns.push(`<button class="btn sm primary" data-job="install" data-tool="${x.id}">${t('원클릭 설치')}</button>`);
    if (x.installed && !x.loggedIn && x.loginKind !== 'terminal') btns.push(`<button class="btn sm ${state === 'login' ? 'primary' : ''}" data-job="login" data-tool="${x.id}">${LOGIN_LABEL[x.id] || t('구독 계정으로 로그인')}</button>`);
    if (x.installed && (x.loggedIn || x.optionalLogin)) btns.push(`<button class="btn sm ghost" data-test="${x.id}">${t('연결 테스트')}</button>`);
    btns.push(`<a class="btn sm ghost" href="${esc(x.docs)}" target="_blank" rel="noopener">${t('문서')} ↗</a>`);
    return `<div class="card setup-tool" data-tool-card="${x.id}">
      <div class="sh"><span class="tool-avatar ${x.id}">${esc(TOOL[x.id]?.short || x.name[0])}</span>
        <div class="st"><b>${esc(x.name)}</b><span>${esc(x.vendor)}${x.version ? ` · v${esc(x.version)}` : ''}</span></div>${badge}</div>
      ${x.note ? `<p class="small muted">${esc(x.note)}</p>` : ''}
      ${x.loginExpired ? `<p class="small warn-text">${t('저장된 로그인이 만료됐어요. 다시 로그인하면 한도도 다시 보여요.')}</p>` : ''}
      ${state === 'login' && LOGIN_HINT[x.id] ? `<p class="small login-hint">${LOGIN_HINT[x.id]}</p>` : ''}
      ${!x.installed && x.installCmd ? `<details class="pcmd"><summary>${t('실행될 명령')}</summary><code>${esc(x.installCmd)}</code></details>` : ''}
      ${!x.installed && !x.canInstall ? `<p class="small warn-text">${t('이 OS에서는 자동 설치를 지원하지 않아요. 문서를 참고해주세요.')}</p>` : ''}
      ${x.installed && !x.loggedIn && x.loginKind === 'terminal' ? `<p class="small muted">${t('터미널에서 이 명령을 실행해 로그인하세요:')}</p><code class="copy" data-copy="${esc(x.loginCmd)}">${esc(x.loginCmd)}</code>` : ''}
      <div class="pact">${btns.join('')}</div>
      <div class="jobbox" hidden></div>
    </div>`;
  };
  const toolStrip = () => `<div class="tool-strip">${st.tools.map((x) => `<span class="ts-item ${ready(x) ? 'on' : x.installed ? 'half' : ''}"><span class="tool-avatar ${x.id}">${esc(TOOL[x.id]?.short || '?')}</span>${esc(x.name)}<em>${ready(x) ? (x.provider ? esc(x.provider) : '✓') : x.installed ? t('로그인 필요') : t('없음')}</em></span>`).join('')}</div>`;

  const AI_MODES = [
    ['sub', glyph('card'), t('구독 계정'), t('Claude Pro·Max, ChatGPT Plus, Google, Cursor')],
    ['key', glyph('key'), t('API 키'), t('키를 붙여넣으면 맞는 도구에 알아서 연결해요')],
    ['company', glyph('building'), t('회사 계정'), t('Amazon Bedrock · Google Vertex · 사내 게이트웨이')],
    ['local', glyph('server'), t('내 컴퓨터·서버의 모델'), t('Ollama · LM Studio · vLLM 같은 자체 서빙')],
  ];
  let aiMode = sessionStorage.getItem('setup.ai') || 'sub';

  const phoneSteps = () => {
    const isPhone = /iPhone|iPad|Android/.test(navigator.userAgent);
    const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
    const phones = ts.phones || [];
    const li = (done, title, body) => `<li class="pstep ${done ? 'done' : ''}"><span class="pdot">${done ? '✓' : ''}</span><div><b>${title}</b>${body ? `<div class="pbody">${body}</div>` : ''}</div></li>`;
    if (remote) {
      return `<div class="card pad"><div class="banner ok-banner">${glyph('checkCircle')} ${t('이 기기는 Baton에 연결돼 있어요')}</div><ol class="psteps">
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
      <h2>${remote ? t('Baton 설정') : t('PC에서 한 번만 설정하면 돼요')}</h2>
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
        <span class="pi">${glyph(p.icon)}</span><span class="pb"><b>${esc(p.name)}</b><span>${esc(p.desc)}</span>
        <span class="ptags">${w.length ? `<em class="ok">✓ ${w.map((x) => esc(TOOL[x]?.name || x)).join(', ')}</em>` : ''}${p.oauth ? `<em>${t('로그인 필요')}</em>` : ''}${p.fields.some((f) => f.secret && !f.optional) ? `<em>${t('토큰 필요')}</em>` : ''}${p.missing ? `<em class="warn">${t('{x} 필요', { x: p.missing })}</em>` : ''}</span></span></button>`; }).join('')}</div>
      <div class="pact center">${!all ? `<button class="btn sm ghost" id="mcpmore">${t('더 보기 ({n})', { n: presets.length - list.length })}</button>` : ''}<button class="btn sm ghost" id="mcpcustom">${t('직접 추가')}</button><a class="btn sm ghost" href="#/mcp">${t('설치된 MCP 보기')} ›</a></div>`;
    $$('[data-preset]', box).forEach((b) => (b.onclick = () => mcpAddSheet(presets.find((p) => p.id === b.dataset.preset), where(b.dataset.preset), drawMcp)));
    $('#mcpmore', box) && ($('#mcpmore', box).onclick = () => { store.set('setup.mcpall', true); drawMcp(); });
    $('#mcpcustom', box).onclick = () => mcpAddSheet(null, [], drawMcp);
  };

  const jobBoxFor = (b, action, tool) => (tool && $(`[data-tool-card="${tool}"] .jobbox`, v)) || $(`.jobbox[data-for="${action.replace(/-(on|off)$/, '')}"]`, v) || b.closest('.card, .section')?.querySelector('.jobbox') || (() => { const d = document.createElement('div'); d.className = 'jobbox'; b.after(d); return d; })();
  /** Show a job's progress under its button; the button reads "…ing" and can't be tapped twice. */
  function follow(b, job) {
    const label = b.textContent.replace(/ · .*$/, '');
    b.disabled = true;
    b.innerHTML = `<span class="spinner sm"></span>${job.action === 'login' ? t('로그인 중…') : job.action === 'install' ? t('설치 중…') : t('진행 중…')}`;
    runJobBox(jobBoxFor(b, job.action, job.tool), job, (ev) => {
      b.disabled = false;
      if (ev.ok) { toast(t('{x} 완료', { x: job.label })); setTimeout(() => render(), 1500); }
      else b.textContent = `${label} · ${t('다시 시도')}`;
    });
  }

  function bindSetupButtons(root) {
    $$('code.copy', root).forEach((c) => (c.onclick = () => { navigator.clipboard?.writeText(c.dataset.copy); toast(t('복사했어요')); }));
    $$('[data-connect]', root).forEach((b) => (b.onclick = () => connectSheet(b.dataset.connect, () => setTimeout(render, 400))));
    $$('[data-test]', root).forEach((b) => (b.onclick = async () => { b.disabled = true; await testConnectionUi(b.dataset.test); b.disabled = false; }));
    $$('[data-job]', root).forEach((b) => (b.onclick = async () => {
      const action = b.dataset.job, tool = b.dataset.tool || null;
      b.disabled = true;
      try { follow(b, (await api('/api/setup/jobs', { body: { action, tool } })).job); }
      catch (e) { toast(e.message, true); b.disabled = false; }
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
  api('/api/setup/jobs').then(({ jobs }) => jobs.forEach((job) => {
    const b = $(`[data-job="${job.action}"]${job.tool ? `[data-tool="${job.tool}"]` : ''}`, v);
    if (b && !b.disabled) follow(b, job);
  })).catch(() => {});
  drawMcp().catch(() => { $('#mcppresets', v).innerHTML = ''; });
}

/** Add an MCP server (preset or custom) to the chosen CLIs. */
async function mcpAddSheet(p, already = [], after) {
  const installed = INSTALLED();
  const field = (f) => `<label><span>${esc(f.label)}</span><input data-f="${f.k}" type="${f.secret ? 'password' : 'text'}" placeholder="${esc(f.ph || '')}" value="${esc(f.value || '')}" autocomplete="off" spellcheck="false"></label>`;
  const body = `<div class="pwform connect-form">
    ${p ? `<p class="small muted">${esc(p.desc)}</p><p class="small mono muted">${esc(p.target)}</p>${p.oauth ? `<p class="small">${t('처음 쓸 때 로그인이 필요해요. Claude Code는 터미널에서 claude → /mcp, Codex는 codex mcp login {name}', { name: p.id })}</p>` : ''}${p.missing ? `<p class="small warn-text">${t('이 서버는 {x}가 필요해요. 먼저 설치해주세요.', { x: p.missing })}</p>` : ''}${p.fields.map(field).join('')}`
      : `<label><span>${t('이름')}</span><input data-f="name" placeholder="my-server" autocomplete="off"></label>
         <label><span>${t('실행 명령 또는 URL')}</span><input data-f="target" placeholder="npx -y @scope/server  ·  https://example.com/mcp" autocomplete="off" spellcheck="false"></label>
         <label><span>${t('환경 변수 / 헤더 (한 줄에 하나, KEY=값)')}</span><textarea data-f="pairs" placeholder="API_KEY=…"></textarea></label>`}
    <div class="field"><span>${t('어느 CLI에 추가할까요?')}</span><div class="chips">${installed.map((k) => `<label class="chip check"><input type="checkbox" data-tool="${k}" ${already.includes(k) ? '' : 'checked'}>${TOOL[k].name}${already.includes(k) ? ' ✓' : ''}</label>`).join('')}</div></div>
    <p class="small muted">${t('각 CLI의 전역 설정에 저장돼서 모든 폴더에서 쓸 수 있어요. 기존 파일은 백업해둬요.')}</p></div>`;
  const r = await sheet({
    title: p ? p.name : t('MCP 서버 직접 추가'), body,
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
  box.classList.remove('ok', 'fail');
  const isLogin = job.action === 'login';
  box.innerHTML = `<div class="jhead"><div class="spinner"></div><div class="jt"><b>${esc(job.label)} · ${job.action === 'install' ? t('설치하는 중') : t('진행 중')}</b><span class="jsub"></span></div><span class="jtime">0:00</span><button class="btn sm ghost" data-stop>${t('중지')}</button></div>
    <div class="jlinks"></div>
    <form class="jinput" hidden><input type="text" placeholder="${t('코드나 답을 붙여넣고 Enter')}" autocomplete="off"><button class="btn sm">${t('보내기')}</button></form>
    <details class="jdetails"><summary>${t('자세한 로그')}</summary><pre class="jlog"></pre></details>`;
  const log = $('.jlog', box), links = $('.jlinks', box), form = $('.jinput', box), sub = $('.jsub', box), time = $('.jtime', box);
  const t0 = job.startedAt || Date.now();
  let lastLine = Date.now(), lastErr = '', seen = -1, ended = false, stopped = false;
  const tick = () => {
    const sec = Math.max(0, Math.floor((Date.now() - t0) / 1000));
    time.textContent = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
    const quiet = (Date.now() - lastLine) / 1000;
    sub.textContent = isLogin ? (links.childElementCount ? t('로그인 페이지에서 승인한 뒤, 코드가 보이면 아래 칸에 붙여넣으세요') : t('로그인 준비 중이에요…'))
      : quiet > 20 ? t('아직 진행 중이에요. 인터넷 속도에 따라 몇 분 걸릴 수 있어요 — 다시 누르지 않아도 돼요')
      : job.action === 'install' ? t('다운로드하고 설치하는 중이에요. 이 화면을 나가도 계속 진행돼요') : '';
  };
  const es = new EventSource(`/api/setup/jobs/${job.id}/stream`);
  tick();
  const timer = setInterval(() => { if (!box.isConnected) { clearInterval(timer); es.close(); return; } tick(); }, 1000);
  $('[data-stop]', box).onclick = () => { stopped = true; api(`/api/setup/jobs/${job.id}/stop`, { method: 'POST' }); };
  form.onsubmit = async (e) => {
    e.preventDefault();
    const inp = $('input', form);
    if (!inp.value.trim()) return;
    await api(`/api/setup/jobs/${job.id}/input`, { body: { text: inp.value.trim() } });
    inp.value = '';
  };
  es.onmessage = (m) => {
    const ev = JSON.parse(m.data);
    if (ev.i != null) { if (ev.i <= seen) return; seen = ev.i; } // a reconnect replays from the start
    if (ev.t === 'line') {
      lastLine = Date.now();
      if (ev.stream === 'err' || /error|fail|denied|not found|실패|오류/i.test(ev.text)) lastErr = ev.text;
      log.textContent += `${ev.text}\n`;
      log.scrollTop = log.scrollHeight;
      if (/paste|code|코드|enter|입력/i.test(ev.text) && ev.stream !== 'cmd') form.hidden = false;
    } else if (ev.t === 'url') {
      links.insertAdjacentHTML('beforeend', `<a class="btn sm primary" href="${esc(ev.url)}" target="_blank" rel="noopener">${t('로그인 페이지 열기')} ↗</a>`);
      form.hidden = false; tick();
    } else if (ev.t === 'code') {
      links.insertAdjacentHTML('beforeend', `<div class="devcode"><span>${t('이 코드를 입력하세요')}</span><b>${esc(ev.code)}</b></div>`);
    } else if (ev.t === 'end') {
      ended = true;
      es.close(); clearInterval(timer);
      links.innerHTML = '';
      if (stopped && !ev.ok) {
        $('.jhead', box).innerHTML = `<div class="jt"><b>${esc(job.label)} · ${t('중지했어요')}</b></div>`;
        form.hidden = true;
        onEnd?.(ev);
        return;
      }
      box.classList.add(ev.ok ? 'ok' : 'fail');
      const why = ev.ok ? '' : ev.code == null || ev.code === -1 ? t('실행하지 못했어요') : lastErr ? esc(lastErr.slice(0, 200)) : t('종료 코드 {code}', { code: ev.code });
      $('.jhead', box).innerHTML = `${ev.ok ? glyph('checkCircle') : glyph('alert')}<div class="jt"><b>${esc(job.label)} · ${ev.ok ? t('완료했어요') : t('실패했어요')}</b><span class="jsub">${ev.ok ? '' : `${why} · ${t('아래 「자세한 로그」를 확인하고 다시 시도해보세요')}`}</span></div>`;
      if (!ev.ok) $('.jdetails', box).open = true;
      form.hidden = true;
      onEnd?.(ev);
    }
  };
  es.onerror = () => { if (ended) es.close(); };
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
  if (r.reset) opts.push({ value: 'reset', icon: glyph('hourglass'), label: t('한도가 풀리면 바로'), desc: t('{when} · {label} 초기화 직후', { when: whenFull(r.reset.at), label: r.reset.label }) });
  opts.push({ value: 'time', icon: glyph('clock'), label: t('시간 정해서'), desc: t('원하는 날짜·시각에 보내요') });
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
