/**
 * Production builds carry no emulator: on a Quest the browser's own WebXR runs. With `?emulate` (performance
 * gate, demo recording) the IWER Quest 3 emulator is loaded as a separate chunk before the world starts.
 * In dev the IWSDK Vite plugin already injects IWER, so this is a no-op there.
 */
export async function maybeInstallEmulator(): Promise<void> {
  if (!import.meta.env.PROD || !new URLSearchParams(location.search).has('emulate')) return;
  const { XRDevice, metaQuest3 } = await import('iwer');
  const device = new XRDevice(metaQuest3);
  device.installRuntime({ forceInstall: true });
  (window as unknown as { __xrDevice: unknown }).__xrDevice = device;
}
