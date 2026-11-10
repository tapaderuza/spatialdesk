# SpatialDesk: submission text

Copy each section into the field of the same name. Every figure below is measured by the project's own checks; where a
figure comes from the emulator rather than a physical headset, the text says so.
The story (Inspiration to What's next) is the one on Devpost since 2026-11-10, when What it does, How we built it and a
quick-look link changed: under the 500 words the form suggests, and naming the device features the judging criteria score.

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

SpatialDesk is a seated, hands-first workspace: boards, focus timers and an assistant. The space moves to your reach,
measured by your hand; a flat screen has nothing to bring closer.

- **It fits you.** A one-minute setup: where you sit, and a pinch where your hand rests, set every panel's distance,
  height and side.
- **You say what you need.** Transcribe hears English or Spanish; Nova proposes changes. Nothing moves until you tap
  Apply, and Undo always works.
- **Every way in.** Hands, gaze dwell, voice, steady aim for tremor, one-switch scanning.
- **Your real room.** In passthrough, Fit room stands your board on your real desk and the others on your walls; an
  anchor restores them tomorrow. Tested in all 13 rooms of Meta's Synthetic Environment Module, in the emulator.
- **Any field of view.** Essential panels stay in the comfortable view, down to Meta VR Glasses' 58° × 54°.
- **Help from a phone.** After you press Allow, a carer's phone can open the setup in your headset.
- **First five minutes.** Setup, then three guided steps learned by doing. With `?fast`, the focus block that ends them
  lasts 25 seconds and your plant grows its first leaf; every block grows another.
- **Airplane seat.** Locomotion is off. The board sits 62 cm away; cards and buttons answer a ray from a resting hand.
- **One bus stop.** No install. A session takes one task and 5 to 90 minutes; a pause keeps your next step.
- **Take it away.** Offline, boards, timers, Undo, hands and gaze keep working on a loaded page; if Nova fails, a
  built-in planner answers.

## How we built it

Meta's Immersive Web SDK over WebXR. One Kotlin Multiplatform engine runs in the headset and on the Spring Boot server,
which validates every Nova 2 Lite plan before you see it. Scene understanding uses WebXR planes and anchors, not MRUK.

227 Playwright scenarios drive the production build in Meta's IWER emulator; a CI gate holds frame time under Meta's
IWSDK starter scene (p95 22.2 vs 29.4 ms, CPU throttled 3x).

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
- The judge's guide: https://github.com/tapaderuza/spatialdesk/blob/main/docs/JUDGE_GUIDE.md
- The privacy policy: https://github.com/tapaderuza/spatialdesk/blob/main/docs/PRIVACY.md
- A quick look, with timers in seconds: https://d2p3027seoreck.cloudfront.net/?fast

## Video demo link

https://youtu.be/FWbl6vpkiH4
