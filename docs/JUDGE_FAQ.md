# Five hard questions

The questions a senior XR engineer is most likely to ask after reading this code, answered from the architecture as it ships. Each
answer gives the short version, the evidence, and the limit. Figures were measured on 2026-11-04 and 2026-11-05 against the emulator or the
production service, as stated. Nothing here has run on a physical headset; the [hardware document](HARDWARE_MITIGATION.md) deals with that.

## 1. Every headset holds a WebSocket to one Fargate task. What does latency do to the frame loop, and what happens when that task dies?

**Short answer: latency cannot reach the frame loop, because nothing in it touches the socket. When the task dies, the cards never
notice, and an open page reconnects by itself: 2.2 s, when we replaced the production task under one.**

The socket carries a hello, pings and keep-alives, and no workspace state. Workspace changes run through a local copy of the engine and persist
to IndexedDB; AI requests are separate HTTPS calls. `src/backend/link.ts` has no per-frame code. The clock sampled over the socket is reported
by the link, and no feature depends on it today.

| Measure | Value |
| --- | --- |
| Round trip, a development machine in Europe through CloudFront to `us-east-1` | 127 to 129 ms |
| Server keep-alive | every 25 s (ALB idle timeout 300 s) |
| Reconnection | Full jitter, 0.5 to 30 s; a press of Plan or Talk wakes it at once |
| Plan my day, press to preview, 6 of 6 | 1.8 to 2.3 s, with Nova taking 1.6 to 2.1 s |
| The first plan after a cold start | 4.3 s |

Deployment is one 0.25 vCPU task, with a circuit breaker that rolls back a failed release. Sessions live in the server's memory, so a new task does not
know the old ids, and a refused handshake reaches the browser as a plain close (1006), the same as a lost network. So before reconnecting, the link asks
the socket's path over HTTP (`src/backend/link.ts`). A 401 means the server does not know the id, and the link takes a new session. A 400 means it does, and
the link keeps it, so a dropped connection does not lose a helper pairing.

We replaced the task live on 2026-11-05 with a production page held open, and nobody touched that page:

| After the socket dropped | Time |
| --- | --- |
| The link retries, finds its id unknown, and is issued a new session | 1.3 s |
| Online again | 2.2 s |
| The next Plan, answered by Nova, the new task's first | 3.6 s after that |

**A press does not wait for the backoff.** With 16 s of backoff still to run, Plan answered in 0.6 s in the emulator. **Talk** recovers the same way: on a 401 it
takes a fresh session and asks again, in the same press (`tests/failure-modes.spec.ts`).

**The limits.** That is one real replacement, measured once. The old and new tasks overlapped, so there was no outage to sit through. In a real outage the link retries with
backoff of up to 30 s, and a press in the meantime ends in the calm line. A new session also starts its per-session quotas afresh, as a reload does.

## 2. What are your Bedrock limits, and what does a judge see when you hit one?

**Short answer: the app's own caps are far inside the account's quota, and each way of hitting a limit has its own plain outcome. None of
them stops the workspace.**

| Layer | Limit | Source |
| --- | --- | --- |
| Account: requests to Nova 2 Lite, cross-region | 200 per minute, not adjustable | Service Quotas, read 2026-11-05 |
| Account: tokens | 8,000,000 per minute | Service Quotas, read 2026-11-05 |
| Per session | 20 plans per hour | `application.yml` |
| Whole deployment | 300 plans per day (UTC) | `application.yml` |
| Per network | 200 new sessions per hour | Task environment |
| One plan | 24 steps, 1,800 output tokens, 64 KB request | `Planner.kt`, `NovaPlanModel.kt`, `AgentApi.kt` |

A plan runs at about 4,800 input and 200 to 340 output tokens (server log). The model answers through one forced tool call at temperature 0,
so its output is structured or it is rejected.

| What happens | What the person sees |
| --- | --- |
| Throttled, access denied or timed out (6 s) | A plan from the deterministic planner, labelled **Built-in planner**, with the reason |
| An invalid plan | One retry with the exact error, then the same labelled planner |
| The session's hour is spent | *"That is 20 plans this hour. Try again a little later."* |
| The day is spent | *"The AI has done all the planning it can today. Your workspace still works by hand."* |
| No answer within 10 s | *"Network issue. Switched to manual mode."*, and a late answer is discarded |

**The limits.**

- **The daily cap is shared and kept in memory.** 300 plans are shared by everyone and the count resets at a server restart. For scale, the
  account made 472 calls to this model in the 30 days to 2026-11-05, before judging began. A burst of heavy use in one day would end the AI for everyone until
  00:00 UTC, with the line above.
