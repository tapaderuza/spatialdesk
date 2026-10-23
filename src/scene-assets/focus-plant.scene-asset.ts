/**
 * The focus sprout: a plant in a stone-glazed pot that grows a leaf with every focus block and opens a blossom every
 * sixth. Visible growth between sessions is the reward, and it is kind: the plant never wilts, a day off just waits.
 * In VR it stands on the studio desk; in "In my room", on the user's real desk beside the board.
 *
 * One mesh, one unlit material, one draw call. Its geometry has room for the fully grown plant and writePlant()
 * rewrites it in place, without allocating: when a block ends, and on each frame while a new leaf unfurls. Flat-shaded
 * low poly like the hills, its light baked into each triangle's colour as it is written (lib/light.ts).
 *
 * Contract: origin at the centre of the pot's base (y = 0 stands on the desk), up +Y, the pot 0.12 m across with its
 * soil at 0.085 m; fully grown the plant is about 0.3 m tall. [growth] is focus blocks done (fractional while a leaf
 * unfurls).
 */
import { Box3, BufferGeometry, Color, DoubleSide, DynamicDrawUsage, Float32BufferAttribute, Mesh, MeshBasicMaterial, Sphere, Vector3 } from '@iwsdk/core';
import { bakeLight } from './lib/light.js';

export const PLANT = { maxLeaves: 18, maxBlossoms: 3, blocksPerBlossom: 6 } as const;

const SEG = 20; // around the pot
const POT = [
  // [radius, height] from the outer base up over the rim and down the inside to the soil.
  [0.042, 0],
  [0.05, 0.045],
  [0.056, 0.082],
  [0.06, 0.088],
  [0.058, 0.095],
  [0.052, 0.093],
  [0.05, 0.085],
] as const;
const SOIL_Y = 0.085;
const STEM_SIDES = 6;
const STEM_RINGS = 8;
const LEAF_ALONG = 5;
const PETALS = 5;
const GOLDEN = (137.5 * Math.PI) / 180;

const TRIS =
  (POT.length - 1) * SEG * 2 + SEG + // pot and soil
  (STEM_RINGS - 1) * STEM_SIDES * 2 + STEM_SIDES + // stem and its tip
  PLANT.maxLeaves * LEAF_ALONG * 4 + // leaves: two strips either side of the rib
  PLANT.maxBlossoms * (PETALS * 2 + 4); // petals and a centre

const C = (hex: string) => new Color(hex);
const COLOR = {
  pot: C('#d9d1c4'),
  rim: C('#c4baab'),
  potInside: C('#8a7f73'),
  soil: C('#3a2a1f'),
  stem: C('#5b8a46'),
  leafBase: C('#3f7a45'),
  leafTip: C('#8cc56a'),
  young: C('#a8dc84'),
  petal: C('#ffd27a'),
  heart: C('#e98e3a'),
} as const;

/** Stem height after [growth] blocks: a quick start, then slower, about 0.2 m above the soil. */
export const stemHeight = (growth: number) => 0.035 + 0.17 * (1 - Math.exp(-growth / 7));

// Writing cursor and scratch values: module-level, so writing a frame allocates nothing.
let pos: Float32Array;
let nor: Float32Array;
let col: Float32Array;
let cursor = 0;
const tint = new Color();
const lit = new Color();
/** Leaves and petals are thin sheets: lit alike from either side. */
let twoSided = false;

function tri(ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number, c: Color): void {
  // Flat normal: (b - a) x (c - a), normalised.
  const ux = bx - ax, uy = by - ay, uz = bz - az;
  const vx = cx - ax, vy = cy - ay, vz = cz - az;
  let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const len = Math.hypot(nx, ny, nz) || 1;
  nx /= len; ny /= len; nz /= len;
  const i = cursor * 9;
  pos[i] = ax; pos[i + 1] = ay; pos[i + 2] = az;
  pos[i + 3] = bx; pos[i + 4] = by; pos[i + 5] = bz;
  pos[i + 6] = cx; pos[i + 7] = cy; pos[i + 8] = cz;
  bakeLight(lit.copy(c), nx, ny, nz, twoSided);
  for (let k = 0; k < 9; k += 3) {
    nor[i + k] = nx; nor[i + k + 1] = ny; nor[i + k + 2] = nz;
    col[i + k] = lit.r; col[i + k + 1] = lit.g; col[i + k + 2] = lit.b;
  }
  cursor++;
}

