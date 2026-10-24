import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { auditRegistry } from '../src/coordinator/audit.js';
import { Coordinator } from '../src/coordinator/coordinator.js';
import { createCoordinatorServer } from '../src/coordinator/http.js';
import { seededRng } from '../src/coordinator/scheduler.js';
import { ENFANTS, RACINE, SOLUTIONS } from '../src/exemples/maths.js';
import { ENFANTS_ROBLOX, RACINE_ROBLOX, SECRETS_ROBLOX, SOLUTIONS_LUAU } from '../src/exemples/roblox.js';
import { makeDecision, makeDecomposition, makeHive, makeRequete, makeResult } from '../src/protocol/builders.js';
import { genererIdentiteWeb, identiteValide, signataireWeb } from '../src/protocol/identite-web.js';
import { generateIdentity, isPostQuantum, verifyObject } from '../src/protocol/identity.js';
import * as objets from '../src/protocol/objets.js';
import type { Assignment, CritereV0, Livrable } from '../src/protocol/types.js';
import { fiche, promptChat, requeteApi, texteAgent, tientDansUnChat } from '../src/taches/fiche.js';
import { ErreurLecture, lireJson, lireReponse } from '../src/taches/lecteur.js';
import { verifier } from '../src/verifier/coeur.js';
import { verifierV0 } from '../src/verifier/v0.js';
import { executeursNavigateur } from '../src/web/executeurs.js';
import { Porte, stockageMemoire } from '../src/web/porte.js';

// OSP v0.4 U1 and U2: one task card for every door, a reader for what chats answer, and the chat
// and guard doors: a browser bee with its own post-quantum identity, the coordinator's own engines,
// and nothing else. Everything here runs the code the page runs.

const fondateur = generateIdentity();
const eclaireuse = generateIdentity();

/** A coordinator with the maths hive (JavaScript) and the Roblox economy (Luau), split into worker cells. */
async function ruches(params: ConstructorParameters<typeof Coordinator>[0]['params'] = {}) {
  const c = new Coordinator({ fondateur: fondateur.id, params: { alpha_faux: 0.05, taux_pieges: 0, ...params }, rng: seededRng(4) });
  for (const [slug, racine, enfants, secrets] of [
    ['maths', RACINE, ENFANTS, undefined],
    ['economy', RACINE_ROBLOX, ENFANTS_ROBLOX, SECRETS_ROBLOX],
  ] as const) {
    c.proposeHive(makeHive(fondateur, { slug, nom: slug, objectif: racine.objectif, ...(slug === 'economy' ? { playbook: 'roblox-pure-logic-first' } : {}) }), racine);
    c.decide(makeDecision(fondateur, 'approbation_ruche', slug, 'ok'));
    const s = c.claim(makeRequete(eclaireuse, 'claim', { ruche: slug, castes: ['eclaireuse'] }))!;
    assert.equal(s.caste, 'eclaireuse');
    const d = await c.submitDecomposition(makeDecomposition(eclaireuse, s.alveole_id, [...enfants]), secrets ? [...secrets] : []);
    if (d.statut === 'en_attente_porteur') c.decide(makeDecision(fondateur, 'approbation_decoupage', d.decoupage, 'ok'));
  }
  return c;
}

async function serveur(c: Coordinator) {
  const http = createCoordinatorServer(c);
  await new Promise<void>((ok) => http.listen(0, '127.0.0.1', ok));
  const url = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
  return {
    url,
    fermer: async () => {
      http.closeAllConnections();
      await new Promise<void>((ok) => http.close(() => ok()));
    },
  };
}

test('browser identity: the same hybrid pq1 identity as the CLI, verified by Node', () => {
  const i = genererIdentiteWeb();
  assert.ok(isPostQuantum(i.id) && identiteValide(i));
  const r = objets.requete(signataireWeb(i), 'claim', { castes: ['gardienne'] });
  assert.ok(verifyObject(r, i.id), 'Node verifies a signature made with the browser libraries');
  assert.ok(!verifyObject({ ...r, castes: ['ouvriere'] }, i.id));
  assert.ok(!identiteValide({ ...i, id: genererIdentiteWeb().id }), 'a stored identity that does not match its keys is refused');
});

