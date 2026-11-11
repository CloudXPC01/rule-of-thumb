/**
 * Emulator test harness (dev only). When the IWER emulator is present, this
 * exposes `window.T` for scripted playtests: enter XR, aim the head, place a
 * hand so its pinch point lands on a stage-local position, change hand poses,
 * and wait N XR frames. Never active on a real headset (no IWER_DEVICE).
 */
import { Vector3 } from '@iwsdk/core';
import { Hands, type Side } from '../hands/hand-state.js';
import { Stage } from '../world/stage.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

export function installTestHarness() {
  const g = globalThis as Any;
  if (!import.meta.env.DEV || !g.IWER_DEVICE) return;
  const d = g.IWER_DEVICE as Any;
  const tmp = new Vector3();

  const frames = (n: number) =>
    new Promise<void>((res) => {
      let k = 0;
      const s = d.activeSession;
      if (!s) return void setTimeout(res, n * 16);
      const f = () => (++k >= n ? res() : s.requestAnimationFrame(f));
      s.requestAnimationFrame(f);
    });

  const toWorld = (x: number, y: number, z: number) => {
    Stage.root.updateMatrixWorld();
    return Stage.root.localToWorld(tmp.set(x, y, z)).clone();
  };

  const T = {
    d,
    frames,
    toWorld,
    god: () => g.__god,
    head(pitch: number, yaw: number) {
      d.controlMode = 'programmatic';
      const cy = Math.cos(yaw / 2), sy = Math.sin(yaw / 2), cp = Math.cos(pitch / 2), sp = Math.sin(pitch / 2);
      d.quaternion.set(cy * sp, sy * cp, -sy * sp, cy * cp);
    },
    lookAt(x: number, y: number, z: number) {
      const w = toWorld(x, y, z);
      const hx = d.position.x, hy = d.position.y, hz = d.position.z;
      const dx = w.x - hx, dy = w.y - hy, dz = w.z - hz;
      T.head(Math.atan2(dy, Math.hypot(dx, dz)), Math.atan2(-dx, -dz));
    },
    lookAtVillager(id: number) {
      const v = g.__god.village.villagers[id];
      if (v) T.lookAt(v.x, v.y + 0.022, v.z);
    },
    async enter(mono = true) {
      d.primaryInputMode = 'hand';
      if (!d.activeSession) {
        (document.querySelector('#rot-enter') as HTMLButtonElement | null)?.click();
        for (let i = 0; i < 40 && !d.activeSession; i++) await new Promise((r) => setTimeout(r, 100));
      }
      if (mono) d.stereoEnabled = false;
      T.head(-0.52, 0);
      await frames(3);
    },
    /** Teleport a hand so its pinch point (or palm) sits at stage-local x,y,z. */
    async handAt(side: Side, x: number, y: number, z: number, key: 'pinchPoint' | 'palm' | 'indexTip' = 'pinchPoint') {
      const h = d.hands[side];
      const H = Hands[side] as Any;
      const t = toWorld(x, y, z);
      for (let i = 0; i < 2; i++) {
        await frames(6);
        const c = H[key];
        h.position.set(h.position.x + (t.x - c.x), h.position.y + (t.y - c.y), h.position.z + (t.z - c.z));
      }
      await frames(6);
      const c = H[key];
      return [c.x - t.x, c.y - t.y, c.z - t.z].map((v: number) => +v.toFixed(4));
    },
    /** Move a hand smoothly so its pinch point (or palm) glides to x,y,z. */
    async glide(side: Side, x: number, y: number, z: number, steps = 10, key: 'pinchPoint' | 'palm' = 'pinchPoint', each?: () => void) {
      const h = d.hands[side];
      const local = key === 'palm' ? g.__god.palmL[side] : g.__god.pinchL[side];
      for (let i = 0; i < steps; i++) {
        const k = 1 / (steps - i);
        h.position.set(
          h.position.x + (x - local.x) * k,
          h.position.y + (y - local.y) * k,
          h.position.z + (z - local.z) * k,
        );
        each?.();
        await frames(2);
      }
    },
    async pose(side: Side, id: string, wait = 8) {
      d.hands[side].poseId = id;
      await frames(wait);
      const H = Hands[side];
      return { pinch: H.pinching, fist: H.fist, curl: +H.curl.toFixed(2), palmUp: H.palmUp, pointing: H.pointing };
    },
    /** Rotate a hand (radians about X) e.g. to turn the palm up. */
    handRot(side: Side, rx: number, ry = 0, rz = 0) {
      const q = d.hands[side].quaternion;
      // XYZ euler -> quaternion
      const c1 = Math.cos(rx / 2), s1 = Math.sin(rx / 2), c2 = Math.cos(ry / 2), s2 = Math.sin(ry / 2), c3 = Math.cos(rz / 2), s3 = Math.sin(rz / 2);
      q.set(s1 * c2 * c3 + c1 * s2 * s3, c1 * s2 * c3 - s1 * c2 * s3, c1 * c2 * s3 + s1 * s2 * c3, c1 * c2 * c3 - s1 * s2 * s3);
    },
    /** Pick up the seed and plant it at a tile while the given villager watches. */
    async plant(tile: number, witness = -1) {
      const god = g.__god;
      const c = { x: 0, y: 0, z: 0 };
      god.island.centreOf(tile, c);
      const sp = god.seed.position.clone();
      await T.pose('right', 'pinch');
      await T.handAt('right', sp.x, sp.y, sp.z);
      await T.pose('right', 'open');
      await T.pose('right', 'pinch');
      const held = god.seedHolder;
      const keep = () => witness >= 0 && T.lookAtVillager(witness);
      keep();
      await T.glide('right', c.x, 0.03, c.z, 10, 'pinchPoint', keep);
      await T.pose('right', 'open', 4);
      await frames(4);
      return { held, type: god.island.tiles[tile].type };
    },
  };
  g.T = T;
}
