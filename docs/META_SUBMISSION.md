# SpatialDesk: submission text

Copy each section into the field of the same name. Every figure below is measured by the project's own checks; where a
figure comes from the emulator rather than a physical headset, the text says so.

## Project name

SpatialDesk

## Tagline

The workspace that adapts to your body on a bad day, so you don't have to adapt to it.

## Inspiration

"Hoy es un mal día. Acércalo todo." Today is a bad day. Bring everything closer.

That sentence, said from a sofa, is where SpatialDesk starts. The same person can reach comfortably on Monday and not on
Tuesday. An arm that held a controller for an hour yesterday tires in minutes today. Turning towards a panel, holding a
hand steady, facing a long task list: on a hard day, each of these becomes a barrier before any work begins.

Accessibility settings usually answer this with a menu: a page of toggles you must find, understand and change, on
exactly the day you have the least to spare. We think that is backwards. In spatial computing the environment itself can
move, so the environment should do the adapting. You should be able to say what kind of day it is, in your own words, and
have the space come to you.

## What it does

SpatialDesk is a mixed-reality workspace for seated productivity: task boards, focus timers and an assistant, arranged
around the body of the person using it.

- **It fits the space to you.** A short guided setup asks where you sit (desk, or sofa and bed), has you pinch where your
  hand naturally rests to measure your comfortable reach, and checks whether your aim needs steadying. The whole
  workspace is laid out from that profile.
- **You say what you need.** "Bring everything closer." "Make the text bigger." "Today is a bad day." Amazon Transcribe
  hears you, in English or Spanish, and Amazon Nova turns the request into a concrete proposal: what will move, where,
  and why.
- **Nothing changes until you agree.** Every proposal is a card you can apply, answer or dismiss. When you apply it, the
  panels glide (never jump) into their new places, and Undo brings back the previous layout.
- **It understands "this".** Rest your head on a card for a second and a soft rim marks it; then "move this to done" acts
  on that card. Hands, controllers, a fingertip poke, voice, head-directed dwell and switch access all work.
- **Someone who cares can help, from a phone.** Say "invite a helper" and the headset shows a short code. A family member
  types it into the companion page on any phone; nothing is shared until the person in the headset presses Allow. Then
  the phone follows the Today board (task titles and columns only, nothing else) and offers one very large button:
  **Help / Recalibrate**. Pressing it opens the guided setup in the headset, where the wearer can follow it or skip any
  step. The helper can ask; only the wearer decides. Sharing stops when they say so, or by itself after 15 minutes.

SpatialDesk is a productivity prototype, not a medical device: it does not diagnose or treat anything.

## How we built it

**The spatial client** is TypeScript and Vite on Meta's Immersive Web SDK (IWSDK): an entity-component-system world,
spatial UI panels, hand and controller rays, and direct poke on buttons and cards. It runs in Meta Quest Browser through
WebXR, in VR or in your room with passthrough.

**One workspace engine, in two places.** The board model, the comfort profile and the layout are a Kotlin Multiplatform
module. The browser runs it compiled to JavaScript to place every panel; the Spring Boot server runs the same code on the
JVM to validate everything the model proposes. A plan the browser could not apply never reaches it.

**Voice.** The browser captures the microphone as 16 kHz PCM and streams it straight to Amazon Transcribe over a
short-lived URL signed by our server: audio never passes through our backend, and AWS credentials never reach the
browser.

**The assistant.** The transcript, the comfort profile and the card your head rests on go to Amazon Nova 2 Lite through
the Amazon Bedrock Converse API. Nova answers through a typed tool, so the result is a list of operations, not free text
to parse. Server-side guardrails then check it against what was asked: "closer" must end nearer than the board is now,
"further" further, and a proposal that breaks a rule is retried or replaced by a clearly labelled built-in plan. Nova is
warmed up when the server starts, so the first request of the day takes about 1.7 s instead of 3.3 s; while it thinks,
an orb breathes in front of you.

**The companion** is a plain, fast web page (no 3D engine) with large type, large targets and both colour schemes. It
pairs through a one-time code, polls an approved snapshot every two seconds and sends help requests the headset can act
on or skip.

**Infrastructure.** S3 and CloudFront serve the web clients; the API runs on ECS Fargate behind an Application Load
Balancer; everything is defined in AWS CDK, in Kotlin.

**Verification.** 199 Playwright scenarios drive the real production build in Meta's IWER headset emulator: the guided
setup, voice, the agent's proposals, gaze dwell, poke, the companion flow, accessibility inputs and failure cases such
as the network dropping. A performance gate fails the build if the frame time slips. Our demo video is recorded the same
way: the real app in IWER, driven by a script, with live Nova and Transcribe.

