# SpatialDesk: submission text

Copy each section into the field of the same name. Every figure below is measured by the project's own checks; where a
figure comes from the emulator rather than a physical headset, the text says so.
The story (Inspiration to What's next) is the one on Devpost since the night of 2026-11-17 to 18: it answers the Accessibility
Forward award item by item, reports the tester's Quest 3 runs, and ends with honest limits.

## Project name

SpatialDesk

## Tagline

The workspace that adapts to your body on a bad day, so you don't have to adapt to it.

## Inspiration

"Hoy es un mal día. Acércalo todo." Today is a bad day. Bring everything closer.

Someone I love, who lives with a disability, said that from her sofa. On a bad day her neck hurts, her arms tire and her aim shakes; spatial apps expect you to turn, reach and pinch the air. Accessibility usually means a menu of toggles, changed on the day you have least to spare. In a headset the room can move, so the room should adapt.

## What it does

SpatialDesk is a seated, hands-first workspace for Quest: boards, focus timers and an AI assistant. The space comes to your reach, measured by your own hand; a flat screen has nothing to bring closer.

- **It fits you.** A one-minute setup sets every panel's distance, height and side from one pinch where your hand reaches comfortably.
- **Say what you need.** Transcribe hears English or Spanish; Nova 2 Lite proposes changes, each with its reason. Nothing moves until you tap Apply, and Undo always works.
- **Your real room.** In passthrough, Fit room stands your board on your desk and the others on your walls, anchored for tomorrow.
- **Any field of view.** Essential panels stay in comfortable view, down to Meta VR Glasses' 58° × 54°.
- **First five minutes.** Setup, then three guided steps learned by doing. With `?fast`, the closing focus block lasts 25 seconds and grows your plant's first leaf.
- **Seated, anywhere.** No install; once loaded it works offline, and a built-in planner answers if Nova cannot.

**Accessibility Forward, as the award names it**

- **Voice alternatives for hand interactions.** Press **Talk** and say any button's name, a setup answer, "bigger text", "high contrast on" or "move focus mode to Done", in English or Spanish; anything longer becomes an AI proposal you approve. No microphone? On the start page, **Neck hurts**, **Tired eyes** or **Left hand only** asks in one press.
- **Eyes-only navigation for limited mobility.** Hands-free: a held gaze presses any control while a ring fills (1 s for buttons, 1.6 s for cards). Too fast or too slow? Say "slower gaze" or "faster gaze" (0.7 to 3.2 s), or set it in the link. A 3-second look at **No hands? Look here** turns it on from the first screen; the setup, a card into Doing and a focus block then need no hands. On Quest 3 and 3S, which have no eye tracking, the head aims; where the headset tracks the eyes, it uses them.
- **High-contrast modes.** **Contrast**, or "high contrast on": black panels, white text, a white outline on every target. Every panel text measures at least 8.19:1 against its background (7.23:1 in the normal theme; WCAG AAA asks 7:1), and a test fails the build below 7:1.
- **Inclusive by default.** Seated, with locomotion off; one pinch fits every panel to your seat and reach; steady aim for tremor; one-switch scanning at your own pace ("slower scan"); "less motion" and "mono audio"; Read aloud speaks each proposed change with its reason. After you press Allow, a carer's phone can open the setup in your headset.

**Tested on a real Quest 3**

A tester from Meta's developer forum ran SpatialDesk on a Quest 3, in VR and in passthrough, and found what the emulator could not show: the console over the board until a restart, panels too close after a near pinch, a gaze ring too easy to start, and the app quitting by itself. Each has a client fix and a test: the space re-checks your head a second or two in, a near pinch brings it at most 20% closer and shrinks the panels to match, and "No hands? Look here" needs a 3-second look. Their next run: "the panels are positioned much better now. The app no longer closes unexpectedly." Exit now also asks for a second press, against the likely cause of those quits: a fingertip on it.

## How we built it

Meta's Immersive Web SDK over WebXR. One Kotlin Multiplatform engine runs in the headset and on a Spring Boot server that validates every Nova plan before you see it; scene understanding uses WebXR planes and anchors. 253 Playwright scenarios drive the production build in Meta's IWER emulator, and a CI gate keeps frame time under Meta's IWSDK starter scene. With `?fps`, the console shows the frame rate on the headset itself.

## Challenges we ran into

Turning comfort into geometry: reach, head-turn limit, tilt, side and text size conflict, so one shared engine solves them, and every comfort rule is a test that fails the build.

Testing without a headset: the emulator never showed a pose that settles late, or fingertips near Exit. One tester's Quest 3 did, in a day.

## What's next for SpatialDesk

**Target launch date: March 2027**, on the Meta Horizon Store as an installable web app, free at launch. Before then: sessions with disabled users and carers, and more headsets, Quest 3S included.

**Honest limits**

One tester on one Quest 3 is not a study, and no session with disabled users has run yet. Frame time is measured in the emulator by CI; `?fps` shows it on a headset, but no number from a real Quest is in yet. One-switch scanning reaches the console and the AI's card, not the cards on the boards. Voice and the AI need the network; boards, timers and Undo do not.

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
