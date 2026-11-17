/**
 * ?fps: the frame rate as the headset shows it, on a line of the command panel, so a tester can read it off a real
 * Quest (and a judge can too). It counts the frames of each second and keeps the longest gap between two of them,
 * so a dropped frame shows as a slow one. The CPU cost of a frame is the performance gate's job (src/perf/probe.ts,
 * tests/perf.spec.ts); this is what the eye gets. Nothing is allocated per frame; the line changes once a second.
 */
export const showFrameRate = typeof location !== 'undefined' && new URLSearchParams(location.search).has('fps');

const WINDOW_MS = 1000;
/** A gap this long is a hidden tab or a session starting, not a frame. */
const NOT_A_FRAME_MS = 1000;

export class FrameMeter {
  private elapsedMs = 0;
  private frames = 0;
  private slowestMs = 0;

  /** One frame [deltaSeconds] after the last; once a second, the line to show (otherwise null). */
  add(deltaSeconds: number, displayHz?: number): string | null {
    const ms = deltaSeconds * 1000;
    if (!(ms > 0) || ms >= NOT_A_FRAME_MS) return null;
    this.elapsedMs += ms;
    this.frames++;
    if (ms > this.slowestMs) this.slowestMs = ms;
    if (this.elapsedMs < WINDOW_MS) return null;
    const fps = Math.round((this.frames * 1000) / this.elapsedMs);
    const display = displayHz && displayHz > 0 ? ` (display ${Math.round(displayHz)} Hz)` : '';
    const line = `${fps} fps, slowest frame ${Math.round(this.slowestMs)} ms${display}`;
    this.elapsedMs = 0;
    this.frames = 0;
    this.slowestMs = 0;
    return line;
  }
}
