// Open Swarm Protocol v0.1 objects (spec/OSP-v0.1.md, §4).
// Field names follow the spec, in French.

export type Hash = `sha256:${string}`;
export type ContributorId = `ed25519:${string}` | `pq1:${string}` | `slh1:${string}`;

export type VerifClass = 'V0' | 'V1' | 'V2';
export type Caste = 'eclaireuse' | 'ouvriere' | 'gardienne' | 'batisseuse';

/** States of a cell (§5). */
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

/** A test case for the V0 verifier `tests-js@1`. */
export interface TestCase {
  nom?: string;
  fn: string;
  args: unknown[];
  attendu: unknown;
}

/** Random input generator for a property test (OSP v0.2, §3.3). */
export type Generateur =
  | { type: 'int'; min: number; max: number }
  | { type: 'float'; min: number; max: number }
  | { type: 'bool' }
  | { type: 'string'; alphabet?: string; maxLen: number }
  | { type: 'array'; of: Generateur; maxLen: number }
  | { type: 'oneOf'; values: unknown[] };

/**
 * Property test: `fn` is called on inputs drawn by `args`, and the JavaScript expression
 * `verifie` must be true. It sees `args`, `out` (the result) and `eq` (deep equality).
 * Example: pgcd → verifie = "args[0] % out === 0 && args[1] % out === 0".
 */
export interface Propriete {
  nom: string;
  fn: string;
  args: Generateur[];
  verifie: string;
  /** Number of cases drawn, 200 by default. */
  cas?: number;
}

/** V0 definition of done: an ES module whose exports must pass the tests. */
export interface CritereV0 {
  classe: 'V0';
  verificateur: 'tests-js@1';
  /** File to import, `solution.mjs` by default. */
  module?: string;
  tests: TestCase[];
  proprietes?: Propriete[];
  /**
   * Commitment to hidden tests (§3.1): sha256 of their canonical form. The tests themselves
   * stay in the coordinator's vault and are revealed to the registry only on validation.
   */
  tests_caches_hash?: Hash;
  /** Commitment to a reference implementation, used to measure how strong the tests are (§3.2). */
  reference_hash?: Hash;
  timeout_ms?: number;
}

/**
 * V0 criterion for a task that consists of writing tests: the deliverable `tests.json` holds
 * tests and properties for the `cible` module. They must all pass on the real target, and
 * catch at least `score_min` of the target's mutants (mutation score, §3.2).
 */
export interface CritereTestsDeTests {
  classe: 'V0';
  verificateur: 'tests-de-tests@1';
  /** Module of the target to test. */
  module: string;
  cible: Livrable;
  /** Functions of the target the tests must cover. */
  fonctions: string[];
  score_min?: number;
  timeout_ms?: number;
}

/** The MVP only knows V0; V1 and V2 come later (§9.1). */
export type CritereFini = CritereV0 | CritereTestsDeTests;

/** What a hive owner or a scout describes before the coordinator issues the cell. */
export interface CellSpec {
  objectif: string;
  /** Context text. The coordinator keeps its hash in the cell. */
  capsule: string;
  critere_fini: CritereFini;
  atomique: boolean;
  budget?: Budget;
  /** OSP v0.3 §3.2: the cell works on a shared repository. */
  depot?: CapsuleDepot;
}

/**
 * OSP v0.3 §3.2: a repo capsule. The files read are taken from the member's own clone at `commit`
 * and checked against their hashes; `ecriture` is the cell's write scope (files, or folders ending in "/").
 */
export interface CapsuleDepot {
  url: string;
  commit: string;
  lecture: string[];
  empreintes_lecture: Record<string, Hash>;
  ecriture: string[];
}

/** The secret part of a cell, sent next to the signed object, never inside it. */
export interface Secrets {
  tests_caches?: TestCase[];
  reference?: Livrable;
}

/** §4.2. The status lives in the coordinator's state: a signed object is immutable. */
export interface Hive extends Signed {
  type: 'osp.hive/0.1';
  slug: string;
  nom: string;
  objectif: string;
  porteur: ContributorId;
  classe_verif_defaut: VerifClass;
  licence_resultats: string;
  budget: { plafond_miel: number };
  /** OSP v0.3 §2.2: set at creation, never changed. A private hive runs in its own registry. */
  visibilite?: 'publique' | 'privee';
  /** OSP v0.3 §2.5: a private hive's own guarantee (target error rate, guard floor), written at launch. */
  parametres?: { alpha_faux?: number; gardiennes_v0?: number };
  /** A private hive's random salt: its identifier, a hash, reveals nothing of its name. */
  sel?: string;
}

/** Roles in a private hive (OSP v0.3 §2.3). */
export type RolePrive = 'proprietaire' | 'membre' | 'observateur';

/**
 * OSP v0.3 §2.2: an invitation into a private hive, signed by its owner. Only the hash of the
 * code (salted) is stored: reading the registry does not reveal it.
 */
export interface Invitation extends Signed {
  type: 'osp.invitation/0.3';
  /** The private hive's identifier. */
  ruche: string;
  role: 'membre' | 'observateur';
  /** sha256(sel ":" code), with the code in its normal form (upper case, no spaces). */
  code_hash: Hash;
  sel: string;
  utilisations_max: number;
  /** Unix time in ms after which the code no longer works. */
  expire: number;
  auteur: ContributorId;
  ts: number;
  nonce: string;
}

