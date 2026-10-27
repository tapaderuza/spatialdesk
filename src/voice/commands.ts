/**
 * What a spoken sentence asks for. Short phrases name a control ("focus", "undo", "apply", "high contrast on");
 * "plan my day" may carry the day after it; anything longer goes to the AI agent as a request in the user's own
 * words ("move the dentist call to the top and give me a short break"), which comes back as a plan to review.
 * So every button has a voice alternative, and the agent can be asked for things no button does.
 * English, plus the obvious Spanish replies; the agent itself understands any language Transcribe heard.
 */
import type { Settings } from '../ui/settings.js';
import { sessionChoiceFromWords, type SessionChoice } from '../agent/session-input.js';

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
  | { kind: 'forget' }
  | { kind: 'save-setup' | 'restore-setup' | 'open-setup' | 'forget-setup' }
  | { kind: 'exit' }
  | { kind: 'fit'; low?: boolean }
  | { kind: 'wrapup' }
  | { kind: 'start'; task?: string }
  | { kind: 'comfort'; text: string }
  | { kind: 'session'; text: string; choice?: SessionChoice }
  | { kind: 'open-return' | 'save-return' | 'resume-return' | 'forget-return' }
  | { kind: 'return-note'; text: string }
  | { kind: 'setting'; setting: keyof Settings; value?: boolean }
  | { kind: 'steady'; value?: boolean }
  | { kind: 'switch'; value?: boolean }
  | { kind: 'reach' }
  | { kind: 'ask'; text: string };

