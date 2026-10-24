import { commitment, hashOf, sha256 } from '../protocol/canonical.js';
import type { CritereFini, CritereTests, CritereTestsDeTests, Generateur, Livrable, Propriete, TestCase } from '../protocol/types.js';
import { LOCKDOWN } from './lockdown.js';
import { LUAU_LABEL, preparerLuau, type SortieLuau } from './luau-prep.js';
import { mutants } from './mutation.js';

// The core of the V0 verifiers (spec §9.1, OSP v0.2 §3, v0.3 §3.6): validation, the runners, the
// suites, the reports, test strength. The same code runs in the coordinator, in the guards' plugin
// and in browsers (OSP v0.4 §2.3): only the executors that run a suite differ (v0.ts for Node's
// thread, process and container sandboxes, web/executeurs.ts for a browser). Isomorphic: no Node API.

/** What a JavaScript runner printed, and in which sandbox. */
export interface SortieJs {
  stdout: string;
  stderr: string;
  timedOut: boolean;
  label: string;
}

/** How a host runs a suite. */
export interface Executeurs {
  /** Runs the JavaScript runner over the deliverable. The input carries the tests and the run's token. */
  js(livrable: Livrable, input: string, timeoutMs: number): Promise<SortieJs>;
  /** Runs a prepared Luau suite (luau-prep.ts), with its gate when `portes` lists files. */
  luau(o: { fichiers: Record<string, string>; spec: unknown; timeoutMs: number; graine: number; portes: string[] }): Promise<SortieLuau>;
  /** Throws if the requested sandbox cannot run here (checked before anything is prepared). */
  verifierMode?(): void;
}

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

// Paths inside a deliverable (OSP v0.3 §3.2, repo deliverables): up to 8 folders, plain characters,
// no segment starting with a dot (so no "..", no hidden file), never absolute.
const SEGMENT = '[A-Za-z0-9_-][A-Za-z0-9_.-]{0,63}';
const DOSSIERS = `(?:${SEGMENT}/){0,8}`;
const FILE_RE = new RegExp(`^${DOSSIERS}[A-Za-z0-9-][A-Za-z0-9_.-]{0,63}\\.(mjs|js|json|luau|lua|ts|tsx|md|txt|css|html|yml|yaml|toml|csv|svg)$`);
/** The module the tests import: JavaScript only. */
const MODULE_RE = new RegExp(`^${DOSSIERS}[A-Za-z0-9-][A-Za-z0-9_.-]{0,63}\\.(mjs|js)$`);
/** A file a deliverable deletes: any name, same path rules. */
const CHEMIN_RE = new RegExp(`^${DOSSIERS}${SEGMENT}$`);
/** The module a Luau suite requires. */
const LUAU_MODULE_RE = new RegExp(`^${DOSSIERS}[A-Za-z0-9-][A-Za-z0-9_.-]{0,63}\\.(luau|lua)$`);
const PORTES = new Set(['luau-checks@1']);

/** Criteria checked by tests (visible, hidden, properties), whatever the language. */
export function estCritereTests(c: CritereFini): c is CritereTests {
  return c.verificateur === 'tests-js@1' || c.verificateur === 'tests-luau@1';
}
const MAX_SUPPRIMES = 64;
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
export const MAX_OUTPUT = 1024 * 1024;

/**
 * The part both runners share: comparing, generating inputs, running every check. It captures the
 * primitives it needs before any delivered code runs, and LOCKDOWN then freezes the built-ins.
 */
export const CORE = `const S = JSON.stringify, P = JSON.parse, K = Object.keys, AI = Array.isArray, F = Function, RA = Reflect.apply;
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

/**
 * The QuickJS runner (WebAssembly sandbox): no network, no disk, no process, no Node API at all.
 * The host hands over the tests and an output function through two globals, removed before any
 * delivered code runs.
 */
export const WASM_RUNNER = `const E = globalThis.__osp_emit, INPUT = globalThis.__osp_spec;
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
    if (!MODULE_RE.test(critere.module) || !(critere.module in critere.cible.fichiers)) throw new Error('The target module must be one of the target files');
    if (!Array.isArray(critere.fonctions) || !critere.fonctions.length || !critere.fonctions.every((f) => FN_RE.test(f))) throw new Error('List the target functions the tests must cover');
    if (critere.score_min !== undefined && !(critere.score_min > 0 && critere.score_min <= 1)) throw new Error('score_min must be in (0, 1]');
    return;
  }
  if (critere.verificateur === 'tests-luau@1') {
    if (typeof critere.module !== 'string' || !LUAU_MODULE_RE.test(critere.module)) throw new Error('A Luau criterion names the module to test, e.g. src/shared/Shop.luau');
    if (critere.portes !== undefined && (!Array.isArray(critere.portes) || !critere.portes.every((p) => PORTES.has(p)))) throw new Error('Unknown gate: the gates are luau-checks@1');
  } else if (critere.verificateur !== 'tests-js@1') throw new Error(`Unknown verifier: ${String((critere as { verificateur?: unknown }).verificateur)}`);
  else if (critere.module !== undefined && !MODULE_RE.test(critere.module)) throw new Error(`Invalid module name: ${critere.module}`);
  validateTests(critere.tests);
  validateProprietes(critere.proprietes);
  if (!critere.tests.length && !critere.proprietes?.length) throw new Error('A V0 criterion needs at least one test or one property');
  for (const h of [critere.tests_caches_hash, critere.reference_hash]) if (h !== undefined && !HASH_RE.test(h)) throw new Error('Invalid commitment hash');
}

