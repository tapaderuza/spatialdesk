# Engineering audit

A self-audit of the shipped build, made on 2026-11-05 with the production code frozen. **Findings 2, 3 and 4 were fixed the same day**, when the owner lifted the freeze for those three alone, **findings 5 and 19 later that day**, in a second lift for those two alone, and **findings 1 and 17 needed no code**; **the others are recorded and not fixed**. It is not a third-party audit and not a penetration test. Severity is
our own judgement of the effect on a person using the app during judging.

## Findings

| # | Severity | Finding | Evidence | Trigger | Fix |
| --- | --- | --- | --- | --- | --- |
| 1 | Fixed | **AWS's default use of voice input was not opted out.** AWS documents that Transcribe stores and uses voice inputs to improve the service unless the account opts out through AWS Organizations. | Effective policy on the account, 2026-11-05: `{"services":{"default":{"opt_out_policy":"optOut"}}}` | Any use of Talk | An organization with an AI services opt-out policy for all services, attached at its root, that child policies cannot change |
| 2 | Fixed | **A page open across a server restart did not reconnect by itself.** A refused handshake reaches the browser as close code 1006, and `link.ts` kept offering its id. Plan recovered it; Talk did not. | Before, real server: first Plan 6.3 s and the calm line, link back 23 s later. After, production task replaced under an open page: link back 2.2 s after the socket dropped, no press. `tests/failure-modes.spec.ts` | A restart or crash with pages open | `a2768d0`: the link asks the socket's path over HTTP (401: new session; 400: keep it), a press wakes it, and Talk retries on a 401 |
| 3 | Fixed | **Removing a panel retained memory.** About 3.3 MB of JS heap per board, 0.4 MB and one geometry per timer, linear. The cause: a UIKit component's `dispose()` stops only itself and IWSDK's document disposes only its root, so every other component kept its Yoga node, whose measure function kept the whole panel. | Heap snapshots gave the chain. After, over 85 rounds of each kind: about 0.02 MB per panel and levelling off; geometries and textures unchanged; WebAssembly memory flat at 16 MB over 160 panels. Desktop Chromium, not a headset. `tests/failure-modes.spec.ts` | Creating and removing boards or timers repeatedly | `a2768d0`: every component stops, children first, and the entities use `dispose()` (`pinned.ts`) |
| 4 | Fixed | **Persistent anchors were never deleted.** Meta's documentation allows a site 8. Past that, the fit stood for the visit, but the layout was saved relative to the new anchor under the old handle. | Before, refusal simulated in IWER, viewer moved 0.5 m: every board 0.500 m out on return. After: 12 fits under a simulated limit never refused, and the last layout returned within 1 cm. Emulated. `tests/failure-modes.spec.ts` | Eight or more fits in one browser, then a change of seat | `a2768d0`: each fit deletes the earlier anchors first, keeps IWSDK's own, never asks for a ninth, and never saves under a mismatched handle |
| 5 | Fixed | **A ray pinch held longer than 800 ms pressed nothing,** with no feedback. This was the default of IWSDK's ray pointer. | Before: 500 ms pressed, 1,000 ms did not. After: held 2.5 s, it presses on release; held 2.5 s and taken off the panel, it does not. The new test fails without the fix. Emulated. `tests/edge-cases.spec.ts` | Slow motor release | `clickThresholdMs` set to no limit on both rays (`poke.ts`). The reach pinch stays a measurement until after its release, so it still presses nothing |
| 6 | Low | **After a pinch slides off a control, the next pinch is lost.** | `tests/edge-cases.spec.ts` | A changed mind | Report upstream |
| 7 | Low | **Two Nova attempts can outlast the client's patience** (6 s each against 7 s), and the line then says "network". | `AgentApi.kt`, `Planner.kt`, `client.ts` | A late invalid plan and a slow retry | A shared deadline across attempts |
| 8 | Low | **The warm-up call can time out at start-up,** so the first plan pays for the loading: 4.3 s instead of about 2. | Server log, 2026-11-05 | The first plan after a cold start | Warm up with a longer timeout |
| 9 | Low | **The production limit is outside the infrastructure code.** The task runs with `SPATIALDESK_SESSIONS_PERIPPERHOUR=200` (revision 16), applied directly because Docker was unavailable and the server code is frozen. A deploy that changes the task definition returns it to the repository's 30. | `aws ecs describe-task-definition` | A later `cdk deploy` that changes the task | Add the variable to `SpatialDeskStack.kt`, line 96 |
| 10 | Low | **No Content Security Policy or Permissions-Policy on the site.** HSTS, `X-Content-Type-Options`, `X-Frame-Options` and `Referrer-Policy` are present. | Response headers, 2026-11-05 | Defence in depth only: the immersive UI has no HTML injection surface | A custom response headers policy |
| 11 | Low | **A high-severity advisory on a transitive dependency:** `zod` 4.6.5, memory exhaustion on oversized collections (GHSA-mrhx-c7xc-m3w5). It is in the bundle through the UI libraries, where it parses the app's own panel files. `src/` does not import it. | `npm audit --omit=dev` | No untrusted input was found reaching it | Update to 4.6.6 or later |
| 12 | Low | **Stream length is enforced by the client.** Grants are counted, but a modified client could hold a granted Transcribe stream open. | `VoiceApi.kt`, `listen.ts` | A deliberately modified client | Not possible with a signed URL alone; a budget alarm |
| 13 | Low | **No alarms on this stack,** and the daily AI cap is shared and in memory. | `aws cloudwatch describe-alarms` | An outage goes unnoticed | Alarms on 5xx and unhealthy hosts |
| 14 | Accepted | **One task, one region, state in memory.** Knowingly accepted for a competition. | `SpatialDeskStack.kt` | Task failure | See the [roadmap](ROADMAP.md) |
| 15 | Accepted | **No offline first load.** The page must be open before the network goes. | `tests/edge-cases.spec.ts` | Opening with no connection | A service worker |
| 16 | Low | **Two development notes are published with the site,** `ui/AGENTS.md` and `scenes/AGENTS.md`. They hold tooling guidance and no secrets. | HTTP 200, 2026-11-05 | Anyone who requests them | Keep them out of `public/` |
| 17 | Fixed | **There was no public privacy policy,** which Meta's Developer Data Use Policy asks for (2.2). | The repository, 2026-11-05 | Any use of the app | [`docs/PRIVACY.md`](PRIVACY.md), checked against the code |
| 18 | Low | **The app's own page does not link to the privacy policy.** The README and the FAQ do. | `index.html`, frozen | Someone who only opens the app | A link on the page, with the next client release |
| 19 | Fixed | **Fit room dead-ended on a headset with no Space Setup.** It advised looking around, which cannot help there, and Meta's guide says few people run that setup. | After: with no planes 3 s after entering, it calls `initiateRoomCapture`, once a session, as the guide recommends; a cancelled scan gets one plain line; a headset with a room is never asked. IWER lacks the call, so `tests/room.spec.ts` stands in for it. **Not run on a headset** | In my room on a Quest with no room set up | `nothingToFit()` in `room-system.ts` |

