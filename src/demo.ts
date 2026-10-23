import { Coordinator } from './coordinator/coordinator.js';
import { COMMUN } from './coordinator/ledger.js';
import { verifyRegistry } from './coordinator/registry.js';
import { seededRng } from './coordinator/scheduler.js';
import { abeilleScriptee, RACINE } from './exemples/maths.js';
import { makeDecision, makeHive } from './protocol/builders.js';
import { generateIdentity, type Identity } from './protocol/identity.js';
import type { Caste, ContributorId } from './protocol/types.js';

// Démo de bout en bout, en mémoire : une ruche part d'une phrase et arrive au miel.
// Les abeilles sont scriptées ; avec le plugin MCP, ce sont de vrais agents.

const CASTES: Record<Caste, string> = { eclaireuse: 'éclaireuse', ouvriere: 'ouvrière', gardienne: 'gardienne', batisseuse: 'bâtisseuse' };
const fmt = (x: number) => x.toFixed(2).replace('.', ',');

export async function demo(log: (s: string) => void = console.log): Promise<boolean> {
  const fondateur = generateIdentity();
  const abeilles: Array<[string, Identity]> = [
    ['léa', generateIdentity()],
    ['kenji', generateIdentity()],
    ['amara', generateIdentity()],
    ['noctua', generateIdentity()],
  ];
  const noms = new Map<string, string>([[fondateur.id, 'toi (fondateur)'], ...abeilles.map(([n, id]) => [id.id, n] as [string, string])]);

  const c = new Coordinator({ fondateur: fondateur.id, params: { taux_pieges: 0.15 }, rng: seededRng(2026) });
  log('\n🐝  KICKSWARM · démo du noyau OSP v0.1\n');

  c.proposeHive(makeHive(fondateur, { slug: 'maths', nom: 'Mini-bibliothèque mathématique', objectif: RACINE.objectif }), RACINE);
  log(`① Tu proposes une ruche, en une phrase : « ${RACINE.objectif} »`);
  c.decide(makeDecision(fondateur, 'approbation_ruche', 'maths', 'Conforme à la charte : résultat ouvert, sans risque'));
  log('② Phase pilote : tu l’admets comme fondateur. La décision est signée et inscrite au registre.\n');
  log('③ L’essaim se met au travail :');

  let bugKenji = true;
  let oriente = false;
  for (let tour = 0; tour < 300 && c.hiveView('maths').statut !== 'terminee'; tour++) {
    const [nom, bee] = abeilles[tour % abeilles.length]!;
    const action = await abeilleScriptee(c, bee, { bug: nom === 'kenji' && bugKenji });
    if (!action) continue;
    if (nom === 'kenji' && action.caste === 'ouvriere') bugKenji = false;
    log(`   ${nom.padEnd(7)} ${CASTES[action.caste].padEnd(11)} alvéole ${action.chemin.padEnd(3)} → ${action.issue}`);

    if (action.issue.includes('attente du porteur')) {
      const prop = c.registry.entries.filter((e) => e.nature === 'decoupage_propose').at(-1)!;
      const id = (prop.donnees as { id: string }).id;
      c.decide(makeDecision(fondateur, 'approbation_decoupage', id, 'Trois fonctions indépendantes, chacune testable'));
      log('   toi     porteur     alvéole 0   → découpage approuvé : 3 alvéoles naissent');
    }
    if (!oriente && c.hiveView('maths').alveoles.some((a) => a.chemin === '2')) {
      c.decide(makeDecision(fondateur, 'orientation', 'maths:2', 'Les nombres premiers d’abord', { multiplicateur: 3 }));
      log('   toi     fondateur   branche 2   → orientation ×3 pendant 72 h (estPremier en priorité)');
      oriente = true;
    }
  }

  const vue = c.hiveView('maths');
  log(`\n④ Ruche ${vue.statut === 'terminee' ? 'complétée' : 'inachevée'} : ${vue.progression.miel}/${vue.progression.total} alvéoles en miel.`);
  const coeur = vue.alveoles.find((a) => a.chemin === '0')!;
  const solution = c.livrableValide(coeur.id);
  if (solution) log(`   Livrable final vérifié : ${Object.keys(solution.fichiers).join(', ')}`);

  log('\n⑤ Ce que chacun a gagné :');
  log('   contributeur       miel gagné   miel dispo   parts   réputation');
  const ids: Array<ContributorId | typeof COMMUN> = [fondateur.id, ...abeilles.map(([, b]) => b.id)];
  for (const id of ids) {
    const a = c.account(id);
    log(`   ${(noms.get(id) ?? id).padEnd(18)} ${fmt(a.miel_gagne).padStart(8)} g ${fmt(a.miel).padStart(10)} g ${fmt(a.parts).padStart(7)} ${a.reputation.toFixed(3).padStart(12)}`);
  }
  const commun = c.account(COMMUN);
  const totalParts = ids.reduce((s, id) => s + c.account(id).parts, 0) + commun.parts;
  log(`   ${'le Commun'.padEnd(18)} ${''.padStart(10)} ${''.padStart(12)} ${fmt(commun.parts).padStart(7)}   (${Math.round((commun.parts / totalParts) * 100)} % des parts, à tous)`);

  const reg = verifyRegistry(c.registry.entries);
  const pieges = c.registry.entries.filter((e) => e.nature === 'piege_dejoue').length;
  log(`\n⑥ Registre public : ${c.registry.entries.length} entrées chaînées, intégrité ${reg.ok ? 'vérifiée ✓' : 'CORROMPUE ✗'}.`);
  log(`   Alvéoles-pièges déjouées : ${pieges}. Rejets : ${c.registry.entries.filter((e) => e.nature === 'alveole_rejetee').length}.`);
  log('\nPour brancher un vrai agent : npm run coordinateur, puis ajoute le plugin MCP (voir README).\n');
  return vue.statut === 'terminee' && reg.ok;
}
