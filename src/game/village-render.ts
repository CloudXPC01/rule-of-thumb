/**
 * Instanced voxel villagers styled per art direction: bright tunics from a
 * 5-colour set, 1-pixel ink eyes on a skin face, role props (axe for
 * woodcutters, rod for fishers, a hat for the elder), carried items and a
 * soft contact shadow so they read at 2.5 cm against the grass.
 * Heads tilt up toward the player when watched; eyes follow the nearest hand.
 */
import { Color, Euler, Group, InstancedMesh, Matrix4, Quaternion, Vector3 } from '@iwsdk/core';
import { TILE } from './island.js';
import { C, STYLE } from './style.js';
import { Job, Village, VState } from './village.js';
import { makeShadows, VoxelMesh } from './voxel.js';

const MAX = 16;
const V = (TILE / 8) * STYLE.villagerScale;
const BODY_W = 3 * V;
const BODY_D = 2.2 * V;
const BODY_H = 3 * V;
const HEAD = 2.8 * V;
const LEGS = 0.8 * V;
const P = STYLE.pal;

export class VillageRender {
  root = new Group();
  private body: VoxelMesh;
  private head: VoxelMesh;
  private eyes: VoxelMesh;
  private gear: VoxelMesh; // [hat, tool handle, tool head, carried item] per villager
  private shadows: InstancedMesh;
  private m = new Matrix4();
  private q = new Quaternion();
  private qHead = new Quaternion();
  private e = new Euler();
  private p = new Vector3();
  private s = new Vector3();
  private off = new Vector3();
  private c = new Color();
  /** Stage-local position the eyes should look at (nearest hand). */
  lookTarget = new Vector3(0, 0.3, 0.5);
  /** Stage-local player head position. */
  headTarget = new Vector3(0, 0.4, 0.5);

  constructor(private village: Village) {
    this.body = new VoxelMesh(MAX);
    this.head = new VoxelMesh(MAX);
    this.eyes = new VoxelMesh(MAX * 2);
    this.gear = new VoxelMesh(MAX * 4);
    this.shadows = makeShadows(MAX, 0.38);
    for (const im of [this.shadows, this.body, this.head, this.eyes, this.gear]) this.root.add(im);
  }

  private hide(mesh: InstancedMesh, i: number) {
    this.m.makeScale(0, 0, 0);
    mesh.setMatrixAt(i, this.m);
  }

  /** Place a gear box at local offset (in the villager's frame). */
  private gearAt(i: number, bx: number, by: number, bz: number, yawQ: Quaternion, lx: number, ly: number, lz: number, sx: number, sy: number, sz: number, col: number, cell: number, tilt = 0) {
    this.off.set(lx, ly, lz).applyQuaternion(yawQ);
    this.p.set(bx + this.off.x, by + this.off.y, bz + this.off.z);
    this.s.set(sx, sy, sz);
    if (tilt) {
      this.e.setFromQuaternion(yawQ);
      this.e.x += tilt;
      this.qHead.setFromEuler(this.e);
      this.m.compose(this.p, this.qHead, this.s);
    } else this.m.compose(this.p, yawQ, this.s);
    this.gear.setMatrixAt(i, this.m);
    this.c.set(col);
    this.gear.setColorAt(i, this.c);
    this.gear.setCells(i, cell);
  }

