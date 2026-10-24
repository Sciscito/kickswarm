import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Coordinator } from '../src/coordinator/coordinator.js';
import { COMMUN } from '../src/coordinator/ledger.js';
import { verifyRegistry } from '../src/coordinator/registry.js';
import { seededRng } from '../src/coordinator/scheduler.js';
import { abeilleScriptee, ENFANTS, RACINE } from '../src/exemples/maths.js';
import { makeDecision, makeDecomposition, makeEngagement, makeHive, makeRequete, makeResult, makeVerdict } from '../src/protocol/builders.js';
import { generateIdentity, newNonce, signObject, type Identity } from '../src/protocol/identity.js';
import type { Hash, Livrable, Requete, Verdict } from '../src/protocol/types.js';

const fondateur = generateIdentity();
const lea = generateIdentity();
const kenji = generateIdentity();
const amara = generateIdentity();

function nouvelleRuche(opts: ConstructorParameters<typeof Coordinator>[0]['params'] = {}, extra: Partial<ConstructorParameters<typeof Coordinator>[0]> = {}) {
  const c = new Coordinator({ fondateur: fondateur.id, params: { alpha_faux: 0.05, taux_pieges: 0, ...opts }, rng: seededRng(7), ...extra });
  c.proposeHive(makeHive(fondateur, { slug: 'maths', nom: 'Mini-bibliothèque mathématique', objectif: 'pgcd, estPremier, fibonacci' }), RACINE);
  return c;
}

/** Une gardienne s'engage sur son verdict, puis le révèle (OSP v0.2, P1-3). */
async function juger(c: Coordinator, id: Identity, resultat: Hash, decision: Verdict['decision'], motif: string) {
  const v = makeVerdict(id, resultat, decision, motif);
  c.engagerVerdict(makeEngagement(id, v));
  return c.submitVerdict(v);
}

/** Tire `bee` comme gardienne de `resultat`, en rendant les autres tâches. */
function tirer(c: Coordinator, bee: Identity, resultat: Hash) {
  for (let i = 0; i < 50; i++) {
    const g = c.claim(makeRequete(bee, 'claim'));
    if (g?.a_verifier?.id === resultat) return g;
    if (g) c.release(makeRequete(bee, 'release', { alveole: g.alveole_id }));
  }
  return null;
}

async function decouper(c: Coordinator): Promise<void> {
  c.decide(makeDecision(fondateur, 'approbation_ruche', 'maths', 'Conforme à la charte'));
  const a = c.claim(makeRequete(lea, 'claim'))!;
  assert.equal(a.caste, 'eclaireuse');
  const d = await c.submitDecomposition(makeDecomposition(lea, a.alveole_id, ENFANTS));
  assert.equal(d.statut, 'en_attente_porteur', 'le niveau 0 attend le porteur (§6.3)');
  c.decide(makeDecision(fondateur, 'approbation_decoupage', d.decoupage, 'Découpage clair'));
}

