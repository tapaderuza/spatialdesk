# SpatialDesk: submission status (2026-10-29)

## Official Feature Freeze (2026-10-29)

**The product is finished.** From `30244e5` on, not one more line of code, feature or fix goes in, unless it is a
critical bug that breaks the demo. Production runs `30244e5` (below), and the judges' video is recorded against it.

**One exception, taken with the user's go-ahead (2026-10-29):** a critical bug that broke the demo (a board brought close
hid the helper's Allow and the guided setup), fixed in `97cb9fe`, pushed, **not deployed** (production stays `30244e5`).

**Second exception, asked by the user (2026-10-29, log blocks 30 and 31):** "closer" could move the board away (fixed on
the server and **deployed as `7dd7e7b`**, confirmed live: 53 cm to 43 cm); the demo's tasks are real; the narration says head pose, not eyes. The freeze is back.

## Git and performance

- **Pushed:** `main` on https://github.com/tapaderuza/spatialdesk, with the full pre-push CI and without `--no-verify`. The
  code is `685216d` (the carer outside the headset, panels that glide, no endless "thinking"): 178 tests passed, 6 skipped
  (the real-server and production story, which needs a server named), 0 failed; server suite 108 tests, 0 failures. Only
  documents come after it.
- **Frame time (whole frame, p95, CPU throttled 3x, Intel UHD 630), standalone run on AC power after a cool-down:** 25.8 ms
  (limit 29.4 ms), median 16.5 ms. The app's own systems: 1.7 ms p95 (limit 3 ms). 78 draw calls (limit 80).
- **It depends on the laptop, not on the code:** the same build measured 30.5 to 33.7 ms right after a deploy (hot, on AC)
  and 85 to 99 ms on battery. With the glide and helper systems taken out it measured the same. Run it cool and plugged in;
  the test retries twice. Still not reached: p95 below 25 ms consistently.

## Production

- **In production now: `30244e5`** (see "Production now runs `30244e5`" below). Earlier: the code of `685216d`, server
  and front deployed together, with the user's explicit authorization for that commit (the earlier one, for `9f5497a`,
  was a separate go-ahead). `node scripts/deploy.mjs` needs
  `JAVA_HOME=C:\Program Files\Java\jdk-17` and `GRADLE_USER_HOME=D:\.gradle` on this machine; the CDK stack took 487 s. The
  end-to-end tests the script runs against production passed 2 of 2 (the link syncs its clock, 198 ms; plan in 3.0 s,
  Nova 2 Lite, three steps).
- **How the live version was checked:** the page at https://d2p3027seoreck.cloudfront.net/ names `assets/main-UtJCl-Ml.js`
  (the entry was `index-*` before; the build has two pages now), the same file the local build names. `companion.html`
  answers 200 with 755 bytes and its three files (9.8 KB of JS, 3.3 KB of CSS, 3.0 KB shared) answer 200; before the deploy
  it also answered 200, but that was CloudFront's fallback to `index.html` for a missing file, so the size and the files
  are the proof, not the code. `/?mode=companion` answers 200. The new help endpoint exists: `POST /api/assist/pairs/x/help`
  answered 404 before and 401 (session expired) after.
- **The carer story against production itself** (`E2E_URL=... npx playwright test tests/assist-real.spec.ts`): the headset
  invites, the carer types the code, nothing shows until Allow, the Today board appears and follows a card added in the
  headset, Help / Recalibrate opens the guided setup and its orb and the carer learns it finished, Stop ends it, the dead
  code is refused. It passes, with a clean console on both pages while it is shared.
