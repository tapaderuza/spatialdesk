/**
 * IWSDK's PanelUISystem ticks every UIKit document each frame, and finds them by walking the whole scene and the camera
 * (two traverses and a new Set per frame, node_modules/@iwsdk/core/dist/ui/ui.js). The walk visits every element of every
 * panel (a board of cards is hundreds of nodes), measured at about 5% of the frame on the worst-case workspace.
 *
 * The documents themselves change rarely: a panel is added when something loads. So the list is kept and re-collected every
 * [REFRESH_FRAMES] frames (~110 ms at 72 fps) and at once when a PanelUI entity finishes configuring; in between, the same
 * documents are ticked from the list, with no walk and no allocation. A disposed document is skipped as before. A document
 * the walk has not seen yet (one added in the last few frames, outside a PanelUI entity) is ticked at most that late.
 *
 * This replaces one method of a framework class on purpose: it is the only way to change what the framework's own system
 * does, and it is installed once, from src/index.ts, before the world creates its systems.
 */
import { PanelUISystem, UIKitDocument } from '@iwsdk/core';

const REFRESH_FRAMES = 8;

interface Cache {
  documents: UIKitDocument[];
  countdown: number;
  collect: (object: unknown) => void;
}

type Ticking = {
  scene: { traverse(visit: (object: never) => void): void };
  camera: { traverse(visit: (object: never) => void): void };
  queries: { configuredPanels: { subscribe(event: 'qualify', listener: () => void): () => void } };
  cleanupFuncs: (() => void)[];
};

let installed = false;

export function installPanelUiCache(): void {
  if (installed) return;
  installed = true;
  const caches = new WeakMap<object, Cache>();
  const original = PanelUISystem.prototype.update;

  const cacheOf = (system: Ticking): Cache => {
    let cache = caches.get(system);
    if (!cache) {
      const documents: UIKitDocument[] = [];
      const collect = (object: unknown) => {
        if (object instanceof UIKitDocument && !object.disposed && !documents.includes(object)) documents.push(object);
      };
      const fresh: Cache = { documents, countdown: 0, collect };
      cache = fresh;
      caches.set(system, fresh);
      // A panel that has just been configured is ticked from the next frame, not up to REFRESH_FRAMES later.
      system.cleanupFuncs.push(system.queries.configuredPanels.subscribe('qualify', () => { fresh.countdown = 0; }));
    }
    return cache;
  };

  PanelUISystem.prototype.update = function (this: PanelUISystem, delta: number): void {
    const system = this as unknown as Ticking;
    if (!system.scene || !system.queries?.configuredPanels) return original.call(this, delta); // not the shape we patched
    const cache = cacheOf(system);
    if (cache.countdown-- <= 0) {
      cache.countdown = REFRESH_FRAMES - 1;
      cache.documents.length = 0;
      system.scene.traverse(cache.collect as never);
      system.camera.traverse(cache.collect as never);
    }
    for (let i = 0; i < cache.documents.length; i++) {
      const document = cache.documents[i];
      if (!document.disposed) document.rootElement.update?.(delta * 1000);
    }
  };
}
