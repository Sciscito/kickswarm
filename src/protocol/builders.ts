import { randomBytes } from 'node:crypto';
import { hashOf, sha256 } from './canonical.js';
import { newNonce, signObject, type Identity } from './identity.js';
import type {
  Adhesion,
  FusionDepot,
  LienGithub,
  RecuDepot,
  CellSpec,
  Invitation,
  Decision,
  EngagementVerdict,
  DecisionNature,
  Decomposition,
  Hash,
  Hive,
  Livrable,
  Requete,
  Result,
  Verdict,
} from './types.js';

// Factories for signed OSP objects, shared by the plugin, the CLI, the demo and the tests.

export function makeRequete(id: Identity, action: Requete['action'], extra: { ruche?: string; alveole?: Hash } = {}): Requete {
  return signObject<Requete>({ type: 'osp.requete/0.1', action, contributeur: id.id, ...extra, ts: Date.now(), nonce: newNonce() }, id);
}

export function makeHive(
  id: Identity,
  h: { slug: string; nom: string; objectif: string; licence?: string; plafond_miel?: number; privee?: boolean; parametres?: Hive['parametres'] },
): Hive {
  return signObject<Hive>(
    {
      type: 'osp.hive/0.1',
      slug: h.slug,
      nom: h.nom,
      objectif: h.objectif,
      porteur: id.id,
      classe_verif_defaut: 'V0',
      licence_resultats: h.licence ?? 'CC-BY-4.0',
      budget: { plafond_miel: h.plafond_miel ?? 500_000 },
      // A private hive carries a random salt: its identifier (a hash) then reveals nothing of its name.
      ...(h.privee ? { visibilite: 'privee' as const, sel: randomBytes(16).toString('hex'), ...(h.parametres ? { parametres: h.parametres } : {}) } : {}),
    },
    id,
  );
}

/** The identifier of a private hive: 128 bits of its hash, prefixed with "p". */
export function idRuchePrivee(h: Hive): string {
  return `p${hashOf(h).slice('sha256:'.length, 'sha256:'.length + 32)}`;
}

/** An invitation code in its normal form: upper case, no spaces. */
export const normaliserCode = (code: string): string => code.toUpperCase().replace(/\s+/g, '');

const B32 = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/**
 * An invitation into a private hive (OSP v0.3 §2.2), signed by its owner, and its code. The code is
 * short and readable (KSW-XXXXX-XXXXX, 50 bits); only its salted hash goes into the invitation.
 */
export function makeInvitation(
  id: Identity,
  ruche: string,
  o: { role?: 'membre' | 'observateur'; utilisations?: number; joursValidite?: number } = {},
): { invitation: Invitation; code: string } {
  const octets = randomBytes(10);
  const lettres = [...octets].map((b) => B32[b & 31]!).join('');
  const code = `KSW-${lettres.slice(0, 5)}-${lettres.slice(5, 10)}`;
  const sel = randomBytes(16).toString('hex');
  const invitation = signObject<Invitation>(
    {
      type: 'osp.invitation/0.3',
      ruche,
      role: o.role ?? 'membre',
      code_hash: sha256(`${sel}:${normaliserCode(code)}`),
      sel,
      utilisations_max: o.utilisations ?? 1,
      expire: Date.now() + (o.joursValidite ?? 14) * 24 * 3600_000,
      auteur: id.id,
      ts: Date.now(),
      nonce: newNonce(),
    },
    id,
  );
  return { invitation, code };
}

export function makeAdhesion(id: Identity, code: string): Adhesion {
  return signObject<Adhesion>({ type: 'osp.adhesion/0.3', contributeur: id.id, code: normaliserCode(code), ts: Date.now(), nonce: newNonce() }, id);
}

export function makeRecuDepot(id: Identity, r: Omit<RecuDepot, 'type' | 'auteur' | 'ts' | 'nonce' | 'sig'>): RecuDepot {
  return signObject<RecuDepot>({ type: 'osp.recu_depot/0.3', ...r, auteur: id.id, ts: Date.now(), nonce: newNonce() }, id);
}

export function makeLienGithub(id: Identity, github: string): LienGithub {
  return signObject<LienGithub>({ type: 'osp.lien_github/0.3', contributeur: id.id, github, ts: Date.now(), nonce: newNonce() }, id);
}

export function makeFusionDepot(id: Identity, f: Omit<FusionDepot, 'type' | 'auteur' | 'ts' | 'nonce' | 'sig'>): FusionDepot {
  return signObject<FusionDepot>({ type: 'osp.fusion_depot/0.3', ...f, auteur: id.id, ts: Date.now(), nonce: newNonce() }, id);
}

export function makeResult(
  id: Identity,
  alveole: Hash,
  caste: Result['caste'],
  livrable: Livrable,
  opts: { impasses?: string[]; agent?: Result['agent']; cout?: Result['cout'] } = {},
): Result {
  return signObject<Result>(
    {
      type: 'osp.result/0.1',
      alveole,
      auteur: id.id,
      caste,
      livrable: hashOf(livrable),
      impasses: opts.impasses ?? [],
      agent: opts.agent ?? { famille: 'inconnue' },
      cout: opts.cout ?? {},
    },
    id,
  );
}

export function makeDecomposition(id: Identity, alveole: Hash, enfants: CellSpec[]): Decomposition {
  return signObject<Decomposition>({ type: 'osp.decomposition/0.1', alveole, auteur: id.id, enfants }, id);
}

export function makeVerdict(id: Identity, resultat: Hash, decision: Verdict['decision'], motif: string, mise = 0.05): Verdict {
  return signObject<Verdict>(
    { type: 'osp.verdict/0.1', resultat, gardienne: id.id, decision, motif, mise_reputation: mise, piege: false, sel: randomBytes(32).toString('hex') },
    id,
  );
}

/** The commitment to a verdict: sent first, the verdict itself is only revealed afterwards. */
export function makeEngagement(id: Identity, v: Verdict): EngagementVerdict {
  return signObject<EngagementVerdict>({ type: 'osp.engagement/0.1', resultat: v.resultat, gardienne: id.id, engagement: hashOf(v) }, id);
}

export function makeDecision(id: Identity, nature: DecisionNature, cible: string, motif: string, params?: Decision['params']): Decision {
  return signObject<Decision>(
    { type: 'osp.decision/0.1', auteur: id.id, nature, cible, motif, date: new Date().toISOString(), ...(params ? { params } : {}) },
    id,
  );
}
