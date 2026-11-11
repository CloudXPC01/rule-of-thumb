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
  Gather,
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
  /** 0..1 crouch under the Hand's shadow. */
  duck: number;
  /** Free-point goal used by Flee and Gather. */
  gx: number;
  gz: number;
  /** Seconds since this villager last chipped wood (render juice). */
  chip: number;
}

export const TUNICS = [0xe8a33c, 0x4b7bd1, 0xd9534f, 0x8e5bd1, 0x3cb3a8, 0xe07bb5, 0xf2e05c, 0x7fbf4d];

export interface VillageEvents {
  onChop?(tile: number, v: Villager): void;
  onChopTick?(tile: number, v: Villager): void;
  onPlant?(tile: number, v: Villager): void;
  onHutBuilt?(tile: number): void;
  onBirth?(v: Villager): void;
  onFish?(tile: number, v: Villager): void;
  onThrowFish?(v: Villager): void;
  onWaterDust?(tile: number, v: Villager): void;
  onLeave?(v: Villager): void;
}

const SPEED = 0.03; // m/s on a 0.5 m island
export const MAX_VILLAGERS = 16;
export const WOOD_PER_HUT = 6;

export class Village {
  villagers: Villager[] = [];
  laws = new Set<LawId>();
  food = 6;
  /** Cloud position in stage-local space, written by the god system. */
  cloud = { x: 0, z: 0, active: false };
  events: VillageEvents = {};
  /** Global pace multiplier for work (set per Age). */
  workRate = 1;
  /** Food eaten per villager per second. */
  hunger = 0.012;
  /** When true, everyone walks to the festival ring and cheers. */
  festival = false;
  private nb: number[] = [];
  private rng = 12345;
  private pt = { x: 0, y: 0, z: 0 };
  private pt2 = { x: 0, y: 0, z: 0 };
  /** Seconds the village has had no food. */
  private starve = 0;

  constructor(private island: Island) {
    for (let k = 0; k < 5; k++) this.spawn(island.centre);
  }

  rand(): number {
    this.rng = (this.rng * 16807) % 2147483647;
    return this.rng / 2147483647;
  }

