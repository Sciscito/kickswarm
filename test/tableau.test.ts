import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { Coordinator } from '../src/coordinator/coordinator.js';
import { createCoordinatorServer } from '../src/coordinator/http.js';
import { seededRng } from '../src/coordinator/scheduler.js';
import { ENFANTS, RACINE, SOLUTIONS } from '../src/exemples/maths.js';
import { makeDecision, makeDecomposition, makeEngagement, makeHive, makeRequete, makeResult, makeVerdict } from '../src/protocol/builders.js';
import { generateIdentity } from '../src/protocol/identity.js';
import type { CritereV0, Livrable } from '../src/protocol/types.js';
import { verifierV0 } from '../src/verifier/v0.js';

// A project's dashboard: progress, milestones, branches, who does what, what waits for a decision,
// the AIs and contributors, the feed, and the measured pace for the simulator. Built from the state
// and the public registry, with the live view's discretion (a trap looks like any guard seat).

const fondateur = generateIdentity();

test('the dashboard follows a project: approval, a scout, a split to approve, workers and guards', async () => {
  const c = new Coordinator({ fondateur: fondateur.id, params: { alpha_faux: 0.05, taux_pieges: 1, gardiennes_v0: 1 }, rng: seededRng(2) });
  c.proposeHive(makeHive(fondateur, { slug: 'maths', nom: 'Maths', objectif: 'gcd, isPrime, fibonacci' }), RACINE);

  // Proposed: the founder decides.
  let t = c.tableauProjet('maths');
  assert.deepEqual(t.attente.map((a) => [a.type, a.qui]), [['approbation_ruche', 'founder']]);
  assert.deepEqual(t.progression, { miel: 0, total: 1 });
  c.decide(makeDecision(fondateur, 'approbation_ruche', 'maths', 'ok'));

  // A scout at work, then its split waits for the owner.
  const sc = generateIdentity();
  const s = c.claim(makeRequete(sc, 'claim'))!;
  c.start(makeRequete(sc, 'start', { alveole: s.alveole_id }));
  t = c.tableauProjet('maths');
  assert.deepEqual(t.travaux.map((x) => [x.chemin, x.caste, x.abeille]), [['0', 'eclaireuse', sc.id]]);
  assert.ok(t.travaux[0]!.depuis, 'since when it works');
  assert.equal(t.maintenant.abeilles, 1);
  const d = await c.submitDecomposition(makeDecomposition(sc, s.alveole_id, ENFANTS));
  t = c.tableauProjet('maths');
  assert.deepEqual(t.attente.map((a) => a.type), ['approbation_decoupage']);
  assert.equal(t.attente[0]!.cible, d.decoupage);
  c.decide(makeDecision(fondateur, 'approbation_decoupage', d.decoupage, 'ok'));

  // Branches appear; a worker hands in; a guard (here holding a trap) checks.
  t = c.tableauProjet('maths');
  assert.deepEqual(t.branches.map((b) => [b.chemin, b.miel, b.total]), [['1', 0, 1], ['2', 0, 1], ['3', 0, 1]]);
  assert.equal(t.attente.length, 0);
  const w = generateIdentity();
  const a = c.claim(makeRequete(w, 'claim'))!;
  c.start(makeRequete(w, 'start', { alveole: a.alveole_id }));
  const module = (a.alveole.critere_fini as CritereV0).module!;
  const livrable: Livrable = { fichiers: { [module]: SOLUTIONS[module]! } };
  await c.submitResult(makeResult(w, a.alveole_id, 'ouvriere', livrable, { agent: { famille: 'api', modele: 'openrouter/acme/fort:free' } }), livrable);
  const g = generateIdentity();
  let seat = null;
  for (let i = 0; i < 20 && !seat; i++) {
    const x = c.claim(makeRequete(g, 'claim'));
    if (x?.a_verifier) seat = x;
    else if (x) c.release(makeRequete(g, 'release', { alveole: x.alveole_id }));
  }
  assert.ok(seat);
  t = c.tableauProjet('maths');
  const v = t.verifications.find((x) => x.chemin === a.alveole.chemin)!;
  assert.equal(v.gardes, 1, 'the trap seat counts like any guard seat');
  assert.ok(!JSON.stringify(t).includes('piege'), 'nothing tells a trap apart');
  assert.ok(t.maintenant.abeilles >= 1);
  assert.deepEqual(t.modeles.map((m) => m.modele), ['openrouter/acme/fort:free']);

  // The trap is caught: the feed may say so, never who held it.
  const verdict = makeVerdict(g, seat.a_verifier!.id, 'rejete', 'trap');
  c.engagerVerdict(makeEngagement(g, verdict));
  await c.submitVerdict(verdict);
});

