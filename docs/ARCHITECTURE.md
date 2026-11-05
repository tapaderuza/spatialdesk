# Architecture

How SpatialDesk is built, why, and where it can fail. The [README](../README.md#architecture) has the overview; this is the detail behind it.
It describes the shipped build. Plans are in the [roadmap](ROADMAP.md).

## 1. Design principles

1. **The workspace never waits for the network.** The AI and voice are accelerators on top of a product that works by hand.
2. **The model proposes; a person disposes.** Nothing an AI suggests changes anything until it is reviewed and applied, and all of it can be undone.
3. **One set of rules.** The hands and the AI go through the same engine, so a plan the headset could not apply is never sent to it.
4. **Every paid call is bounded.** A competition deployment has to survive its own popularity.
5. **Measured, not assumed.** Budgets fail the build, and decisions below cite what was measured.

## 2. System

```text
Meta Quest Browser (WebXR)                                     Phone browser
  IWSDK ECS world, spatial UI, hands and controllers             companion.html
  Workspace engine (Kotlin/JS), IndexedDB, localStorage              |
    |            |                    |                              |
    | 16 kHz PCM | HTTPS              | WSS                          | HTTPS polling
    | (signed    | plans, signing,    | hello, ping,                 |
    |  URL)      | pairing            | keep-alive                   |
    |            v                    v                              v
    |          CloudFront -- /api, /ws --> ALB (CloudFront only) --> Fargate, 1 task, 0.25 vCPU, 512 MB
    |            |                                                    Spring Boot 3 + Kotlin, JVM 17
    |            +-- everything else --> S3, private (OAC)            Workspace engine (Kotlin/JVM)
    v                                                                    |
  Amazon Transcribe streaming <-- (the URL is signed by the task)        | Bedrock Converse, forced tool
                                                                         v
                                                                       Amazon Nova 2 Lite
```

One HTTPS origin serves the app and its backend. WebXR needs a secure context, there is no CORS to get wrong, and a judge opens a single URL.
Infrastructure is one AWS CDK stack in Kotlin (`server/infra/`).

## 3. One engine, two places

`server/shared/` is a Kotlin Multiplatform module. The browser runs it as JavaScript (`vendor/spatialdesk-shared`) and the server runs it on the JVM. It holds the workspace
model, its operations and the layout geometry.

- **Every change goes through it:** `WorkspaceEngine.applyAll` applies a batch whole or not at all.
- **The server validates what the model proposes** by actually applying it to the request's workspace.
- **Comfort is geometry.** Panel distance scales with the measured reach, angular width stays inside the allowed head turn, and a side preference and tilt shift the arrangement.

## 4. The agent loop

```text
intent + words + workspace + viewer pose
  -> Guardrails.facts   what this request must respect, computed by code and stated in the prompt
  -> Nova 2 Lite        one forced tool call, submit_plan, temperature 0, 1,800 tokens at most
  -> Normaliser         fixes slips with exactly one sensible reading; anything ambiguous is left to be rejected
  -> Guardrails         rules the model does not reliably follow in prose
  -> allowlist + engine ten operations, applied to a copy
  -> invalid? one retry with the exact error; still invalid or unavailable? the labelled built-in planner
  -> a proposal card: what changes and why -> Apply -> glide -> Undo
```

Guardrails exist because of measurements recorded in the code: on 2026-10-07 Nova moved a card with 25 of its 120 minutes used to Done on every "next block" and "replan"; on 2026-10-23 it named a card still
in progress as finished, and covered two of four stated needs; on 2026-10-29 "bring it all closer" produced a farther board. Each is now checked by code, and a violation goes back to the model as feedback, like an engine error.

**Why Nova 2 Lite:** measured on 2026-10-07 on the same plan prompt, 1.4 to 1.8 s with correct references, against 2.8 to 3.1 s and invented card titles for Nova Lite, and empty plans for Nova Micro.

## 5. Data

| Data | Where it lives | Who can read it | Lifetime |
| --- | --- | --- | --- |
| Boards, cards, timers, comfort profile | IndexedDB, in the browser | This browser profile | Until cleared |
| Setup, preferences, progress, room poses | `localStorage` | This browser profile | Until cleared |
| Microphone audio | Streamed to Amazon Transcribe; never to our server | AWS, see the [FAQ](JUDGE_FAQ.md#4-do-you-collect-biometric-data-from-voice-where-does-the-audio-go-and-who-keeps-it) | The listen; AWS's terms beyond it |
| Transcript, workspace context | Sent per request to our server and Amazon Nova | Our server's memory for the request; Bedrock | The request |
| Helper's view | Card ids, titles, column labels, up to 12 cards | Only an approved helper | 15 minutes at most, in memory |
| Session id, quota counters | Server memory | The server | Until the task restarts |
| Operational logs | CloudWatch: intents, counts, timings, and a rejected plan's reason | The AWS account | 14 days |

Browser storage is not encrypted, and this is not a clinical record. The [privacy policy](PRIVACY.md) states all of this for the people using the app, and the AWS account is opted out of AI services' use of this content for service improvement.

## 6. Limits

| Limit | Value | Bounds |
| --- | --- | --- |
| New sessions per network | 200 per clock hour | Abuse of the session endpoint |
| Active sessions | 500, oldest evicted | Server memory |
| Plans | 20 per session per hour; 300 per day in all | The Bedrock bill |
| Listens | 60 per session per hour; 600 per day in all | The Transcribe bill |
| Nova call | 6 s, one SDK retry inside it | The wait |
| Client patience | 7 s | The wait |
| Plan | 24 steps, 1,800 output tokens, 64 KB request | Model and server cost |
| Request text | 600 characters; dialogue 6 turns | Prompt size |
| Workspace | 4 boards, 3 timers | The frame budget |

The per-network limit is set in production through the task's environment (`SPATIALDESK_SESSIONS_PERIPPERHOUR=200`, ECS task revision 16). The repository's default remains 30. See the [audit](ENGINEERING_AUDIT.md).

## 7. Failure domains

| What fails | Effect on the person | Recovery |
| --- | --- | --- |
| Network, mid-session | Calm line on AI and voice; everything else works | By itself |
| Network, before loading | The page does not load | Reconnect and open it |
| Nova slow, throttled or wrong | A labelled plan from the built-in planner | Per request |
| Transcribe unavailable | Calm line; visible controls work | Per request |
| Server task restarts | Cards work; an open page reconnects with a new session (2.2 s measured); a press during an outage gets the calm line | By itself. See the [FAQ](JUDGE_FAQ.md#1-every-headset-holds-a-websocket-to-one-fargate-task-what-does-latency-do-to-the-frame-loop-and-what-happens-when-that-task-dies) |
| Daily AI cap spent | Plain line; everything else works | 00:00 UTC, or a restart |
| A WebXR capability missing | That feature is absent | See the [hardware document](HARDWARE_MITIGATION.md#1-api-tolerance-requiredfeatures-is-empty) |
| Browser storage blocked | The visit works; nothing is remembered | Next visit, if allowed |

**Single points of failure, knowingly accepted for a competition:** one task in one region, with state in memory. A failed release rolls back by itself, but a crash loses sessions and quota counts.

## 8. Runtime discipline

The frame budget is treated as a hard requirement:

- **No per-frame allocation** in the app's paths, enforced at 4,096 bytes per frame by a sampling heap profiler in CI.
- **Systems use queries and subscriptions**, not manual lists or polling.
- **A framework cost removed:** IWSDK's `PanelUISystem` walks the whole scene each frame to find its documents, measured at about 5% of the frame on the worst workspace. `src/ui/panel-ui-cache.ts` keeps the list and refreshes it every 8 frames.
- **Motion:** critically damped springs on position, yaw, pitch and scale, with no overshoot. A step is capped at 50 ms, so a stall is not paid in one leap, and at rest a panel costs one comparison.

## 9. Verification

| Layer | What | When |
| --- | --- | --- |
| Type check | TypeScript, strict | Every push, by a pre-push hook |
| Browser scenarios | 224 in Meta's IWER emulator, on the production build | Every push |
| Performance gate | Frame, allocation, draw calls, triangles, heap | Every push |
| Size budget | 2.5 MB gzipped | Every push |
| JVM tests | Server, shared engine, infrastructure | Every deploy through `scripts/deploy.mjs` |
| Real services | Nova, Transcribe and the helper flow against production | On demand |

**What this does not cover:** a physical headset, a GPU, real hand tracking, or people. See the [hardware document](HARDWARE_MITIGATION.md).
