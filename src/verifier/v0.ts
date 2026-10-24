import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { commitment, hashOf, sha256 } from '../protocol/canonical.js';
import type { CritereFini, CritereTestsDeTests, CritereV0, Generateur, Livrable, Propriete, TestCase } from '../protocol/types.js';
import { LOCKDOWN } from './lockdown.js';
import { mutants } from './mutation.js';

// V0 verifiers (spec §9.1, OSP v0.2 §3):
//  - `tests-js@1`: imports the delivered module in an isolated runtime and checks it against
//    visible tests, hidden tests (never shown to the worker, never detailed in reports) and
//    property tests (hundreds of random inputs, seeded by the deliverable's own hash);
//  - `tests-de-tests@1`: the deliverable is a test suite; it must pass on the real target and
//    kill enough mutants of it (mutation score).
// The same mutation engine measures how strong a cell's tests are against a reference (adequacy).
//
// Sandboxes (§8):
//  - wasm (the default, everywhere): QuickJS compiled to WebAssembly, in a throwaway thread.
//    The code under test gets the language and the deliverable's own files, and nothing else:
//    no network, no disk, no process, no Node API. Memory, stack and time are bounded. One pinned
//    engine for the coordinator, the guards and the auditors: the same verdict on every machine;
//  - container (on request): Docker or Podman running V8, network off, read-only filesystem, no
//    capabilities, CPU/memory/process limits, non-root user, plus Node's permission model inside;
//  - process (on request): a separate Node process with the permission model (read limited to the
//    work folder). The network is NOT cut in this mode.
// Choose with KICKSWARM_SANDBOX=auto|wasm|container|process (auto = wasm).
//
// The code under test can never learn the tests or forge the result: the tests reach the runner
// before the module is imported, through a channel it cannot reach; the result line carries a
// per-run secret token; the runner captures every primitive it needs, then freezes the built-ins
// (LOCKDOWN) so the delivered code cannot rewrite what the runner or a property relies on.

export interface TestReport {
  nom: string;
  ok: boolean;
  attendu?: unknown;
  obtenu?: unknown;
  erreur?: string;
  cache?: boolean;
  propriete?: boolean;
  cas?: number;
}

export interface MutationReport {
  tues: number;
  total: number;
  score: number;
  /** A surviving mutant, to help strengthen the tests. */
  survivant?: string;
}

export interface VerifReport {
  ok: boolean;
  motif: string;
  tests: TestReport[];
  duree_ms: number;
  sandbox: string;
  mutation?: MutationReport;
}

export interface VerifOptions {
  sandbox?: string;
  /** The cell's hidden tests, taken out of the coordinator's vault. */
  caches?: TestCase[];
  /** For a worker or a guard, who never see the hidden tests: everything else only. */
  sansCaches?: boolean;
}

const FILE_RE = /^[A-Za-z0-9-][A-Za-z0-9_.-]{0,63}\.(mjs|js|json)$/;
const FN_RE = /^[A-Za-z_$][A-Za-z0-9_$]{0,63}$/;
const HASH_RE = /^sha256:[0-9a-f]{64}$/;
const MAX_FILES = 32;
const MAX_BYTES = 256 * 1024;
const MAX_TESTS = 200;
const MAX_PROPS = 50;
const MAX_CASES = 2000;
const DEFAULT_CASES = 200;
const DEFAULT_TIMEOUT_MS = 5000;
const MAX_TIMEOUT_MS = 30000;
const MUTANT_TIMEOUT_MS = 2000;
const MAX_MUTANTS = 40;
const POOL = 6;
const DEFAULT_SCORE_MIN = 0.8;
const MAX_OUTPUT = 1024 * 1024;
const RUNNER_FILE = '__osp_runner.mjs';
const IMAGE = process.env.KICKSWARM_SANDBOX_IMAGE ?? 'node:24-alpine';
/** Extra time for the container to start (and for the image to be pulled the first time). */
const CONTAINER_GRACE_MS = 60_000;

/**
 * The part both runners share: comparing, generating inputs, running every check. It captures the
 * primitives it needs before any delivered code runs, and LOCKDOWN then freezes the built-ins.
 */
