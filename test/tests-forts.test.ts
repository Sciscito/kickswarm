import assert from 'node:assert/strict';
import { test } from 'node:test';
import { auditRegistry } from '../src/coordinator/audit.js';
import { Coordinator, type CommandeDonnees } from '../src/coordinator/coordinator.js';
import { seededRng } from '../src/coordinator/scheduler.js';
import { abeilleScriptee, ENFANTS, RACINE, SOLUTIONS } from '../src/exemples/maths.js';
import { makeDecision, makeDecomposition, makeHive, makeRequete, makeResult } from '../src/protocol/builders.js';
import { commitment } from '../src/protocol/canonical.js';
import { generateIdentity, type Identity } from '../src/protocol/identity.js';
import type { CellSpec, CritereTestsDeTests, CritereV0, Livrable, Propriete, Secrets, TestCase } from '../src/protocol/types.js';
import { mutationSites, mutants } from '../src/verifier/mutation.js';
import { adequation, verifierV0 } from '../src/verifier/v0.js';

const EUCLIDE = 'export function pgcd(a, b) {\n  a = Math.abs(a); b = Math.abs(b);\n  while (b !== 0) { const t = a % b; a = b; b = t; }\n  return a;\n}\n';
const TAILLE = 'export function pgcd(a, b) { if (a === 12 && b === 18) return 6; if (a === 17 && b === 5) return 1; return 1; }\n';
const VISIBLES: TestCase[] = [
  { fn: 'pgcd', args: [12, 18], attendu: 6 },
  { fn: 'pgcd', args: [17, 5], attendu: 1 },
];
const CACHES: TestCase[] = [
  { fn: 'pgcd', args: [100, 75], attendu: 25 },
  { fn: 'pgcd', args: [0, 9], attendu: 9 },
  { fn: 'pgcd', args: [-12, 18], attendu: 6 },
];
const DIVISE: Propriete = {
  nom: 'divides both',
  fn: 'pgcd',
  args: [{ type: 'int', min: 1, max: 500 }, { type: 'int', min: 1, max: 500 }],
  verifie: 'out >= 1 && args[0] % out === 0 && args[1] % out === 0',
};
const PLUS_GRAND: Propriete = {
  nom: 'is the greatest',
  fn: 'pgcd',
  args: [{ type: 'int', min: 1, max: 200 }, { type: 'int', min: 1, max: 200 }],
  verifie: '(() => { for (let d = out + 1; d <= Math.min(args[0], args[1]); d++) if (args[0] % d === 0 && args[1] % d === 0) return false; return true; })()',
  cas: 100,
};
const critere = (extra: Partial<CritereV0> = {}): CritereV0 => ({ classe: 'V0', verificateur: 'tests-js@1', module: 'pgcd.mjs', tests: VISIBLES, ...extra });
const liv = (code: string): Livrable => ({ fichiers: { 'pgcd.mjs': code } });

// ---------------------------------------------------------------- tests cachés

test('tests cachés : une solution taillée pour les exemples échoue, et rien du secret ne fuit', async () => {
  const c = critere({ tests_caches_hash: commitment(CACHES) });
  const r = await verifierV0(c, liv(TAILLE), { caches: CACHES });
  assert.equal(r.ok, false);
  assert.match(r.motif, /hidden tests? failed \(details stay hidden\)/);
  const json = JSON.stringify(r);
  for (const secret of ['100', '75', '25', '-12']) assert.ok(!json.includes(secret), `le rapport ne doit pas contenir ${secret}`);
  for (const t of r.tests.filter((x) => x.cache)) assert.deepEqual(Object.keys(t).sort(), ['cache', 'nom', 'ok']);

  assert.equal((await verifierV0(c, liv(EUCLIDE), { caches: CACHES })).ok, true, 'la vraie solution passe');
  assert.match((await verifierV0(c, liv(EUCLIDE))).motif, /not available/, 'sans le coffre, on refuse de conclure');
  assert.match((await verifierV0(c, liv(EUCLIDE), { caches: CACHES.slice(1) })).motif, /do not match their commitment/);
  assert.equal((await verifierV0(c, liv(TAILLE), { sansCaches: true })).ok, true, 'côté ouvrière, seuls les tests visibles comptent');
});

