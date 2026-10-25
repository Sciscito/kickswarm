import assert from 'node:assert/strict';
import { test } from 'node:test';
import { auditRegistry } from '../src/coordinator/audit.js';
import { Coordinator } from '../src/coordinator/coordinator.js';
import { cloner, empreinteEtat, geler, gelerPieces } from '../src/coordinator/etat.js';
import { seededRng } from '../src/coordinator/scheduler.js';
import { abeilleScriptee, RACINE } from '../src/exemples/maths.js';
import { makeDecision, makeHive } from '../src/protocol/builders.js';
import { generateIdentity } from '../src/protocol/identity.js';
import type { CritereV0, Livrable } from '../src/protocol/types.js';
import { verifierV0 } from '../src/verifier/v0.js';

// The coordinator's cost must not grow with its history: frozen pieces shared and fingerprinted once,
// state fingerprint and snapshot at the seals, light cell signatures, warm sandboxes.

const fondateur = generateIdentity();
const bees = [generateIdentity(), generateIdentity(), generateIdentity()];

test('state: a frozen piece is shared by the snapshot, the rest is copied; the fingerprint does not depend on freezing', () => {
  const piece = geler({ fichiers: { 'a.mjs': 'export const a = 1;' } });
  const etat = { cells: { c1: { cell: piece, state: 'libre', gardiennes: [] as string[] } }, results: {}, accounts: { x: { miel: 1 } } };
  const copie = cloner(etat);
  assert.equal(copie.cells.c1.cell, piece, 'the frozen piece is shared');
  assert.notEqual(copie.cells.c1, etat.cells.c1, 'the mutable record is copied');
  copie.cells.c1.gardiennes.push('g');
  assert.equal(etat.cells.c1.gardiennes.length, 0, 'changing the copy leaves the original intact');
  assert.throws(() => {
    (piece.fichiers as Record<string, string>)['a.mjs'] = 'tampered';
  }, 'a frozen piece cannot move');

  // Read back from disk (nothing frozen), then frozen again: the same fingerprint.
  const relu = JSON.parse(JSON.stringify(etat)) as typeof etat;
  assert.equal(empreinteEtat(relu), empreinteEtat(etat));
  gelerPieces(relu);
  assert.ok(Object.isFrozen(relu.cells.c1.cell));
  assert.equal(empreinteEtat(relu), empreinteEtat(etat));
  // And it still sees every change of a small record.
  relu.accounts.x.miel = 2;
  assert.notEqual(empreinteEtat(relu), empreinteEtat(etat));
});

test('state: cells are signed with the light hybrid key, seals carry the fingerprint, and the audit checks both', async () => {
  const c = new Coordinator({ fondateur: fondateur.id, params: { alpha_faux: 0.05, taux_pieges: 0.1, sceau_max_commandes: 15 }, rng: seededRng(3) });
  c.proposeHive(makeHive(fondateur, { slug: 'maths', nom: 'Maths', objectif: 'x' }), RACINE);
  c.decide(makeDecision(fondateur, 'approbation_ruche', 'maths', 'ok'));
  for (let tour = 0; tour < 300 && c.hiveView('maths').statut !== 'terminee'; tour++) {
    const action = await abeilleScriptee(c, bees[tour % 3]!);
    if (action?.issue.includes('waiting for the hive owner')) {
      const prop = c.registry.entries.filter((e) => e.nature === 'decoupage_propose').at(-1)!;
      c.decide(makeDecision(fondateur, 'approbation_decoupage', (prop.donnees as { id: string }).id, 'ok'));
    }
  }
  assert.equal(c.hiveView('maths').statut, 'terminee');
  const lancement = c.registry.entries[0]!.donnees as { alveoles?: string; params: { empreinte_etat: number } };
  assert.match(lancement.alveoles!, /^pq1:/, 'the launch announces the cell key');
  assert.equal(lancement.params.empreinte_etat, 2);
  const sceaux = c.registry.entries.filter((e) => e.nature === 'sceau').map((e) => e.donnees as { etat?: string; sig: string });
  assert.ok(sceaux.length >= 3 && sceaux.every((s) => s.etat?.startsWith('sha256:') && s.sig.startsWith('slh1.')), 'SLH-DSA seals carrying the fingerprint');
  const commandes = c.registry.entries.filter((e) => e.nature === 'commande');
  assert.ok(commandes.every((e) => !('etat' in (e.donnees as object))), 'no more fingerprint after every command');

  const report = await auditRegistry(c.registry.entries, { etatAnnonce: c.stateHash() });
  for (const ch of report.controles) assert.ok(ch.ok, `${ch.nom}: ${ch.detail ?? ''}`);

  // A seal claiming another state is caught, even with a valid signature chain around it.
  const faux = structuredClone(c.registry.entries);
  const i = faux.findIndex((e, k) => k > 2 && e.nature === 'sceau');
  (faux[i]!.donnees as { etat: string }).etat = `sha256:${'0'.repeat(64)}`;
  assert.equal((await auditRegistry(faux)).ok, false);
});

test('sandbox: warm threads stay healthy after an infinite loop, a memory bomb and more runs than a thread lives', async () => {
  const c = (fn: string, attendu: unknown): CritereV0 => ({ classe: 'V0', verificateur: 'tests-js@1', module: 'm.mjs', tests: [{ fn, args: [2], attendu }], timeout_ms: 2000 });
  const liv = (code: string): Livrable => ({ fichiers: { 'm.mjs': code } });
  assert.equal((await verifierV0(c('f', 1), liv('export function f() { for (;;) {} }'))).ok, false);
  assert.equal((await verifierV0(c('f', 1), liv('export function f() { const a = []; for (;;) a.push(new Array(1e6).fill(7)); }'))).ok, false);
  const runs = await Promise.all(Array.from({ length: 40 }, (_, k) => verifierV0(c('f', 2 * k), liv(`export const f = (x) => x * ${k};`))));
  assert.ok(runs.every((r) => r.ok), runs.find((r) => !r.ok)?.motif);
});
