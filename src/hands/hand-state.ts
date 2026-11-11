/**
 * Shared, allocation-free hand state written by HandGestureSystem every frame
 * and read by any gameplay system. Positions are world space, metres.
 *
 * Kept system-free so gameplay modules can import it without pulling systems.
 */
import { Vector3 } from '@iwsdk/core';

export type Side = 'left' | 'right';

export interface HandState {
  side: Side;
  /** Wrist joint pose was available this frame. */
  tracked: boolean;
  /** Seconds since tracking was last lost (0 while untracked). */
  trackedFor: number;
  /** Seconds since the hand was last seen; held objects use this to freeze instead of drop. */
  lostFor: number;

  wrist: Vector3;
  palm: Vector3; // centre of palm (middle metacarpal end)
  palmNormal: Vector3; // unit vector out of the palm (inside of hand)
  fingersDir: Vector3; // unit vector wrist -> middle finger
  indexTip: Vector3;
  thumbTip: Vector3;
  pinchPoint: Vector3; // midpoint between thumb and index tips
  velocity: Vector3; // smoothed palm velocity m/s

  /** Raw thumb-index distance (m). */
  pinchDistance: number;
  pinching: boolean;
  pinchStarted: boolean; // edge this frame
  pinchEnded: boolean; // edge this frame
  pinchHeldFor: number;

  /** 0 = open hand, 1 = tight fist. */
  curl: number;
  fist: boolean;
  fistStarted: boolean;
  fistEnded: boolean;

  /** Palm facing up (normal · worldUp > threshold). */
  palmUp: boolean;
  palmUpAmount: number; // -1..1 dot product
  /** Fingers extended, not pinching. */
  open: boolean;
  /** Index extended while other fingers curled. */
  pointing: boolean;
}

function makeHand(side: Side): HandState {
  return {
    side,
    tracked: false,
    trackedFor: 0,
    lostFor: 0,
    wrist: new Vector3(),
    palm: new Vector3(),
    palmNormal: new Vector3(0, 1, 0),
    fingersDir: new Vector3(0, 0, -1),
    indexTip: new Vector3(),
    thumbTip: new Vector3(),
    pinchPoint: new Vector3(),
    velocity: new Vector3(),
    pinchDistance: 1,
    pinching: false,
    pinchStarted: false,
    pinchEnded: false,
    pinchHeldFor: 0,
    curl: 0,
    fist: false,
    fistStarted: false,
    fistEnded: false,
    palmUp: false,
    palmUpAmount: 0,
    open: false,
    pointing: false,
  };
}

/** Tunables, live-editable from the ?debug panel. */
export const GestureTuning = {
  pinchOn: 0.02,
  pinchOff: 0.04,
  /** curl above this = fist, below fistOff releases. */
  fistOn: 0.72,
  fistOff: 0.55,
  palmUpOn: 0.6,
  palmUpOff: 0.45,
  openBelowCurl: 0.3,
  /** Position smoothing factor per 1/72s frame (0 = frozen, 1 = raw). */
  smoothing: 0.6,
};

export const Hands: Record<Side, HandState> = {
  left: makeHand('left'),
  right: makeHand('right'),
};

export const HAND_SIDES: readonly Side[] = ['left', 'right'];
