import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { configurerMoteur } from './moteur/cli.js';
import { CoordinatorClient } from './plugin/client.js';
import { kickswarmHome, loadOrCreateIdentity } from './plugin/identite.js';

// `kickswarm join <hive>`: one command to send your AI into a hive.
// It creates your identity, finds the agents installed on this machine (Claude Code, Codex,
// Gemini CLI), shows what it will change, asks, then registers the Kickswarm MCP plugin in each.
// Then the local engine step (OSP v0.4 §2.6): what this machine can lend (subscriptions through their
// official tools, local models, free keys), a yes for each, OpenRouter in one click, and the engine
// started in the background, which works on its own from then on.

export type AgentId = 'claude' | 'codex' | 'gemini';

export interface PluginCommand {
  command: string;
  args: string[];
  env: Record<string, string>;
}

/** How agents should start the plugin: this very CLI, compiled, with the coordinator URL. */
export function pluginCommand(url: string): PluginCommand {
  const here = fileURLToPath(import.meta.url);
  const cli = here.endsWith('.ts') ? resolve(dirname(here), '..', 'dist', 'cli.js') : join(dirname(here), 'cli.js');
  if (!existsSync(cli)) throw new Error(`Compiled CLI not found at ${cli}. Run “npm run build” first.`);
  return { command: process.execPath, args: [cli, 'plugin'], env: { KICKSWARM_URL: url } };
}

function onPath(cmd: string): boolean {
  const r = spawnSync(process.platform === 'win32' ? 'where' : 'which', [cmd], { encoding: 'utf8', windowsHide: true });
  return r.status === 0 && r.stdout.trim().length > 0;
}

export function detectAgents(): AgentId[] {
  return (['claude', 'codex', 'gemini'] as const).filter(onPath);
}

const tomlString = (s: string) => JSON.stringify(s);

/** Codex reads MCP servers from ~/.codex/config.toml. Replaces an existing kickswarm block. */
export function configureCodex(plugin: PluginCommand, home = homedir()): string {
  const file = join(home, '.codex', 'config.toml');
  mkdirSync(dirname(file), { recursive: true });
  const before = existsSync(file) ? readFileSync(file, 'utf8') : '';
  const kept = before.replace(/\n?\[mcp_servers\.kickswarm\][\s\S]*?(?=\n\[|$)/, '').trimEnd();
  const env = Object.entries(plugin.env).map(([k, v]) => `${k} = ${tomlString(v)}`).join(', ');
  const block = [
    '[mcp_servers.kickswarm]',
    `command = ${tomlString(plugin.command)}`,
    `args = [${plugin.args.map(tomlString).join(', ')}]`,
    `env = { ${env} }`,
  ].join('\n');
  writeFileSync(file, (kept ? kept + '\n\n' : '') + block + '\n', 'utf8');
  return file;
}

/** Gemini CLI reads MCP servers from ~/.gemini/settings.json. */
export function configureGemini(plugin: PluginCommand, home = homedir()): string {
  const file = join(home, '.gemini', 'settings.json');
  mkdirSync(dirname(file), { recursive: true });
  const settings = existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>) : {};
  const servers = (settings.mcpServers as Record<string, unknown> | undefined) ?? {};
  servers.kickswarm = { command: plugin.command, args: plugin.args, env: plugin.env };
  settings.mcpServers = servers;
  writeFileSync(file, JSON.stringify(settings, null, 2) + '\n', 'utf8');
  return file;
}

/** Claude Code has its own command for this. */
export function configureClaude(plugin: PluginCommand): string {
  const env = Object.entries(plugin.env).flatMap(([k, v]) => ['-e', `${k}=${v}`]);
  spawnSync('claude', ['mcp', 'remove', '--scope', 'user', 'kickswarm'], { stdio: 'ignore', windowsHide: true, shell: process.platform === 'win32' });
  const r = spawnSync('claude', ['mcp', 'add', '--scope', 'user', ...env, 'kickswarm', '--', plugin.command, ...plugin.args], {
    encoding: 'utf8',
    windowsHide: true,
    shell: process.platform === 'win32',
  });
  if (r.status !== 0) throw new Error(`claude mcp add failed: ${(r.stderr || r.stdout).trim()}`);
  return 'Claude Code (user scope)';
}

