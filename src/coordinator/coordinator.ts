import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { canonicalize, commitment, hashOf, sha256 } from '../protocol/canonical.js';
import { generateIdentity, isContributorId, signObject, verifyObject, type Identity } from '../protocol/identity.js';
import type {
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
  Livrable,
  Requete,
  Result,
  Secrets,
  TestCase,
  Verdict,
} from '../protocol/types.js';
import { adequation, validateCritere, validateLivrable, validateTests, verifierV0, type VerifOptions, type VerifReport } from '../verifier/v0.js';
import { COMMUN, Ledger, type Account } from './ledger.js';
import { transition } from './lifecycle.js';
import { DEFAULT_PARAMS, type Params } from './params.js';
import { Registry } from './registry.js';
import { graine, rngDepuis, tourA, verifierBalise, type Balise, type BaliseInfo, type SourceBalise } from './balise.js';
import { brancheOf, chooseCandidate, type Rng } from './scheduler.js';
import { PAR_RUCHE, type Trophee, type TropheeId } from './trophees.js';

/** Erreur de protocole, avec le code HTTP à renvoyer. */
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
  /** Gardiennes tirées pour le résultat en attente, qui ne se sont pas encore engagées (baux actifs). */
  gardiennes: Bail[];
  /** Gardiennes qui ont déjà validé le résultat en attente. */
  verdicts: ContributorId[];
  rejets: number;
  /** §5 : après trop de rejets, l'alvéole repart en découpage. */
  redecouper: boolean;
  /** Résultat ou découpage qui attend sa vérification. */
  en_attente?: Hash;
  resultat_valide?: Hash;
  validee_par?: ContributorId[];
  /** Score de mutation de ses tests contre une référence (OSP v0.2, §3.2), s'il a été mesuré. */
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
  /** Miel gagné dans cette ruche, par contributeur (pour le bonus du cœur). */
  contributions: Record<string, number>;
}

interface ResultRecord {
  resultat: Result;
  livrable: Livrable;
  rapport: VerifReport;
  statut: 'en_verification' | 'valide' | 'rejete';
}

interface DecompRecord {
  decomposition: Decomposition;
  statut: 'en_attente' | 'adoptee' | 'refusee';
  /** Score de mutation mesuré pour chaque enfant (null : pas de référence fournie). */
  force_tests: Array<number | null>;
}

interface Piege {
  resultat: Result;
  livrable: Livrable;
  alveole: Hash;
  attribue_a: ContributorId;
  expire: number;
  /** P1-3 : l'engagement de la gardienne, comme pour un vrai résultat. */
  engagement?: Hash;
}

/** P1-3 : une gardienne engagée sur un résultat, dont le verdict reste scellé. */
interface Engagement {
  par: ContributorId;
  engagement: Hash;
  /** Fin de la fenêtre de révélation (elle ne court que lorsque la révélation est ouverte). */
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

interface State {
  fondateur: ContributorId;
  lancement: number;
  hives: Record<string, HiveRecord>;
  cells: Record<string, CellRecord>;
  results: Record<string, ResultRecord>;
  decompositions: Record<string, DecompRecord>;
  pieges: Record<string, Piege>;
  /** P1-3 : verdicts scellés, par résultat. */
  engagements: Record<string, Engagement[]>;
  board: Record<string, BoardEntry[]>;
  accounts: Record<string, Account>;
  nonces: Record<string, number>;
  trophees: Record<string, Trophee[]>;
  compteurs: Record<string, { alveoles: number; verifications: number }>;
  /** Ordre d'arrivée des contributeurs, pour le trophée Pionnier. */
  contributeurs: string[];
}

/** Les commandes qui modifient l'état. Chacune est inscrite en entier au registre (OSP v0.2, §6.1). */
export type CommandeType =
  | 'proposeHive' | 'decide' | 'claim' | 'start' | 'release' | 'submitResult' | 'submitDecomposition' | 'engageVerdict' | 'submitVerdict';

/**
 * Le contenu d'une entrée `commande` : les objets signés reçus, plus tout ce qui n'est pas
 * déterministe (l'heure, les tirages, les signatures du coordinateur, les rapports du vérificateur)
 * et le hash de l'état obtenu. C'est assez pour rejouer toute l'histoire à l'identique.
 */
export interface CommandeDonnees {
  type: CommandeType;
  entree: Record<string, unknown>;
  at: number;
  alea: number[];
  signatures: string[];
  verifs: VerifReport[];
  /** Secrets révélés pendant la commande (tests cachés, références), par engagement. */
  secrets?: Record<string, unknown>;
  /** P1-3 : la balise d'aléa public dont découlent les tirages de cette commande. */
  balise?: Balise;
  etat: Hash;
}

/** La balise annoncée au lancement : son réseau, sa clé, et le décalage en tours. */
export type BaliseAnnoncee = BaliseInfo & { decalage: number };

interface ReplayStep {
  at: number;
  alea: number[];
  signatures: string[];
  verifs: VerifReport[];
  secrets: Record<string, unknown>;
}

/** Le rejeu ne reproduit pas l'histoire inscrite au registre. */
export class ReplayDivergence extends Error {}

export type Verifier = (critere: Cell['critere_fini'], livrable: Livrable, opts?: VerifOptions) => Promise<VerifReport>;

export interface CoordinatorOptions {
  fondateur: ContributorId;
  /** Dossier de persistance (état + registre). Sans dossier, tout reste en mémoire. */
  dataDir?: string;
  params?: Partial<Params>;
  rng?: Rng;
  now?: () => number;
  /** Vérificateur automatique, remplaçable pour les tests. */
  verifier?: Verifier;
  /** P1-3 : la balise d'aléa public (drand). Sans elle, le coordinateur tire lui-même ses aléas. */
  balise?: SourceBalise;
  /** Mode audit : on rejoue un registre existant, avec les identités publiques qu'il annonce. */
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
    piege?: ContributorId;
    auteur?: ContributorId;
    validee_par?: ContributorId[];
  }>;
  classement: Array<{ id: string; grammes: number; trophees: TropheeId[] } & Account>;
  journal: import('./registry.js').RegistryEntry[];
}

