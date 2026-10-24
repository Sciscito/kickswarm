import { createHash } from 'node:crypto';
import type { CapsuleDepot, Hash, Livrable } from './types.js';

// OSP v0.3 §3.2: repo capsules and write scopes. A cell can point to a shared repository at an
// exact commit instead of copying it, and declares the files it may create, change or delete.

const SEGMENT = '[A-Za-z0-9_-][A-Za-z0-9_.-]{0,63}';
/** A file in the repository: relative, no segment starting with a dot (no "..", no hidden file). */
const FICHIER_RE = new RegExp(`^(?:${SEGMENT}/){0,8}${SEGMENT}$`);
/** A write scope entry: a file, or a whole folder written with a final "/". */
const PORTEE_RE = new RegExp(`^(?:${SEGMENT}/){0,8}(?:${SEGMENT}|${SEGMENT}/)$`);
const COMMIT_RE = /^[0-9a-f]{40}([0-9a-f]{24})?$/;
const URL_RE = /^https:\/\/[A-Za-z0-9.-]+(:\d+)?\/[A-Za-z0-9._~\/-]{1,200}$/;
const HASH_RE = /^sha256:[0-9a-f]{64}$/;
const MAX_ENTREES = 64;

/** Throws if the repo capsule is malformed. */
export function validateDepot(d: CapsuleDepot): void {
  if (!d || typeof d !== 'object') throw new Error('Invalid repo capsule');
  if (typeof d.url !== 'string' || !URL_RE.test(d.url) || d.url.includes('..')) throw new Error('The repository must be an https address');
  if (typeof d.commit !== 'string' || !COMMIT_RE.test(d.commit)) throw new Error('The base commit must be a full hexadecimal git hash');
  for (const [nom, liste, re] of [['lecture', d.lecture, FICHIER_RE], ['ecriture', d.ecriture, PORTEE_RE]] as const) {
    if (!Array.isArray(liste) || liste.length > MAX_ENTREES) throw new Error(`${nom}: a list of at most ${MAX_ENTREES} paths`);
    for (const p of liste) if (typeof p !== 'string' || !re.test(p)) throw new Error(`${nom}: path refused: ${String(p)}`);
    if (new Set(liste).size !== liste.length) throw new Error(`${nom}: a path appears twice`);
  }
  if (!d.ecriture.length) throw new Error('A repo cell declares the files it may write');
  const e = d.empreintes_lecture;
  if (!e || typeof e !== 'object' || Array.isArray(e)) throw new Error('empreintes_lecture: one sha256 hash per file read');
  const cles = Object.keys(e).sort();
  if (cles.join('\n') !== [...d.lecture].sort().join('\n')) throw new Error('empreintes_lecture must list exactly the files read');
  for (const k of cles) if (typeof e[k] !== 'string' || !HASH_RE.test(e[k]!)) throw new Error(`empreintes_lecture: invalid hash for ${k}`);
}

/** Does this write scope cover this file? */
export function couvre(ecriture: readonly string[], fichier: string): boolean {
  return ecriture.some((p) => (p.endsWith('/') ? fichier.startsWith(p) : fichier === p));
}

/** Two scopes overlap when an entry of one covers, or is inside, an entry of the other. */
export function chevauchent(a: readonly string[], b: readonly string[]): boolean {
  const recouvre = (x: string, y: string) => x === y || (x.endsWith('/') && y.startsWith(x)) || (y.endsWith('/') && x.startsWith(y));
  return a.some((x) => b.some((y) => recouvre(x, y)));
}

/** Is every entry of `enfant` inside `parent`? */
export function inclus(enfant: readonly string[], parent: readonly string[]): boolean {
  return enfant.every((p) => parent.some((q) => q === p || (q.endsWith('/') && p.startsWith(q))));
}

/** The paths a deliverable touches that its cell's write scope does not cover. */
export function horsPortee(d: CapsuleDepot, livrable: Livrable): string[] {
  return [...Object.keys(livrable.fichiers), ...(livrable.supprimes ?? [])].filter((p) => !couvre(d.ecriture, p));
}

/** The hash git gives a file's content (a "blob"), as written byte for byte (UTF-8, no line-end conversion). */
export function gitBlobSha1(contenu: string): string {
  const octets = Buffer.from(contenu, 'utf8');
  return createHash('sha1').update(Buffer.concat([Buffer.from(`blob ${octets.length}\0`, 'utf8'), octets])).digest('hex');
}

/** The git hashes of a deliverable's files, by path. */
export function blobsDuLivrable(livrable: Livrable): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of Object.keys(livrable.fichiers).sort()) out[k] = gitBlobSha1(livrable.fichiers[k]!);
  return out;
}

/** A file read by the plugin from the member's clone: the hash pinned in the signed cell. */
export function empreinteLecture(contenu: string): Hash {
  return `sha256:${createHash('sha256').update(contenu, 'utf8').digest('hex')}`;
}

/** The branch the bridge writes a cell's honey on (§3.3): one per branch of the comb, or one per cell. */
export function brancheGit(slug: string, chemin: string, parCellule: boolean): string {
  const b = chemin.split('.')[0] ?? '0';
  return parCellule ? `kickswarm/${slug}/cell-${chemin.replace(/\./g, '-')}` : `kickswarm/${slug}/branch-${b}`;
}
