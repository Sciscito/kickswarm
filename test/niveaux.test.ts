import assert from 'node:assert/strict';
import { test } from 'node:test';
import { auditRegistry } from '../src/coordinator/audit.js';
import { Coordinator } from '../src/coordinator/coordinator.js';
import { seededRng } from '../src/coordinator/scheduler.js';
import { ENFANTS, RACINE, SOLUTIONS } from '../src/exemples/maths.js';
import { makeDecision, makeDecomposition, makeHive, makeRequete, makeResult } from '../src/protocol/builders.js';
import { generateIdentity, type Identity } from '../src/protocol/identity.js';
import type { CellSpec, Livrable, Tier } from '../src/protocol/types.js';

// OSP v0.5 §6: tiers of models and the cascade. Splitting needs the best models, small tested writing
// work starts with the cheapest; failures move a cell up one tier, then back to a scout; honey follows
// the tier. Registries written before tiers replay exactly as before.

const fondateur = generateIdentity();
const PREMIER = ENFANTS[1]!;
const FAUX = [
  'export function estPremier(n) { return n % 2 === 1; }\n',
  'export function estPremier(n) { return n > 1; }\n',
  'export function estPremier(n) { return false; }\n',
  'export function estPremier(n) { return true; }\n',
  'export function estPremier(n) { return n === 2; }\n',
];

/** A hive split into the given children, approved by its owner. */
async function ruche(enfants: CellSpec[], params: ConstructorParameters<typeof Coordinator>[0]['params'] = {}) {
  const c = new Coordinator({ fondateur: fondateur.id, params: { taux_pieges: 0, gardiennes_v0: 0, enfants_min: 1, ...params }, rng: seededRng(5) });
  c.proposeHive(makeHive(fondateur, { slug: 'maths', nom: 'Maths', objectif: RACINE.objectif }), RACINE);
  c.decide(makeDecision(fondateur, 'approbation_ruche', 'maths', 'ok'));
  const eclaireuse = generateIdentity();
  const s = c.claim(makeRequete(eclaireuse, 'claim', { ruche: 'maths', castes: ['eclaireuse'] }))!;
  const d = await c.submitDecomposition(makeDecomposition(eclaireuse, s.alveole_id, enfants));
  if (d.statut === 'en_attente_porteur') c.decide(makeDecision(fondateur, 'approbation_decoupage', d.decoupage, 'ok'));
  return c;
}

const prendre = (c: Coordinator, bee: Identity, tier?: Tier) => c.claim(makeRequete(bee, 'claim', { ruche: 'maths', castes: ['ouvriere'], ...(tier ? { tier } : {}) }));
async function rendre(c: Coordinator, bee: Identity, alveole: string, code: string) {
  const livrable: Livrable = { fichiers: { 'premier.mjs': code } };
  return c.submitResult(makeResult(bee, alveole as never, 'ouvriere', livrable), livrable);
}
const natures = (c: Coordinator, n: string) => c.registry.entries.filter((e) => e.nature === n).map((e) => e.donnees as Record<string, unknown>);

test('tiers: splitting needs the best models, small tested work starts with the cheapest', async () => {
  const c = new Coordinator({ fondateur: fondateur.id, params: { taux_pieges: 0 }, rng: seededRng(5) });
  c.proposeHive(makeHive(fondateur, { slug: 'maths', nom: 'Maths', objectif: RACINE.objectif }), RACINE);
  c.decide(makeDecision(fondateur, 'approbation_ruche', 'maths', 'ok'));
  const eco = generateIdentity();
  assert.equal(c.claim(makeRequete(eco, 'claim', { ruche: 'maths', tier: 'economy' })), null, 'an economy bee is not sent the heart to split');
  assert.equal(c.hiveView('maths').alveoles[0]!.niveau, 'frontier');
  const top = generateIdentity();
  const s = c.claim(makeRequete(top, 'claim', { ruche: 'maths', tier: 'frontier' }))!;
  assert.equal(s.caste, 'eclaireuse');
  assert.equal(s.tier, 'frontier');
  const d = await c.submitDecomposition(makeDecomposition(top, s.alveole_id, [...ENFANTS]));
  if (d.statut === 'en_attente_porteur') c.decide(makeDecision(fondateur, 'approbation_decoupage', d.decoupage, 'ok'));
  const a = c.claim(makeRequete(eco, 'claim', { ruche: 'maths', tier: 'economy' }))!;
  assert.equal(a.caste, 'ouvriere');
  assert.equal(a.tier, 'economy');
  // A bee that states no tier (an agent, a chat) can still take anything, as before.
  assert.ok(c.claim(makeRequete(generateIdentity(), 'claim', { ruche: 'maths' })));
  assert.throws(() => c.claim(makeRequete(eco, 'claim', { ruche: 'maths', tier: 'genius' as Tier })), /tier: economy, standard or frontier/);
});

