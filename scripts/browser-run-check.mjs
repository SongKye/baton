// Chromium exercises the production live renderer, question UI, runner and SSE route.
// Only the surrounding navigation shell and CLI are fixtures; no account/network calls.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { pathToFileURL } from 'node:url';

export async function checkBrowser({ root, runner, streamRun, start, finished, home }) {
  const spec = process.env.BATON_PLAYWRIGHT;
  const { chromium } = await import(spec ? pathToFileURL(path.resolve(spec, 'index.mjs')).href : 'playwright-core');
  const source = await fs.readFile(path.join(root, 'public/app.js'), 'utf8');
  const extract = (a, b) => { assert(source.includes(a) && source.includes(b)); return source.slice(source.indexOf(a), source.indexOf(b)); };
  const client = `const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const t = (s, vars = {}) => s.replace(/\\{(\\w+)\\}/g, (_, k) => vars[k] ?? k);
const glyph = () => '', ICON = {chev:''}, toolLabel = esc, fmtDur = () => '', drawRunPill = () => {};
const toast = (s) => { throw new Error(s); };
${extract('const md = (text)', 'const store =')}
${extract('async function api(', 'function toast(')}
${extract('function toolsHtml(', 'function msgsHtml(')}
${extract('function liveRun(', 'function chatLayout(')}
window.finishedCount = 0;
window.live = liveRun(document.querySelector('#chat'), new URL(location.href).searchParams.get('run'), {onDone: ev => {window.final = ev; window.finishedCount++;}});`;
  const requests = [], answers = [], streams = new Map();
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://local');
    if (url.pathname === '/client.js') { res.setHeader('content-type', 'text/javascript'); res.end(client); return; }
    if (url.pathname === '/') { res.setHeader('content-type', 'text/html; charset=utf-8'); res.end('<div id="chat"></div><script src="/client.js"></script>'); return; }
    const stream = url.pathname.match(/^\/api\/runs\/([^/]+)\/stream$/);
    if (stream) { requests.push({ id: stream[1], from: Number(url.searchParams.get('from')) }); streams.set(res, stream[1]); res.on('close', () => streams.delete(res)); streamRun(req, res, stream[1], Number(url.searchParams.get('from'))); return; }
    res.setHeader('content-type', 'application/json');
    if (url.pathname === '/api/runs') { res.end(JSON.stringify({ runs: runner.listRuns() })); return; }
    const answer = url.pathname.match(/^\/api\/runs\/([^/]+)\/answer$/);
    if (answer) {
      let body = ''; for await (const b of req) body += b;
      const data = JSON.parse(body); answers.push(data);
      const ok = runner.answerRun(answer[1], data.requestId, data.answers);
      res.statusCode = ok ? 200 : 400; res.end(JSON.stringify(ok ? { ok } : { error: 'question already answered' })); return;
    }
    res.statusCode = 404; res.end('{}');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ ...(process.env.BATON_BROWSER ? { executablePath: process.env.BATON_BROWSER } : {}), headless: true });
    const errors = [];
    for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
      const context = await browser.newContext({ viewport });
      const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
      const base = `http://127.0.0.1:${server.address().port}/`;
      const releaseFile = path.join(home, `browser-release-${viewport.width}`);
      const slow = start('claude', 'slow', { releaseFile }), slowDone = finished(slow);
      await page.goto(`${base}?run=${slow.id}`);
      await page.waitForFunction(() => document.querySelector('.msg-ai')?.textContent === 'first');
      await context.setOffline(true);
      for (const [response, id] of streams) if (id === slow.id) response.destroy();
      await fs.writeFile(releaseFile, 'continue'); assert((await slowDone).ok);
      await context.setOffline(false);
      await page.waitForFunction(() => window.final, undefined, { timeout: 15000 });
      assert.equal(await page.locator('.msg-ai').textContent(), 'firstsecond');
      assert.equal(await page.evaluate(() => window.finishedCount), 1);
      assert.equal(await page.locator('.typing-caret').count(), 0);
      assert(requests.some(r => r.id === slow.id && r.from > 0), 'reconnect uses the next event id');

      const ask = start('claude', 'ask'), askDone = finished(ask);
      await page.goto(`${base}?run=${ask.id}`); await page.locator('.ask-opt').first().waitFor();
      await page.reload(); await page.locator('.ask-opt').first().waitFor();
      assert.equal(await page.locator('.ask-card').count(), 1, 'pending question survives a page reload');
      const second = await context.newPage(); second.on('pageerror', e => errors.push(e.message));
      await second.goto(`${base}?run=${ask.id}`); await second.locator('.ask-opt').first().waitFor();
      const before = answers.length;
      await page.locator('.ask-opt').first().click(); assert((await askDone).ok);
      await page.waitForFunction(() => window.final); await second.waitForFunction(() => window.final);
      assert.equal(answers.length, before + 1);
      assert.equal(await second.locator('.ask-card.done').count(), 1);
      assert((await second.locator('.ask-card.done').textContent()).includes('Yes'));
      const duplicate = await fetch(`${base}api/runs/${ask.id}/answer`, { method: 'POST', body: JSON.stringify(answers.at(-1)) });
      assert.equal(duplicate.status, 400);
      await second.close();

      const toolFile = path.join(home, `browser-tool-${viewport.width}`);
      const tool = start('claude', 'delayed-tool', { releaseFile: toolFile }), toolDone = finished(tool);
      await page.goto(`${base}?run=${tool.id}`); await page.locator('.tools').waitFor();
      await fs.writeFile(toolFile, 'complete'); await toolDone;
      await page.waitForFunction(() => window.final);
      await page.locator('.tool-item.err').waitFor({ state: 'attached', timeout: 3000 });
      await context.close();
    }
    assert.deepEqual(errors, []);
    console.log('PASS: Chromium desktop/mobile viewport, offline reconnect without duplicates, pending-question reload/two tabs, single answer, tool completion rendering');
  } finally {
    await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  }
}
