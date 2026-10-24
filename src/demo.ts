import { Coordinator } from './coordinator/coordinator.js';
import { COMMUN } from './coordinator/ledger.js';
import { verifyRegistry } from './coordinator/registry.js';
import { seededRng } from './coordinator/scheduler.js';
import { abeilleScriptee, RACINE } from './exemples/maths.js';
import { makeDecision, makeHive } from './protocol/builders.js';
import { generateIdentity, type Identity } from './protocol/identity.js';
import type { Caste, ContributorId } from './protocol/types.js';

// End-to-end demo, in memory: a hive starts from one sentence and ends in honey.
// The bees are scripted; with the MCP plugin, they are real agents.

const CASTES: Record<Caste, string> = { eclaireuse: 'scout', ouvriere: 'worker', gardienne: 'guard', batisseuse: 'builder' };
const fmt = (x: number) => x.toFixed(2);

export async function demo(log: (s: string) => void = console.log): Promise<boolean> {
  const fondateur = generateIdentity();
  const abeilles: Array<[string, Identity]> = [
    ['léa', generateIdentity()],
    ['kenji', generateIdentity()],
    ['amara', generateIdentity()],
    ['noctua', generateIdentity()],
  ];
  const noms = new Map<string, string>([[fondateur.id, 'you (founder)'], ...abeilles.map(([n, id]) => [id.id, n] as [string, string])]);

  // Only four bees: a 5% target error rate (two guards are enough); a real hive aims for 10⁻⁴.
  const c = new Coordinator({ fondateur: fondateur.id, params: { taux_pieges: 0.15, alpha_faux: 0.05 }, rng: seededRng(2026) });
  log('\n🐝  KICKSWARM · OSP v0.1 core demo\n');

  c.proposeHive(makeHive(fondateur, { slug: 'maths', nom: 'Mini-bibliothèque mathématique', objectif: RACINE.objectif }), RACINE);
  log(`① You propose a hive, in one sentence: “${RACINE.objectif}”`);
  c.decide(makeDecision(fondateur, 'approbation_ruche', 'maths', 'Conforme à la charte : résultat ouvert, sans risque'));
  log('② Pilot phase: as the founder, you approve it. The decision is signed and written to the registry.\n');
  log('③ The swarm gets to work:');

  let bugKenji = true;
  let oriente = false;
  for (let tour = 0; tour < 300 && c.hiveView('maths').statut !== 'terminee'; tour++) {
    const [nom, bee] = abeilles[tour % abeilles.length]!;
    const action = await abeilleScriptee(c, bee, { bug: nom === 'kenji' && bugKenji });
    if (!action) continue;
    if (nom === 'kenji' && action.caste === 'ouvriere') bugKenji = false;
    log(`   ${nom.padEnd(7)} ${CASTES[action.caste].padEnd(11)} cell ${action.chemin.padEnd(3)} → ${action.issue}`);

    if (action.issue.includes('waiting for the hive owner')) {
      const prop = c.registry.entries.filter((e) => e.nature === 'decoupage_propose').at(-1)!;
      const id = (prop.donnees as { id: string }).id;
      c.decide(makeDecision(fondateur, 'approbation_decoupage', id, 'Trois fonctions indépendantes, chacune testable'));
      log('   you     hive owner  cell 0   → split approved: 3 cells are born');
    }
    if (!oriente && c.hiveView('maths').alveoles.some((a) => a.chemin === '2')) {
      c.decide(makeDecision(fondateur, 'orientation', 'maths:2', 'Les nombres premiers d’abord', { multiplicateur: 3 }));
      log('   you     founder     branch 2 → orientation ×3 for 72 h (estPremier first)');
      oriente = true;
    }
  }

  const vue = c.hiveView('maths');
  log(`\n④ Hive ${vue.statut === 'terminee' ? 'complete' : 'unfinished'}: ${vue.progression.miel}/${vue.progression.total} cells in honey.`);
  const coeur = vue.alveoles.find((a) => a.chemin === '0')!;
  const solution = c.livrableValide(coeur.id);
  if (solution) log(`   Final deliverable verified: ${Object.keys(solution.fichiers).join(', ')}`);

  log('\n⑤ What everyone earned:');
  log('   contributor      honey earned    available  shares   reputation');
  const ids: Array<ContributorId | typeof COMMUN> = [fondateur.id, ...abeilles.map(([, b]) => b.id)];
  for (const id of ids) {
    const a = c.account(id);
    log(`   ${(noms.get(id) ?? id).padEnd(18)} ${fmt(a.miel_gagne).padStart(8)} g ${fmt(a.miel).padStart(10)} g ${fmt(a.parts).padStart(7)} ${a.reputation.toFixed(3).padStart(12)}`);
  }
  const commun = c.account(COMMUN);
  const totalParts = ids.reduce((s, id) => s + c.account(id).parts, 0) + commun.parts;
  log(`   ${'the Commons'.padEnd(18)} ${''.padStart(10)} ${''.padStart(12)} ${fmt(commun.parts).padStart(7)}   (${Math.round((commun.parts / totalParts) * 100)}% of the shares, owned by everyone)`);

  const reg = verifyRegistry(c.registry.entries);
  const pieges = c.registry.entries.filter((e) => e.nature === 'piege_dejoue').length;
  log(`\n⑥ Public registry: ${c.registry.entries.length} chained entries, integrity ${reg.ok ? 'verified ✓' : 'CORRUPTED ✗'}.`);
  log(`   Trap cells caught: ${pieges}. Rejections: ${c.registry.entries.filter((e) => e.nature === 'alveole_rejetee').length}.`);
  log('\nTo plug in a real agent: npm run coordinateur, then add the MCP plugin (see README).\n');
  return vue.statut === 'terminee' && reg.ok;
}
