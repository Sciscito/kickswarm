// What one action costs the coordinator, and how that cost grows with the size of its history.
//
//   node --import tsx scripts/charge-micro.ts [--steps 10,50,100,200,400]
//
// It opens hives one batch after another (each split into 12 cells, as a real project would be), and after
// each batch times a trivial command and its ingredients: the state hash, the state file, the signatures.

import { mkdtempSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { verifierBalise, QUICKNET, type Balise } from '../src/coordinator/balise.js';
import { Coordinator } from '../src/coordinator/coordinator.js';
import { makeDecision, makeDecomposition, makeHive, makeRequete } from '../src/protocol/builders.js';
import { generateIdentity, signObject, verifyObject } from '../src/protocol/identity.js';
import type { CellSpec, CritereV0 } from '../src/protocol/types.js';
import { verifierV0 } from '../src/verifier/v0.js';

const arg = (k: string, d: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1]! : d;
};
const PALIERS = arg('steps', '10,50,100,200,400').split(',').map(Number);
const chrono = (fn: () => unknown, n = 1) => {
  const t = performance.now();
  for (let i = 0; i < n; i++) fn();
  return (performance.now() - t) / n;
};
const test = (module: string, tests: CritereV0['tests']): CritereV0 => ({ classe: 'V0', verificateur: 'tests-js@1', module, tests });

async function main(): Promise<void> {
  // The ingredients, on their own.
  const pq = generateIdentity('pq1');
  const slh = generateIdentity('slh1');
  const obj = { type: 'x', n: 1 };
  const signePq = signObject(obj, pq);
  const VRAI: Balise = {
    round: 33343387,
    randomness: 'f1d7508803798a9cb2541ee66468524bebfe588cd4ef2936ca4a8d4f4c7917c0',
    signature: '92ded35df97c58a4aa55960ecf0fc9d4f3200f9e3053d47329721ffa45d232c1ce7da897e0aed0b40ab65b8ade97053a',
  };
  const crit = test('f.mjs', [{ fn: 'f', args: [1], attendu: 3 }]);
  const liv = { fichiers: { 'f.mjs': 'export const f = (x) => x * 2 + 1;' } };
  await verifierV0(crit, liv);
  const t = performance.now();
  for (let i = 0; i < 10; i++) await verifierV0(crit, liv);
  console.log('Ingredients (ms):');
  console.log(`  contributor signature, hybrid Ed25519 + ML-DSA-65: sign ${chrono(() => signObject(obj, pq), 20).toFixed(2)}, verify ${chrono(() => verifyObject(signePq, pq.id), 20).toFixed(2)}`);
  console.log(`  coordinator signature, SLH-DSA (each cell, each seal): sign ${chrono(() => signObject(obj, slh), 5).toFixed(1)}`);
  console.log(`  drand beacon, BLS check (each work request): ${chrono(() => verifierBalise(QUICKNET, VRAI), 10).toFixed(1)}`);
  console.log(`  one deliverable run in the WebAssembly sandbox: ${((performance.now() - t) / 10).toFixed(1)} (a submission adds up to 8 trap mutants)`);

  const dir = mkdtempSync(join(tmpdir(), 'kickswarm-micro-'));
  const fondateur = generateIdentity();
  const eclaireuse = generateIdentity();
  const passante = generateIdentity();
  const c = new Coordinator({ fondateur: fondateur.id, dataDir: dir, params: { taux_pieges: 0 } });
  let ouvertes = 0;
  console.log('\nHives | cells | state file | registry | trivial command | of which state hash | split of 12 cells');
  for (const palier of PALIERS) {
    let decoupe = 0;
    for (; ouvertes < palier; ouvertes++) {
      const i = ouvertes;
      const enfants: CellSpec[] = Array.from({ length: 12 }, (_, k) => ({
        objectif: `Hive ${i}: f${k}`, capsule: `f${k}`, atomique: true,
        critere_fini: test(`h${i}f${k}.mjs`, [{ fn: `f${k}`, args: [1], attendu: k + i }]),
      }));
      const racine: CellSpec = { objectif: `Micro hive ${i}`, capsule: 'x', atomique: false, critere_fini: test(`h${i}.mjs`, [{ fn: 'f0', args: [1], attendu: i }]) };
      c.proposeHive(makeHive(fondateur, { slug: `micro-${i}`, nom: `Micro ${i}`, objectif: racine.objectif }), racine);
      c.decide(makeDecision(fondateur, 'approbation_ruche', `micro-${i}`, 'ok'));
      const a = c.claim(makeRequete(eclaireuse, 'claim', { ruche: `micro-${i}` }))!;
      const t0 = performance.now();
      const d = await c.submitDecomposition(makeDecomposition(eclaireuse, a.alveole_id, enfants));
      decoupe = performance.now() - t0;
      c.decide(makeDecision(fondateur, 'approbation_decoupage', d.decoupage, 'ok'));
    }
    const commande = chrono(() => c.release(makeRequete(passante, 'release')), 10);
    const hash = chrono(() => c.stateHash(), 5);
    const cellules = ouvertes * 13;
    const mo = (f: string) => `${(statSync(join(dir, f)).size / 1e6).toFixed(1)} MB`;
    console.log(`${String(palier).padStart(5)} | ${String(cellules).padStart(5)} | ${mo('etat.json').padStart(10)} | ${mo('registre.jsonl').padStart(8)} | ${commande.toFixed(0).padStart(12)} ms | ${hash.toFixed(0).padStart(16)} ms | ${decoupe.toFixed(0).padStart(10)} ms`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
