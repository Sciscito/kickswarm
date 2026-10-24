import assert from 'node:assert/strict';
import { test } from 'node:test';
import { auditRegistry } from '../src/coordinator/audit.js';
import { Coordinator } from '../src/coordinator/coordinator.js';
import { seededRng } from '../src/coordinator/scheduler.js';
import { COINS, ENFANTS_ROBLOX, RACINE_ROBLOX, ROBLOX_SCRIPT, SECRETS_ROBLOX, SHOP } from '../src/exemples/roblox.js';
import { directAccess, scriptedBee, type Outcome } from '../src/exemples/scripted-bee.js';
import { makeDecision, makeHive } from '../src/protocol/builders.js';
import { generateIdentity } from '../src/protocol/identity.js';
import type { Assignment, CritereLuau, Livrable } from '../src/protocol/types.js';
import { consignes } from '../src/plugin/consignes.js';
import { mutants } from '../src/verifier/mutation.js';
import { mutationSitesLuau } from '../src/verifier/mutation-luau.js';
import { adequation, verifierV0 } from '../src/verifier/v0.js';

// OSP v0.3 P0-3: tests-luau@1 and luau-checks@1, the Luau mutation engine and the Roblox playbook.
// The Luau virtual machine compiled to WebAssembly (pinned) runs the same everywhere.

const SHOP_CRIT = ENFANTS_ROBLOX[1]!.critere_fini as CritereLuau;
const COINS_CRIT = ENFANTS_ROBLOX[0]!.critere_fini as CritereLuau;
const shop = (src: string): Livrable => ({ fichiers: { 'src/shared/Shop.luau': src } });
const sansPorte = { ...SHOP_CRIT, portes: [] } as CritereLuau;

test('tests-luau@1: visible, hidden and property tests, in the Luau sandbox', async () => {
  const bon = await verifierV0(SHOP_CRIT, shop(SHOP), { caches: SECRETS_ROBLOX[1]!.tests_caches });
  assert.ok(bon.ok, bon.motif);
  assert.match(bon.motif, /4 tests, 3 hidden tests, 1 properties/);
  assert.match(bon.sandbox, /Luau 0\.739/);

  // A subtle bug passes the visible tests and is caught by a hidden one, without revealing it.
  const bug = shop(SHOP.replace('quantity >= 10', 'quantity > 10'));
  assert.ok((await verifierV0(SHOP_CRIT, bug, { sansCaches: true })).ok);
  const pris = await verifierV0(SHOP_CRIT, bug, { caches: SECRETS_ROBLOX[1]!.tests_caches });
  assert.ok(!pris.ok);
  assert.match(pris.motif, /1 hidden test failed \(details stay hidden\)/);

  // A visible failure says what came back, a property gives its counterexample.
  const faux = await verifierV0(sansPorte, shop(SHOP.replace('unit * quantity', 'unit * quantity + 1')), { sansCaches: true });
  assert.match(faux.motif, /price\("sword",2\) → got 101, expected 100/);
  const negatif = await verifierV0(sansPorte, shop(SHOP.replace('return 0\n  end', 'return -1\n  end')), { sansCaches: true });
  assert.match(negatif.motif, /property “never negative”: counterexample: price\[".*",-?\d+\] returned -1|price\("dragon",1\) → got -1/);

  // Tables are compared by content, whatever their metatables say.
  const panier = await verifierV0({ ...sansPorte, tests: [{ fn: 'total', args: [{ potion: 10, shield: 1 }], attendu: 75 }] }, shop(SHOP), { sansCaches: true });
  assert.ok(panier.ok, panier.motif);
});

