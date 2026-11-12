# SpatialDesk: technical judge's guide

About 15 minutes on a Meta Quest. Each test says what to do, what should happen, and where that behaviour has been
verified, so you can separate what we measured from what only your headset can show.

**How far this has been verified:** SpatialDesk has not yet run on a physical headset. Results below come from Meta's IWER
emulator (Quest 3 profile) running the production build, and from the live production service.

| | |
| --- | --- |
| App | <https://d2p3027seoreck.cloudfront.net/> (Meta Quest Browser) |
| A quick look | <https://d2p3027seoreck.cloudfront.net/?fast> (timers run in seconds: Focus 25 lasts 25 seconds, and the panel says so) |
| Without hands | <https://d2p3027seoreck.cloudfront.net/?fast&handsfree> (the quick look with hands-free on: rest your head's aim on a control until its ring fills) |
| Phone companion | <https://d2p3027seoreck.cloudfront.net/companion.html> |
| Without a headset | <https://d2p3027seoreck.cloudfront.net/?emulate&lang=en-US> (any current Chromium browser) |
| Code | <https://github.com/tapaderuza/spatialdesk> |

Button names below are as shown in English, the app's default language.

## Start here: the first five minutes

1. Open the **quick look** link. Before the headset view, press **Speak** once and allow the microphone (say your day's tasks,
   or press **Stop**): **Talk** then works inside VR with no permission prompt. Select **Enter VR**.
2. Answer the guided setup: where you sit, a pinch where your hand rests, and whether you want steady aim.
3. Follow the three steps on the board: tap a card, drop it in **Doing**, press **Focus 25**.

**Expected:** the block ends after 25 seconds, the focus plant on the desk grows a leaf, and the assistant suggests what to do next.

**Verified:** in the emulator (`tests/studio.spec.ts`, `tests/accessibility.spec.ts`). **Not verified:** on a physical headset. Without `?fast`, Focus 25 lasts 25 real minutes.

**Without hands:** open the *without hands* link instead. Hands-free is off until something turns it on (its link, the
**Hands-free** button, or *"hands free on"* after **Talk**), so a link is the way in for someone who cannot reach the button. Every
step above then takes a held gaze, and the setup's pinch has a **Skip this step** button. **Verified:** gaze presses and card moves
in the emulator (`tests/handsfree.spec.ts`), not yet as one run from setup to the leaf.

## 1. Resilience: turn the Wi-Fi off

SpatialDesk treats the network as optional for the workspace and required only for the AI. Its boards live in the browser's
own storage (IndexedDB), and no card operation waits for a server.

**Load the page first.** The app has no offline cache, so it cannot load, or reload, without a connection.

1. Online, open the app and select **Enter VR**.
2. Select **Plan my day**. A proposal should appear within a few seconds. Select **Discard**.
3. Turn the Wi-Fi off from the headset's Quick Settings and return to the app. If leaving ended the immersive session,
   select **Enter VR** again; the page stays loaded, and entering needs no network.
4. Select **Plan my day**, then **Talk**.
5. Pick up a card and drop it in another column. Select **Focus 25**, then **Undo**.
6. Turn the Wi-Fi back on, wait a moment, and select **Plan my day** again.

**Expected**

- At step 4, each request ends with one plain line, *"Network issue. Switched to manual mode."*, with no error tone. The
  app waits at most 10 seconds (`AI_PATIENCE_MS`, `src/backend/resilience.ts`); a request that fails outright ends sooner.
- At step 5, everything works as before, because none of it uses the network.
- At step 6, the AI answers again with no reload. The connection retries by itself, with backoff of up to 30 seconds, and the
  press itself wakes it, so it does not wait that long.

**Two details you may notice**

- The status line follows the WebSocket. It can keep saying *"Command server online"* until the operating system closes that
  socket, so the line in step 4 is the signal to judge by, not the status line.
- A proposal labelled **Built-in planner** is the designed fallback, not a failure. The server validates every plan from
  Amazon Nova; if a plan fails validation twice, a deterministic planner answers and the card says so. On production on
  2026-11-10, the first **Plan my day** of a fresh workspace, with no words, came from Nova 10 times in 10 (once after a retry),
  in 1.1 to 3.0 s. Until that day it fell back every time: the starter board lacked the **Doing** column the agent plans with.

**Verified:** in the emulator with the browser's network really offline (`tests/edge-cases.spec.ts`, `tests/resilience.spec.ts`),
and against production the same way (AI and voice requests each ended in about 0.5 s; the card move and re-entering worked; the
AI came back after reconnecting). **Not verified:** the behaviour of the Quest's own Wi-Fi switch.

A server restart is a different case, and it recovers by itself too. With a production page held open while the server was replaced
on 2026-11-05, the link was back 2.2 s after the socket dropped, with a new session, no press and no reload, and the next Plan answered.

## 2. Performance and comfort

### What to check

Turn your head quickly across the panels, then select **Plan my day** and **Apply** while watching them move. To measure the
frame rate, use your usual tool, such as OVR Metrics Tool. The criterion to hold us to is the competition's: at least 60 fps
on Quest hardware.

For our own CPU figures on your device, open the app with `?perf`, connect remote debugging, enter the session as usual, and run
`__perf.snapshot()` in the console. It returns frame-time percentiles, draw calls and triangles. Do not call its `launchXR()`:
that lowers the render resolution for the emulator gate. Enter with the normal button instead.

### What we measured

From the CI performance gate (`tests/perf.spec.ts`, `perf-budgets.json`): production build, IWER, a development laptop with the
CPU slowed 3x to allow for thermal throttling and browser overhead.

