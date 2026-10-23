/**
 * "Fit to my room": where the workspace goes in the real room, from the planes the headset detected. Pure math on
 * plain numbers (tested without a browser in tests/room.spec.ts); src/room/room-system.ts feeds it the planes.
 *
 *  - The board you work on stands on your real desk, at arm's length, leaning back toward your eyes: the table
 *    becomes the work surface instead of a board floating in the air.
 *  - The parked boards hang flat on your real walls, in the direction they already were, so the overview is a
 *    Kanban wall you can glance at (tap one to bring it within reach, as before).
 *  - Timers stand on the desk beside the board.
 * Anything without a suitable surface keeps the pose it had.
 */
import { BOARD_SIZE, TIMER_SIZE, type Pose, type Workspace } from '../workspace/model.js';

export type Vec3 = [number, number, number];

/** A detected plane in world space. Its local frame: x and z span the surface, normal is its y axis. */
export interface RoomPlane {
  orientation: 'horizontal' | 'vertical';
  label: string;
  center: Vec3;
  normal: Vec3;
  /** The plane's local x axis in world space. */
  tangent: Vec3;
  /** Polygon extent in the plane's local frame, around [center]. */
  min: [number, number];
  max: [number, number];
}

export interface RoomFit {
  poses: { id: string; pose: Pose }[];
  desk: RoomPlane | null;
  walls: number;
  /** Where the focus plant stands: on the desk, left of the board (null without a desk). */
  plant: Pose | null;
}

const DESK_LABELS = new Set(['table', 'desk']);
/** A desk is a horizontal surface at desk height (seated or standing) in front of the user. */
const DESK_HEIGHT = [0.55, 1.15] as const;
const DESK_REACH = 1.6;
const BOARD_LIFT = 0.02; // the board's bottom edge, above the desk surface
/** The plant's pot is kept this far inside the desk's edge (its rim is 6 cm across from the centre). */
const POT_MARGIN = 0.06;
const FOCUS_DISTANCE = 0.62; // as in Layout.kt: arm's length, poke-able
const WALL_GAP = 0.03;
const WALL_RANGE = [0.9, 4.5] as const;
const WALL_SPACING = BOARD_SIZE.width + 0.12;

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** Where a world point falls in the plane's surface coordinates (x along tangent, z along the bitangent). */
function surface(plane: RoomPlane, point: Vec3): [number, number] {
  const d = sub(point, plane.center);
  const bitangent = cross(plane.tangent, plane.normal);
  return [dot(d, plane.tangent), dot(d, bitangent)];
}

function inside(plane: RoomPlane, point: Vec3, margin: number): boolean {
  const [u, v] = surface(plane, point);
  return u >= plane.min[0] - margin && u <= plane.max[0] + margin && v >= plane.min[1] - margin && v <= plane.max[1] + margin;
}

/** Yaw that turns a panel's front (+Z) toward the eyes; pitch leaning it back toward them (as pinned.ts does). */
function facing(from: Vec3, eye: Vec3): { yaw: number; pitch: number } {
  const dx = eye[0] - from[0];
  const dz = eye[2] - from[2];
  return { yaw: Math.atan2(dx, dz), pitch: Math.atan2(from[1] - eye[1], Math.hypot(dx, dz)) };
}

/** The desk in front of the viewer: a horizontal desk/table plane at desk height, nearest along the gaze. */
export function findDesk(planes: RoomPlane[], viewer: Pose): RoomPlane | null {
  const forward: Vec3 = [-Math.sin(viewer.yaw), 0, -Math.cos(viewer.yaw)];
  let best: RoomPlane | null = null;
  let bestScore = Infinity;
  for (const plane of planes) {
    if (plane.orientation !== 'horizontal') continue;
    const height = plane.center[1];
    const labelled = DESK_LABELS.has(plane.label);
    if (height < DESK_HEIGHT[0] || height > DESK_HEIGHT[1]) continue;
    const to: Vec3 = [plane.center[0] - viewer.x, 0, plane.center[2] - viewer.z];
    const distance = Math.hypot(to[0], to[2]);
    if (distance > DESK_REACH || dot(to, forward) <= 0) continue;
    const score = distance - (labelled ? 0.5 : 0);
    if (score < bestScore) {
      bestScore = score;
      best = plane;
    }
  }
  return best;
}

/** The nearest wall hit by a horizontal ray from the viewer's eyes, within reach of a glance. */
function wallHit(walls: RoomPlane[], eye: Vec3, direction: Vec3): { point: Vec3; wall: RoomPlane; distance: number } | null {
  let best: { point: Vec3; wall: RoomPlane; distance: number } | null = null;
  for (const wall of walls) {
    const denominator = dot(direction, wall.normal);
    if (Math.abs(denominator) < 1e-3) continue;
    const t = dot(sub(wall.center, eye), wall.normal) / denominator;
    if (t < WALL_RANGE[0] || t > WALL_RANGE[1]) continue;
    const point = add(eye, scale(direction, t));
    if (!inside(wall, point, 0.2)) continue;
    if (!best || t < best.distance) best = { point, wall, distance: t };
  }
  return best;
}