  spawn(nearTile: number): Villager | null {
    if (this.villagers.length >= MAX_VILLAGERS) return null;
    const p = this.island.centreOf(nearTile, this.pt);
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
      hop: 1,
      shiver: 0,
      bob: this.rand() * 10,
      speech: 0,
      duck: 0,
      gx: 0,
      gz: 0,
      chip: 0,
    };
    // keep spawn on land
    if (this.island.tileAtLocal(v.x, v.z) < 0) {
      v.x = p.x;
      v.z = p.z;
    }
    this.villagers.push(v);
    return v;
  }

  /** Everyone within `r` of (x,z) runs away for a few seconds. */
  scare(x: number, z: number, r: number) {
    for (const v of this.villagers) {
      const dx = v.x - x;
      const dz = v.z - z;
      const d = Math.hypot(dx, dz);
      if (d > r || v.state === VState.Gather) continue;
      this.release(v);
      if (v.carrying === 3) v.carrying = 0;
      const k = d > 1e-4 ? 1 / d : 1;
      v.gx = v.x + dx * k * 0.08;
      v.gz = v.z + dz * k * 0.08;
      this.clampToLand(v);
      v.state = VState.Flee;
      v.job = Job.None;
      v.timer = 2.5;
      v.hop = 1;
      v.watching = 0;
    }
  }

  update(dt: number, time: number) {
    const isl = this.island;
    this.food = Math.max(0, this.food - dt * this.villagers.length * this.hunger);
    this.starve = this.food <= 0 && !this.festival ? this.starve + dt : 0;
    if (this.starve > 25 && this.villagers.length > 2) {
      this.starve = 0;
      const gone = this.villagers.pop()!;
      this.release(gone);
      this.events.onLeave?.(gone);
    }

    for (const v of this.villagers) {
      v.bob += dt * (v.state === VState.Walk || v.state === VState.Carry || v.state === VState.Flee ? 14 : 3);
      if (v.hop > 0) v.hop = Math.max(0, v.hop - dt * 3);
      if (v.speech > 0) v.speech -= dt;
      v.chip += dt;
      const shivering = this.laws.has('noWarmth');
      v.shiver = shivering ? 1 : Math.max(0, v.shiver - dt);

      // terrain height under feet
      const ti = isl.tileAtLocal(v.x, v.z);
      if (ti >= 0) v.y += (isl.tiles[ti].h - v.y) * Math.min(1, dt * 10);

      if (this.festival && v.state !== VState.Gather && v.state !== VState.Cheer) {
        this.release(v);
        v.state = VState.Gather;
        v.watching = 0;
        const a = (v.id / Math.max(1, this.villagers.length)) * Math.PI * 2;
        const c = isl.centreOf(isl.centre, this.pt);
        v.gx = c.x + Math.sin(a) * 0.07;
        v.gz = c.z + Math.cos(a) * 0.07;
        this.clampToLand(v);
      }

      // Being watched by the Hand overrides work.
      if (v.watching > 0 && !this.festival && v.state !== VState.Flee) {
        v.watching -= dt;
        v.lookUp = Math.min(1, v.lookUp + dt * 5);
        if (v.state !== VState.Watching) {
          // keep a claimed job tile; resume later
          v.state = VState.Watching;
          v.hop = 1;
        }
        continue;
      } else if (v.state === VState.Watching) {
        v.state = VState.Idle;
        v.timer = 0.4;
      }
      v.lookUp = Math.max(0, v.lookUp - dt * 2);

      // Rain dance overrides everything when the cloud hovers near.
      if (this.laws.has('rainDance') && this.cloud.active && !this.festival && v.state !== VState.Flee) {
        const d = Math.hypot(this.cloud.x - v.x, this.cloud.z - v.z);
        if (d < 0.2 && v.carrying === 0) {
          if (v.state !== VState.Dance) this.release(v);
          v.state = VState.Dance;
          v.heading += dt * 6;
          v.hop = Math.max(v.hop, 0.5 + 0.5 * Math.sin(time * 8 + v.id));
          v.timer = 0.8;
          continue;
        }
      }

      const workSpeed = (shivering ? 0.6 : 1) * this.workRate;

      switch (v.state) {
        case VState.Idle:
        case VState.Dance:
        case VState.Cheer:
          v.timer -= dt;
          if (v.state === VState.Cheer) v.hop = Math.max(v.hop, 0.6 + 0.4 * Math.sin(time * 12 + v.id));
          if (v.timer <= 0 && !this.festival) this.chooseJob(v);
          break;
        case VState.Walk:
          if (this.walkTo(v, v.target, dt * Math.max(0.7, workSpeed))) this.arrive(v);
          break;
        case VState.Flee:
          v.timer -= dt;
          if (this.walkPoint(v, v.gx, v.gz, dt * 2.2) || v.timer <= 0) {
            v.state = VState.Idle;
            v.timer = 0.8 + this.rand();
          }
          break;
        case VState.Gather:
          if (this.walkPoint(v, v.gx, v.gz, dt)) {
            v.state = VState.Cheer;
            v.timer = 999;
            const c = isl.centreOf(isl.centre, this.pt);
            v.heading = Math.atan2(c.x - v.x, c.z - v.z);
          }
          break;
        case VState.Chop:
          v.timer -= dt * workSpeed;
          if (isl.tiles[v.target].type !== Tile.Tree) {
            this.release(v);
            v.state = VState.Idle;
            break;
          }
          if (v.chip > 0.45) {
            v.chip = 0;
            this.events.onChopTick?.(v.target, v);
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
            } else if (v.carrying === 2) this.goHome(v);
            else {
              v.state = VState.Idle;
              v.timer = 1;
            }
          }
          break;
        case VState.Throw:
          v.timer -= dt;
          if (v.timer <= 0) {
            this.events.onThrowFish?.(v);
            v.carrying = 0;
            v.state = VState.Cheer;
            v.timer = 1.2;
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
          if (this.walkTo(v, v.target, dt * Math.max(0.7, workSpeed))) {
            if (v.carrying === 1) {
              isl.wood++;
              if (isl.wood >= WOOD_PER_HUT && this.food >= this.villagers.length) this.buildHut();
            } else if (v.carrying === 2) {
              this.food += 3;
            }
            v.carrying = 0;
            v.state = VState.Idle;
            v.timer = (2.5 + this.rand() * 3.5) / this.workRate;
          }
          break;
      }
    }
  }

  private choppers(): number {
    let n = 0;
    for (const v of this.villagers) if (v.job === Job.Chop) n++;
    return n;
  }

  private chooseJob(v: Villager) {
    const isl = this.island;
    const hungry = this.food < this.villagers.length * 0.8;
    // Faithful water carrying: if there is dust, sometimes go water it.
    if (this.laws.has('waterDust') && this.rand() < 0.4) {
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
    const quota = this.laws.has('fishQuota');
    const fishOk = (t: number) => {
      const tile = isl.tiles[t];
      if (tile.type !== Tile.Water || tile.fish <= 0 || tile.claimedBy >= 0) return false;
      if (quota && tile.fish < 2) return false;
      return true;
    };
    if (hungry || this.rand() < 0.08) {
      const pond = this.nearest(v, fishOk);
      if (pond >= 0) {
        this.claim(v, pond);
        v.job = Job.Fish;
        v.state = VState.Walk;
        return;
      }
    }
    // Not everyone chops at once: keeps the forest from vanishing in a minute.
    const cap = 1 + Math.floor(this.villagers.length / 7);
    if (this.choppers() < cap) {
      const holy = this.laws.has('stumpsHoly');
      const tree = this.nearest(v, (t) => {
        const tile = isl.tiles[t];
        if (tile.type !== Tile.Tree || tile.claimedBy >= 0 || tile.fire > 0) return false;
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
        v.timer = 5.5;
        v.chip = 0;
        break;
      case Job.Fish:
        v.state = VState.Fish;
        v.timer = 2.2;
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
    if (v.job === Job.Chop) v.job = Job.None;
  }

  private buildHut() {
    const isl = this.island;
    const p = isl.centreOf(isl.centre, this.pt);
    const px = p.x;
    const pz = p.z;
    let best = -1;
    let bestD = 1e9;
    for (let i = 0; i < isl.tiles.length; i++) {
      const t = isl.tiles[i];
      if (t.type !== Tile.Grass || t.claimedBy >= 0 || t.fire > 0) continue;
      const q = isl.centreOf(i, this.pt2);
      const d = Math.hypot(q.x - px, q.z - pz) + this.rand() * 0.02;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best < 0 || this.villagers.length >= MAX_VILLAGERS) return;
    isl.wood -= WOOD_PER_HUT;
    isl.setType(best, Tile.Hut);
    isl.huts.push(best);
    this.events.onHutBuilt?.(best);
    for (let k = 0; k < 2; k++) {
      const nv = this.spawn(best);
      if (nv) this.events.onBirth?.(nv);
    }
  }

  private clampToLand(v: Villager) {
    if (this.island.tileAtLocal(v.gx, v.gz) >= 0) return;
    // pull the goal toward the island centre until it is on land
    for (let k = 0; k < 8; k++) {
      v.gx *= 0.8;
      v.gz *= 0.8;
      if (this.island.tileAtLocal(v.gx, v.gz) >= 0) return;
    }
  }

  /** Walk toward a free point; true on arrival. */
  private walkPoint(v: Villager, x: number, z: number, dt: number): boolean {
    const dx = x - v.x;
    const dz = z - v.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.006) return true;
    v.heading = Math.atan2(dx, dz);
    const step = Math.min(d, SPEED * dt);
    const nx = v.x + (dx / d) * step;
    const nz = v.z + (dz / d) * step;
    if (this.island.tileAtLocal(nx, nz) < 0) return true;
    v.x = nx;
    v.z = nz;
    return false;
  }

  /** Move toward tile centre; returns true on arrival (within half a tile). */
  private walkTo(v: Villager, tile: number, dt: number): boolean {
    const isl = this.island;
    const p = isl.centreOf(tile, this.pt);
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
    let ti = isl.tileAtLocal(nx, nz);
    if (ti >= 0 && ti !== tile && isl.tiles[ti].type === Tile.Water) {
      nx = v.x + Math.sin(v.heading + 1.2) * step;
      nz = v.z + Math.cos(v.heading + 1.2) * step;
      ti = isl.tileAtLocal(nx, nz);
    }
    if (ti < 0) return true; // edge of the map: give up the walk
    v.x = nx;
    v.z = nz;
    return false;
  }

  private nearest(v: Villager, ok: (t: number) => boolean): number {
    const isl = this.island;
    let best = -1;
    let bestD = 1e9;
    for (let i = 0; i < isl.tiles.length; i++) {
      if (!ok(i)) continue;
      const p = isl.centreOf(i, this.pt2);
      const d = Math.hypot(p.x - v.x, p.z - v.z) + this.rand() * 0.04;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }
}
