// The carer's phone in the pitch cut (scripts/build_pitch_video.py), captured digitally instead of filmed. The production
// build is served here with /api going to the deployed helper service, as in the take (scripts/make-cinematic-video.mjs).
// A headset in Meta's IWER emulator (headless Edge) gets the pitch's workspace with "Llamar a Rocío..." moved to Hecho, as
// at the end of the take, says "invita a un ayudante" and allows the carer; the companion page, in an iPhone 13 viewport
// (390x844 points at 3x, dark), types the code, follows the board and taps Help / Recalibrate. Its states before and after
// the tap are captured as full-page PNGs; then the shot is rendered frame by frame (scripts/html-timeline.ts): the phone,
// in a device frame, settles, scrolls from the board to the button, a touch presses it, the key gives way, "Sent" appears.
//   node scripts/capture_mobile_ui.ts           capture, then the shot (SKIP_BUILD=1: serve the build already in dist/)
//   node scripts/capture_mobile_ui.ts --shot    the shot again from the last capture
// Output in .video/pitch/phone/: board.png, sent.png, phone.json (where the button is, when it is tapped), phone.mp4.
import { execSync, spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, devices, type Browser } from '@playwright/test';
import { EASING, renderTimeline } from './html-timeline.ts';

const root = process.cwd();
const out = join(root, '.video', 'pitch', 'phone');
const script = JSON.parse(readFileSync(join(root, 'docs', 'video', 'pitch-2026.json'), 'utf-8'));
const api = process.env.E2E_URL ?? 'https://d2p3027seoreck.cloudfront.net';
const PORT = 4173;
const local = `http://localhost:${PORT}`;
const GPU = ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11', '--enable-unsafe-swiftshader'];
const SCREEN = { width: 390, height: 844 }; // iPhone 13, in points
const STATUS_BAR = 47; // the notch's band, above the page
const HOME_BAR = 34; // the home indicator's, at the bottom
const SECONDS = 5; // the shot
const SCROLL = [0.95, 2.0]; // from the board down to the button
const TAP_AT = 2.35; // the finger on the key, as the narration says "Help, recalibrate"
const RELEASE_AT = TAP_AT + 0.16;

type Win = Window & Record<string, any>;
interface Box { x: number; y: number; width: number; height: number }
interface Capture { screen: typeof SCREEN; scale: number; page: { height: number }; button: Box; status: Box; seconds?: number; tapAt?: number }

const step = (m: string) => console.log(`\n==> ${m}`);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const beat = (id: string) => script.beats.find((b: { id: string }) => b.id === id);

