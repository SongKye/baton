// Blocking head script: restore appearance before the first paint.
(() => {
  const key = 'baton.theme';
  const paletteKey = 'baton.palette';
  // Baton adaptations: each mood has a light and a dark companion.
  const palettes = {
    forest: { name: 'Forest', light: ['#f6f5f0','#fffefa','#eeeee6','#243b32','#5c6b62','#64776a','#38674f','#ffffff','#203c30'], dark: ['#151e19','#1d2922','#26352b','#e5eadb','#b8c5b8','#93a894','#bdd590','#203728','#11281d'] },
    nord: { name: 'Nord', light: ['#edf1f5','#f9fbfd','#e1e8f0','#2e3440','#4c566a','#5d6c80','#356b83','#ffffff','#2e3b50'], dark: ['#242b38','#2e3747','#394456','#eceff4','#c4cedc','#a0b1c7','#88c0d0','#1c3540','#1d2533'] },
    dracula: { name: 'Dracula', light: ['#f5f1fa','#fffbff','#eae2f3','#352b48','#655674','#796589','#7950ad','#ffffff','#342742'], dark: ['#282a36','#303240','#3c3e50','#f8f8f2','#d7cde6','#b4a7c7','#bd93f9','#282038','#201e2c'] },
    tokyo: { name: 'Tokyo Night', light: ['#edf0fa','#fafbff','#e0e5f4','#293556','#536385','#627298','#365cc4','#ffffff','#202c4a'], dark: ['#1a1b26','#222436','#2b3048','#d9e0ff','#b0bee8','#94a4cc','#82aaff','#17233c','#131524'] },
    monokai: { name: 'Monokai', light: ['#f7f5ec','#fffef7','#eae7d7','#383b2c','#626650','#72765c','#59751e','#ffffff','#333728'], dark: ['#272822','#30322a','#3d4035','#f8f8f2','#d0d4bd','#adb498','#a6e22e','#28320e','#1e2119'] },
    rose: { name: 'Rosé Pine', light: ['#faf4ed','#fffaf3','#f2e9e1','#575279','#6d6787','#79718e','#a33e60','#ffffff','#493347'], dark: ['#191724','#211f30','#2d2940','#e0def4','#c5bfd9','#a69dbd','#ebbcba','#392333','#16131f'] },
  };
  const tokens = ['bg','surface','surface-2','text','text-2','text-3','accent','accent-ink','palette-sidebar'];
  const extraTokens = ['surface-3','border','accent-soft','code-bg','user-bubble','user-ink','ok','warn','danger','claude','codex','agy','opencode','cursor','shadow'];
  const validPalette = value => value === 'default' || Object.hasOwn(palettes, value);
  let palette = 'default';
  const valid = value => ['system', 'light', 'dark'].includes(value);
  const system = matchMedia('(prefers-color-scheme: dark)');
  let preference = 'system';
  try {
    const saved = localStorage.getItem(key);
    if (valid(saved)) preference = saved;
    const savedPalette = localStorage.getItem(paletteKey);
    if (validPalette(savedPalette)) palette = savedPalette;
  } catch { /* Storage may be unavailable; retain the choice for this page. */ }
  function apply() {
    const dark = preference === 'dark' || (preference === 'system' && system.matches);
    if (preference === 'system') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = preference;
    const root = document.documentElement;
    root.dataset.palette = palette;
    const colors = palettes[palette]?.[dark ? 'dark' : 'light'];
    if (colors) {
      tokens.forEach((token, i) => root.style.setProperty(`--${token}`, colors[i]));
      const extras = {
        'surface-3': 'color-mix(in srgb, var(--surface-2), var(--text) 12%)',
        border: 'color-mix(in srgb, var(--text) 14%, transparent)',
        'accent-soft': 'color-mix(in srgb, var(--accent) 13%, transparent)',
        'code-bg': 'var(--bg)', 'user-bubble': 'var(--surface-2)', 'user-ink': 'var(--text)',
        ok: dark ? '#8ed5a3' : '#267445', warn: dark ? '#f0cc80' : '#88600e',
        danger: dark ? '#f598a5' : '#b3374d',
        claude: dark ? '#efa990' : '#a34f30', codex: dark ? '#8ed5b6' : '#28715d',
        agy: dark ? '#9abaff' : '#3a5fa9', opencode: dark ? '#ccacf1' : '#8055a5',
        cursor: 'var(--text-2)', shadow: 'none',
      };
      Object.entries(extras).forEach(([token, value]) => root.style.setProperty(`--${token}`, value));
    } else {
      [...tokens, ...extraTokens].forEach(token => root.style.removeProperty(`--${token}`));
    }
    document.querySelectorAll('meta[name="theme-color"]').forEach(meta => {
      meta.content = colors?.[0] || (dark ? '#111110' : '#f5f4f0');
    });
    document.querySelectorAll('[name="palette"]').forEach(input => {
      input.checked = input.value === palette;
    });
    document.querySelectorAll('[data-palette-preview]').forEach(preview => {
      const swatch = palettes[preview.dataset.palettePreview]?.[dark ? 'dark' : 'light'];
      if (swatch) ['bg','surface','line','ink','muted','faint','accent','accent-ink','side'].forEach((token, i) => preview.style.setProperty(`--swatch-${token}`, swatch[i]));
    });
    document.querySelectorAll('[name="appearance"]').forEach(input => {
      input.checked = input.value === preference;
    });
    const paletteLabel = document.querySelector('[name="palette"]:checked')?.closest('label')?.querySelector('.palette-name')?.childNodes[0]?.textContent;
    const modeLabel = document.querySelector('[name="appearance"]:checked')?.closest('label')?.querySelector('.appearance-label')?.textContent;
    document.querySelectorAll('[data-theme-summary]').forEach(summary => {
      if (paletteLabel && modeLabel) summary.textContent = `${paletteLabel.trim()} · ${modeLabel}`;
    });
  }
  window.BatonTheme = {
    get: () => preference,
    palette: () => palette,
    palettes,
    refresh: apply,
    setPalette(value) {
      if (!validPalette(value)) return;
      palette = value;
      try { localStorage.setItem(paletteKey, value); } catch { /* Apply for this page. */ }
      apply();
    },
    set(value) {
      if (!valid(value)) return;
      preference = value;
      try { localStorage.setItem(key, value); } catch { /* Apply without persistence. */ }
      apply();
    },
  };
  system.addEventListener('change', apply);
  window.addEventListener('storage', event => {
    if (![key, paletteKey, null].includes(event.key)) return;
    if (event.key === key || event.key === null) preference = valid(event.newValue) ? event.newValue : 'system';
    if (event.key === paletteKey || event.key === null) palette = validPalette(event.newValue) ? event.newValue : 'default';
    apply();
  });
  apply();
})();