test('tests-luau@1: the sandbox gives the language and the deliverable, nothing else', async () => {
  const essai = async (code: string, crit: CritereLuau = { ...sansPorte, tests: [{ fn: 'price', args: ['sword', 2], attendu: 100 }], proprietes: [] }) =>
    verifierV0(crit, shop(SHOP.replace('local Shop = {}', `local Shop = {}\n${code}`)), { sansCaches: true });
  for (const [code, attendu] of [
    ['local _ = game:GetService("Players")', /attempt to index nil/],
    ['local _ = os.time()', /attempt to index nil/],
    ['local _ = debug.info(1, "s")', /attempt to index nil/],
    ['getfenv(2).x = 1', /attempt to call a nil value/],
    ['_G.setfenv(0, {})', /attempt to call a nil value/],
    ['string.rep = nil', /readonly/],
    ['local _ = require(script.Parent.Coins)', /attempt to index nil|relative path/],
    ['local _ = require("../../../etc/passwd")', /leaves the deliverable/],
  ] as const) {
    const r = await essai(code);
    assert.ok(!r.ok, code);
    assert.match(r.motif, attendu, code);
  }
  // Endless loop and memory bomb: stopped.
  assert.match((await essai('while true do end', { ...sansPorte, timeout_ms: 500 })).motif, /Time limit exceeded/);
  assert.ok(!(await essai('local t = {} for i = 1, 1e9 do t[i] = string.rep("x", 1000) end')).ok);
  // A forged result (a table that claims to equal everything) fails.
  const forge = await verifierV0(sansPorte, shop('return setmetatable({}, { __index = function() return function() return setmetatable({}, { __eq = function() return true end }) end end })'), { sansCaches: true });
  assert.ok(!forge.ok);
  // math.random is seeded by the deliverable: two runs, the same verdict.
  const hasard = shop(SHOP.replace('return total\nend', 'return total + (math.random(1, 2) - 1) * 0\nend'));
  const [a, b] = [await verifierV0(sansPorte, hasard, { sansCaches: true }), await verifierV0(sansPorte, hasard, { sansCaches: true })];
  assert.deepEqual(a.tests, b.tests);
});

test('luau-checks@1: strict types and the linter, on the deliverable’s own files only', async () => {
  const livrable = (src: string): Livrable => ({ fichiers: { 'src/shared/Shop.luau': src }, contexte: { 'src/shared/Old.luau': 'local unused = 1\nreturn {}\n' } });
  assert.ok((await verifierV0(SHOP_CRIT, livrable(SHOP), { sansCaches: true })).ok, 'a problem in a file only read does not count');
  for (const [src, attendu] of [
    [SHOP.replace('local sum = 0', 'local sum: string = 0'), /type error/],
    [SHOP.replace('local Shop = {}', 'local Shop = {}\nlocal oops = 1'), /lint LocalUnused/],
    [SHOP.replace('--!strict', '--!nocheck'), /“--!nocheck” is not allowed/],
    [SHOP.replace('--!strict', '--!nolint'), /“--!nolint” is not allowed/],
  ] as const) {
    const r = await verifierV0(SHOP_CRIT, livrable(src), { sansCaches: true });
    assert.ok(!r.ok);
    assert.match(r.motif, /^luau-checks@1: /);
    assert.match(r.motif, attendu);
  }
});

test('Luau mutation engine: operators, constants and math functions, never strings, comments or types', () => {
  const src = '--!strict\n-- a == b in a comment\nexport type P = { n: number, f: (number) -> number }\nlocal function f(x: number?): number\n  local s = "a < b"\n  if x and not (x <= 3) then return math.floor(x * 2) end\n  return -1\nend\nreturn { f = f, t = [[x == 1]] }\n';
  const sites = mutationSitesLuau(src).map((s) => `${s.avant}→${s.apres}`);
  assert.deepEqual(sites, ['and→or', 'not →', '<=→<', '3→4', 'floor→ceil', '*→/', '2→3', '1→0']);
  // Engine version 3 mutates Luau; a registry that announced version 2 replays without it.
  assert.equal(mutants(shop(SHOP), { version: 2 }).length, 0);
  assert.ok(mutants(shop(SHOP), { version: 3, max: 100 }).length >= 10);
});