const CORE = `const S = JSON.stringify, P = JSON.parse, K = Object.keys, AI = Array.isArray, F = Function, RA = Reflect.apply;
const NN = Number.isNaN, MI = Math.imul, MF = Math.floor, STR = String;
const SC = (v) => (v === undefined ? undefined : P(S(v)));
const msg = (e) => STR((e && e.message) || e);
const norm = (v) => (v === undefined ? null : P(S(v)));
function eq(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return NN(a) && NN(b);
  if (AI(a) !== AI(b)) return false;
  const ka = K(a), kb = K(b);
  if (ka.length !== kb.length) return false;
  for (let i = 0; i < ka.length; i++) if (!eq(a[ka[i]], b[ka[i]])) return false;
  return true;
}
async function runCase(m, t, nom, cache) {
  try {
    if (typeof m[t.fn] !== 'function') return cache ? { nom, ok: false, cache: true } : { nom, ok: false, attendu: t.attendu, erreur: 'missing export “' + t.fn + '”' };
    const obtenu = norm(await RA(m[t.fn], undefined, SC(t.args)));
    const ok = eq(obtenu, t.attendu);
    return cache ? { nom, ok, cache: true } : { nom, ok, attendu: t.attendu, obtenu };
  } catch (e) { return cache ? { nom, ok: false, cache: true } : { nom, ok: false, attendu: t.attendu, erreur: msg(e) }; }
}
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = MI(t ^ (t >>> 15), t | 1); t ^= t + MI(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function gen(g, r) {
  if (g.type === 'int') return g.min + MF(r() * (g.max - g.min + 1));
  if (g.type === 'float') return g.min + r() * (g.max - g.min);
  if (g.type === 'bool') return r() < 0.5;
  if (g.type === 'string') { const al = g.alphabet || 'abcdefghijklmnopqrstuvwxyz'; const n = MF(r() * (g.maxLen + 1)); let s = ''; for (let i = 0; i < n; i++) s += al[MF(r() * al.length)]; return s; }
  if (g.type === 'array') { const n = MF(r() * (g.maxLen + 1)); const a = []; for (let i = 0; i < n; i++) a.push(gen(g.of, r)); return a; }
  if (g.type === 'oneOf') return SC(g.values[MF(r() * g.values.length)]);
  throw new Error('unknown generator');
}
async function runAll(spec, m) {
  const out = [];
  for (const t of spec.tests) out.push(await runCase(m, t, t.nom || t.fn + '(' + S(t.args).slice(1, -1) + ')', false));
  for (let i = 0; i < spec.caches.length; i++) out.push(await runCase(m, spec.caches[i], 'hidden test #' + (i + 1), true));
  for (const p of spec.proprietes) {
    const nom = 'property “' + p.nom + '”';
    if (typeof m[p.fn] !== 'function') { out.push({ nom, ok: false, propriete: true, erreur: 'missing export “' + p.fn + '”' }); continue; }
    let check;
    try { check = F('args', 'out', 'eq', '"use strict"; return (' + p.verifie + ');'); }
    catch (e) { out.push({ nom, ok: false, propriete: true, erreur: 'invalid property expression: ' + msg(e) }); continue; }
    const r = rng(p.seed);
    let fail = null;
    for (let k = 0; k < p.cas && !fail; k++) {
      const args = p.args.map((g) => gen(g, r));
      try {
        const o = norm(await RA(m[p.fn], undefined, SC(args)));
        if (!check(SC(args), o, eq)) fail = 'counterexample: ' + p.fn + '(' + S(args).slice(1, -1) + ') returned ' + S(o);
      } catch (e) { fail = 'counterexample: ' + p.fn + '(' + S(args).slice(1, -1) + ') threw ' + msg(e); }
    }
    out.push(fail ? { nom, ok: false, propriete: true, erreur: fail } : { nom, ok: true, propriete: true, cas: p.cas });
  }
  return out;
}
`;

