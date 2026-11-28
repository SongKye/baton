// Desktop workspace manager: multi-pane split chats, project context drawer,
// command palette (Cmd/Ctrl+K) and keyboard shortcuts.
// Never activates on mobile viewports (<= 759px) so the mobile PWA shell stays untouched.

const SPLIT_MQ = matchMedia('(min-width: 1024px)');
const ULTRAWIDE_MQ = matchMedia('(min-width: 1680px)');
const DESKTOP_MQ = matchMedia('(min-width: 760px)');
const HAS_STUDIO = Boolean(document.querySelector('link[href*="studio.css"]'));
const IS_MAC = /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent || '');
const MOD_LABEL = IS_MAC ? '⌘' : 'Ctrl+';

export const WS_ICON = {
  split: '<svg class="i" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M12 4v16"/></svg>',
  splitPlus: '<svg class="i" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M12 4v16M15 12h4M17 10v4"/></svg>',
  drawer: '<svg class="i" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M15 4v16"/></svg>',
  maximize: '<svg class="i" viewBox="0 0 24 24"><path d="M15 4h5v5M9 20H4v-5M20 4l-6 6M4 20l6-6"/></svg>',
  restore: '<svg class="i" viewBox="0 0 24 24"><path d="M4 14h6v6M20 10h-6V4M14 10l6-6M10 14l-6 6"/></svg>',
  close: '<svg class="i" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  copy: '<svg class="i" viewBox="0 0 24 24"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
  downArrow: '<svg class="i" viewBox="0 0 24 24"><path d="M12 5v14M6 13l6 6 6-6"/></svg>',
};

