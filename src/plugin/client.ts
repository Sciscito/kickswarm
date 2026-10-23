import { makeRequete } from '../protocol/builders.js';
import type { Identity } from '../protocol/identity.js';
import type { Assignment, CellSpec, Decision, Decomposition, Hash, Hive, Livrable, Result, Secrets, Verdict } from '../protocol/types.js';

/** Client HTTP du coordinateur. Il signe chaque requête avec l'identité locale. */
export class CoordinatorClient {
  constructor(
    readonly url: string,
    readonly identite: Identity,
  ) {}

  private async call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const res = await fetch(new URL(path, this.url), {
      method,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as { erreur?: string };
    if (!res.ok) throw new Error(data.erreur ?? `Erreur ${res.status} du coordinateur`);
    return data as T;
  }

  info() {
    return this.call<{ protocole: string; version: string; fondateur: string; coordinateur: string }>('GET', '/v0');
  }
  hives() {
    return this.call<Array<{ slug: string; nom: string; statut: string; progression: { miel: number; total: number } }>>('GET', '/v0/hives');
  }
  hive(slug: string) {
    return this.call<{ ruche: Hive; statut: string; progression: { miel: number; total: number }; alveoles: Array<{ chemin: string; objectif: string; etat: string }> }>(
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
  registry(since = 0) {
    return this.call<unknown[]>('GET', `/v0/registry?since=${since}`);
  }
  proposeHive(ruche: Hive, racine: CellSpec, secrets?: Secrets) {
    return this.call('POST', '/v0/hives', { ruche, racine, ...(secrets ? { secrets } : {}) });
  }
  async claim(ruche?: string): Promise<Assignment | null> {
    const r = await this.call<{ assignation: Assignment | null }>('POST', '/v0/work/claim', makeRequete(this.identite, 'claim', ruche ? { ruche } : {}));
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
  verdict(v: Verdict) {
    return this.call<{ statut: string; piege?: boolean; correct?: boolean | null; renverse?: boolean; confirmations?: number }>('POST', '/v0/work/verdict', v);
  }
  decide(d: Decision) {
    return this.call<{ decision: Hash }>('POST', '/v0/decisions', d);
  }
}
