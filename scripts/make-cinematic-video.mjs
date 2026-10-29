// Builds the 2026 cinematic demo (under 3 minutes, 1920x1080 at 60 fps, H.264 + AAC) from docs/video/cinematic-2026.json:
//   1. voices: Piper in Docker, locally (narrator, the person, and afterwards Nova's real answers);
//   2. capture: the production build served here (vite preview; /api and /ws go to the deployed server, so Amazon Nova
//      and Amazon Transcribe are live), opened full screen in Edge at /?cinematicMode=true&fast=true and driven beat by
//      beat, each beat waiting for its line. The screen is captured at 1080p60 by ffmpeg (Windows desktop duplication,
//      Quick Sync), the app's own sound (its 3D cues) by the page itself, the carer's phone by a second browser;
//   3. the edit: title card, capture, the phone picture-in-picture, end card with the metrics; narration, her voice,
//      Nova's answers and the app's sound mixed and levelled to -16 LUFS; captions burned in.
//   node scripts/make-cinematic-video.mjs            a new take, then the edit
//   node scripts/make-cinematic-video.mjs --edit     the edit again, from the last take
// CAMERA=none (default: the app's VR studio behind the panels) | real (this machine's webcam) | file:<video> (a clip of a
// room, looped). Needs Docker, ffmpeg with ddagrab and h264_qsv, Edge, and the screen to itself while it records.
// Output: .video/SpatialDesk_Demo_2026.mp4, copied to dist/ (which the next build empties and the next deploy uploads).
import { execFileSync, execSync, spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from '@playwright/test';

const root = process.cwd();
const editOnly = process.argv.includes('--edit');
// NARRATION_FILE: another script of the same shape (scripts/build_pitch_video.py uses docs/video/pitch-2026.json).
// CAPTURE_ONLY: stop after the take, Nova's voice and the cards (the pitch cut is edited in Python). CINEMATIC_QUERY:
// more of the recording mode's URL (e.g. &fov=120). MIC_FILE: a WAV her request is played from instead of her voice.
const script = JSON.parse(readFileSync(join(root, process.env.NARRATION_FILE ?? 'docs/video/cinematic-2026.json'), 'utf-8'));
const base = join(root, '.video', 'cinematic');
mkdirSync(base, { recursive: true });
const work = editOnly ? readFileSync(join(base, 'last.txt'), 'utf-8').trim() : join(base, new Date().toISOString().replace(/[:.]/g, '-'));
mkdirSync(work, { recursive: true });
const voiceDir = join(base, 'voice'); // kept across takes: a line is spoken again only when its words change
const modelsDir = join(root, '.video', 'voices');
const api = process.env.E2E_URL ?? 'https://d2p3027seoreck.cloudfront.net';
const CAMERA = process.env.CAMERA ?? 'none';
const PORT = 4173;
const [W, H, FPS] = [1920, 1080, 60];
const TITLE_S = 4; // title card
const LEAD_S = 0.6; // capture kept before the first line
const TAIL_S = 1.2; // and after the last captured moment
const END_LEAD_S = 0.4; // end card shown before its line
const END_HOLD_S = 2.4; // and after it
const GAP_MS = 350; // between lines
const MAX_S = 180;
const OUTPUT = join(root, '.video', 'SpatialDesk_Demo_2026.mp4');

const step = (m) => console.log(`\n==> ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const seconds = (file) => Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { encoding: 'utf-8' }).trim());
const beatOf = (id) => script.beats.find((b) => b.id === id);

// 1. Voices --------------------------------------------------------------------------------------------------------------

/** Downloads a Piper voice once (the same source as scripts/tts.Dockerfile) into .video/voices. */
function model(name) {
  mkdirSync(modelsDir, { recursive: true });
  const [lang, speaker, quality] = name.split('-');
  for (const ext of ['.onnx', '.onnx.json']) {
    const file = join(modelsDir, name + ext);
    if (existsSync(file)) continue;
    execFileSync('curl', ['-sSfL', '-o', file, `https://huggingface.co/rhasspy/piper-voices/resolve/main/${lang.split('_')[0]}/${lang}/${speaker}/${quality}/${name}${ext}`]);
  }
}

/** Speaks [lines] ({ id, text }) with the role's voice into [dir]/<id>.wav, again only where the words changed. */
function speak(role, lines, dir) {
  mkdirSync(dir, { recursive: true });
  const name = script.voices[role];
  const changed = lines.filter(({ id, text }) => {
    const txt = join(dir, `${id}.txt`);
    return !existsSync(join(dir, `${id}.wav`)) || !existsSync(txt) || readFileSync(txt, 'utf-8') !== text;
  });
  if (!changed.length) return;
  model(name);
  // Piper speaks every .txt in the directory: only this role's current lines are there.
  for (const f of readdirSync(dir)) if (f.endsWith('.txt') && !lines.some(({ id }) => `${id}.txt` === f)) unlinkSync(join(dir, f));
  for (const { id, text } of lines) writeFileSync(join(dir, `${id}.txt`), text);
  // The same Piper as scripts/tts.Dockerfile: from a local venv when there is one (python -m venv .video/piper-venv,
  // then pip install piper-tts==1.3.0), else in Docker.
  const python = join(root, '.video', 'piper-venv', 'Scripts', 'python.exe');
  if (existsSync(python)) {
    execFileSync(python, [join(root, 'scripts', 'tts.py'), join(modelsDir, `${name}.onnx`), dir], { stdio: 'inherit' });
    return;
  }
  try {
    execSync('docker image inspect spatialdesk-tts', { stdio: 'ignore' });
  } catch {
    execSync('docker build -t spatialdesk-tts -f scripts/tts.Dockerfile scripts', { cwd: root, stdio: 'inherit' });
  }
  execFileSync('docker', ['run', '--rm', '-v', `${dir}:/work`, '-v', `${modelsDir}:/models`, 'spatialdesk-tts', `/models/${name}.onnx`], { stdio: 'inherit' });
}

