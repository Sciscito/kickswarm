import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { idRuchePrivee, normaliserCode } from '../protocol/builders.js';
import { canonicalize, commitment, hashOf, sha256 } from '../protocol/canonical.js';
import { blobsDuLivrable, chevauchent, empreinteLecture, horsPortee, inclus, validateDepot } from '../protocol/depot.js';
import { playbook, PLAYBOOKS } from '../playbooks/index.js';
import { generateIdentity, isContributorId, signObject, verifyObject, type Identity } from '../protocol/identity.js';
import type {
  FusionDepot,
  LienGithub,
  RecuDepot,
  Adhesion,
  Assignment,
  Caste,
  Cell,
  CellSpec,
  CellState,
  ContributorId,
  Decision,
  Decomposition,
  EngagementVerdict,
  Hash,
  Hive,
  HiveStatus,
  Invitation,
  Livrable,
  Requete,
  Result,
  RolePrive,
  Secrets,
  TestCase,
  Verdict,
} from '../protocol/types.js';
import { mutants } from '../verifier/mutation.js';
import { adequation, estCritereTests, validateCritere, validateLivrable, validateTests, verifierV0, type VerifOptions, type VerifReport } from '../verifier/v0.js';
import { COMMUN, Ledger, type Account } from './ledger.js';
import { transition } from './lifecycle.js';
import { DEFAULT_PARAMS, type Params } from './params.js';
import { Registry } from './registry.js';
import { graine, rngDepuis, tourA, verifierBalise, type Balise, type BaliseInfo, type SourceBalise } from './balise.js';
import { logit, observer, poidsValide, VIERGE, type Fiabilite } from './fiabilite.js';
import { brancheOf, chooseCandidate, type Rng } from './scheduler.js';
import { PAR_RUCHE, type Trophee, type TropheeId } from './trophees.js';

/** Protocol error, with the HTTP status to return. */
export class OspError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

interface Bail {
  par: ContributorId;
  caste: Caste;
  expire: number;
}

export interface CellRecord {
  id: Hash;
  cell: Cell;
  capsule_texte: string;
  state: CellState;
  profondeur: number;
  enfants: Hash[];
  bail?: Bail;
  /** Guards drawn for the pending result, who have not committed yet (active leases). */
  gardiennes: Bail[];
  /** Guards who have already validated the pending result. */
  verdicts: ContributorId[];
  /** OSP v0.2 P0-4: log-odds of the pending result (Wald test), and number of revealed verdicts. */
  cote?: number;
  nb_verdicts?: number;
  rejets: number;
  /** §5: after too many rejections, the cell goes back to splitting. */
  redecouper: boolean;
  /** Result or split awaiting its verification. */
  en_attente?: Hash;
  resultat_valide?: Hash;
  validee_par?: ContributorId[];
  /** Mutation score of its tests against a reference (OSP v0.2, §3.2), if it was measured. */
  force_tests?: number;
}

interface Orientation {
  branche: string;
  multiplicateur: number;
  expire: number;
  auteur: ContributorId;
  decision: Hash;
}

interface HiveRecord {
  ruche: Hive;
  id: Hash;
  statut: HiveStatus;
  racine: Hash;
  branches: Record<string, { succes: number; echecs: number }>;
  orientations: Orientation[];
  /** Honey earned in this hive, per contributor (for the heart bonus). */
  contributions: Record<string, number>;
}

interface ResultRecord {
  resultat: Result;
  livrable: Livrable;
  rapport: VerifReport;
  statut: 'en_verification' | 'valide' | 'rejete';
  soumis_a: number;
  /** OSP v0.2 P0-3: mutants of this deliverable that the guards' checks reject, from most to least subtle. */
  mutants: Array<{ livrable: Livrable; echecs: number }>;
  /** OSP v0.2 P0-4: without a conclusion (too many verdicts, or too long a wait), the hive owner arbitrates. */
  escalade?: boolean;
}

interface DecompRecord {
  decomposition: Decomposition;
  statut: 'en_attente' | 'adoptee' | 'refusee';
  /** Mutation score measured for each child (null: no reference provided). */
  force_tests: Array<number | null>;
}

/**
 * OSP v0.2 P0-3: a trap is a mutant of the real delivery pending on the cell,
 * handed out in its place. It takes a guard slot, like a real result.
 */
interface Piege {
  livrable: Livrable;
  alveole: Hash;
  /** The real result it is a mutant of. */
  vraie: Hash;
  attribue_a: ContributorId;
  expire: number;
  /** P1-3: the guard's commitment, as for a real result. */
  engagement?: Hash;
}

/** P1-3: a guard committed on a result, whose verdict stays sealed. */
interface Engagement {
  par: ContributorId;
  engagement: Hash;
  /** End of the reveal window (it only runs once the reveal is open). */
  expire: number;
}

export interface BoardEntry {
  nature: 'decouverte' | 'impasse' | 'question';
  chemin: string;
  texte: string;
  auteur?: ContributorId;
  date: string;
  source?: Hash;
}

interface RecuRecord {
  alveole: Hash;
  resultat: Hash;
  branche: string;
  commit: string;
  parent: string;
  pr: string | null;
  auteur: ContributorId;
  date: string;
}

interface FusionRecord {
  pr: string;
  fusionnee_par: string;
  commit_fusion: string;
  auteur: ContributorId;
  date: string;
}


/** A project's dashboard (see Coordinator.tableauProjet). */
export interface TableauProjet {
  ruche: { slug: string; nom: string; objectif: string; statut: HiveStatus; porteur: string; playbook?: string };
  progression: { miel: number; total: number };
  jalons: Array<{ seuil: number; atteint: boolean; date?: string }>;
  maintenant: { abeilles: number; parCaste: Record<Caste, number>; ia: number };
  travaux: Array<{ chemin: string; objectif: string; caste: Caste; abeille: string; depuis?: string }>;
  verifications: Array<{ chemin: string; objectif: string; gardes: number; valides: number }>;
  attente: Array<{ type: 'approbation_ruche' | 'approbation_decoupage' | 'arbitrage' | 'pause'; qui: 'founder' | 'owner'; texte: string; chemin?: string; cible?: string }>;
  branches: Array<{ chemin: string; objectif: string; miel: number; total: number; termine: boolean }>;
  modeles: Array<{ modele: string; famille: string; soumis: number; valides: number; rejetes: number; en_cours: number; score: number }>;
  contributeurs: Array<{ id: string; grammes: number; trophees: string[] }>;
  contributeurs_total: number;
  miel_total: number;
  rythme: { tempsCelluleMs: number | null; mesures: number; restantes: number };
  fil: Array<{ date: string; nature: string; chemin?: string; qui?: string; trophee?: string; grammes?: number }>;
}

export interface DetailCellule {
  cell: Cell;
  etat: CellState;
  capsule: string;
  resultat?: { id: Hash; auteur: ContributorId; agent: Result['agent']; livrable: Livrable; validee_par: ContributorId[] };
  /** The author's GitHub name, if they linked it. */
  github?: string;
  recus: Array<RecuRecord & { id: string; fusion?: FusionRecord }>;
}

const SHA_GIT = /^[0-9a-f]{40}([0-9a-f]{24})?$/;
const CASTES = new Set<string>(['eclaireuse', 'ouvriere', 'batisseuse', 'gardienne']);
const GITHUB_RE = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;

interface State {
  fondateur: ContributorId;
  lancement: number;
  hives: Record<string, HiveRecord>;
  cells: Record<string, CellRecord>;
  results: Record<string, ResultRecord>;
  decompositions: Record<string, DecompRecord>;
  pieges: Record<string, Piege>;
  /** P1-3: sealed verdicts, per result. */
  engagements: Record<string, Engagement[]>;
  /** P0-4: reliability of each guard (sensitivity and specificity, Beta distributions). */
  fiabilite: Record<string, Fiabilite>;
  /** OSP v0.3 §2.3, private hives only (absent elsewhere, so older registries keep their state hashes). */
  membres?: Record<string, { role: RolePrive; gardienne: boolean; depuis: number }>;
  /** OSP v0.3 §2.2, private hives only: invitations, by identifier. */
  invitations?: Record<string, { code_hash: Hash; sel: string; role: 'membre' | 'observateur'; utilisations_max: number; utilisations: number; expire: number; revoquee: boolean }>;
  /** OSP v0.3 §3.3, created with the first one: GitHub names linked to identities. */
  liens_github?: Record<string, string>;
  /** OSP v0.3 §3.3, created with the first one: repo receipts, by identifier. */
  recus?: Record<string, RecuRecord>;
  /** OSP v0.3 §3.3: merges seen by a bridge, by receipt. External evidence. */
  fusions?: Record<string, FusionRecord>;
  board: Record<string, BoardEntry[]>;
  accounts: Record<string, Account>;
  nonces: Record<string, number>;
  trophees: Record<string, Trophee[]>;
  compteurs: Record<string, { alveoles: number; verifications: number }>;
  /** Arrival order of contributors, for the Pioneer trophy. */
  contributeurs: string[];
}

/** The commands that change the state. Each one is written in full to the registry (OSP v0.2, §6.1). */
export type CommandeType =
  | 'proposeHive' | 'decide' | 'claim' | 'start' | 'release' | 'submitResult' | 'submitDecomposition' | 'engageVerdict' | 'submitVerdict' | 'inviter' | 'rejoindre'
  | 'recuDepot' | 'lienGithub' | 'fusionDepot';

/**
 * The content of a `commande` entry: the signed objects received, plus everything that is not
 * deterministic (the time, the draws, the coordinator's signatures, the verifier's reports)
 * and the hash of the resulting state. That is enough to replay the whole history identically.
 */
export interface CommandeDonnees {
  type: CommandeType;
  entree: Record<string, unknown>;
  at: number;
  alea: number[];
  signatures: string[];
  verifs: VerifReport[];
  /** Secrets revealed during the command (hidden tests, references), by commitment. */
  secrets?: Record<string, unknown>;
  /** P1-3: the public randomness beacon this command's draws follow from. */
  balise?: Balise;
  /** P0-3: secret draws (the traps), outside the public beacon; published with the command, after the embargo. */
  alea_secret?: number[];
  etat: Hash;
}

/** The beacon announced at launch: its network, its key, and the offset in rounds. */
export type BaliseAnnoncee = BaliseInfo & { decalage: number };

interface ReplayStep {
  at: number;
  alea: number[];
  alea_secret: number[];
  signatures: string[];
  verifs: VerifReport[];
  secrets: Record<string, unknown>;
}

/** The replay does not reproduce the history written in the registry. */
export class ReplayDivergence extends Error {}

export type Verifier = (critere: Cell['critere_fini'], livrable: Livrable, opts?: VerifOptions) => Promise<VerifReport>;

export interface CoordinatorOptions {
  fondateur: ContributorId;
  /** Persistence folder (state + registry). Without a folder, everything stays in memory. */
  dataDir?: string;
  params?: Partial<Params>;
  rng?: Rng;
  now?: () => number;
  /** Automatic verifier, replaceable for tests. */
  verifier?: Verifier;
  /** P1-3: the public randomness beacon (drand). Without it, the coordinator draws its own random numbers. */
  balise?: SourceBalise;
  /** Audit mode: replays an existing registry, with the public identities it announces. */
  replay?: { coordinateur: ContributorId; pieges: ContributorId; balise?: BaliseAnnoncee };
}

export interface HiveView {
  ruche: Hive;
  statut: HiveStatus;
  progression: { miel: number; total: number };
  orientations: Array<{ branche: string; multiplicateur: number; expire: string }>;
  alveoles: Array<{
    id: Hash;
    chemin: string;
    objectif: string;
    etat: CellState;
    profondeur: number;
    atomique: boolean;
    rejets: number;
    enfants: number;
  }>;
}

export interface LiveView {
  ruche: { slug: string; nom: string; objectif: string; porteur: ContributorId; statut: HiveStatus };
  fondateur: ContributorId;
  progression: { miel: number; total: number };
  miel_total: number;
  commun: number;
  orientations: Array<{ branche: string; multiplicateur: number }>;
  alveoles: Array<{
    id: Hash;
    chemin: string;
    parent: Hash | null;
    objectif: string;
    etat: CellState;
    profondeur: number;
    rejets: number;
    abeille?: { par: ContributorId; caste: Caste };
    gardiennes: ContributorId[];
    auteur?: ContributorId;
    validee_par?: ContributorId[];
  }>;
  classement: Array<{ id: string; grammes: number; trophees: TropheeId[] } & Account>;
  journal: import('./registry.js').RegistryEntry[];
}

const SLUG_RE = /^[a-z0-9][a-z0-9-]{2,39}$/;
const DEFAULT_BUDGET = { tokens_max: 200_000, duree_max_s: 1800 };
const MAX_IMPASSES = 20;

/** A uniform float on [0, 1), 53 bits drawn from the cryptographic generator. */
function aleaCrypto(): number {
  const b = randomBytes(7);
  return (b.readUIntBE(0, 6) * 32 + (b[6]! >>> 3)) / 2 ** 53;
}

function cheminCompare(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? -1) - (pb[i] ?? -1);
    if (d) return d;
  }
  return 0;
}

export class Coordinator {
  readonly params: Params;
  readonly registry: Registry;
  readonly identite: Identity;
  private readonly identitePieges: Identity;
  private readonly ledger: Ledger;
  private state: State;
  private readonly baseRng: Rng;
  private readonly baseNow: () => number;
  private readonly verifier: Verifier;
  private readonly occupees = new Set<Hash>();
  /** During a command: the frozen time, and what must be recorded to replay it. */
  private clock: number | null = null;
  private recording: { alea: number[]; alea_secret: number[]; signatures: string[]; secrets: Record<string, unknown> } | null = null;
  private replayCtx: { alea: number[]; alea_secret: number[]; signatures: string[]; secrets: Record<string, unknown> } | null = null;
  /** P0-3: the secret randomness of traps (cryptographic, never drawn from the public beacon). */
  private readonly baseRngSecret: Rng;
  /** P0-3: every trap draw, with the announced rate: enough to check the rates statistically. */
  readonly journalPieges: Array<{ taux: number; piege: boolean }> = [];
  private readonly rangsSoumission = new Map<string, number>();
  /** The vault: hidden tests and references, by commitment. Private, outside the state and the registry. */
  private coffre: Record<string, unknown> = {};
  private replayNext: ReplayStep | null = null;
  private dernierSceau = 0;
  private commandesSansSceau = 0;
  /** During a request drawn with the beacon: the draws follow from it, and are recorded. */
  private tirageBalise: { rng: Rng; balise: Balise; tirages: number[] } | null = null;

  private readonly now = (): number => this.clock ?? this.baseNow();

  private readonly rng: Rng = () => {
    if (this.tirageBalise) {
      const v = this.tirageBalise.rng();
      this.tirageBalise.tirages.push(v);
      return v;
    }
    if (this.replayCtx) {
      const v = this.replayCtx.alea.shift();
      if (v === undefined) throw new ReplayDivergence('Random draw missing from the registry');
      return v;
    }
    const v = this.baseRng();
    this.recording?.alea.push(v);
    return v;
  };

  /**
   * P0-3: the randomness of traps. A guard can recompute their drand draws; if the trap followed
   * from them, they would know in advance that they are getting one. So it comes from secret randomness,
   * recorded with the command and published only after the embargo.
   */
  private readonly rngSecret: Rng = () => {
    if (this.replayCtx) {
      const v = this.replayCtx.alea_secret.shift();
      if (v === undefined) throw new ReplayDivergence('Secret draw missing from the registry');
      return v;
    }
    const v = this.baseRngSecret();
    this.recording?.alea_secret.push(v);
    return v;
  };

