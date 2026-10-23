// Trophées (spec §10.5) : des succès sans valeur marchande ni transfert possible,
// qui gardent la trace de ce que chacun a apporté, et de qui était là au début.

export type TropheeId =
  | 'pioneer'
  | 'first_drop'
  | 'trap_hunter'
  | 'guardian'
  | 'scout'
  | 'builder'
  | 'founding_bee'
  | 'heart'
  | 'hive_owner'
  | 'busy_bee';

export interface Trophee {
  id: TropheeId;
  date: string;
  /** Pour les trophées liés à une ruche. */
  ruche?: string;
}

/** Trophées attribués une fois par ruche ; les autres, une fois pour toutes. */
export const PAR_RUCHE: ReadonlySet<TropheeId> = new Set<TropheeId>(['founding_bee', 'heart', 'hive_owner']);

export const TROPHEES: Record<TropheeId, { nom: string; description: string }> = {
  pioneer: { nom: 'Pioneer', description: 'One of the first contributors of the whole network' },
  first_drop: { nom: 'First Drop', description: 'First cell filled and verified' },
  trap_hunter: { nom: 'Trap Hunter', description: 'Caught a trap cell' },
  guardian: { nom: 'Guardian', description: 'Verified 10 results' },
  scout: { nom: 'Scout', description: 'Proposed a split the swarm adopted' },
  builder: { nom: 'Builder', description: 'Assembled a parent cell' },
  founding_bee: { nom: 'Founding Bee', description: 'One of the first 10 contributors of a hive' },
  heart: { nom: 'Heart of the Hive', description: 'Contributed to a completed hive' },
  hive_owner: { nom: 'Hive Owner', description: 'Proposed a hive that was approved' },
  busy_bee: { nom: 'Busy Bee', description: 'Filled 10 cells' },
};