- **Console on production** (real Edge, 12 s idle): a flat screen says 4 things and no errors (the Three.js duplicate-
  instance warning twice, the IWSDK banner, one shader precision warning); the emulated headset says 8 (the same, plus the
  emulator's missing plane detection and eye tracking); the companion page says nothing. No page errors and no failed or
  4xx/5xx requests in any of them; the polling is silent. The only 404s are the deliberate "this sharing has ended" answers.
- **No secrets in the repository:** no `.env`, key or credential file is tracked or ever was in the history (`.env`,
  `.env.local` and `.env.production` are ignored); the only matches are AWS's documented example key in a signature unit test
  and a synthetic passphrase in a vault test. No account id or CDK output is tracked.
- **Not checked on production:** a physical headset, and real hands (the story drives the setup and the Allow press through
  the emulator).

## The asymmetric suite is deployed and ready for the judges

- **The carer outside the headset:** `/companion.html` (also `/?mode=companion`), 17 KB, no XR app. The owner says "invite a
  helper" (or presses the button on the start screen), the carer types the code, nothing is shown until Allow, then the
  Today board's card titles follow the headset and one very large Help / Recalibrate button opens the guided setup and its
  orb in the headset. Only titles and columns travel; the carer cannot configure; 15 minutes; Stop revokes at once.
- **Panels glide** to the comfort zone in under a second instead of jumping (27 cm: largest frame 5 % of the way, within
  1 mm in 978 ms); a gliding panel takes no pointer; reduced motion and a flat screen place at once.
- **No endless "thinking":** the AI and the voice get 7 s, then "Network issue. Switched to manual mode." and the cards
  still work by hand. The server cuts Nova at 6 s so its fallback fits.
- **How a judge sees it:** two browser tabs are enough. Tab one: the app, "Enter VR" (or `?emulate` to try without a
  headset), say or type "invite a helper" (the button is on the start screen). Tab two: `/companion.html`, type the code.

## The final polish (pushed after `685216d`, not deployed)

- **First seconds:** a dark splash instead of about 4 s of white page; a start card that says what this is and offers
  Enter VR only where VR exists; a welcome in the headset (the setup's first line for a newcomer, a 9 s banner for someone
  back that leaves as soon as they act).
- **Presence:** soft shadows behind boards and timers in passthrough (one draw call; none in VR, where they would not
  show), a glow on the amber frame, cards that rise a little under the pointer.
- **Fixes:** no one-frame flash of default text on the helper and setup panels; no false "Connected" on the carer's code
  screen; 5.4:1 contrast on the help button in the light theme.
- **README:** rewritten as a pitch by the judging criteria, with the verification table kept.
- **To go live it needs a deploy** (front end only this time; the server is unchanged since `685216d`).

## Production now runs `30244e5` (deployed 2026-10-29)

The micro-interactions are live, on `assets/main-CyPplfzo.js`: a soft rim of light breathes round the card under a
ray (and round the one the eyes rest on for a second); a key gives way under a fingertip (0.5 mm at 3.9 cm, 2.5 mm by
contact, 12 mm pushed through, one press, back in its place); a faint tick sounds from each new control a pointer comes
onto, never two within 120 ms (a sweep across six cards: one tick); an orb breathes beside "Thinking..." while Nova
answers (1.1 s live). Clean CI before the deploy: 198 passed, 0 failed, whole frame p95 24.6 ms, app systems 2.1 ms, 78
draw calls, 2.32 MB. No console errors live. The script's end-to-end test passed 2/2.

## Earlier: `f61b7fa` (deployed 2026-10-28)

Everything pushed is live: the dark splash, "this" for the agent, direct touch, 3D sound, and the two fixes found by
the live check of `b01c8e2`. Checked live on `assets/main-DcoaOpDw.js`: a quick tap with a controller or a hand
presses once; the real Nova answers English in English and Spanish in Spanish, and moved the card that was looked at;
`?cinematicMode=true` does nothing on the deployed site; no console errors. The script's end-to-end test passed 2/2.

## Recording the video (local only, never deployed)

1. `npm run build`
2. `SPATIALDESK_API=https://d2p3027seoreck.cloudfront.net npx vite preview --port 4173` (PowerShell:
   `$env:SPATIALDESK_API="https://d2p3027seoreck.cloudfront.net"; npx vite preview --port 4173`)
3. Chrome: `http://localhost:4173/?cinematicMode=true` (`&fov=78` to match a wider webcam, `&mirror` for a camera
   facing you, `&camera=1080`, `&fast` for timers in seconds). F11, click to start, allow the camera.
4. Mouse: look. Click: select what you look at. P: push it with a hand. T: talk. R: look ahead. Esc: free the mouse.
5. Point the webcam at the room, not at yourself. Say in the video's description that the room is the webcam.

## Spatial AI and direct interaction (pushed after `93f4d4d`, deployed in `b01c8e2`)

- **The agent knows what "this" is:** a second's look at a card (head ray, the eyes where tracked, tested five times a
  second) makes it "this"; "move this to Done" sends Nova its id, which the server marks in the workspace with one fixed
  rule in the system prompt. Only words that point send it; "help me start this" starts that card even without the AI.
