// Default on wide screens; studio.html keeps the all-size design preview.
const responsive = document.documentElement.dataset.studio === 'responsive';
const wide = matchMedia('(min-width: 760px)');
const enabled = () => !responsive || wide.matches;
const originalChildren = new WeakMap();
const ko = window.LANG === 'ko';
const copy = (a, b) => ko ? a : b;
const isMac = /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent || '');
const modKey = isMac ? '⌘' : 'Ctrl+';

const nav = document.querySelector('#tabbar');
const SIDEBAR_KEY = 'baton:sidebar';

const ICON_PANEL = '<svg class="i" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M9 4v16M15 9l-3 3 3 3"/></svg>';
const ICON_SEARCH = '<svg class="i" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>';
const ICON_SPLIT = '<svg class="i" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M12 4v16"/></svg>';

const brand = document.createElement('div');
brand.className = 'studio-brand';
brand.innerHTML = `<a class="studio-brand-link" href="#/" data-tip="Baton"><span class="baton-mark studio-mark" aria-hidden="true"></span><strong>baton<span>WORKSPACE / STUDIO</span></strong></a>
  <button type="button" class="side-toggle" id="side-toggle" aria-label="${copy('사이드바 접기/펼치기', 'Toggle sidebar')}" data-tip="${copy(`사이드바 (${modKey}\\)`, `Sidebar (${modKey}\\)`)}" title="${copy(`사이드바 접기/펼치기 (${modKey}\\)`, `Toggle sidebar (${modKey}\\)`)}">${ICON_PANEL}</button>`;

const cmdBtn = document.createElement('button');
cmdBtn.type = 'button';
cmdBtn.className = 'side-cmd';
cmdBtn.setAttribute('data-tip', copy(`빠른 검색 (${modKey}K)`, `Quick search (${modKey}K)`));
cmdBtn.innerHTML = `${ICON_SEARCH}<span class="side-cmd-lbl">${copy('빠른 검색…', 'Quick search…')}</span><kbd>${modKey}K</kbd>`;
cmdBtn.onclick = () => window.dispatchEvent(new CustomEvent('baton:cmdk'));

const runsDock = document.createElement('div');
runsDock.className = 'side-runs';
runsDock.setAttribute('aria-label', copy('진행 중인 세션', 'Running sessions'));

const foot = document.createElement('div');
foot.className = 'studio-foot';
foot.innerHTML = `<span>MAKE SOMETHING GOOD.</span><button type="button" class="side-kbd-btn" data-tip="${copy('단축키 (?)', 'Shortcuts (?)')}" title="${copy('키보드 단축키 (?)', 'Keyboard shortcuts (?)')}" aria-label="${copy('단축키', 'Shortcuts')}">?</button>`;
foot.querySelector('.side-kbd-btn').onclick = () => window.dispatchEvent(new CustomEvent('baton:shortcuts'));

let userPinnedOpen = false;
function isCollapsed() {
  return document.documentElement.dataset.sidebar === 'collapsed';
}
function setCollapsed(next, { persist = true, fromAuto = false } = {}) {
  if (!enabled()) return;
  if (next) document.documentElement.dataset.sidebar = 'collapsed';
  else delete document.documentElement.dataset.sidebar;
  const btn = brand.querySelector('#side-toggle');
  if (btn) btn.setAttribute('aria-expanded', String(!next));
  if (persist) {
    userPinnedOpen = !next;
    try { localStorage.setItem(SIDEBAR_KEY, next ? 'collapsed' : 'expanded'); } catch { /* ignore */ }
  } else if (!fromAuto) {
    userPinnedOpen = false;
  }
  window.dispatchEvent(new CustomEvent('baton:sidebar-change', { detail: { collapsed: next } }));
}
brand.querySelector('#side-toggle').onclick = () => setCollapsed(!isCollapsed(), { persist: true });

// Restore saved sidebar preference immediately on wide screens
try {
  if (enabled() && localStorage.getItem(SIDEBAR_KEY) === 'collapsed') {
    document.documentElement.dataset.sidebar = 'collapsed';
  }
} catch { /* ignore */ }

// Sync nav item tooltips for collapsed rail mode
function syncTabTooltips() {
  for (const a of nav.querySelectorAll(':scope > a')) {
    const label = a.querySelector('span:not(.tab-badge)')?.textContent?.trim();
    if (label) a.setAttribute('data-tip', label);
  }
}

