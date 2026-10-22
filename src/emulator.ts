/**
 * Production builds carry no emulator: on a Quest the browser's own WebXR runs. With `?emulate` (performance
 * gate, demo recording) the IWER emulator is loaded as a separate chunk before the world starts:
 *  - `?glasses` emulates Meta VR Glasses: the narrower view (IWER's mask, sampled from the glasses' projection), eye
 *    tracking (the glasses' gaze ray, which IWSDK turns into look-and-pinch) and hands as the input, as the glasses
 *    ship without controllers;
 *  - `?room=<id>` adds IWER's Synthetic Environment Module: a procedural real room (`home_office`, `kitchen`, ...)
 *    shown as passthrough in "In my room", with the plane detection, hit testing and anchors a Quest provides.
 * In dev the IWSDK Vite plugin already injects IWER, so this is a no-op there.
 */
import { emulateRenderExtent } from './ui/view-fit.js';

export async function maybeInstallEmulator(): Promise<void> {
  const params = new URLSearchParams(location.search);
  if (!import.meta.env.PROD || !params.has('emulate')) return;
  const { XRDevice, metaQuest3, metaVRGlasses, metaVRGlassesVisibilityMask } = await import('iwer');
  const glasses = params.has('glasses');
  const device = new XRDevice(
    glasses ? { ...metaVRGlasses, supportedFeatures: [...metaVRGlasses.supportedFeatures, 'gaze-tracking'] } : metaQuest3,
  );
  if (glasses) {
    device.primaryInputMode = 'hand';
    const eye = metaVRGlassesVisibilityMask.left;
    const deg = (radians: number) => (radians * 180) / Math.PI;
    emulateRenderExtent({ left: deg(eye.angleLeft), right: deg(eye.angleRight), up: deg(eye.angleUp), down: deg(eye.angleDown) });
  }
  device.installRuntime({ forceInstall: true });
  const room = params.get('room');
  if (room) {
    // SEM's prebuilt bundle carries its own three.js (r184): the package entry would be deduped onto the app's
    // super-three r181 by vite.config.ts and fail to build the room.
    const { SyntheticEnvironmentModule } = (await import('@iwer/sem/build/es/index.js' as string)) as typeof import('@iwer/sem');
    device.installSEM(SyntheticEnvironmentModule);
    device.sem?.loadDefaultEnvironment(room);
  }
  (window as unknown as { __xrDevice: unknown }).__xrDevice = device;
}
