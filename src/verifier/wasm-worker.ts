import { parentPort, workerData } from 'node:worker_threads';
import { newQuickJSWASMModule } from 'quickjs-emscripten';

// The WebAssembly sandbox (OSP v0.2): a QuickJS JavaScript engine compiled to WebAssembly,
// fresh for each run, in a throwaway thread. The code under test finds no network, no disk,
// no process and no Node API: only the language, and the deliverable's files as modules.
// Memory and stack are bounded; a deadline interrupts even an infinite loop, with no way around it.

interface Entree {
  fichiers: Record<string, string>;
  input: string;
  runner: string;
  timeoutMs: number;
  memoireMo: number;
  sortieMax: number;
}

const { fichiers, input, runner, timeoutMs, memoireMo, sortieMax } = workerData as Entree;
const echeance = Date.now() + timeoutMs;
let stdout = '';
let stderr = '';
let timedOut = false;

try {
  const QuickJS = await newQuickJSWASMModule();
  const rt = QuickJS.newRuntime();
  rt.setMemoryLimit(memoireMo * 1024 * 1024);
  rt.setMaxStackSize(1024 * 1024);
  rt.setInterruptHandler(() => {
    if (Date.now() <= echeance) return false;
    timedOut = true;
    return true;
  });
  // The only modules available are the deliverable's files.
  rt.setModuleLoader((nom) => {
    const n = nom.replace(/^\.\//, '');
    const src = Object.hasOwn(fichiers, n) ? fichiers[n] : undefined;
    if (src === undefined) return { error: new Error(`Cannot find module “${nom}”: this sandbox has no network, no disk and no Node API`) };
    return n.endsWith('.json') ? `export default ${JSON.stringify(JSON.parse(src))};` : src;
  });
  const ctx = rt.newContext();
  const emit = ctx.newFunction('emit', (h) => {
    if (stdout.length < sortieMax) stdout += ctx.getString(h);
  });
  ctx.setProp(ctx.global, '__osp_emit', emit);
  emit.dispose();
  const spec = ctx.newString(input);
  ctx.setProp(ctx.global, '__osp_spec', spec);
  spec.dispose();

  const res = ctx.evalCode(runner, '__osp_runner.mjs', { type: 'module' });
  if (res.error) {
    stderr = JSON.stringify(ctx.dump(res.error));
  } else {
    // The runner is asynchronous: run the job queue until it has finished.
    for (;;) {
      const etat = ctx.getPromiseState(res.value);
      if (etat.type !== 'pending') {
        if (etat.type === 'rejected') stderr = JSON.stringify(ctx.dump(etat.error));
        break;
      }
      const jobs = rt.executePendingJobs();
      if (jobs.error) {
        stderr = JSON.stringify(ctx.dump(jobs.error));
        break;
      }
      if (jobs.value === 0) {
        stderr = 'The module awaits something that never comes (no timers or I/O in this sandbox)';
        break;
      }
    }
  }
  // Nothing is freed: the thread stops and takes all the engine's memory with it.
} catch (e) {
  stderr = String(e);
}
parentPort!.postMessage({ stdout, stderr, timedOut });
