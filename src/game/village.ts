/**
 * Village simulation: villagers with needs and jobs, plus the active laws
 * (commandments) that change how they behave. Pure logic, no rendering.
 */
import { Island, Tile, TILE } from './island.js';

export type LawId =
  | 'replant' // faithful: replant after chopping
  | 'stumpsHoly' // misread: worship stumps, chop less
  | 'waterDust' // faithful: carry water to dust
  | 'rainDance' // misread: dance when the cloud is near
  | 'fishQuota' // faithful: leave ponds with < 2 fish alone
  | 'fishSky' // misread: throw fish up to the Hand
  | 'fireWatch' // faithful: fires never spread
  | 'noWarmth'; // misread: no fires at all; they shiver

export enum VState {
  Idle,
  Walk,
  Chop,
  Plant,
  Fish,
  Carry,
  Water,
  Watching,
  Worship,
  Dance,
  Cheer,
  Flee,
  Throw,
}

export enum Job {
  None,
  Chop,
  Fish,
  WaterDust,
  WorshipStump,
}

export interface Villager {
  id: number;
  x: number;
  z: number;
  y: number;
  heading: number;
  state: VState;
  job: Job;
  timer: number;
  target: number; // tile index
  carrying: 0 | 1 | 2 | 3; // nothing, log, fish, water
  tunic: number;
  /** Seconds the Hand has been looking at this villager. */
  gazed: number;
  /** Remaining seconds of "witness" attention after being chosen. */
  watching: number;
  /** Look-up blend 0..1 for the render. */
  lookUp: number;
  hop: number;
  shiver: number;
  bob: number;
  speech: number; // seconds left of gibberish bubble
}

export const TUNICS = [0xe8a33c, 0x4b7bd1, 0xd9534f, 0x8e5bd1, 0x3cb3a8, 0xe07bb5, 0xf2e05c, 0x7fbf4d];

export interface VillageEvents {
  onChop?(tile: number, v: Villager): void;
  onPlant?(tile: number, v: Villager): void;
  onHutBuilt?(tile: number): void;
  onBirth?(v: Villager): void;
  onFish?(tile: number, v: Villager): void;
  onThrowFish?(v: Villager): void;
  onWaterDust?(tile: number, v: Villager): void;
}

const SPEED = 0.03; // m/s on a 0.5 m island
const MAX_VILLAGERS = 16;
const WOOD_PER_HUT = 5;

export class Village {
  villagers: Villager[] = [];
  laws = new Set<LawId>();
  food = 6;
  /** Cloud position in stage-local space, written by the god system. */
  cloud = { x: 0, z: 0, active: false };
  events: VillageEvents = {};
  private nb: number[] = [];
  private rng = 12345;

  constructor(private island: Island) {
    for (let k = 0; k < 5; k++) this.spawn(island.centre);
  }

  rand(): number {
    this.rng = (this.rng * 16807) % 2147483647;
    return this.rng / 2147483647;
  }

  spawn(nearTile: number): Villager | null {
    if (this.villagers.length >= MAX_VILLAGERS) return null;
    const p = { x: 0, y: 0, z: 0 };
    this.island.centreOf(nearTile, p);
    const v: Villager = {
      id: this.villagers.length,
      x: p.x + (this.rand() - 0.5) * TILE * 2,
      z: p.z + (this.rand() - 0.5) * TILE * 2,
      y: p.y,
      heading: this.rand() * Math.PI * 2,
      state: VState.Idle,
      job: Job.None,
      timer: this.rand() * 2,
      target: -1,
      carrying: 0,
      tunic: TUNICS[this.villagers.length % TUNICS.length],
      gazed: 0,
      watching: 0,
      lookUp: 0,
      hop: 0,
      shiver: 0,
      bob: this.rand() * 10,
      speech: 0,
    };
    this.villagers.push(v);
    return v;
  }

