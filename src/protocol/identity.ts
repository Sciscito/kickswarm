import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomBytes,
  sign as edSign,
  verify as edVerify,
  type KeyObject,
} from 'node:crypto';
import { canonicalize } from './canonical.js';
import type { ContributorId } from './types.js';

/** Une identité OSP : la clé publique Ed25519 est l'identifiant (§4.1). */
export interface Identity {
  id: ContributorId;
  privateKeyPem: string;
}

export function generateIdentity(): Identity {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const jwk = publicKey.export({ format: 'jwk' });
  if (!jwk.x) throw new Error('Clé publique Ed25519 illisible');
  return {
    id: `ed25519:${jwk.x}`,
    privateKeyPem: privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(),
  };
}

export function isContributorId(value: unknown): value is ContributorId {
  return typeof value === 'string' && /^ed25519:[A-Za-z0-9_-]{43}$/.test(value);
}

function publicKeyOf(id: ContributorId): KeyObject {
  if (!isContributorId(id)) throw new Error(`Identifiant de contributeur invalide : ${String(id)}`);
  return createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: id.slice('ed25519:'.length) }, format: 'jwk' });
}

const keyCache = new Map<string, KeyObject>();
function privateKeyOf(identity: Identity): KeyObject {
  let key = keyCache.get(identity.privateKeyPem);
  if (!key) {
    key = createPrivateKey(identity.privateKeyPem);
    keyCache.set(identity.privateKeyPem, key);
  }
  return key;
}

/** Signe la forme canonique de l'objet, champ `sig` exclu, et renvoie une copie signée. */
export function signObject<T extends object>(obj: T, identity: Identity): T & { sig: string } {
  const { sig: _old, ...rest } = obj as Record<string, unknown>;
  const sig = edSign(null, Buffer.from(canonicalize(rest), 'utf8'), privateKeyOf(identity)).toString('base64url');
  return { ...(rest as T), sig };
}

export function verifyObject(obj: object, signer: ContributorId): boolean {
  const { sig, ...rest } = obj as Record<string, unknown>;
  if (typeof sig !== 'string') return false;
  try {
    return edVerify(null, Buffer.from(canonicalize(rest), 'utf8'), publicKeyOf(signer), Buffer.from(sig, 'base64url'));
  } catch {
    return false;
  }
}

export function newNonce(): string {
  return randomBytes(12).toString('base64url');
}
