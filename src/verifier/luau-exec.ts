import { intoLua, Lua, type LuaTable } from '@luau-rs/luau';

// One run of the Luau runner (OSP v0.3 §3.6): the Luau virtual machine compiled to WebAssembly,
// pinned (@luau-rs/luau 0.739.0, Luau release 739). The delivered code gets the language and the
// standard library (read-only), the deliverable's own files through `require`, and nothing else: no
// os, no debug, no network, no disk, no host function. Memory and time are bounded. Shared by Node's
// throwaway thread (luau-worker.ts) and browsers (OSP v0.4 §2.3), so both give the same verdict.

export interface EntreeLuau {
  fichiers: Record<string, string>;
  runner: string;
  spec: unknown;
  timeoutMs: number;
  memoireMo: number;
  graine: number;
}

const LIBRAIRIES = ['base', 'coroutine', 'table', 'string', 'math', 'utf8', 'bit32', 'buffer'] as const;

/** JSON → Luau tables, built by the host: the delivered code never sees how. */
function versLua(lua: Lua, v: unknown): unknown {
  if (v === null || typeof v !== 'object') return v;
  const t = lua.createTable();
  if (Array.isArray(v)) v.forEach((x, i) => x !== null && t.rawSet(i + 1, versLua(lua, x) as never));
  else for (const [k, x] of Object.entries(v)) if (x !== null) t.rawSet(k, versLua(lua, x) as never);
  return t;
}

/** Candidate files for a path required without its extension, in Luau's order. */
function trouver(fichiers: Record<string, string>, chemin: string): string | undefined {
  for (const c of [chemin, `${chemin}.luau`, `${chemin}.lua`, `${chemin}/init.luau`, `${chemin}/init.lua`]) if (Object.hasOwn(fichiers, c) && /\.(luau|lua)$/.test(c)) return c;
  return undefined;
}

export async function executerLuau(o: EntreeLuau): Promise<{ timedOut: boolean; sortie?: string; erreur?: string }> {
  const lua = await Lua.create({ libraries: LIBRAIRIES, sandbox: true, memory: { limitBytes: o.memoireMo * 1024 * 1024 } });
  // math.random is seeded by the deliverable's hash: the same draws on every machine.
  lua.execute(`math.randomseed(${o.graine})`);
  const charger = lua.createFunction((type: unknown, x: unknown) => {
    try {
      if (type === 'module') {
        const nom = trouver(o.fichiers, String(x));
        if (!nom) return intoLua.multiple(null, `module not found: ${String(x)}`);
        return intoLua.multiple(lua.load(o.fichiers[nom]!, { name: nom }), nom);
      }
      if (type === 'expression') return lua.load(`local args, out, eq = ...\nreturn (${String(x)})`, { name: 'property' });
      return intoLua.multiple(null, 'unknown request');
    } catch (e) {
      return intoLua.multiple(null, (e as Error).message.split('\n')[0]!);
    }
  });
  let timedOut = false;
  const echeance = Date.now() + o.timeoutMs;
  lua.setInterruptHooks({
    mode: 'continuous',
    execution: () => {
      if (Date.now() <= echeance) return 'continue';
      timedOut = true;
      return 'break';
    },
  });
  try {
    const [sortie] = lua.execute(o.runner, { name: '__osp_runner' }, charger, versLua(lua, o.spec) as LuaTable);
    if (timedOut) return { timedOut };
    return typeof sortie === 'string' ? { timedOut, sortie } : { timedOut, erreur: 'The runner returned no report' };
  } catch (e) {
    if (timedOut) return { timedOut };
    return { timedOut, erreur: (e as Error).message.split('\n')[0]!.slice(0, 300) };
  }
}
