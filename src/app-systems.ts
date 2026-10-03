import { PanelSystem } from './panel.js';

/**
 * Every system WE write is registered from here, so the performance gate can time exactly our code
 * (budget: p95 <= 3 ms per frame with the CPU throttled) separately from the framework's own systems.
 */
export const APP_SYSTEMS = [PanelSystem] as const;