async function capture(browser: Browser): Promise<Capture> {
  if (!process.env.SKIP_BUILD) {
    step('Production build');
    execSync('npm run build', { cwd: root, stdio: 'inherit' });
  }
  step(`Serving it on :${PORT}, /api to ${api}`);
  const preview = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort'],
    { cwd: root, env: { ...process.env, SPATIALDESK_API: api }, stdio: 'ignore' });
  try {
    let up = false;
    for (let i = 0; i < 120 && !up; i++) {
      up = await fetch(local).then((r) => r.ok, () => false);
      if (!up) await sleep(500);
    }
    if (!up) throw new Error(`The preview never answered on ${local}`);

    step('The headset: the pitch workspace, the card in Hecho, a helper invited');
    const owner = await browser.newContext({ baseURL: local, viewport: { width: 1280, height: 960 } });
    await owner.addInitScript(() => {
      localStorage.setItem('spatialdesk.onboarded', '1'); // no first-run coach
      localStorage.setItem('spatialdesk.calibrated', '1'); // nor the guided setup
    });
    const headset = await owner.newPage();
    await headset.goto('/?emulate&fast&lang=es-ES');
    await headset.waitForFunction(() => (window as Win).__world && (window as Win).__xrDevice, null, { timeout: 60_000 });
    await headset.evaluate(() => (window as Win).__world.launchXR());
    await headset.waitForFunction(() => (window as Win).__world.visibilityState.value === 'visible' && (window as Win).__workspace?.state?.boards?.length > 0,
      null, { timeout: 30_000 });
    // The take's card (the one her head rested on) moved to the last column, as she did with "Mueve esto a hecho".
    const moved: string = await headset.evaluate(({ ops, target }) => {
      const ws = (window as Win).__workspace;
      ws.dispatch(ops);
      const board = ws.state.boards.find((b: { title: string }) => b.title === target.board);
      const card = board.columns[target.column].cards[target.card];
      ws.dispatch({ op: 'move_card', board: board.id, card: card.id, column: board.columns[board.columns.length - 1].id });
      return card.title;
    }, { ops: script.seed, target: beat('gaze').target });
    await headset.evaluate((said) => (window as Win).__voice.say(said), beat('invite').command);
    await headset.waitForFunction(() => (window as Win).__helper?.view.stage === 'inviting' && (window as Win).__helper.state.code, null, { timeout: 15_000 });
    const code: string = await headset.evaluate(() => (window as Win).__helper.state.code);

    step(`The carer's phone (iPhone 13): the code ${code}, Allow, the board`);
    const carer = await browser.newContext({ ...devices['iPhone 13'], viewport: { width: SCREEN.width, height: SCREEN.height - STATUS_BAR },
      deviceScaleFactor: 3, colorScheme: 'dark', baseURL: local });
    const phone = await carer.newPage();
    await phone.goto('/companion.html');
    await phone.locator('#code').fill(code);
    await phone.locator('#connect').tap();
    await headset.waitForFunction(() => (window as Win).__helper.view.stage === 'asking', null, { timeout: 15_000 });
    await headset.evaluate(() => (window as Win).__helper.choose('a')); // Allow, as her pointer, gaze or switch would
    await phone.locator('#board li', { hasText: moved }).waitFor({ timeout: 15_000 });
    await phone.locator('#updated', { hasText: 'just now' }).waitFor({ timeout: 6000 });
    const box = (selector: string) => phone.locator(selector).evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { x: r.x + scrollX, y: r.y + scrollY, width: r.width, height: r.height };
    });
    const result: Capture = { screen: SCREEN, scale: 3, page: { height: await phone.evaluate(() => document.documentElement.scrollHeight) },
      button: await box('#help'), status: await box('#help-status') };
    writeFileSync(join(out, 'board.png'), await phone.screenshot({ fullPage: true }));

    step('Help / Recalibrate');
    await phone.locator('#help').tap();
    await phone.locator('#help-status', { hasText: 'Sent' }).waitFor({ timeout: 8000 });
    writeFileSync(join(out, 'sent.png'), await phone.screenshot({ fullPage: true }));
    const opened = await headset.waitForFunction(() => (window as Win).__setup?.view.stage === 'where', null, { timeout: 15_000 }).then(() => true, () => false);
    console.log(opened ? 'The headset opened the guided setup.' : 'The headset did not open the setup within 15 s (the shot only needs the phone).');
    await carer.close();
    await owner.close();
    return result;
  } finally {
    preview.kill();
  }
}

