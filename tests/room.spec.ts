/**
 * "In my room" (Innovation and Technical criteria: passthrough that changes the experience, scene understanding,
 * persistent anchors). The fitting rules as pure math, then end to end in IWER with the Synthetic Environment
 * Module's scanned small office (?room=office_small: walls, a door, a window and a table at 0.75 m, 0.65 m ahead):
 * enter the room from the command panel, Fit room puts the work board on the real table and the parked boards on
 * the real walls, it undoes in one step, and after leaving and reorganising, entering the room again puts every
 * board back where it was in the room.
 */
import { expect, test, type Page } from '@playwright/test';
import { findDesk, fitToRoom, invertRigid, matrixPose, multiply, poseMatrix, type RoomPlane } from '../src/room/fit.js';
import type { Workspace } from '../src/workspace/model.js';
import { frames, openWorkspace, pressXR, tap, turnHead, type Win } from './helpers.js';

const viewer = { x: 0, y: 1.2, z: 0, yaw: 0, pitch: 0 };
const table: RoomPlane = { orientation: 'horizontal', label: 'table', center: [0, 0.75, -0.65], normal: [0, 1, 0], tangent: [1, 0, 0], min: [-0.8, -0.38], max: [0.8, 0.38] };
const leftWall: RoomPlane = { orientation: 'vertical', label: 'wall', center: [-1.25, 1.4, 0], normal: [1, 0, 0], tangent: [0, 0, -1], min: [-1.2, -1.36], max: [1.2, 1.36] };
const rightWall: RoomPlane = { orientation: 'vertical', label: 'wall', center: [1.25, 1.4, 0], normal: [-1, 0, 0], tangent: [0, 0, 1], min: [-1.2, -1.36], max: [1.2, 1.36] };
/** A 90 cm door near the front end of the right wall (the headset reports it as its own plane on top of the wall's). */
const door: RoomPlane = { ...rightWall, label: 'door', center: [1.25, 1.05, 1.0], min: [-0.45, -1.05], max: [0.45, 1.05] };

const workspace = {
  focusBoardId: 'b1',
  boards: [
    { id: 'b1', pose: { x: 0, y: 1.1, z: -0.62, yaw: 0, pitch: 0 } },
    { id: 'b2', pose: { x: -1.2, y: 1.2, z: -0.8, yaw: 1, pitch: 0 } },
    { id: 'b3', pose: { x: 1.4, y: 1.2, z: 0, yaw: -1.5, pitch: 0 } },
  ],
  timers: [{ id: 't1', pose: { x: 0.5, y: 1.2, z: -0.6, yaw: 0, pitch: 0 } }],
} as unknown as Workspace;

test('room fit: the work board stands on the table, parked boards hang on walls, never on a door', () => {
  expect(findDesk([table], viewer)).toBe(table);
  expect(findDesk([table], { ...viewer, yaw: Math.PI })).toBeNull(); // behind the user: not their desk
  const fit = fitToRoom(workspace, viewer, [table, leftWall, rightWall, door]);
  const pose = (id: string) => fit.poses.find((p) => p.id === id)!.pose;
  expect(fit.desk).toBe(table);
  expect(pose('b1').y - 0.25).toBeCloseTo(0.77, 2); // bottom edge 2 cm above the table top
  expect(pose('b1').z).toBeCloseTo(-0.62, 2); // arm's length, over the table (z -0.27..-1.03)
  expect(pose('b1').pitch).toBeLessThan(0); // leans back toward the eyes
  expect(pose('b2').x).toBeCloseTo(-1.22, 2); // on the left wall, 3 cm off it
  expect(pose('b2').yaw).toBeCloseTo(Math.PI / 2, 3); // facing into the room
  expect(pose('b3').x).toBeCloseTo(1.22, 2); // right wall, clear of its door
  expect(fit.walls).toBe(2);
  // A door right where a board would hang: the board slides along the wall until it is clear of it.
  const doorAhead: RoomPlane = { ...rightWall, label: 'door', center: [1.25, 1.05, 0], min: [-0.3, -1.05], max: [0.3, 1.05] };
  const slid = fitToRoom(workspace, viewer, [table, leftWall, rightWall, doorAhead]).poses.find((p) => p.id === 'b3')!.pose;
  expect(slid.x).toBeCloseTo(1.22, 2);
  expect(Math.abs(slid.z)).toBeGreaterThan(0.71); // past the door and half a board
  expect(pose('t1').y).toBeLessThan(1); // the timer stands on the table beside the board
  // The focus plant stands on the table itself, on the right (the console covers the left): the 1.6 m table ends
  // before the far side of the timer, so the plant stands between the board and the timer, which steps aside.
  expect(fit.plant?.y).toBeCloseTo(0.75, 3);
  expect(fit.plant?.x).toBeCloseTo(0.43, 2);
  expect(pose('t1').x).toBeCloseTo(0.63, 2);
  expect(fitToRoom({ ...workspace, timers: [] } as Workspace, viewer, [table]).plant?.x).toBeCloseTo(0.46, 2);
  // Panels drawn smaller for a narrower view (Meta VR Glasses) still stand on the table, not above it.
  const small = fitToRoom(workspace, viewer, [table], 0.85).poses.find((p) => p.id === 'b1')!.pose;
  expect(small.y - 0.25 * 0.85).toBeCloseTo(0.77, 2);
  expect(fitToRoom(workspace, viewer, []).poses).toEqual([]); // no surfaces: nothing moves
});

