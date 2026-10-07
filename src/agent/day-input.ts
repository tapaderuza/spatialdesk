/**
 * "Describe your day", in the browser before entering VR: immersive WebXR has no keyboard, so the words are typed
 * (or dictated, where the browser can) here and kept for the "Plan my day" chip inside VR. The experience never
 * depends on it: with no text, the agent plans from the boards as they are.
 */
import { VisibilityState, type World } from '@iwsdk/core';

const KEY = 'spatialdesk.day';
const MAX = 600;

export function dayText(): string {
  try {
    return localStorage.getItem(KEY) ?? '';
  } catch {
    return '';
  }
}

function saveDayText(text: string): void {
  try {
    localStorage.setItem(KEY, text.slice(0, MAX));
  } catch {
    // private mode: the text simply is not remembered
  }
}

type Recognition = {
  lang: string;
  interimResults: boolean;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
};

export function installDayInput(world: World, onPlan: () => void): () => void {
  const box = document.createElement('div');
  box.id = 'day-input';
  box.style.cssText =
    'position:fixed;left:20px;bottom:20px;width:min(30vw,420px);min-width:260px;box-sizing:border-box;padding:14px;' +
    'background:#15181e;border:1px solid #2c333d;border-radius:14px;color:#eef1f5;font:14px/1.4 system-ui,sans-serif;z-index:10';
  box.innerHTML =
    '<label for="day-text" style="display:block;font-weight:700;margin-bottom:6px">Describe your day</label>' +
    '<textarea id="day-text" rows="3" maxlength="600" placeholder="Finish the report, review two pull requests, call the dentist, gym at 18:00"' +
    ' style="width:100%;box-sizing:border-box;resize:vertical;background:#1d222a;color:#eef1f5;border:1px solid #2c333d;border-radius:8px;padding:8px;font:inherit"></textarea>' +
    '<div style="display:flex;gap:8px;margin-top:8px">' +
    '<button id="day-plan" type="button" style="flex:1;min-height:40px;background:#2f5f9e;color:#eef1f5;border:0;border-radius:8px;font:inherit;font-weight:700;cursor:pointer">Plan my day</button>' +
    '<button id="day-speak" type="button" hidden style="min-height:40px;padding:0 14px;background:#2a313b;color:#eef1f5;border:0;border-radius:8px;font:inherit;cursor:pointer">Speak</button>' +
    '</div>' +
    '<div style="margin-top:6px;color:#b9c2cf;font-size:12px">In VR, the Plan my day chip uses these words.</div>';
  document.body.appendChild(box);

  const text = box.querySelector<HTMLTextAreaElement>('#day-text')!;
  const plan = box.querySelector<HTMLButtonElement>('#day-plan')!;
  const speak = box.querySelector<HTMLButtonElement>('#day-speak')!;
  text.value = dayText();
  text.addEventListener('input', () => saveDayText(text.value));
  plan.addEventListener('click', () => {
    saveDayText(text.value);
    onPlan();
  });

  // Dictation where the browser offers it (desktop Chrome and Edge); hidden elsewhere, never required.
  const Speech = (window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition })
    .SpeechRecognition ?? (window as unknown as { webkitSpeechRecognition?: new () => Recognition }).webkitSpeechRecognition;
  if (Speech) {
    speak.hidden = false;
    let listening: Recognition | null = null;
    speak.addEventListener('click', () => {
      if (listening) {
        listening.stop();
        return;
      }
      const recognition = new Speech();
      recognition.lang = navigator.language || 'en-US';
      recognition.interimResults = false;
      recognition.onresult = (event) => {
        const said = Array.from(event.results, (r) => r[0]?.transcript ?? '').join(' ').trim();
        text.value = `${text.value.trim()} ${said}`.trim().slice(0, MAX);
        saveDayText(text.value);
      };
      recognition.onend = () => {
        listening = null;
        speak.textContent = 'Speak';
      };
      listening = recognition;
      speak.textContent = 'Stop';
      recognition.start();
    });
  }

  const unsubscribe = world.visibilityState.subscribe((state) => {
    box.style.display = state === VisibilityState.NonImmersive ? 'block' : 'none';
  });
  return () => {
    unsubscribe();
    box.remove();
  };
}
