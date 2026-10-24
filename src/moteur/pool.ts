import { completer, decouvrir, ErreurFournisseur, type Fournisseur, type Message, type Modele } from './fournisseurs.js';

// The pool of the local engine (OSP v0.4 §2.6): for each request, the best model that fits (context,
// privacy) and still has quota. A refusal pauses that model and the pool moves to the next one; local
// models come last, as the fallback. Personal requests come first: while one runs, the swarm waits,
// and a share of each known daily quota is kept for personal use.

export type Usage = 'perso' | 'essaim';

export interface Besoin {
  /** Tokens of the request (prompt) and of the expected answer. */
  tokens: number;
  maxTokens: number;
  usage: Usage;
  /** Only models whose provider does not train on prompts (private hives, personal data). */
  confidentiel: boolean;
}

export interface OptionsPool {
  /** Share of each known daily quota kept for personal use (0.3 by default). */
  reservePerso?: number;
  /** Calls to paid models allowed per day, for the swarm (0 by default: a paid key does nothing until a budget is set). */
  payantsParJour?: number;
  maintenant?: () => number;
  log?: (ligne: string) => void;
}

interface Etat {
  jour: string;
  /** Requests today, per provider (the quota belongs to the key). */
  parFournisseur: Map<string, number>;
  payants: number;
}

export interface QualiteModele {
  modele: string;
  valides: number;
  rejetes: number;
}

export class Pool {
  private modelesConnus: Modele[] = [];
  private readonly pauses = new Map<string, number>();
  private readonly echecs = new Map<string, number>();
  private readonly hors = new Set<string>();
  private readonly qualite = new Map<string, { valides: number; rejetes: number }>();
  private etat: Etat = { jour: '', parFournisseur: new Map(), payants: 0 };
  private persoEnCours = 0;
  private dernierPerso = 0;
  private readonly now: () => number;

  constructor(
    readonly fournisseurs: Fournisseur[],
    private readonly o: OptionsPool = {},
  ) {
    this.now = o.maintenant ?? Date.now;
  }

  /** Finds every provider's models. A provider that does not answer is skipped (a local server turned off). */
  async decouvrir(): Promise<{ modeles: number; erreurs: Array<{ fournisseur: string; erreur: string }> }> {
    const erreurs: Array<{ fournisseur: string; erreur: string }> = [];
    const tous: Modele[] = [];
    for (const f of this.fournisseurs) {
      try {
        tous.push(...(await decouvrir(f)));
      } catch (e) {
        erreurs.push({ fournisseur: f.id, erreur: (e as Error).message.slice(0, 160) });
      }
    }
    this.modelesConnus = tous;
    return { modeles: tous.length, erreurs };
  }

  modeles(): Modele[] {
    return this.modelesConnus.filter((m) => !this.hors.has(m.id));
  }

  /** The leaderboard of the swarm (GET /v0/models): the measured quality of each model. */
  noterQualite(classement: QualiteModele[]): void {
    for (const q of classement) this.qualite.set(q.modele, { valides: q.valides, rejetes: q.rejetes });
  }

  private jour(): Etat {
    const j = new Date(this.now()).toISOString().slice(0, 10);
    if (this.etat.jour !== j) this.etat = { jour: j, parFournisseur: new Map(), payants: 0 };
    return this.etat;
  }

  /** Validated over judged, with a prior: an unmeasured model starts in the middle. */
  score(m: Modele): number {
    const q = this.qualite.get(m.id) ?? { valides: 0, rejetes: 0 };
    return (q.valides + 1) / (q.valides + q.rejetes + 2);
  }

