import assert from 'node:assert/strict';
import { test } from 'node:test';
import { auditRegistry } from '../src/coordinator/audit.js';
import { BaliseLocale } from '../src/coordinator/balise.js';
import { Coordinator, type CommandeDonnees, type CoordinatorOptions } from '../src/coordinator/coordinator.js';
import { seededRng } from '../src/coordinator/scheduler.js';
import { abeilleScriptee, ENFANTS, RACINE, SOLUTIONS } from '../src/exemples/maths.js';
import { makeDecision, makeDecomposition, makeEngagement, makeHive, makeRequete, makeResult, makeVerdict } from '../src/protocol/builders.js';
import { generateIdentity, type Identity } from '../src/protocol/identity.js';
import type { Assignment, CritereV0, Hash, Livrable } from '../src/protocol/types.js';
import { mutants } from '../src/verifier/mutation.js';
import { verifierV0 } from '../src/verifier/v0.js';

// OSP v0.2, P0-3 : un piège est un mutant de la vraie livraison en attente, confié à la place de celle-ci,
// avec un taux propre à chaque gardienne. Rien ne le distingue d'un vrai résultat, sauf une vraie vérification.

const fondateur = generateIdentity();
const lea = generateIdentity();
const kenji = generateIdentity();
const amara = generateIdentity();
const sami = generateIdentity();

async function resultatEnAttente(params: CoordinatorOptions['params'] = {}, extra: Partial<CoordinatorOptions> = {}) {
  const c = new Coordinator({ fondateur: fondateur.id, params: { taux_pieges: 1, ...params }, rng: seededRng(5), ...extra });
  c.proposeHive(makeHive(fondateur, { slug: 'maths', nom: 'Maths', objectif: 'pgcd, estPremier, fibonacci' }), RACINE);
  c.decide(makeDecision(fondateur, 'approbation_ruche', 'maths', 'ok'));
  const s = c.claim(makeRequete(lea, 'claim'))!;
  const d = await c.submitDecomposition(makeDecomposition(lea, s.alveole_id, ENFANTS));
  c.decide(makeDecision(fondateur, 'approbation_decoupage', d.decoupage, 'ok'));
  const a = c.claim(makeRequete(kenji, 'claim'))!;
  const critere = a.alveole.critere_fini as CritereV0;
  const livrable: Livrable = { fichiers: { [critere.module!]: SOLUTIONS[critere.module!]! } };
  const r = await c.submitResult(makeResult(kenji, a.alveole_id, 'ouvriere', livrable), livrable);
  assert.equal(r.statut, 'en_verification');
  return { c, resultat: r.resultat as Hash, cellule: a.alveole_id, critere, livrable };
}

/** Prend une tâche de gardienne, en rendant les autres. */
function gardienne(c: Coordinator, bee: Identity): Assignment {
  for (let i = 0; i < 50; i++) {
    const g = c.claim(makeRequete(bee, 'claim'));
    if (g?.a_verifier) return g;
    if (g) c.release(makeRequete(bee, 'release', { alveole: g.alveole_id }));
  }
  throw new Error('jamais tirée gardienne');
}

