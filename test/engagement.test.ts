import assert from 'node:assert/strict';
import { test } from 'node:test';
import { auditRegistry } from '../src/coordinator/audit.js';
import { Coordinator, type CommandeDonnees, type CoordinatorOptions } from '../src/coordinator/coordinator.js';
import type { RegistryEntry } from '../src/coordinator/registry.js';
import { seededRng } from '../src/coordinator/scheduler.js';
import { abeilleScriptee, ENFANTS, RACINE, SOLUTIONS } from '../src/exemples/maths.js';
import { makeDecision, makeDecomposition, makeEngagement, makeHive, makeRequete, makeResult, makeVerdict } from '../src/protocol/builders.js';
import { hashOf } from '../src/protocol/canonical.js';
import { generateIdentity, newNonce, signObject, type Identity } from '../src/protocol/identity.js';
import type { Hash, Livrable, Requete, Verdict } from '../src/protocol/types.js';

// OSP v0.2, P1-3: guards commit to their verdict (its hash) before any verdict is revealed.
// Nobody can copy another guard or fall in line with them.

const fondateur = generateIdentity();
const lea = generateIdentity();
const kenji = generateIdentity();
const amara = generateIdentity();
const sami = generateIdentity();

const trop_tot = (e: { status?: number }) => e.status === 425;

/** A split hive, and a correct result from kenji waiting for its two guards. */
async function resultatEnAttente(extra: Partial<CoordinatorOptions> = {}) {
  const c = new Coordinator({ fondateur: fondateur.id, params: { alpha_faux: 0.05, taux_pieges: 0 }, rng: seededRng(7), ...extra });
  c.proposeHive(makeHive(fondateur, { slug: 'maths', nom: 'Maths', objectif: 'pgcd, estPremier, fibonacci' }), RACINE);
  c.decide(makeDecision(fondateur, 'approbation_ruche', 'maths', 'ok'));
  const s = c.claim(makeRequete(lea, 'claim'))!;
  const d = await c.submitDecomposition(makeDecomposition(lea, s.alveole_id, ENFANTS));
  c.decide(makeDecision(fondateur, 'approbation_decoupage', d.decoupage, 'ok'));
  const a = c.claim(makeRequete(kenji, 'claim'))!;
  const mod = a.alveole.critere_fini.module!;
  const livrable: Livrable = { fichiers: { [mod]: SOLUTIONS[mod]! } };
  const r = await c.submitResult(makeResult(kenji, a.alveole_id, 'ouvriere', livrable), livrable);
  assert.equal(r.statut, 'en_verification');
  const tirer = (bee: Identity) => {
    for (let i = 0; i < 50; i++) {
      const g = c.claim(makeRequete(bee, 'claim'));
      if (g?.a_verifier?.id === r.resultat) return g;
      if (g) c.release(makeRequete(bee, 'release', { alveole: g.alveole_id }));
    }
    throw new Error('never drawn as a guard');
  };
  return { c, resultat: r.resultat as Hash, cellule: a.alveole_id, tirer };
}

test('commitment: no verdict is visible before all the guards have committed', async () => {
  const { c, resultat, tirer } = await resultatEnAttente();
  tirer(amara);
  const va = makeVerdict(amara, resultat, 'valide', 'motif-secret-amara');
  const e = c.engagerVerdict(makeEngagement(amara, va));
  assert.equal(e.revelation, false, 'the second guard has not committed yet');

  // The public registry contains only the hash: neither the decision nor the reason.
  const publie = JSON.stringify(c.registry.entries);
  assert.ok(publie.includes(hashOf(va)), 'the commitment is public');
  assert.ok(!publie.includes('motif-secret-amara'), 'the verdict stays sealed');
  await assert.rejects(c.submitVerdict(va), trop_tot, 'revealing too early is refused');

  // The commitment cannot be guessed: the salt makes every verdict unique, even when identical in substance.
  const pareil = makeVerdict(amara, resultat, 'valide', 'motif-secret-amara');
  assert.notEqual(hashOf(pareil), hashOf(va));

  tirer(lea);
  const vl = makeVerdict(lea, resultat, 'valide', 'ok');
  assert.equal(c.engagerVerdict(makeEngagement(lea, vl)).revelation, true, 'all committed: the reveal opens');
  assert.equal((await c.submitVerdict(vl)).statut, 'en_verification');
  assert.equal((await c.submitVerdict(va)).statut, 'miel');
  assert.deepEqual(c.hiveView('maths').progression.miel, 1);
});