test('de l’idée au miel : une ruche complète, de bout en bout', async () => {
  const c = nouvelleRuche();
  assert.equal(c.claim(makeRequete(lea, 'claim')), null, 'une ruche proposée ne distribue rien');
  assert.throws(() => c.decide(makeDecision(lea, 'approbation_ruche', 'maths', 'ok')), /fondateur/);
  c.decide(makeDecision(fondateur, 'approbation_ruche', 'maths', 'Conforme à la charte'));

  const a = c.claim(makeRequete(lea, 'claim'))!;
  assert.equal(a.caste, 'eclaireuse', 'le cœur non atomique appelle une éclaireuse');
  const d = await c.submitDecomposition(makeDecomposition(lea, a.alveole_id, ENFANTS));
  assert.throws(() => c.decide(makeDecision(kenji, 'approbation_decoupage', d.decoupage, 'ok')), /porteur/);
  c.decide(makeDecision(fondateur, 'approbation_decoupage', d.decoupage, 'Découpage clair'));
  assert.deepEqual(c.hiveView('maths').progression, { miel: 0, total: 4 });

  // Kenji livre d'abord du faux : le vérificateur automatique le rejette.
  const repAvant = c.account(kenji.id).reputation;
  const faux = await abeilleScriptee(c, kenji, { bug: true });
  assert.equal(faux?.caste, 'ouvriere');
  assert.match(faux!.issue, /rejeté/);
  assert.ok(c.account(kenji.id).reputation < repAvant, 'un rejet coûte de la réputation');
  assert.ok(c.board('maths').some((e) => e.nature === 'impasse'), 'l’échec est inscrit au tableau noir');

  // Puis l'essaim travaille jusqu'au cœur.
  const abeilles: Identity[] = [kenji, amara, lea];
  for (let tour = 0; tour < 200 && c.hiveView('maths').statut !== 'terminee'; tour++) {
    const bee = abeilles[tour % abeilles.length]!;
    const action = await abeilleScriptee(c, bee);
    if (action?.caste === 'gardienne') assert.match(action.issue, /miel|démasqué|confirmé|scellé/);
  }
  const vue = c.hiveView('maths');
  assert.equal(vue.statut, 'terminee');
  assert.deepEqual(vue.progression, { miel: 4, total: 4 });

  // La solution du cœur est l'assemblage vérifié des trois enfants.
  const coeur = vue.alveoles.find((x) => x.chemin === '0')!;
  assert.ok(c.livrableValide(coeur.id)?.fichiers['solution.mjs']);

  // Registre intègre, et le Commun détient 30 % des parts (§18.2).
  assert.deepEqual(verifyRegistry(c.registry.entries), { ok: true });
  const ids = [fondateur.id, lea.id, kenji.id, amara.id];
  const partsContributeurs = ids.reduce((s, id) => s + c.account(id).parts, 0);
  const commun = c.account(COMMUN).parts;
  assert.ok(Math.abs(commun / (commun + partsContributeurs) - 0.3) < 0.01, `Commun ${commun} / contributeurs ${partsContributeurs}`);
  assert.ok(c.account(fondateur.id).parts > 0, 'allocation fondateur et bonus porteur');
  for (const id of ids) assert.ok(c.account(id).miel_gagne > 0, 'chacun a gagné du miel');
});

test('on ne vérifie jamais son propre travail', async () => {
  const c = nouvelleRuche();
  await decouper(c);
  const a = c.claim(makeRequete(kenji, 'claim'))!;
  assert.equal(a.caste, 'ouvriere');
  const mod = a.alveole.critere_fini.module!;
  const { SOLUTIONS } = await import('../src/exemples/maths.js');
  const livrable: Livrable = { fichiers: { [mod]: SOLUTIONS[mod]! } };
  const r = await c.submitResult(makeResult(kenji, a.alveole_id, 'ouvriere', livrable), livrable);
  assert.equal(r.statut, 'en_verification');
  await assert.rejects(juger(c, kenji, r.resultat, 'valide', 'moi-même'), /gardienne|propre/);
  for (let i = 0; i < 6; i++) {
    const b = c.claim(makeRequete(kenji, 'claim'));
    if (b) {
      assert.notEqual(b.a_verifier?.id, r.resultat, 'kenji ne reçoit jamais son propre résultat à vérifier');
      c.release(makeRequete(kenji, 'release', { alveole: b.alveole_id }));
    }
  }
});

test('une gardienne qui rejette à tort un résultat juste perd de la réputation', async () => {
  const c = nouvelleRuche();
  await decouper(c);
  const a = c.claim(makeRequete(kenji, 'claim'))!;
  const mod = a.alveole.critere_fini.module!;
  const { SOLUTIONS } = await import('../src/exemples/maths.js');
  const livrable: Livrable = { fichiers: { [mod]: SOLUTIONS[mod]! } };
  const r = await c.submitResult(makeResult(kenji, a.alveole_id, 'ouvriere', livrable), livrable);
  assert.ok(tirer(c, amara, r.resultat), 'amara finit par être tirée gardienne');
  const avant = c.account(amara.id).reputation;
  const faux = makeVerdict(amara, r.resultat, 'rejete', 'je n’aime pas');
  c.engagerVerdict(makeEngagement(amara, faux));
  assert.ok(tirer(c, lea, r.resultat), 'lea est tirée seconde gardienne');
  c.engagerVerdict(makeEngagement(lea, makeVerdict(lea, r.resultat, 'valide', 'ok')));
  const v = await c.submitVerdict(faux);
  assert.equal(v.renverse, true);
  assert.ok(c.account(amara.id).reputation < avant);
  assert.equal(c.hiveView('maths').alveoles.find((x) => x.id === a.alveole_id)!.etat, 'en_verification');
});

