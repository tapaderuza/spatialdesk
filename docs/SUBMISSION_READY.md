# SpatialDesk: submission status (2026-10-28)

## Git and performance

- **Pushed:** `main` on https://github.com/tapaderuza/spatialdesk, with the full pre-push CI (typecheck, 153 tests passed and
  5 skipped as before, size check) and without `--no-verify`. The previous push was `c1ad445`.
- **Frame time (whole frame, p95, CPU throttled 3x, Intel UHD 630), latest full run:** 27.1 ms (limit 29.4 ms), median
  16.4 ms. The app's own systems: 1.5 ms p95 (limit 3 ms). 78 draw calls (limit 80), 67 bytes allocated per frame.
- **Still not reached:** p95 below 25 ms consistently. The same code measures 24 to 33 ms across runs on this laptop;
  what is left of the frame is the framework (pointer raycasts, render) and the emulator, not our code. The performance
  test retries twice so noise does not fail the CI; its budgets are unchanged.

## Production

- **In production now: `main = 9f5497a`** (English first, the guided setup, the voice phrases, on top of the panel
  cache, sofa and bed mode, the amber frame and the controller pulse). Deployed the same day with the user's explicit
  authorization for that commit (the one before it, for `c1ad445`, was a separate go-ahead). `node scripts/deploy.mjs`
  needs `JAVA_HOME=C:\Program Files\Java\jdk-17` and `GRADLE_USER_HOME=D:\.gradle` on this machine; the CDK stack took
  124 s. The end-to-end tests against production passed 2 of 2 (the link syncs its clock in 117 ms; plan in 1.9 s,
  Nova 2 Lite, three steps).
- **How the live version was checked:** the page at https://d2p3027seoreck.cloudfront.net/ names
  `assets/index-mKbjlmfo.js`, the same file the local build of `9f5497a` names (7.1 MB served, HTTP 200); that bundle
  holds the new storage keys (`spatialdesk.calibrated`, `spatialdesk.language`, `spatialdesk.seat`) and the setup orb,
  and `ui/setup.uikitml` answers 200. The previous bundle, `index-BOwyVc7t.js` (`c1ad445`), is still downloadable but no
  page points to it.
- **Not checked on production:** the guided setup and English-first were not walked through in the live app (the
  end-to-end tests cover the link and the plan, not the setup); they were tested on the preview build, in the emulator.

## Video

- **Public link:** https://youtu.be/jtqAi3gl-os (155 s, "SpatialDesk: a workspace that adapts to your body and your mind
  (Meta Quest, Meta VR Glasses)"). Public, not made for kids; YouTube's oEmbed answers 200 without signing in.
- It shows her request in Spanish, the space adapting, her companion's question, the saved setup, steady aim, one switch,
  fit to my reach, a session at her pace, a return point, the AI log and her own room. It does not show the guided setup
  or the sofa and bed mode: both are newer than the recording.

## Devpost (project 1254068, shown as SUBMITTED, 5/5 steps)

- Saved: new tagline and story, the new video link (the public page embeds the new video and not the old one), the 9
  old stills removed and the 11 new ones in story order with the cover first, and the Additional info texts
  (capabilities used, hand interactions, future of VR).
- The four contest declarations were ticked by the user in the original submission; they were left as they were.

## Code changes in this push

- **English first** (`src/i18n/language.ts`): the app, listening and reading aloud are in English whatever the browser's
  language is; another language comes from the link (`?lang=es-ES`) or from the person ("speak Spanish", "habla
  español", remembered in that browser). New English phrases: "Put it within my reach" (and its variants), "recalibrate".
  "I'm on the sofa" and "Undo" were already understood. `tests/english-first.spec.ts` (6).
- **Guided setup** (`src/onboarding/setup.ts`, `public/ui/setup.uikitml`): the first time in VR, three big questions:
  where you sit (Desk / Sofa/Bed), reach out and pinch an orb 50 cm away (the pinch's own reach, height and side become
  the space, applied when you press Start, in one Undo), and whether you want pointer stabilization (steady aim). Skip
  at any step; "recalibrate" or the Recalibrate button on the My setup card brings it back. The seat chosen makes Fit
  room accept a sofa or bed by itself. `tests/setup.spec.ts` (6).
- **The test that failed once** (`comfort.spec.ts` "start small"): not reproduced in 48 runs under load, four causes
  ruled out by measurement; but a lost press on a panel that had just changed its buttons was reproduced in a new test
  (8 times in 25) and fixed in `pressXR` (it aimed at where the button was, not where it is): 25 of 25 after. Whether that
  is also what failed once in "start small" is not proven; that test now reports the agent's state if it ever fails again.
  Details in `docs/AUTONOMOUS_EXECUTION_LOG.md`, blocks 11 to 13.
- Earlier, already pushed: fit to my reach, the one-switch scan frame, steady aim, sofa and bed mode (30 cm to 1.15 m),
  the amber frame and pulse when the space settles, the panel cache and the profiler.

## Not done, and why

- `D:\d` (two stray screenshots saved under a mistaken path) was not deleted: the tool's safety check refused the
  removal. Delete the folder by hand.
- Haptics on a real controller, and the guided setup with real hands: the pulse is requested and counted in the
  emulator, and a controller trigger stands for the pinch; a headset's own behaviour is not verified here.
- Transcribe language identification (noticing Spanish without being told): needs a server change and a real-audio
  check, and a wrong guess would break the voice of the judges. Not attempted.
- Buttons answered in Spanish: the planner's reply follows the language of what was said; a button with no spoken words
  (Plan my day, Start small) is answered in English even when the panels are in Spanish.
- Ideas still open from the catalogue (`docs/IDEAS_SALUD_ACCESIBILIDAD_2026-10-27.md`): a carer who sets up the space
  from a phone (the `/api/assist` server exists), visual and haptic alerts.
- No physical headset evidence, by the project's own rule.
