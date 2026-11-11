/**
 * Stone commandment tablets with pixel-text that is chiselled in letter by
 * letter. Also a small reusable billboard used for "!" and petition signs.
 */
import {
  BoxGeometry,
  CanvasTexture,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  NearestFilter,
  PlaneGeometry,
  SRGBColorSpace,
} from '@iwsdk/core';
import type { LawId } from './village.js';
import { drawText, textWidth, wrapText } from './pixfont.js';
import { drawFrame, INK } from './hud.js';

const W = 72;
const H = 92;

export class Tablet {
  root = new Group();
  law: LawId;
  text: string;
  shown = 0; // characters revealed
  blessed = false;
  crushed = false;
  /** 0..1 rise-in animation. */
  rise = 0;
  shake = 0;
  private canvas: HTMLCanvasElement;
  private ctx2d: CanvasRenderingContext2D;
  private tex: CanvasTexture;
  private stone: Mesh;
  private face: Mesh;
  private lines: string[];
  private glow: MeshBasicMaterial;

  constructor(law: LawId, text: string, public numeral: string) {
    this.law = law;
    this.text = text.toUpperCase();
    this.canvas = document.createElement('canvas');
    this.canvas.width = W;
    this.canvas.height = H;
    this.ctx2d = this.canvas.getContext('2d')!;
    this.ctx2d.imageSmoothingEnabled = false;
    this.tex = new CanvasTexture(this.canvas);
    this.tex.magFilter = NearestFilter;
    this.tex.minFilter = NearestFilter;
    this.tex.colorSpace = SRGBColorSpace;
    this.lines = wrapText(this.text, 10);

    const w = W * 0.0014;
    const h = H * 0.0014;
    this.stone = new Mesh(new BoxGeometry(w + 0.006, h + 0.006, 0.008), new MeshLambertMaterial({ color: 0x8d877c }));
    this.face = new Mesh(new PlaneGeometry(w, h), new MeshBasicMaterial({ map: this.tex, transparent: true }));
    this.face.position.z = 0.0042;
    this.glow = new MeshBasicMaterial({ color: 0xffd34d, transparent: true, opacity: 0 });
    const halo = new Mesh(new BoxGeometry(w + 0.014, h + 0.014, 0.002), this.glow);
    halo.position.z = -0.005;
    this.root.add(this.stone, this.face, halo);
    this.draw();
  }

  get done(): boolean {
    return this.shown >= this.text.length;
  }

  /** Reveal one more character; returns true if a visible glyph was cut. */
  chiselStep(): boolean {
    if (this.done) return false;
    this.shown++;
    this.draw();
    return this.text[this.shown - 1] !== ' ';
  }

  bless() {
    this.blessed = true;
    this.glow.opacity = 0.9;
    (this.stone.material as MeshLambertMaterial).color.set(0xc9a24a);
    this.draw();
  }

  update(dt: number) {
    if (this.rise < 1) this.rise = Math.min(1, this.rise + dt * 1.5);
    if (this.shake > 0) this.shake = Math.max(0, this.shake - dt * 3);
    if (this.blessed) this.glow.opacity = 0.5 + 0.3 * Math.sin(performance.now() / 300);
  }

