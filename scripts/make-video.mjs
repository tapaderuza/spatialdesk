// Builds the submission video (< 3 min, 1280x720, H.264 + AAC) in three steps:
//   1. the voice-over: docs/video/narration.json spoken by Piper, locally (no account, no key, no cost);
//   2. the recording: tests/demo.spec.ts in the IWER Quest 3 emulator, paced so each beat lasts as long as its line;
//   3. the edit (ffmpeg): title card, recording, end card, the voice at each beat, captions burned in.
//   node scripts/make-video.mjs            against production (E2E_URL=... for another deployment)
//   node scripts/make-video.mjs --edit     edit the last recording again without recording
// Needs Docker (builds the spatialdesk-tts image once), ffmpeg/ffprobe on PATH, and Edge. Output in .video/.
import { execFileSync, execSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { calibrateRecording, captureIdentity, fingerprintTree, validateIdentity, validateRecording } from './video-contract.mjs';

const root = process.cwd();
const editing = process.argv.includes('--edit') || process.argv.includes('--check');
// Each new take has its own directory: failed captures never replace an approved cut.
const out = resolve(process.env.VIDEO_DIR ?? (editing ? join(root, '.video') : join(root, '.video', 'runs', new Date().toISOString().replace(/[:.]/g, '-'))));
const voiceDir = join(out, 'voice');
const script = JSON.parse(readFileSync(join(root, 'docs/video/narration.json'), 'utf-8'));
const markersFile = join(out, 'markers.json');
const identityPaths = () => ({ narration: join(root, 'docs/video/narration.json'), demo: join(root, 'tests/demo.spec.ts'),
  helpers: join(root, 'tests/helpers.ts'), durations: join(out, 'durations.json'), markers: markersFile, recording: join(out, 'recording.webm'),
  ...Object.fromEntries(script.beats.map(({ id }) => [`voice:${id}`, join(voiceDir, `${id}.wav`)])),
  ...Object.fromEntries(script.beats.filter(b => b.audio).map(b => [`source:${b.id}`, join(root, b.audio)])) });
const identityFile = join(out, 'capture.json');
const appIdentity = () => fingerprintTree(root, ['src', 'public', 'vendor/spatialdesk-shared', 'server/app/src/main', 'server/shared/src', 'iwsdk.config.json', 'package-lock.json']);
const currentIdentity = () => ({ ...captureIdentity(identityPaths()), app: appIdentity() });
if (editing) {
  validateRecording(script, JSON.parse(readFileSync(markersFile, 'utf-8')).beats,
    JSON.parse(readFileSync(join(out, 'durations.json'), 'utf-8')));
  validateIdentity(existsSync(identityFile) ? JSON.parse(readFileSync(identityFile, 'utf-8')).identity : null, currentIdentity());
  if (process.argv.includes('--check')) { console.log('Capture matches current script, pacing, test and video.'); process.exit(0); }
}
mkdirSync(voiceDir, { recursive: true });
if (!editing && existsSync(markersFile)) throw new Error('This VIDEO_DIR already contains a take. Choose a new directory or use --edit.');
console.log(`Video working directory: ${out}`);
if (!editing) {
  const cache = process.env.VIDEO_VOICE_CACHE ?? join(root, '.video', 'voice');
  if (existsSync(cache)) for (const file of readdirSync(cache)) copyFileSync(join(cache, file), join(voiceDir, file));
}
const url = process.env.E2E_URL ?? 'https://d2p3027seoreck.cloudfront.net';
const [W, H, FPS] = [1280, 720, 30];
const TITLE_S = 4.5; // title card
const LEAD_S = 0.8; // recording kept before the first beat
const TAIL_S = 1.2; // and after the last recorded line
const END_LEAD_S = 0.5; // end card shown before its line starts
const END_HOLD_S = 2.5; // and kept after it
const MAX_S = 180; // judges watch three minutes

const step = (m) => console.log(`\n==> ${m}`);
const run = (cmd, env = {}) => execSync(cmd, { cwd: root, stdio: 'inherit', shell: true, env: { ...process.env, ...env } });
const seconds = (file) =>
  Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { encoding: 'utf-8' }).trim());

