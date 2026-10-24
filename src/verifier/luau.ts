import { extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import type { Generateur, Propriete, TestCase } from '../protocol/types.js';
import { LUAU_RUNNER } from './luau-runner.js';

// `tests-luau@1` and `luau-checks@1` (OSP v0.3 §3.6), the host side: it prepares the suite (the
// property cases are drawn here, from the deliverable's hash) and runs it in luau-worker.ts.

export const LUAU_LABEL = 'WebAssembly (Luau 0.739: no network, no disk, bounded memory)';
const LUAU_WORKER = new URL(`./luau-worker${extname(fileURLToPath(import.meta.url))}`, import.meta.url);
const MEMOIRE_MO = 128;

export interface ResultatLuau {
  ok: boolean;
  obtenu?: string;
  erreur?: string;
  cas?: number;
}

export interface SortieLuau {
  timedOut: boolean;
  /** The module could not be loaded. */
  chargement?: string;
  resultats?: ResultatLuau[];
  /** luau-checks@1 found something: its diagnostics. */
  portes?: string[];
  erreur?: string;
}

/** Same generator as the JavaScript runner: a small 32-bit PRNG and the same input generators. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gen(g: Generateur, r: () => number): unknown {
  switch (g.type) {
    case 'int':
      return g.min + Math.floor(r() * (g.max - g.min + 1));
    case 'float':
      return g.min + r() * (g.max - g.min);
    case 'bool':
      return r() < 0.5;
    case 'string': {
      const al = g.alphabet || 'abcdefghijklmnopqrstuvwxyz';
      const n = Math.floor(r() * (g.maxLen + 1));
      let s = '';
      for (let i = 0; i < n; i++) s += al[Math.floor(r() * al.length)];
      return s;
    }
    case 'array':
      return Array.from({ length: Math.floor(r() * (g.maxLen + 1)) }, () => gen(g.of, r));
    case 'oneOf':
      return structuredClone(g.values[Math.floor(r() * g.values.length)]);
  }
}

export function preparerLuau(
  module: string,
  tests: TestCase[],
  caches: TestCase[],
  proprietes: Array<Propriete & { seed: number; cas: number }>,
): unknown {
  const appel = (t: TestCase) => ({ fn: t.fn, args: t.args, n: t.args.length, attendu: t.attendu });
  return {
    module,
    tests: tests.map(appel),
    caches: caches.map(appel),
    proprietes: proprietes.map((p) => {
      const r = rng(p.seed);
      return {
        fn: p.fn,
        verifie: p.verifie,
        cas: Array.from({ length: p.cas }, () => {
          const args = p.args.map((g) => gen(g, r));
          return { args, n: args.length };
        }),
      };
    }),
  };
}

/** Runs a prepared suite in a throwaway thread, killed if it outlives its time. */
export function runLuau(o: { fichiers: Record<string, string>; spec: unknown; timeoutMs: number; graine: number; portes?: string[] }): Promise<SortieLuau> {
  return new Promise((resolve) => {
    let fini = false;
    const finir = (s: SortieLuau) => {
      if (fini) return;
      fini = true;
      clearTimeout(minuteur);
      void worker.terminate();
      resolve(s);
    };
    const worker = new Worker(LUAU_WORKER, {
      workerData: { fichiers: o.fichiers, runner: LUAU_RUNNER, spec: o.spec, timeoutMs: o.timeoutMs, memoireMo: MEMOIRE_MO, graine: o.graine, portes: o.portes },
      resourceLimits: { maxOldGenerationSizeMb: MEMOIRE_MO * 4 },
    });
    // The type checker has its own time: the gate and the tests together get a generous safety net.
    const minuteur = setTimeout(() => finir({ timedOut: true }), o.timeoutMs + (o.portes?.length ? 20_000 : 5000));
    worker.once('message', (m: { timedOut: boolean; sortie?: string; erreur?: string; portes?: string[] }) => {
      if (m.timedOut) return finir({ timedOut: true });
      if (m.portes) return finir({ timedOut: false, portes: m.portes });
      if (m.erreur || !m.sortie) return finir({ timedOut: false, erreur: m.erreur ?? 'no report' });
      try {
        const r = JSON.parse(m.sortie) as { chargement?: string; resultats?: ResultatLuau[] };
        finir({ timedOut: false, ...r });
      } catch {
        finir({ timedOut: false, erreur: 'unreadable report' });
      }
    });
    worker.once('error', (e) => finir({ timedOut: false, erreur: String(e) }));
    worker.once('exit', () => finir({ timedOut: false, erreur: 'The sandbox stopped unexpectedly' }));
  });
}