test('commitment: you cannot reveal anything other than what you committed to', async () => {
  const { c, resultat, tirer } = await resultatEnAttente();
  tirer(amara);
  await assert.rejects(c.submitVerdict(makeVerdict(amara, resultat, 'valide', 'sans engagement')), /Commit to your verdict first/);
  const va = makeVerdict(amara, resultat, 'valide', 'ok');
  c.engagerVerdict(makeEngagement(amara, va));
  assert.throws(() => c.engagerVerdict(makeEngagement(amara, va)), /guard drawn/, 'you commit only once');
  tirer(lea);
  c.engagerVerdict(makeEngagement(lea, makeVerdict(lea, resultat, 'valide', 'ok')));

  // Changing your mind after seeing the other one? The verdict no longer matches the commitment.
  await assert.rejects(c.submitVerdict(makeVerdict(amara, resultat, 'rejete', 'changement d’avis')), /does not match/);
  const { sig: _sig, ...corps } = va;
  await assert.rejects(c.submitVerdict(signObject<Verdict>({ ...corps, sel: 'ab' }, amara)), /salt/, 'a salt that is too short would make the commitment guessable');
  // Another guard cannot reveal in their place.
  await assert.rejects(c.submitVerdict(makeVerdict(sami, resultat, 'valide', 'ok')), /No commitment/);
  assert.equal((await c.submitVerdict(va)).statut, 'en_verification');
});

test('commitment: staying silent costs more than being wrong', async () => {
  let maintenant = Date.now();
  const { c, resultat, tirer } = await resultatEnAttente({ now: () => maintenant });
  tirer(amara);
  c.engagerVerdict(makeEngagement(amara, makeVerdict(amara, resultat, 'valide', 'ok')));
  tirer(lea);
  const vl = makeVerdict(lea, resultat, 'valide', 'ok');
  c.engagerVerdict(makeEngagement(lea, vl));
  assert.equal((await c.submitVerdict(vl)).statut, 'en_verification');
  const repAmara = c.account(amara.id).reputation;

  // Amara never reveals: at the end of the window, she loses more than with any revealed verdict.
  maintenant += 1800 * 1.5 * 1000 + 1;
  c.claim(signObject<Requete>({ type: 'osp.requete/0.1', action: 'claim', contributeur: sami.id, ts: maintenant, nonce: newNonce() }, sami));
  const coutSilence = c.account(amara.id).reputation / repAmara;
  const p = c.params;
  assert.ok(coutSilence < 0.999, 'silence is penalized');
  assert.ok(coutSilence <= Math.min(p.facteur_verdict_renverse, p.facteur_piege_valide) + 1e-3, `silence ×${coutSilence}`);
  assert.ok(c.registry.entries.some((e) => e.nature === 'engagement_expire'), 'the silence is written to the registry');
  assert.notEqual(c.hiveView('maths').alveoles.find((x) => x.etat === 'en_verification'), undefined, 'the freed seat waits for a new guard');
});

