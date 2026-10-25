import { parentPort } from 'node:worker_threads';
import { newQuickJSWASMModule } from 'quickjs-emscripten';
import { executerQuickJS, type EntreeQuickJS } from './quickjs-exec.js';

// The WebAssembly sandbox (OSP v0.2) in Node: a thread that keeps one QuickJS WebAssembly module warm and
// gives every run its own fresh engine (runtime and context: no object can cross from one run to the next).
// Loading the module is what cost a quarter of a second per run. The main thread retires this thread after
// a few runs, or at once after a run that hit a limit, so the memory of the engines never piles up.

const module = await newQuickJSWASMModule();
parentPort!.on('message', async (m: { id: number; entree: EntreeQuickJS }) => {
  const r = await executerQuickJS(module, m.entree);
  parentPort!.postMessage({ id: m.id, ...r });
});
