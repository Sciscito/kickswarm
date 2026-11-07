import type { Executeurs } from '../verifier/coeur.js';
import { verifier } from '../verifier/coeur.js';
import { hashPrompt } from '../protocol/carte.js';
import { makeDelegation, signataire } from '../protocol/builders.js';
import { generateIdentity, verifyObject, type Identity } from '../protocol/identity.js';
import * as objets from '../protocol/objets.js';
import type { Assignment, Delegation, Hash, Livrable, SealedCard } from '../protocol/types.js';
import { fiche } from '../taches/fiche.js';
import { lireReponse } from '../taches/lecteur.js';

// OSP v0.5 §2 (H3): the runner. It works for a main identity with a runner key, takes only sealed
// cards, runs one executor once per attempt with the sealed prompt as its whole instruction (no
// conversation), checks the deliverable here with the coordinator's own engines, and hands it in with
// the card's prompt hash. A failure gives the cell back (counting toward a stronger tier).
// Three steps, so a workflow can split them across jobs with different secrets (§2.4):
//   tirer (runner key) -> executer (executor credential only) -> rendre (runner key).

/** What a runner keeps: its own identity and the delegation its main identity signed. */
export interface CleRunner {
  type: 'kickswarm.runner-key/0.5';
  url: string;
  hive: string;
  main: string;
  identite: Identity;
  delegation: Delegation;
}

/** A drawn task: the assignment and its sealed card, both checked. */
export interface CarteTiree {
  assignment: Assignment;
  carte: SealedCard;
}

/** What an executor gives back. `agent` names the model or tool that wrote it. */
export interface Execution {
  livrable: Livrable;
  agent: string;
}

/** An executor: one sealed card in, a deliverable out (or a thrown error). */
export type Executeur = (t: CarteTiree) => Promise<Execution>;

async function appel<T>(url: string, method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const r = await fetch(new URL(path, url), { method, ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) });
  const j = (await r.json().catch(() => ({}))) as T & { error?: string; erreur?: string };
  if (!r.ok) throw new Error(j.erreur ?? j.error ?? `HTTP ${r.status} on ${path}`);
  return j;
}

/** Make a runner key for one hive: a fresh identity, a delegation signed by the main identity, sent to the coordinator. */
export async function creerCleRunner(url: string, main: Identity, hive: string, o: { parJour?: number; jours?: number } = {}): Promise<CleRunner> {
  const identite = generateIdentity();
  const delegation = makeDelegation(main, identite.id, hive, o);
  await appel(url, 'POST', '/v0/runners', delegation);
  return { type: 'kickswarm.runner-key/0.5', url, hive, main: main.id, identite, delegation };
}

/**
 * Draw a task as a runner: the coordinator picks it (a runner never names a cell), seals the card for
 * this executor and signs it. The card's signature and prompt hash are checked before anything runs.
 */
export async function tirer(cle: CleRunner, executor: string): Promise<CarteTiree | null> {
  const s = signataire(cle.identite);
  const r = await appel<{ assignation: Assignment | null }>(cle.url, 'POST', '/v0/work/claim', objets.requete(s, 'claim', { ruche: cle.hive, executor }));
  const a = r.assignation;
  if (!a) return null;
  const carte = a.carte;
  if (!carte) {
    await liberer(cle, a);
    throw new Error('the coordinator gave an unsealed lease to a runner');
  }
  if (!verifyObject(carte, carte.coordinator) || hashPrompt(carte.prompt) !== carte.prompt_hash || carte.executor !== executor) {
    await liberer(cle, a);
    throw new Error('the sealed card does not check out (signature, prompt hash or executor): given back');
  }
  await appel(cle.url, 'POST', '/v0/work/start', objets.requete(s, 'start', { alveole: a.alveole_id }));
  return { assignment: a, carte };
}

/** Read a model's answer into a deliverable, with the parts a builder assembles. */
export function lireLivrable(t: CarteTiree, texte: string): Livrable {
  const f = fiche(t.assignment);
  const lu = lireReponse(texte, { module: f.livrable.module, ...(f.livrable.portee ? { portee: f.livrable.portee } : {}) });
  const parties = t.assignment.caste === 'batisseuse' && !f.livrable.portee ? Object.assign({}, ...(t.assignment.enfants_valides ?? []).map((e) => e.livrable.fichiers)) : {};
  return { fichiers: { ...parties, ...lu.fichiers }, ...(lu.supprimes ? { supprimes: lu.supprimes } : {}) };
}

