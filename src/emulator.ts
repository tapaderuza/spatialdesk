/**
 * Production builds carry no emulator: on a Quest the browser's own WebXR runs. With `?emulate` (performance
 * gate, demo recording) the IWER emulator is loaded as a separate chunk before the world starts:
 *  - `?glasses` emulates Meta VR Glasses (the Quest runtime with the glasses' narrower view mask) instead of Quest 3;
 *  - `?room=<id>` adds IWER's Synthetic Environment Module: a procedural real room (`home_office`, `kitchen`, ...)
 *    shown as passthrough in "In my room", with the plane detection, hit testing and anchors a Quest provides.
 * In dev the IWSDK Vite plugin already injects IWER, so this is a no-op there.
 */
export async function maybeInstallEmulator(): Promise<void> {
  const params = new URLSearchParams(location.search);
  if (!import.meta.env.PROD || !params.has('emulate')) return;
  const { XRDevice, metaQuest3, metaVRGlasses } = await import('iwer');
  const device = new XRDevice(params.has('glasses') ? metaVRGlasses : metaQuest3);
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
