/**
 * Visual debug for the gesture layer. Enabled with ?debug in the URL.
 * Shows a marker at each palm coloured by gesture and a palm-normal stick,
 * and exposes the live state as window.__hands for automated checks.
 *
 * Colours: grey = open/idle, cyan = pinch, red = fist, yellow = palm-up,
 * green = pointing.
 */
import {
  Color,
  createSystem,
  Group,
  Mesh,
  MeshBasicMaterial,
  SphereGeometry,
  CylinderGeometry,
  Vector3,
} from '@iwsdk/core';
import { HAND_SIDES, Hands, GestureTuning } from './hand-state.js';

const DEBUG =
  typeof location !== 'undefined' && new URLSearchParams(location.search).has('debug');

(globalThis as unknown as { __hands: unknown }).__hands = { Hands, GestureTuning };

export class HandDebugSystem extends createSystem({}) {
  private markers: Record<'left' | 'right', { root: Group; mat: MeshBasicMaterial; stick: Mesh }> =
    {} as never;
  private colors = {
    idle: new Color(0x9aa0a6),
    pinch: new Color(0x00e5ff),
    fist: new Color(0xff3355),
    palmUp: new Color(0xffd400),
    point: new Color(0x33ff88),
  };
  private tmp = new Vector3();

  init(): void {
    if (!DEBUG) return;
    for (const side of HAND_SIDES) {
      const root = new Group();
      const mat = new MeshBasicMaterial({ color: this.colors.idle, depthTest: false });
      const ball = new Mesh(new SphereGeometry(0.015, 12, 8), mat);
      const stick = new Mesh(
        new CylinderGeometry(0.003, 0.003, 0.08, 6).translate(0, 0.04, 0),
        mat,
      );
      ball.renderOrder = stick.renderOrder = 999;
      root.add(ball, stick);
      this.world.createTransformEntity(root);
      this.markers[side] = { root, mat, stick };
    }
  }

  private last: Record<string, string> = { left: '', right: '' };

  update(): void {
    if (import.meta.env.DEV) {
      for (const side of HAND_SIDES) {
        const h = Hands[side];
        const sig = h.tracked
          ? `pinch=${h.pinching} fist=${h.fist} palmUp=${h.palmUp} open=${h.open} point=${h.pointing}`
          : 'untracked';
        if (sig !== this.last[side]) {
          this.last[side] = sig;
          console.info(
            `[hands] ${side} ${sig} curl=${h.curl.toFixed(2)} pinchD=${h.pinchDistance.toFixed(3)} up=${h.palmUpAmount.toFixed(2)}`,
          );
        }
      }
    }
    if (!DEBUG) return;
    for (const side of HAND_SIDES) {
      const h = Hands[side];
      const m = this.markers[side];
      m.root.visible = h.tracked;
      if (!h.tracked) continue;
      m.root.position.copy(h.palm);
      this.tmp.copy(h.palm).add(h.palmNormal);
      m.stick.quaternion.setFromUnitVectors(UP, h.palmNormal);
      const c = h.fist
        ? this.colors.fist
        : h.pinching
          ? this.colors.pinch
          : h.pointing
            ? this.colors.point
            : h.palmUp
              ? this.colors.palmUp
              : this.colors.idle;
      m.mat.color.copy(c);
    }
  }
}

const UP = new Vector3(0, 1, 0);
