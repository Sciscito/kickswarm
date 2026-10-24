import { parentPort, workerData } from 'node:worker_threads';
import { controlerLuau } from './luau-checks.js';
import { executerLuau } from './luau-exec.js';

// The Luau sandbox (OSP v0.3 §3.6), in a throwaway thread: the Luau virtual machine compiled to
// WebAssembly, pinned (@luau-rs/luau 0.739.0, Luau release 739), so the coordinator, the guards and
// the auditors give the same verdict. The delivered code gets the language and the standard library
// (read-only), the deliverable's own files through `require`, and nothing else: no os, no debug, no
// network, no disk, no host function. Memory and time are bounded.

interface Entree {
  fichiers: Record<string, string>;
  runner: string;
  spec: unknown;
  timeoutMs: number;
  memoireMo: number;
  graine: number;
  /** luau-checks@1: the files to check (the deliverable's own Luau files), or nothing. */
  portes?: string[];
}

const { fichiers, runner, spec, timeoutMs, memoireMo, graine, portes } = workerData as Entree;
async function executer(): Promise<{ timedOut: boolean; sortie?: string; erreur?: string; portes?: string[] }> {
  if (portes?.length) {
    const diagnostics = await controlerLuau(fichiers, portes);
    if (diagnostics.length) return { timedOut: false, portes: diagnostics };
  }
  return executerLuau({ fichiers, runner, spec, timeoutMs, memoireMo, graine });
}

executer().then(
  (r) => parentPort!.postMessage(r),
  (e: unknown) => parentPort!.postMessage({ timedOut: false, erreur: String((e as Error)?.message ?? e).slice(0, 300) }),
);
