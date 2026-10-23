/**
 * "Holds up in rooms the developer never tested" (Technical criterion): Fit room in every room Meta's Synthetic
 * Environment Module ships, eight procedural rooms and five scanned ones, none of them tuned for. The user sits at
 * whatever desk or table the headset detects there, a focus timer runs, and Fit room must leave:
 *  - the board standing on that surface (bottom edge 2 cm above it), over the surface itself, within reach;
 *  - the timers standing on the surface, the plant inside its outline, nothing pushed through a wall;
 *  - the parked boards flat on real walls, never on a door or a window.
 * A room with no desk in reach moves nothing onto a desk. The outcome per room is printed for the write-up.
 */
import { expect, test, type Page } from '@playwright/test';
import { frames, type Win } from './helpers.js';

const ROOMS = [
  'home_office', 'bedroom', 'conference_room', 'kitchen', 'music_studio', 'open_office', 'open_studio', 'sunlit_living_room',
  'office_small', 'office_large', 'meeting_room', 'living_room', 'music_room',
];

interface Plane { orientation: string; label: string; center: number[]; normal: number[]; tangent: number[]; min: number[]; max: number[] }

/** Enters the room in passthrough and waits until the headset has reported its surfaces. */
async function enterRoom(page: Page, room: string): Promise<Plane[]> {
  await page.goto(`/?emulate&fast&room=${room}`);
  await page.waitForFunction(() => (window as Win).__world && (window as Win).__xrDevice && (window as Win).__room, null, { timeout: 60_000 });
  await page.evaluate(() =>
    (window as Win).__world.launchXR({ sessionMode: 'immersive-ar', features: { handTracking: true, planeDetection: true, anchors: true } }),
  );
  await page.waitForFunction(() => (window as Win).__room.state.inRoom && (window as Win).__room.queries.planes.entities.size >= 3, null, { timeout: 40_000 });
  await frames(page, 20);
  return page.evaluate(() => (window as Win).__room.planes());
}

const DESK_LABELS = new Set(['desk', 'table']);

/**
 * Where a user would sit at the surface: 0.45 m out from its edge on the side nearest the room's centre (the floor),
 * eyes 0.47 m above it, facing its centre. Null when the room has no desk-height surface.
 */
function seat(planes: Plane[]): { x: number; y: number; z: number; yaw: number; desk: Plane } | null {
  const floor = planes.find((p) => p.label === 'floor');
  const middle = floor ? floor.center : [0, 0, 0];
  const desks = planes
    .filter((p) => p.orientation === 'horizontal' && p.center[1] >= 0.55 && p.center[1] <= 1.15)
    .sort((a, b) => Number(DESK_LABELS.has(b.label)) - Number(DESK_LABELS.has(a.label)));
  const desk = desks[0];
  if (!desk) return null;
  const t = desk.tangent;
  const b = [t[1] * desk.normal[2] - t[2] * desk.normal[1], t[2] * desk.normal[0] - t[0] * desk.normal[2], t[0] * desk.normal[1] - t[1] * desk.normal[0]];
  const sides = [
    { dir: b, reach: desk.max[1] }, { dir: b.map((v) => -v), reach: -desk.min[1] },
    { dir: t, reach: desk.max[0] }, { dir: t.map((v) => -v), reach: -desk.min[0] },
  ].map(({ dir, reach }) => {
    const at = [desk.center[0] + dir[0] * (reach + 0.45), desk.center[2] + dir[2] * (reach + 0.45)];
    return { at, score: Math.hypot(at[0] - middle[0], at[1] - middle[2]) };
  });
  const best = sides.sort((p, q) => p.score - q.score)[0];
  const [x, z] = best.at;
  return { x, y: desk.center[1] + 0.47, z, yaw: Math.atan2(-(desk.center[0] - x), -(desk.center[2] - z)), desk };
}

/** Where a world point falls in a plane's surface frame, and how far off the plane it is. */
function local(plane: Plane, p: number[]): { u: number; v: number; off: number } {
  const d = [p[0] - plane.center[0], p[1] - plane.center[1], p[2] - plane.center[2]];
  const t = plane.tangent;
  const n = plane.normal;
  const b = [t[1] * n[2] - t[2] * n[1], t[2] * n[0] - t[0] * n[2], t[0] * n[1] - t[1] * n[0]];
  const dot = (a: number[], c: number[]) => a[0] * c[0] + a[1] * c[1] + a[2] * c[2];
  return { u: dot(d, t), v: dot(d, b), off: dot(d, n) };
}

const over = (plane: Plane, p: number[], margin: number) => {
  const { u, v } = local(plane, p);
  return u >= plane.min[0] - margin && u <= plane.max[0] + margin && v >= plane.min[1] - margin && v <= plane.max[1] + margin;
};

/** A panel's bottom-edge centre: its pose leans back by [pitch] after turning by [yaw] (YXZ). */
function bottomOf(pose: { x: number; y: number; z: number; yaw: number; pitch: number }, height: number): number[] {
  const h = height / 2;
  return [pose.x - h * Math.sin(pose.pitch) * Math.sin(pose.yaw), pose.y - h * Math.cos(pose.pitch), pose.z - h * Math.sin(pose.pitch) * Math.cos(pose.yaw)];
}

