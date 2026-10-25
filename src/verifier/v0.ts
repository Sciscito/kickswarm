import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { availableParallelism, tmpdir } from 'node:os';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import type { CritereFini, CritereTests, Livrable, TestCase } from '../protocol/types.js';
import { adequation as mesurer, CORE, MAX_OUTPUT, verifier, WASM_RUNNER, type Executeurs, type SortieJs, type VerifOptions, type VerifReport } from './coeur.js';
import { LOCKDOWN } from './lockdown.js';
import { runLuau } from './luau.js';

export {
  estCritereTests,
  validateCritere,
  validateLivrable,
  validateProprietes,
  validateTests,
  type MutationReport,
  type TestReport,
  type VerifOptions,
  type VerifReport,
} from './coeur.js';

// V0 verifiers (spec §9.1, OSP v0.2 §3):
//  - `tests-js@1`: imports the delivered module in an isolated runtime and checks it against
//    visible tests, hidden tests (never shown to the worker, never detailed in reports) and
//    property tests (hundreds of random inputs, seeded by the deliverable's own hash);
//  - `tests-de-tests@1`: the deliverable is a test suite; it must pass on the real target and
//    kill enough mutants of it (mutation score);
//  - `tests-luau@1` (OSP v0.3 §3.6): the same tests for a pure Luau module, run in the Luau virtual
//    machine compiled to WebAssembly (luau.ts), with the `luau-checks@1` gate before them.
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
// This file holds Node's sandboxes; the verification itself (validation, runners, suites, reports,
// test strength) is in coeur.ts, the same code browsers run.
//
// The code under test can never learn the tests or forge the result: the tests reach the runner
// before the module is imported, through a channel it cannot reach; the result line carries a
// per-run secret token; the runner captures every primitive it needs, then freezes the built-ins
// (LOCKDOWN) so the delivered code cannot rewrite what the runner or a property relies on.

const RUNNER_FILE = '__osp_runner.mjs';
const IMAGE = process.env.KICKSWARM_SANDBOX_IMAGE ?? 'node:24-alpine';
/** Extra time for the container to start (and for the image to be pulled the first time). */
const CONTAINER_GRACE_MS = 60_000;

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

/**
 * The processor cores this server may use: KICKSWARM_THREADS when set (a small hosted container often
 * reports the host's cores, not its own share), else what Node sees.
 */
export function coeursDisponibles(): number {
  const n = Number(process.env.KICKSWARM_THREADS);
  return Math.max(1, Number.isInteger(n) && n > 0 ? n : availableParallelism());
}

// Warm sandboxes: one thread per processor core, each keeping its QuickJS module loaded. Every run still gets
// a fresh engine; a thread is retired after RUNS_PAR_FIL runs, or at once after a run that hit a limit.
const RUNS_PAR_FIL = 25;
const FILS_MAX = coeursDisponibles();

interface Fil {
  w: Worker;
  runs: number;
  occupe: boolean;
}

const fils: Fil[] = [];
const enAttenteDeFil: Array<(f: Fil) => void> = [];
// Background runs (preparing trap cells) wait behind everything else, and never hold more than half the
// threads: a bee's submission or a guard's check is never stuck behind them.
const enAttenteDeFond: Array<(f: Fil) => void> = [];
const FOND_MAX = Math.max(1, Math.floor(FILS_MAX / 2));
let fondEnCours = 0;
let prochainId = 0;

function nouveauFil(): Fil {
  // A safety net around the engine's own limits: the thread itself is bounded, and killed if late.
  // No env stripping here: the code under test runs inside QuickJS and never sees process.env.
  const w = new Worker(WASM_WORKER, { resourceLimits: { maxOldGenerationSizeMb: WASM_MEMORY_MB * 2 } });
  const f: Fil = { w, runs: 0, occupe: false };
  w.on('exit', () => {
    const i = fils.indexOf(f);
    if (i >= 0) fils.splice(i, 1);
  });
  w.on('error', () => undefined);
  fils.push(f);
  return f;
}

function prendreFil(fond = false): Promise<Fil> {
  const libre = fond && (fondEnCours >= FOND_MAX || enAttenteDeFil.length) ? undefined : (fils.find((f) => !f.occupe) ?? (fils.length < FILS_MAX ? nouveauFil() : undefined));
  if (libre) {
    libre.occupe = true;
    libre.w.ref();
    if (fond) fondEnCours++;
    return Promise.resolve(libre);
  }
  return new Promise((ok) => (fond ? enAttenteDeFond : enAttenteDeFil).push(ok));
}

