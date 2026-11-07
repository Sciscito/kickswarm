import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { Coordinator } from '../src/coordinator/coordinator.js';
import { createCoordinatorServer } from '../src/coordinator/http.js';
import { seededRng } from '../src/coordinator/scheduler.js';
import { ENFANTS, RACINE, SOLUTIONS } from '../src/exemples/maths.js';
import { makeDecision, makeDecomposition, makeHive, makeRequete } from '../src/protocol/builders.js';
import { generateIdentity } from '../src/protocol/identity.js';
import type { CellSpec } from '../src/protocol/types.js';
import { creerCleRunner, executeurTexte, rendre, tirer, tour } from '../src/runner/runner.js';
import { executeursNode } from '../src/verifier/v0.js';

// OSP v0.5 H3: a runner works for its main identity over HTTP, from sealed cards only, runs an executor
// with the sealed prompt, checks the deliverable locally and hands it in with the prompt hash.

const fondateur = generateIdentity();
const PREMIER = ENFANTS[1]!;

async function hiveServer(enfants: CellSpec[]) {
  const c = new Coordinator({ fondateur: fondateur.id, params: { taux_pieges: 0, gardiennes_v0: 0, enfants_min: 1 }, rng: seededRng(11) });
  c.proposeHive(makeHive(fondateur, { slug: 'maths', nom: 'Maths', objectif: RACINE.objectif }), RACINE);
  c.decide(makeDecision(fondateur, 'approbation_ruche', 'maths', 'ok'));
  const eclaireuse = generateIdentity();
  const s = c.claim(makeRequete(eclaireuse, 'claim', { ruche: 'maths', castes: ['eclaireuse'] }))!;
  const d = await c.submitDecomposition(makeDecomposition(eclaireuse, s.alveole_id, enfants));
  if (d.statut === 'en_attente_porteur') c.decide(makeDecision(fondateur, 'approbation_decoupage', d.decoupage, 'ok'));
  const http = createCoordinatorServer(c);
  await new Promise<void>((ok) => http.listen(0, '127.0.0.1', ok));
  const url = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
  return { c, url, close: () => new Promise<void>((ok) => http.close(() => ok())) };
}

/** An answer in the format the sealed prompt asks for: the file in one code block. */
const answer = (module: string, code: string) => `\`\`\`js ${module}\n${code}\n\`\`\``;

test('a runner key draws a sealed card over HTTP, an executor fills it, the result goes in with its prompt hash', async () => {
  const h = await hiveServer([PREMIER]);
  try {
    const main = generateIdentity();
    const cle = await creerCleRunner(h.url, main, 'maths', { parJour: 3 });
    let seen = '';
    const executer = executeurTexte(async (prompt) => {
      seen = prompt;
      return { texte: answer('premier.mjs', SOLUTIONS['premier.mjs']!), agent: 'test-model:free' };
    }, executeursNode());
    const issue = await tour(cle, 'kickswarm-engine', executer);
    assert.equal(issue, 'rendu');
    assert.match(seen, /one pass/, 'the executor received the sealed prompt itself');
    assert.ok(h.c.account(main.id).miel_gagne > 0, 'the honey goes to the main identity');
    const miels = h.c.registry.entries.filter((e) => e.nature === 'miel').map((e) => e.donnees as Record<string, unknown>);
    assert.ok(miels.length && miels.every((m) => m.beneficiaire !== cle.identite.id), 'nothing is paid to the runner key');
  } finally {
    await h.close();
  }
});

test('a failing executor gives the cell back; a tampered prompt hash is refused', async () => {
  const h = await hiveServer([PREMIER]);
  try {
    const cle = await creerCleRunner(h.url, generateIdentity(), 'maths', { parJour: 5 });
    const wrong = executeurTexte(async () => ({ texte: answer('premier.mjs', 'export function estPremier() { return true; }'), agent: 'weak:free' }), executeursNode(), { essais: 2 });
    assert.equal(await tour(cle, 'kickswarm-engine', wrong), 'abandonne');

    const t = (await tirer(cle, 'kickswarm-engine'))!;
    assert.ok(t, 'the cell went back to the draw and can be drawn again');
    const forged = { ...t, carte: { ...t.carte, prompt_hash: `sha256:${'0'.repeat(64)}` as `sha256:${string}` } };
    await assert.rejects(
      rendre(cle, forged, { livrable: { fichiers: { 'premier.mjs': SOLUTIONS['premier.mjs']! } }, agent: 'x' }),
      /not made from the sealed card/,
    );
  } finally {
    await h.close();
  }
});
