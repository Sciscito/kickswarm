import { genererIdentiteWeb, identiteValide, signataireWeb, type IdentiteWeb } from '../protocol/identite-web.js';
import * as objets from '../protocol/objets.js';
import type { Assignment, Hash, Livrable, Verdict } from '../protocol/types.js';
import { fiche, promptChat, tientDansUnChat, type FicheTache } from '../taches/fiche.js';
import { lireReponse } from '../taches/lecteur.js';
import { validateLivrable, verifier, type Executeurs, type VerifReport } from '../verifier/coeur.js';

// The chat door and the guard door (OSP v0.4 §2.3, §2.4), without the page: everything a browser bee
// does, so that it can be tested in Node as well. The identity and the work in progress are kept in a
// storage the page provides (localStorage); the keys never leave it.

export interface Stockage {
  lire(cle: string): string | null;
  ecrire(cle: string, valeur: string): void;
  effacer(cle: string): void;
}

export interface TacheChat {
  assignment: Assignment;
  fiche: FicheTache;
  prompt: string;
}

export interface Verification {
  livrable: Livrable;
  rapport: VerifReport;
  /** If a check failed: a message to paste back into the same chat conversation. */
  correctif?: string;
}

export interface Garde {
  chemin: string;
  objectif: string;
  ok: boolean;
  motif: string;
  /** What the reveal said, if it happened at once: a trap caught, a verdict recorded… */
  issue?: string;
}

interface Scelle {
  verdict: Verdict;
  chemin: string;
}

const CLES = { identite: 'kickswarm.identite', tache: 'kickswarm.tache', scelles: 'kickswarm.scelles' };
/** The castes each door takes: the chat door writes, the guard door verifies. */
const ECRIRE = ['ouvriere', 'batisseuse'] as const;

export class ErreurPorte extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

export function stockageMemoire(): Stockage {
  const m = new Map<string, string>();
  return { lire: (k) => m.get(k) ?? null, ecrire: (k, v) => void m.set(k, v), effacer: (k) => void m.delete(k) };
}

/** What to paste back into the chat when a check fails: the failure, and the same answer format. */
export function promptCorrection(r: VerifReport, f: FicheTache): string {
  const echecs = r.tests.filter((t) => !t.ok && !t.cache).slice(0, 5);
  const lignes = echecs.length
    ? echecs.map((t) => `- ${t.nom}: ${t.erreur ?? `got ${JSON.stringify(t.obtenu)}, expected ${JSON.stringify(t.attendu)}`}`)
    : [`- ${r.motif}`];
  return [
    'Your code was checked and it is not right yet:',
    ...lignes,
    '',
    `Fix it and answer again with the complete file \`${f.livrable.module}\`, in the same format: one code block, the path right after the backticks.`,
  ].join('\n');
}

export class Porte {
  constructor(
    readonly url: string,
    private readonly stockage: Stockage,
    private readonly executeurs: Executeurs,
  ) {}

  // ---------------------------------------------------------------- identity

  /** The contributor's identity, created on first use and kept in the browser. */
  identite(): IdentiteWeb {
    const brut = this.stockage.lire(CLES.identite);
    if (brut) {
      try {
        const i = JSON.parse(brut) as unknown;
        if (identiteValide(i)) return i;
      } catch {
        // a damaged identity is replaced below
      }
    }
    const i = genererIdentiteWeb();
    this.stockage.ecrire(CLES.identite, JSON.stringify(i));
    return i;
  }

  /** A backup file of the identity: whoever has it can sign as this contributor. */
  exporterIdentite(): string {
    return JSON.stringify({ type: 'kickswarm.identite-web/1', ...this.identite() });
  }

  importerIdentite(texte: string): IdentiteWeb {
    const { type: _t, ...i } = JSON.parse(texte) as IdentiteWeb & { type?: string };
    if (!identiteValide(i)) throw new ErreurPorte('This file is not a valid Kickswarm identity');
    this.stockage.ecrire(CLES.identite, JSON.stringify(i));
    return i;
  }

