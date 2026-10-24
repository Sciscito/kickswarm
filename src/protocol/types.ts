// Objets de l'Open Swarm Protocol v0.1 (spec/OSP-v0.1.md, §4).
// Les noms de champs suivent la spec, en français.

export type Hash = `sha256:${string}`;
export type ContributorId = `ed25519:${string}` | `pq1:${string}` | `slh1:${string}`;

export type VerifClass = 'V0' | 'V1' | 'V2';
export type Caste = 'eclaireuse' | 'ouvriere' | 'gardienne' | 'batisseuse';

/** États d'une alvéole (§5). */
export type CellState =
  | 'verrouillee'
  | 'libre'
  | 'reservee'
  | 'en_cours'
  | 'en_verification'
  | 'miel'
  | 'rejetee'
  | 'bloquee';

export type HiveStatus = 'proposee' | 'active' | 'en_pause' | 'terminee' | 'refusee';

export interface Signed {
  sig?: string;
}

export interface Budget {
  tokens_max: number;
  duree_max_s: number;
}

/** Un cas de test du vérificateur V0 `tests-js@1`. */
export interface TestCase {
  nom?: string;
  fn: string;
  args: unknown[];
  attendu: unknown;
}

/** Générateur d'entrées aléatoires pour un test par propriété (OSP v0.2, §3.3). */
export type Generateur =
  | { type: 'int'; min: number; max: number }
  | { type: 'float'; min: number; max: number }
  | { type: 'bool' }
  | { type: 'string'; alphabet?: string; maxLen: number }
  | { type: 'array'; of: Generateur; maxLen: number }
  | { type: 'oneOf'; values: unknown[] };

/**
 * Test par propriété : `fn` est appelée sur des entrées tirées par `args`, et l'expression
 * JavaScript `verifie` doit être vraie. Elle voit `args`, `out` (le résultat) et `eq` (égalité profonde).
 * Exemple : pgcd → verifie = "args[0] % out === 0 && args[1] % out === 0".
 */
export interface Propriete {
  nom: string;
  fn: string;
  args: Generateur[];
  verifie: string;
  /** Nombre de cas tirés, 200 par défaut. */
  cas?: number;
}

/** Critère de fin V0 : un module ES dont les exports doivent passer les tests. */
export interface CritereV0 {
  classe: 'V0';
  verificateur: 'tests-js@1';
  /** Fichier à importer, `solution.mjs` par défaut. */
  module?: string;
  tests: TestCase[];
  proprietes?: Propriete[];
  /**
   * Engagement sur des tests cachés (§3.1) : sha256 de leur forme canonique. Les tests eux-mêmes
   * restent dans le coffre du coordinateur et ne sont révélés au registre qu'à la validation.
   */
  tests_caches_hash?: Hash;
  /** Engagement sur une implémentation de référence, qui sert à mesurer la force des tests (§3.2). */
  reference_hash?: Hash;
  timeout_ms?: number;
}

/**
 * Critère V0 pour une tâche qui consiste à écrire des tests : le livrable `tests.json` contient des
 * tests et des propriétés pour le module `cible`. Ils doivent tous passer sur la vraie cible, et
 * détecter au moins `score_min` des mutants de la cible (score de mutation, §3.2).
 */
export interface CritereTestsDeTests {
  classe: 'V0';
  verificateur: 'tests-de-tests@1';
  /** Module de la cible à tester. */
  module: string;
  cible: Livrable;
  /** Fonctions de la cible que les tests doivent couvrir. */
  fonctions: string[];
  score_min?: number;
  timeout_ms?: number;
}

/** Le MVP ne connaît que V0 ; V1 et V2 arrivent ensuite (§9.1). */
export type CritereFini = CritereV0 | CritereTestsDeTests;

/** Ce qu'un porteur ou une éclaireuse décrit avant que le coordinateur n'émette l'alvéole. */
export interface CellSpec {
  objectif: string;
  /** Texte du contexte. Le coordinateur en garde le hash dans l'alvéole. */
  capsule: string;
  critere_fini: CritereFini;
  atomique: boolean;
  budget?: Budget;
}

