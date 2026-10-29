/**
 * Recording mode, for filming the app from a desktop: `/?cinematicMode=true`, on this machine only (localhost; see
 * cinematicRequested in src/emulator.ts), never in the deployed app. It is Meta's IWER emulator dressed for a camera:
 *
 *  - The room behind the panels is the webcam's live picture, on a curved screen fixed in the room in front of where
 *    the session began, so it pans with the head as passthrough does. The app runs its passthrough mode ("In my room"),
 *    so the virtual studio steps aside and the panels cast their shadows. With no camera, or a refused one, the app's
 *    own VR studio is filmed instead.
 *  - Nothing on the page but the canvas: no start card, no cursor.
 *  - The head turns with the mouse through a critically damped spring, so a pan starts and ends gently and never jerks.
 *  - A click selects what the centre of the view rests on (look and select), P pushes it with the right hand (a poke
 *    the camera can see), T talks, R looks straight ahead again. Esc gives the mouse back.
 *
 * A stand-in for passthrough, not passthrough: the footage should say so.
 */
import {
  BackSide,
  BufferAttribute,
  createSystem,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  SphereGeometry,
  SRGBColorSpace,
  Vector3,
  VideoTexture,
  VisibilityState,
  type World,
} from '@iwsdk/core';
import { launchRoom, launchVR } from '../room/room-system.js';
import { livePanels, type GazeTarget } from '../ui/panel-hits.js';
import { unlockAudio } from '../ui/sounds.js';

const params = new URLSearchParams(location.search);
/** The webcam's horizontal field of view (degrees): how wide a piece of the room its picture covers. */
const FOV_DEG = Math.min(120, Math.max(30, Number(params.get('fov')) || 70));
/** A webcam facing the room is shown as it sees it; `&mirror` flips it (a camera facing you). */
const MIRROR = params.has('mirror');
/** `&camera=1080` asks for 1080p; 720p by default, which is plenty behind the panels and half the upload. */
const CAMERA_HEIGHT = params.get('camera') === '1080' ? 1080 : 720;
/** Far enough that every panel stands in front of it. */
const BACKDROP_RADIUS = 4;
/** How much of each edge fades to black, so the picture has no hard border. */
const EDGE = 0.08;

/** The pan's smoothing time (s): a mouse flick becomes a turn of about a second, with no overshoot. */
const LOOK_SMOOTH_S = 0.35;
const OMEGA = 2 / LOOK_SMOOTH_S;
/** Radians per pixel of mouse movement: slow, so a hand on the mouse films like a head. */
const SENSITIVITY = 0.0018;
const PITCH_LIMIT = 1.0;

/** The poke the camera sees, in seconds per phase: up to the control, in, a moment on it, back, down. */
const POKE = { reach: 0.45, press: 0.6, hold: 0.25, back: 0.35, rest: 0.5 } as const;
type PokePhase = keyof typeof POKE;
const PHASES: readonly PokePhase[] = ['reach', 'press', 'hold', 'back', 'rest'];
/** It starts and ends this far in front of the control; contact goes a few millimetres in. */
const POKE_FROM = 0.12;
/** On its way up and down the hand arcs this far out from the panel, never sliding across it (or across another). */
const POKE_ARC = 0.15;
const POKE_INTO = 0.003;
/**
 * Where the hands rest, out of view: beside the hips, from where the head is when the session starts (metres). In front
 * of every panel, so a hand on its way up or down never passes through one and presses what is there.
 */
const REST_RIGHT = new Vector3(0.24, -0.62, 0.05);
const REST_LEFT = new Vector3(-0.24, -0.62, 0.05);
/** Palms down, fingers forward. */
const RESTING = new Quaternion(-Math.SQRT1_2, 0, 0, Math.SQRT1_2);

interface Vector3Like {
  x: number;
  y: number;
  z: number;
  set(x: number, y: number, z: number): void;
}
interface QuaternionLike {
  set(x: number, y: number, z: number, w: number): void;
}
interface EmulatedDevice {
  quaternion: QuaternionLike;
  primaryInputMode: 'controller' | 'hand';
  hands: Record<'left' | 'right', { position: Vector3Like; quaternion: QuaternionLike }>;
}

type CameraState = 'waiting' | 'on' | 'none' | 'refused';

/** Read by the Playwright tests (tests/cinematic.spec.ts). */
const state = {
  started: false,
  camera: 'waiting' as CameraState,
  yaw: 0,
  pitch: 0,
  targetYaw: 0,
  targetPitch: 0,
  poking: false,
  pokes: 0,
};
const velocity = { yaw: 0, pitch: 0 };

