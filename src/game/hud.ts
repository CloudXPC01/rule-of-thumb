/**
 * Pixel-text HUD plate at the island's front rim (Age, land health, wood,
 * food, people, onboarding hint) plus a large Banner used for Age
 * announcements, festival readings and the ending card.
 * Both are CanvasTextures with nearest filtering, redrawn only on change.
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

const HW = 160;
const HH = 84;

function makeCanvas(w: number, h: number) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext('2d')!;
  g.imageSmoothingEnabled = false;
  const tex = new CanvasTexture(canvas);
  tex.magFilter = NearestFilter;
  tex.minFilter = NearestFilter;
  tex.colorSpace = SRGBColorSpace;
  return { canvas, g, tex };
}

export class Hud {
  root = new Group();
  private g: CanvasRenderingContext2D;
  private tex: CanvasTexture;
  private key = '';

  constructor() {
    const { g, tex } = makeCanvas(HW, HH);
    this.g = g;
    this.tex = tex;
    const w = 0.22;
    const h = (w * HH) / HW;
    // stone plinth the plate sits on
    const base = new Mesh(new BoxGeometry(w + 0.01, h + 0.01, 0.008), new MeshLambertMaterial({ color: 0x5c4a3a }));
    base.position.z = -0.0045;
    const face = new Mesh(new PlaneGeometry(w, h), new MeshBasicMaterial({ map: tex }));
    this.root.add(base, face);
  }

  set(d: HudData, time: number) {
    const pulse = d.hintPulse && Math.floor(time * 2.5) % 2 === 0;
    const key = `${d.age}|${Math.round(d.ageProgress * 40)}|${Math.round(d.health * 40)}|${d.wood}|${Math.floor(d.food)}|${d.people}|${d.laws}|${d.hint}|${pulse}`;
    if (key === this.key) return;
    this.key = key;
    const g = this.g;
    g.fillStyle = '#2b2119';
    g.fillRect(0, 0, HW, HH);
    g.fillStyle = '#efe2c4';
    g.fillRect(2, 2, HW - 4, HH - 4);
    const ink = '#3d2c1e';

    // row 1: Age + session progress bar
    drawText(g, d.age, 6, 5, 1, ink);
    g.fillStyle = '#c9b48c';
    g.fillRect(HW - 46, 6, 40, 5);
    g.fillStyle = '#c6463a';
    g.fillRect(HW - 46, 6, Math.round(40 * Math.min(1, d.ageProgress)), 5);

    // row 2: land health bar
    drawText(g, '&', 6, 16, 1, '#c6463a');
    g.fillStyle = '#7a6448';
    g.fillRect(14, 16, HW - 20, 7);
    g.fillStyle = d.health > 0.66 ? '#5aa83c' : d.health > 0.4 ? '#d2b072' : '#9a8f80';
    g.fillRect(15, 17, Math.round((HW - 22) * Math.max(0, Math.min(1, d.health))), 5);

    // row 3: resources
    drawText(g, `[${d.wood}`, 6, 27, 1, '#7a4b2a');
    drawText(g, `$${Math.floor(d.food)}`, 40, 27, 1, '#2a7fa0');
    drawText(g, `@${d.people}`, 76, 27, 1, '#8e3b6b');
    drawText(g, `LAWS ${d.laws}`, HW - 6, 27, 1, ink, 'right');

    g.fillStyle = '#c9b48c';
    g.fillRect(6, 37, HW - 12, 1);

    // hint: up to 4 lines of 25 chars
    if (d.hint) {
      if (pulse) {
        g.fillStyle = '#ffe89a';
        g.fillRect(3, 39, HW - 6, HH - 42);
      }
      const lines = wrapText(d.hint, 25);
      let y = 42;
      for (let i = 0; i < Math.min(4, lines.length); i++) {
        drawText(g, lines[i], HW / 2, y, 1, '#5a2a14', 'center');
        y += 10;
      }
    }
    this.tex.needsUpdate = true;
  }
}

const BW = 256;
const BH = 104;

/** Big pixel-text announcement card that floats above the island. */
export class Banner {
  root = new Group();
  private g: CanvasRenderingContext2D;
  private tex: CanvasTexture;
  private mat: MeshBasicMaterial;
  private t = 0;
  private dur = 0;
  /** 0..1 current visibility (fades). */
  vis = 0;

  constructor() {
    const { g, tex } = makeCanvas(BW, BH);
    this.g = g;
    this.tex = tex;
    this.mat = new MeshBasicMaterial({ map: tex, transparent: true, opacity: 0, depthWrite: false });
    const w = 0.4;
    const mesh = new Mesh(new PlaneGeometry(w, (w * BH) / BW), this.mat);
    mesh.renderOrder = 20;
    this.root.add(mesh);
    this.root.visible = false;
  }

  /** title: big line; body: small wrapped text. duration <= 0 means stay. */
  show(title: string, body = '', duration = 3.5, style: 'stone' | 'gold' | 'night' = 'stone') {
    const g = this.g;
    g.clearRect(0, 0, BW, BH);
    const bg = style === 'gold' ? '#e6c76a' : style === 'night' ? '#1d1830' : '#d9cfbf';
    const edge = style === 'gold' ? '#8a6414' : style === 'night' ? '#e8b04a' : '#5c4a3a';
    const ink = style === 'gold' ? '#4a300a' : style === 'night' ? '#ffe7a8' : '#3d2c1e';
    g.fillStyle = edge;
    g.fillRect(2, 0, BW - 4, BH);
    g.fillRect(0, 2, BW, BH - 4);
    g.fillStyle = bg;
    g.fillRect(4, 4, BW - 8, BH - 8);
    const titleLines = wrapText(title, 20);
    let y = body ? 12 : Math.round(BH / 2 - titleLines.length * 9);
    for (const l of titleLines.slice(0, 2)) {
      drawText(g, l, BW / 2, y, 2, ink, 'center');
      y += 18;
    }
    if (body) {
      y += 4;
      for (const l of wrapText(body, 40).slice(0, 5)) {
        drawText(g, l, BW / 2, y, 1, ink, 'center');
        y += 10;
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
    this.root.scale.setScalar(0.9 + 0.1 * easeOutBack(fadeIn));
    if (this.dur > 0 && this.t >= this.dur) this.root.visible = false;
  }
}

function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}