/** The Node runner (container and process sandboxes): tests arrive through stdin. */
const RUNNER = `const W = process.stdout.write.bind(process.stdout);
const EXIT = process.exit.bind(process);
const chunks = [];
for await (const c of process.stdin) chunks.push(c);
const spec = JSON.parse(Buffer.concat(chunks).toString('utf8'));
const TOKEN = spec.token;
delete spec.token;
const MODULE = new URL('./' + spec.module, import.meta.url).href;
${CORE}
${LOCKDOWN}
const emit = (o) => { W('\\n__OSP__' + TOKEN + S(o) + '\\n'); EXIT(0); };
let m;
try { m = await import(MODULE); }
catch (e) { emit({ chargement: msg(e) }); }
emit({ tests: await runAll(spec, m) });
`;

/**
 * The QuickJS runner (WebAssembly sandbox): no network, no disk, no process, no Node API at all.
 * The host hands over the tests and an output function through two globals, removed before any
 * delivered code runs.
 */
const WASM_RUNNER = `const E = globalThis.__osp_emit, INPUT = globalThis.__osp_spec;
delete globalThis.__osp_emit;
delete globalThis.__osp_spec;
const spec = JSON.parse(INPUT);
const TOKEN = spec.token;
delete spec.token;
${CORE}
{
  const noop = () => {};
  const c = {};
  for (const k of ['log', 'info', 'warn', 'error', 'debug', 'trace', 'table', 'dir', 'group', 'groupEnd', 'time', 'timeEnd', 'assert', 'count']) c[k] = noop;
  globalThis.console = Object.freeze(c);
}
${LOCKDOWN}
const emit = (o) => E('\\n__OSP__' + TOKEN + S(o) + '\\n');
let m = null;
try { m = await import(spec.module); }
catch (e) { emit({ chargement: msg(e) }); }
if (m) emit({ tests: await runAll(spec, m) });
`;

// ---------------------------------------------------------------- validation

function validateGenerator(g: Generateur, depth = 0): void {
  if (!g || typeof g !== 'object' || depth > 4) throw new Error('Invalid generator');
  switch (g.type) {
    case 'int':
    case 'float':
      if (!Number.isFinite(g.min) || !Number.isFinite(g.max) || g.min > g.max) throw new Error(`Invalid ${g.type} generator range`);
      return;
    case 'bool':
      return;
    case 'string':
      if (!(Number.isInteger(g.maxLen) && g.maxLen >= 0 && g.maxLen <= 1000)) throw new Error('A string generator needs maxLen between 0 and 1000');
      if (g.alphabet !== undefined && (typeof g.alphabet !== 'string' || !g.alphabet.length)) throw new Error('Invalid string alphabet');
      return;
    case 'array':
      if (!(Number.isInteger(g.maxLen) && g.maxLen >= 0 && g.maxLen <= 1000)) throw new Error('An array generator needs maxLen between 0 and 1000');
      validateGenerator(g.of, depth + 1);
      return;
    case 'oneOf':
      if (!Array.isArray(g.values) || !g.values.length || g.values.length > 100) throw new Error('oneOf needs 1 to 100 values');
      return;
    default:
      throw new Error(`Unknown generator type: ${String((g as { type?: unknown }).type)}`);
  }
}

export function validateTests(tests: TestCase[], label = 'tests'): void {
  if (!Array.isArray(tests)) throw new Error(`${label} must be an array`);
  if (tests.length > MAX_TESTS) throw new Error(`Too many ${label} (maximum ${MAX_TESTS})`);
  for (const t of tests) {
    if (!FN_RE.test(t?.fn)) throw new Error(`Invalid function name: ${String(t?.fn)}`);
    if (!Array.isArray(t.args)) throw new Error(`The arguments of test ${t.fn} must be an array`);
  }
}

export function validateProprietes(props: Propriete[] | undefined): void {
  if (props === undefined) return;
  if (!Array.isArray(props) || props.length > MAX_PROPS) throw new Error(`Up to ${MAX_PROPS} properties`);
  for (const p of props) {
    if (typeof p?.nom !== 'string' || !p.nom.trim() || p.nom.length > 100) throw new Error('Each property needs a name (100 characters maximum)');
    if (!FN_RE.test(p.fn)) throw new Error(`Invalid function name: ${String(p.fn)}`);
    if (!Array.isArray(p.args)) throw new Error(`Property ${p.nom}: args must be a list of generators`);
    p.args.forEach((g) => validateGenerator(g));
    if (typeof p.verifie !== 'string' || !p.verifie.trim() || p.verifie.length > 2000) throw new Error(`Property ${p.nom}: verifie must be a JavaScript expression (2000 characters maximum)`);
    if (p.cas !== undefined && !(Number.isInteger(p.cas) && p.cas >= 1 && p.cas <= MAX_CASES)) throw new Error(`Property ${p.nom}: cas must be between 1 and ${MAX_CASES}`);
  }
}

