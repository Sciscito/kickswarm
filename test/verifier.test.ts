import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { CritereV0 } from '../src/protocol/types.js';
import { verifierV0 } from '../src/verifier/v0.js';

const critere: CritereV0 = {
  classe: 'V0',
  verificateur: 'tests-js@1',
  module: 'pgcd.mjs',
  tests: [
    { fn: 'pgcd', args: [12, 18], attendu: 6 },
    { fn: 'pgcd', args: [17, 5], attendu: 1 },
  ],
};
const bon = 'export function pgcd(a, b) { return b === 0 ? a : pgcd(b, a % b); }';

test('V0: a correct solution passes all the tests', async () => {
  const r = await verifierV0(critere, { fichiers: { 'pgcd.mjs': bon } });
  assert.equal(r.ok, true, r.motif);
  assert.equal(r.tests.length, 2);
});

test('V0: a wrong value is rejected with the details', async () => {
  const r = await verifierV0(critere, { fichiers: { 'pgcd.mjs': 'export const pgcd = (a, b) => a * b;' } });
  assert.equal(r.ok, false);
  assert.match(r.motif, /2\/2 checks failed/);
});

test('V0: an exception or a missing export is rejected', async () => {
  const lance = await verifierV0(critere, { fichiers: { 'pgcd.mjs': 'export function pgcd() { throw new Error("boum"); }' } });
  assert.equal(lance.ok, false);
  assert.match(lance.motif, /boum/);
  const absent = await verifierV0(critere, { fichiers: { 'pgcd.mjs': 'export const autre = 1;' } });
  assert.equal(absent.ok, false);
  assert.match(absent.motif, /missing export/);
});

test('V0: an infinite loop is cut off by the time limit', async () => {
  const r = await verifierV0({ ...critere, timeout_ms: 800 }, { fichiers: { 'pgcd.mjs': 'export function pgcd() { for (;;) {} }' } });
  assert.equal(r.ok, false);
  assert.match(r.motif, /Time limit exceeded/);
});

test('V0: dangerous file names are refused', async () => {
  const r = await verifierV0(critere, { fichiers: { '../pgcd.mjs': bon } });
  assert.equal(r.ok, false);
  assert.match(r.motif, /refused/);
});

test('V0: the sandbox prevents reading outside the working folder', async (t) => {
  const code = `import { readFileSync } from 'node:fs';
export function pgcd() { readFileSync(${JSON.stringify(process.execPath)}); return 6; }`;
  // By default without Docker: WebAssembly, where the node:fs module does not even exist.
  const r = await verifierV0({ ...critere, tests: [critere.tests[0]!] }, { fichiers: { 'pgcd.mjs': code } });
  assert.match(r.sandbox, /WebAssembly/);
  assert.equal(r.ok, false);
  assert.match(r.motif, /no network, no disk/);
  // Process mode, on explicit request, relies on Node's permission model.
  const p = await verifierV0({ ...critere, tests: [critere.tests[0]!] }, { fichiers: { 'pgcd.mjs': code } }, { sandbox: 'process' });
  if (!p.sandbox.includes('permissions')) return t.skip('permission model unavailable');
  assert.equal(p.ok, false, 'reading outside the sandbox should have failed');
});

test('V0: a module split across several files is accepted', async () => {
  const r = await verifierV0(
    { ...critere, module: 'solution.mjs' },
    { fichiers: { 'solution.mjs': "export { pgcd } from './pgcd.mjs';", 'pgcd.mjs': bon } },
  );
  assert.equal(r.ok, true, r.motif);
});

test('container sandbox: network cut off, read-only, no privileges, bounded resources', async (t) => {
  const { containerArgs, containerRuntime } = await import('../src/verifier/v0.js');
  const args = containerArgs('/tmp/osp-x', 'osp-v0-test', 5000);
  const has = (...seq: string[]) => args.join(' ').includes(seq.join(' '));
  assert.ok(has('--network', 'none'));
  assert.ok(has('--read-only'));
  assert.ok(has('--cap-drop', 'ALL'));
  assert.ok(has('--security-opt', 'no-new-privileges'));
  assert.ok(has('--memory', '256m') && has('--pids-limit', '64') && has('--cpus', '1'));
  assert.ok(has('type=bind,source=/tmp/osp-x,target=/work,readonly'));
  assert.ok(has('timeout', '-s', 'KILL', '5'));
  assert.ok(has('node', '--permission', '--allow-fs-read=/work'));

  if (!containerRuntime()) return t.skip('neither Docker nor Podman on this machine');
  const r = await verifierV0(critere, { fichiers: { 'pgcd.mjs': bon } }, { sandbox: 'container' });
  assert.equal(r.ok, true, r.motif);
  assert.match(r.sandbox, /container/);
});

test('container sandbox required without Docker or Podman: clear refusal', async (t) => {
  const { containerRuntime } = await import('../src/verifier/v0.js');
  if (containerRuntime()) return t.skip('a container engine is present');
  const r = await verifierV0(critere, { fichiers: { 'pgcd.mjs': bon } }, { sandbox: 'container' });
  assert.equal(r.ok, false);
  assert.match(r.motif, /neither Docker nor Podman/);
});
