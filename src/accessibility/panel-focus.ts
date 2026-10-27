const listeners = new Set<(owner: string) => void>();
/** Modal panels share a slot. Claiming it dismisses pending UI through each owner's normal cancellation path. */
export function claimPanel(owner: string): void { for (const listener of listeners) listener(owner); }
export function onPanelClaim(listener: (owner: string) => void): () => void { listeners.add(listener); return () => { listeners.delete(listener); }; }