test('alvéoles-pièges : la gardienne attentive gagne, la complaisante perd la moitié', async () => {
  const c = nouvelleRuche({ taux_pieges: 1 });
  await decouper(c);
  const a = c.claim(makeRequete(kenji, 'claim'))!;
  const mod = a.alveole.critere_fini.module!;
  const { SOLUTIONS } = await import('../src/exemples/maths.js');
  const livrable: Livrable = { fichiers: { [mod]: SOLUTIONS[mod]! } };
  const r = await c.submitResult(makeResult(kenji, a.alveole_id, 'ouvriere', livrable), livrable);
  // Tirée sur ce résultat, une nouvelle venue reçoit à coup sûr (taux 1) un mutant du vrai livrable.
  const gardienne = (bee: Identity) => {
    for (let i = 0; i < 50; i++) {
      const g = c.claim(makeRequete(bee, 'claim'));
      if (g?.a_verifier) return g;
      if (g) c.release(makeRequete(bee, 'release', { alveole: g.alveole_id }));
    }
    throw new Error('jamais tirée gardienne');
  };
  const p1 = gardienne(amara);
  assert.notEqual(p1.a_verifier!.id, r.resultat);
  const r1 = await juger(c, amara, p1.a_verifier!.id, 'rejete', 'les tests échouent');
  assert.deepEqual([r1.piege, r1.correct], [true, true]);
  assert.equal(c.account(amara.id).miel_gagne, 12);

  const p2 = gardienne(lea);
  const avant = c.account(lea.id).reputation;
  const r2 = await juger(c, lea, p2.a_verifier!.id, 'valide', 'ça a l’air bien');
  assert.deepEqual([r2.piege, r2.correct], [true, false]);
  assert.equal(c.account(lea.id).reputation, Math.round(avant * 0.5 * 10_000) / 10_000);
});

test('bail expiré : l’alvéole revient dans l’essaim', async () => {
  let maintenant = Date.now();
  const c = nouvelleRuche({}, { now: () => maintenant });
  await decouper(c);
  const a = c.claim(makeRequete(kenji, 'claim'))!;
  const avant = c.account(kenji.id).reputation;
  maintenant += 1800 * 1.5 * 1000 + 1;
  assert.throws(() => c.claim(makeRequete(amara, 'claim')), /expirée/, 'une requête hors de la fenêtre anti-rejeu est refusée');
  c.claim(signObject<Requete>({ type: 'osp.requete/0.1', action: 'claim', contributeur: amara.id, ts: maintenant, nonce: newNonce() }, amara));
  assert.ok(c.account(kenji.id).reputation < avant, 'un bail expiré coûte un peu de réputation');
  assert.notEqual(c.liveView('maths').alveoles.find((x) => x.id === a.alveole_id)!.abeille?.par, kenji.id, 'kenji a perdu son bail');
});