for (const room of ROOMS) {
  test(`fit room holds up in SEM "${room}"`, async ({ page }) => {
    test.setTimeout(150_000);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const planes = await enterRoom(page, room);
    const chair = seat(planes);
    if (chair) {
      await page.evaluate(({ x, y, z, yaw }) => {
        const device = (window as Win).__xrDevice;
        device.position.set(x, y, z);
        device.quaternion.set(0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2));
      }, chair);
      await frames(page, 15);
    }
    await page.evaluate(() => (window as Win).__voice.say('focus')); // a running timer, which must find room too
    await page.waitForFunction(() => (window as Win).__workspace.state.timers.length === 1);
    const focusPose = () =>
      page.evaluate(() => {
        const ws = (window as Win).__workspace.state;
        return ws.boards.find((b: any) => b.id === ws.focusBoardId).pose;
      });
    const before = await focusPose();
    await page.evaluate(() => (window as Win).__room.requestFit());
    await page.waitForFunction(() => (window as Win).__room.state.lastFit != null, null, { timeout: 10_000 });
    await frames(page, 5);
    const after = await page.evaluate(() => {
      const ws = (window as Win).__workspace.state;
      const eye = (window as Win).__world.camera.getWorldPosition(new (window as Win).__world.camera.position.constructor());
      return {
        fit: (window as Win).__room.state.lastFit,
        focus: ws.boards.find((b: any) => b.id === ws.focusBoardId).pose,
        timers: ws.timers.map((t: any) => t.pose),
        parked: ws.boards.filter((b: any) => b.id !== ws.focusBoardId).map((b: any) => b.pose),
        plant: (window as Win).__room.plantPose,
        scale: (window as Win).__workspace.panelScale as number,
        eye: [eye.x, eye.y, eye.z],
      };
    });
    const walls = planes.filter((p) => p.orientation === 'vertical');
    const surfaces = planes.filter((p) => p.orientation === 'horizontal');
    const s = after.scale;
    const outcome: string[] = [`${planes.length} planes`];

    if (after.fit.desk) {
      // The board stands on a real surface, over it, within reach, with no wall between it and the eyes.
      const bottom = bottomOf(after.focus, 0.5 * s);
      const desk = surfaces.find((p) => Math.abs(p.center[1] - (bottom[1] - 0.02)) < 0.05 && over(p, bottom, 0.02));
      expect(desk, 'the board stands over a detected surface').toBeTruthy();
      const lift = bottom[1] - desk!.center[1];
      expect(lift).toBeGreaterThanOrEqual(0);
      expect(lift).toBeLessThan(0.06);
      const reach = Math.hypot(after.focus.x - after.eye[0], after.focus.z - after.eye[2]);
      expect(reach).toBeGreaterThan(0.5);
      expect(reach).toBeLessThan(0.75);
      for (const wall of walls) {
        if (!over(wall, [after.focus.x, after.focus.y, after.focus.z], 0)) continue;
        const eyeSide = Math.sign(local(wall, after.eye).off);
        const off = local(wall, [after.focus.x, after.focus.y, after.focus.z]).off;
        expect(Math.sign(off), `the board is on the user's side of a ${wall.label}`).toBe(eyeSide);
      }
      // Timers stand on the surface beside the board; on one too small, they hover in a row just above the board.
      let standing = 0;
      for (const timer of after.timers) {
        const foot = bottomOf(timer, 0.16 * s);
        if (Math.abs(foot[1] - desk!.center[1]) < 0.06) {
          standing++;
          expect(over(desk!, foot, 0.04), 'the timer stands on the surface').toBe(true);
        } else {
          expect(foot[1], 'a timer off the surface hovers above the board').toBeGreaterThan(after.focus.y + 0.25 * s * Math.cos(after.focus.pitch));
        }
      }
      outcome.push(standing === after.timers.length ? 'timer on it' : 'timer above the board (small surface)');
      if (after.plant) {
        expect(after.plant.y).toBeCloseTo(desk!.center[1], 3);
        expect(over(desk!, [after.plant.x, after.plant.y, after.plant.z], -0.04), 'the plant stands inside the outline').toBe(true);
      }
      outcome.push(`desk "${desk!.label}" at ${desk!.center[1].toFixed(2)} m`, `board ${(lift * 100).toFixed(1)} cm above it, ${reach.toFixed(2)} m away`, after.plant ? 'plant on it' : 'no room for the plant');
    } else {
      // Nowhere to stand it: the board stays where it was.
      expect(after.focus).toEqual(before);
      outcome.push(chair ? 'surface out of reach: board unchanged' : 'no desk-height surface: board unchanged');
    }
    // Parked boards that moved hang flat on a wall, never a door or a window.
    let onWalls = 0;
    const opening = (w: Plane) => w.label === 'door' || w.label === 'window';
    for (const pose of after.parked) {
      const p = [pose.x, pose.y, pose.z];
      if (!walls.some((w) => !opening(w) && Math.abs(local(w, p).off) < 0.06 && over(w, p, 0.05))) continue;
      onWalls++;
      const covered = walls.find((w) => opening(w) && Math.abs(local(w, p).off) < 0.15 && over(w, p, 0));
      expect(covered?.label, 'a board hangs over a door or a window').toBeUndefined();
    }
    expect(onWalls).toBeGreaterThanOrEqual(after.fit.walls);
    outcome.push(`${after.fit.walls} board(s) on walls`);
    console.log(`ROOM ${room}: ${outcome.join('; ')}`);
    expect(errors).toEqual([]);
  });
}