/** [panelScale]: the scale the panels are drawn at for the headset's view (Layout.kt), so they stand on the desk. */
export function fitToRoom(workspace: Workspace, viewer: Pose, planes: RoomPlane[], panelScale = 1): RoomFit {
  const eye: Vec3 = [viewer.x, viewer.y, viewer.z];
  const forward: Vec3 = [-Math.sin(viewer.yaw), 0, -Math.cos(viewer.yaw)];
  const right: Vec3 = [Math.cos(viewer.yaw), 0, -Math.sin(viewer.yaw)];
  const poses: { id: string; pose: Pose }[] = [];
  const board = { width: BOARD_SIZE.width * panelScale, height: BOARD_SIZE.height * panelScale };
  const timerSize = { width: TIMER_SIZE.width * panelScale, height: TIMER_SIZE.height * panelScale };
  let plant: Pose | null = null;

  const desk = findDesk(planes, viewer);
  if (desk && workspace.focusBoardId) {
    const deskY = desk.center[1];
    const center: Vec3 = add([eye[0], deskY + BOARD_LIFT + board.height / 2, eye[2]], scale(forward, FOCUS_DISTANCE));
    poses.push({ id: workspace.focusBoardId, pose: { x: center[0], y: center[1], z: center[2], ...facing(center, eye) } });
    // The focus plant stands on the desk itself, on the right, where the console (left, close by) never covers it:
    // past the timers if the desk reaches, else between the board and the timers (they step aside), else just left of
    // the board. With no room at all it stays in the studio.
    const pot = (offset: number): Vec3 => add(add([center[0], deskY, center[2]], scale(right, offset)), scale(forward, 0.02));
    const timerSpan = workspace.timers.length ? 0.06 + timerSize.width : 0;
    const past = board.width / 2 + timerSpan + 0.1;
    const between = board.width / 2 + 0.07;
    const left = -(board.width / 2 + 0.1);
    let timerShift = 0;
    let plantAt: number | null = null;
    if (inside(desk, pot(past), -POT_MARGIN)) plantAt = past;
    else if (inside(desk, pot(between), -POT_MARGIN) && (!workspace.timers.length || inside(desk, pot(between + 0.08 + timerSize.width), 0.05))) {
      plantAt = between;
      timerShift = 0.09;
    } else if (inside(desk, pot(left), -POT_MARGIN)) plantAt = left;
    if (plantAt != null) {
      const at = pot(plantAt);
      plant = { x: at[0], y: deskY, z: at[2], yaw: viewer.yaw + 0.35, pitch: 0 };
    }
    workspace.timers.forEach((timer, i) => {
      const side = scale(right, board.width / 2 + 0.06 + timerShift + timerSize.width / 2);
      const at: Vec3 = add(add(center, side), [0, -board.height / 2 + timerSize.height / 2 + i * (timerSize.height + 0.03), 0]);
      poses.push({ id: timer.id, pose: { x: at[0], y: at[1], z: at[2], ...facing(at, eye) } });
    });
  }

  const walls = planes.filter((p) => p.orientation === 'vertical' && p.label !== 'door' && p.label !== 'window');
  const placed: Vec3[] = [];
  let onWalls = 0;
  for (const board of workspace.boards) {
    if (board.id === workspace.focusBoardId) continue;
    const toBoard: Vec3 = [board.pose.x - viewer.x, 0, board.pose.z - viewer.z];
    const length = Math.hypot(toBoard[0], toBoard[2]) || 1;
    const hit = wallHit(walls, eye, scale(toBoard, 1 / length));
    if (!hit) continue;
    // Facing into the room: the wall normal turned toward the viewer, the board just off the wall.
    const normal = dot(hit.wall.normal, sub(eye, hit.point)) >= 0 ? hit.wall.normal : scale(hit.wall.normal, -1);
    let point = add(hit.point, scale(normal, WALL_GAP));
    // Two boards in the same direction: slide the later one along the wall.
    const along = cross([0, 1, 0], normal);
    for (let guard = 0; guard < 4 && placed.some((p) => Math.hypot(p[0] - point[0], p[2] - point[2]) < WALL_SPACING); guard++) {
      point = add(point, scale(along, WALL_SPACING));
    }
    placed.push(point);
    onWalls++;
    poses.push({ id: board.id, pose: { x: point[0], y: point[1], z: point[2], yaw: Math.atan2(normal[0], normal[2]), pitch: 0 } });
  }
  return { poses, desk, walls: onWalls, plant };
}

// Poses relative to a room anchor, so a layout survives between sessions (src/room/room-system.ts).

/** A pose as a 4x4 column-major matrix (rotation YXZ as three.js applies it: yaw, then pitch). */
export function poseMatrix(pose: Pose): number[] {
  const [cy, sy, cp, sp] = [Math.cos(pose.yaw), Math.sin(pose.yaw), Math.cos(pose.pitch), Math.sin(pose.pitch)];
  // R = Ry(yaw) * Rx(pitch)
  return [cy, 0, -sy, 0, sy * sp, cp, cy * sp, 0, sy * cp, -sp, cy * cp, 0, pose.x, pose.y, pose.z, 1];
}

export function matrixPose(m: ArrayLike<number>): Pose {
  // From R = Ry(yaw) * Rx(pitch): m[9] = -sin(pitch); m[8] = sin(yaw) cos(pitch); m[10] = cos(yaw) cos(pitch).
  const pitch = Math.asin(Math.max(-1, Math.min(1, -m[9])));
  return { x: m[12], y: m[13], z: m[14], yaw: Math.atan2(m[8], m[10]), pitch };
}

export function multiply(a: ArrayLike<number>, b: ArrayLike<number>): number[] {
  const out = new Array<number>(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
      out[c * 4 + r] = s;
    }
  }
  return out;
}

/** Inverse of a rigid transform (rotation + translation). */
export function invertRigid(m: ArrayLike<number>): number[] {
  const out = [m[0], m[4], m[8], 0, m[1], m[5], m[9], 0, m[2], m[6], m[10], 0, 0, 0, 0, 1];
  for (let r = 0; r < 3; r++) out[12 + r] = -(out[r] * m[12] + out[4 + r] * m[13] + out[8 + r] * m[14]);
  return out;
}
