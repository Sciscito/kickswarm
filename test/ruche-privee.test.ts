import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { cheminSur, lireFichiers, lirePlan, ruchePrivee, type Niveau } from '../src/prive/ruche.js';

const git = (cwd: string, ...a: string[]) => spawnSync('git', a, { cwd, encoding: 'utf8' }).stdout.trim();

function repo(): string {
  const d = mkdtempSync(join(tmpdir(), 'ks-prive-'));
  git(d, 'init', '-q', '-b', 'main');
  writeFileSync(join(d, 'README.md'), '# Tiny\n');
  writeFileSync(join(d, 'check.mjs'), "import { add } from './add.mjs';\nif (add(2, 3) !== 5 || add(-1, 1) !== 0) { console.error('add is wrong'); process.exit(1); }\nconsole.log('ok');\n");
  writeFileSync(join(d, 'add.mjs'), 'export function add(a, b) { return 0; }\n');
  git(d, 'add', '.');
  git(d, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'init');
  return d;
}

test('paths are kept inside the repository', () => {
  assert.equal(cheminSur('src/a.js'), 'src/a.js');
  for (const bad of ['../x', '/etc/passwd', 'C:/x', '.git/config', 'a/../../b', '.kickswarm/x', '']) assert.equal(cheminSur(bad), null, bad);
  assert.deepEqual(Object.keys(lireFichiers('```js src/a.js\nx\n```\n```js other.js\ny\n```', ['src/'])), ['src/a.js'], 'files outside the scope are ignored');
  assert.throws(() => lirePlan('{"tasks":[{"title":"t","write":["../../evil"],"instructions":"x"}]}'), /no usable task/);
});

test('a private hive plans, has free models work on a branch, checks with the project test, commits what passes', async () => {
  const d = repo();
  const calls: Niveau[] = [];
  const completer = async (prompt: string, niveau: Niveau, essai: number) => {
    calls.push(niveau);
    if (niveau === 'plan') return { agent: 'planner', texte: '{"tasks":[{"title":"Make add correct","read":["check.mjs"],"write":["add.mjs"],"instructions":"Return a + b."}]}' };
    assert.match(prompt, /YOU MAY WRITE ONLY: add\.mjs/);
    if (essai === 0) return { agent: 'free-model:free', texte: '```js add.mjs\nexport function add(a, b) { return a - b; }\n```' };
    assert.match(prompt, /add is wrong/, 'the failing check output goes back to the model');
    return { agent: 'strong-model', texte: '```js add.mjs\nexport function add(a, b) { return a + b; }\n```' };
  };
  const r = await ruchePrivee({ dossier: d, objectif: 'Fix add', completer, test: 'node check.mjs', essais: 2 });
  assert.deepEqual(calls, ['plan', 'travail', 'renfort'], 'free model first, the strong one only for the last attempt');
  assert.equal(r.faites.length, 1);
  assert.equal(r.faites[0]!.agent, 'strong-model');
  assert.equal(r.ratees.length, 0);
  assert.match(readFileSync(join(r.worktree, 'add.mjs'), 'utf8'), /a \+ b/);
  assert.match(readFileSync(join(d, 'add.mjs'), 'utf8'), /return 0/, "the person's checkout is untouched");
  assert.match(git(d, 'log', '--oneline', r.branche), /Make add correct/);
  assert.ok(existsSync(join(d, '.kickswarm')));
  assert.match(readFileSync(join(d, '.git', 'info', 'exclude'), 'utf8'), /\.kickswarm\//);
});