test('the cascade: two failures move a cell up one tier, a failure at the top sends it back to a scout', async () => {
  const c = await ruche([PREMIER]);
  const eco = generateIdentity();
  const mid = generateIdentity();
  const top = generateIdentity();
  let faux = 0;

  // Economy: one rejected result, and one "I tried and could not" release.
  let a = prendre(c, eco, 'economy')!;
  assert.equal((await rendre(c, eco, a.alveole_id, FAUX[faux++]!)).statut, 'rejete');
  a = prendre(c, eco, 'economy')!;
  c.release(makeRequete(eco, 'release', { alveole: a.alveole_id, echec: true }));
  assert.deepEqual(natures(c, 'niveau_releve').map((d) => [d.de, d.a]), [['economy', 'standard']]);
  assert.equal(prendre(c, eco, 'economy'), null, 'the cell is now out of reach for economy models');

  // Standard: two failures; the old rule (three rejections) does not send it back to a scout any more.
  for (let i = 0; i < 2; i++) {
    a = prendre(c, mid, 'standard')!;
    assert.equal(a.tier, 'standard');
    assert.equal((await rendre(c, mid, a.alveole_id, FAUX[faux++]!)).statut, 'rejete');
  }
  assert.equal(natures(c, 'redecoupage').length, 0, 'three rejections, no going back to a scout yet');
  assert.deepEqual(natures(c, 'niveau_releve').map((d) => d.a), ['standard', 'frontier']);
  assert.equal(prendre(c, mid, 'standard'), null);

  // Frontier: one failure, and the cell goes back to a scout, who needs the best models too.
  a = prendre(c, top, 'frontier')!;
  assert.equal((await rendre(c, top, a.alveole_id, FAUX[faux++]!)).statut, 'rejete');
  assert.deepEqual(natures(c, 'redecoupage').map((d) => d.apres), ['frontier']);
  assert.equal(c.claim(makeRequete(mid, 'claim', { ruche: 'maths', castes: ['eclaireuse'], tier: 'standard' })), null);
  const s = c.claim(makeRequete(top, 'claim', { ruche: 'maths', castes: ['eclaireuse'], tier: 'frontier' }))!;
  assert.equal(s.caste, 'eclaireuse');
  assert.equal(s.alveole_id, a.alveole_id);

  // A release without "echec" counts for nothing, and "echec" is refused anywhere but on a release.
  assert.throws(() => c.claim(makeRequete(eco, 'claim', { ruche: 'maths', echec: true })), /only true, on a release/);

  const report = await auditRegistry(c.registry.entries, { etatAnnonce: c.stateHash() });
  assert.ok(report.ok, JSON.stringify(report.controles.filter((x) => !x.ok)));
});

test('honey follows the tier the cell needed', async () => {
  const eco = await ruche([PREMIER]);
  const top = await ruche([{ ...PREMIER, tier: 'frontier' }]);
  for (const c of [eco, top]) {
    const bee = generateIdentity();
    const a = prendre(c, bee, 'frontier')!;
    assert.equal((await rendre(c, bee, a.alveole_id, SOLUTIONS['premier.mjs']!)).statut, 'miel');
  }
  const [e] = natures(eco, 'alveole_miel');
  const [f] = natures(top, 'alveole_miel');
  assert.equal(e!.niveau, 'economy');
  assert.equal(f!.niveau, 'frontier');
  assert.equal(Number(f!.grammes) / Number(e!.grammes), 4);
  // The tier the owner asked for is part of the signed cell.
  assert.equal(top.hiveView('maths').alveoles.find((x) => x.profondeur === 1)!.niveau, 'frontier');
});

test('a registry written before tiers replays exactly as before', async () => {
  const c = await ruche([PREMIER], { niveaux: 0 });
  await assert.rejects(ruche([{ ...PREMIER, tier: 'economy' }], { niveaux: 0 }), /no tiers of models/);
  const bee = generateIdentity();
  for (let i = 0; i < 3; i++) {
    // Without tiers, a stated tier changes nothing.
    const a = prendre(c, bee, 'economy')!;
    assert.equal(a.tier, undefined);
    assert.equal((await rendre(c, bee, a.alveole_id, FAUX[i]!)).statut, 'rejete');
  }
  assert.equal(natures(c, 'redecoupage').length, 1, 'three rejections send it back to a scout, as in v0.1');
  assert.equal(natures(c, 'niveau_releve').length, 0);
  // The launch entry carries the version; a registry that says nothing about tiers replays without them.
  const lancement = c.registry.entries[0]!.donnees as { params: { niveaux?: number } };
  assert.equal(lancement.params.niveaux, 0);
  const report = await auditRegistry(c.registry.entries, { etatAnnonce: c.stateHash() });
  assert.ok(report.ok, JSON.stringify(report.controles.filter((x) => !x.ok)));
});