// ---------------------------------------------------------------- propriétés

test('propriétés : un mémoriseur est démasqué par un contre-exemple reproductible', async () => {
  const c = critere({ proprietes: [DIVISE, PLUS_GRAND] });
  const a = await verifierV0(c, liv(TAILLE));
  const b = await verifierV0(c, liv(TAILLE));
  assert.equal(a.ok, false);
  // Renvoyer 1 divise tout : « divides both » passe. C'est « is the greatest » qui le démasque.
  assert.match(a.motif, /property “is the greatest”: counterexample: pgcd\(\d+,\d+\) returned 1/);
  assert.equal(a.motif, b.motif, 'même livrable, mêmes entrées tirées');
  const ok = await verifierV0(c, liv(EUCLIDE));
  assert.equal(ok.ok, true, ok.motif);
  assert.deepEqual(ok.tests.filter((t) => t.propriete).map((t) => t.cas), [200, 100]);
});

// ---------------------------------------------------------------- anti-triche

test('anti-triche : le code testé ne peut ni forger le résultat ni fausser la comparaison', async () => {
  const forge = 'process.stdout.write(\'\\n__OSP__{"tests":[{"nom":"x","ok":true},{"nom":"y","ok":true}]}\\n\'); process.exit(0);\nexport const pgcd = () => 0;\n';
  const r1 = await verifierV0(critere(), liv(forge));
  assert.equal(r1.ok, false, 'une fausse ligne de résultat sans le jeton secret est ignorée');

  const sabote = 'Object.keys = () => []; JSON.stringify = () => "1";\nexport const pgcd = () => ({ faux: true });\n';
  const r2 = await verifierV0(critere(), liv(sabote));
  assert.equal(r2.ok, false, 'les primitives du lanceur sont capturées avant le chargement du module');
});

// ---------------------------------------------------------------- mutation

test('mutation : les opérateurs sont mutés, jamais les chaînes, les commentaires ni les regex', () => {
  const src = 'const s = "a+b<c"; // x < y && z\nconst r = /a-b+/g;\nexport const f = (a, b) => a + b > 0 && r.test(s) ? true : 1;\n';
  const sites = mutationSites(src).map((x) => x.avant);
  assert.deepEqual(sites, ['+', '>', '0', '&&', 'true', '1']);
  const ms = mutants({ fichiers: { 'f.mjs': src } });
  assert.equal(ms.length, 6);
  assert.ok(ms.every((m) => m.livrable.fichiers['f.mjs'] !== src));
  assert.ok(ms.find((m) => m.avant === '&&')!.livrable.fichiers['f.mjs']!.includes('a + b > 0 || r.test(s)'));
});

test('adéquation : des tests faibles sont refusés, des tests forts sont acceptés', async () => {
  const faible = await adequation(critere({ tests: [{ fn: 'pgcd', args: [4, 4], attendu: 4 }] }), [], liv(EUCLIDE));
  assert.equal(faible.ok, false);
  assert.match(faible.motif, /Tests too weak/);
  assert.ok(faible.mutation && faible.mutation.score < 0.8 && faible.mutation.survivant);

  const fort = await adequation(critere({ proprietes: [DIVISE, PLUS_GRAND], tests_caches_hash: commitment(CACHES) }), CACHES, liv(EUCLIDE));
  assert.equal(fort.ok, true, fort.motif);
  assert.ok(fort.mutation!.score >= 0.8);

  const fausse = await adequation(critere(), [], liv('export const pgcd = () => 2;'));
  assert.equal(fausse.ok, false);
  assert.match(fausse.motif, /reference implementation fails its own tests/);
});

