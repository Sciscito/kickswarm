import { hashOf } from './canonical.js';
import { newNonce, signObject, type Identity } from './identity.js';
import type {
  CellSpec,
  Decision,
  DecisionNature,
  Decomposition,
  Hash,
  Hive,
  Livrable,
  Requete,
  Result,
  Verdict,
} from './types.js';

// Fabriques d'objets OSP signés, partagées par le plugin, la CLI, la démo et les tests.

export function makeRequete(id: Identity, action: Requete['action'], extra: { ruche?: string; alveole?: Hash } = {}): Requete {
  return signObject<Requete>({ type: 'osp.requete/0.1', action, contributeur: id.id, ...extra, ts: Date.now(), nonce: newNonce() }, id);
}

export function makeHive(id: Identity, h: { slug: string; nom: string; objectif: string; licence?: string; plafond_miel?: number }): Hive {
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
    },
    id,
  );
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
    { type: 'osp.verdict/0.1', resultat, gardienne: id.id, decision, motif, mise_reputation: mise, piege: false },
    id,
  );
}

export function makeDecision(id: Identity, nature: DecisionNature, cible: string, motif: string, params?: Decision['params']): Decision {
  return signObject<Decision>(
    { type: 'osp.decision/0.1', auteur: id.id, nature, cible, motif, date: new Date().toISOString(), ...(params ? { params } : {}) },
    id,
  );
}