let world: World;
let device: EmulatedDevice | null = null;
let backdrop: Mesh | null = null;
let video: HTMLVideoElement | null = null;
/** The right hand's resting place, once the session has started (null before). */
let rest: Vector3 | null = null;

export function startCinematic(w: World): void {
  world = w;
  device = (window as unknown as { __xrDevice?: EmulatedDevice }).__xrDevice ?? null;
  if (!device) console.warn('Recording mode: no emulated headset here, so the mouse cannot turn the head. Use the production build (npm run build, then npx vite preview).');
  else device.primaryInputMode = 'hand'; // hands, as a person in passthrough would have them
  installCleanPage(w.renderer.domElement);
  world.registerSystem(CinematicSystem);
  (window as unknown as { __cinematic: unknown }).__cinematic = { state, look, aim, select, poke, backdrop: () => backdrop };
  showStart();
}

// The page: only the canvas, black around it, no cursor.
function installCleanPage(canvas: HTMLCanvasElement): void {
  const style = document.createElement('style');
  style.textContent = `
    html.cinematic, html.cinematic body { background: #000 !important; }
    html.cinematic body > :not(.cinematic-keep):not(#cinematic-start) { display: none !important; }
    html.cinematic > :not(head):not(body) { display: none !important; }
    html.cinematic.cinematic-live, html.cinematic.cinematic-live * { cursor: none !important; }
    #cinematic-start { position: fixed; inset: 0; z-index: 10; display: grid; place-items: center; background: #000;
      color: #b4bfce; font: 600 18px/1.5 system-ui, sans-serif; text-align: center; cursor: pointer; }
    #cinematic-start small { display: block; font-weight: 400; font-size: 14px; color: #7d8796; margin-top: 8px; }`;
  document.head.appendChild(style);
  // The canvas and what holds it stay shown, the container the XR session moves it into later included.
  const keep = () => {
    for (let e: HTMLElement | null = canvas; e && e !== document.body; e = e.parentElement) e.classList.add('cinematic-keep');
  };
  keep();
  new MutationObserver(keep).observe(document.body, { childList: true, subtree: true });
  document.documentElement.classList.add('cinematic');
}

function showStart(): void {
  const start = document.createElement('div');
  start.id = 'cinematic-start';
  start.innerHTML =
    'Recording mode: click to start<small>Mouse: look. Click: select what you look at. P: push it with a hand. T: talk. R: look ahead. Esc: free the mouse.</small>';
  start.addEventListener('click', () => void begin(start), { once: true });
  document.body.appendChild(start);
}

/** The click that starts it all: the gesture lets the browser lock the mouse, start audio and ask for the camera. */
async function begin(start: HTMLElement): Promise<void> {
  lockMouse();
  unlockAudio();
  start.textContent = 'Starting...';
  const camera = await openCamera();
  if (camera) launchRoom(world);
  else launchVR(world);
  start.remove();
  document.documentElement.classList.add('cinematic-live');
  state.started = true;
  world.renderer.domElement.addEventListener('click', () => (document.pointerLockElement ? select() : lockMouse()));
  document.addEventListener('mousemove', (event) => {
    if (document.pointerLockElement) look(event.movementX, event.movementY);
  });
  document.addEventListener('keydown', (event) => {
    if (event.repeat) return;
    const key = event.key.toLowerCase();
    if (key === 'p') poke();
    else if (key === 't') livePanels.find((p) => p.name === 'command')?.press('talk');
    else if (key === 'r') aim(0, 0);
  });
}

function lockMouse(): void {
  try {
    const locked = world.renderer.domElement.requestPointerLock() as unknown;
    if (locked instanceof Promise) locked.catch(() => {});
  } catch {
    // No pointer lock (a test browser): the tests turn the head through window.__cinematic.
  }
}

async function openCamera(): Promise<HTMLVideoElement | null> {
  if (!navigator.mediaDevices?.getUserMedia) {
    state.camera = 'none';
    return null;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { height: { ideal: CAMERA_HEIGHT }, frameRate: { ideal: 30 } }, audio: false });
    const element = document.createElement('video');
    element.muted = true;
    element.playsInline = true;
    element.srcObject = stream;
    await element.play();
    video = element;
    state.camera = 'on';
    return element;
  } catch (error) {
    state.camera = (error as { name?: string } | null)?.name === 'NotAllowedError' ? 'refused' : 'none';
    console.warn(`Recording mode: no camera (${(error as Error | null)?.message ?? String(error)}); filming the VR studio instead.`);
    return null;
  }
}

