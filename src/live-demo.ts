import type { Server } from 'node:http';
import { DrandHttp } from './coordinator/balise.js';
import { Coordinator } from './coordinator/coordinator.js';
import { createCoordinatorServer } from './coordinator/http.js';
import { httpAccess, scriptedBee, type BeeAction, type Outcome } from './exemples/scripted-bee.js';
import { TOOLKIT_ROOT, TOOLKIT_SCRIPT } from './exemples/toolkit.js';
import { makeDecision, makeHive } from './protocol/builders.js';
import { generateIdentity } from './protocol/identity.js';
import { CoordinatorClient } from './plugin/client.js';

// Live demo: a real coordinator over HTTP, a real live hive page, and scripted bees that go
// through the same signed API as real agents. Hives restart forever, so you can film it.

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const SAY: Record<Outcome, string> = {
  decomposition_proposed: 'split the cell, waiting for the hive owner',
  decomposition_adopted: 'split the cell',
  delivered: 'delivered, now under verification',
  rejected: 'delivered broken code, rejected by the verifier',
  assembled: 'assembled the children, now under verification',
  assembly_rejected: 'assembly rejected',
  sealed: 'sealed its verdict, waiting for the other guards',
  verified: 'verified it: honey!',
  confirmed: 'confirmed it, waiting for more guards',
  fake_caught: 'caught a broken result',
  overturned: 'was overturned',
  trap_caught: 'caught a trap cell',
  trap_missed: 'fell for a trap cell',
};
const CASTE: Record<string, string> = { eclaireuse: 'scout', ouvriere: 'worker', gardienne: 'guard', batisseuse: 'builder' };

export interface LiveDemoOptions {
  port: number;
  bees: number;
  speed: number;
  /** Tirer au sort avec la balise publique drand (réseau requis). */
  beacon?: boolean;
  log?: (s: string) => void;
}

export async function liveDemo(opts: LiveDemoOptions): Promise<Server> {
  const log = opts.log ?? console.log;
  const founder = generateIdentity();
  // A small swarm: a 1% target error rate needs 3 newcomer guards per cell (10⁻⁴, the default, needs 7).
  const coord = new Coordinator({ fondateur: founder.id, params: { taux_pieges: 0.08, alpha_faux: 0.01 }, ...(opts.beacon ? { balise: new DrandHttp() } : {}) });
  const server = createCoordinatorServer(coord);
  await new Promise<void>((r) => server.listen(opts.port, '127.0.0.1', r));
  const url = `http://127.0.0.1:${opts.port}`;
  const owner = new CoordinatorClient(url, founder);

  log('\n🐝  KICKSWARM · live demo');
  log(`   Watch the hive live: ${url}/hive`);
  log(`   Random draws: ${opts.beacon ? 'public drand beacon (each claim waits ~6 s for its round)' : 'local (pass --beacon drand for the public beacon)'}`);
  log('   Target error rate: 1% per cell for this small demo swarm (real hives default to 1 in 10,000)\n');

  const names = ['swift-lynx', 'amber-wren', 'quiet-orca', 'night-moth', 'iron-heron', 'solar-ibis', 'brave-koi', 'lunar-fox'];
  const pace = (base: number) => sleep((base * (0.7 + Math.random() * 0.8)) / opts.speed);

  void (async () => {
    for (let round = 1; ; round++) {
      const slug = round === 1 ? 'math-toolkit' : `math-toolkit-${round}`;
      await owner.proposeHive(makeHive(founder, { slug, nom: `Math toolkit #${round}`, objectif: TOOLKIT_ROOT.objectif }), TOOLKIT_ROOT);
      await pace(1500);
      await owner.decide(makeDecision(founder, 'approbation_ruche', slug, 'Within the charter: open result, no risk'));
      log(`▶ Hive “${slug}” approved. The swarm wakes up.`);

      let done = false;
      const bees = Array.from({ length: opts.bees }, (_, i) => ({ name: names[i % names.length]!, access: httpAccess(new CoordinatorClient(url, generateIdentity()), slug), bug: i === 1 }));
      await Promise.all(
        bees.map(async (bee, i) => {
          await sleep(i * 400);
          while (!done) {
            let action: BeeAction | null = null;
            try {
              action = await scriptedBee(bee.access, TOOLKIT_SCRIPT, {
                bug: bee.bug && Math.random() < 0.5,
                pause: (caste) => pace(caste === 'gardienne' ? 1800 : caste === 'eclaireuse' ? 2600 : 3400),
              });
            } catch (e) {
              log(`  ! ${bee.name}: ${(e as Error).message}`);
            }
            if (action?.caste === 'ouvriere') bee.bug = false;
            if (action) {
              log(`  ${bee.name.padEnd(11)} ${CASTE[action.caste]!.padEnd(8)} cell ${action.chemin.padEnd(5)} ${SAY[action.outcome]}`);
              if (action.outcome === 'decomposition_proposed' && action.decoupage) {
                await pace(1600);
                await owner.decide(makeDecision(founder, 'approbation_decoupage', action.decoupage, 'Clear split, every child is testable'));
                log(`  ${'owner'.padEnd(11)} approved the split of cell ${action.chemin}`);
              }
            }
            const live = await owner.hive(slug);
            if (live.statut === 'terminee') done = true;
            else await pace(action ? 900 : 1500);
          }
        }),
      );
      log(`★ Hive “${slug}” complete. Every cell is honey.\n`);
      await sleep(10_000 / opts.speed);
    }
  })();

  return server;
}