  update(dt: number, time: number) {
    const isl = this.island;
    // food: everybody eats slowly
    this.food = Math.max(0, this.food - dt * this.villagers.length * 0.012);

    for (const v of this.villagers) {
      v.bob += dt * (v.state === VState.Walk ? 14 : 3);
      if (v.hop > 0) v.hop = Math.max(0, v.hop - dt * 3);
      if (v.speech > 0) v.speech -= dt;
      const shivering = this.laws.has('noWarmth');
      v.shiver = shivering ? 1 : Math.max(0, v.shiver - dt);

      // Being watched by the Hand overrides work.
      if (v.watching > 0) {
        v.watching -= dt;
        v.lookUp = Math.min(1, v.lookUp + dt * 5);
        if (v.state !== VState.Watching) {
          v.state = VState.Watching;
          v.hop = 1;
        }
        continue;
      } else if (v.state === VState.Watching) {
        v.state = VState.Idle;
        v.timer = 0.4;
      }
      v.lookUp = Math.max(0, v.lookUp - dt * 2);

      // terrain height under feet
      const ti = isl.tileAtLocal(v.x, v.z);
      if (ti >= 0) v.y += (isl.tiles[ti].h - v.y) * Math.min(1, dt * 10);

      // Rain dance overrides everything when the cloud hovers near.
      if (this.laws.has('rainDance') && this.cloud.active) {
        const d = Math.hypot(this.cloud.x - v.x, this.cloud.z - v.z);
        if (d < 0.18 && v.carrying === 0) {
          v.state = VState.Dance;
          v.heading += dt * 6;
          v.hop = Math.max(v.hop, 0.5 + 0.5 * Math.sin(time * 8 + v.id));
          continue;
        }
      }

      const workSpeed = shivering ? 0.6 : 1;

      switch (v.state) {
        case VState.Idle:
        case VState.Dance:
        case VState.Cheer:
          v.timer -= dt;
          if (v.state === VState.Cheer) v.hop = Math.max(v.hop, 0.6 + 0.4 * Math.sin(time * 12 + v.id));
          if (v.timer <= 0) this.chooseJob(v);
          break;
        case VState.Walk:
          if (this.walkTo(v, v.target, dt * workSpeed)) this.arrive(v);
          break;
        case VState.Chop:
          v.timer -= dt * workSpeed;
          if (isl.tiles[v.target].type !== Tile.Tree) {
            this.release(v);
            v.state = VState.Idle;
            break;
          }
          if (v.timer <= 0) {
            isl.setType(v.target, Tile.Stump);
            this.events.onChop?.(v.target, v);
            v.carrying = 1;
            if (this.laws.has('replant')) {
              v.state = VState.Plant;
              v.timer = 1.0;
            } else {
              this.release(v);
              this.goHome(v);
            }
          }
          break;
        case VState.Plant:
          v.timer -= dt;
          if (v.timer <= 0) {
            if (isl.tiles[v.target].type === Tile.Stump) {
              isl.setType(v.target, Tile.Sapling);
              this.events.onPlant?.(v.target, v);
            }
            this.release(v);
            this.goHome(v);
          }
          break;
        case VState.Fish:
          v.timer -= dt * workSpeed;
          if (v.timer <= 0) {
            const t = isl.tiles[v.target];
            if (t.fish > 0) {
              t.fish--;
              isl.dirty.add(v.target);
              v.carrying = 2;
              this.events.onFish?.(v.target, v);
            }
            this.release(v);
            if (this.laws.has('fishSky') && v.carrying === 2) {
              v.state = VState.Throw;
              v.timer = 1.2;
              v.hop = 1;
            } else this.goHome(v);
          }
          break;
        case VState.Throw:
          v.timer -= dt;
          if (v.timer <= 0) {
            this.events.onThrowFish?.(v);
            v.carrying = 0;
            v.state = VState.Idle;
            v.timer = 1;
          }
          break;
        case VState.Water:
          v.timer -= dt;
          if (v.timer <= 0) {
            const t = isl.tiles[v.target];
            if (t.type === Tile.Dust) {
              t.soak += 0.5;
              t.wet = 1;
              isl.dirty.add(v.target);
              this.events.onWaterDust?.(v.target, v);
            }
            v.carrying = 0;
            this.release(v);
            v.state = VState.Idle;
            v.timer = 0.5;
          }
          break;
        case VState.Worship:
          v.timer -= dt;
          v.hop = Math.max(v.hop, 0.3 * (1 + Math.sin(time * 5 + v.id)));
          if (v.timer <= 0) {
            this.release(v);
            v.state = VState.Idle;
            v.timer = 0.5;
          }
          break;
        case VState.Carry:
          if (this.walkTo(v, v.target, dt * workSpeed)) {
            if (v.carrying === 1) {
              isl.wood++;
              if (isl.wood >= WOOD_PER_HUT) this.buildHut();
            } else if (v.carrying === 2) {
              this.food += 3;
            }
            v.carrying = 0;
            v.state = VState.Idle;
            v.timer = 0.6 + this.rand() * 1.5;
          }
          break;
      }
    }
  }

  private chooseJob(v: Villager) {
    const isl = this.island;
    const hungry = this.food < this.villagers.length * 0.8;
    // Faithful water carrying: if there is dust, sometimes go water it.
    if (this.laws.has('waterDust') && this.rand() < 0.35) {
      const pond = this.nearest(v, (t) => isl.tiles[t].type === Tile.Water);
      const dust = this.nearest(v, (t) => isl.tiles[t].type === Tile.Dust && isl.tiles[t].claimedBy < 0);
      if (pond >= 0 && dust >= 0) {
        v.carrying = 3;
        this.claim(v, dust);
        v.job = Job.WaterDust;
        v.state = VState.Walk;
        return;
      }
    }
    if (this.laws.has('stumpsHoly') && this.rand() < 0.45) {
      const s = this.nearest(v, (t) => isl.tiles[t].type === Tile.Stump);
      if (s >= 0) {
        v.job = Job.WorshipStump;
        v.target = s;
        v.state = VState.Walk;
        return;
      }
    }
    const fishOk = (t: number) => {
      const tile = isl.tiles[t];
      if (tile.type !== Tile.Water || tile.fish <= 0 || tile.claimedBy >= 0) return false;
      if (this.laws.has('fishQuota') && tile.fish < 2) return false;
      return true;
    };
    if (hungry || this.rand() < 0.3) {
      const pond = this.nearest(v, fishOk);
      if (pond >= 0) {
        this.claim(v, pond);
        v.job = Job.Fish;
        v.state = VState.Walk;
        return;
      }
    }
    const holy = this.laws.has('stumpsHoly');
    const tree = this.nearest(v, (t) => {
      const tile = isl.tiles[t];
      if (tile.type !== Tile.Tree || tile.claimedBy >= 0) return false;
      if (holy) {
        isl.neighbours(t, this.nb);
        for (const n of this.nb) if (isl.tiles[n].type === Tile.Stump) return false;
      }
      return true;
    });
    if (tree >= 0) {
      this.claim(v, tree);
      v.job = Job.Chop;
      v.state = VState.Walk;
      return;
    }
    // nothing to do: wander
    v.state = VState.Idle;
    v.timer = 1 + this.rand() * 2;
    v.heading += (this.rand() - 0.5) * 2;
  }

