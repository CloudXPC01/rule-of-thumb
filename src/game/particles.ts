/**
 * Cheap voxel particle pool: one InstancedMesh, fixed capacity, gravity,
 * per-particle colour, size and lifetime. Used for rain, wood chips, leaf
 * confetti, sparks, flames, lanterns.
 */
import {
  BoxGeometry,
  Color,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  Quaternion,
  Vector3,
  Euler,
} from '@iwsdk/core';

export interface SpawnOpts {
  x: number;
  y: number;
  z: number;
  vx?: number;
  vy?: number;
  vz?: number;
  life?: number;
  size?: number;
  color: number;
  gravity?: number;
  /** stretch along velocity (rain streaks) */
  stretch?: number;
  /** stop and die when y < floor */
  floor?: number;
  drag?: number;
  shrink?: boolean;
}

export class Particles {
  mesh: InstancedMesh;
  private n: number;
  private alive: Uint8Array;
  private px: Float32Array;
  private py: Float32Array;
  private pz: Float32Array;
  private vx: Float32Array;
  private vy: Float32Array;
  private vz: Float32Array;
  private life: Float32Array;
  private maxLife: Float32Array;
  private size: Float32Array;
  private grav: Float32Array;
  private stretch: Float32Array;
  private floor: Float32Array;
  private drag: Float32Array;
  private shrink: Uint8Array;
  private cursor = 0;
  private m = new Matrix4();
  private q = new Quaternion();
  private e = new Euler();
  private p = new Vector3();
  private s = new Vector3();
  private c = new Color();
  /** Called when a particle hits its floor (e.g. raindrop lands). */
  onLand?: (x: number, z: number) => void;

  constructor(capacity: number, additive = false) {
    this.n = capacity;
    const mat = new MeshBasicMaterial({ color: 0xffffff, transparent: additive, opacity: additive ? 0.9 : 1 });
    this.mesh = new InstancedMesh(new BoxGeometry(1, 1, 1), mat, capacity);
    this.mesh.frustumCulled = false;
    const f = () => new Float32Array(capacity);
    this.alive = new Uint8Array(capacity);
    this.shrink = new Uint8Array(capacity);
    this.px = f();
    this.py = f();
    this.pz = f();
    this.vx = f();
    this.vy = f();
    this.vz = f();
    this.life = f();
    this.maxLife = f();
    this.size = f();
    this.grav = f();
    this.stretch = f();
    this.floor = f();
    this.drag = f();
    this.m.makeScale(0, 0, 0);
    for (let i = 0; i < capacity; i++) {
      this.mesh.setMatrixAt(i, this.m);
      this.mesh.setColorAt(i, this.c.set(0xffffff));
    }
  }

  spawn(o: SpawnOpts) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.n;
    this.alive[i] = 1;
    this.px[i] = o.x;
    this.py[i] = o.y;
    this.pz[i] = o.z;
    this.vx[i] = o.vx ?? 0;
    this.vy[i] = o.vy ?? 0;
    this.vz[i] = o.vz ?? 0;
    this.life[i] = this.maxLife[i] = o.life ?? 1;
    this.size[i] = o.size ?? 0.004;
    this.grav[i] = o.gravity ?? -0.4;
    this.stretch[i] = o.stretch ?? 0;
    this.floor[i] = o.floor ?? -10;
    this.drag[i] = o.drag ?? 0;
    this.shrink[i] = o.shrink === false ? 0 : 1;
    this.mesh.setColorAt(i, this.c.set(o.color));
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  burst(x: number, y: number, z: number, count: number, color: number | number[], speed = 0.15, size = 0.003, life = 0.8) {
    for (let k = 0; k < count; k++) {
      const a = Math.random() * Math.PI * 2;
      const up = 0.4 + Math.random() * 0.8;
      const col = Array.isArray(color) ? color[k % color.length] : color;
      this.spawn({
        x,
        y,
        z,
        vx: Math.cos(a) * speed * (0.4 + Math.random()),
        vy: up * speed * 1.4,
        vz: Math.sin(a) * speed * (0.4 + Math.random()),
        life: life * (0.6 + Math.random() * 0.6),
        size: size * (0.6 + Math.random() * 0.8),
        color: col,
        gravity: -0.6,
      });
    }
  }

  update(dt: number) {
    let any = false;
    for (let i = 0; i < this.n; i++) {
      if (!this.alive[i]) continue;
      any = true;
      this.life[i] -= dt;
      this.vy[i] += this.grav[i] * dt;
      if (this.drag[i]) {
        const k = Math.max(0, 1 - this.drag[i] * dt);
        this.vx[i] *= k;
        this.vy[i] *= k;
        this.vz[i] *= k;
      }
      this.px[i] += this.vx[i] * dt;
      this.py[i] += this.vy[i] * dt;
      this.pz[i] += this.vz[i] * dt;
      if (this.py[i] < this.floor[i]) {
        this.onLand?.(this.px[i], this.pz[i]);
        this.life[i] = 0;
      }
      if (this.life[i] <= 0) {
        this.alive[i] = 0;
        this.m.makeScale(0, 0, 0);
        this.mesh.setMatrixAt(i, this.m);
        continue;
      }
      const t = this.shrink[i] ? Math.min(1, (this.life[i] / this.maxLife[i]) * 2) : 1;
      const sz = this.size[i] * t;
      this.p.set(this.px[i], this.py[i], this.pz[i]);
      if (this.stretch[i]) {
        this.s.set(sz * 0.5, sz * this.stretch[i], sz * 0.5);
        this.q.identity();
      } else {
        this.s.setScalar(sz);
        this.q.setFromEuler(this.e.set(this.life[i] * 5, this.life[i] * 3, 0));
      }
      this.m.compose(this.p, this.q, this.s);
      this.mesh.setMatrixAt(i, this.m);
    }
    if (any) this.mesh.instanceMatrix.needsUpdate = true;
  }
}
