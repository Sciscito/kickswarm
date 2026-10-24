import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomBytes,
  sign as cryptoSign,
  verify as cryptoVerify,
  type KeyObject,
} from 'node:crypto';
import { canonicalize } from './canonical.js';
import type { ContributorId } from './types.js';

// Identities and signatures, with cryptographic agility (OSP v0.2, P0-5).
//
//  - `pq1:`  hybrid Ed25519 + ML-DSA-65 identity (FIPS 204). The signature is valid only if
//            BOTH signatures are: one would have to break both the elliptic curve and the
//            lattice. This is the default identity for contributors.
//  - `slh1:` SLH-DSA-SHA2-128f (FIPS 205), whose security rests only on the hash
//            function. The most conservative choice there is: it serves the coordinator and the registry seals.
//  - `ed25519:` the historical identity, still accepted, but vulnerable to a quantum computer.
//
// A post-quantum identifier is the fingerprint (sha256) of its public keys: it stays short.
// The signature carries the public keys, checked against this fingerprint, and the exact type
// of each key is checked, which rules out any algorithm substitution.

export type Algo = 'pq1' | 'slh1' | 'ed25519';

export interface Identity {
  id: ContributorId;
  /** Main private key: Ed25519 (`pq1`, `ed25519`) or SLH-DSA (`slh1`). */
  privateKeyPem: string;
  /** ML-DSA-65 private key, for hybrid `pq1` identities. */
  pqPrivateKeyPem?: string;
}

const PQ = 'ml-dsa-65';
const SLH = 'slh-dsa-sha2-128f';
const b64 = (b: Buffer) => b.toString('base64url');
const unb64 = (s: string) => Buffer.from(s, 'base64url');
const fingerprint = (...parts: Buffer[]) => b64(createHash('sha256').update(Buffer.concat(parts)).digest());

export function algoOf(id: string): Algo | null {
  const m = /^(pq1|slh1|ed25519):[A-Za-z0-9_-]{43}$/.exec(id);
  return m ? (m[1] as Algo) : null;
}

export function isContributorId(value: unknown): value is ContributorId {
  return typeof value === 'string' && algoOf(value) !== null;
}

/** True if the identity resists a quantum computer. */
export function isPostQuantum(id: string): boolean {
  const a = algoOf(id);
  return a === 'pq1' || a === 'slh1';
}

function rawEd(pub: KeyObject): Buffer {
  const jwk = pub.export({ format: 'jwk' });
  if (!jwk.x) throw new Error('Unreadable Ed25519 public key');
  return unb64(jwk.x);
}
const spki = (pub: KeyObject) => pub.export({ type: 'spki', format: 'der' });
const pem = (k: KeyObject) => k.export({ format: 'pem', type: 'pkcs8' }).toString();

export function generateIdentity(algo: Algo = 'pq1'): Identity {
  if (algo === 'ed25519') {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    return { id: `ed25519:${b64(rawEd(publicKey))}`, privateKeyPem: pem(privateKey) };
  }
  if (algo === 'slh1') {
    const { publicKey, privateKey } = generateKeyPairSync(SLH as 'ed25519');
    return { id: `slh1:${fingerprint(spki(publicKey))}`, privateKeyPem: pem(privateKey) };
  }
  const ed = generateKeyPairSync('ed25519');
  const pq = generateKeyPairSync(PQ as 'ed25519');
  return {
    id: `pq1:${fingerprint(rawEd(ed.publicKey), spki(pq.publicKey))}`,
    privateKeyPem: pem(ed.privateKey),
    pqPrivateKeyPem: pem(pq.privateKey),
  };
}

const keyCache = new Map<string, KeyObject>();
function privateKey(pemText: string): KeyObject {
  let key = keyCache.get(pemText);
  if (!key) {
    key = createPrivateKey(pemText);
    keyCache.set(pemText, key);
  }
  return key;
}

/** Signs bytes with an identity, in the format of its algorithm. */
export function signBytes(data: Buffer, identity: Identity): string {
  const algo = algoOf(identity.id);
  if (algo === 'ed25519') return b64(cryptoSign(null, data, privateKey(identity.privateKeyPem)));
  if (algo === 'slh1') {
    const k = privateKey(identity.privateKeyPem);
    return `slh1.${b64(cryptoSign(null, data, k))}.${b64(spki(createPublicKey(k)))}`;
  }
  if (algo === 'pq1') {
    if (!identity.pqPrivateKeyPem) throw new Error('Hybrid identity without its ML-DSA key');
    const ed = privateKey(identity.privateKeyPem);
    const pq = privateKey(identity.pqPrivateKeyPem);
    return ['pq1', cryptoSign(null, data, ed), cryptoSign(null, data, pq), rawEd(createPublicKey(ed)), spki(createPublicKey(pq))]
      .map((x) => (typeof x === 'string' ? x : b64(x)))
      .join('.');
  }
  throw new Error(`Unknown identity: ${identity.id}`);
}

/** Checks a signature against an identifier; any anomaly (format, fingerprint, key type) means refusal. */
export function verifyBytes(data: Buffer, sig: string, signer: string): boolean {
  try {
    const algo = algoOf(signer);
    const fp = signer.slice(signer.indexOf(':') + 1);
    if (algo === 'ed25519') {
      if (sig.includes('.')) return false;
      const pub = createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: fp }, format: 'jwk' });
      return cryptoVerify(null, data, pub, unb64(sig));
    }
    if (algo === 'slh1') {
      const [tag, s, pk, ...rest] = sig.split('.');
      if (tag !== 'slh1' || !s || !pk || rest.length) return false;
      const der = unb64(pk);
      if (fingerprint(der) !== fp) return false;
      const pub = createPublicKey({ key: der, format: 'der', type: 'spki' });
      if ((pub.asymmetricKeyType as string) !== SLH) return false;
      return cryptoVerify(null, data, pub, unb64(s));
    }
    if (algo === 'pq1') {
      const [tag, sEd, sPq, pkEd, pkPq, ...rest] = sig.split('.');
      if (tag !== 'pq1' || !sEd || !sPq || !pkEd || !pkPq || rest.length) return false;
      const edRaw = unb64(pkEd), pqDer = unb64(pkPq);
      if (edRaw.length !== 32 || fingerprint(edRaw, pqDer) !== fp) return false;
      const edPub = createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: b64(edRaw) }, format: 'jwk' });
      const pqPub = createPublicKey({ key: pqDer, format: 'der', type: 'spki' });
      if ((pqPub.asymmetricKeyType as string) !== PQ) return false;
      // BOTH signatures must be valid.
      return cryptoVerify(null, data, edPub, unb64(sEd)) && cryptoVerify(null, data, pqPub, unb64(sPq));
    }
    return false;
  } catch {
    return false;
  }
}

/** Signs the canonical form of the object, `sig` field excluded, and returns a signed copy. */
export function signObject<T extends object>(obj: T, identity: Identity): T & { sig: string } {
  const { sig: _old, ...rest } = obj as Record<string, unknown>;
  return { ...(rest as T), sig: signBytes(Buffer.from(canonicalize(rest), 'utf8'), identity) };
}

export function verifyObject(obj: object, signer: ContributorId | string): boolean {
  const { sig, ...rest } = obj as Record<string, unknown>;
  if (typeof sig !== 'string') return false;
  return verifyBytes(Buffer.from(canonicalize(rest), 'utf8'), sig, signer);
}

export function newNonce(): string {
  return randomBytes(12).toString('base64url');
}
