import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { test } from 'node:test';
import { auditRegistry } from '../src/coordinator/audit.js';
import { Coordinator } from '../src/coordinator/coordinator.js';
import type { RegistryEntry } from '../src/coordinator/registry.js';
import { seededRng } from '../src/coordinator/scheduler.js';
import { abeilleScriptee, RACINE } from '../src/exemples/maths.js';
import { makeDecision, makeHive, makeRequete } from '../src/protocol/builders.js';
import { canonicalize, hashOf } from '../src/protocol/canonical.js';
import { generateIdentity, isPostQuantum, signObject, verifyObject, type Algo } from '../src/protocol/identity.js';
import type { Hash } from '../src/protocol/types.js';

const b64 = (b: Buffer) => b.toString('base64url');
const fp = (...parts: Buffer[]) => b64(createHash('sha256').update(Buffer.concat(parts)).digest());

function rechain(entries: RegistryEntry[]): RegistryEntry[] {
  let prev: Hash | null = null;
  return entries.map((e, i) => {
    const base = { seq: i, prev, date: e.date, nature: e.nature, donnees: e.donnees };
    const hash = hashOf(base);
    prev = hash;
    return { ...base, hash };
  });
}

test('trois algorithmes : chacun signe, vérifie, et refuse l’altération comme le mauvais signataire', () => {
  for (const algo of ['pq1', 'slh1', 'ed25519'] as Algo[]) {
    const a = generateIdentity(algo), b = generateIdentity(algo);
    const o = signObject({ msg: 'swarm', n: 1 }, a);
    assert.equal(verifyObject(o, a.id), true, algo);
    assert.equal(verifyObject({ ...o, n: 2 }, a.id), false, `${algo} : altération`);
    assert.equal(verifyObject(o, b.id), false, `${algo} : mauvais signataire`);
    assert.equal(isPostQuantum(a.id), algo !== 'ed25519');
  }
});

test('hybride : les DEUX signatures sont exigées, et chacune est liée à l’empreinte', () => {
  const a = generateIdentity('pq1');
  const o = signObject({ x: 1 }, a);
  const parts = o.sig.split('.');
  const corrupt = (i: number) => { const p = [...parts]; const buf = Buffer.from(p[i]!, 'base64url'); buf[5] = buf[5]! ^ 0xff; p[i] = b64(buf); return p.join('.'); };
  assert.equal(verifyObject({ ...o, sig: corrupt(1) }, a.id), false, 'Ed25519 corrompue : refus, même si ML-DSA est valide');
  assert.equal(verifyObject({ ...o, sig: corrupt(2) }, a.id), false, 'ML-DSA corrompue : refus, même si Ed25519 est valide');
  assert.equal(verifyObject({ ...o, sig: parts.slice(0, 4).join('.') }, a.id), false, 'signature tronquée');
  // Les clés d'une autre identité, avec ses propres signatures valides, ne passent pas l'empreinte.
  const b = generateIdentity('pq1');
  assert.equal(verifyObject(signObject({ x: 1 }, b), a.id), false);
});

test('substitution d’algorithme impossible : une clé faible ne peut pas se faire passer pour post-quantique', () => {
  const data = Buffer.from(canonicalize({ x: 1 }));
  const ed = generateKeyPairSync('ed25519');
  const edSpki = ed.publicKey.export({ type: 'spki', format: 'der' });
  const edRaw = Buffer.from(ed.publicKey.export({ format: 'jwk' }).x!, 'base64url');
  const edSig = sign(null, data, ed.privateKey);
  // « slh1 » dont la clé est en réalité Ed25519 : l'empreinte colle, le type de clé non.
  const fauxSlh = `slh1:${fp(edSpki)}`;
  assert.equal(verifyObject({ x: 1, sig: `slh1.${b64(edSig)}.${b64(edSpki)}` }, fauxSlh), false);
  // « pq1 » dont la moitié ML-DSA est en réalité une seconde clé Ed25519.
  const ed2 = generateKeyPairSync('ed25519');
  const ed2Spki = ed2.publicKey.export({ type: 'spki', format: 'der' });
  const fauxPq = `pq1:${fp(edRaw, ed2Spki)}`;
  const sig = ['pq1', b64(edSig), b64(sign(null, data, ed2.privateKey)), b64(edRaw), b64(ed2Spki)].join('.');
  assert.equal(verifyObject({ x: 1, sig }, fauxPq), false);
  // Une signature Ed25519 nue ne vaut rien pour une identité hybride.
  assert.equal(verifyObject({ x: 1, sig: b64(edSig) }, fauxPq), false);
});

