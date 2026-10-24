#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { auditRegistry } from './coordinator/audit.js';
import { DrandHttp, QUICKNET, tourA, type SourceBalise } from './coordinator/balise.js';
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
import { appliquerOptions, chargerParticipation, decrire, enregistrerParticipation, type OptionsParticipation } from './plugin/participation.js';
import { startPlugin } from './plugin/server.js';
import { trial } from './trial.js';
import { resolveSandbox } from './verifier/v0.js';

const HELP = `kickswarm · Open Swarm Protocol v0.1

  kickswarm join <hive> [--url <coordinator>] [--yes] [--preset full|light|night]   Send your AI into a hive (one command)
  kickswarm settings [--preset ...] [--roles ...] [--per-day n] [--quiet 23-7|off] [--pause|--resume]   How your bee takes part
  kickswarm demo live [--port 7777] [--bees 6] [--speed 1] [--beacon none|drand]   Live hive demo in your browser
  kickswarm demo                                        End-to-end demo in the terminal
  kickswarm trial [--port 7777] [--guards 4] [--beacon none|drand] [--rehearse]   First run with a real AI (see docs/trial.md)
  kickswarm coordinator [--port 7777] [--host 127.0.0.1] [--data ./data] [--founder <id>] [--sandbox wasm|container|process] [--beacon drand|none]
  kickswarm plugin [--url <coordinator>]                MCP server for your agent (stdio)
  kickswarm identity                                    Show (and create if needed) your identity
  kickswarm journal [--n 20] [--full] [--verify]        Everything your AI did for the swarm, on this machine
  kickswarm hives [--url ...]                           List hives
  kickswarm propose <hive.json> [--url ...]             Propose a hive (slug, nom, objectif, racine)
  kickswarm decide <nature> <target> <reason> [--multiplier n] [--url ...]
  kickswarm audit [--data ./data | --file registre.jsonl | --url ...] [--reverify]   Replay the public registry and check everything

Default coordinator: $KICKSWARM_URL or http://127.0.0.1:7777
Identity: $KICKSWARM_HOME/identite.json (default ~/.kickswarm)`;

const SETTINGS_HELP = `How your bee takes part (saved on this machine, applied before every task):

  --preset full     Every role, up to 20 tasks a day (the default)
  --preset light    Only verify other bees' work: your machine replays the tests, almost no AI usage
  --preset night    Every role, only from 22:00 to 08:00
  --roles scout,worker,builder,guard   The roles your AI accepts
  --per-day 20      At most this many tasks a day (0: no limit)
  --quiet 23-7      Rest from 23:00 to 07:00 (off: never rest)
  --pause / --resume`;

