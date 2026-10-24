import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { auditRegistry } from '../src/coordinator/audit.js';
import { Coordinator, type CommandeDonnees, type CoordinatorOptions } from '../src/coordinator/coordinator.js';
import type { RegistryEntry } from '../src/coordinator/registry.js';
import { seededRng } from '../src/coordinator/scheduler.js';
import { abeilleScriptee, ENFANTS, RACINE } from '../src/exemples/maths.js';
import { makeDecision, makeDecomposition, makeHive, makeRequete } from '../src/protocol/builders.js';
import { hashOf } from '../src/protocol/canonical.js';
import { generateIdentity, type Identity } from '../src/protocol/identity.js';
import type { Hash } from '../src/protocol/types.js';

const fondateur = generateIdentity();
const bees: Identity[] = [generateIdentity(), generateIdentity(), generateIdentity()];

/** Recomputes the hash chain after a forgery, as a forger would. */
function rechain(entries: RegistryEntry[]): RegistryEntry[] {
  let prev: Hash | null = null;
  return entries.map((e, i) => {
    const base = { seq: i, prev, date: e.date, nature: e.nature, donnees: e.donnees };
    const hash = hashOf(base);
    prev = hash;
    return { ...base, hash };
  });
}

/** A complete hive: split, rejection, traps, orientation, release, refused commands. */
async function fullRun(extra: Partial<CoordinatorOptions> = {}): Promise<Coordinator> {
  const c = new Coordinator({ fondateur: fondateur.id, params: { alpha_faux: 0.05, taux_pieges: 0.2 }, rng: seededRng(11), ...extra });
  c.proposeHive(makeHive(fondateur, { slug: 'maths', nom: 'Maths', objectif: 'pgcd, estPremier, fibonacci' }), RACINE);
  assert.throws(() => c.decide(makeDecision(bees[0]!, 'approbation_ruche', 'maths', 'pas fondateur')));
  c.decide(makeDecision(fondateur, 'approbation_ruche', 'maths', 'Conforme à la charte'));
  let bug = true, oriente = false, rappel = false;
  for (let tour = 0; tour < 300 && c.hiveView('maths').statut !== 'terminee'; tour++) {
    const bee = bees[tour % bees.length]!;
    if (!rappel && tour === 3) {
      const a = c.claim(makeRequete(bee, 'claim'));
      if (a) c.release(makeRequete(bee, 'release', { alveole: a.alveole_id }));
      rappel = true;
      continue;
    }
    const action = await abeilleScriptee(c, bee, { bug: bug && bee === bees[1] });
    if (action?.caste === 'ouvriere' && bee === bees[1]) bug = false;
    if (action?.issue.includes('waiting for the hive owner')) {
      const prop = c.registry.entries.filter((e) => e.nature === 'decoupage_propose').at(-1)!;
      c.decide(makeDecision(fondateur, 'approbation_decoupage', (prop.donnees as { id: string }).id, 'Découpage clair'));
    }
    if (!oriente && c.hiveView('maths').alveoles.some((x) => x.chemin === '2')) {
      c.decide(makeDecision(fondateur, 'orientation', 'maths:2', 'Les premiers d’abord', { multiplicateur: 3 }));
      oriente = true;
    }
  }
  assert.equal(c.hiveView('maths').statut, 'terminee');
  return c;
}

test('audit: a complete hive replays identically, entry by entry', async () => {
  const c = await fullRun();
  const entries = c.registry.entries;
  const report = await auditRegistry(entries, { etatAnnonce: c.stateHash() });
  for (const ch of report.controles) assert.ok(ch.ok, `${ch.nom}: ${ch.detail ?? ''}`);
  assert.equal(report.ok, true);
  assert.equal(report.etat, c.stateHash());
  assert.ok(report.commandes > 20, `${report.commandes} commands replayed`);
  const types = new Set(entries.filter((e) => e.nature === 'commande').map((e) => (e.donnees as CommandeDonnees).type));
  for (const t of ['proposeHive', 'decide', 'claim', 'start', 'release', 'submitResult', 'submitDecomposition', 'engageVerdict', 'submitVerdict']) assert.ok(types.has(t as never), `command ${t} present`);
});

test('audit: re-verification confirms every report of the honest verifier', async () => {
  const c = await fullRun();
  const report = await auditRegistry(c.registry.entries, { reverifier: true });
  assert.equal(report.ok, true, JSON.stringify(report.controles));
});

test('audit: a refused command leaves no trace, neither in the state nor in the registry', () => {
  const c = new Coordinator({ fondateur: fondateur.id, params: { alpha_faux: 0.05, taux_pieges: 0, abeilles_max: 1 }, rng: seededRng(3) });
  c.proposeHive(makeHive(fondateur, { slug: 'maths', nom: 'Maths', objectif: 'x' }), RACINE);
  c.decide(makeDecision(fondateur, 'approbation_ruche', 'maths', 'ok'));
  assert.ok(c.claim(makeRequete(bees[0]!, 'claim')));
  const n = c.registry.entries.length, h = c.stateHash();
  assert.throws(() => c.claim(makeRequete(bees[0]!, 'claim')), /At most 1/);
  assert.throws(() => c.decide(makeDecision(bees[1]!, 'pause', 'maths', 'pas le droit')));
  assert.equal(c.registry.entries.length, n, 'no phantom entry');
  assert.equal(c.stateHash(), h, 'no phantom nonce or lease in the state');
});

