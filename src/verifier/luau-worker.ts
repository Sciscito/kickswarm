import { parentPort, workerData } from 'node:worker_threads';
import { intoLua, Lua, type LuaTable } from '@luau-rs/luau';
import { Analysis } from '@luau-rs/luau/analysis';

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
const LIBRAIRIES = ['base', 'coroutine', 'table', 'string', 'math', 'utf8', 'bit32', 'buffer'] as const;
const INTERDITS = /^[ \t]*--!(nocheck|nonstrict|nolint)[ \t]*\r?$/m;

/** luau-checks@1: strict type checking and Luau's linter, on the deliverable's own Luau files. */
async function controler(aVerifier: string[]): Promise<string[]> {
  const an = await Analysis.create({ mode: 'strict', lint: true });
  for (const [nom, src] of Object.entries(fichiers)) if (/\.(luau|lua)$/.test(nom)) an.setModule(nom, src);
  const out: string[] = [];
  for (const nom of aVerifier) {
    const m = INTERDITS.exec(fichiers[nom] ?? '');
    if (m) out.push(`${nom}: “--!${m[1]}” is not allowed (the check is strict)`);
    for (const d of an.check(nom).diagnostics) {
      if (d.module !== nom) continue;
      out.push(`${nom}:${d.location.begin.line + 1}: ${d.kind === 'lint' ? `lint ${d.code}` : 'type error'}: ${d.message.split('\n')[0]}`);
    }
  }
  return out;
}

/** JSON → Luau tables, built by the host: the delivered code never sees how. */
function versLua(lua: Lua, v: unknown): unknown {
  if (v === null || typeof v !== 'object') return v;
  const t = lua.createTable();
  if (Array.isArray(v)) v.forEach((x, i) => x !== null && t.rawSet(i + 1, versLua(lua, x) as never));
  else for (const [k, x] of Object.entries(v)) if (x !== null) t.rawSet(k, versLua(lua, x) as never);
  return t;
}

/** Candidate files for a path required without its extension, in Luau's order. */
function trouver(chemin: string): string | undefined {
  for (const c of [chemin, `${chemin}.luau`, `${chemin}.lua`, `${chemin}/init.luau`, `${chemin}/init.lua`]) if (Object.hasOwn(fichiers, c) && /\.(luau|lua)$/.test(c)) return c;
  return undefined;
}

async function executer(): Promise<{ timedOut: boolean; sortie?: string; erreur?: string; portes?: string[] }> {
  if (portes?.length) {
    const diagnostics = await controler(portes);
    if (diagnostics.length) return { timedOut: false, portes: diagnostics };
  }
  const lua = await Lua.create({ libraries: LIBRAIRIES, sandbox: true, memory: { limitBytes: memoireMo * 1024 * 1024 } });
  // math.random is seeded by the deliverable's hash: the same draws on every machine.
  lua.execute(`math.randomseed(${graine})`);
  const charger = lua.createFunction((type: unknown, x: unknown) => {
    try {
      if (type === 'module') {
        const nom = trouver(String(x));
        if (!nom) return intoLua.multiple(null, `module not found: ${String(x)}`);
        return intoLua.multiple(lua.load(fichiers[nom]!, { name: nom }), nom);
      }
      if (type === 'expression') return lua.load(`local args, out, eq = ...\nreturn (${String(x)})`, { name: 'property' });
      return intoLua.multiple(null, 'unknown request');
    } catch (e) {
      return intoLua.multiple(null, (e as Error).message.split('\n')[0]!);
    }
  });
  let timedOut = false;
  const echeance = Date.now() + timeoutMs;
  lua.setInterruptHooks({
    mode: 'continuous',
    execution: () => {
      if (Date.now() <= echeance) return 'continue';
      timedOut = true;
      return 'break';
    },
  });
  try {
    const [sortie] = lua.execute(runner, { name: '__osp_runner' }, charger, versLua(lua, spec) as LuaTable);
    if (timedOut) return { timedOut };
    return typeof sortie === 'string' ? { timedOut, sortie } : { timedOut, erreur: 'The runner returned no report' };
  } catch (e) {
    if (timedOut) return { timedOut };
    return { timedOut, erreur: (e as Error).message.split('\n')[0]!.slice(0, 300) };
  }
}

executer().then(
  (r) => parentPort!.postMessage(r),
  (e: unknown) => parentPort!.postMessage({ timedOut: false, erreur: String((e as Error)?.message ?? e).slice(0, 300) }),
);
