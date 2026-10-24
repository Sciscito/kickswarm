// The "(parameter)" values of the OSP v0.1 spec, with their starting values.
// Governance (§14) can change them without changing the version.

export interface Params {
  /** §5: the lease lasts duree_max_s × this factor. */
  facteur_bail: number;
  /** §5: beyond this, the cell is sent back for splitting. */
  rejets_avant_redecoupage: number;
  /** §6.2 */
  enfants_min: number;
  enfants_max: number;
  /** §6.4 */
  profondeur_max: number;
  /** §6.3: splits up to this level must be approved by the hive owner. */
  niveau_approbation_porteur: number;
  /** §9.1 and OSP v0.2 §4.4: minimum number of validations per V0 cell (0: the automatic verifier is enough). */
  gardiennes_v0: number;
  /** OSP v0.2 §2: maximum rate of false honey, α* (probability that a validated cell is false). */
  alpha_faux: number;
  /** OSP v0.2 §4.2: P(correct) of a result that passed the automatic verifier, before any verdict. */
  p_juste_initiale: number;
  /** OSP v0.2 §5.3: Beta(a, b) prior of a guard's sensitivity and specificity. */
  prior_sensibilite: [number, number];
  prior_specificite: [number, number];
  /** OSP v0.2 §5.3: each guard is weighted on this quantile of their reliability (the lower bound). */
  quantile_fiabilite: number;
  /** OSP v0.2 §5.3: gradual forgetting, applied to old observations at each new one. */
  oubli_fiabilite: number;
  /** OSP v0.2 §4.4: beyond this number of verdicts without a conclusion, the hive owner arbitrates. */
  verdicts_max: number;
  /** OSP v0.2 §4.4: a result that waits longer than this for its guards also goes to arbitration. */
  escalade_ms: number;
  /** §9.4 and OSP v0.2 P0-3: trap rate of a newcomer guard; it decreases with their reputation. */
  taux_pieges: number;
  /** OSP v0.2 P0-3: floor of the trap rate, even for the most reliable guards. */
  taux_pieges_min: number;
  /** OSP v0.2 P0-3: mutants tried per delivery to make traps. */
  pieges_essais: number;
  /**
   * OSP v0.3 §2.6: a private hive's instance. Its honey stays local (no power shares, no Commons), and
   * only its members take part. Written at launch, so the audit knows which invariants apply.
   */
  prive: boolean;
  /** Version of the mutation engine (it is part of the replay). A registry that does not announce it uses version 1. */
  moteur_mutation: number;
  /** OSP v0.2 P0-3: maximum delay before a registry entry is published, even if a verification is still open. */
  embargo_max_ms: number;
  /** OSP v0.2 §3.2: minimum share of mutants that a child's tests must detect. */
  score_mutation_min: number;
  /** OSP v0.2 §3.2: require a reference for each child, to measure the strength of its tests. */
  reference_obligatoire: boolean;
  /** §10.1 */
  miel_base: number;
  bonus_coeur: number;
  part_gardienne: number;
  bonus_piege: number;
  bonus_faux_reel: number;
  miel_eclaireuse: number;
  part_porteur: number;
  /** §10.2 */
  reputation_initiale: number;
  gain_reputation: number;
  facteur_verdict_renverse: number;
  facteur_bail_expire: number;
  facteur_piege_valide: number;
  facteur_resultat_rejete: number;
  /** OSP v0.2 P1-3: withholding a verdict after committing must cost more than the worst revealed verdict. */
  facteur_non_revele: number;
  /** §12 */
  plancher_anti_famine: number;
  multiplicateur_max_total: number;
  /** §17 */
  orientation_max: number;
  orientation_duree_ms: number;
  /** §18.2 */
  taux_cristallisation: number;
  parts_par_gramme: number;
  ratio_commun: number;
  allocation_fondateur: number;
  allocation_fondateur_duree_ms: number;
  /** §10.5: the first N contributors of the network receive the Pioneer trophy. */
  pionniers: number;
  /** Simultaneous leases allowed per contributor (one bee = one lease). */
  abeilles_max: number;
  /** OSP v0.2 P0-5: the registry is sealed at the latest after this delay… */
  sceau_intervalle_ms: number;
  /** … or after this number of commands. */
  sceau_max_commandes: number;
  /** Acceptance window for signed requests (anti-replay). */
  fenetre_requete_ms: number;
  /** P1-3: the draw uses drand round tourA(ts) + this offset. */
  balise_decalage: number;
  /** P1-3: maximum gap between the contributor's clock and the coordinator's, for a fair draw. */
  fenetre_balise_ms: number;
}

const HEURE = 3600_000;

export const DEFAULT_PARAMS: Params = {
  facteur_bail: 1.5,
  rejets_avant_redecoupage: 3,
  enfants_min: 2,
  enfants_max: 12,
  profondeur_max: 8,
  niveau_approbation_porteur: 1,
  gardiennes_v0: 2,
  alpha_faux: 1e-4,
  p_juste_initiale: 0.9,
  prior_sensibilite: [9, 1],
  prior_specificite: [19, 1],
  quantile_fiabilite: 0.05,
  oubli_fiabilite: 0.995,
  verdicts_max: 9,
  escalade_ms: 2 * HEURE,
  taux_pieges: 0.1,
  taux_pieges_min: 0.01,
  pieges_essais: 8,
  moteur_mutation: 2,
  prive: false,
  embargo_max_ms: 2 * HEURE,
  score_mutation_min: 0.8,
  reference_obligatoire: false,
  miel_base: 6,
  bonus_coeur: 80,
  part_gardienne: 0.2,
  bonus_piege: 12,
  bonus_faux_reel: 6,
  miel_eclaireuse: 6,
  part_porteur: 0.05,
  reputation_initiale: 0.2,
  gain_reputation: 0.05,
  facteur_verdict_renverse: 0.9,
  facteur_bail_expire: 0.98,
  facteur_piege_valide: 0.5,
  facteur_resultat_rejete: 0.95,
  facteur_non_revele: 0.5,
  plancher_anti_famine: 0.05,
  multiplicateur_max_total: 5,
  orientation_max: 3,
  orientation_duree_ms: 72 * HEURE,
  taux_cristallisation: 0.1,
  parts_par_gramme: 1,
  ratio_commun: 3 / 7,
  allocation_fondateur: 0.02,
  allocation_fondateur_duree_ms: 4 * 365 * 24 * HEURE,
  pionniers: 1000,
  abeilles_max: 3,
  sceau_intervalle_ms: 2000,
  sceau_max_commandes: 50,
  fenetre_requete_ms: 5 * 60_000,
  balise_decalage: 3,
  fenetre_balise_ms: 4000,
};