/** OSP v0.3 §2.2: a person asks to join a private hive with an invitation code. */
export interface Adhesion extends Signed {
  type: 'osp.adhesion/0.3';
  contributeur: ContributorId;
  code: string;
  ts: number;
  nonce: string;
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
  /** OSP v0.3 §3.2, only on repo cells. */
  depot?: CapsuleDepot;
}

export interface Livrable {
  fichiers: Record<string, string>;
  /** OSP v0.3 §3.2: files of the write scope that the deliverable deletes. */
  supprimes?: string[];
  /**
   * OSP v0.3 §3.2: repository files the deliverable reads (the cell's `lecture`), exactly as pinned by
   * their hashes. Present when the tests run, never written to the repository.
   */
  contexte?: Record<string, string>;
}

/**
 * OSP v0.3 §3.3: a repo receipt, signed by the member who runs the bridge. It says which commit
 * holds a cell's honey; `fichiers` gives the git hash of each file, so anyone can compare.
 */
export interface RecuDepot extends Signed {
  type: 'osp.recu_depot/0.3';
  alveole: Hash;
  resultat: Hash;
  depot: string;
  branche: string;
  commit: string;
  /** The commit it was built on: the branch's previous head, or the cell's base commit. */
  parent: string;
  fichiers: Record<string, string>;
  supprimes: string[];
  pr: string | null;
  auteur: ContributorId;
  ts: number;
  nonce: string;
}

/** OSP v0.3 §3.3: a member links their GitHub name to their Kickswarm identity, once. */
export interface LienGithub extends Signed {
  type: 'osp.lien_github/0.3';
  contributeur: ContributorId;
  github: string;
  ts: number;
  nonce: string;
}

/** OSP v0.3 §3.3: the bridge saw a pull request merged by a human. External evidence: the audit lists it apart. */
export interface FusionDepot extends Signed {
  type: 'osp.fusion_depot/0.3';
  recu: Hash;
  pr: string;
  fusionnee_par: string;
  commit_fusion: string;
  auteur: ContributorId;
  ts: number;
  nonce: string;
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

/** §6.2: a scout's proposed split. */
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
  /** OSP v0.2 P1-3: 32 random bytes, so the commitment cannot be guessed among three decisions. */
  sel: string;
}

/**
 * OSP v0.2 P1-3: the guard first commits to its verdict (its hash), then reveals it
 * once every guard of the result has committed. Nobody can copy the others.
 */
export interface EngagementVerdict extends Signed {
  type: 'osp.engagement/0.1';
  resultat: Hash;
  gardienne: ContributorId;
  /** hashOf(verdict): the signed verdict, salt included. */
  engagement: Hash;
}

export type DecisionNature =
  | 'approbation_ruche'
  | 'refus_ruche'
  | 'pause'
  | 'reprise'
  | 'orientation'
  | 'approbation_decoupage'
  | 'refus_decoupage'
  /** OSP v0.2 §4.4: the hive owner settles an escalated result (cible: the result's identifier). */
  | 'arbitrage_valide'
  | 'arbitrage_rejet'
  /** OSP v0.3 §2.3, private hives only: the owner gives a member a role (cible: the member; params.role, params.gardienne). */
  | 'role_attribue'
  /** The owner removes a member (cible: the member). Their past work stays in the registry. */
  | 'role_retire'
  /** A member leaves (cible: themselves). */
  | 'depart'
  /** The owner revokes an invitation not used up yet (cible: the invitation's identifier). */
  | 'invitation_revoquee';

/** §14.6 */
export interface Decision extends Signed {
  type: 'osp.decision/0.1';
  auteur: ContributorId;
  nature: DecisionNature;
  /** Hive slug, `slug:branch` for an orientation, or hash of a split. */
  cible: string;
  motif: string;
  date: string;
  params?: { multiplicateur?: number; role?: 'membre' | 'observateur'; gardienne?: boolean };
}

/** Signed request for actions with no object of their own (claim, start, release). */
export interface Requete extends Signed {
  type: 'osp.requete/0.1';
  /** `lire`: a member asks for a read ticket on a private hive (OSP v0.3 §2.8). */
  action: 'claim' | 'start' | 'release' | 'lire';
  contributeur: ContributorId;
  ruche?: string;
  alveole?: Hash;
  ts: number;
  nonce: string;
}

/** What a bee receives when it claims work. */
export interface Assignment {
  caste: Caste;
  alveole_id: Hash;
  alveole: Cell;
  capsule: string;
  profondeur: number;
  bail_expire: number;
  /**
   * For a guard: the deliverable to verify, and the identifier to cite in its verdict.
   * Verification is anonymous (OSP v0.2 P0-3): neither the author, nor anything that sets a trap apart.
   */
  a_verifier?: { id: Hash; livrable: Livrable };
  /** For a builder: the children's validated deliverables. */
  enfants_valides?: Array<{ chemin: string; objectif: string; module: string; livrable: Livrable }>;
}