  private signataire(): objets.Signataire {
    return signataireWeb(this.identite());
  }

  private async appel<T>(method: 'GET' | 'POST', chemin: string, corps?: unknown): Promise<T> {
    const res = await fetch(new URL(chemin, this.url), {
      method,
      headers: corps === undefined ? {} : { 'content-type': 'application/json' },
      body: corps === undefined ? undefined : JSON.stringify(corps),
    });
    const data = (await res.json().catch(() => ({}))) as { erreur?: string };
    if (!res.ok) throw new ErreurPorte(data.erreur ?? `Coordinator error ${res.status}`, res.status);
    return data as T;
  }

  ruches(): Promise<Array<{ slug: string; nom: string; statut: string; progression: { miel: number; total: number } }>> {
    return this.appel('GET', '/v0/hives');
  }

  compte(): Promise<{ id: string; miel: number; miel_gagne: number; reputation: number; trophees?: Array<{ id: string }> }> {
    return this.appel('GET', `/v0/contributors/${encodeURIComponent(this.identite().id)}`);
  }

  // ---------------------------------------------------------------- the chat door

  /** The task in progress, if the page was reloaded. */
  enCours(): TacheChat | null {
    const brut = this.stockage.lire(CLES.tache);
    if (!brut) return null;
    const t = JSON.parse(brut) as TacheChat;
    return t.assignment.bail_expire > Date.now() ? t : (this.stockage.effacer(CLES.tache), null);
  }

  /**
   * Takes a writing task that fits in one chat message. A task the chat door cannot serve (too big,
   * or reading files from a repository the browser does not have) goes straight back to the swarm.
   */
  async prendre(ruche?: string): Promise<TacheChat | null> {
    const deja = this.enCours();
    if (deja) return deja;
    for (let essai = 0; essai < 5; essai++) {
      const r = await this.appel<{ assignation: Assignment | null }>('POST', '/v0/work/claim', objets.requete(this.signataire(), 'claim', { ...(ruche ? { ruche } : {}), castes: [...ECRIRE] }));
      const a = r.assignation;
      if (!a) return null;
      const f = fiche(a);
      if (!tientDansUnChat(f) || a.alveole.depot?.lecture.length) {
        await this.appel('POST', '/v0/work/release', objets.requete(this.signataire(), 'release', { alveole: a.alveole_id }));
        continue;
      }
      await this.appel('POST', '/v0/work/start', objets.requete(this.signataire(), 'start', { alveole: a.alveole_id }));
      const t: TacheChat = { assignment: a, fiche: f, prompt: promptChat(f) };
      this.stockage.ecrire(CLES.tache, JSON.stringify(t));
      return t;
    }
    return null;
  }

  /** Reads the chat's answer and checks it here, with the same engines as the coordinator. Nothing is sent. */
  async verifier(reponse: string): Promise<Verification> {
    const t = this.enCours();
    if (!t) throw new ErreurPorte('No task in progress: take one first');
    const lu = lireReponse(reponse, { module: t.fiche.livrable.module, ...(t.fiche.livrable.portee ? { portee: t.fiche.livrable.portee } : {}) });
    const livrable: Livrable = { fichiers: lu.fichiers, ...(lu.supprimes ? { supprimes: lu.supprimes } : {}) };
    try {
      validateLivrable(livrable);
    } catch (e) {
      throw new ErreurPorte((e as Error).message);
    }
    const rapport = await verifier(t.assignment.alveole.critere_fini, livrable, { sansCaches: true }, this.executeurs);
    return { livrable, rapport, ...(rapport.ok ? {} : { correctif: promptCorrection(rapport, t.fiche) }) };
  }

