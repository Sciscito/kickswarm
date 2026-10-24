import assert from 'node:assert/strict';
import { test } from 'node:test';
import { auditRegistry } from '../src/coordinator/audit.js';
import { BaliseLocale, DrandHttp, publication, QUICKNET, tourA, verifierBalise, type Balise } from '../src/coordinator/balise.js';
import { Coordinator, type CommandeDonnees } from '../src/coordinator/coordinator.js';
import type { RegistryEntry } from '../src/coordinator/registry.js';
import { abeilleScriptee, RACINE } from '../src/exemples/maths.js';
import { makeDecision, makeHive, makeRequete } from '../src/protocol/builders.js';
import { hashOf } from '../src/protocol/canonical.js';
import { generateIdentity, newNonce, signObject } from '../src/protocol/identity.js';
import type { Hash, Requete } from '../src/protocol/types.js';

// A real round of the drand quicknet network (League of Entropy), recorded during development.
const VRAI: Balise = {
  round: 33343387,
  randomness: 'f1d7508803798a9cb2541ee66468524bebfe588cd4ef2936ca4a8d4f4c7917c0',
  signature: '92ded35df97c58a4aa55960ecf0fc9d4f3200f9e3053d47329721ffa45d232c1ce7da897e0aed0b40ab65b8ade97053a',
};

function rechain(entries: RegistryEntry[]): RegistryEntry[] {
  let prev: Hash | null = null;
  return entries.map((e, i) => {
    const base = { seq: i, prev, date: e.date, nature: e.nature, donnees: e.donnees };
    const hash = hashOf(base);
    prev = hash;
    return { ...base, hash };
  });
}

test('drand: a real round of the public network verifies offline; the slightest alteration is refused', () => {
  assert.equal(verifierBalise(QUICKNET, VRAI), true);
  assert.equal(verifierBalise(QUICKNET, { ...VRAI, round: VRAI.round + 1 }), false, 'signature presented for another round');
  const sig = Buffer.from(VRAI.signature, 'hex');
  sig[10] = sig[10]! ^ 1;
  assert.equal(verifierBalise(QUICKNET, { ...VRAI, signature: sig.toString('hex') }), false, 'altered signature');
  assert.equal(verifierBalise(QUICKNET, { ...VRAI, randomness: 'ab'.repeat(32) }), false, 'randomness that does not derive from the signature');
  assert.equal(verifierBalise(new BaliseLocale().info, VRAI), false, 'another group key');
});

test('round rule: when the contributor signs, the randomness for their draw does not exist yet', () => {
  for (const ts of [Date.now(), Date.now() + 1234, Date.now() - 2999]) {
    const r = tourA(QUICKNET, ts) + 3;
    assert.ok(publication(QUICKNET, r) > ts + 2 * QUICKNET.periode * 1000 - 1, 'the target round is published at least 6 s after the signature');
  }
});

test('live drand: the next round is fetched and verified (if the network is reachable)', async (t) => {
  const d = new DrandHttp();
  try {
    const b = await d.get(tourA(QUICKNET, Date.now()) + 1);
    assert.equal(verifierBalise(QUICKNET, b), true);
  } catch {
    t.skip('drand network unreachable from this machine');
  }
});

const fondateur = generateIdentity();
const bees = [generateIdentity(), generateIdentity(), generateIdentity()];

async function rucheTiree() {
  const source = new BaliseLocale(25);
  const c = new Coordinator({ fondateur: fondateur.id, params: { alpha_faux: 0.05, taux_pieges: 0.1, balise_decalage: 2 }, balise: source });
  c.proposeHive(makeHive(fondateur, { slug: 'maths', nom: 'Maths', objectif: 'x' }), RACINE);
  c.decide(makeDecision(fondateur, 'approbation_ruche', 'maths', 'ok'));
  for (let tour = 0; tour < 300 && c.hiveView('maths').statut !== 'terminee'; tour++) {
    const action = await abeilleScriptee(c, bees[tour % 3]!);
    if (action?.issue.includes('waiting for the hive owner')) {
      const prop = c.registry.entries.filter((e) => e.nature === 'decoupage_propose').at(-1)!;
      c.decide(makeDecision(fondateur, 'approbation_decoupage', (prop.donnees as { id: string }).id, 'ok'));
    }
  }
  assert.equal(c.hiveView('maths').statut, 'terminee');
  return { c, source };
}