  constructor(private readonly options: CoordinatorOptions) {
    if (!isContributorId(options.fondateur)) throw new Error('Invalid founder identifier');
    this.params = { ...DEFAULT_PARAMS, ...options.params };
    // A registry that announces no mutation engine version was written with version 1.
    if (options.replay && options.params?.moteur_mutation === undefined) this.params.moteur_mutation = 1;
    // Cryptographic randomness: past draws are public, they must not allow guessing the next ones.
    this.baseRng = options.rng ?? aleaCrypto;
    this.baseRngSecret = options.rng ?? aleaCrypto;
    this.baseNow = options.now ?? Date.now;
    this.verifier = options.verifier ?? verifierV0;
    if (options.replay && options.dataDir) throw new Error('Audit mode works in memory, without a data folder');

    const dir = options.dataDir;
    if (dir) mkdirSync(dir, { recursive: true });
    this.registry = new Registry(dir ? join(dir, 'registre.jsonl') : undefined, () => this.now());

    const keysFile = dir ? join(dir, 'cles.json') : undefined;
    if (options.replay) {
      this.identite = { id: options.replay.coordinateur, privateKeyPem: '' };
      this.identitePieges = { id: options.replay.pieges, privateKeyPem: '' };
    } else if (keysFile && existsSync(keysFile)) {
      const coffreFile = join(dir!, 'coffre.json');
      if (existsSync(coffreFile)) this.coffre = JSON.parse(readFileSync(coffreFile, 'utf8')) as Record<string, unknown>;
      const keys = JSON.parse(readFileSync(keysFile, 'utf8')) as { coordinateur: Identity; pieges: Identity };
      this.identite = keys.coordinateur;
      this.identitePieges = keys.pieges;
    } else {
      // The coordinator signs with SLH-DSA: security that rests only on the hash function.
      this.identite = generateIdentity('slh1');
      this.identitePieges = generateIdentity('slh1');
      if (keysFile) writeFileSync(keysFile, JSON.stringify({ coordinateur: this.identite, pieges: this.identitePieges }, null, 2), 'utf8');
    }

    const stateFile = dir ? join(dir, 'etat.json') : undefined;
    if (stateFile && existsSync(stateFile)) {
      this.state = JSON.parse(readFileSync(stateFile, 'utf8')) as State;
      if (this.state.fondateur !== options.fondateur) {
        throw new Error('This data folder belongs to another founder');
      }
    } else {
      // A single clock read for the launch: the state and the registry entry must agree.
      this.clock = this.baseNow();
      this.state = {
        fondateur: options.fondateur,
        lancement: this.clock,
        hives: {},
        cells: {},
        results: {},
        decompositions: {},
        pieges: {},
        engagements: {},
        fiabilite: {},
        board: {},
        accounts: {},
        nonces: {},
        trophees: {},
        compteurs: {},
        contributeurs: [],
      };
      const balise = this.baliseAnnoncee();
      this.registry.append('lancement', {
        // On replay, the parameters as the registry announces them: a parameter added since then does not change the entry.
        fondateur: options.fondateur, coordinateur: this.identite.id, pieges: this.identitePieges.id,
        params: options.replay && options.params ? options.params : this.params, ...(balise ? { balise } : {}),
      });
      this.clock = null;
      if (!options.replay) this.sceller();
    }
    this.normalizeState();
    this.ledger = new Ledger(this.params, options.fondateur, this.state.lancement, this.registry, () => this.now());
    this.ledger.accounts = this.state.accounts;
    // The state on disk must be exactly the one the registry's last command announces.
    const derniere = [...this.registry.entries].reverse().find((e) => e.nature === 'commande');
    if (derniere && (derniere.donnees as CommandeDonnees).etat !== this.stateHash()) {
      throw new Error('Local state inconsistent with the registry: run "kickswarm audit" to rebuild and understand');
    }
    this.save();
  }

  /**
   * Seals the registry (OSP v0.2, P0-5): the coordinator signs the hash of the last entry with SLH-DSA.
   * Since that hash chains the whole history, a single seal authenticates everything before it.
   */
  sceller(): void {
    if (this.options.replay) throw new Error('A coordinator in audit mode does not seal: it imports the seals');
    const tete = this.registry.entries[this.registry.entries.length - 1];
    if (!tete || tete.nature === 'sceau') return;
    const sceau = signObject({ type: 'osp.sceau/0.1' as const, coordinateur: this.identite.id, seq: tete.seq, tete: tete.hash }, this.identite);
    this.registry.append('sceau', sceau);
    this.dernierSceau = this.baseNow();
    this.commandesSansSceau = 0;
  }

  private peutEtreSceller(): void {
    this.commandesSansSceau++;
    const du = this.commandesSansSceau >= this.params.sceau_max_commandes || this.baseNow() - this.dernierSceau >= this.params.sceau_intervalle_ms;
    if (du) this.sceller();
  }

  /** Audit mode: takes a seal from the original registry, after checking its signature. */
  importSceau(date: string, sceau: { type: string; coordinateur: string; seq: number; tete: string; sig?: string }): void {
    if (!this.options.replay) throw new Error('Seal import is reserved for audit mode');
    const tete = this.registry.entries[this.registry.entries.length - 1];
    if (sceau.type !== 'osp.sceau/0.1' || sceau.coordinateur !== this.identite.id || !tete || sceau.seq !== tete.seq || sceau.tete !== tete.hash) {
      throw new ReplayDivergence(`Seal inconsistent with the registry at entry #${tete?.seq}`);
    }
    if (!verifyObject(sceau, this.identite.id)) throw new ReplayDivergence('Invalid seal signature');
    this.clock = Date.parse(date);
    try {
      this.registry.append('sceau', sceau);
    } finally {
      this.clock = null;
    }
  }

  /** The registry's last seal, if there is one. */
  dernierSceauInscrit(): { seq: number; sceau: unknown } | undefined {
    for (let i = this.registry.entries.length - 1; i >= 0; i--) {
      const e = this.registry.entries[i]!;
      if (e.nature === 'sceau') return { seq: e.seq, sceau: e.donnees };
    }
    return undefined;
  }

  /**
   * What the coordinator publishes in real time (P0-3): the registry content up to the horizon,
   * with the state that follows from it, and the actual registry head, with its last seal. The head
   * commits to everything still under embargo: an observer who notes it sees any later rewrite.
   */
  etatPublie(): { seq: number; etat: Hash | null; tete: { seq: number; hash: Hash } | null; sceau: { seq: number; sceau: unknown } | null } {
    const seq = this.horizon();
    let etat: Hash | null = null;
    for (let i = seq; i >= 0; i--) {
      const e = this.registry.entries[i]!;
      if (e.nature === 'commande') {
        etat = (e.donnees as CommandeDonnees).etat;
        break;
      }
    }
    const t = this.registry.entries[this.registry.entries.length - 1];
    return { seq, etat, tete: t ? { seq: t.seq, hash: t.hash } : null, sceau: this.dernierSceauInscrit() ?? null };
  }

  /** Fingerprint of the complete state: what auditors compare. */
  stateHash(): Hash {
    return sha256(canonicalize(this.state));
  }

  /** For an audit's re-verification: a cell's done criterion. */
  critereOf(cellId: Hash): Cell['critere_fini'] | undefined {
    return this.state.cells[cellId]?.cell.critere_fini;
  }

  /** For an audit's re-verification: a result's deliverable and the criterion it must pass. */
  resultForReverify(resultId: Hash): { critere: Cell['critere_fini']; livrable: Livrable } | undefined {
    const rr = this.state.results[resultId];
    const rec = rr ? this.state.cells[rr.resultat.alveole] : undefined;
    return rr && rec ? { critere: rec.cell.critere_fini, livrable: rr.livrable } : undefined;
  }

  /**
   * Replays a command written in the registry (audit mode). The coordinator then reproduces
   * exactly the same entries: any difference is a divergence.
   */
  async replayCommande(c: CommandeDonnees): Promise<void> {
    if (!this.options.replay) throw new Error('Replay is reserved for a coordinator created in audit mode');
    this.replayNext = {
      at: c.at, alea: [...(c.alea ?? [])], alea_secret: [...(c.alea_secret ?? [])], signatures: [...(c.signatures ?? [])], verifs: c.verifs ?? [], secrets: c.secrets ?? {},
    };
    const e = c.entree as {
      ruche: Hive; racine: CellSpec; decision: Decision; requete: Requete; resultat: Result; livrable: Livrable; decomposition: Decomposition;
      engagement: EngagementVerdict; verdict: Verdict; invitation: Invitation; adhesion: Adhesion;
      recu: RecuDepot; lien: LienGithub; fusion: FusionDepot;
    };
    try {
      switch (c.type) {
        case 'proposeHive': this.proposeHive(e.ruche, e.racine); break;
        case 'decide': this.decide(e.decision); break;
        case 'claim': if (c.balise) this.claimAvecBalise(e.requete, c.balise); else this.claim(e.requete); break;
        case 'start': this.start(e.requete); break;
        case 'release': this.release(e.requete); break;
        case 'submitResult': await this.submitResult(e.resultat, e.livrable); break;
        case 'submitDecomposition': await this.submitDecomposition(e.decomposition); break;
        case 'engageVerdict': this.engagerVerdict(e.engagement); break;
        case 'submitVerdict': await this.submitVerdict(e.verdict); break;
        case 'inviter': this.inviter(e.invitation); break;
        case 'rejoindre': this.rejoindre(e.adhesion); break;
        case 'recuDepot': this.recuDepot(e.recu); break;
        case 'lienGithub': this.lienGithub(e.lien); break;
        case 'fusionDepot': this.fusionDepot(e.fusion); break;
        default: throw new ReplayDivergence(`Unknown command: ${String(c.type)}`);
      }
    } finally {
      this.replayNext = null;
    }
  }

  /**
   * Runs a command as a transaction: the state and the registry roll back if
   * it fails; if it succeeds, it is written to the registry with everything needed to replay it.
   */
  private run<T>(type: CommandeType, entree: Record<string, unknown>, verifs: VerifReport[], fn: () => T): T {
    const replay = this.replayNext;
    this.replayNext = null;
    if (this.options.replay && !replay) throw new Error('Coordinator in audit mode: it only replays the registry');
    const at = replay ? replay.at : this.baseNow();
    this.clock = at;
    this.replayCtx = replay ? { alea: [...replay.alea], alea_secret: [...replay.alea_secret], signatures: [...replay.signatures], secrets: replay.secrets } : null;
    this.recording = replay ? null : { alea: [], alea_secret: [], signatures: [], secrets: {} };
    const pieges = this.journalPieges.length;
    const snapshot = structuredClone(this.state);
    this.registry.begin();
    try {
      const out = fn();
      // Drawn with the beacon, the random numbers are recomputed, not taken over: only the signatures are checked.
      if (this.replayCtx && ((!this.tirageBalise && this.replayCtx.alea.length) || this.replayCtx.alea_secret.length || this.replayCtx.signatures.length)) {
        throw new ReplayDivergence('The replay consumed fewer draws or signatures than the original');
      }
      const alea = this.tirageBalise ? this.tirageBalise.tirages : replay ? replay.alea : this.recording!.alea;
      const alea_secret = replay ? replay.alea_secret : this.recording!.alea_secret;
      const signatures = replay ? replay.signatures : this.recording!.signatures;
      const secrets = replay ? replay.secrets : this.recording!.secrets;
      this.registry.append('commande', {
        type, entree, at, alea, signatures, verifs, ...(Object.keys(secrets).length ? { secrets } : {}),
        ...(this.tirageBalise ? { balise: this.tirageBalise.balise } : {}), ...(alea_secret.length ? { alea_secret } : {}), etat: this.stateHash(),
      } satisfies CommandeDonnees);
      this.registry.commit();
      this.save();
      if (!replay) this.peutEtreSceller();
      return out;
    } catch (e) {
      this.state = snapshot;
      this.ledger.accounts = this.state.accounts;
      this.registry.rollback();
      this.journalPieges.length = pieges;
      throw e;
    } finally {
      this.clock = null;
      this.replayCtx = null;
      this.recording = null;
      this.tirageBalise = null;
    }
  }

  /** The beacon announced at launch, live as on replay. */
  baliseAnnoncee(): BaliseAnnoncee | undefined {
    if (this.options.replay) return this.options.replay.balise;
    return this.options.balise ? { ...this.options.balise.info, decalage: this.params.balise_decalage } : undefined;
  }

  /**
   * Take work, with a draw nobody controls (P1-3): the request signed at
   * time `ts` is drawn with drand round tourA(ts) + offset, which did not exist yet
   * when the contributor signed. Without a configured beacon, it is an ordinary claim.
   */
  async reclamer(r: Requete): Promise<Assignment | null> {
    const src = this.options.balise;
    if (!src) return this.claim(r);
    if (r?.type !== 'osp.requete/0.1' || r.action !== 'claim') throw new OspError('Expected a claim request');
    if (!isContributorId(r.contributeur) || !verifyObject(r, r.contributeur)) throw new OspError('Invalid request signature', 401);
    if (typeof r.ts !== 'number' || Math.abs(this.baseNow() - r.ts) > this.params.fenetre_balise_ms) {
      throw new OspError("Your clock is too far from the coordinator's for a fair draw: synchronize it", 401);
    }
    let b: Balise;
    try {
      b = await src.get(tourA(src.info, r.ts) + this.params.balise_decalage);
    } catch (e) {
      throw new OspError(`Randomness beacon unavailable: ${(e as Error).message}`, 503);
    }
    return this.claimAvecBalise(r, b);
  }

  private claimAvecBalise(r: Requete, b: Balise): Assignment | null {
    const info = this.baliseAnnoncee();
    if (!info) throw new ReplayDivergence('Beacon used without being announced at launch');
    if (b.round !== tourA(info, r.ts) + info.decalage) throw new ReplayDivergence(`Beacon round ${b.round} breaks the rule (expected ${tourA(info, r.ts) + info.decalage})`);
    if (!verifierBalise(info, b)) throw new ReplayDivergence(`Invalid beacon for round ${b.round}`);
    const tirage = { rng: rngDepuis(graine(b, hashOf(r))), balise: b, tirages: [] as number[] };
    this.tirageBalise = tirage;
    try {
      return this.run('claim', { requete: r }, [], () => {
        this.tirageBalise = tirage;
        return this.doClaim(r);
      });
    } finally {
      this.tirageBalise = null;
    }
  }

  /** Reveals a secret from the vault and records it in the command; on replay, takes it back and checks the commitment. */
  private reveal(hash: Hash): unknown {
    if (this.replayCtx) {
      const v = this.replayCtx.secrets[hash];
      if (v === undefined || commitment(v) !== hash) throw new ReplayDivergence('Revealed secret missing or not matching its commitment');
      return v;
    }
    const v = this.coffre[hash];
    if (v === undefined) throw new OspError("Secret missing from this coordinator's vault", 500);
    this.recording!.secrets[hash] = v;
    return v;
  }

  /** A cell's hidden tests, taken out of the vault, for the verifier. */
  private cachesFor(rec: CellRecord): TestCase[] | undefined {
    const c = rec.cell.critere_fini;
    if (!estCritereTests(c) || !c.tests_caches_hash) return undefined;
    const v = this.coffre[c.tests_caches_hash] as TestCase[] | undefined;
    if (!v) throw new OspError("This cell's hidden tests are not in this coordinator's vault", 503);
    return v;
  }

