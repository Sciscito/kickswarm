import { Analysis } from '@luau-rs/luau/analysis';

// luau-checks@1 (OSP v0.3 §3.6): Luau's own analyzer, pinned, in strict mode with its linter. Shared by
// Node's throwaway thread (luau-worker.ts) and browsers (OSP v0.4 §2.3).

const INTERDITS = /^[ \t]*--!(nocheck|nonstrict|nolint)[ \t]*\r?$/m;

/** luau-checks@1: strict type checking and Luau's linter, on the deliverable's own Luau files. */
export async function controlerLuau(fichiers: Record<string, string>, aVerifier: string[]): Promise<string[]> {
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

