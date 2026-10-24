import assert from 'node:assert/strict';
import { test } from 'node:test';
import { auditRegistry } from '../src/coordinator/audit.js';
import { BaliseLocale } from '../src/coordinator/balise.js';
import { Coordinator, type CommandeDonnees, type CoordinatorOptions } from '../src/coordinator/coordinator.js';
import { seededRng } from '../src/coordinator/scheduler.js';
import { abeilleScriptee, ENFANTS, RACINE, SOLUTIONS } from '../src/exemples/maths.js';
import { makeDecision, makeDecomposition, makeEngagement, makeHive, makeRequete, makeResult, makeVerdict } from '../src/protocol/builders.js';
import { generateIdentity, type Identity } from '../src/protocol/identity.js';
import type { Assignment, CritereV0, Hash, Livrable } from '../src/protocol/types.js';
import { mutants } from '../src/verifier/mutation.js';
import { verifierV0 } from '../src/verifier/v0.js';

// OSP v0.2, P0-3: a trap is a mutant of the real pending delivery, handed out in its place,
// at a rate specific to each guard. Nothing tells it apart from a real result, except a real verification.

const fondateur = generateIdentity();
const lea = generateIdentity();
const kenji = generateIdentity();
const amara = generateIdentity();
const sami = generateIdentity();

async function resultatEnAttente(params: CoordinatorOptions['params'] = {}, extra: Partial<CoordinatorOptions> = {}) {
  const c = new Coordinator({ fondateur: fondateur.id, params: { alpha_faux: 0.05, taux_pieges: 1, ...params }, rng: seededRng(5), ...extra });
  c.proposeHive(makeHive(fondateur, { slug: 'maths', nom: 'Maths', objectif: 'pgcd, estPremier, fibonacci' }), RACINE);
  c.decide(makeDecision(fondateur, 'approbation_ruche', 'maths', 'ok'));
  const s = c.claim(makeRequete(lea, 'claim'))!;
  const d = await c.submitDecomposition(makeDecomposition(lea, s.alveole_id, ENFANTS));
  c.decide(makeDecision(fondateur, 'approbation_decoupage', d.decoupage, 'ok'));
  const a = c.claim(makeRequete(kenji, 'claim'))!;
  const critere = a.alveole.critere_fini as CritereV0;
  const livrable: Livrable = { fichiers: { [critere.module!]: SOLUTIONS[critere.module!]! } };
  const r = await c.submitResult(makeResult(kenji, a.alveole_id, 'ouvriere', livrable), livrable);
  assert.equal(r.statut, 'en_verification');
  return { c, resultat: r.resultat as Hash, cellule: a.alveole_id, critere, livrable };
}

/** Takes a guard task, releasing the others. */
function gardienne(c: Coordinator, bee: Identity): Assignment {
  for (let i = 0; i < 50; i++) {
    const g = c.claim(makeRequete(bee, 'claim'));
    if (g?.a_verifier) return g;
    if (g) c.release(makeRequete(bee, 'release', { alveole: g.alveole_id }));
  }
  throw new Error('never drawn as a guard');
}

test('trap: a mutant of the real pending deliverable, which only a real verification exposes', async () => {
  const { c, resultat, cellule, critere, livrable } = await resultatEnAttente();
  const p = gardienne(c, amara);
  assert.deepEqual(Object.keys(p.a_verifier!).sort(), ['id', 'livrable'], 'anonymous verification: neither author nor signed result');
  assert.notEqual(p.a_verifier!.id, resultat, 'at rate 1, a newcomer receives a trap');
  assert.equal(p.alveole_id, cellule, 'same cell as the real result');
  const recu = p.a_verifier!.livrable;
  assert.ok(!JSON.stringify(recu).includes('__piege__'));
  assert.ok(
    mutants(livrable, { max: c.params.pieges_essais }).some((m) => JSON.stringify(m.livrable) === JSON.stringify(recu)),
    'the trap is the real deliverable with a single bug',
  );
  assert.equal((await verifierV0(critere, livrable, { sansCaches: true })).ok, true, 'the real one passes the guards’ checks');
  const rejeu = await verifierV0(critere, recu, { sansCaches: true });
  assert.equal(rejeu.ok, false, 'the trap fails them');
  assert.ok(rejeu.tests.some((t) => t.ok), 'but it passes some of the tests: there is nothing crude about it');

  // The public view does not give it away: the guard appears there like the others, with no "trap" field.
  const vue = c.liveView('maths').alveoles.find((x) => x.id === cellule)!;
  assert.equal(vue.etat, 'en_verification');
  assert.ok(vue.gardiennes.includes(amara.id));
  assert.ok(!JSON.stringify(c.liveView('maths')).includes(p.a_verifier!.id));
  assert.ok(!('piege' in vue));

  // The published registry stops before the submission: impossible to compare the received deliverable against it.
  const publie = c.registry.entries.slice(0, c.horizon() + 1);
  assert.ok(!publie.some((e) => e.nature === 'resultat_soumis'), 'the submission is under embargo');
  assert.ok(!JSON.stringify(publie).includes(SOLUTIONS[critere.module!]!.slice(0, 40)));
  const pub = c.etatPublie();
  assert.ok(pub.tete!.seq > pub.seq, 'the registry head, however, stays public');

  const v = makeVerdict(amara, p.a_verifier!.id, 'rejete', 'un test échoue');
  c.engagerVerdict(makeEngagement(amara, v));
  const r = await c.submitVerdict(v);
  assert.deepEqual([r.piege, r.correct], [true, true]);
});