const encodeur = new TextEncoder();
/** Size in UTF-8 bytes (the standard TextEncoder: browsers have no Buffer). */
const octets = (texte: string) => encodeur.encode(texte).length;

export function validateLivrable(livrable: Livrable): void {
  if (!livrable || typeof livrable.fichiers !== 'object' || livrable.fichiers === null) throw new Error('Deliverable has no files');
  const names = Object.keys(livrable.fichiers);
  if (names.length === 0 && !livrable.supprimes?.length) throw new Error('Empty deliverable');
  if (names.length > MAX_FILES) throw new Error(`Too many files (maximum ${MAX_FILES})`);
  let total = 0;
  for (const name of names) {
    if (!FILE_RE.test(name) || name.split('/').some((s) => s.startsWith('__osp'))) throw new Error(`File name refused: ${name}`);
    const content = livrable.fichiers[name];
    if (typeof content !== 'string') throw new Error(`Non-text content: ${name}`);
    total += octets(content);
  }
  if (total > MAX_BYTES) throw new Error(`Deliverable too large (maximum ${MAX_BYTES} bytes)`);
  if (livrable.contexte !== undefined) {
    if (typeof livrable.contexte !== 'object' || livrable.contexte === null || Array.isArray(livrable.contexte)) throw new Error('contexte maps a path to its content');
    for (const [p, c] of Object.entries(livrable.contexte)) {
      if (!FILE_RE.test(p) || p.split('/').some((x) => x.startsWith('__osp')) || typeof c !== 'string') throw new Error(`Context file refused: ${p}`);
      if (p in livrable.fichiers || livrable.supprimes?.includes(p)) throw new Error(`A file read cannot also be written or deleted: ${p}`);
      total += octets(c);
    }
    if (total > MAX_BYTES) throw new Error(`Deliverable too large (maximum ${MAX_BYTES} bytes)`);
  }
  if (livrable.supprimes !== undefined) {
    if (!Array.isArray(livrable.supprimes) || livrable.supprimes.length > MAX_SUPPRIMES) throw new Error(`Up to ${MAX_SUPPRIMES} deleted files`);
    for (const p of livrable.supprimes) {
      if (typeof p !== 'string' || !CHEMIN_RE.test(p)) throw new Error(`Deleted path refused: ${String(p)}`);
      if (p in livrable.fichiers) throw new Error(`A file cannot be both written and deleted: ${p}`);
    }
  }
}

// ---------------------------------------------------------------- running a suite

interface Suite {
  module: string;
  tests: TestCase[];
  caches: TestCase[];
  proprietes: Propriete[];
  timeout: number;
  /** OSP v0.3 §3.6: a Luau suite, and the files its luau-checks@1 gate checks (none: no gate). */
  luau?: { portes: string[] };
}

/** Seed of a property: derived from the deliverable's hash, so impossible to target in advance. */
function seedFor(livrableHash: string, nom: string): number {
  return parseInt(sha256(`${livrableHash}:${nom}`).slice(7, 15), 16);
}

