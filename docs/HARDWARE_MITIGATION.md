# Hardware risk mitigation

**SpatialDesk has not run on a physical headset.** This document deals with that directly. It takes each way a real Meta Quest
3 could differ from the emulator, shows what in the architecture limits the damage, gives the evidence, and names what only a
headset can settle. It does not claim that the app reaches 60 fps on a Quest 3. It claims something narrower that can be checked:
**the architecture makes each hardware risk small, separate and survivable, and no single one of them can stop the workspace
from working.**

All tests run Meta's IWER emulator (Quest 3 profile) on the production build. Commands to repeat them are in the
[judge's guide](JUDGE_GUIDE.md#5-repeat-our-checks).

| Risk on a real headset | What limits it | Evidence | Only a headset can show |
| --- | --- | --- | --- |
| A WebXR capability is missing or refused | Nothing is required; each feature has its own fallback | `tests/edge-cases.spec.ts`, `tests/failure-modes.spec.ts` | Quest Browser's prompts and grants |
| CPU cost per frame | Budgets enforced on every push, measured at the heaviest workspace | `tests/perf.spec.ts` | Real frame time and thermals |
| GPU cost per frame | Draw-call and triangle budgets only | `tests/perf.spec.ts` | **Everything else: not measured** |
| Hand-tracking noise | Noise-tolerant targets; optional steady aim | `tests/interaction.spec.ts`, `tests/tremor.spec.ts` | The real tracker's noise |
| Network degrades or disappears | Local-first workspace; a 10 s ceiling on every wait | `tests/resilience.spec.ts`, `tests/edge-cases.spec.ts`, production probes | The Quest's own Wi-Fi behaviour |

## 1. API tolerance: `requiredFeatures` is empty

Under the WebXR Device API, a session request fails outright if a *required* feature is unavailable, whereas an unavailable
*optional* feature is simply not granted. SpatialDesk requires nothing, so **the only outcome of a missing capability is the loss
of the feature that uses it.**

`launchVR` and `launchRoom` (`src/room/room-system.ts`) and `iwsdk.config.json` set each feature to `true`, which IWSDK requests
as optional. This is checked, not assumed: the first test in `tests/edge-cases.spec.ts` wraps `navigator.xr.requestSession`, records
every request, asserts that `requiredFeatures` is empty in both modes, withholds all eleven capabilities, and then operates the app.

| If this is not granted | The code path | What the person gets |
| --- | --- | --- |
| Hand tracking | Input falls back to controllers | Every control works with the trigger |
| Plane detection | `fitToRoom` returns no poses | *"I can't see your desk or walls yet..."*; nothing moves |
| Anchors | `frame?.createAnchor` is guarded; its promise is caught | The fit holds for the session, without being remembered |
| Persistent handles | `requestPersistentHandle` is checked before use | Same: no memory across visits |
| Restoring an anchor | `restorePersistentAnchor` rejection is caught | *"I could not find your room layout here..."*; nothing is applied |
| Keeping another anchor (Meta's guide: 8 for a site) | Each fit deletes the earlier ones first, and a ninth is never asked for | Never reached in 12 fits under a simulated limit. If refused: *"Fitted for this visit..."*, and nothing is saved under a handle it does not belong to |
| Eye tracking | Hands-free aims with the head | Dwell still works |
| The whole session (`NotAllowedError`) | The page stays in 2D | Workspace unchanged; the next try enters |
| Microphone | The refusal returns before any network call | A plain line; the server is never asked |
| All browser storage | Writes are caught; IndexedDB gives up after 2 s | The visit works; only the memory is lost |

**What remains open.** Grants and prompts are Quest Browser's own. Meta's documentation shows plane detection requested as a
required feature, while ours asks for it as optional, and that has not been tried on a device. On a headset with no Space Setup,
Fit room calls `initiateRoomCapture`, as that guide recommends: once a session, after the 3 seconds it says to wait. IWER lacks the
call, so a test stands in for it, and what the headset's own scan does has not been seen.

## 2. Frame budget: 22.2 ms against Meta's own starter scene

The reference is deliberately not a number we chose. It is **Meta's IWSDK starter scene, published as Quest-ready, measured
under identical conditions**: production build, IWER, the same machine, the CPU slowed 3x.

| Measure (CPU) | SpatialDesk, 2026-11-04 | SpatialDesk, 2026-11-05 | Meta's starter scene | Budget |
| --- | --- | --- | --- | --- |
| Whole frame, median | 13.1 ms | 11.8 ms | 18.8 ms | |
| Whole frame, 95th percentile | **22.2 ms** | **19.5 ms** | 29.4 ms | 29.4 ms |
| The app's own systems, 95th percentile | 2.2 ms | 2.1 ms | not measured | 3.0 ms |
| Allocation per frame | not recorded | 221 bytes | not measured | 4,096 bytes |
| Draw calls | 78 | 78 | 72 | 80 |
| Triangles | 31,568 | 31,568 | 81,688 | 120,000 |
| JS heap | 103 MB | 103 MB | not measured | 150 MB |

**Why this is strong evidence for the CPU.**

- **It is measured at the worst case.** The gate fills the heaviest workspace the engine allows and turns hands-free on, so the gaze
  ray is tested against every panel each frame (`tests/perf.spec.ts`, `tests/workload.ts`). The starter scene is measured as it ships.
- **The app itself is nearly free.** Our systems take about 2 ms at the 95th percentile. The rest of the frame is the framework and the
  renderer, which any IWSDK app pays. The per-frame paths are written not to allocate, and a sampling heap profiler holds them to the budget.
- **The geometry is light.** 39% of the starter's triangles.
- **It cannot regress quietly.** Exceeding any budget fails `npm run ci`, which a pre-push hook runs before every push.
- **A stall is not paid as a jump.** The glide's step is capped at 50 ms. With the main thread frozen for half a second in the middle of
  a glide, the largest single-frame move was 3.75 cm of a 27.2 cm travel (`tests/failure-modes.spec.ts`).

**How to read it honestly.**

- **These are not frame rates on a Quest.** A 60 fps frame has 16.7 ms, and these figures are deliberately pessimistic, with the CPU
  slowed 3x. They neither predict 45 fps nor prove 60.
- **It varies.** The same code has measured 19.5 to 33.1 ms across runs on a shared laptop, so some runs miss the 29.4 ms budget, and
  the gate retries before failing. Our video quotes 24.6 ms, from an earlier run; the submission text quotes the 22.2 ms above.
- **One measure is worse than the starter:** 78 draw calls against 72.
- **The thermal margin is an assumption, not a measurement.** `perf-budgets.json` records the reasoning: the development CPU and the
  Quest 3's Snapdragon XR2 Gen 2 score alike on single-core benchmarks, and the 3x slowdown is there to cover sustained throttling and
  browser overhead. No thermal measurement of any kind has been made.
- **GPU time is not included.** IWER does not model it. Fill rate, translucent panels stacked in depth, passthrough compositing and
  text rendering at headset resolution are the likeliest places for a surprise, and none has been measured.

**Memory.** A long sitting leaves nothing behind: after 160 card and comfort changes the scene held the same 553 objects and the JS heap
had grown about 1 MB. Removing a panel now frees it. Over 85 rounds of each kind the JS heap grew about 0.02 MB per board or timer and was
levelling off, geometries and textures did not change, and the WebAssembly memory stayed at 16 MB over 160 panels. Before the fix of
2026-11-05 a board kept 3.3 MB and a timer 0.4 MB and a geometry, without limit; the cause is in the
[engineering audit](ENGINEERING_AUDIT.md). These are desktop Chromium figures in the emulator. Quest Browser's own memory has not been measured.

## 3. Hand jitter: steady aim

Real hand tracking is noisier than a controller, and the pinch itself jolts the ray. There are two layers against that.

**For everyone.** Every interactive target is at least 6 x 6 cm in the world (`tests/interaction.spec.ts`), and taps are tested under
synthetic tracking noise of ±1 cm at the origin in a 3° cone. Direct touch presses on contact, once, however slowly the finger arrives,
and hands-free dwell needs no pinch at all.

**Steady aim, for hands that shake.** It is optional: offered in the guided setup, or by `?steady` or voice. Instead of pressing what is
under the ray at the instant of the pinch, it presses the control that held the largest share of the preceding 450 ms of aim, with at
least 40% of it, and a press between controls snaps to the nearest within 1.5 cm (`src/ui/aim.ts`). It uses fixed-size ring buffers
and allocates nothing per sample or per press.

Measured on the command panel's real button grid, with 3,000 trials per strength (15 buttons, 200 aims each, a fixed seed):

| Synthetic tremor | Off: intended button pressed | On: intended button pressed | On: wrong button pressed |
| --- | --- | --- | --- |
| Moderate: 3.5 cm sweep at 4-6 Hz, 2.5 cm pinch jolt | 81.2% | **100%** | 0 |
| Strong: 5 cm sweep at 4-6 Hz, 3 cm pinch jolt | 59.0% | **100%** | 0 |

**What remains open.** This is a model of selection, not a clinical measure, and the noise is synthetic. The Quest tracker's real noise and
the real jolt of a pinch have not been measured, and nobody has tried this with a tremor. One pointer limit also applies to every ray pinch:
the pinch after one that slid off a control is lost. It is listed in the [judge's guide](JUDGE_GUIDE.md#6-known-limits).

## 4. Network: manual mode needs no switch

There is no failover to trigger, because the workspace never depended on the network. Boards live in IndexedDB, every change runs through a
local copy of the engine, and nothing per-frame touches a socket. "Manual mode" is simply what remains when the AI cannot answer.

| Layer | Limit | Where |
| --- | --- | --- |
| One AI request, from press to answer | 10 s, then one calm line | `AI_PATIENCE_MS`, `src/backend/resilience.ts` |
| Waiting for a session within it | 4 s | `src/agent/client.ts` |
| One Nova call, retries included | 6 s, then the labelled built-in planner | `timeout-seconds`, `application.yml` |
| Connecting to voice | 10 s; nothing heard, 6 s; a microphone prompt nobody answers, 8 s | `src/voice/listen.ts` |
| Reconnecting | Full jitter, 0.5 to 30 s; a press of Plan or Talk wakes it at once | `src/backend/link.ts` |
| Opening storage | 2 s, then a fresh start | `src/workspace/store.ts` |

**Measured against production.** With the browser's network really cut (2026-11-04), Plan and Talk each ended in about 0.5 s with
*"Network issue. Switched to manual mode."*; a card moved, re-entering XR worked, and the AI answered again after reconnecting, with no reload.

**What remains open.**

- **The first load needs a connection.** There is no offline cache, so the page must already be open.
- **A server restart is a different case from a lost network, and it recovers by itself.** With a production page held open while the server was
  replaced on 2026-11-05, the link was back 2.2 s after the socket dropped, with no press and no reload. That is one replacement, measured once. A press
  during a real outage still ends in the calm line. See the
  [FAQ](JUDGE_FAQ.md#1-every-headset-holds-a-websocket-to-one-fargate-task-what-does-latency-do-to-the-frame-loop-and-what-happens-when-that-task-dies).
- **The Quest's own Wi-Fi switch** has not been tried.

## 5. What only a headset can settle

| Question | How to measure | Criterion |
| --- | --- | --- |
| Does it hold the frame rate? | OVR Metrics Tool, on the worst-case workspace, for 10 minutes | The competition's: at least 60 fps |
| What does it cost the GPU? | OVR Metrics Tool, VR against passthrough | Stays within the frame budget |
| Does it throttle over time? | The same run, watching CPU and GPU levels | No sustained drop |
| Are pinches reliable? | 20 presses each on small and large controls | Each lands once on what was aimed at |
| Is steady aim better on real tracking? | The same presses, on and off | On is no worse than off |
| Does Fit room land on a real table? | Three rooms the developer has not seen | The board stands on the table |
| Does the room scan start? | A Quest with no Space Setup: In my room, wait 3 s, Fit room | The scan opens, and Fit room works after it |
| Do anchors come back? | Fit, leave, re-enter, reboot | The boards return to their places |
| Is it comfortable? | People, seated, over a real session | Their own report: **never measured** |

The nearest thing to these today is the [judge's guide](JUDGE_GUIDE.md): about 15 minutes, written so a judge can tell what we measured
from what only their headset can show.