test('trap: it takes up a guard seat, and its holder does not receive the real one at the same time', async () => {
  const { c, resultat } = await resultatEnAttente();
  const p = gardienne(c, amara);
  assert.notEqual(p.a_verifier!.id, resultat);
  // As long as her trap is open, amara receives no other verification task on this result.
  for (let i = 0; i < 10; i++) {
    const g = c.claim(makeRequete(amara, 'claim'));
    assert.ok(!g?.a_verifier, 'never two deliverables of the same result at once');
    if (g) c.release(makeRequete(amara, 'release', { alveole: g.alveole_id }));
  }
  // Once her verdict is revealed, the seat frees up.
  const v = makeVerdict(amara, p.a_verifier!.id, 'rejete', 'ko');
  c.engagerVerdict(makeEngagement(amara, v));
  await c.submitVerdict(v);
  assert.ok(gardienne(c, sami).a_verifier);
});

test('individual rate: high for a newcomer, lower for a reliable guard, never below the floor', async () => {
  const c = new Coordinator({ fondateur: fondateur.id, params: { alpha_faux: 0.05, taux_pieges: 0.2 }, rng: seededRng(9) });
  assert.equal(c.tauxPieges(generateIdentity().id), 0.2, 'a newcomer: the full rate');
  c.proposeHive(makeHive(fondateur, { slug: 'maths', nom: 'Maths', objectif: 'x' }), RACINE);
  c.decide(makeDecision(fondateur, 'approbation_ruche', 'maths', 'ok'));
  const abeilles = [kenji, amara, lea];
  for (let tour = 0; tour < 300 && c.hiveView('maths').statut !== 'terminee'; tour++) {
    const action = await abeilleScriptee(c, abeilles[tour % 3]!);
    if (action?.issue.includes('waiting for the hive owner')) {
      const prop = c.registry.entries.filter((e) => e.nature === 'decoupage_propose').at(-1)!;
      c.decide(makeDecision(fondateur, 'approbation_decoupage', (prop.donnees as { id: string }).id, 'ok'));
    }
  }
  const fiable = abeilles.reduce((m, b) => (c.account(b.id).reputation > c.account(m.id).reputation ? b : m));
  assert.ok(c.account(fiable.id).reputation > c.params.reputation_initiale);
  assert.ok(c.tauxPieges(fiable.id) < 0.2, `reputation ${c.account(fiable.id).reputation} → rate ${c.tauxPieges(fiable.id)}`);
  assert.ok(c.tauxPieges(fiable.id) >= c.params.taux_pieges_min);
  const sans = new Coordinator({ fondateur: fondateur.id, params: { alpha_faux: 0.05, taux_pieges: 0 } });
  assert.equal(sans.tauxPieges(lea.id), 0, 'at rate zero, no trap, not even the floor');
});

test('embargo: lifted as soon as the result is settled, and at the latest after the maximum delay', async () => {
  let maintenant = Date.now();
  const { c, resultat } = await resultatEnAttente({ taux_pieges: 0 }, { now: () => maintenant });
  const tete = () => c.registry.entries.length - 1;
  assert.ok(c.horizon() < tete());
  maintenant += c.params.embargo_max_ms + 1;
  assert.equal(c.horizon(), tete(), 'past the maximum delay, everything is published');

  maintenant = Date.now();
  const verdicts = [];
  for (const bee of [amara, sami]) {
    const g = gardienne(c, bee);
    assert.equal(g.a_verifier!.id, resultat, 'rate zero: real verifications');
    const v = makeVerdict(bee, resultat, 'valide', 'ok');
    c.engagerVerdict(makeEngagement(bee, v));
    verdicts.push(v);
  }
  assert.ok(c.horizon() < tete(), 'committed but not revealed: still under embargo');
  assert.equal((await c.submitVerdict(verdicts[0]!)).statut, 'en_verification');
  assert.equal((await c.submitVerdict(verdicts[1]!)).statut, 'miel');
  assert.equal(c.horizon(), tete(), 'the result is settled: everything is published');
});

