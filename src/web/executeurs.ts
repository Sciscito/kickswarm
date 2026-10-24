import variant from '@jitl/quickjs-wasmfile-release-sync';
import { newQuickJSWASMModuleFromVariant, type QuickJSSyncVariant } from 'quickjs-emscripten-core';
import { MAX_OUTPUT, WASM_RUNNER, type Executeurs } from '../verifier/coeur.js';
import { executerLuau } from '../verifier/luau-exec.js';
import { lireSortieLuau } from '../verifier/luau-prep.js';
import { LUAU_RUNNER } from '../verifier/luau-runner.js';
import { executerQuickJS } from '../verifier/quickjs-exec.js';

// The executors of the chat and guard doors (OSP v0.4 §2.3, §2.4): the same WebAssembly engines as
// the coordinator (QuickJS for JavaScript, Luau), run in the page with a fresh engine for each run, and
// the same verifier core (coeur.ts). A browser therefore reaches the same verdict as the coordinator.
// Also runs in Node, which is how the tests check it.

export const LABEL_NAVIGATEUR = 'WebAssembly in this browser (QuickJS and Luau, no network, no disk)';

export function executeursNavigateur(): Executeurs {
  return {
    js: async (livrable, input, timeoutMs) => {
      // Under Node's module resolution TypeScript sees the variant's namespace, not its default export.
      const moteur = await newQuickJSWASMModuleFromVariant(variant as unknown as QuickJSSyncVariant);
      const r = await executerQuickJS(moteur, { fichiers: livrable.fichiers, input, runner: WASM_RUNNER, timeoutMs, memoireMo: 256, sortieMax: MAX_OUTPUT });
      return { ...r, label: LABEL_NAVIGATEUR };
    },
    luau: async (o) => {
      if (o.portes.length) {
        // The analyzer is large: it is only loaded when a gate needs it.
        const { controlerLuau } = await import('../verifier/luau-checks.js');
        const diagnostics = await controlerLuau(o.fichiers, o.portes);
        if (diagnostics.length) return { timedOut: false, portes: diagnostics };
      }
      return lireSortieLuau(await executerLuau({ fichiers: o.fichiers, runner: LUAU_RUNNER, spec: o.spec, timeoutMs: o.timeoutMs, memoireMo: 128, graine: o.graine }));
    },
  };
}
