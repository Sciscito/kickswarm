import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { pontUneFois, messageCommit, type Forge } from '../src/bridge/pont.js';
import { memeDepot } from '../src/bridge/git.js';
import { verifierCommit } from '../src/bridge/verifier.js';
import { auditRegistry } from '../src/coordinator/audit.js';
import { Coordinator } from '../src/coordinator/coordinator.js';
import { Hote } from '../src/coordinator/hote.js';
import { createCoordinatorServer } from '../src/coordinator/http.js';
import type { RegistryEntry } from '../src/coordinator/registry.js';
import { seededRng } from '../src/coordinator/scheduler.js';
import { httpAccess, scriptedBee } from '../src/exemples/scripted-bee.js';
import { makeAdhesion, makeDecision, makeDecomposition, makeHive, makeInvitation, makeLienGithub, makeRecuDepot, makeRequete, makeResult } from '../src/protocol/builders.js';
import { blobsDuLivrable, chevauchent, couvre, empreinteLecture, gitBlobSha1, inclus, validateDepot } from '../src/protocol/depot.js';
import { generateIdentity } from '../src/protocol/identity.js';
import type { CapsuleDepot, CellSpec, Hash, Livrable } from '../src/protocol/types.js';
import { CoordinatorClient } from '../src/plugin/client.js';
import { consignes } from '../src/plugin/consignes.js';
import { lireDepot } from '../src/plugin/depot-local.js';
import { validateLivrable } from '../src/verifier/v0.js';

// OSP v0.3 P0-2: repo capsules, write scopes and the GitHub bridge. A cell's honey becomes a
// commit and a pull request on the real repository, made on a member's machine with their own git;
// the audit checks that the commit holds exactly the validated deliverable.

const URL_DEPOT = 'https://example.test/cousins/game';
const COINS = 'export const COIN_VALUE = 10;\n';
const SHOP = "import { COIN_VALUE } from './coins.mjs';\nexport function price(n) { return n * COIN_VALUE; }\n";

