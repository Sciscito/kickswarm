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

// OSP v0.2, P1-3 : les gardiennes s'engagent sur leur verdict (son hash) avant que le moindre verdict
// ne soit révélé. Personne ne peut copier une autre gardienne ni s'aligner sur elle.

const fondateur = generateIdentity();
const lea = generateIdentity();
const kenji = generateIdentity();
const amara = generateIdentity();
const sami = generateIdentity();

const trop_tot = (e: { status?: number }) => e.status === 425;

/** Une ruche découpée, et un résultat juste de kenji qui attend ses deux gardiennes. */
async function resultatEnAttente(extra: Partial<CoordinatorOptions> = {}) {
  const c = new Coordinator({ fondateur: fondateur.id, params: { taux_pieges: 0 }, rng: seededRng(7), ...extra });
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
    throw new Error('jamais tirée gardienne');
  };
  return { c, resultat: r.resultat as Hash, cellule: a.alveole_id, tirer };
}

test('engagement : aucun verdict n’est visible avant que toutes les gardiennes se soient engagées', async () => {
  const { c, resultat, tirer } = await resultatEnAttente();
  tirer(amara);
  const va = makeVerdict(amara, resultat, 'valide', 'motif-secret-amara');
  const e = c.engagerVerdict(makeEngagement(amara, va));
  assert.equal(e.revelation, false, 'la seconde gardienne n’est pas encore engagée');

  // Le registre public ne contient que le hash : ni la décision, ni le motif.
  const publie = JSON.stringify(c.registry.entries);
  assert.ok(publie.includes(hashOf(va)), 'l’engagement est public');
  assert.ok(!publie.includes('motif-secret-amara'), 'le verdict reste scellé');
  await assert.rejects(c.submitVerdict(va), trop_tot, 'révéler trop tôt est refusé');

  // L'engagement ne se devine pas : le sel rend chaque verdict unique, même identique sur le fond.
  const pareil = makeVerdict(amara, resultat, 'valide', 'motif-secret-amara');
  assert.notEqual(hashOf(pareil), hashOf(va));

  tirer(lea);
  const vl = makeVerdict(lea, resultat, 'valide', 'ok');
  assert.equal(c.engagerVerdict(makeEngagement(lea, vl)).revelation, true, 'toutes engagées : la révélation s’ouvre');
  assert.equal((await c.submitVerdict(vl)).statut, 'en_verification');
  assert.equal((await c.submitVerdict(va)).statut, 'miel');
  assert.deepEqual(c.hiveView('maths').progression.miel, 1);
});

test('engagement : impossible de révéler autre chose que ce sur quoi on s’est engagée', async () => {
  const { c, resultat, tirer } = await resultatEnAttente();
  tirer(amara);
  await assert.rejects(c.submitVerdict(makeVerdict(amara, resultat, 'valide', 'sans engagement')), /Engage-toi d’abord/);
  const va = makeVerdict(amara, resultat, 'valide', 'ok');
  c.engagerVerdict(makeEngagement(amara, va));
  assert.throws(() => c.engagerVerdict(makeEngagement(amara, va)), /gardienne tirée/, 'on ne s’engage qu’une fois');
  tirer(lea);
  c.engagerVerdict(makeEngagement(lea, makeVerdict(lea, resultat, 'valide', 'ok')));

  // Changer d'avis après avoir vu l'autre ? Le verdict ne correspond plus à l'engagement.
  await assert.rejects(c.submitVerdict(makeVerdict(amara, resultat, 'rejete', 'changement d’avis')), /ne correspond pas/);
  const { sig: _sig, ...corps } = va;
  await assert.rejects(c.submitVerdict(signObject<Verdict>({ ...corps, sel: 'ab' }, amara)), /Sel/, 'un sel trop court rendrait l’engagement devinable');
  // Une autre gardienne ne peut pas révéler à sa place.
  await assert.rejects(c.submitVerdict(makeVerdict(sami, resultat, 'valide', 'ok')), /Aucun engagement/);
  assert.equal((await c.submitVerdict(va)).statut, 'en_verification');
});

test('engagement : se taire coûte plus cher que se tromper', async () => {
  let maintenant = Date.now();
  const { c, resultat, tirer } = await resultatEnAttente({ now: () => maintenant });
  tirer(amara);
  c.engagerVerdict(makeEngagement(amara, makeVerdict(amara, resultat, 'valide', 'ok')));
  tirer(lea);
  const vl = makeVerdict(lea, resultat, 'valide', 'ok');
  c.engagerVerdict(makeEngagement(lea, vl));
  assert.equal((await c.submitVerdict(vl)).statut, 'en_verification');
  const repAmara = c.account(amara.id).reputation;

  // Amara ne révèle jamais : à la fin de la fenêtre, elle perd plus qu'avec n'importe quel verdict révélé.
  maintenant += 1800 * 1.5 * 1000 + 1;
  c.claim(signObject<Requete>({ type: 'osp.requete/0.1', action: 'claim', contributeur: sami.id, ts: maintenant, nonce: newNonce() }, sami));
  const coutSilence = c.account(amara.id).reputation / repAmara;
  const p = c.params;
  assert.ok(coutSilence < 0.999, 'le silence est sanctionné');
  assert.ok(coutSilence <= Math.min(p.facteur_verdict_renverse, p.facteur_piege_valide) + 1e-3, `silence ×${coutSilence}`);
  assert.ok(c.registry.entries.some((e) => e.nature === 'engagement_expire'), 'le silence est inscrit au registre');
  assert.notEqual(c.hiveView('maths').alveoles.find((x) => x.etat === 'en_verification'), undefined, 'la place libérée attend une nouvelle gardienne');
});