// Render live runs inside the sidebar dock
function escHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function renderSideRuns(runs = []) {
  if (!enabled() || !runs.length) { runsDock.innerHTML = ''; return; }
  const rows = runs.slice(0, 6).map((r) => {
    const title = r.title || r.prompt || copy('응답 중', 'Running');
    const href = r.sessionId ? `#/s/${r.tool}/${encodeURIComponent(r.sessionId)}` : '#/';
    const splitBtn = r.sessionId
      ? `<button type="button" class="sr-split" data-split-tool="${escHtml(r.tool)}" data-split-id="${escHtml(r.sessionId)}" title="${copy('옆 창에 분할 열기', 'Open in split pane')}" aria-label="${copy('옆 창에 분할 열기', 'Open in split pane')}">${ICON_SPLIT}</button>`
      : '';
    return `<div class="side-run" data-href="${escHtml(href)}" data-tip="${escHtml(title)}" role="button" tabindex="0">
      <i class="sr-dot" aria-hidden="true"></i>
      <span class="sr-title">${escHtml(title)}</span>
      ${splitBtn}
    </div>`;
  }).join('');
  runsDock.innerHTML = `<div class="side-sec-h"><span>${copy('진행 중', 'Running')}</span><span>${runs.length}</span></div>${rows}`;
  for (const row of runsDock.querySelectorAll('.side-run')) {
    const go = (e) => {
      const sp = e.target.closest?.('.sr-split');
      if (sp) {
        e.stopPropagation();
        window.dispatchEvent(new CustomEvent('baton:split-open', { detail: { tool: sp.dataset.splitTool, id: sp.dataset.splitId } }));
        return;
      }
      if ((e.metaKey || e.ctrlKey) && row.querySelector('.sr-split')) {
        const s = row.querySelector('.sr-split');
        window.dispatchEvent(new CustomEvent('baton:split-open', { detail: { tool: s.dataset.splitTool, id: s.dataset.splitId } }));
        return;
      }
      location.hash = row.dataset.href;
    };
    row.onclick = go;
    row.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(e); } };
  }
}

window.addEventListener('baton:runs', (e) => renderSideRuns(e.detail?.runs || []));
window.addEventListener('baton:toggle-sidebar', () => setCollapsed(!isCollapsed(), { persist: true }));
window.addEventListener('baton:workspace-density', (e) => {
  // Auto-collapse sidebar when multi-pane workspace opens on medium-width screens unless user explicitly expanded
  if (!enabled() || userPinnedOpen) return;
  const { dense } = e.detail || {};
  if (dense && window.innerWidth < 1480 && !isCollapsed()) {
    setCollapsed(true, { persist: false, fromAuto: true });
  }
});

function decorate() {
  if (!enabled()) return;
  syncTabTooltips();
  const view = document.querySelector('main.view');
  if (!view?.querySelector(':scope > .stats') || view.querySelector('.studio-intro')) return;
  originalChildren.set(view, [...view.children]);
  view.classList.add('studio-home');
  const intro = document.createElement('section');
  intro.className = 'studio-intro';
  const date = new Intl.DateTimeFormat(ko ? 'ko-KR' : 'en-US', { month: 'long', day: 'numeric', weekday: 'long' }).format(new Date());
  intro.innerHTML = `<div class="studio-eyebrow">YOUR PERSONAL AI WORKSPACE <span>${date}</span></div>
    <div class="studio-heading"><div><h2>${copy('좋은 흐름을,', 'Keep your ideas.')}<br><em>${copy('계속 이어가요.', 'Keep your flow.')}</em></h2><p>${copy('흩어진 AI 작업을 한곳에. 여기서 다음을 시작하세요.', 'All your AI work, together. Pick up where inspiration left off.')}</p></div>
    <a href="#/new" class="studio-start"><span aria-hidden="true">↗</span>${copy('새로운 작업 시작', 'Start something new')}</a></div>`;
  view.prepend(intro);
  const sections = [...view.querySelectorAll(':scope > .section:not(#home-usage)')];
  const primary = document.createElement('div');
  primary.className = 'studio-primary';
  const secondary = document.createElement('aside');
  secondary.className = 'studio-secondary';
  secondary.setAttribute('aria-label', copy('프로젝트와 사용량', 'Projects and usage'));
  for (const section of sections) {
    if (section.querySelector('.update-banner')) { section.classList.add('studio-update'); view.prepend(section); continue; }
    (section.querySelector('.srow') || section.querySelector('a[href="#/sessions"]') ? primary : secondary).append(section);
  }
  const usage = view.querySelector('#home-usage');
  if (usage) secondary.prepend(usage);
  view.append(primary, secondary);
}
new MutationObserver(decorate).observe(document.querySelector('#app'), { childList: true, subtree: true });
function syncLayout() {
  if (enabled()) {
    nav.prepend(brand, cmdBtn);
    nav.append(runsDock, foot);
    syncTabTooltips();
    try {
      const saved = localStorage.getItem(SIDEBAR_KEY);
      if (saved === 'collapsed') document.documentElement.dataset.sidebar = 'collapsed';
      else delete document.documentElement.dataset.sidebar;
    } catch { /* ignore */ }
    decorate();
  } else {
    brand.remove();
    cmdBtn.remove();
    runsDock.remove();
    foot.remove();
    delete document.documentElement.dataset.sidebar;
    const view = document.querySelector('main.view.studio-home');
    if (!view) return;
    for (const child of originalChildren.get(view) || []) {
      if (view.contains(child)) view.append(child);
    }
    view.querySelectorAll(':scope > .studio-intro, :scope > .studio-primary, :scope > .studio-secondary').forEach(el => el.remove());
    view.querySelector(':scope > .studio-update')?.classList.remove('studio-update');
    view.classList.remove('studio-home');
    originalChildren.delete(view);
  }
}
if (responsive) wide.addEventListener('change', syncLayout);
syncLayout();
