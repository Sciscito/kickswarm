import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { hashOf } from '../protocol/canonical.js';
import type { Hash } from '../protocol/types.js';

/** A public registry entry, chained to the previous one by its hash (§14.6). */
export interface RegistryEntry {
  seq: number;
  prev: Hash | null;
  date: string;
  nature: string;
  donnees: unknown;
  hash: Hash;
}

/**
 * The registry is the source of truth (OSP v0.2, §6.1). The writes of a command form
 * a transaction: they are written to disk and broadcast only on commit, and disappear
 * if the command fails.
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
      if (!check.ok) throw new Error(`Corrupted registry (${file}): ${check.erreur}`);
    }
  }

  append(nature: string, donnees: unknown): RegistryEntry {
    const last = this.entries[this.entries.length - 1];
    // Deep copy: a written entry must never move again, even if the source object changes.
    const base = { seq: this.entries.length, prev: last ? last.hash : null, date: new Date(this.now()).toISOString(), nature, donnees: structuredClone(donnees) };
    const entry: RegistryEntry = { ...base, hash: hashOf(base) };
    this.entries.push(entry);
    if (this.pending) this.pending.push(entry);
    else this.publish([entry]);
    return entry;
  }

  begin(): void {
    if (this.pending) throw new Error('Registry transaction already open');
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

  /** Subscribes to new entries (real-time stream). Returns the unsubscribe function. */
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

/** Recomputes every hash and every link: anyone can verify the registry. */
export function verifyRegistry(entries: RegistryEntry[]): { ok: true } | { ok: false; erreur: string } {
  let prev: Hash | null = null;
  for (const [i, e] of entries.entries()) {
    if (e.seq !== i) return { ok: false, erreur: `sequence number ${e.seq} at position ${i}` };
    if (e.prev !== prev) return { ok: false, erreur: `chain broken at entry ${i}` };
    const { hash, ...base } = e;
    if (hashOf(base) !== hash) return { ok: false, erreur: `invalid hash at entry ${i}` };
    prev = hash;
  }
  return { ok: true };
}