/** Throws if the criterion is not a V0 criterion this verifier can run. */
export function validateCritere(critere: CritereFini): void {
  if (!critere || critere.classe !== 'V0') throw new Error('The MVP only supports verification class V0');
  if (critere.timeout_ms !== undefined && !(critere.timeout_ms > 0 && critere.timeout_ms <= MAX_TIMEOUT_MS)) {
    throw new Error(`timeout_ms must be between 1 and ${MAX_TIMEOUT_MS}`);
  }
  if (critere.verificateur === 'tests-de-tests@1') {
    validateLivrable(critere.cible);
    if (!FILE_RE.test(critere.module) || !(critere.module in critere.cible.fichiers)) throw new Error('The target module must be one of the target files');
    if (!Array.isArray(critere.fonctions) || !critere.fonctions.length || !critere.fonctions.every((f) => FN_RE.test(f))) throw new Error('List the target functions the tests must cover');
    if (critere.score_min !== undefined && !(critere.score_min > 0 && critere.score_min <= 1)) throw new Error('score_min must be in (0, 1]');
    return;
  }
  if (critere.verificateur !== 'tests-js@1') throw new Error(`Unknown verifier: ${String((critere as { verificateur?: unknown }).verificateur)}`);
  if (critere.module !== undefined && !FILE_RE.test(critere.module)) throw new Error(`Invalid module name: ${critere.module}`);
  validateTests(critere.tests);
  validateProprietes(critere.proprietes);
  if (!critere.tests.length && !critere.proprietes?.length) throw new Error('A V0 criterion needs at least one test or one property');
  for (const h of [critere.tests_caches_hash, critere.reference_hash]) if (h !== undefined && !HASH_RE.test(h)) throw new Error('Invalid commitment hash');
}

export function validateLivrable(livrable: Livrable): void {
  if (!livrable || typeof livrable.fichiers !== 'object' || livrable.fichiers === null) throw new Error('Deliverable has no files');
  const names = Object.keys(livrable.fichiers);
  if (names.length === 0) throw new Error('Empty deliverable');
  if (names.length > MAX_FILES) throw new Error(`Too many files (maximum ${MAX_FILES})`);
  let total = 0;
  for (const name of names) {
    if (!FILE_RE.test(name) || name.startsWith('__osp')) throw new Error(`File name refused: ${name}`);
    const content = livrable.fichiers[name];
    if (typeof content !== 'string') throw new Error(`Non-text content: ${name}`);
    total += Buffer.byteLength(content, 'utf8');
  }
  if (total > MAX_BYTES) throw new Error(`Deliverable too large (maximum ${MAX_BYTES} bytes)`);
}

// ---------------------------------------------------------------- sandboxes

export type SandboxMode = 'container' | 'wasm' | 'process';

let runtimeCache: string | null | undefined;

/** Docker or Podman, if one answers (checked once). */
export function containerRuntime(): string | null {
  if (runtimeCache !== undefined) return runtimeCache;
  runtimeCache = null;
  for (const rt of ['docker', 'podman']) {
    const r = spawnSync(rt, ['version', '--format', '{{.Server.Version}}'], { timeout: 8000, windowsHide: true, encoding: 'utf8' });
    if (r.status === 0 && r.stdout.trim()) {
      runtimeCache = rt;
      break;
    }
  }
  return runtimeCache;
}

/**
 * One engine for everyone by default: the coordinator, every guard and every auditor run the same
 * QuickJS build, so a deliverable gets the same verdict on every machine. The container (V8) and the
 * process sandbox are explicit choices.
 */
