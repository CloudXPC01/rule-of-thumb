/**
 * Places the stage in front of the player when an XR session begins and lets
 * either hand pinch the handle ring (the stage's rim) to drag it anywhere.
 * Yaw follows the player so the island always faces them after a move.
 */
import {
  createSystem,
  Mesh,
  CylinderGeometry,
  MeshLambertMaterial,
  Quaternion,
  MeshBasicMaterial,
  TorusGeometry,
  Vector3,
  VisibilityState,
} from '@iwsdk/core';
import { HAND_SIDES, Hands, type Side } from '../hands/hand-state.js';
import { Stage } from './stage.js';

const GRAB_RADIUS = 0.06; // how close the pinch must be to the rim

export class StagePlacementSystem extends createSystem({}) {
  private ring!: Mesh;
  private ringMat!: MeshBasicMaterial;
  private holder: Side | null = null;
  private grabOffset = new Vector3();
  private head = new Vector3();
  private local = new Vector3();
  private target = new Vector3();
  private needsInitialPlace = true;
  private headQuat = new Quaternion();

  init(): void {
    this.world.createTransformEntity(Stage.root);
    this.ringMat = new MeshBasicMaterial({ color: 0xfff1c1, transparent: true, opacity: 0.25 });
    this.ring = new Mesh(new TorusGeometry(Stage.radius + 0.015, 0.006, 6, 64), this.ringMat);
    this.ring.rotation.x = -Math.PI / 2;
    Stage.root.add(this.ring);
    // Placeholder island slab until the real diorama lands.
    const slab = new Mesh(
      new CylinderGeometry(Stage.radius, Stage.radius * 0.8, 0.06, 24).translate(0, -0.03, 0),
      new MeshLambertMaterial({ color: 0x6b8f4e }),
    );
    slab.name = 'placeholder-slab';
    Stage.root.add(slab);
    this.placeInFront();

    this.cleanupFuncs.push(
      this.visibilityState.subscribe((v) => {
        if (v !== VisibilityState.NonImmersive && this.needsInitialPlace) {
          this.needsInitialPlace = false;
          // wait a beat for the head pose to settle
          setTimeout(() => this.placeInFront(), 250);
        }
        if (v === VisibilityState.NonImmersive) this.needsInitialPlace = true;
      }),
    );
  }

  /** 0.55 m forward, 0.32 m below eye height (~30 deg down), facing the player. */
  placeInFront(): void {
    this.player.head.getWorldPosition(this.head);
    const fwd = this.target.set(0, 0, -1).applyQuaternion(this.player.head.getWorldQuaternion(this.headQuat));
    fwd.y = 0;
    if (fwd.lengthSq() < 1e-4) fwd.set(0, 0, -1);
    fwd.normalize();
    Stage.root.position.copy(this.head).addScaledVector(fwd, 0.55);
    Stage.root.position.y = Math.max(this.head.y - 0.32, 0.5);
    this.faceHead();
  }

  private faceHead(): void {
    this.player.head.getWorldPosition(this.head);
    const dx = this.head.x - Stage.root.position.x;
    const dz = this.head.z - Stage.root.position.z;
    Stage.root.rotation.set(0, Math.atan2(dx, dz), 0);
  }

  update(): void {
    let hovering = false;
    for (const side of HAND_SIDES) {
      const h = Hands[side];
      if (!h.tracked) continue;
      // distance from pinch point to the rim, measured in the stage's plane
      this.local.copy(h.pinchPoint);
      Stage.root.worldToLocal(this.local);
      const rimDist = Math.hypot(Math.hypot(this.local.x, this.local.z) - Stage.radius, this.local.y);
      const near = rimDist < GRAB_RADIUS;
      if (near) hovering = true;
      if (this.holder === null && h.pinchStarted && near) {
        this.holder = side;
        this.grabOffset.copy(Stage.root.position).sub(h.pinchPoint);
      }
    }

    if (this.holder) {
      const h = Hands[this.holder];
      if (h.pinching) {
        this.target.copy(h.pinchPoint).add(this.grabOffset);
        Stage.root.position.lerp(this.target, 0.5);
        this.faceHead();
      } else if (h.pinchEnded || h.lostFor > 0.3) {
        this.holder = null;
        Stage.placed = true;
      }
    }

    const want = this.holder ? 0.9 : hovering ? 0.6 : 0.04;
    this.ringMat.opacity += (want - this.ringMat.opacity) * 0.2;
  }
}
