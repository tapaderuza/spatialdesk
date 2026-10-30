// Renders an HTML page that moves in time to a 1080p60 video, one frame after another: the page defines window.render(t)
// (t in seconds), which puts everything where it is at that moment; each frame is drawn, captured as a PNG and piped to
// ffmpeg. Smooth and the same on every run, however fast the machine, where a real-time recording drops frames. Used by
// scripts/capture_mobile_ui.ts (the carer's phone) and scripts/end_card.ts (the pitch's end card).
import { spawn } from 'node:child_process';
import type { Browser } from '@playwright/test';

export const [W, H, FPS] = [1920, 1080, 60];

type Timeline = Window & { render(t: number): void };

export async function renderTimeline(browser: Browser, html: string, seconds: number, out: string): Promise<void> {
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  await page.setContent(html, { waitUntil: 'load' });
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all([...document.images].map((image) => image.decode()));
  });
  // Nearly lossless: the cut encodes it once more.
  const ffmpeg = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'png', '-i', '-',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '10', '-pix_fmt', 'yuv420p', '-r', String(FPS), out], { stdio: ['pipe', 'inherit', 'inherit'] });
  const exited = new Promise<number | null>((resolve) => ffmpeg.on('exit', resolve));
  const frames = Math.round(seconds * FPS);
  for (let i = 0; i < frames; i++) {
    await page.evaluate((t) => (window as unknown as Timeline).render(t), i / FPS);
    const png = await page.screenshot({ type: 'png' });
    if (!ffmpeg.stdin.write(png)) await new Promise((resolve) => ffmpeg.stdin.once('drain', resolve));
  }
  ffmpeg.stdin.end();
  const code = await exited;
  await page.close();
  if (code !== 0) throw new Error(`ffmpeg stopped with ${code} rendering ${out}`);
}

/** Easing for the pages' render(t), as source to inline: 0 to 1 over [from, to] seconds, cubic out or in-out. */
export const EASING = `
  const clamp = (x) => Math.min(1, Math.max(0, x));
  const span = (t, from, to) => clamp((t - from) / (to - from));
  const out = (x) => 1 - Math.pow(1 - x, 3);
  const inOut = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
`;
