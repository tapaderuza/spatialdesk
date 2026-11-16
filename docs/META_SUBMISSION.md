# SpatialDesk: submission text

Copy each section into the field of the same name. Every figure below is measured by the project's own checks; where a
figure comes from the emulator rather than a physical headset, the text says so.
The story (Inspiration to What's next) is the one on Devpost since 2026-11-16: 446 words, shorter for a skim, still naming the
device features and the first five minutes the judging criteria score.

## Project name

SpatialDesk

## Tagline

The workspace that adapts to your body on a bad day, so you don't have to adapt to it.

## Inspiration

"Hoy es un mal día. Acércalo todo." Today is a bad day. Bring everything closer.

Someone I love, who lives with a disability, said that from her sofa. On a bad day her neck hurts, her arms tire and her aim shakes; spatial apps expect you to turn, reach and pinch the air. Accessibility usually means a menu of toggles, changed on the day you have least to spare. In a headset the room can move, so the room should adapt.

## What it does

SpatialDesk is a seated, hands-first workspace for Quest: boards, focus timers and an AI assistant. The space comes to your reach, measured by your own hand; a flat screen has nothing to bring closer.

- **It fits you.** A one-minute setup sets every panel's distance, height and side from one pinch where your hand rests.
- **Say what you need.** Transcribe hears English or Spanish; Nova 2 Lite proposes changes, each with its reason. Nothing moves until you tap Apply, and Undo always works. No microphone? One press asks for the same.
- **Every way in.** Voice for every button, the setup and card moves; gaze alone from the first screen; high contrast; steady aim for tremor; one-switch scanning.
- **Your real room.** In passthrough, Fit room stands your board on your desk and the others on your walls, anchored for tomorrow.
- **Any field of view.** Essential panels stay in comfortable view, down to Meta VR Glasses' 58° × 54°.
- **Help from a phone.** After you press Allow, a carer's phone can open the setup in your headset.
- **First five minutes.** Setup, then three guided steps learned by doing. With `?fast`, the closing focus block lasts 25 seconds and grows your plant's first leaf; every block adds one.
- **Seated, anywhere.** Locomotion is off and the board sits 62 cm away. No install; once loaded, boards, timers and Undo work offline, and a built-in planner answers if Nova cannot.

## How we built it

Meta's Immersive Web SDK over WebXR. One Kotlin Multiplatform engine runs in the headset and on a Spring Boot server that validates every Nova plan before you see it; scene understanding uses WebXR planes and anchors. 237 Playwright scenarios drive the production build in Meta's IWER emulator, and a CI gate keeps frame time under Meta's IWSDK starter scene.

## Challenges we ran into

Turning comfort into geometry: reach, head-turn limit, tilt, side and text size conflict, so one shared engine solves them, and every comfort rule is a test that fails the build.

## What's next for SpatialDesk

**Target launch date: March 2027**, on the Meta Horizon Store as an installable web app, free at launch. Before then: testing on Quest 3 and 3S hardware, and sessions with disabled users and carers.

## Built with

Meta Immersive Web SDK (IWSDK), Meta IWER, Meta Quest Browser, WebXR, TypeScript, Vite, Playwright, Kotlin, Kotlin Multiplatform, Spring
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
- Without hands (hands-free on, timers in seconds): https://d2p3027seoreck.cloudfront.net/?fast&handsfree

## Video demo link

https://youtu.be/FWbl6vpkiH4
