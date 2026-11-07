import { AGENTS, agentInstalle, executerAgent, type IdAgent } from '../moteur/agents.js';
import { pool } from '../moteur/cli.js';
import { chargerConfig } from '../moteur/config.js';
import { completer as completerModele, type Fournisseur, type Message } from '../moteur/fournisseurs.js';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ruchePrivee, type Completer } from './ruche.js';

/** From a GitHub issue URL: clone the repository (shallow), install its dependencies without scripts, and turn the issue into a goal. */
async function depuisIssue(home: string, url: string): Promise<{ dossier: string; objectif: string; test: string; ref: string }> {
  const m = url.match(/github\.com\/([\w.-]+)\/([\w.-]+)\/issues\/(\d+)/);
  if (!m) throw new Error('--issue expects https://github.com/<owner>/<repo>/issues/<number>');
  const [, owner, repo, num] = m;
  const r = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues/${num}`, { headers: { 'user-agent': 'kickswarm-hive' } });
  if (!r.ok) throw new Error(`GitHub said ${r.status} for that issue`);
  const issue = (await r.json()) as { title: string; body?: string; state: string };
  const dossier = join(home, 'oss', `${owner}-${repo}`);
  mkdirSync(join(home, 'oss'), { recursive: true });
  const run = (cmd: string, args: string[], cwd?: string) => {
    const x = spawnSync(cmd, args, { cwd, encoding: 'utf8', shell: process.platform === 'win32', windowsHide: true });
    if (x.status !== 0) throw new Error(`${cmd} ${args[0]}: ${(x.stderr || x.stdout).slice(-300)}`);
  };
  if (!existsSync(join(dossier, '.git'))) run('git', ['clone', '--depth', '50', `https://github.com/${owner}/${repo}.git`, dossier]);
  else run('git', ['pull', '--ff-only'], dossier);
  // Dependencies without install scripts: nothing from the package registry runs at install time.
  if (existsSync(join(dossier, 'package-lock.json'))) run('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], dossier);
  else if (existsSync(join(dossier, 'package.json'))) run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund'], dossier);
  const objectif = `Resolve GitHub issue ${owner}/${repo}#${num}: "${issue.title}"

${(issue.body ?? '').slice(0, 6000)}

Follow the repository's own conventions (read AGENTS.md or CONTRIBUTING.md if present). Keep the change small.`;
  return { dossier, objectif, test: existsSync(join(dossier, 'package.json')) ? 'npm test' : '', ref: `${owner}/${repo}#${num}` };
}

// `kickswarm hive <folder> --goal "..."`: a private hive on any local git repository.

export const AIDE_HIVE = `kickswarm hive <folder> --goal "<what you want>"  |  kickswarm hive --issue <github issue url> [--test "<command>"] [--planner auto|claude-code|codex|gemini-cli|engine] [--tries 3]

  A strong model plans once (your Claude Code, Codex or Gemini CLI if installed, else your best free model).
  Free models from your engine do each task on a new branch, in .kickswarm/ (your checkout is untouched).
  --test runs the project's own check after each task (e.g. "npm test"); failures go back to the model,
  and the last attempt goes to the strong model. Each task that passes is one commit on the branch.

  Careful: --test runs code written by AI models on this machine. Use it on projects you trust, ideally
  in a container or a VM. Without --test, nothing is run; review the branch before merging it.`;

const SYSTEME = 'You are a careful software engineer. Answer exactly in the format asked for.';

export async function commandeHive(home: string, args: string[], opts: Record<string, string>): Promise<void> {
  let dossier = args[0];
  let ref: string | null = null;
  if (opts.issue) {
    const x = await depuisIssue(home, opts.issue);
    dossier = x.dossier;
    opts.goal ??= x.objectif;
    if (!opts.test && x.test) opts.test = x.test;
    ref = x.ref;
    console.log(`[hive] ${x.ref} cloned in ${x.dossier}`);
  }
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
  let appel = 0;
  const viaPool = async (prompt: string) => {
    const besoin = { tokens: Math.ceil(prompt.length / 3.5), maxTokens: 16000, usage: 'essaim' as const, confidentiel: false };
    const cands = p.candidats(besoin);
    // Each call goes to the next candidate in turn, so attempts try different models.
    for (let k = 0; k < Math.min(cands.length, 4); k++) {
      const m = cands[(appel + k) % cands.length]!;
      const f = p.fournisseurs.find((x) => x.id === m.fournisseur)!;
      try {
        const texte = await completerModele(f, m.nom, msgs(prompt), { maxTokens: besoin.maxTokens });
        appel++;
        return { texte, agent: m.id };
      } catch {
        // rate-limited or down: the next candidate
      }
    }
    appel++;
    const r = await p.completer(besoin, msgs(prompt));
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
  if (ref && r.faites.length) {
    // A patch to review before anything is proposed upstream.
    const base = spawnSync('git', ['merge-base', 'HEAD', r.branche], { cwd: dossier, encoding: 'utf8' }).stdout.trim();
    const patch = spawnSync('git', ['diff', `${base}..${r.branche}`], { cwd: dossier, encoding: 'utf8', maxBuffer: 64 << 20 }).stdout;
    const f = join(home, 'oss', `${ref.replace(/[/#]/g, '-')}.patch`);
    writeFileSync(f, patch);
    console.log(`
Patch for ${ref}: ${f}
Nothing was sent upstream. Review it; a pull request is opened only if you decide to (disclose AI assistance as the project asks).`);
  }
}