- **Two attempts can outlast the patience.** Each call may take 6 s, so a first plan that fails validation late plus a slow retry can pass the client's 10 s.
  The person then gets the calm line, and it reads "network" when the cause was the model. The late answer is dropped, which is tested.
- **A plan can cost two Bedrock calls** while counting once against the quota.
- **A cold start is slower.** The start-up warm-up call timed out on 2026-11-05 (6 s on 0.25 vCPU while the JVM was starting), so the first plan paid for the
  loading: 4.3 s, with the rest at about 2 s.

## 3. How do your spatial anchors persist, and what happens when they do not?

**Short answer: one persistent anchor of ours, replaced by each fit, on the floor under the viewer, with every panel's pose stored relative to it in the browser. Each failure
we could simulate ends in a plain line or a fit that lasts for the visit, and none brings a layout back in the wrong place.**

*Fit room* (`src/room/room-system.ts`) creates an anchor inside an XR frame, deletes the earlier ones, requests a persistent handle, and stores the handle with every board's and
timer's pose relative to the anchor, in `localStorage`. On entering the room again it restores the anchor by handle and places everything once, relative to where the
anchor now is. Only the anchor's pose is read per frame; planes are read only when fitting. Boards are not parented to the anchor.

Meta's guide says a site can create 8 persistent anchors at a time. SpatialDesk's site holds two: ours, and one that IWSDK keeps for scene understanding. IWSDK reads its anchor every frame, so
that one is never deleted. A ninth is never asked for, and nothing is saved under a handle it does not belong to.

| Case | Behaviour | Test |
| --- | --- | --- |
| Normal return, even after reorganising in VR | Every board returns within 1 cm | `tests/room.spec.ts` |
| The anchor is gone | *"I could not find your room layout here..."*; nothing applied; Fit room replaces the memory | `tests/failure-modes.spec.ts` |
| The saved record is unreadable | Ignored; the room opens | `tests/failure-modes.spec.ts` |
| Anchors unavailable | The fit holds for the visit | `tests/edge-cases.spec.ts` |
| Twelve fits from twelve seats, under a simulated limit of 8 | Never refused; one anchor of ours throughout; the last layout returns within 1 cm | `tests/failure-modes.spec.ts` |
| 8 anchors already held, and a deletion that never answers | The old ones go, IWSDK's stays, and the fit is remembered | `tests/failure-modes.spec.ts` |
| A handle refused, or at the limit with no way to delete | *"Fitted for this visit: the headset could not remember this room."*; nothing saved | `tests/failure-modes.spec.ts` |

**The limits.**

- **All of this is emulated.** IWER's anchors are a model. Real relocalisation, and real drift, have never been tried.
- **Deleting anchors is not in Meta's guide.** `deletePersistentAnchor` comes from the WebXR Anchors draft, and whether Quest Browser implements it has not been tried. If it does not, the
  limit still holds, and the fit stops being remembered once 8 are held.
- **A fit gives up the old memory first.** The earlier anchor goes before the new handle is confirmed, so if the headset then refuses the handle, the earlier layout is gone too, and the next fit starts it again.
- **One room per browser profile.** A fit in another room replaces the last.
- **No correction during a session.** Placement happens once on entry, so a relocalisation in mid-session is not followed.
- **It belongs to one browser profile.** Per Meta's documentation, private mode does not persist anchors and clearing the site's history deletes them.

## 4. Do you collect biometric data from voice? Where does the audio go, and who keeps it?

**Short answer: we compute no voiceprint, store no audio, and audio never touches our server. AWS's use of voice input to improve its services is switched off for this
account, by a policy that can be read back from the account. The [privacy policy](PRIVACY.md) is public.**

**What the app does.** The microphone opens only when the person selects Talk; there is no wake word. The browser converts it to 16 kHz PCM and streams it directly to Amazon
Transcribe over TLS, on a URL the server signs. The tracks stop when the utterance ends. The request names a language, an encoding and a sample rate and nothing else: no
speaker identification, no diarization (`src/voice/listen.ts`, `VoiceApi.kt`). AWS's service card lists speaker identification and biometric recognition as unsupported uses of
Transcribe. Refusing the microphone costs nothing, and the rest of the app works.

**What travels afterwards.** The transcript, not the audio, goes to our server and on to Amazon Nova as part of the request. Our server's logs record intents, step counts,
timings and token counts. They do not log the request or the transcript. A rejected plan's reason can quote a card title or a phrase from the plan, and logs are kept for 14 days.
AWS states that Bedrock does not store prompts and completions or use them to train models, and model invocation logging is not enabled on this account (checked 2026-11-05).