export function resolveSandbox(pref: string = process.env.KICKSWARM_SANDBOX ?? 'auto'): SandboxMode {
  if (pref === 'process') return 'process';
  if (pref !== 'container') return 'wasm';
  if (!containerRuntime()) throw new Error('Container sandbox requested, but neither Docker nor Podman is available');
  return 'container';
}

/** The worker that runs QuickJS (its .ts source under tsx, its compiled .js otherwise). */
const WASM_WORKER = new URL(`./wasm-worker${extname(fileURLToPath(import.meta.url))}`, import.meta.url);
const WASM_MEMORY_MB = 256;
const WASM_LABEL = 'WebAssembly (QuickJS: no network, no disk, bounded memory)';

function runWasm(fichiers: Record<string, string>, input: string, timeoutMs: number): Promise<RunOutput> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (o: Omit<RunOutput, 'label' | 'code'>) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      void worker.terminate();
      resolve({ ...o, code: 0, label: WASM_LABEL });
    };
    const worker = new Worker(WASM_WORKER, {
      workerData: { fichiers, input, runner: WASM_RUNNER, timeoutMs, memoireMo: WASM_MEMORY_MB, sortieMax: MAX_OUTPUT },
      // A safety net around the engine's own limits: the thread itself is bounded and killed if late.
      resourceLimits: { maxOldGenerationSizeMb: WASM_MEMORY_MB * 2 },
      // No env stripping here: the code under test runs inside QuickJS and never sees process.env.
    });
    const timer = setTimeout(() => finish({ stdout: '', stderr: '', timedOut: true }), timeoutMs + 3000);
    worker.once('message', (m: { stdout: string; stderr: string; timedOut: boolean }) => finish(m));
    worker.once('error', (e) => finish({ stdout: '', stderr: String(e), timedOut: false }));
    worker.once('exit', () => finish({ stdout: '', stderr: 'The sandbox stopped unexpectedly', timedOut: false }));
  });
}

/** Arguments of the locked-down container run (pure function, tested on its own). */
export function containerArgs(dir: string, name: string, timeoutMs: number, image = IMAGE): string[] {
  const seconds = Math.max(1, Math.ceil(timeoutMs / 1000));
  return [
    'run', '--rm', '-i', '--name', name,
    '--network', 'none',
    '--read-only',
    '--cap-drop', 'ALL',
    '--security-opt', 'no-new-privileges',
    '--user', '1000:1000',
    '--memory', '256m', '--memory-swap', '256m',
    '--cpus', '1',
    '--pids-limit', '64',
    '--tmpfs', '/tmp:rw,noexec,nosuid,size=16m',
    '--mount', `type=bind,source=${dir},target=/work,readonly`,
    '--workdir', '/work',
    image,
    'timeout', '-s', 'KILL', String(seconds),
    'node', '--permission', '--allow-fs-read=/work', `/work/${RUNNER_FILE}`,
  ];
}

function permissionFlags(dir: string): { flags: string[]; label: string } {
  const allowed = process.allowedNodeEnvironmentFlags;
  if (allowed.has('--permission')) return { flags: ['--permission', `--allow-fs-read=${dir}`], label: 'process + Node permissions (network not cut)' };
  if (allowed.has('--experimental-permission')) {
    return { flags: ['--experimental-permission', `--allow-fs-read=${dir}`], label: 'process + Node permissions, experimental (network not cut)' };
  }
  return { flags: [], label: 'isolated process, no permission model (network not cut)' };
}

interface RunOutput {
  stdout: string;
  stderr: string;
  timedOut: boolean;
  code: number | null;
  label: string;
}

function run(dir: string, input: string, timeoutMs: number, mode: SandboxMode): Promise<RunOutput> {
  if (mode === 'container') {
    const rt = containerRuntime()!;
    const name = `osp-v0-${randomBytes(6).toString('hex')}`;
    const kill = () => {
      spawn(rt, ['kill', name], { stdio: 'ignore', windowsHide: true }).on('error', () => {});
    };
    return collect(rt, containerArgs(dir, name, timeoutMs), dir, undefined, input, timeoutMs + CONTAINER_GRACE_MS, `container (${rt}, network off, read-only, 256 MB)`, kill);
  }
  const { flags, label } = permissionFlags(dir);
  const env: NodeJS.ProcessEnv = {};
  if (process.env.SystemRoot) env.SystemRoot = process.env.SystemRoot;
  return collect(process.execPath, [...flags, join(dir, RUNNER_FILE)], dir, env, input, timeoutMs, label);
}