test('anti-rejeu, pause et orientation', async () => {
  const c = nouvelleRuche();
  await decouper(c);
  const req = makeRequete(kenji, 'claim');
  c.claim(req);
  assert.throws(() => c.claim(req), /rejouée/);

  assert.throws(() => c.decide(makeDecision(kenji, 'pause', 'maths', 'stop')), /porteur de la ruche ou au fondateur/);
  c.decide(makeDecision(fondateur, 'pause', 'maths', 'Frein d’urgence : test'));
  assert.equal(c.claim(makeRequete(amara, 'claim')), null, 'une ruche en pause ne distribue rien');
  c.decide(makeDecision(fondateur, 'reprise', 'maths', 'Reprise'));

  assert.throws(() => c.decide(makeDecision(fondateur, 'orientation', 'maths:2', 'trop', { multiplicateur: 4 })), /entre 1 et 3/);
  assert.throws(() => c.decide(makeDecision(fondateur, 'orientation', 'maths:9', 'inconnue')), /Branche inconnue/);
  c.decide(makeDecision(fondateur, 'orientation', 'maths:2', 'Priorité aux nombres premiers', { multiplicateur: 3 }));
  assert.deepEqual(c.hiveView('maths').orientations.map((o) => [o.branche, o.multiplicateur]), [['2', 3]]);
  assert.throws(() => c.decide(makeDecision(fondateur, 'pause', 'maths', '')), /motivée/);
});

test('persistance : le coordinateur reprend son état et son registre', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'osp-data-'));
  try {
    const c1 = new Coordinator({ fondateur: fondateur.id, dataDir: dir, params: { alpha_faux: 0.05, taux_pieges: 0 } });
    c1.proposeHive(makeHive(fondateur, { slug: 'maths', nom: 'Maths', objectif: 'test' }), RACINE);
    c1.decide(makeDecision(fondateur, 'approbation_ruche', 'maths', 'ok'));
    const n = c1.registry.entries.length;
    const c2 = new Coordinator({ fondateur: fondateur.id, dataDir: dir, params: { alpha_faux: 0.05, taux_pieges: 0 } });
    assert.equal(c2.hiveView('maths').statut, 'active');
    assert.equal(c2.registry.entries.length, n);
    assert.equal(c2.identite.id, c1.identite.id);
    assert.throws(() => new Coordinator({ fondateur: lea.id, dataDir: dir }), /autre fondateur/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('double vérification : deux gardiennes distinctes, puis les trophées tombent', async () => {
  const c = nouvelleRuche();
  await decouper(c);
  const a = c.claim(makeRequete(kenji, 'claim'))!;
  const mod = a.alveole.critere_fini.module!;
  const { SOLUTIONS } = await import('../src/exemples/maths.js');
  const livrable: Livrable = { fichiers: { [mod]: SOLUTIONS[mod]! } };
  const r = await c.submitResult(makeResult(kenji, a.alveole_id, 'ouvriere', livrable), livrable);

  assert.ok(tirer(c, amara, r.resultat), 'amara est tirée gardienne');
  const va = makeVerdict(amara, r.resultat, 'valide', 'ok');
  assert.deepEqual(c.engagerVerdict(makeEngagement(amara, va)), { statut: 'engage', revelation: false });
  await assert.rejects(c.submitVerdict(va), (e: { status?: number }) => e.status === 425, 'pas de révélation tant que la seconde gardienne ne s’est pas engagée');
  assert.equal(tirer(c, amara, r.resultat), null, 'la même gardienne ne vérifie pas deux fois');
  assert.ok(tirer(c, lea, r.resultat), 'lea est tirée seconde gardienne');
  const vl = makeVerdict(lea, r.resultat, 'valide', 'ok');
  assert.deepEqual(c.engagerVerdict(makeEngagement(lea, vl)), { statut: 'engage', revelation: true });
  const v1 = await c.submitVerdict(va);
  assert.deepEqual([v1.statut, v1.confirmations], ['en_verification', 1], 'une seule confirmation ne suffit pas');
  const v2 = await c.submitVerdict(vl);
  assert.equal(v2.statut, 'miel');

  const ids = (id: Identity) => c.account(id.id).trophees.map((t) => t.id);
  assert.ok(ids(kenji).includes('first_drop') && ids(kenji).includes('pioneer') && ids(kenji).includes('founding_bee'));
  assert.ok(ids(lea).includes('scout'));
  assert.ok(ids(fondateur).includes('hive_owner'));
  assert.ok(c.registry.entries.some((e) => e.nature === 'trophee'), 'chaque trophée est inscrit au registre');
});
