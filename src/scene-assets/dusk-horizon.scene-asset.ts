/**
 * The ground and horizon of the VR studio: a floor disc that glows softly under the desk and fades into the dome's
 * ground colour, and two rings of low hills at dusk, the far one paler with haze. They give the seated user a floor
 * and a distance to rest the eyes on, for one draw call (unlit, vertex colours).
 *
 * Contract: origin at the floor under the user (y = 0), the floor disc 6 m in radius (further out the dome's ground,
 * the same colour, takes over: no large fill to draw twice), hills at 45 and 62 m rising at most about 8 m: a few
 * degrees above the horizon, never behind the panels.
 */
import { BufferGeometry, Color, DoubleSide, Float32BufferAttribute, Mesh, MeshBasicMaterial } from '@iwsdk/core';

const SEGMENTS = 72;
const FLOOR = [
  // [radius, sRGB colour]: a pool of light under the desk fading to the dome's ground.
  [0, '#2a2a38'],
  [1.6, '#252633'],
  [3.5, '#1c1d28'],
  [6, '#12131a'],
] as const;
const HILLS = [
  { radius: 45, base: 2.4, waves: [[3, 2.1, 1.0], [7, 1.3, 2.3], [13, 0.7, 0.4]], foot: '#1a1726', crest: '#2b2440' },
  { radius: 62, base: 4.8, waves: [[2, 3.2, 0.5], [5, 1.9, 1.7], [11, 1.0, 2.9]], foot: '#2a2540', crest: '#4a3d5e' },
] as const;

function horizonGeometry(): BufferGeometry {
  const positions: number[] = [];
  const colors: number[] = [];
  const a = new Color();
  const b = new Color();
  const push = (x: number, y: number, z: number, c: Color) => {
    positions.push(x, y, z);
    colors.push(c.r, c.g, c.b);
  };
  const around = (s: number) => (s / SEGMENTS) * Math.PI * 2;
  for (let r = 0; r < FLOOR.length - 1; r++) {
    const [r0, c0] = FLOOR[r];
    const [r1, c1] = FLOOR[r + 1];
    a.set(c0);
    b.set(c1);
    for (let s = 0; s < SEGMENTS; s++) {
      const [t0, t1] = [around(s), around(s + 1)];
      const p = (radius: number, t: number) => [Math.cos(t) * radius, 0, Math.sin(t) * radius] as const;
      push(...p(r0, t0), a); push(...p(r1, t1), b); push(...p(r1, t0), b);
      push(...p(r0, t0), a); push(...p(r0, t1), a); push(...p(r1, t1), b);
    }
  }
  for (const hill of HILLS) {
    a.set(hill.foot);
    b.set(hill.crest);
    const height = (t: number) => Math.max(0.6, hill.base + hill.waves.reduce((sum, [f, amp, phase]) => sum + amp * Math.sin(f * t + phase), 0));
    for (let s = 0; s < SEGMENTS; s++) {
      const [t0, t1] = [around(s), around(s + 1)];
      const [x0, z0, x1, z1] = [Math.cos(t0) * hill.radius, Math.sin(t0) * hill.radius, Math.cos(t1) * hill.radius, Math.sin(t1) * hill.radius];
      const [h0, h1] = [height(t0), height(t1)];
      push(x0, -1, z0, a); push(x1, h1, z1, b); push(x1, -1, z1, a);
      push(x0, -1, z0, a); push(x0, h0, z0, b); push(x1, h1, z1, b);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  geometry.computeBoundingSphere();
  return geometry;
}

const horizon = new Mesh(horizonGeometry(), new MeshBasicMaterial({ vertexColors: true, side: DoubleSide, fog: false }));
horizon.name = 'Horizon';

export default horizon;
