import type { Generateur, Propriete, TestCase } from '../protocol/types.js';

// `tests-luau@1` (OSP v0.3 §3.6), the part every host shares (Node, browsers): preparing the suite
// (the property cases are drawn here, from the deliverable's hash) and reading the runner's report.

export const LUAU_LABEL = 'WebAssembly (Luau 0.739: no network, no disk, bounded memory)';

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

/** What a Luau execution returns (luau-exec.ts), read into a SortieLuau. */
export function lireSortieLuau(m: { timedOut: boolean; sortie?: string; erreur?: string; portes?: string[] }): SortieLuau {
  if (m.timedOut) return { timedOut: true };
  if (m.portes) return { timedOut: false, portes: m.portes };
  if (m.erreur || !m.sortie) return { timedOut: false, erreur: m.erreur ?? 'no report' };
  try {
    const r = JSON.parse(m.sortie) as { chargement?: string; resultats?: ResultatLuau[] };
    return { timedOut: false, ...r };
  } catch {
    return { timedOut: false, erreur: 'unreadable report' };
  }
}