// 1. Voice: every line again whenever any line changed (one container run, the voice loads once). A beat with its own
// 'audio' (a real person's voice) plays that instead; lines no longer in the script are not spoken.
step('Voice-over (Piper, local)');
const spoken = script.beats.filter((b) => !b.audio);
for (const f of readdirSync(voiceDir)) if (f.endsWith('.txt') && !spoken.some(({ id }) => `${id}.txt` === f)) unlinkSync(join(voiceDir, f));
for (const { id, audio } of script.beats.filter((b) => b.audio)) {
  if (!existsSync(join(root, audio))) throw new Error(`${audio} is missing: the real recording for "${id}" is kept outside the repository.`);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', join(root, audio), '-ac', '1', '-c:a', 'pcm_s16le', join(voiceDir, `${id}.wav`)]);
}
const changed = spoken.some(({ id, text }) => {
  const txt = join(voiceDir, `${id}.txt`);
  return !existsSync(join(voiceDir, `${id}.wav`)) || !existsSync(txt) || readFileSync(txt, 'utf-8') !== text;
});
if (changed) {
  for (const { id, text } of spoken) writeFileSync(join(voiceDir, `${id}.txt`), text);
  try {
    execSync('docker image inspect spatialdesk-tts', { stdio: 'ignore' });
  } catch {
    run('docker build -t spatialdesk-tts -f scripts/tts.Dockerfile scripts');
  }
  run(`docker run --rm -v "${voiceDir}:/work" spatialdesk-tts`, { MSYS_NO_PATHCONV: '1' });
}
const durations = Object.fromEntries(script.beats.map(({ id }) => [id, seconds(join(voiceDir, `${id}.wav`))]));
writeFileSync(join(out, 'durations.json'), JSON.stringify(durations, null, 2));
// The "say" line is also the browser's microphone: 16 kHz mono, a moment of silence before it and after it (Talk
// ends on a pause), so the real Amazon Transcribe hears exactly what the video plays.
const mic = join(voiceDir, 'mic.wav');
const sayBeat = script.beats.find((b) => b.id === 'say');
execFileSync('ffmpeg', [
  '-y', '-loglevel', 'error', '-f', 'lavfi', '-t', '0.3', '-i', 'anullsrc=r=16000:cl=mono', '-i', sayBeat?.mic ? join(root, sayBeat.mic) : join(voiceDir, 'say.wav'),
  '-f', 'lavfi', '-t', '3', '-i', 'anullsrc=r=16000:cl=mono',
  '-filter_complex', '[1:a]aresample=16000,aformat=sample_fmts=s16:channel_layouts=mono[v];[0:a][v][2:a]concat=n=3:v=0:a=1',
  '-c:a', 'pcm_s16le', mic,
]);
console.log(`${script.beats.length} lines, ${Object.values(durations).reduce((a, b) => a + b, 0).toFixed(1)} s of voice`);

