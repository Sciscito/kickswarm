import { ed25519 } from '@noble/curves/ed25519.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { concatBytes } from '@noble/hashes/utils.js';
import { ml_dsa65 } from '@noble/post-quantum/ml-dsa.js';
import { base64url, depuisBase64url, type Signataire } from './objets.js';
import type { ContributorId } from './types.js';

// A contributor's identity made in a browser (OSP v0.4 §2.3): the same hybrid `pq1` identity as the
// CLI's (Ed25519 + ML-DSA-65, FIPS 204), with the audited @noble libraries instead of Node's crypto.
// The signatures have the exact format identity.ts verifies: Node checks them like any other.

/** The DER header of an ML-DSA-65 public key (SubjectPublicKeyInfo, OID 2.16.840.1.101.3.4.3.18). */
const SPKI_ML_DSA_65 = Uint8Array.from([0x30, 0x82, 0x07, 0xb2, 0x30, 0x0b, 0x06, 0x09, 0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x03, 0x12, 0x03, 0x82, 0x07, 0xa1, 0x00]);

/** What the browser keeps (never sent anywhere): the two secret keys. */
export interface IdentiteWeb {
  id: ContributorId;
  /** Ed25519 secret key (32 bytes), base64url. */
  ed: string;
  /** ML-DSA-65 seed (32 bytes), base64url: the key pair is derived from it. */
  graine: string;
}

function cles(i: IdentiteWeb) {
  const ed = depuisBase64url(i.ed);
  const pq = ml_dsa65.keygen(depuisBase64url(i.graine));
  const pkEd = ed25519.getPublicKey(ed);
  const spki = concatBytes(SPKI_ML_DSA_65, pq.publicKey);
  return { ed, pq, pkEd, spki };
}

function empreinte(pkEd: Uint8Array, spki: Uint8Array): ContributorId {
  return `pq1:${base64url(sha256(concatBytes(pkEd, spki)))}`;
}

export function genererIdentiteWeb(): IdentiteWeb {
  const ed = ed25519.utils.randomSecretKey();
  const graine = globalThis.crypto.getRandomValues(new Uint8Array(32));
  const brouillon = { id: 'pq1:' as ContributorId, ed: base64url(ed), graine: base64url(graine) };
  const k = cles(brouillon);
  return { ...brouillon, id: empreinte(k.pkEd, k.spki) };
}

/** Checks a stored identity (a damaged one would sign for someone else). */
export function identiteValide(i: unknown): i is IdentiteWeb {
  try {
    const x = i as IdentiteWeb;
    const k = cles(x);
    return empreinte(k.pkEd, k.spki) === x.id;
  } catch {
    return false;
  }
}

/** A signer for objets.ts: `pq1.<sig Ed25519>.<sig ML-DSA-65>.<public Ed25519>.<public ML-DSA-65 SPKI>`. */
export function signataireWeb(i: IdentiteWeb): Signataire {
  const k = cles(i);
  return {
    id: i.id,
    signer: (donnees) => ['pq1', ed25519.sign(donnees, k.ed), ml_dsa65.sign(donnees, k.pq.secretKey), k.pkEd, k.spki].map((x) => (typeof x === 'string' ? x : base64url(x))).join('.'),
  };
}
