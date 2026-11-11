/**
 * Island renderer (all art styles, see style.ts / design/art-direction.md).
 *
 * Everything is instanced voxels from voxel.ts: one draw call per part type.
 * Unit v = TILE / 8 (4.5 mm). Colour comes from the style palette (painted
 * styles) or the pixel atlas (textured style); per-instance tints carry fake
 * ambient occlusion and the "drought twin" that health loss fades toward.
 */
import { Color, Euler, Group, InstancedMesh, Matrix4, Quaternion, Vector3 } from '@iwsdk/core';
import { HALF, Island, N, Tile, TILE, vnoise } from './island.js';
import { C, STYLE } from './style.js';
import { glowMaterial, makeShadows, VoxelMesh } from './voxel.js';

const V = TILE / 8;
const P = STYLE.pal;
const TEX = STYLE.textured;

type Species = 0 | 1 | 2; // oak, pine, third (birch / autumn / mint)

/** Kept for other modules that want a cheap stable hash. */
export function hash(n: number): number {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

const PROPS = 46;
const LEAVES_PER = 3;
const MAX_HUTS = 24;
const HUT_PARTS = 6; // walls, roof, ridge, door, chimney, lantern post
const MAX_FLAMES = 36;

export class IslandRender {
  root = new Group();
  private cap: VoxelMesh;
  private body: VoxelMesh;
  private trunks: VoxelMesh;
  private leaves: VoxelMesh;
  private huts: VoxelMesh;
  private glow: VoxelMesh; // windows + lantern lamps (unlit)
  private flames: VoxelMesh;
  private props: VoxelMesh;
  private under: VoxelMesh;
  private shadows: InstancedMesh;

  private m = new Matrix4();
  private q = new Quaternion();
  private e = new Euler();
  private p = new Vector3();
  private s = new Vector3();
  private c = new Color();
  private c2 = new Color();
  private pos = { x: 0, y: 0, z: 0 };
  private desat = 0;
  private night = 0;
  private time = 0;
  private waterFrame = 0;
  private pop: Float32Array;
  private species: Uint8Array;
  private band: Uint8Array;
  private jx: Float32Array;
  private jz: Float32Array;
  private rot: Uint8Array;
  private propTile: Int16Array;
  private propKind: Uint8Array;
  private propOff: Float32Array;
  private nb: number[] = [];

  constructor(private island: Island) {
    const count = N * N;
    this.pop = new Float32Array(count).fill(1);
    this.species = new Uint8Array(count);
    this.band = new Uint8Array(count);
    this.jx = new Float32Array(count);
    this.jz = new Float32Array(count);
    this.rot = new Uint8Array(count);
    for (let i = 0; i < count; i++) {
      const x = i % N;
      const z = Math.floor(i / N);
      const n = vnoise(x * 0.25, z * 0.25, 1);
      this.band[i] = n < 0.38 ? 0 : n < 0.62 ? 1 : 2;
      const sp = vnoise(x * 0.3, z * 0.3, 9);
      this.species[i] = (sp > 0.62 ? 1 : hash(i * 3.3) < (STYLE.id === 'b' ? 0.12 : 0.18) ? 2 : 0) as Species;
      this.jx[i] = (hash(i * 5.1) - 0.5) * 3 * V;
      this.jz[i] = (hash(i * 7.9) - 0.5) * 3 * V;
      this.rot[i] = hash(i * 2.7) < 0.5 ? 0 : 1;
    }

    this.cap = new VoxelMesh(count);
    this.body = new VoxelMesh(count);
    this.trunks = new VoxelMesh(count);
    this.leaves = new VoxelMesh(count * LEAVES_PER);
    this.huts = new VoxelMesh(MAX_HUTS * HUT_PARTS);
    this.glow = new VoxelMesh(MAX_HUTS * 2, glowMaterial());
    this.flames = new VoxelMesh(MAX_FLAMES * 3, glowMaterial());
    this.props = new VoxelMesh(PROPS);
    this.under = new VoxelMesh(64);
    this.shadows = makeShadows(count + MAX_HUTS, 0.32);
    for (const im of [this.under, this.body, this.cap, this.shadows, this.trunks, this.leaves, this.huts, this.props, this.glow, this.flames]) {
      this.root.add(im);
    }
    this.flames.count = 0;
    this.glow.visible = false;

    this.propTile = new Int16Array(PROPS).fill(-1);
    this.propKind = new Uint8Array(PROPS);
    this.propOff = new Float32Array(PROPS * 2);
    this.placeProps();
    this.buildUnderside();
    for (let i = 0; i < count; i++) this.refreshTile(i);
    this.refreshHuts();
    this.refreshProps();
  }

  // ---------------------------------------------------------------------------
  // colour helpers
  // ---------------------------------------------------------------------------

  /** this.c = palette colour (or white when textured) with jitter, AO and drought. */
  private tint(hexCol: number, drought: number, ao = 1, j = 0.5, forceColour = false) {
    if (TEX && !forceColour) this.c.setRGB(1, 1, 1);
    else this.c.set(hexCol);
    if (STYLE.jitter) {
      const f = 1 + (j - 0.5) * STYLE.jitter * 2;
      this.c.multiplyScalar(f);
    }
    if (this.desat > 0) {
      if (TEX && !forceColour) {
        // textured: multiply toward a warm dry cast
        this.c2.set(0xe2cc8e);
        this.c.lerp(this.c2, this.desat * 0.9);
      } else {
        this.c2.set(drought);
        this.c.lerp(this.c2, this.desat);
      }
    }
    this.c.multiplyScalar(ao);
  }

  private aoOf(i: number): number {
    const isl = this.island;
    const x = i % N;
    const z = Math.floor(i / N);
    let ao = 1;
    for (const [dx, dz] of ORTHO) {
      const t = isl.at(x + dx, z + dz);
      if (!t || t.type === Tile.Void) ao *= 0.92; // rim
      else if (t.type === Tile.Tree || t.type === Tile.Hut) ao *= 0.88;
    }
    return Math.max(0.68, ao);
  }

  private nearWater(i: number): boolean {
    const x = i % N;
    const z = Math.floor(i / N);
    let n = 0;
    for (const [dx, dz] of ORTHO) if (this.island.at(x + dx, z + dz)?.type === Tile.Water) n++;
    // only the inner bank: tiles touching water on two sides, or one side + noise
    return n >= 2 || (n === 1 && hash(i * 6.1) < 0.45);
  }

  // ---------------------------------------------------------------------------
  // static geometry
  // ---------------------------------------------------------------------------

  private buildUnderside() {
    let k = 0;
    const put = (x: number, y: number, z: number, sx: number, sy: number, sz: number, col: number, cell: number) => {
      if (k >= 64) return;
      this.p.set(x, y, z);
      this.s.set(sx, sy, sz);
      this.m.compose(this.p, this.q.identity(), this.s);
      this.under.setMatrixAt(k, this.m);
      this.tint(col, col, 1, hash(k * 3.7));
      this.under.setColorAt(k, this.c);
      this.under.setCells(k, cell, cell, cell);
      k++;
    };
    const base = -TILE - (TEX ? TILE : 0.009);
    const rings = [
      { r: 0.19, y: base - 0.02, n: 16, sz: 0.06, col: P.dirt[1], cell: C.dirtSide },
      { r: 0.12, y: base - 0.055, n: 12, sz: 0.055, col: P.dirt[2], cell: C.dirtSide },
      { r: 0.06, y: base - 0.09, n: 8, sz: 0.045, col: P.stone[1], cell: C.stone },
    ];
    for (const ring of rings) {
      for (let a = 0; a < ring.n; a++) {
        const t = (a / ring.n) * Math.PI * 2 + ring.r * 3;
        const j = hash(k * 13) * 0.018;
        put(Math.cos(t) * ring.r, ring.y - j, Math.sin(t) * ring.r, ring.sz, ring.sz * (1 + hash(k) * 0.5), ring.sz, ring.col, ring.cell);
      }
    }
    // tapering stone stalactite
    const sizes = [8, 6, 4, 3, 2];
    let y = base - 0.11;
    for (let i = 0; i < sizes.length; i++) {
      const s = sizes[i] * V;
      put((hash(i + 40) - 0.5) * 0.01, y, (hash(i + 50) - 0.5) * 0.01, s, s * 1.2, s, P.stone[i % 2], C.stone);
      y -= s * 1.1;
    }
    // hanging vines on the textured style
    if (TEX) {
      for (let v = 0; v < 4; v++) {
        const a = v * 1.7 + 0.4;
        put(Math.cos(a) * 0.205, base - 0.045, Math.sin(a) * 0.205, V, 6 * V, V, P.pine, C.pine);
      }
    }
    this.under.count = k;
    this.under.touch();
  }

  private placeProps() {
    // deterministic scatter on grass tiles away from trees and the village core
    const isl = this.island;
    let k = 0;
    const want = [
      { kind: 0, n: 24 }, // grass tuft
      { kind: 1, n: 12 }, // flower
      { kind: 2, n: 8 }, // rock
    ];
    let seed = 1;
    for (const w of want) {
      let placed = 0;
      for (let tries = 0; tries < 600 && placed < w.n && k < PROPS; tries++) {
        const i = Math.floor(hash(seed++ * 1.37) * isl.tiles.length);
        const t = isl.tiles[i];
        if (t.type !== Tile.Grass && !(w.kind === 2 && t.type === Tile.Tree)) continue;
        if (i === isl.centre) continue;
        this.propTile[k] = i;
        this.propKind[k] = w.kind;
        this.propOff[k * 2] = (hash(seed * 3.1) - 0.5) * TILE * 0.7;
        this.propOff[k * 2 + 1] = (hash(seed * 5.3) - 0.5) * TILE * 0.7;
        k++;
        placed++;
      }
    }
  }

  refreshProps() {
    const isl = this.island;
    for (let k = 0; k < PROPS; k++) {
      const i = this.propTile[k];
      const t = i >= 0 ? isl.tiles[i] : null;
      const kind = this.propKind[k];
      const show = t && (t.type === Tile.Grass || (kind === 2 && (t.type === Tile.Tree || t.type === Tile.Stump || t.type === Tile.Dust)));
      if (!t || !show) {
        this.m.makeScale(0, 0, 0);
        this.props.setMatrixAt(k, this.m);
        continue;
      }
      isl.centreOf(i, this.pos);
      const ox = this.propOff[k * 2];
      const oz = this.propOff[k * 2 + 1];
      const hj = hash(k * 9.1);
      if (kind === 0) {
        this.p.set(this.pos.x + ox, this.pos.y + 0.75 * V, this.pos.z + oz);
        this.s.set(V * 0.9, V * (1.2 + hj), V * 0.9);
        this.tint(P.grass[2], P.dGrass, 0.9, hj);
        this.props.setCells(k, C.grassTop2, C.grassTop1);
      } else if (kind === 1) {
        this.p.set(this.pos.x + ox, this.pos.y + 0.6 * V, this.pos.z + oz);
        this.s.set(V, V, V);
        const fc = [0xe8c547, 0xd97b8a, 0xf2efe6][k % 3];
        this.tint(fc, P.dGrass, 1, hj, true);
        this.props.setCells(k, C.white);
      } else {
        this.p.set(this.pos.x + ox, this.pos.y + 0.5 * V, this.pos.z + oz);
        this.s.set(2 * V * (0.8 + hj * 0.6), V * (0.8 + hj * 0.6), 2 * V);
        this.tint(P.stone[k % 2], P.stone[1], 1, hj);
        this.props.setCells(k, C.stone);
      }
      this.q.setFromEuler(this.e.set(0, hj * 3, 0));
      this.m.compose(this.p, this.q, this.s);
      this.props.setMatrixAt(k, this.m);
      this.props.setColorAt(k, this.c);
    }
    this.props.touch();
  }

  // ---------------------------------------------------------------------------
  // per-tile refresh
  // ---------------------------------------------------------------------------

  refreshTile(i: number) {
    const t = this.island.tiles[i];
    const isl = this.island;
    isl.centreOf(i, this.pos);
    const j = hash(i);
    const visible = t.type !== Tile.Void;
    const popK = easeOutBack(this.pop[i]);
    const ao = visible ? this.aoOf(i) : 1;
    const capH = TEX ? TILE : 0.009;
    const bodyH = TEX ? TILE : 0.05;

    // --- body: dirt column under the cap
    this.p.set(this.pos.x, this.pos.y - capH - bodyH / 2, this.pos.z);
    this.s.set(visible ? TILE : 0, bodyH, visible ? TILE : 0);
    this.m.compose(this.p, this.q.identity(), this.s);
    this.body.setMatrixAt(i, this.m);
    this.tint(j > 0.5 ? P.dirt[0] : P.dirt[1], P.dirt[1], 1, j);
    this.body.setColorAt(i, this.c);
    this.body.setCells(i, C.dirtTop, C.dirtSide, C.dirtSide);

    // --- cap: the walkable top
    this.p.set(this.pos.x, this.pos.y - capH / 2, this.pos.z);
    this.s.set(visible ? TILE : 0, capH, visible ? TILE : 0);
    this.m.compose(this.p, this.q, this.s);
    this.cap.setMatrixAt(i, this.m);

    let topCell: number = [C.grassTop0, C.grassTop1, C.grassTop2][this.band[i]];
    if (TEX && hash(i * 4.4) < 0.25) topCell = C.grassTop3;
    let sideCell: number = C.grassSide;
    let col = P.grass[this.band[i]];
    let dry = P.dGrass;
    let forceCol = false;
    if (t.type === Tile.Water) {
      topCell = C.water0 + this.waterFrame;
      sideCell = C.sand;
      col = t.fish > 0 ? (t.fish >= 2 ? P.waterShallow : P.waterDeep) : P.dWater;
      dry = P.dWater;
      if (TEX && t.fish === 0) {
        col = P.dWater;
        forceCol = true;
      }
    } else if (t.type === Tile.Dust) {
      topCell = C.dustTop;
      sideCell = C.grassSide;
      col = t.wet > 0.3 ? P.dirt[0] : P.dust;
      dry = P.dust;
    } else if (t.burnt > 0.5 && t.type !== Tile.Hut) {
      topCell = C.char;
      col = P.char;
    } else if (this.nearWater(i) && (t.type === Tile.Grass || t.type === Tile.Stump)) {
      topCell = C.sand;
      col = P.sand;
      dry = P.sand;
    }
    const rimTile = this.isRim(i);
    this.tint(col, dry, ao * (rimTile && STYLE.rim ? 1.12 : 1), j, forceCol);
    if (t.wet > 0.3 && t.type !== Tile.Water) this.c.multiplyScalar(0.82);
    if (t.fire > 0) {
      this.c2.set(P.ember);
      this.c.lerp(this.c2, Math.min(0.85, t.fire * 0.8));
    }
    this.cap.setColorAt(i, this.c);
    this.cap.setCells(i, topCell, sideCell, C.dirtSide);

    // --- trees / saplings / stumps: trunk + up to 3 leaf boxes
    const sp = this.species[i] as Species;
    const tree = t.type === Tile.Tree;
    const sap = t.type === Tile.Sapling;
    const stump = t.type === Tile.Stump;
    const ox = this.pos.x + (tree || sap ? this.jx[i] : 0);
    const oz = this.pos.z + (tree || sap ? this.jz[i] : 0);
    const baseY = this.pos.y;
    this.q.setFromEuler(this.e.set(0, this.rot[i] ? Math.PI / 2 : 0, 0));
    const fire = t.fire;
    const leafCol = sp === 0 ? P.oak : sp === 1 ? P.pine : P.third;
    const leafCell = sp === 0 ? C.oak : sp === 1 ? C.pine : STYLE.id === 'b' ? C.autumn : C.birch;

    // trunk
    let tw = 0, th = 0, ty = 0;
    let trunkCol = P.wood;
    let trunkCell: number = C.bark;
    if (tree) {
      if (sp === 0) { tw = 2 * V; th = 5 * V; }
      else if (sp === 1) { tw = V; th = 2 * V; }
      else {
        tw = V; th = 7 * V;
        if (STYLE.id !== 'b') { trunkCol = P.birchBark; trunkCell = C.birchBark; }
      }
      ty = baseY + (th * popK) / 2;
    } else if (sap) {
      tw = V * (0.8 + t.growth * 0.6);
      th = V * (2 + t.growth * 2);
      ty = baseY + (th * popK) / 2;
    } else if (stump) {
      tw = 3 * V; th = 1.5 * V;
      ty = baseY + th / 2;
    }
    this.p.set(ox, ty, oz);
    this.s.set(tw, th * (stump ? 1 : popK), tw);
    this.m.compose(this.p, this.q, this.s);
    this.trunks.setMatrixAt(i, this.m);
    this.tint(trunkCol, 0x6d5a48, 1, j);
    if (stump) this.trunks.setCells(i, C.woodEnd, C.bark);
    else this.trunks.setCells(i, C.woodEnd, trunkCell);
    if (fire > 0) { this.c2.set(P.char); this.c.lerp(this.c2, Math.min(0.7, t.burnt * 0.12)); }
    this.trunks.setColorAt(i, this.c);

    // leaves
    for (let l = 0; l < LEAVES_PER; l++) {
      const li = i * LEAVES_PER + l;
      let w = 0, h = 0, y = 0, dx = 0, dz = 0;
      if (tree) {
        if (sp === 0) {
          if (l === 0) { w = 6 * V; h = 4 * V; y = 5 * V + 2 * V; }
          else if (l === 1) { w = 4 * V; h = 3 * V; y = 9 * V + 1.5 * V; dx = V; dz = -V; }
        } else if (sp === 1) {
          const tiers = [6, 4, 2];
          w = tiers[l] * V; h = 2 * V; y = (2 + l * 2) * V + V;
        } else if (l === 0) {
          w = 3 * V; h = 4 * V; y = 5 * V + 2 * V;
          if (STYLE.id === 'b') { w = 6 * V; h = 4 * V; } // autumn oak
        }
        // gentle per-tree size variety
        const sv = 0.9 + hash(i * 1.9) * 0.2;
        w *= sv; h *= sv; y *= sv;
      } else if (sap && l === 0) {
        w = V * (2 + t.growth * 2.5); h = w; y = V * (2 + t.growth * 2) + w / 2;
      }
      if (this.rot[i]) { const tmp = dx; dx = dz; dz = -tmp; }
      this.p.set(ox + dx, baseY + y * popK, oz + dz);
      this.s.set(w * popK, h * popK, w * popK);
      this.m.compose(this.p, this.q, this.s);
      this.leaves.setMatrixAt(li, this.m);
      const shade = l === 1 ? 1.08 : 1; // upper crowns catch more light
      this.tint(sap ? P.grass[2] : leafCol, P.dFoliage, shade, hash(i * 3 + l));
      if (fire > 0) { this.c2.set(P.ember); this.c.lerp(this.c2, Math.min(0.9, fire)); }
      this.leaves.setColorAt(li, this.c);
      this.leaves.setCells(li, sap ? C.birch : leafCell);
    }

    // contact shadow under objects
    const sh = tree ? 1.1 : stump ? 0.55 : sap ? 0.5 : 0;
    this.p.set(ox, baseY + 0.0006, oz);
    this.s.setScalar(sh * TILE * (tree || sap ? popK : 1));
    this.m.compose(this.p, this.q.identity(), this.s);
    this.shadows.setMatrixAt(i, this.m);
  }

  private isRim(i: number): boolean {
    const x = i % N;
    const z = Math.floor(i / N);
    for (const [dx, dz] of ORTHO) {
      const t = this.island.at(x + dx, z + dz);
      if (!t || t.type === Tile.Void) return true;
    }
    return false;
  }

  refreshHuts() {
    const huts = this.island.huts;
    const hs = STYLE.hutScale;
    let g = 0;
    for (let k = 0; k < MAX_HUTS; k++) {
      const base = k * HUT_PARTS;
      if (k >= huts.length) {
        this.m.makeScale(0, 0, 0);
        for (let p = 0; p < HUT_PARTS; p++) this.huts.setMatrixAt(base + p, this.m);
        this.shadows.setMatrixAt(N * N + k, this.m);
        continue;
      }
      const i = huts[k];
      this.island.centreOf(i, this.pos);
      const popK = easeOutBack(this.pop[i]);
      // door faces the island centre (snapped to 90 degrees)
      const ang = Math.atan2(-this.pos.x, -this.pos.z);
      const yaw = Math.round(ang / (Math.PI / 2)) * (Math.PI / 2);
      this.q.setFromEuler(this.e.set(0, yaw, 0));
      const fx = Math.sin(yaw), fz = Math.cos(yaw);
      const j = hash(i);
      const part = (idx: number, lx: number, ly: number, lz: number, sx: number, sy: number, sz: number, col: number, top: number, side: number) => {
        // local (lx, lz) rotated by yaw
        const wx = this.pos.x + (lx * Math.cos(yaw) + lz * Math.sin(yaw)) * hs;
        const wz = this.pos.z + (-lx * Math.sin(yaw) + lz * Math.cos(yaw)) * hs;
        this.p.set(wx, this.pos.y + ly * hs * popK, wz);
        this.s.set(sx * hs * popK, sy * hs * popK, sz * hs * popK);
        this.m.compose(this.p, this.q, this.s);
        this.huts.setMatrixAt(base + idx, this.m);
        this.tint(col, P.dWall, 1, j);
        this.huts.setColorAt(base + idx, this.c);
        this.huts.setCells(base + idx, top, side, side);
      };
      part(0, 0, 2 * V, 0, 6 * V, 4 * V, 5 * V, P.wall, C.wall, C.wall); // walls
      part(1, 0, 4.5 * V, 0, 8 * V, V, 7 * V, P.roof, C.roof, C.roof); // roof slab with overhang
      part(2, 0, 5.5 * V, 0, 8 * V, V, 3 * V, P.roof, C.roof, C.roof); // ridge
      part(3, 0, 1.5 * V, 2.55 * V, 2 * V, 3 * V, 0.3 * V, P.door, C.door, C.door); // door
      part(4, 2 * V, 6 * V, -1.5 * V, V, 2 * V, V, P.stone[0], C.stone, C.stone); // chimney
      part(5, 3.6 * V, 2 * V, 3.2 * V, 0.6 * V, 4 * V, 0.6 * V, P.wood, C.woodEnd, C.bark); // lantern post
      // glow bits: window on the door side, lamp atop the post
      const gw = (lx: number, ly: number, lz: number, s: number) => {
        const wx = this.pos.x + (lx * Math.cos(yaw) + lz * Math.sin(yaw)) * hs;
        const wz = this.pos.z + (-lx * Math.sin(yaw) + lz * Math.cos(yaw)) * hs;
        this.p.set(wx, this.pos.y + ly * hs * popK, wz);
        this.s.set(s * hs, s * hs, s * hs);
        this.m.compose(this.p, this.q, this.s);
        this.glow.setMatrixAt(g, this.m);
        this.c.set(0xffc061);
        this.glow.setColorAt(g, this.c);
        this.glow.setCells(g, C.window);
        g++;
      };
      gw(-1.8 * V, 2.4 * V, 2.55 * V, 1.1 * V);
      gw(3.6 * V, 4.4 * V, 3.2 * V, 0.9 * V);
      // contact shadow
      this.p.set(this.pos.x, this.pos.y + 0.0006, this.pos.z);
      this.s.setScalar(1.3 * TILE * hs * popK);
      this.m.compose(this.p, this.q.identity(), this.s);
      this.shadows.setMatrixAt(N * N + k, this.m);
      void fx; void fz;
    }
    this.glow.count = g;
    this.huts.touch();
    this.glow.touch();
    this.shadows.instanceMatrix.needsUpdate = true;
  }

  /** Start a squash-pop animation on a tile. */
  popTile(i: number) {
    this.pop[i] = 0;
  }

  /** 0 = day, 1 = full night (windows and lanterns lit). */
  setNight(v: number) {
    this.night = v;
    this.glow.visible = v > 0.05;
  }

  update(dt: number, health: number) {
    this.time += dt;
    const want = Math.max(0, Math.min(0.85, (0.78 - health) * 1.6));
    const changedDesat = Math.abs(want - this.desat) > 0.01;
    this.desat += (want - this.desat) * Math.min(1, dt * 1.5);

    const isl = this.island;
    let hutsDirty = false;
    let propsDirty = false;
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
      propsDirty = true;
    }
    // animate water: swap atlas frames at 4 fps
    const wf = Math.floor(this.time * 4) % 3;
    if (wf !== this.waterFrame) {
      this.waterFrame = wf;
      for (let i = 0; i < isl.tiles.length; i++) if (isl.tiles[i].type === Tile.Water) isl.dirty.add(i);
    }
    if (isl.dirty.size) {
      for (const i of isl.dirty) {
        this.refreshTile(i);
        // AO depends on neighbours: refresh orthogonal neighbours' caps too
        const x = i % N, z = Math.floor(i / N);
        for (const [dx, dz] of ORTHO) {
          const nx = x + dx, nz = z + dz;
          if (nx >= 0 && nz >= 0 && nx < N && nz < N && !isl.dirty.has(nz * N + nx)) this.refreshCapOnly(nz * N + nx);
        }
        propsDirty = true;
      }
      this.cap.touch();
      this.body.touch();
      this.trunks.touch();
      this.leaves.touch();
      this.shadows.instanceMatrix.needsUpdate = true;
      hutsDirty = true;
    }
    if (hutsDirty) this.refreshHuts();
    if (propsDirty) this.refreshProps();
    isl.dirty.clear();
    this.updateFlames();
  }

  private refreshCapOnly(i: number) {
    // cheap path: recompute only the cap colour (for neighbour AO)
    const t = this.island.tiles[i];
    if (t.type === Tile.Void) return;
    this.refreshTile(i);
  }

  private updateFlames() {
    const isl = this.island;
    let n = 0;
    for (let i = 0; i < isl.tiles.length && n < MAX_FLAMES; i++) {
      const t = isl.tiles[i];
      if (t.fire <= 0) continue;
      isl.centreOf(i, this.pos);
      const tall = t.type === Tile.Tree ? 6 * V : t.type === Tile.Hut ? 4 * V : 0;
      const sizes = [2, 1.5, 1];
      const cols = [0xff7a1f, 0xffb02e, 0xffe27a];
      for (let k = 0; k < 3; k++) {
        const fl = 1 + 0.15 * Math.sin(this.time * 18 + i * 1.7 + k * 2.1);
        const s = sizes[k] * V * (0.6 + t.fire * 0.6) * fl;
        this.p.set(this.pos.x + Math.sin(this.time * 7 + i + k) * 0.3 * V, this.pos.y + tall + (k * 1.4 + 1) * V * (0.7 + t.fire * 0.5), this.pos.z);
        this.q.setFromEuler(this.e.set(0, this.time * 2 + i, 0));
        this.s.set(s, s * 1.3, s);
        this.m.compose(this.p, this.q, this.s);
        this.flames.setMatrixAt(n * 3 + k, this.m);
        this.c.set(cols[k]);
        this.flames.setColorAt(n * 3 + k, this.c);
        this.flames.setCells(n * 3 + k, C.white);
      }
      n++;
    }
    this.flames.count = n * 3;
    if (n) this.flames.touch();
  }
}

const ORTHO = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

function easeOutBack(t: number): number {
  if (t >= 1) return 1;
  const c1 = 1.9;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

// HALF is re-exported for callers that place things relative to the grid
export { HALF };
