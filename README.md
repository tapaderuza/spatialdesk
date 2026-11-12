# SpatialDesk

**Accessibility should not be a settings menu you dig through on a bad day. It should be an environment that adapts to you.**

**The problem.** Reach, posture and energy change from one day to the next, and productivity software assumes they don't. On a
low-energy day the screen sits too far away, turning the head costs more, and accessibility settings ask for effort up front, in
a menu, at the moment there is least of it to spend. This is a physical-ergonomics problem, and spatial computing is the first
platform that can answer it with geometry instead of menus.

**The product.** SpatialDesk is a seated mixed-reality workspace that reshapes itself around the person using it. Say *"Bring
everything closer and make the text bigger"*: Amazon Transcribe streams the speech to text, Amazon Nova 2 Lite on Bedrock answers
through a single forced, typed tool call, the same Kotlin engine the headset runs validates every proposed operation on the server,
and Meta's Immersive Web SDK glides the panels into place once the person selects Apply. It opens from one URL in Meta Quest
Browser, with no install and no account. Every change is reviewed first and can be undone, and a family member or carer can help
from an ordinary phone while the person in the headset stays in control.

**The engineering advantage.** The AI accelerates SpatialDesk, and the workspace never depends on it. Boards live in the browser
and no card operation waits for a server, so losing the network in mid-session costs one calm line, and voice and AI return with the
network, with no reload. An open page also comes back by itself when the server restarts: 2.2 seconds, when the production server was
replaced under one. A slow or invalid model answer is cut at 6 seconds or corrected once with the exact error, then replaced by
a deterministic planner that labels itself. No WebXR capability is required, so a headset that lacks one loses that feature, not the
session. Every AI and speech call sits behind session and daily caps, and 227 browser scenarios, a performance gate and 13 synthetic
rooms run before every push. The proof still to come is the one only hardware can give: SpatialDesk has not yet run on a physical
headset, and [exactly what that leaves open](docs/HARDWARE_MITIGATION.md) is written down.

