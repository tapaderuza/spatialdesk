/**
 * Every text on every panel against the background it sits on, in the normal theme and in high contrast: at least 7:1,
 * WCAG 1.4.6 Contrast (Enhanced), level AAA. The panels' own stylesheets (public/ui/*.uikitml) are read as UIKit applies
 * them: class rules, then :dark rules (high contrast) over them, then inline styles; a text takes the nearest background
 * above it. The colours the command panel paints at runtime (src/panel.ts) are checked on the notice line and the
 * primary buttons they appear on.
 *
 * Left out, because the app replaces it before the first frame: the seven-day strip's "-" (src/panel.ts progressPainter
 * writes " " on an empty day, and "+" in #15181e on the focused green, 10.7:1).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';

const AAA = 7;
const UI = 'public/ui';

function luminance(hex: string): number {
  const h = hex.slice(1);
  const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h.slice(0, 6);
  const channel = (i: number) => {
    const c = parseInt(full.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
}

function ratio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const colour = (body: string, property: string) => body.match(new RegExp(`(?:^|[^-a-z])${property}:\\s*(#[0-9a-fA-F]{3,8})`))?.[1];

interface Measured { file: string; id: string; text: string; theme: 'normal' | 'high contrast'; pair: string; ratio: number }

/** Each text node of one panel, with the colour it is drawn in and the background behind it. */
function measure(file: string, dark: boolean): Measured[] {
  const source = readFileSync(`${UI}/${file}`, 'utf8');
  const css = source.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? '';
  const rules = [...css.matchAll(/\.([\w-]+)(:dark)?\s*\{([^}]*)\}/g)].map((m) => ({ cls: m[1], dark: !!m[2], body: m[3] }));
  const html = source.replace(/<style>[\s\S]*?<\/style>/, '').replace(/<!--[\s\S]*?-->/g, '');
  const style = (classes: string[], inline: string) => {
    const out: { color?: string; bg?: string } = {};
    for (const pass of dark ? [false, true] : [false]) {
      for (const c of classes) {
        for (const r of rules) {
          if (r.cls !== c || r.dark !== pass) continue;
          out.color = colour(r.body, 'color') ?? out.color;
          out.bg = colour(r.body, 'background-color') ?? out.bg;
        }
      }
    }
    out.color = colour(inline, 'color') ?? out.color;
    out.bg = colour(inline, 'background-color') ?? out.bg;
    return out;
  };
  const stack: { color: string; bg?: string; id: string }[] = [{ color: '#000000', id: 'root' }];
  const found: Measured[] = [];
  for (const m of html.matchAll(/<(\/?)([a-zA-Z]+)([^>]*)>|([^<]+)/g)) {
    if (m[4] !== undefined) {
      const text = m[4].trim();
      if (!text) continue;
      const top = stack[stack.length - 1];
      const bg = [...stack].reverse().find((s) => s.bg)?.bg;
      if (!bg || /^day-\d-mark$/.test(top.id)) continue;
      found.push({ file, id: top.id, text: text.slice(0, 24), theme: dark ? 'high contrast' : 'normal', pair: `${top.color} on ${bg}`, ratio: ratio(top.color, bg) });
      continue;
    }
    if (m[1]) {
      stack.pop();
      continue;
    }
    const attrs = m[3];
    if (/\/\s*$/.test(attrs)) continue;
    const classes = (attrs.match(/class="([^"]*)"/)?.[1] ?? '').split(/\s+/).filter(Boolean);
    const s = style(classes, attrs.match(/style="([^"]*)"/)?.[1] ?? '');
    const parent = stack[stack.length - 1];
    stack.push({ color: s.color ?? parent.color, bg: s.bg, id: attrs.match(/id="([^"]*)"/)?.[1] ?? classes.join('.') });
  }
  return found;
}

test('every panel text is at least 7:1 against its background, in the normal theme and in high contrast', () => {
  const files = readdirSync(UI).filter((f) => f.endsWith('.uikitml'));
  const all = files.flatMap((f) => [...measure(f, false), ...measure(f, true)]);
  expect(all.length, 'texts found in the panels').toBeGreaterThan(200);
  const low = all.filter((m) => m.ratio < AAA).map((m) => `${m.ratio.toFixed(2)}  ${m.file} #${m.id} "${m.text}" (${m.theme}: ${m.pair})`);
  expect(low, 'panel texts under 7:1').toEqual([]);
});

test('the colours the command panel paints at runtime are at least 7:1 where they appear', () => {
  const panel = readFileSync('src/panel.ts', 'utf8');
  const constant = (name: string, key: string) => {
    const value = panel.match(new RegExp(`const ${name} = \\{[^}]*\\b${key}: '(#[0-9a-fA-F]{6})'`))?.[1];
    expect(value, `${name}.${key} in src/panel.ts`).toBeTruthy();
    return value!;
  };
  const command = readFileSync(`${UI}/command.uikitml`, 'utf8');
  const noticeNormal = colour(command.match(/\.notice\s*\{([^}]*)\}/)![1], 'background-color')!;
  const noticeDark = colour(command.match(/\.notice:dark\s*\{([^}]*)\}/)![1], 'background-color')!;
  const label = colour(command.match(/\.label\s*\{([^}]*)\}/)![1], 'color')!;
  const labelDark = colour(command.match(/\.label:dark\s*\{([^}]*)\}/)![1], 'color')!;
  const pairs: [string, string, string][] = [];
  for (const key of ['normal', 'dim', 'error']) {
    pairs.push([`notice text ${key}`, constant('TEXT', key), noticeNormal], [`notice text ${key}, high contrast`, constant('TEXT', key), noticeDark]);
  }
  pairs.push(['nudge', constant('NOTICE', 'nudge'), noticeNormal], ['nudge, high contrast', constant('NOTICE', 'nudge'), noticeDark]);
  pairs.push(['label on a primary button', label, constant('BUTTON', 'primary')], ['label on a primary button, high contrast', labelDark, constant('BUTTON', 'primary')]);
  const low = pairs.filter(([, fg, bg]) => ratio(fg, bg) < AAA).map(([what, fg, bg]) => `${what}: ${fg} on ${bg} = ${ratio(fg, bg).toFixed(2)}`);
  expect(low).toEqual([]);
});
