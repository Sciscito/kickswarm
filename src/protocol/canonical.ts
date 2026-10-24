import { sha256 as sha256Octets } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import type { Hash } from './types.js';

// Isomorphic: no Node API here, so browsers (the chat door, OSP v0.4 §2.3) compute the same hashes.

/**
 * Canonical JSON (RFC 8785, JCS): keys sorted by UTF-16 code units, no whitespace,
 * numbers in ECMAScript format. `undefined` fields are omitted.
 */
export function canonicalize(value: unknown): string {
  if (value === undefined) throw new Error('Undefined value not allowed in an OSP object');
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw new Error('Non-finite number not allowed in an OSP object');
    }
    if (typeof value === 'bigint' || typeof value === 'function' || typeof value === 'symbol') {
      throw new Error(`Type ${typeof value} not allowed in an OSP object`);
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return '[' + value.map(canonicalize).join(',') + ']';
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalize(obj[k])).join(',') + '}';
}

export function sha256(text: string): Hash {
  return `sha256:${bytesToHex(sha256Octets(utf8ToBytes(text)))}`;
}

/** Commitment to a secret value (hidden tests, reference): the hash is published, the value revealed later. */
export function commitment(value: unknown): Hash {
  return sha256(canonicalize(value));
}

/** Identifier of an OSP object: hash of its canonical form, `sig` field excluded (§4.1). */
export function hashOf(obj: object): Hash {
  const { sig: _sig, ...rest } = obj as Record<string, unknown>;
  return sha256(canonicalize(rest));
}
