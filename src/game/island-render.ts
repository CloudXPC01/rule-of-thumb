/**
 * Voxel renderer for the Island. Everything is InstancedMesh so the whole
 * diorama costs a handful of draw calls. Colours are flat per-voxel with a
 * small deterministic jitter, which reads as pixel art up close.
 *
 * Health desaturation: every colour is lerped toward grey-brown as the
 * island's health drops, so harm is visible at a glance.
 */
import {
  BoxGeometry,
  Color,
  Group,
  InstancedMesh,
  Matrix4,
  MeshLambertMaterial,
  Quaternion,
  Vector3,
} from '@iwsdk/core';
import { Island, N, Tile, TILE } from './island.js';

export const PAL = {
  grass: 0x6dbb45,
  grass2: 0x5aa83c,
  dirt: 0x7b5236,
  dirtDark: 0x5c3b26,
  canopy: 0x2f8a3e,
  canopy2: 0x3fa34a,
  trunk: 0x7a4b2a,
  stump: 0xb07c47,
  dust: 0xd2b072,
  dust2: 0xc49d5e,
  water: 0x3fb3d8,
  waterDead: 0x6d7f7a,
  wetDust: 0x9c7a4c,
  hutWall: 0xf0d9a8,
  hutRoof: 0xc6463a,
  sapling: 0x8be05a,
  ember: 0xff6a1f,
  char: 0x3a2e28,
};

const COL_H = 0.05; // dirt column depth below surface
const CAP = 0.008; // coloured top cap thickness

export class IslandRender {
  root = new Group();
  private body: InstancedMesh;
  private cap: InstancedMesh;
  private trunks: InstancedMesh;
  private canopies: InstancedMesh;
  private huts: InstancedMesh;
  private roofs: InstancedMesh;
  private under: InstancedMesh;
  private m = new Matrix4();
  private q = new Quaternion();
  private p = new Vector3();
  private s = new Vector3();
  private c = new Color();
  private grey = new Color(0x9a8f80);
  private ember = new Color(PAL.ember);
  private charC = new Color(PAL.char);
  private pos = { x: 0, y: 0, z: 0 };
  private desat = 0;
  /** Per-tile pop animation timers (0..1, 1 = settled). */
  private pop: Float32Array;

  constructor(private island: Island) {
    const count = N * N;
    this.pop = new Float32Array(count).fill(1);
    const lambert = () => new MeshLambertMaterial({ color: 0xffffff });
    const box = new BoxGeometry(1, 1, 1);
    this.body = new InstancedMesh(box, lambert(), count);
    this.cap = new InstancedMesh(box, lambert(), count);
    this.trunks = new InstancedMesh(box, lambert(), count);
    this.canopies = new InstancedMesh(box, lambert(), count * 2);
    this.huts = new InstancedMesh(box, lambert(), 24);
    this.roofs = new InstancedMesh(box, lambert(), 24);
    this.under = new InstancedMesh(box, lambert(), 60);
    for (const im of [this.body, this.cap, this.trunks, this.canopies, this.huts, this.roofs, this.under]) {
      im.frustumCulled = false;
      this.root.add(im);
    }
    this.buildUnderside();
    for (let i = 0; i < count; i++) this.refreshTile(i);
  }

  /** Floating-island rocky underside: a stack of shrinking dirt rings. */
  private buildUnderside() {
    let k = 0;
    const rings = [
      { r: 0.2, y: -0.07, n: 18, sz: 0.06 },
      { r: 0.13, y: -0.11, n: 14, sz: 0.05 },
      { r: 0.06, y: -0.145, n: 9, sz: 0.04 },
      { r: 0.0, y: -0.175, n: 1, sz: 0.035 },
    ];
    for (const ring of rings) {
      for (let a = 0; a < ring.n && k < 60; a++) {
        const t = (a / ring.n) * Math.PI * 2;
        const j = hash(k * 13) * 0.02;
        this.p.set(Math.cos(t) * ring.r, ring.y - j, Math.sin(t) * ring.r);
        this.s.set(ring.sz, ring.sz * (1 + hash(k) * 0.6), ring.sz);
        this.m.compose(this.p, this.q.identity(), this.s);
        this.under.setMatrixAt(k, this.m);
        this.under.setColorAt(k, this.c.set(hash(k * 7) > 0.5 ? PAL.dirt : PAL.dirtDark));
        k++;
      }
    }
    this.under.count = k;
  }