  /** Checks that each secret matches the commitment published in the criterion. */
  private checkSecrets(spec: CellSpec, secret: Secrets | undefined, label: string): void {
    const c = spec.critere_fini;
    if (!estCritereTests(c)) {
      if (secret?.tests_caches || secret?.reference) throw new OspError(`${label}: this type of criterion has no secrets`);
      return;
    }
    if (c.tests_caches_hash) {
      if (!secret?.tests_caches) throw new OspError(`${label}: the announced hidden tests were not sent`);
      try { validateTests(secret.tests_caches, 'hidden tests'); } catch (e) { throw new OspError(`${label}: ${(e as Error).message}`); }
      if (commitment(secret.tests_caches) !== c.tests_caches_hash) throw new OspError(`${label}: the hidden tests do not match their commitment`);
    } else if (secret?.tests_caches) throw new OspError(`${label}: send the tests_caches_hash commitment with the hidden tests`);
    if (c.reference_hash) {
      if (!secret?.reference) throw new OspError(`${label}: the announced reference was not sent`);
      try { validateLivrable(secret.reference); } catch (e) { throw new OspError(`${label}: invalid reference: ${(e as Error).message}`); }
      if (commitment(secret.reference) !== c.reference_hash) throw new OspError(`${label}: the reference does not match its commitment`);
    } else if (secret?.reference) throw new OspError(`${label}: send the reference_hash commitment with the reference`);
  }

  private storeSecrets(secrets: Array<Secrets | undefined>): void {
    let changed = false;
    for (const sec of secrets) {
      if (sec?.tests_caches) { this.coffre[commitment(sec.tests_caches)] = sec.tests_caches; changed = true; }
      if (sec?.reference) { this.coffre[commitment(sec.reference)] = sec.reference; changed = true; }
    }
    if (changed && this.options.dataDir) {
      const file = join(this.options.dataDir, 'coffre.json');
      writeFileSync(file + '.tmp', JSON.stringify(this.coffre), { encoding: 'utf8', mode: 0o600 });
      renameSync(file + '.tmp', file);
    }
  }

  /** Signs on behalf of the coordinator; on replay, takes the recorded signature and checks it. */
  private sign<T extends object>(obj: T, who: Identity): T & { sig: string } {
    if (this.replayCtx) {
      const sig = this.replayCtx.signatures.shift();
      if (sig === undefined) throw new ReplayDivergence('Expected signature missing from the registry');
      const signed = { ...obj, sig } as T & { sig: string };
      if (!verifyObject(signed, who.id)) throw new ReplayDivergence('Invalid coordinator signature on replay');
      return signed;
    }
    const signed = signObject(obj, who);
    this.recording?.signatures.push(signed.sig);
    return signed;
  }

  get fondateur(): ContributorId {
    return this.state.fondateur;
  }

  // ---------------------------------------------------------------- hives

  proposeHive(ruche: Hive, racine: CellSpec, secrets?: Secrets): HiveView {
    if (!this.replayNext) this.checkSecrets(racine, secrets, 'Heart of the hive');
    const out = this.run('proposeHive', { ruche, racine }, [], () => this.doProposeHive(ruche, racine));
    if (!this.options.replay) this.storeSecrets([secrets]);
    return out;
  }

  private doProposeHive(ruche: Hive, racine: CellSpec): HiveView {
    if (ruche?.type !== 'osp.hive/0.1') throw new OspError('Expected a hive object (osp.hive/0.1)');
    if (!isContributorId(ruche.porteur)) throw new OspError('Invalid hive owner');
    if (!verifyObject(ruche, ruche.porteur)) throw new OspError('Invalid hive signature', 401);
    if (!SLUG_RE.test(ruche.slug)) throw new OspError('Invalid slug: 3 to 40 characters, lowercase letters, digits and hyphens');
    if (this.state.hives[ruche.slug]) throw new OspError(`The hive "${ruche.slug}" already exists`, 409);
    if (!ruche.nom || !ruche.objectif) throw new OspError('A hive needs a name and a goal');
    if (ruche.classe_verif_defaut !== 'V0') throw new OspError('The MVP only supports verification class V0');
    if (ruche.playbook !== undefined && !playbook(ruche.playbook)) throw new OspError(`Unknown playbook: ${String(ruche.playbook)} (known: ${Object.keys(PLAYBOOKS).join(', ')})`);
    // OSP v0.3 §2.7: a private hive is a coordinator instance of its own, hosting that one hive.
    if (this.params.prive) {
      if (ruche.visibilite !== 'privee') throw new OspError('This instance only hosts its private hive', 409);
      if (Object.keys(this.state.hives).length) throw new OspError('A private instance hosts a single hive', 409);
    } else if (ruche.visibilite === 'privee') {
      throw new OspError('A private hive is created through POST /v0/private, in its own registry', 400);
    }
    this.validateSpec(racine);

    const hive: HiveRecord = {
      ruche,
      id: hashOf(ruche),
      statut: 'proposee',
      racine: '' as Hash,
      branches: {},
      orientations: [],
      contributions: {},
    };
    this.state.hives[ruche.slug] = hive;
    if (this.params.prive) {
      this.state.membres = { [ruche.porteur]: { role: 'proprietaire', gardienne: true, depuis: this.now() } };
      this.state.invitations = {};
    }
    this.registry.append('ruche_proposee', { slug: ruche.slug, id: hive.id, porteur: ruche.porteur, nom: ruche.nom });
    hive.racine = this.emitCell(ruche.slug, racine, null, '0', 0).id;
    return this.hiveView(ruche.slug);
  }

  // ---------------------------------------------------------------- private hives (OSP v0.3 §2)

  /** The one hive of a private instance. */
  private rucheUnique(): HiveRecord {
    const h = Object.values(this.state.hives)[0];
    if (!h) throw new OspError('This private hive is not set up yet', 409);
    return h;
  }

  /** In a private hive, only members take part, and observers only read. A public hive is open to all. */
  private exigerMembre(id: ContributorId, pourTravailler = true): void {
    if (!this.params.prive) return;
    const m = this.state.membres?.[id];
    if (!m) throw new OspError('This hive is private: only its members take part', 403);
    if (pourTravailler && m.role === 'observateur') throw new OspError('Observers can read this hive, not work in it', 403);
  }

  /** The members of a private hive, for the owner's tools and the dashboard. */
  membres(): Array<{ id: string; role: RolePrive; gardienne: boolean; depuis: string }> {
    return Object.entries(this.state.membres ?? {}).map(([id, m]) => ({ id, role: m.role, gardienne: m.gardienne, depuis: new Date(m.depuis).toISOString() }));
  }

  /** A signed object's freshness and single use, as for requests. */
  private fraicheur(auteur: ContributorId, ts: number, nonce: string): void {
    if (typeof ts !== 'number' || Math.abs(this.now() - ts) > this.params.fenetre_requete_ms) throw new OspError('Expired object: check your clock', 401);
    const cle = `${auteur}:${nonce}`;
    if (!nonce || this.state.nonces[cle] !== undefined) throw new OspError('Replayed object', 409);
    this.state.nonces[cle] = ts;
  }

  /** OSP v0.3 §2.2: the owner invites. Only the salted hash of the code is kept. */
  inviter(inv: Invitation): { invitation: Hash } {
    return this.run('inviter', { invitation: inv }, [], () => this.doInviter(inv));
  }

  private doInviter(inv: Invitation): { invitation: Hash } {
    if (!this.params.prive) throw new OspError('Invitations only exist in private hives', 400);
    if (inv?.type !== 'osp.invitation/0.3') throw new OspError('Expected an invitation object (osp.invitation/0.3)');
    if (!isContributorId(inv.auteur) || !verifyObject(inv, inv.auteur)) throw new OspError('Invalid invitation signature', 401);
    const hive = this.rucheUnique();
    if (inv.auteur !== hive.ruche.porteur) throw new OspError('Only the hive owner invites', 403);
    if (inv.ruche !== idRuchePrivee(hive.ruche)) throw new OspError('This invitation is for another hive', 400);
    if (inv.role !== 'membre' && inv.role !== 'observateur') throw new OspError('An invitation is for a member or an observer');
    if (!/^sha256:[0-9a-f]{64}$/.test(inv.code_hash) || typeof inv.sel !== 'string' || inv.sel.length < 16) throw new OspError('Invalid code hash or salt');
    if (!Number.isInteger(inv.utilisations_max) || inv.utilisations_max < 1 || inv.utilisations_max > 100) throw new OspError('An invitation is used 1 to 100 times');
    if (!(inv.expire > this.now() && inv.expire <= this.now() + 90 * 24 * 3600_000)) throw new OspError('An invitation lasts at most 90 days');
    this.fraicheur(inv.auteur, inv.ts, inv.nonce);
    const id = hashOf(inv);
    const invitations = (this.state.invitations ??= {});
    invitations[id] = { code_hash: inv.code_hash, sel: inv.sel, role: inv.role, utilisations_max: inv.utilisations_max, utilisations: 0, expire: inv.expire, revoquee: false };
    this.registry.append('invitation', { id, role: inv.role, utilisations_max: inv.utilisations_max, expire: new Date(inv.expire).toISOString() });
    return { invitation: id };
  }

  /** The invitation a code opens, if it is still valid. Reads only: the host asks every private instance. */
  trouverInvitation(code: string): Hash | null {
    const c = normaliserCode(String(code ?? ''));
    const now = this.now();
    for (const [id, inv] of Object.entries(this.state.invitations ?? {})) {
      if (inv.revoquee || inv.utilisations >= inv.utilisations_max || inv.expire <= now) continue;
      if (sha256(`${inv.sel}:${c}`) === inv.code_hash) return id as Hash;
    }
    return null;
  }

  /** OSP v0.3 §2.2: a person joins with a code. The membership is written in the hive's own registry. */
  rejoindre(a: Adhesion): { ruche: string; role: RolePrive } {
    return this.run('rejoindre', { adhesion: a }, [], () => this.doRejoindre(a));
  }

  private doRejoindre(a: Adhesion): { ruche: string; role: RolePrive } {
    if (!this.params.prive) throw new OspError('Only private hives are joined with a code', 400);
    if (a?.type !== 'osp.adhesion/0.3') throw new OspError('Expected a membership request (osp.adhesion/0.3)');
    if (!isContributorId(a.contributeur) || !verifyObject(a, a.contributeur)) throw new OspError('Invalid membership signature', 401);
    this.fraicheur(a.contributeur, a.ts, a.nonce);
    const id = this.trouverInvitation(a.code);
    if (!id) throw new OspError('Unknown, used or expired invitation code', 404);
    const membres = this.state.membres!;
    if (membres[a.contributeur]) throw new OspError('You are already a member of this hive', 409);
    const inv = this.state.invitations![id]!;
    inv.utilisations++;
    membres[a.contributeur] = { role: inv.role, gardienne: inv.role === 'membre', depuis: this.now() };
    this.registry.append('membre_ajoute', { contributeur: a.contributeur, role: inv.role, invitation: id });
    return { ruche: this.rucheUnique().ruche.slug, role: inv.role };
  }

  // ---------------------------------------------------------------- repository (OSP v0.3 §3.3)

  /** Who may write the repository's facts: a working member in a private hive, the owner in a public one. */
  private exigerPont(auteur: ContributorId, rec: CellRecord): void {
    if (this.params.prive) return this.exigerMembre(auteur);
    if (auteur !== this.state.hives[rec.cell.ruche]?.ruche.porteur) throw new OspError("Only the hive owner runs this hive's bridge", 403);
  }

  /**
   * The bridge says which commit holds a cell's honey. The coordinator holds no repository access
   * (principle 2), so it checks what it can: the cell, the validated result, and the git hash of every
   * file against the validated deliverable. Anyone with the repository can then check the commit.
   */
  recuDepot(r: RecuDepot): { recu: Hash } {
    return this.run('recuDepot', { recu: r }, [], () => this.doRecuDepot(r));
  }

  private doRecuDepot(r: RecuDepot): { recu: Hash } {
    if (r?.type !== 'osp.recu_depot/0.3') throw new OspError('Expected a repo receipt (osp.recu_depot/0.3)');
    if (!isContributorId(r.auteur) || !verifyObject(r, r.auteur)) throw new OspError('Invalid receipt signature', 401);
    const rec = this.cellOrThrow(r.alveole);
    this.exigerPont(r.auteur, rec);
    const depot = rec.cell.depot;
    if (!depot) throw new OspError('This cell does not work on a repository', 400);
    if (rec.state !== 'miel' || rec.resultat_valide !== r.resultat) throw new OspError('A receipt is for the validated result of a cell turned into honey', 409);
    if (r.depot !== depot.url) throw new OspError("This receipt is for another repository than the cell's", 400);
    if (!SHA_GIT.test(String(r.commit)) || !SHA_GIT.test(String(r.parent))) throw new OspError('commit and parent are full git hashes');
    if (typeof r.branche !== 'string' || !/^kickswarm\/[A-Za-z0-9._/-]{1,200}$/.test(r.branche) || r.branche.includes('..')) throw new OspError('The branch is named kickswarm/…');
    if (r.pr !== null && (typeof r.pr !== 'string' || !/^https:\/\/\S{1,300}$/.test(r.pr))) throw new OspError('The pull request is an https address, or null');
    const livrable = this.state.results[r.resultat]!.livrable;
    if (canonicalize(r.fichiers ?? null) !== canonicalize(blobsDuLivrable(livrable))) throw new OspError('The receipt does not hold exactly the validated deliverable (git hashes differ)', 409);
    if (canonicalize(r.supprimes ?? null) !== canonicalize([...(livrable.supprimes ?? [])].sort())) throw new OspError('The receipt does not delete exactly what the deliverable deletes', 409);
    this.fraicheur(r.auteur, r.ts, r.nonce);
    const id = hashOf(r);
    // Two bridges may write the same honey: the receipts make it visible, and harmless.
    (this.state.recus ??= {})[id] = {
      alveole: rec.id,
      resultat: r.resultat,
      branche: r.branche,
      commit: r.commit,
      parent: r.parent,
      pr: r.pr,
      auteur: r.auteur,
      date: new Date(this.now()).toISOString(),
    };
    this.registry.append('recu_depot', { id, alveole: rec.id, chemin: rec.cell.chemin, branche: r.branche, commit: r.commit, pr: r.pr });
    return { recu: id };
  }

  /** A member links their GitHub name to their identity, once: the bridge credits them as co-author. */
  lienGithub(l: LienGithub): { github: string } {
    return this.run('lienGithub', { lien: l }, [], () => this.doLienGithub(l));
  }

  private doLienGithub(l: LienGithub): { github: string } {
    if (l?.type !== 'osp.lien_github/0.3') throw new OspError('Expected a GitHub link (osp.lien_github/0.3)');
    if (!isContributorId(l.contributeur) || !verifyObject(l, l.contributeur)) throw new OspError('Invalid link signature', 401);
    this.exigerMembre(l.contributeur, false);
    if (typeof l.github !== 'string' || !GITHUB_RE.test(l.github)) throw new OspError('Invalid GitHub name');
    const pris = Object.entries(this.state.liens_github ?? {}).some(([id, g]) => g.toLowerCase() === l.github.toLowerCase() && id !== l.contributeur);
    if (pris) throw new OspError('This GitHub name is already linked to another identity', 409);
    this.fraicheur(l.contributeur, l.ts, l.nonce);
    (this.state.liens_github ??= {})[l.contributeur] = l.github;
    this.registry.append('lien_github', { contributeur: l.contributeur, github: l.github });
    return { github: l.github };
  }

  /** The bridge saw a human merge the pull request of a receipt. The audit lists it as external evidence. */
  fusionDepot(f: FusionDepot): { fusion: Hash } {
    return this.run('fusionDepot', { fusion: f }, [], () => this.doFusionDepot(f));
  }

