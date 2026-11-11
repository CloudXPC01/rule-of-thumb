/**
 * Pixel UI in the Woodcut Pixel style: every panel is a carved wooden frame
 * around paper, drawn at one pixel density (1 canvas px ≈ 1.4 mm) with the
 * game's 5x7 font and ink pictograms.
 *   Hud    - small signboard on the island's front rim (Age, land hearts,
 *            wood / food / people / laws, onboarding hint)
 *   Banner - hanging signboard for Age announcements, festival readings
 *            and the ending card; floats beside the island, never over it
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
import { drawText, wrapText } from './pixfont.js';

export interface HudData {
  age: string;
  ageProgress: number; // 0..1 through the whole session
  health: number; // 0..1
  wood: number;
  food: number;
  people: number;
  laws: number;
  hint: string;
  hintPulse: boolean;
}

/** Metres per canvas pixel for all UI (one density everywhere). */
export const UI_PX = 0.0014;

export const INK = '#241a14';
const PAPER = '#f0e2c0';
const PAPER_GRAIN = '#e3d1a8';
const WOOD = ['#4a2e1c', '#7a4e2e', '#b07c47', '#d9a466']; // dark → light

function makeCanvas(w: number, h: number) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext('2d')!;
  g.imageSmoothingEnabled = false;
  const tex = new CanvasTexture(canvas);
  tex.magFilter = NearestFilter;
  tex.minFilter = NearestFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = SRGBColorSpace;
  return { canvas, g, tex };
}

