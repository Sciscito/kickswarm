import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Coordinator } from '../src/coordinator/coordinator.js';
import { createCoordinatorServer } from '../src/coordinator/http.js';
import { seededRng } from '../src/coordinator/scheduler.js';
import { RACINE } from '../src/exemples/maths.js';
import { makeDecision, makeHive } from '../src/protocol/builders.js';
import { generateIdentity } from '../src/protocol/identity.js';
import { CoordinatorClient } from '../src/plugin/client.js';
import {
  appliquerOptions,
  chargerParticipation,
  CompteurJour,
  decrire,
  DEFAULT_PARTICIPATION,
  enHeuresCalmes,
  enregistrerParticipation,
  type Participation,
} from '../src/plugin/participation.js';
import { createPluginServer } from '../src/plugin/server.js';

// How a contributor takes part: a default request, presets, options, and a plugin that honours them.

test('participation: the default request, presets and options', () => {
  assert.deepEqual(DEFAULT_PARTICIPATION.roles, ['scout', 'worker', 'builder', 'guard']);
  assert.equal(DEFAULT_PARTICIPATION.parJour, 20);
  const light = appliquerOptions(DEFAULT_PARTICIPATION, { preset: 'light' });
  assert.deepEqual(light.roles, ['guard']);
  const night = appliquerOptions(DEFAULT_PARTICIPATION, { preset: 'night' });
  assert.deepEqual(night.heuresCalmes, [8, 22]);
  const custom = appliquerOptions(light, { roles: 'worker,guard', perDay: '5', quiet: '23-7', ruche: 'text-toolkit' });
  assert.deepEqual(custom.roles, ['worker', 'guard']);
  assert.equal(custom.parJour, 5);
  assert.deepEqual(custom.heuresCalmes, [23, 7]);
  assert.deepEqual(custom.ruches, ['text-toolkit']);
  assert.equal(appliquerOptions(custom, { quiet: 'off' }).heuresCalmes, null);
  assert.equal(appliquerOptions(custom, { pause: true }).pause, true);
  assert.match(decrire(custom), /roles: worker, guard · up to 5 tasks a day · resting from 23:00 to 07:00/);
  for (const bad of [{ roles: 'nope' }, { perDay: '-1' }, { quiet: '25-3' }, { quiet: '7-7' }, { preset: 'turbo' }]) {
    assert.throws(() => appliquerOptions(DEFAULT_PARTICIPATION, bad), /./, JSON.stringify(bad));
  }
});

test('participation: quiet hours wrap around midnight', () => {
  const p = (h: [number, number]): Participation => ({ ...DEFAULT_PARTICIPATION, heuresCalmes: h });
  const at = (h: number) => new Date(2026, 0, 1, h, 30);
  assert.ok(enHeuresCalmes(p([23, 7]), at(23)) && enHeuresCalmes(p([23, 7]), at(3)));
  assert.ok(!enHeuresCalmes(p([23, 7]), at(7)) && !enHeuresCalmes(p([23, 7]), at(12)));
  assert.ok(enHeuresCalmes(p([8, 22]), at(8)) && !enHeuresCalmes(p([8, 22]), at(22)));
  assert.ok(!enHeuresCalmes(DEFAULT_PARTICIPATION, at(3)));
});

