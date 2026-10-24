import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Coordinator } from '../src/coordinator/coordinator.js';
import { Garde } from '../src/coordinator/garde.js';
import { createCoordinatorServer, type OptionsServeur } from '../src/coordinator/http.js';
import { Hote } from '../src/coordinator/hote.js';
import { lancerProjet, PROJETS } from '../src/exemples/lancement/index.js';
import { CoordinatorClient } from '../src/plugin/client.js';
import { makeHive } from '../src/protocol/builders.js';
import { generateIdentity, type Identity } from '../src/protocol/identity.js';

// The public coordinator (`kickswarm coordinator --public`, docs/deploy.md): budgets per address,
// capped streams, a bounded queue for heavy work, the home page's counters, the package it serves,
// and the prepared projects that open by themselves at every start.

async function demarrer(options: OptionsServeur = {}, fondateur: Identity = generateIdentity()) {
  const c = new Coordinator({ fondateur: fondateur.id, params: { taux_pieges: 0 } });
  const http = createCoordinatorServer(c, new Hote(c), options);
  await new Promise<void>((ok) => http.listen(0, '127.0.0.1', ok));
  const url = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
  const fin = async () => {
    http.closeAllConnections();
    await new Promise<void>((ok) => http.close(() => ok()));
  };
  return { c, url, fondateur, fin };
}

/** A visitor relayed by the local proxy (Caddy adds X-Forwarded-For). */
const visiteur = (ip: string, init: RequestInit = {}): RequestInit => ({ ...init, headers: { ...(init.headers ?? {}), 'x-forwarded-for': ip, 'content-type': 'application/json' } });

test('public mode: each address has a budget, the operator on this machine does not', async () => {
  const s = await demarrer({ garde: new Garde({ proxy: true, lecturesParMinute: 3, ecrituresParMinute: 2 }) });
  try {
    for (let i = 0; i < 3; i++) assert.equal((await fetch(`${s.url}/v0/hives`, visiteur('203.0.113.7'))).status, 200);
    const trop = await fetch(`${s.url}/v0/hives`, visiteur('203.0.113.7'));
    assert.equal(trop.status, 429);
    assert.equal(trop.headers.get('retry-after'), '60');
    assert.match(((await trop.json()) as { erreur: string }).erreur, /wait a minute/);
    // Another address has its own budget; this machine itself has none.
    assert.equal((await fetch(`${s.url}/v0/hives`, visiteur('198.51.100.2'))).status, 200);
    for (let i = 0; i < 5; i++) assert.equal((await fetch(`${s.url}/v0/hives`)).status, 200);
    // Writes have their own, smaller budget (the bodies here are refused, but they are counted first).
    for (let i = 0; i < 2; i++) assert.notEqual((await fetch(`${s.url}/v0/work/claim`, visiteur('192.0.2.9', { method: 'POST', body: '{}' }))).status, 429);
    assert.equal((await fetch(`${s.url}/v0/work/claim`, visiteur('192.0.2.9', { method: 'POST', body: '{}' }))).status, 429);
    // Security headers, and the health check.
    const h = await fetch(`${s.url}/healthz`);
    assert.equal(h.headers.get('x-frame-options'), 'DENY');
    assert.equal(h.headers.get('x-content-type-options'), 'nosniff');
    assert.deepEqual(Object.keys((await h.json()) as object).sort(), ['attente', 'flux', 'lourdes', 'ok']);
  } finally {
    await s.fin();
  }
});

test('public mode: without the local proxy, a forged X-Forwarded-For does not buy a new budget', async () => {
  const g = new Garde({ proxy: false });
  const req = { socket: { remoteAddress: '203.0.113.50' }, headers: { 'x-forwarded-for': '1.2.3.4' } } as never;
  assert.equal(g.adresse(req), '203.0.113.50');
  assert.equal(g.estLocal(req), false);
  const relaye = { socket: { remoteAddress: '127.0.0.1' }, headers: { 'x-forwarded-for': '9.9.9.9, 203.0.113.50' } } as never;
  assert.equal(new Garde({ proxy: true }).adresse(relaye), '203.0.113.50', 'the last hop is the one Caddy saw');
});

test('public mode: heavy work waits in a bounded queue, then answers "busy" at once', async () => {
  const g = new Garde({ lourdesSimultanees: 1, fileMax: 1 });
  let liberer!: () => void;
  const premiere = g.lourd(() => new Promise<string>((ok) => { liberer = () => ok('a'); }));
  const ordre: string[] = [];
  const seconde = g.lourd(async () => { ordre.push('b'); return 'b'; });
  await assert.rejects(g.lourd(async () => 'c'), (e: Error & { status?: number }) => e.status === 503 && /busy/.test(e.message));
  assert.deepEqual(g.charge(), { lourdes: 1, attente: 1, flux: 0 });
  liberer();
  assert.equal(await premiere, 'a');
  assert.equal(await seconde, 'b');
  assert.deepEqual(ordre, ['b']);
  assert.deepEqual(g.charge(), { lourdes: 0, attente: 0, flux: 0 });
});

