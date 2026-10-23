/**
 * The focus companion: a small light that keeps you company while you work, the body double of SpatialDesk and the
 * presence of its AI agent. It floats beside the board you work on. Everything it does is in its shader, driven by
 * uniforms the companion system sets (src/studio/companion-system.ts): it breathes; a soft bright spot, its gaze,
 * turns to the board while it works with you and to you when it has something to say; and a band round its middle
 * shows how much of the focus block is left, so time can be seen at a glance.
 *
 * One mesh, one draw call. Contract: origin at the centre of the light, 4 cm in radius; its front (+Z) faces the user.
 */
import { Color, IcosahedronGeometry, Mesh, ShaderMaterial, Vector3 } from '@iwsdk/core';

export const COMPANION_RADIUS = 0.04;

const VERTEX = /* glsl */ `
uniform float uTime;
uniform float uBounce;
varying vec3 vLocal;
varying vec3 vViewNormal;
varying vec3 vViewDir;
void main() {
  vLocal = normalize(position);
  // A slow float, and a little hop when something good happens.
  vec3 p = position * (1.0 + 0.18 * uBounce);
  p.y += sin(uTime * 0.9) * 0.004 + 0.02 * uBounce;
  vec4 view = modelViewMatrix * vec4(p, 1.0);
  vViewNormal = normalize(normalMatrix * normal);
  vViewDir = normalize(-view.xyz);
  gl_Position = projectionMatrix * view;
}`;

const FRAGMENT = /* glsl */ `
uniform float uTime;
uniform float uPulse;
uniform float uSpeed;
uniform float uEye;
uniform float uProgress;
uniform float uDim;
uniform float uFlash;
uniform vec3 uCore;
uniform vec3 uRim;
uniform vec3 uEyeDir;
varying vec3 vLocal;
varying vec3 vViewNormal;
varying vec3 vViewDir;
void main() {
  float fresnel = pow(1.0 - max(dot(normalize(vViewNormal), normalize(vViewDir)), 0.0), 2.0);
  float breath = 0.5 + 0.5 * sin(uTime * 6.2831853 * uSpeed);
  vec3 color = mix(uCore, uRim, fresnel) * (1.0 - uPulse + uPulse * breath);
  // Its gaze: a soft bright spot on the side facing uEyeDir.
  color += vec3(1.0) * smoothstep(0.80, 0.97, dot(vLocal, normalize(uEyeDir))) * uEye;
  // Time made visible: round its middle, the share of the block that is left glows, the share spent is dim.
  if (uProgress >= 0.0) {
    float band = 1.0 - smoothstep(0.07, 0.13, abs(vLocal.y));
    float turn = fract(atan(vLocal.x, vLocal.z) / 6.2831853 + 1.0);
    float left = step(turn, uProgress);
    color = mix(color, mix(color * 0.45, uRim * 1.4, left), band);
  }
  color = mix(color, vec3(1.0, 0.86, 0.45), uFlash);
  gl_FragColor = vec4(color * uDim, 1.0);
}`;

/** A material of its own for each placed companion (the system drives its uniforms). */
export function createCompanionMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uBounce: { value: 0 },
      uPulse: { value: 0.15 },
      uSpeed: { value: 1 / 6 },
      uEye: { value: 0.35 },
      uProgress: { value: -1 },
      uDim: { value: 1 },
      uFlash: { value: 0 },
      uCore: { value: new Color('#dce9ff') },
      uRim: { value: new Color('#6fa8ff') },
      uEyeDir: { value: new Vector3(0, 0.15, 1) },
    },
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
  });
}

const companion = new Mesh(new IcosahedronGeometry(COMPANION_RADIUS, 4), createCompanionMaterial());
companion.name = 'Companion';

export default companion;
