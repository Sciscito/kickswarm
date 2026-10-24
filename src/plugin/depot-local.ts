import { memeDepot, run } from '../bridge/git.js';
import { empreinteLecture } from '../protocol/depot.js';
import type { CapsuleDepot, Hash } from '../protocol/types.js';

// OSP v0.3 §3.2: a repo cell's files are read from the member's own clone, at the exact commit of
// the signed cell, and checked against the hashes it pins. Nothing about the repository goes to
// the coordinator: the clone and its credentials stay on this machine.

export interface LectureDepot {
  /** The clone used, if one is set for this repository. */
  clone?: string;
  /** Files read and matching their pinned hash. */
  fichiers: Record<string, string>;
  /** Files that could not be used, and why. */
  manquants: Array<{ chemin: string; raison: string }>;
}

const MAX_OCTETS = 200_000;

/** The clone set for this repository in the participation settings, whatever the spelling of its address. */
export function cloneDe(url: string, depots: Record<string, string> | undefined): string | undefined {
  return Object.entries(depots ?? {}).find(([u]) => memeDepot(u, url))?.[1];
}

/** Reads one file of the repository at a commit, byte for byte (no line-end conversion). */
export function lireFichier(clone: string, commit: string, chemin: string): Promise<string> {
  return run('git', clone, ['-c', 'core.autocrlf=false', 'cat-file', 'blob', `${commit}:${chemin}`]);
}

/** Reads `chemins` at `commit` and returns their hashes, for a scout's children (the AI cannot hash). */
export async function empreintes(clone: string, commit: string, chemins: string[]): Promise<Record<string, Hash>> {
  const out: Record<string, Hash> = {};
  for (const c of chemins) out[c] = empreinteLecture(await lireFichier(clone, commit, c));
  return out;
}

export async function lireDepot(d: CapsuleDepot, depots: Record<string, string> | undefined): Promise<LectureDepot> {
  const clone = cloneDe(d.url, depots);
  if (!clone) return { fichiers: {}, manquants: d.lecture.map((chemin) => ({ chemin, raison: 'no local clone set for this repository' })) };
  const r: LectureDepot = { clone, fichiers: {}, manquants: [] };
  let total = 0;
  for (const chemin of d.lecture) {
    let contenu: string;
    try {
      contenu = await lireFichier(clone, d.commit, chemin);
    } catch {
      r.manquants.push({ chemin, raison: `not found at commit ${d.commit.slice(0, 10)} in ${clone} (git fetch?)` });
      continue;
    }
    if (empreinteLecture(contenu) !== d.empreintes_lecture[chemin]) {
      r.manquants.push({ chemin, raison: 'its content does not match the hash pinned by the cell' });
      continue;
    }
    total += Buffer.byteLength(contenu, 'utf8');
    if (total > MAX_OCTETS) {
      r.manquants.push({ chemin, raison: `too large to show (over ${MAX_OCTETS} bytes in all)` });
      continue;
    }
    r.fichiers[chemin] = contenu;
  }
  return r;
}