  private arrive(v: Villager) {
    switch (v.job) {
      case Job.Chop:
        v.state = VState.Chop;
        v.timer = 2.4;
        break;
      case Job.Fish:
        v.state = VState.Fish;
        v.timer = 2.0;
        break;
      case Job.WaterDust:
        v.state = VState.Water;
        v.timer = 0.8;
        break;
      case Job.WorshipStump:
        v.state = VState.Worship;
        v.timer = 3 + this.rand() * 2;
        break;
      default:
        v.state = VState.Idle;
        v.timer = 1;
    }
  }

  private goHome(v: Villager) {
    const isl = this.island;
    v.target = isl.huts.length ? isl.huts[v.id % isl.huts.length] : isl.centre;
    v.state = VState.Carry;
    v.job = Job.None;
  }

  private claim(v: Villager, t: number) {
    this.release(v);
    v.target = t;
    this.island.tiles[t].claimedBy = v.id;
  }

  release(v: Villager) {
    if (v.target >= 0 && this.island.tiles[v.target]?.claimedBy === v.id) {
      this.island.tiles[v.target].claimedBy = -1;
    }
  }

  private buildHut() {
    const isl = this.island;
    // nearest grass tile to centre that's not water/hut
    const p = { x: 0, y: 0, z: 0 };
    isl.centreOf(isl.centre, p);
    let best = -1;
    let bestD = 1e9;
    for (let i = 0; i < isl.tiles.length; i++) {
      const t = isl.tiles[i];
      if (t.type !== Tile.Grass || t.claimedBy >= 0) continue;
      const q = { x: 0, y: 0, z: 0 };
      isl.centreOf(i, q);
      const d = Math.hypot(q.x - p.x, q.z - p.z) + this.rand() * 0.02;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best < 0) return;
    isl.wood -= WOOD_PER_HUT;
    isl.setType(best, Tile.Hut);
    isl.huts.push(best);
    this.events.onHutBuilt?.(best);
    for (let k = 0; k < 2; k++) {
      const nv = this.spawn(best);
      if (nv) this.events.onBirth?.(nv);
    }
  }

  /** Move toward tile centre; returns true on arrival (within half a tile). */
  private walkTo(v: Villager, tile: number, dt: number): boolean {
    const isl = this.island;
    const p = { x: 0, y: 0, z: 0 };
    isl.centreOf(tile, p);
    const dx = p.x - v.x;
    const dz = p.z - v.z;
    const d = Math.hypot(dx, dz);
    const stop = isl.tiles[tile].type === Tile.Water || isl.tiles[tile].type === Tile.Hut ? TILE * 0.9 : TILE * 0.45;
    if (d < stop) return true;
    const want = Math.atan2(dx, dz);
    let diff = want - v.heading;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    v.heading += diff * Math.min(1, dt * 60);
    const step = Math.min(d, SPEED * dt);
    let nx = v.x + Math.sin(v.heading) * step;
    let nz = v.z + Math.cos(v.heading) * step;
    // don't walk on water unless that is the destination: sidestep
    const ti = isl.tileAtLocal(nx, nz);
    if (ti >= 0 && ti !== tile && isl.tiles[ti].type === Tile.Water) {
      nx = v.x + Math.sin(v.heading + 1.2) * step;
      nz = v.z + Math.cos(v.heading + 1.2) * step;
    }
    if (ti < 0) return true; // fell off the map edge somehow: give up the walk
    v.x = nx;
    v.z = nz;
    return false;
  }

  private nearest(v: Villager, ok: (t: number) => boolean): number {
    const isl = this.island;
    let best = -1;
    let bestD = 1e9;
    const p = { x: 0, y: 0, z: 0 };
    for (let i = 0; i < isl.tiles.length; i++) {
      if (!ok(i)) continue;
      isl.centreOf(i, p);
      const d = Math.hypot(p.x - v.x, p.z - v.z) + this.rand() * 0.04;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }
}
