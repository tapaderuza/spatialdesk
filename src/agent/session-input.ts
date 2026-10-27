/** An explicit work-session choice. Energy is reported by the user, never inferred or persisted. */
export type Energy = 'low' | 'steady';

export interface SessionChoice {
  minutes: number;
  energy: Energy;
}

export const DEFAULT_SESSION: SessionChoice = { minutes: 15, energy: 'steady' };

export function sessionChoiceFromWords(text: string): SessionChoice | null {
  const amount = /\b(?:i (?:only )?have|tengo|dispongo de|me quedan)\s+(?:solo\s+)?(\d+|five|ten|fifteen|twenty five|cinco|diez|quince|veinticinco)\s*(?:minutes?|minutos?)\b/.exec(text);
  if (!amount) return null;
  const words: Record<string, number> = { five: 5, ten: 10, fifteen: 15, 'twenty five': 25, cinco: 5, diez: 10, quince: 15, veinticinco: 25 };
  return { minutes: words[amount[1]] ?? Number(amount[1]), energy: /\b(?:tired|low energy|cansad[oa]|poca energia|baja energia)\b/.test(text) ? 'low' : 'steady' };
}