test('piège : un mutant du vrai livrable en attente, que seule une vraie vérification démasque', async () => {
  const { c, resultat, cellule, critere, livrable } = await resultatEnAttente();
  const p = gardienne(c, amara);
  assert.deepEqual(Object.keys(p.a_verifier!).sort(), ['id', 'livrable'], 'vérification anonyme : ni auteur, ni résultat signé');
  assert.notEqual(p.a_verifier!.id, resultat, 'à taux 1, une nouvelle venue reçoit un piège');
  assert.equal(p.alveole_id, cellule, 'même alvéole que le vrai résultat');
  const recu = p.a_verifier!.livrable;
  assert.ok(!JSON.stringify(recu).includes('__piege__'));
  assert.ok(
    mutants(livrable, { max: c.params.pieges_essais }).some((m) => JSON.stringify(m.livrable) === JSON.stringify(recu)),
    'le piège est le vrai livrable avec un seul bug',
  );
  assert.equal((await verifierV0(critere, livrable, { sansCaches: true })).ok, true, 'le vrai passe les contrôles des gardiennes');
  const rejeu = await verifierV0(critere, recu, { sansCaches: true });
  assert.equal(rejeu.ok, false, 'le piège y échoue');
  assert.ok(rejeu.tests.some((t) => t.ok), 'mais il passe une partie des tests : il n’a rien de grossier');

  // La vue publique ne le trahit pas : la gardienne y figure comme les autres, sans champ « piège ».
  const vue = c.liveView('maths').alveoles.find((x) => x.id === cellule)!;
  assert.equal(vue.etat, 'en_verification');
  assert.ok(vue.gardiennes.includes(amara.id));
  assert.ok(!JSON.stringify(c.liveView('maths')).includes(p.a_verifier!.id));
  assert.ok(!('piege' in vue));

  // Le registre publié s'arrête avant la soumission : impossible d'y comparer le livrable reçu.
  const publie = c.registry.entries.slice(0, c.horizon() + 1);
  assert.ok(!publie.some((e) => e.nature === 'resultat_soumis'), 'la soumission est sous embargo');
  assert.ok(!JSON.stringify(publie).includes(SOLUTIONS[critere.module!]!.slice(0, 40)));
  const pub = c.etatPublie();
  assert.ok(pub.tete!.seq > pub.seq, 'la tête du registre, elle, reste publique');

  const v = makeVerdict(amara, p.a_verifier!.id, 'rejete', 'un test échoue');
  c.engagerVerdict(makeEngagement(amara, v));
  const r = await c.submitVerdict(v);
  assert.deepEqual([r.piege, r.correct], [true, true]);
});

test('piège : il occupe une place de gardienne, et sa titulaire ne reçoit pas le vrai en même temps', async () => {
  const { c, resultat } = await resultatEnAttente();
  const p = gardienne(c, amara);
  assert.notEqual(p.a_verifier!.id, resultat);
  // Tant que son piège est ouvert, amara ne reçoit aucune autre tâche de vérification sur ce résultat.
  for (let i = 0; i < 10; i++) {
    const g = c.claim(makeRequete(amara, 'claim'));
    assert.ok(!g?.a_verifier, 'pas deux livrables du même résultat à la fois');
    if (g) c.release(makeRequete(amara, 'release', { alveole: g.alveole_id }));
  }
  // Une fois son verdict révélé, la place se libère.
  const v = makeVerdict(amara, p.a_verifier!.id, 'rejete', 'ko');
  c.engagerVerdict(makeEngagement(amara, v));
  await c.submitVerdict(v);
  assert.ok(gardienne(c, sami).a_verifier);
});

test('taux individuel : élevé pour une nouvelle venue, plus bas pour une gardienne fiable, jamais sous le plancher', async () => {
  const c = new Coordinator({ fondateur: fondateur.id, params: { taux_pieges: 0.2 }, rng: seededRng(9) });
  assert.equal(c.tauxPieges(generateIdentity().id), 0.2, 'une nouvelle venue : le taux plein');
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
  const fiable = abeilles.reduce((m, b) => (c.account(b.id).reputation > c.account(m.id).reputation ? b : m));
  assert.ok(c.account(fiable.id).reputation > c.params.reputation_initiale);
  assert.ok(c.tauxPieges(fiable.id) < 0.2, `réputation ${c.account(fiable.id).reputation} → taux ${c.tauxPieges(fiable.id)}`);
  assert.ok(c.tauxPieges(fiable.id) >= c.params.taux_pieges_min);
  const sans = new Coordinator({ fondateur: fondateur.id, params: { taux_pieges: 0 } });
  assert.equal(sans.tauxPieges(lea.id), 0, 'à taux nul, aucun piège, même pas le plancher');
});