// 2. Recording, paced by the voice.
if (!process.argv.includes('--edit')) {
  run('npm run --if-present typecheck');
  if (process.env.DEMO_CONFIG) run('npm run build'); // alternate capture configs may reuse a running preview
  step(`Recording the demo in IWER against ${url}`);
  const appBefore = appIdentity();
  const staticPaths = Object.fromEntries(Object.entries(identityPaths()).filter(([key]) => key !== 'markers' && key !== 'recording'));
  const staticBefore = captureIdentity(staticPaths);
  writeFileSync(join(out, 'capture-start.json'), JSON.stringify({ url, identity: { ...staticBefore, app: appBefore } }, null, 2));
  const config = process.env.DEMO_CONFIG ? ['--config', process.env.DEMO_CONFIG] : [];
  execFileSync(process.execPath, ['node_modules/@playwright/test/cli.js', 'test', 'tests/demo.spec.ts', ...config],
    { cwd: root, stdio: 'inherit', env: { ...process.env, DEMO: '1', E2E_URL: url, NARRATION: join(out, 'durations.json'), MARKERS: markersFile, MIC: mic } });
  if (appBefore !== appIdentity()) throw new Error('The application changed during recording. Record a new take.');
  validateIdentity(staticBefore, captureIdentity(staticPaths));
  copyFileSync(JSON.parse(readFileSync(markersFile, 'utf-8')).video, join(out, 'recording.webm'));
  const raw = JSON.parse(readFileSync(markersFile, 'utf-8'));
  const pixels = execFileSync('ffmpeg', ['-v', 'error', '-i', join(out, 'recording.webm'), '-vf', 'fps=10,crop=4:4:14:14,scale=1:1', '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-'], { maxBuffer: 2 * 1024 * 1024 });
  raw.beats = calibrateRecording(raw.beats, pixels);
  raw.timing = 'frame-marker-v1';
  writeFileSync(markersFile, JSON.stringify(raw, null, 2));
}
const marks = JSON.parse(readFileSync(markersFile, 'utf-8')).beats; // [{ id, at }] ms since the recording began
validateRecording(script, marks, durations);
if (!editing) writeFileSync(identityFile, JSON.stringify({ url, identity: currentIdentity() }, null, 2));

// Gallery stills for Devpost, from the recording (no captions): [file, beat, seconds into that beat].
step('Gallery');
const galleryDir = join(out, 'gallery');
if (resolve(galleryDir) !== resolve(out, 'gallery')) throw new Error('Invalid gallery destination');
rmSync(galleryDir, { recursive: true, force: true }); // only this cut's stills
mkdirSync(galleryDir, { recursive: true });
const STILLS = [
  ['1-her-request', 'heard', 2.5],
  ['2-space-adapted', 'apply', 7],
  ['3-plan-preview', 'plan', 5],
  ['4-hands-free', 'handsfree', 3],
  ['17-one-switch', 'switch', 6.5],
  ['18-fit-to-my-reach', 'reach', 3],
  ['5-session-choice', 'session', 2.5],
  ['6-session-finished', 'session-end', 1.5],
  ['7-work-checkpoint', 'pause', 2.5],
  ['16-return-review', 'return', 3],
  ['8-ai-log', 'log', 2.5],
  ['9-in-my-room', 'room', 8.5],
  ['10-room-focus', 'room', 13],
  ['11-glasses', 'glasses', 7],
  ['12-studio', 'enter', 0.8],
  ['13-dialogue', 'dialogue', 3],
  ['14-saved-setup', 'saved', 3],
  ['15-recall', 'recall', 1.5],
];
for (const [name, id, offset] of STILLS) {
  const mark = marks.find((m) => m.id === id);
  if (!mark) continue;
  // The beat marker in the corner is hidden as in the edit.
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', `${mark.at / 1000 + offset}`, '-i', join(out, 'recording.webm'), '-vf', 'delogo=x=2:y=2:w=28:h=28', '-frames:v', '1', join(galleryDir, `${name}.png`)]);
}

// 3. The edit.
// Real footage before the title card (script.open): its own picture, sound and captions; left out when its file is not
// here (it lives in .video/source, outside the repository).
const open = script.open && existsSync(join(root, script.open.clip)) ? script.open : null;
const OPEN_S = open ? open.seconds : 0;
if (open) {
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', '2.2', '-i', join(root, open.clip), '-frames:v', '1', '-q:v', '3', join(out, 'open-frame.jpg')]);
}

step('Title and end cards');
const browser = await chromium.launch({ channel: 'msedge' });
const page = await browser.newPage({ viewport: { width: W, height: H } });
for (const [name, html] of Object.entries(cards())) {
  await page.setContent(html);
  await page.screenshot({ path: join(out, `${name}.png`) });
}
await browser.close();
copyFileSync(join(out, open ? 'thumb.png' : 'title.png'), join(galleryDir, '0-thumbnail.png'));

