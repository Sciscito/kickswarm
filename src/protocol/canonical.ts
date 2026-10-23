import { createHash } from 'node:crypto';
import type { Hash } from './types.js';

/**
 * JSON canonique (RFC 8785, JCS) : clés triées par unités UTF-16, pas d'espaces,
 * nombres au format ECMAScript. Les champs `undefined` sont omis.
 */
export function canonicalize(value: unknown): string {
  if (value === undefined) throw new Error('Valeur undefined interdite dans un objet OSP');
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw new Error('Nombre non fini interdit dans un objet OSP');
    }
    if (typeof value === 'bigint' || typeof value === 'function' || typeof value === 'symbol') {
      throw new Error(`Type ${typeof value} interdit dans un objet OSP`);
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return '[' + value.map(canonicalize).join(',') + ']';
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalize(obj[k])).join(',') + '}';
}

export function sha256(text: string): Hash {
  return `sha256:${createHash('sha256').update(text, 'utf8').digest('hex')}`;
}

/** Identifiant d'un objet OSP : hash de sa forme canonique, champ `sig` exclu (§4.1). */
export function hashOf(obj: object): Hash {
  const { sig: _sig, ...rest } = obj as Record<string, unknown>;
  return sha256(canonicalize(rest));
}