test('task card: the same cell as an agent text, an API request and one chat message', async () => {
  const c = await ruches();
  const a = c.claim(makeRequete(generateIdentity(), 'claim', { ruche: 'economy', castes: ['ouvriere'] }))!;
  const f = fiche(a);
  assert.equal(f.livrable.langage, 'luau');
  assert.match(f.livrable.module, /^src\/shared\/(Coins|Shop)\.luau$/);
  assert.ok(f.playbook?.titre.includes('pure logic first'));
  assert.ok(tientDansUnChat(f));
  const chat = promptChat(f);
  assert.match(chat, /## Done when\n1\. /);
  assert.match(chat, /```luau src\/shared\/(Coins|Shop)\.luau\n--!strict/, 'the answer format, with an example');
  assert.match(chat, /<data>[\s\S]*<\/data>/, 'the capsule stays framed as data');
  const api = requeteApi(f);
  assert.ok(!api.user.includes('## Answer format') && api.user.includes('## Done when'));
  assert.deepEqual((api.schema.required as string[]), ['files']);
  assert.match(texteAgent(a), /# Worker bee/);
  // A builder's card carries the children's verified work, as data to build on.
  const scout = { ...a, caste: 'eclaireuse' } as Assignment;
  assert.throws(() => fiche(scout), /writing work/);
});

test('answer reader: what five different chats really answer', () => {
  const code = 'export function pgcd(a, b) {\n  return b === 0 ? a : pgcd(b, a % b);\n}\n';
  const attendu = { module: 'pgcd.mjs' };
  const reponses = [
    // Path on the fence line.
    `\`\`\`js pgcd.mjs\n${code}\`\`\``,
    // A title attribute, and prose around it.
    `Sure! Here it is:\n\n\`\`\`javascript title="pgcd.mjs"\n${code}\`\`\`\n\nIt uses Euclid's algorithm.`,
    // A bold file name on the line before, Windows line ends.
    `**pgcd.mjs**\r\n\`\`\`js\r\n${code.replace(/\n/g, '\r\n')}\`\`\``,
    // A heading with the path in backticks, and a shell block to ignore.
    `### File: \`pgcd.mjs\`\n\`\`\`\n${code}\`\`\`\n\nRun it with:\n\`\`\`bash\nnode test.mjs\n\`\`\``,
    // A single unnamed block, tildes.
    `~~~\n${code}~~~`,
  ];
  for (const r of reponses) assert.deepEqual(lireReponse(r, attendu).fichiers, { 'pgcd.mjs': code }, r.slice(0, 40));
  // Several files with paths, a deletion inside the write scope.
  const repo = lireReponse('```luau src/a.luau\nreturn 1\n```\n```luau src/b.luau\nreturn 2\n```\nDELETE: src/old.luau', { module: 'src/a.luau', portee: ['src/'] });
  assert.deepEqual(Object.keys(repo.fichiers), ['src/a.luau', 'src/b.luau']);
  assert.deepEqual(repo.supprimes, ['src/old.luau']);
  // What is refused, with a message a person can act on.
  assert.throws(() => lireReponse('Here is the idea: use Euclid.', attendu), /No code block found/);
  assert.throws(() => lireReponse('```js\na()\n```\n```js\nb()\n```', attendu), /Several code blocks without a file path/);
  assert.throws(() => lireReponse('```luau src/x.luau\nreturn 1\n```', { module: 'src/x.luau', portee: ['src/a.luau'] }), /Outside what this task may write/);
  assert.throws(() => lireReponse('```js\nx\n```\nDELETE: a.js', attendu), ErreurLecture);
  // JSON answers: a fence, trailing commas.
  assert.deepEqual(lireJson('Here:\n```json\n{ "a": [1, 2,], }\n```'), { a: [1, 2] });
});

test('browser executors: the same verdicts as the coordinator, in JavaScript and Luau', async () => {
  const ex = executeursNavigateur();
  const js = ENFANTS[0]!.critere_fini as CritereV0;
  const luau = ENFANTS_ROBLOX[1]!.critere_fini;
  for (const [crit, l] of [
    [js, { fichiers: { 'pgcd.mjs': SOLUTIONS['pgcd.mjs']! } }],
    [js, { fichiers: { 'pgcd.mjs': 'export function pgcd(a, b) { return a; }\n' } }],
    [luau, { fichiers: { 'src/shared/Shop.luau': SOLUTIONS_LUAU['src/shared/Shop.luau']! } }],
    [luau, { fichiers: { 'src/shared/Shop.luau': SOLUTIONS_LUAU['src/shared/Shop.luau']!.replace('local Shop = {}', 'local Shop = {}\nlocal oops = 1') } }],
  ] as const) {
    const navigateur = await verifier(crit, l as Livrable, { sansCaches: true }, ex);
    const noeud = await verifierV0(crit, l as Livrable, { sansCaches: true });
    assert.equal(navigateur.ok, noeud.ok);
    assert.equal(navigateur.motif, noeud.motif);
  }
});

test('chat door and guard door: a chat answer becomes honey, a browser with no AI catches a trap, the audit passes', async () => {
  const c = await ruches({ taux_pieges: 1, gardiennes_v0: 1 });
  const { url, fermer } = await serveur(c);
  try {
    const ex = executeursNavigateur();
    const chat = new Porte(url, stockageMemoire(), ex);
    const garde = new Porte(url, stockageMemoire(), ex);
    assert.notEqual(chat.identite().id, garde.identite().id);

    // The chat door takes writing work only.
    const t = (await chat.prendre('maths'))!;
    assert.ok(t && (t.assignment.caste === 'ouvriere' || t.assignment.caste === 'batisseuse'));
    assert.equal((await chat.prendre('maths'))!.assignment.alveole_id, t.assignment.alveole_id, 'a reload gives back the task in progress');
    const module = t.fiche.livrable.module;
    assert.ok(t.prompt.includes(`\`\`\`js ${module}`));

    // A wrong answer: refused here, with a fix message to paste back into the chat. Nothing is sent.
    const faux = await chat.verifier(`Sure!\n\`\`\`js\nexport function ${t.fiche.livrable.fonctions[0]}() { return -1; }\n\`\`\``);
    assert.ok(!faux.rapport.ok);
    assert.match(faux.correctif!, /Your code was checked and it is not right yet/);
    // The right answer passes here, then is signed and handed in.
    const bon = await chat.verifier(`**${module}**\n\`\`\`js\n${SOLUTIONS[module]}\`\`\``);
    assert.ok(bon.rapport.ok, bon.rapport.motif);
    const rendu = await chat.rendre(bon.livrable, 'Le Chat');
    assert.equal(rendu.statut, 'en_verification', rendu.motif);
    assert.equal(chat.enCours(), null);

    // The guard door: only verifications. At a trap rate of 1, a newcomer first gets a trap.
    const issues: string[] = [];
    for (let i = 0; i < 6 && !issues.includes('verdict recorded (miel)'); i++) {
      const g = await garde.garder('maths');
      if (g?.issue) issues.push(g.issue);
      for (const r of await garde.reveler()) issues.push(r.issue);
    }
    assert.ok(issues.includes('trap caught'), issues.join(', '));
    assert.ok(issues.includes('verdict recorded (miel)'), issues.join(', '));
    assert.ok((await chat.compte()).miel_gagne > 0, 'the chat bee earned honey');
    assert.ok((await garde.compte()).miel_gagne > 0, 'the guard bee earned honey, with no AI at all');

    // The result says it came from a chat, as declared.
    const soumis = c.registry.entries.find((e) => e.nature === 'commande' && (e.donnees as { type: string }).type === 'submitResult');
    assert.deepEqual(((soumis!.donnees as { entree: { resultat: { agent: unknown } } }).entree.resultat.agent), { famille: 'chat', modele: 'Le Chat' });

    const report = await auditRegistry(c.registry.entries, { reverifier: true, etatAnnonce: c.stateHash() });
    assert.ok(report.ok, JSON.stringify(report.controles.filter((x) => !x.ok)));
    assert.match(report.controles.find((x) => x.nom === 'Contributor signatures')!.detail!, /100%\) are post-quantum/);
  } finally {
    await fermer();
  }
});