function voices() {
  step('Voices (Piper, local)');
  for (const role of ['narrator', 'person']) speak(role, script.beats.filter((b) => b.voice === role), join(voiceDir, role));
  const durations = Object.fromEntries(script.beats.map((b) => [b.id, seconds(join(voiceDir, b.voice, `${b.id}.wav`))]));
  if (process.env.MIC_FILE) durations.say = seconds(process.env.MIC_FILE) + 0.3; // her own voice, as the microphone plays it
  writeFileSync(join(work, 'durations.json'), JSON.stringify(durations, null, 2));
  console.log(`${script.beats.length} lines, ${Object.values(durations).reduce((a, b) => a + b, 0).toFixed(1)} s of voice`);
  return durations;
}

// 2. Capture -------------------------------------------------------------------------------------------------------------

/**
 * In the page, before the app: the person is not new to the app (no first-run coach), the app's sound is recorded where
 * it reaches the speakers (every connection to its AudioContext's destination also feeds a recorder), the microphone
 * plays the next queued line of hers, and the camera is this take's (none: refused, so the VR studio is filmed).
 */
function inPage({ camera }) {
  localStorage.setItem('spatialdesk.onboarded', '1');
  const Native = window.AudioContext;
  const video = (window.__video = { audioStartedAt: null, micAt: [], micQueue: [], frames: [], measuring: false });
  // The app's sound is src/ui/sounds.ts's context, recognised by how it reaches the speakers: through a 6.5 kHz low-pass
  // (other contexts, the engine's own among them, come earlier and stay silent). From then on everything that context
  // sends to its speakers is also recorded.
  const connect = AudioNode.prototype.connect;
  let chunk = 0;
  const startTap = (context) => {
    const tap = context.createMediaStreamDestination();
    context.__videoTap = tap;
    const recorder = new MediaRecorder(tap.stream, { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 256_000 });
    recorder.ondataavailable = (event) => {
      if (!event.data.size) return;
      const index = chunk++;
      const reader = new FileReader();
      reader.onload = () => window.__videoAudioChunk(index, String(reader.result).split(',')[1]);
      reader.readAsDataURL(event.data);
    };
    recorder.onstart = () => (video.audioStartedAt = performance.timeOrigin + performance.now());
    video.stopAudio = () => new Promise((resolve) => {
      recorder.onstop = () => setTimeout(resolve, 500); // the last chunk's reader
      recorder.stop();
    });
    video.audioStartedAt = -1;
    recorder.start(1000);
  };
  AudioNode.prototype.connect = function (destination, ...rest) {
    const result = connect.call(this, destination, ...rest);
    if (destination === this.context.destination) {
      if (video.audioStartedAt === null && this instanceof BiquadFilterNode && Math.round(this.frequency.value) === 6500) startTap(this.context);
      if (this.context.__videoTap) connect.call(this, this.context.__videoTap);
    }
    return result;
  };
  const devices = navigator.mediaDevices;
  const original = devices.getUserMedia.bind(devices);
  devices.getUserMedia = async (constraints = {}) => {
    if (constraints.video) {
      if (camera === 'none') throw new DOMException('No camera in this take', 'NotAllowedError');
      if (camera === 'file') {
        const clip = document.createElement('video');
        Object.assign(clip, { src: '/__video/camera', loop: true, muted: true, playsInline: true });
        await clip.play();
        return clip.captureStream();
      }
      return original(constraints);
    }
    if (constraints.audio) {
      const context = new Native();
      const out = context.createMediaStreamDestination();
      const line = video.micQueue.shift();
      if (line) {
        const source = context.createBufferSource();
        source.buffer = await context.decodeAudioData(await (await fetch(line)).arrayBuffer());
        source.connect(out);
        source.start(context.currentTime + 0.3);
        video.micAt.push(performance.timeOrigin + performance.now() + 300);
      }
      return out.stream;
    }
    return original(constraints);
  };
  const tick = (t) => {
    if (video.measuring) video.frames.push(t);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

async function capture(durations) {
  step('Production build');
  if (!process.env.SKIP_BUILD) execSync('npm run build', { cwd: root, stdio: 'inherit' });
  step(`Serving it on :${PORT}, /api and /ws to ${api}`);
  const preview = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort'],
    { cwd: root, env: { ...process.env, SPATIALDESK_API: api }, stdio: 'ignore' });
  const local = `http://localhost:${PORT}`;
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(local)).ok) break;
    } catch {
      /* not up yet */
    }
    await sleep(500);
  }

  const markers = { camera: CAMERA, beats: [], nova: [], carer: null, events: [] };
  const event = (kind) => markers.events.push({ kind, at: Date.now() });
  const audioChunks = [];
  const browser = await chromium.launch({
    channel: 'msedge', headless: false, chromiumSandbox: true,
    args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required',
      '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--hide-scrollbars'],
  });
  const context = await browser.newContext({ viewport: null, baseURL: local });
  await context.exposeFunction('__videoAudioChunk', (index, data) => (audioChunks[index] = Buffer.from(data, 'base64')));
  await context.route('**/__video/**', (route) => {
    const name = new URL(route.request().url()).pathname.split('/').pop();
    const file = name === 'camera' ? CAMERA.slice('file:'.length) : name === 'say.wav' && process.env.MIC_FILE ? process.env.MIC_FILE : join(voiceDir, 'person', name);
    return route.fulfill({ path: file });
  });
  await context.addInitScript(inPage, { camera: CAMERA.startsWith('file:') ? 'file' : CAMERA });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  const { windowId } = await cdp.send('Browser.getWindowForTarget');
  await cdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'fullscreen' } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.stack ?? e.message));

  // The carer's phone, its own browser, ready before the story needs it.
  const phone = await chromium.launch({ channel: 'msedge' });
  const phoneContext = await phone.newContext({ baseURL: local, viewport: { width: 540, height: 960 }, deviceScaleFactor: 1, recordVideo: { dir: work, size: { width: 540, height: 960 } } });
  const carerT0 = Date.now();
  const carer = await phoneContext.newPage();
  await carer.goto('/companion.html');

  await page.goto(`/?cinematicMode=true&fast=true${process.env.CINEMATIC_QUERY ?? ''}`);
  await page.waitForSelector('#cinematic-start', { timeout: 60_000 });
  // A 62-degree vertical view (about 95 across a 16:9 frame): the emulator's default 90 makes a 120-degree frame whose
  // edges stretch the panels.
  await page.evaluate(() => (window.__xrDevice.fovy = (62 * Math.PI) / 180));
  await page.click('#cinematic-start');
  await page.waitForFunction(() => window.__cinematic.state.started && window.__world.visibilityState.value === 'visible', null, { timeout: 30_000 });
  await page.waitForFunction(() => window.__setup?.view.stage === 'where', null, { timeout: 15_000 });
  await page.waitForFunction(() => (window.__video.audioStartedAt ?? -1) > 0, null, { timeout: 10_000 });
  await sleep(1500);

  step('Capturing the screen at 1080p60');
  // The desktop's frames stay on the GPU into Media Foundation's hardware encoder: the fastest path here (about 55 of the
  // screen's 59 frames a second, where copying each frame to the CPU managed 49), and the least taken from the app.
  const ffmpeg = spawn('ffmpeg', ['-y', '-loglevel', 'warning', '-stats', '-f', 'lavfi', '-i', `ddagrab=output_idx=0:framerate=${FPS}:draw_mouse=0`,
    '-c:v', 'h264_mf', '-hw_encoding', '1', '-b:v', '40M', join(work, 'capture.mp4')], { stdio: ['pipe', 'ignore', 'pipe'] });
  let ffmpegLog = '';
  ffmpeg.stderr.on('data', (d) => (ffmpegLog += d.toString()));
  await sleep(2000);
  // The sync mark: a magenta square in the corner for a moment; its time in the page clock places everything else.
  markers.flashAt = await page.evaluate(() => new Promise((resolve) => {
    const mark = document.createElement('div');
    mark.className = 'cinematic-keep';
    mark.style.cssText = 'position:fixed;left:0;top:0;width:64px;height:64px;background:#ff00ff;z-index:2147483647';
    document.body.appendChild(mark);
    requestAnimationFrame(() => {
      const at = performance.timeOrigin + performance.now();
      setTimeout(() => {
        mark.remove();
        resolve(at);
      }, 400);
    });
  }));
  await sleep(600);
  await page.evaluate(() => (window.__video.measuring = true));

  // The story ---------------------------------------------------------------------------------------------------------
  /** A wait that, when it times out, says which one and what the app was doing. */
  const until = (label, fn, arg, timeout) =>
    page.waitForFunction(fn, arg, { timeout }).catch(async (error) => {
      const state = await page.evaluate(() => ({ rim: window.__rim?.state, attention: { key: window.__attention?.state.key, focus: window.__attention?.state.focus },
        head: window.__cinematic?.state, agent: window.__agent?.state.phase, helper: window.__helper?.view.stage, setup: window.__setup?.view.stage,
        view: (() => {
          const w = window.__world;
          const V = w.camera.position.constructor;
          let card = null;
          w.scene.traverse((o) => {
            if (o.name === 'b1:card-0-1') card = o;
          });
          const eye = w.camera.getWorldPosition(new V());
          const forward = w.camera.getWorldDirection(new V());
          const to = card ? new V().setFromMatrixPosition(card.matrixWorld).sub(eye).normalize() : null;
          return { gazeOrigin: w.player.gazeOrigin, degreesOffCard: to ? (Math.acos(Math.min(1, forward.dot(to))) * 180) / Math.PI : null,
            rig: { y: w.player.rotation.y, x: w.player.position.x, z: w.player.position.z } };
        })() })).catch((e) => String(e));
      throw new Error(`${label}: ${error.message.split(String.fromCharCode(10))[0]} ${JSON.stringify(state)}`);
    });
  let speakingUntil = 0;
  const settle = async () => {
    const wait = speakingUntil + GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
  };
  const beat = async (id, at) => {
    if (at === undefined) {
      await settle();
      at = Date.now();
    }
    markers.beats.push({ id, voice: beatOf(id).voice, at });
    speakingUntil = at + durations[id] * 1000;
    console.log(`beat ${id}`);
  };
  /** Turns the head (the cinematic spring) until the centre of the view is on a named element. */
  const aimAt = async (name, u = 0, v = 0) => {
    const angles = await page.evaluate(({ name, u, v }) => {
      const w = window.__world;
      let el = null;
      w.scene.traverse((o) => {
        if (o.name === name) el = o;
      });
      if (!el) return null;
      el.updateWorldMatrix(true, false);
      const V = w.camera.position.constructor;
      const d = new V(u, v, 0).applyMatrix4(el.matrixWorld).sub(w.camera.getWorldPosition(new V())).normalize();
      return { yaw: Math.atan2(-d.x, -d.z), pitch: Math.asin(d.y) };
    }, { name, u, v });
    if (!angles) throw new Error(`No element ${name} to look at`);
    await page.evaluate(({ yaw, pitch }) => window.__cinematic.aim(yaw, pitch), angles);
    await until(`the head on ${name}`, () => {
      const s = window.__cinematic.state;
      return Math.abs(s.yaw - s.targetYaw) < 0.003 && Math.abs(s.pitch - s.targetPitch) < 0.003;
    }, null, 6000);
  };
  const pokeIt = async () => {
    const before = await page.evaluate(() => window.__cinematic.state.pokes);
    event('poke-start');
    await page.evaluate(() => window.__cinematic.poke());
    await page.waitForFunction((n) => window.__cinematic.state.pokes > n, before, { timeout: 8000 });
    event('poke-end');
  };
  const phase = (want) => page.waitForFunction((want) => {
    const s = window.__agent.state;
    if (s.phase === 'error') throw new Error(`The agent failed: ${JSON.stringify(s.plan)}`);
    return s.phase === want;
  }, want, { timeout: 40_000 });
  /** Nova's answer, as it appears on the card; her voice says it once the line before it has ended. */
  const novaSays = async (id) => {
    await phase('preview');
    const shownAt = Date.now();
    const plan = await page.evaluate(() => window.__agent.state.plan);
    if (!/nova/i.test(plan.source ?? '')) throw new Error(`Not Amazon Nova's answer: ${plan.source}`);
    await settle();
    const at = Math.max(shownAt, Date.now());
    markers.nova.push({ id, text: plan.summary, at, shownAt });
    speakingUntil = at + (plan.summary.length / 11 + 0.4) * 1000; // Piper speaks about 14 characters a second
    console.log(`nova ${id}: ${plan.summary}`);
  };
  /** The right hand reaches the orb, pinches it, and goes back down. */
  const pinchOrb = async () => {
    event('pinch-start');
    await page.evaluate(async () => {
      const w = window.__world;
      const V = w.camera.position.constructor;
      const Q = w.camera.quaternion.constructor;
      const hand = window.__xrDevice.hands.right;
      const orb = w.scene.getObjectByName('setup-orb').getWorldPosition(new V());
      const toward = w.camera.getWorldPosition(new V()).sub(orb).normalize();
      // A comfortable arm's length, a little past the orb (the hand is measured, not the orb): the profile's reach is
      // then about 0.9, and "closer" has somewhere to go.
      const goal = orb.clone().addScaledVector(toward, -0.08).add(new V(0.02, -0.03, 0));
      const from = new V(hand.position.x, hand.position.y, hand.position.z);
      const q = new Q().setFromUnitVectors(new V(0, 0, -1), toward.clone().negate());
      hand.quaternion.set(q.x, q.y, q.z, q.w);
      const frame = () => new Promise(requestAnimationFrame);
      const move = async (a, b, ms) => {
        const t0 = performance.now();
        for (let k = 0; k < 1; ) {
          k = Math.min(1, (performance.now() - t0) / ms);
          const e = k * k * (3 - 2 * k);
          hand.position.set(a.x + (b.x - a.x) * e, a.y + (b.y - a.y) * e, a.z + (b.z - a.z) * e);
          await frame();
        }
      };
      await move(from, goal, 1100);
      hand.updatePinchValue(1);
      for (let i = 0; i < 12; i++) await frame();
      hand.updatePinchValue(0);
      for (let i = 0; i < 20; i++) await frame();
      await move(goal, from, 900);
      hand.quaternion.set(-Math.SQRT1_2, 0, 0, Math.SQRT1_2);
    });
    event('pinch-end');
  };

  let carerFrom = 0;
  try {
    // 0:00 Where are you sitting? Sofa or bed, her own reach, no steadying: the space fits her.
    await beat('intro');
    await aimAt('setup:setup-root');
    await sleep(durations.intro * 1000 - 2200);
    await aimAt('setup:setup-b');
    await pokeIt(); // Sofa/Bed
    await page.waitForFunction(() => window.__setup.view.stage === 'reach', null, { timeout: 8000 });
    event('orb-shown');
    await beat('orb');
    await aimAt('setup-orb');
    await sleep(Math.max(0, durations.orb * 1000 - 3200));
    await pinchOrb();
    await page.waitForFunction(() => window.__setup.view.stage === 'steady', null, { timeout: 10_000 });
    await beat('fitted');
    await aimAt('setup:setup-b');
    await page.evaluate(() => window.__cinematic.select()); // No
    await until('the last page of the setup', () => window.__setup.view.stage === 'done', null, 8000);
    markers.setup = await page.evaluate(() => ({ hint: window.__setup.view.hint, reach: window.__setup.view.reach?.comfort }));
    await sleep(1600); // "Your space is ready", and how far the board now is
    await aimAt('setup:setup-a');
    await page.evaluate(() => window.__cinematic.select()); // Start
    await until('the setup closing', () => window.__setup.view.stage === null, null, 8000);
    await sleep(1200);
    await page.evaluate(() => window.__cinematic.aim(0, -0.08));

    // 0:35 Her request, heard by Amazon Transcribe; Nova thinks (the orb), answers; she applies: the space glides closer.
    await beat('ask');
    await settle();
    await page.evaluate(() => window.__video.micQueue.push('/__video/say.wav'));
    await aimAt('command:talk-button');
    await page.keyboard.press('t');
    await page.waitForFunction(() => window.__video.micAt.length > 0, null, { timeout: 8000 });
    await beat('say', Math.round(await page.evaluate(() => window.__video.micAt[0])));
    await page.evaluate(() => window.__cinematic.aim(0, -0.08));
    await page.waitForFunction(() => window.__heard != null, null, { timeout: 40_000 });
    markers.heard = await page.evaluate(() => window.__heard.said);
    await novaSays('nova-reach');
    await beat('apply');
    await aimAt('agent:plan-apply');
    await page.evaluate(() => window.__cinematic.select());
    await sleep(2600); // the glide, and Nova asking how it feels
    await aimAt('agent:plan-discard');
    await page.evaluate(() => window.__cinematic.select()); // Close: the board is clear for her eyes
    await page.waitForFunction(() => window.__agent.state.phase === 'idle', null, { timeout: 5000 });
    await page.evaluate(() => window.__cinematic.aim(0, -0.1));

    // 1:15 Her eyes rest on a card: the rim; "move this to done"; she pokes Apply: the key gives way, the card moves.
    await beat('gaze');
    await aimAt('b1:card-0-1');
    await until('the rim of her eyes', () => window.__rim.state.visible && window.__rim.state.by === 'eyes', null, 6000);
    markers.lookedAt = await page.evaluate(() => window.__attention.state.focus);
    await beat('move');
    await sleep(durations.move * 1000);
    await page.evaluate((said) => window.__voice.say(said), beatOf('move').command ?? 'Move this to done.');
    await novaSays('nova-move');
    await beat('poke');
    await aimAt('agent:plan-apply');
    await sleep(600);
    await pokeIt();
    await sleep(1800);

    // 2:00 A carer, on a phone: the invitation, the code, Allow, the board, Help / Recalibrate opens her setup.
    await beat('helper');
    await page.evaluate(() => window.__cinematic.aim(0, -0.1));
    await beat('invite');
    await sleep(durations.invite * 1000);
    await page.evaluate((said) => window.__voice.say(said), beatOf('invite').command ?? 'invite a helper');
    await page.waitForFunction(() => window.__helper?.view.stage === 'inviting' && window.__helper.state.code, null, { timeout: 15_000 });
    const code = await page.evaluate(() => window.__helper.state.code);
    await aimAt('helper:root').catch(() => aimAt('helper:a'));
    await beat('carer');
    carerFrom = Date.now();
    await carer.locator('#code').pressSequentially(code, { delay: 110 });
    await carer.locator('#connect').click();
    await page.waitForFunction(() => window.__helper.view.stage === 'asking', null, { timeout: 15_000 });
    await aimAt('helper:a');
    await sleep(500);
    await page.evaluate(() => window.__cinematic.select()); // Allow
    await page.waitForFunction(() => window.__helper.view.stage === 'sharing', null, { timeout: 15_000 });
    await carer.locator('#board').waitFor({ timeout: 15_000 });
    await sleep(1800);
    event('help');
    await carer.locator('#help').click();
    await page.waitForFunction(() => window.__setup.view.stage === 'where', null, { timeout: 15_000 });
    event('setup-reopened');
    await aimAt('setup:setup-root');
    await settle();
    await sleep(TAIL_S * 1000);
    markers.carer = { t0: carerT0, from: carerFrom, to: Date.now() };
    markers.end = Date.now();
  } catch (error) {
    // Keep what was captured (ffmpeg closes the file on q), and leave nothing running.
    ffmpeg.stdin.write('q');
    await new Promise((r) => ffmpeg.on('exit', r));
    await phone.close().catch(() => {});
    await browser.close().catch(() => {});
    preview.kill();
    throw error;
  }

  // Stop everything, keeping what was recorded.
  await page.evaluate(() => (window.__video.measuring = false));
  const frames = await page.evaluate(() => window.__video.frames);
  ffmpeg.stdin.write('q');
  await new Promise((r) => ffmpeg.on('exit', r));
  await page.evaluate(() => window.__video.stopAudio());
  markers.audioStartedAt = await page.evaluate(() => window.__video.audioStartedAt);
  writeFileSync(join(work, 'app-audio.webm'), Buffer.concat(audioChunks.filter(Boolean)));
  await phoneContext.close();
  copyFileSync(await carer.video().path(), join(work, 'carer.webm'));
  await phone.close();
  await browser.close();
  preview.kill();

  const gaps = frames.slice(1).map((t, i) => t - frames[i]).sort((a, b) => a - b);
  markers.render = { frames: frames.length, seconds: (frames[frames.length - 1] - frames[0]) / 1000, fps: frames.length / ((frames[frames.length - 1] - frames[0]) / 1000),
    p50Ms: gaps[Math.floor(gaps.length * 0.5)], p95Ms: gaps[Math.floor(gaps.length * 0.95)], worstMs: gaps[gaps.length - 1] };
  markers.ffmpegStats = ffmpegLog.trim().split(/\r|\n/).filter(Boolean).slice(-3);
  markers.pageErrors = errors;
  writeFileSync(join(work, 'markers.json'), JSON.stringify(markers, null, 2));
  writeFileSync(join(base, 'last.txt'), work);
  if (errors.length) throw new Error(`Page errors during the take:\n${errors.join('\n')}`);
  return markers;
}