const aGit = (() => {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

function sh(cwd: string, ...args: string[]): string {
  return execFileSync('git', ['-c', 'core.autocrlf=false', ...args], { cwd, encoding: 'utf8' }).trim();
}

/** A "GitHub" repository (a bare one), its first commit, and the owner's clone, which reaches it through the https address. */
function depotDeTest() {
  const dir = mkdtempSync(join(tmpdir(), 'osp-depot-'));
  const nu = join(dir, 'remote.git').replace(/\\/g, '/');
  const graine = join(dir, 'seed');
  const clone = join(dir, 'clone');
  sh(dir, 'init', '--quiet', '--bare', '-b', 'main', nu);
  mkdirSync(join(graine, 'src'), { recursive: true });
  writeFileSync(join(graine, 'src', 'coins.mjs'), COINS);
  writeFileSync(join(graine, 'src', 'old.mjs'), 'export const OLD = 1;\n');
  writeFileSync(join(graine, 'README.md'), '# The cousins’ game\n');
  sh(dir, 'init', '--quiet', '-b', 'main', graine);
  sh(graine, 'add', '.');
  sh(graine, '-c', 'user.name=Seed', '-c', 'user.email=seed@example.test', 'commit', '--quiet', '-m', 'First commit');
  sh(graine, 'push', '--quiet', nu, 'main');
  const base = sh(graine, 'rev-parse', 'HEAD');
  sh(dir, 'clone', '--quiet', nu, clone);
  sh(clone, 'config', 'remote.origin.url', URL_DEPOT);
  sh(clone, 'config', `url.${nu}.insteadOf`, URL_DEPOT);
  sh(clone, 'config', 'user.name', 'Owner');
  sh(clone, 'config', 'user.email', 'owner@example.test');
  return { dir, nu, clone, base, fermer: () => rmSync(dir, { recursive: true, force: true }) };
}

function capsule(base: string, ecriture: string[], lecture: string[] = ['src/coins.mjs']): CapsuleDepot {
  return { url: URL_DEPOT, commit: base, lecture, empreintes_lecture: Object.fromEntries(lecture.map((p) => [p, empreinteLecture(COINS)])), ecriture };
}

function celluleShop(depot: CapsuleDepot): CellSpec {
  return {
    objectif: 'The shop: price of n items in coins',
    capsule: 'price(n) returns the price of n items, using COIN_VALUE from src/coins.mjs.',
    atomique: true,
    critere_fini: {
      classe: 'V0',
      verificateur: 'tests-js@1',
      module: 'src/shop.mjs',
      tests: [
        { fn: 'price', args: [3], attendu: 30 },
        { fn: 'price', args: [0], attendu: 0 },
      ],
    },
    depot,
  };
}

test('repo capsules: paths, write scopes and git hashes', () => {
  const ok = capsule('a'.repeat(40), ['src/shop.mjs', 'src/ui/']);
  validateDepot(ok);
  for (const [mauvais, motif] of [
    [{ ...ok, url: 'http://example.test/a/b' }, /https/],
    [{ ...ok, commit: 'main' }, /full hexadecimal/],
    [{ ...ok, ecriture: ['../etc/passwd'] }, /refused/],
    [{ ...ok, ecriture: ['.github/workflows/x.yml'] }, /refused/],
    [{ ...ok, ecriture: [] }, /declares the files/],
    [{ ...ok, empreintes_lecture: {} }, /exactly the files read/],
  ] as const) {
    assert.throws(() => validateDepot(mauvais as CapsuleDepot), motif);
  }
  assert.ok(couvre(['src/ui/'], 'src/ui/Button.luau') && !couvre(['src/ui/'], 'src/uix.luau') && couvre(['a.mjs'], 'a.mjs'));
  assert.ok(chevauchent(['src/'], ['src/shop.mjs']) && chevauchent(['src/a.mjs'], ['src/a.mjs']) && !chevauchent(['src/a.mjs'], ['src/b.mjs']));
  assert.ok(inclus(['src/ui/x.mjs'], ['src/']) && !inclus(['docs/x.md'], ['src/']));
  assert.ok(memeDepot('git@github.com:Cousins/Game.git', 'https://github.com/cousins/game') && !memeDepot('https://github.com/a/b', 'https://github.com/a/c'));

  // Deliverables now carry repository paths and deletions, never a way out of the folder.
  validateLivrable({ fichiers: { 'src/ui/shop.luau': '--', 'src/shop.mjs': '' }, supprimes: ['src/old.mjs'] });
  validateLivrable({ fichiers: {}, supprimes: ['src/old.mjs'] });
  for (const f of ['../x.mjs', 'src/../x.mjs', '/etc/x.mjs', '.git/config.json', 'src/.hidden.mjs']) assert.throws(() => validateLivrable({ fichiers: { [f]: '' } }), /refused/, f);
  assert.throws(() => validateLivrable({ fichiers: { 'a.mjs': '' }, supprimes: ['a.mjs'] }), /both written and deleted/);

  if (aGit) {
    // The coordinator computes the same hash as git, without git.
    const d = mkdtempSync(join(tmpdir(), 'osp-blob-'));
    try {
      for (const contenu of ['', 'é\r\nà\n', SHOP]) {
        writeFileSync(join(d, 'f'), contenu, 'utf8');
        assert.equal(gitBlobSha1(contenu), sh(d, 'hash-object', '--no-filters', 'f'));
      }
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  }
});

test('write scopes: two cells on the same file are never open at the same time', async () => {
  const fondateur = generateIdentity();
  const eclaireuse = generateIdentity();
  const base = 'b'.repeat(40);
  const c = new Coordinator({ fondateur: fondateur.id, params: { alpha_faux: 0.05, taux_pieges: 0 }, rng: seededRng(3) });
  const racine: CellSpec = { ...celluleShop(capsule(base, ['src/'])), objectif: 'The game logic', atomique: false };
  c.proposeHive(makeHive(fondateur, { slug: 'game', nom: 'Game', objectif: 'A game' }), racine);
  c.decide(makeDecision(fondateur, 'approbation_ruche', 'game', 'ok'));
  const a = c.claim(makeRequete(eclaireuse, 'claim'))!;
  assert.equal(a.caste, 'eclaireuse');
  const enfant = (objectif: string, ecriture: string[]): CellSpec => ({ ...celluleShop(capsule(base, ecriture)), objectif });
  // A child cannot write outside its parent's scope.
  await assert.rejects(
    c.submitDecomposition(makeDecomposition(eclaireuse, a.alveole_id, [enfant('Shop', ['src/shop.mjs']), enfant('Docs', ['docs/shop.md'])])),
    /stays inside its parent/,
  );
  const d = await c.submitDecomposition(
    makeDecomposition(eclaireuse, a.alveole_id, [enfant('Shop', ['src/shop.mjs']), enfant('Shop UI', ['src/shop.mjs', 'src/ui/']), enfant('Coins', ['src/coins.mjs'])]),
  );
  if (d.statut === 'en_attente_porteur') c.decide(makeDecision(fondateur, 'approbation_decoupage', d.decoupage, 'ok'));

  const abeilles = [generateIdentity(), generateIdentity(), generateIdentity()];
  const prises = abeilles.map((b) => c.claim(makeRequete(b, 'claim')));
  const objectifs = prises.filter(Boolean).map((p) => p!.alveole.objectif);
  assert.equal(objectifs.length, 2, 'the third bee waits: the only free cell overlaps an open one');
  assert.ok(objectifs.includes('Coins'));
  assert.ok(!(objectifs.includes('Shop') && objectifs.includes('Shop UI')), 'never both cells on src/shop.mjs');
  // A cell may only write inside its scope.
  const i = prises.findIndex((p) => p && p.alveole.objectif !== 'Coins');
  const tenue = prises[i]!;
  const hors: Livrable = { fichiers: { 'src/shop.mjs': SHOP, 'src/coins.mjs': COINS } };
  await assert.rejects(c.submitResult(makeResult(abeilles[i]!, tenue.alveole_id, 'ouvriere', hors), hors), /Outside this cell's write scope: src\/coins\.mjs/);
  // Once the cell goes back to the swarm, the other one opens.
  c.release(makeRequete(abeilles[i]!, 'release', { alveole: tenue.alveole_id }));
  const ensuite = c.claim(makeRequete(abeilles[2]!, 'claim'));
  assert.ok(ensuite && ensuite.alveole.objectif !== 'Coins');
});

test('plugin: the files read come from the member’s clone, checked against the signed cell', { skip: !aGit }, async () => {
  const r = depotDeTest();
  try {
    const depot = capsule(r.base, ['src/shop.mjs']);
    const lu = await lireDepot(depot, { [`${URL_DEPOT}.git`]: r.clone });
    assert.deepEqual(lu.fichiers, { 'src/coins.mjs': COINS });
    const faux = await lireDepot({ ...depot, empreintes_lecture: { 'src/coins.mjs': empreinteLecture('tampered') } }, { [URL_DEPOT]: r.clone });
    assert.match(faux.manquants[0]!.raison, /does not match the hash/);
    const sans = await lireDepot(depot, {});
    assert.match(sans.manquants[0]!.raison, /no local clone/);
    const cell = { ...celluleShop(depot), type: 'osp.cell/0.1', ruche: 'game', parent: null, chemin: '0', capsule: 'sha256:x', budget: { tokens_max: 1, duree_max_s: 1 }, emise_par: 'coordinateur' } as never;
    const texte = consignes({ caste: 'ouvriere', alveole: cell, alveole_id: 'sha256:y' as Hash, capsule: 'ctx', bail_expire: Date.now() } as never, lu);
    assert.match(texte, /Your write scope: `src\/shop\.mjs`/);
    assert.ok(texte.includes(`<file path="src/coins.mjs">\n${COINS}`), 'the file is given as data');
  } finally {
    r.fermer();
  }
});

test('bridge: the cousin’s honey becomes a pull request with the right co-author, and the audit checks the commit', { skip: !aGit }, async () => {
  const r = depotDeTest();
  const fondateur = generateIdentity();
  const proprio = generateIdentity();
  const cousin = generateIdentity();
  const coord = new Coordinator({ fondateur: fondateur.id, params: { taux_pieges: 0 } });
  const hote = new Hote(coord);
  const http = createCoordinatorServer(coord, hote);
  await new Promise<void>((ok) => http.listen(0, '127.0.0.1', ok));
  const url = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
  try {
    // The cousins' private hive, on their game's repository.
    const owner = new CoordinatorClient(url, proprio);
    const ruche = makeHive(proprio, { slug: 'cousins-game', nom: 'The cousins’ game', objectif: 'A small game', privee: true });
    const { id, slug } = await owner.creerRuchePrivee(ruche, celluleShop(capsule(r.base, ['src/shop.mjs', 'src/old.mjs'])), makeDecision(proprio, 'approbation_ruche', ruche.slug, 'Our game'));
    owner.utiliserRuchePrivee(id);
    const { invitation, code } = makeInvitation(proprio, id);
    await owner.inviter(invitation);
    const cc = new CoordinatorClient(url, cousin);
    await cc.rejoindreAvecCode(makeAdhesion(cousin, code));
    cc.utiliserRuchePrivee(id);
    await cc.lienGithub(makeLienGithub(cousin, 'cousin-dev'));
    await assert.rejects(owner.lienGithub(makeLienGithub(proprio, 'Cousin-Dev')), /already linked/);

    // The cousin's bee writes the shop and deletes the old file; the owner's bee verifies it.
    const a = (await cc.claim(slug))!;
    assert.equal(a.alveole.depot?.commit, r.base, 'the signed cell pins the commit');
    await cc.start(a.alveole_id);
    const livrable: Livrable = { fichiers: { 'src/shop.mjs': SHOP, 'src/coins.mjs': COINS }, supprimes: ['src/old.mjs'] };
    await assert.rejects(cc.submit(makeResult(cousin, a.alveole_id, 'ouvriere', livrable), livrable), (e: { status?: number }) => e.status === 403);
    // The file it reads travels with it, for the tests only, as pinned by the cell (the plugin does this).
    const triche: Livrable = { fichiers: { 'src/shop.mjs': SHOP }, contexte: { 'src/coins.mjs': 'export const COIN_VALUE = 1;\n' } };
    await assert.rejects(cc.submit(makeResult(cousin, a.alveole_id, 'ouvriere', triche), triche), /as pinned by its hash/);
    const bon: Livrable = { fichiers: { 'src/shop.mjs': SHOP }, supprimes: ['src/old.mjs'], contexte: { 'src/coins.mjs': COINS } };
    const sous = await cc.submit(makeResult(cousin, a.alveole_id, 'ouvriere', bon, { agent: { famille: 'claude-code' } }), bon);
    assert.equal(sous.statut, 'en_verification', `${sous.rapport.motif}`);
    const inst = hote.instance(id);
    for (let i = 0; i < 10 && inst.hiveView(slug).statut !== 'terminee'; i++) await scriptedBee(httpAccess(owner, slug), { decompositions: {}, solutions: {} });
    assert.equal(inst.hiveView(slug).statut, 'terminee');

    // The bridge, on the owner's machine, with their git and (here) a stand-in for gh.
    const prs: Array<{ branche: string; titre: string }> = [];
    let fusionnee = false;
    const forge: Forge = {
      async ouvrirPr(o) {
        prs.push({ branche: o.branche, titre: o.titre });
        return `${URL_DEPOT}/pull/1`;
      },
      async etatPr() {
        return fusionnee ? { fusionnee: true, par: 'owner-dev', commit: 'c'.repeat(40) } : { fusionnee: false };
      },
    };
    const avantHead = sh(r.clone, 'rev-parse', 'HEAD');
    const rapport = await pontUneFois({ client: owner, identite: proprio, clone: r.clone, forge });
    assert.equal(rapport.commits.length, 1);
    const { commit, branche } = rapport.commits[0]!;
    assert.equal(branche, 'kickswarm/cousins-game/branch-0');
    assert.deepEqual(prs, [{ branche, titre: 'Kickswarm · The cousins’ game, branch 0: The shop: price of n items in coins' }]);

    // In the "GitHub" repository: the branch, built on the cell's commit, holding exactly the honey.
    assert.equal(sh(r.nu, 'rev-parse', `refs/heads/${branche}`), commit);
    assert.equal(sh(r.nu, 'rev-parse', `${commit}^`), r.base);
    assert.equal(sh(r.nu, 'show', `${commit}:src/shop.mjs`) + '\n', SHOP);
    assert.equal(sh(r.nu, 'diff-tree', '-r', '--no-commit-id', '--name-status', r.base, commit), 'D\tsrc/old.mjs\nA\tsrc/shop.mjs');
    const message = sh(r.nu, 'log', '-1', '--format=%B', commit);
    assert.match(message, /^kickswarm\(0\): The shop/);
    assert.match(message, /Co-authored-by: cousin-dev <cousin-dev@users\.noreply\.github\.com>/);
    assert.match(message, /\nAI: claude-code\n/);
    assert.match(message, /Verified by: tests-js@1 \(V0 tests\), then 1 guard\./);
    assert.equal(sh(r.clone, 'rev-parse', 'HEAD'), avantHead, 'the member’s current branch is untouched');
    assert.equal(sh(r.clone, 'status', '--porcelain'), '', 'and so is their working tree');

    // Nothing twice: the receipt is in the registry.
    assert.equal((await pontUneFois({ client: owner, identite: proprio, clone: r.clone, forge })).commits.length, 0);
    const detail = await owner.cellule(a.alveole_id);
    assert.equal(detail.recus.length, 1);
    assert.equal(detail.recus[0]!.pr, `${URL_DEPOT}/pull/1`);
    // A receipt that does not name exactly the validated deliverable is refused.
    const faux = makeRecuDepot(proprio, {
      alveole: a.alveole_id, resultat: detail.resultat!.id, depot: URL_DEPOT, branche, commit, parent: r.base,
      fichiers: blobsDuLivrable({ fichiers: { 'src/shop.mjs': SHOP + '// extra\n' } }), supprimes: ['src/old.mjs'], pr: null,
    });
    await assert.rejects(owner.recuDepot(faux), /exactly the validated deliverable/);

    // A human merges: the next pass records it, as external evidence.
    fusionnee = true;
    assert.deepEqual((await pontUneFois({ client: owner, identite: proprio, clone: r.clone, forge })).fusions.map((f) => f.par), ['owner-dev']);

    // The audit: the private registry replays, the receipt matches, and the commit checks out in the clone.
    const entries = (await owner.registry()) as RegistryEntry[];
    const report = await auditRegistry(entries, { ancres: await owner.ancres(), verifierCommit: (x) => verifierCommit(r.clone, x) });
    assert.ok(report.ok, JSON.stringify(report.controles.filter((x) => !x.ok)));
    const noms = report.controles.map((x) => x.nom);
    for (const n of ['Repo receipts name exactly the validated deliverables', 'Each receipt’s commit holds exactly that deliverable (checked in your clone)', 'External evidence, not replayable offline']) {
      assert.ok(noms.includes(n), n);
    }
    assert.match(report.controles.find((x) => x.nom.startsWith('External'))!.detail!, /merged by a human.*owner-dev/);

    // A bridge cannot slip a change in: a commit with one more file fails the check.
    const glisse = join(r.dir, 'glisse');
    sh(r.dir, 'clone', '--quiet', '-b', branche, r.nu, glisse);
    writeFileSync(join(glisse, 'backdoor.mjs'), 'export default 1;\n');
    sh(glisse, 'add', '.');
    sh(glisse, '-c', 'user.name=X', '-c', 'user.email=x@example.test', 'commit', '--quiet', '--amend', '--no-edit');
    sh(glisse, 'push', '--quiet', '--force', 'origin', `HEAD:refs/heads/evil`);
    sh(r.clone, 'fetch', '--quiet', 'origin');
    const evil = sh(r.clone, 'rev-parse', 'origin/evil');
    const recu = { commit: evil, parent: r.base, fichiers: blobsDuLivrable(bon), supprimes: ['src/old.mjs'] };
    assert.match((await verifierCommit(r.clone, recu))!, /outside the deliverable: backdoor\.mjs/);
    assert.equal(await verifierCommit(r.clone, { ...recu, commit }), null);
    assert.ok(messageCommit(detail).endsWith(`Kickswarm-Cell: 0 ${detail.resultat!.id}\n`));
  } finally {
    http.closeAllConnections();
    await new Promise<void>((ok) => http.close(() => ok()));
    r.fermer();
  }
});
