import { Vector3, VisibilityState, type World } from '@iwsdk/core';
import type { Pose } from './model.js';

const eye = new Vector3();
const forward = new Vector3();

/**
 * The user's eye pose (yaw only): what "bring everything to me" and the agent's arrange_space lay things out
 * around. In the browser the camera is a preview camera behind the user, so the layout keeps the default anchor
 * it was designed around.
 */
export function viewerPose(world: World): Pose {
  if (world.visibilityState.value === VisibilityState.NonImmersive) return { x: 0, y: 1.6, z: 0, yaw: 0, pitch: 0 };
  world.camera.getWorldPosition(eye);
  world.camera.getWorldDirection(forward);
  return { x: eye.x, y: eye.y, z: eye.z, yaw: Math.atan2(-forward.x, -forward.z), pitch: 0 };
}
