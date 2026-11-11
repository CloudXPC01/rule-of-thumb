/**
 * Reads raw WebXR hand joints every frame and turns them into forgiving,
 * hysteresis-based gestures (pinch, fist/curl, palm-up, open, point).
 * Results land in the shared `Hands` object (see hand-state.ts).
 *
 * Deliberately position-based: no gesture depends on fast velocity, so it
 * stays robust to tracking jitter on a real Quest.
 */
import { createSystem, Matrix4, Quaternion, Vector3 } from '@iwsdk/core';
import { GestureTuning as T, HAND_SIDES, Hands, type HandState } from './hand-state.js';

const CURL_FINGERS = [
  'index-finger-tip',
  'middle-finger-tip',
  'ring-finger-tip',
  'pinky-finger-tip',
] as const;

export class HandGestureSystem extends createSystem({}) {
  private tmpPos = new Vector3();
  private tmpQuat = new Quaternion();
  private tmpVec = new Vector3();
  private originMatrix = new Matrix4();
  private prevPalm: Record<'left' | 'right', Vector3> = {
    left: new Vector3(),
    right: new Vector3(),
  };
  private seen: Record<'left' | 'right', boolean> = { left: false, right: false };
  private up = new Vector3(0, 1, 0);
  private joints: Record<string, Vector3> = {};
  private jointQuats: Record<string, Quaternion> = {};

  init(): void {
    for (const name of [
      'wrist',
      'thumb-tip',
      'middle-finger-metacarpal',
      'middle-finger-phalanx-proximal',
      'index-finger-phalanx-proximal',
      ...CURL_FINGERS,
    ]) {
      this.joints[name] = new Vector3();
      this.jointQuats[name] = new Quaternion();
    }
  }

  update(delta: number): void {
    const dt = Math.max(delta, 1 / 240);
    for (const side of HAND_SIDES) {
      const h = Hands[side];
      h.pinchStarted = h.pinchEnded = h.fistStarted = h.fistEnded = false;
      this.seen[side] = false;
    }

    const frame = this.xrFrame;
    const refSpace = this.renderer.xr.getReferenceSpace();
    if (frame && refSpace && frame.session) {
      this.player.updateWorldMatrix(true, false);
      this.originMatrix.copy(this.player.matrixWorld);
      for (const source of frame.session.inputSources) {
        const hand = source.hand;
        const side = source.handedness;
        if (!hand || (side !== 'left' && side !== 'right')) continue;
        if (this.seen[side]) continue;
        if (this.readJoints(frame, hand, refSpace)) {
          this.seen[side] = true;
          this.applyGestures(Hands[side], dt);
        }
      }
    }

    for (const side of HAND_SIDES) {
      const h = Hands[side];
      if (!this.seen[side]) {
        if (h.tracked) {
          // Lost tracking: release edges so nothing stays stuck "held" forever,
          // but keep positions frozen where they were (callers read lostFor).
          if (h.pinching) h.pinchEnded = true;
          if (h.fist) h.fistEnded = true;
          h.pinching = h.fist = h.palmUp = h.open = h.pointing = false;
          h.velocity.set(0, 0, 0);
        }
        h.tracked = false;
        h.trackedFor = 0;
        h.lostFor += dt;
      }
    }
  }

  /** Fills this.joints with world-space positions. Returns false if wrist missing. */
  private readJoints(frame: XRFrame, hand: XRHand, refSpace: XRReferenceSpace): boolean {
    if (!frame.getJointPose) return false;
    for (const name in this.joints) {
      const joint = hand.get(name as XRHandJoint);
      if (!joint) return false;
      const pose = frame.getJointPose(joint, refSpace);
      if (!pose) return false;
      const p = pose.transform.position;
      const o = pose.transform.orientation;
      this.joints[name].set(p.x, p.y, p.z).applyMatrix4(this.originMatrix);
      this.tmpQuat.set(o.x, o.y, o.z, o.w);
      this.jointQuats[name]
        .setFromRotationMatrix(this.originMatrix)
        .multiply(this.tmpQuat);
    }
    return true;
  }

