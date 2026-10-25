import { canonicalize, sha256 } from '../protocol/canonical.js';
import type { Hash } from '../protocol/types.js';

// The coordinator's state, kept cheap to copy and to fingerprint whatever the size of its history.
//
// The big pieces never change once written: a signed cell, a result with its deliverable and its
// report, a split, a hive. They are frozen when they enter the state. A frozen piece is shared, not
// copied, when a command takes its rollback snapshot, and its fingerprint is computed once.
//
// The state fingerprint (version 2) replaces each of these pieces by its own hash, at fixed places,
// whether the piece is frozen or not: frozen only makes it faster. So a state loaded from disk and the
// same state built command by command have the same fingerprint.

/** Deep-freezes a JSON value: written once, it can no longer move. */
export function geler<T>(v: T): T {
  if (v === null || typeof v !== 'object' || Object.isFrozen(v)) return v;
  for (const x of Object.values(v as object)) geler(x);
  return Object.freeze(v);
}

/** Copies a JSON value; the frozen pieces are shared, since nothing can change them. */
export function cloner<T>(v: T): T {
  if (v === null || typeof v !== 'object' || Object.isFrozen(v)) return v;
  if (Array.isArray(v)) return v.map(cloner) as T;
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) out[k] = cloner(x);
  return out as T;
}

const empreintes = new WeakMap<object, Hash>();

/** A piece's own hash, kept for frozen pieces. */
function piece(v: unknown): { $h: Hash } | null | undefined {
  if (v === undefined || v === null) return v as null | undefined;
  if (typeof v !== 'object') return { $h: sha256(canonicalize(v)) };
  const connue = empreintes.get(v);
  if (connue) return { $h: connue };
  const h = sha256(canonicalize(v));
  if (Object.isFrozen(v)) empreintes.set(v, h);
  return { $h: h };
}

type Enregistrements = Record<string, Record<string, unknown>> | undefined;

/** Each record of a collection, with the named fields replaced by their own hash. */
function remplacer(collection: Enregistrements, champs: string[]): Enregistrements {
  if (!collection) return collection;
  const out: Record<string, Record<string, unknown>> = {};
  for (const [k, rec] of Object.entries(collection)) {
    const r: Record<string, unknown> = { ...rec };
    for (const c of champs) if (c in r) r[c] = piece(r[c]);
    out[k] = r;
  }
  return out;
}

/** The places of the immutable pieces in the state. */
const PIECES: Record<string, string[]> = {
  cells: ['cell'],
  results: ['resultat', 'livrable', 'rapport', 'mutants'],
  decompositions: ['decomposition'],
  hives: ['ruche'],
  pieges: ['livrable'],
};

/** Fingerprint version 2 of a state: the small records in full, the big immutable pieces by their hash. */
export function empreinteEtat(state: Record<string, unknown>): Hash {
  const vue: Record<string, unknown> = { ...state };
  for (const [col, champs] of Object.entries(PIECES)) vue[col] = remplacer(state[col] as Enregistrements, champs);
  return sha256(canonicalize(vue));
}

/** What is finished never moves again: honey cells, settled results, decided splits. */
const TERMINES: Record<string, (rec: Record<string, unknown>) => boolean> = {
  cells: (r) => r.state === 'miel',
  results: (r) => r.statut !== 'en_verification',
  decompositions: (r) => r.statut !== 'en_attente',
};

/**
 * Freezes, in a state read from disk, what the commands freeze as they write it: the immutable pieces,
 * and the finished records. Freezing changes no fingerprint; it only makes the snapshots cheap.
 */
export function gelerPieces(state: Record<string, unknown>): void {
  for (const [col, champs] of Object.entries(PIECES)) {
    const collection = state[col] as Enregistrements;
    if (!collection) continue;
    for (const rec of Object.values(collection)) for (const c of champs) if (rec[c] !== undefined) geler(rec[c]);
  }
  for (const [col, fini] of Object.entries(TERMINES)) {
    const collection = state[col] as Enregistrements;
    if (collection) for (const rec of Object.values(collection)) if (fini(rec)) geler(rec);
  }
}
