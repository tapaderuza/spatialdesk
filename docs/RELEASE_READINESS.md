# Release readiness — 2026-10-30

**Status: ready for the jury.** The code is frozen and verified, the documentation is final, the demo video's Gold Master
is identified and kept, and the media workspace is cleaned. What remains is the entrant's own: publishing the video and
submitting the form.

## Freeze

The application (`src/`, `public/`, `server/`, configuration, dependencies, tests) and the video pipeline (`scripts/`,
`docs/video/`) are under an absolute freeze. Release preparation changed documentation only: this report, the
[README](../README.md), the [submission text](META_SUBMISSION.md), and status notes in the historical logs. No deployment
was made; production keeps serving the build it served before.

## Gold Master

| | |
| --- | --- |
| File | `.video/SpatialDesk_Final_Pitch.mp4` (local; `.video/` is never committed) |
| Length, format | 100.07 s, 1920x1080 at 60 fps, 6,004 frames, H.264 High + AAC 48 kHz, -15.8 LUFS integrated |
| Size | 29,289,781 bytes |
| SHA-256 | `402a8213b26d09ed12106a54c354da6aca5fe22e6de02c27dfbe1e8c3e69267f` |
| Made by | `python scripts/build_pitch_video.py` (the phone by `scripts/capture_mobile_ui.ts`, the end card by `scripts/end_card.ts`) |

The approval named the file `SpatialDesk_Final_Pitch_2026_6.mp4`. No file of that name exists on this machine; the
approved video is the last render delivered before the approval, the only final render that exists, renamed here with
its bytes unchanged (SHA-256 checked before and after). The video shows a family member filmed at home: it is never
committed, and its source clips stay in the ignored `inputs/`.

## Media cleanup

Every intermediate and obsolete media file was moved out of the repository into `D:\d\spatialdesk-media-2026-10-30\`
(34 items, 2.96 GB, with a `MANIFEST.txt` of where each came from): the 15 recording takes and their voice cache, the
pitch's intermediates (phone shot, end card, effects, masks, captions), the earlier pipeline's runs and renders, their
thumbnails and sheets, the discarded carer clip (`IMG_2089.MOV` and its duplicate), the copy in `dist/`, and a
superseded, unfinished jury package. Deleting that folder permanently is left to the owner. Kept: the Gold Master, the
three source clips it is made from, and the local voice tooling.

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

## Handoff

The jury gets the repository's `main` branch and the video. Left to the entrant:

1. Upload `.video/SpatialDesk_Final_Pitch.mp4` to the video host the competition rules require, and keep its link.
2. Paste the sections of [META_SUBMISSION.md](META_SUBMISSION.md) into the form, add the video link and the repository
   link, and complete the form's own declarations.
3. Submit before the deadline, 18 November 2026 at 12:00 PT. The [official rules](https://start-developer-competition-26.devpost.com/rules)
   govern the entry.
