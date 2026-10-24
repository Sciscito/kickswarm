import { makeRequete } from '../protocol/builders.js';
import type { Identity } from '../protocol/identity.js';
import type { DetailCellule } from '../coordinator/coordinator.js';
import type { Adhesion, Assignment, Caste, CellSpec, Decision, Decomposition, EngagementVerdict, FusionDepot, Hash, Hive, Invitation, LienGithub, Livrable, RecuDepot, Result, Secrets, Verdict } from '../protocol/types.js';

/** HTTP client for the coordinator. It signs every request with the local identity. */
export class CoordinatorClient {
  constructor(
    readonly url: string,
    readonly identite: Identity,
  ) {}

  /** OSP v0.3 §2.8: the private hive this client works in, if any, and its current read ticket. */
  private prive: string | undefined;
  private ticket: { valeur: string; expire: number } | undefined;

  /** From now on, every hive route goes to this private hive's own instance (`/v0/p/{id}/…`). */
  utiliserRuchePrivee(id: string | undefined): void {
    this.prive = id;
    this.ticket = undefined;
  }

  get ruchePrivee(): string | undefined {
    return this.prive;
  }

  /** A read ticket lasts an hour: one signature per hour, renewed a few minutes before it runs out. */
  private async ticketLecture(): Promise<string> {
    if (this.ticket && this.ticket.expire - Date.now() > 5 * 60_000) return this.ticket.valeur;
    const r = await this.call<{ ticket: string; expire: string }>('POST', '/v0/ticket', makeRequete(this.identite, 'lire'));
    this.ticket = { valeur: r.ticket, expire: Date.parse(r.expire) };
    return r.ticket;
  }

  private async call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    // Host routes (creating a private hive, joining with a code) stay public.
    const hote = path === '/v0/private' || path === '/v0/join';
    const chemin = this.prive && !hote && path.startsWith('/v0/') ? `/v0/p/${this.prive}${path.slice(3)}` : path;
    const headers: Record<string, string> = body === undefined ? {} : { 'content-type': 'application/json' };
    if (this.prive && !hote && method === 'GET') headers.authorization = `Bearer ${await this.ticketLecture()}`;
    const res = await fetch(new URL(chemin, this.url), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as { erreur?: string };
    // The HTTP status comes with the error: 425 means “reveal not open yet, try again”.
    if (!res.ok) throw Object.assign(new Error(data.erreur ?? `Coordinator error ${res.status}`), { status: res.status });
    return data as T;
  }

  info() {
    return this.call<{ protocole: string; version: string; fondateur: string; coordinateur: string }>('GET', '/v0');
  }
  hives() {
    return this.call<Array<{ slug: string; nom: string; statut: string; progression: { miel: number; total: number } }>>('GET', '/v0/hives');
  }
  hive(slug: string) {
    return this.call<{ ruche: Hive; statut: string; progression: { miel: number; total: number }; alveoles: Array<{ id: string; chemin: string; objectif: string; etat: string; profondeur: number; enfants: number }> }>(
      'GET',
      `/v0/hives/${encodeURIComponent(slug)}`,
    );
  }
  board(slug: string) {
    return this.call<Array<{ nature: string; chemin: string; texte: string; date: string }>>('GET', `/v0/board/${encodeURIComponent(slug)}`);
  }
  account(id: string = this.identite.id) {
    return this.call<{ id: string; miel: number; parts: number; reputation: number; miel_gagne: number; trophees?: Array<{ id: string; ruche?: string }> }>(
      'GET',
      `/v0/contributors/${encodeURIComponent(id)}`,
    );
  }
  /** The registry from `since` on, page after page (the coordinator serves it in pages). */
  async registry(since = 0): Promise<unknown[]> {
    const out: unknown[] = [];
    for (;;) {
      const page = await this.call<unknown[]>('GET', `/v0/registry?since=${since + out.length}`);
      if (!page.length) return out;
      out.push(...page);
    }
  }
  proposeHive(ruche: Hive, racine: CellSpec, secrets?: Secrets) {
    return this.call('POST', '/v0/hives', { ruche, racine, ...(secrets ? { secrets } : {}) });
  }
  async claim(ruche?: string, castes?: Caste[]): Promise<Assignment | null> {
    const r = await this.call<{ assignation: Assignment | null }>('POST', '/v0/work/claim', makeRequete(this.identite, 'claim', { ...(ruche ? { ruche } : {}), ...(castes ? { castes } : {}) }));
    return r.assignation;
  }
  start(alveole: Hash) {
    return this.call<{ etat: string }>('POST', '/v0/work/start', makeRequete(this.identite, 'start', { alveole }));
  }
  release(alveole: Hash) {
    return this.call<{ rappelee: boolean }>('POST', '/v0/work/release', makeRequete(this.identite, 'release', { alveole }));
  }
  submit(resultat: Result, livrable: Livrable) {
    return this.call<{ statut: string; resultat: Hash; rapport: { ok: boolean; motif: string } }>('POST', '/v0/work/submit', { resultat, livrable });
  }
  decompose(d: Decomposition, secrets?: Array<Secrets | undefined>) {
    return this.call<{ statut: string; decoupage: Hash; enfants: Hash[] }>('POST', '/v0/work/decompose', { decomposition: d, secrets: secrets ?? [] });
  }
  engager(e: EngagementVerdict) {
    return this.call<{ statut: 'engage'; revelation: boolean }>('POST', '/v0/work/commit', e);
  }
  verdict(v: Verdict) {
    return this.call<{ statut: string; piege?: boolean; correct?: boolean | null; renverse?: boolean; confirmations?: number }>('POST', '/v0/work/verdict', v);
  }
  decide(d: Decision) {
    return this.call<{ decision: Hash }>('POST', '/v0/decisions', d);
  }

  // OSP v0.3 §2: private hives.
  creerRuchePrivee(ruche: Hive, racine: CellSpec, approbation: Decision, secrets?: Secrets) {
    return this.call<{ id: string; slug: string }>('POST', '/v0/private', { ruche, racine, approbation, ...(secrets ? { secrets } : {}) });
  }
  rejoindreAvecCode(a: Adhesion) {
    return this.call<{ id: string; slug: string; role: string }>('POST', '/v0/join', a);
  }
  inviter(i: Invitation) {
    return this.call<{ invitation: Hash }>('POST', '/v0/invitations', i);
  }
  membres() {
    return this.call<Array<{ id: string; role: string; gardienne: boolean; depuis: string }>>('GET', '/v0/members');
  }
  ancres() {
    return this.call<Array<{ seq: number; tete: Hash }>>('GET', '/v0/anchors');
  }
  etatPublie() {
    return this.call<{ seq: number; etat: Hash | null; tete: { seq: number; hash: Hash } | null }>('GET', '/v0/state-hash');
  }
  // OSP v0.3 §3.3: the bridge's routes.
  cellule(id: Hash) {
    return this.call<DetailCellule>('GET', `/v0/cells/${encodeURIComponent(id)}`);
  }
  mielsDepot() {
    return this.call<Array<{ id: Hash; chemin: string; ruche: string; recus: number }>>('GET', '/v0/repo/honey');
  }
  recuDepot(r: RecuDepot) {
    return this.call<{ recu: Hash }>('POST', '/v0/repo/receipts', r);
  }
  lienGithub(l: LienGithub) {
    return this.call<{ github: string }>('POST', '/v0/repo/github', l);
  }
  fusionDepot(f: FusionDepot) {
    return this.call<{ fusion: Hash }>('POST', '/v0/repo/merges', f);
  }
}