/** Scratch points ([x, y, z] each) for the part being written: indices into it name the corners. */
const pts = new Float64Array(64 * 3);

function setPt(i: number, x: number, y: number, z: number): void {
  pts[i * 3] = x;
  pts[i * 3 + 1] = y;
  pts[i * 3 + 2] = z;
}

function triPts(a: number, b: number, c: number, color: Color): void {
  tri(pts[a * 3], pts[a * 3 + 1], pts[a * 3 + 2], pts[b * 3], pts[b * 3 + 1], pts[b * 3 + 2], pts[c * 3], pts[c * 3 + 1], pts[c * 3 + 2], color);
}

function quadPts(a: number, b: number, c: number, d: number, color: Color): void {
  triPts(a, b, c, color);
  triPts(a, c, d, color);
}

const smooth = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

/** The pot, a lathe of POT around Y, and the soil inside it. DoubleSide: every face is lit from the side seen. */
function writePot(): void {
  for (let p = 0; p < POT.length - 1; p++) {
    const [r0, y0] = POT[p];
    const [r1, y1] = POT[p + 1];
    const color = p >= 5 ? COLOR.potInside : p >= 2 ? COLOR.rim : COLOR.pot;
    for (let s = 0; s < SEG; s++) {
      const a0 = (s / SEG) * Math.PI * 2;
      const a1 = ((s + 1) / SEG) * Math.PI * 2;
      setPt(0, r0 * Math.cos(a0), y0, r0 * Math.sin(a0));
      setPt(1, r0 * Math.cos(a1), y0, r0 * Math.sin(a1));
      setPt(2, r1 * Math.cos(a1), y1, r1 * Math.sin(a1));
      setPt(3, r1 * Math.cos(a0), y1, r1 * Math.sin(a0));
      quadPts(0, 3, 2, 1, color);
    }
  }
  const r = POT[POT.length - 1][0];
  for (let s = 0; s < SEG; s++) {
    const a0 = (s / SEG) * Math.PI * 2;
    const a1 = ((s + 1) / SEG) * Math.PI * 2;
    tri(0, SOIL_Y, 0, r * Math.cos(a1), SOIL_Y, r * Math.sin(a1), r * Math.cos(a0), SOIL_Y, r * Math.sin(a0), COLOR.soil);
  }
}

/** A point on the stem, [t] from the soil (0) to the tip (1), with a gentle S-curve. */
function stemPoint(t: number, height: number, out: Float64Array, at: number): void {
  out[at] = 0.006 * Math.sin(t * 2.6) * (height / 0.2);
  out[at + 1] = SOIL_Y + t * height;
  out[at + 2] = 0.004 * Math.sin(t * 1.9 + 0.8) * (height / 0.2);
}

const center = new Float64Array(3);

function writeStem(height: number): void {
  for (let k = 0; k < STEM_RINGS; k++) {
    const t = k / (STEM_RINGS - 1);
    stemPoint(t, height, center, 0);
    const r = 0.0042 * (1 - 0.55 * t);
    for (let j = 0; j < STEM_SIDES; j++) {
      const a = (j / STEM_SIDES) * Math.PI * 2;
      setPt(k * STEM_SIDES + j, center[0] + r * Math.cos(a), center[1], center[2] + r * Math.sin(a));
    }
  }
  for (let k = 0; k < STEM_RINGS - 1; k++) {
    for (let j = 0; j < STEM_SIDES; j++) {
      const n = (j + 1) % STEM_SIDES;
      quadPts(k * STEM_SIDES + j, (k + 1) * STEM_SIDES + j, (k + 1) * STEM_SIDES + n, k * STEM_SIDES + n, COLOR.stem);
    }
  }
  const top = (STEM_RINGS - 1) * STEM_SIDES;
  setPt(63, center[0], center[1] + 0.004, center[2]);
  for (let j = 0; j < STEM_SIDES; j++) triPts(63, top + j, top + ((j + 1) % STEM_SIDES), COLOR.stem);
}