/** The participation options of the command line (a hive joined is remembered too). */
function participationOptions(opts: Record<string, string>, ruche?: string): OptionsParticipation {
  return {
    ...(opts.preset !== undefined ? { preset: opts.preset } : {}),
    ...(opts.roles !== undefined ? { roles: opts.roles } : {}),
    ...(opts['per-day'] !== undefined ? { perDay: opts['per-day'] } : {}),
    ...(opts.quiet !== undefined ? { quiet: opts.quiet } : {}),
    ...(opts.pause !== undefined ? { pause: true } : {}),
    ...(opts.resume !== undefined ? { resume: true } : {}),
    ...(ruche ? { ruche } : {}),
  };
}

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
      if (!pos[1]) throw new Error('Usage: kickswarm join <hive> [--url <coordinator>] [--preset full|light|night] [--roles ...] [--per-day n] [--quiet 23-7]');
      // How you take part: the default request, or a preset, or your own options.
      const home = kickswarmHome();
      const p = appliquerOptions(chargerParticipation(home), participationOptions(opts, pos[1]));
      enregistrerParticipation(home, p);
      console.log(`\nHow your bee takes part: ${decrire(p)}\n   Change it at any time: kickswarm settings --help`);
      return joinHive(pos[1], { url, yes: opts.yes !== undefined });
    }
    case 'settings':
    case 'participation': {
      const home = kickswarmHome();
      if (opts.help !== undefined) {
        console.log(SETTINGS_HELP);
        return;
      }
      const avant = chargerParticipation(home);
      const apres = appliquerOptions(avant, participationOptions(opts));
      const change = JSON.stringify(avant) !== JSON.stringify(apres);
      if (change) enregistrerParticipation(home, apres);
      console.log(`${change ? 'Saved. ' : ''}How your bee takes part: ${decrire(apres)}`);
      if (apres.ruches.length) console.log(`Hives joined: ${apres.ruches.join(', ')}`);
      if (!change) console.log('Options: kickswarm settings --help');
      return;
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
      if (!LOCAL_HOSTS.has(host) && sandbox === 'process' && opts.unsafe === undefined) {
        throw new Error(
          'Refusing to expose a coordinator beyond this machine with the process sandbox (it does not cut the network). Use the default WebAssembly sandbox or a container, or pass --unsafe on a network you fully trust.',
        );
      }
      // Random draws come from drand by default: nobody, not even the coordinator, chooses them.
      let balise: SourceBalise | undefined;
      const beacon = opts.beacon || 'drand';
      if (beacon === 'drand') {
        balise = new DrandHttp();
        try {
          await balise.get(tourA(QUICKNET, Date.now()));
        } catch (e) {
          throw new Error(`The drand beacon is unreachable (${(e as Error).message}). Fix the network, or pass --beacon none to let the coordinator draw by itself (draws then become unverifiable).`);
        }
      } else if (beacon !== 'none') throw new Error('--beacon must be drand or none');
      const coord = new Coordinator({ fondateur: founder, dataDir, balise });
      createCoordinatorServer(coord).listen(port, host, () => {
        console.log(`OSP v0.1 coordinator on http://${host}:${port}`);
        console.log(`Live hive: http://${host}:${port}/hive`);
        console.log(`Founder: ${founder}\nData: ${dataDir}\nSandbox: ${sandbox}${sandbox === 'process' ? ' (network not cut: keep this coordinator private)' : ''}`);
        console.log(`Random draws: ${balise ? 'public drand beacon (League of Entropy, quicknet), verifiable by anyone' : 'drawn by the coordinator itself (not verifiable)'}`);
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
      let embargo = 0;
      const file = opts.file ?? (opts.url === undefined ? join(resolve(opts.data ?? 'data'), 'registre.jsonl') : undefined);
      if (file && existsSync(file)) {
        source = file;
        entries = readFileSync(file, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l) as RegistryEntry);
      } else {
        // State hash first, then the registry cut at the same entry: the live hive keeps moving.
        // Entries still under embargo (open verifications) come later; the head hash already commits to them.
        const head = (await (await fetch(new URL('/v0/state-hash', url))).json()) as { seq: number; etat: string | null; tete?: { seq: number } | null };
        const all = (await (await fetch(new URL('/v0/registry', url))).json()) as RegistryEntry[];
        entries = all.slice(0, head.seq + 1);
        announced = head.etat ?? undefined;
        source = url;
        if (head.tete && head.tete.seq > head.seq) embargo = head.tete.seq - head.seq;
      }
      console.log(`\nAuditing ${entries.length} registry entries from ${source}${opts.reverify !== undefined ? ', re-running every verification' : ''}…\n`);
      const report = await auditRegistry(entries, { reverifier: opts.reverify !== undefined, etatAnnonce: announced as `sha256:${string}` | undefined });
      for (const c of report.controles) console.log(`  ${c.ok ? '✓' : '✗'} ${c.nom}${c.detail ? `\n      ${c.detail}` : ''}`);
      console.log(`\n${report.ok ? 'AUDIT PASSED' : 'AUDIT FAILED'}: ${report.commandes} commands replayed${report.etat ? `, state ${report.etat}` : ''}`);
      if (embargo) console.log(`${embargo} newer entr${embargo > 1 ? 'ies are' : 'y is'} still under embargo while verifications are open; audit again later to cover them.`);
      console.log('');
      process.exitCode = report.ok ? 0 : 1;
      return;
    }
    case 'trial':
    case 'essai': {
      const run = await trial({
        port: Number(opts.port ?? 7777),
        beacon: opts.beacon === 'drand',
        guards: Number(opts.guards ?? 4),
        rehearse: opts.rehearse !== undefined,
      });
      const { ok } = await run.done;
      if (opts.rehearse !== undefined) {
        await run.stop();
        process.exitCode = ok ? 0 : 1;
        return;
      }
      console.log(`\nThe hive is complete. The live hive stays open at ${run.url}/hive — press Ctrl+C to stop.`);
      return;
    }
    case 'demo': {
      if (pos[1] === 'live' || opts.live !== undefined) {
        await liveDemo({ port: Number(opts.port ?? 7777), bees: Number(opts.bees ?? 6), speed: Number(opts.speed ?? 1), beacon: opts.beacon === 'drand' });
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