  private applyGestures(h: HandState, dt: number): void {
    const j = this.joints;
    const firstFrame = !h.tracked;
    const k = firstFrame ? 1 : 1 - Math.pow(1 - T.smoothing, dt * 72);

    h.tracked = true;
    h.trackedFor += dt;
    h.lostFor = 0;

    // Smoothed positions
    h.wrist.lerp(j['wrist'], firstFrame ? 1 : k);
    if (firstFrame) h.wrist.copy(j['wrist']);
    h.indexTip.lerp(j['index-finger-tip'], k);
    h.thumbTip.lerp(j['thumb-tip'], k);
    if (firstFrame) {
      h.indexTip.copy(j['index-finger-tip']);
      h.thumbTip.copy(j['thumb-tip']);
    }
    h.pinchPoint.copy(h.indexTip).add(h.thumbTip).multiplyScalar(0.5);

    // Palm centre: halfway between middle metacarpal and proximal phalanx base.
    this.tmpPos.copy(j['middle-finger-metacarpal']).lerp(j['middle-finger-phalanx-proximal'], 0.5);
    if (firstFrame) {
      h.palm.copy(this.tmpPos);
      this.prevPalm[h.side].copy(this.tmpPos);
    } else {
      h.palm.lerp(this.tmpPos, k);
    }

    // Velocity (smoothed, from smoothed palm)
    this.tmpVec.copy(h.palm).sub(this.prevPalm[h.side]).divideScalar(dt);
    h.velocity.lerp(this.tmpVec, firstFrame ? 0 : 0.25);
    this.prevPalm[h.side].copy(h.palm);

    // Directions. WebXR joint space: -Z along the bone toward the tip,
    // +Y out of the back of the hand => palm normal = -Y.
    h.fingersDir.set(0, 0, -1).applyQuaternion(this.jointQuats['middle-finger-metacarpal']).normalize();
    h.palmNormal.set(0, -1, 0).applyQuaternion(this.jointQuats['middle-finger-metacarpal']).normalize();

    // Pinch with hysteresis
    h.pinchDistance = j['thumb-tip'].distanceTo(j['index-finger-tip']);
    const wasPinching = h.pinching;
    if (!h.pinching && h.pinchDistance < T.pinchOn) h.pinching = true;
    else if (h.pinching && h.pinchDistance > T.pinchOff) h.pinching = false;
    h.pinchStarted = h.pinching && !wasPinching;
    h.pinchEnded = !h.pinching && wasPinching;
    h.pinchHeldFor = h.pinching ? h.pinchHeldFor + dt : 0;

    // Curl: average fingertip->wrist distance normalised by palm length.
    const palmLen = Math.max(j['wrist'].distanceTo(j['middle-finger-phalanx-proximal']), 0.04);
    let sum = 0;
    for (const f of CURL_FINGERS) sum += j[f].distanceTo(j['wrist']);
    const ratio = sum / CURL_FINGERS.length / palmLen; // ~1.9 open, ~1.0 fist
    const curlRaw = clamp01((1.85 - ratio) / (1.85 - 1.05));
    h.curl = firstFrame ? curlRaw : h.curl + (curlRaw - h.curl) * k;

    // Pointing: index extended (tip far from wrist) while middle/ring/pinky curled.
    const indexExt = j['index-finger-tip'].distanceTo(j['wrist']) / palmLen;
    const othersExt =
      (j['middle-finger-tip'].distanceTo(j['wrist']) +
        j['ring-finger-tip'].distanceTo(j['wrist']) +
        j['pinky-finger-tip'].distanceTo(j['wrist'])) /
      3 /
      palmLen;
    h.pointing = indexExt > 1.6 && othersExt < 1.3 && !h.pinching;

    const wasFist = h.fist;
    if (!h.fist && h.curl > T.fistOn && !h.pinching && !h.pointing) h.fist = true;
    else if (h.fist && (h.curl < T.fistOff || h.pointing)) h.fist = false;
    h.fistStarted = h.fist && !wasFist;
    h.fistEnded = !h.fist && wasFist;

    // Palm up
    h.palmUpAmount = h.palmNormal.dot(this.up);
    if (!h.palmUp && h.palmUpAmount > T.palmUpOn) h.palmUp = true;
    else if (h.palmUp && h.palmUpAmount < T.palmUpOff) h.palmUp = false;

    h.open = h.curl < T.openBelowCurl && !h.pinching;

  }
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
