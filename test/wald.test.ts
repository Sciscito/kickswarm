import assert from 'node:assert/strict';
import { test } from 'node:test';
import { auditRegistry } from '../src/coordinator/audit.js';
import { Coordinator, type CoordinatorOptions } from '../src/coordinator/coordinator.js';
import { betaQuantile, betaRepartition, lnGamma, poidsValide, VIERGE } from '../src/coordinator/fiabilite.js';
import { DEFAULT_PARAMS } from '../src/coordinator/params.js';
import { seededRng } from '../src/coordinator/scheduler.js';
import { ENFANTS, RACINE, SOLUTIONS } from '../src/exemples/maths.js';
import { makeDecision, makeDecomposition, makeEngagement, makeHive, makeRequete, makeResult, makeVerdict } from '../src/protocol/builders.js';
import { generateIdentity, newNonce, signObject, type Identity } from '../src/protocol/identity.js';
import type { CritereV0, Hash, Livrable, Requete, Verdict } from '../src/protocol/types.js';

// OSP v0.2, P0-4 : on ne fixe plus le nombre de gardiennes. On les tire tant que la probabilité
// que le résultat soit faux n'est pas passée sous α* (test séquentiel de Wald), chacune pesée
// sur la borne basse de sa fiabilité (lois Beta), avec un plancher de 2 et un plafond de 9.

const fondateur = generateIdentity();
const lea = generateIdentity();
const kenji = generateIdentity();
const gardiennes = Array.from({ length: 10 }, () => generateIdentity());

test('fiabilité : la loi Beta et ses quantiles, contre des formes fermées', () => {
  assert.ok(Math.abs(lnGamma(5) - Math.log(24)) < 1e-12);
  assert.ok(Math.abs(lnGamma(0.5) - Math.log(Math.sqrt(Math.PI))) < 1e-12);
  for (const a of [1, 3, 19, 200]) assert.ok(Math.abs(betaQuantile(0.05, a, 1) - 0.05 ** (1 / a)) < 1e-12, `Beta(${a}, 1)`);
  for (const b of [1, 4, 50]) assert.ok(Math.abs(betaQuantile(0.05, 1, b) - (1 - 0.95 ** (1 / b))) < 1e-12, `Beta(1, ${b})`);
  assert.ok(Math.abs(betaRepartition(0.3, 2.5, 7) + betaRepartition(0.7, 7, 2.5) - 1) < 1e-12, 'symétrie I_x(a,b) = 1 − I_{1−x}(b,a)');
  // Plus d'observations favorables, plus de poids ; une nouvelle venue reste prudemment pesée.
  const p = DEFAULT_PARAMS;
  const w0 = poidsValide(VIERGE, p);
  assert.ok(poidsValide({ s_ok: 20, s_ko: 0, c_ok: 50, c_ko: 0 }, p) > w0);
  assert.ok(poidsValide({ s_ok: 0, s_ko: 5, c_ok: 0, c_ko: 0 }, p) < w0);
});

/** Une ruche avec un résultat juste de kenji, qui attend ses gardiennes. */
async function enAttente(params: CoordinatorOptions['params'] = {}, extra: Partial<CoordinatorOptions> = {}) {
  const c = new Coordinator({ fondateur: fondateur.id, params: { taux_pieges: 0, ...params }, rng: seededRng(4), ...extra });
  c.proposeHive(makeHive(fondateur, { slug: 'maths', nom: 'Maths', objectif: 'pgcd, estPremier, fibonacci' }), RACINE);
  c.decide(makeDecision(fondateur, 'approbation_ruche', 'maths', 'ok'));
  const s = c.claim(makeRequete(lea, 'claim'))!;
  const d = await c.submitDecomposition(makeDecomposition(lea, s.alveole_id, ENFANTS));
  c.decide(makeDecision(fondateur, 'approbation_decoupage', d.decoupage, 'ok'));
  const a = c.claim(makeRequete(kenji, 'claim'))!;
  const mod = (a.alveole.critere_fini as CritereV0).module!;
  const livrable: Livrable = { fichiers: { [mod]: SOLUTIONS[mod]! } };
  const r = await c.submitResult(makeResult(kenji, a.alveole_id, 'ouvriere', livrable), livrable);
  return { c, resultat: r.resultat as Hash, cellule: a.alveole_id };
}

/** Tire `bee` gardienne de `resultat` et l'engage sur un « valide » ; null si aucune place n'est ouverte. */
function engager(c: Coordinator, bee: Identity, resultat: Hash): Verdict | null {
  for (let i = 0; i < 20; i++) {
    const g = c.claim(makeRequete(bee, 'claim'));
    if (!g) return null;
    if (g.a_verifier?.id === resultat) {
      const v = makeVerdict(bee, resultat, 'valide', 'tous les tests passent');
      c.engagerVerdict(makeEngagement(bee, v));
      return v;
    }
    c.release(makeRequete(bee, 'release', { alveole: g.alveole_id }));
  }
  return null;
}