// 3. Edit ----------------------------------------------------------------------------------------------------------------

/** Where the magenta sync square first shows in the capture (seconds). */
function flashInCapture() {
  const raw = execFileSync('ffmpeg', ['-v', 'error', '-t', '20', '-i', join(work, 'capture.mp4'), '-vf', 'crop=16:16:20:20,scale=1:1', '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-'], { maxBuffer: 64 * 1024 * 1024 });
  for (let i = 0; i + 2 < raw.length; i += 3) if (raw[i] > 200 && raw[i + 1] < 70 && raw[i + 2] > 200) return i / 3 / FPS;
  throw new Error('The sync mark is not in the capture.');
}

async function edit(durations, markers) {
  step('Nova, in her own voice');
  speak('nova', markers.nova.map(({ id, text }) => ({ id, text })), join(work, 'nova'));
  const voiceFile = (v) => (v.voice === 'nova' ? join(work, 'nova', `${v.id}.wav`) : join(voiceDir, v.voice, `${v.id}.wav`));

  step('Cards');
  const browser = await chromium.launch({ channel: 'msedge' });
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  for (const [name, html] of Object.entries(cards())) {
    await page.setContent(html);
    await page.waitForTimeout(300); // web fonts
    await page.screenshot({ path: join(work, `${name}.png`) });
  }
  await browser.close();

  step('Edit');
  const flash = flashInCapture();
  const toCapture = (at) => flash + (at - markers.flashAt) / 1000; // epoch ms -> seconds into capture.mp4
  const first = markers.beats[0].at;
  const segStart = toCapture(first) - LEAD_S;
  const segEnd = toCapture(markers.end);
  const mainS = segEnd - segStart;
  const endS = END_LEAD_S + durations.end + END_HOLD_S;
  const totalS = TITLE_S + mainS + endS;
  if (totalS >= MAX_S) throw new Error(`The cut would be ${totalS.toFixed(1)} s; the limit is ${MAX_S} s.`);
  const inMain = (at) => TITLE_S + toCapture(at) - segStart; // epoch ms -> seconds into the cut
  const voices = [
    ...markers.beats.map((b) => ({ ...b, start: inMain(b.at) })),
    ...markers.nova.map((n) => ({ id: n.id, voice: 'nova', text: n.text, start: inMain(n.at) })),
    { id: 'end', voice: 'narrator', start: TITLE_S + mainS + END_LEAD_S },
  ].sort((a, b) => a.start - b.start);
  for (const v of voices) v.seconds = seconds(voiceFile(v));
  writeFileSync(join(work, 'captions.srt'), captions(voices));

  const carer = markers.carer;
  const pipFrom = inMain(carer.from) - TITLE_S; // within the main part
  const pipS = (carer.to - carer.from) / 1000;
  const pipSkip = (carer.from - carer.t0) / 1000;
  const audioSkip = (toCapture(first) - LEAD_S) - toCapture(markers.audioStartedAt); // the app's sound began before the story
  const inputs = ['-loop', '1', '-t', `${TITLE_S}`, '-i', 'title.png', '-i', 'capture.mp4', '-loop', '1', '-t', `${endS}`, '-i', 'end.png', '-i', 'carer.webm', '-i', 'app-audio.webm'];
  for (const v of voices) inputs.push('-i', voiceFile(v));
  const fade = 0.4;
  const graph = [
    `[1:v]trim=start=${segStart}:duration=${mainS},setpts=PTS-STARTPTS,fps=${FPS},format=yuv420p,setsar=1[cap]`,
    `[3:v]trim=start=${pipSkip}:duration=${pipS},setpts=PTS-STARTPTS+${pipFrom}/TB,scale=-2:820,pad=iw+20:ih+20:10:10:color=0x1c2330,format=yuva420p,` +
      `fade=t=in:st=${pipFrom}:d=0.35:alpha=1,fade=t=out:st=${pipFrom + pipS - 0.35}:d=0.35:alpha=1[pip]`,
    `[cap][pip]overlay=x=W-w-80:y=(H-h)/2:eof_action=pass:enable='between(t,${pipFrom},${pipFrom + pipS})',format=yuv420p,fade=t=in:st=0:d=${fade}[main]`,
    `[0:v]fps=${FPS},format=yuv420p,setsar=1,fade=t=out:st=${TITLE_S - fade}:d=${fade}[title]`,
    `[2:v]fps=${FPS},format=yuv420p,setsar=1,fade=t=in:st=0:d=${fade}[end]`,
    `[title][main][end]concat=n=3:v=1:a=0,subtitles=captions.srt:force_style='FontName=Segoe UI,FontSize=15,PrimaryColour=&H00FFFFFF,BorderStyle=3,OutlineColour=&H40000000,Outline=6,Shadow=0,MarginV=24'[v]`,
    `[4:a]atrim=start=${Math.max(0, audioSkip)},asetpts=PTS-STARTPTS,aresample=48000,adelay=${Math.round((TITLE_S + Math.max(0, -audioSkip)) * 1000)}:all=1,atrim=end=${TITLE_S + mainS},volume=2.2[app]`,
    ...voices.map((v, i) => `[${5 + i}:a]aresample=48000,adelay=${Math.round(v.start * 1000)}:all=1[v${i}]`),
    `[app]${voices.map((_, i) => `[v${i}]`).join('')}amix=inputs=${voices.length + 1}:normalize=0:dropout_transition=0,loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000[a]`,
  ].join(';');
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...inputs, '-filter_complex', graph, '-map', '[v]', '-map', '[a]', '-t', `${totalS}`,
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-profile:v', 'high', '-r', `${FPS}`, '-g', `${FPS * 2}`, '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-movflags', '+faststart', 'cut.mp4'], { cwd: work, stdio: 'inherit' });
  copyFileSync(join(work, 'cut.mp4'), OUTPUT);
  mkdirSync(join(root, 'dist'), { recursive: true });
  copyFileSync(OUTPUT, join(root, 'dist', 'SpatialDesk_Demo_2026.mp4'));
  writeFileSync(join(work, 'edit.json'), JSON.stringify({ flash, segStart, mainS, totalS, voices: voices.map(({ id, voice, start, seconds: s }) => ({ id, voice, start, seconds: s })) }, null, 2));
  return verify(markers);
}

