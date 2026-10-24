import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { auditRegistry } from '../src/coordinator/audit.js';
import { Coordinator } from '../src/coordinator/coordinator.js';
import { Hote } from '../src/coordinator/hote.js';
import { createCoordinatorServer } from '../src/coordinator/http.js';
import type { RegistryEntry } from '../src/coordinator/registry.js';
import { httpAccess, scriptedBee } from '../src/exemples/scripted-bee.js';
import { MATHS_SCRIPT, RACINE } from '../src/exemples/maths.js';
import { idRuchePrivee, makeAdhesion, makeDecision, makeHive, makeInvitation, makeRequete } from '../src/protocol/builders.js';
import { hashOf } from '../src/protocol/canonical.js';
import { generateIdentity, type Identity } from '../src/protocol/identity.js';
import type { Hash } from '../src/protocol/types.js';
import { CoordinatorClient } from '../src/plugin/client.js';

// OSP v0.3 P0-1: private hives by invitation. Same protocol and same audit; only who can enter,
// who can read and who can verify change. Each private hive runs in its own coordinator instance.

const fondateur = generateIdentity();
const proprio = generateIdentity();
const cousin = generateIdentity();
const inconnu = generateIdentity();

function rucheJeu(owner: Identity, parametres?: { alpha_faux?: number; gardiennes_v0?: number }) {
  const ruche = makeHive(owner, { slug: 'jeu-des-cousins', nom: 'Game of the cousins', objectif: 'A small game, built by two cousins', privee: true, ...(parametres ? { parametres } : {}) });
  return { ruche, approbation: makeDecision(owner, 'approbation_ruche', ruche.slug, 'Our private hive') };
}

function rechain(entries: RegistryEntry[]): RegistryEntry[] {
  let prev: Hash | null = null;
  return entries.map((e, i) => {
    const base = { seq: i, prev, date: e.date, nature: e.nature, donnees: e.donnees };
    const hash = hashOf(base);
    prev = hash;
    return { ...base, hash };
  });
}

