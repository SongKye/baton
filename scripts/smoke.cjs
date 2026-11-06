// Headless smoke test: opens every screen and reports page errors.
//   node scripts/smoke.cjs [baseUrl] [path-to-playwright-core]
// Needs a Chromium/Chrome and playwright-core (not a Baton dependency).
const base = process.argv[2] || 'http://127.0.0.1:7420';
const pw = require(process.argv[3] || 'playwright-core');
(async () => {
  const browser = await pw.chromium.launch({ channel: 'chrome' });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`${page.url()} :: ${e.message}`));
  const get = async (p) => (await (await fetch(base + p)).json());
  const sess = (await get('/api/sessions?limit=1')).items[0];
  const proj = (await get('/api/projects')).items?.[0] || (await get('/api/projects'))[0];
  const skill = (await get('/api/skills')).skills[0];
  const routes = ['#/', '#/projects', '#/projects?f=dozing', '#/sessions', '#/tools', '#/ports', '#/skills', '#/mcp', '#/usage', '#/cleanup', '#/trash',
    '#/settings', '#/setup', '#/inbox', '#/new',
    sess && `#/s/${sess.tool}/${encodeURIComponent(sess.id)}`, proj && `#/p/${encodeURIComponent(proj.id)}`, skill && `#/skill/${skill.id}`].filter(Boolean);
  for (const r of routes) {
    await page.goto(`${base}/${r}`);
    await page.waitForTimeout(r.includes('setup') || r.includes('usage') ? 6000 : 2500);
    // the router renders errors as: <div class="empty" style="padding-top:30vh"><b>Couldn't load</b>message<button>…
    const failed = await page.$$eval('#app > .empty b', (bs) => bs.some((b) => /불러오지 못했어요|Couldn't load/.test(b.textContent))).catch(() => false);
    console.log(`${failed ? '✗' : '✓'} ${r}`);
    if (failed) errors.push(`${r} :: render error: ${await page.$eval('#app > .empty', (el) => el.textContent.slice(0, 200))}`);
  }
  await browser.close();
  if (errors.length) { console.log('\nERRORS'); for (const e of errors) console.log(' ', e); process.exit(1); }
  console.log('\nall screens OK');
})();
