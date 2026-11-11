/**
 * Title screen ("The Diorama", Woodcut Pixel style). Shown outside XR.
 * The island on the right is the live game scene (same assets, villagers
 * really working), framed by GodSystem's attract mode; this module draws the
 * plank wall behind the transparent WebGL canvas and the copy on the left,
 * all in the game's own 5x7 pixel font. The ENTER signboard launches AR.
 */
import { VisibilityState, type World } from '@iwsdk/core';
import { ALL_LAWS, Book } from './game/book.js';
import { drawFrame, INK } from './game/hud.js';
import { drawText, textWidth, wrapText } from './game/pixfont.js';

const BONE = '#f0e2c0';
const GOLD = '#ffd34d';

/** A crisp pixel-text canvas, displayed at an integer CSS scale. */
function pixelText(lines: string[], opts: { scale: number; color: string; outline?: string; drop?: string; gap?: number; align?: 'left' | 'center' }) {
  const gap = opts.gap ?? 3;
  const w = Math.max(...lines.map((l) => textWidth(l))) + 4;
  const h = lines.length * (7 + gap) - gap + 5;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  const x = opts.align === 'center' ? w / 2 : 2;
  lines.forEach((l, i) => {
    const y = 1 + i * (7 + gap);
    if (opts.drop) drawText(g, l, x, y + 2, 1, opts.drop, opts.align);
    if (opts.outline) for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) drawText(g, l, x + dx, y + dy, 1, opts.outline, opts.align);
    drawText(g, l, x, y, 1, opts.color, opts.align);
  });
  c.style.width = `${w * opts.scale}px`;
  c.style.height = `${h * opts.scale}px`;
  c.className = 'px';
  c.setAttribute('aria-hidden', 'true');
  return c;
}

/** Plank wall texture as a data URL (drawn once). */
function plankWall(): string {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 96;
  const g = c.getContext('2d')!;
  const tones = ['#6f4a2f', '#7b5236', '#86593a', '#74503a'];
  let s = 11;
  const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
  for (let row = 0; row < 6; row++) {
    const y = row * 16;
    let x = -Math.floor(r() * 40);
    while (x < 128) {
      const len = 40 + Math.floor(r() * 50);
      g.fillStyle = tones[Math.floor(r() * tones.length)];
      g.fillRect(x, y, len, 15);
      for (let k = 0; k < 10; k++) {
        g.fillStyle = r() < 0.5 ? '#5e3d27' : '#94664a';
        g.fillRect(x + Math.floor(r() * len), y + 2 + Math.floor(r() * 11), 3 + Math.floor(r() * 6), 1);
      }
      g.fillStyle = '#3b2619';
      g.fillRect(x + len - 1, y, 1, 15);
      g.fillRect(x + 3, y + 7, 1, 1); // nail
      g.fillRect(x + len - 5, y + 7, 1, 1);
      x += len;
    }
    g.fillStyle = '#3b2619';
    g.fillRect(0, y + 15, 128, 1);
  }
  return c.toDataURL();
}

function enterSign(label: string, sub: string): HTMLCanvasElement {
  const w = 120;
  const h = 40;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  const r = drawFrame(g, w, h, 'wood');
  const scale = textWidth(label) * 2 <= r.w - 6 ? 2 : 1;
  drawText(g, label, w / 2, r.y + 3, scale, INK, 'center');
  drawText(g, sub, w / 2, r.y + r.h - 9, 1, '#7a4e2e', 'center');
  c.className = 'px';
  return c;
}

const CSS = `
#rot-title{position:fixed;inset:0;z-index:10;display:flex;align-items:center;padding:clamp(16px,4vw,64px);
  box-sizing:border-box;pointer-events:none;font-family:ui-monospace,Consolas,monospace}
#rot-title .px{image-rendering:pixelated;image-rendering:crisp-edges;display:block}
#rot-title .col{display:flex;flex-direction:column;align-items:flex-start;gap:clamp(12px,2.2vh,22px);
  width:min(46%,560px);pointer-events:auto}
#rot-title button{all:unset;cursor:pointer;display:block;line-height:0;filter:drop-shadow(0 6px 0 #241a14);transition:transform .08s steps(2)}
#rot-title button:hover{transform:translateY(-2px)}
#rot-title button:active{transform:translateY(4px);filter:drop-shadow(0 2px 0 #241a14)}
#rot-title button:focus-visible{outline:3px solid #ffd34d;outline-offset:6px}
#rot-title button[disabled]{cursor:default;opacity:.85}
#rot-title .sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
body.rot-wall{background-color:#6f4a2f;background-size:512px 384px;image-rendering:pixelated}
body.rot-wall::after{content:"";position:fixed;inset:0;pointer-events:none;z-index:5;box-shadow:inset 0 0 220px 80px rgba(24,14,6,.62)}
@media (max-width:820px){
  #rot-title{align-items:flex-end;justify-content:center}
  #rot-title .col{width:100%;align-items:center;text-align:center}
}`;

