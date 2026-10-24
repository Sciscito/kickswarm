import { canonicalize, hashOf } from './canonical.js';
import type { Caste, ContributorId, EngagementVerdict, Hash, Livrable, Requete, Result, Verdict } from './types.js';

// The signed work objects (requests, results, sealed verdicts), built the same way in Node and in a
// browser (OSP v0.4 §2.3): only the signer differs. builders.ts wraps them with a Node identity,
// the chat door with a browser identity (identite-web.ts). Isomorphic: no Node API here.

/** Something that signs bytes in an identity's format (see identity.ts for the formats). */
export interface Signataire {
  id: ContributorId;
  signer(donnees: Uint8Array): string;
}

const encodeur = new TextEncoder();

/** Signs the canonical form of the object, `sig` field excluded, and returns a signed copy. */
export function signerObjet<T extends object>(obj: T, s: Signataire): T & { sig: string } {
  const { sig: _old, ...rest } = obj as Record<string, unknown>;
  return { ...(rest as T), sig: s.signer(encodeur.encode(canonicalize(rest))) };
}

export function base64url(octets: Uint8Array): string {
  let bin = '';
  for (const o of octets) bin += String.fromCharCode(o);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function depuisBase64url(texte: string): Uint8Array {
  const bin = atob(texte.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (texte.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

export function aleatoire(n: number): Uint8Array {
  return globalThis.crypto.getRandomValues(new Uint8Array(n));
}

export function nonce(): string {
  return base64url(aleatoire(12));
}

const hex = (octets: Uint8Array) => Array.from(octets, (o) => o.toString(16).padStart(2, '0')).join('');

export function requete(s: Signataire, action: Requete['action'], extra: { ruche?: string; alveole?: Hash; castes?: Caste[] } = {}): Requete {
  return signerObjet<Requete>({ type: 'osp.requete/0.1', action, contributeur: s.id, ...extra, ts: Date.now(), nonce: nonce() }, s);
}

export function resultat(
  s: Signataire,
  alveole: Hash,
  caste: Result['caste'],
  livrable: Livrable,
  opts: { impasses?: string[]; agent?: Result['agent']; cout?: Result['cout'] } = {},
): Result {
  return signerObjet<Result>(
    {
      type: 'osp.result/0.1',
      alveole,
      auteur: s.id,
      caste,
      livrable: hashOf(livrable),
      impasses: opts.impasses ?? [],
      agent: opts.agent ?? { famille: 'inconnue' },
      cout: opts.cout ?? {},
    },
    s,
  );
}

export function verdict(s: Signataire, resultatId: Hash, decision: Verdict['decision'], motif: string, mise = 0.05): Verdict {
  return signerObjet<Verdict>(
    { type: 'osp.verdict/0.1', resultat: resultatId, gardienne: s.id, decision, motif, mise_reputation: mise, piege: false, sel: hex(aleatoire(32)) },
    s,
  );
}

/** The commitment to a verdict: sent first, the verdict itself is only revealed afterwards. */
export function engagement(s: Signataire, v: Verdict): EngagementVerdict {
  return signerObjet<EngagementVerdict>({ type: 'osp.engagement/0.1', resultat: v.resultat, gardienne: s.id, engagement: hashOf(v) }, s);
}
