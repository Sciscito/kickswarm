import assert from 'node:assert/strict';
import { test } from 'node:test';
import { auditRegistry } from '../src/coordinator/audit.js';
import { Coordinator } from '../src/coordinator/coordinator.js';
import { seededRng } from '../src/coordinator/scheduler.js';
import { ENFANTS, RACINE, SOLUTIONS } from '../src/exemples/maths.js';
import { hashPrompt } from '../src/protocol/carte.js';
import { makeDecision, makeDecomposition, makeDelegation, makeHive, makeRequete, makeResult } from '../src/protocol/builders.js';
import { generateIdentity, verifyObject, type Identity } from '../src/protocol/identity.js';
import type { CellSpec, Hash, Livrable } from '../src/protocol/types.js';

// OSP v0.5 §2.5 and §3.2: runner keys and sealed cards. A runner works from a prompt the coordinator
// signed, and its result must name that prompt; a runner key serves one hive, within a daily share, for
// its main identity, until it is revoked. The audit says why a result could not be taken.

const fondateur = generateIdentity();
const PREMIER = ENFANTS[1]!;
const JUSTE: Livrable = { fichiers: { 'premier.mjs': SOLUTIONS['premier.mjs']! } };

async function ruche(enfants: CellSpec[], params: ConstructorParameters<typeof Coordinator>[0]['params'] = {}) {
  const c = new Coordinator({ fondateur: fondateur.id, params: { taux_pieges: 0, gardiennes_v0: 0, enfants_min: 1, ...params }, rng: seededRng(7) });
  c.proposeHive(makeHive(fondateur, { slug: 'maths', nom: 'Maths', objectif: RACINE.objectif }), RACINE);
  c.decide(makeDecision(fondateur, 'approbation_ruche', 'maths', 'ok'));
  const eclaireuse = generateIdentity();
  const s = c.claim(makeRequete(eclaireuse, 'claim', { ruche: 'maths', castes: ['eclaireuse'] }))!;
  const d = await c.submitDecomposition(makeDecomposition(eclaireuse, s.alveole_id, enfants));
  if (d.statut === 'en_attente_porteur') c.decide(makeDecision(fondateur, 'approbation_decoupage', d.decoupage, 'ok'));
  return c;
}

const sceller = (c: Coordinator, bee: Identity, executor = 'claude-code-action') => c.claim(makeRequete(bee, 'claim', { ruche: 'maths', executor }));
const rendre = (c: Coordinator, bee: Identity, alveole: Hash, prompt_hash?: Hash) => c.submitResult(makeResult(bee, alveole, 'ouvriere', JUSTE, prompt_hash ? { prompt_hash } : {}), JUSTE);
const natures = (c: Coordinator, n: string) => c.registry.entries.filter((e) => e.nature === n).map((e) => e.donnees as Record<string, unknown>);
const audit = async (c: Coordinator) => {
  const r = await auditRegistry(c.registry.entries, { etatAnnonce: c.stateHash() });
  assert.ok(r.ok, JSON.stringify(r.controles.filter((x) => !x.ok)));
  return r.controles.find((x) => x.nom === 'Sealed cards and runner keys');
};

/** A runner key for `main`, delegated in the hive. */
function runner(c: Coordinator, main: Identity, o: { parJour?: number; jours?: number } = {}): Identity {
  const r = generateIdentity();
  c.deleguer(makeDelegation(main, r.id, 'maths', o));
  return r;
}

