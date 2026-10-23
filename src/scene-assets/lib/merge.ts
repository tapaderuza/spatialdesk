/**
 * Merging for the studio assets: each asset is one mesh, one material and one draw call, its surfaces told apart by
 * vertex colour. Parts are made non-indexed, transformed and appended, each with a flat colour or a colour per
 * vertex position (a gentle gradient), lit once into the colours (light.ts) for an unlit material.
 */
import { BufferGeometry, Color, Float32BufferAttribute, type Matrix4 } from '@iwsdk/core';
import { bakeLight } from './light.js';

export interface ColoredPart {
  geometry: BufferGeometry;
  /** A colour (sRGB hex), or one computed from each vertex's merged position. */
  color: string | ((x: number, y: number, z: number, out: Color) => void);
  matrix?: Matrix4;
}

export function mergeColored(parts: readonly ColoredPart[]): BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const color = new Color();
  const lit = new Color();
  for (const part of parts) {
    const geometry = part.geometry.index ? part.geometry.toNonIndexed() : part.geometry.clone();
    if (part.matrix) geometry.applyMatrix4(part.matrix);
    if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
    const p = geometry.getAttribute('position');
    const n = geometry.getAttribute('normal');
    if (typeof part.color === 'string') color.set(part.color);
    for (let i = 0; i < p.count; i++) {
      const [x, y, z] = [p.getX(i), p.getY(i), p.getZ(i)];
      if (typeof part.color === 'function') part.color(x, y, z, color);
      positions.push(x, y, z);
      normals.push(n.getX(i), n.getY(i), n.getZ(i));
      lit.copy(color);
      bakeLight(lit, n.getX(i), n.getY(i), n.getZ(i));
      colors.push(lit.r, lit.g, lit.b);
    }
    geometry.dispose();
  }
  const merged = new BufferGeometry();
  merged.setAttribute('position', new Float32BufferAttribute(positions, 3));
  merged.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  merged.setAttribute('color', new Float32BufferAttribute(colors, 3));
  merged.computeBoundingBox();
  merged.computeBoundingSphere();
  return merged;
}
