#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { pontUneFois, suivrePont, type PontRapport } from './bridge/pont.js';
import { AIDE_MOTEUR, commandeAbeille, commandeMoteur } from './moteur/cli.js';
import { lancerProjet, PROJETS } from './exemples/lancement/index.js';
import { verifierCommit } from './bridge/verifier.js';
import { auditRegistry } from './coordinator/audit.js';
import { DrandHttp, QUICKNET, tourA, type SourceBalise } from './coordinator/balise.js';
import { Coordinator } from './coordinator/coordinator.js';
import type { RegistryEntry } from './coordinator/registry.js';
import { Garde } from './coordinator/garde.js';
import { createCoordinatorServer } from './coordinator/http.js';
import { Hote } from './coordinator/hote.js';
import { demo } from './demo.js';
import { joinHive } from './install.js';
import { liveDemo } from './live-demo.js';
import { makeAdhesion, makeDecision, makeHive, makeInvitation, makeLienGithub } from './protocol/builders.js';
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
  kickswarm coordinator --public [--port 7777] [--data /srv/kickswarm] [--launch all|none|<project>,…]   Open to everyone, behind Caddy (see docs/deploy.md)
  kickswarm plugin [--url <coordinator>]                MCP server for your agent (stdio)
  kickswarm identity                                    Show (and create if needed) your identity
  kickswarm journal [--n 20] [--full] [--verify]        Everything your AI did for the swarm, on this machine
  kickswarm hives [--url ...]                           List hives
  kickswarm propose <hive.json> [--url ...]             Propose a hive (slug, nom, objectif, racine)
  kickswarm decide <nature> <target> <reason> [--multiplier n] [--url ...]
  kickswarm audit [--data ./data | --file registre.jsonl | --url ...] [--hive <private id>] [--clone <path>] [--reverify]   Replay a registry and check everything
  kickswarm private create <hive.json> [--alpha 0.05] [--guards 1]   Create a private hive, by invitation only
  kickswarm private invite <id> [--role member|observer] [--uses 1] [--days 14]
  kickswarm private members <id>  ·  private role <id> <member> member|observer <reason> [--no-guard]
  kickswarm private remove <id> <member> <reason>  ·  private revoke <id> <invitation> <reason>  ·  private leave <id>
  kickswarm join --invite <code>                       Join a private hive with an invitation code
  kickswarm engine [add|remove|set|serve] …            The local engine: your free AI keys and local models, for you first (see kickswarm engine --help)
  kickswarm bee [--hive <slug>]                         Put the local engine to work for the swarm, with your personal endpoint
  kickswarm launch <project>                            Open a prepared project (see docs/projets.md): ${Object.keys(PROJETS).join(', ')}
  kickswarm bridge <hive> --clone <path> [--remote origin] [--base main] [--per-cell] [--no-pr] [--once]
                                                        Turn honey into commits and pull requests, with your own git and gh
  kickswarm github <your GitHub name> [--hive <id>]     Link your GitHub name, to be credited as co-author
  kickswarm settings --clone <repository url>=<path>    Where your clone of a hive's repository is

Default coordinator: $KICKSWARM_URL or http://127.0.0.1:7777
Identity: $KICKSWARM_HOME/identite.json (default ~/.kickswarm)`;

const SETTINGS_HELP = `How your bee takes part (saved on this machine, applied before every task):

  --preset full     Every role, up to 20 tasks a day (the default)
  --preset light    Only verify other bees' work: your machine replays the tests, almost no AI usage
  --preset night    Every role, only from 22:00 to 08:00
  --roles scout,worker,builder,guard   The roles your AI accepts
  --per-day 20      At most this many tasks a day (0: no limit)
  --quiet 23-7      Rest from 23:00 to 07:00 (off: never rest)
  --pause / --resume
  --clone https://github.com/me/game=C:\dev\game   Your local clone of a hive's repository (empty path: forget it)`;

