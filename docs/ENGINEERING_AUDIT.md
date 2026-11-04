# Engineering audit

A self-audit of the shipped build, made on 2026-11-05 with the production code frozen, so **findings are recorded and not fixed**. It is not a third-party audit and not a penetration test. Severity is
our own judgement of the effect on a person using the app during judging.

## Findings

| # | Severity | Finding | Evidence | Trigger | Fix |
| --- | --- | --- | --- | --- | --- |
| 1 | Medium | **AWS's default use of voice input is not opted out.** AWS documents that Transcribe stores and uses voice inputs to improve the service unless the account opts out through AWS Organizations. The account is in no organization. | `organizations` API, 2026-11-05 | Any use of Talk | Set the opt-out policy on the account |
| 2 | Medium | **A page open across a server restart does not reconnect by itself.** A refused handshake reaches the browser as close code 1006, and `link.ts` drops its id only on 4404 or 1008. Plan recovers it; Talk does not. | Real server, 2026-11-05: first Plan 6.3 s and the calm line, link back 23 s later, next Plan 1.6 s. `tests/failure-modes.spec.ts` | A restart or crash with pages open | `link.ts`: a close before the hello means an unknown session. `listen.ts`: drop the session on a 401 |
| 3 | Low to medium | **Removing a panel retains memory.** About 3.3 MB of JS heap per board, 0.4 MB and one geometry per timer. Linear over 85 rounds, with no plateau. Cards, comfort changes and idle time are flat. | 85 rounds of each kind, after forced collections. `tests/failure-modes.spec.ts` holds it from growing | Creating and removing boards or timers repeatedly. About 20 board cycles pass the 150 MB budget | `pinned.ts`: `dispose()` for `destroy()` removes the geometry, shown by redirecting the call in memory. The JS retention is **not yet explained**; it is not `livePanels` |
| 4 | Low | **Persistent anchors are never deleted.** Meta's documentation allows a site 8. Past that, the fit stands for the visit, but the layout is saved relative to the new anchor under the old handle. | Refusal simulated in IWER, viewer moved 0.5 m: every board 0.500 m out on return. `tests/failure-modes.spec.ts` | Eight or more fits in one browser, then a change of seat | Delete the previous anchor; never save under a mismatched handle |
| 5 | Low | **A ray pinch held longer than 800 ms presses nothing,** with no feedback. This is the default of IWSDK's ray pointer. | `tests/edge-cases.spec.ts`; 500 ms pressed, 1,000 ms did not | Slow motor release | Raise `clickThresholdMs` |
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

## How the failure modes were tested

`tests/failure-modes.spec.ts` adds 14 scenarios, run in the emulator: a server restart, the session limit, the headset coming off in mid-glide, a half-second stall, the system menu, a switch between
controllers and hands, a refused session, a refused microphone, blocked storage, an erased anchor, an unreadable saved room, a refused anchor, unusable server answers, and a long sitting. They found findings 3 and 4 and
confirmed finding 2 against the real server. Where a scenario pins a limit, its comment says so, so a fix will show up as a test to change.