/**
 * An executor from any text completion (the engine's pool of free models, an API, an official CLI):
 * each attempt is a fresh, one-pass run of the sealed prompt, never a conversation (§3.3). The first
 * deliverable that passes the visible checks here is kept.
 */
export function executeurTexte(completer: (prompt: string, essai: number) => Promise<{ texte: string; agent: string }>, ex: Executeurs, o: { essais?: number; log?: (l: string) => void } = {}): Executeur {
  return async (t) => {
    const essais = o.essais ?? 3;
    let dernier = '';
    for (let i = 0; i < essais; i++) {
      let reponse: { texte: string; agent: string };
      try {
        reponse = await completer(t.carte.prompt, i);
      } catch (e) {
        dernier = (e as Error).message;
        o.log?.(`attempt ${i + 1}: no answer (${dernier.slice(0, 80)})`);
        continue;
      }
      let livrable: Livrable;
      try {
        livrable = lireLivrable(t, reponse.texte);
      } catch (e) {
        dernier = (e as Error).message;
        o.log?.(`attempt ${i + 1} by ${reponse.agent}: unreadable (${dernier.slice(0, 80)})`);
        continue;
      }
      const rapport = await verifier(t.assignment.alveole.critere_fini, livrable, { sansCaches: true }, ex);
      if (rapport.ok) return { livrable, agent: reponse.agent };
      dernier = rapport.motif;
      o.log?.(`attempt ${i + 1} by ${reponse.agent}: not yet (${rapport.motif.slice(0, 80)})`);
    }
    throw new Error(`no deliverable passed the visible checks after ${essais} attempt(s): ${dernier.slice(0, 120)}`);
  };
}

/** Hand in a deliverable with the card's prompt hash; the coordinator refuses any other prompt. */
export async function rendre(cle: CleRunner, t: CarteTiree, e: Execution): Promise<{ statut: string; motif: string }> {
  const resultat = objets.resultat(signataire(cle.identite), t.assignment.alveole_id, t.assignment.caste as 'ouvriere' | 'batisseuse', e.livrable, {
    agent: { famille: 'api', modele: e.agent.slice(0, 120) },
    prompt_hash: t.carte.prompt_hash as Hash,
  });
  const r = await appel<{ statut: string; rapport?: { motif: string } }>(cle.url, 'POST', '/v0/work/submit', { resultat, livrable: e.livrable });
  return { statut: r.statut, motif: r.rapport?.motif ?? '' };
}

/** Give the cell back to the draw; `echec`: the executor tried and could not (counts toward a stronger tier). */
export async function liberer(cle: CleRunner, a: Assignment, echec = false): Promise<void> {
  await appel(cle.url, 'POST', '/v0/work/release', objets.requete(signataire(cle.identite), 'release', { alveole: a.alveole_id, ...(echec ? { echec: true as const } : {}) }));
}

export type IssueRunner = 'rendu' | 'refuse' | 'abandonne' | 'rien';

/** One full turn: draw, execute, hand in (or give back). */
export async function tour(cle: CleRunner, executor: string, executer: Executeur, log: (l: string) => void = () => {}): Promise<IssueRunner> {
  const t = await tirer(cle, executor);
  if (!t) return 'rien';
  log(`sealed card for cell ${t.assignment.alveole_id.slice(0, 12)}… (${t.assignment.caste}), prompt ${t.carte.prompt_hash.slice(0, 19)}…`);
  let e: Execution;
  try {
    e = await executer(t);
  } catch (err) {
    await liberer(cle, t.assignment, true);
    log(`given back: ${(err as Error).message.slice(0, 140)}`);
    return 'abandonne';
  }
  const r = await rendre(cle, t, e);
  log(`handed in by ${e.agent}: ${r.statut}${r.motif ? ` (${r.motif.slice(0, 100)})` : ''}`);
  return r.statut === 'rejete' ? 'refuse' : 'rendu';
}