const attach = new Float64Array(3);

/**
 * One leaf from [attach]: [yaw] around the stem, [pitch] up from level, [length] long, cupped across and drooping
 * toward its tip. [youth] (1 new, 0 mature) tints it the fresh green of a leaf just opened.
 */
function writeLeaf(yaw: number, pitch: number, length: number, youth: number): void {
  const [fx, fy, fz] = [Math.cos(pitch) * Math.sin(yaw), Math.sin(pitch), Math.cos(pitch) * Math.cos(yaw)];
  const [sx, sz] = [Math.cos(yaw), -Math.sin(yaw)];
  // n = f x s: the leaf's upper side.
  const [nx, ny, nz] = [fy * sz, fz * sx - fx * sz, -fy * sx];
  const width = 0.42 * length;
  for (let i = 0; i <= LEAF_ALONG; i++) {
    const u = i / LEAF_ALONG;
    const along = u * length;
    const droop = 0.18 * length * u * u;
    const rx = attach[0] + fx * along;
    const ry = attach[1] + fy * along - droop;
    const rz = attach[2] + fz * along;
    const w = width * Math.pow(Math.sin(Math.PI * u), 0.75);
    const cup = 0.2 * w;
    setPt(i, rx, ry, rz);
    setPt(8 + i, rx - sx * w + nx * cup, ry + ny * cup, rz - sz * w + nz * cup);
    setPt(16 + i, rx + sx * w + nx * cup, ry + ny * cup, rz + sz * w + nz * cup);
  }
  for (let i = 0; i < LEAF_ALONG; i++) {
    tint.lerpColors(COLOR.leafBase, COLOR.leafTip, (i + 0.5) / LEAF_ALONG).lerp(COLOR.young, youth * 0.6);
    quadPts(i, i + 1, 8 + i + 1, 8 + i, tint);
    quadPts(i, 16 + i, 16 + i + 1, i + 1, tint);
  }
}

/** A five-petal blossom at [attach], [size] 0..1 as it opens, turned by [turn]. */
function writeBlossom(size: number, turn: number): void {
  const [cx, cy, cz] = [attach[0], attach[1], attach[2]];
  setPt(0, cx, cy, cz);
  for (let p = 0; p < PETALS; p++) {
    const phi = (p / PETALS) * Math.PI * 2 + turn;
    // Rounded petals: wide at the middle, cupped up toward the tip.
    const tip = 0.028 * size;
    const side = 0.014 * size;
    setPt(1, cx + Math.cos(phi - 0.55) * side, cy + 0.003 * size, cz + Math.sin(phi - 0.55) * side);
    setPt(2, cx + Math.cos(phi) * tip, cy + 0.008 * size, cz + Math.sin(phi) * tip);
    setPt(3, cx + Math.cos(phi + 0.55) * side, cy + 0.003 * size, cz + Math.sin(phi + 0.55) * side);
    triPts(0, 1, 2, COLOR.petal);
    triPts(0, 2, 3, COLOR.petal);
  }
  setPt(4, cx, cy + 0.007 * size, cz);
  for (let q = 0; q < 4; q++) {
    const a0 = (q / 4) * Math.PI * 2 + turn;
    const a1 = ((q + 1) / 4) * Math.PI * 2 + turn;
    setPt(5, cx + Math.cos(a0) * 0.005 * size, cy + 0.002 * size, cz + Math.sin(a0) * 0.005 * size);
    setPt(6, cx + Math.cos(a1) * 0.005 * size, cy + 0.002 * size, cz + Math.sin(a1) * 0.005 * size);
    triPts(4, 5, 6, COLOR.heart);
  }
}

