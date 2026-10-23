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

/**
 * Le registre est la source de vérité (OSP v0.2, §6.1). Les écritures d'une commande forment
 * une transaction : elles ne sont écrites sur disque et diffusées qu'au commit, et disparaissent
 * si la commande échoue.
 */
export class Registry {
  readonly entries: RegistryEntry[] = [];
  private readonly listeners = new Set<(entry: RegistryEntry) => void>();
  private pending: RegistryEntry[] | null = null;

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
    // Copie profonde : une entrée inscrite ne doit plus jamais bouger, même si l'objet source change.
    const base = { seq: this.entries.length, prev: last ? last.hash : null, date: new Date(this.now()).toISOString(), nature, donnees: structuredClone(donnees) };
    const entry: RegistryEntry = { ...base, hash: hashOf(base) };
    this.entries.push(entry);
    if (this.pending) this.pending.push(entry);
    else this.publish([entry]);
    return entry;
  }

  begin(): void {
    if (this.pending) throw new Error('Transaction du registre déjà ouverte');
    this.pending = [];
  }

  commit(): void {
    const done = this.pending ?? [];
    this.pending = null;
    this.publish(done);
  }

  rollback(): void {
    const n = this.pending?.length ?? 0;
    this.pending = null;
    this.entries.splice(this.entries.length - n, n);
  }

  /** S'abonne aux nouvelles entrées (flux temps réel). Renvoie la fonction de désabonnement. */
  onAppend(fn: (entry: RegistryEntry) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  since(seq: number): RegistryEntry[] {
    return this.entries.slice(Math.max(0, seq));
  }

  private publish(entries: RegistryEntry[]): void {
    if (!entries.length) return;
    if (this.file) appendFileSync(this.file, entries.map((e) => JSON.stringify(e)).join('\n') + '\n', 'utf8');
    for (const e of entries) for (const fn of this.listeners) fn(e);
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
