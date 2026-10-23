/**
 * What a spoken sentence asks for. Short phrases name a control ("focus", "undo", "apply", "high contrast on");
 * "plan my day" may carry the day after it; anything longer goes to the AI agent as a request in the user's own
 * words ("move the dentist call to the top and give me a short break"), which comes back as a plan to review.
 * So every button has a voice alternative, and the agent can be asked for things no button does.
 * English, plus the obvious Spanish replies; the agent itself understands any language Transcribe heard.
 */
import type { Settings } from '../ui/settings.js';

export type VoiceCommand =
  | { kind: 'plan'; text: string }
  | { kind: 'prioritise' }
  | { kind: 'apply' }
  | { kind: 'discard' }
  | { kind: 'undo' }
  | { kind: 'focus' }
  | { kind: 'arrange' }
  | { kind: 'clear' }
  | { kind: 'log' }
  | { kind: 'exit' }
  | { kind: 'fit' }
  | { kind: 'wrapup' }
  | { kind: 'setting'; setting: keyof Settings; value?: boolean }
  | { kind: 'ask'; text: string };

const PLEASE = String.raw`(?: please| now)?`;
const YES = 'yes|yeah|yep|ok|okay|sure|apply|accept|do it|go ahead|sounds good|si|vale|aplica|aplicar';
const NO = 'no|nope|discard|cancel|not now|close|dismiss|never mind|nevermind|cancela|cancelar|ahora no';
/** One or two of [words] ("yes, apply it", "no, cancel"), then an optional object and "please". */
const reply = (words: string) => new RegExp(String.raw`^(?:${words})(?: (?:${words}))?(?: it| that| this| the plan)?${PLEASE}$`);
const PHRASES: [RegExp, VoiceCommand][] = [
  [reply(YES), { kind: 'apply' }],
  [reply(NO), { kind: 'discard' }],
  [new RegExp(String.raw`^(?:undo|deshacer|deshaz)(?: that| it| the last (?:step|change)| last)?${PLEASE}$`), { kind: 'undo' }],
  [new RegExp(String.raw`^(?:start )?(?:a )?(?:focus|focus 25|focus twenty five|focus mode|focus block|pomodoro|enfoque)${PLEASE}$`), { kind: 'focus' }],
  [new RegExp(String.raw`^(?:bring (?:it|everything|them|it all)(?: back)? (?:to me|here|closer)|come back|reset (?:the )?(?:layout|space))${PLEASE}$`), { kind: 'arrange' }],
  [new RegExp(String.raw`^(?:clear(?: the)? done|clear finished(?: cards)?)${PLEASE}$`), { kind: 'clear' }],
  [new RegExp(String.raw`^(?:ai log|show(?: me)?(?: the)?(?: ai)? log|what did you do|why)${PLEASE}$`), { kind: 'log' }],
  [new RegExp(String.raw`^(?:prioriti[sz]e|sort)(?: (?:my|the) (?:tasks|board|cards|day))?${PLEASE}$`), { kind: 'prioritise' }],
  [new RegExp(String.raw`^(?:exit|leave|quit)(?: (?:the )?(?:workspace|vr))?${PLEASE}$`), { kind: 'exit' }],
  [new RegExp(String.raw`^(?:fit(?: (?:it|everything|the boards))?(?: to)? (?:my |the )?room|put (?:the )?boards on (?:my |the )?walls)${PLEASE}$`), { kind: 'fit' }],
  [
    new RegExp(
      String.raw`^(?:wrap(?: it)? up(?: (?:my|the) day)?|(?:end|finish|close) (?:my|the) day|call it a day|(?:i am |i m |im )?done for (?:today|the day)|(?:termina|terminar|cierra|cerrar) (?:el|mi) dia)${PLEASE}$`,
    ),
    { kind: 'wrapup' },
  ],
];
const SETTINGS: [RegExp, keyof Settings][] = [
  [/^(?:high )?contrast$/, 'highContrast'],
  [/^(?:sound|sounds)$/, 'sound'],
  [/^read(?:ing)? aloud$/, 'readAloud'],
  [/^hands ?free$/, 'handsFree'],
  [/^(?:focus )?(?:dimming|dim|bubble)$/, 'focusDim'],
];
/** "Plan my day:" and the like, in the words as heard (the rest keeps its commas for the planner). */
const PLAN = /^\s*(?:plan|planifica|organiza)(?:\s+(?:my|mi)\s+(?:day|d[ií]a))?(?=$|[\s:,.-])\s*[:,.-]?\s*/i;

/** Lower case, accents folded, punctuation dropped: "Turn High-Contrast on." -> "turn high contrast on". */
function normalise(said: string): string {
  return said
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseCommand(said: string): VoiceCommand | null {
  const text = normalise(said);
  if (!text) return null;
  for (const [pattern, command] of PHRASES) if (pattern.test(text)) return command;

  // "turn high contrast on", "hands free off", "switch off sounds", "read aloud"
  const toggle = /^(?:turn |switch )?(on |off )?(.+?)( on| off)?$/.exec(text);
  if (toggle) {
    const value = (toggle[1] ?? toggle[3])?.trim();
    for (const [pattern, setting] of SETTINGS) {
      if (pattern.test(toggle[2])) return { kind: 'setting', setting, value: value == null ? undefined : value === 'on' };
    }
  }

  if (PLAN.test(said)) return { kind: 'plan', text: said.replace(PLAN, '').trim() };

  // One unknown word is more likely a mishearing than a request.
  return text.includes(' ') ? { kind: 'ask', text: said.trim() } : null;
}