test('commitment: a guard who reveals late is still judged', async () => {
  // The automatic verifier accepts the deliverable, but the re-run requested by a guard exposes it.
  let accepte = true;
  const verifier: CoordinatorOptions['verifier'] = async () => ({ ok: accepte, motif: accepte ? '3/3 tests passed' : 'wrong', tests: [], duree_ms: 1, sandbox: 'none' });
  const { c, resultat, tirer } = await resultatEnAttente({ verifier });
  accepte = false;
  tirer(amara);
  const va = makeVerdict(amara, resultat, 'valide', 'complaisante');
  c.engagerVerdict(makeEngagement(amara, va));
  tirer(lea);
  const vl = makeVerdict(lea, resultat, 'rejete', 'les tests sont faux');
  c.engagerVerdict(makeEngagement(lea, vl));
  assert.equal((await c.submitVerdict(vl)).statut, 'rejete', 'lea exposes the fake result');

  // Amara hoped to stay silent to escape the penalty: revealing late costs her less than silence.
  const avant = c.account(amara.id).reputation;
  const r = await c.submitVerdict(va);
  assert.deepEqual([r.statut, r.renverse], ['rejete', true]);
  assert.equal(c.account(amara.id).reputation, Math.round(avant * 0.9 * 10_000) / 10_000);
});

test('commitment: a trap follows the same path as a real result', async () => {
  const { c, resultat } = await resultatEnAttente({ params: { alpha_faux: 0.05, taux_pieges: 1 } });
  let p = c.claim(makeRequete(amara, 'claim'));
  for (let i = 0; i < 50 && !p?.a_verifier; i++) {
    if (p) c.release(makeRequete(amara, 'release', { alveole: p.alveole_id }));
    p = c.claim(makeRequete(amara, 'claim'));
  }
  assert.notEqual(p!.a_verifier!.id, resultat, 'at rate 1, the newcomer receives a trap');
  const v = makeVerdict(amara, p!.a_verifier!.id, 'rejete', 'les tests échouent');
  await assert.rejects(c.submitVerdict(v), /Commit to your verdict first/,'a trap also requires a commitment');
  assert.equal(c.engagerVerdict(makeEngagement(amara, v)).statut, 'engage');
  const r = await c.submitVerdict(v);
  assert.deepEqual([r.piege, r.correct], [true, true]);
});

test('commitment: the audit checks that every revealed verdict matches an earlier commitment', async () => {
  const c = new Coordinator({ fondateur: fondateur.id, params: { alpha_faux: 0.05, taux_pieges: 0.15 }, rng: seededRng(13) });
  c.proposeHive(makeHive(fondateur, { slug: 'maths', nom: 'Maths', objectif: 'x' }), RACINE);
  c.decide(makeDecision(fondateur, 'approbation_ruche', 'maths', 'ok'));
  const abeilles = [kenji, amara, lea];
  for (let tour = 0; tour < 300 && c.hiveView('maths').statut !== 'terminee'; tour++) {
    const action = await abeilleScriptee(c, abeilles[tour % 3]!);
    if (action?.issue.includes('waiting for the hive owner')) {
      const prop = c.registry.entries.filter((e) => e.nature === 'decoupage_propose').at(-1)!;
      c.decide(makeDecision(fondateur, 'approbation_decoupage', (prop.donnees as { id: string }).id, 'ok'));
    }
  }
  assert.equal(c.hiveView('maths').statut, 'terminee');
  const report = await auditRegistry(c.registry.entries, { etatAnnonce: c.stateHash() });
  for (const ch of report.controles) assert.ok(ch.ok, `${ch.nom}: ${ch.detail ?? ''}`);
  const ch = report.controles.find((x) => x.nom === 'Guards committed to their verdicts before any was revealed')!;
  assert.match(ch.detail!, /each matching a signed, salted commitment written before it/);

  // Removing a commitment from the registry (and recomputing the hash chain, without the seals): the audit fails.
  const forged = c.registry.entries.filter((e) => e.nature !== 'sceau');
  const i = forged.findIndex((e) => e.nature === 'commande' && (e.donnees as CommandeDonnees).type === 'engageVerdict');
  forged.splice(i, 1);
  let prev: Hash | null = null;
  const rechaine: RegistryEntry[] = forged.map((e, seq) => {
    const base = { seq, prev, date: e.date, nature: e.nature, donnees: e.donnees };
    const hash = hashOf(base);
    prev = hash;
    return { ...base, hash };
  });
  assert.equal((await auditRegistry(rechaine)).ok, false);
});