/** "<url>=<path>", with the path made absolute: the plugin runs from another folder. */
function cloneOption(v: string): string {
  const i = v.indexOf('=');
  const chemin = v.slice(i + 1).trim();
  return `${v.slice(0, i)}=${chemin ? resolve(chemin) : ''}`;
}

/** The participation options of the command line (a hive joined is remembered too). */
function participationOptions(opts: Record<string, string>, ruche?: string): OptionsParticipation {
  return {
    ...(opts.preset !== undefined ? { preset: opts.preset } : {}),
    ...(opts.roles !== undefined ? { roles: opts.roles } : {}),
    ...(opts['per-day'] !== undefined ? { perDay: opts['per-day'] } : {}),
    ...(opts.quiet !== undefined ? { quiet: opts.quiet } : {}),
    ...(opts.pause !== undefined ? { pause: true } : {}),
    ...(opts.resume !== undefined ? { resume: true } : {}),
    ...(opts.clone !== undefined && opts.clone.includes('=') ? { clone: cloneOption(opts.clone) } : {}),
    ...(ruche ? { ruche } : {}),
  };
}

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

/** `kickswarm private …`: create a private hive, invite, manage members (OSP v0.3 §2). */
async function commandePrivee(args: string[], opts: Record<string, string>, c: CoordinatorClient): Promise<void> {
  const [action, id, ...reste] = args;
  const raison = (mots: string[]) => {
    if (!mots.length) throw new Error('Every decision states its reason: add it at the end of the command');
    return mots.join(' ');
  };
  switch (action) {
    case 'create': {
      if (!id) throw new Error('Usage: kickswarm private create <hive.json> [--alpha 0.05] [--guards 1]');
      const def = JSON.parse(readFileSync(id, 'utf8')) as { slug: string; nom: string; objectif: string; racine: CellSpec };
      const parametres = {
        ...(opts.alpha !== undefined ? { alpha_faux: Number(opts.alpha) } : {}),
        ...(opts.guards !== undefined ? { gardiennes_v0: Number(opts.guards) } : {}),
      };
      const ruche = makeHive(c.identite, { ...def, privee: true, ...(Object.keys(parametres).length ? { parametres } : {}) });
      const r = await c.creerRuchePrivee(ruche, def.racine, makeDecision(c.identite, 'approbation_ruche', def.slug, 'Private hive created by its owner'));
      console.log(`Private hive “${r.slug}” created. Its identifier: ${r.id}`);
      console.log(`Invite someone: kickswarm private invite ${r.id}`);
      console.log('What "private" means: hidden from the public, not from whoever runs this coordinator (it runs the tests). For full privacy, run your own coordinator.');
      return;
    }
    case 'invite': {
      if (!id) throw new Error('Usage: kickswarm private invite <id> [--role member|observer] [--uses 1] [--days 14]');
      c.utiliserRuchePrivee(id);
      const role = opts.role === 'observer' ? 'observateur' : 'membre';
      const { invitation, code } = makeInvitation(c.identite, id, { role, utilisations: Number(opts.uses ?? 1), joursValidite: Number(opts.days ?? 14) });
      await c.inviter(invitation);
      console.log(`Invitation code: ${code}`);
      console.log(`Valid until ${new Date(invitation.expire).toLocaleString('en-GB')}, ${invitation.utilisations_max} use(s), as ${role === 'membre' ? 'a member' : 'an observer'}.`);
      console.log(`They join with:  kickswarm join --invite ${code} --url ${c.url}`);
      console.log(`Or with this link (the code stays in the browser):  ${c.url.replace(/\/$/, '')}/join#invite=${code}`);
      return;
    }
    case 'members': {
      if (!id) throw new Error('Usage: kickswarm private members <id>');
      c.utiliserRuchePrivee(id);
      for (const m of await c.membres()) console.log(`${m.role.padEnd(12)} ${m.gardienne ? 'guard   ' : '        '} ${m.id}  (since ${m.depuis.slice(0, 10)})`);
      return;
    }
    case 'role':
    case 'remove':
    case 'revoke':
    case 'leave': {
      if (!id) throw new Error(`Usage: kickswarm private ${action} <id> …`);
      c.utiliserRuchePrivee(id);
      let d;
      if (action === 'leave') d = makeDecision(c.identite, 'depart', c.identite.id, opts.reason ?? 'Leaving the hive');
      else if (action === 'remove') d = makeDecision(c.identite, 'role_retire', reste[0] ?? '', raison(reste.slice(1)));
      else if (action === 'revoke') d = makeDecision(c.identite, 'invitation_revoquee', reste[0] ?? '', raison(reste.slice(1)));
      else {
        const role = reste[1] === 'observer' ? 'observateur' : reste[1] === 'member' ? 'membre' : undefined;
        if (!reste[0] || !role) throw new Error('Usage: kickswarm private role <id> <member> member|observer <reason> [--no-guard]');
        d = makeDecision(c.identite, 'role_attribue', reste[0], raison(reste.slice(2)), { role, gardienne: opts['no-guard'] === undefined });
      }
      const r = await c.decide(d);
      console.log(`Decision written to the private hive's registry: ${r.decision}`);
      return;
    }
    default:
      throw new Error('Usage: kickswarm private create|invite|members|role|remove|revoke|leave …');
  }
}

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
      let ruche = pos[1];
      // OSP v0.3 §2.2: a private hive is joined with the code of an invitation.
      if (opts.invite) {
        const c = client();
        const r = await c.rejoindreAvecCode(makeAdhesion(c.identite, opts.invite));
        console.log(`\nYou joined the private hive “${r.slug}” as ${r.role === 'observateur' ? 'an observer' : 'a member'}. Its identifier: ${r.id}`);
        ruche = r.id;
      }
      if (!ruche) throw new Error('Usage: kickswarm join <hive> [--url <coordinator>] [--preset full|light|night] [--roles ...] [--per-day n] [--quiet 23-7], or kickswarm join --invite <code>');
      // How you take part: the default request, or a preset, or your own options.
      const home = kickswarmHome();
      const p = appliquerOptions(chargerParticipation(home), participationOptions(opts, ruche));
      enregistrerParticipation(home, p);
      console.log(`\nHow your bee takes part: ${decrire(p)}\n   Change it at any time: kickswarm settings --help`);
      return joinHive(ruche, { url, yes: opts.yes !== undefined, ...(opts.autostart !== undefined ? { autostart: true } : {}), moteur: opts['no-engine'] === undefined });
    }
    case 'private':
    case 'privee':
      return commandePrivee(pos.slice(1), opts, client());
    case 'engine':
    case 'moteur':
      if (opts.help !== undefined) return void console.log(AIDE_MOTEUR);
      return commandeMoteur(kickswarmHome(), url, pos.slice(1), opts);
    case 'bee':
    case 'abeille':
      return commandeAbeille(kickswarmHome(), url, opts);
    case 'launch':
    case 'lancer': {
      const p = PROJETS[pos[1] ?? ''];
      if (!p) throw new Error(`Usage: kickswarm launch <project>. Projects: ${Object.keys(PROJETS).join(', ')} (see docs/projets.md)`);
      const r = await lancerProjet(client(), p, (l) => console.log(l));
      if (r.cellules) console.log(`
“${p.nom}” is open: ${r.cellules} cells. Its dashboard: ${url.replace(/\/$/, '')}/project/${p.slug}`);
      return;
    }
    case 'bridge':
    case 'pont': {
      // OSP v0.3 §3.3: runs here, with this member's own git and gh. The coordinator never sees a token.
      const ruche = pos[1];
      if (!ruche || !opts.clone) throw new Error('Usage: kickswarm bridge <hive> --clone <path> [--remote origin] [--base main] [--per-cell] [--no-pr] [--once] [--every 30]');
      const c = client();
      if (/^p[0-9a-f]{32}$/.test(ruche)) c.utiliserRuchePrivee(ruche);
      const o = {
        client: c,
        identite: c.identite,
        clone: resolve(opts.clone),
        remote: opts.remote || 'origin',
        base: opts.base || 'main',
        parCellule: opts['per-cell'] !== undefined,
        ...(opts['no-pr'] !== undefined ? { forge: null } : {}),
        log: (l: string) => console.log(`[bridge] ${l}`),
      };
      if (opts.once !== undefined) {
        const r: PontRapport = await pontUneFois(o);
        for (const i of r.ignorees) console.log(`[bridge] Skipped cell ${i.chemin}: ${i.raison}`);
        console.log(`[bridge] ${r.commits.length} commit(s), ${r.fusions.length} merge(s) recorded.`);
        return;
      }
      console.log(`[bridge] Following ${ruche} into ${o.clone}. Ctrl+C to stop.`);
      return suivrePont({ ...o, intervalleMs: Number(opts.every ?? 30) * 1000 });
    }
    case 'github': {
      const login = pos[1];
      if (!login) throw new Error('Usage: kickswarm github <your GitHub name> [--hive <private id>]');
      const c = client();
      if (opts.hive) c.utiliserRuchePrivee(opts.hive);
      const r = await c.lienGithub(makeLienGithub(c.identite, login));
      console.log(`Linked: commits from your honey will credit ${r.github} as co-author.`);
      return;
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
      const publique = opts.public !== undefined;
      const moi = loadOrCreateIdentity().identite;
      const founder = opts.founder ?? opts.fondateur ?? moi.id;
      if (!isContributorId(founder)) throw new Error('--founder must be an ed25519:… identity');
      const port = Number(opts.port ?? 7777);
      // Public mode listens on this machine only: Caddy, in front, brings HTTPS and relays the visitors.
      const host = opts.host ?? opts.hote ?? '127.0.0.1';
      const dataDir = resolve(opts.data ?? opts.donnees ?? 'data');
      process.env.KICKSWARM_SANDBOX = opts.sandbox || process.env.KICKSWARM_SANDBOX || 'auto';
      const sandbox = resolveSandbox();
      if ((publique || !LOCAL_HOSTS.has(host)) && sandbox === 'process' && opts.unsafe === undefined) {
        throw new Error(
          'Refusing to expose a coordinator beyond this machine with the process sandbox (it does not cut the network). Use the default WebAssembly sandbox or a container, or pass --unsafe on a network you fully trust.',
        );
      }
      if (publique) {
        if (opts.beacon === 'none') throw new Error('A public coordinator draws with the public drand beacon: --beacon none is for private tests');
        // Nobody tests the network before everyone comes in: it tests itself, end to end, before it opens.
        console.log('Self-check: a whole hive in memory (proposal, split, work, verification, guards, trap, audit)…');
        const t = Date.now();
        if (!(await demo(() => {}))) throw new Error('The self-check failed: this machine cannot verify deliverables correctly. Nothing was opened.');
        console.log(`Self-check passed in ${((Date.now() - t) / 1000).toFixed(1)} s.`);
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
      // Private hives (OSP v0.3) run next to the public ones, each in its own instance and registry.
      const hote = new Hote(coord, { dataDir, ...(balise ? { balise } : {}), ...(publique ? { privesMax: Number(opts['max-private'] ?? 500) } : {}) });
      const garde = publique ? new Garde({ proxy: LOCAL_HOSTS.has(host) }) : undefined;
      // The package built next to this program (deploy/install.sh runs `npm pack`): the join command installs it from here.
      const paquet = opts.package ? resolve(opts.package) : fileURLToPath(new URL('../kickswarm.tgz', import.meta.url));
      const serveur = createCoordinatorServer(coord, hote, { ...(garde ? { garde } : {}), ...(existsSync(paquet) ? { paquet } : {}) });
      await new Promise<void>((ok) => serveur.listen(port, host, ok));
      console.log(`OSP v0.1 coordinator on http://${host}:${port}${publique ? ' (public mode: budgets per address, bounded queue)' : ''}`);
      console.log(`Live hive: http://${host}:${port}/hive`);
      console.log(`Founder: ${founder}\nData: ${dataDir}\nSandbox: ${sandbox}${sandbox === 'process' ? ' (network not cut: keep this coordinator private)' : ''}`);
      console.log(`Random draws: ${balise ? 'public drand beacon (League of Entropy, quicknet), verifiable by anyone' : 'drawn by the coordinator itself (not verifiable)'}`);
      // The prepared projects of docs/projets.md open by themselves (safe to run at every start).
      const lancer = String(opts.launch ?? (publique ? 'all' : 'none'));
      const projets = lancer === 'none' ? [] : lancer === 'all' ? Object.values(PROJETS) : lancer.split(',').map((n) => PROJETS[n.trim()] ?? (() => { throw new Error(`Unknown project: ${n}`); })());
      if (projets.length && founder !== moi.id) console.log('The prepared projects are not opened: the founder\'s key is not on this machine (run "kickswarm launch <project>" from the founder\'s machine).');
      else {
        const local = new CoordinatorClient(`http://${LOCAL_HOSTS.has(host) ? host : '127.0.0.1'}:${port}`.replace('://::1', '://[::1]'), moi);
        for (const p of projets) {
          try {
            const r = await lancerProjet(local, p);
            console.log(r.deja ? `Project “${p.nom}”: already open.` : `Project “${p.nom}”: opened, ${r.cellules} cells.`);
          } catch (e) {
            console.error(`Project “${p.nom}” could not be opened: ${(e as Error).message}`);
          }
        }
      }
      // Stopped by the service manager: finish the requests in flight, then leave (the state is saved after every command).
      for (const signal of ['SIGTERM', 'SIGINT'] as const) {
        process.once(signal, () => {
          console.log('Stopping…');
          serveur.close(() => process.exit(0));
          serveur.closeIdleConnections();
          setTimeout(() => process.exit(0), 5000).unref();
        });
      }
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
      let ancres: Array<{ seq: number; tete: `sha256:${string}` }> | undefined;
      const file = opts.file ?? (opts.url === undefined && opts.hive === undefined ? join(resolve(opts.data ?? 'data'), 'registre.jsonl') : undefined);
      if (opts.hive) {
        // A private hive: its own registry, read with a member's ticket, checked against the public anchors.
        const c = client();
        c.utiliserRuchePrivee(opts.hive);
        const head = await c.etatPublie();
        entries = ((await c.registry()) as RegistryEntry[]).slice(0, head.seq + 1);
        announced = head.etat ?? undefined;
        ancres = await c.ancres();
        source = `private hive ${opts.hive} at ${url}`;
        if (head.tete && head.tete.seq > head.seq) embargo = head.tete.seq - head.seq;
      } else if (file && existsSync(file)) {
        source = file;
        entries = readFileSync(file, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l) as RegistryEntry);
      } else {
        // State hash first, then the registry cut at the same entry: the live hive keeps moving.
        // Entries still under embargo (open verifications) come later; the head hash already commits to them.
        const head = (await (await fetch(new URL('/v0/state-hash', url))).json()) as { seq: number; etat: string | null; tete?: { seq: number } | null };
        const all: RegistryEntry[] = [];
        for (let page: RegistryEntry[]; all.length <= head.seq && (page = (await (await fetch(new URL(`/v0/registry?since=${all.length}`, url))).json()) as RegistryEntry[]).length; ) all.push(...page);
        entries = all.slice(0, head.seq + 1);
        announced = head.etat ?? undefined;
        source = url;
        if (head.tete && head.tete.seq > head.seq) embargo = head.tete.seq - head.seq;
      }
      console.log(`\nAuditing ${entries.length} registry entries from ${source}${opts.reverify !== undefined ? ', re-running every verification' : ''}…\n`);
      const clone = opts.clone ? resolve(opts.clone) : undefined;
      const report = await auditRegistry(entries, {
        reverifier: opts.reverify !== undefined,
        etatAnnonce: announced as `sha256:${string}` | undefined,
        ...(ancres ? { ancres } : {}),
        ...(clone ? { verifierCommit: (r) => verifierCommit(clone, r) } : {}),
      });
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