## Challenges we ran into

**Making "closer" mean something, mathematically.** A comfortable layout is not one number. Every panel's distance
scales with the reach measured in the setup; its angular width has to stay inside how far that person can turn their
head; a preferred side and a tilt shift the whole arrangement; and a panel that needs an answer must always stand in
front of the boards (at least 7 cm, never nearer than 28 cm to the eyes), or the board steals its ray and its fingertip.
These constraints fight each other: bigger text makes a board wider, which pushes its edges past the turn limit, which
pulls it closer, which can crowd the panel in front of it. We solved the layout in the shared engine so that the browser
and the server agree on every pose, and we keep the user's heading stable while seated: a head turned less than 70° is
a glance at a panel, not a new direction to rebuild the room around.

**Trusting the model, but checking it.** In testing, "bring everything closer" once came back as a board moving from
53 cm to 62 cm: further away. A wrong layout is worse than none for someone with limited reach. We added direction rules
on the server, enforced by the shared engine and covered by tests: whatever the model proposes, "closer" always ends
nearer than now.

**Moving the world without making anyone queasy.** Teleporting a board half a metre breaks the room. Every move is a
critically damped spring on position, yaw, pitch and scale: it never overshoots, settles within 2% in 0.75 s, carries its
speed into a new target when two commands arrive in a row, and allocates nothing per frame.

**Keeping latency low end to end.** Speech, inference, the network and rendering run on very different clocks. We stream
audio directly to Transcribe, warm Nova up at start-up, keep all model work off the render loop, show the orb while the
model thinks, and keep the headset's frame budget sacred: in our CI gate, with the CPU throttled 3x, the whole frame's
95th percentile is 24.6 ms against 29.4 ms for Meta's IWSDK starter scene, with 78 draw calls and a 2.32 MB gzipped
bundle. Those are emulator measurements; on-headset measurement is part of what comes next.

**Help without taking control.** A carer needs to be able to help without being able to rearrange someone else's space.
We built explicit approval, a minimal shared snapshot, short-lived codes and sessions, and a single help request that the
wearer can always skip.

## Accomplishments that we're proud of

- A sentence said on a sofa, in Spanish, becomes a reviewed, applied and undoable change to a 3D workspace, end to end
  with live AWS services.
- One layout engine shared by browser and server, so a proposal is validated against exactly the rules that will place
  it.
- 199 automated scenarios in Meta's emulator, and a performance gate that keeps every change honest.
- A companion any family member can use on any phone, with consent built into every step.

## What we learned

Accessibility in spatial computing is less about adding settings and more about removing the need for them. And an AI
assistant earns trust when it proposes rather than acts, explains its proposal, and can be checked by rules it cannot
argue with.

## What's next for SpatialDesk

**Target launch date: March 2027**, on the Meta Horizon Store as an installable web app, free during the launch period.

- **Testing with the people it is for:** structured sessions with disabled users and carers, measuring time to a
  comfortable setup, task completion, unwanted actions, recovery through Undo, and comfort over a whole session.
- **On-headset performance work** on Meta Quest 3 and 3S, alongside the emulator gate.
- **A comfort profile that travels:** good days and bad days remembered, so the space can offer yesterday's layout
  before you ask.
- **More ways in:** eye tracking where the device supports it, and wider assistive-input compatibility.
- **A richer companion:** notifications instead of polling, and shared routines that a family sets up together, always
  with explicit consent and a way to stop.

The long-term vision is simple: a space that changes as your day changes, without making you start again, dig through
settings or hand control to an assistant.

## Built with

Meta Immersive Web SDK (IWSDK), Meta IWER, WebXR, TypeScript, Vite, Playwright, Kotlin, Kotlin Multiplatform, Spring
Boot, Amazon Bedrock, Amazon Nova 2 Lite, Amazon Transcribe, AWS CDK, Amazon S3, Amazon CloudFront, Amazon ECS on AWS
Fargate, Elastic Load Balancing.

## Try it

- SpatialDesk: https://d2p3027seoreck.cloudfront.net/
- Without a headset (Meta's IWER emulator): https://d2p3027seoreck.cloudfront.net/?emulate&lang=en-US
- The companion, on a phone: https://d2p3027seoreck.cloudfront.net/companion.html
- The code: https://github.com/tapaderuza/spatialdesk
- Step-by-step judge's guide and local setup: `README.md` in the repository.

## Video demo link

https://youtu.be/6N9PWPoEBKU