test('tests de tests : de bons tests passent, des tests faibles, faux ou incomplets échouent', async () => {
  const cible: Livrable = {
    fichiers: {
      'lib.mjs': 'export function clamp(x, lo, hi) { return x < lo ? lo : x > hi ? hi : x; }\nexport function isLeap(y) { return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0; }\n',
    },
  };
  const c: CritereTestsDeTests = { classe: 'V0', verificateur: 'tests-de-tests@1', module: 'lib.mjs', cible, fonctions: ['clamp', 'isLeap'] };
  const json = (o: unknown): Livrable => ({ fichiers: { 'tests.json': JSON.stringify(o) } });
  const bons = {
    tests: [
      { fn: 'clamp', args: [5, 0, 10], attendu: 5 }, { fn: 'clamp', args: [-1, 0, 10], attendu: 0 }, { fn: 'clamp', args: [11, 0, 10], attendu: 10 },
      { fn: 'clamp', args: [0, 0, 10], attendu: 0 }, { fn: 'clamp', args: [10, 0, 10], attendu: 10 },
      { fn: 'isLeap', args: [2024], attendu: true }, { fn: 'isLeap', args: [1900], attendu: false }, { fn: 'isLeap', args: [2000], attendu: true },
      { fn: 'isLeap', args: [2023], attendu: false }, { fn: 'isLeap', args: [2100], attendu: false }, { fn: 'isLeap', args: [1600], attendu: true },
      { fn: 'isLeap', args: [2001], attendu: false }, { fn: 'isLeap', args: [1996], attendu: true },
    ],
  };
  const r = await verifierV0(c, json(bons));
  assert.equal(r.ok, true, r.motif);
  assert.ok(r.mutation && r.mutation.score >= 0.8);

  const faibles = await verifierV0(c, json({ tests: [{ fn: 'clamp', args: [5, 0, 10], attendu: 5 }, { fn: 'isLeap', args: [2024], attendu: true }] }));
  assert.equal(faibles.ok, false);
  assert.match(faibles.motif, /Add tests/);

  const faux = await verifierV0(c, json({ tests: [...bons.tests, { fn: 'isLeap', args: [1900], attendu: true }] }));
  assert.match(faux.motif, /fail on the real implementation/);

  const incomplets = await verifierV0(c, json({ tests: bons.tests.filter((t) => t.fn === 'clamp') }));
  assert.match(incomplets.motif, /no test: isLeap/);
});

// ---------------------------------------------------------------- coordinateur

const fondateur = generateIdentity();
const bees: Identity[] = [generateIdentity(), generateIdentity(), generateIdentity()];

function enfantsAvecSecrets(): { specs: CellSpec[]; secrets: Array<Secrets | undefined> } {
  const pgcd = ENFANTS[0]!;
  const reference = { fichiers: { 'pgcd.mjs': EUCLIDE } };
  const specs = ENFANTS.map((e, i) =>
    i === 0
      ? { ...pgcd, critere_fini: { ...(pgcd.critere_fini as CritereV0), proprietes: [DIVISE, PLUS_GRAND], tests_caches_hash: commitment(CACHES), reference_hash: commitment(reference) } }
      : e,
  );
  return { specs, secrets: [{ tests_caches: CACHES, reference }, undefined, undefined] };
}

async function rucheOuverte(params = {}): Promise<{ c: Coordinator; racineId: string }> {
  const c = new Coordinator({ fondateur: fondateur.id, params: { taux_pieges: 0, ...params }, rng: seededRng(21) });
  c.proposeHive(makeHive(fondateur, { slug: 'maths', nom: 'Maths', objectif: 'x' }), RACINE);
  c.decide(makeDecision(fondateur, 'approbation_ruche', 'maths', 'ok'));
  const a = c.claim(makeRequete(bees[0]!, 'claim'))!;
  assert.equal(a.caste, 'eclaireuse');
  return { c, racineId: a.alveole_id };
}