test('Wald : à α* = 10⁻⁴, il faut 7 nouvelles venues ; le miel publie sa probabilité d’être faux', async () => {
  const { c, resultat, cellule } = await enAttente();
  const verdicts: Verdict[] = [];
  for (const g of gardiennes) {
    const v = engager(c, g, resultat);
    if (v) verdicts.push(v);
  }
  assert.equal(verdicts.length, 7, 'exactement 7 places ouvertes pour des gardiennes de fiabilité inconnue');
  for (const [i, v] of verdicts.entries()) {
    const r = await c.submitVerdict(v);
    assert.equal(r.statut, i < 6 ? 'en_verification' : 'miel', `verdict ${i + 1}`);
  }
  assert.equal(c.hiveView('maths').alveoles.find((x) => x.id === cellule)!.etat, 'miel');
  const miel = c.registry.entries.find((e) => e.nature === 'alveole_miel')!.donnees as { p_faux: number; cote: number; gardiennes: string[] };
  assert.ok(miel.p_faux <= 1e-4, `P(faux) = ${miel.p_faux}`);
  assert.equal(miel.gardiennes.length, 7);

  const report = await auditRegistry(c.registry.entries, { etatAnnonce: c.stateHash() });
  for (const ch of report.controles) assert.ok(ch.ok, `${ch.nom}: ${ch.detail ?? ''}`);
  assert.match(report.controles.find((x) => x.nom.startsWith('Every honey cell'))!.detail!, /each with P\(false\) ≤ α\* = 0\.0001/);
});

test('Wald : des gardiennes fiables concluent avec le plancher de 2, jamais avec une seule', async () => {
  // Des a priori très forts : toutes les gardiennes sont « expertes ».
  const { c, resultat } = await enAttente({ prior_sensibilite: [5000, 10], prior_specificite: [5000, 10] });
  const v1 = engager(c, gardiennes[0]!, resultat)!;
  const v2 = engager(c, gardiennes[1]!, resultat)!;
  assert.equal(engager(c, gardiennes[2]!, resultat), null, 'deux places seulement : le plancher');
  assert.equal((await c.submitVerdict(v1)).statut, 'en_verification', 'une seule validation ne suffit jamais');
  assert.equal((await c.submitVerdict(v2)).statut, 'miel');
});

test('fiabilité : déjouer un piège augmente le poids d’une gardienne ; en valider un le diminue', async () => {
  const { c } = await enAttente({ taux_pieges: 1 });
  const [attentive, complaisante] = gardiennes;
  const w0 = c.poids(attentive!.id);
  for (const [bee, decision] of [[attentive!, 'rejete'], [complaisante!, 'valide']] as const) {
    let g = c.claim(makeRequete(bee, 'claim'));
    while (g && !g.a_verifier) {
      c.release(makeRequete(bee, 'release', { alveole: g.alveole_id }));
      g = c.claim(makeRequete(bee, 'claim'));
    }
    const v = makeVerdict(bee, g!.a_verifier!.id, decision, 'verdict');
    c.engagerVerdict(makeEngagement(bee, v));
    assert.equal((await c.submitVerdict(v)).piege, true);
  }
  assert.ok(c.poids(attentive!.id) > w0, 'piège déjoué : sensibilité en hausse');
  assert.ok(c.poids(complaisante!.id) < w0, 'piège validé : sensibilité en baisse');
});

test('escalade : sans conclusion après le plafond de verdicts, le porteur arbitre, publiquement', async () => {
  const { c, resultat, cellule } = await enAttente({ verdicts_max: 3 });
  const verdicts = gardiennes.slice(0, 5).map((g) => engager(c, g, resultat)).filter((v): v is Verdict => v !== null);
  assert.equal(verdicts.length, 3, 'le plafond borne les places');
  for (const v of verdicts) await c.submitVerdict(v);
  assert.ok(c.registry.entries.some((e) => e.nature === 'escalade'), 'escalade inscrite au registre');
  assert.equal(engager(c, gardiennes[5]!, resultat), null, 'plus aucune gardienne tirée');

  assert.throws(() => c.decide(makeDecision(gardiennes[0]!, 'arbitrage_valide', resultat, 'je tranche')), /porteur/);
  c.decide(makeDecision(fondateur, 'arbitrage_valide', resultat, 'Trois validations concordantes, aucun rejet'));
  assert.equal(c.hiveView('maths').alveoles.find((x) => x.id === cellule)!.etat, 'miel');
  const report = await auditRegistry(c.registry.entries);
  for (const ch of report.controles) assert.ok(ch.ok, `${ch.nom}: ${ch.detail ?? ''}`);
  assert.match(report.controles.find((x) => x.nom.startsWith('Every honey cell'))!.detail!, /1 settled by the hive owner after escalation/);
});

test('escalade : un résultat qui attend trop longtemps ses gardiennes part aussi en arbitrage', async () => {
  let maintenant = Date.now();
  const { c, resultat } = await enAttente({}, { now: () => maintenant });
  maintenant += c.params.escalade_ms + 1;
  c.claim(signObject<Requete>({ type: 'osp.requete/0.1', action: 'claim', contributeur: gardiennes[0]!.id, ts: maintenant, nonce: newNonce() }, gardiennes[0]!));
  const e = c.registry.entries.find((x) => x.nature === 'escalade');
  assert.ok(e, 'escalade après le délai');
  assert.equal((e!.donnees as { resultat: string }).resultat, resultat);
  c.decide(makeDecision(fondateur, 'arbitrage_rejet', resultat, 'Personne pour vérifier : on refait'));
  assert.ok(c.registry.entries.some((x) => x.nature === 'alveole_rejetee'));
});