  update() {
    const vs = this.village.villagers;
    const t = performance.now() / 1000;
    for (let k = 0; k < MAX; k++) {
      const v = vs[k];
      if (!v) {
        this.hide(this.body, k);
        this.hide(this.head, k);
        this.hide(this.eyes, k * 2);
        this.hide(this.eyes, k * 2 + 1);
        for (let g = 0; g < 4; g++) this.hide(this.gear, k * 4 + g);
        this.hide(this.shadows, k);
        continue;
      }
      const walking = v.state === VState.Walk || v.state === VState.Carry || v.state === VState.Flee || v.state === VState.Gather;
      const bob = walking ? Math.abs(Math.sin(v.bob)) * 0.0022 : 0;
      const hop = Math.sin(Math.min(1, v.hop) * Math.PI) * 0.009 * (v.hop > 0 ? 1 : 0);
      const shake = v.shiver ? Math.sin(v.bob * 9) * 0.0007 : 0;
      const chopping = v.state === VState.Chop;
      const swing = chopping ? Math.sin(t * 9 + v.id) : 0;

      // facing: player when watched, else heading
      let yaw = v.heading;
      if (v.lookUp > 0.01) {
        const toYaw = Math.atan2(this.headTarget.x - v.x, this.headTarget.z - v.z);
        yaw = lerpAngle(v.heading, toYaw, v.lookUp);
      }
      this.q.setFromEuler(this.e.set(0, yaw, 0));
      const squash = 1 - v.duck * 0.45 - (v.hop > 0.8 ? 0.12 : 0);
      const baseY = v.y + bob + hop;
      const bodyH = BODY_H * squash;
      const bx = v.x + shake;
      const bz = v.z;

      // body (tunic) sits on short legs
      this.p.set(bx, baseY + LEGS + bodyH / 2, bz);
      this.s.set(BODY_W * (1 + v.duck * 0.2), bodyH, BODY_D);
      this.m.compose(this.p, this.q, this.s);
      this.body.setMatrixAt(k, this.m);
      this.c.set(P.tunics[v.id % P.tunics.length]);
      this.body.setColorAt(k, this.c);
      this.body.setCells(k, C.white);

      // head pitches back toward the Hand when watched
      const pitch = -0.7 * v.lookUp;
      this.qHead.setFromEuler(this.e.set(pitch, yaw, 0));
      const headY = baseY + LEGS + bodyH + HEAD / 2;
      this.p.set(bx, headY, bz);
      this.s.setScalar(HEAD);
      this.m.compose(this.p, this.qHead, this.s);
      this.head.setMatrixAt(k, this.m);
      this.c.set(P.skin[(v.id * 7) % P.skin.length]);
      this.head.setColorAt(k, this.c);
      this.head.setCells(k, C.white);

      // eyes: two ink pixels that slide toward the nearest hand; wide when watched
      const lookX = Math.max(-1, Math.min(1, (this.lookTarget.x - v.x) * 8)) * 0.25 * V;
      const wide = v.lookUp > 0.5 ? 1.5 : 1;
      for (let e = 0; e < 2; e++) {
        this.off.set((e ? 1 : -1) * 0.7 * V + lookX, 0.25 * V, HEAD / 2 + 0.0002).applyQuaternion(this.qHead);
        this.p.set(bx, headY, bz).add(this.off);
        this.s.set(0.55 * V, 0.55 * V * wide, 0.15 * V);
        this.m.compose(this.p, this.qHead, this.s);
        this.eyes.setMatrixAt(k * 2 + e, this.m);
        this.c.set(P.ink);
        this.eyes.setColorAt(k * 2 + e, this.c);
        this.eyes.setCells(k * 2 + e, C.white);
      }

      // gear 0: hat for the elder (first villager) / gold band once they have laws
      const g0 = k * 4;
      if (v.id === 0) {
        this.gearAt(g0, bx, headY, bz, this.qHead, 0, HEAD / 2 + 0.5 * V, 0, HEAD * 1.15, V, HEAD * 1.15, 0xf2efe6, C.white);
      } else if (this.village.laws.size > 0 && v.id % 3 === 1) {
        this.gearAt(g0, bx, headY, bz, this.qHead, 0, HEAD / 2 + 0.15 * V, 0, HEAD * 1.04, 0.5 * V, HEAD * 1.04, 0xe0b23a, C.white);
      } else this.hide(this.gear, g0);

      // gear 1-2: role tool in the right hand (axe for choppers, rod for fishers)
      const bodyMidY = baseY + LEGS + bodyH * 0.55;
      if (v.job === Job.Chop || chopping) {
        const tilt = -0.6 + swing * 0.9;
        this.gearAt(g0 + 1, bx, bodyMidY, bz, this.q, BODY_W / 2 + 0.4 * V, 0.6 * V, 0.6 * V, 0.4 * V, 3 * V, 0.4 * V, P.wood, C.white, tilt);
        this.gearAt(g0 + 2, bx, bodyMidY, bz, this.q, BODY_W / 2 + 0.4 * V, 1.9 * V, 1.4 * V, 0.3 * V, 1 * V, 1.2 * V, 0xb8bcc4, C.white, tilt);
      } else if (v.job === Job.Fish || v.state === VState.Fish) {
        this.gearAt(g0 + 1, bx, bodyMidY, bz, this.q, BODY_W / 2 + 0.3 * V, 1.6 * V, 1.6 * V, 0.25 * V, 5 * V, 0.25 * V, P.wood, C.white, 0.9);
        this.hide(this.gear, g0 + 2);
      } else {
        this.hide(this.gear, g0 + 1);
        this.hide(this.gear, g0 + 2);
      }

      // gear 3: carried item above the head (log / fish / water)
      if (v.carrying) {
        const col = v.carrying === 1 ? 0x8a5a2b : v.carrying === 2 ? 0xbfd8e2 : 0x3fa0c8;
        const ly = HEAD + 0.6 * V + bodyH - BODY_H;
        if (v.carrying === 1) this.gearAt(g0 + 3, bx, headY, bz, this.q, 0, ly, 0, 3.2 * V, 0.9 * V, 0.9 * V, col, C.white);
        else if (v.carrying === 2) this.gearAt(g0 + 3, bx, headY, bz, this.q, 0, ly, 0, 2.2 * V, 0.8 * V, 0.6 * V, col, C.white);
        else this.gearAt(g0 + 3, bx, headY, bz, this.q, 0, ly, 0, 1.3 * V, 1.3 * V, 1.3 * V, col, C.white);
      } else this.hide(this.gear, g0 + 3);

      // soft shadow, shrinking as they hop
      this.p.set(v.x, v.y + 0.0008, v.z);
      this.s.setScalar(TILE * 0.62 * (1 - hop * 25));
      this.m.compose(this.p, this.q.identity(), this.s);
      this.shadows.setMatrixAt(k, this.m);
    }
    this.body.touch();
    this.head.touch();
    this.eyes.touch();
    this.gear.touch();
    this.shadows.instanceMatrix.needsUpdate = true;
  }
}

function lerpAngle(a: number, b: number, t: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
