/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { World } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';
import { HandDebugSystem } from './hands/hand-debug-system.js';
import { HandGestureSystem } from './hands/hand-gesture-system.js';
import { StagePlacementSystem } from './world/stage-placement-system.js';
import { GodSystem } from './game/god-system.js';
import { mountTitle } from './title.js';
import { installTestHarness } from './dev/test-harness.js';

World.create(
  document.getElementById('scene-container') as HTMLDivElement,
  projectOptions,
).then((world) => {
  world.registerSystem(HandGestureSystem);
  world.registerSystem(HandDebugSystem);
  world.registerSystem(StagePlacementSystem);
  world.registerSystem(GodSystem);
  mountTitle(world);
  installTestHarness();
});
