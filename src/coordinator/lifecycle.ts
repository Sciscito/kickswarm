import type { CellState } from '../protocol/types.js';

/**
 * State machine of a cell (§5). Splitting (§6) adds two paths to
 * `verrouillee`: when the children are created, from `en_cours` (deep split,
 * adopted automatically) or from `en_verification` (split approved by the hive owner).
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
  if (!canTransition(rec.state, to)) throw new Error(`Forbidden transition: ${rec.state} → ${to}`);
  rec.state = to;
}
