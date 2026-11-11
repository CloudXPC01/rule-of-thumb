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

const videoStartWall = Date.now(); // recordVideo starts with the page
await page.exposeFunction('__saveAudio', async (name, b64, startWall) => {
  const file = path.join(outDir, `${name}.webm`);
  fs.writeFileSync(file, Buffer.from(b64, 'base64'));
  const meta = { file, offsetSec: (startWall - videoStartWall) / 1000 };
  fs.writeFileSync(path.join(outDir, `${name}.json`), JSON.stringify(meta));
  return meta;
});
await page.addInitScript(() => {
  // In-page recording helpers for video scenarios.
  globalThis.REC = {
    rec: null, chunks: [], start: 0,
    startAudio() {
      const stream = globalThis.__sfx?.tap();
      if (!stream) return false;
      this.chunks = [];
      this.rec = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 192000 });
      this.rec.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
      this.start = Date.now();
      this.rec.start(500);
      return true;
    },
    async stopAudio(name = 'audio') {
      if (!this.rec) return null;
      await new Promise((r) => { this.rec.onstop = r; this.rec.stop(); });
      const buf = new Uint8Array(await new Blob(this.chunks).arrayBuffer());
      let bin = '';
      for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
      return globalThis.__saveAudio(name, btoa(bin), this.start);
    },
  };
  // Caption overlay (lower third, pixel style)
  globalThis.CAP = (text, ms = 3000) => {
    let el = document.getElementById('cap-overlay');
    if (!el) {
      el = document.createElement('div');
      el.id = 'cap-overlay';
      el.style.cssText = 'position:fixed;left:50%;bottom:7%;transform:translateX(-50%);z-index:99999;padding:12px 22px;background:rgba(43,33,25,.88);color:#ffe7a8;font:600 26px/1.25 ui-monospace,Consolas,monospace;letter-spacing:.04em;border:3px solid #6b3f1f;box-shadow:4px 4px 0 #1a120c;text-align:center;max-width:80%;transition:opacity .35s;opacity:0;pointer-events:none';
      document.body.appendChild(el);
    }
    el.textContent = text;
    el.style.opacity = text ? '1' : '0';
    clearTimeout(el._t);
    if (ms > 0) el._t = setTimeout(() => (el.style.opacity = '0'), ms);
  };
  // Hide emulator chrome (control panels, badges) for clean capture
  globalThis.HIDE_EMU = () => {
    for (const el of document.querySelectorAll('body *')) {
      const t = el.childElementCount === 0 ? el.textContent ?? '' : '';
      if (/Remote Control Active|Enter XR/.test(t)) {
        let n = el;
        while (n.parentElement && n.parentElement !== document.body) n = n.parentElement;
        n.style.display = 'none';
      }
    }
    // emulator dev UI lives in shadow-DOM hosts (badge, panels, edge glow)
    for (const el of document.querySelectorAll('body *')) {
      if (el.shadowRoot && !el.querySelector('canvas')) el.style.display = 'none';
    }
    const st = document.createElement('style');
    st.textContent = '[class*="iwer"],[id*="iwer"],[class*="devui"]{display:none!important}';
    document.head.appendChild(st);
  };
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
