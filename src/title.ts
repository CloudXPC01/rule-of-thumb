/**
 * 2D title overlay shown outside XR (Quest Browser tab, desktop). Holds the
 * visible "Enter" button that launches the AR session, plus Book progress.
 * Hidden while immersive; reappears when the player exits.
 */
import { VisibilityState, type World } from '@iwsdk/core';
import { ALL_LAWS, Book } from './game/book.js';

const CSS = `
#rot-title{position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;
  gap:18px;padding:24px;background:radial-gradient(ellipse at 50% 40%,rgba(40,30,22,.55),rgba(14,10,8,.92));
  color:#f4e9d2;font-family:ui-monospace,Menlo,Consolas,monospace;text-align:center;z-index:10;image-rendering:pixelated}
#rot-title h1{margin:0;font-size:clamp(34px,8vw,72px);letter-spacing:.06em;color:#ffe7a8;
  text-shadow:4px 4px 0 #6b3f1f}
#rot-title p{margin:0;max-width:34em;line-height:1.55;font-size:clamp(13px,2.2vw,16px);color:#e6d6b8}
#rot-title button{font:inherit;font-size:clamp(16px,3vw,22px);padding:14px 28px;background:#6dbb45;color:#1d2a12;
  border:0;box-shadow:0 6px 0 #3d6b25,0 0 0 4px #1d2a12;cursor:pointer;letter-spacing:.08em}
#rot-title button:active{transform:translateY(4px);box-shadow:0 2px 0 #3d6b25,0 0 0 4px #1d2a12}
#rot-title button:disabled{background:#9a8f80;box-shadow:0 0 0 4px #3a2e28;cursor:default}
#rot-title small{color:#bfae8e;font-size:12px}
`;

export function mountTitle(world: World) {
  Book.load();
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  const el = document.createElement('div');
  el.id = 'rot-title';
  el.innerHTML = `
    <h1>RULE OF THUMB</h1>
    <p>You can't speak. They're watching your hands.<br>Everything you do becomes scripture, and they will get it slightly wrong.</p>
    <button id="rot-enter">ENTER</button>
    <small id="rot-note">Hands only. Seated. Put your controllers down. About 10 minutes.</small>
    <small id="rot-book"></small>`;
  document.body.appendChild(el);
  const btn = el.querySelector<HTMLButtonElement>('#rot-enter')!;
  const note = el.querySelector<HTMLElement>('#rot-note')!;
  const book = el.querySelector<HTMLElement>('#rot-book')!;

  const refreshBook = () => {
    const d = Book.load();
    book.textContent = d.plays
      ? `Book of the Hand: ${d.laws.length}/${ALL_LAWS.length} laws found · endings seen: ${d.endings.length}/3`
      : '';
  };
  refreshBook();

  if (!world.xrEnabled) {
    btn.disabled = true;
    btn.textContent = 'NEEDS A QUEST';
    note.textContent = 'Open this page in the Meta Quest Browser to play in mixed reality.';
  }
  btn.addEventListener('click', () => world.launchXR());
  world.visibilityState.subscribe((v) => {
    el.style.display = v === VisibilityState.NonImmersive ? 'flex' : 'none';
    if (v === VisibilityState.NonImmersive) refreshBook();
  });
}
