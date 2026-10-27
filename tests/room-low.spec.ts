/**
 * Fit room on a low surface: a sofa seat or a bed, 30 cm up, for a body lying back (src/room/fit.ts). The rule is the
 * pure math (which plane is the surface, how high the board stands), the posture that switches it on (the comfort
 * profile tilted back, or "I'm on the sofa"), and the one thing that must not change: without them a room is fitted
 * exactly as before, so a chair or a shelf is never taken for a desk (tests/rooms.spec.ts depends on that).
 */
import { expect, test } from '@playwright/test';
import { findDesk, fitToRoom, isSeat, RECLINED_TILT_DEG, type RoomPlane } from '../src/room/fit.js';
import type { Workspace } from '../src/workspace/model.js';

const viewer = { x: 0, y: 0.95, z: 0, yaw: 0, pitch: 0 };
const surface = (label: string, height: number, depth = 0.65): RoomPlane => ({
  orientation: 'horizontal', label, center: [0, height, -depth], normal: [0, 1, 0], tangent: [1, 0, 0], min: [-0.9, -0.45], max: [0.9, 0.45],
});
const couch = surface('couch', 0.45);
const bed = surface('bed', 0.4);
const wall: RoomPlane = { orientation: 'vertical', label: 'wall', center: [-1.25, 1.2, 0], normal: [1, 0, 0], tangent: [0, 0, -1], min: [-1.2, -1], max: [1.2, 1] };

const workspace = (tiltDeg: number) => ({
  focusBoardId: 'b1',
  comfort: { reach: 1, scale: 1, side: 'both', turnDeg: 120, tiltDeg },
  boards: [{ id: 'b1', pose: { x: 0, y: 1.1, z: -0.62, yaw: 0, pitch: 0 } }, { id: 'b2', pose: { x: -1.2, y: 1.2, z: -0.8, yaw: 1, pitch: 0 } }],
  timers: [],
}) as unknown as Workspace;

test('low mode: a sofa or a bed at 30 cm to 1.15 m is the surface; below, above or behind the user is not', () => {
  expect(findDesk([couch], viewer, true)).toBe(couch);
  expect(findDesk([bed], viewer, true)).toBe(bed);
  expect(findDesk([surface('couch', 0.25)], viewer, true), 'under 30 cm').toBeNull();
  expect(findDesk([surface('couch', 1.3)], viewer, true), 'above desk height').toBeNull();
  expect(findDesk([couch], { ...viewer, yaw: Math.PI }, true), 'behind the user').toBeNull();
  expect(findDesk([surface('couch', 0.45, 2.5)], viewer, true), 'out of reach').toBeNull();
  expect(isSeat('couch') && isSeat('sofa') && isSeat('bed')).toBe(true);
  expect(isSeat('table') || isSeat('floor')).toBe(false);
});

test('low mode prefers what a body lies on over an unlabelled low shelf, and a real desk over both', () => {
  const shelf = surface('other', 0.4);
  expect(findDesk([shelf, couch], viewer, true)).toBe(couch);
  const desk = surface('desk', 0.74);
  expect(findDesk([shelf, desk], viewer, true)).toBe(desk);
});

test('without low mode a room is fitted as before: a low surface is no desk', () => {
  expect(findDesk([couch], viewer)).toBeNull();
  expect(findDesk([couch], viewer, false)).toBeNull();
  expect(findDesk([couch, surface('table', 0.75)], viewer)?.label).toBe('table');
  expect(fitToRoom(workspace(0), viewer, [couch, wall]).desk).toBeNull();
});

test('a reclined comfort profile switches low mode on by itself, and the board stands 2 cm above the surface', () => {
  expect(RECLINED_TILT_DEG).toBe(10);
  expect(fitToRoom(workspace(RECLINED_TILT_DEG - 1), viewer, [couch, wall]).desk, 'not reclined enough').toBeNull();
  const fit = fitToRoom(workspace(RECLINED_TILT_DEG), viewer, [couch, wall]);
  expect(fit.desk).toBe(couch);
  const pose = fit.poses.find((p) => p.id === 'b1')!.pose;
  expect(pose.y - 0.25).toBeCloseTo(0.45 + 0.02, 2); // bottom edge 2 cm above the seat: not hanging in the air
  expect(pose.z).toBeCloseTo(-0.62, 2); // arm's length, over the surface
  expect(fit.poses.some((p) => p.id === 'b2'), 'the parked board still goes to the wall').toBe(true);
});

test('saying it overrides the posture either way', () => {
  expect(fitToRoom(workspace(0), viewer, [bed, wall], 1, { low: true }).desk).toBe(bed);
  expect(fitToRoom(workspace(30), viewer, [bed, wall], 1, { low: false }).desk, 'asked for a desk only').toBeNull();
});

test('"I\'m on the sofa" and "estoy en la cama" ask for low mode; "fit to my room" keeps asking for the usual', async () => {
  const { parseCommand } = await import('../src/voice/commands.js');
  for (const said of ["I'm on the sofa", 'I am in bed', "I'm lying on the couch.", 'estoy en el sofá', 'Estoy en la cama', 'estoy tumbada en la cama']) {
    expect(parseCommand(said), said).toEqual({ kind: 'fit', low: true });
  }
  expect(parseCommand('fit to my room')).toEqual({ kind: 'fit' });
  expect(parseCommand("I can't turn my neck")?.kind).toBe('comfort'); // a description still goes to the agent
});
