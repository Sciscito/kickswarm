import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import type { Server } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { getDefaultEnvironment, StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { auditRegistry } from './coordinator/audit.js';
import { DrandHttp } from './coordinator/balise.js';
import { Coordinator } from './coordinator/coordinator.js';
import { createCoordinatorServer } from './coordinator/http.js';
import type { Params } from './coordinator/params.js';
import type { RegistryEntry } from './coordinator/registry.js';
import { helperGuard, httpAccess, scriptedBee, type HiveAccess } from './exemples/scripted-bee.js';
import { TEXT_ROOT, TEXT_SCRIPT } from './exemples/texte.js';
import { makeDecision, makeHive } from './protocol/builders.js';
import { generateIdentity } from './protocol/identity.js';
import { CoordinatorClient } from './plugin/client.js';
import { loadOrCreateIdentity } from './plugin/identite.js';

// `kickswarm trial`: the first run with a real AI. A coordinator on this machine, the text-toolkit
// hive, and a ready-made folder where a Claude Code session becomes a bee. A single agent cannot
// verify its own work, so a few helper guards (honest, automatic) do the verifying; the hive owner's
// approval of splits is automatic too, for this trial only.

export const TRIAL_SLUG = 'text-toolkit';
const PROJECT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export interface TrialOptions {
  port: number;
  /** Draws from the public drand beacon (network needed). */
  beacon?: boolean;
  /** Helper guards. With one AI and a 1% target, 3 newcomer guards per cell are needed. */
  guards?: number;
  /** A scripted bee plays the AI: a full dress rehearsal, then the trial stops. */
  rehearse?: boolean;
  /** Where essai/runs and essai/abeille go (default: this project's essai folder). */
  sortie?: string;
  /** Pause between two helper-guard tries, in ms. */
  pace?: number;
  /** In a rehearsal, also start the plugin exactly as the bee folder configures it (needs dist). */
  smoke?: boolean;
  /** Coordinator parameters on top of the trial's own (tests use them to go faster). */
  params?: Partial<Params>;
  log?: (s: string) => void;
}

export interface TrialRun {
  url: string;
  server: Server;
  /** Folder of this run: its registry, its state and the founder's key. */
  dossier: string;
  /** The folder to open in a new Claude Code session. */
  abeille: string;
  /** Resolves once the hive is complete and audited. */
  done: Promise<{ ok: boolean }>;
  stop(): Promise<void>;
}

/** The bee folder: an MCP config for the Kickswarm plugin, tool permissions, and the bee's standing instructions. */
export function prepareBee(sortie: string, url: string): { dossier: string; command: string; args: string[]; env: Record<string, string> } {
  const dossier = join(sortie, 'abeille');
  mkdirSync(join(dossier, '.claude'), { recursive: true });
  const command = process.execPath;
  const args = [join(PROJECT, 'dist', 'cli.js'), 'plugin'];
  const env = { KICKSWARM_URL: url, KICKSWARM_HOME: join(dossier, '.kickswarm') };
  writeFileSync(join(dossier, '.mcp.json'), JSON.stringify({ mcpServers: { kickswarm: { command, args, env } } }, null, 2) + '\n', 'utf8');
  // Only the Kickswarm tools are pre-approved: they reach the coordinator and nothing else.
  writeFileSync(join(dossier, '.claude', 'settings.json'), JSON.stringify({ enableAllProjectMcpServers: true, permissions: { allow: ['mcp__kickswarm'] } }, null, 2) + '\n', 'utf8');
  writeFileSync(
    join(dossier, 'CLAUDE.md'),
    [
      '# You are a Kickswarm bee',
      '',
      'This folder has one purpose: lend your intelligence to a Kickswarm hive, through the `kickswarm` MCP tools.',
      '',
      `1. Call \`swarm_join\` with ruche = "${TRIAL_SLUG}".`,
      '2. Call `swarm_next` and do exactly the cell it gives you, following its instructions. Hand it in with `swarm_submit` (worker or builder) or `swarm_decompose` (scout).',
      '3. Call `swarm_next` again, and keep going. When it says there is nothing to do right now, guards are verifying: call it again. Stop when it says the hive is complete.',
      '4. At the end, call `swarm_journal` and `swarm_status`, and summarise what you did in a few lines.',
      '',
      'Rules:',
      '- Use only the kickswarm tools. Do not create or edit files in this folder.',
      '- Do not ask the human for help or approval: decide alone, as the cell instructions say.',
      '- If a hand-in is refused, read the reason, fix your work and hand it in again.',
      '',
    ].join('\n'),
    'utf8',
  );
  return { dossier, command, args, env };
}

/** Starts the plugin exactly as the bee folder configures it, lists its tools and joins the hive. */
async function smokeTest(cfg: { command: string; args: string[]; env: Record<string, string> }): Promise<string> {
  const client = new Client({ name: 'kickswarm-trial-check', version: '1.0.0' });
  await client.connect(new StdioClientTransport({ command: cfg.command, args: cfg.args, env: { ...getDefaultEnvironment(), ...cfg.env }, stderr: 'ignore' }));
  try {
    const tools = (await client.listTools()).tools.map((t) => t.name);
    if (!tools.includes('swarm_next')) throw new Error(`the plugin exposes no swarm_next (got ${tools.join(', ')})`);
    const r = (await client.callTool({ name: 'swarm_join', arguments: { ruche: TRIAL_SLUG } })) as { content: Array<{ text: string }> };
    const text = r.content.map((c) => c.text).join(' ');
    if (!/You joined/.test(text)) throw new Error(`swarm_join answered: ${text.slice(0, 200)}`);
    return `${tools.length} tools, swarm_join OK`;
  } finally {
    await client.close();
  }
}

/** A readable line for the registry entries worth following. */
function describe(e: RegistryEntry, short: (id: unknown) => string): string | null {
  const d = e.donnees as Record<string, unknown>;
  const cell = d.chemin !== undefined ? `cell ${String(d.chemin)}` : '';
  switch (e.nature) {
    case 'decoupage_propose': return `scout ${short(d.auteur)} proposed a split of ${cell} into ${String(d.enfants)} cells`;
    case 'decoupage_adopte': return `split of ${cell} adopted: ${(d.enfants as unknown[]).length} new cells`;
    case 'resultat_soumis': return `${short(d.auteur)} delivered ${cell} (automatic check: ${String(d.verification_auto)})`;
    case 'alveole_rejetee': return `${cell} rejected: ${String(d.motif).slice(0, 160)}`;
    case 'alveole_miel': return `${cell} is honey: ${(d.gardiennes as unknown[]).length} guards, P(false) = ${String(d.p_faux ?? '–')}`;
    case 'escalade': return `${cell} escalated to the hive owner: ${String(d.motif)}`;
    case 'ruche_terminee': return `hive complete: ${String(d.miel_total)} g of honey`;
    default: return null;
  }
}

export async function trial(opts: TrialOptions): Promise<TrialRun> {
  const log = opts.log ?? console.log;
  const sortie = resolve(opts.sortie ?? join(PROJECT, 'essai'));
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const dossier = join(sortie, 'runs', stamp);
  const founder = loadOrCreateIdentity(join(dossier, 'fondateur')).identite;
  const coord = new Coordinator({
    fondateur: founder.id,
    dataDir: join(dossier, 'data'),
    params: { alpha_faux: 0.01, taux_pieges: 0.1, ...opts.params },
    ...(opts.beacon ? { balise: new DrandHttp() } : {}),
  });
  const server = createCoordinatorServer(coord);
  await new Promise<void>((r) => server.listen(opts.port, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

  coord.proposeHive(makeHive(founder, { slug: TRIAL_SLUG, nom: 'Text toolkit', objectif: TEXT_ROOT.objectif }), TEXT_ROOT);
  coord.decide(makeDecision(founder, 'approbation_ruche', TRIAL_SLUG, 'Trial hive: small, open, testable'));
  const bee = prepareBee(sortie, url);

  const noms = new Map<string, string>([[founder.id, 'owner']]);
  const short = (id: unknown) => noms.get(String(id)) ?? (String(id).includes(':') ? `${String(id).split(':')[0]}:${String(id).split(':')[1]!.slice(0, 6)}` : String(id).slice(0, 14));
  const t0 = Date.now();
  const stamped = (s: string) => log(`  [${String(Math.round((Date.now() - t0) / 1000)).padStart(4)} s] ${s}`);

  // Approval of splits: automatic for this trial (a real hive owner decides by hand).
  // The registry announces entries inside the command that writes them: act just after it, never during.
  const off = coord.registry.onAppend((e) => {
    setTimeout(() => {
      if (coord.registry.entries[e.seq]?.hash !== e.hash) return; // rolled back
      const line = describe(e, short);
      if (line) stamped(line);
      if (e.nature === 'decoupage_propose') {
        try {
          coord.decide(makeDecision(founder, 'approbation_decoupage', String((e.donnees as { id: string }).id), 'Approved automatically for this trial'));
          stamped('owner approved the split (automatic for this trial)');
        } catch (err) {
          stamped(`could not approve the split: ${(err as Error).message}`);
        }
      }
    }, 0);
  });

  log('\n🐝  KICKSWARM · trial with a real AI');
  log(`   Coordinator: ${url}   ·   live hive: ${url}/hive`);
  log(`   Hive “${TRIAL_SLUG}”: ${TEXT_ROOT.objectif}`);
  log(`   Registry and state of this run: ${dossier}`);
  log(`   Random draws: ${opts.beacon ? 'public drand beacon' : 'local'}   ·   target error rate: 1% per cell`);

  let fini = false;
  const terminee = () => coord.hiveView(TRIAL_SLUG).statut === 'terminee';
  const enVerification = () => coord.hiveView(TRIAL_SLUG).alveoles.some((c) => c.etat === 'en_verification');
  const pace = opts.pace ?? 1500;

  // Helper guards: they only verify, and only when something awaits verification.
  const guards: HiveAccess[] = Array.from({ length: opts.guards ?? 4 }, (_, i) => {
    const id = generateIdentity();
    noms.set(id.id, `guard-${i + 1}`);
    return httpAccess(new CoordinatorClient(url, id), TRIAL_SLUG);
  });
  const loops: Promise<void>[] = guards.map(async (g, i) => {
    await sleep(i * 200);
    while (!fini) {
      try {
        if (g.sealed.length || enVerification()) {
          const a = await helperGuard(g);
          if (a) stamped(`${noms.get(g.identite.id)} ${a.outcome.replace(/_/g, ' ')} on cell ${a.chemin}`);
        }
      } catch (err) {
        stamped(`${noms.get(g.identite.id)}: ${(err as Error).message}`);
      }
      await sleep(pace * (0.6 + Math.random() * 0.8));
    }
  });

  if (opts.rehearse) {
    log('\n   Dress rehearsal: a scripted bee plays the AI.\n');
    if (opts.smoke ?? true) {
      if (existsSync(bee.args[0]!)) {
        try {
          stamped(`bee folder check: the plugin starts as configured (${await smokeTest(bee)})`);
        } catch (err) {
          stamped(`bee folder check FAILED: ${(err as Error).message}`);
          throw err;
        }
      } else stamped('bee folder check skipped: run “npm run build” first');
    }
    const ia = generateIdentity();
    noms.set(ia.id, 'scripted-ai');
    const access = httpAccess(new CoordinatorClient(url, ia), TRIAL_SLUG);
    loops.push(
      (async () => {
        while (!fini) {
          try {
            await scriptedBee(access, TEXT_SCRIPT);
          } catch (err) {
            stamped(`scripted-ai: ${(err as Error).message}`);
          }
          await sleep(pace / 2);
        }
      })(),
    );
  } else {
    log('\n   Now open a new session in the Claude app (Code tab), in this folder:');
    log(`     ${bee.dossier}`);
    log('   accept the “kickswarm” MCP server if asked, and say:');
    log('     “Join the hive and work until it is complete.”');
    log('   Press Ctrl+C here to stop the trial.\n');
  }

  const done = (async () => {
    while (!terminee()) await sleep(500);
    const report = await auditRegistry(coord.registry.entries, { etatAnnonce: coord.stateHash() });
    log(`\n${report.ok ? '✓ AUDIT PASSED' : '✗ AUDIT FAILED'}: ${report.commandes} commands replayed`);
    for (const c of report.controles) log(`  ${c.ok ? '✓' : '✗'} ${c.nom}${c.detail ? ` — ${c.detail}` : ''}`);
    log(`\nCheck it yourself at any time:  node dist/cli.js audit --data "${join(dossier, 'data')}"`);
    return { ok: report.ok };
  })();

  const stop = async () => {
    fini = true;
    off();
    await Promise.allSettled(loops);
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  };
  return { url, server, dossier, abeille: bee.dossier, done, stop };
}