test('test strength in Luau: weak tests are refused, strong ones measured', async () => {
  const caches = SECRETS_ROBLOX[0]!.tests_caches!;
  const fort = await adequation(COINS_CRIT, caches, { fichiers: { 'src/shared/Coins.luau': COINS } }, { moteurMutation: 3 });
  assert.ok(fort.ok, fort.motif);
  assert.equal(fort.mutation!.score, 1);
  const faible = await adequation({ ...COINS_CRIT, tests: COINS_CRIT.tests.slice(0, 2), proprietes: [], tests_caches_hash: undefined }, [], { fichiers: { 'src/shared/Coins.luau': COINS } }, { moteurMutation: 3 });
  assert.ok(!faible.ok);
  assert.match(faible.motif, /Tests too weak: src\/shared\/Coins\.luau:\d+/);
});

test('a Roblox hive in Luau: the playbook guides the bees, a guard catches a Luau trap, the audit replays every verification', async () => {
  const fondateur = generateIdentity();
  assert.throws(
    () => new Coordinator({ fondateur: fondateur.id }).proposeHive(makeHive(fondateur, { slug: 'game-x', nom: 'X', objectif: 'x', playbook: 'nope' }), RACINE_ROBLOX),
    /Unknown playbook/,
  );
  const c = new Coordinator({ fondateur: fondateur.id, params: { alpha_faux: 0.05, taux_pieges: 0.6 }, rng: seededRng(11) });
  c.proposeHive(makeHive(fondateur, { slug: 'obby', nom: 'Obby', objectif: 'A Roblox obstacle game', playbook: 'roblox-pure-logic-first' }), RACINE_ROBLOX);
  c.decide(makeDecision(fondateur, 'approbation_ruche', 'obby', 'ok'));

  // What the plugin would tell each role: Luau, the gate, and the playbook's part.
  const vues: Assignment[] = [];
  const abeilles = Array.from({ length: 5 }, () => generateIdentity());
  const issues: Outcome[] = [];
  for (let tour = 0; tour < 300 && c.hiveView('obby').statut !== 'terminee'; tour++) {
    const h = directAccess(c, abeilles[tour % abeilles.length]!, 'obby');
    const reclamer = h.claim;
    h.claim = async () => {
      const a = await reclamer();
      if (a) vues.push(a);
      return a;
    };
    const a = await scriptedBee(h, ROBLOX_SCRIPT);
    if (!a) continue;
    issues.push(a.outcome);
    if (a.outcome === 'decomposition_proposed' && a.decoupage) c.decide(makeDecision(fondateur, 'approbation_decoupage', a.decoupage, 'Pure modules first'));
  }
  assert.equal(c.hiveView('obby').statut, 'terminee', `the Luau hive is complete (${issues.join(', ')})`);
  assert.ok(issues.includes('trap_caught'), 'a guard caught a mutated Luau deliverable');
  assert.ok(!issues.includes('trap_missed'));

  const eclaireuse = vues.find((v) => v.caste === 'eclaireuse')!;
  const ouvriere = vues.find((v) => v.caste === 'ouvriere')!;
  const batisseuse = vues.find((v) => v.caste === 'batisseuse')!;
  assert.equal(ouvriere.playbook, 'roblox-pure-logic-first');
  assert.match(consignes(eclaireuse), /## Playbook: Roblox game: pure logic first[\s\S]*Split into pure modules and thin glue/);
  assert.match(consignes(eclaireuse), /"tests-luau@1"/);
  const travail = consignes(ouvriere);
  assert.match(travail, /A Luau module `src\/shared\/(Coins|Shop)\.luau` that returns a table/);
  assert.match(travail, /luau-checks@1/);
  assert.match(travail, /require\("\.\/Coins"\)/);
  assert.match(consignes(batisseuse), /```lua\n--!strict/);

  // The audit replays everything and re-runs each verification in its own Luau sandbox.
  const report = await auditRegistry(c.registry.entries, { reverifier: true, etatAnnonce: c.stateHash() });
  assert.ok(report.ok, JSON.stringify(report.controles.filter((x) => !x.ok)));
  assert.match(report.controles.find((x) => x.nom.startsWith('Verifier reports reproduced'))!.detail ?? '', /Luau 0\.739/);
  assert.match(report.controles.find((x) => x.nom.startsWith('Trap cells'))!.detail!, /[1-9]\d* trap\(s\)/);
});
