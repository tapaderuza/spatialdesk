import type { Comfort, Workspace } from '../workspace/model.js';

export type SharePurpose = 'task' | 'config' | 'help';
export interface ShareGrant {
  id: string;
  purpose: SharePurpose;
  createdAt: number;
  expiresAt: number;
  taskIds: string[];
  revokedAt?: number;
}

export interface SharedTasks {
  version: 1;
  tasks: { id: string; title: string; column: string }[];
}

export interface RemoteConfigurationProposal {
  id: string;
  grantId: string;
  createdAt: number;
  expiresAt: number;
  changes: Partial<Comfort>;
  requiresLocalApproval: true;
}

export const SHARE_LIMITS = Object.freeze({ taskIds: 32, minDurationMs: 60000, maxDurationMs: 3600000, proposalMs: 300000 });
const ids = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,79}$/;
const purposes: SharePurpose[] = ['task', 'config', 'help'];
const range = { reach: [0.5, 1.8], scale: [0.8, 1.8], turnDeg: [20, 120], tiltDeg: [-25, 30] } as const;

function validId(value: unknown): value is string { return typeof value === 'string' && ids.test(value) && !['constructor', 'prototype', '__proto__'].includes(value); }
function object(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value)); }

export function grantIsActive(grant: ShareGrant | null | undefined, purpose: SharePurpose, now = Date.now()): grant is ShareGrant {
  return !!grant && validId(grant.id) && grant.purpose === purpose && Number.isFinite(now) && Number.isFinite(grant.createdAt) &&
    Number.isFinite(grant.expiresAt) && grant.createdAt >= 0 && grant.createdAt <= now && grant.expiresAt > now &&
    grant.expiresAt - grant.createdAt >= SHARE_LIMITS.minDurationMs && grant.expiresAt - grant.createdAt <= SHARE_LIMITS.maxDurationMs &&
    grant.revokedAt === undefined && Array.isArray(grant.taskIds) && grant.taskIds.length <= SHARE_LIMITS.taskIds && grant.taskIds.every(validId);
}

/** Only explicitly selected fields. A title may itself be sensitive: the UI still needs a preview before sending. */
export function buildTaskShare(workspace: Workspace, grant: ShareGrant, now = Date.now()): SharedTasks | null {
  if (!grantIsActive(grant, 'task', now)) return null;
  const selected = new Set(grant.taskIds);
  const tasks: SharedTasks['tasks'] = [];
  for (const board of workspace.boards) for (const column of board.columns) for (const card of column.cards) {
    if (selected.has(card.id)) tasks.push({ id: card.id, title: card.title, column: column.title });
  }
  return { version: 1, tasks };
}

/** This only constructs a suggestion. It never calls the workspace or treats remote approval as local consent. */
export function filterConfigurationProposal(value: unknown, grant: ShareGrant, now = Date.now()): RemoteConfigurationProposal | null {
  if (!grantIsActive(grant, 'config', now) || !object(value) || Object.keys(value).some(k => !['id', 'changes'].includes(k)) || !validId(value.id) || !object(value.changes)) return null;
  const fields = Object.keys(value.changes);
  if (!fields.length || fields.some(key => key !== 'side' && !Object.prototype.hasOwnProperty.call(range, key))) return null;
  const changes: Partial<Comfort> = {};
  for (const key of fields) {
    const v = value.changes[key];
    if (key === 'side') { if (typeof v !== 'string' || !['both', 'left', 'right'].includes(v)) return null; changes.side = v as Comfort['side']; }
    else {
      const [min, max] = range[key as keyof typeof range];
      if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) return null;
      changes[key as keyof typeof range] = v;
    }
  }
  return { id: value.id, grantId: grant.id, createdAt: now, expiresAt: Math.min(grant.expiresAt, now + SHARE_LIMITS.proposalMs), changes, requiresLocalApproval: true };
}

/** Recheck the current grant at the moment the user presses Apply, not only when the proposal arrived. */
export function proposalStillAllowed(proposal: RemoteConfigurationProposal, grant: ShareGrant | null | undefined, now = Date.now()): boolean {
  return grantIsActive(grant, 'config', now) && proposal.grantId === grant.id && Number.isFinite(proposal.createdAt) && proposal.createdAt >= grant.createdAt && proposal.createdAt <= now && proposal.expiresAt > now &&
    proposal.expiresAt - proposal.createdAt <= SHARE_LIMITS.proposalMs &&
    proposal.expiresAt <= grant.expiresAt && proposal.requiresLocalApproval === true &&
    filterConfigurationProposal({ id: proposal.id, changes: proposal.changes }, grant, now) !== null;
}

/** In-memory consent ledger. These IDs describe consent; they are not authentication tokens for a network service. */
export class SharingPermissions {
  private readonly permissions = new Map<string, ShareGrant>();
  private sequence = 0;

  grant(purpose: SharePurpose, taskIds: readonly string[] = [], durationMs = 900000, now = Date.now()): ShareGrant | null {
    if (!purposes.includes(purpose) || !Number.isFinite(now) || now < 0 || !Number.isFinite(durationMs) || durationMs < SHARE_LIMITS.minDurationMs || durationMs > SHARE_LIMITS.maxDurationMs ||
      !Array.isArray(taskIds) || taskIds.length > SHARE_LIMITS.taskIds || !taskIds.every(validId) || (purpose === 'task' && !taskIds.length) || (purpose !== 'task' && taskIds.length > 0)) return null;
    const grant: ShareGrant = { id: `grant-${now}-${++this.sequence}`, purpose, createdAt: now, expiresAt: now + durationMs, taskIds: [...new Set(taskIds)] };
    this.permissions.set(grant.id, grant);
    return this.clone(grant);
  }

  get(id: string): ShareGrant | null { const grant = this.permissions.get(id); return grant ? this.clone(grant) : null; }
  list(now = Date.now()): ShareGrant[] { return [...this.permissions.values()].filter(g => grantIsActive(g, g.purpose, now)).map(g => this.clone(g)); }

  revoke(id: string, now = Date.now()): boolean {
    const grant = this.permissions.get(id);
    if (!grant || !Number.isFinite(now)) return false;
    this.permissions.set(id, { ...grant, revokedAt: now });
    return true;
  }

  revokeAll(now = Date.now()): void { for (const id of this.permissions.keys()) this.revoke(id, now); }
  snapshotTasks(workspace: Workspace, id: string, now = Date.now()): SharedTasks | null { const grant = this.permissions.get(id); return grant ? buildTaskShare(workspace, grant, now) : null; }
  proposeConfiguration(value: unknown, id: string, now = Date.now()): RemoteConfigurationProposal | null { const grant = this.permissions.get(id); return grant ? filterConfigurationProposal(value, grant, now) : null; }
  mayApprove(proposal: RemoteConfigurationProposal, now = Date.now()): boolean { return proposalStillAllowed(proposal, this.permissions.get(proposal.grantId), now); }
  private clone(grant: ShareGrant): ShareGrant { return { ...grant, taskIds: [...grant.taskIds] }; }
}