// 4. Checks --------------------------------------------------------------------------------------------------------------

function verify(markers) {
  step('Checks');
  const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-show_entries', 'stream=codec_type,codec_name,width,height,r_frame_rate,nb_read_frames,sample_rate,channels:format=duration', '-of', 'json', OUTPUT], { encoding: 'utf-8' }));
  const v = probe.streams.find((s) => s.codec_type === 'video');
  const a = probe.streams.find((s) => s.codec_type === 'audio');
  const duration = Number(probe.format.duration);
  // ffmpeg reports on stderr: every decoding error of the whole file, then the loudness summary.
  const decodeErrors = spawnSync('ffmpeg', ['-v', 'error', '-i', OUTPUT, '-f', 'null', '-'], { encoding: 'utf-8' }).stderr.trim();
  const loud = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', OUTPUT, '-vn', '-af', 'ebur128=peak=true', '-f', 'null', '-'], { encoding: 'utf-8' }).stderr;
  const report = {
    file: OUTPUT,
    seconds: duration,
    video: { codec: v.codec_name, width: v.width, height: v.height, rate: v.r_frame_rate, frames: Number(v.nb_read_frames), expectedFrames: Math.round(duration * FPS) },
    audio: { codec: a.codec_name, sampleRate: Number(a.sample_rate), channels: a.channels },
    decodeErrors: decodeErrors || 'none',
    render: markers.render,
    capture: markers.ffmpegStats,
    camera: markers.camera,
    loudness: loud.split('Summary:').pop().replace(/\s+/g, ' ').trim(),
  };
  writeFileSync(join(work, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  const problems = [];
  if (duration >= MAX_S) problems.push(`${duration.toFixed(1)} s is not under ${MAX_S} s`);
  if (v.width !== W || v.height !== H || v.r_frame_rate !== `${FPS}/1`) problems.push(`video is ${v.width}x${v.height} at ${v.r_frame_rate}`);
  if (Math.abs(report.video.frames - report.video.expectedFrames) > 2) problems.push(`${report.video.frames} frames for ${report.video.expectedFrames} expected`);
  if (decodeErrors) problems.push(`decode errors: ${decodeErrors.slice(0, 300)}`);
  if (problems.length) throw new Error(`The cut fails its checks: ${problems.join('; ')}`);
  return report;
}

/** Captions: each line in chunks of at most two lines of ~42 characters, timed by length within its own audio. */
function captions(voices) {
  const time = (s) => {
    const ms = Math.max(0, Math.round(s * 1000));
    const pad = (n, w = 2) => String(n).padStart(w, '0');
    return `${pad(Math.floor(ms / 3_600_000))}:${pad(Math.floor(ms / 60_000) % 60)}:${pad(Math.floor(ms / 1000) % 60)},${pad(ms % 1000, 3)}`;
  };
  const twoLines = (chunk) => {
    if (chunk.length <= 42) return chunk;
    const words = chunk.split(' ');
    let best = 1;
    for (let i = 1; i < words.length; i++) if (Math.abs(words.slice(0, i).join(' ').length - chunk.length / 2) < Math.abs(words.slice(0, best).join(' ').length - chunk.length / 2)) best = i;
    return `${words.slice(0, best).join(' ')}\n${words.slice(best).join(' ')}`;
  };
  const entries = [];
  for (const v of voices) {
    const text = v.voice === 'nova' ? v.text : beatOf(v.id).text;
    const said = v.voice === 'person' ? `"${text}"` : v.voice === 'nova' ? `Nova: ${text}` : text;
    const parts = [];
    for (const sentence of said.match(/[^.!?:]+[.!?:]?"?/g) ?? [said]) {
      let current = '';
      for (const word of sentence.trim().split(/\s+/)) {
        if (current && `${current} ${word}`.length > 84) {
          parts.push(current);
          current = word;
        } else current = current ? `${current} ${word}` : word;
      }
      if (current) parts.push(current);
    }
    const total = parts.reduce((n, p) => n + p.length, 0);
    let t = v.start;
    for (const part of parts) {
      const d = (v.seconds * part.length) / total;
      entries.push(`${entries.length + 1}\n${time(t)} --> ${time(t + d)}\n${twoLines(part)}\n`);
      t += d;
    }
  }
  return entries.join('\n');
}

function cards() {
  const style = `<style>
    html,body{margin:0;width:${W}px;height:${H}px;background:#0b0f14;color:#e9eef5;font-family:'Segoe UI',system-ui,sans-serif}
    .wrap{height:100%;display:flex;flex-direction:column;justify-content:center;padding:0 160px;box-sizing:border-box;
      background:radial-gradient(circle at 78% 28%,#1b3a5c 0,#0b0f14 58%)}
    h1{font-size:104px;margin:0 0 22px;letter-spacing:-2px} p{font-size:40px;line-height:1.35;margin:0;color:#b9c6d6;max-width:1300px}
    .small{margin-top:46px;font-size:26px;color:#8a98ac;max-width:1400px;line-height:1.45}
    .grid{display:grid;grid-template-columns:repeat(4,1fr);gap:28px;margin-top:56px}
    .tile{border:2px solid #2a4a70;border-radius:22px;padding:26px 28px;background:rgba(20,34,52,.55)}
    .tile b{display:block;font-size:58px;color:#9cc3ff;letter-spacing:-1px} .tile span{display:block;margin-top:10px;font-size:22px;line-height:1.35;color:#b9c6d6}
    .url{font-size:34px;color:#9cc3ff;margin-top:34px}
  </style>`;
  const tiles = script.metrics.map(([big, small]) => `<div class="tile"><b>${big}</b><span>${small}</span></div>`).join('');
  return {
    title: `${style}<div class="wrap"><h1>${script.title}</h1><p>${script.subtitle}</p><div class="small">${script.disclosure}</div></div>`,
    end: `${style}<div class="wrap"><h1 style="font-size:84px">${script.title}</h1><p>${script.end_line}</p><div class="grid">${tiles}</div>
      <div class="url">${api.replace(/^https:\/\//, '')}</div>
      <div class="small" style="margin-top:22px">${script.disclosure} Meta IWSDK · TypeScript · Kotlin · Spring Boot · AWS.</div></div>`,
  };
}

// ------------------------------------------------------------------------------------------------------------------------

console.log(`Working directory: ${work}`);
const durations = voices();
const markers = editOnly ? JSON.parse(readFileSync(join(work, 'markers.json'), 'utf-8')) : await capture(durations);
if (process.env.CAPTURE_ONLY) {
  speak('nova', markers.nova.map(({ id, text }) => ({ id, text })), join(work, 'nova'));
  const browser = await chromium.launch({ channel: 'msedge' });
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  for (const [name, html] of Object.entries(cards())) {
    await page.setContent(html);
    await page.waitForTimeout(300);
    await page.screenshot({ path: join(work, `${name}.png`) });
  }
  await browser.close();
  console.log(`Take ready for the pitch edit: ${work}`);
  process.exit(0);
}
const report = await edit(durations, markers);
console.log(`\n${OUTPUT}: ${report.seconds.toFixed(1)} s, ${report.video.width}x${report.video.height} at ${report.video.rate}`);
