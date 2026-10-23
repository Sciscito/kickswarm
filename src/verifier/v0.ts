import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CritereFini, Livrable } from '../protocol/types.js';

// V0 verifier `tests-js@1` (spec §9.1): imports the delivered module in an isolated runtime,
// calls each export with the test's arguments and compares with the expected value.
// Two sandboxes (§8):
//  - container (preferred): Docker or Podman, network off, read-only filesystem, no capabilities,
//    CPU/memory/process limits, non-root user, plus Node's permission model inside;
//  - process (fallback): a separate Node process with the permission model (read limited to the
//    work folder, no writes, no child processes), empty environment and a timeout. The network is
//    NOT cut in this mode: never expose a public coordinator with it.
// Choose with KICKSWARM_SANDBOX=auto|container|process (auto = container when available).

export interface TestReport {
  nom: string;
  ok: boolean;
  attendu: unknown;
  obtenu?: unknown;
  erreur?: string;
}

export interface VerifReport {
  ok: boolean;
  motif: string;
  tests: TestReport[];
  duree_ms: number;
  sandbox: string;
}

const FILE_RE = /^[A-Za-z0-9-][A-Za-z0-9_.-]{0,63}\.(mjs|js|json)$/;
const FN_RE = /^[A-Za-z_$][A-Za-z0-9_$]{0,63}$/;
const MAX_FILES = 32;
const MAX_BYTES = 256 * 1024;
const MAX_TESTS = 200;
const DEFAULT_TIMEOUT_MS = 5000;
const MAX_TIMEOUT_MS = 30000;
const MAX_OUTPUT = 1024 * 1024;
const RUNNER_FILE = '__osp_runner.mjs';
const IMAGE = process.env.KICKSWARM_SANDBOX_IMAGE ?? 'node:24-alpine';
/** Extra time for the container to start (and for the image to be pulled the first time). */
const CONTAINER_GRACE_MS = 60_000;
const TESTS_FILE = '__osp_tests.json';

const RUNNER = `import { readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
const { module: mod, tests } = JSON.parse(readFileSync(new URL('./${TESTS_FILE}', import.meta.url), 'utf8'));
const msg = (e) => String((e && e.message) || e);
const norm = (v) => (v === undefined ? null : JSON.parse(JSON.stringify(v)));
const emit = (o) => process.stdout.write('\\n__OSP__' + JSON.stringify(o) + '\\n');
let m;
try { m = await import(new URL('./' + mod, import.meta.url).href); }
catch (e) { emit({ chargement: msg(e) }); process.exit(0); }
const out = [];
for (const t of tests) {
  const nom = t.nom || t.fn + '(' + JSON.stringify(t.args).slice(1, -1) + ')';
  try {
    if (typeof m[t.fn] !== 'function') { out.push({ nom, ok: false, attendu: t.attendu, erreur: 'missing export “' + t.fn + '”' }); continue; }
    const obtenu = norm(await m[t.fn](...t.args));
    out.push({ nom, ok: isDeepStrictEqual(obtenu, t.attendu), attendu: t.attendu, obtenu });
  } catch (e) { out.push({ nom, ok: false, attendu: t.attendu, erreur: msg(e) }); }
}
emit({ tests: out });
`;

