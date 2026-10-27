// Three bounded requests against the local server, using synthetic work tasks.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const base = process.env.COMPANION_BASE_URL || 'http://127.0.0.1:8080';
const session = await fetch(`${base}/api/sessions`, { method: 'POST' });
assert.ok(session.ok);
const { sessionId } = await session.json();
const workspace = { nextId: 20, focusBoardId: 'b1', boards: [{ id: 'b1', title: 'Today', pose: { x: 0, y: 1.3, z: -0.62, yaw: 0, pitch: 0 }, columns: [
  { id: 'todo', title: 'To do', cards: [{ id: 'k1', title: 'Check the bill', minutes: 10, priority: 'normal' }] },
  { id: 'doing', title: 'Doing', cards: [{ id: 'k2', title: 'Review the letter', minutes: 30, priority: 'normal' }] },
  { id: 'done', title: 'Done', cards: [{ id: 'k3', title: 'Finished task', priority: 'normal' }] },
] }] };
const results = [];
for (const choice of [{ minutes: 10, energy: 'low' }, { minutes: 10, energy: 'steady' }, { minutes: 2, energy: 'low' }]) {
  const response = await fetch(`${base}/api/agent/plan`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Session': sessionId },
    body: JSON.stringify({ intent: 'session', text: choice.energy === 'low' ? 'Hoy tengo poca energía.' : 'Quiero avanzar un poco.', workspace, sessionChoice: choice }), signal: AbortSignal.timeout(25_000) });
  const plan = await response.json();
  let error;
  try {
    if (choice.minutes < 5) { assert.equal(response.status, 400); assert.equal(plan.ok, false); }
    else {
      assert.ok(response.ok && plan.ok, plan.error);
      assert.match(plan.source, /nova/);
      const timers = plan.steps.filter(s => s.op.op === 'start_timer');
      assert.equal(timers.length, 1);
      assert.ok(timers[0].op.minutes >= 5 && timers[0].op.minutes <= (choice.energy === 'low' ? 5 : 10));
      assert.ok(['Check the bill', 'Review the letter', 'k1', 'k2'].includes(timers[0].op.card));
      assert.match(timers[0].op.label, /^Session: /);
      assert.ok(plan.steps.every(s => ['focus_board', 'move_card', 'start_timer', 'arrange_space'].includes(s.op.op)));
    }
  } catch (e) { error = e.message; }
  results.push({ choice, passed: !error, error, plan });
  console.log(`${error ? 'FAIL' : 'PASS'} ${choice.minutes} min / ${choice.energy}${error ? `: ${error}` : ''}`);
}
await mkdir('.video', { recursive: true });
await writeFile('.video/session-evaluation.json', JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
assert.ok(results.every(r => r.passed), 'Session evaluation has failures.');