test('secret randomness: with a public beacon, the trap draw does not derive from it, and the audit replays it', async () => {
  const c = new Coordinator({ fondateur: fondateur.id, params: { alpha_faux: 0.05, taux_pieges: 1, balise_decalage: 2 }, balise: new BaliseLocale(25) });
  c.proposeHive(makeHive(fondateur, { slug: 'maths', nom: 'Maths', objectif: 'x' }), RACINE);
  c.decide(makeDecision(fondateur, 'approbation_ruche', 'maths', 'ok'));
  const abeilles = [kenji, amara, lea];
  for (let tour = 0; tour < 300 && c.hiveView('maths').statut !== 'terminee'; tour++) {
    const action = await abeilleScriptee(c, abeilles[tour % 3]!);
    if (action?.issue.includes('waiting for the hive owner')) {
      const prop = c.registry.entries.filter((e) => e.nature === 'decoupage_propose').at(-1)!;
      c.decide(makeDecision(fondateur, 'approbation_decoupage', (prop.donnees as { id: string }).id, 'ok'));
    }
  }
  const avecSecret = c.registry.entries.filter((e) => e.nature === 'commande' && (e.donnees as CommandeDonnees).alea_secret?.length);
  assert.ok(avecSecret.length > 0, 'the trap draws are recorded separately');
  assert.ok(avecSecret.every((e) => (e.donnees as CommandeDonnees).balise), 'on requests otherwise drawn with the beacon');
  const report = await auditRegistry(c.registry.entries, { etatAnnonce: c.stateHash(), reverifier: true });
  for (const ch of report.controles) assert.ok(ch.ok, `${ch.nom}: ${ch.detail ?? ''}`);
  const ch = report.controles.find((x) => x.nom === 'Trap cells drawn at each guard’s announced rate')!;
  assert.match(ch.detail!, /single-bug mutant of the real deliverable/);
  assert.ok(c.registry.entries.some((e) => e.nature === 'piege_dejoue' || e.nature === 'piege_valide'), 'traps were indeed drawn');
});

test('audit: a forged mutant report, or a removed secret draw, is exposed', async () => {
  const c = new Coordinator({ fondateur: fondateur.id, params: { alpha_faux: 0.05, taux_pieges: 0.5 }, rng: seededRng(21) });
  c.proposeHive(makeHive(fondateur, { slug: 'maths', nom: 'Maths', objectif: 'x' }), RACINE);
  c.decide(makeDecision(fondateur, 'approbation_ruche', 'maths', 'ok'));
  const abeilles = [kenji, amara, lea];
  for (let tour = 0; tour < 300 && c.hiveView('maths').statut !== 'terminee'; tour++) {
    const action = await abeilleScriptee(c, abeilles[tour % 3]!);
    if (action?.issue.includes('waiting for the hive owner')) {
      const prop = c.registry.entries.filter((e) => e.nature === 'decoupage_propose').at(-1)!;
      c.decide(makeDecision(fondateur, 'approbation_decoupage', (prop.donnees as { id: string }).id, 'ok'));
    }
  }
  assert.equal((await auditRegistry(c.registry.entries, { reverifier: true })).ok, true);

  // A mutant declared "rejected by the guards" although it passes: the re-verification sees it.
  const faux = structuredClone(c.registry.entries);
  const sub = faux.find((e) => e.nature === 'commande' && (e.donnees as CommandeDonnees).type === 'submitResult' && (e.donnees as CommandeDonnees).verifs.length > 1)!;
  const rapports = (sub.donnees as CommandeDonnees).verifs;
  rapports[1] = { ...rapports[1]!, ok: !rapports[1]!.ok };
  const r1 = await auditRegistry(faux, { reverifier: true });
  assert.equal(r1.ok, false);

  // Removing the secret draw from a request: the replay can no longer reproduce it.
  const sansSecret = structuredClone(c.registry.entries);
  const claim = sansSecret.find((e) => e.nature === 'commande' && (e.donnees as CommandeDonnees).alea_secret?.length)!;
  delete (claim.donnees as CommandeDonnees).alea_secret;
  assert.equal((await auditRegistry(sansSecret)).ok, false);
});