const PLEASE = String.raw`(?: please| now)?`;
const YES = 'yes|yeah|yep|ok|okay|sure|apply|accept|do it|go ahead|sounds good|si|vale|aplica|aplicar';
const NO = 'no|nope|discard|cancel|not now|close|dismiss|never mind|nevermind|cancela|cancelar|ahora no';
/** One or two of [words] ("yes, apply it", "no, cancel"), then an optional object and "please". */
const reply = (words: string) => new RegExp(String.raw`^(?:${words})(?: (?:${words}))?(?: it| that| this| the plan)?${PLEASE}$`);
const PHRASES: [RegExp, VoiceCommand][] = [
  [/^(?:pause and resume|pause my work|i need to stop|necesito parar|pausa mi trabajo|punto de retorno)$/, { kind: 'open-return' }],
  [/^(?:save and pause|save my place|guarda y pausa|guarda mi punto|guarda el punto de retorno)$/, { kind: 'save-return' }],
  [/^(?:where was i|resume my work|return to my task|por donde iba|donde estaba|retoma mi trabajo|vuelve a mi tarea)$/, { kind: 'resume-return' }],
  [/^(?:forget (?:my |the )?(?:checkpoint|return point)|(?:olvida|borra) (?:mi |el )?punto de retorno)$/, { kind: 'forget-return' }],
  [/^(?:remember (?:this|my) (?:setup|space)|save (?:this|my|the) (?:setup|space)|(?:recuerda|guarda) (?:este|mi|el) (?:ajuste|espacio))$/, { kind: 'save-setup' }],
  [/^(?:restore (?:my|the|saved) (?:setup|space)|(?:recupera|restaura) (?:mi|el) (?:ajuste|espacio)(?: guardado)?)$/, { kind: 'restore-setup' }],
  [/^(?:my setup|show (?:my|the|saved) (?:setup|space)|mi ajuste|muestra mi ajuste)$/, { kind: 'open-setup' }],
  [/^(?:fit (?:it |everything )?to (?:my reach|me)|measure my reach|reach test|(?:ponlo|ponlo todo|ajustalo|ajustalo todo|pon el tablero) a mi alcance|mide mi alcance|hasta donde llego)$/, { kind: 'reach' }],
  [/^(?:forget (?:my|the|saved) (?:setup|space)|(?:olvida|borra) (?:mi|el) (?:ajuste|espacio)(?: guardado)?)$/, { kind: 'forget-setup' }],
  [/^(?:forget (?:our |the )?conversation|clear (?:our |the )?conversation|olvida (?:la |nuestra )?conversacion|borra (?:la |nuestra )?conversacion)$/, { kind: 'forget' }],
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
  // Said from the sofa or the bed: Fit room then accepts a low surface (src/room/fit.ts).
  [new RegExp(String.raw`^(?:i(?: m| am) (?:on|in|lying on|lying in) (?:the |my )?(?:sofa|couch|bed)|estoy (?:en|tumbad[oa] en|echad[oa] en) (?:el |mi |la )?(?:sofa|cama))${PLEASE}$`), { kind: 'fit', low: true }],
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
  [/^(?:focus )?(?:nudges?|reminders?|call ?backs?)$/, 'nudges'],
];
/** "Help me start (the report)": the agent makes the task's first five minutes; the rest names the task. */
const START = new RegExp(
  String.raw`^(?:help me (?:get )?start(?:ed)?|start small|(?:a |the )?first step|i can ?t (?:get )?start(?:ed)?|just start|ayudame a empezar|no puedo empezar|primer paso)(?: (?:on|with|for|of|con|de|para))?(?: (.+?))?${PLEASE}$`,
);
/** Something about the body, eyes or reach ("I can't turn my neck"): the agent adapts the space instead of planning work. */
const COMFORT =
  /\b(?:neck|cuello|my (?:left|right) (?:hand|side|arm)|only (?:use )?(?:my )?(?:left|right)|(?:mano|lado|brazo) (?:izquierd|derech)\w*|can ?t (?:turn|reach|see|move)|no (?:puedo|alcanzo) (?:girar|ver|mover|alcanzar)|eyes? (?:are |is )?(?:tired|hurt|strained)|tired eyes|ojos cansados|(?:me )?duelen? (?:los )?ojos|vista cansada|fatiga visual|low vision|baja vision|bigger|larger|mas grandes?|closer|mas cerca|further away|farther away|mas lejos|lying (?:down|in bed)|tumbad\w*|en la cama|wheelchair|silla de ruedas|tremor|temblor|back to normal|reset (?:the )?(?:space|layout|comfort))\b/;
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
  const note = /^\s*(?:cuando vuelva|mi siguiente paso es|when i (?:come back|return)|my next step is)\s*[:,.-]?\s+(.+)$/i.exec(said.trim());
  if (note) return { kind: 'return-note', text: note[1].trim() };
  const start = START.exec(text);
  if (start) return start[1] ? { kind: 'start', task: start[1] } : { kind: 'start' };
  for (const [pattern, command] of PHRASES) if (pattern.test(text)) return command;

  // "turn high contrast on", "hands free off", "switch off sounds", "read aloud"
  const toggle = /^(?:turn |switch )?(on |off )?(.+?)( on| off)?$/.exec(text);
  if (toggle) {
    const value = (toggle[1] ?? toggle[3])?.trim();
    for (const [pattern, setting] of SETTINGS) {
      if (pattern.test(toggle[2])) return { kind: 'setting', setting, value: value == null ? undefined : value === 'on' };
    }
  }

  // "tremor mode on", "steady aim off", "my hands shake": the steady aim of src/ui/aim.ts (before body talk, which
  // would otherwise take "tremor" to the agent).
  const steady = /^(?:turn |switch )?(on |off )?(?:tremor mode|steady aim|steady mode|modo temblor)( on| off)?$/.exec(text);
  if (steady) {
    const value = (steady[1] ?? steady[2])?.trim();
    return value ? { kind: 'steady', value: value === 'on' } : { kind: 'steady' };
  }
  // "switch mode on", "one button mode off": one-switch scanning (src/accessibility/switch-system.ts).
  const oneSwitch = /^(?:turn |switch )?(on |off )?(?:switch mode|switch access|one button mode|single switch|modo pulsador)( on| off)?$/.exec(text);
  if (oneSwitch) {
    const value = (oneSwitch[1] ?? oneSwitch[2])?.trim();
    return value ? { kind: 'switch', value: value === 'on' } : { kind: 'switch' };
  }
  // Said on its own; a longer sentence ("... and I can't turn my neck") goes to the agent, which adapts the space too.
  if (/^(?:my hands? (?:shake|shakes|tremble)|i have (?:a )?tremor|me tiemblan las manos|tengo temblor)$/.test(text)) return { kind: 'steady', value: true };
  if (COMFORT.test(text)) return { kind: 'comfort', text: said.trim() };
  const sessionChoice = sessionChoiceFromWords(text);
  if (sessionChoice || /^(?:next session|my next session|plan my session|siguiente sesion|mi siguiente sesion|prepara mi sesion)$/.test(text)) return { kind: 'session', text: said.trim(), choice: sessionChoice ?? undefined };
  if (PLAN.test(said)) return { kind: 'plan', text: said.replace(PLAN, '').trim() };

  // One unknown word is more likely a mishearing than a request.
  return text.includes(' ') ? { kind: 'ask', text: said.trim() } : null;
}
