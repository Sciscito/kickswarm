import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { Coordinator } from '../src/coordinator/coordinator.js';
import { createCoordinatorServer } from '../src/coordinator/http.js';
import { SOLUTIONS_BENCHMARK } from '../src/exemples/lancement/benchmark.js';
import { EXEMPLES_BOUCLIER } from '../src/exemples/lancement/bouclier.js';
import { lancerProjet, PROJETS } from '../src/exemples/lancement/index.js';
import { SOLUTIONS_KICKSWARM } from '../src/exemples/lancement/kickswarm.js';
import { generateIdentity } from '../src/protocol/identity.js';
import type { CritereTestsDeTests, CritereV0 } from '../src/protocol/types.js';
import { CoordinatorClient } from '../src/plugin/client.js';
import { adequation, verifierV0 } from '../src/verifier/v0.js';

// The launch projects of docs/projets.md: every prepared cell can be done (its reference passes its own
// tests and hidden tests, and its tests are strong enough), every test-writing cell has a suite that
// passes, and `kickswarm launch` opens them on a coordinator.

const SOLUTIONS: Record<string, string> = { ...SOLUTIONS_KICKSWARM, ...SOLUTIONS_BENCHMARK };

for (const p of Object.values(PROJETS)) {
  test(`${p.slug}: every prepared cell can be done, and its tests are strong`, async () => {
    for (const [i, e] of p.enfants.entries()) {
      const c = e.critere_fini;
      if (c.verificateur === 'tests-js@1') {
        const module = (c as CritereV0).module!;
        const s = p.secrets[i]!;
        const r = await verifierV0(c, { fichiers: { [module]: SOLUTIONS[module]! } }, { caches: s.tests_caches ?? [] });
        assert.ok(r.ok, `${module}: ${r.motif}`);
        if (s.reference) {
          const a = await adequation(c, s.tests_caches ?? [], s.reference, { moteurMutation: 3 });
          assert.ok(a.ok, `${module}: ${a.motif}`);
        }
      } else if (c.verificateur === 'tests-de-tests@1') {
        const module = (c as CritereTestsDeTests).module;
        const r = await verifierV0(c, { fichiers: { 'tests.json': JSON.stringify(EXEMPLES_BOUCLIER[module]) } });
        assert.ok(r.ok, `${module}: ${r.motif}`);
      }
    }
  });
}

test('kickswarm launch: the three projects open on a coordinator, ready for every bee', async () => {
  const fondateur = generateIdentity();
  const c = new Coordinator({ fondateur: fondateur.id, params: { taux_pieges: 0 } });
  const http = createCoordinatorServer(c);
  await new Promise<void>((ok) => http.listen(0, '127.0.0.1', ok));
  const url = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
  try {
    const client = new CoordinatorClient(url, fondateur);
    for (const p of Object.values(PROJETS)) {
      const r = await lancerProjet(client, p);
      assert.equal(r.cellules, p.enfants.length);
      const t = c.tableauProjet(p.slug);
      assert.equal(t.ruche.statut, 'active');
      assert.equal(t.branches.length, p.enfants.length);
      assert.deepEqual(t.attente, [], `${p.slug}: nothing waits for a human`);
    }
    // Running it again is harmless.
    await lancerProjet(client, PROJETS['uncopyable-benchmark']!).catch((e: Error) => assert.match(e.message, /scout|lease|cell/i));
    // Someone else's coordinator: the project waits for its founder.
    const autre = new CoordinatorClient(url, generateIdentity());
    const p = { ...PROJETS['open-source-shield']!, slug: 'shield-elsewhere' };
    assert.deepEqual(await lancerProjet(autre, p), { cellules: 0 });
    assert.equal(c.tableauProjet('shield-elsewhere').attente[0]?.type, 'approbation_ruche');
  } finally {
    http.closeAllConnections();
    await new Promise<void>((ok) => http.close(() => ok()));
  }
});
