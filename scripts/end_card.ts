// The pitch's end card (scripts/build_pitch_video.py): five seconds rendered frame by frame (scripts/html-timeline.ts).
// The name and its line rise in, an accent draws under them, then the figures one after another: each tile rises out of a
// blur and its number counts up to its value (a word, like "Offline", is wiped in), its edge lighting as it lands; then
// where to try it, and how the video was made. The words and figures are docs/video/pitch-2026.json's, the look the
// cinematic end card's (scripts/make-cinematic-video.mjs).
//   node scripts/end_card.ts      .video/pitch/end-card.mp4
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from '@playwright/test';
import { EASING, renderTimeline } from './html-timeline.ts';

const root = process.cwd();
const script = JSON.parse(readFileSync(join(root, 'docs', 'video', 'pitch-2026.json'), 'utf-8'));
const OUTPUT = join(root, '.video', 'pitch', 'end-card.mp4');
const SECONDS = 5;
const START = 0.35; // the cut crosses into the card over its first half second
const url = (process.env.PUBLIC_URL ?? 'https://d2p3027seoreck.cloudfront.net').replace(/^https:\/\//, '');

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// "24.6 ms" counts up to 24.6 with one decimal and keeps " ms"; a figure without a number is wiped in.
const tiles = (script.metrics as [string, string][]).map(([figure, label]) => {
  const m = /^(\d+(?:\.(\d+))?)(.*)$/.exec(figure);
  return { figure, label, value: m ? Number(m[1]) : null, decimals: m?.[2]?.length ?? 0, suffix: m ? m[3] : '' };
});

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  html, body { margin: 0; width: 1920px; height: 1080px; overflow: hidden; background: #0b0f14; color: #e9eef5;
    font-family: 'Segoe UI Variable Display', 'Segoe UI', system-ui, sans-serif; }
  #bg { position: absolute; inset: -60px; background: radial-gradient(circle at 78% 28%, #1b3a5c 0, #0b0f14 58%); }
  .wrap { position: absolute; inset: 0; display: flex; flex-direction: column; justify-content: center; padding: 0 160px; }
  h1 { font-size: 84px; margin: 0 0 18px; letter-spacing: -2px; font-weight: 700; }
  #accent { height: 4px; width: 112px; border-radius: 2px; background: linear-gradient(90deg, #9cc3ff, #5b9bff); transform-origin: 0 50%; margin: 0 0 26px; }
  p { font-size: 40px; line-height: 1.35; margin: 0; color: #b9c6d6; }
  .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 28px; margin-top: 56px; }
  .tile { position: relative; border: 2px solid #2a4a70; border-radius: 22px; padding: 26px 28px; background: rgba(20, 34, 52, 0.55); overflow: hidden; }
  .tile b { display: block; font-size: 58px; color: #9cc3ff; letter-spacing: -1px; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .tile span { display: block; margin-top: 10px; font-size: 22px; line-height: 1.35; color: #b9c6d6; }
  .sheen { position: absolute; inset: 0; background: linear-gradient(105deg, transparent 30%, rgba(156, 195, 255, 0.16) 50%, transparent 70%);
    background-size: 300% 100%; pointer-events: none; }
  .url { font-size: 34px; color: #9cc3ff; margin-top: 34px; }
  .small { margin-top: 22px; font-size: 26px; color: #8a98ac; max-width: 1400px; line-height: 1.45; }
</style></head><body>
<div id="bg"></div>
<div class="wrap">
  <h1 id="title">${esc(script.title)}</h1>
  <div id="accent"></div>
  <p id="line">${esc(script.end_line)}</p>
  <div class="grid">${tiles.map((t, i) => `<div class="tile" id="tile${i}"><b id="figure${i}">${esc(t.figure)}</b><span>${esc(t.label)}</span><div class="sheen" id="sheen${i}"></div></div>`).join('')}</div>
  <div class="url" id="url">${esc(url)}</div>
  <div class="small" id="small">${esc(script.disclosure)} Meta IWSDK · TypeScript · Kotlin · Spring Boot · AWS.</div>
</div>
<script>${EASING}
const $ = (id) => document.getElementById(id);
const tiles = ${JSON.stringify(tiles)};
const S = ${START};
const rise = (el, t, from, to, by, blur = 0) => {
  const e = out(span(t, from, to));
  el.style.opacity = e;
  el.style.transform = 'translateY(' + (1 - e) * by + 'px)';
  if (blur) el.style.filter = 'blur(' + (1 - e) * blur + 'px)';
};
window.render = (t) => {
  $('bg').style.transform = 'translate(' + -40 * inOut(span(t, 0, ${SECONDS})) + 'px, ' + 18 * inOut(span(t, 0, ${SECONDS})) + 'px)';
  rise($('title'), t, S, S + 0.7, 28);
  $('accent').style.transform = 'scaleX(' + out(span(t, S + 0.35, S + 1.0)) + ')';
  rise($('line'), t, S + 0.2, S + 0.9, 22);
  tiles.forEach((tile, i) => {
    const from = S + 0.9 + 0.3 * i;
    const el = $('tile' + i);
    rise(el, t, from, from + 0.65, 36, 10);
    el.style.transform += ' scale(' + (0.96 + 0.04 * out(span(t, from, from + 0.65))) + ')';
    const figure = $('figure' + i);
    const count = out(span(t, from + 0.05, from + 1.05));
    if (tile.value === null) figure.style.clipPath = 'inset(0 ' + (1 - count) * 100 + '% 0 0)';
    else figure.textContent = (tile.value * count).toFixed(tile.decimals) + tile.suffix;
    // Its edge lights as the number lands, and a sheen crosses it.
    const land = span(t, from + 0.85, from + 1.15) * (1 - span(t, from + 1.15, from + 1.9));
    el.style.borderColor = 'rgb(' + [42 + 49 * land, 74 + 81 * land, 112 + 143 * land].map(Math.round).join(',') + ')';
    el.style.boxShadow = '0 0 ' + 28 * land + 'px rgba(91, 155, 255, ' + 0.35 * land + ')';
    $('sheen' + i).style.backgroundPosition = 120 - 140 * inOut(span(t, from + 0.6, from + 1.5)) + '% 0';
  });
  rise($('url'), t, S + 2.3, S + 2.9, 18);
  rise($('small'), t, S + 2.55, S + 3.2, 14);
};
</script></body></html>`;

mkdirSync(join(root, '.video', 'pitch'), { recursive: true });
const browser = await chromium.launch({ channel: 'msedge' });
try {
  await renderTimeline(browser, html, SECONDS, OUTPUT);
  console.log(`${OUTPUT}: ${SECONDS} s, the figures one after another`);
} finally {
  await browser.close();
}
