import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import type { CritereV0, Livrable } from '../src/protocol/types.js';
import { resolveSandbox, verifierV0 } from '../src/verifier/v0.js';

// Le bac à sable WebAssembly (QuickJS) : ce qu'un livrable malveillant tente chez une gardienne,
// et ce qu'un livrable honnête doit pouvoir faire.

const liv = (code: string, extra: Record<string, string> = {}): Livrable => ({ fichiers: { 'm.mjs': code, ...extra } });
const critere = (tests: CritereV0['tests'], proprietes?: CritereV0['proprietes']): CritereV0 => ({
  classe: 'V0',
  verificateur: 'tests-js@1',
  module: 'm.mjs',
  tests,
  ...(proprietes ? { proprietes } : {}),
  timeout_ms: 3000,
});

test('wasm : le bac à sable par défaut partout, Docker ou non', () => {
  // Un seul moteur pour tout le monde : le même verdict sur chaque machine.
  assert.equal(resolveSandbox('auto'), 'wasm');
  assert.equal(resolveSandbox('wasm'), 'wasm');
  assert.equal(resolveSandbox(''), 'wasm');
  assert.equal(resolveSandbox('process'), 'process', 'le mode processus reste possible, sur demande explicite');
});

test('wasm : aucun accès au réseau, ni par une API, ni par un import', async () => {
  let connexions = 0;
  const serveur = createServer((_req, res) => {
    connexions++;
    res.end('export const x = 1;');
  });
  await new Promise<void>((r) => serveur.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(serveur.address() as AddressInfo).port}/x.mjs`;
  try {
    // Ce qui existe dans l'environnement : rien de ce qui parle au monde extérieur.
    const sonde = `export function sonde() {
      return [typeof fetch, typeof XMLHttpRequest, typeof WebSocket, typeof process, typeof require, typeof setTimeout, typeof Deno, typeof Bun];
    }`;
    const r = await verifierV0(critere([{ fn: 'sonde', args: [], attendu: Array(8).fill('undefined') }]), liv(sonde));
    assert.equal(r.ok, true, r.motif);
    assert.match(r.sandbox, /WebAssembly/);

    for (const tentative of [`await import(${JSON.stringify(url)});`, `await import('node:http');`, `await import('node:net');`, `await fetch(${JSON.stringify(url)});`]) {
      const code = `${tentative}\nexport const f = () => 1;`;
      const rr = await verifierV0(critere([{ fn: 'f', args: [], attendu: 1 }]), liv(code));
      assert.equal(rr.ok, false, tentative);
    }
    assert.equal(connexions, 0, 'aucune connexion n’a atteint le serveur');
  } finally {
    serveur.close();
  }
});

test('wasm : aucun accès au disque ni aux modules du système', async () => {
  for (const spec of ['node:fs', 'fs', 'os', 'std', '../package.json', '/etc/passwd', 'C:/Windows/win.ini', 'node:child_process']) {
    const code = `import * as x from ${JSON.stringify(spec)};\nexport const f = () => 1;`;
    const r = await verifierV0(critere([{ fn: 'f', args: [], attendu: 1 }]), liv(code));
    assert.equal(r.ok, false, spec);
    assert.match(r.motif, /could not be loaded|no network, no disk/, spec);
  }
});

test('wasm : boucle infinie, bombe mémoire et récursion sans fin sont arrêtées proprement', async () => {
  const boucle = await verifierV0(critere([{ fn: 'f', args: [], attendu: 1 }]), liv('export function f() { for (;;) { try { while (true) {} } catch {} } }'));
  assert.equal(boucle.ok, false);
  assert.match(boucle.motif, /Time limit/, 'l’interruption ne se rattrape pas');

  const memoire = await verifierV0(critere([{ fn: 'f', args: [], attendu: 1 }]), liv('export function f() { const a = []; for (;;) a.push(new Array(1e6).fill(7)); }'));
  assert.equal(memoire.ok, false);

  const pile = await verifierV0(critere([{ fn: 'f', args: [], attendu: 1 }]), liv('export function f() { return f() + 1; }'));
  assert.equal(pile.ok, false);
  assert.match(pile.motif, /f\(\)/);
});

for (const sandbox of ['wasm', 'process'] as const) {
  test(`verrouillage (${sandbox}) : un livrable ne peut pas truquer le lanceur ni les propriétés`, async () => {
    const prop = critere([{ fn: 'f', args: [[1, -2]], attendu: false }], [
      { nom: 'tous positifs', fn: 'f', args: [{ type: 'array', of: { type: 'int', min: -5, max: 5 }, maxLen: 5 }], verifie: 'out === args[0].every((x) => x > 0)', cas: 50 },
    ]);
    const honnete = 'export const f = (a) => a.every((x) => x > 0);';
    assert.equal((await verifierV0(prop, liv(honnete), { sandbox })).ok, true);

    const truquages = [
      // Réécrire ce dont dépend l'expression d'une propriété.
      'Array.prototype.every = () => true;\nexport const f = () => true;',
      // Transformer les échecs du rapport en réussites.
      'Array.prototype.push = function (x) { x.ok = true; this[this.length] = x; return this.length; };\nexport const f = () => true;',
      'Object.prototype.toJSON = function () { return { ok: true }; };\nexport const f = () => true;',
      'Object.defineProperty(Object.prototype, "ok", { get: () => true, set() {} });\nexport const f = () => true;',
      // Remplacer une primitive globale.
      'globalThis.JSON = { stringify: () => "{}", parse: JSON.parse };\nexport const f = () => true;',
    ];
    for (const code of truquages) {
      const r = await verifierV0(prop, liv(code), { sandbox });
      assert.equal(r.ok, false, code.split('\n')[0]);
    }
  });

  test(`verrouillage (${sandbox}) : le code ordinaire fonctionne toujours`, async () => {
    // Node exige « with { type: 'json' } » pour importer un JSON ; QuickJS l'accepte tel quel.
    const json = sandbox === 'wasm' ? "import donnees from './d.json';" : "const donnees = { k: 'v' };";
    const code = `${json}
import { double } from './outil.mjs';
class MonErreur extends Error { constructor(m) { super(m); this.name = 'MonErreur'; } }
function Point(x) { this.x = x; }
Point.prototype.toString = function () { return 'P' + this.x; };
export async function f(n) {
  console.log('trace', n);
  const o = { valueOf() { return n; } };
  o.toString = () => 'o';
  const e = new MonErreur('x');
  return [double(+o), String(new Point(n)), e.name, donnees.k, await Promise.resolve(n)];
}`;
    const r = await verifierV0(critere([{ fn: 'f', args: [3], attendu: [6, 'P3', 'MonErreur', 'v', 3] }]), liv(code, { 'outil.mjs': 'export const double = (x) => x * 2;', 'd.json': '{"k":"v"}' }), { sandbox });
    assert.equal(r.ok, true, r.motif);
  });
}

test('wasm : même livrable, même verdict, au détail près', async () => {
  const c = critere([{ fn: 'f', args: [4], attendu: 24 }], [{ nom: 'positif', fn: 'f', args: [{ type: 'int', min: 0, max: 8 }], verifie: 'out >= 1', cas: 100 }]);
  const l = liv('export const f = (n) => (n <= 1 ? 1 : n * f(n - 1));');
  const [a, b] = await Promise.all([verifierV0(c, l), verifierV0(c, l)]);
  assert.deepEqual(a.tests, b.tests);
  assert.equal(a.ok, true, a.motif);
});
