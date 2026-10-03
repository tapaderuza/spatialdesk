// Bundle-size gate (ROADMAP heuristic A): initial JS the headset downloads, gzipped, <= 2.5 MB.
// The emulator chunk is excluded: it is only fetched with ?emulate (tests, demo recording).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const BUDGET = 2.5 * 1024 * 1024;
const dir = 'dist/assets';
let total = 0;
const rows = [];
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.js') || f.startsWith('emulator-')) continue;
  const gz = gzipSync(readFileSync(join(dir, f))).length;
  total += gz;
  rows.push([f, statSync(join(dir, f)).size, gz]);
}
rows.sort((a, b) => b[2] - a[2]).forEach(([f, raw, gz]) => console.log(`${(gz / 1024).toFixed(0).padStart(7)} KB gz  ${(raw / 1024).toFixed(0).padStart(7)} KB  ${f}`));
console.log(`total ${(total / 1048576).toFixed(2)} MB gz (budget ${(BUDGET / 1048576).toFixed(1)} MB)`);
if (total > BUDGET) { console.error('BUNDLE SIZE BUDGET EXCEEDED'); process.exit(1); }
