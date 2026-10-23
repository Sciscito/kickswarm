import type { CellState } from '../protocol/types.js';

/**
 * Machine à états d'une alvéole (§5). Le découpage (§6) ajoute deux passages vers
 * `verrouillee` : quand les enfants sont créés, depuis `en_cours` (découpage profond,
 * adopté d'office) ou depuis `en_verification` (découpage approuvé par le porteur).
 */
export const TRANSITIONS: Readonly<Record<CellState, readonly CellState[]>> = {
  verrouillee: ['libre'],
  libre: ['reservee'],
  reservee: ['en_cours', 'libre'],
  en_cours: ['en_verification', 'rejetee', 'verrouillee', 'libre'],
  en_verification: ['miel', 'rejetee', 'verrouillee'],
  rejetee: ['libre', 'bloquee'],
  bloquee: ['libre'],
  miel: [],
};

export function canTransition(from: CellState, to: CellState): boolean {
  return TRANSITIONS[from].includes(to);
}

export function transition(rec: { state: CellState }, to: CellState): void {
  if (!canTransition(rec.state, to)) throw new Error(`Transition interdite : ${rec.state} → ${to}`);
  rec.state = to;
}
