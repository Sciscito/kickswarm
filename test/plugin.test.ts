import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Coordinator } from '../src/coordinator/coordinator.js';
import { createCoordinatorServer } from '../src/coordinator/http.js';
import { seededRng } from '../src/coordinator/scheduler.js';
import { ENFANTS, RACINE, SOLUTIONS } from '../src/exemples/maths.js';
import { makeDecision, makeDecomposition, makeHive, makeRequete, makeResult } from '../src/protocol/builders.js';
import { Scelles } from '../src/plugin/scelles.js';
import { generateIdentity, signObject } from '../src/protocol/identity.js';
import { CoordinatorClient } from '../src/plugin/client.js';
import type { CritereV0 } from '../src/protocol/types.js';
import { JournalLocal } from '../src/plugin/journal.js';
import { createPluginServer } from '../src/plugin/server.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

type Texte = { content: Array<{ type: string; text: string }>; isError?: boolean };
const texte = (r: unknown) => (r as Texte).content.map((c) => c.text).join('\n');

test('MCP plugin + HTTP API: an agent joins, splits, delivers, and the hive moves forward', async () => {
  const fondateur = generateIdentity();
  const coord = new Coordinator({ fondateur: fondateur.id, params: { alpha_faux: 0.05, taux_pieges: 0 }, rng: seededRng(3) });
  const http = createCoordinatorServer(coord);
  await new Promise<void>((r) => http.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;

  try {
    const porteur = new CoordinatorClient(url, fondateur);
    await porteur.proposeHive(makeHive(fondateur, { slug: 'maths', nom: 'Maths', objectif: 'Mini-bibliothèque' }), RACINE);
    await porteur.decide(makeDecision(fondateur, 'approbation_ruche', 'maths', 'Conforme à la charte'));

    // API security: forged signature and replay refused.
    const req = makeRequete(fondateur, 'claim');
    const falsifiee = { ...req, contributeur: generateIdentity().id };
    const r1 = await fetch(`${url}/v0/work/claim`, { method: 'POST', body: JSON.stringify(falsifiee) });
    assert.equal(r1.status, 401);
    await fetch(`${url}/v0/work/release`, { method: 'POST', body: JSON.stringify(signObject({ ...makeRequete(fondateur, 'release') }, fondateur)) });

    // An agent plugged into the plugin.
    const abeille = generateIdentity();
    const mcp = new Client({ name: 'test-agent', version: '1.0.0' });
    const [cote1, cote2] = InMemoryTransport.createLinkedPair();
    const home = mkdtempSync(join(tmpdir(), 'osp-journal-'));
    const journal = new JournalLocal(home);
    await createPluginServer(new CoordinatorClient(url, abeille), journal).connect(cote2);
    await mcp.connect(cote1);

    const outils = (await mcp.listTools()).tools.map((t) => t.name).sort();
    assert.deepEqual(outils, ['hive_board', 'swarm_decompose', 'swarm_join', 'swarm_journal', 'swarm_leave', 'swarm_next', 'swarm_status', 'swarm_submit']);

    assert.match(texte(await mcp.callTool({ name: 'swarm_join', arguments: { ruche: 'maths' } })), /You joined “Maths”/);
    const eclaireuse = texte(await mcp.callTool({ name: 'swarm_next', arguments: {} }));
    assert.match(eclaireuse, /Scout bee/);
    assert.match(eclaireuse, /<capsule>/);

    const enfants = ENFANTS.map((e) => ({ objectif: e.objectif, capsule: e.capsule, atomique: e.atomique, critere_fini: { module: (e.critere_fini as CritereV0).module!, tests: (e.critere_fini as CritereV0).tests } }));
    assert.match(texte(await mcp.callTool({ name: 'swarm_decompose', arguments: { enfants } })), /hive owner/);
    const enAttente = coord.hiveView('maths');
    assert.equal(enAttente.alveoles[0]!.etat, 'en_verification');

    const registre = (await porteur.registry()) as Array<{ nature: string; donnees: { id?: string } }>;
    const decoupage = registre.filter((e) => e.nature === 'decoupage_propose').at(-1)!.donnees.id!;
    await porteur.decide(makeDecision(fondateur, 'approbation_decoupage', decoupage, 'Bon découpage'));

    const ouvriere = texte(await mcp.callTool({ name: 'swarm_next', arguments: {} }));
    assert.match(ouvriere, /Worker bee/);
    const module = /named `([^`]+)`/.exec(ouvriere)![1]!;

    // A wrong deliverable is not even sent: the plugin tests locally first.
    const faux = (await mcp.callTool({ name: 'swarm_submit', arguments: { fichiers: { [module]: 'export const x = 1;' } } })) as Texte;
    assert.equal(faux.isError, true);
    assert.match(texte(faux), /Nothing was sent/);

    const ok = texte(await mcp.callTool({ name: 'swarm_submit', arguments: { fichiers: { [module]: SOLUTIONS[module]! } } }));
    assert.match(ok, /en_verification/);
    assert.match(texte(await mcp.callTool({ name: 'swarm_status', arguments: {} })), /Reputation/);
    assert.match(texte(await mcp.callTool({ name: 'hive_board', arguments: {} })), /empty/, 'nothing is validated or rejected yet');

    // The local journal recorded everything: what the AI was asked, and everything it sent.
    const natures = journal.dernieres(100).map((e) => e.nature);
    for (const n of ['rejoint', 'consigne', 'decoupage', 'controle_local', 'livraison']) assert.ok(natures.includes(n), `journal: ${n}`);
    const consigne = journal.dernieres(100).find((e) => e.nature === 'consigne' && (e.donnees as { caste: string }).caste === 'ouvriere')!;
    assert.match((consigne.donnees as { consignes: string }).consignes, /Worker bee/, 'the full instructions are kept');
    const livraison = journal.dernieres(100).find((e) => e.nature === 'livraison')!;
    assert.equal((livraison.donnees as { fichiers: Record<string, string> }).fichiers[module], SOLUTIONS[module], 'the code sent is kept as is');
    assert.deepEqual(journal.verifier(), { ok: true });
    const vue = texte(await mcp.callTool({ name: 'swarm_journal', arguments: { n: 10 } }));
    assert.match(vue, /delivered cell/);
    assert.match(vue, /local check failed/);

    await mcp.close();
    rmSync(home, { recursive: true, force: true });
  } finally {
    await new Promise<void>((r) => http.close(() => r()));
  }
});

test('guard plugin: the verdict goes out sealed, stays on disk, and reveals itself once the other guard has committed', async () => {
  const fondateur = generateIdentity();
  const [lea, kenji, sami] = [generateIdentity(), generateIdentity(), generateIdentity()];
  const coord = new Coordinator({ fondateur: fondateur.id, params: { alpha_faux: 0.05, taux_pieges: 0 }, rng: seededRng(3) });
  coord.proposeHive(makeHive(fondateur, { slug: 'maths', nom: 'Maths', objectif: 'x' }), RACINE);
  coord.decide(makeDecision(fondateur, 'approbation_ruche', 'maths', 'ok'));
  const s = coord.claim(makeRequete(lea, 'claim'))!;
  const d = await coord.submitDecomposition(makeDecomposition(lea, s.alveole_id, ENFANTS));
  coord.decide(makeDecision(fondateur, 'approbation_decoupage', d.decoupage, 'ok'));
  const a = coord.claim(makeRequete(kenji, 'claim'))!;
  const mod = (a.alveole.critere_fini as CritereV0).module!;
  const livrable = { fichiers: { [mod]: SOLUTIONS[mod]! } };
  await coord.submitResult(makeResult(kenji, a.alveole_id, 'ouvriere', livrable), livrable);
  // The other cells are taken: the only task left is a verification.
  for (const bee of [lea, sami]) {
    for (let i = 0; i < 30; i++) {
      const g = coord.claim(makeRequete(bee, 'claim'))!;
      if (!g.a_verifier) break;
      coord.release(makeRequete(bee, 'release', { alveole: g.alveole_id }));
    }
  }
  assert.ok(!coord.hiveView('maths').alveoles.some((x) => x.etat === 'libre'));

  const http = createCoordinatorServer(coord);
  await new Promise<void>((r) => http.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
  const home = mkdtempSync(join(tmpdir(), 'osp-scelles-'));
  const agent = async (nom: string, opts: { scelles?: Scelles; intervalleRevelationMs?: number } = {}) => {
    const mcp = new Client({ name: nom, version: '1.0.0' });
    const [cote1, cote2] = InMemoryTransport.createLinkedPair();
    const journal = new JournalLocal(join(home, nom));
    await createPluginServer(new CoordinatorClient(url, generateIdentity()), journal, { intervalleRevelationMs: 0, ...opts }).connect(cote2);
    await mcp.connect(cote1);
    await mcp.callTool({ name: 'swarm_join', arguments: { ruche: 'maths' } });
    return { mcp, journal };
  };
  try {
    const fichier = join(home, 'verdicts-scelles.json');
    const scellesA = new Scelles(fichier);
    const A = await agent('a', { scelles: scellesA, intervalleRevelationMs: 50 });
    const B = await agent('b');

    const premiere = texte(await A.mcp.callTool({ name: 'swarm_next', arguments: {} }));
    assert.match(premiere, /Drawn as a guard/);
    assert.match(premiere, /Your verdict is sealed: only its hash was sent/);
    assert.equal(new Scelles(fichier).tous.length, 1, 'the sealed verdict, salt included, is kept on disk');

    const seconde = texte(await B.mcp.callTool({ name: 'swarm_next', arguments: {} }));
    // B opens the reveal and reveals at once; A's plugin may have revealed just before.
    assert.match(seconde, /Verdict recorded: (en_verification|miel)/, 'the second guard opens the reveal and reveals at once');

    // A's plugin reveals in the background, without waiting for its AI to call a tool again.
    const fini = () => coord.hiveView('maths').progression.miel === 1 && new Scelles(fichier).tous.length === 0;
    for (let i = 0; i < 100 && !fini(); i++) await new Promise((r) => setTimeout(r, 30));
    assert.equal(coord.hiveView('maths').progression.miel, 1, 'both verdicts revealed: the cell becomes honey');
    assert.equal(new Scelles(fichier).tous.length, 0);
    const natures = A.journal.dernieres(50).map((e) => e.nature);
    assert.ok(natures.includes('engagement') && natures.includes('verdict'), natures.join(', '));
    await A.mcp.close();
    await B.mcp.close();
  } finally {
    await new Promise<void>((r) => http.close(() => r()));
    rmSync(home, { recursive: true, force: true });
  }
});
