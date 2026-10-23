import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { hashOf, sha256 } from '../protocol/canonical.js';
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
  Hash,
  Hive,
  HiveStatus,
  Livrable,
  Requete,
  Result,
  Verdict,
} from '../protocol/types.js';
import { validateCritere, validateLivrable, verifierV0, type VerifReport } from '../verifier/v0.js';
import { COMMUN, Ledger, type Account } from './ledger.js';
import { transition } from './lifecycle.js';
import { DEFAULT_PARAMS, type Params } from './params.js';
import { Registry } from './registry.js';
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
  /** Gardiennes tirées pour le résultat en attente (baux actifs). */
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
}

interface Piege {
  resultat: Result;
  livrable: Livrable;
  alveole: Hash;
  attribue_a: ContributorId;
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
  board: Record<string, BoardEntry[]>;
  accounts: Record<string, Account>;
  nonces: Record<string, number>;
  trophees: Record<string, Trophee[]>;
  compteurs: Record<string, { alveoles: number; verifications: number }>;
  /** Ordre d'arrivée des contributeurs, pour le trophée Pionnier. */
  contributeurs: string[];
}

export interface CoordinatorOptions {
  fondateur: ContributorId;
  /** Dossier de persistance (état + registre). Sans dossier, tout reste en mémoire. */
  dataDir?: string;
  params?: Partial<Params>;
  rng?: Rng;
  now?: () => number;
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
  private readonly state: State;
  private readonly rng: Rng;
  private readonly now: () => number;
  private readonly occupees = new Set<Hash>();

  constructor(private readonly options: CoordinatorOptions) {
    if (!isContributorId(options.fondateur)) throw new Error('Identifiant du fondateur invalide');
    this.params = { ...DEFAULT_PARAMS, ...options.params };
    this.rng = options.rng ?? Math.random;
    this.now = options.now ?? Date.now;

    const dir = options.dataDir;
    if (dir) mkdirSync(dir, { recursive: true });
    this.registry = new Registry(dir ? join(dir, 'registre.jsonl') : undefined, this.now);

    const keysFile = dir ? join(dir, 'cles.json') : undefined;
    if (keysFile && existsSync(keysFile)) {
      const keys = JSON.parse(readFileSync(keysFile, 'utf8')) as { coordinateur: Identity; pieges: Identity };
      this.identite = keys.coordinateur;
      this.identitePieges = keys.pieges;
    } else {
      this.identite = generateIdentity();
      this.identitePieges = generateIdentity();
      if (keysFile) writeFileSync(keysFile, JSON.stringify({ coordinateur: this.identite, pieges: this.identitePieges }, null, 2), 'utf8');
    }

    const stateFile = dir ? join(dir, 'etat.json') : undefined;
    if (stateFile && existsSync(stateFile)) {
      this.state = JSON.parse(readFileSync(stateFile, 'utf8')) as State;
      if (this.state.fondateur !== options.fondateur) {
        throw new Error('Ce dossier de données appartient à un autre fondateur');
      }
    } else {
      this.state = {
        fondateur: options.fondateur,
        lancement: this.now(),
        hives: {},
        cells: {},
        results: {},
        decompositions: {},
        pieges: {},
        board: {},
        accounts: {},
        nonces: {},
        trophees: {},
        compteurs: {},
        contributeurs: [],
      };
      this.registry.append('lancement', { fondateur: options.fondateur, coordinateur: this.identite.id, params: this.params });
    }
    this.normalizeState();
    this.ledger = new Ledger(this.params, options.fondateur, this.state.lancement, this.registry, this.now);
    this.ledger.accounts = this.state.accounts;
    this.save();
  }

  get fondateur(): ContributorId {
    return this.state.fondateur;
  }

  // ---------------------------------------------------------------- ruches

  proposeHive(ruche: Hive, racine: CellSpec): HiveView {
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
    this.save();
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
        ...this.ledger.get(id as ContributorId),
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
      commun: this.ledger.get(COMMUN).parts,
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
        gardiennes: c.gardiennes.filter((g) => g.expire > now).map((g) => g.par),
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
    return { id, ...this.ledger.get(id), trophees: this.trophiesOf(id) };
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
    this.save();
    return { decision: id };
  }

  // ---------------------------------------------------------------- travail

  claim(r: Requete): Assignment | null {
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
      if (piege) {
        this.save();
        return piege;
      }
    }

    // Verrous 1 et 2 (§9.2) : k gardiennes distinctes, tirées au sort, jamais l'auteur.
    const k = Math.max(1, this.params.gardiennes_v0);
    const aVerifier = cells.filter((c) => {
      if (c.state !== 'en_verification' || !c.en_attente) return false;
      const rr = this.state.results[c.en_attente];
      if (!rr || rr.resultat.auteur === who) return false;
      if (c.gardiennes.some((g) => g.par === who) || c.verdicts.includes(who)) return false;
      return c.gardiennes.length + c.verdicts.length < k;
    });
    const libres = cells.filter((c) => c.state === 'libre');

