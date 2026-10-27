# SpatialDesk: the current accessibility demo

The source of truth is [video/narration.json](video/narration.json), performed by
`tests/demo.spec.ts`. The previous recording starting with `describe` is obsolete.
Do not combine it with current narration or manually rename its markers.

```powershell
# Validate a take before any audio, gallery or editing writes.
$env:VIDEO_DIR='D:\spatialdesk\.video\runs\<take>'
node scripts/make-video.mjs --check

# Capture again and include the approved opening.
Remove-Item Env:VIDEO_DIR -ErrorAction SilentlyContinue
node scripts/make-video.mjs --approved

# Re-edit a verified take.
$env:VIDEO_DIR='D:\spatialdesk\.video\runs\<take>'
node scripts/make-video.mjs --edit --approved
```

New takes go into separate timestamped directories under `.video/runs/`; the old
recording and approved v3 stay untouched. `VIDEO_DIR` overrides the destination.
`--edit` and `--check` default to `.video` for compatibility, but reject the old
capture. Metadata binds video, markers, narration, recording test, input helpers,
voice files, source speech, voice lengths, app source and planner source with SHA-256. Matching step names
alone is insufficient.

Current takes also carry a small calibration marker during capture. Its colour is decoded from the video's
frame clock, removed in editing, and used to align every beat. `clockAt` retains the original test clock;
`at` and `end` are the measured video interval. The preparation gap between visits is excluded from the edit.

On this workstation the existing system FFmpeg is also available to Playwright
in `.video/playwright`. Set `$env:PLAYWRIGHT_BROWSERS_PATH='D:\spatialdesk\.video\playwright'`
before capturing. On another workstation, install Playwright's recorder with
`npx playwright install ffmpeg` instead.

The demo keeps the controller at z=0 for console controls and z=0.2 for the near agent card,
behind its contact zone, so the test exercises the pointing ray consistently.
The usual helper default remains unchanged for other tests. `tests/demo-input.spec.ts`
checks that Plan my day receives a real controller click after all four comfort
changes, including 1.5x scale and 0.8 reach.

The capture defaults to production. Set `E2E_URL` for another deployment.
Successful recording proves the observed deployed behavior, not that a remote
server contains every local commit.

## Approved opening

`scripts/render-approved.py` incorporates the treatment from `work/render_v2.py`
and `work/render_v3.py` in the previous chat. It reuses the first 10.9 seconds of
`outputs/SpatialDesk-pantalla-v3.mp4`, preserving approved color and bilingual
subtitles. The mother's actual approved audio continues through 13.7 seconds,
including her final words over the transition. Her voice is not synthesized.

The 2.8-second perspective transition covers the laptop display from frame one
with an image from the verified new recording, retaining the approved background
and final Spanish/English caption. Its mask extends past the lower/right display
edge so the original reading text cannot peek out beside the inserted picture.
The new demo follows with its narration,
captions and end card; its duplicate opening and title are omitted. The other
narration remains English, as in the approved edit.

It reuses `facelessyt.video.assemble` and `data/music/loop.wav` at gain 0.07:

- Python: `python` with NumPy and Pillow (`FACELESS_PYTHON` override).
- FacelessYT: `D:/FacelessYT` (`FACELESS_ROOT` override).
- Approved folder: `C:/Users/Apasp/Documents/Codex/2026-10-23/eres-un-experto-en-hackathon-estamos-2`
  (`SPATIALDESK_APPROVED_ROOT` override).

Output: `<take>/SpatialDesk-actual-aprobado.mp4`, 1920x1080, 30 fps, H.264/AAC,
under 180 seconds. `approved/sources.json` records provenance. The approved source
folder is read-only input; nothing is written back to it.

## Current beats

| Beat | On screen |
|---|---|
| enter | Workspace before adaptation |
| talk | Talk, to request adaptation |
| say | Mother's Spanish request enters the microphone |
| heard | Transcription and proposed comfort changes |
| apply | Workspace comes closer, larger and to her right |
| dialogue | Live Nova corrects the previous distance in response to her feedback |
| saved | She explicitly saves five settings in this browser |
| plan | Agent plans her day |
| handsfree | Gaze activates controls |
| session | She chooses time and energy; Nova proposes one bounded block on an existing task |
| pause | She dictates the next action, explicitly saves it and pauses the same timer |
| return | A new visit recalls the work checkpoint locally; review and Apply resume the same clock |
| session-end | Local completion card offers stopping or choosing again; the task stays open |
| log | Reasons and individual undo actions |
| recall | A new visit, local restore preview, and approval of the saved setup |
| room | Fit room and focus in the simulated room |
| end | End card, authored in editing rather than captured |

Recording uses IWER, IWSDK's browser-based headset emulator, with an active XR
(immersive) session. See [Testing Your Experience](https://iwsdk.dev/guides/02-testing-experience.html).
It requires real Bedrock and Transcribe responses and rejects fallback plans.
Timers use `?fast`: minutes pass as seconds in the demo. This is not physical
headset evidence. Piper supplies other narration locally in Docker; FFmpeg,
FFprobe and Edge must be available.
