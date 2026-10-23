import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Coordinator } from '../src/coordinator/coordinator.js';
import { createCoordinatorServer } from '../src/coordinator/http.js';
import { seededRng } from '../src/coordinator/scheduler.js';
import { ENFANTS, RACINE, SOLUTIONS } from '../src/exemples/maths.js';
import { makeDecision, makeHive, makeRequete } from '../src/protocol/builders.js';
import { generateIdentity, signObject } from '../src/protocol/identity.js';
import { CoordinatorClient } from '../src/plugin/client.js';
import type { CritereV0 } from '../src/protocol/types.js';
import { createPluginServer } from '../src/plugin/server.js';

type Texte = { content: Array<{ type: string; text: string }>; isError?: boolean };
const texte = (r: unknown) => (r as Texte).content.map((c) => c.text).join('\n');

test('plugin MCP + API HTTP : un agent rejoint, découpe, livre, et la ruche avance', async () => {
  const fondateur = generateIdentity();
  const coord = new Coordinator({ fondateur: fondateur.id, params: { taux_pieges: 0 }, rng: seededRng(3) });
  const http = createCoordinatorServer(coord);
  await new Promise<void>((r) => http.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;

  try {
    const porteur = new CoordinatorClient(url, fondateur);
    await porteur.proposeHive(makeHive(fondateur, { slug: 'maths', nom: 'Maths', objectif: 'Mini-bibliothèque' }), RACINE);
    await porteur.decide(makeDecision(fondateur, 'approbation_ruche', 'maths', 'Conforme à la charte'));

    // Sécurité de l'API : signature falsifiée et rejeu refusés.
    const req = makeRequete(fondateur, 'claim');
    const falsifiee = { ...req, contributeur: generateIdentity().id };
    const r1 = await fetch(`${url}/v0/work/claim`, { method: 'POST', body: JSON.stringify(falsifiee) });
    assert.equal(r1.status, 401);
    await fetch(`${url}/v0/work/release`, { method: 'POST', body: JSON.stringify(signObject({ ...makeRequete(fondateur, 'release') }, fondateur)) });

    // Un agent branché sur le plugin.
    const abeille = generateIdentity();
    const mcp = new Client({ name: 'agent-de-test', version: '1.0.0' });
    const [cote1, cote2] = InMemoryTransport.createLinkedPair();
    await createPluginServer(new CoordinatorClient(url, abeille)).connect(cote2);
    await mcp.connect(cote1);

    const outils = (await mcp.listTools()).tools.map((t) => t.name).sort();
    assert.deepEqual(outils, ['hive_board', 'swarm_decompose', 'swarm_join', 'swarm_leave', 'swarm_next', 'swarm_status', 'swarm_submit']);

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

    // Un livrable faux n'est même pas envoyé : le plugin teste d'abord en local.
    const faux = (await mcp.callTool({ name: 'swarm_submit', arguments: { fichiers: { [module]: 'export const x = 1;' } } })) as Texte;
    assert.equal(faux.isError, true);
    assert.match(texte(faux), /Nothing was sent/);

    const ok = texte(await mcp.callTool({ name: 'swarm_submit', arguments: { fichiers: { [module]: SOLUTIONS[module]! } } }));
    assert.match(ok, /en_verification/);
    assert.match(texte(await mcp.callTool({ name: 'swarm_status', arguments: {} })), /Reputation/);
    assert.match(texte(await mcp.callTool({ name: 'hive_board', arguments: {} })), /empty/, 'rien n’est encore validé ni rejeté');

    await mcp.close();
  } finally {
    await new Promise<void>((r) => http.close(() => r()));
  }
});
