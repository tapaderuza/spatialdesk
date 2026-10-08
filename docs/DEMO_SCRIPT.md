# SpatialDesk Command Center: the demo video

The video is built by one command, with no manual editing:

```
node scripts/make-video.mjs            # against production; E2E_URL=... for another deployment
node scripts/make-video.mjs --edit     # re-edit the last recording (after changing cards or captions)
```

1. **Voice-over:** each line of [video/narration.json](video/narration.json) is spoken by Piper (an open-source voice
   that runs locally in Docker: no account, no key, no cost). The lines are only re-spoken when the text changes.
2. **Recording:** `tests/demo.spec.ts` plays the demo in the IWER Quest 3 emulator with the controller ray and the
   trigger, against the real server and the real AI (it fails if the plan comes from the built-in fallback). Each beat
   waits until its line has been spoken, so picture and voice stay in sync whatever the AI's latency.
3. **Edit (ffmpeg):** title card, the recording, end card, the voice laid at each beat, and captions burned in (also
   written to `.video/captions.srt` for YouTube). The build fails if the cut is 3 minutes or longer.

Output: `.video/spatialdesk-demo.mp4` (1280x720, H.264 + AAC).

## What is real and what is staged

- Everything on screen is the production app, driven the way a user would drive it: ray and trigger, head turns
  toward the panel being tapped.
- The app runs with `?fast`, the same option judges can use: timers run in seconds instead of minutes, and the
  narration says so.
- The emulator's field of view is narrowed to 72° vertical, and the view pitched 6° down, so a 16:9 frame shows
  roughly what the wearer looks at. At the default 90°, a 16:9 frame is 121° wide and the boards look small.
- The first guided-start step is skipped; `tests/accessibility.spec.ts` measures it separately.

## Beats

| Beat | On screen |
|---|---|
| describe | The page: the day typed into *Describe your day* |
| enter | Into the workspace: the board within reach, the rest at the sides |
| coach | The guided start's first step, then Skip |
| plan | A glance at the left panel, *Plan my day*; the agent thinks |
| preview | The plan card: each step with its reason, the model and its latency |
| apply | *Apply*: the Today board and its focus timer |
| hands | A card picked up and dropped in *Doing* |
| timer | The 25-second focus block ends: chime and flash |
| suggestion | The agent's own suggestion: a break, because the report is not finished |
| accept | One tap: the break timer starts |
| log | *AI log*: every action with its reason and its own Undo |
| undo | One step undone; the notice says what else went with it |
| contrast | High contrast on |
| arrange | *Bring to me* |
| end | End card with the link |