test('room anchor math: a pose relative to the anchor comes back exactly', () => {
  const anchor = poseMatrix({ x: 0.4, y: 0, z: -0.2, yaw: 0.7, pitch: 0 });
  const pose = { x: -1.1, y: 1.3, z: -0.5, yaw: 1.2, pitch: -0.3 };
  const back = matrixPose(multiply(anchor, multiply(invertRigid(anchor), poseMatrix(pose))));
  for (const key of ['x', 'y', 'z', 'yaw', 'pitch'] as const) expect(back[key]).toBeCloseTo(pose[key], 6);
});

const poses = (page: Page) =>
  page.evaluate(() => Object.fromEntries((window as Win).__workspace.state.boards.map((b: any) => [b.id, b.pose])) as Record<string, { x: number; y: number; z: number }>);

async function enterRoom(page: Page): Promise<void> {
  await tap(page, 'command:room-button');
  await page
    .waitForFunction(() => (window as Win).__room?.state.inRoom && (window as Win).__room.queries.planes.entities.size >= 8, null, { timeout: 30_000 })
    .catch(async (error) => {
      const w = await page.evaluate(() => {
        const win = window as Win;
        return { vis: win.__world.visibilityState.value, blend: win.__world.session?.environmentBlendMode, room: win.__room.state, planes: win.__room.queries.planes.entities.size, notice: win.__notice };
      });
      throw new Error(`${error.message} ${JSON.stringify(w)}`);
    });
  await frames(page, 20);
}

test('in my room: fit to the real table and walls, undo in one step, and remembered after reorganising', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = await openWorkspace(page, '?emulate&room=office_small');
  await page.evaluate(() => (window as Win).__xrDevice.position.set(0, 1.2, 0)); // seated at the table
  await enterRoom(page);
  expect(await page.evaluate(() => (window as Win).__world.session.environmentBlendMode)).toBe('alpha-blend'); // passthrough
  const focus = await page.evaluate(() => (window as Win).__workspace.state.focusBoardId as string);
  const before = await poses(page);

  await turnHead(page, 40); // seated, the user looks at the console to press Fit room...
  await pressXR(page, 'command:fit-button', 'left');
  await page.waitForFunction(() => (window as Win).__room.state.lastFit != null, null, { timeout: 5_000 });
  await turnHead(page, 0);
  const fit = await page.evaluate(() => (window as Win).__room.state.lastFit);
  expect(fit.desk).toBe(true);
  expect(fit.walls).toBeGreaterThanOrEqual(1);
  const fitted = await poses(page);
  expect(fitted[focus].y).toBeCloseTo(0.75 + 0.02 + 0.25, 1); // standing on the scanned table
  expect(Math.abs(fitted[focus].x)).toBeLessThan(0.05); // ...and the board still stands straight ahead, not toward the console
  expect(await page.evaluate(() => (window as Win).__notice.text)).toContain('Fitted to your room');
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('spatialdesk.room') ?? 'null')?.uuid, null, { timeout: 5_000 });

  // One undo step takes the whole fit back; voice fits it again.
  await page.evaluate(() => (window as Win).__workspace.undo());
  expect((await poses(page))[focus].y).toBeCloseTo(before[focus].y, 3);
  await page.evaluate(() => (window as Win).__voice.say('Fit to my room'));
  await page.waitForFunction(
    (y) => {
      const ws = (window as Win).__workspace.state;
      return Math.abs(ws.boards.find((b: any) => b.id === ws.focusBoardId).pose.y - y) < 0.01;
    },
    fitted[focus].y,
  );
  await page.waitForTimeout(800); // the layout is saved relative to the anchor
  const remembered = await poses(page);
  // Focus 25 in the room: the timer starts, and the boards stay on the real desk and walls (nothing steps back).
  await page.evaluate(() => (window as Win).__voice.say('focus'));
  await page.waitForFunction(() => (window as Win).__workspace.state.timers.length === 1);
  expect(await poses(page)).toEqual(remembered);

  // Leave the room, reorganise, come back: every board returns to its place in the room.
  await page.evaluate(() => (window as Win).__world.exitXR());
  await page.waitForFunction(() => (window as Win).__world.visibilityState.value === 'non-immersive' && !(window as Win).__world.session);
  await frames(page, 30); // the command panel is back on screen
  await page.evaluate(() => (window as Win).__workspace.dispatch({ op: 'arrange_space', layout: 'desk' }, { viewer: { x: 0.3, y: 1.6, z: 0, yaw: 0.4, pitch: 0 } }));
  const moved = (await poses(page))[focus];
  expect(Math.hypot(moved.x - remembered[focus].x, moved.y - remembered[focus].y, moved.z - remembered[focus].z)).toBeGreaterThan(0.2);
  await enterRoom(page);
  await page.waitForFunction(() => (window as Win).__room.state.restored > 0, null, { timeout: 10_000 });
  const restored = await poses(page);
  for (const id of Object.keys(remembered)) {
    expect(restored[id].x).toBeCloseTo(remembered[id].x, 2);
    expect(restored[id].y).toBeCloseTo(remembered[id].y, 2);
    expect(restored[id].z).toBeCloseTo(remembered[id].z, 2);
  }
  expect(await page.evaluate(() => (window as Win).__notice.text)).toContain('where you left them');
  expect(errors).toEqual([]);
});