  private doFusionDepot(f: FusionDepot): { fusion: Hash } {
    if (f?.type !== 'osp.fusion_depot/0.3') throw new OspError('Expected a merge statement (osp.fusion_depot/0.3)');
    if (!isContributorId(f.auteur) || !verifyObject(f, f.auteur)) throw new OspError('Invalid statement signature', 401);
    const recu = this.state.recus?.[f.recu];
    if (!recu) throw new OspError('Unknown receipt', 404);
    this.exigerPont(f.auteur, this.cellOrThrow(recu.alveole));
    if (!recu.pr || f.pr !== recu.pr) throw new OspError("This is not the receipt's pull request", 400);
    if (typeof f.fusionnee_par !== 'string' || !GITHUB_RE.test(f.fusionnee_par)) throw new OspError('Invalid GitHub name');
    if (!SHA_GIT.test(String(f.commit_fusion))) throw new OspError('The merge commit is a full git hash');
    if (this.state.fusions?.[f.recu]) throw new OspError('This merge is already recorded', 409);
    this.fraicheur(f.auteur, f.ts, f.nonce);
    (this.state.fusions ??= {})[f.recu] = { pr: f.pr, fusionnee_par: f.fusionnee_par, commit_fusion: f.commit_fusion, auteur: f.auteur, date: new Date(this.now()).toISOString() };
    this.registry.append('fusion_depot', { recu: f.recu, pr: f.pr, fusionnee_par: f.fusionnee_par, commit_fusion: f.commit_fusion });
    return { fusion: hashOf(f) };
  }

  /** What the bridge and the dashboard need about a cell: its capsule, its validated honey, its receipts. */
  detailCellule(id: Hash): DetailCellule {
    const rec = this.cellOrThrow(id);
    const rr = rec.resultat_valide ? this.state.results[rec.resultat_valide] : undefined;
    return {
      cell: rec.cell,
      etat: rec.state,
      capsule: rec.capsule_texte,
      ...(rr
        ? {
            resultat: { id: rec.resultat_valide!, auteur: rr.resultat.auteur, agent: rr.resultat.agent, livrable: rr.livrable, validee_par: rec.validee_par ?? [] },
            ...(this.state.liens_github?.[rr.resultat.auteur] ? { github: this.state.liens_github[rr.resultat.auteur] } : {}),
          }
        : {}),
      recus: Object.entries(this.state.recus ?? {})
        .filter(([, r]) => r.alveole === rec.id)
        .map(([rid, r]) => ({ id: rid, ...r, ...(this.state.fusions?.[rid] ? { fusion: this.state.fusions[rid] } : {}) })),
    };
  }

  /** Cells turned into honey on a repository, with their number of receipts: the bridge's work list. */
  mielsDepot(): Array<{ id: Hash; chemin: string; ruche: string; recus: number }> {
    const n: Record<string, number> = {};
    for (const r of Object.values(this.state.recus ?? {})) n[r.alveole] = (n[r.alveole] ?? 0) + 1;
    return Object.values(this.state.cells)
      .filter((c) => c.state === 'miel' && c.cell.depot)
      .map((c) => ({ id: c.id, chemin: c.cell.chemin, ruche: c.cell.ruche, recus: n[c.id] ?? 0 }));
  }

  /** The repository facts of the registry, for the audit: every receipt and merge. */
  faitsDepot(): { recus: Record<string, RecuRecord>; fusions: Record<string, FusionRecord> } {
    return { recus: this.state.recus ?? {}, fusions: this.state.fusions ?? {} };
  }

  /**
   * OSP v0.3 §2.8: a read ticket on a private hive. The member signs a fresh request; nothing is
   * written (reads must not fill the registry). Any role may read, observers included.
   */
  verifierLecteur(r: Requete): ContributorId {
    if (r?.type !== 'osp.requete/0.1' || r.action !== 'lire') throw new OspError('Expected a read request');
    if (!isContributorId(r.contributeur) || !verifyObject(r, r.contributeur)) throw new OspError('Invalid request signature', 401);
    if (typeof r.ts !== 'number' || Math.abs(this.now() - r.ts) > this.params.fenetre_requete_ms) throw new OspError('Expired request: check your clock', 401);
    this.exigerMembre(r.contributeur, false);
    return r.contributeur;
  }

  /** A member leaves or is removed: their open leases go back to the swarm at once. Their past work stays. */
  private retirerMembre(id: ContributorId): void {
    delete this.state.membres![id];
    for (const rec of Object.values(this.state.cells)) {
      if (rec.bail?.par === id) {
        delete rec.bail;
        if (rec.state === 'reservee' || rec.state === 'en_cours') rec.state = 'libre';
      }
      rec.gardiennes = rec.gardiennes.filter((g) => g.par !== id);
    }
    for (const [pid, p] of Object.entries(this.state.pieges)) if (p.attribue_a === id && !p.engagement) delete this.state.pieges[pid];
    this.registry.append('membre_retire', { contributeur: id });
  }

  /** OSP v0.3 §2.4, public instance: the head of a private registry. It commits the coordinator to one history. */
  ancrer(ruche: Hash, seq: number, tete: Hash): void {
    if (this.options.replay) throw new Error('An audit coordinator does not anchor: it imports anchors');
    if (this.params.prive) throw new Error('Anchors go into the public registry');
    this.registry.append('ancre', { ruche, seq, tete });
    this.peutEtreSceller();
  }

  /** Audit mode: takes an anchor from the original registry, as it does for seals. */
  importAncre(date: string, a: { ruche: Hash; seq: number; tete: Hash }): void {
    if (!this.options.replay) throw new Error('Anchor import is for audit mode only');
    this.clock = Date.parse(date);
    try {
      this.registry.append('ancre', { ruche: a.ruche, seq: a.seq, tete: a.tete });
    } finally {
      this.clock = null;
    }
  }

  listHives(): Array<{ slug: string; nom: string; statut: HiveStatus; progression: { miel: number; total: number } }> {
    return Object.values(this.state.hives).map((h) => ({
      slug: h.ruche.slug,
      nom: h.ruche.nom,
      statut: h.statut,
      progression: this.progression(h.ruche.slug),
    }));
  }

  hiveView(slug: string): HiveView {
    const hive = this.hiveOrThrow(slug);
    const now = this.now();
    return {
      ruche: hive.ruche,
      statut: hive.statut,
      progression: this.progression(slug),
      orientations: hive.orientations
        .filter((o) => o.expire > now)
        .map((o) => ({ branche: o.branche, multiplicateur: o.multiplicateur, expire: new Date(o.expire).toISOString() })),
      alveoles: this.cellsOf(slug)
        .sort((a, b) => cheminCompare(a.cell.chemin, b.cell.chemin))
        .map((c) => ({
          id: c.id,
          chemin: c.cell.chemin,
          objectif: c.cell.objectif,
          etat: c.state,
          profondeur: c.profondeur,
          atomique: c.cell.atomique,
          rejets: c.rejets,
          enfants: c.enfants.length,
        })),
    };
  }


  /**
   * A project's dashboard (OSP v0.3 §3.5, v0.4): progress and milestones, branches, who does what now,
   * how many bees and AIs work on it, what waits for a decision, the AIs and contributors, a feed, and
   * the measured time per cell for the simulator. Same discretion as the live view: a guard holding a
   * trap counts like any guard, and the registry is read up to the embargo horizon only.
   */
  tableauProjet(slug: string): TableauProjet {
    const hive = this.hiveOrThrow(slug);
    const now = this.now();
    const cells = this.cellsOf(slug);
    const ids = new Set<string>(cells.map((c) => c.id));
    const visibles = this.registry.entries.slice(0, this.horizon() + 1);
    const progression = this.progression(slug);

    // Who works now: a lease, or a guard seat (a trap's seat looks like any other).
    const travaux: TableauProjet['travaux'] = [];
    const verifications: TableauProjet['verifications'] = [];
    const parCaste: Record<Caste, number> = { eclaireuse: 0, ouvriere: 0, batisseuse: 0, gardienne: 0 };
    const abeilles = new Set<string>();
    const debut = new Map<string, number>();
    for (const e of visibles) {
      if (e.nature !== 'commande') continue;
      const c = e.donnees as CommandeDonnees;
      const alveole = (c.entree as { requete?: Requete }).requete?.alveole;
      if (c.type === 'start' && alveole && ids.has(alveole)) debut.set(alveole, Date.parse(e.date));
    }
    for (const c of cells) {
      if (c.bail && c.bail.expire > now && (c.state === 'reservee' || c.state === 'en_cours')) {
        abeilles.add(c.bail.par);
        parCaste[c.bail.caste]++;
        const d = debut.get(c.id);
        travaux.push({ chemin: c.cell.chemin, objectif: c.cell.objectif, caste: c.bail.caste, abeille: c.bail.par, ...(d ? { depuis: new Date(d).toISOString() } : {}) });
      }
      if (c.state === 'en_verification') {
        const gardes = [
          ...c.gardiennes.filter((g) => g.expire > now).map((g) => g.par),
          ...this.engagesSur(c.en_attente).map((g) => g.par),
          ...this.piegesSur(c).filter((p) => p.expire > now).map((p) => p.attribue_a),
        ];
        for (const g of gardes) abeilles.add(g);
        parCaste.gardienne += gardes.length;
        verifications.push({ chemin: c.cell.chemin, objectif: c.cell.objectif, gardes: gardes.length, valides: c.verdicts.length });
      }
    }

    // What waits for a human.
    const attente: TableauProjet['attente'] = [];
    if (hive.statut === 'proposee') attente.push({ type: 'approbation_ruche', qui: 'founder', texte: 'The project waits for the founder’s approval to start.' });
    if (hive.statut === 'en_pause') attente.push({ type: 'pause', qui: 'owner', texte: 'The owner paused the project.' });
    for (const [id, d] of Object.entries(this.state.decompositions)) {
      const rec = this.state.cells[d.decomposition.alveole];
      if (d.statut === 'en_attente' && rec && ids.has(rec.id)) attente.push({ type: 'approbation_decoupage', qui: 'owner', chemin: rec.cell.chemin, cible: id, texte: `A split of “${rec.cell.objectif.slice(0, 80)}” into ${d.decomposition.enfants.length} cells waits for the owner’s approval.` });
    }
    for (const c of cells) {
      const rr = c.en_attente ? this.state.results[c.en_attente] : undefined;
      if (rr?.escalade && c.state === 'en_verification') attente.push({ type: 'arbitrage', qui: 'owner', chemin: c.cell.chemin, cible: c.en_attente!, texte: `The guards of “${c.cell.objectif.slice(0, 80)}” did not reach a conclusion: the owner decides.` });
    }

    // Branches: the children of the heart, each with its own progress.
    const racine = this.state.cells[hive.racine];
    const branches = (racine?.enfants ?? []).map((id) => {
      const b = this.state.cells[id]!;
      const sous = cells.filter((c) => c.cell.chemin === b.cell.chemin || c.cell.chemin.startsWith(`${b.cell.chemin}.`));
      return { chemin: b.cell.chemin, objectif: b.cell.objectif, miel: sous.filter((c) => c.state === 'miel').length, total: sous.length, termine: b.state === 'miel' };
    });

    // Milestones and pace, from the honey written in the registry.
    const miels = visibles.filter((e) => e.nature === 'alveole_miel' && ids.has(String((e.donnees as { alveole: string }).alveole)));
    const jalons = [25, 50, 75, 100].map((seuil) => {
      const n = Math.ceil((seuil / 100) * Math.max(1, progression.total));
      const e = miels[n - 1];
      return { seuil, atteint: progression.total > 0 && progression.miel * 100 >= seuil * progression.total, ...(e ? { date: e.date } : {}) };
    });
    const durees = miels
      .map((e) => {
        const a = String((e.donnees as { alveole: string }).alveole);
        const d = debut.get(a);
        return d ? Date.parse(e.date) - d : null;
      })
      .filter((x): x is number => x !== null && x >= 0)
      .sort((a, z) => a - z);
    const mediane = durees.length ? durees[Math.floor(durees.length / 2)]! : null;

    const fil = visibles
      .filter((e) => {
        const d = (e.donnees ?? {}) as Record<string, unknown>;
        if (['alveole_miel', 'decoupage_adopte', 'piege_dejoue', 'escalade'].includes(e.nature)) return ids.has(String(d.alveole));
        if (e.nature === 'trophee') return d.ruche === slug;
        return e.nature === 'ruche_terminee' && d.slug === slug;
      })
      .slice(-25)
      .reverse()
      .map((e) => {
        const d = e.donnees as Record<string, unknown>;
        return { date: e.date, nature: e.nature, ...(d.chemin !== undefined ? { chemin: String(d.chemin) } : {}), ...(d.auteur ? { qui: String(d.auteur) } : {}), ...(d.beneficiaire ? { qui: String(d.beneficiaire) } : {}), ...(d.trophee ? { trophee: String(d.trophee) } : {}), ...(typeof d.grammes === 'number' ? { grammes: d.grammes } : {}) };
      });

    const contributeurs = Object.entries(hive.contributions)
      .map(([id, g]) => ({ id, grammes: Math.round(g * 1000) / 1000, trophees: [...new Set(this.trophiesOf(id).map((t) => t.id))] }))
      .sort((a, z) => z.grammes - a.grammes)
      .slice(0, 10);
    const modeles = this.classementModeles(slug).modeles;

    return {
      ruche: { slug, nom: hive.ruche.nom, objectif: hive.ruche.objectif, statut: hive.statut, porteur: hive.ruche.porteur, ...(hive.ruche.playbook ? { playbook: hive.ruche.playbook } : {}) },
      progression,
      jalons,
      maintenant: { abeilles: abeilles.size, parCaste, ia: modeles.length },
      travaux: travaux.sort((a, z) => cheminCompare(a.chemin, z.chemin)),
      verifications,
      attente,
      branches,
      modeles,
      contributeurs,
      contributeurs_total: Object.keys(hive.contributions).length,
      miel_total: Math.round(Object.values(hive.contributions).reduce((s, x) => s + x, 0) * 1000) / 1000,
      rythme: { tempsCelluleMs: mediane, mesures: durees.length, restantes: progression.total - progression.miel },
      fil,
    };
  }

  /** Complete snapshot of a hive for the live view: cells, bees at work, leaderboard, log. */
  liveView(slug: string): LiveView {
    const hive = this.hiveOrThrow(slug);
    const now = this.now();
    const cells = this.cellsOf(slug).sort((a, b) => cheminCompare(a.cell.chemin, b.cell.chemin));
    const ids = new Set<string>(cells.map((c) => c.id));
    const actif = (b?: Bail) => (b && b.expire > now ? { par: b.par, caste: b.caste } : undefined);

    const classement = Object.entries(hive.contributions)
      .map(([id, g]) => ({
        id,
        grammes: Math.round(g * 1000) / 1000,
        trophees: [...new Set(this.trophiesOf(id).map((t) => t.id))],
        ...this.ledger.peek(id as ContributorId),
      }))
      .sort((a, b) => b.grammes - a.grammes)
      .slice(0, 20);

    // The public log stops at the embargo horizon (P0-3).
    const journal = this.registry.entries
      .slice(0, this.horizon() + 1)
      .filter((e) => {
        const d = (e.donnees ?? {}) as Record<string, unknown>;
        return d.ruche === slug || d.slug === slug || ids.has(String(d.alveole)) || (e.nature === 'decision' && String(d.cible ?? '').startsWith(slug));
      })
      .slice(-60);

    return {
      ruche: { slug, nom: hive.ruche.nom, objectif: hive.ruche.objectif, porteur: hive.ruche.porteur, statut: hive.statut },
      fondateur: this.state.fondateur,
      progression: this.progression(slug),
      miel_total: Math.round(Object.values(hive.contributions).reduce((s, x) => s + x, 0) * 1000) / 1000,
      commun: this.ledger.peek(COMMUN).parts,
      orientations: hive.orientations.filter((o) => o.expire > now).map((o) => ({ branche: o.branche, multiplicateur: o.multiplicateur })),
      alveoles: cells.map((c) => ({
        id: c.id,
        chemin: c.cell.chemin,
        parent: c.cell.parent,
        objectif: c.cell.objectif,
        etat: c.state,
        profondeur: c.profondeur,
        rejets: c.rejets,
        abeille: actif(c.bail),
        // A guard who received a trap appears like the others: the public view gives nothing away.
        gardiennes: [
          ...c.gardiennes.filter((g) => g.expire > now).map((g) => g.par),
          ...this.engagesSur(c.en_attente).map((e) => e.par),
          ...this.piegesSur(c).filter((p) => p.expire > now).map((p) => p.attribue_a),
        ],
        auteur: c.resultat_valide ? this.state.results[c.resultat_valide]?.resultat.auteur : undefined,
        validee_par: c.validee_par,
      })),
      classement,
      journal,
    };
  }

