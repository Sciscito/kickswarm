import { parentPort, workerData } from 'node:worker_threads';
import { newQuickJSWASMModule } from 'quickjs-emscripten';
import { executerQuickJS, type EntreeQuickJS } from './quickjs-exec.js';

// The WebAssembly sandbox (OSP v0.2) in Node: a fresh QuickJS engine in a throwaway thread, which
// stops after the run and takes all the engine's memory with it. The run itself is quickjs-exec.ts.

const r = await executerQuickJS(await newQuickJSWASMModule(), workerData as EntreeQuickJS);
parentPort!.postMessage(r);
