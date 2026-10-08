// Builds the submission video (< 3 min, 1280x720, H.264 + AAC) in three steps:
//   1. the voice-over: docs/video/narration.json spoken by Piper, locally (no account, no key, no cost);
//   2. the recording: tests/demo.spec.ts in the IWER Quest 3 emulator, paced so each beat lasts as long as its line;
//   3. the edit (ffmpeg): title card, recording, end card, the voice at each beat, captions burned in.
//   node scripts/make-video.mjs            against production (E2E_URL=... for another deployment)
//   node scripts/make-video.mjs --edit     edit the last recording again without recording
// Needs Docker (builds the spatialdesk-tts image once), ffmpeg/ffprobe on PATH, and Edge. Output in .video/.
import { execFileSync, execSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from '@playwright/test';

const root = process.cwd();
const out = join(root, '.video');
const voiceDir = join(out, 'voice');
mkdirSync(voiceDir, { recursive: true });
const script = JSON.parse(readFileSync(join(root, 'docs/video/narration.json'), 'utf-8'));
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

// 1. Voice: every line again whenever any line changed (one container run, the voice loads once).
step('Voice-over (Piper, local)');
const changed = script.beats.some(({ id, text }) => {
  const txt = join(voiceDir, `${id}.txt`);
  return !existsSync(join(voiceDir, `${id}.wav`)) || !existsSync(txt) || readFileSync(txt, 'utf-8') !== text;
});
if (changed) {
  for (const { id, text } of script.beats) writeFileSync(join(voiceDir, `${id}.txt`), text);
  try {
    execSync('docker image inspect spatialdesk-tts', { stdio: 'ignore' });
  } catch {
    run('docker build -t spatialdesk-tts -f scripts/tts.Dockerfile scripts');
  }
  run(`docker run --rm -v "${voiceDir}:/work" spatialdesk-tts`, { MSYS_NO_PATHCONV: '1' });
}
const durations = Object.fromEntries(script.beats.map(({ id }) => [id, seconds(join(voiceDir, `${id}.wav`))]));
writeFileSync(join(out, 'durations.json'), JSON.stringify(durations, null, 2));
console.log(`${script.beats.length} lines, ${Object.values(durations).reduce((a, b) => a + b, 0).toFixed(1)} s of voice`);

// 2. Recording, paced by the voice.
const markersFile = join(out, 'markers.json');
if (!process.argv.includes('--edit')) {
  step(`Recording the demo in IWER against ${url}`);
  run('npx playwright test tests/demo.spec.ts', { DEMO: '1', E2E_URL: url, NARRATION: join(out, 'durations.json'), MARKERS: markersFile });
  copyFileSync(JSON.parse(readFileSync(markersFile, 'utf-8')).video, join(out, 'recording.webm'));
}
const marks = JSON.parse(readFileSync(markersFile, 'utf-8')).beats; // [{ id, at }] ms since the recording began

// 3. The edit.
step('Title and end cards');
const browser = await chromium.launch({ channel: 'msedge' });
const page = await browser.newPage({ viewport: { width: W, height: H } });
for (const [name, html] of Object.entries(cards())) {
  await page.setContent(html);
  await page.screenshot({ path: join(out, `${name}.png`) });
}
await browser.close();

step('Edit');
const recorded = marks.map((m) => ({ ...m, s: m.at / 1000 }));
const last = recorded[recorded.length - 1];
const trimStart = Math.max(0, recorded[0].s - LEAD_S);
const mainS = last.s + durations[last.id] + TAIL_S - trimStart;
const endS = END_LEAD_S + durations.end + END_HOLD_S;
const totalS = TITLE_S + mainS + endS;
const voice = [
  ...recorded.map((m) => ({ id: m.id, start: TITLE_S + m.s - trimStart })),
  { id: 'end', start: TITLE_S + mainS + END_LEAD_S },
];
writeFileSync(join(out, 'captions.srt'), captions(voice));

const inputs = ['-loop', '1', '-t', `${TITLE_S}`, '-i', 'title.png', '-ss', `${trimStart}`, '-t', `${mainS}`, '-i', 'recording.webm'];
inputs.push('-loop', '1', '-t', `${endS}`, '-i', 'end.png');
for (const v of voice) inputs.push('-i', join('voice', `${v.id}.wav`));
const fade = 0.4;
const graph = [
  `[0:v]fps=${FPS},format=yuv420p,setsar=1,fade=t=out:st=${TITLE_S - fade}:d=${fade}[v0]`,
  `[1:v]fps=${FPS},scale=${W}:${H},format=yuv420p,setsar=1,fade=t=in:st=0:d=${fade}[v1]`,
  `[2:v]fps=${FPS},format=yuv420p,setsar=1,fade=t=in:st=0:d=${fade}[v2]`,
  `[v0][v1][v2]concat=n=3:v=1:a=0,subtitles=captions.srt:force_style='FontName=Segoe UI,FontSize=15,PrimaryColour=&H00FFFFFF,BorderStyle=3,OutlineColour=&H90000000,Outline=5,Shadow=0,MarginV=22'[v]`,
  ...voice.map((v, i) => `[${i + 3}:a]aresample=48000,adelay=${Math.round(v.start * 1000)}:all=1[a${i}]`),
  `${voice.map((_, i) => `[a${i}]`).join('')}amix=inputs=${voice.length}:normalize=0,apad[a]`,
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
if (final >= MAX_S) {
  console.error(`Too long: ${final.toFixed(1)} s, the limit is ${MAX_S} s.`);
  process.exit(1);
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
  for (const v of voiceTrack) {
    const parts = chunks(script.beats.find((b) => b.id === v.id).text);
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
  return {
    title: `${base}<div class="wrap"><h1>${script.title}</h1><p>${script.subtitle}</p>
      <div class="tags"><span class="tag">Productivity</span><span class="tag">Agentic Interaction</span><span class="tag">Hands-first WebXR</span></div>
      <div class="small">Recorded in Meta's IWER Quest 3 emulator. The AI runs live on Amazon Bedrock.</div></div>`,
    end: `${base}<div class="wrap"><h1>${script.title}</h1><p>Open it on a Quest: no install, no account.</p>
      <div class="url">${url.replace(/^https:\/\//, '')}</div>
      <div class="small">Meta Immersive Web SDK, TypeScript, Kotlin Multiplatform, Spring Boot, Amazon Bedrock (Nova 2 Lite), AWS CDK</div></div>`,
  };
}
