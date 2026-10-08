import { Vector3, VisibilityState, type World } from '@iwsdk/core';
import type { Pose } from './model.js';
import { workspace } from './store.js';

const eye = new Vector3();
const forward = new Vector3();

/**
 * The user's eye pose (yaw only), as the headset reports it; button presses use [deskPose] instead. In the browser
 * the camera is a preview camera behind the user, so the layout keeps the default anchor it was designed around.
 */
export function viewerPose(world: World): Pose {
  if (world.visibilityState.value === VisibilityState.NonImmersive) return { x: 0, y: 1.6, z: 0, yaw: 0, pitch: 0 };
  world.camera.getWorldPosition(eye);
  world.camera.getWorldDirection(forward);
  return { x: eye.x, y: eye.y, z: eye.z, yaw: Math.atan2(-forward.x, -forward.z), pitch: 0 };
}

/** How far the head may turn from the desk and still be a glance at one of its panels (the command panel is at 50°). */
const GLANCE_RADIANS = (70 * Math.PI) / 180;

/**
 * The pose a button press arranges things around. Seated, you look at the panel you are tapping, so the head's yaw at
 * that moment is the panel's direction, not where you face: while the head is within a glance of the desk, the desk
 * keeps its heading (and follows the head's position). Turned further, you have really turned, and the head wins.
 */
export function deskPose(world: World): Pose {
  const viewer = viewerPose(world);
  const desk = workspace.state.anchor.yaw;
  const turn = Math.atan2(Math.sin(viewer.yaw - desk), Math.cos(viewer.yaw - desk));
  return Math.abs(turn) <= GLANCE_RADIANS ? { ...viewer, yaw: desk } : viewer;
}