  /** Signs and hands in the deliverable. `ia` is the AI used, as the contributor declares it. */
  async rendre(livrable: Livrable, ia: string): Promise<{ statut: string; motif: string }> {
    const t = this.enCours();
    if (!t) throw new ErreurPorte('No task in progress');
    const resultat = objets.resultat(this.signataire(), t.assignment.alveole_id, t.assignment.caste as 'ouvriere' | 'batisseuse', livrable, {
      agent: { famille: 'chat', ...(ia ? { modele: ia.slice(0, 60) } : {}) },
    });
    const r = await this.appel<{ statut: string; rapport: { motif: string } }>('POST', '/v0/work/submit', { resultat, livrable });
    this.stockage.effacer(CLES.tache);
    return { statut: r.statut, motif: r.rapport.motif };
  }

  /** Gives the task back to the swarm, with no penalty. */
  async liberer(): Promise<void> {
    const t = this.enCours();
    this.stockage.effacer(CLES.tache);
    if (t) await this.appel('POST', '/v0/work/release', objets.requete(this.signataire(), 'release', { alveole: t.assignment.alveole_id }));
  }

  // ---------------------------------------------------------------- the guard door

  private scelles(): Scelle[] {
    try {
      return JSON.parse(this.stockage.lire(CLES.scelles) ?? '[]') as Scelle[];
    } catch {
      return [];
    }
  }

  private garderScelles(s: Scelle[]): void {
    this.stockage.ecrire(CLES.scelles, JSON.stringify(s));
  }

  /**
   * Takes one verification, replays it here, and commits to its verdict (sealed: only its hash is
   * sent). The verdict is kept in the browser before the commitment goes out, so it can always be revealed.
   */
  async garder(ruche?: string): Promise<Garde | null> {
    const r = await this.appel<{ assignation: Assignment | null }>('POST', '/v0/work/claim', objets.requete(this.signataire(), 'claim', { ...(ruche ? { ruche } : {}), castes: ['gardienne'] }));
    const a = r.assignation;
    if (!a?.a_verifier) return null;
    const rejeu = await verifier(a.alveole.critere_fini, a.a_verifier.livrable, { sansCaches: true }, this.executeurs);
    const s = this.signataire();
    const v = objets.verdict(s, a.a_verifier.id, rejeu.ok ? 'valide' : 'rejete', rejeu.motif);
    const scelle: Scelle = { verdict: v, chemin: a.alveole.chemin };
    this.garderScelles([...this.scelles(), scelle]);
    const c = await this.appel<{ revelation: boolean }>('POST', '/v0/work/commit', objets.engagement(s, v));
    const garde: Garde = { chemin: a.alveole.chemin, objectif: a.alveole.objectif, ok: rejeu.ok, motif: rejeu.motif };
    if (c.revelation) {
      const issues = await this.reveler();
      const mienne = issues.find((x) => x.resultat === v.resultat);
      if (mienne) garde.issue = mienne.issue;
    }
    return garde;
  }

  /** Reveals the sealed verdicts whose reveal is open (the others wait: 425). */
  async reveler(): Promise<Array<{ resultat: Hash; chemin: string; issue: string }>> {
    const restants: Scelle[] = [];
    const issues: Array<{ resultat: Hash; chemin: string; issue: string }> = [];
    for (const s of this.scelles()) {
      try {
        const r = await this.appel<{ statut: string; piege?: boolean; correct?: boolean | null; renverse?: boolean }>('POST', '/v0/work/verdict', s.verdict);
        const issue = r.piege ? (r.correct ? 'trap caught' : 'trap missed') : r.renverse ? 'verdict overturned' : `verdict recorded (${r.statut})`;
        issues.push({ resultat: s.verdict.resultat, chemin: s.chemin, issue });
      } catch (e) {
        // Not open yet: kept for later. Anything else (expired, already settled) is dropped.
        if ((e as ErreurPorte).status === 425) restants.push(s);
      }
    }
    this.garderScelles(restants);
    return issues;
  }
}
