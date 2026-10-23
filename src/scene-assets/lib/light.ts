/**
 * Baked light for the studio assets. The desk and the plant are drawn unlit (the cheapest shader, a few pixels each
 * in stereo), so their light is computed once into the vertex colours: a warm key from the dusk glow above and in
 * front, and a hemisphere fill, cool from the sky and dim from the ground. Flat-shaded low poly, like the hills.
 */
import type { Color } from '@iwsdk/core';

/** Where the key light comes from (normalised): up, a little toward the user, a little from the right. */
const KEY = (() => {
  const [x, y, z] = [0.35, 0.8, 0.5];
  const length = Math.hypot(x, y, z);
  return [x / length, y / length, z / length] as const;
})();
const KEY_TINT = [1, 0.93, 0.84] as const;
const SKY_TINT = [0.82, 0.86, 1] as const;

/**
 * Lights [color] in place for a surface facing (nx, ny, nz). [twoSided] lights a thin sheet (a leaf) the same from
 * either side, whichever way its triangles wind.
 */
export function bakeLight(color: Color, nx: number, ny: number, nz: number, twoSided = false): Color {
  let key = nx * KEY[0] + ny * KEY[1] + nz * KEY[2];
  key = twoSided ? Math.abs(key) : Math.max(0, key);
  const sky = (twoSided ? Math.abs(ny) : ny) * 0.5 + 0.5;
  const ambient = 0.42;
  color.r *= ambient + 0.62 * key * KEY_TINT[0] + 0.28 * sky * SKY_TINT[0];
  color.g *= ambient + 0.62 * key * KEY_TINT[1] + 0.28 * sky * SKY_TINT[1];
  color.b *= ambient + 0.62 * key * KEY_TINT[2] + 0.28 * sky * SKY_TINT[2];
  return color;
}
