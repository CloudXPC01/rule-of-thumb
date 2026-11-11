/**
 * Instanced voxel villagers: body, head, two white pixel eyes, and a carried
 * item (log / fish / water). Heads tilt up toward the player when watched,
 * and eyes track the nearest hand.
 */
import {
  BoxGeometry,
  Color,
  Group,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Quaternion,
  Vector3,
  Euler,
} from '@iwsdk/core';
import { Village, VState } from './village.js';

const MAX = 16;
const BODY_W = 0.0075;
const BODY_H = 0.0095;
const HEAD = 0.008;
const SKIN = [0xf1c27d, 0xe0ac69, 0xc68642, 0x8d5524];

export class VillageRender {
  root = new Group();
  private body: InstancedMesh;
  private head: InstancedMesh;
  private eyes: InstancedMesh;
  private item: InstancedMesh;
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
    const box = new BoxGeometry(1, 1, 1);
    this.body = new InstancedMesh(box, new MeshLambertMaterial(), MAX);
    this.head = new InstancedMesh(box, new MeshLambertMaterial(), MAX);
    this.eyes = new InstancedMesh(box, new MeshBasicMaterial({ color: 0xffffff }), MAX * 2);
    this.item = new InstancedMesh(box, new MeshLambertMaterial(), MAX);
    for (const im of [this.body, this.head, this.eyes, this.item]) {
      im.frustumCulled = false;
      this.root.add(im);
    }
  }

  update() {
    const vs = this.village.villagers;
    for (let k = 0; k < MAX; k++) {
      const v = vs[k];
      if (!v) {
        this.m.makeScale(0, 0, 0);
        this.body.setMatrixAt(k, this.m);
        this.head.setMatrixAt(k, this.m);
        this.eyes.setMatrixAt(k * 2, this.m);
        this.eyes.setMatrixAt(k * 2 + 1, this.m);
        this.item.setMatrixAt(k, this.m);
        continue;
      }
      const walking = v.state === VState.Walk || v.state === VState.Carry;
      const bob = walking ? Math.abs(Math.sin(v.bob)) * 0.002 : 0;
      const hop = Math.sin(Math.min(1, v.hop) * Math.PI) * 0.008 * (v.hop > 0 ? 1 : 0);
      const shake = v.shiver ? Math.sin(v.bob * 9) * 0.0006 : 0;
      const chop = v.state === VState.Chop ? Math.sin(v.bob * 3) * 0.25 : 0;

      // facing: player when watching, else heading
      let yaw = v.heading;
      if (v.lookUp > 0.01) {
        const toYaw = Math.atan2(this.headTarget.x - v.x, this.headTarget.z - v.z);
        yaw = lerpAngle(v.heading, toYaw, v.lookUp);
      }
      this.q.setFromEuler(this.e.set(chop * 0.4, yaw, 0));
      const baseY = v.y + bob + hop;

      this.p.set(v.x + shake, baseY + BODY_H / 2, v.z);
      this.s.set(BODY_W, BODY_H * (1 - (v.hop > 0.8 ? 0.15 : 0)), BODY_W * 0.8);
      this.m.compose(this.p, this.q, this.s);
      this.body.setMatrixAt(k, this.m);
      this.body.setColorAt(k, this.c.set(v.tunic));

      // head pitches back toward the Hand when watched
      const pitch = -0.7 * v.lookUp;
      this.qHead.setFromEuler(this.e.set(pitch, yaw, 0));
      this.p.set(v.x + shake, baseY + BODY_H + HEAD / 2, v.z);
      this.s.setScalar(HEAD);
      this.m.compose(this.p, this.qHead, this.s);
      this.head.setMatrixAt(k, this.m);
      this.head.setColorAt(k, this.c.set(SKIN[v.id % SKIN.length]));

      // eyes: two white pixels on the face, sliding toward the look target
      const lookX = Math.max(-1, Math.min(1, (this.lookTarget.x - v.x) * 8)) * 0.0008;
      for (let e = 0; e < 2; e++) {
        this.off.set((e ? 1 : -1) * 0.0019 + lookX, 0.0008, HEAD / 2 + 0.0003).applyQuaternion(this.qHead);
        this.p.set(v.x + shake, baseY + BODY_H + HEAD / 2, v.z).add(this.off);
        this.s.set(0.0016, v.lookUp > 0.5 ? 0.0022 : 0.0016, 0.0006);
        this.m.compose(this.p, this.qHead, this.s);
        this.eyes.setMatrixAt(k * 2 + e, this.m);
      }

      // carried item above the head
      if (v.carrying) {
        const col = v.carrying === 1 ? 0x8a5a2b : v.carrying === 2 ? 0x9fd3e6 : 0x3fb3d8;
        this.p.set(v.x, baseY + BODY_H + HEAD + 0.004, v.z);
        if (v.carrying === 1) this.s.set(0.012, 0.004, 0.004);
        else if (v.carrying === 2) this.s.set(0.008, 0.0035, 0.003);
        else this.s.set(0.005, 0.005, 0.005);
        this.m.compose(this.p, this.q, this.s);
        this.item.setColorAt(k, this.c.set(col));
      } else {
        this.m.makeScale(0, 0, 0);
      }
      this.item.setMatrixAt(k, this.m);
    }
    for (const im of [this.body, this.head, this.eyes, this.item]) {
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
    }
  }
}

function lerpAngle(a: number, b: number, t: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