test('claim by caste: a door asks only for what it does, and an old registry replays the same', async () => {
  const c = await ruches();
  const w = generateIdentity();
  assert.equal(c.claim(makeRequete(w, 'claim', { castes: ['gardienne'] })), null, 'no verification pending: nothing for the guard door');
  const a = c.claim(makeRequete(w, 'claim', { castes: ['ouvriere'] }))!;
  assert.equal(a.caste, 'ouvriere');
  assert.throws(() => c.claim(makeRequete(w, 'claim', { castes: ['reine' as 'ouvriere'] })), /castes/);
  const livrable: Livrable = { fichiers: { [(a.alveole.critere_fini as CritereV0).module ?? 'x.mjs']: SOLUTIONS[(a.alveole.critere_fini as CritereV0).module!] ?? '' } };
  if (a.alveole.critere_fini.verificateur === 'tests-js@1') await c.submitResult(makeResult(w, a.alveole_id, 'ouvriere', livrable), livrable);
  const report = await auditRegistry(c.registry.entries, { etatAnnonce: c.stateHash() });
  assert.ok(report.ok, JSON.stringify(report.controles.filter((x) => !x.ok)));
});

test('the page and its modules: served by the coordinator, and nothing outside the allowlist', async () => {
  const { url, fermer } = await serveur(await ruches());
  try {
    const page = await fetch(`${url}/bee`);
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, /<script type="importmap">/);
    // Every library the page maps is really served.
    const carte = JSON.parse(/<script type="importmap">([\s\S]*?)<\/script>/.exec(html)![1]!) as { imports: Record<string, string> };
    for (const [nom, chemin] of Object.entries(carte.imports)) {
      if (chemin.endsWith('/')) continue;
      assert.equal((await fetch(url + chemin)).status, 200, nom);
    }
    const app = await fetch(`${url}/app/web/porte.js`);
    assert.equal(app.status, 200);
    assert.match(app.headers.get('content-type')!, /javascript/);
    assert.match(await app.text(), /class Porte/);
    assert.equal((await fetch(`${url}/vendor/@noble/hashes/sha2.js`)).status, 200);
    assert.equal((await fetch(`${url}/vendor/@luau-rs/luau/dist/luau_wasm_bg.wasm`)).headers.get('content-type'), 'application/wasm');
    for (const interdit of [
      '/vendor/@modelcontextprotocol/sdk/package.json',
      '/vendor/@noble/hashes/package.json',
      '/vendor/@noble/hashes/../../../package.json',
      '/vendor/@noble/hashes/%2e%2e/%2e%2e/package.json',
      '/app/coordinator/coordinator.js',
      '/app/web/../coordinator/http.js',
      '/app/web/porte.ts',
    ]) {
      assert.equal((await fetch(url + interdit)).status, 404, interdit);
    }
  } finally {
    await fermer();
  }
});
