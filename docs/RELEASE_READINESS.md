# Release readiness — 2026-10-30

**Status: submitted.** The code is frozen and verified, the documentation is final, the demo video's Gold Master is
published at https://youtu.be/FWbl6vpkiH4, the repository is public, and the Devpost entry carries all of it (see
Submission, below).

## Freeze

The application (`src/`, `public/`, `server/`, configuration, dependencies, tests) and the video pipeline (`scripts/`,
`docs/video/`) are under an absolute freeze. The owner reopened the video pipeline twice: once so the sound effects sit
where their panels are on screen, and once for the second version of the video (two of Meta's synthetic rooms, the
glide's before and after). Otherwise release preparation changed documentation only: this report, the
[README](../README.md), the [submission text](META_SUBMISSION.md), and status notes in the historical logs. No deployment
was made; production keeps serving the build it served before.

## Gold Master

| | |
| --- | --- |
| File | `.video/SpatialDesk_Final_Pitch.mp4` (local; `.video/` is never committed) |
| Length, format | 128.98 s, 1920x1080 at 60 fps, 7,739 frames, H.264 High + AAC 48 kHz, -15.9 LUFS integrated |
| Size | 39,838,635 bytes |
| SHA-256 | `b058e1d730429553de43932398c6d98a8cc373a682cb74ccf046d0bd36ba4cae` |
| Made by | `python scripts/build_pitch_video.py` (the phone by `scripts/capture_mobile_ui.ts`, the end card by `scripts/end_card.ts`, the rooms by `scripts/capture_extra_take.mjs`) |

It is the second version, approved by the owner on 2026-10-30. It keeps the previous master's cut
(SHA-256 `a9b5b530…8fd6`, kept in the holding folder below) and adds "Board: 53 cm → 43 cm" over the glide, then, after
the setup reopens, a second take in two of Meta's synthetic rooms (IWER's Synthetic Environment Module, shown as
passthrough): Fit room in a home office, one switch undoing it, the network failing with the app's calm notice and a card
moved by hand; then Fit room in a kitchen (log block 38). The person filmed at home has her face blurred wherever she
appears (the opening and the gesture corner), as the contest's rules allow no identifiable person other than the
entrant; her hands and her voice stay (log block 39). The footage is never committed, and its source clips stay in the
ignored `inputs/`.

## Media cleanup

Every intermediate and obsolete media file was moved out of the repository into `D:\d\spatialdesk-media-2026-10-30\`
(34 items, 2.96 GB, with a `MANIFEST.txt` of where each came from): the 15 recording takes and their voice cache, the
pitch's intermediates (phone shot, end card, effects, masks, captions), the earlier pipeline's runs and renders, their
thumbnails and sheets, the discarded carer clip (`IMG_2089.MOV` and its duplicate), the copy in `dist/`, and a
superseded, unfinished jury package; its `superseded/` folder holds the earlier masters. The second version's takes (the
one used and an unusable first try), its intermediates and its `dist/` copy went to the same folder, listed in the same
manifest. Deleting that folder permanently is left to the owner. Kept: the Gold Master, the three source clips it is made
from, and the local voice tooling.

## Verification

| Check | Result |
| --- | --- |
| Front end: `npm run typecheck` (TypeScript strict) | 0 errors |
| Server: Kotlin compile of the app and the shared engine, forced fresh | 0 warnings, 0 errors |
| Server: `gradlew build` | Successful |
| Server and shared-engine tests, forced fresh | 86 tests (59 app, 27 shared), 0 failures, 0 skipped |
| `npm run ci`: type check, 199 Playwright scenarios in IWER with the performance gate, size budget | Runs in the pre-push hook; a failure blocks the push |
| Configured formatter or linter (ESLint, Prettier, ktlint, Detekt, Spotless) | None configured; none added, as that would rewrite frozen code |

Emulator results are not physical-headset measurements; the README and the submission text say so where it matters.

## Debug output and test-facing code

- **No debug logging in the client:** no `console.log`, `console.debug`, `console.trace` or `debugger` anywhere in `src/`.
  Five `console.warn` calls report real faults (storage unavailable, a save that failed, a Transcribe exception, two
  recording-mode notices).
- **Server logs are operational:** SLF4J lines record latency, token counts, plan sizes and socket counts, never what a
  user said. The two `debug` lines (an unreadable socket message, a failed send) are below Spring Boot's default `INFO`
  level and do not print in production.
- **No leftover test comments:** no `TODO`, `FIXME`, `HACK` or test-only notes in the client or the server.
- **Automation hooks are deliberate:** the app exposes `window.__world`, `window.__workspace` and similar handles, each
  documented where it is defined. They are how the 199 Playwright scenarios and the video pipeline drive the real app;
  removing them would break the test suite and break the freeze, so they stay.

## Submission (2026-10-30)

- **Video:** the Gold Master, uploaded to the project's YouTube channel and public: https://youtu.be/FWbl6vpkiH4 (2:09,
  the second version with her face blurred; it replaced the earlier uploads in both of Devpost's video fields the same
  day, and those that showed or named her are now private; not made for kids; answered "no" to YouTube's AI-use
  question, as none of its four cases applies: the narrator is a generic synthetic voice, not a real person, and the
  footage of the person filmed is real, with only her face blurred). Viewable without signing in.
- **Repository:** made public at the owner's request, after a scan of its whole history: the only credential-shaped
  strings are AWS's documented example key in the SigV4 test, and every commit uses a GitHub noreply address. The
  [official rules](https://start-developer-competition-26.devpost.com/rules) ask WebXR entries for a link to it.
- **Devpost:** the existing entry (project 1254068, still SUBMITTED, 5 of 5 steps) was updated rather than duplicated:
  named SpatialDesk, with the tagline, story, links (the app, the emulator, the companion and GitHub), 20 technology
  tags and the new video, both in the entry and on its public page
  (https://devpost.com/software/spatialdesk-command-center). The story is [META_SUBMISSION.md](META_SUBMISSION.md)'s:
  under the 500 words the form suggests, naming the device features the judging criteria score (hands-first input, gaze,
  passthrough with scene understanding and persistent anchors, field-of-view-aware layout), with the target launch date
  the rules require. The earlier 1,600-word version is kept in the same backup folder. The form's additional answers, track, division and the four
  declarations were left as the entrant set them.
- The entry's previous texts, links, tags and video are kept in
  `D:\d\spatialdesk-media-2026-10-30\devpost-backup\project-details-before-2026-10-30.md`.
- The entry can still be edited until the deadline, 18 November 2026 at 12:00 PT.