test('public mode: live streams are capped per address', async () => {
  const g = new Garde({ proxy: true, fluxParAdresse: 2 });
  const req = { socket: { remoteAddress: '127.0.0.1' }, headers: { 'x-forwarded-for': '203.0.113.8' } } as never;
  const a = g.ouvrirFlux(req);
  const b = g.ouvrirFlux(req);
  assert.throws(() => g.ouvrirFlux(req), /Too many live pages/);
  a();
  a();
  const c = g.ouvrirFlux(req);
  b();
  c();
  assert.equal(g.charge().flux, 0);
});

test('public mode: a proposer cannot flood the founder with waiting projects', async () => {
  const s = await demarrer({ garde: new Garde({ proxy: true }), enAttenteParPorteur: 2 });
  try {
    const moi = generateIdentity();
    const racine = { objectif: 'x', capsule: 'x', atomique: true, critere_fini: { classe: 'V0', verificateur: 'tests-js@1', module: 'm.mjs', tests: [{ fn: 'f', args: [], attendu: 1 }] } };
    const proposer = (n: number) =>
      fetch(`${s.url}/v0/hives`, visiteur('203.0.113.9', { method: 'POST', body: JSON.stringify({ ruche: makeHive(moi, { slug: `idea-${n}`, nom: `Idea ${n}`, objectif: 'An idea' }), racine }) }));
    assert.equal((await proposer(1)).status, 201);
    assert.equal((await proposer(2)).status, 201);
    const r = await proposer(3);
    assert.equal(r.status, 429);
    assert.match(((await r.json()) as { erreur: string }).erreur, /waiting for the founder/);
  } finally {
    await s.fin();
  }
});

test('the home page counters, and the prepared projects that open at every start', async () => {
  const s = await demarrer();
  try {
    const vide = (await (await fetch(`${s.url}/v0/stats`)).json()) as Record<string, unknown>;
    assert.deepEqual({ ...vide, activite: undefined }, { projets: 0, termines: 0, alveoles: { miel: 0, total: 0 }, abeilles: 0, contributeurs: 0, grammes: 0, ia: 0, activite: undefined });

    const op = new CoordinatorClient(s.url, s.fondateur);
    let cellules = 0;
    for (const p of Object.values(PROJETS)) cellules += (await lancerProjet(op, p)).cellules + 1;
    // A restart runs it again: nothing changes.
    for (const p of Object.values(PROJETS)) assert.deepEqual(await lancerProjet(op, p), { cellules: 0, deja: true });

    const bee = new CoordinatorClient(s.url, generateIdentity());
    assert.ok(await bee.claim());
    const st = s.c.compteurs();
    assert.equal(st.projets, 3);
    assert.equal(st.alveoles.total, cellules);
    assert.equal(st.abeilles, 1, 'one bee holds a cell');
    assert.ok(st.activite);
  } finally {
    await s.fin();
  }
});

test('the join command installs the package this coordinator serves; the registry comes in pages', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ks-paquet-'));
  const paquet = join(dir, 'kickswarm.tgz');
  writeFileSync(paquet, Buffer.from([0x1f, 0x8b, 1, 2, 3]));
  const s = await demarrer({ paquet });
  try {
    assert.equal(((await (await fetch(`${s.url}/v0`)).json()) as { paquet?: string }).paquet, '/kickswarm.tgz');
    const r = await fetch(`${s.url}/kickswarm.tgz`);
    assert.equal(r.headers.get('content-type'), 'application/gzip');
    assert.deepEqual([...new Uint8Array(await r.arrayBuffer())], [0x1f, 0x8b, 1, 2, 3]);

    const op = new CoordinatorClient(s.url, s.fondateur);
    await lancerProjet(op, PROJETS['uncopyable-benchmark']!);
    const tout = await op.registry();
    assert.equal(tout.length, s.c.horizon() + 1);
    assert.deepEqual(await op.registry(3), tout.slice(3));
  } finally {
    await s.fin();
  }
  const sans = await demarrer();
  try {
    assert.equal(((await (await fetch(`${sans.url}/v0`)).json()) as { paquet?: string }).paquet, undefined);
    assert.equal((await fetch(`${sans.url}/kickswarm.tgz`)).status, 404);
  } finally {
    await sans.fin();
  }
});
