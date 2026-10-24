import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ErreurFournisseur, type Fournisseur, type Message } from './fournisseurs.js';

// Subscriptions through their official command-line tools (OSP v0.4 §2.6): Claude Code (a Claude
// subscription), Gemini CLI (a Google account), Codex (a ChatGPT subscription). The engine runs them
// headless, on prompts written by strangers, so every run is locked down as far as each tool allows,
// from what its documentation states:
//  - Claude Code: `--tools ""` and a deny rule on every tool and every MCP tool, no MCP server,
//    `--safe-mode` (no CLAUDE.md, hooks, plugins, skills), no prompt, no saved session, one turn;
//  - Gemini CLI: plan mode (no shell, no writes), no extension, no MCP server;
//  - Codex: its read-only sandbox still lets it run commands that read files, and it has no switch to
//    turn the shell off: it is only used if the contributor explicitly accepts that risk.
// Every run happens in a fresh empty folder, the prompt goes on stdin (never on the command line),
// and an option an old version does not know makes the run fail: it never runs unlocked.

export type IdAgent = 'claude-code' | 'gemini-cli' | 'codex';

export interface DefinitionAgent {
  id: IdAgent;
  commande: string;
  args: (dossier: string) => string[];
  /** Reads the final answer from what the tool printed. */
  lire: (stdout: string) => string;
  /** The tool can read files on this machine despite the lock (Codex). */
  risqueLecture: boolean;
  contexte: number;
  abonnement: string;
}

export const AGENTS: Record<IdAgent, DefinitionAgent> = {
  'claude-code': {
    id: 'claude-code',
    commande: 'claude',
    args: (dossier) => {
      const mcp = join(dossier, 'mcp.json');
      writeFileSync(mcp, '{"mcpServers":{}}');
      return ['-p', '--safe-mode', '--tools', '', '--disallowedTools', '*', 'mcp__*', '--strict-mcp-config', '--mcp-config', mcp, '--permission-prompts', 'none', '--no-session-persistence', '--output-format', 'text', '--max-turns', '1'];
    },
    lire: (s) => s.trim(),
    risqueLecture: false,
    contexte: 200_000,
    abonnement: 'Claude (Pro, Max)',
  },
  'gemini-cli': {
    id: 'gemini-cli',
    commande: 'gemini',
    args: () => ['--approval-mode', 'plan', '--extensions', 'none', '--allowed-mcp-server-names', 'kickswarm-no-mcp', '--output-format', 'json', '--prompt', 'Do the task given above.'],
    lire: (s) => {
      const j = JSON.parse(s.slice(s.indexOf('{'))) as { response?: string; error?: { message?: string } };
      if (j.error) throw new Error(j.error.message ?? 'Gemini CLI error');
      return (j.response ?? '').trim();
    },
    risqueLecture: false,
    contexte: 1_000_000,
    abonnement: 'Google account (Gemini)',
  },
  codex: {
    id: 'codex',
    commande: 'codex',
    args: () => ['exec', '--skip-git-repo-check', '--ephemeral', '--ignore-user-config', '--ignore-rules', '--sandbox', 'read-only', '-'],
    lire: (s) => s.trim(),
    risqueLecture: true,
    contexte: 200_000,
    abonnement: 'ChatGPT (Plus, Pro)',
  },
};

/** Messages the tools print when a subscription limit or a login problem stops them. */
const LIMITE = /hit your (session|weekly|opus|sonnet) limit|usage limit|rate limit|quota|credit balance is too low|spend limit|429|resource.?exhausted/i;
const CONNEXION = /not logged in|please run \/login|authentication required|login expired|invalid api key|401|unauthorized|sign in/i;
const OPTION_INCONNUE = /unknown option|unknown argument|unrecognized|invalid option|did you mean/i;

/** Quotes one argument for cmd.exe: our arguments are fixed, but an empty one must survive. */
function pourCmd(a: string): string {
  if (a === '') return '""';
  return /[\s"&|<>^%(),;]/.test(a) ? `"${a.replace(/"/g, '""')}"` : a;
}

export function agentInstalle(commande: string): boolean {
  const r = spawnSync(process.platform === 'win32' ? 'where' : 'which', [commande], { encoding: 'utf8', windowsHide: true });
  return r.status === 0 && r.stdout.trim().length > 0;
}

/** Runs one locked-down request through a subscription tool. */
export async function executerAgent(f: Fournisseur, messages: Message[], o: { delaiMs?: number; commande?: string } = {}): Promise<string> {
  const def = AGENTS[f.agent!];
  const dossier = mkdtempSync(join(tmpdir(), 'kickswarm-agent-'));
  try {
    const args = def.args(dossier);
    const commande = o.commande ?? f.commande ?? def.commande;
    // npm installs these tools as .cmd shims on Windows, which only cmd.exe can start: the command
    // line is built here, every argument quoted (they are all fixed by this file), and passed verbatim.
    const enfant =
      process.platform === 'win32'
        ? spawn(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', `"${[commande, ...args].map(pourCmd).join(' ')}"`], { cwd: dossier, windowsVerbatimArguments: true, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
        : spawn(commande, args, { cwd: dossier, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    const prompt = messages.map((m) => (m.role === 'system' ? m.content : m.role === 'assistant' ? `Your previous answer:\n${m.content}` : m.content)).join('\n\n');
    let out = '';
    let err = '';
    enfant.stdout.on('data', (d: Buffer) => (out += d.toString('utf8')));
    enfant.stderr.on('data', (d: Buffer) => (err += d.toString('utf8')));
    enfant.stdin.on('error', () => {});
    enfant.stdin.end(prompt);
    const code = await new Promise<number | null>((ok, ko) => {
      const t = setTimeout(() => {
        enfant.kill('SIGKILL');
        ko(new ErreurFournisseur(`${def.id}: no answer within ${Math.round((o.delaiMs ?? 300_000) / 1000)} s`, 504, 60_000));
      }, o.delaiMs ?? 300_000);
      enfant.on('error', (e) => (clearTimeout(t), ko(new ErreurFournisseur(`${def.id}: ${e.message}`, 404, undefined, true))));
      enfant.on('close', (c) => (clearTimeout(t), ok(c)));
    });
    const tout = `${out}\n${err}`;
    if (code !== 0 || !out.trim()) {
      if (OPTION_INCONNUE.test(err)) throw new ErreurFournisseur(`${def.id} is too old for the locked-down mode: update it (${err.trim().split('\n')[0]})`, 400, undefined, true);
      if (CONNEXION.test(tout)) throw new ErreurFournisseur(`${def.id}: not logged in (open it once and sign in)`, 401, undefined, true);
      if (LIMITE.test(tout)) throw new ErreurFournisseur(`${def.id}: subscription limit reached`, 429, 3_600_000);
      throw new ErreurFournisseur(`${def.id} failed (${code}): ${tout.trim().slice(0, 200)}`, 502, 120_000);
    }
    try {
      return def.lire(out);
    } catch (e) {
      throw new ErreurFournisseur(`${def.id}: unreadable answer (${(e as Error).message})`, 502, 60_000);
    }
  } finally {
    rmSync(dossier, { recursive: true, force: true });
  }
}
