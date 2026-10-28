/**
 * "Describe your day", in the browser before entering VR: immersive WebXR has no keyboard, so the words are typed
 * (or dictated, where the browser can) here and kept for the "Plan my day" chip inside VR. The experience never
 * depends on it: with no text, the agent plans from the boards as they are.
 */
import { VisibilityState, type World } from '@iwsdk/core';
import { isListening, listen, stopListening } from '../voice/listen.js';
import { requestInvite } from '../assist/helper-state.js';
import { launchRoom, launchVR } from '../room/room-system.js';

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

export function installDayInput(world: World, onPlan: () => void): () => void {
  const box = document.createElement('div');
  box.id = 'day-input';
  box.style.cssText =
    'position:fixed;left:20px;bottom:20px;width:min(30vw,420px);min-width:260px;box-sizing:border-box;padding:14px;' +
    'background:#15181e;border:1px solid #2c333d;border-radius:14px;color:#eef1f5;font:14px/1.4 system-ui,sans-serif;z-index:10';
  box.innerHTML =
    // The first thing a newcomer reads on a screen: what this is, and the one thing to do next.
    '<div style="font-weight:700;font-size:17px">Welcome to SpatialDesk</div>' +
    '<div id="day-welcome" style="color:#b9c2cf;font-size:13px;margin:2px 0 10px">A workspace that adapts to your body. Put on a headset and enter, or try it here with the mouse.</div>' +
    '<div style="display:flex;gap:8px;margin-bottom:12px">' +
    '<button id="day-vr" type="button" hidden style="flex:1;min-height:44px;background:#f2b84b;color:#1a1203;border:0;border-radius:8px;font:inherit;font-weight:700;font-size:15px;cursor:pointer">Enter VR</button>' +
    '<button id="day-room" type="button" hidden style="flex:1;min-height:44px;background:#2a313b;color:#eef1f5;border:1px solid #4a5666;border-radius:8px;font:inherit;font-weight:700;cursor:pointer">In my room</button>' +
    '</div>' +
    '<label for="day-text" style="display:block;font-weight:700;margin-bottom:6px">Describe your day</label>' +
    '<textarea id="day-text" rows="2" maxlength="600" placeholder="Finish the report, review two pull requests, call the dentist, gym at 18:00"' +
    ' style="width:100%;box-sizing:border-box;resize:vertical;background:#1d222a;color:#eef1f5;border:1px solid #2c333d;border-radius:8px;padding:8px;font:inherit"></textarea>' +
    '<div style="display:flex;gap:8px;margin-top:8px">' +
    '<button id="day-plan" type="button" style="flex:1;min-height:40px;background:#2f5f9e;color:#eef1f5;border:0;border-radius:8px;font:inherit;font-weight:700;cursor:pointer">Plan my day</button>' +
    '<button id="day-speak" type="button" hidden style="min-height:40px;padding:0 14px;background:#2a313b;color:#eef1f5;border:0;border-radius:8px;font:inherit;cursor:pointer">Speak</button>' +
    '</div>' +
    '<button id="day-invite" type="button" style="margin-top:8px;width:100%;min-height:40px;background:transparent;color:#eef1f5;border:1px solid #4a5666;border-radius:8px;font:inherit;cursor:pointer">Invite a family member or carer to follow along</button>' +
    '<div id="day-status" role="status" style="margin-top:6px;color:#b9c2cf;font-size:12px">In VR, the Plan my day chip uses these words, and Talk takes voice commands.</div>';
  document.body.appendChild(box);

  const text = box.querySelector<HTMLTextAreaElement>('#day-text')!;
  const plan = box.querySelector<HTMLButtonElement>('#day-plan')!;
  const speak = box.querySelector<HTMLButtonElement>('#day-speak')!;
  const status = box.querySelector<HTMLDivElement>('#day-status')!;
  text.value = dayText();
  text.addEventListener('input', () => saveDayText(text.value));
  // Enter VR (and In my room, where passthrough exists), the same as the buttons on the command panel. A browser with no
  // WebXR at all is told so, rather than shown a button that does nothing.
  const vr = box.querySelector<HTMLButtonElement>('#day-vr')!;
  const room = box.querySelector<HTMLButtonElement>('#day-room')!;
  vr.addEventListener('click', () => launchVR(world));
  room.addEventListener('click', () => launchRoom(world));
  const noHeadset = () => {
    box.querySelector('#day-welcome')!.textContent = 'A workspace that adapts to your body. No headset here: try it with the mouse, or open this page on a Meta Quest.';
  };
  const xr = navigator.xr;
  if (!xr) {
    noHeadset();
  } else {
    void xr.isSessionSupported('immersive-vr').then((ok) => {
      vr.hidden = !ok;
      if (!ok) noHeadset();
    }).catch(noHeadset);
    void xr.isSessionSupported('immersive-ar').then((ok) => (room.hidden = !ok)).catch(() => undefined);
  }
  // A code for someone outside the headset to follow the Today board (src/assist); the panel that shows it is in the scene.
  box.querySelector<HTMLButtonElement>('#day-invite')!.addEventListener('click', () => {
    if (!requestInvite()) status.textContent = 'Inviting a helper is not available yet. Try again in a moment.';
  });
  plan.addEventListener('click', () => {
    saveDayText(text.value);
    onPlan();
  });

  // Dictation through the same voice path as Talk in VR (src/voice/listen.ts). Using it here also lets the browser ask
  // for the microphone once, before the headset is on, so Talk works straight away inside the workspace.
  if (typeof navigator.mediaDevices?.getUserMedia === 'function') { // undefined outside a secure context
    speak.hidden = false;
    speak.addEventListener('click', async () => {
      if (isListening()) {
        stopListening();
        return;
      }
      const start = text.value.trim();
      speak.textContent = 'Stop';
      const result = await listen({ partial: (said) => (text.value = `${start} ${said}`.trim().slice(0, MAX)) });
      speak.textContent = 'Speak';
      text.value = result.ok ? `${start} ${result.text}`.trim().slice(0, MAX) : start;
      saveDayText(text.value);
      status.textContent = result.ok ? 'Got it. Press Plan my day, or enter the workspace.' : result.error;
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
