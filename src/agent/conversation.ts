/** Bounded in-memory dialogue. The workspace owns its separate log of executed actions. */
export interface ConversationTurn {
  user: string;
  assistant: string;
  outcome: 'discussed' | 'proposed' | 'applied' | 'discarded';
}

export class Conversation {
  private turns: ConversationTurn[] = [];

  snapshot(): ConversationTurn[] {
    return this.turns.map((turn) => ({ ...turn }));
  }

  remember(turn: ConversationTurn): void {
    this.turns.push({ ...turn, user: turn.user.slice(0, 1500), assistant: turn.assistant.slice(0, 2000) });
    this.turns = this.turns.slice(-6);
  }

  resolve(outcome: 'applied' | 'discarded'): void {
    const last = this.turns[this.turns.length - 1];
    if (last?.outcome === 'proposed') last.outcome = outcome;
  }

  clear(): void {
    this.turns = [];
  }
}