| Measure | SpatialDesk (run of 2026-11-04) | Meta's IWSDK starter scene (reference) |
| --- | --- | --- |
| Whole frame, median | 13.1 ms | 18.8 ms |
| Whole frame, 95th percentile | 22.2 ms | 29.4 ms |
| The app's own systems, 95th percentile | 2.2 ms | not measured |
| Draw calls | 78 | 72 |
| Triangles | 31,568 | 81,688 |
| JS heap | 103 MB | not measured |

**How to read this**

- These figures compare CPU cost with a scene Meta publishes as Quest-ready, under identical conditions. They are not a frame
  rate on a Quest. **GPU time is not included.**
- A 60 fps frame has 16.7 ms. The 22.2 ms above is a deliberately pessimistic number, with the CPU slowed 3x; it does not
  predict 45 fps, and it does not prove 60 fps either.
- It varies with machine load, so the gate retries before failing. On the same laptop the build has measured from 19.5 ms
  (2026-11-05) to over 50 ms (2026-11-07), with draw calls and triangles unchanged; on 2026-11-10 it passed on a retry at
  29.2 ms while the antivirus was using about three cores. Our video quotes 24.6 ms, from an earlier run.
- It says nothing about motion sickness, which we have not measured.

### What supports comfort by design

- **The viewer is never moved.** Locomotion is off (`iwsdk.config.json`), and the experience is built to be used seated.
- **Only panels move, and only on request.** They glide on a critically damped spring that never overshoots and settles
  within 2% in 0.75 s (`src/ui/glide.ts`, `tests/glide.spec.ts`).

Whether this is comfortable on real optics is for you to judge.

## 3. Hardware tolerance

SpatialDesk never asks WebXR to *require* a capability. Each feature in `iwsdk.config.json` and in the room session
(`launchRoom`, `src/room/room-system.ts`) is set to `true`, which IWSDK requests as an **optional** feature; a `requiredFeatures`
entry the runtime lacks would make the whole session request fail. So a missing capability can only remove the feature that
uses it, not stop the app from starting.

| Capability | If the headset does not grant it |
| --- | --- |
| Hand tracking | Controllers work everything |
| Plane detection | Fit room asks the headset to scan the room where it offers that (Quest's Space Setup). Otherwise it says *"I can't see your desk or walls..."*. Either way it moves nothing until there is a room to fit to |
| Anchors | The fit holds for the session, without being remembered |
| Eye tracking | Hands-free aims with the head; every Quest has that |

**To try it:** turn hand tracking off in the headset's settings and enter with controllers. Then use **In my room** on a headset with
no room setup, and select **Fit room**.

**Scene understanding:** this is a WebXR app, so it uses WebXR plane detection and anchors (`src/room/room-system.ts`) rather than MRUK.
Fit room runs in all 13 rooms of Meta's Synthetic Environment Module, none of them tuned for, in the emulator (`tests/rooms.spec.ts`).

**Verified:** in the emulator, by withholding every optional capability from the session. The test records each session request,
asserts that `requiredFeatures` is empty for VR and for the room, and then operates the app
(`tests/edge-cases.spec.ts`, first test). **Not verified:** on a physical device.

## 4. Input modes

Each of the first three opens with a link, so it can be set up in advance by whoever helps, and can also be turned on by voice.

| Mode | Link | What to try |
| --- | --- | --- |
| Steady aim | `/?steady` | Shake your hand while aiming: the press goes to the control you aimed at most over the last 450 ms |
| One switch | `/?switch` | First pinch anywhere starts the scan; the next selects the control lit |
| Hands-free | `/?handsfree` | Rest your head's aim on a control: a ring fills and presses it (1 s for buttons, 1.6 s for cards) |
| Voice | any link | **Talk**, then *"Bring everything closer and make the text bigger"*; review, **Apply**, **Undo** |

The standards behind these, and their limits, are in the README's
[Accessibility & Inclusivity Standards](../README.md#accessibility--inclusivity-standards).

## 5. Repeat our checks

```powershell
npm ci
npm run typecheck
npx playwright test tests/edge-cases.spec.ts tests/failure-modes.spec.ts   # the edge and failure cases cited here
npm run test:perf                                                          # the performance gate
```

`npm run ci` runs everything. To run the real-service tests against production, set
`E2E_URL=https://d2p3027seoreck.cloudfront.net` and run `tests/e2e.spec.ts`, `tests/e2e-voice.spec.ts` and `tests/assist-real.spec.ts`. These
make real Amazon Nova and Amazon Transcribe calls.

The suite has 227 browser scenarios: the 199 quoted in the video, plus seven in `tests/edge-cases.spec.ts`, 20 in
`tests/failure-modes.spec.ts` and one in `tests/room.spec.ts`.

## 6. Known limits

- **After a pinch that slides off a control into empty space, the next pinch is lost.** The one after it works.
- **One-switch scanning covers the command panel and the agent's card**, not the cards on the boards.
- **Voice and the AI need the network**, and listening starts from the **Talk** control: there is no wake word.
- **Each network can open 200 new sessions per hour.** Past that, the link retries, the AI gives the calm line, and the cards keep working.
- **The AI has 300 plans per day across all users, and voice 600 listens.** Past that, a plain line says so, and the cards keep working.
- **No study with people, on any device, has been run yet.**

Every finding, with its evidence and its fix, is in the [engineering audit](ENGINEERING_AUDIT.md). The hard questions are in the
[FAQ](JUDGE_FAQ.md).
