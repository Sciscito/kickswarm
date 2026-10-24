import type { QuickJSWASMModule } from 'quickjs-emscripten';

// The WebAssembly sandbox (OSP v0.2): one run of the JavaScript runner in a QuickJS engine compiled to
// WebAssembly. The code under test finds no network, no disk, no process and no host API: only the
// language, and the deliverable's files as modules. Memory and stack are bounded; a deadline
// interrupts even an infinite loop, with no way around it. Shared by Node's throwaway thread
// (wasm-worker.ts) and browsers (OSP v0.4 §2.3): give it a fresh engine for each run.

export interface EntreeQuickJS {
  fichiers: Record<string, string>;
  input: string;
  runner: string;
  timeoutMs: number;
  memoireMo: number;
  sortieMax: number;
}

export async function executerQuickJS(QuickJS: QuickJSWASMModule, o: EntreeQuickJS): Promise<{ stdout: string; stderr: string; timedOut: boolean }> {
  const echeance = Date.now() + o.timeoutMs;
  let stdout = '';
  let stderr = '';
  let timedOut = false;
  try {
    const rt = QuickJS.newRuntime();
    rt.setMemoryLimit(o.memoireMo * 1024 * 1024);
    rt.setMaxStackSize(1024 * 1024);
    rt.setInterruptHandler(() => {
      if (Date.now() <= echeance) return false;
      timedOut = true;
      return true;
    });
    // The only modules available are the deliverable's files.
    rt.setModuleLoader((nom) => {
      const n = nom.replace(/^\.\//, '');
      const src = Object.hasOwn(o.fichiers, n) ? o.fichiers[n] : undefined;
      if (src === undefined) return { error: new Error(`Cannot find module “${nom}”: this sandbox has no network, no disk and no Node API`) };
      return n.endsWith('.json') ? `export default ${JSON.stringify(JSON.parse(src))};` : src;
    });
    const ctx = rt.newContext();
    const emit = ctx.newFunction('emit', (h) => {
      if (stdout.length < o.sortieMax) stdout += ctx.getString(h);
    });
    ctx.setProp(ctx.global, '__osp_emit', emit);
    emit.dispose();
    const spec = ctx.newString(o.input);
    ctx.setProp(ctx.global, '__osp_spec', spec);
    spec.dispose();

    const res = ctx.evalCode(o.runner, '__osp_runner.mjs', { type: 'module' });
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
    // Nothing is freed: the engine is thrown away with all its memory (a thread that stops, or an
    // engine the browser's garbage collector reclaims).
  } catch (e) {
    stderr = String(e);
  }
  return { stdout, stderr, timedOut };
}