/** Lève une erreur si le critère n'est pas un critère V0 exécutable par ce vérificateur. */
export function validateCritere(critere: CritereFini): void {
  if (!critere || critere.classe !== 'V0') throw new Error('The MVP only supports verification class V0');
  if (critere.verificateur !== 'tests-js@1') throw new Error(`Unknown verifier: ${String(critere.verificateur)}`);
  if (critere.module !== undefined && !FILE_RE.test(critere.module)) throw new Error(`Invalid module name: ${critere.module}`);
  if (!Array.isArray(critere.tests) || critere.tests.length === 0) throw new Error('A V0 criterion needs at least one test');
  if (critere.tests.length > MAX_TESTS) throw new Error(`Too many tests (maximum ${MAX_TESTS})`);
  for (const t of critere.tests) {
    if (!FN_RE.test(t.fn)) throw new Error(`Invalid function name: ${String(t.fn)}`);
    if (!Array.isArray(t.args)) throw new Error(`The arguments of test ${t.fn} must be an array`);
  }
  if (critere.timeout_ms !== undefined && !(critere.timeout_ms > 0 && critere.timeout_ms <= MAX_TIMEOUT_MS)) {
    throw new Error(`timeout_ms must be between 1 and ${MAX_TIMEOUT_MS}`);
  }
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

export type SandboxMode = 'container' | 'process';

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

export function resolveSandbox(pref: string = process.env.KICKSWARM_SANDBOX ?? 'auto'): SandboxMode {
  if (pref === 'process') return 'process';
  const rt = containerRuntime();
  if (pref === 'container' && !rt) throw new Error('Container sandbox requested, but neither Docker nor Podman is available');
  return rt ? 'container' : 'process';
}

/** Arguments of the locked-down container run (pure function, tested on its own). */
export function containerArgs(dir: string, name: string, timeoutMs: number, image = IMAGE): string[] {
  const seconds = Math.max(1, Math.ceil(timeoutMs / 1000));
  return [
    'run', '--rm', '--name', name,
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

function run(dir: string, timeoutMs: number, mode: SandboxMode): Promise<RunOutput> {
  if (mode === 'container') {
    const rt = containerRuntime()!;
    const name = `osp-v0-${randomBytes(6).toString('hex')}`;
    const kill = () => {
      spawn(rt, ['kill', name], { stdio: 'ignore', windowsHide: true }).on('error', () => {});
    };
    return collect(rt, containerArgs(dir, name, timeoutMs), dir, undefined, timeoutMs + CONTAINER_GRACE_MS, `container (${rt}, network off, read-only, 256 MB)`, kill);
  }
  const { flags, label } = permissionFlags(dir);
  const env: NodeJS.ProcessEnv = {};
  if (process.env.SystemRoot) env.SystemRoot = process.env.SystemRoot;
  return collect(process.execPath, [...flags, join(dir, RUNNER_FILE)], dir, env, timeoutMs, label);
}

function collect(cmd: string, args: string[], cwd: string, env: NodeJS.ProcessEnv | undefined, timeoutMs: number, label: string, onTimeout?: () => void): Promise<RunOutput> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
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

export async function verifierV0(critere: CritereFini, livrable: Livrable, opts: { sandbox?: string } = {}): Promise<VerifReport> {
  const started = Date.now();
  const fail = (motif: string, tests: TestReport[] = [], sandbox = 'none'): VerifReport => ({ ok: false, motif, tests, duree_ms: Date.now() - started, sandbox });

  try {
    validateCritere(critere);
    validateLivrable(livrable);
  } catch (e) {
    return fail((e as Error).message);
  }
  const mod = critere.module ?? 'solution.mjs';
  if (!(mod in livrable.fichiers)) return fail(`The deliverable does not contain the expected module “${mod}”`);
  let mode: SandboxMode;
  try {
    mode = resolveSandbox(opts.sandbox);
  } catch (e) {
    return fail((e as Error).message);
  }

  const dir = await mkdtemp(join(tmpdir(), 'osp-v0-'));
  try {
    for (const [name, content] of Object.entries(livrable.fichiers)) await writeFile(join(dir, name), content, 'utf8');
    await writeFile(join(dir, TESTS_FILE), JSON.stringify({ module: mod, tests: critere.tests }), 'utf8');
    await writeFile(join(dir, RUNNER_FILE), RUNNER, 'utf8');

    const out = await run(dir, critere.timeout_ms ?? DEFAULT_TIMEOUT_MS, mode);
    if (out.timedOut) return fail(`Time limit exceeded (${critere.timeout_ms ?? DEFAULT_TIMEOUT_MS} ms)`, [], out.label);
    const line = out.stdout.split('\n').reverse().find((l) => l.startsWith('__OSP__'));
    if (!line) {
      const err = out.stderr.trim().split('\n').slice(-3).join(' ').slice(0, 300);
      return fail(`The module crashed before the tests finished${err ? `: ${err}` : ''}`, [], out.label);
    }
    const parsed = JSON.parse(line.slice('__OSP__'.length)) as { chargement?: string; tests?: TestReport[] };
    if (parsed.chargement) return fail(`Module could not be loaded: ${parsed.chargement}`, [], out.label);
    const tests = parsed.tests ?? [];
    const failed = tests.filter((t) => !t.ok);
    if (failed.length === 0) {
      return { ok: true, motif: `${tests.length}/${tests.length} tests passed`, tests, duree_ms: Date.now() - started, sandbox: out.label };
    }
    const first = failed[0]!;
    const detail = first.erreur ?? `got ${JSON.stringify(first.obtenu)}, expected ${JSON.stringify(first.attendu)}`;
    return fail(`${failed.length}/${tests.length} tests failed. First failure: ${first.nom} → ${detail}`, tests, out.label);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
