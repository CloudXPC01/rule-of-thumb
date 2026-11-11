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

const W = 96;
const H = 124;

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
    this.lines = wrapText(this.text, 14);

    const w = 0.095;
    const h = 0.123;
    this.stone = new Mesh(new BoxGeometry(w + 0.006, h + 0.006, 0.008), new MeshLambertMaterial({ color: 0x8b8378 }));
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
    g.fillStyle = this.blessed ? '#e6c76a' : '#d9cfbf';
    g.fillRect(0, 0, W, H);
    // speckle + chipped corners: reads as carved stone at pixel scale
    for (let i = 0; i < 70; i++) {
      g.fillStyle = i % 2 ? (this.blessed ? '#d4ae4e' : '#c8bca9') : this.blessed ? '#f3dc8a' : '#e8dfcf';
      g.fillRect((i * 37) % W, (i * 53) % H, 2, 2);
    }
    g.clearRect(0, 0, 3, 3);
    g.clearRect(W - 3, 0, 3, 3);
    g.clearRect(0, H - 3, 3, 3);
    g.clearRect(W - 3, H - 3, 3, 3);
    const ink = this.blessed ? '#6b4a10' : '#4a3a2c';
    const cut = this.blessed ? '#fff1b8' : '#f4eee2';
    drawText(g, this.numeral, W / 2, 6, 2, ink, 'center', cut);
    g.fillStyle = ink;
    g.fillRect(14, 24, W - 28, 2);
    let left = this.shown;
    let y = 33;
    for (const line of this.lines) {
      if (left <= 0) break;
      const part = line.slice(0, left);
      left -= line.length + 1;
      drawText(g, part, W / 2, y, 1, ink, 'center', cut);
      y += 10;
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
