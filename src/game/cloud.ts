/**
 * The god's cloud: a chunky voxel puff that can be dragged (pinch), wrung
 * for rain (fist), or poked for lightning. Also owns the lightning bolt
 * mesh and the soft blob shadows (cloud + hand) cast on the island.
 * Visual only; the god system decides what the gestures do.
 */
import {
  BoxGeometry,
  CircleGeometry,
  Color,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Quaternion,
  Vector3,
} from '@iwsdk/core';
import { hash } from './island-render.js';

const PUFFS = 14;
const BOLT_SEGS = 7;

export class Cloud {
  root = new Group();
  /** Stage-local position of the cloud centre. */
  pos = new Vector3(0.1, 0.17, 0.04);
  /** 0..1 how hard it is being wrung right now. */
  squeeze = 0;
  /** 0..1 hover highlight. */
  hover = 0;
  /** Darkness from charge (lightning recently / rain). */
  dark = 0;
  private puffs: InstancedMesh;
  private bolt: InstancedMesh;
  private boltMat: MeshBasicMaterial;
  private boltT = 0;
  private boltFrom = new Vector3();
  private boltTo = new Vector3();
  private offs: Float32Array;
  private m = new Matrix4();
  private q = new Quaternion();
  private p = new Vector3();
  private s = new Vector3();
  private up = new Vector3(0, 1, 0);
  private dir = new Vector3();
  private c = new Color();
  private white = new Color(0xffffff);
  private storm = new Color(0x8a8fa0);
  readonly shadow: Mesh;
  readonly handShadow: Mesh;
  private handShadowMat: MeshBasicMaterial;
  private t = 0;