**[Watch the two-minute demo](https://youtu.be/FWbl6vpkiH4)** · **[Open SpatialDesk](https://d2p3027seoreck.cloudfront.net/)** · **[Quick look, timers in seconds](https://d2p3027seoreck.cloudfront.net/?fast)** · **[Without hands](https://d2p3027seoreck.cloudfront.net/?fast&handsfree)** · **[Try it without a headset](https://d2p3027seoreck.cloudfront.net/?emulate&lang=en-US)** · **[Open the mobile companion](https://d2p3027seoreck.cloudfront.net/companion.html)**

## At a glance

| | |
| --- | --- |
| **For** | People whose reach, posture or energy changes from day to day, and the people who help them |
| **Runs on** | Meta Quest Browser (WebXR), or any current Chromium browser with Meta's IWER emulator |
| **Assistant** | Amazon Transcribe (streaming speech) and Amazon Nova 2 Lite on Amazon Bedrock (structured, reviewable proposals) |
| **Helper** | A phone web page: approved, time-limited, read-only board plus one large Help / Recalibrate button |
| **Automated checks** | 227 browser scenarios in Meta's IWER emulator (Playwright), plus JVM tests for the server and shared engine |
| **Performance gate** | Whole-frame p95 22.2 ms with the CPU throttled 3x (budget: Meta's IWSDK starter scene, 29.4 ms), 78 draw calls (budget 80), 2.32 MB gzipped (budget 2.5). The video quotes 24.6 ms, from an earlier run |

Performance figures are measured in the emulator by the CI gate, not on a physical headset. SpatialDesk is an
accessibility-focused productivity prototype: it does not diagnose, prescribe treatment or claim clinical validation.

## Judge's guide

For the engineering evaluation: the [technical judge's guide](docs/JUDGE_GUIDE.md) (network loss, performance, hardware
tolerance, in about 15 minutes), [hardware risk mitigation](docs/HARDWARE_MITIGATION.md) (no physical headset yet, and what that
leaves open) and [five hard questions](docs/JUDGE_FAQ.md) (latency, Bedrock limits, anchors, voice data, abuse).

### On Meta Quest

1. Open the production link in Meta Quest Browser. Before entering, add a few tasks under **Describe your day**, for
   example: **"Review the proposal, reply to Ana, prepare tomorrow's meeting."** Choose **Enter VR** for an immersive
   session, or **In my room** when the browser supports passthrough.
2. Complete the short comfort setup: where you sit, a comfortable reach (pinch where your hand rests), and steady aim.
   Any step can be skipped.
3. Select **Talk**, allow microphone access, and say: **"Bring everything closer and make the text bigger."** Review the
   proposal, select **Apply**, and watch the panels glide into reach. **Undo** restores the previous layout.
4. Select **Plan my day** to review a proposed plan. It stays a proposal until you apply it. Manual controls such as
   **Focus 25** work without any AI request.
5. Invite a helper and try the phone flow below.

For Spanish, open [the Spanish version](https://d2p3027seoreck.cloudfront.net/?lang=es-ES). Speech needs microphone
permission, a connection and an available voice service. If it is unavailable, carry on with the visible controls; a
labelled local fallback answer is not a Nova answer.

### On a computer, without a headset

Open [the emulator link](https://d2p3027seoreck.cloudfront.net/?emulate&lang=en-US) in a current Chromium-based browser
and select **Enter VR**. **IWER** is Meta's browser-based headset emulator: it supplies a simulated Quest 3 headset and
controllers, so the whole workspace can be explored with a mouse and keyboard. **WebXR** is the browser interface that
starts and manages the immersive session. Emulator results show browser behaviour, not comfort or performance on a
physical headset; see Meta's [testing guide](https://iwsdk.dev/guides/02-testing-experience.html).

### The companion, with a second screen

1. In SpatialDesk, say **"Invite a helper"**, or use **Invite a family member or carer** on the start screen.
2. On a phone or a second browser tab, open the [companion](https://d2p3027seoreck.cloudfront.net/companion.html) and
   type the eight-character code. It expires after two minutes.
3. In SpatialDesk, select **Allow**. Until then the helper sees nothing.
4. The phone follows the Today board's task titles and column labels (up to 12 cards), refreshed about every two
   seconds.
5. Press **Help / Recalibrate** on the phone: the guided setup opens in the headset, where its wearer decides what to do
   and can skip any step. The helper cannot change comfort settings remotely.
6. Select **Stop sharing** in SpatialDesk. Sharing also ends by itself after 15 minutes.

## How a request flows

```text
"Hoy es un mal día, acércalo todo."  (Today is a bad day. Bring everything closer.)
   |
   | microphone -> 16 kHz PCM, streamed straight from the browser to Amazon Transcribe (URL signed by the server)
   v
transcript + workspace context (comfort profile, the card the head rests on)
   |
   | Spring Boot -> Amazon Bedrock Converse -> Amazon Nova 2 Lite, answering through a typed tool
   v
proposed operations  --> guardrails (the shared workspace engine: e.g. "closer" must end nearer than now)
   |
   v
a proposal card in the headset: what changes and why  -->  Apply  -->  panels glide to their new pose  -->  Undo
```

Nothing changes until the person agrees. If Nova is slow or unavailable, a bounded timeout hands over to a clearly
labelled built-in planner, so a service failure is never presented as a model answer.

## Architecture

```text
Meta Quest Browser / desktop browser
  TypeScript + Vite
  Meta IWSDK: ECS world, spatial UI, hand/controller and poke interaction
  WebXR: immersive session, passthrough, tracked input
  Shared Kotlin Multiplatform workspace engine, compiled to JavaScript
       |
       | HTTPS: commands, plans, helper pairing          WebSocket: command-server connection
       v
  Spring Boot 3 + Kotlin, JVM 17  (ECS Fargate behind an Application Load Balancer)
  The same workspace engine on the JVM: every proposal is validated before the client sees it
       |                                  |
       | Bedrock Converse                 | short-lived signed streaming URL
       v                                  v
  Amazon Nova 2 Lite                  browser microphone -> Amazon Transcribe (audio never passes the server)

Phone browser: companion.html  --HTTPS polling, approved snapshot, help requests-->  helper service (Spring Boot)

Hosting: S3 + CloudFront (web), ALB + ECS Fargate (API); infrastructure as code with AWS CDK in Kotlin
Testing: Playwright drives Meta's IWER emulator in Edge; Gradle runs the JVM tests
```

**One engine, two places.** The workspace rules and the layout live in a Kotlin Multiplatform module
(`server/shared/`). The browser runs it as JavaScript to place panels; the server runs it on the JVM to validate what the
model proposes. A plan the browser could not apply is never sent to it.

**Comfort is geometry.** Each panel's distance scales with the measured comfort reach, its angular width is kept inside
the allowed head turn, a preferred side and tilt shift the arrangement, and panels that need an answer always stand in
front of the boards. When something moves, it glides: a critically damped spring on position, yaw, pitch and scale that
never overshoots, settles within 2% in 0.75 s, carries its speed into a new target, and allocates nothing per frame.

**IWSDK and IWER have different jobs.** IWSDK runs the spatial experience; IWER supplies simulated devices during
development and testing. `iwsdk.config.json` is the scene and runtime configuration authority; `vite.config.ts` wires the
plugin, the proxy and the build.

**Speech has its own path.** The browser converts microphone input to streaming PCM. Spring Boot signs a short-lived
Amazon Transcribe connection and the audio goes straight from the browser to Transcribe. AWS credentials stay on the
server, never in the browser.

**Data sharing is explicit.** Workspace state is saved in browser storage. AI requests send the request and relevant
workspace context to the backend and the model. Approved helper snapshots contain card identifiers, titles and column
labels only: no notes, timers or comfort profile. Browser storage is not an encrypted clinical record. The AWS account is opted
out of AI services' use of this content for service improvement, and the [privacy policy](docs/PRIVACY.md) states all of it.

## Accessibility & Inclusivity Standards

SpatialDesk treats variation in reach, posture and fine motor control as an input-design and spatial-layout problem. This
section maps what the shipped build does to two W3C documents: the
[Web Content Accessibility Guidelines (WCAG) 2.2](https://www.w3.org/TR/WCAG22/), a W3C Recommendation, and the
[XR Accessibility User Requirements (XAUR)](https://www.w3.org/TR/xaur/), a W3C Working Group Note of 25 August 2021.

**Scope of this mapping.** It is informative and is not a conformance claim. WCAG 2.2 is written for web content, and an
immersive WebXR canvas falls outside its testable model, so its criteria are applied here by analogy; XAUR is the more direct
reference, but it states requirements, not a conformance scheme. No third party has audited the product, no study with disabled
participants has been run, and nothing here has been validated on a physical headset. Where a mechanism is verified, it was verified in
Meta's IWER emulator by the named tests. The steady-aim model is measured with synthetic tremor and is not a clinical instrument.

### Capabilities in the shipped build

| Capability | Mechanism | WCAG 2.2 (by analogy) | XAUR | Verification |
| --- | --- | --- | --- | --- |
| **One-switch scanning** | The command panel's controls, or the agent's card while it is open, are highlighted in turn; a first press arms the scan and a later, separate press selects. A held or repeated press cannot select. Input is Space or Enter on a screen, and any pinch or trigger in XR. Enabled by `?switch` or "switch mode on". | 2.1.1 Keyboard (A), in part: on a screen, for the controls scanned | REQ 4a, 4c | `tests/switch.spec.ts`, `tests/accessibility-switch.spec.ts` |
| **Steady aim** | A press selects the control holding the largest share (at least 40%) of the preceding 450 ms of aim, rather than the one under the ray at that instant; a press between controls snaps to the nearest within 1.5 cm. Enabled in the guided setup, by `?steady`, or by voice. | No direct criterion | REQ 4a | `tests/tremor.spec.ts` |
| **Voice control** | Speech through Amazon Transcribe drives commands and free-form requests, in English and Spanish. | No direct criterion | REQ 2a, 5a | `tests/voice.spec.ts`, `tests/e2e-voice.spec.ts` |
| **Hands-free dwell** | Resting the head's aim, or the eyes where tracked, presses a control after 1 s, or 1.6 s for cards. A control cannot repeat until the gaze has left it, and sweeping across controls selects nothing. Enabled by `?handsfree` or by voice. | No direct criterion | REQ 2a, 2c | `tests/handsfree.spec.ts`, `tests/edge-cases.spec.ts` |
| **Confirmation before spatial change** | An AI request yields a proposal listing each change and its reason. Nothing moves until Apply; Discard leaves the state unchanged; Undo reverses applied steps. | 3.2.5 Change on Request (AAA); 3.3.6 Error Prevention (All) (AAA) | REQ 15d | `tests/interaction.spec.ts`, `tests/edge-cases.spec.ts` |
| **Pointer cancellation** | A ray pinch completes on release, however long it is held; moving off the panel before release aborts it. | 2.5.2 Pointer Cancellation (A), for ray input | REQ 4a | `tests/edge-cases.spec.ts` |
| **Selection over dragging** | Moving a card is two discrete selections: pick, then drop. Repositioning a panel by hand does use a drag, on its grab bar; Fit room and spoken requests reposition panels without one. | 2.5.1 Pointer Gestures (A); 2.5.7 Dragging Movements (AA), in part | REQ 4c | `tests/interaction.spec.ts` |
| **Target geometry** | Every interactive target is at least 6 x 6 cm in the world, and every direct-touch target is within arm's reach. | 2.5.8 Target Size (Minimum) (AA); CSS pixels have no direct meaning in XR | REQ 4b | `tests/interaction.spec.ts` |
| **Calibration and field of view** | A guided setup records seating position and a comfortable reach measured by a pinch, and can be reopened at any time. The layout is fitted to the field of view the headset reports. | No direct criterion | REQ 13a, 13b | `tests/setup.spec.ts`, `tests/reach.spec.ts`, `tests/glasses.spec.ts` |
| **Motion restraint** | The viewer is never moved: locomotion is disabled. Panels move only on request, on a critically damped spring without overshoot. Motion sickness has not been measured. | No direct criterion | REQ 16a | `tests/glide.spec.ts` |
| **High contrast and spatial audio** | High contrast is a control and a voice command; contrast ratios have not been audited. Cues sound from the position of their panel. | Not assessed (1.4.3, 1.4.11) | REQ 6a, 17a | `tests/accessibility.spec.ts`, `tests/spatial-ai.spec.ts` |

### Known limitations

- **Lost pinch.** After a pinch slides off a control into empty space, the next pinch is lost; the following one works.
- **Direct touch** presses on contact by design, so it has no cancellation: 2.5.2 applies to ray input only.
- **Scanning coverage.** One-switch scanning reaches the command panel and the agent's card, not the cards on the boards, so
  XAUR REQ 2b (all areas reachable by one input method) is only partly met.
- **Assistive technology.** The immersive canvas exposes no accessibility tree, so screen readers are not supported, and the
  programmatic-access criteria (1.3.1, 4.1.2, 4.1.3) are not met.
- **Preferences not exposed.** Dwell time, scan interval, reduced motion, mono audio and reading scale are implemented, validated
  and tested as stored preferences, but this build has no control for them. WCAG 2.2.1 Timing Adjustable and 2.3.3 Animation
  from Interactions and XAUR REQ 15b and 18a are therefore not claimed.
- **Network.** Voice control and the AI need a connection, and listening starts from the Talk control, with no wake word.
- **Room memory.** The app remembers one room per browser profile, and a new fit replaces the last.

Exact test instructions are in the [technical judge's guide](docs/JUDGE_GUIDE.md). Every finding, with its evidence, is in the
[engineering audit](docs/ENGINEERING_AUDIT.md).

## Run locally

Prerequisites: **Node.js 22.12+** (see `.nvmrc`; 24 also works), npm, and **JDK 17** with `JAVA_HOME` set. The Gradle
wrapper supplies Gradle. The shared engine's JavaScript build is committed under `vendor/spatialdesk-shared`.

### Windows PowerShell

From the repository root:

```powershell
npm ci
.\server\gradlew.bat -p server :app:bootJar
$env:SPATIALDESK_AGENT_MODE = 'built-in'
$env:SPATIALDESK_VOICE_ENABLED = 'false'
npm run server:run
```

Keep that terminal running. In a second terminal at the repository root:

```powershell
npm run typecheck
npx @iwsdk/cli dev up --no-open
npx @iwsdk/cli dev status
```

Open **http://localhost:8081/?emulate&lang=en-US** and **http://localhost:8081/companion.html**. The backend listens on
**8080**, and the development server proxies `/api` and `/ws` to it; **http://localhost:8080/actuator/health** answers
when it is up. If 8081 is taken, use the URL that `dev status` reports. `--no-open` uses your own browser; `npm run dev`
opens the SDK-managed one instead, and `npm run dev:down` stops it.

### macOS / Linux

The same npm commands; start the backend with:

```sh
./server/gradlew -p server :app:bootJar
SPATIALDESK_AGENT_MODE=built-in SPATIALDESK_VOICE_ENABLED=false npm run server:run
```

### With Amazon Nova and Amazon Transcribe

The steps above use the **built-in planner with voice off**, so the workspace, the setup and the helper flow need no AWS
account. That is a deterministic fallback, not Nova. For the full path, give the server AWS credentials through the
standard credential chain with access to Bedrock (the inference profile `us.amazon.nova-2-lite-v1:0` in `us-east-1` by
default) and Transcribe streaming, set `SPATIALDESK_AGENT_MODE=bedrock` and `SPATIALDESK_VOICE_ENABLED=true`, and restart
the backend. AWS usage may incur charges.

Plain HTTP is fine for `localhost`. On a physical headset, use the production HTTPS URL: a LAN address over HTTP is not
an equivalent WebXR setup.

## Verification

```powershell
npm run typecheck
npm run build
npm run check:size
.\server\gradlew.bat -p server build
npm run test:xr
```

`npm run ci` runs the type check, the 227 Playwright scenarios (including the performance gate) and the size budget; a
pre-push hook runs it before every push. The Playwright configuration builds the app and serves it on port **4173**
(free it first) and uses the installed **Microsoft Edge**; elsewhere, set `PW_CHANNEL` (for example `chrome`).
Real-service end-to-end tests (`npm run test:e2e`) also need the backend and AWS access.

TypeScript runs in strict mode and Kotlin with strict null interop; no separate formatter or linter (ESLint, Prettier,
ktlint, Detekt) is configured. Emulator runs are not a substitute for testing on a physical headset or with users.

## Repository map

| Path | Purpose |
| --- | --- |
| `src/` | The spatial app: workspace, assistant, comfort setup, accessibility input, companion client |
| `public/scenes/`, `public/ui/` | Scene composition and spatial UI documents |
| `server/app/` | Spring Boot API: Nova planning and guardrails, Transcribe signing, helper service |
| `server/shared/`, `vendor/spatialdesk-shared/` | The Kotlin Multiplatform workspace engine and its JavaScript build |
| `server/infra/` | AWS CDK infrastructure in Kotlin |
| `tests/` | Playwright scenarios in IWER, and their fixtures |
| `scripts/`, `docs/video/` | Build, size and deploy scripts; the demo video's reproducible pipeline |
| `docs/JUDGE_GUIDE.md`, `docs/HARDWARE_MITIGATION.md`, `docs/JUDGE_FAQ.md` | For the technical evaluation |
| `docs/ARCHITECTURE.md`, `docs/ENGINEERING_AUDIT.md`, `docs/ROADMAP.md` | How it is built, what we found wrong, what comes next |
| `docs/META_SUBMISSION.md` | The submission text |
| `docs/RELEASE_READINESS.md` | What was checked for this release, and how |

The application and the video pipeline are under feature freeze for judging. People filmed for the demo video, media
files, credentials and generated outputs are never committed.
