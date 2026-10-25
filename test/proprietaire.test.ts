import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { auditRegistry } from '../src/coordinator/audit.js';
import { Coordinator } from '../src/coordinator/coordinator.js';
import { Garde } from '../src/coordinator/garde.js';
import { Hote } from '../src/coordinator/hote.js';
import { createCoordinatorServer } from '../src/coordinator/http.js';
import { FICHIER_PROPRIETAIRE, Proprietaire } from '../src/coordinator/proprietaire.js';
import { seededRng } from '../src/coordinator/scheduler.js';
import type { CritereLuau, CritereV0 } from '../src/protocol/types.js';
import { ErreurCadrage, lireCadrage, phraseTest, promptCadrage, slugDe, type Idee } from '../src/taches/cadrage.js';
import { executeursNavigateur } from '../src/web/executeurs.js';
import { Porte, stockageMemoire } from '../src/web/porte.js';

// A creator's own hive server (docs/host-your-hive.md): the creator describes an idea, their own AI
// frames it (the heart, its examples, a first plan), the owner code opens it from /create, and people
// with nothing but an AI chat or a browser build it to the end. Everything is in the registry.

const CODE = 'correct-horse-battery-staple-42';
const IDEE: Idee = { nom: 'Text tools', objectif: 'A small library of text helpers: slugs, word counts and title case.', langage: 'javascript' };

/** What a creator's AI answers (prose around a JSON block, as chats do). */
const REPONSE = `Here is the plan for your project:

\`\`\`json
{
  "module": "text.mjs",
  "description": "Three text helpers. text.mjs re-exports slugify from slug.mjs and wordCount and titleCase from words.mjs.",
  "functions": ["slugify", "wordCount", "titleCase"],
  "examples": [
    { "fn": "slugify", "args": ["Hello World"], "expected": "hello-world" },
    { "fn": "slugify", "args": ["  Déjà vu!  "], "expected": "d-j-vu" },
    { "fn": "wordCount", "args": ["one two  three"], "expected": 3 },
    { "fn": "wordCount", "args": [""], "expected": 0 },
    { "fn": "titleCase", "args": ["the swarm WORKS"], "expected": "The Swarm Works" },
    { "fn": "titleCase", "args": ["a"], "expected": "A" },
  ],
  "parts": [
    {
      "module": "slug.mjs",
      "goal": "Turn any text into a URL slug.",
      "functions": ["slugify"],
      "examples": [
        { "fn": "slugify", "args": ["Hello World"], "expected": "hello-world" },
        { "fn": "slugify", "args": ["--A  b--"], "expected": "a-b" },
        { "fn": "slugify", "args": [""], "expected": "" }
      ]
    },
    {
      "module": "words.mjs",
      "goal": "Count words and put text in title case.",
      "functions": ["wordCount", "titleCase"],
      "examples": [
        { "fn": "wordCount", "args": ["one two  three"], "expected": 3 },
        { "fn": "wordCount", "args": ["   "], "expected": 0 },
        { "fn": "titleCase", "args": ["the swarm WORKS"], "expected": "The Swarm Works" }
      ]
    }
  ]
}
\`\`\`

Every example was computed by hand.`;

const CODE_DES_PARTIES: Record<string, string> = {
  'slug.mjs': "export function slugify(s) {\n  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');\n}\n",
  'words.mjs':
    "export function wordCount(s) {\n  const t = s.trim();\n  return t ? t.split(/\\s+/).length : 0;\n}\nexport function titleCase(s) {\n  return s.split(' ').map((w) => (w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w)).join(' ');\n}\n",
  'text.mjs': "export { slugify } from './slug.mjs';\nexport { wordCount, titleCase } from './words.mjs';\n",
};