/** La partie secrète d'une alvéole, envoyée à côté de l'objet signé, jamais dedans. */
export interface Secrets {
  tests_caches?: TestCase[];
  reference?: Livrable;
}

/** §4.2. Le statut vit dans l'état du coordinateur : un objet signé est immuable. */
export interface Hive extends Signed {
  type: 'osp.hive/0.1';
  slug: string;
  nom: string;
  objectif: string;
  porteur: ContributorId;
  classe_verif_defaut: VerifClass;
  licence_resultats: string;
  budget: { plafond_miel: number };
}

/** §4.3 */
export interface Cell extends Signed {
  type: 'osp.cell/0.1';
  ruche: string;
  parent: Hash | null;
  chemin: string;
  objectif: string;
  capsule: Hash;
  critere_fini: CritereFini;
  budget: Budget;
  atomique: boolean;
  emise_par: 'coordinateur';
}

export interface Livrable {
  fichiers: Record<string, string>;
}

/** §4.4 */
export interface Result extends Signed {
  type: 'osp.result/0.1';
  alveole: Hash;
  auteur: ContributorId;
  caste: 'ouvriere' | 'batisseuse';
  livrable: Hash;
  impasses: string[];
  agent: { famille: string; modele?: string };
  cout: { tokens?: number; duree_s?: number };
}

/** §6.2 : la proposition de découpage d'une éclaireuse. */
export interface Decomposition extends Signed {
  type: 'osp.decomposition/0.1';
  alveole: Hash;
  auteur: ContributorId;
  enfants: CellSpec[];
}

/** §4.5 */
export interface Verdict extends Signed {
  type: 'osp.verdict/0.1';
  resultat: Hash;
  gardienne: ContributorId;
  decision: 'valide' | 'rejete' | 'abstention';
  motif: string;
  mise_reputation: number;
  piege: boolean;
  /** OSP v0.2 P1-3 : 32 octets aléatoires, pour que l'engagement ne se devine pas parmi trois décisions. */
  sel: string;
}

/**
 * OSP v0.2 P1-3 : la gardienne s'engage d'abord sur son verdict (son hash), puis le révèle
 * quand toutes les gardiennes du résultat se sont engagées. Personne ne peut copier les autres.
 */
export interface EngagementVerdict extends Signed {
  type: 'osp.engagement/0.1';
  resultat: Hash;
  gardienne: ContributorId;
  /** hashOf(verdict) : le verdict signé, sel compris. */
  engagement: Hash;
}

export type DecisionNature =
  | 'approbation_ruche'
  | 'refus_ruche'
  | 'pause'
  | 'reprise'
  | 'orientation'
  | 'approbation_decoupage'
  | 'refus_decoupage';

/** §14.6 */
export interface Decision extends Signed {
  type: 'osp.decision/0.1';
  auteur: ContributorId;
  nature: DecisionNature;
  /** Slug de ruche, `slug:branche` pour une orientation, ou hash d'un découpage. */
  cible: string;
  motif: string;
  date: string;
  params?: { multiplicateur?: number };
}

/** Requête signée pour les actions sans objet propre (prendre, commencer, rappeler). */
export interface Requete extends Signed {
  type: 'osp.requete/0.1';
  action: 'claim' | 'start' | 'release';
  contributeur: ContributorId;
  ruche?: string;
  alveole?: Hash;
  ts: number;
  nonce: string;
}

/** Ce que reçoit une abeille quand elle prend du travail. */
export interface Assignment {
  caste: Caste;
  alveole_id: Hash;
  alveole: Cell;
  capsule: string;
  profondeur: number;
  bail_expire: number;
  /** Pour une gardienne : le résultat à vérifier. */
  a_verifier?: { id: Hash; resultat: Result; livrable: Livrable };
  /** Pour une bâtisseuse : les livrables validés des enfants. */
  enfants_valides?: Array<{ chemin: string; objectif: string; module: string; livrable: Livrable }>;
}