/**
 * The webcam's picture on the inside of a piece of sphere [FOV_DEG] wide (and as tall as the picture's shape says),
 * facing where the head looks when the session starts and fixed in that direction, so a turn of the head pans across
 * the room; its centre follows the head (CinematicSystem), as a far room shows no parallax and a fixed webcam has none
 * to give. Drawn before anything else, never in front of a panel; its edges fade to black, as a headset's view does.
 */
function placeBackdrop(source: HTMLVideoElement): void {
  const texture = new VideoTexture(source);
  texture.colorSpace = SRGBColorSpace;
  if (!MIRROR) {
    // Seen from inside, a sphere runs right to left: flipped once more, the room reads as the camera sees it.
    texture.repeat.x = -1;
    texture.offset.x = 1;
  }
  const hfov = (FOV_DEG * Math.PI) / 180;
  const aspect = source.videoWidth && source.videoHeight ? source.videoWidth / source.videoHeight : 16 / 9;
  const vfov = 2 * Math.atan(Math.tan(hfov / 2) / aspect);
  // phi 3pi/2 is straight ahead (-Z), theta pi/2 the horizon.
  const geometry = new SphereGeometry(BACKDROP_RADIUS, 64, 36, (3 * Math.PI) / 2 - hfov / 2, hfov, Math.PI / 2 - vfov / 2, vfov);
  const uv = geometry.getAttribute('uv');
  const colors = new Float32Array(uv.count * 3);
  const fade = (t: number) => Math.min(1, Math.max(0, t / EDGE));
  for (let i = 0; i < uv.count; i++) {
    const f = fade(uv.getX(i)) * fade(1 - uv.getX(i)) * fade(uv.getY(i)) * fade(1 - uv.getY(i));
    colors[i * 3] = colors[i * 3 + 1] = colors[i * 3 + 2] = f * f * (3 - 2 * f);
  }
  geometry.setAttribute('color', new BufferAttribute(colors, 3));
  const material = new MeshBasicMaterial({ map: texture, side: BackSide, vertexColors: true, toneMapped: false, depthWrite: false, fog: false });
  const mesh = new Mesh(geometry, material);
  mesh.name = 'cinematic-backdrop';
  mesh.renderOrder = -1000;
  mesh.frustumCulled = false;
  const forward = world.camera.getWorldDirection(new Vector3());
  world.camera.getWorldPosition(mesh.position);
  mesh.rotation.y = Math.atan2(-forward.x, -forward.z);
  world.createTransformEntity(mesh);
  backdrop = mesh;
}

// Looking: the mouse moves a target; the head follows it on a spring (CinematicSystem).
function look(dx: number, dy: number): void {
  aim(state.targetYaw - dx * SENSITIVITY, state.targetPitch - dy * SENSITIVITY);
}

function aim(yaw: number, pitch: number, instant = false): void {
  state.targetYaw = yaw;
  state.targetPitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, pitch));
  if (instant) {
    state.yaw = state.targetYaw;
    state.pitch = state.targetPitch;
    velocity.yaw = velocity.pitch = 0;
  }
}

// What the centre of the view rests on.
const origin = new Vector3();
const direction = new Vector3();
const point = new Vector3();

function centre(): { panel: GazeTarget; key: string } | null {
  world.camera.getWorldPosition(origin);
  world.camera.getWorldDirection(direction);
  let best: GazeTarget | null = null;
  let distance = Infinity;
  for (const panel of livePanels) {
    const t = panel.rayDistance(origin, direction);
    if (t > 0 && t < distance) {
      distance = t;
      best = panel;
    }
  }
  if (!best) return null;
  point.copy(direction).multiplyScalar(distance).add(origin);
  const key = best.gazeHit(point, true);
  return key == null ? null : { panel: best, key };
}

function select(): void {
  const target = centre();
  target?.panel.press(target.key);
}

// The poke the camera sees: the right hand comes up to the control the view rests on, pushes it, and goes back down.
interface Poke {
  phase: PokePhase | 'orient';
  t: number;
  frames: number;
  /** The fingertip's offset from the hand's own position, measured once the hand points at the panel. */
  readonly offset: Vector3;
  readonly centre: Vector3;
  readonly normal: Vector3;
  readonly from: Vector3;
}
let active: Poke | null = null;
const matrix = new Matrix4();
const tip = new Vector3();
const pointing = new Quaternion();
const a = new Vector3();
const b = new Vector3();

/** Both hands down beside the body, out of the picture, where a poke starts and ends. */
function restHands(): void {
  const head = world.camera.getWorldPosition(new Vector3());
  rest = head.clone().add(REST_RIGHT);
  const left = head.add(REST_LEFT);
  device!.hands.right.position.set(rest.x, rest.y, rest.z);
  device!.hands.left.position.set(left.x, left.y, left.z);
  for (const side of ['left', 'right'] as const) device!.hands[side].quaternion.set(RESTING.x, RESTING.y, RESTING.z, RESTING.w);
}