test('beacon: a whole hive drawn with the beacon replays draw by draw, and the audit confirms it', async () => {
  const { c } = await rucheTiree();
  const claims = c.registry.entries.filter((e) => e.nature === 'commande' && (e.donnees as CommandeDonnees).type === 'claim');
  assert.ok(claims.length > 5);
  assert.ok(claims.every((e) => (e.donnees as CommandeDonnees).balise), 'every work request carries its beacon');
  const report = await auditRegistry(c.registry.entries, { etatAnnonce: c.stateHash() });
  for (const ch of report.controles) assert.ok(ch.ok, `${ch.nom}: ${ch.detail ?? ''}`);
  const b = report.controles.find((x) => x.nom === 'Random draws from a public beacon')!;
  assert.match(b.detail!, /BLS-verified round 2 rounds after the signed request/);
  assert.match(b.detail!, /private beacon/, 'a test beacon is flagged as such');
});

test('beacon: cheating on the randomness, the beacon or its round makes the replay diverge', async () => {
  const { c, source } = await rucheTiree();
  // The SLH-DSA seals would already expose any alteration (the next seal no longer matches):
  // we remove them to check that the replay alone also catches every cheat on the randomness.
  const sansSceaux = rechain(c.registry.entries.filter((e) => e.nature !== 'sceau'));
  const i = sansSceaux.findIndex((e) => e.nature === 'commande' && ((e.donnees as CommandeDonnees).alea?.length ?? 0) > 0 && (e.donnees as CommandeDonnees).balise);
  const falsifier = async (f: (d: CommandeDonnees) => void) => {
    const forged = structuredClone(sansSceaux);
    f(forged[i]!.donnees as CommandeDonnees);
    return auditRegistry(rechain(forged));
  };
  const divergence = (r: Awaited<ReturnType<typeof auditRegistry>>) => r.controles.find((x) => x.nom.startsWith('Deterministic replay'))?.ok === false;
  assert.ok(divergence(await falsifier((d) => { d.alea[0] = 0.0001; })), 'made-up draw');
  assert.ok(divergence(await falsifier((d) => { d.balise!.randomness = 'cd'.repeat(32); })), 'made-up beacon randomness: the replay diverges');
  assert.equal((await falsifier((d) => { d.balise!.randomness = 'cd'.repeat(32); })).ok, false, 'made-up beacon randomness');
  const autre = await source.get(c.registry.entries.length + 1000);
  assert.equal((await falsifier((d) => { d.balise = autre; })).ok, false, 'a real beacon, but from another round');

  // Removing the beacon from a request: the history stays consistent, but the audit sees the non-public draw.
  const sans = await falsifier((d) => { delete d.balise; });
  const b = sans.controles.find((x) => x.nom === 'Random draws from a public beacon');
  assert.ok(b && !b.ok, JSON.stringify(sans.controles));
  assert.match(b.detail!, /drawn without the announced beacon/);
});

test('beacon: no draw without the beacon, nor with a clock too far off', async () => {
  const c = new Coordinator({ fondateur: fondateur.id, params: { alpha_faux: 0.05, taux_pieges: 0 }, balise: new BaliseLocale(25) });
  c.proposeHive(makeHive(fondateur, { slug: 'maths', nom: 'Maths', objectif: 'x' }), RACINE);
  c.decide(makeDecision(fondateur, 'approbation_ruche', 'maths', 'ok'));
  assert.throws(() => c.claim(makeRequete(bees[0]!, 'claim')), /public beacon/);
  const vieille = signObject<Requete>({ type: 'osp.requete/0.1', action: 'claim', contributeur: bees[0]!.id, ts: Date.now() - 10_000, nonce: newNonce() }, bees[0]!);
  await assert.rejects(c.reclamer(vieille), /clock is too far/);
  const a = await c.reclamer(makeRequete(bees[0]!, 'claim'));
  assert.equal(a?.caste, 'eclaireuse');
});