test('engagement : une gardienne qui révèle après coup est jugée quand même', async () => {
  // Le vérificateur automatique accepte le livrable, mais le rejeu demandé par une gardienne le démasque.
  let accepte = true;
  const verifier: CoordinatorOptions['verifier'] = async () => ({ ok: accepte, motif: accepte ? '3/3 tests passed' : 'faux', tests: [], duree_ms: 1, sandbox: 'none' });
  const { c, resultat, tirer } = await resultatEnAttente({ verifier });
  accepte = false;
  tirer(amara);
  const va = makeVerdict(amara, resultat, 'valide', 'complaisante');
  c.engagerVerdict(makeEngagement(amara, va));
  tirer(lea);
  const vl = makeVerdict(lea, resultat, 'rejete', 'les tests sont faux');
  c.engagerVerdict(makeEngagement(lea, vl));
  assert.equal((await c.submitVerdict(vl)).statut, 'rejete', 'lea démasque le faux résultat');

  // Amara espérait se taire pour échapper à la sanction : révéler après coup la sanctionne moins que le silence.
  const avant = c.account(amara.id).reputation;
  const r = await c.submitVerdict(va);
  assert.deepEqual([r.statut, r.renverse], ['rejete', true]);
  assert.equal(c.account(amara.id).reputation, Math.round(avant * 0.9 * 10_000) / 10_000);
});

test('engagement : un piège suit le même chemin qu’un vrai résultat', async () => {
  const c = new Coordinator({ fondateur: fondateur.id, params: { taux_pieges: 1 }, rng: seededRng(3) });
  c.proposeHive(makeHive(fondateur, { slug: 'maths', nom: 'Maths', objectif: 'x' }), RACINE);
  c.decide(makeDecision(fondateur, 'approbation_ruche', 'maths', 'ok'));
  const s = c.claim(makeRequete(lea, 'claim'))!;
  if (s.caste !== 'gardienne') {
    const d = await c.submitDecomposition(makeDecomposition(lea, s.alveole_id, ENFANTS));
    c.decide(makeDecision(fondateur, 'approbation_decoupage', d.decoupage, 'ok'));
  }
  const p = c.claim(makeRequete(amara, 'claim'))!;
  assert.equal(p.caste, 'gardienne');
  const v = makeVerdict(amara, p.a_verifier!.id, 'rejete', 'les tests échouent');
  await assert.rejects(c.submitVerdict(v), /Engage-toi d’abord/, 'un piège exige aussi un engagement');
  assert.equal(c.engagerVerdict(makeEngagement(amara, v)).statut, 'engage');
  const r = await c.submitVerdict(v);
  assert.deepEqual([r.piege, r.correct], [true, true]);
});

test('engagement : l’audit vérifie que chaque verdict révélé correspond à un engagement antérieur', async () => {
  const c = new Coordinator({ fondateur: fondateur.id, params: { taux_pieges: 0.15 }, rng: seededRng(13) });
  c.proposeHive(makeHive(fondateur, { slug: 'maths', nom: 'Maths', objectif: 'x' }), RACINE);
  c.decide(makeDecision(fondateur, 'approbation_ruche', 'maths', 'ok'));
  const abeilles = [kenji, amara, lea];
  for (let tour = 0; tour < 300 && c.hiveView('maths').statut !== 'terminee'; tour++) {
    const action = await abeilleScriptee(c, abeilles[tour % 3]!);
    if (action?.issue.includes('attente du porteur')) {
      const prop = c.registry.entries.filter((e) => e.nature === 'decoupage_propose').at(-1)!;
      c.decide(makeDecision(fondateur, 'approbation_decoupage', (prop.donnees as { id: string }).id, 'ok'));
    }
  }
  assert.equal(c.hiveView('maths').statut, 'terminee');
  const report = await auditRegistry(c.registry.entries, { etatAnnonce: c.stateHash() });
  for (const ch of report.controles) assert.ok(ch.ok, `${ch.nom}: ${ch.detail ?? ''}`);
  const ch = report.controles.find((x) => x.nom === 'Guards committed to their verdicts before any was revealed')!;
  assert.match(ch.detail!, /each matching a signed, salted commitment written before it/);

  // Retirer un engagement du registre (et recalculer le chaînage, sans les sceaux) : l'audit échoue.
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