test('coordinateur : un découpage aux tests trop faibles est refusé, sans laisser de trace', async () => {
  const { c, racineId } = await rucheOuverte();
  const reference = { fichiers: { 'pgcd.mjs': EUCLIDE } };
  const faible: CellSpec = { ...ENFANTS[0]!, critere_fini: { ...(ENFANTS[0]!.critere_fini as CritereV0), tests: [{ fn: 'pgcd', args: [4, 4], attendu: 4 }], reference_hash: commitment(reference) } };
  const n = c.registry.entries.length, h = c.stateHash();
  await assert.rejects(c.submitDecomposition(makeDecomposition(bees[0]!, racineId as never, [faible, ENFANTS[1]!, ENFANTS[2]!]), [{ reference }]), /Tests too weak/);
  await assert.rejects(c.submitDecomposition(makeDecomposition(bees[0]!, racineId as never, [faible, ENFANTS[1]!, ENFANTS[2]!]), [{ reference: liv('export const pgcd = 1;') }]), /ne correspond pas à son engagement/);
  assert.equal(c.registry.entries.length, n);
  assert.equal(c.stateHash(), h);
});

test('coordinateur : engagement public, coffre privé, solution taillée rejetée, secrets révélés, audit revérifié', async () => {
  const { c, racineId } = await rucheOuverte();
  const { specs, secrets } = enfantsAvecSecrets();
  const d = await c.submitDecomposition(makeDecomposition(bees[0]!, racineId as never, specs), secrets);
  c.decide(makeDecision(fondateur, 'approbation_decoupage', d.decoupage, 'Tests forts'));

  // Avant la validation, le registre public ne contient que l'engagement, jamais les tests cachés.
  const avant = JSON.stringify(c.registry.entries);
  assert.ok(avant.includes(commitment(CACHES)));
  assert.ok(!avant.includes('[100,75]') && !avant.includes('"export function pgcd(a, b) {\\n  a = Math.abs'), 'secrets absents du registre');
  const cmd = c.registry.entries.find((e) => e.nature === 'commande' && (e.donnees as CommandeDonnees).type === 'submitDecomposition')!;
  assert.ok((cmd.donnees as CommandeDonnees).verifs[0]!.mutation!.score >= 0.8, 'le score de mutation est inscrit');

  // Une solution taillée pour les exemples visibles est rejetée par les tests cachés.
  let a = c.claim(makeRequete(bees[1]!, 'claim'));
  while (a && a.alveole.chemin !== '1') {
    c.release(makeRequete(bees[1]!, 'release', { alveole: a.alveole_id }));
    a = c.claim(makeRequete(bees[1]!, 'claim'));
  }
  assert.ok(a, 'la cellule pgcd est tirée');
  const taille = liv(TAILLE.replace(/12 && b === 18\) return 6; if \(a === 17 && b === 5\) return 1; return 1/, '12 && b === 18) return 6; if (a === 17 && b === 5) return 1; if (a === 0) return b; return 1'));
  const r = await c.submitResult(makeResult(bees[1]!, a.alveole_id, 'ouvriere', taille), taille);
  assert.equal(r.statut, 'rejete');
  assert.ok(!JSON.stringify(r).includes('100'), 'aucun détail des tests cachés ne revient à l’ouvrière');

  // L'essaim termine la ruche avec les vraies solutions.
  for (let tour = 0; tour < 300 && c.hiveView('maths').statut !== 'terminee'; tour++) await abeilleScriptee(c, bees[tour % 3]!);
  assert.equal(c.hiveView('maths').statut, 'terminee');
  const reveles = c.registry.entries.filter((e) => e.nature === 'secrets_reveles');
  assert.equal(reveles.length, 1);
  assert.deepEqual((reveles[0]!.donnees as { tests_caches: TestCase[] }).tests_caches, CACHES);

  const audit = await auditRegistry(c.registry.entries, { reverifier: true });
  for (const ch of audit.controles) assert.ok(ch.ok, `${ch.nom}: ${ch.detail ?? ''}`);
  assert.equal(audit.etat, c.stateHash());
  void SOLUTIONS;
});