  /** The public board, without the source result's identifier: a guard would compare it with their ticket (P0-3). */
  board(slug: string): Array<Omit<BoardEntry, 'source'>> {
    this.hiveOrThrow(slug);
    return (this.state.board[slug] ?? []).map(({ source: _source, ...e }) => e);
  }

  account(id: ContributorId | typeof COMMUN): Account & { id: string; trophees: Trophee[] } {
    return { id, ...this.ledger.peek(id), trophees: this.trophiesOf(id) };
  }

  trophiesOf(id: string): Trophee[] {
    return this.state.trophees[id] ?? [];
  }

  /**
   * OSP v0.4 §2.6: how each AI model really does, from the registry alone. Every result declares its
   * model (agent.modele, or its family), and every result is verified: handed in, validated, refused.
   * Ranked by validated over judged, with a prior, so a model judged twice does not top the list.
   */
  classementModeles(ruche?: string): { modeles: Array<{ modele: string; famille: string; soumis: number; valides: number; rejetes: number; en_cours: number; score: number }> } {
    const parModele = new Map<string, { modele: string; famille: string; soumis: number; valides: number; rejetes: number; en_cours: number }>();
    for (const rr of Object.values(this.state.results)) {
      if (ruche !== undefined && this.state.cells[rr.resultat.alveole]?.cell.ruche !== ruche) continue;
      const a = rr.resultat.agent ?? { famille: 'inconnue' };
      const cle = (a.modele ?? a.famille ?? 'inconnue').slice(0, 120);
      const m = parModele.get(cle) ?? { modele: cle, famille: String(a.famille ?? 'inconnue').slice(0, 40), soumis: 0, valides: 0, rejetes: 0, en_cours: 0 };
      m.soumis++;
      if (rr.statut === 'valide') m.valides++;
      else if (rr.statut === 'rejete') m.rejetes++;
      else m.en_cours++;
      parModele.set(cle, m);
    }
    const modeles = [...parModele.values()].map((m) => ({ ...m, score: Math.round(((m.valides + 1) / (m.valides + m.rejetes + 2)) * 1000) / 1000 }));
    modeles.sort((a, z) => z.score - a.score || z.valides - a.valides || a.modele.localeCompare(z.modele));
    return { modeles };
  }

  livrableValide(cellId: Hash): Livrable | undefined {
    const rec = this.state.cells[cellId];
    return rec?.resultat_valide ? this.state.results[rec.resultat_valide]?.livrable : undefined;
  }

  // ---------------------------------------------------------------- governance

  decide(d: Decision): { decision: Hash } {
    return this.run('decide', { decision: d }, [], () => this.doDecide(d));
  }

  private doDecide(d: Decision): { decision: Hash } {
    if (d?.type !== 'osp.decision/0.1') throw new OspError('Expected a decision object (osp.decision/0.1)');
    if (!isContributorId(d.auteur) || !verifyObject(d, d.auteur)) throw new OspError('Invalid decision signature', 401);
    if (!d.motif?.trim()) throw new OspError('Every decision must state its reason (principle 5)');
    const id = hashOf(d);
    const estFondateur = d.auteur === this.state.fondateur;

    switch (d.nature) {
      case 'approbation_ruche':
      case 'refus_ruche': {
        if (!estFondateur) throw new OspError('During the pilot phase (§14.2), only the founder admits hives', 403);
        const hive = this.hiveOrThrow(d.cible);
        if (hive.statut !== 'proposee') throw new OspError(`The hive is already ${hive.statut}`, 409);
        hive.statut = d.nature === 'approbation_ruche' ? 'active' : 'refusee';
        if (hive.statut === 'active') this.grant(hive.ruche.porteur, 'hive_owner', hive.ruche.slug);
        break;
      }
      case 'pause':
      case 'reprise': {
        const hive = this.hiveOrThrow(d.cible);
        this.requirePorteurOuFondateur(hive, d.auteur);
        const [de, vers]: [HiveStatus, HiveStatus] = d.nature === 'pause' ? ['active', 'en_pause'] : ['en_pause', 'active'];
        if (hive.statut !== de) throw new OspError(`Impossible: the hive is ${hive.statut}`, 409);
        hive.statut = vers;
        break;
      }
      case 'orientation': {
        const [slug = '', branche = ''] = d.cible.split(':');
        const hive = this.hiveOrThrow(slug);
        this.requirePorteurOuFondateur(hive, d.auteur);
        const m = d.params?.multiplicateur ?? this.params.orientation_max;
        if (!(m >= 1 && m <= this.params.orientation_max)) {
          throw new OspError(`The orientation multiplier must be between 1 and ${this.params.orientation_max}`);
        }
        const existe = this.cellsOf(slug).some((c) => brancheOf(c.cell.chemin) === branche);
        if (!existe) throw new OspError(`Unknown branch: ${branche}`, 404);
        hive.orientations.push({ branche, multiplicateur: m, expire: this.now() + this.params.orientation_duree_ms, auteur: d.auteur, decision: id });
        break;
      }
      case 'approbation_decoupage':
      case 'refus_decoupage': {
        const dr = this.state.decompositions[d.cible];
        if (!dr) throw new OspError('Unknown split', 404);
        const rec = this.cellOrThrow(dr.decomposition.alveole);
        const hive = this.hiveOrThrow(rec.cell.ruche);
        if (d.auteur !== hive.ruche.porteur) throw new OspError('Only the hive owner approves splits at the first levels (§6.3)', 403);
        if (dr.statut !== 'en_attente' || rec.en_attente !== d.cible) throw new OspError('This split is not awaiting a decision', 409);
        if (d.nature === 'approbation_decoupage') this.applyDecomposition(rec, d.cible);
        else {
          dr.statut = 'refusee';
          delete rec.en_attente;
          transition(rec, 'rejetee');
          rec.rejets++;
          this.ledger.reputation(dr.decomposition.auteur, 'resultat_rejete');
          this.addBoard(rec.cell.ruche, { nature: 'impasse', chemin: rec.cell.chemin, texte: `Découpage refusé par le porteur : ${d.motif}`, source: d.cible });
          transition(rec, 'libre');
        }
        break;
      }
      case 'arbitrage_valide':
      case 'arbitrage_rejet': {
        // OSP v0.2 §4.4: when the guards reach no conclusion, the hive owner decides, publicly and with a stated reason.
        const rr = this.state.results[d.cible];
        if (!rr) throw new OspError('Unknown result', 404);
        const rec = this.cellOrThrow(rr.resultat.alveole);
        this.requirePorteurOuFondateur(this.hiveOrThrow(rec.cell.ruche), d.auteur);
        if (!rr.escalade || rec.state !== 'en_verification' || rec.en_attente !== d.cible) throw new OspError('This result is not awaiting arbitration', 409);
        if (d.nature === 'arbitrage_valide') this.validate(rec, d.cible, rec.verdicts.slice(), true);
        else this.rejectResult(rec, d.cible, `Arbitrage du porteur : ${d.motif}`);
        break;
      }
      // OSP v0.3 §2.3: every change of membership is a signed, stated decision, in the hive's own registry.
      case 'role_attribue':
      case 'role_retire':
      case 'depart':
      case 'invitation_revoquee': {
        if (!this.params.prive) throw new OspError('Roles and invitations only exist in private hives', 400);
        const proprietaire = this.rucheUnique().ruche.porteur;
        const membres = this.state.membres!;
        if (d.nature === 'depart') {
          if (d.cible !== d.auteur) throw new OspError('You can only leave for yourself', 403);
          if (d.auteur === proprietaire) throw new OspError('The owner cannot leave the hive', 409);
          if (!membres[d.cible]) throw new OspError('You are not a member of this hive', 404);
          this.retirerMembre(d.cible as ContributorId);
          break;
        }
        if (d.auteur !== proprietaire) throw new OspError('Only the hive owner manages members and invitations', 403);
        if (d.nature === 'invitation_revoquee') {
          const inv = this.state.invitations?.[d.cible];
          if (!inv) throw new OspError('Unknown invitation', 404);
          inv.revoquee = true;
        } else if (d.nature === 'role_retire') {
          if (d.cible === proprietaire) throw new OspError('The owner cannot be removed', 409);
          if (!membres[d.cible]) throw new OspError('Not a member of this hive', 404);
          this.retirerMembre(d.cible as ContributorId);
        } else {
          const m = membres[d.cible];
          if (!m) throw new OspError('Not a member of this hive', 404);
          if (m.role === 'proprietaire') throw new OspError('The owner keeps their role', 409);
          const role = d.params?.role ?? m.role;
          if (role !== 'membre' && role !== 'observateur') throw new OspError('A role is member or observer');
          m.role = role;
          // An observer never guards; a member guards unless the owner says otherwise.
          m.gardienne = role === 'membre' && (d.params?.gardienne ?? true);
        }
        break;
      }
      default:
        throw new OspError(`Unknown decision nature: ${String((d as Decision).nature)}`);
    }
    this.registry.append('decision', { id, ...d });
    return { decision: id };
  }

  // ---------------------------------------------------------------- work

  claim(r: Requete): Assignment | null {
    if (this.options.balise && !this.replayNext) throw new OspError('This coordinator draws lots with the public beacon: go through reclamer()', 400);
    return this.run('claim', { requete: r }, [], () => this.doClaim(r));
  }

  private doClaim(r: Requete): Assignment | null {
    this.checkRequete(r, 'claim');
    this.expire();
    const who = r.contributeur;
    if (this.leasesOf(who) >= this.params.abeilles_max) {
      throw new OspError(`At most ${this.params.abeilles_max} simultaneous bees per contributor`, 429);
    }
    if (r.ruche !== undefined) this.hiveOrThrow(r.ruche);
    const hives = Object.values(this.state.hives).filter((h) => h.statut === 'active' && (r.ruche === undefined || h.ruche.slug === r.ruche));
    const slugs = new Set(hives.map((h) => h.ruche.slug));
    const cells = Object.values(this.state.cells).filter((c) => slugs.has(c.cell.ruche));

    // Locks 1 and 2 (§9.2): distinct guards, drawn by lot, never the author; as many as
    // the Wald test requires (OSP v0.2 P0-4), never fewer than the floor.
    const prend = (caste: Caste) => r.castes === undefined || r.castes.includes(caste);
    const aVerifier = cells.filter((c) => {
      if (!prend('gardienne')) return false;
      if (c.state !== 'en_verification' || !c.en_attente) return false;
      // OSP v0.3 §2.3: in a private hive, only members with the guard role are drawn to verify.
      if (this.params.prive && !this.state.membres?.[who]?.gardienne) return false;
      const rr = this.state.results[c.en_attente];
      if (!rr || rr.resultat.auteur === who) return false;
      const engages = this.engagesSur(c.en_attente);
      const pieges = this.piegesSur(c);
      if (c.gardiennes.some((g) => g.par === who) || c.verdicts.includes(who) || engages.some((e) => e.par === who) || pieges.some((p) => p.attribue_a === who)) return false;
      return c.gardiennes.length + engages.length + pieges.length < this.placesRequises(c);
    });
    // OSP v0.3 §3.2: never two open cells whose write scopes overlap, so no merge conflicts between cells.
    const ouvertes = cells.filter((c) => c.cell.depot && (c.state === 'reservee' || c.state === 'en_cours' || c.state === 'en_verification'));
    const libres = cells.filter((c) => {
      if (c.state !== 'libre') return false;
      if (r.castes !== undefined && !r.castes.includes(this.casteFor(c))) return false;
      const d = c.cell.depot;
      return !d || !ouvertes.some((o) => o.cell.depot!.url === d.url && chevauchent(o.cell.depot!.ecriture, d.ecriture));
    });

    if (aVerifier.length && (libres.length === 0 || this.rng() < 0.5)) {
      const rec = aVerifier[Math.floor(this.rng() * aVerifier.length)]!;
      const rr = this.state.results[rec.en_attente!]!;
      const expire = this.leaseEnd(rec);
      // Lock 4 (§9.4, OSP v0.2 P0-3): instead of the real result, a mutant of it, at a
      // rate specific to each guard. Same cell, same slot, same lease: nothing tells it apart.
      if (this.piegeable(rr)) {
        const taux = this.tauxPieges(who);
        const piege = this.rngSecret() < taux;
        this.journalPieges.push({ taux, piege });
        if (piege) return this.makeTrap(who, rec, rr, expire);
      }
      rec.gardiennes.push({ par: who, caste: 'gardienne', expire });
      return { ...this.assignment(rec, 'gardienne', expire), a_verifier: { id: rec.en_attente!, livrable: rr.livrable } };
    }
    if (!libres.length) return null;

    // First draw a hive, then a branch by Thompson sampling (§12).
    const ruchesLibres = [...new Set(libres.map((c) => c.cell.ruche))].sort();
    const slug = ruchesLibres[Math.floor(this.rng() * ruchesLibres.length)]!;
    const hive = this.state.hives[slug]!;
    const choix = chooseCandidate(
      libres.filter((c) => c.cell.ruche === slug).map((c) => ({ chemin: c.cell.chemin, profondeur: c.profondeur, rec: c })),
      {
        stats: (b) => hive.branches[b] ?? { succes: 0, echecs: 0 },
        multiplicateur: (b) => this.multiplicateur(hive, b),
        plancher: this.params.plancher_anti_famine,
        rng: this.rng,
      },
    );
    if (!choix) return null;
    const rec = choix.rec;
    const caste = this.casteFor(rec);
    transition(rec, 'reservee');
    rec.bail = { par: who, caste, expire: this.leaseEnd(rec) };
    return this.assignment(rec, caste, rec.bail.expire);
  }

  start(r: Requete): { etat: CellState } {
    return this.run('start', { requete: r }, [], () => this.doStart(r));
  }

  private doStart(r: Requete): { etat: CellState } {
    this.checkRequete(r, 'start');
    const rec = this.cellOrThrow(r.alveole);
    if (rec.bail?.par !== r.contributeur) throw new OspError('You do not hold the lease on this cell', 403);
    if (rec.state === 'reservee') transition(rec, 'en_cours');
    return { etat: rec.state };
  }

  release(r: Requete): { rappelee: boolean } {
    return this.run('release', { requete: r }, [], () => this.doRelease(r));
  }

