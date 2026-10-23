/**
 * The studio desk under the focus board in VR: a walnut top on two charcoal sled legs, the desk the board stands on
 * (in "In my room" the user's real desk takes its place). One mesh, one draw call: the woods and metal are vertex
 * colours, with the light baked in (lib/light.ts), of one unlit material.
 *
 * Contract: origin at the centre of the top surface (y = 0 is where things stand), the user sits on the +Z side,
 * 1.3 x 0.45 m. The legs run 1.4 m down so they reach the floor for any seated or standing eye height; the floor
 * disc (dusk-horizon) hides whatever runs below it.
 */
import { BoxGeometry, Matrix4, Mesh, MeshBasicMaterial } from '@iwsdk/core';
import { bevelBox } from './lib/hardsurface.js';
import { mergeColored, type ColoredPart } from './lib/merge.js';

export const DESK = { width: 1.3, depth: 0.45, thickness: 0.03, legLength: 1.4 } as const;

const WALNUT = '#6e4d36';
const WALNUT_EDGE = '#5a3e2b';
const CHARCOAL = '#2b2f36';

function deskGeometry() {
  const at = (x: number, y: number, z: number) => new Matrix4().makeTranslation(x, y, z);
  const parts: ColoredPart[] = [
    // The top, its grain a soft gradient from the user's edge (lighter, where the hands rest) to the back.
    {
      geometry: bevelBox(DESK.width, DESK.thickness, DESK.depth, 0.006, 0.045, 4),
      matrix: at(0, -DESK.thickness / 2, 0),
      color: (_x, y, z, out) => {
        out.set(y < -0.004 ? WALNUT_EDGE : WALNUT);
        out.offsetHSL(0, 0, (z / DESK.depth) * 0.03);
      },
    },
  ];
  // Sled legs: two posts per side joined by a rail under the top, set in from the edges so the knees have room.
  for (const side of [-1, 1]) {
    const x = side * (DESK.width / 2 - 0.09);
    for (const z of [-0.16, 0.16]) {
      parts.push({ geometry: new BoxGeometry(0.03, DESK.legLength, 0.022), matrix: at(x, -DESK.thickness - DESK.legLength / 2, z), color: CHARCOAL });
    }
    parts.push({ geometry: new BoxGeometry(0.03, 0.022, 0.36), matrix: at(x, -DESK.thickness - 0.011, 0), color: CHARCOAL });
  }
  return mergeColored(parts);
}

const desk = new Mesh(deskGeometry(), new MeshBasicMaterial({ vertexColors: true }));
desk.name = 'Desk';

export default desk;