  private draw() {
    const g = this.ctx2d;
    g.clearRect(0, 0, W, H);
    const base = this.blessed ? '#e0b23a' : '#b3ada2';
    const dark = this.blessed ? '#a07418' : '#8a847a';
    const light = this.blessed ? '#ffe08a' : '#d2ccc0';
    // ink silhouette with chipped corners, stone face, bevel and speckle
    g.fillStyle = '#241a14';
    g.fillRect(2, 0, W - 4, H);
    g.fillRect(0, 2, W, H - 4);
    g.fillRect(1, 1, W - 2, H - 2);
    g.fillStyle = base;
    g.fillRect(2, 2, W - 4, H - 4);
    g.fillStyle = light;
    g.fillRect(2, 2, W - 4, 1);
    g.fillRect(2, 2, 1, H - 4);
    g.fillStyle = dark;
    g.fillRect(2, H - 3, W - 4, 1);
    g.fillRect(W - 3, 2, 1, H - 4);
    let sd = 7;
    const rnd = () => (sd = (sd * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 90; i++) {
      g.fillStyle = rnd() < 0.5 ? dark : light;
      g.fillRect(3 + Math.floor(rnd() * (W - 6)), 3 + Math.floor(rnd() * (H - 6)), 1, 1);
    }
    // a crack and two chips: carved by hand, not printed
    g.fillStyle = dark;
    for (let k = 0; k < 6; k++) g.fillRect(W - 12 + k, H - 14 + (k % 2), 1, 1);
    g.fillStyle = '#241a14';
    g.fillRect(W - 4, 6, 1, 2);
    g.fillRect(5, H - 4, 2, 1);
    const ink = this.blessed ? '#4a300a' : '#2e2620';
    const cut = this.blessed ? '#fff1b8' : '#dcd6ca';
    drawText(g, this.numeral, W / 2, 5, 1, ink, 'center', cut);
    g.fillStyle = ink;
    g.fillRect(10, 15, W - 20, 1);
    let left = this.shown;
    let y = 20;
    for (const line of this.lines) {
      if (left <= 0) break;
      const part = line.slice(0, left);
      left -= line.length + 1;
      drawText(g, part, W / 2, y, 1, ink, 'center', cut);
      y += 9;
    }
    this.tex.needsUpdate = true;
  }
}

/** Billboard text bubble (e.g. "!" or a petition pictogram line). */
export class Bubble {
  mesh: Mesh;
  private canvas: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  private tex: CanvasTexture;
  private current = '';

  constructor(widthM = 0.03, heightM = 0.015, private px = 64) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = px;
    this.canvas.height = Math.round((px * heightM) / widthM);
    this.g = this.canvas.getContext('2d')!;
    this.tex = new CanvasTexture(this.canvas);
    this.tex.magFilter = NearestFilter;
    this.tex.minFilter = NearestFilter;
    this.tex.colorSpace = SRGBColorSpace;
    this.mesh = new Mesh(
      new PlaneGeometry(widthM, heightM),
      new MeshBasicMaterial({ map: this.tex, transparent: true, depthWrite: false }),
    );
    this.mesh.renderOrder = 10;
    this.mesh.visible = false;
  }

  set(text: string, bg = '#fff8e6', fg = '#3a2a1a') {
    if (text === this.current) return;
    this.current = text;
    const g = this.g;
    const w = this.canvas.width;
    const h = this.canvas.height;
    g.clearRect(0, 0, w, h);
    if (w >= 96) {
      // signboards: carved wood frame around paper, one pixel density
      const r = drawFrame(g, w, h, 'wood');
      const scale = Math.max(1, Math.min(2, Math.floor((r.h - 2) / 8), Math.floor((r.w - 4) / Math.max(1, textWidth(text)))));
      drawText(g, text, w / 2, r.y + Math.round((r.h - 7 * scale) / 2), scale, INK, 'center');
      this.tex.needsUpdate = true;
      return;
    }
    g.fillStyle = bg;
    g.fillRect(2, 2, w - 4, h - 4);
    g.fillStyle = fg;
    g.fillRect(0, 2, 2, h - 4);
    g.fillRect(w - 2, 2, 2, h - 4);
    g.fillRect(2, 0, w - 4, 2);
    g.fillRect(2, h - 2, w - 4, 2);
    const scale = Math.max(1, Math.min(Math.floor((h - 6) / 8), Math.floor((w - 8) / Math.max(1, textWidth(text)))));
    drawText(g, text, w / 2, Math.round((h - 7 * scale) / 2), scale, fg, 'center');
    this.tex.needsUpdate = true;
  }
}
