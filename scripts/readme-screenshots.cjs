// Capture the real UI with fictional data; no Baton server, CLI or user data is read.
// node scripts/readme-screenshots.cjs [path-to-playwright-core]
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.argv[2] || 'playwright-core');
const root = path.resolve(__dirname, '..');
const out = path.join(root, 'docs/images');
const en = JSON.parse(fs.readFileSync(path.join(root, 'public/locales/en.json'), 'utf8'));
const now = Date.parse('2026-11-09T01:30:00Z');
const origin = 'http://baton-demo.local';

function fixtures(lang) {
  const copy = (ko, en) => lang === 'ko' ? ko : en;
  const sessions = [
    ['codex', 'checkout', copy('결제 흐름, 마지막 점검', 'Checkout flow, final checks'), copy('모바일 결제 테스트를 실행하고 있어요.', 'Running the mobile checkout tests.'), { running: true, live: true }],
    ['claude', 'design-system', copy('버튼과 입력창 다듬기', 'Polishing buttons and inputs'), copy('포커스 상태와 키보드 탐색을 확인하고 있어요.', 'Checking focus states and keyboard navigation.'), { terminal: 'busy', live: true }],
    ['claude', 'field-notes', copy('지도에 여행 기록 모으기', 'Travel memories on a map'), copy('사진과 메모를 연결했어요. 다음은 지도 필터예요.', 'Photos and notes are connected. Map filters are next.'), { pinned: true }],
    ['codex', 'checkout', copy('주문 내역 검색 추가', 'Search through order history'), copy('날짜 필터와 검색을 추가했고 테스트를 통과했어요.', 'Date filters and search are ready. Tests passed.'), {}],
    ['agy', 'weekend-web', copy('주말 프로젝트 첫 화면', 'A home for the weekend project'), copy('첫 화면을 정리했어요. 미리보기를 확인해보세요.', 'The home page is ready for a preview.'), {}],
    ['claude', 'design-system', copy('어두운 화면에서도 또렷하게', 'A clearer dark theme'), copy('텍스트 대비와 색상 토큰을 정리했어요.', 'Text contrast and color tokens are updated.'), {}],
  ].map(([tool, project, title, lastReply, extra], i) => ({
    id: `demo-${i}`, key: `${tool}:demo-${i}`, tool, project, title, lastReply,
    updated: now - (i + 1) * 600000, ...extra,
  }));
  const projects = ['checkout', 'design-system', 'field-notes'].map((name, i) => ({
    id: name, name, path: `~/workspace/${name}`, status: 'active', idleDays: 0,
    sessions: [12, 8, 4][i], tools: { claude: 2, codex: 2 },
    brief: { oneLiner: [copy('결제부터 주문 내역까지', 'From checkout to order history'), copy('작은 요소부터 일관되게', 'Consistency in every component'), copy('다음 여행을 위한 작은 기록장', 'A little journal for the next trip')][i], progress: [80, 65, 40][i] },
  }));
  return {
    '/api/state': { tools: ['claude', 'codex', 'agy'].map(id => ({ id, installed: true })), settings: { setupDone: true }, runs: [], unread: 0, lastEventId: 0 },
    '/api/home': { stats: { week: 24, weekProjects: 3 }, live: sessions.slice(0, 2), pinned: [sessions[2]], recent: sessions.slice(3), dozing: [], activeProjects: projects },
    '/api/sessions': { items: sessions, total: sessions.length },
    '/api/usage': { tools: Object.fromEntries(['claude', 'codex', 'agy'].map((id, i) => [id, { periods: { today: { input: 25000 * (i + 1), output: 12000, cacheRead: 100000 } } }])) },
    '/api/limits': Object.fromEntries(['claude', 'codex', 'agy'].map((id, i) => [id, { windows: [{ label: '5h', usedPercent: [32, 58, 18][i], resetsAt: now + 7200000 }] }])),
    '/api/events/after/0': { items: [] },
    '/api/push': {},
  };
}

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome' });
  try {
    for (const lang of ['en', 'ko']) {
      for (const device of ['desktop', 'mobile']) {
        const mobile = device === 'mobile';
        const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1080 }, deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile, locale: lang === 'ko' ? 'ko-KR' : 'en-US', timezoneId: 'Asia/Seoul', colorScheme: 'light', serviceWorkers: 'block' });
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', e => errors.push(e.message));
        await page.clock.setFixedTime(new Date(now));
        await page.addInitScript(() => { localStorage.setItem('baton.theme', 'light'); localStorage.setItem('baton.palette', 'forest'); });
        const data = fixtures(lang);
        await context.route('**/*', async route => {
          const url = new URL(route.request().url());
          // Fonts are the only external resources allowed; never contact a live API.
          if (url.origin !== origin) {
            if (url.hostname === 'cdn.jsdelivr.net') return route.continue();
            return route.abort();
          }
          const p = url.pathname;
          if (p.startsWith('/api/')) {
            if (!Object.hasOwn(data, p)) errors.push(`Missing fixture: ${p}`);
            return route.fulfill({ json: data[p] || {} });
          }
          if (p === '/i18n.js') return route.fulfill({ contentType: 'text/javascript', body: `window.LANG=${JSON.stringify(lang)};window.LOCALE=${JSON.stringify(lang === 'ko' ? 'ko-KR' : 'en-US')};window.I18N_EN=${JSON.stringify(en)};window.t=(ko,vars)=>{let s=LANG==='ko'?ko:(I18N_EN[ko]??ko);return vars?s.replace(/\\{(\\w+)\\}/g,(m,k)=>vars[k]??m):s;};document.documentElement.lang=LANG;` });
          const vendors = { '/vendor/marked.js': 'node_modules/marked/lib/marked.umd.js', '/vendor/purify.js': 'node_modules/dompurify/dist/purify.min.js' };
          const file = path.join(root, vendors[p] || `public${p === '/' ? '/index.html' : p}`);
          if (!fs.existsSync(file)) { errors.push(`Missing asset: ${p}`); return route.fulfill({ status: 404 }); }
          const type = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' }[path.extname(file)] || 'application/octet-stream';
          return route.fulfill({ path: file, contentType: type });
        });
        await page.goto(`${origin}/${mobile ? '#/sessions' : '#/'}`);
        await page.waitForSelector(mobile ? '#slist .srow' : '.studio-home .usage-mini .bar');
        await page.evaluate(() => document.fonts.ready);
        if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) errors.push('Horizontal overflow');
        if (errors.length) throw new Error(errors.join('\n'));
        const name = `${device}-${lang}.png`;
        await page.screenshot({ path: path.join(out, name), animations: 'disabled' });
        console.log(`Saved ${name}`);
        await context.close();
      }
    }
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
