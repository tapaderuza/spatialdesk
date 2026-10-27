export interface CommunicationPhrase { id: string; text: string }
export const COMMUNICATION_PHRASES: readonly CommunicationPhrase[] = Object.freeze([
  { id: 'pause', text: 'Necesito una pausa.' }, { id: 'help', text: 'Quiero ayuda.' },
  { id: 'yes', text: 'Sí.' }, { id: 'no', text: 'No.' },
  { id: 'repeat', text: 'Repite más despacio, por favor.' }, { id: 'water', text: 'Quiero agua.' },
]);

/** Selecting a phrase is not permission to send it, speak it, or mutate the workspace. */
export class CommunicationBoard {
  private phrases: CommunicationPhrase[] = COMMUNICATION_PHRASES.map(p => ({ ...p }));
  private serial = 0;
  private selected = '';
  get draft(): string { return this.selected; }
  list(): CommunicationPhrase[] { return this.phrases.map(p => ({ ...p })); }
  select(id: string): boolean { const p = this.phrases.find(p => p.id === id); if (!p) return false; this.selected = p.text; return true; }
  compose(value: string): boolean {
    if (typeof value !== 'string' || value.length > 240 || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value)) return false;
    this.selected = value.replace(/\s+/g, ' ').trim(); return !!this.selected;
  }
  add(value: string): boolean {
    if (this.phrases.length >= 24 || !this.compose(value)) return false;
    this.phrases.push({ id: `own-${++this.serial}`, text: this.selected }); return true;
  }
  clear(): void { this.selected = ''; }
  reset(): void { this.phrases = COMMUNICATION_PHRASES.map(p => ({ ...p })); this.selected = ''; }
}