export function createDesktopWorkspace(deps) {
  const {
    app, G, TOOL, ICON, glyph, t, esc, ago, projectName, api, toast, sheet, pick, store,
    mountChatPane, mountNewChatPane, mountProjectDrawer, drawRunPill, render, isKeyboardField,
  } = deps;

  const MAX_PANES = () => (ULTRAWIDE_MQ.matches ? 3 : 2);
  const canSplit = () => HAS_STUDIO && SPLIT_MQ.matches;

  let mounted = false;
  let seq = 0;
  let shellEl = null;
  let panesEl = null;
  let drawerEl = null;
  let drawerResizerEl = null;
  let drawerCtrl = null;

  /** @type {Array<{uid:string, kind:'chat'|'new', tool:string, id?:string, cwd?:string, from?:string, attach?:string, label?:string, flex:number, el?:HTMLElement, ctrl?:any}>} */
  let panes = [];
  let activeUid = null;
  let maximizedUid = null;
  let drawer = {
    open: false,
    projectId: null,
    tab: store.get('drawerTab', 'sessions'),
    width: Math.max(300, Math.min(560, Number(store.get('drawerW', 380)) || 380)),
  };

  // Remember the last session spec so "Split Open" from a list page can pair smoothly
  let lastSessionSpec = null;

  const specKey = (s) => (s?.kind === 'chat' && s.tool && s.id ? `${s.tool}:${s.id}` : null);
  const activePane = () => panes.find((p) => p.uid === activeUid) || panes[0] || null;
  const openSessionKeys = () => new Set(panes.map(specKey).filter(Boolean));

  function persistState() {
    try {
      const saved = panes
        .filter((p) => p.kind === 'chat' && p.tool && p.id)
        .map((p) => ({ kind: 'chat', tool: p.tool, id: p.id, flex: p.flex }));
      sessionStorage.setItem('baton:wsPanes', JSON.stringify(saved));
    } catch { /* ignore */ }
  }

  function notifyDensity() {
    const dense = mounted && (panes.length >= 2 || drawer.open);
    window.dispatchEvent(new CustomEvent('baton:workspace-density', { detail: { dense, count: panes.length, drawerOpen: drawer.open } }));
  }

  function ensureShell() {
    if (mounted && shellEl?.isConnected) return;
    mounted = true;
    app.innerHTML = `<div class="ws-shell">
      <div class="ws-stage">
        <div class="ws-panes" data-ws-panes></div>
        <div class="ws-resizer ctx-drawer-resizer" data-drawer-resizer title="${t('드래그해서 너비 조절')}"></div>
        <aside class="ctx-drawer" data-ctx-drawer aria-label="${t('프로젝트 컨텍스트')}"></aside>
      </div>
    </div>`;
    shellEl = app.querySelector('.ws-shell');
    panesEl = app.querySelector('[data-ws-panes]');
    drawerEl = app.querySelector('[data-ctx-drawer]');
    drawerResizerEl = app.querySelector('[data-drawer-resizer]');
    drawerEl.style.setProperty('--drawer-w', `${drawer.width}px`);
    wireDrawerResizer();
  }

  function wireDrawerResizer() {
    if (!drawerResizerEl) return;
    drawerResizerEl.addEventListener('pointerdown', (e) => {
      if (!drawer.open) return;
      e.preventDefault();
      const x0 = e.clientX;
      const w0 = drawerEl.getBoundingClientRect().width || drawer.width;
      drawerResizerEl.classList.add('dragging');
      document.body.setAttribute('data-resizing', '1');
      const onMove = (ev) => {
        const next = Math.max(300, Math.min(Math.min(580, window.innerWidth * 0.45), Math.round(w0 + (x0 - ev.clientX))));
        drawer.width = next;
        drawerEl.style.setProperty('--drawer-w', `${next}px`);
      };
      const onUp = () => {
        drawerResizerEl.classList.remove('dragging');
        document.body.removeAttribute('data-resizing');
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        store.set('drawerW', drawer.width);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    });
    drawerResizerEl.addEventListener('dblclick', () => {
      drawer.width = 380;
      drawerEl.style.setProperty('--drawer-w', '380px');
      store.set('drawerW', 380);
    });
  }

  function wirePaneResizer(handle, leftPane, rightPane) {
    handle.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const x0 = e.clientX;
      const l0 = leftPane.el.getBoundingClientRect().width;
      const r0 = rightPane.el.getBoundingClientRect().width;
      const sum = l0 + r0;
      if (sum <= 0) return;
      const flexSum = (leftPane.flex || 1) + (rightPane.flex || 1);
      handle.classList.add('dragging');
      document.body.setAttribute('data-resizing', '1');
      const onMove = (ev) => {
        const dx = ev.clientX - x0;
        const minW = 320;
        const lW = Math.max(minW, Math.min(sum - minW, l0 + dx));
        const rW = sum - lW;
        leftPane.flex = (lW / sum) * flexSum;
        rightPane.flex = (rW / sum) * flexSum;
        leftPane.el.style.flexGrow = String(leftPane.flex);
        rightPane.el.style.flexGrow = String(rightPane.flex);
      };
      const onUp = () => {
        handle.classList.remove('dragging');
        document.body.removeAttribute('data-resizing');
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        persistState();
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    });
    handle.addEventListener('dblclick', () => {
      for (const p of panes) {
        p.flex = 1;
        if (p.el) p.el.style.flexGrow = '1';
      }
      persistState();
    });
  }

  function syncChrome() {
    if (!mounted || !panesEl) return;
    const isSplit = panes.length > 1 && !maximizedUid;
    panesEl.classList.toggle('is-split', isSplit);
    // Rebuild resizers between visible panes without destroying mounted pane DOMs!
    panesEl.querySelectorAll(':scope > .ws-resizer').forEach((r) => r.remove());
    const visible = [];
    for (const p of panes) {
      const hidden = Boolean(maximizedUid && maximizedUid !== p.uid);
      p.el.classList.toggle('is-hidden', hidden);
      p.el.classList.toggle('is-focused', p.uid === activeUid);
      p.el.style.flexGrow = hidden ? '0' : String(p.flex || 1);
      if (!hidden) visible.push(p);
      p.ctrl?.updateWorkspaceMeta?.({
        splitMode: panes.length > 1,
        maximized: maximizedUid === p.uid,
        canAddSplit: canSplit() && panes.length < MAX_PANES(),
        drawerOpen: drawer.open,
      });
    }
    for (let i = 0; i < visible.length - 1; i++) {
      const h = document.createElement('div');
      h.className = 'ws-resizer';
      h.title = t('드래그해서 너비 조절 · 더블클릭하면 균등 분할');
      visible[i].el.after(h);
      wirePaneResizer(h, visible[i], visible[i + 1]);
    }
    drawerEl.classList.toggle('open', drawer.open);
    drawerResizerEl.classList.toggle('show', drawer.open);
    drawerCtrl?.syncOpenKeys?.(openSessionKeys());
    drawRunPill();
    persistState();
    notifyDensity();
  }

  function focusPane(uid, { focusInput = false } = {}) {
    const p = panes.find((x) => x.uid === uid);
    if (!p) return;
    activeUid = uid;
    if (maximizedUid && maximizedUid !== uid) maximizedUid = uid;
    // Sync URL hash with focused chat pane silently so refresh/notifications stay aligned
    if (p.kind === 'chat' && p.tool && p.id) {
      const h = `#/s/${p.tool}/${encodeURIComponent(p.id)}`;
      if (location.hash !== h) {
        G.skipHash = h;
        history.replaceState(history.state, '', h);
      }
      lastSessionSpec = { kind: 'chat', tool: p.tool, id: p.id };
    }
    // If project drawer is open, follow the focused pane's project automatically
    const proj = p.ctrl?.getProjectId?.();
    if (drawer.open && proj && proj !== drawer.projectId) {
      openProjectDrawer(proj, { tab: drawer.tab });
    }
    syncChrome();
    if (focusInput) p.ctrl?.focusInput?.();
  }

  function closePane(uid) {
    const idx = panes.findIndex((x) => x.uid === uid);
    if (idx < 0) return;
    const [removed] = panes.splice(idx, 1);
    const fallbackProject = removed.ctrl?.getProjectId?.();
    try { removed.ctrl?.destroy?.(); } catch { /* ignore */ }
    removed.el?.remove();
    if (maximizedUid === uid) maximizedUid = null;
    if (!panes.length) {
      destroy();
      location.hash = fallbackProject ? `#/p/${encodeURIComponent(fallbackProject)}` : '#/sessions';
      return;
    }
    const next = panes[Math.min(idx, panes.length - 1)];
    focusPane(next.uid);
  }

  function toggleMaximize(uid) {
    if (panes.length <= 1) return;
    maximizedUid = maximizedUid === uid ? null : uid;
    activeUid = uid;
    syncChrome();
  }

  async function pickAndAddSplit(fromPane) {
    if (!canSplit()) return;
    if (panes.length >= MAX_PANES()) {
      toast(t('최대 {n}개 창까지 동시에 열 수 있어요', { n: MAX_PANES() }));
      return;
    }
    const curSession = fromPane?.ctrl?.getSession?.();
    const openKeys = openSessionKeys();
    const opts = [
      { value: { kind: 'new', cwd: curSession?.cwd || curSession?.project || '' }, icon: glyph('plus'), label: t('새 세션 옆에 열기'), desc: curSession?.project ? projectName(curSession.project) : t('새 대화를 바로 옆 창에서 시작해요') },
    ];
    for (const r of (G.runs || [])) {
      if (!r.sessionId) continue;
      const k = `${r.tool}:${r.sessionId}`;
      if (openKeys.has(k)) continue;
      opts.push({
        value: { kind: 'chat', tool: r.tool, id: r.sessionId },
        icon: '<i class="live-dot busy"></i>',
        label: r.title || r.prompt || t('응답 중'),
        desc: `${TOOL[r.tool]?.name || r.tool} · ${t('지금 응답 중')}`,
      });
    }
    try {
      const d = await api('/api/sessions?limit=14');
      for (const s of (d.items || [])) {
        if (openKeys.has(`${s.tool}:${s.id}`) || opts.some((o) => o.value?.tool === s.tool && o.value?.id === s.id)) continue;
        opts.push({
          value: { kind: 'chat', tool: s.tool, id: s.id },
          icon: `<span class="tool-badge ${s.tool}">${TOOL[s.tool]?.short || '?'}</span>`,
          label: s.title,
          desc: `${TOOL[s.tool]?.name || s.tool}${s.project ? ` · ${projectName(s.project)}` : ''} · ${ago(s.updated)}`,
        });
      }
    } catch { /* fallback to new + live */ }
    const chosen = await pick(t('옆 창에 열 세션'), opts);
    if (!chosen) return;
    addPane(chosen);
  }

  function mountPaneRecord(pane) {
    const el = document.createElement('div');
    el.className = 'ws-pane';
    el.dataset.paneUid = pane.uid;
    el.addEventListener('pointerdown', () => {
      if (activeUid !== pane.uid) focusPane(pane.uid);
    });
    panesEl.append(el);
    pane.el = el;

    const callbacks = {
      isPrimary: panes.length === 1,
      splitMode: panes.length > 1,
      maximized: maximizedUid === pane.uid,
      canAddSplit: canSplit() && panes.length < MAX_PANES(),
      drawerOpen: drawer.open,
      onSplitAdd: () => pickAndAddSplit(pane),
      onClosePane: () => closePane(pane.uid),
      onMaximize: () => toggleMaximize(pane.uid),
      onToggleProject: (pid) => toggleProjectDrawer(pid),
      onProjectLoaded: (pid) => {
        if (drawer.open && activeUid === pane.uid && pid && pid !== drawer.projectId) {
          openProjectDrawer(pid, { tab: drawer.tab });
        }
      },
      onSessionCreated: (tool, sid) => {
        pane.kind = 'chat';
        pane.tool = tool;
        pane.id = sid;
        if (activeUid === pane.uid) {
          const h = `#/s/${tool}/${encodeURIComponent(sid)}`;
          G.skipHash = h;
          history.replaceState(history.state, '', h);
        }
        persistState();
      },
      onPromotedToChat: (tool, sid) => {
        // After a new chat pane finishes its first turn, replace in-place with a full chat pane
        pane.kind = 'chat';
        pane.tool = tool;
        pane.id = sid;
        try { pane.ctrl?.destroy?.(); } catch { /* ignore */ }
        el.innerHTML = '';
        pane.ctrl = mountChatPane(el, { tool, id: sid, ...callbacks });
        syncChrome();
      },
    };

    if (pane.kind === 'new') {
      pane.ctrl = mountNewChatPane(el, {
        tool: pane.tool, cwd: pane.cwd, from: pane.from, attach: pane.attach, label: pane.label,
        ...callbacks,
      });
    } else {
      pane.ctrl = mountChatPane(el, { tool: pane.tool, id: pane.id, ...callbacks });
      lastSessionSpec = { kind: 'chat', tool: pane.tool, id: pane.id };
    }
  }

  function addPane(spec, { focus = true } = {}) {
    ensureShell();
    const k = specKey(spec);
    if (k) {
      const existing = panes.find((p) => specKey(p) === k);
      if (existing) {
        maximizedUid = null;
        focusPane(existing.uid, { focusInput: focus });
        return existing;
      }
    }
    if (panes.length >= MAX_PANES()) {
      // Replace the least-recently focused non-active pane, or warn
      toast(t('최대 {n}개 창까지 동시에 열 수 있어요', { n: MAX_PANES() }));
      return null;
    }
    maximizedUid = null;
    const pane = { uid: `p${++seq}`, flex: 1, ...spec };
    panes.push(pane);
    mountPaneRecord(pane);
    focusPane(pane.uid, { focusInput: focus });
    return pane;
  }

  function replacePane(pane, spec) {
    try { pane.ctrl?.destroy?.(); } catch { /* ignore */ }
    pane.el.innerHTML = '';
    Object.assign(pane, { kind: spec.kind, tool: spec.tool, id: spec.id, cwd: spec.cwd, from: spec.from, attach: spec.attach, label: spec.label });
    const callbacks = {
      isPrimary: panes[0]?.uid === pane.uid,
      splitMode: panes.length > 1,
      maximized: maximizedUid === pane.uid,
      canAddSplit: canSplit() && panes.length < MAX_PANES(),
      drawerOpen: drawer.open,
      onSplitAdd: () => pickAndAddSplit(pane),
      onClosePane: () => closePane(pane.uid),
      onMaximize: () => toggleMaximize(pane.uid),
      onToggleProject: (pid) => toggleProjectDrawer(pid),
      onProjectLoaded: (pid) => {
        if (drawer.open && activeUid === pane.uid && pid && pid !== drawer.projectId) {
          openProjectDrawer(pid, { tab: drawer.tab });
        }
      },
      onSessionCreated: (tool, sid) => {
        pane.kind = 'chat'; pane.tool = tool; pane.id = sid;
        if (activeUid === pane.uid) { const h = `#/s/${tool}/${encodeURIComponent(sid)}`; G.skipHash = h; history.replaceState(history.state, '', h); }
        persistState();
      },
      onPromotedToChat: (tool, sid) => replacePane(pane, { kind: 'chat', tool, id: sid }),
    };
    pane.ctrl = pane.kind === 'new'
      ? mountNewChatPane(pane.el, { tool: pane.tool, cwd: pane.cwd, from: pane.from, attach: pane.attach, label: pane.label, ...callbacks })
      : mountChatPane(pane.el, { tool: pane.tool, id: pane.id, ...callbacks });
    focusPane(pane.uid);
  }

  function openProjectDrawer(projectId, { tab } = {}) {
    if (!mounted || !drawerEl || !projectId) return;
    drawer.open = true;
    drawer.projectId = projectId;
    if (tab) { drawer.tab = tab; store.set('drawerTab', tab); }
    try { drawerCtrl?.destroy?.(); } catch { /* ignore */ }
    drawerCtrl = mountProjectDrawer(drawerEl, projectId, {
      tab: drawer.tab,
      openKeys: openSessionKeys(),
      onTabChange: (nextTab) => { drawer.tab = nextTab; store.set('drawerTab', nextTab); },
      onClose: () => closeProjectDrawer(),
      onOpenSession: (tool, id) => {
        const existing = panes.find((p) => p.kind === 'chat' && p.tool === tool && p.id === id);
        if (existing) { focusPane(existing.uid, { focusInput: true }); return; }
        const cur = activePane();
        if (cur) replacePane(cur, { kind: 'chat', tool, id });
        else addPane({ kind: 'chat', tool, id });
      },
      onSplitSession: (tool, id) => {
        if (panes.length < MAX_PANES()) addPane({ kind: 'chat', tool, id });
        else toast(t('최대 {n}개 창까지 동시에 열 수 있어요', { n: MAX_PANES() }));
      },
      onNewSession: (cwd) => {
        if (panes.length < MAX_PANES()) addPane({ kind: 'new', cwd });
        else { const cur = activePane(); if (cur) replacePane(cur, { kind: 'new', cwd }); }
      },
    });
    syncChrome();
  }

  function closeProjectDrawer() {
    drawer.open = false;
    try { drawerCtrl?.destroy?.(); } catch { /* ignore */ }
    drawerCtrl = null;
    syncChrome();
  }

  function toggleProjectDrawer(projectId) {
    const pid = projectId || activePane()?.ctrl?.getProjectId?.();
    if (!pid) { toast(t('이 세션에 연결된 프로젝트가 없어요')); return; }
    if (drawer.open && drawer.projectId === pid) closeProjectDrawer();
    else openProjectDrawer(pid);
  }

  /**
   * Entry point from router (`viewChat` / `viewNew`) on desktop (`>= 1024px`).
   * Keeps existing split panes alive if the user navigates between chats inside workspace!
   */
  function openFromRoute(spec, { openProjectId = null } = {}) {
    if (!mounted) {
      ensureShell();
      panes = [];
      activeUid = null;
      maximizedUid = null;
      addPane(spec, { focus: true });
    } else {
      const k = specKey(spec);
      const existing = k ? panes.find((p) => specKey(p) === k) : null;
      if (existing) {
        focusPane(existing.uid);
      } else {
        const cur = activePane();
        if (cur) replacePane(cur, spec);
        else addPane(spec);
      }
    }
    if (openProjectId) openProjectDrawer(openProjectId, { tab: 'sessions' });
  }

  /**
   * Open a session side-by-side from anywhere (session row split button, sidebar live run,
   * project page "프로젝트 + 채팅 함께 보기", or Cmd+K Shift+Enter).
   */
  function openSplitFromAnywhere(spec, { withProjectId = null } = {}) {
    if (!canSplit()) {
      if (spec.kind === 'chat') location.hash = `#/s/${spec.tool}/${encodeURIComponent(spec.id)}`;
      else location.hash = `#/new${spec.cwd ? `?cwd=${encodeURIComponent(spec.cwd)}` : ''}`;
      return;
    }
    if (mounted) {
      addPane(spec, { focus: true });
      if (withProjectId) openProjectDrawer(withProjectId);
      return;
    }
    // Coming from a non-chat view: transition smoothly into chat-mode workspace
    const currentProjectMatch = (location.hash || '').match(/^#\/p\/(.+?)(?:\?|$)/);
    const projectToOpen = withProjectId || (currentProjectMatch ? decodeURIComponent(currentProjectMatch[1]) : null);
    if (G.cleanup) { try { G.cleanup(); } catch { /* ignore */ } G.cleanup = null; }
    document.body.classList.add('chat-mode');
    document.querySelectorAll('#tabbar a').forEach((a) => a.classList.toggle('on', a.dataset.tab === 'sessions'));
    ensureShell();
    panes = [];
    activeUid = null;
    maximizedUid = null;
    // If coming from a non-project list and we had a recent session, open both side-by-side!
    if (!projectToOpen && lastSessionSpec && specKey(lastSessionSpec) && specKey(lastSessionSpec) !== specKey(spec)) {
      addPane(lastSessionSpec, { focus: false });
    }
    addPane(spec, { focus: true });
    if (projectToOpen) openProjectDrawer(projectToOpen, { tab: 'sessions' });
    G.cleanup = () => destroy();
  }

  function destroy() {
    if (!mounted) return;
    for (const p of panes) {
      try { p.ctrl?.destroy?.(); } catch { /* ignore */ }
    }
    panes = [];
    activeUid = null;
    maximizedUid = null;
    try { drawerCtrl?.destroy?.(); } catch { /* ignore */ }
    drawerCtrl = null;
    drawer.open = false;
    mounted = false;
    shellEl = null;
    panesEl = null;
    drawerEl = null;
    drawerResizerEl = null;
    notifyDensity();
  }

  // ---------------------------------------------------------------- Command Palette (Cmd/Ctrl + K)
  let cmdkEl = null;
  let cmdkCache = { at: 0, projects: [], sessions: [] };

  function closeCommandPalette() {
    if (!cmdkEl) return;
    const el = cmdkEl;
    cmdkEl = null;
    el.classList.remove('show');
    setTimeout(() => el.remove(), 180);
  }

  async function openCommandPalette() {
    if (!HAS_STUDIO || !DESKTOP_MQ.matches) return;
    if (cmdkEl) { closeCommandPalette(); return; }
    const scrim = document.createElement('div');
    scrim.className = 'cmdk-scrim';
    scrim.innerHTML = `<div class="cmdk" role="dialog" aria-modal="true" aria-label="${t('빠른 검색')}">
      <div class="cmdk-head">${ICON.search}<input type="text" placeholder="${t('세션, 프로젝트, 명령 검색…')}" autocomplete="off"><span class="cmdk-kbd">Esc</span></div>
      <div class="cmdk-list"></div>
      <div class="cmdk-foot">
        <span><kbd class="cmdk-kbd">↵</kbd> ${t('열기')}</span>
        <span><kbd class="cmdk-kbd">Shift+↵</kbd> ${t('옆 창에 분할 열기')}</span>
        <span><kbd class="cmdk-kbd">↑↓</kbd> ${t('이동')}</span>
      </div>
    </div>`;
    document.body.append(scrim);
    cmdkEl = scrim;
    requestAnimationFrame(() => scrim.classList.add('show'));

    const inp = scrim.querySelector('input');
    const listEl = scrim.querySelector('.cmdk-list');
    let sel = 0;
    let items = [];

    const actions = [
      { group: t('빠른 명령'), kind: 'action', icon: glyph('plus'), title: t('새 세션 시작'), sub: t('도구와 폴더를 골라 새 대화 시작'), run: (split) => split ? openSplitFromAnywhere({ kind: 'new' }) : (location.hash = '#/new') },
      { group: t('빠른 명령'), kind: 'action', icon: WS_ICON.drawer, title: t('사이드바 접기 / 펼치기'), sub: `${MOD_LABEL}\\`, run: () => window.dispatchEvent(new CustomEvent('baton:toggle-sidebar')) },
      ...(mounted ? [
        { group: t('빠른 명령'), kind: 'action', icon: WS_ICON.splitPlus, title: t('옆 창에 세션 분할 추가'), sub: t('현재 대화 옆에 새 창 열기'), run: () => pickAndAddSplit(activePane()) },
        { group: t('빠른 명령'), kind: 'action', icon: glyph('folder'), title: t('프로젝트 컨텍스트 패널 토글'), sub: `${MOD_LABEL}.`, run: () => toggleProjectDrawer() },
      ] : []),
      { group: t('빠른 명령'), kind: 'action', icon: glyph('spark'), title: t('라이트 / 다크 모드 전환'), sub: t('화면 밝기 바로 바꾸기'), run: () => { const cur = window.BatonTheme?.get?.(); const isDark = cur === 'dark' || (cur === 'system' && matchMedia('(prefers-color-scheme: dark)').matches); window.BatonTheme?.set?.(isDark ? 'light' : 'dark'); } },
      { group: t('이동'), kind: 'nav', icon: glyph('building'), title: t('홈'), sub: '#/', run: () => { location.hash = '#/'; } },
      { group: t('이동'), kind: 'nav', icon: glyph('folder'), title: t('프로젝트'), sub: '#/projects', run: () => { location.hash = '#/projects'; } },
      { group: t('이동'), kind: 'nav', icon: glyph('thought'), title: t('세션'), sub: '#/sessions', run: () => { location.hash = '#/sessions'; } },
      { group: t('이동'), kind: 'nav', icon: glyph('wrench'), title: t('도구'), sub: '#/tools', run: () => { location.hash = '#/tools'; } },
      { group: t('이동'), kind: 'nav', icon: glyph('key'), title: t('설정'), sub: '#/settings', run: () => { location.hash = '#/settings'; } },
    ];

    const buildItems = (q) => {
      const needle = q.trim().toLowerCase();
      const match = (str) => !needle || String(str || '').toLowerCase().includes(needle);
      const out = [];
      for (const r of (G.runs || [])) {
        if (!r.sessionId) continue;
        const ttl = r.title || r.prompt || t('응답 중');
        if (!match(`${ttl} ${r.tool}`)) continue;
        out.push({
          group: t('지금 응답 중'),
          kind: 'session',
          icon: '<i class="live-dot busy"></i>',
          title: ttl,
          sub: `${TOOL[r.tool]?.name || r.tool} · ${t('응답 중')}`,
          run: (split) => split
            ? openSplitFromAnywhere({ kind: 'chat', tool: r.tool, id: r.sessionId })
            : (location.hash = `#/s/${r.tool}/${encodeURIComponent(r.sessionId)}`),
        });
      }
      for (const s of cmdkCache.sessions) {
        if (!match(`${s.title} ${s.project || ''} ${s.tool}`)) continue;
        out.push({
          group: t('최근 세션'),
          kind: 'session',
          icon: `<span class="tool-badge ${s.tool}">${TOOL[s.tool]?.short || '?'}</span>`,
          title: s.title,
          sub: `${TOOL[s.tool]?.name || s.tool}${s.project ? ` · ${projectName(s.project)}` : ''} · ${ago(s.updated)}`,
          run: (split) => split
            ? openSplitFromAnywhere({ kind: 'chat', tool: s.tool, id: s.id })
            : (location.hash = `#/s/${s.tool}/${encodeURIComponent(s.id)}`),
        });
        if (out.filter((x) => x.kind === 'session').length >= (needle ? 14 : 6)) break;
      }
      for (const p of cmdkCache.projects) {
        if (!needle && p.archived) continue;
        if (!match(`${p.name} ${p.path || ''}`)) continue;
        out.push({
          group: t('프로젝트'),
          kind: 'project',
          icon: glyph('folder'),
          title: p.name,
          sub: p.path || '',
          run: () => { location.hash = `#/p/${encodeURIComponent(p.id)}`; },
        });
        if (out.filter((x) => x.kind === 'project').length >= (needle ? 10 : 5)) break;
      }
      for (const a of actions) {
        if (match(`${a.title} ${a.sub}`)) out.push(a);
      }
      return out;
    };

    const draw = () => {
      items = buildItems(inp.value);
      sel = Math.min(sel, Math.max(0, items.length - 1));
      if (!items.length) {
        listEl.innerHTML = `<div class="empty">${t('검색 결과가 없어요')}</div>`;
        return;
      }
      let lastGroup = '';
      listEl.innerHTML = items.map((it, i) => {
        const hdr = it.group !== lastGroup ? `<div class="cmdk-group">${esc(it.group)}</div>` : '';
        lastGroup = it.group;
        return `${hdr}<button type="button" class="cmdk-item${i === sel ? ' on' : ''}" data-ci="${i}">
          <span class="ci-ic">${it.icon}</span>
          <span class="ci-b"><div class="ci-t">${esc(it.title)}</div>${it.sub ? `<div class="ci-s">${esc(it.sub)}</div>` : ''}</span>
          ${it.kind === 'session' ? `<span class="cmdk-kbd" title="${t('Shift+Enter로 옆 창 열기')}">${t('분할')}</span>` : ''}
        </button>`;
      }).join('');
      listEl.querySelectorAll('[data-ci]').forEach((b) => {
        b.onclick = (ev) => {
          const it = items[+b.dataset.ci];
          closeCommandPalette();
          it?.run(ev.shiftKey || ev.metaKey || ev.ctrlKey);
        };
      });
      listEl.querySelector('.on')?.scrollIntoView({ block: 'nearest' });
    };

    inp.oninput = () => { sel = 0; draw(); };
    inp.onkeydown = (e) => {
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key === 'Escape') { e.preventDefault(); closeCommandPalette(); return; }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (!items.length) return;
        sel = (sel + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length;
        listEl.querySelectorAll('[data-ci]').forEach((el, i) => el.classList.toggle('on', i === sel));
        listEl.querySelector('.on')?.scrollIntoView({ block: 'nearest' });
        return;
      }
      if (e.key === 'Enter' && items[sel]) {
        e.preventDefault();
        const it = items[sel];
        closeCommandPalette();
        it.run(e.shiftKey);
      }
    };
    scrim.onclick = (e) => { if (e.target === scrim) closeCommandPalette(); };

    draw();
    setTimeout(() => inp.focus(), 20);

    // Refresh cache in background if older than 15s
    if (Date.now() - cmdkCache.at > 15000) {
      Promise.all([
        api('/api/projects').catch(() => ({ items: [] })),
        api('/api/sessions?limit=40').catch(() => ({ items: [] })),
      ]).then(([p, s]) => {
        cmdkCache = { at: Date.now(), projects: p.items || [], sessions: s.items || [] };
        if (cmdkEl === scrim) draw();
      });
    }
  }

  function showShortcutsSheet() {
    const rows = [
      [`${MOD_LABEL}K`, t('빠른 검색 (커맨드 팔레트)')],
      [`${MOD_LABEL}\\`, t('좌측 사이드바 접기 / 펼치기')],
      [`${MOD_LABEL}.`, t('채팅 중 프로젝트 컨텍스트 패널 열기 / 닫기')],
      ['Alt + 1 / 2 / 3', t('분할된 채팅 창 간 포커스 이동')],
      [`${MOD_LABEL}Click`, t('세션을 옆 창에 바로 분할 열기')],
      ['?', t('키보드 단축키 보기')],
    ];
    sheet({
      title: t('키보드 단축키'),
      body: `<div class="card list">${rows.map(([k, label]) => `<div class="setting"><div class="l"><b>${esc(label)}</b></div><kbd class="cmdk-kbd">${esc(k)}</kbd></div>`).join('')}</div>`,
    });
  }

  // Global keyboard shortcuts (desktop only)
  document.addEventListener('keydown', (e) => {
    if (!HAS_STUDIO || !DESKTOP_MQ.matches || e.isComposing || e.keyCode === 229) return;
    const mod = IS_MAC ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
    if (mod && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      openCommandPalette();
      return;
    }
    if (mod && e.key === '\\') {
      e.preventDefault();
      window.dispatchEvent(new CustomEvent('baton:toggle-sidebar'));
      return;
    }
    if (mod && e.key === '.') {
      if (mounted) {
        e.preventDefault();
        toggleProjectDrawer();
      }
      return;
    }
    if (e.altKey && !e.metaKey && !e.ctrlKey && ['1', '2', '3'].includes(e.key) && mounted) {
      const idx = Number(e.key) - 1;
      if (panes[idx]) {
        e.preventDefault();
        focusPane(panes[idx].uid, { focusInput: true });
      }
      return;
    }
    if (e.key === '?' && !e.metaKey && !e.ctrlKey && !e.altKey && !isKeyboardField(document.activeElement) && !cmdkEl) {
      e.preventDefault();
      showShortcutsSheet();
    }
  });

  // Listen to sidebar events
  window.addEventListener('baton:cmdk', openCommandPalette);
  window.addEventListener('baton:shortcuts', showShortcutsSheet);
  window.addEventListener('baton:split-open', (e) => {
    const { tool, id, cwd, projectId } = e.detail || {};
    if (tool && id) openSplitFromAnywhere({ kind: 'chat', tool, id }, { withProjectId: projectId });
    else openSplitFromAnywhere({ kind: 'new', cwd }, { withProjectId: projectId });
  });

  // If window shrinks below split breakpoint while multi-pane is active, fall back cleanly to active pane
  SPLIT_MQ.addEventListener?.('change', () => {
    if (!mounted || SPLIT_MQ.matches) return;
    const cur = activePane();
    destroy();
    if (cur?.kind === 'chat' && cur.tool && cur.id) location.hash = `#/s/${cur.tool}/${encodeURIComponent(cur.id)}`;
    else render();
  });

  return {
    canSplit,
    isMounted: () => mounted,
    openSessionKeys,
    openFromRoute,
    openSplitFromAnywhere,
    openProjectDrawer,
    toggleProjectDrawer,
    openCommandPalette,
    destroy,
  };
}
