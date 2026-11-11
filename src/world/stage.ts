/**
 * The "stage": a single root Group that every gameplay object parents to.
 * It sits at chest height in front of the player and can be repositioned
 * by pinching its handle ring and dragging. Shared by all game concepts.
 */
import { Group, Vector3 } from '@iwsdk/core';

export const Stage = {
  root: new Group(),
  /** Radius of the playable top surface (m). */
  radius: 0.27,
  /** Has the player placed it at least once this session. */
  placed: false,
  /** Temp for callers. */
  tmp: new Vector3(),
};
Stage.root.name = 'stage-root';
