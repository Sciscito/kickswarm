import { makeDecision, makeDecomposition, makeHive } from '../../protocol/builders.js';
import type { CoordinatorClient } from '../../plugin/client.js';
import { BENCHMARK } from './benchmark.js';
import { BOUCLIER } from './bouclier.js';
import type { ProjetLancement } from './commun.js';
import { KICKSWARM } from './kickswarm.js';

export type { ProjetLancement } from './commun.js';

// `kickswarm launch <project>` (docs/projets.md): proposes a prepared project, approves it when the
// launcher is the founder, takes its heart as the scout, hands in the prepared split with its hidden
// tests and references (the coordinator measures the strength of the tests), and approves the split
// as the owner. The cells are then open to every bee.

export const PROJETS: Record<string, ProjetLancement> = {
  [KICKSWARM.slug]: KICKSWARM,
  [BENCHMARK.slug]: BENCHMARK,
  [BOUCLIER.slug]: BOUCLIER,
};

export async function lancerProjet(client: CoordinatorClient, p: ProjetLancement, log: (l: string) => void = () => {}): Promise<{ cellules: number; deja?: true }> {
  const moi = client.identite;
  const info = await client.info();
  // Safe to run again: a project already proposed goes on from where it stopped, one already split is left alone.
  const vue = await client.hive(p.slug).catch(() => null);
  let statut = vue?.statut ?? null;
  const coeur = vue?.alveoles.find((a) => a.profondeur === 0);
  if (statut !== null && statut !== 'proposee' && (!coeur || coeur.enfants > 0 || !['libre', 'reservee', 'en_cours'].includes(coeur.etat))) {
    log(`“${p.nom}” is already open.`);
    return { cellules: 0, deja: true };
  }
  if (statut === null) {
    await client.proposeHive(makeHive(moi, { slug: p.slug, nom: p.nom, objectif: p.objectif }), p.racine);
    log(`Proposed “${p.nom}”.`);
    statut = 'proposee';
  }
  if (statut === 'proposee') {
    if (info.fondateur !== moi.id) {
      log('It now waits for the founder’s approval; run this command again once it is approved to hand in its first split.');
      return { cellules: 0 };
    }
    await client.decide(makeDecision(moi, 'approbation_ruche', p.slug, 'Launch project from docs/projets.md'));
    log('Approved (you are the founder of this coordinator).');
  }
  const a = await client.claim(p.slug, ['eclaireuse']);
  if (!a || a.caste !== 'eclaireuse') throw new Error('The heart of the project could not be taken as the scout');
  await client.start(a.alveole_id);
  const d = await client.decompose(makeDecomposition(moi, a.alveole_id, p.enfants), p.secrets);
  log(`First split handed in: ${p.enfants.length} cells, tests measured by the coordinator.`);
  if (d.statut === 'en_attente_porteur') {
    await client.decide(makeDecision(moi, 'approbation_decoupage', d.decoupage, 'Prepared first split of a launch project'));
    log('Split approved: the cells are open to every bee.');
  }
  return { cellules: p.enfants.length };
}
