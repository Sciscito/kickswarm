#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { auditRegistry } from './coordinator/audit.js';
import { Coordinator } from './coordinator/coordinator.js';
import type { RegistryEntry } from './coordinator/registry.js';
import { createCoordinatorServer } from './coordinator/http.js';
import { demo } from './demo.js';
import { joinHive } from './install.js';
import { liveDemo } from './live-demo.js';
import { makeDecision, makeHive } from './protocol/builders.js';
import { isContributorId } from './protocol/identity.js';
import type { CellSpec, DecisionNature } from './protocol/types.js';
import { CoordinatorClient } from './plugin/client.js';
import { kickswarmHome, loadOrCreateIdentity } from './plugin/identite.js';
import { JournalLocal, resumer } from './plugin/journal.js';
import { startPlugin } from './plugin/server.js';
import { resolveSandbox } from './verifier/v0.js';

const HELP = `kickswarm · Open Swarm Protocol v0.1

  kickswarm join <hive> [--url <coordinator>] [--yes]   Send your AI into a hive (one command)
  kickswarm demo live [--port 7777] [--bees 6] [--speed 1]   Live hive demo in your browser
  kickswarm demo                                        End-to-end demo in the terminal
  kickswarm coordinator [--port 7777] [--host 127.0.0.1] [--data ./data] [--founder <id>] [--sandbox auto|container|process]
  kickswarm plugin [--url <coordinator>]                MCP server for your agent (stdio)
  kickswarm identity                                    Show (and create if needed) your identity
  kickswarm journal [--n 20] [--full] [--verify]        Everything your AI did for the swarm, on this machine
  kickswarm hives [--url ...]                           List hives
  kickswarm propose <hive.json> [--url ...]             Propose a hive (slug, nom, objectif, racine)
  kickswarm decide <nature> <target> <reason> [--multiplier n] [--url ...]
  kickswarm audit [--data ./data | --file registre.jsonl | --url ...] [--reverify]   Replay the public registry and check everything

Default coordinator: $KICKSWARM_URL or http://127.0.0.1:7777
Identity: $KICKSWARM_HOME/identite.json (default ~/.kickswarm)`;

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

function parse(argv: string[]): { pos: string[]; opts: Record<string, string> } {
  const pos: string[] = [];
  const opts: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (!a.startsWith('--')) pos.push(a);
    else if (argv[i + 1] === undefined || argv[i + 1]!.startsWith('--')) opts[a.slice(2)] = '';
    else opts[a.slice(2)] = argv[++i]!;
  }
  return { pos, opts };
}