  private doRelease(r: Requete): { rappelee: boolean } {
    this.checkRequete(r, 'release');
    const id = r.alveole;
    const rec = id ? this.state.cells[id] : undefined;
    let rappelee = false;
    if (rec?.bail?.par === r.contributeur && (rec.state === 'reservee' || rec.state === 'en_cours')) {
      delete rec.bail;
      rec.state = 'libre';
      rappelee = true;
      this.registry.append('rappel', { alveole: rec.id, contributeur: r.contributeur });
    } else if (rec && rec.gardiennes.some((g) => g.par === r.contributeur)) {
      rec.gardiennes = rec.gardiennes.filter((g) => g.par !== r.contributeur);
      rappelee = true;
    }
    for (const [pid, p] of Object.entries(this.state.pieges)) {
      if (p.attribue_a === r.contributeur && p.alveole === id) {
        delete this.state.pieges[pid];
        rappelee = true;
      }
    }
    return { rappelee };
  }

  async submitResult(res: Result, livrable: Livrable): Promise<{ statut: 'rejete' | 'en_verification' | 'miel'; resultat: Hash; rapport: VerifReport }> {
    const replay = this.replayNext;
    const verifs = replay ? replay.verifs : await this.verifyResult(res, livrable);
    const [rapport, ...mutants] = verifs;
    if (!rapport) throw new ReplayDivergence('Verification report missing from the registry');
    return this.run('submitResult', { resultat: res, livrable }, verifs, () => this.doSubmitResult(res, livrable, rapport, mutants));
  }

  /**
   * Side-effect-free checks, then automatic verification, outside the transaction. If the deliverable
   * passes, we prepare what is needed to make traps (P0-3): its mutants, run through only the checks
   * that the guards re-run. Those they reject can be handed to them in place of the real one.
   */
  private async verifyResult(res: Result, livrable: Livrable): Promise<VerifReport[]> {
    const rec = this.checkResult(res, livrable);
    if (this.occupees.has(rec.id)) throw new OspError('A verification is already in progress for this cell', 409);
    this.occupees.add(rec.id);
    try {
      const rapport = await this.verifier(rec.cell.critere_fini, livrable, { caches: this.cachesFor(rec) });
      const crit = rec.cell.critere_fini;
      if (!rapport.ok || this.params.taux_pieges <= 0 || this.params.gardiennes_v0 <= 0 || !estCritereTests(crit)) return [rapport];
      const reports = [rapport];
      let tues = 0;
      for (const m of mutants(livrable, { max: this.params.pieges_essais, version: this.params.moteur_mutation })) {
        const r = await this.verifier(crit, m.livrable, { sansCaches: true });
        reports.push(r);
        if (!r.ok && ++tues >= 3) break;
      }
      return reports;
    } finally {
      this.occupees.delete(rec.id);
    }
  }

  private checkResult(res: Result, livrable: Livrable): CellRecord {
    if (res?.type !== 'osp.result/0.1') throw new OspError('Expected a result object (osp.result/0.1)');
    if (!isContributorId(res.auteur) || !verifyObject(res, res.auteur)) throw new OspError('Invalid result signature', 401);
    this.exigerMembre(res.auteur);
    if (this.state.results[hashOf(res)]) throw new OspError('Result already submitted', 409);
    const rec = this.cellOrThrow(res.alveole);
    if (rec.bail?.par !== res.auteur) throw new OspError('You do not hold the lease on this cell', 403);
    if (rec.bail.caste !== res.caste) throw new OspError(`Your caste for this cell is "${rec.bail.caste}"`, 409);
    if (rec.state !== 'reservee' && rec.state !== 'en_cours') throw new OspError(`The cell is ${rec.state}`, 409);
    try {
      validateLivrable(livrable);
    } catch (e) {
      throw new OspError((e as Error).message);
    }
    if (hashOf(livrable) !== res.livrable) throw new OspError('The deliverable hash does not match the signed result');
    const depot = rec.cell.depot;
    if (depot) {
      const hors = horsPortee(depot, livrable);
      if (hors.length) throw new OspError(`Outside this cell's write scope: ${hors.slice(0, 5).join(', ')}`, 403);
      for (const [p, contenu] of Object.entries(livrable.contexte ?? {})) {
        if (!depot.lecture.includes(p) || empreinteLecture(contenu) !== depot.empreintes_lecture[p]) throw new OspError(`Context file ${p} is not a file read by this cell, as pinned by its hash`);
      }
    } else if (livrable.supprimes !== undefined || livrable.contexte !== undefined) throw new OspError('Only a repo cell deletes files or reads repository files');
    return rec;
  }

  private doSubmitResult(
    res: Result,
    livrable: Livrable,
    rapport: VerifReport,
    essais: VerifReport[],
  ): { statut: 'rejete' | 'en_verification' | 'miel'; resultat: Hash; rapport: VerifReport } {
    // The state may have changed during verification: check again, inside the transaction.
    const rec = this.checkResult(res, livrable);
    if (rec.state === 'reservee') transition(rec, 'en_cours');
    const id = hashOf(res);
    // The mutants are recomputed identically (the engine is deterministic); only the reports come from execution.
    const candidats = essais.length ? mutants(livrable, { max: this.params.pieges_essais, version: this.params.moteur_mutation }) : [];
    if (essais.length > candidats.length) throw new ReplayDivergence('More mutant reports than mutants');
    // A good trap loads and passes some of the tests: only a real verification exposes it.
    const pieges = essais
      .map((r, i) => ({ livrable: candidats[i]!.livrable, echecs: r.ok ? 0 : r.tests.filter((t) => !t.ok).length }))
      .filter((m) => m.echecs > 0)
      .sort((a, b) => a.echecs - b.echecs);
    this.state.results[id] = { resultat: res, livrable, rapport, statut: 'en_verification', soumis_a: this.now(), mutants: pieges };
    delete rec.bail;
    this.registry.append('resultat_soumis', {
      id,
      alveole: rec.id,
      chemin: rec.cell.chemin,
      auteur: res.auteur,
      livrable: res.livrable,
      verification_auto: rapport.motif,
    });
    for (const impasse of (res.impasses ?? []).slice(0, MAX_IMPASSES)) {
      this.addBoard(rec.cell.ruche, { nature: 'impasse', chemin: rec.cell.chemin, texte: String(impasse).slice(0, 500), auteur: res.auteur, source: id });
    }

    if (!rapport.ok) {
      this.rejectResult(rec, id, `Vérificateur automatique : ${rapport.motif}`);
      return { statut: 'rejete', resultat: id, rapport };
    }
    transition(rec, 'en_verification');
    rec.en_attente = id;
    rec.cote = Math.round(logit(this.params.p_juste_initiale) * 1e9) / 1e9;
    rec.nb_verdicts = 0;
    if (this.params.gardiennes_v0 <= 0) {
      this.validate(rec, id);
      return { statut: 'miel', resultat: id, rapport };
    }
    return { statut: 'en_verification', resultat: id, rapport };
  }

  async submitDecomposition(d: Decomposition, secrets: Array<Secrets | undefined> = []): Promise<{ statut: 'en_attente_porteur' | 'adopte'; decoupage: Hash; enfants: Hash[] }> {
    const replay = this.replayNext;
    const verifs = replay ? replay.verifs : await this.checkDecomposition(d, secrets);
    const out = this.run('submitDecomposition', { decomposition: d }, verifs, () => this.doSubmitDecomposition(d, verifs));
    if (!this.options.replay) this.storeSecrets(secrets);
    return out;
  }

  /**
   * Outside the transaction: do the secrets match their commitments, and are the tests of each
   * child that provides a reference strong enough (mutation score, OSP v0.2 §3.2)?
   */
  private async checkDecomposition(d: Decomposition, secrets: Array<Secrets | undefined>): Promise<VerifReport[]> {
    this.decompositionBasics(d);
    const reports: VerifReport[] = [];
    for (const [i, child] of d.enfants.entries()) {
      const label = `Child ${i + 1} ("${child.objectif.slice(0, 50)}")`;
      this.checkSecrets(child, secrets[i], label);
      const c = child.critere_fini;
      if (!estCritereTests(c)) continue;
      if (!c.reference_hash) {
        if (this.params.reference_obligatoire) throw new OspError(`${label}: a reference implementation is required to measure the strength of the tests`);
        continue;
      }
      const r = await adequation(c, secrets[i]?.tests_caches ?? [], secrets[i]!.reference!, {
        scoreMin: this.params.score_mutation_min,
        moteurMutation: this.params.moteur_mutation,
        exigerMesure: this.params.reference_obligatoire,
      });
      if (!r.ok) throw new OspError(`${label}: ${r.motif}`);
      reports.push(r);
    }
    return reports;
  }

  /** The split checks that need no heavy computation. */
  private decompositionBasics(d: Decomposition): CellRecord {
    if (d?.type !== 'osp.decomposition/0.1') throw new OspError('Expected a split object (osp.decomposition/0.1)');
    if (!isContributorId(d.auteur) || !verifyObject(d, d.auteur)) throw new OspError('Invalid split signature', 401);
    this.exigerMembre(d.auteur);
    if (this.state.decompositions[hashOf(d)]) throw new OspError('Split already submitted', 409);
    const rec = this.cellOrThrow(d.alveole);
    if (rec.bail?.par !== d.auteur || rec.bail.caste !== 'eclaireuse') throw new OspError('You are not the scout of this cell', 403);
    if (rec.state !== 'reservee' && rec.state !== 'en_cours') throw new OspError(`The cell is ${rec.state}`, 409);
    const n = Array.isArray(d.enfants) ? d.enfants.length : 0;
    if (n < this.params.enfants_min || n > this.params.enfants_max) {
      throw new OspError(`A split has between ${this.params.enfants_min} and ${this.params.enfants_max} children`);
    }
    if (rec.profondeur + 1 > this.params.profondeur_max) throw new OspError('Maximum depth reached (§6.4)');
    d.enfants.forEach((e) => this.validateSpec(e));
    // OSP v0.3 §3.2: the children of a repo cell work on the same repository, inside its write scope.
    const depot = rec.cell.depot;
    if (depot) {
      for (const e of d.enfants) {
        if (!e.depot) continue;
        if (e.depot.url !== depot.url) throw new OspError('A child works on the same repository as its parent');
        if (!inclus(e.depot.ecriture, depot.ecriture)) throw new OspError("A child's write scope stays inside its parent's");
      }
    }
    return rec;
  }

  private doSubmitDecomposition(d: Decomposition, verifs: VerifReport[]): { statut: 'en_attente_porteur' | 'adopte'; decoupage: Hash; enfants: Hash[] } {
    // The state may have changed while the tests were measured: check again, inside the transaction.
    const rec = this.decompositionBasics(d);
    const id = hashOf(d);
    const n = d.enfants.length;
    // One mutation score per child that announces a reference, in order.
    const avecRef = d.enfants.filter((e) => estCritereTests(e.critere_fini) && e.critere_fini.reference_hash).length;
    if (verifs.length !== avecRef || verifs.some((r) => !r.ok || !r.mutation)) throw new OspError('Test strength measurement missing or insufficient');
    let k = 0;
    // A reference with nothing to mutate has no measurement: like a child without a reference.
    const force_tests = d.enfants.map((e) => {
      if (!estCritereTests(e.critere_fini) || !e.critere_fini.reference_hash) return null;
      const m = verifs[k++]!.mutation!;
      return m.total > 0 ? m.score : null;
    });
    if (rec.state === 'reservee') transition(rec, 'en_cours');

    this.state.decompositions[id] = { decomposition: d, statut: 'en_attente', force_tests };
    delete rec.bail;
    this.registry.append('decoupage_propose', { id, alveole: rec.id, chemin: rec.cell.chemin, auteur: d.auteur, enfants: n });

    if (rec.profondeur <= this.params.niveau_approbation_porteur) {
      transition(rec, 'en_verification');
      rec.en_attente = id;
      return { statut: 'en_attente_porteur', decoupage: id, enfants: [] };
    }
    this.applyDecomposition(rec, id);
    return { statut: 'adopte', decoupage: id, enfants: rec.enfants };
  }

  /**
   * First half of a verdict (OSP v0.2, P1-3): the guard publishes the hash of their verdict,
   * which stays sealed. Verdicts are revealed only once all the guards of the result
   * have committed: nobody can copy another one or align with them.
   */
  engagerVerdict(e: EngagementVerdict): { statut: 'engage'; revelation: boolean } {
    return this.run('engageVerdict', { engagement: e }, [], () => this.doEngagerVerdict(e));
  }

  private doEngagerVerdict(e: EngagementVerdict): { statut: 'engage'; revelation: boolean } {
    if (e?.type !== 'osp.engagement/0.1') throw new OspError('Expected a commitment object (osp.engagement/0.1)');
    if (!isContributorId(e.gardienne) || !verifyObject(e, e.gardienne)) throw new OspError('Invalid commitment signature', 401);
    this.exigerMembre(e.gardienne);
    if (typeof e.engagement !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(e.engagement)) throw new OspError('Invalid commitment: expected sha256');
    this.expire();

    const piege = this.state.pieges[e.resultat];
    if (piege) {
      if (piege.attribue_a !== e.gardienne) throw new OspError('This result was not assigned to you', 403);
      if (piege.engagement) throw new OspError('You have already committed on this result', 409);
      piege.engagement = e.engagement;
      piege.expire = this.leaseEnd(this.cellOrThrow(piege.alveole));
      this.registry.append('engagement', { resultat: e.resultat, gardienne: e.gardienne, engagement: e.engagement });
      return { statut: 'engage', revelation: true };
    }

    const rr = this.state.results[e.resultat];
    if (!rr) throw new OspError('Unknown result', 404);
    const rec = this.cellOrThrow(rr.resultat.alveole);
    if (rec.state !== 'en_verification' || rec.en_attente !== e.resultat) throw new OspError('This result is no longer awaiting verification', 409);
    if (!rec.gardiennes.some((g) => g.par === e.gardienne)) throw new OspError('You are not a guard drawn for this result', 403);
    if (rr.resultat.auteur === e.gardienne) throw new OspError('You cannot verify your own work (§7.3)', 403);
    rec.gardiennes = rec.gardiennes.filter((g) => g.par !== e.gardienne);
    const liste = (this.state.engagements[e.resultat] ??= []);
    liste.push({ par: e.gardienne, engagement: e.engagement, expire: this.leaseEnd(rec) });
    this.registry.append('engagement', { resultat: e.resultat, gardienne: e.gardienne, engagement: e.engagement });
    const ouverte = this.revelationOuverte(rec, e.resultat);
    // The reveal window starts when it opens, for each of them.
    if (ouverte) for (const x of liste) x.expire = this.leaseEnd(rec);
    return { statut: 'engage', revelation: ouverte };
  }

  /** All the guard slots open on the result have committed: the reveal can start. */
  private revelationOuverte(rec: CellRecord, resultat: Hash): boolean {
    const pieges = this.piegesSur(rec);
    return rec.gardiennes.length === 0 && pieges.every((p) => p.engagement) && this.engagesSur(resultat).length + pieges.length >= this.placesRequises(rec);
  }

  // ---------------------------------------------------------------- P0-4: Wald sequential test

  /** The log-odds beyond which P(false) ≤ α*. */
  private seuilWald(): number {
    return logit(1 - this.params.alpha_faux);
  }

  /** The weight of a "valid" from this guard: log(c / (1 − s)) on the lower bounds of their reliability. */
  poids(id: ContributorId): number {
    return poidsValide(this.state.fiabilite[id] ?? VIERGE, this.params);
  }

  /** One more observation of a guard's reliability, when the truth is known. */
  private noter(id: ContributorId, quoi: 's' | 'c', ok: boolean): void {
    observer((this.state.fiabilite[id] ??= { ...VIERGE }), quoi, ok, this.params.oubli_fiabilite);
  }

