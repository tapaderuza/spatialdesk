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
const USUAL_DESK_HEIGHT = 0.74;
/** The board's spot may be this close to the surface's edge and still count as over it. */
const SPOT_MARGIN = 0.03;
const BOARD_LIFT = 0.02; // the board's bottom edge, above the desk surface
/** The plant's pot is kept this far inside the desk's edge (its rim is 6 cm across from the centre). */
const POT_MARGIN = 0.06;
/** How far a standing timer's foot may reach past the desk's edge. */
const TIMER_OVERHANG = 0.03;
const OPENINGS = new Set(['door', 'window']);
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

/**
 * The desk in front of the viewer: a horizontal surface at desk height right under the spot where the board will
 * stand (arm's length ahead), however large the surface and wherever its centre is; a desk or table before anything
 * else, then the one at the most usual desk height.
 */
export function findDesk(planes: RoomPlane[], viewer: Pose): RoomPlane | null {
  const forward: Vec3 = [-Math.sin(viewer.yaw), 0, -Math.cos(viewer.yaw)];
  let best: RoomPlane | null = null;
  let bestScore = Infinity;
  for (const plane of planes) {
    if (plane.orientation !== 'horizontal') continue;
    const height = plane.center[1];
    if (height < DESK_HEIGHT[0] || height > DESK_HEIGHT[1]) continue;
    const spot: Vec3 = [viewer.x + forward[0] * FOCUS_DISTANCE, height, viewer.z + forward[2] * FOCUS_DISTANCE];
    if (!inside(plane, spot, SPOT_MARGIN)) continue;
    const score = (DESK_LABELS.has(plane.label) ? 0 : 1) + Math.abs(height - USUAL_DESK_HEIGHT);
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
  const panel = { width: BOARD_SIZE.width * panelScale, height: BOARD_SIZE.height * panelScale };
  const timer = { width: TIMER_SIZE.width * panelScale, height: TIMER_SIZE.height * panelScale };
  let plant: Pose | null = null;

  const desk = findDesk(planes, viewer);
  if (desk && workspace.focusBoardId) {
    const deskY = desk.center[1];
    const center: Vec3 = add([eye[0], deskY + BOARD_LIFT + panel.height / 2, eye[2]], scale(forward, FOCUS_DISTANCE));
    poses.push({ id: workspace.focusBoardId, pose: { x: center[0], y: center[1], z: center[2], ...facing(center, eye) } });
    // Along the desk at the board's depth, [offset] metres to the board's right (negative: its left).
    const onDesk = (offset: number): Vec3 => add([center[0], deskY, center[2]], scale(right, offset));
    const timerFits = (at: number) => inside(desk, onDesk(at - timer.width / 2), TIMER_OVERHANG) && inside(desk, onDesk(at + timer.width / 2), TIMER_OVERHANG);
    const plantFits = (at: number) => inside(desk, add(onDesk(at), scale(forward, 0.02)), -POT_MARGIN);
    // Timers stand on the desk beside the board, right if the desk reaches, else left; on a desk too small for either
    // they hover in a row just above the board, as in VR. The plant takes a free place on the desk, right first, where
    // the console (left, close by) never covers it: past the timers, or between them and the board (they step aside).
    const half = panel.width / 2;
    const beside = half + 0.06 + timer.width / 2;
    const options: { timers: number | null; plant: number | null }[] = [
      ...(workspace.timers.length
        ? [
            { timers: beside, plant: beside + timer.width / 2 + 0.1 },
            { timers: beside + 0.09, plant: half + 0.07 },
            { timers: beside, plant: -(half + 0.1) },
            { timers: -beside, plant: half + 0.1 },
            { timers: beside, plant: null },
            { timers: -beside, plant: null },
          ]
        : []),
      { timers: null, plant: half + 0.1 },
      { timers: null, plant: -(half + 0.1) },
      { timers: null, plant: null },
    ];
    const chosen = options.find((o) => (o.timers == null || timerFits(o.timers)) && (o.plant == null || plantFits(o.plant)))!;
    if (chosen.plant != null) {
      const at = add(onDesk(chosen.plant), scale(forward, 0.02));
      plant = { x: at[0], y: deskY, z: at[2], yaw: viewer.yaw + 0.35, pitch: 0 };
    }
    workspace.timers.forEach((t, i) => {
      const at: Vec3 =
        chosen.timers != null
          ? add(onDesk(chosen.timers), [0, BOARD_LIFT + timer.height / 2 + i * (timer.height + 0.03), 0])
          : add(add(center, scale(right, [0, -1, 1][i % 3] * (timer.width + 0.03))), [0, panel.height / 2 + 0.03 + timer.height / 2, 0]);
      poses.push({ id: t.id, pose: { x: at[0], y: at[1], z: at[2], ...facing(at, eye) } });
    });
  }

  // Parked boards go flat on real walls, never over a door or a window (planes the headset reports on top of the
  // wall's own): a board that would land on one slides along the wall until it is clear, or stays where it was.
  const openings = planes.filter((p) => p.orientation === 'vertical' && OPENINGS.has(p.label));
  const walls = planes.filter((p) => p.orientation === 'vertical' && !OPENINGS.has(p.label));
  const clearOfOpenings = (point: Vec3) =>
    openings.every((o) => Math.abs(dot(sub(point, o.center), o.normal)) > 0.15 || !inside(o, point, panel.width / 2 + 0.05));
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
    const start = add(hit.point, scale(normal, WALL_GAP));
    const along = cross([0, 1, 0], normal);
    const point = [0, 1, -1, 2, -2]
      .map((k) => add(start, scale(along, k * WALL_SPACING)))
      .find((p) => inside(hit.wall, p, 0) && clearOfOpenings(p) && !placed.some((q) => Math.hypot(q[0] - p[0], q[2] - p[2]) < WALL_SPACING));
    if (!point) continue;
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
