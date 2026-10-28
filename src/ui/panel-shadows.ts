/**
 * Panels that sit in the room rather than on the glass: in passthrough, a soft shadow behind every board and timer, as
 * if lit from a little above, so against a real wall a board reads as an object hung on it. Only in passthrough: in VR
 * the dusk sky is so dark that the same shadow changes it by about 7 levels in 255 (measured), nothing anyone can see,
 * and it would still cost a draw call per eye. One instanced mesh holds every shadow (one draw call whatever the number of
 * panels), a rounded-rectangle falloff in the shader (no texture), and the instance data is sent to the GPU only on a
 * frame when some panel has moved. Nothing is allocated per frame.
 */
import { createSystem, InstancedBufferAttribute, InstancedMesh, Matrix4, PlaneGeometry, ShaderMaterial, type Object3D } from '@iwsdk/core';

/** More panels than this cast no shadow (the engine never lays out nearly as many). */
const MAX = 24;
/** Where the shadow sits in the panel's own frame: below (light from above) and just behind it. */
const DROP_Y = -0.02;
const BEHIND_Z = -0.012;
/** How far beyond the panel's edges the shadow reaches, fading from [OPACITY] at the edge to nothing. */
const SPREAD = 0.06;
const OPACITY = 0.35;

interface Caster {
  object: Object3D;
  width: number;
  height: number;
}

const casters: Caster[] = [];

/** [object] (a panel's root, centred on the panel) casts a shadow of [size] metres; the returned function stops it. */
export function castShadow(object: Object3D, size: { width: number; height: number }): () => void {
  const caster: Caster = { object, width: size.width, height: size.height };
  casters.push(caster);
  return () => {
    const index = casters.indexOf(caster);
    if (index >= 0) casters.splice(index, 1);
  };
}

const VERTEX = /* glsl */ `
  attribute vec2 aSize;
  varying vec2 vPos;
  varying vec2 vHalf;
  void main() {
    vPos = (uv - 0.5) * aSize; // metres from the centre, in the panel's own frame
    vHalf = aSize * 0.5 - vec2(${SPREAD.toFixed(3)}); // the panel's own half size
    vec4 p = vec4(position, 1.0);
    #ifdef USE_INSTANCING
      p = instanceMatrix * p;
    #endif
    gl_Position = projectionMatrix * modelViewMatrix * p;
  }
`;

/** Full strength at the panel's edge, gone [SPREAD] beyond it, with round corners: the falloff of a soft contact shadow. */
const FRAGMENT = /* glsl */ `
  uniform float uOpacity;
  varying vec2 vPos;
  varying vec2 vHalf;
  void main() {
    vec2 outside = max(abs(vPos) - vHalf, 0.0);
    float fall = 1.0 - smoothstep(0.0, 1.0, length(outside) / ${SPREAD.toFixed(3)});
    gl_FragColor = vec4(0.0, 0.0, 0.0, uOpacity * fall * fall);
  }
`;

function shown(object: Object3D): boolean {
  for (let o: Object3D | null = object; o; o = o.parent) if (!o.visible) return false;
  return true;
}

/** Keeps every shadow under its panel. Register after the systems that move panels (GlideSystem). */
export class PanelShadowSystem extends createSystem({}) {
  private mesh!: InstancedMesh;
  private sizes!: InstancedBufferAttribute;
  private readonly local = new Matrix4();
  private readonly placed = new Matrix4();
  /** The matrices sent last time (in the same precision as three's), to send nothing when nothing moved. */
  private readonly sent = new Float64Array(MAX * 16);
  private sentCount = -1;

  init(): void {
    const geometry = new PlaneGeometry(1, 1);
    this.sizes = new InstancedBufferAttribute(new Float32Array(MAX * 2), 2);
    geometry.setAttribute('aSize', this.sizes);
    const material = new ShaderMaterial({
      uniforms: { uOpacity: { value: OPACITY } },
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      depthWrite: false,
    });
    this.mesh = new InstancedMesh(geometry, material, MAX);
    this.mesh.name = 'panel-shadows';
    this.mesh.count = 0;
    this.mesh.frustumCulled = false; // the instances are everywhere; the mesh's own bounds mean nothing
    this.mesh.renderOrder = -1; // before the panels, which are drawn over it
    this.world.createTransformEntity(this.mesh);
    (window as unknown as { __shadows: unknown }).__shadows = { count: () => this.mesh.count, mesh: this.mesh };
  }

  update(): void {
    const blend = this.world.session?.environmentBlendMode;
    const room = blend === 'alpha-blend' || blend === 'additive';
    if (!room) {
      if (this.mesh.visible) {
        this.mesh.visible = false;
        this.mesh.count = 0;
        this.sentCount = -1;
        this.sent.fill(Number.NaN); // back in a room, every instance is written again
      }
      return;
    }
    this.mesh.visible = true;
    let count = 0;
    let changed = false;
    for (let i = 0; i < casters.length && count < MAX; i++) {
      const caster = casters[i];
      if (!shown(caster.object)) continue;
      caster.object.updateWorldMatrix(true, false);
      const width = caster.width + 2 * SPREAD;
      const height = caster.height + 2 * SPREAD;
      this.local.makeScale(width, height, 1).setPosition(0, DROP_Y, BEHIND_Z);
      this.placed.multiplyMatrices(caster.object.matrixWorld, this.local);
      const e = this.placed.elements;
      const base = count * 16;
      for (let k = 0; k < 16; k++) {
        if (this.sent[base + k] !== e[k]) {
          this.sent[base + k] = e[k];
          changed = true;
        }
      }
      // From the first instance that differs on, every later one is rewritten (a panel gone shifts the rest down).
      if (changed) {
        this.mesh.setMatrixAt(count, this.placed);
        this.sizes.setXY(count, width, height);
      }
      count++;
    }
    if (count !== this.sentCount) changed = true;
    if (!changed) return;
    this.sentCount = count;
    this.mesh.count = count;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.sizes.needsUpdate = true;
  }
}