  /**
   * The guard slots to fill on the pending result: enough to cross the Wald threshold
   * with guards of unknown reliability (the most cautiously weighted), and never fewer than the
   * floor. More reliable guards conclude sooner; the extra slots close.
   */
  private placesRequises(rec: CellRecord): number {
    const rr = rec.en_attente ? this.state.results[rec.en_attente] : undefined;
    if (!rr || rr.escalade) return 0;
    const plancher = Math.max(1, this.params.gardiennes_v0);
    const manque = this.seuilWald() - (rec.cote ?? logit(this.params.p_juste_initiale));
    const parPoids = manque > 0 ? Math.ceil(manque / poidsValide(VIERGE, this.params) - 1e-9) : 0;
    const places = Math.max(plancher - rec.verdicts.length, parPoids);
    return Math.max(0, Math.min(places, this.params.verdicts_max - (rec.nb_verdicts ?? 0)));
  }

  /** When the guards cannot reach a conclusion, the result goes to the hive owner for arbitration (§4.4). */
  private escalader(rec: CellRecord, rr: ResultRecord, motif: string): void {
    rr.escalade = true;
    this.registry.append('escalade', { alveole: rec.id, chemin: rec.cell.chemin, resultat: rec.en_attente, motif });
  }

  private engagesSur(resultat: Hash | undefined): Engagement[] {
    return resultat ? (this.state.engagements[resultat] ?? []) : [];
  }

  /** Second half of a verdict: the reveal, which must match the commitment. */
  async submitVerdict(v: Verdict): Promise<{ statut: string; piege?: boolean; correct?: boolean | null; renverse?: boolean; confirmations?: number }> {
    const replay = this.replayNext;
    const rejeu = replay ? (replay.verifs[0] ?? null) : await this.rejeuFor(v);
    return this.run('submitVerdict', { verdict: v }, rejeu ? [rejeu] : [], () => this.doSubmitVerdict(v, rejeu));
  }

  /** Rejecting a result accepted by the automatic verifier triggers a re-run (§9.5, MVP version). */
  private async rejeuFor(v: Verdict): Promise<VerifReport | null> {
    if (v?.type !== 'osp.verdict/0.1' || v.decision !== 'rejete' || this.state.pieges[v.resultat]) return null;
    const rr = this.state.results[v.resultat];
    const rec = rr ? this.state.cells[rr.resultat.alveole] : undefined;
    if (!rr || !rec || rec.en_attente !== v.resultat) return null;
    if (!this.engagesSur(v.resultat).some((e) => e.par === v.gardienne) || !this.revelationOuverte(rec, v.resultat)) return null;
    return this.verifier(rec.cell.critere_fini, rr.livrable, { caches: this.cachesFor(rec) });
  }

  private doSubmitVerdict(v: Verdict, rejeu: VerifReport | null): { statut: string; piege?: boolean; correct?: boolean | null; renverse?: boolean; confirmations?: number } {
    if (v?.type !== 'osp.verdict/0.1') throw new OspError('Expected a verdict object (osp.verdict/0.1)');
    if (!isContributorId(v.gardienne) || !verifyObject(v, v.gardienne)) throw new OspError('Invalid verdict signature', 401);
    this.exigerMembre(v.gardienne);
    if (!['valide', 'rejete', 'abstention'].includes(v.decision)) throw new OspError('Invalid decision');
    if (typeof v.sel !== 'string' || !/^[0-9a-f]{64,}$/.test(v.sel)) throw new OspError('Verdict salt missing or too short (32 bytes in hexadecimal)');
    this.expire();
    const h = hashOf(v);

    const piege = this.state.pieges[v.resultat];
    if (piege) {
      if (piege.attribue_a !== v.gardienne) throw new OspError('This result was not assigned to you', 403);
      if (!piege.engagement) throw new OspError('Commit to your verdict first (osp.engagement/0.1)', 409);
      if (piege.engagement !== h) throw new OspError('This verdict does not match your commitment', 400);
      delete this.state.pieges[v.resultat];
      const ruche = this.state.cells[piege.alveole]?.cell.ruche;
      let correct: boolean | null = null;
      if (v.decision === 'rejete') {
        correct = true;
        this.ledger.award(v.gardienne, this.params.bonus_piege, 'piège déjoué', ruche);
        this.ledger.reputation(v.gardienne, 'confirme');
        // A trap is a false result whose truth is known: it measures sensitivity.
        this.noter(v.gardienne, 's', true);
        this.registry.append('piege_dejoue', { gardienne: v.gardienne, alveole: piege.alveole });
        this.grant(v.gardienne, 'trap_hunter', ruche);
      } else if (v.decision === 'valide') {
        correct = false;
        this.ledger.reputation(v.gardienne, 'piege_valide');
        this.noter(v.gardienne, 's', false);
        this.registry.append('piege_valide', { gardienne: v.gardienne, alveole: piege.alveole });
      }
      return { statut: 'piege', piege: true, correct };
    }

    const rr = this.state.results[v.resultat];
    if (!rr) throw new OspError('Unknown result', 404);
    const rec = this.cellOrThrow(rr.resultat.alveole);
    if (rr.resultat.auteur === v.gardienne) throw new OspError('You cannot verify your own work (§7.3)', 403);
    const liste = this.engagesSur(v.resultat);
    const eng = liste.find((e) => e.par === v.gardienne);
    if (!eng) {
      throw new OspError(
        rec.gardiennes.some((g) => g.par === v.gardienne) ? 'Commit to your verdict first (osp.engagement/0.1)' : 'No commitment from you on this result',
        409,
      );
    }
    if (eng.engagement !== h) throw new OspError('This verdict does not match your commitment', 400);
    const enCours = rec.state === 'en_verification' && rec.en_attente === v.resultat;
    if (enCours && !this.revelationOuverte(rec, v.resultat)) {
      throw new OspError('Reveal not open yet: other guards still have to commit', 425);
    }
    const reste = liste.filter((e) => e !== eng);
    if (reste.length) this.state.engagements[v.resultat] = reste;
    else delete this.state.engagements[v.resultat];
    // The weight of this "valid" in the Wald test, based on the guard's reliability at this moment.
    const poids = enCours && v.decision === 'valide' ? this.poids(v.gardienne) : undefined;
    this.registry.append('verdict', { resultat: v.resultat, gardienne: v.gardienne, decision: v.decision, motif: v.motif, engagement: h, ...(poids !== undefined ? { poids } : {}) });

    if (!enCours) {
      // Late reveal: the result was settled while this verdict was sealed.
      // It is judged anyway: staying silent costs more than having been wrong.
      if (v.decision === 'abstention') return { statut: rr.statut };
      const juste = (v.decision === 'rejete') === (rr.statut === 'rejete');
      this.ledger.reputation(v.gardienne, juste ? 'confirme' : 'renverse');
      this.noter(v.gardienne, rr.statut === 'rejete' ? 's' : 'c', juste);
      return { statut: rr.statut, renverse: !juste };
    }
    rec.nb_verdicts = (rec.nb_verdicts ?? 0) + 1;

    if (v.decision === 'valide') {
      // Wald test (OSP v0.2 §4.2): each "valid" adds log(c / (1 − s)) to the log-odds.
      rec.verdicts.push(v.gardienne);
      rec.cote = Math.round(((rec.cote ?? logit(this.params.p_juste_initiale)) + poids!) * 1e9) / 1e9;
      if (rec.verdicts.length >= Math.max(1, this.params.gardiennes_v0) && rec.cote >= this.seuilWald()) {
        this.validate(rec, v.resultat, rec.verdicts.slice());
        return { statut: 'miel', confirmations: rec.validee_par?.length };
      }
      this.escaladerSiEpuise(rec, rr);
      return { statut: 'en_verification', confirmations: rec.verdicts.length };
    }
    if (v.decision === 'abstention') {
      this.escaladerSiEpuise(rec, rr);
      return { statut: 'en_verification' };
    }

    // Rejection of a result the automatic verifier had accepted: re-run it (§9.5, MVP version).
    // In V0, the re-run decides: either the result is false, or the guard was wrong.
    if (!rejeu) throw new OspError('Re-run missing for this rejection', 500);
    if (!rejeu.ok) {
      this.ledger.award(v.gardienne, this.params.bonus_faux_reel, 'faux résultat démasqué', rec.cell.ruche);
      this.ledger.reputation(v.gardienne, 'confirme');
      this.noter(v.gardienne, 's', true);
      // Those who had validated a false result are overturned.
      for (const g of rec.verdicts) {
        this.ledger.reputation(g, 'renverse');
        this.noter(g, 's', false);
      }
      this.rejectResult(rec, v.resultat, `Rejeté par une gardienne : ${v.motif}`);
      return { statut: 'rejete' };
    }
    this.ledger.reputation(v.gardienne, 'renverse');
    this.noter(v.gardienne, 'c', false);
    this.registry.append('verdict_renverse', { resultat: v.resultat, gardienne: v.gardienne, rejeu: rejeu.motif });
    this.escaladerSiEpuise(rec, rr);
    return { statut: 'en_verification', renverse: true };
  }

  /** Too many verdicts without a conclusion: the hive owner arbitrates. */
  private escaladerSiEpuise(rec: CellRecord, rr: ResultRecord): void {
    if (!rr.escalade && (rec.nb_verdicts ?? 0) >= this.params.verdicts_max) this.escalader(rec, rr, `${rec.nb_verdicts} verdicts sans conclusion`);
  }

  // ---------------------------------------------------------------- internal

  private emitCell(ruche: string, spec: CellSpec, parent: CellRecord | null, chemin: string, profondeur: number): CellRecord {
    const cell = this.sign<Cell>(
      {
        type: 'osp.cell/0.1',
        ruche,
        parent: parent ? parent.id : null,
        chemin,
        objectif: spec.objectif,
        capsule: sha256(spec.capsule),
        critere_fini: spec.critere_fini,
        budget: spec.budget ?? DEFAULT_BUDGET,
        atomique: spec.atomique,
        emise_par: 'coordinateur',
        ...(spec.depot ? { depot: spec.depot } : {}),
      },
      this.identite,
    );
    const rec: CellRecord = {
      id: hashOf(cell),
      cell,
      capsule_texte: spec.capsule,
      state: 'libre',
      profondeur,
      enfants: [],
      gardiennes: [],
      verdicts: [],
      rejets: 0,
      redecouper: false,
    };
    this.state.cells[rec.id] = rec;
    this.registry.append('alveole_emise', { id: rec.id, ruche, chemin, parent: cell.parent, atomique: cell.atomique });
    return rec;
  }

  private applyDecomposition(rec: CellRecord, id: Hash): void {
    const dr = this.state.decompositions[id]!;
    dr.statut = 'adoptee';
    transition(rec, 'verrouillee');
    delete rec.en_attente;
    rec.redecouper = false;
    rec.rejets = 0;
    rec.enfants = dr.decomposition.enfants.map((spec, i) => {
      const child = this.emitCell(rec.cell.ruche, spec, rec, rec.cell.chemin === '0' ? `${i + 1}` : `${rec.cell.chemin}.${i + 1}`, rec.profondeur + 1);
      const f = dr.force_tests?.[i];
      if (typeof f === 'number') child.force_tests = f;
      return child.id;
    });
    const hive = this.state.hives[rec.cell.ruche]!;
    const auteur = dr.decomposition.auteur;
    this.ledger.award(auteur, this.params.miel_eclaireuse, `découpage ${rec.cell.chemin}`, hive.ruche.slug);
    this.addContribution(hive, auteur, this.params.miel_eclaireuse);
    this.ledger.reputation(auteur, 'confirme');
    this.grant(auteur, 'scout');
    this.registry.append('decoupage_adopte', { id, alveole: rec.id, chemin: rec.cell.chemin, enfants: rec.enfants });
  }

  private rejectResult(rec: CellRecord, resultId: Hash, motif: string): void {
    const rr = this.state.results[resultId]!;
    rr.statut = 'rejete';
    transition(rec, 'rejetee');
    rec.rejets++;
    delete rec.en_attente;
    rec.gardiennes = [];
    rec.verdicts = [];
    delete rec.cote;
    delete rec.nb_verdicts;
    // Traps not yet committed disappear with the result, like the real guards' slots.
    for (const [pid, p] of Object.entries(this.state.pieges)) if (p.vraie === resultId && !p.engagement) delete this.state.pieges[pid];
    const hive = this.state.hives[rec.cell.ruche]!;
    this.branchStats(hive, rec).echecs++;
    this.ledger.reputation(rr.resultat.auteur, 'resultat_rejete');
    this.addBoard(rec.cell.ruche, { nature: 'impasse', chemin: rec.cell.chemin, texte: motif.slice(0, 500), auteur: rr.resultat.auteur, source: resultId });
    this.registry.append('alveole_rejetee', { alveole: rec.id, chemin: rec.cell.chemin, resultat: resultId, motif, rejets: rec.rejets });

    if (rec.rejets >= this.params.rejets_avant_redecoupage && rec.enfants.length === 0) {
      if (rec.profondeur + 1 > this.params.profondeur_max) {
        transition(rec, 'bloquee');
        this.registry.append('alveole_bloquee', { alveole: rec.id, chemin: rec.cell.chemin });
        return;
      }
      rec.redecouper = true;
      this.registry.append('redecoupage', { alveole: rec.id, chemin: rec.cell.chemin });
    }
    transition(rec, 'libre');
  }

  private validate(rec: CellRecord, resultId: Hash, gardiennes: ContributorId[] = [], arbitrage = false): void {
    const rr = this.state.results[resultId]!;
    rr.statut = 'valide';
    transition(rec, 'miel');
    rec.resultat_valide = resultId;
    rec.validee_par = gardiennes;
    delete rec.en_attente;
    rec.gardiennes = [];
    rec.verdicts = [];
    // P0-4: the probability that this honey is false, according to the Wald test (published with the validation).
    const cote = rec.cote;
    delete rec.cote;
    delete rec.nb_verdicts;
    const wald = cote !== undefined && gardiennes.length ? { cote, p_faux: Number((1 / (1 + Math.exp(cote))).toPrecision(6)) } : {};
    const hive = this.state.hives[rec.cell.ruche]!;
    const slug = hive.ruche.slug;
    this.branchStats(hive, rec).succes++;

    const g = this.mielOf(rec);
    const auteur = rr.resultat.auteur;
    this.ledger.award(auteur, g, `alvéole ${rec.cell.chemin}`, slug);
    this.addContribution(hive, auteur, g);
    this.ledger.reputation(auteur, 'confirme');
    this.grant(auteur, 'first_drop');
    if (rec.enfants.length) this.grant(auteur, 'builder');
    if (this.bump(auteur, 'alveoles') >= 10) this.grant(auteur, 'busy_bee');
    for (const gardienne of gardiennes) {
      const gg = g * this.params.part_gardienne;
      this.ledger.award(gardienne, gg, `vérification ${rec.cell.chemin}`, slug);
      this.addContribution(hive, gardienne, gg);
      this.ledger.reputation(gardienne, 'confirme');
      this.noter(gardienne, 'c', true);
      if (this.bump(gardienne, 'verifications') >= 10) this.grant(gardienne, 'guardian');
    }
    this.addBoard(slug, { nature: 'decouverte', chemin: rec.cell.chemin, texte: `Validée : ${rec.cell.objectif}`, auteur, source: resultId });
    this.registry.append('alveole_miel', {
      alveole: rec.id, chemin: rec.cell.chemin, resultat: resultId, auteur, gardiennes, grammes: g, ...wald, ...(arbitrage ? { arbitrage: true } : {}),
    });
    // The cell's secrets become public: anyone can now re-verify its validation.
    const crit = rec.cell.critere_fini;
    if (estCritereTests(crit) && (crit.tests_caches_hash || crit.reference_hash)) {
      this.registry.append('secrets_reveles', {
        alveole: rec.id,
        chemin: rec.cell.chemin,
        ...(crit.tests_caches_hash ? { tests_caches: this.reveal(crit.tests_caches_hash) } : {}),
        ...(crit.reference_hash ? { reference: this.reveal(crit.reference_hash) } : {}),
      });
    }

    if (rec.cell.parent) {
      const parent = this.state.cells[rec.cell.parent];
      if (parent && parent.state === 'verrouillee' && parent.enfants.every((c) => this.state.cells[c]?.state === 'miel')) {
        transition(parent, 'libre');
        this.registry.append('alveole_liberee', { alveole: parent.id, chemin: parent.cell.chemin });
      }
    } else {
      this.completeHive(hive);
    }
  }