async function serveur() {
  const coord = new Coordinator({ fondateur: fondateur.id, params: { taux_pieges: 0 } });
  const hote = new Hote(coord, { essaisMax: 50 });
  const http = createCoordinatorServer(coord, hote);
  await new Promise<void>((r) => http.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
  const fermer = async () => {
    http.closeAllConnections();
    await new Promise<void>((r) => http.close(() => r()));
  };
  return { coord, hote, url, fermer };
}

test('private hive: the cousin joins with a code, a stranger is refused, the public sees only an anchor', async () => {
  const { coord, url, fermer } = await serveur();
  try {
    const owner = new CoordinatorClient(url, proprio);
    const { ruche, approbation } = rucheJeu(proprio);
    const { id, slug } = await owner.creerRuchePrivee(ruche, RACINE, approbation);
    assert.equal(id, idRuchePrivee(ruche));
    assert.match(id, /^p[0-9a-f]{32}$/, 'a random identifier: the URL does not reveal the project');

    owner.utiliserRuchePrivee(id);
    const { invitation, code } = makeInvitation(proprio, id);
    await owner.inviter(invitation);
    assert.match(code, /^KSW-[A-Z2-9]{5}-[A-Z2-9]{5}$/);

    const c = new CoordinatorClient(url, cousin);
    const r = await c.rejoindreAvecCode(makeAdhesion(cousin, code.toLowerCase().replace('-', ' - ')));
    assert.deepEqual([r.id, r.slug, r.role], [id, slug, 'membre'], 'the code works in any case and spacing');
    c.utiliserRuchePrivee(id);
    assert.deepEqual((await c.membres()).map((m) => m.role).sort(), ['membre', 'proprietaire']);
    await assert.rejects(new CoordinatorClient(url, generateIdentity()).rejoindreAvecCode(makeAdhesion(generateIdentity(), code)), /Unknown, used or expired/, 'single use');

    // A stranger: no ticket, no work, nothing listed.
    const s = new CoordinatorClient(url, inconnu);
    s.utiliserRuchePrivee(id);
    await assert.rejects(s.membres(), (e: { status?: number }) => e.status === 403);
    await assert.rejects(s.claim(slug), (e: { status?: number }) => e.status === 403);
    const brut = await fetch(`${url}/v0/p/${id}/registry`);
    assert.equal(brut.status, 401, 'no read without a ticket');
    assert.equal(brut.headers.get('access-control-allow-origin'), null, 'no cross-origin reading of a private hive');
    assert.equal(((await (await fetch(`${url}/v0/hives`)).json()) as unknown[]).length, 0, 'the public list shows no private hive');

    // The public registry holds an opaque anchor, nothing of the project.
    const publicTexte = JSON.stringify(coord.registry.entries);
    assert.ok(coord.registry.entries.some((e) => e.nature === 'ancre' && (e.donnees as { ruche: string }).ruche === Hote.cleAncre(id)));
    for (const secret of [slug, 'Game of the cousins', id, proprio.id, cousin.id]) assert.ok(!publicTexte.includes(secret), `the public registry does not contain ${secret.slice(0, 20)}`);
  } finally {
    await fermer();
  }
});

test('private hive: two members cross-review each other, honey stays local, both audits pass with the anchors', async () => {
  const { coord, hote, url, fermer } = await serveur();
  try {
    const owner = new CoordinatorClient(url, proprio);
    const { ruche, approbation } = rucheJeu(proprio);
    const { id, slug } = await owner.creerRuchePrivee(ruche, RACINE, approbation);
    owner.utiliserRuchePrivee(id);
    const { invitation, code } = makeInvitation(proprio, id);
    await owner.inviter(invitation);
    const cc = new CoordinatorClient(url, cousin);
    await cc.rejoindreAvecCode(makeAdhesion(cousin, code));
    cc.utiliserRuchePrivee(id);

    const abeilles = [httpAccess(owner, slug), httpAccess(cc, slug)];
    const inst = hote.instance(id);
    for (let tour = 0; tour < 200 && inst.hiveView(slug).statut !== 'terminee'; tour++) {
      const a = await scriptedBee(abeilles[tour % 2]!, MATHS_SCRIPT);
      if (a?.outcome === 'decomposition_proposed' && a.decoupage) await owner.decide(makeDecision(proprio, 'approbation_decoupage', a.decoupage, 'Clear split'));
    }
    assert.equal(inst.hiveView(slug).statut, 'terminee', 'two members alone finish the hive');
    const miels = inst.registry.entries.filter((e) => e.nature === 'alveole_miel');
    assert.ok(miels.length > 0 && miels.every((e) => (e.donnees as { gardiennes: string[] }).gardiennes.length >= 1), 'each cell checked by the other member');
    assert.ok(inst.registry.entries.filter((e) => e.nature === 'miel').every((e) => (e.donnees as { parts: number }).parts === 0), 'honey stays local: no power shares');
    assert.equal(coord.registry.entries.filter((e) => e.nature === 'miel').length, 0, 'nothing reaches the public ledger');

    // A member downloads the private registry with a ticket and audits it against the public anchors.
    hote.ancrerMaintenant();
    const head = await cc.etatPublie();
    const entries = ((await cc.registry()) as RegistryEntry[]).slice(0, head.seq + 1);
    const ancres = await cc.ancres();
    const report = await auditRegistry(entries, { etatAnnonce: head.etat ?? undefined, ancres });
    for (const ch of report.controles) assert.ok(ch.ok, `${ch.nom}: ${ch.detail ?? ''}`);
    assert.ok(report.controles.some((x) => x.nom.startsWith('Private hive: honey stays local')));
    assert.match(report.controles.find((x) => x.nom.startsWith('Matches the public anchors'))!.detail!, /anchor\(s\) in the public registry/);

    // Showing a member a rewritten history: the public anchors give it away.
    const faux = structuredClone(entries.filter((e) => e.nature !== 'sceau'));
    (faux.find((e) => e.nature === 'membre_ajoute')!.donnees as { role: string }).role = 'observateur';
    const r2 = await auditRegistry(rechain(faux), { ancres });
    assert.equal(r2.controles.find((x) => x.nom.startsWith('Matches the public anchors'))!.ok, false);

    // The public registry still replays, anchors included.
    const pub = await auditRegistry(coord.registry.entries, { etatAnnonce: coord.stateHash() });
    for (const ch of pub.controles) assert.ok(ch.ok, `public: ${ch.nom}: ${ch.detail ?? ''}`);
  } finally {
    await fermer();
  }
});

test('private hive: roles, removal, leaving, revoked invitations, observers', async () => {
  const coord = new Coordinator({ fondateur: fondateur.id, params: { taux_pieges: 0 } });
  const hote = new Hote(coord);
  const { ruche, approbation } = rucheJeu(proprio);
  const { id, slug } = hote.creer(ruche, RACINE, approbation);
  const inst = hote.instance(id);

  assert.throws(() => inst.inviter(makeInvitation(cousin, id).invitation), /Only the hive owner invites/);
  assert.throws(() => inst.inviter(makeInvitation(proprio, `p${'0'.repeat(32)}`).invitation), /another hive/);

  // An observer reads (ticket) but never works.
  const obs = makeInvitation(proprio, id, { role: 'observateur' });
  inst.inviter(obs.invitation);
  const parent = generateIdentity();
  assert.equal(hote.rejoindre(makeAdhesion(parent, obs.code)).role, 'observateur');
  assert.ok(hote.ticket(id, makeRequete(parent, 'lire')).ticket);
  assert.throws(() => inst.claim(makeRequete(parent, 'claim')), /Observers can read/);

  // A revoked invitation no longer opens the door.
  const inv = makeInvitation(proprio, id, { utilisations: 5 });
  const { invitation: invId } = inst.inviter(inv.invitation);
  inst.decide(makeDecision(proprio, 'invitation_revoquee', invId, 'Shared by mistake'));
  assert.throws(() => hote.rejoindre(makeAdhesion(cousin, inv.code)), /Unknown, used or expired/);

  // A member who does not guard is never drawn to verify.
  const m = makeInvitation(proprio, id);
  inst.inviter(m.invitation);
  hote.rejoindre(makeAdhesion(cousin, m.code));
  inst.decide(makeDecision(proprio, 'role_attribue', cousin.id, 'Builds only for now', { role: 'membre', gardienne: false }));
  assert.equal(inst.membres().find((x) => x.id === cousin.id)!.gardienne, false);
  assert.throws(() => inst.decide(makeDecision(cousin, 'role_retire', parent.id, 'not my call')), /Only the hive owner/);

  // Removed: their bees lose access at once, and their ticket stops working.
  const t = hote.ticket(id, makeRequete(cousin, 'lire')).ticket;
  inst.decide(makeDecision(proprio, 'role_retire', cousin.id, 'Left the project'));
  assert.throws(() => inst.claim(makeRequete(cousin, 'claim')), /only its members take part/);
  assert.throws(() => hote.lecteur(id, t), /no longer a member/);
  assert.ok(inst.registry.entries.some((e) => e.nature === 'membre_retire'), 'the removal is in the registry');

  // Leaving, for yourself only; the owner stays.
  inst.decide(makeDecision(parent, 'depart', parent.id, 'Seen enough'));
  assert.equal(inst.membres().length, 1);
  assert.throws(() => inst.decide(makeDecision(proprio, 'depart', proprio.id, 'bye')), /owner cannot leave/);

  // Roles do not exist in public hives, and a public coordinator refuses a private hive.
  assert.throws(() => coord.decide(makeDecision(fondateur, 'role_retire', cousin.id, 'x')), /only exist in private hives/);
  assert.throws(() => coord.proposeHive(rucheJeu(proprio).ruche, RACINE), /POST \/v0\/private/);
  assert.equal(inst.hiveView(slug).statut, 'active');
});

test('private hive: guessing codes is rate-limited, and private hives come back after a restart', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'osp-prive-'));
  try {
    const coord = new Coordinator({ fondateur: fondateur.id, dataDir: dir, params: { taux_pieges: 0 } });
    const hote = new Hote(coord, { dataDir: dir, essaisMax: 3 });
    const { ruche, approbation } = rucheJeu(proprio, { alpha_faux: 0.1, gardiennes_v0: 1 });
    const { id } = hote.creer(ruche, RACINE, approbation);
    const inv = makeInvitation(proprio, id);
    hote.instance(id).inviter(inv.invitation);
    for (let i = 0; i < 3; i++) assert.throws(() => hote.rejoindre(makeAdhesion(inconnu, `KSW-AAAAA-AAAA${i}`), '1.2.3.4'), /Unknown/);
    assert.throws(() => hote.rejoindre(makeAdhesion(inconnu, inv.code), '1.2.3.4'), /Too many join attempts/, 'even the right code, after too many tries');
    hote.rejoindre(makeAdhesion(cousin, inv.code), '5.6.7.8');
    hote.ancrerMaintenant();

    // Restart: the host finds its private hives, their members and their own guarantee.
    const coord2 = new Coordinator({ fondateur: fondateur.id, dataDir: dir });
    const hote2 = new Hote(coord2, { dataDir: dir });
    const inst = hote2.instance(id);
    assert.deepEqual(inst.membres().map((m) => m.role).sort(), ['membre', 'proprietaire']);
    assert.equal(inst.params.alpha_faux, 0.1);
    assert.equal(inst.params.prive, true);
    hote2.ancrerMaintenant();
    assert.equal(hote2.ancres(id).length, hote.ancres(id).length, 'no duplicate anchor for an unchanged head after a restart');
    const report = await auditRegistry(inst.registry.entries, { ancres: hote2.ancres(id) });
    for (const ch of report.controles) assert.ok(ch.ok, `${ch.nom}: ${ch.detail ?? ''}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
