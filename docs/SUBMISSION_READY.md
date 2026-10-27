# SpatialDesk: submission status (2026-10-27, night)

## Git and performance

- **Pushed:** `50c539c..a5039d6  main -> main` on https://github.com/tapaderuza/spatialdesk, with the full pre-push CI
  (typecheck, 133 tests, size check) and without `--no-verify`.
- **Frame time (whole frame, p95, CPU throttled 3x, Intel UHD 630):** 28.7 ms in the push run, limit 29.4 ms. Median
  16.9 ms. The app's own systems: 2.0 ms p95 (limit 3 ms). 78 draw calls (limit 80), 78 bytes allocated per frame.
- **Honest caveat:** over five runs of the same code today the p95 went from 28.7 to 33.1 ms. The cause is the laptop,
  not the code: the October 23 commit, which passed that day, measures 34.9 ms here now. The change that helped is real
  (the median frame went from 19.5 to 18.1 ms), but a future push can still fail the gate on a noisy run.

## Video

- **Public link:** https://youtu.be/jtqAi3gl-os (155 s, "SpatialDesk: a workspace that adapts to your body and your mind
  (Meta Quest, Meta VR Glasses)"). Public, not made for kids; YouTube's oEmbed answers 200 without signing in.
- It shows her request in Spanish, the space adapting, her companion's question, the saved setup, steady aim, one switch,
  fit to my reach, a session at her pace, a return point, the AI log and her own room.

## Devpost (project 1254068, shown as SUBMITTED, 5/5 steps)

- Saved: new tagline and story, the new video link (the public page embeds the new video and not the old one), the 9
  old stills removed and the 11 new ones in story order with the cover first, and the Additional info texts
  (capabilities used, hand interactions, future of VR).
- The four contest declarations were ticked by the user in the original submission; they were left as they were.

## Code changes since the previous push

- Fit to my reach (`src/accessibility/reach.ts`, `reach-system.ts`, `tests/reach.spec.ts`).
- One-switch scan: a thick amber frame on the control lit, drawn in the transparent pass so it shows over the panels.
- Steady aim and one switch, with their tests and documentation (README, `docs/SUBMISSION.md`).
- Video: 19 beats, a second marker blue for beats 16 to 31, gallery stills without the beat marker.
- Performance: `src/ui/panel-ui-cache.ts` replaces two scene walks per frame in the framework's `PanelUISystem` with a
  cached list; the profiler (`npm run perf:profile`) now prints who calls the costly functions.

## Not done, and why

- `D:\d` (two stray screenshots saved under a mistaken path) was not deleted: the tool's safety check refused the
  removal. Delete the folder by hand.
- Anchoring the board to a bed or sofa: Fit room looks for a surface at desk height, and a sofa seat is lower. It needs
  its own rule and tests over the rooms.
- Ideas still open from the catalogue (`docs/IDEAS_SALUD_ACCESIBILIDAD_2026-10-27.md`): a carer who sets up the space
  from a phone (the `/api/assist` server exists), guided calibration in VR, visual and haptic alerts, English-first UI.
- No physical headset evidence, by the project's own rule.
