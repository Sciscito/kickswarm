import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canonicalize, hashOf } from '../src/protocol/canonical.js';
import { generateIdentity, signObject, verifyObject } from '../src/protocol/identity.js';
import { canTransition, transition } from '../src/coordinator/lifecycle.js';
import { Registry, verifyRegistry } from '../src/coordinator/registry.js';
import { chooseCandidate, sampleBeta, seededRng } from '../src/coordinator/scheduler.js';

test('JSON canonique : clés triées, imbrication, undefined omis', () => {
  assert.equal(canonicalize({ b: 1, a: { d: [1, 'x'], c: null }, z: undefined }), '{"a":{"c":null,"d":[1,"x"]},"b":1}');
  assert.throws(() => canonicalize({ x: Number.NaN }));
});

test('hash : identique quel que soit l’ordre des clés, et sans la signature', () => {
  assert.equal(hashOf({ a: 1, b: 2 }), hashOf({ b: 2, a: 1 }));
  assert.equal(hashOf({ a: 1, sig: 'xyz' }), hashOf({ a: 1 }));
  assert.match(hashOf({ a: 1 }), /^sha256:[0-9a-f]{64}$/);
});

test('signatures : identité hybride post-quantique par défaut ; valide, altérée, mauvais signataire', () => {
  const alice = generateIdentity();
  const bob = generateIdentity();
  assert.match(alice.id, /^pq1:[A-Za-z0-9_-]{43}$/);
  const signed = signObject({ type: 'test', valeur: 42 }, alice);
  assert.equal(verifyObject(signed, alice.id), true);
  assert.equal(verifyObject({ ...signed, valeur: 43 }, alice.id), false);
  assert.equal(verifyObject(signed, bob.id), false);
  assert.equal(verifyObject({ type: 'test' }, alice.id), false);
});

test('cycle de vie : transitions permises et interdites (§5)', () => {
  assert.equal(canTransition('libre', 'reservee'), true);
  assert.equal(canTransition('en_verification', 'miel'), true);
  assert.equal(canTransition('miel', 'libre'), false);
  assert.equal(canTransition('libre', 'miel'), false);
  const rec = { state: 'rejetee' as const } as { state: Parameters<typeof transition>[0]['state'] };
  transition(rec, 'libre');
  assert.equal(rec.state, 'libre');
  assert.throws(() => transition(rec, 'miel'), /Transition interdite/);
});

test('registre : chaînage vérifiable, toute altération détectée', () => {
  const reg = new Registry();
  reg.append('a', { x: 1 });
  reg.append('b', { y: 2 });
  reg.append('c', { z: 3 });
  assert.deepEqual(verifyRegistry(reg.entries), { ok: true });
  const falsifie = reg.entries.map((e) => ({ ...e }));
  falsifie[1] = { ...falsifie[1]!, donnees: { y: 999 } };
  assert.equal(verifyRegistry(falsifie).ok, false);
});

test('ordonnancement : Beta dans [0,1], orientation et profondeur respectées', () => {
  const rng = seededRng(42);
  for (let i = 0; i < 200; i++) {
    const x = sampleBeta(1.5, 3, rng);
    assert.ok(x > 0 && x < 1);
  }
  const candidats = [
    { chemin: '1.1', profondeur: 2 },
    { chemin: '1', profondeur: 1 },
    { chemin: '2.3', profondeur: 2 },
  ];
  const compte: Record<string, number> = { '1': 0, '2': 0 };
  for (let i = 0; i < 2000; i++) {
    const c = chooseCandidate(candidats, {
      stats: () => ({ succes: 0, echecs: 0 }),
      multiplicateur: (b) => (b === '2' ? 5 : 1),
      plancher: 0.05,
      rng,
    })!;
    compte[c.chemin.split('.')[0]!]!++;
    if (c.chemin.startsWith('1')) assert.equal(c.chemin, '1.1', 'la plus profonde de la branche d’abord');
  }
  assert.ok(compte['2']! > compte['1']! * 2, `l’orientation ×5 doit dominer (${JSON.stringify(compte)})`);
  assert.ok(compte['1']! > 0, 'le plancher anti-famine laisse vivre l’autre branche');
});