  refreshTile(i: number) {
    const t = this.island.tiles[i];
    const isl = this.island;
    isl.centreOf(i, this.pos);
    const jitter = hash(i);
    const visible = t.type !== Tile.Void;
    const popK = easeOutBack(this.pop[i]);

    // dirt body
    this.p.set(this.pos.x, this.pos.y - COL_H / 2 - CAP, this.pos.z);
    this.s.set(visible ? TILE : 0, COL_H, visible ? TILE : 0);
    this.m.compose(this.p, this.q.identity(), this.s);
    this.body.setMatrixAt(i, this.m);
    this.tint(jitter > 0.5 ? PAL.dirt : PAL.dirtDark, 0.04, jitter);
    this.body.setColorAt(i, this.c);

    // top cap
    this.p.set(this.pos.x, this.pos.y - CAP / 2, this.pos.z);
    this.s.set(visible ? TILE : 0, CAP, visible ? TILE : 0);
    this.m.compose(this.p, this.q, this.s);
    this.cap.setMatrixAt(i, this.m);
    let top: number = jitter > 0.5 ? PAL.grass : PAL.grass2;
    if (t.type === Tile.Dust) top = t.wet > 0.3 ? PAL.wetDust : jitter > 0.5 ? PAL.dust : PAL.dust2;
    else if (t.type === Tile.Water) top = t.fish > 0 ? PAL.water : PAL.waterDead;
    else if (t.type === Tile.Stump) top = jitter > 0.5 ? PAL.grass2 : PAL.dust2;
    this.tint(top, t.type === Tile.Water ? 0 : 0.05, jitter);
    if (t.wet > 0 && t.type !== Tile.Water) this.c.multiplyScalar(1 - t.wet * 0.25);
    if (t.fire > 0) this.c.lerp(this.ember, Math.min(1, t.fire * 0.9));
    else if (t.burnt > 0) this.c.lerp(this.charC, Math.min(0.7, t.burnt * 0.15));
    this.cap.setColorAt(i, this.c);

    // trunk: trees (tall), stumps (short), saplings (thin)
    let trunkH = 0;
    let trunkW = TILE * 0.28;
    if (t.type === Tile.Tree) trunkH = 0.022 + jitter * 0.01;
    else if (t.type === Tile.Stump) trunkH = 0.008;
    else if (t.type === Tile.Sapling) {
      trunkH = 0.008 + t.growth * 0.014;
      trunkW = TILE * (0.12 + t.growth * 0.14);
    }
    this.p.set(this.pos.x, this.pos.y + trunkH / 2, this.pos.z);
    this.s.set(trunkH ? trunkW : 0, trunkH * popK, trunkH ? trunkW : 0);
    this.m.compose(this.p, this.q, this.s);
    this.trunks.setMatrixAt(i, this.m);
    this.tint(t.type === Tile.Stump ? PAL.stump : PAL.trunk, 0.05, jitter);
    this.trunks.setColorAt(i, this.c);

    // canopy: two stacked cubes for trees, one small for saplings
    const tree = t.type === Tile.Tree;
    const sap = t.type === Tile.Sapling;
    const cw = tree ? TILE * (0.85 + jitter * 0.2) : sap ? TILE * (0.3 + t.growth * 0.45) : 0;
    const baseY = this.pos.y + trunkH;
    this.p.set(this.pos.x, baseY + cw * 0.45, this.pos.z);
    this.s.setScalar(cw * popK);
    this.m.compose(this.p, this.q, this.s);
    this.canopies.setMatrixAt(i * 2, this.m);
    this.tint(sap ? PAL.sapling : jitter > 0.5 ? PAL.canopy : PAL.canopy2, 0.06, jitter);
    if (t.fire > 0) this.c.lerp(this.ember, Math.min(1, t.fire));
    this.canopies.setColorAt(i * 2, this.c);
    const cw2 = tree ? cw * 0.6 : 0;
    this.p.set(this.pos.x + (jitter - 0.5) * 0.006, baseY + cw * 0.95 + cw2 * 0.3, this.pos.z);
    this.s.setScalar(cw2 * popK);
    this.m.compose(this.p, this.q, this.s);
    this.canopies.setMatrixAt(i * 2 + 1, this.m);
    this.tint(PAL.canopy2, 0.06, 1 - jitter);
    this.canopies.setColorAt(i * 2 + 1, this.c);

    this.body.instanceMatrix.needsUpdate = true;
    this.cap.instanceMatrix.needsUpdate = true;
    this.trunks.instanceMatrix.needsUpdate = true;
    this.canopies.instanceMatrix.needsUpdate = true;
    for (const im of [this.body, this.cap, this.trunks, this.canopies]) {
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
    }
  }