export function mountTitle(world: World) {
  Book.load();
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  document.body.classList.add('rot-wall');
  document.body.style.backgroundImage = `url(${plankWall()})`;

  const el = document.createElement('div');
  el.id = 'rot-title';
  const col = document.createElement('div');
  col.className = 'col';
  el.appendChild(col);
  document.body.appendChild(el);

  const narrow = () => window.innerWidth <= 820;
  const k = () => (narrow() ? 2 : window.innerWidth > 1500 ? 3 : 2);

  const sr = document.createElement('h1');
  sr.className = 'sr';
  sr.textContent = "Rule of Thumb. You can't speak. They're watching your hands. Everything you do becomes scripture, and they will get it slightly wrong.";

  const btn = document.createElement('button');
  btn.id = 'rot-enter';
  btn.setAttribute('aria-label', 'Enter mixed reality');
  const book = document.createElement('div');
  book.id = 'rot-book';

  const render = () => {
    col.replaceChildren();
    const s = k();
    col.append(
      sr,
      pixelText(narrow() ? ['A TINY CIVILISATION,', 'ON YOUR ACTUAL DESK'] : ['A TINY CIVILISATION, ON YOUR ACTUAL DESK'], { scale: s, color: GOLD, drop: INK, align: narrow() ? 'center' : 'left' }),
      pixelText(['RULE OF', 'THUMB'], { scale: s * 4, color: BONE, outline: INK, drop: '#3b2619', gap: 2, align: narrow() ? 'center' : 'left' }),
      pixelText(wrapText("YOU CAN'T SPEAK. THEY'RE WATCHING YOUR HANDS. EVERYTHING YOU DO BECOMES SCRIPTURE, AND THEY WILL GET IT SLIGHTLY WRONG.", narrow() ? 28 : 34), {
        scale: s,
        color: BONE,
        drop: INK,
        align: narrow() ? 'center' : 'left',
      }),
    );
    const xr = world.xrEnabled;
    const sign = enterSign(xr ? 'ENTER' : 'OPEN ON QUEST', xr ? 'PINCH OR POKE' : 'META QUEST BROWSER');
    sign.style.width = `${sign.width * s * 1.5}px`;
    sign.style.height = `${sign.height * s * 1.5}px`;
    btn.replaceChildren(sign);
    btn.disabled = !xr;
    col.append(
      btn,
      pixelText(narrow() ? ['HANDS ONLY - SEATED', 'ABOUT 10 MINUTES', 'PUT YOUR CONTROLLERS DOWN'] : ['HANDS ONLY - SEATED - ABOUT 10 MINUTES', 'PUT YOUR CONTROLLERS DOWN'], { scale: s, color: '#e3d1a8', drop: INK, align: narrow() ? 'center' : 'left' }),
    );
    const d = Book.load();
    if (d.plays) {
      const pages = ALL_LAWS.map((l) => (d.laws.includes(l) ? '{' : '-')).join(' ');
      book.replaceChildren(
        pixelText([`BOOK OF THE HAND  ${pages}  ${d.laws.length}/${ALL_LAWS.length}`, `ENDINGS SEEN ${d.endings.length}/3`], { scale: s, color: GOLD, drop: INK, align: narrow() ? 'center' : 'left' }),
      );
      col.append(book);
    }
  };
  render();
  window.addEventListener('resize', render);

  btn.addEventListener('click', () => {
    if (world.xrEnabled) world.launchXR();
  });
  world.visibilityState.subscribe((v) => {
    const flat = v === VisibilityState.NonImmersive;
    el.style.display = flat ? 'flex' : 'none';
    document.body.classList.toggle('rot-wall', flat);
    if (flat) render();
  });
}