function collect(cmd: string, args: string[], cwd: string, env: NodeJS.ProcessEnv | undefined, input: string, timeoutMs: number, label: string, onTimeout?: () => void): Promise<RunOutput> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      onTimeout?.();
      child.kill('SIGKILL');
    }, timeoutMs);
    child.stdout.on('data', (d: Buffer) => {
      if (stdout.length < MAX_OUTPUT) stdout += d.toString('utf8');
    });
    child.stderr.on('data', (d: Buffer) => {
      if (stderr.length < MAX_OUTPUT) stderr += d.toString('utf8');
    });
    child.stdin.on('error', () => {});
    child.stdin.end(input);
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ stdout, stderr: String(e), timedOut: false, code: null, label });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      // `timeout -s KILL` inside the container exits with 137.
      resolve({ stdout, stderr, timedOut: timedOut || code === 137, code, label });
    });
  });
}

// ---------------------------------------------------------------- running a suite

interface Suite {
  module: string;
  tests: TestCase[];
  caches: TestCase[];
  proprietes: Propriete[];
  timeout: number;
}

/** Seed of a property: derived from the deliverable's hash, so impossible to target in advance. */
function seedFor(livrableHash: string, nom: string): number {
  return parseInt(sha256(`${livrableHash}:${nom}`).slice(7, 15), 16);
}

async function runSuite(suite: Suite, livrable: Livrable, opts: VerifOptions): Promise<VerifReport> {
  const started = Date.now();
  const fail = (motif: string, tests: TestReport[] = [], sandbox = 'none'): VerifReport => ({ ok: false, motif, tests, duree_ms: Date.now() - started, sandbox });
  if (!(suite.module in livrable.fichiers)) return fail(`The deliverable does not contain the expected module “${suite.module}”`);
  let mode: SandboxMode;
  try {
    mode = resolveSandbox(opts.sandbox);
  } catch (e) {
    return fail((e as Error).message);
  }
  const lh = hashOf(livrable);
  const token = randomBytes(16).toString('hex');
  const input = JSON.stringify({
    token,
    module: suite.module,
    tests: suite.tests,
    caches: suite.caches,
    proprietes: suite.proprietes.map((p) => ({ ...p, cas: p.cas ?? DEFAULT_CASES, seed: seedFor(lh, p.nom) })),
  });
  const out = await execute(livrable, input, suite.timeout, mode);
  if (out.timedOut) return fail(`Time limit exceeded (${suite.timeout} ms)`, [], out.label);
  const marker = `__OSP__${token}`;
  const line = out.stdout.split('\n').reverse().find((l) => l.startsWith(marker));
  if (!line) {
    const err = out.stderr.trim().split('\n').slice(-3).join(' ').slice(0, 300);
    return fail(`The module crashed before the tests finished${err ? `: ${err}` : ''}`, [], out.label);
  }
  const parsed = JSON.parse(line.slice(marker.length)) as { chargement?: string; tests?: TestReport[] };
  if (parsed.chargement) return fail(`Module could not be loaded: ${parsed.chargement}`, [], out.label);
  const tests = parsed.tests ?? [];
  const expected = suite.tests.length + suite.caches.length + suite.proprietes.length;
  if (tests.length !== expected) return fail('The runner returned an incomplete report', tests, out.label);
  const failed = tests.filter((t) => !t.ok);
  const visibles = tests.filter((t) => !t.cache && !t.propriete).length;
  const props = tests.filter((t) => t.propriete).length;
  const parts = [`${visibles} tests`, suite.caches.length ? `${suite.caches.length} hidden tests` : '', props ? `${props} properties` : ''].filter(Boolean).join(', ');
  if (failed.length === 0) return { ok: true, motif: `All passed: ${parts}`, tests, duree_ms: Date.now() - started, sandbox: out.label };
  const visibleFail = failed.find((t) => !t.cache && !t.propriete);
  const propFail = failed.find((t) => t.propriete);
  const hiddenFails = failed.filter((t) => t.cache).length;
  const detail = visibleFail
    ? `${visibleFail.nom} → ${visibleFail.erreur ?? `got ${JSON.stringify(visibleFail.obtenu)}, expected ${JSON.stringify(visibleFail.attendu)}`}`
    : propFail
      ? `${propFail.nom}: ${propFail.erreur}`
      : `${hiddenFails} hidden test${hiddenFails > 1 ? 's' : ''} failed (details stay hidden)`;
  return fail(`${failed.length}/${tests.length} checks failed (${parts}). First failure: ${detail}`, tests, out.label);
}

