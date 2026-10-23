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
  /** §9.1 : gardiennes requises pour une alvéole V0, en plus du vérificateur automatique. */
  gardiennes_v0: number;
  /** §9.4 */
  taux_pieges: number;
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
  /** Fenêtre d'acceptation des requêtes signées (anti-rejeu). */
  fenetre_requete_ms: number;
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
  taux_pieges: 0.04,
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
  fenetre_requete_ms: 5 * 60_000,
};