  refreshHuts() {
    const huts = this.island.huts;
    for (let k = 0; k < 24; k++) {
      if (k >= huts.length) {
        this.m.makeScale(0, 0, 0);
        this.huts.setMatrixAt(k, this.m);
        this.roofs.setMatrixAt(k, this.m);
        continue;
      }
      const i = huts[k];
      this.island.centreOf(i, this.pos);
      const popK = easeOutBack(this.pop[i]);
      this.p.set(this.pos.x, this.pos.y + 0.009 * popK, this.pos.z);
      this.s.set(TILE * 0.8, 0.018 * popK, TILE * 0.7);
      this.m.compose(this.p, this.q.identity(), this.s);
      this.huts.setMatrixAt(k, this.m);
      this.tint(PAL.hutWall, 0.03, hash(i));
      this.huts.setColorAt(k, this.c);
      this.p.set(this.pos.x, this.pos.y + 0.022 * popK, this.pos.z);
      this.s.set(TILE * 0.95, 0.009 * popK, TILE * 0.85);
      this.m.compose(this.p, this.q, this.s);
      this.roofs.setMatrixAt(k, this.m);
      this.tint(PAL.hutRoof, 0.04, hash(i + 3));
      this.roofs.setColorAt(k, this.c);
    }
    this.huts.instanceMatrix.needsUpdate = true;
    this.roofs.instanceMatrix.needsUpdate = true;
    if (this.huts.instanceColor) this.huts.instanceColor.needsUpdate = true;
    if (this.roofs.instanceColor) this.roofs.instanceColor.needsUpdate = true;
  }

  /** Start a squash-pop animation on a tile. */
  popTile(i: number) {
    this.pop[i] = 0;
  }

  update(dt: number, health: number) {
    // desaturation follows health, eased
    const want = Math.max(0, Math.min(0.75, (0.75 - health) * 1.4));
    const changedDesat = Math.abs(want - this.desat) > 0.01;
    this.desat += (want - this.desat) * Math.min(1, dt * 1.5);

    const isl = this.island;
    let hutsDirty = false;
    for (let i = 0; i < this.pop.length; i++) {
      if (this.pop[i] < 1) {
        this.pop[i] = Math.min(1, this.pop[i] + dt * 2.2);
        isl.dirty.add(i);
        if (isl.tiles[i].type === Tile.Hut) hutsDirty = true;
      }
    }
    if (changedDesat) {
      for (let i = 0; i < isl.tiles.length; i++) isl.dirty.add(i);
      hutsDirty = true;
    }
    for (const i of isl.dirty) this.refreshTile(i);
    if (isl.dirty.size || hutsDirty) this.refreshHuts();
    isl.dirty.clear();
  }

  private tint(hex: number, vary: number, j: number) {
    this.c.set(hex);
    const f = 1 + (j - 0.5) * vary * 2;
    this.c.r *= f;
    this.c.g *= f;
    this.c.b *= f;
    if (this.desat > 0) this.c.lerp(this.grey, this.desat);
  }
}

export function hash(n: number): number {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

function easeOutBack(t: number): number {
  if (t >= 1) return 1;
  const c1 = 1.9;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

