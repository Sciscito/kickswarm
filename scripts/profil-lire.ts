// Reads a .cpuprofile and prints where the time went: self time by function, and total time by function.
//
//   node --import tsx scripts/profil-lire.ts <file.cpuprofile> [--top 30] [--filter src/]

import { readFileSync } from 'node:fs';

interface Noeud { id: number; callFrame: { functionName: string; url: string; lineNumber: number }; children?: number[]; hitCount?: number }
const [fichier] = process.argv.slice(2);
const arg = (k: string, d: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1]! : d;
};
const TOP = Number(arg('top', '30'));
const p = JSON.parse(readFileSync(fichier!, 'utf8')) as { nodes: Noeud[]; samples: number[]; timeDeltas: number[] };
const parId = new Map(p.nodes.map((n) => [n.id, n]));
const parent = new Map<number, number>();
for (const n of p.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
const nom = (n: Noeud) => `${n.callFrame.functionName || '(anonymous)'} ${n.callFrame.url.replace(/^.*\/(src|scripts|node_modules)\//, '$1/').replace(/^node:/, 'node:')}:${n.callFrame.lineNumber + 1}`;

const soi = new Map<string, number>();
const total = new Map<string, number>();
let tout = 0;
for (let i = 0; i < p.samples.length; i++) {
  const dt = p.timeDeltas[i] ?? 0;
  tout += dt;
  let n = parId.get(p.samples[i]!);
  if (!n) continue;
  soi.set(nom(n), (soi.get(nom(n)) ?? 0) + dt);
  const vus = new Set<string>();
  while (n) {
    const k = nom(n);
    if (!vus.has(k)) {
      total.set(k, (total.get(k) ?? 0) + dt);
      vus.add(k);
    }
    const pid = parent.get(n.id);
    n = pid === undefined ? undefined : parId.get(pid);
  }
}
const ms = (x: number) => `${(x / 1000).toFixed(0).padStart(7)} ms ${((x / tout) * 100).toFixed(1).padStart(5)}%`;
console.log(`Sampled time: ${(tout / 1e6).toFixed(1)} s\n\nSelf time:`);
for (const [k, v] of [...soi].sort((a, b) => b[1] - a[1]).slice(0, TOP)) console.log(`${ms(v)}  ${k}`);
console.log('\nTotal time (with callees), project code only:');
for (const [k, v] of [...total].filter(([k]) => /src\/|scripts\//.test(k)).sort((a, b) => b[1] - a[1]).slice(0, TOP)) console.log(`${ms(v)}  ${k}`);
