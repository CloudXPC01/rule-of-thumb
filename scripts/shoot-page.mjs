// Screenshot a local HTML file after pressing keys: node scripts/shoot-page.mjs file.html outPrefix 1 2 3
import { chromium } from 'playwright-core';
import { pathToFileURL } from 'node:url';
const [file, prefix, ...keys] = process.argv.slice(2);
const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--use-angle=d3d11'] });
const p = await b.newPage({ viewport: { width: Number(process.env.W ?? 1280), height: Number(process.env.H ?? 720) } });
await p.goto(pathToFileURL(file).href);
for (const k of keys) {
  await p.keyboard.press(k);
  await p.waitForTimeout(6000);
  await p.screenshot({ path: `${prefix}-${k}.png` });
}
await b.close();