/** The shot: the phone in a device frame on the cut's dark blue, its page scrolled and tapped by render(t). */
function shot(c: Capture, board: string, sent: string): string {
  const k = 1.06; // pixels of the 1080p frame per point
  const p = (v: number) => `${(v * k).toFixed(2)}px`;
  const bezel = 12;
  const corner = 47.33; // the screen's
  const view = SCREEN.height - STATUS_BAR;
  // Down far enough that the button and the line under it clear the home indicator.
  const scroll = Math.max(0, Math.min(c.page.height - view, c.status.y + c.status.height + HOME_BAR + 14 - view));
  const tap = { x: c.button.x + c.button.width * 0.6, y: c.button.y + c.button.height * 0.56 };
  const device = { width: (SCREEN.width + 2 * bezel) * k, height: (SCREEN.height + 2 * bezel) * k };
  const b = c.button;
  // Where the camera closes in as the key is pressed: between the button and the line that answers under it.
  const focusY = (1080 - device.height) / 2 + (bezel + STATUS_BAR + b.y + b.height * 0.75 - scroll) * k;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  html, body { margin: 0; width: 1920px; height: 1080px; overflow: hidden; background: #0b0f14; }
  #bg { position: absolute; inset: 0; background: radial-gradient(ellipse at 50% 40%, #1d3b5e 0, #0f1a29 42%, #0b0f14 74%); }
  #glow { position: absolute; left: ${960 - 520}px; top: ${(1080 - device.height) / 2 + (STATUS_BAR + b.y - scroll + b.height / 2) * k - 520}px; width: 1040px; height: 1040px;
    border-radius: 50%; background: radial-gradient(circle, rgba(255, 176, 32, 0.2) 0, rgba(255, 176, 32, 0.06) 34%, rgba(255, 176, 32, 0) 62%); }
  #stage { position: absolute; inset: 0; perspective: 2400px; transform-origin: 50% ${focusY.toFixed(1)}px; }
  #rig { position: absolute; left: ${(1920 - device.width) / 2}px; top: ${(1080 - device.height) / 2}px; width: ${device.width}px; height: ${device.height}px;
    transform-style: preserve-3d; }
  .key { position: absolute; width: ${p(3.4)}; border-radius: ${p(1.6)}; background: linear-gradient(90deg, #2b2e33, #61666d 50%, #2b2e33); }
  .left { left: ${p(-2.4)}; } .right { right: ${p(-2.4)}; }
  #device { position: absolute; inset: 0; border-radius: ${p(corner + bezel)};
    background: linear-gradient(145deg, #6a6f77 0%, #2a2c31 22%, #4a4e55 48%, #1f2125 74%, #5d6168 100%);
    box-shadow: 0 60px 120px rgba(0, 0, 0, 0.62), 0 18px 44px rgba(0, 0, 0, 0.45); }
  #bezel { position: absolute; inset: ${p(2.4)}; border-radius: ${p(corner + bezel - 2.4)}; background: #050506; }
  #screen { position: absolute; left: ${p(bezel)}; top: ${p(bezel)}; width: ${p(SCREEN.width)}; height: ${p(SCREEN.height)}; border-radius: ${p(corner)};
    overflow: hidden; background: #12151b; }
  #page { position: absolute; left: 0; top: ${p(STATUS_BAR)}; width: ${p(SCREEN.width)}; will-change: transform; }
  #page img { position: absolute; left: 0; top: 0; width: 100%; }
  #hole, #press { position: absolute; left: ${p(b.x)}; top: ${p(b.y)}; width: ${p(b.width)}; height: ${p(b.height)}; border-radius: ${p(25.2)}; opacity: 0; }
  #hole { background: #12151b; }
  #press { background: url(${board}) no-repeat; background-size: ${p(SCREEN.width)} auto; background-position: ${p(-b.x)} ${p(-b.y)}; }
  #touch, #ripple { position: absolute; left: ${p(tap.x - 32)}; top: ${p(tap.y - 32)}; width: ${p(64)}; height: ${p(64)}; border-radius: 50%; opacity: 0;
    box-sizing: border-box; }
  /* Seen on the amber key too: a bright ring with a soft dark edge and shadow under it. */
  #touch { border: ${p(2.2)} solid rgba(255, 255, 255, 0.95); box-shadow: 0 0 0 ${p(1)} rgba(0, 0, 0, 0.22), 0 ${p(4)} ${p(16)} rgba(0, 0, 0, 0.35); }
  #ripple { border: ${p(2.6)} solid rgba(255, 255, 255, 0.92); box-shadow: 0 0 0 ${p(1)} rgba(0, 0, 0, 0.15); }
  #bar { position: absolute; left: 0; top: 0; width: 100%; height: ${p(STATUS_BAR)}; background: #12151b; }
  #time { position: absolute; left: 0; top: ${p(13)}; width: ${p(116)}; text-align: center; color: #fff;
    font: 600 ${p(17)}/1 'Segoe UI Variable Display', 'Segoe UI', system-ui, sans-serif; letter-spacing: ${p(-0.2)}; }
  #icons { position: absolute; right: ${p(24)}; top: ${p(17)}; width: ${p(72)}; height: ${p(12)}; }
  #notch { position: absolute; left: 50%; top: 0; width: ${p(160)}; height: ${p(31)}; margin-left: ${p(-80)}; background: #050506;
    border-radius: 0 0 ${p(20)} ${p(20)}; }
  #home { position: absolute; left: 50%; bottom: ${p(8)}; width: ${p(134)}; height: ${p(5)}; margin-left: ${p(-67)}; border-radius: ${p(3)};
    background: rgba(255, 255, 255, 0.88); }
  #glass { position: absolute; inset: 0; background: linear-gradient(115deg, transparent 38%, rgba(255, 255, 255, 0.07) 48%, rgba(255, 255, 255, 0.02) 54%, transparent 62%);
    background-size: 260% 100%; }
  </style></head><body>
  <div id="bg"></div><div id="glow"></div>
  <div id="stage"><div id="rig">
    <div class="key left" style="top: ${p(118)}; height: ${p(30)}"></div>
    <div class="key left" style="top: ${p(178)}; height: ${p(62)}"></div>
    <div class="key left" style="top: ${p(254)}; height: ${p(62)}"></div>
    <div class="key right" style="top: ${p(212)}; height: ${p(96)}"></div>
    <div id="device"><div id="bezel"></div>
      <div id="screen">
        <div id="page" style="height: ${p(c.page.height)}">
          <img id="board" src="${board}"><img id="sent" src="${sent}" style="opacity: 0">
          <div id="hole"></div><div id="press"></div><div id="touch"></div><div id="ripple"></div>
        </div>
        <div id="bar"><div id="time">9:41</div>
          <svg id="icons" viewBox="0 0 72 12" fill="#fff">
            <rect x="0" y="8" width="3" height="4" rx="0.8"/><rect x="5" y="5.5" width="3" height="6.5" rx="0.8"/>
            <rect x="10" y="3" width="3" height="9" rx="0.8"/><rect x="15" y="0.5" width="3" height="11.5" rx="0.8"/>
            <path d="M24.5 4.2a10.5 10.5 0 0 1 14.5 0" stroke="#fff" stroke-width="1.9" fill="none" stroke-linecap="round"/>
            <path d="M27.3 7.1a6.4 6.4 0 0 1 8.9 0" stroke="#fff" stroke-width="1.9" fill="none" stroke-linecap="round"/>
            <circle cx="31.75" cy="10.2" r="1.6"/>
            <rect x="45" y="0.5" width="23.5" height="11" rx="3.4" fill="none" stroke="rgba(255,255,255,0.45)" stroke-width="1"/>
            <rect x="47" y="2.5" width="19.5" height="7" rx="1.8"/><rect x="69.6" y="4" width="1.6" height="4" rx="0.8" fill="rgba(255,255,255,0.45)"/>
          </svg></div>
        <div id="notch"></div><div id="home"></div><div id="glass"></div>
      </div>
    </div>
  </div></div>
  <script>${EASING}
  const $ = (id) => document.getElementById(id);
  const [stage, rig, page, sentImage, hole, press, touch, ripple, glow, glass] = ['stage', 'rig', 'page', 'sent', 'hole', 'press', 'touch', 'ripple', 'glow', 'glass'].map($);
  const TAP = ${TAP_AT}, RELEASE = ${RELEASE_AT};
  window.render = (t) => {
    const settle = out(span(t, 0, 1.25));
    rig.style.transform = 'translateY(' + (1 - settle) * 46 + 'px) rotateX(' + (1 - settle) * 7 + 'deg) rotateY(' + (1 - settle) * -18 + 'deg) scale(' + (0.92 + 0.08 * settle) + ')';
    stage.style.transform = 'scale(' + (1 + 0.035 * inOut(span(t, 0, 1.9)) + 0.15 * inOut(span(t, 1.75, 3.3))) + ')';
    glass.style.backgroundPosition = 130 - 160 * inOut(span(t, 0.1, 1.7)) + '% 0';
    page.style.transform = 'translateY(' + -inOut(span(t, ${SCROLL[0]}, ${SCROLL[1]})) * ${(scroll * k).toFixed(2)} + 'px)';
    // The finger: it comes near, presses, lifts; a ripple where it was.
    const near = out(span(t, TAP - 0.42, TAP - 0.04));
    const down = span(t, TAP, TAP + 0.08) - span(t, RELEASE, RELEASE + 0.1);
    const gone = span(t, RELEASE + 0.05, RELEASE + 0.4);
    touch.style.opacity = near * (1 - gone);
    touch.style.transform = 'scale(' + (1.4 - 0.4 * near) * (1 - 0.16 * down) + ')';
    touch.style.background = 'rgba(255, 255, 255, ' + (0.34 + 0.2 * down) + ')';
    const wave = span(t, RELEASE, RELEASE + 0.6);
    ripple.style.opacity = wave > 0 && wave < 1 ? 0.75 * (1 - out(wave)) : 0;
    ripple.style.transform = 'scale(' + (1 + 1.6 * out(wave)) + ')';
    // The key gives way under it (the page's own :active), then the page answers: "Sent. Waiting for their headset...".
    const pressed = t < TAP ? 0 : 1 - span(t, RELEASE, RELEASE + 0.18);
    hole.style.opacity = press.style.opacity = pressed;
    press.style.transform = 'scale(' + (1 - 0.025 * down) + ')';
    press.style.filter = 'brightness(' + (1 - 0.08 * down) + ')';
    sentImage.style.opacity = span(t, RELEASE, RELEASE + 0.18);
    glow.style.opacity = 0.25 + 0.75 * out(span(t, RELEASE - 0.05, RELEASE + 0.25)) * (1 - 0.6 * span(t, RELEASE + 0.3, RELEASE + 1.6));
  };
  </script></body></html>`;
}

mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', args: GPU });
try {
  const json = join(out, 'phone.json');
  const c: Capture = process.argv.includes('--shot') ? JSON.parse(readFileSync(json, 'utf-8')) : await capture(browser);
  writeFileSync(json, JSON.stringify(c, null, 2)); // kept even if the shot fails: --shot starts from it
  step('The shot, frame by frame');
  const png = (name: string) => `data:image/png;base64,${readFileSync(join(out, name)).toString('base64')}`;
  await renderTimeline(browser, shot(c, png('board.png'), png('sent.png')), SECONDS, join(out, 'phone.mp4'));
  writeFileSync(json, JSON.stringify({ ...c, seconds: SECONDS, tapAt: TAP_AT }, null, 2));
  console.log(`${join(out, 'phone.mp4')}: ${SECONDS} s, the key tapped at ${TAP_AT} s`);
} finally {
  await browser.close();
}
