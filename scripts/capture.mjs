/**
 * Headless emulator runner for playtests and gameplay capture.
 * Launches the installed Google Chrome (GPU, D3D11) against the local dev
 * server (which injects the IWER emulator), enters XR with hand tracking and
 * runs a scenario script in the page. Optionally records video.
 *
 *   node scripts/capture.mjs fps
 *   node scripts/capture.mjs video <scenario.js> [out-dir]
 *   node scripts/capture.mjs run <scenario.js> [out-dir]   (no video, screenshots via __shot)
 *
 * Env: GAME_URL (default http://localhost:5180/), CHROME_PATH.
 */
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const URL = process.env.GAME_URL ?? 'http://localhost:5180/';
const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const [mode = 'fps', scenarioPath, outDir = 'capture'] = process.argv.slice(2);
const W = Number(process.env.W ?? 1280);
const H = Number(process.env.H ?? 720);

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required', '--disable-renderer-backgrounding', '--disable-background-timer-throttling'],
});
const context = await browser.newContext({
  viewport: { width: W, height: H },
  deviceScaleFactor: 1,
  ...(mode === 'video' ? { recordVideo: { dir: outDir, size: { width: W, height: H } } } : {}),
});
const page = await context.newPage();
page.on('console', (m) => {
  const t = m.text();
  if (m.type() === 'error' || t.startsWith('[cap]')) console.log(`[page:${m.type()}]`, t.slice(0, 300));
});
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

fs.mkdirSync(outDir, { recursive: true });
await page.exposeFunction('__shot', async (name) => {
  const file = path.join(outDir, `${name}.png`);
  await page.screenshot({ path: file });
  return file;
});

const t0 = Date.now();
await page.goto(URL, { waitUntil: 'load' });
await page.waitForFunction(() => globalThis.__god && globalThis.T && document.querySelector('#rot-enter'), null, { timeout: 120000 });
console.log(`ready in ${((Date.now() - t0) / 1000).toFixed(1)} s`);

if (mode === 'fps') {
  const r = await page.evaluate(async () => {
    const T = globalThis.T;
    const raf = await new Promise((res) => { let n = 0; const s = performance.now(); const f = () => { n++; if (performance.now() - s < 2000) requestAnimationFrame(f); else res(n / 2); }; requestAnimationFrame(f); });
    await T.enter(true);
    const xr = await new Promise((res) => { let n = 0; const s = performance.now(); const sess = T.d.activeSession; const f = () => { n++; if (performance.now() - s < 3000) sess.requestAnimationFrame(f); else res(n / 3); }; sess.requestAnimationFrame(f); });
    const gl = document.querySelector('canvas').getContext('webgl2');
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    return { raf, xr, gpu: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : '?' };
  });
  console.log(JSON.stringify(r));
} else {
  const src = fs.readFileSync(scenarioPath, 'utf8');
  const result = await page.evaluate(async (code) => {
    // eslint-disable-next-line no-new-func
    const fn = new Function('return (async () => {' + code + '\n})()');
    return await fn();
  }, src);
  console.log('scenario result:', JSON.stringify(result));
}

await context.close();
if (mode === 'video') {
  const vids = fs.readdirSync(outDir).filter((f) => f.endsWith('.webm')).map((f) => path.join(outDir, f));
  console.log('videos:', vids.join(', '));
}
await browser.close();
