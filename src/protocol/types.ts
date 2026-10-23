// Objets de l'Open Swarm Protocol v0.1 (spec/OSP-v0.1.md, §4).
// Les noms de champs suivent la spec, en français.

export type Hash = `sha256:${string}`;
export type ContributorId = `ed25519:${string}`;

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

/** Critère de fin V0 : un module ES dont les exports doivent passer les tests. */
export interface CritereV0 {
  classe: 'V0';
  verificateur: 'tests-js@1';
  /** Fichier à importer, `solution.mjs` par défaut. */
  module?: string;
  tests: TestCase[];
  timeout_ms?: number;
}

/** Le MVP ne connaît que V0 ; V1 et V2 arrivent ensuite (§9.1). */
export type CritereFini = CritereV0;

/** Ce qu'un porteur ou une éclaireuse décrit avant que le coordinateur n'émette l'alvéole. */
export interface CellSpec {
  objectif: string;
  /** Texte du contexte. Le coordinateur en garde le hash dans l'alvéole. */
  capsule: string;
  critere_fini: CritereFini;
  atomique: boolean;
  budget?: Budget;
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
