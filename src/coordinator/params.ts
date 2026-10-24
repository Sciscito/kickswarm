// Les « (paramètre) » de la spec OSP v0.1, avec leurs valeurs de départ.
// La gouvernance (§14) peut les modifier sans changer de version.

export interface Params {
  /** §5 : le bail vaut duree_max_s × ce facteur. */
  facteur_bail: number;
  /** §5 : au-delà, l'alvéole est renvoyée en découpage. */
  rejets_avant_redecoupage: number;
  /** §6.2 */
  enfants_min: number;
  enfants_max: number;
  /** §6.4 */
  profondeur_max: number;
  /** §6.3 : les découpages jusqu'à ce niveau doivent être approuvés par le porteur. */
  niveau_approbation_porteur: number;
  /** §9.1 et OSP v0.2 §4.4 : plancher de validations par alvéole V0 (0 : le vérificateur automatique suffit). */
  gardiennes_v0: number;
  /** OSP v0.2 §2 : taux maximal de faux miel, α* (probabilité qu'une alvéole validée soit fausse). */
  alpha_faux: number;
  /** OSP v0.2 §4.2 : P(juste) d'un résultat qui a passé le vérificateur automatique, avant tout verdict. */
  p_juste_initiale: number;
  /** OSP v0.2 §5.3 : a priori Beta(a, b) de la sensibilité et de la spécificité d'une gardienne. */
  prior_sensibilite: [number, number];
  prior_specificite: [number, number];
  /** OSP v0.2 §5.3 : on pèse chaque gardienne sur ce quantile de sa fiabilité (la borne basse). */
  quantile_fiabilite: number;
  /** OSP v0.2 §5.3 : oubli progressif, appliqué aux anciennes observations à chaque nouvelle. */
  oubli_fiabilite: number;
  /** OSP v0.2 §4.4 : au-delà de ce nombre de verdicts sans conclusion, le porteur arbitre. */
  verdicts_max: number;
  /** OSP v0.2 §4.4 : un résultat qui attend ses gardiennes plus longtemps part aussi en arbitrage. */
  escalade_ms: number;
  /** §9.4 et OSP v0.2 P0-3 : taux de pièges d'une gardienne nouvelle venue ; il baisse avec sa réputation. */
  taux_pieges: number;
  /** OSP v0.2 P0-3 : plancher du taux de pièges, même pour les gardiennes les plus fiables. */
  taux_pieges_min: number;
  /** OSP v0.2 P0-3 : mutants essayés par livraison pour fabriquer des pièges. */
  pieges_essais: number;
  /** OSP v0.2 P0-3 : délai maximal avant publication d'une entrée du registre, même si une vérification reste ouverte. */
  embargo_max_ms: number;
  /** OSP v0.2 §3.2 : part minimale des mutants que les tests d'un enfant doivent détecter. */
  score_mutation_min: number;
  /** OSP v0.2 §3.2 : exiger une référence pour chaque enfant, afin de mesurer la force de ses tests. */
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
  /** OSP v0.2 P1-3 : taire son verdict après s'être engagée doit coûter plus que le pire verdict révélé. */
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
  /** §10.5 : les N premiers contributeurs du réseau reçoivent le trophée Pionnier. */
  pionniers: number;
  /** Baux simultanés autorisés par contributeur (une abeille = un bail). */
  abeilles_max: number;
  /** OSP v0.2 P0-5 : le registre est scellé au plus tard après ce délai… */
  sceau_intervalle_ms: number;
  /** … ou après ce nombre de commandes. */
  sceau_max_commandes: number;
  /** Fenêtre d'acceptation des requêtes signées (anti-rejeu). */
  fenetre_requete_ms: number;
  /** P1-3 : le tirage utilise le tour drand tourA(ts) + ce décalage. */
  balise_decalage: number;
  /** P1-3 : écart maximal entre l'horloge du contributeur et celle du coordinateur, pour un tirage équitable. */
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