    if (aVerifier.length && (libres.length === 0 || this.rng() < 0.5)) {
      const rec = aVerifier[Math.floor(this.rng() * aVerifier.length)]!;
      const bail: Bail = { par: who, caste: 'gardienne', expire: this.leaseEnd(rec) };
      rec.gardiennes.push(bail);
      const rr = this.state.results[rec.en_attente!]!;
      this.save();
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
    this.save();
    return this.assignment(rec, caste, rec.bail.expire);
  }

  start(r: Requete): { etat: CellState } {
    this.checkRequete(r, 'start');
    const rec = this.cellOrThrow(r.alveole);
    if (rec.bail?.par !== r.contributeur) throw new OspError('Tu ne détiens pas le bail de cette alvéole', 403);
    if (rec.state === 'reservee') {
      transition(rec, 'en_cours');
      this.save();
    }
    return { etat: rec.state };
  }

  release(r: Requete): { rappelee: boolean } {
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
    this.save();
    return { rappelee };
  }

  async submitResult(res: Result, livrable: Livrable): Promise<{ statut: 'rejete' | 'en_verification' | 'miel'; resultat: Hash; rapport: VerifReport }> {
    if (res?.type !== 'osp.result/0.1') throw new OspError('Objet résultat attendu (osp.result/0.1)');
    if (!isContributorId(res.auteur) || !verifyObject(res, res.auteur)) throw new OspError('Signature du résultat invalide', 401);
    const id = hashOf(res);
    if (this.state.results[id]) throw new OspError('Résultat déjà soumis', 409);
    const rec = this.cellOrThrow(res.alveole);
    if (rec.bail?.par !== res.auteur) throw new OspError('Tu ne détiens pas le bail de cette alvéole', 403);
    if (rec.bail.caste !== res.caste) throw new OspError(`Ta caste pour cette alvéole est « ${rec.bail.caste} »`, 409);
    if (rec.state === 'reservee') transition(rec, 'en_cours');
    if (rec.state !== 'en_cours') throw new OspError(`L'alvéole est ${rec.state}`, 409);
    if (this.occupees.has(rec.id)) throw new OspError('Une vérification est déjà en cours pour cette alvéole', 409);
    try {
      validateLivrable(livrable);
    } catch (e) {
      throw new OspError((e as Error).message);
    }
    if (hashOf(livrable) !== res.livrable) throw new OspError('Le hash du livrable ne correspond pas au résultat signé');

    this.occupees.add(rec.id);
    let rapport: VerifReport;
    try {
      rapport = await verifierV0(rec.cell.critere_fini, livrable);
    } finally {
      this.occupees.delete(rec.id);
    }
    if (rec.bail?.par !== res.auteur || rec.state !== 'en_cours') throw new OspError('Le bail a expiré pendant la vérification', 409);

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
      this.save();
      return { statut: 'rejete', resultat: id, rapport };
    }
    transition(rec, 'en_verification');
    rec.en_attente = id;
    if (this.params.gardiennes_v0 <= 0) {
      this.validate(rec, id);
      this.save();
      return { statut: 'miel', resultat: id, rapport };
    }
    this.save();
    return { statut: 'en_verification', resultat: id, rapport };
  }

  submitDecomposition(d: Decomposition): { statut: 'en_attente_porteur' | 'adopte'; decoupage: Hash; enfants: Hash[] } {
    if (d?.type !== 'osp.decomposition/0.1') throw new OspError('Objet découpage attendu (osp.decomposition/0.1)');
    if (!isContributorId(d.auteur) || !verifyObject(d, d.auteur)) throw new OspError('Signature du découpage invalide', 401);
    const id = hashOf(d);
    if (this.state.decompositions[id]) throw new OspError('Découpage déjà soumis', 409);
    const rec = this.cellOrThrow(d.alveole);
    if (rec.bail?.par !== d.auteur || rec.bail.caste !== 'eclaireuse') throw new OspError('Tu n’es pas l’éclaireuse de cette alvéole', 403);
    if (rec.state === 'reservee') transition(rec, 'en_cours');
    if (rec.state !== 'en_cours') throw new OspError(`L'alvéole est ${rec.state}`, 409);
    const n = Array.isArray(d.enfants) ? d.enfants.length : 0;
    if (n < this.params.enfants_min || n > this.params.enfants_max) {
      throw new OspError(`Un découpage compte entre ${this.params.enfants_min} et ${this.params.enfants_max} enfants`);
    }
    if (rec.profondeur + 1 > this.params.profondeur_max) throw new OspError('Profondeur maximale atteinte (§6.4)');
    d.enfants.forEach((e) => this.validateSpec(e));

    this.state.decompositions[id] = { decomposition: d, statut: 'en_attente' };
    delete rec.bail;
    this.registry.append('decoupage_propose', { id, alveole: rec.id, chemin: rec.cell.chemin, auteur: d.auteur, enfants: n });

    if (rec.profondeur <= this.params.niveau_approbation_porteur) {
      transition(rec, 'en_verification');
      rec.en_attente = id;
      this.save();
      return { statut: 'en_attente_porteur', decoupage: id, enfants: [] };
    }
    this.applyDecomposition(rec, id);
    this.save();
    return { statut: 'adopte', decoupage: id, enfants: rec.enfants };
  }

  async submitVerdict(v: Verdict): Promise<{ statut: string; piege?: boolean; correct?: boolean | null; renverse?: boolean; confirmations?: number }> {
    if (v?.type !== 'osp.verdict/0.1') throw new OspError('Objet verdict attendu (osp.verdict/0.1)');
    if (!isContributorId(v.gardienne) || !verifyObject(v, v.gardienne)) throw new OspError('Signature du verdict invalide', 401);
    if (!['valide', 'rejete', 'abstention'].includes(v.decision)) throw new OspError('Décision invalide');

    const piege = this.state.pieges[v.resultat];
    if (piege) {
      if (piege.attribue_a !== v.gardienne) throw new OspError('Ce résultat ne t’a pas été attribué', 403);
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
      this.save();
      return { statut: 'piege', piege: true, correct };
    }

    const rr = this.state.results[v.resultat];
    if (!rr) throw new OspError('Résultat inconnu', 404);
    const rec = this.cellOrThrow(rr.resultat.alveole);
    if (rec.state !== 'en_verification' || rec.en_attente !== v.resultat) throw new OspError('Ce résultat n’attend plus de vérification', 409);
    if (!rec.gardiennes.some((g) => g.par === v.gardienne)) throw new OspError('Tu n’es pas une gardienne tirée pour ce résultat', 403);
    if (rr.resultat.auteur === v.gardienne) throw new OspError('On ne vérifie pas son propre travail (§7.3)', 403);
    this.registry.append('verdict', { resultat: v.resultat, gardienne: v.gardienne, decision: v.decision, motif: v.motif });
    rec.gardiennes = rec.gardiennes.filter((g) => g.par !== v.gardienne);

    if (v.decision === 'valide') {
      rec.verdicts.push(v.gardienne);
      if (rec.verdicts.length >= Math.max(1, this.params.gardiennes_v0)) {
        this.validate(rec, v.resultat, rec.verdicts.slice());
        this.save();
        return { statut: 'miel', confirmations: rec.validee_par?.length };
      }
      this.save();
      return { statut: 'en_verification', confirmations: rec.verdicts.length };
    }
    if (v.decision === 'abstention') {
      this.save();
      return { statut: 'en_verification' };
    }

    // Rejet d'un résultat que le vérificateur automatique avait accepté : on rejoue (§9.5, version MVP).
    const rejeu = await verifierV0(rec.cell.critere_fini, rr.livrable);
    if (rec.state !== 'en_verification' || rec.en_attente !== v.resultat) throw new OspError('Ce résultat n’attend plus de vérification', 409);
    if (!rejeu.ok) {
      this.ledger.award(v.gardienne, this.params.bonus_faux_reel, 'faux résultat démasqué', rec.cell.ruche);
      this.ledger.reputation(v.gardienne, 'confirme');
      // Celles qui avaient validé un résultat faux sont renversées.
      for (const g of rec.verdicts) this.ledger.reputation(g, 'renverse');
      this.rejectResult(rec, v.resultat, `Rejeté par une gardienne : ${v.motif}`);
      this.save();
      return { statut: 'rejete' };
    }
    this.ledger.reputation(v.gardienne, 'renverse');
    this.registry.append('verdict_renverse', { resultat: v.resultat, gardienne: v.gardienne, rejeu: rejeu.motif });
    this.save();
    return { statut: 'en_verification', renverse: true };
  }

  // ---------------------------------------------------------------- interne

  private emitCell(ruche: string, spec: CellSpec, parent: CellRecord | null, chemin: string, profondeur: number): CellRecord {
    const cell = signObject<Cell>(
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
    rec.enfants = dr.decomposition.enfants.map(
      (spec, i) => this.emitCell(rec.cell.ruche, spec, rec, rec.cell.chemin === '0' ? `${i + 1}` : `${rec.cell.chemin}.${i + 1}`, rec.profondeur + 1).id,
    );
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
    const bases = cells.filter((c) => c.cell.atomique && c.enfants.length === 0 && c.state !== 'bloquee');
    if (!bases.length) return null;
    const rec = bases[Math.floor(this.rng() * bases.length)]!;
    const critere = rec.cell.critere_fini;
    const fns = [...new Set(critere.tests.map((t) => t.fn))];
    const livrable: Livrable = {
      fichiers: { [critere.module ?? 'solution.mjs']: fns.map((f) => `export function ${f}() { return '__piege__'; }`).join('\n') + '\n' },
    };
    const resultat = signObject<Result>(
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
      if (rec.bail && rec.bail.expire <= now && !this.occupees.has(rec.id)) {
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
    for (const [id, p] of Object.entries(this.state.pieges)) if (p.expire <= now) delete this.state.pieges[id];
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
    for (const p of Object.values(this.state.pieges)) if (p.attribue_a === who) n++;
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