  private completeHive(hive: HiveRecord): void {
    hive.statut = 'terminee';
    const slug = hive.ruche.slug;
    const total = Object.values(hive.contributions).reduce((s, x) => s + x, 0);
    if (total > 0) {
      for (const [id, g] of Object.entries(hive.contributions)) {
        this.ledger.award(id as ContributorId, (this.params.bonus_coeur * g) / total, 'bonus du cœur', slug);
        this.grant(id as ContributorId, 'heart', slug);
      }
      // Backing (§10.1) comes after the MVP: the multiplier is 1 for now.
      this.ledger.award(hive.ruche.porteur, total * this.params.part_porteur, 'porteur : ruche complétée', slug);
    }
    this.registry.append('ruche_terminee', { slug, miel_total: Math.round(total * 1000) / 1000 });
  }

  /**
   * P0-3: a trap is the real pending deliverable with a single subtle bug, which the guards'
   * checks expose. It takes a guard slot on the cell, like the real result.
   */
  private makeTrap(who: ContributorId, rec: CellRecord, rr: ResultRecord, expire: number): Assignment {
    const m = rr.mutants[Math.floor(this.rngSecret() * rr.mutants.length)]!;
    // An identifier as opaque as a real result's.
    const id = sha256(canonicalize({ type: 'osp.piege/0.2', vraie: rec.en_attente, gardienne: who, sel: [this.rngSecret(), this.rngSecret()] }));
    this.state.pieges[id] = { livrable: m.livrable, alveole: rec.id, vraie: rec.en_attente!, attribue_a: who, expire };
    return { ...this.assignment(rec, 'gardienne', expire), a_verifier: { id, livrable: m.livrable } };
  }

  /** A result can serve as a model for traps as long as it has mutants and its submission is under embargo. */
  private piegeable(rr: ResultRecord): boolean {
    return rr.mutants.length > 0 && this.now() - rr.soumis_a < this.params.embargo_max_ms;
  }

  /**
   * P0-3: a guard's trap rate. High for a newcomer, it decreases with their
   * reputation without going below the floor: it is the cheapest way to measure each one.
   */
  tauxPieges(who: ContributorId): number {
    const t = this.params.taux_pieges;
    if (t <= 0) return 0;
    const rep = this.ledger.peek(who).reputation;
    const p = Math.round(((t * (1 - rep)) / (1 - this.params.reputation_initiale)) * 1e6) / 1e6;
    return Math.min(1, Math.max(Math.min(t, this.params.taux_pieges_min), p));
  }

  /** The traps still open on a cell's pending result: each one takes a slot there. */
  private piegesSur(rec: CellRecord): Piege[] {
    return rec.en_attente ? Object.values(this.state.pieges).filter((p) => p.alveole === rec.id && p.vraie === rec.en_attente) : [];
  }

  /**
   * OSP v0.2 P0-3: the last publishable registry entry. As long as a result awaits its
   * guards, its submission and everything after it stay under embargo: otherwise a guard
   * would compare the deliverable received with the published one, and recognize a trap. The registry
   * head (its hash, its seals) stays public: nothing under embargo can change.
   */
  horizon(): number {
    const entries = this.registry.entries;
    let h = entries.length - 1;
    const limite = this.baseNow() - this.params.embargo_max_ms;
    for (const [id, rr] of Object.entries(this.state.results)) {
      if (rr.statut === 'en_verification' && rr.soumis_a >= limite) h = Math.min(h, this.debutSoumission(id) - 1);
    }
    return h;
  }

  /** Index of a submission's first entry (`resultat_soumis`), found in the registry then kept in memory. */
  private debutSoumission(id: string): number {
    const connu = this.rangsSoumission.get(id);
    if (connu !== undefined && this.registry.entries[connu]?.nature === 'resultat_soumis') return connu;
    for (let i = this.registry.entries.length - 1; i >= 0; i--) {
      const e = this.registry.entries[i]!;
      if (e.nature === 'resultat_soumis' && (e.donnees as { id: string }).id === id) {
        this.rangsSoumission.set(id, i);
        return i;
      }
    }
    return 0;
  }

  private assignment(rec: CellRecord, caste: Caste, bail_expire: number): Assignment {
    const a: Assignment = { caste, alveole_id: rec.id, alveole: rec.cell, capsule: rec.capsule_texte, profondeur: rec.profondeur, bail_expire };
    const pb = this.state.hives[rec.cell.ruche]?.ruche.playbook;
    if (pb) a.playbook = pb;
    if (caste === 'batisseuse') {
      a.enfants_valides = rec.enfants.map((cid) => {
        const child = this.state.cells[cid]!;
        return {
          chemin: child.cell.chemin,
          objectif: child.cell.objectif,
          module: child.cell.critere_fini.module ?? 'solution.mjs',
          livrable: this.livrableValide(cid) ?? { fichiers: {} },
        };
      });
    }
    return a;
  }

  private casteFor(rec: CellRecord): Caste {
    if (rec.enfants.length > 0) return 'batisseuse';
    if (!rec.cell.atomique || rec.redecouper) return 'eclaireuse';
    return 'ouvriere';
  }

  private mielOf(rec: CellRecord): number {
    const hauteur = (r: CellRecord): number => (r.enfants.length ? 1 + Math.max(...r.enfants.map((c) => hauteur(this.state.cells[c]!))) : 0);
    const cClasse = 1; // V0 (§10.1)
    return this.params.miel_base * cClasse * (1 + 0.25 * hauteur(rec));
  }

  private multiplicateur(hive: HiveRecord, branche: string): number {
    const now = this.now();
    const m = hive.orientations.filter((o) => o.branche === branche && o.expire > now).reduce((acc, o) => acc * o.multiplicateur, 1);
    return Math.min(m, this.params.multiplicateur_max_total);
  }

  private expire(): void {
    const now = this.now();
    for (const rec of Object.values(this.state.cells)) {
      if (rec.bail && rec.bail.expire <= now) {
        const par = rec.bail.par;
        delete rec.bail;
        if (rec.state === 'reservee' || rec.state === 'en_cours') rec.state = 'libre';
        this.ledger.reputation(par, 'bail_expire');
        this.registry.append('bail_expire', { alveole: rec.id, contributeur: par });
      }
      if (rec.gardiennes.some((g) => g.expire <= now)) {
        for (const g of rec.gardiennes) if (g.expire <= now) this.ledger.reputation(g.par, 'bail_expire');
        rec.gardiennes = rec.gardiennes.filter((g) => g.expire > now);
      }
      // P0-4: a result that waits too long for its guards (small hive, absent guards) goes to arbitration.
      const rr = rec.state === 'en_verification' && rec.en_attente ? this.state.results[rec.en_attente] : undefined;
      if (rr && rr.statut === 'en_verification' && !rr.escalade && now - rr.soumis_a > this.params.escalade_ms) {
        this.escalader(rec, rr, 'attente trop longue des gardiennes');
      }
    }
    // P1-3: a sealed verdict not revealed in time costs more than the worst revealed verdict.
    // The window only runs if the reveal is open (or if the result was settled in the meantime).
    for (const [resultat, liste] of Object.entries(this.state.engagements)) {
      const rr = this.state.results[resultat];
      const rec = rr ? this.state.cells[rr.resultat.alveole] : undefined;
      if (rec && rec.en_attente === resultat && rec.state === 'en_verification' && !this.revelationOuverte(rec, resultat)) continue;
      const echues = liste.filter((e) => e.expire <= now);
      for (const e of echues) {
        this.ledger.reputation(e.par, 'non_revele');
        this.registry.append('engagement_expire', { resultat, gardienne: e.par });
      }
      if (echues.length === liste.length) delete this.state.engagements[resultat];
      else if (echues.length) this.state.engagements[resultat] = liste.filter((e) => e.expire > now);
    }
    for (const [id, p] of Object.entries(this.state.pieges)) {
      if (p.expire > now) continue;
      // Exactly as for a real result: expired lease, or sealed verdict never revealed.
      if (p.engagement) {
        this.ledger.reputation(p.attribue_a, 'non_revele');
        this.registry.append('engagement_expire', { resultat: id, gardienne: p.attribue_a });
      } else this.ledger.reputation(p.attribue_a, 'bail_expire');
      delete this.state.pieges[id];
    }
    for (const hive of Object.values(this.state.hives)) hive.orientations = hive.orientations.filter((o) => o.expire > now);
    const limite = now - this.params.fenetre_requete_ms;
    for (const [k, ts] of Object.entries(this.state.nonces)) if (ts < limite) delete this.state.nonces[k];
  }

  private leasesOf(who: ContributorId): number {
    let n = 0;
    for (const c of Object.values(this.state.cells)) {
      if (c.bail?.par === who) n++;
      n += c.gardiennes.filter((g) => g.par === who).length;
    }
    // A sealed verdict no longer takes a bee: real result or trap, it is counted the same way.
    for (const p of Object.values(this.state.pieges)) if (p.attribue_a === who && !p.engagement) n++;
    return n;
  }

  private leaseEnd(rec: CellRecord): number {
    return this.now() + rec.cell.budget.duree_max_s * 1000 * this.params.facteur_bail;
  }

  private checkRequete(r: Requete, action: Requete['action']): void {
    if (r?.type !== 'osp.requete/0.1' || r.action !== action) throw new OspError(`Expected a ${action} request`);
    if (!isContributorId(r.contributeur) || !verifyObject(r, r.contributeur)) throw new OspError('Invalid request signature', 401);
    this.exigerMembre(r.contributeur);
    if (typeof r.ts !== 'number' || Math.abs(this.now() - r.ts) > this.params.fenetre_requete_ms) throw new OspError('Request expired: check your clock', 401);
    const key = `${r.contributeur}:${r.nonce}`;
    if (!r.nonce || this.state.nonces[key] !== undefined) throw new OspError('Replayed request', 409);
    if (r.castes !== undefined && (!Array.isArray(r.castes) || !r.castes.length || !r.castes.every((c) => CASTES.has(c)))) throw new OspError('castes: a list among eclaireuse, ouvriere, batisseuse, gardienne');
    this.state.nonces[key] = r.ts;
  }

  private validateSpec(spec: CellSpec): void {
    if (!spec || typeof spec.objectif !== 'string' || !spec.objectif.trim() || spec.objectif.length > 2000) {
      throw new OspError('Every cell needs a goal (2,000 characters maximum)');
    }
    if (typeof spec.capsule !== 'string' || spec.capsule.length > 100_000) throw new OspError('Invalid capsule (100,000 characters maximum)');
    if (typeof spec.atomique !== 'boolean') throw new OspError('The "atomique" field must be a boolean');
    try {
      validateCritere(spec.critere_fini);
    } catch (e) {
      throw new OspError(`Invalid done criterion for "${spec.objectif.slice(0, 60)}": ${(e as Error).message}`);
    }
    if (spec.depot !== undefined) {
      try {
        validateDepot(spec.depot);
      } catch (e) {
        throw new OspError(`Invalid repo capsule for "${spec.objectif.slice(0, 60)}": ${(e as Error).message}`);
      }
    }
  }

  private requirePorteurOuFondateur(hive: HiveRecord, auteur: ContributorId): void {
    if (auteur !== hive.ruche.porteur && auteur !== this.state.fondateur) {
      throw new OspError('Reserved for the hive owner or the founder', 403);
    }
  }

  private branchStats(hive: HiveRecord, rec: CellRecord): { succes: number; echecs: number } {
    const b = brancheOf(rec.cell.chemin);
    return (hive.branches[b] ??= { succes: 0, echecs: 0 });
  }

  private addContribution(hive: HiveRecord, id: ContributorId, g: number): void {
    const nouveau = hive.contributions[id] === undefined;
    hive.contributions[id] = (hive.contributions[id] ?? 0) + g;
    if (nouveau && Object.keys(hive.contributions).length <= 10) this.grant(id, 'founding_bee', hive.ruche.slug);
    if (!this.state.contributeurs.includes(id)) {
      this.state.contributeurs.push(id);
      if (this.state.contributeurs.length <= this.params.pionniers) this.grant(id, 'pioneer');
    }
  }

  /** Awards a trophy (§10.5), once and for all or once per hive, and writes it to the registry. */
  private grant(id: ContributorId, trophee: TropheeId, ruche?: string): void {
    const liste = (this.state.trophees[id] ??= []);
    const cible = PAR_RUCHE.has(trophee) ? ruche : undefined;
    if (liste.some((t) => t.id === trophee && t.ruche === cible)) return;
    liste.push({ id: trophee, date: new Date(this.now()).toISOString(), ...(cible ? { ruche: cible } : {}) });
    this.registry.append('trophee', { beneficiaire: id, trophee, ruche: cible ?? ruche });
  }

  private bump(id: ContributorId, cle: 'alveoles' | 'verifications'): number {
    const c = (this.state.compteurs[id] ??= { alveoles: 0, verifications: 0 });
    return ++c[cle];
  }

  /** Upgrades a state written by an earlier version. */
  private normalizeState(): void {
    this.state.trophees ??= {};
    this.state.compteurs ??= {};
    this.state.contributeurs ??= [];
    this.state.engagements ??= {};
    this.state.fiabilite ??= {};
    for (const rr of Object.values(this.state.results)) {
      rr.soumis_a ??= 0;
      rr.mutants ??= [];
    }
    for (const c of Object.values(this.state.cells)) {
      const ancien = c as CellRecord & { gardienne?: Bail; validee_par?: unknown };
      c.gardiennes ??= ancien.gardienne ? [ancien.gardienne] : [];
      c.verdicts ??= [];
      delete ancien.gardienne;
      if (ancien.validee_par !== undefined && !Array.isArray(ancien.validee_par)) c.validee_par = [ancien.validee_par as ContributorId];
    }
  }

  private addBoard(slug: string, entry: Omit<BoardEntry, 'date'>): void {
    (this.state.board[slug] ??= []).push({ ...entry, date: new Date(this.now()).toISOString() });
  }

  private progression(slug: string): { miel: number; total: number } {
    const cells = this.cellsOf(slug);
    return { miel: cells.filter((c) => c.state === 'miel').length, total: cells.length };
  }

  private cellsOf(slug: string): CellRecord[] {
    return Object.values(this.state.cells).filter((c) => c.cell.ruche === slug);
  }

  private hiveOrThrow(slug: string): HiveRecord {
    const h = this.state.hives[slug];
    if (!h) throw new OspError(`Unknown hive: ${slug}`, 404);
    return h;
  }

  private cellOrThrow(id: Hash | undefined): CellRecord {
    const c = id ? this.state.cells[id] : undefined;
    if (!c) throw new OspError('Unknown cell', 404);
    return c;
  }

  private save(): void {
    if (!this.options.dataDir) return;
    const file = join(this.options.dataDir, 'etat.json');
    writeFileSync(file + '.tmp', JSON.stringify(this.state), 'utf8');
    renameSync(file + '.tmp', file);
  }
}