function rng(seed: number) {
  let s = seed % 2147483647 || 1;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

export type Frame = 'wood' | 'gold' | 'night';

/** Carved wooden frame (5 px) around a paper field; returns the inner rect. */
export function drawFrame(g: CanvasRenderingContext2D, w: number, h: number, kind: Frame = 'wood') {
  const wood = kind === 'gold' ? ['#5a3e0a', '#a07418', '#e0b23a', '#ffe08a'] : kind === 'night' ? ['#120d18', '#2a2236', '#46395a', '#6a5a84'] : WOOD;
  const paper = kind === 'night' ? '#1d1830' : kind === 'gold' ? '#f4e2a8' : PAPER;
  const grain = kind === 'night' ? '#251f3c' : kind === 'gold' ? '#e8d08a' : PAPER_GRAIN;
  g.clearRect(0, 0, w, h);
  // outer ink silhouette with notched corners
  g.fillStyle = INK;
  g.fillRect(1, 0, w - 2, h);
  g.fillRect(0, 1, w, h - 2);
  // wood border
  g.fillStyle = wood[1];
  g.fillRect(1, 1, w - 2, h - 2);
  // plank grain along the frame
  const r = rng(w * 31 + h);
  for (let k = 0; k < (w + h) / 3; k++) {
    g.fillStyle = r() < 0.5 ? wood[0] : wood[2];
    const x = 1 + Math.floor(r() * (w - 3));
    const y = 1 + Math.floor(r() * (h - 3));
    g.fillRect(x, y, 2, 1);
  }
  // bevel: light top/left, dark bottom/right
  g.fillStyle = wood[3];
  g.fillRect(2, 1, w - 4, 1);
  g.fillRect(1, 2, 1, h - 4);
  g.fillStyle = wood[0];
  g.fillRect(2, h - 2, w - 4, 1);
  g.fillRect(w - 2, 2, 1, h - 4);
  // inner recess + paper
  g.fillStyle = INK;
  g.fillRect(4, 4, w - 8, h - 8);
  g.fillStyle = paper;
  g.fillRect(5, 5, w - 10, h - 10);
  for (let k = 0; k < (w * h) / 60; k++) {
    g.fillStyle = grain;
    g.fillRect(5 + Math.floor(r() * (w - 11)), 5 + Math.floor(r() * (h - 11)), 1, 1);
  }
  // nail heads in the corners
  g.fillStyle = kind === 'night' ? '#8a7aa4' : '#3a2a1e';
  for (const [x, y] of [[2, 2], [w - 4, 2], [2, h - 4], [w - 4, h - 4]]) g.fillRect(x, y, 2, 2);
  return { x: 6, y: 6, w: w - 12, h: h - 12 };
}

const HW = 160;
const HH = 88;

export class Hud {
  root = new Group();
  private g: CanvasRenderingContext2D;
  private tex: CanvasTexture;
  private key = '';

  constructor() {
    const { g, tex } = makeCanvas(HW, HH);
    this.g = g;
    this.tex = tex;
    const w = HW * UI_PX;
    const h = HH * UI_PX;
    // thick plank the sign is painted on, plus two stubby posts into the soil
    const wood = new MeshLambertMaterial({ color: 0x7a4e2e });
    const base = new Mesh(new BoxGeometry(w, h, 0.006), wood);
    base.position.z = -0.0032;
    const face = new Mesh(new PlaneGeometry(w, h), new MeshBasicMaterial({ map: tex, transparent: true }));
    for (const sx of [-1, 1]) {
      const post = new Mesh(new BoxGeometry(0.008, 0.05, 0.008), new MeshLambertMaterial({ color: 0x4a2e1c }));
      post.position.set(sx * (w / 2 - 0.018), -h / 2 - 0.012, -0.004);
      this.root.add(post);
    }
    this.root.add(base, face);
  }

  set(d: HudData, time: number) {
    const pulse = d.hintPulse && Math.floor(time * 2) % 2 === 0;
    const hearts = Math.round(Math.max(0, Math.min(1, d.health)) * 10);
    const key = `${d.age}|${Math.round(d.ageProgress * 12)}|${hearts}|${d.wood}|${Math.floor(d.food)}|${d.people}|${d.laws}|${d.hint}|${pulse}`;
    if (key === this.key) return;
    this.key = key;
    const g = this.g;
    const r = drawFrame(g, HW, HH, 'wood');
    let y = r.y + 2;

    // row 1: Age name + 12 sun pips for session progress
    drawText(g, d.age, r.x + 2, y, 1, INK);
    for (let i = 0; i < 12; i++) {
      g.fillStyle = i / 12 < d.ageProgress ? '#c9502f' : '#cdb88c';
      g.fillRect(r.x + r.w - 2 - (12 - i) * 4, y + 2, 3, 3);
    }
    y += 11;

    // row 2: land as 10 hearts that wilt to drought colour
    for (let i = 0; i < 10; i++) {
      const full = i < hearts;
      drawText(g, full ? '&' : '}', r.x + 2 + i * 7, y, 1, full ? (hearts <= 3 ? '#b07c47' : '#c9402f') : '#a89070');
    }
    drawText(g, 'LAND', r.x + r.w - 2, y, 1, '#7a5a3a', 'right');
    y += 11;

    // row 3: ink pictogram counters
    const cols = [r.x + 2, r.x + 36, r.x + 70, r.x + 104];
    drawText(g, `[${d.wood}`, cols[0], y, 1, INK);
    drawText(g, `$${Math.floor(d.food)}`, cols[1], y, 1, INK);
    drawText(g, `@${d.people}`, cols[2], y, 1, INK);
    drawText(g, `{${d.laws}`, cols[3], y, 1, INK);
    y += 10;

    // carved divider
    g.fillStyle = '#c9b48c';
    g.fillRect(r.x + 2, y, r.w - 4, 1);
    g.fillStyle = '#fff4d8';
    g.fillRect(r.x + 2, y + 1, r.w - 4, 1);
    y += 4;

    // hint: up to 3 lines; the paper glows warm when it is new
    if (d.hint) {
      if (pulse) {
        g.fillStyle = '#ffe9a8';
        g.fillRect(r.x, y - 1, r.w, r.y + r.h - y + 1);
      }
      const lines = wrapText(d.hint, 24);
      for (let i = 0; i < Math.min(3, lines.length); i++) {
        drawText(g, lines[i], HW / 2, y + i * 9, 1, '#6b2a14', 'center');
      }
    }
    this.tex.needsUpdate = true;
  }
}

const BW = 168;
const BH = 80;

/** Hanging wooden signboard for announcements; sits beside the island. */
export class Banner {
  root = new Group();
  private g: CanvasRenderingContext2D;
  private tex: CanvasTexture;
  private mat: MeshBasicMaterial;
  private ropeMat: MeshBasicMaterial;
  private t = 0;
  private dur = 0;
  /** 0..1 current visibility (fades). */
  vis = 0;

  constructor() {
    const { g, tex } = makeCanvas(BW, BH);
    this.g = g;
    this.tex = tex;
    this.mat = new MeshBasicMaterial({ map: tex, transparent: true, opacity: 0, depthWrite: false });
    const w = BW * UI_PX;
    const h = BH * UI_PX;
    const mesh = new Mesh(new PlaneGeometry(w, h), this.mat);
    mesh.renderOrder = 20;
    // two short ropes it hangs from
    const rope = new MeshBasicMaterial({ color: 0x5a4030, transparent: true, opacity: 0 });
    for (const sx of [-1, 1]) {
      const r = new Mesh(new BoxGeometry(0.0015, 0.04, 0.0015), rope);
      r.position.set(sx * (w / 2 - 0.02), h / 2 + 0.02, 0);
      this.root.add(r);
    }
    this.ropeMat = rope;
    this.root.add(mesh);
    this.root.visible = false;
  }
  /** title: big line; body: small wrapped text. duration <= 0 means stay. */
  show(title: string, body = '', duration = 3.5, style: 'stone' | 'gold' | 'night' = 'stone') {
    const g = this.g;
    const kind: Frame = style === 'gold' ? 'gold' : style === 'night' ? 'night' : 'wood';
    const r = drawFrame(g, BW, BH, kind);
    const ink = kind === 'night' ? '#ffe7a8' : kind === 'gold' ? '#4a300a' : INK;
    const titleLines = wrapText(title, 12);
    const bodyLines = body ? wrapText(body, 25).slice(0, 4) : [];
    const blockH = titleLines.slice(0, 2).length * 16 + (bodyLines.length ? 4 + bodyLines.length * 9 : 0);
    let y = r.y + Math.max(2, Math.floor((r.h - blockH) / 2));
    for (const l of titleLines.slice(0, 2)) {
      drawText(g, l, BW / 2, y, 2, ink, 'center');
      y += 16;
    }
    if (bodyLines.length) {
      y += 4;
      for (const l of bodyLines) {
        drawText(g, l, BW / 2, y, 1, ink, 'center');
        y += 9;
      }
    }
    this.tex.needsUpdate = true;
    this.t = 0;
    this.dur = duration;
    this.root.visible = true;
  }

  hide() {
    this.dur = 0.001;
    this.t = 1;
  }

  update(dt: number) {
    if (!this.root.visible) return;
    this.t += dt;
    const fadeIn = Math.min(1, this.t * 4);
    const fadeOut = this.dur > 0 ? Math.min(1, Math.max(0, (this.dur - this.t) * 2)) : 1;
    this.vis = Math.min(fadeIn, fadeOut);
    this.mat.opacity = this.vis;
    this.ropeMat.opacity = this.vis;
    if (this.dur > 0 && this.t >= this.dur) this.root.visible = false;
  }
}