**AWS's default, and our opt-out.** AWS documents that by default Transcribe stores and uses the voice inputs it processes to develop and improve the service, unless the account
opts out through an AWS Organizations policy. **This account has opted out.** Since 2026-11-05 an AI services opt-out policy for all services is attached at the organization's root, with child policies barred from
changing it, and the account's effective policy reads `optOut` (`aws organizations describe-effective-policy --policy-type AISERVICES_OPT_OUT_POLICY`). AWS states that this stops the use of the content for service
improvement and deletes the associated historical content, except what is needed to provide the service. It does not stop the transcription itself: the audio still goes to Transcribe.

**Meta's policies.** We checked the app against Meta's Developer Data Use Policy, as updated on 2026-07-02, since microphone data counts as Device User Data there:

| Clause | What it asks | What SpatialDesk does |
| --- | --- | --- |
| 2.2 | A public privacy policy: what is processed, how, why, and how to ask for deletion | [`docs/PRIVACY.md`](PRIVACY.md) |
| 3.1 | Use only to run the app, for aggregated analytics, or for the law | Only to run the app. No analytics |
| 4.3, 4.4, 4.6 | No sale; no profiling on disability or medical condition; no identifying people through AI | None of these. Comfort settings stay in the browser, and no voiceprint exists |
| 4.11 | No device data to Meta through its business tools | The app contains none |
| 5.1, 5.2 | Sharing only as the user directs, or with a service provider that does not use it for its own purposes | Selecting Talk or Plan is what sends it, and AWS is the only provider. The opt-out above is what ends AWS's own use |
| 6.2, 6.3 | Deletion, and a clear way to ask for it | Clearing the site's data; logs expire in 14 days; requests by [issue](https://github.com/tapaderuza/spatialdesk/issues) |

**The limits.** This is our own reading, not a certificate from Meta or a lawyer. The policy's text does not settle whether a web page capturing the microphone falls under Device User Data or Developer User Data, so we followed the stricter one. We have
not had AWS's terms reviewed against clause 5.2. The Store steps that Meta ties to an app listing (an age group, an IARC rating) belong to the launch, and are in the [roadmap](ROADMAP.md).

**What we do not claim.** No third party has audited this. It is not presented as compliant with any privacy or health regulation, and nobody should enter clinical data.

Sources: [Meta Developer Data Use Policy](https://developers.meta.com/horizon/policy/data-use/),
[AWS AI services opt-out policies](https://docs.aws.amazon.com/organizations/latest/userguide/orgs_manage_policies_ai-opt-out.html),
[Transcribe opt-out](https://docs.aws.amazon.com/transcribe/latest/dg/opt-out.html),
[Transcribe service card](https://docs.aws.amazon.com/ai/responsible-ai/transcribe-speech-recognition/overview.html),
[Nova 2 Lite service card](https://docs.aws.amazon.com/ai/responsible-ai/nova-2-lite/overview.html).

## 5. A browser receives a URL that reaches AWS, and spoken words reach a model that can change the workspace. What stops abuse?

**Short answer: the browser never holds a secret, the server's role can do two things, and the model can only propose. A person applies every change.**

**Credentials.** The server signs each Transcribe URL with SigV4. The URL carries a signature and a temporary token, not a secret key, and must be opened within 30 s. The task role
may call one model through one inference profile and start Transcribe streams, nothing else (`SpatialDeskStack.kt`). The site bucket is private behind CloudFront, and the load balancer
admits only CloudFront's address range, so the per-network count (second-to-last `X-Forwarded-For` hop) cannot be sidestepped by calling it directly. A session id is 128 random bits.

**The model.** Prompt injection, through speech or through a card's title, is assumed to happen. What contains it:

1. The model has one tool, `submit_plan`, with no access to any network, file or credential.
2. Only ten operations are allowed. Deleting boards, moving panels by hand and dismissing timers are not among them.
3. Each step passes the shared engine and the request's guardrails on the server, and the batch applies whole or not at all, which the client's engine checks again (`tests/failure-modes.spec.ts`).
4. **Nothing changes until the person selects Apply**, and everything applied can be undone.
5. Text entering the prompt is bounded (600 characters for the request) and no text from the headset reaches the system prompt. Earlier dialogue is marked as untrusted data, and gaze crosses the wire as ids only.

**The limits.**

- **Stream length is enforced by the client.** A listen ends at 20 s at most in our client, and the server cannot enforce that once the URL is used. A modified client could hold a granted stream
  open, bounded per session and per day by the number of grants (60 per hour, 600 per day), not by their length.
- **`remove_card` and `clear_done` are allowed operations.** A hostile card title could lead the model to propose them. They would appear in the proposal, each with its reason, and need Apply.
- **There is no WAF** and the app has no Content Security Policy header. Both are recorded in the [audit](ENGINEERING_AUDIT.md).
- **No penetration test has been run.**