async function main(): Promise<void> {
  const { pos, opts } = parse(process.argv.slice(2));
  const url = opts.url ?? process.env.KICKSWARM_URL ?? 'http://127.0.0.1:7777';
  const client = () => new CoordinatorClient(url, loadOrCreateIdentity().identite);

  switch (pos[0]) {
    case 'join': {
      if (!pos[1]) throw new Error('Usage: kickswarm join <hive> [--url <coordinator>]');
      return joinHive(pos[1], { url, yes: opts.yes !== undefined });
    }
    case 'identity':
    case 'identite': {
      const { identite, fichier, creee } = loadOrCreateIdentity();
      console.log(`${creee ? 'New identity' : 'Identity'}: ${identite.id}\nFile: ${fichier} (never share it)`);
      return;
    }
    case 'coordinator':
    case 'coordinateur': {
      const founder = opts.founder ?? opts.fondateur ?? loadOrCreateIdentity().identite.id;
      if (!isContributorId(founder)) throw new Error('--founder must be an ed25519:… identity');
      const port = Number(opts.port ?? 7777);
      const host = opts.host ?? opts.hote ?? '127.0.0.1';
      const dataDir = resolve(opts.data ?? opts.donnees ?? 'data');
      process.env.KICKSWARM_SANDBOX = opts.sandbox || process.env.KICKSWARM_SANDBOX || 'auto';
      const sandbox = resolveSandbox();
      if (!LOCAL_HOSTS.has(host) && sandbox !== 'container' && opts.unsafe === undefined) {
        throw new Error(
          'Refusing to expose a coordinator beyond this machine without the container sandbox (the process sandbox does not cut the network). Install Docker or Podman, or pass --unsafe on a network you fully trust.',
        );
      }
      const coord = new Coordinator({ fondateur: founder, dataDir });
      createCoordinatorServer(coord).listen(port, host, () => {
        console.log(`OSP v0.1 coordinator on http://${host}:${port}`);
        console.log(`Live hive: http://${host}:${port}/hive`);
        console.log(`Founder: ${founder}\nData: ${dataDir}\nSandbox: ${sandbox}${sandbox === 'process' ? ' (network not cut: keep this coordinator private)' : ''}`);
      });
      return;
    }
    case 'plugin':
      return startPlugin(url);
    case 'hives':
    case 'ruches': {
      for (const h of await client().hives()) console.log(`${h.slug.padEnd(24)} ${h.statut.padEnd(10)} ${h.progression.miel}/${h.progression.total}  ${h.nom}`);
      return;
    }
    case 'propose':
    case 'ruche': {
      if (!pos[1]) throw new Error('Give the hive JSON file');
      const def = JSON.parse(readFileSync(pos[1], 'utf8')) as { slug: string; nom: string; objectif: string; racine: CellSpec };
      const c = client();
      await c.proposeHive(makeHive(c.identite, def), def.racine);
      console.log(`Hive “${def.slug}” proposed. It starts when the founder approves it.`);
      return;
    }
    case 'decide':
    case 'decider': {
      const [, nature, cible, ...motif] = pos;
      if (!nature || !cible || !motif.length) throw new Error('Usage: kickswarm decide <nature> <target> <reason>');
      const c = client();
      const m = opts.multiplier ?? opts.multiplicateur;
      const r = await c.decide(makeDecision(c.identite, nature as DecisionNature, cible, motif.join(' '), m ? { multiplicateur: Number(m) } : undefined));
      console.log(`Decision written to the public registry: ${r.decision}`);
      return;
    }
    case 'journal': {
      const j = new JournalLocal(kickswarmHome());
      if (opts.verify !== undefined) {
        const v = j.verifier();
        console.log(v.ok ? `Journal intact: ${j.fichier}` : `Journal ALTERED: ${v.erreur}`);
        process.exitCode = v.ok ? 0 : 1;
        return;
      }
      const entries = j.dernieres(Number(opts.n ?? 20));
      if (!entries.length) console.log('Your local journal is empty: your AI has not worked for the swarm yet.');
      for (const e of entries) console.log(opts.full !== undefined ? JSON.stringify(e, null, 2) : resumer(e));
      return;
    }
    case 'audit': {
      let entries: RegistryEntry[];
      let announced: string | undefined;
      let source: string;
      const file = opts.file ?? (opts.url === undefined ? join(resolve(opts.data ?? 'data'), 'registre.jsonl') : undefined);
      if (file && existsSync(file)) {
        source = file;
        entries = readFileSync(file, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l) as RegistryEntry);
      } else {
        // State hash first, then the registry cut at the same entry: the live hive keeps moving.
        const head = (await (await fetch(new URL('/v0/state-hash', url))).json()) as { seq: number; etat: string };
        const all = (await (await fetch(new URL('/v0/registry', url))).json()) as RegistryEntry[];
        entries = all.slice(0, head.seq + 1);
        announced = head.etat;
        source = url;
      }
      console.log(`\nAuditing ${entries.length} registry entries from ${source}${opts.reverify !== undefined ? ', re-running every verification' : ''}…\n`);
      const report = await auditRegistry(entries, { reverifier: opts.reverify !== undefined, etatAnnonce: announced as `sha256:${string}` | undefined });
      for (const c of report.controles) console.log(`  ${c.ok ? '✓' : '✗'} ${c.nom}${c.detail ? `\n      ${c.detail}` : ''}`);
      console.log(`\n${report.ok ? 'AUDIT PASSED' : 'AUDIT FAILED'}: ${report.commandes} commands replayed${report.etat ? `, state ${report.etat}` : ''}\n`);
      process.exitCode = report.ok ? 0 : 1;
      return;
    }
    case 'demo': {
      if (pos[1] === 'live' || opts.live !== undefined) {
        await liveDemo({ port: Number(opts.port ?? 7777), bees: Number(opts.bees ?? 6), speed: Number(opts.speed ?? 1) });
        return;
      }
      const ok = await demo();
      process.exitCode = ok ? 0 : 1;
      return;
    }
    default:
      console.log(HELP);
  }
}

main().catch((e: unknown) => {
  console.error(`Error: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
});