const SLUG_RE = /^[a-z0-9][a-z0-9-]{2,39}$/;
const DEFAULT_BUDGET = { tokens_max: 200_000, duree_max_s: 1800 };
const MAX_IMPASSES = 20;

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
  /** Pendant une commande : l'heure figée, et ce qu'il faut inscrire pour pouvoir la rejouer. */
  private clock: number | null = null;
  private recording: { alea: number[]; signatures: string[]; secrets: Record<string, unknown> } | null = null;
  private replayCtx: { alea: number[]; signatures: string[]; secrets: Record<string, unknown> } | null = null;
  /** Le coffre : tests cachés et références, par engagement. Privé, hors de l'état et du registre. */
  private coffre: Record<string, unknown> = {};
  private replayNext: ReplayStep | null = null;
  private dernierSceau = 0;
  private commandesSansSceau = 0;
  /** Pendant une demande tirée avec la balise : les tirages en découlent, et sont notés. */
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
      if (v === undefined) throw new ReplayDivergence('Tirage aléatoire absent du registre');
      return v;
    }
    const v = this.baseRng();
    this.recording?.alea.push(v);
    return v;
  };

  constructor(private readonly options: CoordinatorOptions) {
    if (!isContributorId(options.fondateur)) throw new Error('Identifiant du fondateur invalide');
    this.params = { ...DEFAULT_PARAMS, ...options.params };
    this.baseRng = options.rng ?? Math.random;
    this.baseNow = options.now ?? Date.now;
    this.verifier = options.verifier ?? verifierV0;
    if (options.replay && options.dataDir) throw new Error('Le mode audit travaille en mémoire, sans dossier de données');

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
      // Le coordinateur signe en SLH-DSA : une sécurité qui ne repose que sur la fonction de hachage.
      this.identite = generateIdentity('slh1');
      this.identitePieges = generateIdentity('slh1');
      if (keysFile) writeFileSync(keysFile, JSON.stringify({ coordinateur: this.identite, pieges: this.identitePieges }, null, 2), 'utf8');
    }

    const stateFile = dir ? join(dir, 'etat.json') : undefined;
    if (stateFile && existsSync(stateFile)) {
      this.state = JSON.parse(readFileSync(stateFile, 'utf8')) as State;
      if (this.state.fondateur !== options.fondateur) {
        throw new Error('Ce dossier de données appartient à un autre fondateur');
      }
    } else {
      // Une seule lecture de l'horloge pour le lancement : l'état et l'entrée du registre doivent concorder.
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
        board: {},
        accounts: {},
        nonces: {},
        trophees: {},
        compteurs: {},
        contributeurs: [],
      };
      const balise = this.baliseAnnoncee();
      this.registry.append('lancement', {
        fondateur: options.fondateur, coordinateur: this.identite.id, pieges: this.identitePieges.id, params: this.params, ...(balise ? { balise } : {}),
      });
      this.clock = null;
      if (!options.replay) this.sceller();
    }
    this.normalizeState();
    this.ledger = new Ledger(this.params, options.fondateur, this.state.lancement, this.registry, () => this.now());
    this.ledger.accounts = this.state.accounts;
    // L'état sur disque doit être exactement celui qu'annonce la dernière commande du registre.
    const derniere = [...this.registry.entries].reverse().find((e) => e.nature === 'commande');
    if (derniere && (derniere.donnees as CommandeDonnees).etat !== this.stateHash()) {
      throw new Error('État local incohérent avec le registre : lance « kickswarm audit » pour reconstruire et comprendre');
    }
    this.save();
  }

  /**
   * Scelle le registre (OSP v0.2, P0-5) : le coordinateur signe en SLH-DSA le hash de la dernière entrée.
   * Comme ce hash enchaîne toute l'histoire, un seul sceau authentifie tout ce qui le précède.
   */
  sceller(): void {
    if (this.options.replay) throw new Error('Un coordinateur en mode audit ne scelle pas : il importe les sceaux');
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

  /** Mode audit : reprend un sceau du registre original, après en avoir vérifié la signature. */
  importSceau(date: string, sceau: { type: string; coordinateur: string; seq: number; tete: string; sig?: string }): void {
    if (!this.options.replay) throw new Error('Import de sceau réservé au mode audit');
    const tete = this.registry.entries[this.registry.entries.length - 1];
    if (sceau.type !== 'osp.sceau/0.1' || sceau.coordinateur !== this.identite.id || !tete || sceau.seq !== tete.seq || sceau.tete !== tete.hash) {
      throw new ReplayDivergence(`Sceau incohérent avec le registre à l'entrée #${tete?.seq}`);
    }
    if (!verifyObject(sceau, this.identite.id)) throw new ReplayDivergence('Signature du sceau invalide');
    this.clock = Date.parse(date);
    try {
      this.registry.append('sceau', sceau);
    } finally {
      this.clock = null;
    }
  }

  /** Le dernier sceau du registre, s'il y en a un. */
  dernierSceauInscrit(): { seq: number; sceau: unknown } | undefined {
    for (let i = this.registry.entries.length - 1; i >= 0; i--) {
      const e = this.registry.entries[i]!;
      if (e.nature === 'sceau') return { seq: e.seq, sceau: e.donnees };
    }
    return undefined;
  }

  /** Empreinte de l'état complet : ce que les auditeurs comparent. */
  stateHash(): Hash {
    return sha256(canonicalize(this.state));
  }

  /** Pour la revérification d'un audit : le critère de fin d'une alvéole. */
  critereOf(cellId: Hash): Cell['critere_fini'] | undefined {
    return this.state.cells[cellId]?.cell.critere_fini;
  }

  /** Pour la revérification d'un audit : le livrable d'un résultat et le critère qu'il doit passer. */
  resultForReverify(resultId: Hash): { critere: Cell['critere_fini']; livrable: Livrable } | undefined {
    const rr = this.state.results[resultId];
    const rec = rr ? this.state.cells[rr.resultat.alveole] : undefined;
    return rr && rec ? { critere: rec.cell.critere_fini, livrable: rr.livrable } : undefined;
  }

  /**
   * Rejoue une commande inscrite au registre (mode audit). Le coordinateur reproduit alors
   * exactement les mêmes entrées : toute différence est une divergence.
   */
  async replayCommande(c: CommandeDonnees): Promise<void> {
    if (!this.options.replay) throw new Error('Rejeu réservé à un coordinateur créé en mode audit');
    this.replayNext = { at: c.at, alea: [...(c.alea ?? [])], signatures: [...(c.signatures ?? [])], verifs: c.verifs ?? [], secrets: c.secrets ?? {} };
    const e = c.entree as {
      ruche: Hive; racine: CellSpec; decision: Decision; requete: Requete; resultat: Result; livrable: Livrable; decomposition: Decomposition;
      engagement: EngagementVerdict; verdict: Verdict;
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
        default: throw new ReplayDivergence(`Commande inconnue : ${String(c.type)}`);
      }
    } finally {
      this.replayNext = null;
    }
  }

  /**
   * Exécute une commande comme une transaction : l'état et le registre reviennent en arrière si
   * elle échoue ; si elle réussit, elle est inscrite au registre avec tout ce qu'il faut pour la rejouer.
   */
  private run<T>(type: CommandeType, entree: Record<string, unknown>, verifs: VerifReport[], fn: () => T): T {
    const replay = this.replayNext;
    this.replayNext = null;
    if (this.options.replay && !replay) throw new Error('Coordinateur en mode audit : il ne fait que rejouer le registre');
    const at = replay ? replay.at : this.baseNow();
    this.clock = at;
    this.replayCtx = replay ? { alea: [...replay.alea], signatures: [...replay.signatures], secrets: replay.secrets } : null;
    this.recording = replay ? null : { alea: [], signatures: [], secrets: {} };
    const snapshot = structuredClone(this.state);
    this.registry.begin();
    try {
      const out = fn();
      // Tirés avec la balise, les aléas sont recalculés et non repris : on ne contrôle que les signatures.
      if (this.replayCtx && ((!this.tirageBalise && this.replayCtx.alea.length) || this.replayCtx.signatures.length)) {
        throw new ReplayDivergence('Le rejeu a consommé moins de tirages ou de signatures que l’original');
      }
      const alea = this.tirageBalise ? this.tirageBalise.tirages : replay ? replay.alea : this.recording!.alea;
      const signatures = replay ? replay.signatures : this.recording!.signatures;
      const secrets = replay ? replay.secrets : this.recording!.secrets;
      this.registry.append('commande', {
        type, entree, at, alea, signatures, verifs, ...(Object.keys(secrets).length ? { secrets } : {}),
        ...(this.tirageBalise ? { balise: this.tirageBalise.balise } : {}), etat: this.stateHash(),
      } satisfies CommandeDonnees);
      this.registry.commit();
      this.save();
      if (!replay) this.peutEtreSceller();
      return out;
    } catch (e) {
      this.state = snapshot;
      this.ledger.accounts = this.state.accounts;
      this.registry.rollback();
      throw e;
    } finally {
      this.clock = null;
      this.replayCtx = null;
      this.recording = null;
      this.tirageBalise = null;
    }
  }

  /** La balise annoncée au lancement, en direct comme au rejeu. */
  baliseAnnoncee(): BaliseAnnoncee | undefined {
    if (this.options.replay) return this.options.replay.balise;
    return this.options.balise ? { ...this.options.balise.info, decalage: this.params.balise_decalage } : undefined;
  }

  /**
   * Prendre du travail, avec un tirage que personne ne contrôle (P1-3) : la demande signée à
   * l'instant `ts` est tirée avec le tour drand tourA(ts) + décalage, qui n'existait pas encore
   * quand le contributeur a signé. Sans balise configurée, c'est un claim ordinaire.
   */
  async reclamer(r: Requete): Promise<Assignment | null> {
    const src = this.options.balise;
    if (!src) return this.claim(r);
    if (r?.type !== 'osp.requete/0.1' || r.action !== 'claim') throw new OspError('Requête claim attendue');
    if (!isContributorId(r.contributeur) || !verifyObject(r, r.contributeur)) throw new OspError('Signature de la requête invalide', 401);
    if (typeof r.ts !== 'number' || Math.abs(this.baseNow() - r.ts) > this.params.fenetre_balise_ms) {
      throw new OspError('Ton horloge est trop éloignée de celle du coordinateur pour un tirage équitable : synchronise-la', 401);
    }
    let b: Balise;
    try {
      b = await src.get(tourA(src.info, r.ts) + this.params.balise_decalage);
    } catch (e) {
      throw new OspError(`Balise d'aléa indisponible : ${(e as Error).message}`, 503);
    }
    return this.claimAvecBalise(r, b);
  }

  private claimAvecBalise(r: Requete, b: Balise): Assignment | null {
    const info = this.baliseAnnoncee();
    if (!info) throw new ReplayDivergence('Balise utilisée sans avoir été annoncée au lancement');
    if (b.round !== tourA(info, r.ts) + info.decalage) throw new ReplayDivergence(`Tour de balise ${b.round} contraire à la règle (attendu ${tourA(info, r.ts) + info.decalage})`);
    if (!verifierBalise(info, b)) throw new ReplayDivergence(`Balise du tour ${b.round} invalide`);
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

  /** Révèle un secret du coffre et l'inscrit dans la commande ; au rejeu, le reprend et vérifie l'engagement. */
  private reveal(hash: Hash): unknown {
    if (this.replayCtx) {
      const v = this.replayCtx.secrets[hash];
      if (v === undefined || commitment(v) !== hash) throw new ReplayDivergence('Secret révélé absent ou contraire à son engagement');
      return v;
    }
    const v = this.coffre[hash];
    if (v === undefined) throw new OspError('Secret absent du coffre de ce coordinateur', 500);
    this.recording!.secrets[hash] = v;
    return v;
  }

  /** Les tests cachés d'une alvéole, sortis du coffre, pour le vérificateur. */
  private cachesFor(rec: CellRecord): TestCase[] | undefined {
    const c = rec.cell.critere_fini;
    if (c.verificateur !== 'tests-js@1' || !c.tests_caches_hash) return undefined;
    const v = this.coffre[c.tests_caches_hash] as TestCase[] | undefined;
    if (!v) throw new OspError('Les tests cachés de cette alvéole ne sont pas dans le coffre de ce coordinateur', 503);
    return v;
  }

  /** Vérifie que chaque secret correspond à l'engagement publié dans le critère. */
  private checkSecrets(spec: CellSpec, secret: Secrets | undefined, label: string): void {
    const c = spec.critere_fini;
    if (c.verificateur !== 'tests-js@1') {
      if (secret?.tests_caches || secret?.reference) throw new OspError(`${label} : ce type de critère n'a pas de secrets`);
      return;
    }
    if (c.tests_caches_hash) {
      if (!secret?.tests_caches) throw new OspError(`${label} : les tests cachés annoncés n'ont pas été envoyés`);
      try { validateTests(secret.tests_caches, 'hidden tests'); } catch (e) { throw new OspError(`${label} : ${(e as Error).message}`); }
      if (commitment(secret.tests_caches) !== c.tests_caches_hash) throw new OspError(`${label} : les tests cachés ne correspondent pas à leur engagement`);
    } else if (secret?.tests_caches) throw new OspError(`${label} : envoie l'engagement tests_caches_hash avec les tests cachés`);
    if (c.reference_hash) {
      if (!secret?.reference) throw new OspError(`${label} : la référence annoncée n'a pas été envoyée`);
      try { validateLivrable(secret.reference); } catch (e) { throw new OspError(`${label} : référence invalide : ${(e as Error).message}`); }
      if (commitment(secret.reference) !== c.reference_hash) throw new OspError(`${label} : la référence ne correspond pas à son engagement`);
    } else if (secret?.reference) throw new OspError(`${label} : envoie l'engagement reference_hash avec la référence`);
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

  /** Signe au nom du coordinateur ; au rejeu, reprend la signature inscrite et la vérifie. */
  private sign<T extends object>(obj: T, who: Identity): T & { sig: string } {
    if (this.replayCtx) {
      const sig = this.replayCtx.signatures.shift();
      if (sig === undefined) throw new ReplayDivergence('Signature attendue absente du registre');
      const signed = { ...obj, sig } as T & { sig: string };
      if (!verifyObject(signed, who.id)) throw new ReplayDivergence('Signature du coordinateur invalide au rejeu');
      return signed;
    }
    const signed = signObject(obj, who);
    this.recording?.signatures.push(signed.sig);
    return signed;
  }

  get fondateur(): ContributorId {
    return this.state.fondateur;
  }

  // ---------------------------------------------------------------- ruches

  proposeHive(ruche: Hive, racine: CellSpec, secrets?: Secrets): HiveView {
    if (!this.replayNext) this.checkSecrets(racine, secrets, 'Cœur de la ruche');
    const out = this.run('proposeHive', { ruche, racine }, [], () => this.doProposeHive(ruche, racine));
    if (!this.options.replay) this.storeSecrets([secrets]);
    return out;
  }

  private doProposeHive(ruche: Hive, racine: CellSpec): HiveView {
    if (ruche?.type !== 'osp.hive/0.1') throw new OspError('Objet ruche attendu (osp.hive/0.1)');
    if (!isContributorId(ruche.porteur)) throw new OspError('Porteur invalide');
    if (!verifyObject(ruche, ruche.porteur)) throw new OspError('Signature de la ruche invalide', 401);
    if (!SLUG_RE.test(ruche.slug)) throw new OspError('Slug invalide : 3 à 40 caractères, minuscules, chiffres et tirets');
    if (this.state.hives[ruche.slug]) throw new OspError(`La ruche « ${ruche.slug} » existe déjà`, 409);
    if (!ruche.nom || !ruche.objectif) throw new OspError('Une ruche a besoin d’un nom et d’un objectif');
    if (ruche.classe_verif_defaut !== 'V0') throw new OspError('Le MVP ne gère que la classe de vérification V0');
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
    this.registry.append('ruche_proposee', { slug: ruche.slug, id: hive.id, porteur: ruche.porteur, nom: ruche.nom });
    hive.racine = this.emitCell(ruche.slug, racine, null, '0', 0).id;
    return this.hiveView(ruche.slug);
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

  /** Instantané complet d'une ruche pour la vue en direct : alvéoles, abeilles au travail, classement, journal. */
  liveView(slug: string): LiveView {
    const hive = this.hiveOrThrow(slug);
    const now = this.now();
    const cells = this.cellsOf(slug).sort((a, b) => cheminCompare(a.cell.chemin, b.cell.chemin));
    const ids = new Set<string>(cells.map((c) => c.id));
    const actif = (b?: Bail) => (b && b.expire > now ? { par: b.par, caste: b.caste } : undefined);
    const pieges = Object.values(this.state.pieges).filter((p) => ids.has(p.alveole) && p.expire > now);

    const classement = Object.entries(hive.contributions)
      .map(([id, g]) => ({
        id,
        grammes: Math.round(g * 1000) / 1000,
        trophees: [...new Set(this.trophiesOf(id).map((t) => t.id))],
        ...this.ledger.peek(id as ContributorId),
      }))
      .sort((a, b) => b.grammes - a.grammes)
      .slice(0, 20);

    const journal = this.registry.entries
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
        gardiennes: [...c.gardiennes.filter((g) => g.expire > now).map((g) => g.par), ...this.engagesSur(c.en_attente).map((e) => e.par)],
        piege: pieges.find((p) => p.alveole === c.id)?.attribue_a,
        auteur: c.resultat_valide ? this.state.results[c.resultat_valide]?.resultat.auteur : undefined,
        validee_par: c.validee_par,
      })),
      classement,
      journal,
    };
  }

  board(slug: string): BoardEntry[] {
    this.hiveOrThrow(slug);
    return this.state.board[slug] ?? [];
  }

  account(id: ContributorId | typeof COMMUN): Account & { id: string; trophees: Trophee[] } {
    return { id, ...this.ledger.peek(id), trophees: this.trophiesOf(id) };
  }

  trophiesOf(id: string): Trophee[] {
    return this.state.trophees[id] ?? [];
  }

  livrableValide(cellId: Hash): Livrable | undefined {
    const rec = this.state.cells[cellId];
    return rec?.resultat_valide ? this.state.results[rec.resultat_valide]?.livrable : undefined;
  }

  // ---------------------------------------------------------------- gouvernance

  decide(d: Decision): { decision: Hash } {
    return this.run('decide', { decision: d }, [], () => this.doDecide(d));
  }

  private doDecide(d: Decision): { decision: Hash } {
    if (d?.type !== 'osp.decision/0.1') throw new OspError('Objet décision attendu (osp.decision/0.1)');
    if (!isContributorId(d.auteur) || !verifyObject(d, d.auteur)) throw new OspError('Signature de la décision invalide', 401);
    if (!d.motif?.trim()) throw new OspError('Toute décision doit être motivée (principe 5)');
    const id = hashOf(d);
    const estFondateur = d.auteur === this.state.fondateur;

    switch (d.nature) {
      case 'approbation_ruche':
      case 'refus_ruche': {
        if (!estFondateur) throw new OspError('Pendant la phase pilote (§14.2), seul le fondateur admet les ruches', 403);
        const hive = this.hiveOrThrow(d.cible);
        if (hive.statut !== 'proposee') throw new OspError(`La ruche est déjà ${hive.statut}`, 409);
        hive.statut = d.nature === 'approbation_ruche' ? 'active' : 'refusee';
        if (hive.statut === 'active') this.grant(hive.ruche.porteur, 'hive_owner', hive.ruche.slug);
        break;
      }
      case 'pause':
      case 'reprise': {
        const hive = this.hiveOrThrow(d.cible);
        this.requirePorteurOuFondateur(hive, d.auteur);
        const [de, vers]: [HiveStatus, HiveStatus] = d.nature === 'pause' ? ['active', 'en_pause'] : ['en_pause', 'active'];
        if (hive.statut !== de) throw new OspError(`Impossible : la ruche est ${hive.statut}`, 409);
        hive.statut = vers;
        break;
      }
      case 'orientation': {
        const [slug = '', branche = ''] = d.cible.split(':');
        const hive = this.hiveOrThrow(slug);
        this.requirePorteurOuFondateur(hive, d.auteur);
        const m = d.params?.multiplicateur ?? this.params.orientation_max;
        if (!(m >= 1 && m <= this.params.orientation_max)) {
          throw new OspError(`Le multiplicateur d'orientation doit être entre 1 et ${this.params.orientation_max}`);
        }
        const existe = this.cellsOf(slug).some((c) => brancheOf(c.cell.chemin) === branche);
        if (!existe) throw new OspError(`Branche inconnue : ${branche}`, 404);
        hive.orientations.push({ branche, multiplicateur: m, expire: this.now() + this.params.orientation_duree_ms, auteur: d.auteur, decision: id });
        break;
      }
      case 'approbation_decoupage':
      case 'refus_decoupage': {
        const dr = this.state.decompositions[d.cible];
        if (!dr) throw new OspError('Découpage inconnu', 404);
        const rec = this.cellOrThrow(dr.decomposition.alveole);
        const hive = this.hiveOrThrow(rec.cell.ruche);
        if (d.auteur !== hive.ruche.porteur) throw new OspError('Seul le porteur approuve les découpages des premiers niveaux (§6.3)', 403);
        if (dr.statut !== 'en_attente' || rec.en_attente !== d.cible) throw new OspError('Ce découpage n’attend pas de décision', 409);
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
      default:
        throw new OspError(`Nature de décision inconnue : ${String((d as Decision).nature)}`);
    }
    this.registry.append('decision', { id, ...d });
    return { decision: id };
  }

  // ---------------------------------------------------------------- travail

  claim(r: Requete): Assignment | null {
    if (this.options.balise && !this.replayNext) throw new OspError('Ce coordinateur tire au sort avec la balise publique : passe par reclamer()', 400);
    return this.run('claim', { requete: r }, [], () => this.doClaim(r));
  }

  private doClaim(r: Requete): Assignment | null {
    this.checkRequete(r, 'claim');
    this.expire();
    const who = r.contributeur;
    if (this.leasesOf(who) >= this.params.abeilles_max) {
      throw new OspError(`Maximum ${this.params.abeilles_max} abeilles simultanées par contributeur`, 429);
    }
    if (r.ruche !== undefined) this.hiveOrThrow(r.ruche);
    const hives = Object.values(this.state.hives).filter((h) => h.statut === 'active' && (r.ruche === undefined || h.ruche.slug === r.ruche));
    const slugs = new Set(hives.map((h) => h.ruche.slug));
    const cells = Object.values(this.state.cells).filter((c) => slugs.has(c.cell.ruche));

    // Verrou 4 (§9.4) : une part des tâches de vérification sont des pièges.
    if (cells.length && this.rng() < this.params.taux_pieges) {
      const piege = this.makeTrap(who, cells);
      if (piege) return piege;
    }

    // Verrous 1 et 2 (§9.2) : k gardiennes distinctes, tirées au sort, jamais l'auteur.
    const k = Math.max(1, this.params.gardiennes_v0);
    const aVerifier = cells.filter((c) => {
      if (c.state !== 'en_verification' || !c.en_attente) return false;
      const rr = this.state.results[c.en_attente];
      if (!rr || rr.resultat.auteur === who) return false;
      const engages = this.engagesSur(c.en_attente);
      if (c.gardiennes.some((g) => g.par === who) || c.verdicts.includes(who) || engages.some((e) => e.par === who)) return false;
      return c.gardiennes.length + engages.length + c.verdicts.length < k;
    });
    const libres = cells.filter((c) => c.state === 'libre');

    if (aVerifier.length && (libres.length === 0 || this.rng() < 0.5)) {
      const rec = aVerifier[Math.floor(this.rng() * aVerifier.length)]!;
      const bail: Bail = { par: who, caste: 'gardienne', expire: this.leaseEnd(rec) };
      rec.gardiennes.push(bail);
      const rr = this.state.results[rec.en_attente!]!;
      return { ...this.assignment(rec, 'gardienne', bail.expire), a_verifier: { id: rec.en_attente!, resultat: rr.resultat, livrable: rr.livrable } };
    }
    if (!libres.length) return null;

    // On tire d'abord une ruche, puis une branche par Thompson (§12).
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
    if (rec.bail?.par !== r.contributeur) throw new OspError('Tu ne détiens pas le bail de cette alvéole', 403);
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
    const rapport = replay ? replay.verifs[0] : await this.verifyResult(res, livrable);
    if (!rapport) throw new ReplayDivergence('Rapport de vérification absent du registre');
    return this.run('submitResult', { resultat: res, livrable }, [rapport], () => this.doSubmitResult(res, livrable, rapport));
  }

  /** Contrôles sans effet, puis vérification automatique, hors de la transaction. */
  private async verifyResult(res: Result, livrable: Livrable): Promise<VerifReport> {
    const rec = this.checkResult(res, livrable);
    if (this.occupees.has(rec.id)) throw new OspError('Une vérification est déjà en cours pour cette alvéole', 409);
    this.occupees.add(rec.id);
    try {
      return await this.verifier(rec.cell.critere_fini, livrable, { caches: this.cachesFor(rec) });
    } finally {
      this.occupees.delete(rec.id);
    }
  }

  private checkResult(res: Result, livrable: Livrable): CellRecord {
    if (res?.type !== 'osp.result/0.1') throw new OspError('Objet résultat attendu (osp.result/0.1)');
    if (!isContributorId(res.auteur) || !verifyObject(res, res.auteur)) throw new OspError('Signature du résultat invalide', 401);
    if (this.state.results[hashOf(res)]) throw new OspError('Résultat déjà soumis', 409);
    const rec = this.cellOrThrow(res.alveole);
    if (rec.bail?.par !== res.auteur) throw new OspError('Tu ne détiens pas le bail de cette alvéole', 403);
    if (rec.bail.caste !== res.caste) throw new OspError(`Ta caste pour cette alvéole est « ${rec.bail.caste} »`, 409);
    if (rec.state !== 'reservee' && rec.state !== 'en_cours') throw new OspError(`L'alvéole est ${rec.state}`, 409);
    try {
      validateLivrable(livrable);
    } catch (e) {
      throw new OspError((e as Error).message);
    }
    if (hashOf(livrable) !== res.livrable) throw new OspError('Le hash du livrable ne correspond pas au résultat signé');
    return rec;
  }

  private doSubmitResult(res: Result, livrable: Livrable, rapport: VerifReport): { statut: 'rejete' | 'en_verification' | 'miel'; resultat: Hash; rapport: VerifReport } {
    // L'état a pu changer pendant la vérification : on recontrôle, dans la transaction.
    const rec = this.checkResult(res, livrable);
    if (rec.state === 'reservee') transition(rec, 'en_cours');
    const id = hashOf(res);
    this.state.results[id] = { resultat: res, livrable, rapport, statut: 'en_verification' };
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
   * Hors de la transaction : les secrets correspondent-ils à leurs engagements, et les tests de chaque
   * enfant qui fournit une référence sont-ils assez forts (score de mutation, OSP v0.2 §3.2) ?
   */
  private async checkDecomposition(d: Decomposition, secrets: Array<Secrets | undefined>): Promise<VerifReport[]> {
    this.decompositionBasics(d);
    const reports: VerifReport[] = [];
    for (const [i, child] of d.enfants.entries()) {
      const label = `Enfant ${i + 1} (« ${child.objectif.slice(0, 50)} »)`;
      this.checkSecrets(child, secrets[i], label);
      const c = child.critere_fini;
      if (c.verificateur !== 'tests-js@1') continue;
      if (!c.reference_hash) {
        if (this.params.reference_obligatoire) throw new OspError(`${label} : une implémentation de référence est exigée pour mesurer la force des tests`);
        continue;
      }
      const r = await adequation(c, secrets[i]?.tests_caches ?? [], secrets[i]!.reference!, { scoreMin: this.params.score_mutation_min });
      if (!r.ok) throw new OspError(`${label} : ${r.motif}`);
      reports.push(r);
    }
    return reports;
  }

  /** Les contrôles du découpage qui ne demandent aucun calcul lourd. */
  private decompositionBasics(d: Decomposition): CellRecord {
    if (d?.type !== 'osp.decomposition/0.1') throw new OspError('Objet découpage attendu (osp.decomposition/0.1)');
    if (!isContributorId(d.auteur) || !verifyObject(d, d.auteur)) throw new OspError('Signature du découpage invalide', 401);
    if (this.state.decompositions[hashOf(d)]) throw new OspError('Découpage déjà soumis', 409);
    const rec = this.cellOrThrow(d.alveole);
    if (rec.bail?.par !== d.auteur || rec.bail.caste !== 'eclaireuse') throw new OspError('Tu n’es pas l’éclaireuse de cette alvéole', 403);
    if (rec.state !== 'reservee' && rec.state !== 'en_cours') throw new OspError(`L'alvéole est ${rec.state}`, 409);
    const n = Array.isArray(d.enfants) ? d.enfants.length : 0;
    if (n < this.params.enfants_min || n > this.params.enfants_max) {
      throw new OspError(`Un découpage compte entre ${this.params.enfants_min} et ${this.params.enfants_max} enfants`);
    }
    if (rec.profondeur + 1 > this.params.profondeur_max) throw new OspError('Profondeur maximale atteinte (§6.4)');
    d.enfants.forEach((e) => this.validateSpec(e));
    return rec;
  }

  private doSubmitDecomposition(d: Decomposition, verifs: VerifReport[]): { statut: 'en_attente_porteur' | 'adopte'; decoupage: Hash; enfants: Hash[] } {
    // L'état a pu changer pendant la mesure des tests : on recontrôle, dans la transaction.
    const rec = this.decompositionBasics(d);
    const id = hashOf(d);
    const n = d.enfants.length;
    // Un score de mutation par enfant qui annonce une référence, dans l'ordre.
    const avecRef = d.enfants.filter((e) => e.critere_fini.verificateur === 'tests-js@1' && e.critere_fini.reference_hash).length;
    if (verifs.length !== avecRef || verifs.some((r) => !r.ok || !r.mutation)) throw new OspError('Mesure de la force des tests manquante ou insuffisante');
    let k = 0;
    const force_tests = d.enfants.map((e) => (e.critere_fini.verificateur === 'tests-js@1' && e.critere_fini.reference_hash ? verifs[k++]!.mutation!.score : null));
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
   * Première moitié d'un verdict (OSP v0.2, P1-3) : la gardienne publie le hash de son verdict,
   * qui reste scellé. Les verdicts ne se révèlent que lorsque toutes les gardiennes du résultat
   * se sont engagées : personne ne peut copier une autre ni s'aligner sur elle.
   */
  engagerVerdict(e: EngagementVerdict): { statut: 'engage'; revelation: boolean } {
    return this.run('engageVerdict', { engagement: e }, [], () => this.doEngagerVerdict(e));
  }

  private doEngagerVerdict(e: EngagementVerdict): { statut: 'engage'; revelation: boolean } {
    if (e?.type !== 'osp.engagement/0.1') throw new OspError('Objet engagement attendu (osp.engagement/0.1)');
    if (!isContributorId(e.gardienne) || !verifyObject(e, e.gardienne)) throw new OspError('Signature de l’engagement invalide', 401);
    if (typeof e.engagement !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(e.engagement)) throw new OspError('Engagement invalide : sha256 attendu');
    this.expire();

    const piege = this.state.pieges[e.resultat];
    if (piege) {
      if (piege.attribue_a !== e.gardienne) throw new OspError('Ce résultat ne t’a pas été attribué', 403);
      if (piege.engagement) throw new OspError('Tu t’es déjà engagée sur ce résultat', 409);
      piege.engagement = e.engagement;
      piege.expire = this.leaseEnd(this.cellOrThrow(piege.alveole));
      this.registry.append('engagement', { resultat: e.resultat, gardienne: e.gardienne, engagement: e.engagement });
      return { statut: 'engage', revelation: true };
    }

    const rr = this.state.results[e.resultat];
    if (!rr) throw new OspError('Résultat inconnu', 404);
    const rec = this.cellOrThrow(rr.resultat.alveole);
    if (rec.state !== 'en_verification' || rec.en_attente !== e.resultat) throw new OspError('Ce résultat n’attend plus de vérification', 409);
    if (!rec.gardiennes.some((g) => g.par === e.gardienne)) throw new OspError('Tu n’es pas une gardienne tirée pour ce résultat', 403);
    if (rr.resultat.auteur === e.gardienne) throw new OspError('On ne vérifie pas son propre travail (§7.3)', 403);
    rec.gardiennes = rec.gardiennes.filter((g) => g.par !== e.gardienne);
    const liste = (this.state.engagements[e.resultat] ??= []);
    liste.push({ par: e.gardienne, engagement: e.engagement, expire: this.leaseEnd(rec) });
    this.registry.append('engagement', { resultat: e.resultat, gardienne: e.gardienne, engagement: e.engagement });
    const ouverte = this.revelationOuverte(rec, e.resultat);
    // La fenêtre de révélation part du moment où elle s'ouvre, pour chacune.
    if (ouverte) for (const x of liste) x.expire = this.leaseEnd(rec);
    return { statut: 'engage', revelation: ouverte };
  }

  /** Toutes les places de gardienne du résultat sont engagées (ou déjà tranchées) : on peut révéler. */
  private revelationOuverte(rec: CellRecord, resultat: Hash): boolean {
    const k = Math.max(1, this.params.gardiennes_v0);
    return rec.gardiennes.length === 0 && this.engagesSur(resultat).length + rec.verdicts.length >= k;
  }

  private engagesSur(resultat: Hash | undefined): Engagement[] {
    return resultat ? (this.state.engagements[resultat] ?? []) : [];
  }

  /** Seconde moitié d'un verdict : la révélation, qui doit correspondre à l'engagement. */
  async submitVerdict(v: Verdict): Promise<{ statut: string; piege?: boolean; correct?: boolean | null; renverse?: boolean; confirmations?: number }> {
    const replay = this.replayNext;
    const rejeu = replay ? (replay.verifs[0] ?? null) : await this.rejeuFor(v);
    return this.run('submitVerdict', { verdict: v }, rejeu ? [rejeu] : [], () => this.doSubmitVerdict(v, rejeu));
  }

  /** Le rejet d'un résultat accepté par le vérificateur automatique déclenche un rejeu (§9.5, version MVP). */
  private async rejeuFor(v: Verdict): Promise<VerifReport | null> {
    if (v?.type !== 'osp.verdict/0.1' || v.decision !== 'rejete' || this.state.pieges[v.resultat]) return null;
    const rr = this.state.results[v.resultat];
    const rec = rr ? this.state.cells[rr.resultat.alveole] : undefined;
    if (!rr || !rec || rec.en_attente !== v.resultat) return null;
    if (!this.engagesSur(v.resultat).some((e) => e.par === v.gardienne) || !this.revelationOuverte(rec, v.resultat)) return null;
    return this.verifier(rec.cell.critere_fini, rr.livrable, { caches: this.cachesFor(rec) });
  }

  private doSubmitVerdict(v: Verdict, rejeu: VerifReport | null): { statut: string; piege?: boolean; correct?: boolean | null; renverse?: boolean; confirmations?: number } {
    if (v?.type !== 'osp.verdict/0.1') throw new OspError('Objet verdict attendu (osp.verdict/0.1)');
    if (!isContributorId(v.gardienne) || !verifyObject(v, v.gardienne)) throw new OspError('Signature du verdict invalide', 401);
    if (!['valide', 'rejete', 'abstention'].includes(v.decision)) throw new OspError('Décision invalide');
    if (typeof v.sel !== 'string' || !/^[0-9a-f]{64,}$/.test(v.sel)) throw new OspError('Sel du verdict absent ou trop court (32 octets en hexadécimal)');
    this.expire();
    const h = hashOf(v);

    const piege = this.state.pieges[v.resultat];
    if (piege) {
      if (piege.attribue_a !== v.gardienne) throw new OspError('Ce résultat ne t’a pas été attribué', 403);
      if (!piege.engagement) throw new OspError('Engage-toi d’abord sur ton verdict (osp.engagement/0.1)', 409);
      if (piege.engagement !== h) throw new OspError('Ce verdict ne correspond pas à ton engagement', 400);
      delete this.state.pieges[v.resultat];
      const ruche = this.state.cells[piege.alveole]?.cell.ruche;
      let correct: boolean | null = null;
      if (v.decision === 'rejete') {
        correct = true;
        this.ledger.award(v.gardienne, this.params.bonus_piege, 'piège déjoué', ruche);
        this.ledger.reputation(v.gardienne, 'confirme');
        this.registry.append('piege_dejoue', { gardienne: v.gardienne, alveole: piege.alveole });
        this.grant(v.gardienne, 'trap_hunter', ruche);
      } else if (v.decision === 'valide') {
        correct = false;
        this.ledger.reputation(v.gardienne, 'piege_valide');
        this.registry.append('piege_valide', { gardienne: v.gardienne, alveole: piege.alveole });
      }
      return { statut: 'piege', piege: true, correct };
    }

    const rr = this.state.results[v.resultat];
    if (!rr) throw new OspError('Résultat inconnu', 404);
    const rec = this.cellOrThrow(rr.resultat.alveole);
    if (rr.resultat.auteur === v.gardienne) throw new OspError('On ne vérifie pas son propre travail (§7.3)', 403);
    const liste = this.engagesSur(v.resultat);
    const eng = liste.find((e) => e.par === v.gardienne);
    if (!eng) {
      throw new OspError(
        rec.gardiennes.some((g) => g.par === v.gardienne) ? 'Engage-toi d’abord sur ton verdict (osp.engagement/0.1)' : 'Aucun engagement de ta part sur ce résultat',
        409,
      );
    }
    if (eng.engagement !== h) throw new OspError('Ce verdict ne correspond pas à ton engagement', 400);
    const enCours = rec.state === 'en_verification' && rec.en_attente === v.resultat;
    if (enCours && !this.revelationOuverte(rec, v.resultat)) {
      throw new OspError('Révélation pas encore ouverte : d’autres gardiennes doivent encore s’engager', 425);
    }
    const reste = liste.filter((e) => e !== eng);
    if (reste.length) this.state.engagements[v.resultat] = reste;
    else delete this.state.engagements[v.resultat];
    this.registry.append('verdict', { resultat: v.resultat, gardienne: v.gardienne, decision: v.decision, motif: v.motif, engagement: h });

    if (!enCours) {
      // Révélation tardive : le résultat a été tranché pendant que ce verdict était scellé.
      // On la juge quand même : se taire coûte plus cher que d'avoir eu tort.
      if (v.decision === 'abstention') return { statut: rr.statut };
      const juste = (v.decision === 'rejete') === (rr.statut === 'rejete');
      this.ledger.reputation(v.gardienne, juste ? 'confirme' : 'renverse');
      return { statut: rr.statut, renverse: !juste };
    }

    if (v.decision === 'valide') {
      rec.verdicts.push(v.gardienne);
      if (rec.verdicts.length >= Math.max(1, this.params.gardiennes_v0)) {
        this.validate(rec, v.resultat, rec.verdicts.slice());
        return { statut: 'miel', confirmations: rec.validee_par?.length };
      }
      return { statut: 'en_verification', confirmations: rec.verdicts.length };
    }
    if (v.decision === 'abstention') return { statut: 'en_verification' };

    // Rejet d'un résultat que le vérificateur automatique avait accepté : on rejoue (§9.5, version MVP).
    if (!rejeu) throw new OspError('Rejeu manquant pour ce rejet', 500);
    if (!rejeu.ok) {
      this.ledger.award(v.gardienne, this.params.bonus_faux_reel, 'faux résultat démasqué', rec.cell.ruche);
      this.ledger.reputation(v.gardienne, 'confirme');
      // Celles qui avaient validé un résultat faux sont renversées.
      for (const g of rec.verdicts) this.ledger.reputation(g, 'renverse');
      this.rejectResult(rec, v.resultat, `Rejeté par une gardienne : ${v.motif}`);
      return { statut: 'rejete' };
    }
    this.ledger.reputation(v.gardienne, 'renverse');
    this.registry.append('verdict_renverse', { resultat: v.resultat, gardienne: v.gardienne, rejeu: rejeu.motif });
    return { statut: 'en_verification', renverse: true };
  }

  // ---------------------------------------------------------------- interne

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

  private validate(rec: CellRecord, resultId: Hash, gardiennes: ContributorId[] = []): void {
    const rr = this.state.results[resultId]!;
    rr.statut = 'valide';
    transition(rec, 'miel');
    rec.resultat_valide = resultId;
    rec.validee_par = gardiennes;
    delete rec.en_attente;
    rec.gardiennes = [];
    rec.verdicts = [];
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
      if (this.bump(gardienne, 'verifications') >= 10) this.grant(gardienne, 'guardian');
    }
    this.addBoard(slug, { nature: 'decouverte', chemin: rec.cell.chemin, texte: `Validée : ${rec.cell.objectif}`, auteur, source: resultId });
    this.registry.append('alveole_miel', { alveole: rec.id, chemin: rec.cell.chemin, resultat: resultId, auteur, gardiennes, grammes: g });
    // Les secrets de l'alvéole deviennent publics : chacun peut désormais revérifier sa validation.
    const crit = rec.cell.critere_fini;
    if (crit.verificateur === 'tests-js@1' && (crit.tests_caches_hash || crit.reference_hash)) {
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
      // Les soutiens (§10.1) arrivent après le MVP : le multiplicateur vaut 1 pour l'instant.
      this.ledger.award(hive.ruche.porteur, total * this.params.part_porteur, 'porteur : ruche complétée', slug);
    }
    this.registry.append('ruche_terminee', { slug, miel_total: Math.round(total * 1000) / 1000 });
  }

  private makeTrap(who: ContributorId, cells: CellRecord[]): Assignment | null {
    const bases = cells.filter((c) => c.cell.atomique && c.enfants.length === 0 && c.state !== 'bloquee' && c.cell.critere_fini.verificateur === 'tests-js@1');
    if (!bases.length) return null;
    const rec = bases[Math.floor(this.rng() * bases.length)]!;
    const critere = rec.cell.critere_fini;
    if (critere.verificateur !== 'tests-js@1') return null;
    const fns = [...new Set([...critere.tests.map((t) => t.fn), ...(critere.proprietes ?? []).map((p) => p.fn)])];
    const livrable: Livrable = {
      fichiers: { [critere.module ?? 'solution.mjs']: fns.map((f) => `export function ${f}() { return '__piege__'; }`).join('\n') + '\n' },
    };
    const resultat = this.sign<Result>(
      {
        type: 'osp.result/0.1',
        alveole: rec.id,
        auteur: this.identitePieges.id,
        caste: 'ouvriere',
        livrable: hashOf(livrable),
        impasses: [],
        agent: { famille: 'inconnue' },
        cout: { tokens: Math.floor(this.rng() * 1e9) },
      },
      this.identitePieges,
    );
    const id = hashOf(resultat);
    const expire = this.leaseEnd(rec);
    this.state.pieges[id] = { resultat, livrable, alveole: rec.id, attribue_a: who, expire };
    return { ...this.assignment(rec, 'gardienne', expire), a_verifier: { id, resultat, livrable } };
  }

  private assignment(rec: CellRecord, caste: Caste, bail_expire: number): Assignment {
    const a: Assignment = { caste, alveole_id: rec.id, alveole: rec.cell, capsule: rec.capsule_texte, profondeur: rec.profondeur, bail_expire };
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
    }
    // P1-3 : un verdict scellé qu'on ne révèle pas à temps coûte plus cher que le pire verdict révélé.
    // La fenêtre ne court que si la révélation est ouverte (ou si le résultat a été tranché entre-temps).
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
      if (p.engagement) {
        this.ledger.reputation(p.attribue_a, 'non_revele');
        this.registry.append('engagement_expire', { resultat: id, gardienne: p.attribue_a });
      }
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
    // Un verdict scellé n'occupe plus d'abeille : vrai résultat ou piège, c'est compté pareil.
    for (const p of Object.values(this.state.pieges)) if (p.attribue_a === who && !p.engagement) n++;
    return n;
  }

  private leaseEnd(rec: CellRecord): number {
    return this.now() + rec.cell.budget.duree_max_s * 1000 * this.params.facteur_bail;
  }

  private checkRequete(r: Requete, action: Requete['action']): void {
    if (r?.type !== 'osp.requete/0.1' || r.action !== action) throw new OspError(`Requête ${action} attendue`);
    if (!isContributorId(r.contributeur) || !verifyObject(r, r.contributeur)) throw new OspError('Signature de la requête invalide', 401);
    if (typeof r.ts !== 'number' || Math.abs(this.now() - r.ts) > this.params.fenetre_requete_ms) throw new OspError('Requête expirée : vérifie l’horloge', 401);
    const key = `${r.contributeur}:${r.nonce}`;
    if (!r.nonce || this.state.nonces[key] !== undefined) throw new OspError('Requête rejouée', 409);
    this.state.nonces[key] = r.ts;
  }

  private validateSpec(spec: CellSpec): void {
    if (!spec || typeof spec.objectif !== 'string' || !spec.objectif.trim() || spec.objectif.length > 2000) {
      throw new OspError('Chaque alvéole a besoin d’un objectif (2 000 caractères maximum)');
    }
    if (typeof spec.capsule !== 'string' || spec.capsule.length > 100_000) throw new OspError('Capsule invalide (100 000 caractères maximum)');
    if (typeof spec.atomique !== 'boolean') throw new OspError('Le champ « atomique » doit être un booléen');
    try {
      validateCritere(spec.critere_fini);
    } catch (e) {
      throw new OspError(`Critère de fin invalide pour « ${spec.objectif.slice(0, 60)} » : ${(e as Error).message}`);
    }
  }

  private requirePorteurOuFondateur(hive: HiveRecord, auteur: ContributorId): void {
    if (auteur !== hive.ruche.porteur && auteur !== this.state.fondateur) {
      throw new OspError('Réservé au porteur de la ruche ou au fondateur', 403);
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

  /** Attribue un trophée (§10.5), une fois pour toutes ou une fois par ruche, et l'inscrit au registre. */
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

  /** Remet à niveau un état écrit par une version précédente. */
  private normalizeState(): void {
    this.state.trophees ??= {};
    this.state.compteurs ??= {};
    this.state.contributeurs ??= [];
    this.state.engagements ??= {};
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
    if (!h) throw new OspError(`Ruche inconnue : ${slug}`, 404);
    return h;
  }

  private cellOrThrow(id: Hash | undefined): CellRecord {
    const c = id ? this.state.cells[id] : undefined;
    if (!c) throw new OspError('Alvéole inconnue', 404);
    return c;
  }

  private save(): void {
    if (!this.options.dataDir) return;
    const file = join(this.options.dataDir, 'etat.json');
    writeFileSync(file + '.tmp', JSON.stringify(this.state), 'utf8');
    renameSync(file + '.tmp', file);
  }
}