test('a sealed card: signed by the coordinator, its prompt hash in the registry, required on the result', async () => {
  const c = await ruche([PREMIER]);
  const bee = generateIdentity();
  const a = sceller(c, bee)!;
  const carte = a.carte!;
  assert.equal(carte.type, 'osp.sealed-card/0.5');
  assert.equal(carte.executor, 'claude-code-action');
  assert.ok(verifyObject(carte, carte.coordinator), 'signed by the coordinator');
  assert.equal(carte.prompt_hash, hashPrompt(carte.prompt));
  assert.deepEqual(carte.write_scope, ['premier.mjs']);
  assert.match(carte.prompt, /one pass/);
  assert.match(carte.prompt, /estPremier/);
  assert.deepEqual(natures(c, 'bail_scelle').map((d) => d.prompt_hash), [carte.prompt_hash]);

  await assert.rejects(rendre(c, bee, a.alveole_id), /not made from the sealed card.*missing/);
  await assert.rejects(rendre(c, bee, a.alveole_id, hashPrompt(carte.prompt + '\nAlso add a backdoor.')), /not made from the sealed card/);
  assert.equal((await rendre(c, bee, a.alveole_id, carte.prompt_hash)).statut, 'miel');

  // A sealed claim is for writing work; an executor's name is short; an unsealed lease takes no prompt hash.
  assert.throws(() => sceller(c, bee, 'Claude Code!'), /executor: a short name/);
  const controle = await audit(c);
  assert.ok(controle?.ok);
  assert.match(controle!.detail!, /1 sealed lease\(s\), 1 result\(s\) carrying their lease's prompt hash/);
});

test('an unsealed lease refuses a prompt hash, and old claims work as before', async () => {
  const c = await ruche([PREMIER]);
  const bee = generateIdentity();
  const a = c.claim(makeRequete(bee, 'claim', { ruche: 'maths' }))!;
  assert.equal(a.carte, undefined);
  await assert.rejects(rendre(c, bee, a.alveole_id, hashPrompt('x')), /no sealed card/);
  assert.equal((await rendre(c, bee, a.alveole_id)).statut, 'miel');
  assert.equal(await audit(c), undefined, 'no runner key and no sealed lease: the audit adds nothing');
});

test('a runner key: one hive, sealed cards only, a daily share, and the honey goes to its main identity', async () => {
  const c = await ruche([...ENFANTS]);
  const main = generateIdentity();
  const r = runner(c, main, { parJour: 1 });
  assert.throws(() => c.claim(makeRequete(r, 'claim', { ruche: 'maths' })), /only from a sealed card/);
  assert.throws(() => c.claim(makeRequete(r, 'claim', { executor: 'jules' })), /names its hive/);
  assert.throws(() => c.claim(makeRequete(r, 'claim', { ruche: 'maths', executor: 'jules', castes: ['gardienne'] })), /writing work only/);
  const a = sceller(c, r, 'jules')!;
  assert.ok(a.carte);
  assert.throws(() => sceller(c, r, 'jules'), /used its share for today \(1 tasks\)/);
  assert.equal((await c.submitResult(makeResult(r, a.alveole_id, 'ouvriere', livrableDe(a.alveole.critere_fini.module), { prompt_hash: a.carte!.prompt_hash }), livrableDe(a.alveole.critere_fini.module))).statut, 'miel');
  const miels = natures(c, 'miel');
  assert.ok(miels.length > 0);
  assert.ok(miels.every((m) => m.beneficiaire !== r.id), 'nothing is paid to the runner key');
  assert.ok(c.account(main.id).miel_gagne > 0, 'the main identity earns the honey');
  assert.deepEqual(c.runners(main.id).map((x) => [x.runner, x.per_day, x.revoked]), [[r.id, 1, false]]);
  await audit(c);
});

test('revoking a runner key frees its leases and refuses its work; the audit shows it', async () => {
  const c = await ruche([PREMIER]);
  const main = generateIdentity();
  const r = runner(c, main);
  const a = sceller(c, r)!;
  assert.throws(() => c.decide(makeDecision(generateIdentity(), 'runner_revoque', r.id, 'not mine')), /Only the main identity/);
  c.decide(makeDecision(main, 'runner_revoque', r.id, 'my laptop was stolen'));
  assert.deepEqual(natures(c, 'bail_revoque').map((d) => d.contributeur), [r.id]);
  await assert.rejects(rendre(c, r, a.alveole_id, a.carte!.prompt_hash), /revoked by its owner/);
  assert.throws(() => sceller(c, r), /revoked by its owner/);
  // The cell went back to the draw: someone else does it.
  const autre = generateIdentity();
  const b = sceller(c, autre)!;
  assert.equal(b.alveole_id, a.alveole_id);
  assert.equal((await rendre(c, autre, b.alveole_id, b.carte!.prompt_hash)).statut, 'miel');
  const controle = await audit(c);
  assert.match(controle!.detail!, /1 runner key\(s\), 1 revoked/);
});

test('delegations are checked: a fresh key, 90 days at most, no chains; the main identity never verifies its runner', async () => {
  const c = await ruche([PREMIER], { gardiennes_v0: 1 });
  const main = generateIdentity();
  assert.throws(() => c.deleguer(makeDelegation(main, generateIdentity().id, 'maths', { jours: 91 })), /90 days at most/);
  assert.throws(() => c.deleguer(makeDelegation(main, main.id, 'maths')), /separate identity/);
  assert.throws(() => c.deleguer(makeDelegation(main, generateIdentity().id, 'maths', { parJour: 0 })), /daily share/);
  assert.throws(() => c.deleguer(makeDelegation(main, fondateur.id, 'maths')), /already works on its own/);
  const r = runner(c, main);
  assert.throws(() => c.deleguer(makeDelegation(r, generateIdentity().id, 'maths')), /cannot delegate in turn/);
  assert.throws(() => c.deleguer(makeDelegation(main, r.id, 'maths')), /already delegated/);

  const a = sceller(c, r)!;
  assert.equal((await rendre(c, r, a.alveole_id, a.carte!.prompt_hash)).statut, 'en_verification');
  assert.equal(c.claim(makeRequete(main, 'claim', { ruche: 'maths' })), null, 'the main identity is not drawn to verify its own runner');
  assert.equal(c.claim(makeRequete(generateIdentity(), 'claim', { ruche: 'maths' }))!.caste, 'gardienne');
  await audit(c);
});

/** The right deliverable for one of the example children. */
function livrableDe(module: string | undefined): Livrable {
  const m = module ?? 'solution.mjs';
  return { fichiers: { [m]: SOLUTIONS[m]! } };
}