/** Runs the runner in the chosen sandbox: in memory for WebAssembly, from a throwaway folder otherwise. */
async function execute(livrable: Livrable, input: string, timeoutMs: number, mode: SandboxMode): Promise<RunOutput> {
  if (mode === 'wasm') return runWasm(livrable.fichiers, input, timeoutMs);
  const dir = await mkdtemp(join(tmpdir(), 'osp-v0-'));
  try {
    for (const [name, content] of Object.entries(livrable.fichiers)) await writeFile(join(dir, name), content, 'utf8');
    await writeFile(join(dir, RUNNER_FILE), RUNNER, 'utf8');
    return await run(dir, input, timeoutMs, mode);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function suiteOf(critere: CritereV0, caches: TestCase[], timeout?: number): Suite {
  return {
    module: critere.module ?? 'solution.mjs',
    tests: critere.tests,
    caches,
    proprietes: critere.proprietes ?? [],
    timeout: timeout ?? critere.timeout_ms ?? DEFAULT_TIMEOUT_MS,
  };
}

async function pool<T, R>(items: T[], size: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]!);
      }
    }),
  );
  return out;
}

/** Mutation score of a suite against an implementation: the share of mutants it catches. */
async function mutationScore(suite: Suite, implementation: Livrable, fichiers: string[] | undefined, opts: VerifOptions, version?: number): Promise<MutationReport> {
  const ms = mutants(implementation, { max: MAX_MUTANTS, fichiers, version });
  if (!ms.length) return { tues: 0, total: 0, score: 1 };
  const short = { ...suite, timeout: Math.min(suite.timeout, MUTANT_TIMEOUT_MS) };
  const results = await pool(ms, POOL, (m) => runSuite(short, m.livrable, opts));
  const survivors = ms.filter((_, i) => results[i]!.ok);
  const tues = ms.length - survivors.length;
  const s = survivors[0];
  return {
    tues,
    total: ms.length,
    score: Math.round((tues / ms.length) * 1000) / 1000,
    ...(s ? { survivant: `${s.fichier}:${s.ligne} « ${s.avant} » → « ${s.apres} » goes unnoticed` } : {}),
  };
}

// ---------------------------------------------------------------- public API

function checkCaches(critere: CritereV0, caches: TestCase[] | undefined): string | null {
  if (!critere.tests_caches_hash) return caches?.length ? 'Hidden tests were given for a cell that has none' : null;
  if (!caches) return 'The hidden tests of this cell are not available on this coordinator';
  try {
    validateTests(caches, 'hidden tests');
  } catch (e) {
    return (e as Error).message;
  }
  return commitment(caches) === critere.tests_caches_hash ? null : 'The hidden tests do not match their commitment';
}

export async function verifierV0(critere: CritereFini, livrable: Livrable, opts: VerifOptions = {}): Promise<VerifReport> {
  const started = Date.now();
  const fail = (motif: string): VerifReport => ({ ok: false, motif, tests: [], duree_ms: Date.now() - started, sandbox: 'none' });
  try {
    validateCritere(critere);
    validateLivrable(livrable);
  } catch (e) {
    return fail((e as Error).message);
  }
  if (critere.verificateur === 'tests-de-tests@1') return verifierTestsDeTests(critere, livrable, opts);
  const bad = opts.sansCaches ? null : checkCaches(critere, opts.caches);
  if (bad) return fail(bad);
  return runSuite(suiteOf(critere, opts.sansCaches ? [] : (opts.caches ?? [])), livrable, opts);
}