async function rucheTerminee(params = {}, abeilles = [generateIdentity(), generateIdentity(), generateIdentity()]) {
  const fondateur = generateIdentity();
  const c = new Coordinator({ fondateur: fondateur.id, params: { alpha_faux: 0.05, taux_pieges: 0.1, ...params }, rng: seededRng(31) });
  c.proposeHive(makeHive(fondateur, { slug: 'maths', nom: 'Maths', objectif: 'x' }), RACINE);
  c.decide(makeDecision(fondateur, 'approbation_ruche', 'maths', 'ok'));
  for (let tour = 0; tour < 300 && c.hiveView('maths').statut !== 'terminee'; tour++) {
    const action = await abeilleScriptee(c, abeilles[tour % abeilles.length]!);
    if (action?.issue.includes('attente du porteur')) {
      const prop = c.registry.entries.filter((e) => e.nature === 'decoupage_propose').at(-1)!;
      c.decide(makeDecision(fondateur, 'approbation_decoupage', (prop.donnees as { id: string }).id, 'ok'));
    }
  }
  assert.equal(c.hiveView('maths').statut, 'terminee');
  return c;
}

test('coordinateur : identité SLH-DSA, alvéoles signées en SLH-DSA, registre scellé et audité', async () => {
  const c = await rucheTerminee({ sceau_max_commandes: 5 });
  assert.match(c.identite.id, /^slh1:/);
  const cellule = c.hiveView('maths').alveoles[0]!;
  const emise = c.registry.entries.find((e) => e.nature === 'alveole_emise' && (e.donnees as { id: string }).id === cellule.id);
  assert.ok(emise);
  assert.equal(c.registry.entries[1]!.nature, 'sceau', 'le lancement est scellé tout de suite');
  const sceaux = c.registry.entries.filter((e) => e.nature === 'sceau');
  assert.ok(sceaux.length >= 3, `${sceaux.length} sceaux`);
  for (const s of sceaux) assert.match((s.donnees as { sig: string }).sig, /^slh1\./);

  const report = await auditRegistry(c.registry.entries, { etatAnnonce: c.stateHash() });
  for (const ch of report.controles) assert.ok(ch.ok, `${ch.nom}: ${ch.detail ?? ''}`);
  const sc = report.controles.find((x) => x.nom.startsWith('Registry sealed'))!;
  assert.match(sc.detail!, /SLH-DSA-SHA2-128f \(FIPS 205\)/);
  assert.match(report.controles.find((x) => x.nom === 'Contributor signatures')!.detail!, /\(100%\) are post-quantum/);
});

test('sceaux : un sceau falsifié, ou qui pointe ailleurs, est démasqué ; sans sceau, l’audit le dit', async () => {
  const c = await rucheTerminee({ sceau_max_commandes: 5 });
  const i = c.registry.entries.findIndex((e, k) => k > 2 && e.nature === 'sceau');

  const sigFausse = structuredClone(c.registry.entries);
  const d = sigFausse[i]!.donnees as { sig: string };
  const p = d.sig.split('.');
  const buf = Buffer.from(p[1]!, 'base64url');
  buf[10] = buf[10]! ^ 0xff;
  p[1] = b64(buf);
  d.sig = p.join('.');
  const r1 = await auditRegistry(rechain(sigFausse));
  assert.equal(r1.ok, false);
  assert.match(JSON.stringify(r1.controles), /seal #\d+ is invalid/);

  const teteFausse = structuredClone(c.registry.entries);
  (teteFausse[i]!.donnees as { seq: number }).seq -= 1;
  assert.equal((await auditRegistry(rechain(teteFausse))).ok, false);

  const sansSceaux = rechain(c.registry.entries.filter((e) => e.nature !== 'sceau'));
  const r3 = await auditRegistry(sansSceaux);
  const sc = r3.controles.find((x) => x.nom.startsWith('Registry sealed'))!;
  assert.equal(sc.ok, false);
  assert.match(sc.detail!, /no seal found/);
});

test('compatibilité : une ancienne identité Ed25519 participe encore, et l’audit en mesure la part', async () => {
  const anciens = [generateIdentity('ed25519'), generateIdentity(), generateIdentity()];
  const c = await rucheTerminee({}, anciens);
  const report = await auditRegistry(c.registry.entries);
  assert.equal(report.ok, true, JSON.stringify(report.controles));
  const part = report.controles.find((x) => x.nom === 'Contributor signatures')!.detail!;
  assert.match(part, /are post-quantum hybrid/);
  assert.ok(!/\(100%\)/.test(part), part);
  // Le fondateur, hybride, a bien vu ses décisions acceptées.
  assert.ok(c.registry.entries.some((e) => e.nature === 'decision'));
  void makeRequete;
});