test('embargo : levé dès que le résultat est tranché, et au plus tard après le délai maximal', async () => {
  let maintenant = Date.now();
  const { c, resultat } = await resultatEnAttente({ taux_pieges: 0 }, { now: () => maintenant });
  const tete = () => c.registry.entries.length - 1;
  assert.ok(c.horizon() < tete());
  maintenant += c.params.embargo_max_ms + 1;
  assert.equal(c.horizon(), tete(), 'au-delà du délai maximal, tout est publié');

  maintenant = Date.now();
  const verdicts = [];
  for (const bee of [amara, sami]) {
    const g = gardienne(c, bee);
    assert.equal(g.a_verifier!.id, resultat, 'taux nul : de vraies vérifications');
    const v = makeVerdict(bee, resultat, 'valide', 'ok');
    c.engagerVerdict(makeEngagement(bee, v));
    verdicts.push(v);
  }
  assert.ok(c.horizon() < tete(), 'engagées mais pas révélées : encore sous embargo');
  assert.equal((await c.submitVerdict(verdicts[0]!)).statut, 'en_verification');
  assert.equal((await c.submitVerdict(verdicts[1]!)).statut, 'miel');
  assert.equal(c.horizon(), tete(), 'le résultat est tranché : tout est publié');
});

test('aléa secret : avec une balise publique, le tirage du piège n’en découle pas, et l’audit le rejoue', async () => {
  const c = new Coordinator({ fondateur: fondateur.id, params: { taux_pieges: 1, balise_decalage: 2 }, balise: new BaliseLocale(25) });
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
  const avecSecret = c.registry.entries.filter((e) => e.nature === 'commande' && (e.donnees as CommandeDonnees).alea_secret?.length);
  assert.ok(avecSecret.length > 0, 'les tirages de pièges sont inscrits à part');
  assert.ok(avecSecret.every((e) => (e.donnees as CommandeDonnees).balise), 'sur des demandes tirées par ailleurs avec la balise');
  const report = await auditRegistry(c.registry.entries, { etatAnnonce: c.stateHash(), reverifier: true });
  for (const ch of report.controles) assert.ok(ch.ok, `${ch.nom}: ${ch.detail ?? ''}`);
  const ch = report.controles.find((x) => x.nom === 'Trap cells drawn at each guard’s announced rate')!;
  assert.match(ch.detail!, /single-bug mutant of the real deliverable/);
  assert.ok(c.registry.entries.some((e) => e.nature === 'piege_dejoue' || e.nature === 'piege_valide'), 'des pièges ont bien été tirés');
});

test('audit : un rapport de mutant falsifié, ou un tirage secret retiré, est démasqué', async () => {
  const c = new Coordinator({ fondateur: fondateur.id, params: { taux_pieges: 0.5 }, rng: seededRng(21) });
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
  assert.equal((await auditRegistry(c.registry.entries, { reverifier: true })).ok, true);

  // Un mutant déclaré « rejeté par les gardiennes » alors qu'il passe : la revérification le voit.
  const faux = structuredClone(c.registry.entries);
  const sub = faux.find((e) => e.nature === 'commande' && (e.donnees as CommandeDonnees).type === 'submitResult' && (e.donnees as CommandeDonnees).verifs.length > 1)!;
  const rapports = (sub.donnees as CommandeDonnees).verifs;
  rapports[1] = { ...rapports[1]!, ok: !rapports[1]!.ok };
  const r1 = await auditRegistry(faux, { reverifier: true });
  assert.equal(r1.ok, false);

  // Retirer le tirage secret d'une demande : le rejeu ne peut plus la reproduire.
  const sansSecret = structuredClone(c.registry.entries);
  const claim = sansSecret.find((e) => e.nature === 'commande' && (e.donnees as CommandeDonnees).alea_secret?.length)!;
  delete (claim.donnees as CommandeDonnees).alea_secret;
  assert.equal((await auditRegistry(sansSecret)).ok, false);
});
