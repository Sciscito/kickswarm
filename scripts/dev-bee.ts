// A local coordinator to try the chat door and the guard door (OSP v0.4 §2.3, §2.4) in a browser:
//   npx tsx scripts/dev-bee.ts [port] [--animate]   then open http://localhost:<port>/bee
// With --animate, scripted bees keep working every few seconds: the dashboards (/project/<hive>) move.
// Two public hives are ready, already split into worker cells: the maths library (JavaScript) and the
// Roblox economy (Luau). A scripted bee hands in one result, so the guard door has work too.
import { Coordinator } from '../src/coordinator/coordinator.js';
import { createCoordinatorServer } from '../src/coordinator/http.js';
import { seededRng } from '../src/coordinator/scheduler.js';
import { ENFANTS, MATHS_SCRIPT, RACINE, SOLUTIONS } from '../src/exemples/maths.js';
import { ENFANTS_ROBLOX, RACINE_ROBLOX, ROBLOX_SCRIPT, SECRETS_ROBLOX } from '../src/exemples/roblox.js';
import { directAccess, scriptedBee } from '../src/exemples/scripted-bee.js';
import { makeDecision, makeDecomposition, makeHive, makeRequete, makeResult } from '../src/protocol/builders.js';
import { generateIdentity } from '../src/protocol/identity.js';
import type { CritereV0, Livrable } from '../src/protocol/types.js';

const port = Number(process.argv.find((a) => /^\d+$/.test(a)) ?? 7788);
const animer = process.argv.includes('--animate');
const fondateur = generateIdentity();
const eclaireuse = generateIdentity();
const ouvriere = generateIdentity();
const c = new Coordinator({ fondateur: fondateur.id, params: { alpha_faux: 0.05, gardiennes_v0: 1, taux_pieges: 0.3 }, rng: seededRng(1) });

for (const [slug, nom, racine, enfants, secrets] of [
  ['maths', 'Mini maths library', RACINE, ENFANTS, undefined],
  ['economy', 'Roblox game economy (Luau)', RACINE_ROBLOX, ENFANTS_ROBLOX, SECRETS_ROBLOX],
] as const) {
  c.proposeHive(makeHive(fondateur, { slug, nom, objectif: racine.objectif }), racine);
  c.decide(makeDecision(fondateur, 'approbation_ruche', slug, 'Demo hive'));
  const s = c.claim(makeRequete(eclaireuse, 'claim', { ruche: slug, castes: ['eclaireuse'] }))!;
  const d = await c.submitDecomposition(makeDecomposition(eclaireuse, s.alveole_id, [...enfants]), secrets ? [...secrets] : []);
  if (d.statut === 'en_attente_porteur') c.decide(makeDecision(fondateur, 'approbation_decoupage', d.decoupage, 'Clear split'));
}

// One result waiting for its guards: work for the guard door.
const a = c.claim(makeRequete(ouvriere, 'claim', { ruche: 'maths', castes: ['ouvriere'] }))!;
const module = (a.alveole.critere_fini as CritereV0).module!;
const livrable: Livrable = { fichiers: { [module]: SOLUTIONS[module]! } };
await c.submitResult(makeResult(ouvriere, a.alveole_id, 'ouvriere', livrable, { agent: { famille: 'script' } }), livrable);

createCoordinatorServer(c).listen(port, '127.0.0.1', () => console.log(`Kickswarm dev coordinator: http://localhost:${port}/bee, dashboards at /project/maths and /project/economy`));

if (animer) {
  // A few scripted bees, one action every few seconds, on both hives; splits are approved as they come.
  const abeilles = Array.from({ length: 5 }, () => generateIdentity());
  let n = 0;
  setInterval(async () => {
    const bee = abeilles[n % abeilles.length]!;
    const [slug, script] = n++ % 2 === 0 ? (['maths', MATHS_SCRIPT] as const) : (['economy', ROBLOX_SCRIPT] as const);
    try {
      const a = await scriptedBee(directAccess(c, bee, slug), script, { bug: Math.random() < 0.15 });
      if (a?.outcome === 'decomposition_proposed' && a.decoupage) c.decide(makeDecision(fondateur, 'approbation_decoupage', a.decoupage, 'Clear split'));
    } catch {
      // a busy cell or a closed hive: the next tick tries again
    }
  }, 2500);
}
