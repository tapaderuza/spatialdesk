# SpatialDesk Command Center: demo script (under 3 minutes)

The demo is a Playwright test. It runs in the IWER Quest 3 emulator, drives everything with the controller ray and
trigger, and records a 1280x720 video:

```
DEMO=1 npx playwright test tests/demo.spec.ts             # local: needs `npm run server:run` (Bedrock credentials)
DEMO=1 E2E_URL=https://d2p3027seoreck.cloudfront.net npx playwright test tests/demo.spec.ts   # production
```

The automated run takes about 65 s. The narrated cut below takes about 2:30: the pauses are lengthened in editing,
and nothing is sped up except one marked shortcut, where the 25-minute focus block is shortened to 6 seconds.

| Time | On screen | Narration (voice-over) |
|---|---|---|
| 0:00 | The browser page: command panel and the "Describe your day" box | "SpatialDesk is a workspace you wear. Before putting the headset on, I tell it about my day." |
| 0:10 | Typing: report, two reviews, the dentist, slides, gym at 18:00 | "No forms: just the day, in my own words. It works in English or Spanish." |
| 0:20 | Enter the workspace (XR) | "In VR, the boards I work with are within arm's reach, and everything else waits on the sides." |
| 0:30 | The ray on "Plan my day" | "One tap. Amazon Nova plans the day through a single tool call, and the same Kotlin engine that runs in the headset validates every step." |
| 0:40 | The plan card: three steps, each with its reason, "AI plan by Amazon Nova 2 Lite, 1.9 s" | "Nothing changes until I say so. I can see what it will do, and why." |
| 0:50 | Apply: the "Today" board appears in front, with a 25-minute timer above it | "One tap applies the whole plan, and one undo would take it back." |
| 1:00 | Pick a card, drop it in Doing | "By hand it is just as quick: pick up, drop, and it snaps into place. Poke, pinch or mouse all work." |
| 1:15 | (Shortcut: the 25-minute block ends.) Chime, the timer flashes | "When a focus block ends, the agent notices on its own..." |
| 1:25 | The suggestion card: a 5-minute break, because the report has used 25 of its 120 minutes | "...and it knows the report is not finished, because the app tells it how much of the estimate is used. So it suggests a break, not a false 'done'." |
| 1:40 | Apply: the break timer starts | "I accept it with one tap. The agent never acts without me." |
| 1:50 | "AI log": what the AI did, each step with its reason and its own Undo | "Every action is explained, and every step can be undone on its own, even after later changes. Anything that depended on it goes too, and the app says so." |
| 2:05 | Undo one step | (The notice reads "Undone: ...".) |
| 2:15 | "Bring to me": everything comes back around the user | "If I move, the workspace comes with me." |
| 2:25 | End card | "SpatialDesk: built and tested without a headset, against hand-tracking noise, performance budgets on a throttled CPU, and an AI with guardrails." |

## What the run checks (it fails otherwise)

- The command server is online, and the plan comes from Amazon Nova, not the built-in fallback.
- Each phase is reached: preview, applied, the agent's own suggestion, the log, and one step undone.
- The whole run takes under 180 s.

## Notes for the edit

- The command panel is closer in the emulator than it looks on a Quest (the emulator's field of view is narrower):
  frame the shots on the boards.
- The timer shortcut is the only time compression. Say so on screen ("25 min, shortened").