test('audit: forging a derived entry, then recomputing the hash chain, is detected', async () => {
  const c = await fullRun();
  const forged = structuredClone(c.registry.entries);
  const i = forged.findIndex((e) => e.nature === 'alveole_miel');
  (forged[i]!.donnees as { grammes: number }).grammes = 999;
  const report = await auditRegistry(rechain(forged));
  const replay = report.controles.find((x) => x.nom.startsWith('Deterministic replay'))!;
  assert.equal(replay.ok, false);
  assert.match(replay.detail!, new RegExp(`#${i}`));
});

test('audit: modifying a signed object inside a command is detected', async () => {
  const c = await fullRun();
  const forged = structuredClone(c.registry.entries);
  const e = forged.find((x) => x.nature === 'commande' && (x.donnees as CommandeDonnees).type === 'submitVerdict')!;
  const v = (e.donnees as CommandeDonnees).entree.verdict as { decision: string };
  v.decision = v.decision === 'valide' ? 'rejete' : 'valide';
  const report = await auditRegistry(rechain(forged));
  assert.equal(report.ok, false);
  assert.match(report.controles.find((x) => x.nom.startsWith('Deterministic replay'))!.detail!, /failed on replay|differs|replay produced/);
});

test('audit: deleting a command, or cheating on the randomness, is detected', async () => {
  const c = await fullRun();
  const sansCommande = structuredClone(c.registry.entries);
  const k = sansCommande.findIndex((x) => x.nature === 'commande' && (x.donnees as CommandeDonnees).type === 'start');
  sansCommande.splice(k, 1);
  assert.equal((await auditRegistry(rechain(sansCommande))).ok, false);

  // A draw that changes the course of events (here: forcing a trap cell) makes the replay diverge.
  // A draw modified without any effect would be undetectable, but also harmless;
  // against an operator who would pick their own draws, the defence is the public drand beacon (P1-3).
  const aleaTruque = structuredClone(c.registry.entries);
  const apresDecoupage = aleaTruque.findIndex((x) => x.nature === 'decoupage_adopte');
  const claim = aleaTruque.find((x) => {
    const d = x.donnees as CommandeDonnees;
    return x.seq > apresDecoupage && x.nature === 'commande' && d.type === 'claim' && d.alea.length > 0 && d.alea[0]! >= 0.2;
  })!;
  (claim.donnees as CommandeDonnees).alea[0] = 0;
  assert.equal((await auditRegistry(rechain(aleaTruque))).ok, false, 'a draw that changes the course of events is detected');
});

test('audit: a lying verifier passes the replay, but not the re-verification', async () => {
  const menteur = async () => ({ ok: true, motif: '3/3 tests passed', tests: [], duree_ms: 1, sandbox: 'none' });
  const c = new Coordinator({ fondateur: fondateur.id, params: { alpha_faux: 0.05, taux_pieges: 0, gardiennes_v0: 0 }, rng: seededRng(5), verifier: menteur });
  c.proposeHive(makeHive(fondateur, { slug: 'maths', nom: 'Maths', objectif: 'x' }), RACINE);
  c.decide(makeDecision(fondateur, 'approbation_ruche', 'maths', 'ok'));
  const a = c.claim(makeRequete(bees[0]!, 'claim'))!;
  const d = await c.submitDecomposition(makeDecomposition(bees[0]!, a.alveole_id, ENFANTS));
  c.decide(makeDecision(fondateur, 'approbation_decoupage', d.decoupage, 'ok'));
  await abeilleScriptee(c, bees[1]!, { bug: true });
  assert.ok(c.hiveView('maths').alveoles.some((x) => x.etat === 'miel'), 'the liar got wrong code through');

  const sans = await auditRegistry(c.registry.entries);
  assert.equal(sans.ok, true, 'the history is consistent with what the coordinator wrote');
  const avec = await auditRegistry(c.registry.entries, { reverifier: true });
  const check = avec.controles.find((x) => x.nom.startsWith('Verifier reports'))!;
  assert.equal(check.ok, false, 'the re-verification exposes the lie');
  assert.match(check.detail!, /registry says passed, a fresh run says failed/);
});

test('audit: on-disk registry replayed, tampered local state refused at startup', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'osp-audit-'));
  try {
    const c = new Coordinator({ fondateur: fondateur.id, dataDir: dir, params: { alpha_faux: 0.05, taux_pieges: 0 }, rng: seededRng(9) });
    c.proposeHive(makeHive(fondateur, { slug: 'maths', nom: 'Maths', objectif: 'x' }), RACINE);
    c.decide(makeDecision(fondateur, 'approbation_ruche', 'maths', 'ok'));
    c.claim(makeRequete(bees[0]!, 'claim'));

    const lignes = readFileSync(join(dir, 'registre.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as RegistryEntry);
    const report = await auditRegistry(lignes, { etatAnnonce: c.stateHash() });
    assert.equal(report.ok, true, JSON.stringify(report.controles));
    assert.doesNotThrow(() => new Coordinator({ fondateur: fondateur.id, dataDir: dir }));

    const etat = JSON.parse(readFileSync(join(dir, 'etat.json'), 'utf8'));
    etat.accounts[bees[0]!.id] = { miel: 1_000_000, parts: 0, reputation: 1, miel_gagne: 1_000_000 };
    writeFileSync(join(dir, 'etat.json'), JSON.stringify(etat));
    assert.throws(() => new Coordinator({ fondateur: fondateur.id, dataDir: dir }), /inconsistent with the registry/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('audit: an entry modified without recomputing the hash chain is stopped at once', async () => {
  const c = await fullRun();
  const forged = structuredClone(c.registry.entries);
  (forged[5]!.donnees as Record<string, unknown>).falsifie = true;
  const report = await auditRegistry(forged);
  assert.equal(report.ok, false);
  assert.equal(report.controles[0]!.nom, 'Hash chain intact');
  assert.equal(report.controles[0]!.ok, false);
});