step('Edit');
const recorded = marks.map((m) => ({ ...m, s: m.at / 1000 }));
const last = recorded[recorded.length - 1];
const trimStart = Math.max(0, recorded[0].s - LEAD_S);
const calibrated = recorded.every((m) => Number.isFinite(m.end));
const mainS = calibrated ? recorded.reduce((n, m) => n + m.end - m.s, 0) : last.s + durations[last.id] + TAIL_S - trimStart;
const endS = END_LEAD_S + durations.end + END_HOLD_S;
const totalS = OPEN_S + TITLE_S + mainS + endS;
let nextVoiceStart = OPEN_S + TITLE_S;
const voice = [
  ...recorded.map((m) => {
    const v = { id: m.id, start: calibrated ? nextVoiceStart : OPEN_S + TITLE_S + m.s - trimStart };
    nextVoiceStart += m.end - m.s;
    return v;
  }),
  { id: 'end', start: OPEN_S + TITLE_S + mainS + END_LEAD_S },
];
const approvedMainStart = voice.find((v) => v.id === 'heard')?.start ?? OPEN_S + TITLE_S;
const deliveryS = process.argv.includes('--approved') ? 13.7 + totalS - approvedMainStart : totalS;
if (deliveryS >= MAX_S) throw new Error(`Cut would be ${deliveryS.toFixed(1)} s, limit ${MAX_S} s. No video replaced.`);
writeFileSync(join(out, 'captions.srt'), captions(voice));

const inputs = [];
if (open) inputs.push('-t', `${OPEN_S}`, '-i', join(root, open.clip));
const first = inputs.length / 4; // the title card's input index: 1 after the opening clip, else 0
inputs.push('-loop', '1', '-t', `${TITLE_S}`, '-i', 'title.png');
if (!calibrated) inputs.push('-ss', `${trimStart}`, '-t', `${mainS}`);
inputs.push('-i', 'recording.webm');
inputs.push('-loop', '1', '-t', `${endS}`, '-i', 'end.png');
for (const v of voice) inputs.push('-i', join('voice', `${v.id}.wav`));
const fade = 0.4;
const graph = [
  ...(calibrated ? [
    `[${first + 1}:v]split=${recorded.length}${recorded.map((_, i) => `[raw${i}]`).join('')}`,
    ...recorded.map((m, i) => `[raw${i}]trim=start=${m.s}:end=${m.end},setpts=PTS-STARTPTS,delogo=x=2:y=2:w=28:h=28[part${i}]`),
    `${recorded.map((_, i) => `[part${i}]`).join('')}concat=n=${recorded.length}:v=1:a=0[recorded]`,
  ] : []),
  ...(open
    ? [
        `[0:v]fps=${FPS},scale=${W}:${H},format=yuv420p,setsar=1,fade=t=in:st=0:d=${fade},fade=t=out:st=${OPEN_S - fade}:d=${fade}[vo]`,
        `[0:a]atrim=0:${OPEN_S},afade=t=out:st=${OPEN_S - fade}:d=${fade},aresample=48000[ao]`,
      ]
    : []),
  `[${first}:v]fps=${FPS},format=yuv420p,setsar=1,${open ? `fade=t=in:st=0:d=${fade},` : ''}fade=t=out:st=${TITLE_S - fade}:d=${fade}[v0]`,
  `${calibrated ? '[recorded]' : `[${first + 1}:v]`}fps=${FPS},scale=${W}:${H},format=yuv420p,setsar=1,fade=t=in:st=0:d=${fade}[v1]`,
  `[${first + 2}:v]fps=${FPS},format=yuv420p,setsar=1,fade=t=in:st=0:d=${fade}[v2]`,
  `${open ? '[vo]' : ''}[v0][v1][v2]concat=n=${open ? 4 : 3}:v=1:a=0,subtitles=captions.srt:force_style='FontName=Segoe UI,FontSize=15,PrimaryColour=&H00FFFFFF,BorderStyle=3,OutlineColour=&H38000000,Outline=6,Shadow=0,MarginV=22'[v]`,
  ...voice.map((v, i) => `[${first + 3 + i}:a]aresample=48000,adelay=${Math.round(v.start * 1000)}:all=1[a${i}]`),
  `${open ? '[ao]' : ''}${voice.map((_, i) => `[a${i}]`).join('')}amix=inputs=${voice.length + (open ? 1 : 0)}:normalize=0,apad[a]`,
].join(';');
execFileSync(
  'ffmpeg',
  ['-y', '-loglevel', 'error', ...inputs, '-filter_complex', graph, '-map', '[v]', '-map', '[a]', '-t', `${totalS}`,
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart',
    'spatialdesk-demo.mp4'],
  { cwd: out, stdio: 'inherit' },
);
const final = seconds(join(out, 'spatialdesk-demo.mp4'));
console.log(`\n.video/spatialdesk-demo.mp4: ${final.toFixed(1)} s (captions also in .video/captions.srt)`);
if (final >= MAX_S && !process.argv.includes('--approved')) {
  console.error(`Too long: ${final.toFixed(1)} s, the limit is ${MAX_S} s.`);
  process.exit(1);
}
writeFileSync(join(out, 'edit.json'), JSON.stringify({ mainStart: OPEN_S + TITLE_S, approvedMainStart, totalSeconds: final,
  identity: { ...currentIdentity(), cut: captureIdentity({ cut: join(out, 'spatialdesk-demo.mp4') }).cut } }, null, 2));