test('participation: settings and the daily counter live on the contributor’s machine', () => {
  const home = mkdtempSync(join(tmpdir(), 'osp-participation-'));
  try {
    assert.deepEqual(chargerParticipation(home), DEFAULT_PARTICIPATION, 'nothing saved: the default request');
    enregistrerParticipation(home, appliquerOptions(DEFAULT_PARTICIPATION, { preset: 'light' }));
    assert.deepEqual(chargerParticipation(home).roles, ['guard']);
    const c = new CompteurJour(home);
    assert.equal(c.aujourdhui(), 0);
    c.plusUn();
    c.plusUn();
    assert.equal(new CompteurJour(home).aujourdhui(), 2);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

async function ruche() {
  const fondateur = generateIdentity();
  const coord = new Coordinator({ fondateur: fondateur.id, params: { taux_pieges: 0 }, rng: seededRng(3) });
  coord.proposeHive(makeHive(fondateur, { slug: 'maths', nom: 'Maths', objectif: 'x' }), RACINE);
  coord.decide(makeDecision(fondateur, 'approbation_ruche', 'maths', 'ok'));
  const http = createCoordinatorServer(coord);
  await new Promise<void>((r) => http.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
  return { coord, http, url };
}

async function agent(url: string, participation: Participation, compteur?: { aujourdhui(): number; plusUn(): void }) {
  const mcp = new Client({ name: 'test-agent', version: '1.0.0' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await createPluginServer(new CoordinatorClient(url, generateIdentity()), undefined, { attenteMs: 0, intervalleRevelationMs: 0, participation: () => participation, ...(compteur ? { compteur } : {}) }).connect(b);
  await mcp.connect(a);
  const next = async () => (((await mcp.callTool({ name: 'swarm_next', arguments: {} })) as { content: Array<{ text: string }> }).content.map((c) => c.text).join('\n'));
  return { mcp, next };
}

test('plugin: only the roles the contributor accepts; any other task goes back to the swarm', async () => {
  const { coord, http, url } = await ruche();
  try {
    // The only task is the scout's split of the root: a guard-only bee gives it back.
    const garde = await agent(url, appliquerOptions(DEFAULT_PARTICIPATION, { preset: 'light' }));
    assert.match(await garde.next(), /Nothing matching your settings right now \(you take: guard\)/);
    assert.equal(coord.hiveView('maths').alveoles[0]!.etat, 'libre', 'the cell went straight back to the swarm');
    const tout = await agent(url, DEFAULT_PARTICIPATION);
    assert.match(await tout.next(), /Scout bee/, 'a bee that takes every role gets it');
    await garde.mcp.close();
    await tout.mcp.close();
  } finally {
    http.closeAllConnections();
    await new Promise<void>((r) => http.close(() => r()));
  }
});

test('plugin: pause, quiet hours and the daily share are honoured before any task', async () => {
  const { coord, http, url } = await ruche();
  try {
    const h = new Date().getHours();
    const cases: Array<[Participation, RegExp, { aujourdhui(): number; plusUn(): void }?]> = [
      [{ ...DEFAULT_PARTICIPATION, pause: true }, /paused/],
      [{ ...DEFAULT_PARTICIPATION, heuresCalmes: [h, (h + 1) % 24] }, /Quiet hours/],
      [{ ...DEFAULT_PARTICIPATION, parJour: 3 }, /done its 3 tasks for today/, { aujourdhui: () => 3, plusUn: () => undefined }],
    ];
    for (const [p, attendu, compteur] of cases) {
      const a = await agent(url, p, compteur);
      assert.match(await a.next(), attendu);
      await a.mcp.close();
    }
    assert.equal(coord.hiveView('maths').alveoles[0]!.etat, 'libre', 'no task was taken');
    // A task taken counts toward today's share.
    let n = 0;
    const a = await agent(url, DEFAULT_PARTICIPATION, { aujourdhui: () => n, plusUn: () => void n++ });
    await a.next();
    assert.equal(n, 1);
    await a.mcp.close();
  } finally {
    http.closeAllConnections();
    await new Promise<void>((r) => http.close(() => r()));
  }
});

test('join page: served at /, /join and /join/<hive>; the live hive stays at /hive', async () => {
  const { http, url } = await ruche();
  try {
    for (const path of ['/', '/join', '/join/maths']) {
      const r = await fetch(url + path);
      assert.equal(r.status, 200, path);
      assert.match(await r.text(), /<title>Join the Swarm<\/title>/, path);
    }
    assert.match(await (await fetch(url + '/hive')).text(), /<title>Kickswarm Live Hive<\/title>/);
    assert.notEqual((await fetch(url + '/join/Bad%20Slug!')).status, 200, 'only well-formed hive slugs');
  } finally {
    http.closeAllConnections();
    await new Promise<void>((r) => http.close(() => r()));
  }
});
