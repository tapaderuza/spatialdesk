# SpatialDesk: submission text

Copy each section into the field of the same name. Every figure below is measured by the project's own checks; where a
figure comes from the emulator rather than a physical headset, the text says so.
The story (Inspiration to What's next) is the one submitted on 2026-10-30: under the 500 words the form suggests, and
naming the device features the judging criteria score.

## Project name

SpatialDesk

## Tagline

The workspace that adapts to your body on a bad day, so you don't have to adapt to it.

## Inspiration

"Hoy es un mal día. Acércalo todo." Today is a bad day. Bring everything closer.

Someone I love, who lives with a disability, said that from her sofa. On a bad day her neck hurts, her arms tire and her
aim shakes; spatial apps expect you to turn, reach and pinch the air. Accessibility usually means a menu of toggles,
changed on the day you have least to spare. In a headset the room can move, so the room should adapt.

## What it does

SpatialDesk is a seated, hands-first workspace: task boards, focus timers and an assistant, arranged around the body you
have today.

- **It fits you.** A one-minute setup asks where you sit and has you pinch where your hand rests; that sets every
  panel's distance, height and side.
- **You say what you need.** Amazon Transcribe hears you in English or Spanish; Amazon Nova proposes changes with
  reasons. Nothing moves until you tap Apply; panels glide, and Undo always works.
- **Every way in.** Hands (poke, pinch), gaze dwell (eyes where tracked, else head), voice, steady aim for tremor,
  one-switch scanning. Rest your head on a card and say "move this to done".
- **Your real room.** In passthrough, Fit room reads the detected planes: your board stands on your real desk, the
  others on your walls, and a persistent anchor restores them tomorrow. Tested in all 13 rooms of Meta's Synthetic
  Environment Module.
- **Any field of view.** The layout reads each eye's projection and keeps essential panels in the comfortable view, down
  to Meta VR Glasses' 58° × 54°.
- **Help from a phone.** After you press Allow, a carer's phone shows your Today board and one large button, Help /
  Recalibrate, that opens the setup in your headset. They ask; you decide.
- **A reason to come back.** A focus plant grows a leaf with every focus block.

## How we built it

Meta's Immersive Web SDK, in TypeScript over WebXR. One Kotlin Multiplatform engine holds the layout and the rules: the
headset runs it as JavaScript; the Spring Boot server runs it on the JVM to validate every Nova 2 Lite plan (Bedrock
Converse, typed tool) before you see it. Guardrails enforce intent ("closer" must end nearer), and a built-in planner
answers when the AI cannot: SpatialDesk works without it. Audio streams from the browser straight to Transcribe.

199 Playwright scenarios drive the production build in Meta's IWER emulator; a CI gate holds frame time (p95 24.6 ms,
CPU throttled 3x) under Meta's IWSDK starter scene (29.4 ms), at 78 draw calls.

## Challenges we ran into

Turning comfort into geometry: reach, head-turn limit, tilt, side and text size conflict, so one shared engine solves
them, and every comfort rule is a test that fails the build.

## What's next for SpatialDesk

**Target launch date: March 2027**, on the Meta Horizon Store as an installable web app, free at launch. Before then:
testing on Quest 3 and 3S hardware, sessions with disabled users and carers, and comfort profiles for good and bad days.

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

https://youtu.be/FWbl6vpkiH4