  /** The models that fit the need right now, best first. */
  candidats(b: Besoin): Modele[] {
    const e = this.jour();
    const t = this.now();
    return this.modeles()
      .filter((m) => {
        if ((this.pauses.get(m.id) ?? 0) > t) return false;
        if (b.confidentiel && !m.confidentiel) return false;
        if (m.contexte < b.tokens + b.maxTokens) return false;
        const f = this.fournisseurs.find((x) => x.id === m.fournisseur)!;
        const utilises = e.parFournisseur.get(f.id) ?? 0;
        if (f.parJour !== undefined) {
          const plafond = b.usage === 'perso' ? f.parJour : Math.floor(f.parJour * (1 - (this.o.reservePerso ?? 0.3)));
          if (utilises >= plafond) return false;
        }
        if (!m.gratuit && b.usage === 'essaim' && e.payants >= (this.o.payantsParJour ?? 0)) return false;
        return true;
      })
      .sort((a, z) => {
        // Cloud models first (stronger), local models as the fallback; then measured quality, then context.
        const local = (m: Modele) => (this.fournisseurs.find((f) => f.id === m.fournisseur)?.local ? 1 : 0);
        return local(a) - local(z) || this.score(z) - this.score(a) || z.contexte - a.contexte;
      });
  }

  /** The largest request this pool can serve now, for the swarm (the chat door's limit does not apply). */
  tailleMax(confidentiel = false): number {
    const c = this.candidats({ tokens: 0, maxTokens: 0, usage: 'essaim', confidentiel });
    return c.length ? Math.max(...c.map((m) => m.contexte)) : 0;
  }

  private compter(m: Modele): void {
    const e = this.jour();
    e.parFournisseur.set(m.fournisseur, (e.parFournisseur.get(m.fournisseur) ?? 0) + 1);
    if (!m.gratuit) e.payants++;
  }

  /** A provider refused: pause the model (longer each time), or drop it for today. */
  noterRefus(m: Modele, err: unknown): void {
    const e = err instanceof ErreurFournisseur ? err : new ErreurFournisseur(String((err as Error)?.message ?? err), 0);
    if (e.definitif) {
      this.hors.add(m.id);
      this.o.log?.(`${m.id}: set aside for today (${e.message.slice(0, 80)})`);
      return;
    }
    const n = (this.echecs.get(m.id) ?? 0) + 1;
    this.echecs.set(m.id, n);
    const attente = e.attendreMs ?? Math.min(3_600_000, 15_000 * 2 ** (n - 1));
    this.pauses.set(m.id, this.now() + attente);
  }

  noterSucces(m: Modele): void {
    this.echecs.delete(m.id);
  }

  /** Counts a call made through the raw path (the personal endpoint's pass-through). */
  noterAppel(m: Modele): void {
    this.compter(m);
  }

  /** Asks the best model, and the next ones on refusal. */
  async completer(b: Besoin, messages: Message[], signal?: AbortSignal): Promise<{ modele: Modele; texte: string }> {
    const essayes = new Set<string>();
    for (;;) {
      const m = this.candidats(b).find((x) => !essayes.has(x.id));
      if (!m) throw new ErreurFournisseur('No model available right now: every quota is used or paused', 429);
      essayes.add(m.id);
      const f = this.fournisseurs.find((x) => x.id === m.fournisseur)!;
      this.compter(m);
      try {
        const texte = await completer(f, m.nom, messages, { maxTokens: b.maxTokens, ...(signal ? { signal } : {}) });
        this.noterSucces(m);
        return { modele: m, texte };
      } catch (e) {
        this.noterRefus(m, e);
      }
    }
  }

  // ---------------------------------------------------------------- you first

  /** Wraps a personal request: the swarm waits while it runs, and a moment after. */
  async pourMoi<T>(f: () => Promise<T>): Promise<T> {
    this.persoEnCours++;
    try {
      return await f();
    } finally {
      this.persoEnCours--;
      this.dernierPerso = this.now();
    }
  }

  /** May the swarm use the pool now? Not while a personal request runs, nor in the 10 s after one. */
  essaimPeutTravailler(): boolean {
    return this.persoEnCours === 0 && this.now() - this.dernierPerso > 10_000;
  }

  /** For `kickswarm engine`: what each provider used today. */
  bilan(): Array<{ fournisseur: string; utilises: number; parJour?: number; modeles: number }> {
    const e = this.jour();
    return this.fournisseurs.map((f) => ({ fournisseur: f.id, utilises: e.parFournisseur.get(f.id) ?? 0, ...(f.parJour !== undefined ? { parJour: f.parJour } : {}), modeles: this.modeles().filter((m) => m.fournisseur === f.id).length }));
  }
}