/**
 * Strength of a cell's tests (§3.2): the reference must pass every test, and the tests
 * must catch at least `scoreMin` of its mutants. Otherwise, the tests are too weak to validate anything.
 *
 * A reference in which the engine finds nothing to mutate cannot be measured: it is accepted without
 * measuring, like a cell with no reference (which the scout could have supplied instead), unless
 * the measurement is required (`exigerMesure`, when references are mandatory).
 */
export async function adequation(
  critere: CritereV0,
  caches: TestCase[],
  reference: Livrable,
  opts: VerifOptions & { scoreMin?: number; moteurMutation?: number; exigerMesure?: boolean } = {},
): Promise<VerifReport> {
  const started = Date.now();
  const scoreMin = opts.scoreMin ?? DEFAULT_SCORE_MIN;
  const base = await verifierV0(critere, reference, { ...opts, caches });
  if (!base.ok) return { ...base, ok: false, motif: `The reference implementation fails its own tests: ${base.motif}` };
  const mutation = await mutationScore(suiteOf(critere, caches), reference, undefined, opts, opts.moteurMutation);
  const ok = mutation.total > 0 ? mutation.score >= scoreMin : !opts.exigerMesure;
  const motif = mutation.total === 0
    ? ok
      ? 'The reference has nothing to mutate: accepted without measuring the strength of the tests'
      : 'The reference has nothing to mutate: the strength of the tests cannot be measured'
    : `Mutation score ${(mutation.score * 100).toFixed(0)}% (${mutation.tues}/${mutation.total} mutants caught, minimum ${(scoreMin * 100).toFixed(0)}%)${ok ? '' : `. Tests too weak: ${mutation.survivant}`}`;
  return { ok, motif, tests: base.tests, duree_ms: Date.now() - started, sandbox: base.sandbox, mutation };
}

/** `tests-de-tests@1`: the `tests.json` deliverable must pass on the real target and kill its mutants. */
async function verifierTestsDeTests(critere: CritereTestsDeTests, livrable: Livrable, opts: VerifOptions): Promise<VerifReport> {
  const started = Date.now();
  const fail = (motif: string, extra: Partial<VerifReport> = {}): VerifReport => ({ ok: false, motif, tests: [], duree_ms: Date.now() - started, sandbox: 'none', ...extra });
  const raw = livrable.fichiers['tests.json'];
  if (raw === undefined) return fail('The deliverable must contain tests.json');
  let suite: { tests?: TestCase[]; proprietes?: Propriete[] };
  try {
    suite = JSON.parse(raw) as typeof suite;
    validateTests(suite.tests ?? []);
    validateProprietes(suite.proprietes);
  } catch (e) {
    return fail(`tests.json is invalid: ${(e as Error).message}`);
  }
  const tests = suite.tests ?? [];
  const proprietes = suite.proprietes ?? [];
  if (!tests.length && !proprietes.length) return fail('tests.json contains no test');
  const covered = new Set([...tests.map((t) => t.fn), ...proprietes.map((p) => p.fn)]);
  const missing = critere.fonctions.filter((f) => !covered.has(f));
  if (missing.length) return fail(`These functions have no test: ${missing.join(', ')}`);

  const s: Suite = { module: critere.module, tests, caches: [], proprietes, timeout: critere.timeout_ms ?? DEFAULT_TIMEOUT_MS };
  const base = await runSuite(s, critere.cible, opts);
  if (!base.ok) return { ...base, motif: `Your tests fail on the real implementation: ${base.motif}` };
  const mutation = await mutationScore(s, critere.cible, [critere.module], opts);
  const scoreMin = critere.score_min ?? DEFAULT_SCORE_MIN;
  const ok = mutation.total > 0 && mutation.score >= scoreMin;
  const motif = `Mutation score ${(mutation.score * 100).toFixed(0)}% (${mutation.tues}/${mutation.total} mutants caught, minimum ${(scoreMin * 100).toFixed(0)}%)${ok ? '' : `. Add tests: ${mutation.survivant ?? 'the target has nothing to mutate'}`}`;
  return { ok, motif, tests: base.tests, duree_ms: Date.now() - started, sandbox: base.sandbox, mutation };
}