function rendreFil(f: Fil, retirer: boolean, fond = false): void {
  if (fond) fondEnCours--;
  if (retirer) {
    const i = fils.indexOf(f);
    if (i >= 0) fils.splice(i, 1);
    void f.w.terminate();
  }
  // Urgent runs first; a background run only within its share of the threads.
  const urgent = enAttenteDeFil.shift();
  const suivant = urgent ?? (fondEnCours < FOND_MAX ? enAttenteDeFond.shift() : undefined);
  if (suivant) {
    const g = retirer ? nouveauFil() : f;
    g.occupe = true;
    g.w.ref();
    if (!urgent) fondEnCours++;
    suivant(g);
    return;
  }
  if (!retirer) {
    f.occupe = false;
    // An idle thread does not keep the process alive.
    f.w.unref();
  }
}

async function runWasm(fichiers: Record<string, string>, input: string, timeoutMs: number, fond = false): Promise<RunOutput> {
  const f = await prendreFil(fond);
  return new Promise((resolve) => {
    const id = ++prochainId;
    let fini = false;
    const finir = (o: Omit<RunOutput, 'label' | 'code'>, retirer: boolean) => {
      if (fini) return;
      fini = true;
      clearTimeout(minuteur);
      f.w.off('message', surMessage);
      f.w.off('error', surErreur);
      f.w.off('exit', surSortie);
      rendreFil(f, retirer, fond);
      resolve({ ...o, code: 0, label: WASM_LABEL });
    };
    const surMessage = (m: { id: number; stdout: string; stderr: string; timedOut: boolean }) => {
      if (m.id !== id) return;
      f.runs++;
      // A run that hit a limit may leave the engine's module in a bad state: that thread is retired.
      const abime = m.timedOut || /Aborted|RuntimeError|out of memory|InternalError/i.test(m.stderr);
      finir({ stdout: m.stdout, stderr: m.stderr, timedOut: m.timedOut }, abime || f.runs >= RUNS_PAR_FIL);
    };
    const surErreur = (e: unknown) => finir({ stdout: '', stderr: String(e), timedOut: false }, true);
    const surSortie = () => finir({ stdout: '', stderr: 'The sandbox stopped unexpectedly', timedOut: false }, true);
    f.w.on('message', surMessage);
    f.w.once('error', surErreur);
    f.w.once('exit', surSortie);
    const minuteur = setTimeout(() => finir({ stdout: '', stderr: '', timedOut: true }, true), timeoutMs + 3000);
    f.w.postMessage({ id, entree: { fichiers, input, runner: WASM_RUNNER, timeoutMs, memoireMo: WASM_MEMORY_MB, sortieMax: MAX_OUTPUT } });
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

interface RunOutput extends SortieJs {
  code: number | null;
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

/** Runs the runner in the chosen sandbox: in memory for WebAssembly, from a throwaway folder otherwise. */
async function execute(livrable: Livrable, input: string, timeoutMs: number, mode: SandboxMode, fond = false): Promise<RunOutput> {
  if (mode === 'wasm') return runWasm(livrable.fichiers, input, timeoutMs, fond);
  const dir = await mkdtemp(join(tmpdir(), 'osp-v0-'));
  try {
    for (const [name, content] of Object.entries(livrable.fichiers)) {
      await mkdir(dirname(join(dir, name)), { recursive: true });
      await writeFile(join(dir, name), content, 'utf8');
    }
    await writeFile(join(dir, RUNNER_FILE), RUNNER, 'utf8');
    return await run(dir, input, timeoutMs, mode);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}


/** Node's executors: the sandbox chosen by `opts.sandbox` for JavaScript, a throwaway thread for Luau. */
export function executeursNode(opts: VerifOptions = {}): Executeurs {
  return {
    verifierMode: () => void resolveSandbox(opts.sandbox),
    js: (livrable, input, timeoutMs) => execute(livrable, input, timeoutMs, resolveSandbox(opts.sandbox), opts.fond),
    luau: (o) => runLuau(o),
  };
}

export function verifierV0(critere: CritereFini, livrable: Livrable, opts: VerifOptions = {}): Promise<VerifReport> {
  return verifier(critere, livrable, opts, executeursNode(opts));
}

/**
 * Strength of a cell's tests (§3.2): the reference must pass every test, and the tests
 * must catch at least `scoreMin` of its mutants (see coeur.ts).
 */
export function adequation(
  critere: CritereTests,
  caches: TestCase[],
  reference: Livrable,
  opts: VerifOptions & { scoreMin?: number; moteurMutation?: number; exigerMesure?: boolean } = {},
): Promise<VerifReport> {
  return mesurer(critere, caches, reference, opts, executeursNode(opts));
}