async function runSuite(suite: Suite, livrable: Livrable, ex: Executeurs): Promise<VerifReport> {
  const started = Date.now();
  const fail = (motif: string, tests: TestReport[] = [], sandbox = 'none'): VerifReport => ({ ok: false, motif, tests, duree_ms: Date.now() - started, sandbox });
  if (!(suite.module in livrable.fichiers)) return fail(`The deliverable does not contain the expected module “${suite.module}”`);
  if (suite.luau) return runSuiteLuau(suite, suite.luau.portes, livrable, started, ex);
  try {
    ex.verifierMode?.();
  } catch (e) {
    return fail((e as Error).message);
  }
  const lh = hashOf(livrable);
  const token = Array.from(globalThis.crypto.getRandomValues(new Uint8Array(16)), (o) => o.toString(16).padStart(2, '0')).join('');
  const input = JSON.stringify({
    token,
    module: suite.module,
    tests: suite.tests,
    caches: suite.caches,
    proprietes: suite.proprietes.map((p) => ({ ...p, cas: p.cas ?? DEFAULT_CASES, seed: seedFor(lh, p.nom) })),
  });
  let out: SortieJs;
  try {
    out = await ex.js(livrable, input, suite.timeout);
  } catch (e) {
    return fail((e as Error).message);
  }
  if (out.timedOut) return fail(`Time limit exceeded (${suite.timeout} ms)`, [], out.label);
  const marker = `__OSP__${token}`;
  const line = out.stdout.split('\n').reverse().find((l) => l.startsWith(marker));
  if (!line) {
    const err = out.stderr.trim().split('\n').slice(-3).join(' ').slice(0, 300);
    return fail(`The module crashed before the tests finished${err ? `: ${err}` : ''}`, [], out.label);
  }
  const parsed = JSON.parse(line.slice(marker.length)) as { chargement?: string; tests?: TestReport[] };
  if (parsed.chargement) return fail(`Module could not be loaded: ${parsed.chargement}`, [], out.label);
  return bilan(suite, parsed.tests ?? [], out.label, started);
}

/** `tests-luau@1`: the gate first, if any, then the tests, in the Luau sandbox. */
async function runSuiteLuau(suite: Suite, portes: string[], livrable: Livrable, started: number, ex: Executeurs): Promise<VerifReport> {
  const fail = (motif: string): VerifReport => ({ ok: false, motif, tests: [], duree_ms: Date.now() - started, sandbox: LUAU_LABEL });
  const lh = hashOf(livrable);
  const proprietes = suite.proprietes.map((p) => ({ ...p, cas: p.cas ?? DEFAULT_CASES, seed: seedFor(lh, p.nom) }));
  const out = await ex.luau({
    fichiers: livrable.fichiers,
    spec: preparerLuau(suite.module, suite.tests, suite.caches, proprietes),
    timeoutMs: suite.timeout,
    graine: seedFor(lh, 'math.random'),
    portes,
  });
  if (out.timedOut) return fail(`Time limit exceeded (${suite.timeout} ms)`);
  if (out.portes) return fail(`luau-checks@1: ${out.portes.length} problem${out.portes.length > 1 ? 's' : ''} (strict types and lint). First: ${out.portes[0]}`);
  if (out.erreur) return fail(`The module crashed before the tests finished: ${out.erreur}`);
  if (out.chargement) return fail(`Module could not be loaded: ${out.chargement}`);
  const nv = suite.tests.length;
  const nc = suite.caches.length;
  const lire = (s?: string): unknown => {
    if (s === undefined) return undefined;
    try {
      return JSON.parse(s) as unknown;
    } catch {
      return s;
    }
  };
  const tests: TestReport[] = (out.resultats ?? []).map((x, i) => {
    if (i < nv) {
      const t = suite.tests[i]!;
      const nom = t.nom || `${t.fn}(${JSON.stringify(t.args).slice(1, -1)})`;
      return x.erreur !== undefined ? { nom, ok: false, attendu: t.attendu, erreur: x.erreur } : { nom, ok: x.ok, attendu: t.attendu, obtenu: lire(x.obtenu) };
    }
    if (i < nv + nc) return { nom: `hidden test #${i - nv + 1}`, ok: x.ok, cache: true };
    const nom = `property “${suite.proprietes[i - nv - nc]?.nom ?? '?'}”`;
    return x.ok ? { nom, ok: true, propriete: true, cas: x.cas } : { nom, ok: false, propriete: true, erreur: x.erreur };
  });
  return bilan(suite, tests, LUAU_LABEL, started);
}

