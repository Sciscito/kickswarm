import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { hashOf } from '../protocol/canonical.js';
import type { Hash } from '../protocol/types.js';

/** Une entrée du registre public, chaînée à la précédente par son hash (§14.6). */
export interface RegistryEntry {
  seq: number;
  prev: Hash | null;
  date: string;
  nature: string;
  donnees: unknown;
  hash: Hash;
}

export class Registry {
  readonly entries: RegistryEntry[] = [];
  private readonly listeners = new Set<(entry: RegistryEntry) => void>();

  constructor(
    private readonly file?: string,
    private readonly now: () => number = Date.now,
  ) {
    if (file && existsSync(file)) {
      for (const line of readFileSync(file, 'utf8').split('\n')) {
        if (line.trim()) this.entries.push(JSON.parse(line) as RegistryEntry);
      }
      const check = verifyRegistry(this.entries);
      if (!check.ok) throw new Error(`Registre corrompu (${file}) : ${check.erreur}`);
    }
  }

  append(nature: string, donnees: unknown): RegistryEntry {
    const last = this.entries[this.entries.length - 1];
    const base = { seq: this.entries.length, prev: last ? last.hash : null, date: new Date(this.now()).toISOString(), nature, donnees };
    const entry: RegistryEntry = { ...base, hash: hashOf(base) };
    this.entries.push(entry);
    if (this.file) appendFileSync(this.file, JSON.stringify(entry) + '\n', 'utf8');
    for (const fn of this.listeners) fn(entry);
    return entry;
  }

  /** S'abonne aux nouvelles entrées (flux temps réel). Renvoie la fonction de désabonnement. */
  onAppend(fn: (entry: RegistryEntry) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  since(seq: number): RegistryEntry[] {
    return this.entries.slice(Math.max(0, seq));
  }
}

/** Recalcule chaque hash et chaque chaînage : n'importe qui peut vérifier le registre. */
export function verifyRegistry(entries: RegistryEntry[]): { ok: true } | { ok: false; erreur: string } {
  let prev: Hash | null = null;
  for (const [i, e] of entries.entries()) {
    if (e.seq !== i) return { ok: false, erreur: `numéro ${e.seq} à la position ${i}` };
    if (e.prev !== prev) return { ok: false, erreur: `chaînage rompu à l'entrée ${i}` };
    const { hash, ...base } = e;
    if (hashOf(base) !== hash) return { ok: false, erreur: `hash invalide à l'entrée ${i}` };
    prev = hash;
  }
  return { ok: true };
}