- **Direct touch:** a fingertip (or a controller's tip) lights a control from 5 cm, with a ring on the surface closing
  in, and presses it on contact, however slowly; one press per touch, never from behind.
- **3D sound:** every cue stays put in the room as the head turns; a gliding panel breathes a soft whoosh that follows it.
- Deployed with `b01c8e2`, server and front end together.

## Video

- **Pitch cut with her real footage (2026-10-29, local file, not uploaded):** `.video/pitch/SpatialDesk_Final_Pitch_2026.mp4`,
  copied to `dist/SpatialDesk_Final_Pitch_2026.mp4`: 106 s, 1920x1080 at 60 fps. Her request on the sofa ("Hoy es un mal
  día, acércalo todo", captioned), then the app on a dark background, her own voice heard by the real Transcribe and
  answered by the real Nova in Spanish (captioned in English), a corner showing her real pinch and poke (labelled as
  filmed separately), the carer's phone pressing Help / Recalibrate and the setup opening in the headset, the figures.
  Made by `python scripts/build_pitch_video.py` (log block 29); the clips stay in `inputs/`, never committed.
- **New cut (2026-10-29, local file, not uploaded):** `.video/SpatialDesk_Demo_2026.mp4`, copied to
  `dist/SpatialDesk_Demo_2026.mp4` (the next `npm run build` empties `dist/`, and the next deploy would publish what is
  there: keep the `.video/` copy). 123 s, 1920x1080 at 60 fps (52 captured frames a second, the rest repeated), H.264 +
  AAC, -16 LUFS, captions burned in. The guided setup (sofa or bed, her reach, Start), her spoken request heard by the
  real Transcribe and answered by the real Nova, the space gliding closer, the gaze rim and "move this to done" pushed
  with a fingertip, a carer's phone (code, Allow, Help / Recalibrate), and an end card with the metrics. Made by
  `node scripts/make-cinematic-video.mjs` (log block 28); `CAMERA=real` films this machine's webcam behind the panels.
  Uploading it and changing the Devpost link are the user's steps.
- **Public link:** https://youtu.be/jtqAi3gl-os (155 s, "SpatialDesk: a workspace that adapts to your body and your mind
  (Meta Quest, Meta VR Glasses)"). Public, not made for kids; YouTube's oEmbed answers 200 without signing in.
- It shows her request in Spanish, the space adapting, her companion's question, the saved setup, steady aim, one switch,
  fit to my reach, a session at her pace, a return point, the AI log and her own room. It does not show the guided setup,
  the sofa and bed mode or the carer's view: all are newer than the recording.

## Devpost (project 1254068, shown as SUBMITTED, 5/5 steps)

- Saved: new tagline and story, the new video link (the public page embeds the new video and not the old one), the 9
  old stills removed and the 11 new ones in story order with the cover first, and the Additional info texts
  (capabilities used, hand interactions, future of VR).
- The four contest declarations were ticked by the user in the original submission; they were left as they were.

## Code changes in the two previous pushes (the latest block is above)

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
- Ideas still open from the catalogue (`docs/IDEAS_SALUD_ACCESIBILIDAD_2026-10-27.md`): visual and haptic alerts. (The
  carer who helps from a phone is done and deployed: see above.)
- The carer's view is a poll every 2 s on each side, so a change shows in about 2 to 6 s; it is not a push.
- The first card on the companion page is the Today board only (the board titled Today, else the one being worked on).
- No physical headset evidence, by the project's own rule.