const WHAT: Record<AgentId, string> = {
  claude: 'Claude Code: register the plugin with “claude mcp add --scope user kickswarm”',
  codex: 'Codex: add a [mcp_servers.kickswarm] block to ~/.codex/config.toml',
  gemini: 'Gemini CLI: add mcpServers.kickswarm to ~/.gemini/settings.json',
};

export function launchPrompt(slug: string): string {
  return `Join the Kickswarm hive “${slug}” with swarm_join, then call swarm_next and do each cell you receive, submitting with swarm_submit or swarm_decompose. Keep going until swarm_next says there is nothing left to do.`;
}

export async function joinHive(slug: string, opts: { url: string; yes: boolean; autostart?: boolean; moteur?: boolean; log?: (s: string) => void }): Promise<void> {
  const log = opts.log ?? console.log;
  const { identite, fichier, creee } = loadOrCreateIdentity();
  log(`\n🐝  Kickswarm · joining “${slug}”\n`);
  log(`${creee ? 'Created your identity' : 'Your identity'}: ${identite.id}`);
  log(`   Stored in ${fichier}. It never leaves this machine.\n`);

  const client = new CoordinatorClient(opts.url, identite);
  let hiveName = slug;
  try {
    // A private hive (OSP v0.3) is read through its own routes, with a member's ticket.
    let cible = slug;
    if (/^p[0-9a-f]{32}$/.test(slug)) {
      client.utiliserRuchePrivee(slug);
      cible = (await client.hives())[0]?.slug ?? slug;
    }
    const hive = await client.hive(cible);
    hiveName = hive.ruche.nom;
    log(`Hive found: “${hive.ruche.nom}” (${hive.statut}), ${hive.progression.miel}/${hive.progression.total} cells verified.`);
  } catch (e) {
    throw new Error(`Cannot reach hive “${slug}” at ${opts.url}: ${(e as Error).message}`);
  }

  const agents = detectAgents();
  if (!agents.length) {
    log('\nNo coding agent found on this machine (Claude Code, Codex or Gemini CLI): the engine below can still lend your free keys and local models.');
  } else {
    await brancherAgents(agents, slug, opts, log);
  }
  if (opts.moteur !== false) await configurerMoteur(kickswarmHome(), opts.url, { oui: opts.yes, ...(opts.autostart !== undefined ? { autostart: opts.autostart } : {}), log });
  log(`\nWatch the hive live: ${opts.url.replace(/\/$/, '')}/hive\n`);
}

/** The MCP plugin in each agent found: for working with your agent yourself, alongside the engine. */
async function brancherAgents(agents: AgentId[], slug: string, opts: { url: string; yes: boolean }, log: (s: string) => void): Promise<void> {
  const plugin = pluginCommand(opts.url);
  log('\nThis will:');
  for (const a of agents) log(`  • ${WHAT[a]}`);
  if (!opts.yes) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = (await rl.question('\nProceed? [y/N] ')).trim().toLowerCase();
    rl.close();
    if (answer !== 'y' && answer !== 'yes') {
      log('Nothing changed.');
      return;
    }
  }
  for (const a of agents) {
    try {
      const where = a === 'claude' ? configureClaude(plugin) : a === 'codex' ? configureCodex(plugin) : configureGemini(plugin);
      log(`  ✓ ${a}: ${where}`);
    } catch (e) {
      log(`  ✗ ${a}: ${(e as Error).message}`);
    }
  }
  log(`\nYour agents can also work for “${slug}” when you ask them. Open one and say:`);
  log(`  “${launchPrompt(slug)}”`);
  if (agents.includes('claude')) {
    log('\nOr launch a Claude Code bee right away, without a chat window:');
    log(`  claude -p "${launchPrompt(slug).replace(/"/g, '\\"')}" --allowedTools "mcp__kickswarm"`);
  }
}
