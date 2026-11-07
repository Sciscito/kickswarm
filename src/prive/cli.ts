import { AGENTS, agentInstalle, executerAgent, type IdAgent } from '../moteur/agents.js';
import { pool } from '../moteur/cli.js';
import { chargerConfig } from '../moteur/config.js';
import type { Fournisseur, Message } from '../moteur/fournisseurs.js';
import { ruchePrivee, type Completer } from './ruche.js';

// `kickswarm hive <folder> --goal "..."`: a private hive on any local git repository.

export const AIDE_HIVE = `kickswarm hive <folder> --goal "<what you want>" [--test "<command>"] [--planner auto|claude-code|codex|gemini-cli|engine] [--tries 3]

  A strong model plans once (your Claude Code, Codex or Gemini CLI if installed, else your best free model).
  Free models from your engine do each task on a new branch, in .kickswarm/ (your checkout is untouched).
  --test runs the project's own check after each task (e.g. "npm test"); failures go back to the model,
  and the last attempt goes to the strong model. Each task that passes is one commit on the branch.

  Careful: --test runs code written by AI models on this machine. Use it on projects you trust, ideally
  in a container or a VM. Without --test, nothing is run; review the branch before merging it.`;

const SYSTEME = 'You are a careful software engineer. Answer exactly in the format asked for.';

export async function commandeHive(home: string, args: string[], opts: Record<string, string>): Promise<void> {
  const dossier = args[0];
  if (!dossier || !opts.goal || opts.help !== undefined) return void console.log(AIDE_HIVE);
  const log = (l: string) => console.log(`[hive] ${l}`);
  const msgs = (prompt: string): Message[] => [{ role: 'system', content: SYSTEME }, { role: 'user', content: prompt }];

  // The strong model: an official agent in its locked-down one-shot mode, if installed.
  const voulu = opts.planner ?? 'auto';
  const agent: IdAgent | null = voulu === 'engine' ? null : voulu !== 'auto' ? (voulu as IdAgent) : ((['claude-code', 'codex', 'gemini-cli'] as IdAgent[]).find((a) => agentInstalle(AGENTS[a].commande)) ?? null);
  if (agent && !AGENTS[agent]) throw new Error(`Unknown planner ${agent}`);
  const viaAgent = async (prompt: string) => ({ texte: await executerAgent({ id: `agent:${agent}`, agent } as unknown as Fournisseur, msgs(prompt), { delaiMs: 600_000 }), agent: agent! });

  // The workers: the engine's pool, free models first.
  const p = pool(chargerConfig(home), () => {});
  await p.decouvrir().catch(() => {});
  const libres = p.modeles().length;
  const viaPool = async (prompt: string) => {
    const r = await p.completer({ tokens: Math.ceil(prompt.length / 3.5), maxTokens: 16000, usage: 'essaim', confidentiel: false }, msgs(prompt));
    return { texte: r.texte, agent: r.modele.id };
  };
  if (!libres && !agent) throw new Error('No model available: connect a free provider (kickswarm engine, e.g. OpenRouter) or install Claude Code, Codex or Gemini CLI.');
  log(`planner: ${agent ?? 'best engine model'} · workers: ${libres ? `${libres} engine model(s), free first` : agent} · check: ${opts.test ?? 'none'}`);

  const completer: Completer = async (prompt, niveau) => {
    if (niveau === 'travail' && libres) return viaPool(prompt);
    if (agent) return viaAgent(prompt);
    return viaPool(prompt);
  };
  const r = await ruchePrivee({ dossier, objectif: opts.goal, completer, ...(opts.test ? { test: opts.test } : {}), essais: Number(opts.tries ?? 3), log });
  console.log(`\nDone: ${r.faites.length} task(s) committed, ${r.ratees.length} not solved.\nBranch: ${r.branche} (worktree ${r.worktree})\nReview it: git log ${r.branche}   ·   merge it: git merge ${r.branche}   ·   drop it: git worktree remove "${r.worktree}" && git branch -D ${r.branche}`);
  for (const x of r.ratees) console.log(`  not solved: ${x.titre}`);
}