test('honey: milestones, measured pace for the simulator, feed and contributors', async () => {
  const c = new Coordinator({ fondateur: fondateur.id, params: { alpha_faux: 0.05, taux_pieges: 0, gardiennes_v0: 1 }, rng: seededRng(3) });
  c.proposeHive(makeHive(fondateur, { slug: 'maths', nom: 'Maths', objectif: 'x' }), RACINE);
  c.decide(makeDecision(fondateur, 'approbation_ruche', 'maths', 'ok'));
  const sc = generateIdentity();
  const s = c.claim(makeRequete(sc, 'claim'))!;
  const d = await c.submitDecomposition(makeDecomposition(sc, s.alveole_id, ENFANTS));
  c.decide(makeDecision(fondateur, 'approbation_decoupage', d.decoupage, 'ok'));
  const w = generateIdentity();
  const a = c.claim(makeRequete(w, 'claim'))!;
  c.start(makeRequete(w, 'start', { alveole: a.alveole_id }));
  const module = (a.alveole.critere_fini as CritereV0).module!;
  const livrable: Livrable = { fichiers: { [module]: SOLUTIONS[module]! } };
  await c.submitResult(makeResult(w, a.alveole_id, 'ouvriere', livrable, { agent: { famille: 'chat', modele: 'Le Chat' } }), livrable);
  const g = generateIdentity();
  const x = c.claim(makeRequete(g, 'claim', { castes: ['gardienne'] }))!;
  const rejeu = await verifierV0(x.alveole.critere_fini, x.a_verifier!.livrable, { sansCaches: true });
  const v = makeVerdict(g, x.a_verifier!.id, rejeu.ok ? 'valide' : 'rejete', rejeu.motif);
  c.engagerVerdict(makeEngagement(g, v));
  await c.submitVerdict(v);

  const t = c.tableauProjet('maths');
  assert.deepEqual(t.progression, { miel: 1, total: 4 });
  assert.deepEqual(t.jalons.map((j) => j.atteint), [true, false, false, false]);
  assert.ok(t.jalons[0]!.date);
  assert.equal(t.rythme.mesures, 1, 'one honey cell with a start: one measure');
  assert.ok(t.rythme.tempsCelluleMs !== null && t.rythme.tempsCelluleMs >= 0);
  assert.equal(t.rythme.restantes, 3);
  assert.ok(t.fil.some((f) => f.nature === 'alveole_miel'));
  assert.ok(t.contributeurs.some((x2) => x2.id === w.id && x2.grammes > 0));
  assert.deepEqual(t.modeles.map((m) => [m.modele, m.valides]), [['Le Chat', 1]]);
  assert.equal(t.branches.find((b) => b.chemin === a.alveole.chemin)?.termine, true);
});

test('the dashboard page and its data are served; an unknown project is a clean 404', async () => {
  const c = new Coordinator({ fondateur: fondateur.id, params: { taux_pieges: 0 } });
  c.proposeHive(makeHive(fondateur, { slug: 'maths', nom: 'Maths', objectif: 'x' }), RACINE);
  const http = createCoordinatorServer(c);
  await new Promise<void>((ok) => http.listen(0, '127.0.0.1', ok));
  const url = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
  try {
    const page = await fetch(`${url}/project/maths`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /How many bees to finish\?/);
    const j = (await (await fetch(`${url}/v0/hives/maths/dashboard`)).json()) as { ruche: { nom: string }; attente: unknown[] };
    assert.equal(j.ruche.nom, 'Maths');
    assert.equal(j.attente.length, 1);
    assert.equal((await fetch(`${url}/v0/hives/nope/dashboard`)).status, 404);
    assert.match(await (await fetch(`${url}/join`)).text(), /\/project\/\$\{esc\(h\.slug\)\}/, 'project cards link to their dashboard');
  } finally {
    http.closeAllConnections();
    await new Promise<void>((ok) => http.close(() => ok()));
  }
});
