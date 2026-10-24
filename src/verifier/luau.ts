import { extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { LUAU_RUNNER } from './luau-runner.js';
import { lireSortieLuau, type SortieLuau } from './luau-prep.js';

export { LUAU_LABEL, preparerLuau, type ResultatLuau, type SortieLuau } from './luau-prep.js';

// `tests-luau@1` and `luau-checks@1` (OSP v0.3 §3.6), the Node host: it runs a prepared suite
// (luau-prep.ts) in luau-worker.ts, a throwaway thread.

const LUAU_WORKER = new URL(`./luau-worker${extname(fileURLToPath(import.meta.url))}`, import.meta.url);
const MEMOIRE_MO = 128;

/** Runs a prepared suite in a throwaway thread, killed if it outlives its time. */
export function runLuau(o: { fichiers: Record<string, string>; spec: unknown; timeoutMs: number; graine: number; portes?: string[] }): Promise<SortieLuau> {
  return new Promise((resolve) => {
    let fini = false;
    const finir = (s: SortieLuau) => {
      if (fini) return;
      fini = true;
      clearTimeout(minuteur);
      void worker.terminate();
      resolve(s);
    };
    const worker = new Worker(LUAU_WORKER, {
      workerData: { fichiers: o.fichiers, runner: LUAU_RUNNER, spec: o.spec, timeoutMs: o.timeoutMs, memoireMo: MEMOIRE_MO, graine: o.graine, portes: o.portes },
      resourceLimits: { maxOldGenerationSizeMb: MEMOIRE_MO * 4 },
    });
    // The type checker has its own time: the gate and the tests together get a generous safety net.
    const minuteur = setTimeout(() => finir({ timedOut: true }), o.timeoutMs + (o.portes?.length ? 20_000 : 5000));
    worker.once('message', (m: { timedOut: boolean; sortie?: string; erreur?: string; portes?: string[] }) => finir(lireSortieLuau(m)));
    worker.once('error', (e) => finir({ timedOut: false, erreur: String(e) }));
    worker.once('exit', () => finir({ timedOut: false, erreur: 'The sandbox stopped unexpectedly' }));
  });
}
