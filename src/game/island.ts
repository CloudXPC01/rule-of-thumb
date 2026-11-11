/**
 * Island simulation state: a square grid of voxel tiles masked to a circle.
 * Pure data + rules, no rendering. Coordinates are Stage-local metres with
 * the island top surface around y = 0.
 */

export enum Tile {
  Void = 0,
  Grass = 1,
  Tree = 2,
  Stump = 3,
  Dust = 4,
  Water = 5,
  Sapling = 6,
  Hut = 7,
}

export const N = 14;
export const TILE = 0.036;
export const HALF = ((N - 1) / 2) * TILE;

export interface TileState {
  type: Tile;
  /** Column height offset above base (m), gives the voxel terrain relief. */
  h: number;
  /** 0..1 growth for saplings. */
  growth: number;
  /** 0..1 wetness from rain, decays. */
  wet: number;
  /** Accumulated rain on dust; heals into grass at 1. */
  soak: number;
  /** Reserved by a villager (index) or -1. */
  claimedBy: number;
  /** Seconds since last change, for pop animations. */
  age: number;
  /** Fish count for water tiles. */
  fish: number;
}

export class Island {
  tiles: TileState[] = [];
  /** Indices changed this frame; the renderer drains this. */
  dirty = new Set<number>();
  /** Village centre tile index. */
  centre = 0;
  wood = 0;
  huts: number[] = [];

  constructor(seed = 7) {
    let s = seed;
    const rand = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    const c = (N - 1) / 2;
    for (let z = 0; z < N; z++) {
      for (let x = 0; x < N; x++) {
        const d = Math.hypot(x - c, z - c);
        const inside = d <= c + 0.35;
        const type = inside ? Tile.Grass : Tile.Void;
        const h = inside ? Math.max(0, 0.012 - d * 0.0012) + Math.floor(rand() * 2) * 0.004 : 0;
        this.tiles.push({ type, h, growth: 0, wet: 0, soak: 0, claimedBy: -1, age: 99, fish: 0 });
      }
    }
    // Pond (front-left from the player's view, player looks toward -z... stage faces player at +z)
    for (const [x, z] of [
      [3, 8], [4, 8], [3, 9], [4, 9], [5, 9], [4, 10], [3, 10], [2, 9],
    ]) {
      const t = this.at(x, z);
      if (t && t.type !== Tile.Void) {
        t.type = Tile.Water;
        t.h = -0.004;
        t.fish = 3;
      }
    }
    // Forest: most of the back half and the right side.
    for (let i = 0; i < this.tiles.length; i++) {
      const t = this.tiles[i];
      if (t.type !== Tile.Grass) continue;
      const x = i % N;
      const z = Math.floor(i / N);
      const back = z < 6;
      const right = x > 8;
      if ((back || right) && rand() < 0.72) {
        t.type = Tile.Tree;
        t.growth = 1;
      } else if (rand() < 0.12) {
        t.type = Tile.Tree;
        t.growth = 1;
      }
    }
    // Village clearing near the centre-front.
    this.centre = this.index(7, 8);
    for (let z = 7; z <= 9; z++) {
      for (let x = 6; x <= 8; x++) {
        const t = this.at(x, z)!;
        if (t.type !== Tile.Water) t.type = Tile.Grass;
      }
    }
    this.setType(this.index(6, 7), Tile.Hut);
    this.huts.push(this.index(6, 7));
    for (let i = 0; i < this.tiles.length; i++) this.dirty.add(i);
  }

  index(x: number, z: number): number {
    return z * N + x;
  }

  at(x: number, z: number): TileState | undefined {
    if (x < 0 || z < 0 || x >= N || z >= N) return undefined;
    return this.tiles[this.index(x, z)];
  }

  /** Stage-local centre of tile i (top surface y). */
  centreOf(i: number, out: { x: number; y: number; z: number }) {
    out.x = (i % N) * TILE - HALF;
    out.z = Math.floor(i / N) * TILE - HALF;
    out.y = this.tiles[i].h;
    return out;
  }

  /** Tile index under a Stage-local x/z, or -1. */
  tileAtLocal(x: number, z: number): number {
    const ix = Math.round((x + HALF) / TILE);
    const iz = Math.round((z + HALF) / TILE);
    if (ix < 0 || iz < 0 || ix >= N || iz >= N) return -1;
    const i = this.index(ix, iz);
    return this.tiles[i].type === Tile.Void ? -1 : i;
  }

  setType(i: number, type: Tile) {
    const t = this.tiles[i];
    if (t.type === type) return;
    t.type = type;
    t.age = 0;
    if (type === Tile.Sapling) t.growth = 0;
    if (type === Tile.Tree) t.growth = 1;
    if (type !== Tile.Dust) t.soak = 0;
    this.dirty.add(i);
  }

  neighbours(i: number, out: number[]): number[] {
    out.length = 0;
    const x = i % N;
    const z = Math.floor(i / N);
    for (const [dx, dz] of NEIGH) {
      const nx = x + dx;
      const nz = z + dz;
      if (nx < 0 || nz < 0 || nx >= N || nz >= N) continue;
      const j = this.index(nx, nz);
      if (this.tiles[j].type !== Tile.Void) out.push(j);
    }
    return out;
  }

  count(type: Tile): number {
    let n = 0;
    for (const t of this.tiles) if (t.type === type) n++;
    return n;
  }

  /** 0 = wasteland, 1 = lush. */
  health(): number {
    let land = 0;
    let good = 0;
    for (const t of this.tiles) {
      if (t.type === Tile.Void || t.type === Tile.Water || t.type === Tile.Hut) continue;
      land++;
      if (t.type === Tile.Tree) good += 1;
      else if (t.type === Tile.Sapling) good += 0.6 + 0.4 * t.growth;
      else if (t.type === Tile.Grass) good += 0.55;
      else if (t.type === Tile.Stump) good += 0.15;
    }
    return land ? Math.min(1, good / (land * 0.8)) : 0;
  }
}

const NEIGH = [
  [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1],
] as const;