function poke(): void {
  if (active || !device || !rest) return;
  const target = centre();
  if (!target || !target.panel.matrixOf(target.key, matrix)) return;
  const e = matrix.elements;
  const normal = new Vector3(e[0], e[1], e[2]).cross(new Vector3(e[4], e[5], e[6])).normalize();
  pointing.setFromUnitVectors(new Vector3(0, 0, -1), normal.clone().negate());
  device.hands.right.quaternion.set(pointing.x, pointing.y, pointing.z, pointing.w);
  const hand = device.hands.right.position;
  active = { phase: 'orient', t: 0, frames: 0, offset: new Vector3(), centre: new Vector3().setFromMatrixPosition(matrix), normal, from: new Vector3(hand.x, hand.y, hand.z) };
  state.poking = true;
}

/** Where the hand must be for the fingertip to be [d] in front of the control's centre. */
function handAt(p: Poke, d: number, out: Vector3): Vector3 {
  return out.copy(p.centre).addScaledVector(p.normal, d).sub(p.offset);
}

function stepPoke(p: Poke, delta: number): void {
  const hand = device!.hands.right.position;
  if (p.phase === 'orient') {
    // A couple of frames for the turned hand to reach the fingertip's space, then measure where the fingertip is.
    if (++p.frames < 3) return;
    world.player.indexTipSpaces.right.getWorldPosition(tip);
    p.offset.set(tip.x - hand.x, tip.y - hand.y, tip.z - hand.z);
    p.phase = 'reach';
    p.t = 0;
    return;
  }
  p.t += delta;
  const span = POKE[p.phase];
  if (p.phase === 'reach') {
    a.copy(p.from);
    handAt(p, POKE_FROM, b);
  } else if (p.phase === 'press') {
    handAt(p, POKE_FROM, a);
    handAt(p, -POKE_INTO, b);
  } else if (p.phase === 'hold') {
    handAt(p, -POKE_INTO, a);
    b.copy(a);
  } else if (p.phase === 'back') {
    handAt(p, -POKE_INTO, a);
    handAt(p, POKE_FROM, b);
  } else {
    handAt(p, POKE_FROM, a);
    b.copy(rest!);
  }
  const k = Math.min(1, p.t / span);
  a.lerp(b, k * k * (3 - 2 * k));
  if (p.phase === 'reach' || p.phase === 'rest') a.addScaledVector(p.normal, POKE_ARC * Math.sin(Math.PI * k));
  hand.set(a.x, a.y, a.z);
  if (p.t < span) return;
  const next = PHASES[PHASES.indexOf(p.phase) + 1];
  p.t = 0;
  if (next) p.phase = next;
  else {
    device!.hands.right.quaternion.set(RESTING.x, RESTING.y, RESTING.z, RESTING.w);
    active = null;
    state.poking = false;
    state.pokes++;
  }
}

/** Turns the head toward the mouse's target on a critically damped spring; runs a poke; keeps the backdrop round the head. */
class CinematicSystem extends createSystem({}) {
  update(delta: number): void {
    if (video && !backdrop && this.world.visibilityState.peek() !== VisibilityState.NonImmersive) placeBackdrop(video);
    if (backdrop) this.world.camera.getWorldPosition(backdrop.position);
    if (!device) return;
    if (!rest && this.world.visibilityState.peek() !== VisibilityState.NonImmersive) restHands();
    const step = Math.min(delta, 0.05);
    if (step > 0) {
      // The closed-form step of a critically damped spring (as src/ui/glide.ts): exact for any frame time.
      const decay = Math.exp(-OMEGA * step);
      let d = state.yaw - state.targetYaw;
      let lift = (velocity.yaw + OMEGA * d) * step;
      velocity.yaw = (velocity.yaw - OMEGA * lift) * decay;
      state.yaw = state.targetYaw + (d + lift) * decay;
      d = state.pitch - state.targetPitch;
      lift = (velocity.pitch + OMEGA * d) * step;
      velocity.pitch = (velocity.pitch - OMEGA * lift) * decay;
      state.pitch = state.targetPitch + (d + lift) * decay;
    }
    const sy = Math.sin(state.yaw / 2);
    const cy = Math.cos(state.yaw / 2);
    const sx = Math.sin(state.pitch / 2);
    const cx = Math.cos(state.pitch / 2);
    device.quaternion.set(cy * sx, sy * cx, -sy * sx, cy * cx); // yaw, then pitch (YXZ)
    if (active) stepPoke(active, step);
  }
}