  constructor() {
    const box = new BoxGeometry(1, 1, 1);
    this.puffs = new InstancedMesh(box, new MeshLambertMaterial({ color: 0xffffff, emissive: 0x334455 }), PUFFS);
    this.puffs.frustumCulled = false;
    this.offs = new Float32Array(PUFFS * 4);
    for (let i = 0; i < PUFFS; i++) {
      const a = hash(i * 3.1) * Math.PI * 2;
      const r = i === 0 ? 0 : 0.012 + hash(i * 7.7) * 0.03;
      this.offs[i * 4] = Math.cos(a) * r * 1.4;
      this.offs[i * 4 + 1] = (hash(i * 5.3) - 0.3) * 0.016;
      this.offs[i * 4 + 2] = Math.sin(a) * r;
      this.offs[i * 4 + 3] = 0.022 + hash(i * 2.9) * 0.018 - r * 0.25;
    }
    this.boltMat = new MeshBasicMaterial({ color: 0xfffbe0, transparent: true, opacity: 0 });
    this.bolt = new InstancedMesh(box, this.boltMat, BOLT_SEGS);
    this.bolt.frustumCulled = false;
    this.bolt.visible = false;

    const disc = new CircleGeometry(1, 20).rotateX(-Math.PI / 2);
    this.shadow = new Mesh(disc, new MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.18, depthWrite: false }));
    this.shadow.renderOrder = 2;
    this.handShadowMat = new MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0, depthWrite: false });
    this.handShadow = new Mesh(disc, this.handShadowMat);
    this.handShadow.renderOrder = 2;
    this.root.add(this.puffs, this.bolt, this.shadow, this.handShadow);
  }

  /** Distance from a stage-local point to the cloud body (0 inside). */
  distanceTo(local: Vector3): number {
    const dx = (local.x - this.pos.x) / 1.3;
    const dy = (local.y - this.pos.y) * 1.4;
    const dz = local.z - this.pos.z;
    return Math.max(0, Math.hypot(dx, dy, dz) - 0.035);
  }

  strike(groundX: number, groundY: number, groundZ: number) {
    this.boltT = 0.28;
    this.boltFrom.set(this.pos.x, this.pos.y - 0.02, this.pos.z);
    this.boltTo.set(groundX, groundY, groundZ);
    this.dark = 1;
    this.layoutBolt();
  }

  private layoutBolt() {
    const segs = BOLT_SEGS;
    let px = this.boltFrom.x;
    let py = this.boltFrom.y;
    let pz = this.boltFrom.z;
    for (let i = 0; i < segs; i++) {
      const k = (i + 1) / segs;
      const jit = i === segs - 1 ? 0 : 0.014;
      const nx = this.boltFrom.x + (this.boltTo.x - this.boltFrom.x) * k + (Math.random() - 0.5) * jit;
      const ny = this.boltFrom.y + (this.boltTo.y - this.boltFrom.y) * k;
      const nz = this.boltFrom.z + (this.boltTo.z - this.boltFrom.z) * k + (Math.random() - 0.5) * jit;
      const dx = nx - px;
      const dy = ny - py;
      const dz = nz - pz;
      const len = Math.hypot(dx, dy, dz);
      this.p.set((px + nx) / 2, (py + ny) / 2, (pz + nz) / 2);
      this.q.setFromUnitVectors(this.up, this.dir.set(dx / len, dy / len, dz / len));
      this.s.set(0.0028, len, 0.0028);
      this.m.compose(this.p, this.q, this.s);
      this.bolt.setMatrixAt(i, this.m);
      px = nx;
      py = ny;
      pz = nz;
    }
    this.bolt.instanceMatrix.needsUpdate = true;
  }

  /** handLocal: nearest hand palm in stage-local space, or null. */
  update(dt: number, handLocal: Vector3 | null, islandTopY: number) {
    this.t += dt;
    this.dark = Math.max(0, this.dark - dt * 0.8);
    const sq = this.squeeze;
    for (let i = 0; i < PUFFS; i++) {
      const o = i * 4;
      const wob = Math.sin(this.t * 1.3 + i) * 0.0015;
      // wringing pulls puffs inward and squashes them vertically
      const pull = 1 - sq * 0.35;
      this.p.set(
        this.pos.x + this.offs[o] * pull,
        this.pos.y + this.offs[o + 1] * (1 - sq * 0.5) + wob,
        this.pos.z + this.offs[o + 2] * pull,
      );
      const sz = this.offs[o + 3] * (1 + this.hover * 0.08);
      this.s.set(sz * (1 + sq * 0.2), sz * (1 - sq * 0.35), sz * (1 + sq * 0.2));
      this.m.compose(this.p, this.q.identity(), this.s);
      this.puffs.setMatrixAt(i, this.m);
      this.c.copy(this.white).lerp(this.storm, Math.min(1, sq * 0.8 + this.dark * 0.6));
      this.puffs.setColorAt(i, this.c);
    }
    this.puffs.instanceMatrix.needsUpdate = true;
    if (this.puffs.instanceColor) this.puffs.instanceColor.needsUpdate = true;

    if (this.boltT > 0) {
      this.boltT -= dt;
      this.bolt.visible = true;
      this.boltMat.opacity = Math.max(0, this.boltT / 0.28) * (0.7 + Math.random() * 0.3);
      if (Math.random() < 0.3) this.layoutBolt();
    } else this.bolt.visible = false;

    // cloud shadow on the island
    const h = Math.max(0.02, this.pos.y - islandTopY);
    this.shadow.position.set(this.pos.x, islandTopY + 0.0015, this.pos.z);
    this.shadow.scale.setScalar(0.05 + h * 0.08);
    (this.shadow.material as MeshBasicMaterial).opacity = 0.12 + sq * 0.12;

    // hand shadow: a soft dark disc under the palm when it hovers over the land
    if (handLocal && Math.hypot(handLocal.x, handLocal.z) < 0.26 && handLocal.y > islandTopY) {
      const hh = handLocal.y - islandTopY;
      this.handShadow.visible = true;
      this.handShadow.position.set(handLocal.x, islandTopY + 0.002, handLocal.z);
      this.handShadow.scale.setScalar(0.025 + hh * 0.12);
      const want = Math.max(0, 0.32 - hh * 1.1);
      this.handShadowMat.opacity += (want - this.handShadowMat.opacity) * Math.min(1, dt * 10);
    } else {
      this.handShadowMat.opacity = Math.max(0, this.handShadowMat.opacity - dt * 2);
      this.handShadow.visible = this.handShadowMat.opacity > 0.01;
    }
  }
}