test('framing: the request for the creator’s AI, its answer read into a heart and a first plan', () => {
  const p = promptCadrage({ ...IDEE, details: 'Keep it dependency-free.' });
  assert.match(p, /Project name: Text tools/);
  assert.match(p, /Keep it dependency-free\./);
  assert.match(p, /2 to 8 parts/);
  assert.match(p, /```json\n\{\n {2}"module": "name\.mjs"/);

  const c = lireCadrage(REPONSE, IDEE);
  assert.equal(c.slug, 'text-tools');
  assert.equal(c.racine.atomique, false);
  const tete = c.racine.critere_fini as CritereV0;
  assert.equal(tete.verificateur, 'tests-js@1');
  assert.equal(tete.module, 'text.mjs');
  assert.equal(tete.tests.length, 6, 'a trailing comma in the AI’s JSON is tolerated');
  assert.match(c.racine.capsule, /It assembles the parts: slug\.mjs \(slugify\); words\.mjs \(wordCount, titleCase\)/);
  assert.deepEqual(c.enfants.map((e) => [e.objectif, e.atomique, e.critere_fini.module]), [
    ['Turn any text into a URL slug.', true, 'slug.mjs'],
    ['Count words and put text in title case.', true, 'words.mjs'],
  ]);
  assert.equal(phraseTest(tete.tests[0]!), 'slugify("Hello World") gives "hello-world"');

  // Roblox: Luau modules, the strict checks, and the playbook.
  const luau = lireCadrage(
    JSON.stringify({
      module: 'src/shared/Economy.luau',
      description: 'Coins and a shop for a Roblox game.',
      functions: ['add', 'price'],
      examples: [
        { fn: 'add', args: [1, 2], expected: 3 },
        { fn: 'price', args: ['sword', 2], expected: 100 },
        { fn: 'price', args: ['sword', 0], expected: 0 },
      ],
      parts: [
        { module: 'src/shared/Coins.luau', goal: 'Add coins.', functions: ['add'], examples: [{ fn: 'add', args: [1, 2], expected: 3 }, { fn: 'add', args: [0, 0], expected: 0 }, { fn: 'add', args: [5, -5], expected: 0 }] },
        { module: 'src/shared/Shop.luau', goal: 'Price items.', functions: ['price'], examples: [{ fn: 'price', args: ['sword', 2], expected: 100 }, { fn: 'price', args: ['sword', 1], expected: 50 }, { fn: 'price', args: ['sword', 0], expected: 0 }] },
      ],
    }),
    { ...IDEE, nom: 'Dragon shop', langage: 'luau' },
  );
  assert.equal(luau.playbook, 'roblox-pure-logic-first');
  assert.deepEqual((luau.enfants[1]!.critere_fini as CritereLuau).portes, ['luau-checks@1']);
  assert.equal(luau.enfants[1]!.critere_fini.verificateur, 'tests-luau@1');

  // What is refused, with a message the creator can act on.
  const sans = (f: (r: Record<string, unknown>) => void) => {
    const r = JSON.parse(/```json\n([\s\S]*?)\n```/.exec(REPONSE)![1]!.replace(/,(\s*[}\]])/g, '$1')) as Record<string, unknown>;
    f(r);
    return JSON.stringify(r);
  };
  for (const [texte, motif] of [
    ['I would split it in three parts.', /No JSON found/],
    [sans((r) => delete r.parts), /Plan 2 to 8 parts/],
    [sans((r) => ((r.parts as Array<Record<string, unknown>>)[1]!.module = 'slug.mjs')), /share the file slug\.mjs/],
    [sans((r) => (r.module = '../../etc/passwd')), /The heart: the file must look like "name\.mjs"/],
    [sans((r) => ((r.examples as Array<Record<string, unknown>>)[0]!.fn = 'eval')), /The heart, example 1: “eval” is not in its "functions"/],
    [sans((r) => ((r.parts as Array<Record<string, unknown>>)[0]!.examples = [])), /Part 1: give 3 to 40 examples/],
    [sans((r) => ((r.examples as Array<Record<string, unknown>>)[2]!.expected = undefined)), /"expected" must be a plain JSON value/],
  ] as const) {
    assert.throws(() => lireCadrage(texte, IDEE), (e: unknown) => e instanceof ErreurCadrage && motif.test(e.message), String(motif));
  }
  assert.throws(() => promptCadrage({ ...IDEE, nom: 'X' }), /name of 3 to 60 characters/);
  assert.equal(slugDe('Déjà Vu — the Game!'), 'deja-vu-the-game');
  assert.equal(slugDe('?!'), 'project-hive');
});

/** A creator's own server, as `kickswarm coordinator --public --owner-code … --trust-proxy` builds it. */
async function serveurCreateur(params: ConstructorParameters<typeof Coordinator>[0]['params'] = {}) {
  const dossier = mkdtempSync(join(tmpdir(), 'kickswarm-owner-'));
  const proprietaire = new Proprietaire(dossier, CODE);
  const c = new Coordinator({ fondateur: proprietaire.identite.id, params: { alpha_faux: 0.05, taux_pieges: 0, gardiennes_v0: 1, ...params }, rng: seededRng(7) });
  const http = createCoordinatorServer(c, new Hote(c), { proprietaire, garde: new Garde({ proxyDistant: true }) });
  await new Promise<void>((ok) => http.listen(0, '127.0.0.1', ok));
  const url = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
  /** An owner request, as the page sends it, from a visitor behind the hosting provider's proxy. */
  const owner = async (chemin: string, corps: Record<string, unknown>, depuis = '203.0.113.7') => {
    const r = await fetch(`${url}/v0/owner/${chemin}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': depuis }, body: JSON.stringify(corps) });
    return { status: r.status, corps: (await r.json()) as Record<string, unknown> };
  };
  return {
    c,
    url,
    dossier,
    proprietaire,
    owner,
    fermer: async () => {
      http.closeAllConnections();
      await new Promise<void>((ok) => http.close(() => ok()));
      rmSync(dossier, { recursive: true, force: true });
    },
  };
}

test('owner page: the code unlocks it, wrong guesses wait, a project opens with its plan already approved', async () => {
  const s = await serveurCreateur();
  try {
    // The owner's key is made once, in the data folder, readable by its owner only.
    const cle = join(s.dossier, FICHIER_PROPRIETAIRE);
    if (process.platform !== 'win32') assert.equal(statSync(cle).mode & 0o077, 0);
    assert.equal(new Proprietaire(s.dossier, CODE).identite.id, s.proprietaire.identite.id, 'the same owner after a restart');
    assert.throws(() => new Proprietaire(s.dossier, 'short'), /at least 16 characters/);

    assert.equal(((await (await fetch(`${s.url}/v0`)).json()) as { proprietaire?: boolean }).proprietaire, true);
    const page = await fetch(`${s.url}/create`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /<title>Open Your Hive<\/title>/);

    // Wrong codes: refused; past ten from one address, even the right code waits there, not elsewhere.
    assert.equal((await s.owner('projects', { code: 'nope' })).status, 403);
    for (let i = 0; i < 9; i++) await s.owner('projects', { code: `guess-${i}` });
    assert.equal((await s.owner('projects', { code: CODE })).status, 429);
    assert.equal((await s.owner('projects', { code: CODE }, '198.51.100.9')).status, 200);

    // A bad answer: the server reads it again and says why.
    const mauvais = await s.owner('hives', { code: CODE, idee: IDEE, reponse: '{"module":"text.mjs"}' }, '198.51.100.9');
    assert.equal(mauvais.status, 400);
    assert.match(String(mauvais.corps.erreur), /functions/);

    const ouvert = await s.owner('hives', { code: CODE, idee: IDEE, reponse: REPONSE }, '198.51.100.9');
    assert.equal(ouvert.status, 201, JSON.stringify(ouvert.corps));
    assert.deepEqual(ouvert.corps, { slug: 'text-tools', cellules: 2, rejoindre: '/join/text-tools', tableau: '/project/text-tools' });
    const vue = s.c.hiveView('text-tools');
    assert.equal(vue.statut, 'active');
    assert.equal(vue.ruche.porteur, s.proprietaire.identite.id);
    assert.equal(vue.alveoles.filter((a) => a.profondeur === 1 && a.etat === 'libre').length, 2, 'the parts are open to every bee');
    assert.equal((await s.owner('hives', { code: CODE, idee: IDEE, reponse: REPONSE }, '198.51.100.9')).status, 409, 'the same name twice');

    const projets = await s.owner('projects', { code: CODE }, '198.51.100.9');
    assert.deepEqual((projets.corps.projets as Array<{ slug: string; attente: unknown[] }>).map((p) => [p.slug, p.attente.length]), [['text-tools', 0]]);
    // Only the decisions of a hive owner.
    const autre = await s.owner('decide', { code: CODE, nature: 'approbation_ruche', cible: 'text-tools', motif: 'ok then' }, '198.51.100.9');
    assert.equal(autre.status, 400);
    // A coordinator started without an owner code has no owner page.
    const nu = createCoordinatorServer(new Coordinator({ fondateur: s.proprietaire.identite.id }));
    await new Promise<void>((ok) => nu.listen(0, '127.0.0.1', ok));
    const r = await fetch(`http://127.0.0.1:${(nu.address() as AddressInfo).port}/v0/owner/projects`, { method: 'POST', body: JSON.stringify({ code: CODE }) });
    assert.equal(r.status, 404);
    nu.closeAllConnections();
    await new Promise<void>((ok) => nu.close(() => ok()));
  } finally {
    await s.fermer();
  }
});

test('a creator’s project, built to the end by people with only an AI chat or a browser, then audited', async () => {
  const s = await serveurCreateur();
  try {
    assert.equal((await s.owner('hives', { code: CODE, idee: IDEE, reponse: REPONSE })).status, 201);
    const ex = executeursNavigateur();
    const chats = [new Porte(s.url, stockageMemoire(), ex), new Porte(s.url, stockageMemoire(), ex)];
    const gardes = [new Porte(s.url, stockageMemoire(), ex), new Porte(s.url, stockageMemoire(), ex)];
    const roles: string[] = [];
    for (let tour = 0; tour < 40 && s.c.hiveView('text-tools').statut !== 'terminee'; tour++) {
      for (const chat of chats) {
        const t = await chat.prendre('text-tools');
        if (!t) continue;
        roles.push(t.assignment.caste);
        // What an AI chat answers: only the file of its task. A builder writes the heart; the verified
        // parts' files come with its answer.
        const module = t.fiche.livrable.module;
        const v = await chat.verifier(`\`\`\`js ${module}\n${CODE_DES_PARTIES[module]}\`\`\``);
        if (t.assignment.caste === 'batisseuse') {
          assert.match(t.prompt, /added to your answer automatically/);
          assert.deepEqual(Object.keys(v.livrable.fichiers).sort(), ['slug.mjs', 'text.mjs', 'words.mjs']);
        }
        assert.ok(v.rapport.ok, v.rapport.motif);
        await chat.rendre(v.livrable, 'ChatGPT');
      }
      for (const g of gardes) {
        await g.garder('text-tools');
        await g.reveler();
      }
    }
    assert.equal(s.c.hiveView('text-tools').statut, 'terminee', `the project is complete (${roles.join(', ')})`);
    assert.deepEqual([...new Set(roles)].sort(), ['batisseuse', 'ouvriere'], 'two parts written, then assembled, all from a chat');
    for (const p of [...chats, ...gardes]) assert.ok((await p.compte()).miel_gagne > 0, 'every bee earned honey');

    const report = await auditRegistry(s.c.registry.entries, { reverifier: true, etatAnnonce: s.c.stateHash() });
    assert.ok(report.ok, JSON.stringify(report.controles.filter((x) => !x.ok)));
  } finally {
    await s.fermer();
  }
});