if (process.argv.includes('--approved')) {
  const python = process.env.FACELESS_PYTHON ?? 'python';
  execFileSync(python, ['scripts/render-approved.py', '--take', out], { cwd: root, stdio: 'inherit' });
}

/** Each line as captions of at most two lines of ~42 characters, timed by length within the line's audio. */
function captions(voiceTrack) {
  const time = (s) => {
    const ms = Math.round(s * 1000);
    const pad = (n, w = 2) => String(n).padStart(w, '0');
    return `${pad(Math.floor(ms / 3_600_000))}:${pad(Math.floor(ms / 60_000) % 60)}:${pad(Math.floor(ms / 1000) % 60)},${pad(ms % 1000, 3)}`;
  };
  const chunks = (text) => {
    const result = [];
    for (const sentence of text.match(/[^.!?:]+[.!?:]?/g) ?? [text]) {
      let current = '';
      for (const word of sentence.trim().split(/\s+/)) {
        if (current && (current + ' ' + word).length > 84) {
          result.push(current);
          current = word;
        } else current = current ? `${current} ${word}` : word;
      }
      if (current) result.push(current);
    }
    return result;
  };
  const twoLines = (chunk) => {
    if (chunk.length <= 42) return chunk;
    const words = chunk.split(' ');
    let best = 1;
    for (let i = 1; i < words.length; i++) {
      const a = words.slice(0, i).join(' ').length;
      if (Math.abs(a - chunk.length / 2) < Math.abs(words.slice(0, best).join(' ').length - chunk.length / 2)) best = i;
    }
    return `${words.slice(0, best).join(' ')}\n${words.slice(best).join(' ')}`;
  };
  const entries = [];
  const timed = (at, to, text) => entries.push(`${entries.length + 1}\n${time(at)} --> ${time(to)}\n${text}\n`);
  if (open) for (const c of open.captions) timed(c.at, c.to, c.text);
  for (const v of voiceTrack) {
    const beat = script.beats.find((b) => b.id === v.id);
    if (beat.captions) {
      for (const c of beat.captions) timed(v.start + c.at, v.start + c.to, c.text);
      continue;
    }
    if (beat.subtitles?.length) {
      const split = (text, fraction = 0.5) => {
        const words = text.split(' ');
        let best = 1;
        for (let i = 1; i < words.length; i++) {
          const left = words.slice(0, i).join(' ');
          const score = Math.abs(left.length / text.length - fraction) - (left.endsWith(',') ? 0.2 : 0);
          const candidate = words.slice(0, best).join(' ');
          const previous = Math.abs(candidate.length / text.length - fraction) - (candidate.endsWith(',') ? 0.2 : 0);
          if (score < previous) best = i;
        }
        return [words.slice(0, best).join(' '), words.slice(best).join(' ')];
      };
      const pairs = beat.subtitles.flatMap(([es, en]) => {
        if (es.length <= 42 && en.length <= 42) return [[es, en]];
        const a = split(en);
        const b = split(es, a[0].length / en.length);
        return [[b[0], a[0]], [b[1], a[1]]];
      });
      const weight = pairs.reduce((n, pair) => n + pair[1].length, 0);
      let at = v.start;
      for (const [es, en] of pairs) {
        const length = durations[v.id] * en.length / weight;
        timed(at, at + length, `${twoLines(es)}\n${twoLines(en)}`);
        at += length;
      }
      continue;
    }
    const parts = chunks(beat.text);
    const total = parts.reduce((n, p) => n + p.length, 0);
    let t = v.start;
    for (const part of parts) {
      const d = (durations[v.id] * part.length) / total;
      entries.push(`${entries.length + 1}\n${time(t)} --> ${time(t + d)}\n${twoLines(part)}\n`);
      t += d;
    }
  }
  return entries.join('\n');
}

