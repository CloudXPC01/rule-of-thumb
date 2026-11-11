// Smoke-test a deployed build: load time, console errors, title screenshot, scribe endpoint.
import { chromium } from 'playwright-core';
const url = process.argv[2];
const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--use-angle=d3d11'] });
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
const errs = [];
p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
p.on('console', (m) => m.type() === 'error' && errs.push('console: ' + m.text().slice(0, 200)));
const t0 = Date.now();
await p.goto(url, { waitUntil: 'load' });
await p.waitForFunction(() => globalThis.__god && document.querySelector('#rot-enter'), null, { timeout: 60000 });
const ready = (Date.now() - t0) / 1000;
await p.waitForTimeout(2500);
await p.screenshot({ path: 'capture/prod-title.png' });
const scribe = await p.evaluate(async () => { const r = await fetch('/api/scribe', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ omen: 'plant', witness: 'Bo', laws: [], crushed: [], health: 80, population: 5 }) }); return { status: r.status, body: (await r.text()).slice(0, 200) }; });
const info = await p.evaluate(() => ({ xr: !!navigator.xr, harness: typeof globalThis.T, phase: globalThis.__god.phase }));
console.log(JSON.stringify({ ready, scribe, info, errs: errs.slice(0, 8) }, null, 1));
await b.close();