/** The report of a suite, the same for every language. */
function bilan(suite: Suite, tests: TestReport[], label: string, started: number): VerifReport {
  const fail = (motif: string, t: TestReport[] = [], sandbox = 'none'): VerifReport => ({ ok: false, motif, tests: t, duree_ms: Date.now() - started, sandbox });
  const out = { label };
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

function suiteOf(critere: CritereTests, caches: TestCase[], timeout?: number, portes: string[] = []): Suite {
  return {
    module: critere.module ?? 'solution.mjs',
    tests: critere.tests,
    caches,
    proprietes: critere.proprietes ?? [],
    timeout: timeout ?? critere.timeout_ms ?? DEFAULT_TIMEOUT_MS,
    ...(critere.verificateur === 'tests-luau@1' ? { luau: { portes } } : {}),
  };
}

/** OSP v0.3 §3.2: the repository files a repo deliverable reads are present when its tests run, unchanged. */
function aLancer(livrable: Livrable): Livrable {
  return livrable.contexte ? { fichiers: { ...livrable.contexte, ...livrable.fichiers } } : livrable;
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
async function mutationScore(suite: Suite, implementation: Livrable, fichiers: string[] | undefined, ex: Executeurs, version?: number): Promise<MutationReport> {
  const ms = mutants(implementation, { max: MAX_MUTANTS, fichiers, version });
  if (!ms.length) return { tues: 0, total: 0, score: 1 };
  // The gate is not part of the measure: a mutant only counts as caught when a test catches it.
  const short: Suite = { ...suite, timeout: Math.min(suite.timeout, MUTANT_TIMEOUT_MS), ...(suite.luau ? { luau: { portes: [] } } : {}) };
  const results = await pool(ms, POOL, (m) => runSuite(short, aLancer(m.livrable), ex));
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

function checkCaches(critere: CritereTests, caches: TestCase[] | undefined): string | null {
  if (!critere.tests_caches_hash) return caches?.length ? 'Hidden tests were given for a cell that has none' : null;
  if (!caches) return 'The hidden tests of this cell are not available on this coordinator';
  try {
    validateTests(caches, 'hidden tests');
  } catch (e) {
    return (e as Error).message;
  }
  return commitment(caches) === critere.tests_caches_hash ? null : 'The hidden tests do not match their commitment';
}

/** Verifies a deliverable against a V0 criterion, running it with the given executors. */
export async function verifier(critere: CritereFini, livrable: Livrable, opts: VerifOptions, ex: Executeurs): Promise<VerifReport> {
  const started = Date.now();
  const fail = (motif: string): VerifReport => ({ ok: false, motif, tests: [], duree_ms: Date.now() - started, sandbox: 'none' });
  try {
    validateCritere(critere);
    validateLivrable(livrable);
  } catch (e) {
    return fail((e as Error).message);
  }
  if (critere.verificateur === 'tests-de-tests@1') return verifierTestsDeTests(critere, livrable, ex);
  const bad = opts.sansCaches ? null : checkCaches(critere, opts.caches);
  if (bad) return fail(bad);
  // luau-checks@1 checks the deliverable's own Luau files, not the repository files it only reads.
  const portes = critere.verificateur === 'tests-luau@1' && critere.portes?.includes('luau-checks@1') ? Object.keys(livrable.fichiers).filter((f) => /\.(luau|lua)$/.test(f)) : [];
  return runSuite(suiteOf(critere, opts.sansCaches ? [] : (opts.caches ?? []), undefined, portes), aLancer(livrable), ex);
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
  critere: CritereTests,
  caches: TestCase[],
  reference: Livrable,
  opts: VerifOptions & { scoreMin?: number; moteurMutation?: number; exigerMesure?: boolean },
  ex: Executeurs,
): Promise<VerifReport> {
  const started = Date.now();
  const scoreMin = opts.scoreMin ?? DEFAULT_SCORE_MIN;
  const base = await verifier(critere, reference, { ...opts, caches }, ex);
  if (!base.ok) return { ...base, ok: false, motif: `The reference implementation fails its own tests: ${base.motif}` };
  const mutation = await mutationScore(suiteOf(critere, caches), reference, undefined, ex, opts.moteurMutation);
  const ok = mutation.total > 0 ? mutation.score >= scoreMin : !opts.exigerMesure;
  const motif = mutation.total === 0
    ? ok
      ? 'The reference has nothing to mutate: accepted without measuring the strength of the tests'
      : 'The reference has nothing to mutate: the strength of the tests cannot be measured'
    : `Mutation score ${(mutation.score * 100).toFixed(0)}% (${mutation.tues}/${mutation.total} mutants caught, minimum ${(scoreMin * 100).toFixed(0)}%)${ok ? '' : `. Tests too weak: ${mutation.survivant}`}`;
  return { ok, motif, tests: base.tests, duree_ms: Date.now() - started, sandbox: base.sandbox, mutation };
}

/** `tests-de-tests@1`: the `tests.json` deliverable must pass on the real target and kill its mutants. */
async function verifierTestsDeTests(critere: CritereTestsDeTests, livrable: Livrable, ex: Executeurs): Promise<VerifReport> {
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
  const base = await runSuite(s, critere.cible, ex);
  if (!base.ok) return { ...base, motif: `Your tests fail on the real implementation: ${base.motif}` };
  const mutation = await mutationScore(s, critere.cible, [critere.module], ex);
  const scoreMin = critere.score_min ?? DEFAULT_SCORE_MIN;
  const ok = mutation.total > 0 && mutation.score >= scoreMin;
  const motif = `Mutation score ${(mutation.score * 100).toFixed(0)}% (${mutation.tues}/${mutation.total} mutants caught, minimum ${(scoreMin * 100).toFixed(0)}%)${ok ? '' : `. Add tests: ${mutation.survivant ?? 'the target has nothing to mutate'}`}`;
  return { ok, motif, tests: base.tests, duree_ms: Date.now() - started, sandbox: base.sandbox, mutation };
}