The largest finding is one no test here can address: **it has not run on a physical headset**. See the [hardware document](HARDWARE_MITIGATION.md).

## Checked, and found sound

| Check | Result |
| --- | --- |
| Secrets in the tracked tree | None. The only match is AWS's published example key, in a signing test |
| Media and personal files in the repository | None tracked except `tests/fixtures/plan-my-day.wav`, synthetic speech made with Piper |
| IAM | The task may invoke one model through one profile and start Transcribe streams; nothing else |
| Network exposure | The load balancer admits only CloudFront's range; the bucket is private behind OAC, and enforces TLS |
| Client address | Second-to-last `X-Forwarded-For` hop, so a spoofed header does not change the count |
| Session ids | 128 bits from `SecureRandom`; required for the socket and for every paid call |
| Logs | No transcript or request body. A rejected plan's reason can quote plan text. 14-day retention |
| Bedrock invocation logging | Not enabled on the account |
| Helper data | Strict JSON at the boundary; titles and columns only; nothing shared until the owner approves |
| WebXR requests | `requiredFeatures` empty in both modes, by test |
| Production after the change | Revision 16 on the same image, rollout `COMPLETED`, 40 more sessions from one network all accepted, connection and clock sync passing, and 6 of 6 real plans in 1.8 to 2.3 s |
| Production after the fixes | Client from `a2768d0` live, task replaced on revision 16, rollout `COMPLETED`, connection and clock sync passing, a real plan in 1.7 s, and real speech through Transcribe reaching the agent |

## How the failure modes were tested

`tests/failure-modes.spec.ts` holds 20 scenarios, run in the emulator: a server restart, a press during the backoff, a dropped connection, Talk with a forgotten session, the session limit, the headset coming off in mid-glide, a half-second stall, the system menu, a switch between
controllers and hands, a refused session, a refused microphone, blocked storage, an erased anchor, an unreadable saved room, twelve fits under the anchor limit, anchors left from before, no way to delete them, a refused anchor, unusable server answers, and a long sitting. They found findings 3 and 4 and
confirmed finding 2 against the real server, and they now hold the fixes. They also stopped a first version of the anchor fix, which deleted IWSDK's own anchor and froze the render loop.