function cards() {
  const base = `<style>
    html,body{margin:0;width:${W}px;height:${H}px;background:#0b0f14;color:#e9eef5;font-family:'Segoe UI',system-ui,sans-serif}
    .wrap{height:100%;display:flex;flex-direction:column;justify-content:center;padding:0 110px;box-sizing:border-box;
      background:radial-gradient(circle at 78% 30%,#16324f 0,#0b0f14 55%)}
    h1{font-size:64px;margin:0 0 18px;letter-spacing:-1px} p{font-size:28px;line-height:1.35;margin:0;color:#b9c6d6;max-width:900px}
    .tag{display:inline-block;margin:0 10px 0 0;padding:6px 14px;border:2px solid #2f6db3;border-radius:10px;font-size:20px;color:#9cc3ff}
    .tags{margin-top:34px} .small{margin-top:28px;font-size:20px;color:#7f8ea3} .url{font-size:30px;color:#9cc3ff;margin-top:26px}
  </style>`;
  const tags = (script.tags ?? []).map((t) => `<span class="tag">${t}</span>`).join('');
  const cardsHtml = {
    title: `${base}<div class="wrap"><h1>${script.title}</h1><p>${script.subtitle}</p>
      <div class="tags">${tags}</div>
      <div class="small">The real app, recorded in Meta's IWER emulator (Quest 3). The AI runs live on Amazon Bedrock; voice on Amazon Transcribe.</div></div>`,
    end: `${base}<div class="wrap"><h1>${script.title}</h1><p>${script.end_line}</p>
      <div class="url">${/^https?:\/\/(localhost|127\.)/.test(url) ? '' : url.replace(/^https:\/\//, '')}</div>
      <div class="small">Recorded in Meta's IWER Quest 3 emulator. Live Amazon Nova and Transcribe.<br>Meta IWSDK · TypeScript · Kotlin Multiplatform · Spring Boot · AWS</div></div>`,
  };
  if (!open) return cardsHtml;
  // The thumbnail: the person it is for, and the promise.
  const photo = readFileSync(join(out, 'open-frame.jpg')).toString('base64');
  return {
    ...cardsHtml,
    thumb: `${base}<div class="wrap" style="background:linear-gradient(90deg,#0b0f14 0,rgba(11,15,20,.88) 38%,rgba(11,15,20,0) 70%),url(data:image/jpeg;base64,${photo}) center/cover">
      <h1 style="font-size:84px">${script.title}</h1><p style="font-size:38px;max-width:560px;color:#e9eef5">A workspace that adapts to your body.</p>
      <div class="tags">${tags.split('</span>').slice(0, 3).join('</span>')}</span></div></div>`,
  };
}
