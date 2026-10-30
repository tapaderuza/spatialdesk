// The pitch's second take (scripts/build_pitch_video.py): the same real app in Meta's IWER emulator, recorded like the
// first take (scripts/make-cinematic-video.mjs: Edge full screen, the screen at 1080p60 by ffmpeg, the app's own sound,
// a magenta sync mark), now in two of Meta's synthetic rooms (IWER's Synthetic Environment Module, `?room=`, shown as
// passthrough: the recording mode's dark backdrop is hidden). In each room the viewer sits at the desk and says "fit
// room"; in the first, one switch then undoes it, the network to the AI fails and a card moves by hand. Each beat
// waits for its line (docs/video/pitch-2026.json's `extra`), spoken by the narrator's voice into its own folder.
//   node scripts/capture_extra_take.mjs        (SKIP_BUILD=1: serve the build already in dist/)
// Output: .video/cinematic/<stamp>-extra/ capture.mp4, markers.json (epoch ms), app-audio-<n>.webm; its path in
// .video/pitch/last-extra.txt. Needs the screen to itself for about three minutes.
import { execFileSync, execSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from '@playwright/test';

const root = process.cwd();
const script = JSON.parse(readFileSync(join(root, 'docs', 'video', 'pitch-2026.json'), 'utf-8'));
const extra = script.extra;
const work = join(root, '.video', 'cinematic', `${new Date().toISOString().replace(/[:.]/g, '-')}-extra`);
const voiceDir = join(root, '.video', 'cinematic', 'voice', 'narrator-extra');
const api = process.env.E2E_URL ?? 'https://d2p3027seoreck.cloudfront.net';
const PORT = 4173;
const local = `http://localhost:${PORT}`;
const GAP_MS = 350;
mkdirSync(work, { recursive: true });
mkdirSync(voiceDir, { recursive: true });

const step = (m) => console.log(`\n==> ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const seconds = (file) => Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { encoding: 'utf-8' }).trim());

/** The narrator's lines for these beats, spoken again only where the words changed (scripts/tts.py, Piper). */
function voices() {
  step('Voices (Piper, local)');
  const changed = extra.beats.filter(({ id, text }) => {
    const txt = join(voiceDir, `${id}.txt`);
    return !existsSync(join(voiceDir, `${id}.wav`)) || !existsSync(txt) || readFileSync(txt, 'utf-8') !== text;
  });
  if (changed.length) {
    for (const f of readdirSync(voiceDir)) if (f.endsWith('.txt') && !extra.beats.some(({ id }) => `${id}.txt` === f)) unlinkSync(join(voiceDir, f));
    for (const { id, text } of extra.beats) writeFileSync(join(voiceDir, `${id}.txt`), text);
    execFileSync(join(root, '.video', 'piper-venv', 'Scripts', 'python.exe'),
      [join(root, 'scripts', 'tts.py'), join(root, '.video', 'voices', `${script.voices.narrator}.onnx`), voiceDir], { stdio: 'inherit' });
  }
  return Object.fromEntries(extra.beats.map(({ id }) => [id, seconds(join(voiceDir, `${id}.wav`))]));
}

/**
 * In the page, before the app, as in the first take: not new to the app, already calibrated, a slower switch scan the
 * camera can follow, the dark clip as the "camera" (so the recording mode opens the room), and the app's sound recorded
 * where it reaches the speakers.
 */
function inPage() {
  localStorage.setItem('spatialdesk.onboarded', '1');
  localStorage.setItem('spatialdesk.calibrated', '1');
  localStorage.setItem('spatialdesk.access-preferences', JSON.stringify({ scanIntervalMs: 700 }));
  const video = (window.__video = { audioStartedAt: null });
  const connect = AudioNode.prototype.connect;
  let chunk = 0;
  AudioNode.prototype.connect = function (destination, ...rest) {
    const result = connect.call(this, destination, ...rest);
    if (destination === this.context.destination) {
      if (video.audioStartedAt === null && this instanceof BiquadFilterNode && Math.round(this.frequency.value) === 6500) {
        const tap = this.context.createMediaStreamDestination();
        this.context.__videoTap = tap;
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
          recorder.onstop = () => setTimeout(resolve, 500);
          recorder.stop();
        });
        video.audioStartedAt = -1;
        recorder.start(1000);
      }
      if (this.context.__videoTap) connect.call(this, this.context.__videoTap);
    }
    return result;
  };
  const devices = navigator.mediaDevices;
  const original = devices.getUserMedia.bind(devices);
  devices.getUserMedia = async (constraints = {}) => {
    if (!constraints.video) return original(constraints);
    const clip = document.createElement('video');
    Object.assign(clip, { src: '/__video/camera', loop: true, muted: true, playsInline: true });
    await clip.play();
    return clip.captureStream();
  };
}

async function capture(durations) {
  if (!process.env.SKIP_BUILD) {
    step('Production build');
    execSync('npm run build', { cwd: root, stdio: 'inherit' });
  }
  const dark = join(work, 'dark.mp4');
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=0x1a1a1a:s=1280x720:r=30:d=12', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', dark]);
  step(`Serving it on :${PORT}, /api to ${api}`);
  const preview = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort'],
    { cwd: root, env: { ...process.env, SPATIALDESK_API: api }, stdio: 'ignore' });
  let ffmpeg = null;
  const markers = { beats: [], segments: [], audio: [], events: [], rooms: [] };
  const event = (kind) => markers.events.push({ kind, at: Date.now() });
  let speakingUntil = 0;
  const beat = async (id) => {
    const wait = speakingUntil + GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    const at = Date.now();
    markers.beats.push({ id, at });
    speakingUntil = at + durations[id] * 1000;
  };
  const settle = async (extraMs = 0) => {
    const wait = speakingUntil + extraMs - Date.now();
    if (wait > 0) await sleep(wait);
  };
  try {
    let up = false;
    for (let i = 0; i < 120 && !up; i++) {
      up = await fetch(local).then((r) => r.ok, () => false);
      if (!up) await sleep(500);
    }
    if (!up) throw new Error(`The preview never answered on ${local}`);

    const browser = await chromium.launch({
      channel: 'msedge', headless: false, chromiumSandbox: true,
      args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required',
        '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--hide-scrollbars'],
    });
    const context = await browser.newContext({ viewport: null, baseURL: local });
    let audioChunks = [];
    await context.exposeFunction('__videoAudioChunk', (index, data) => (audioChunks[index] = Buffer.from(data, 'base64')));
    await context.route('**/__video/camera', (route) => route.fulfill({ path: dark, contentType: 'video/mp4' }));
    await context.addInitScript(inPage);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.stack ?? e.message));
    const cdp = await context.newCDPSession(page);
    const { windowId } = await cdp.send('Browser.getWindowForTarget');
    await cdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'fullscreen' } });

    /** The head toward a named element, through the recording mode's spring (as in the first take). */
    const aimAt = async (name, u = 0, v = 0) => {
      const angles = await page.evaluate(({ name, u, v }) => {
        const w = window.__world;
        let el = null;
        w.scene.traverse((o) => { if (o.name === name) el = o; });
        if (!el) return null;
        el.updateWorldMatrix(true, false);
        const V = w.camera.position.constructor;
        const d = new V(u, v, 0).applyMatrix4(el.matrixWorld).sub(w.camera.getWorldPosition(new V())).normalize();
        return { yaw: Math.atan2(-d.x, -d.z), pitch: Math.asin(d.y) };
      }, { name, u, v });
      if (!angles) throw new Error(`No element ${name} to look at`);
      await page.evaluate(({ yaw, pitch }) => window.__cinematic.aim(yaw, pitch), angles);
    };
    /** A real pinch of the right hand: the session's own selectstart, which is what the switch listens to. */
    const pinch = () => page.evaluate(async () => {
      const hand = window.__xrDevice.hands.right;
      const frame = () => new Promise(requestAnimationFrame);
      hand.updatePinchValue(1);
      for (let i = 0; i < 10; i++) await frame();
      hand.updatePinchValue(0);
      for (let i = 0; i < 10; i++) await frame();
    });
    const select = () => page.evaluate(() => window.__cinematic.select());
    const hoy = () => page.evaluate(() => window.__workspace.state.boards.find((b) => b.title === 'Hoy').id);

    /** A room: loaded, the pitch's board (its first card already in Hecho, as the story left it), sitting at the desk. */
    const enter = async (room) => {
      audioChunks = [];
      await page.goto(`/?cinematicMode=true&fast=true&room=${room}`);
      await page.waitForSelector('#cinematic-start', { timeout: 60_000 });
      await page.waitForFunction(() => window.__workspace?.state?.boards?.length > 0, null, { timeout: 30_000 });
      await page.evaluate(({ ops, target }) => {
        const ws = window.__workspace;
        ws.dispatch(ops);
        const board = ws.state.boards.find((b) => b.title === target.board);
        const card = board.columns[target.column].cards[target.card];
        ws.dispatch({ op: 'move_card', board: board.id, card: card.id, column: board.columns[board.columns.length - 1].id });
      }, { ops: script.seed, target: script.beats.find((b) => b.id === 'gaze').target });
      await page.click('#cinematic-start');
      await page.waitForFunction(() => window.__cinematic?.state.started && window.__room?.state.inRoom, null, { timeout: 30_000 });
      await page.waitForFunction(() => window.__room.queries.planes.entities.size >= 3, null, { timeout: 40_000 });
      await page.waitForFunction(() => (window.__video.audioStartedAt ?? -1) > 0, null, { timeout: 10_000 });
      const seat = await page.evaluate(() => {
        window.__world.scene.traverse((o) => { if (o.name === 'cinematic-backdrop') o.visible = false; }); // the room, not the clip
        // Beside the desk, facing it (tests/rooms.spec.ts's seat()).
        const planes = window.__room.planes();
        const floor = planes.find((p) => p.label === 'floor');
        const middle = floor ? floor.center : [0, 0, 0];
        const labels = new Set(['desk', 'table']);
        const desk = planes.filter((p) => p.orientation === 'horizontal' && p.center[1] >= 0.55 && p.center[1] <= 1.15)
          .sort((a, b) => Number(labels.has(b.label)) - Number(labels.has(a.label)))[0];
        if (!desk) return null;
        const t = desk.tangent;
        const n = desk.normal;
        const b = [t[1] * n[2] - t[2] * n[1], t[2] * n[0] - t[0] * n[2], t[0] * n[1] - t[1] * n[0]];
        const side = [{ dir: b, reach: desk.max[1] }, { dir: b.map((v) => -v), reach: -desk.min[1] }, { dir: t, reach: desk.max[0] }, { dir: t.map((v) => -v), reach: -desk.min[0] }]
          .map(({ dir, reach }) => ({ dir, at: [desk.center[0] + dir[0] * (reach + 0.45), desk.center[2] + dir[2] * (reach + 0.45)] }))
          .sort((p, q) => Math.hypot(p.at[0] - middle[0], p.at[1] - middle[2]) - Math.hypot(q.at[0] - middle[0], q.at[1] - middle[2]))[0];
        const yaw = Math.atan2(side.dir[0], side.dir[2]);
        window.__xrDevice.position.set(side.at[0], 1.15, side.at[1]);
        window.__cinematic.aim(yaw, -0.12);
        return { desk: desk.label, yaw };
      });
      if (!seat) throw new Error(`No desk in ${room}`);
      markers.rooms.push({ room, ...seat });
      await sleep(1500);
    };
    /** The room's sound, as recorded by the page, kept before the page goes. */
    const keepAudio = async (n) => {
      await page.evaluate(() => window.__video.stopAudio());
      const file = `app-audio-${n}.webm`;
      writeFileSync(join(work, file), Buffer.concat(audioChunks.filter(Boolean)));
      markers.audio.push({ file, startedAt: await page.evaluate(() => window.__video.audioStartedAt) });
    };
    const fit = async () => {
      await page.evaluate(() => window.__voice.say('fit room'));
      await page.waitForFunction(() => window.__room.state.lastFit != null, null, { timeout: 15_000 });
      markers.events.push({ kind: 'fit', at: Date.now(), fit: await page.evaluate(() => window.__room.state.lastFit) });
    };

    // 1. The first room, recorded once it is ready (the loading is never filmed): Fit room, then one switch undoing it,
    // then the network to the AI failing and a card moved by hand. Its command panel stays close at her left.
    const [first, second] = extra.rooms;
    await enter(first);
    step('Capturing the screen at 1080p60');
    ffmpeg = spawn('ffmpeg', ['-y', '-loglevel', 'warning', '-f', 'lavfi', '-i', 'ddagrab=output_idx=0:framerate=60:draw_mouse=0',
      '-c:v', 'h264_mf', '-hw_encoding', '1', '-b:v', '40M', join(work, 'capture.mp4')], { stdio: ['pipe', 'ignore', 'pipe'] });
    await sleep(2000);
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
    await sleep(800);
    let from = Date.now();
    await beat('rooms');
    await sleep(1400);
    await fit();
    await settle(700);
    await beat('switch');
    await aimAt('command:undo-button', 0.12, 0.05);
    await page.evaluate(() => window.__voice.say('switch mode on'));
    await sleep(700);
    await pinch(); // the first press starts the scan
    event('switch-armed');
    await page.waitForFunction(() => /^undo/.test(window.__switch?.view.highlighted ?? ''), null, { timeout: 45_000 });
    await sleep(500);
    await pinch(); // Undo
    event('switch-undo');
    await sleep(500);
    await aimAt(`${await hoy()}:col-1`, 0, -0.05);
    await settle(1000);
    await page.evaluate(() => window.__voice.say('switch mode off'));
    await beat('offline');
    await context.route('**/api/agent/**', (route) => route.abort());
    await aimAt('command:talk-button', 0.1, 0.12);
    await page.evaluate(() => window.__voice.say('plan my day'));
    await page.waitForFunction(() => window.__notice?.text, null, { timeout: 20_000 });
    markers.events.push({ kind: 'offline', at: Date.now(), notice: await page.evaluate(() => window.__notice.text) });
    await sleep(1600);
    const board = await hoy();
    await aimAt(`${board}:card-0-0`);
    await sleep(1100);
    await select(); // pick it up
    event('pick');
    await sleep(500);
    await aimAt(`${board}:col-2`, 0, -0.35);
    await sleep(1100);
    await select(); // drop it in Hecho
    event('drop');
    await sleep(400);
    await aimAt(`${board}:col-1`, 0, -0.05);
    await settle(1200);
    markers.segments.push({ room: first, from, to: Date.now() });
    markers.moved = await page.evaluate((id) => window.__workspace.state.boards.find((b) => b.id === id).columns[2].cards.map((c) => c.title), board);
    await context.unroute('**/api/agent/**');
    await keepAudio(0);

    // 2. The second room: the same words, another desk. Edge shows its full-screen notice after each load: it fades first.
    await enter(second);
    await sleep(4500);
    from = Date.now();
    await beat('rooms2');
    await sleep(1000);
    await fit();
    await settle(1200);
    markers.segments.push({ room: second, from, to: Date.now() });
    await keepAudio(1);
    markers.errors = errors;
    ffmpeg.stdin.write('q');
    await new Promise((r) => ffmpeg.on('exit', r));
    ffmpeg = null;
    await browser.close();
  } finally {
    if (ffmpeg) {
      ffmpeg.stdin.write('q');
      await new Promise((r) => ffmpeg.on('exit', r));
    }
    preview.kill();
  }
  return markers;
}

const durations = voices();
const markers = await capture(durations);
markers.voiceDir = voiceDir;
writeFileSync(join(work, 'markers.json'), JSON.stringify(markers, null, 2));
mkdirSync(join(root, '.video', 'pitch'), { recursive: true });
writeFileSync(join(root, '.video', 'pitch', 'last-extra.txt'), work);
console.log(`\n${work}: ${markers.segments.length} segments, ${markers.beats.length} beats, ${markers.errors.length} page errors`);