/** Room for the fully grown plant, rewritten by writePlant(). Each placed plant gets its own (geometry is shared). */
export function createPlantGeometry(): BufferGeometry {
  const geometry = new BufferGeometry();
  for (const name of ['position', 'normal', 'color']) {
    geometry.setAttribute(name, new Float32BufferAttribute(new Float32Array(TRIS * 9), 3).setUsage(DynamicDrawUsage));
  }
  // Fixed bounds that hold the fully grown plant, so growth never needs them recomputed.
  geometry.boundingBox = new Box3(new Vector3(-0.13, 0, -0.13), new Vector3(0.13, 0.33, 0.13));
  geometry.boundingSphere = geometry.boundingBox.getBoundingSphere(new Sphere());
  return geometry;
}

/**
 * Writes the plant after [growth] focus blocks into [geometry] (from createPlantGeometry): two seed leaves, then a
 * leaf per block in a golden-angle spiral (each unfurling over its block's fraction, and growing on with age), and a
 * blossom every sixth block. Allocation-free: safe to call every frame while a leaf unfurls.
 */
export function writePlant(geometry: BufferGeometry, growth: number): void {
  pos = geometry.getAttribute('position').array as Float32Array;
  nor = geometry.getAttribute('normal').array as Float32Array;
  col = geometry.getAttribute('color').array as Float32Array;
  cursor = 0;
  const g = Math.max(0, growth);
  const height = stemHeight(g);
  twoSided = false;
  writePot();
  writeStem(height);
  twoSided = true;
  // Seed leaves, low on the stem.
  for (let k = 0; k < 2; k++) {
    stemPoint(0.14, height, attach, 0);
    writeLeaf(k * Math.PI + 0.4, (25 * Math.PI) / 180, 0.034, 0);
  }
  const leaves = Math.min(PLANT.maxLeaves - 2, Math.ceil(g));
  for (let j = 0; j < leaves; j++) {
    const unfurl = smooth(g - j);
    if (unfurl <= 0) continue;
    const age = Math.max(0, g - j);
    const at = Math.min(stemHeight(j + 0.5) * 0.9, height * 0.95);
    stemPoint(at / height, height, attach, 0);
    const pitch = ((22 + 30 * Math.exp(-age / 3)) * Math.PI) / 180;
    writeLeaf(j * GOLDEN + 0.9, pitch, (0.032 + 0.03 * (1 - Math.exp(-age / 4))) * unfurl, Math.exp(-age / 2));
  }
  for (let j = 0; j < PLANT.maxBlossoms; j++) {
    const open = smooth(g - (PLANT.blocksPerBlossom * (j + 1) - 1));
    if (open <= 0) break;
    // The first at the tip, later ones lower down, each against the stem.
    stemPoint(1 - 0.22 * j, height, attach, 0);
    attach[0] += Math.cos(j * 2.1) * 0.005 * Math.min(j, 1);
    attach[2] += Math.sin(j * 2.1) * 0.005 * Math.min(j, 1);
    writeBlossom(open, j * 0.7);
  }
  geometry.setDrawRange(0, cursor * 3);
  geometry.getAttribute('position').needsUpdate = true;
  geometry.getAttribute('normal').needsUpdate = true;
  geometry.getAttribute('color').needsUpdate = true;
}

/** The catalogue plant: nine blocks in, a blossom open. A placed plant writes its own growth into its own geometry. */
const geometry = createPlantGeometry();
writePlant(geometry, 9);
const plant = new Mesh(geometry, new MeshBasicMaterial({ vertexColors: true, side: DoubleSide }));
plant.name = 'Plant';

export default plant;
