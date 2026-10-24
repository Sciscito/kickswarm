import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { signataire } from '../protocol/builders.js';
import type { Caste } from '../protocol/types.js';
import { loadOrCreateIdentity } from '../plugin/identite.js';
import { appliquerOptions, chargerParticipation, CompteurJour, enHeuresCalmes, enregistrerParticipation, ROLE_OF } from '../plugin/participation.js';
import { executeursNode } from '../verifier/v0.js';
import { AbeilleApi } from './abeille.js';
import { ajouterFournisseur, chargerConfig, enregistrerConfig, fournisseursActifs, retirerFournisseur, type ConfigMoteur } from './config.js';
import { detecterAcces, puissance, type Acces } from './detection.js';
import { CATALOGUE } from './fournisseurs.js';
import { connecterOpenRouter } from './openrouter-oauth.js';
import { Pool } from './pool.js';
import { serveurPerso, type Tableau } from './serveur.js';
import { arreter, demarrer, etat, installerDemarrageAuto, retirerDemarrageAuto } from './service.js';
import { stockageFichier } from './stockage.js';

// The local engine's commands (OSP v0.4 §2.6): `kickswarm engine …` to set it up, see it, and run it
// in the background; `kickswarm bee` to put it to work, with the dashboard and the personal endpoint.
// `configurerMoteur` is the step `kickswarm join` runs: detect, ask, connect, start.

export const AIDE_MOTEUR = `The local engine: all your AI, for you first, then for the swarm.

  kickswarm engine                         What you lend, your swarm power, what was used today
  kickswarm engine start | stop | status   Run it in the background (its page: http://127.0.0.1:7790)
  kickswarm engine autostart on | off      Start it when you log in (off by default)
  kickswarm engine connect openrouter      Connect OpenRouter in your browser: free models, no key to copy
  kickswarm engine add <provider> [--key K] [--base URL] [--models a,b] [--per-day N] [--confidential] [--accept-file-reads]
  kickswarm engine remove <provider>
  kickswarm engine set [--reserve 0.3] [--paid-per-day 0] [--personal-free on|off] [--bees 3]
  kickswarm engine serve [--port 7790]     Only the personal endpoint, for your own tools
  kickswarm bee [--hive <slug>] [--port 7790] [--no-serve] [--once]   Work in the foreground

Providers: ${Object.values(CATALOGUE).map((c) => `${c.id} (${c.aide}${c.env ? `; or set ${c.env}` : ''})`).join('\n           ')}

Consumer chat websites and apps (ChatGPT, Claude.ai, Gemini…) are never driven: their terms forbid it, and
your subscriptions are used through their official tools instead. Use the chats by hand on the /bee page.`;

const TYPE: Record<Acces['type'], string> = { abonnement: 'subscription', gratuit: 'free key', local: 'this machine', payant: 'paid key' };

function pool(c: ConfigMoteur, log: (l: string) => void): Pool {
  return new Pool(fournisseursActifs(c), { reservePerso: c.reservePerso, payantsParJour: c.payantsParJour, log });
}

async function decouvrirEtDire(p: Pool, log: (l: string) => void): Promise<void> {
  const r = await p.decouvrir();
  // A local server that is not running is not news: it is optional.
  for (const e of r.erreurs) if (!p.fournisseurs.find((f) => f.id === e.fournisseur)?.local) log(`  ${e.fournisseur}: not reachable (${e.erreur.split('\n')[0]})`);
}

function annoncerServeur(c: ConfigMoteur, port: number): void {
  console.log(`\nYour engine's page: http://127.0.0.1:${port}`);
  console.log(`Your personal endpoint: http://127.0.0.1:${port}/v1   (OpenAI-compatible, model "auto")`);
  console.log(`Its key: ${c.jeton}`);
  if (c.autoriserGratuitsPerso) console.log('Note: free and test models may be used by their provider to train its models. For private work: kickswarm engine set --personal-free off');
}

/** Prints what this machine can lend, and the swarm power it gives. */
export function direPuissance(acces: Acces[], log: (l: string) => void = console.log): void {
  for (const a of acces) {
    if (!a.disponible && a.type === 'local') continue;
    const etatAcces = a.prete && a.disponible ? '● lent' : a.disponible ? (a.risque ? '○ off (could read your files)' : '○ available') : '· not set up';
    log(`  ${etatAcces.padEnd(31)} ${a.id.padEnd(12)} ${TYPE[a.type]}${a.parJour ? `, ${a.parJour} tasks/day` : a.type === 'local' ? ', unlimited' : ''}`);
  }
  const p = puissance(acces);
  log(`\n  Swarm power: level ${p.niveau.rang + 1}, ${p.niveau.nom}. ${p.acces} AI(s) lent, ${p.abeilles} bee(s) at once, ${p.illimite ? 'unlimited' : `up to ${p.tachesParJour}`} tasks a day.`);
  log(`  ${p.niveau.texte}`);
}

const oui = (r: string, defaut: boolean) => (r.trim() === '' ? defaut : /^(y|yes|o|oui)$/i.test(r.trim()));

/**
 * The engine step of `kickswarm join`: what this machine can lend, a yes for each, OpenRouter in one
 * click, then the engine in the background. With --yes: the safe defaults (subscriptions and local
 * models lent with their default share, no browser opened, no start at login).
 */
export async function configurerMoteur(
  home: string,
  url: string,
  o: {
    oui: boolean;
    autostart?: boolean;
    ouvrir?: (u: string) => void;
    log?: (l: string) => void;
    /** For tests: how tools are found, and how the engine is started. */
    installe?: (commande: string) => boolean;
    lancer?: (home: string, url: string) => { deja: boolean };
    env?: Record<string, string | undefined>;
  },
): Promise<void> {
  const log = o.log ?? console.log;
  let c = chargerConfig(home);
  c.coordinateur = url;
  const detecter = (cfg: ConfigMoteur) => detecterAcces(cfg, o.env ?? process.env, o.installe);
  const acces = await detecter(c);
  log('\nYour AIs, and what they can lend to the swarm:');
  direPuissance(acces, log);
  const rl = o.oui ? null : createInterface({ input: process.stdin, output: process.stdout });
  const demander = async (q: string, defaut: boolean) => (rl ? oui(await rl.question(`${q} [${defaut ? 'Y/n' : 'y/N'}] `), defaut) : defaut);
  try {
    for (const a of acces) {
      if (a.type !== 'abonnement' || !a.disponible || a.prete) continue;
      const def = CATALOGUE[a.id]!;
      if (a.risque) {
        if (await demander(`\n${a.id} can read files on this machine even when locked down. Lend it anyway?`, false)) c = ajouterFournisseur(c, { id: a.id, accepteLecture: true });
        continue;
      }
      if (await demander(`\nLend ${def.aide.split(',')[0]} to the swarm, up to ${def.parJour} tasks a day? Your own use always comes first.`, true)) c = ajouterFournisseur(c, { id: a.id });
    }
    const openrouter = acces.find((a) => a.id === 'openrouter');
    if (!openrouter?.prete && !o.oui && (await demander('\nConnect OpenRouter for free models? It opens your browser, you approve, done.', true))) {
      try {
        log('Waiting for your approval in the browser…');
        const cle = await connecterOpenRouter(o.ouvrir ? { ouvrir: o.ouvrir } : {});
        c = ajouterFournisseur(c, { id: 'openrouter', cle });
        log('  ✓ OpenRouter connected.');
      } catch (e) {
        log(`  OpenRouter not connected: ${(e as Error).message}. Later: kickswarm engine connect openrouter`);
      }
    }
    enregistrerConfig(home, c);
    log('\nWith your choices:');
    direPuissance(await detecter(c), log);
    if (await demander('\nStart your engine in the background now?', true)) {
      const d = (o.lancer ?? demarrer)(home, url);
      log(`  ✓ Engine ${d.deja ? 'already running' : 'started'}. Its page: http://127.0.0.1:${c.port}`);
    }
    const auto = o.autostart ?? (await demander('Start it automatically when you log in?', false));
    if (auto) log(`  ✓ Start at login: ${installerDemarrageAuto(home, url)}`);
  } finally {
    rl?.close();
  }
}

export async function commandeMoteur(home: string, url: string, args: string[], opts: Record<string, string>): Promise<void> {
  let c = chargerConfig(home);
  const log = (l: string) => console.log(l);
  switch (args[0]) {
    case undefined: {
      console.log('Your AIs:');
      direPuissance(await detecterAcces(c));
      const p = pool(c, log);
      await decouvrirEtDire(p, log);
      console.log(`\n${p.modeles().length} model(s) ready. ${Math.round(c.reservePerso * 100)}% of known daily quotas kept for you; paid calls for the swarm: ${c.payantsParJour}/day.`);
      const e = etat(home);
      console.log(e.actif ? `Running in the background (pid ${e.pid}). Log: ${e.journal}` : 'Not running in the background: kickswarm engine start');
      annoncerServeur(c, c.port);
      return;
    }
    case 'start': {
      const cible = opts.url ? url : (c.coordinateur ?? url);
      if (!c.coordinateur) enregistrerConfig(home, { ...c, coordinateur: cible });
      const d = demarrer(home, cible);
      console.log(`${d.deja ? 'Already running' : 'Started'} (pid ${d.pid}), working for ${cible}. Its page: http://127.0.0.1:${c.port}  ·  log: ${d.journal}`);
      return;
    }
    case 'stop':
      console.log(arreter(home) ? 'Stopped.' : 'It was not running.');
      return;
    case 'status': {
      const e = etat(home);
      console.log(e.actif ? `Running (pid ${e.pid}) for ${c.coordinateur ?? url}. Page: http://127.0.0.1:${c.port}  ·  log: ${e.journal}` : 'Not running. Start it with: kickswarm engine start');
      return;
    }
    case 'autostart':
      if (args[1] === 'off') console.log(retirerDemarrageAuto() ? 'It will no longer start at login.' : 'It was not set to start at login.');
      else console.log(`It will start when you log in: ${installerDemarrageAuto(home, c.coordinateur ?? url)}. Undo: kickswarm engine autostart off`);
      return;
    case 'connect': {
      if (args[1] !== 'openrouter') throw new Error('Usage: kickswarm engine connect openrouter');
      console.log('Opening OpenRouter in your browser: approve, and come back here…');
      const cle = await connecterOpenRouter();
      enregistrerConfig(home, ajouterFournisseur(c, { id: 'openrouter', cle }));
      console.log('OpenRouter is connected: its free models join your engine. See them with: kickswarm engine');
      return;
    }
    case 'add': {
      const id = args[1];
      if (!id) throw new Error('Usage: kickswarm engine add <provider> [--key K] [--base URL] [--models a,b] [--per-day N] [--confidential] [--accept-file-reads]');
      c = ajouterFournisseur(c, {
        id,
        ...(opts.key ? { cle: opts.key } : {}),
        ...(opts.base ? { url: opts.base.replace(/\/+$/, '') } : {}),
        ...(opts.models ? { modeles: opts.models.split(',').map((s) => s.trim()).filter(Boolean) } : {}),
        ...(opts['per-day'] ? { parJour: Number(opts['per-day']) } : {}),
        ...(opts.confidential !== undefined ? { confidentiel: true } : {}),
        ...(opts['accept-file-reads'] !== undefined ? { accepteLecture: true } : {}),
      });
      enregistrerConfig(home, c);
      console.log(`Saved ${id} (any key stays in ${home}). See it with: kickswarm engine`);
      return;
    }
    case 'remove':
      enregistrerConfig(home, retirerFournisseur(c, args[1] ?? ''));
      console.log(`Removed ${args[1]}.`);
      return;
    case 'set': {
      if (opts.reserve !== undefined) c.reservePerso = Math.min(0.9, Math.max(0, Number(opts.reserve)));
      if (opts['paid-per-day'] !== undefined) c.payantsParJour = Math.max(0, Math.floor(Number(opts['paid-per-day'])));
      if (opts['personal-free'] !== undefined) c.autoriserGratuitsPerso = opts['personal-free'] !== 'off';
      if (opts.bees !== undefined) c.abeilles = Math.min(8, Math.max(1, Math.floor(Number(opts.bees))));
      enregistrerConfig(home, c);
      console.log(`Saved: ${Math.round(c.reservePerso * 100)}% kept for you, ${c.payantsParJour} paid call(s) a day for the swarm, free models for personal use: ${c.autoriserGratuitsPerso ? 'on' : 'off'}${c.abeilles ? `, ${c.abeilles} bee(s) at once` : ''}.`);
      return;
    }
    case 'serve': {
      const p = pool(c, log);
      await decouvrirEtDire(p, log);
      const port = Number(opts.port ?? c.port);
      serveurPerso(p, { jeton: c.jeton, autoriserGratuits: c.autoriserGratuitsPerso, log }).listen(port, '127.0.0.1', () => annoncerServeur(c, port));
      return;
    }
    default:
      console.log(AIDE_MOTEUR);
  }
}

/** `kickswarm bee`: the swarm loop (several bees at once), the dashboard and the personal endpoint. */
export async function commandeAbeille(home: string, urlParDefaut: string, opts: Record<string, string>): Promise<void> {
  const c = chargerConfig(home);
  const url = opts.url ? urlParDefaut : (c.coordinateur ?? urlParDefaut);
  const log = (l: string) => console.log(`[bee] ${new Date().toISOString().slice(11, 19)} ${l}`);
  const p = pool(c, log);
  await decouvrirEtDire(p, log);
  const identite = loadOrCreateIdentity(home).identite;
  const participation = chargerParticipation(home);
  const castes = (Object.keys(ROLE_OF) as Caste[]).filter((k) => participation.roles.includes(ROLE_OF[k]) && k !== 'eclaireuse');
  const compteur = new CompteurJour(home);
  const acces = () => detecterAcces(chargerConfig(home));
  // One bee per AI lent, as the dashboard says, within the coordinator's limit per contributor.
  const n = c.abeilles ?? Math.max(1, puissance(await acces()).abeilles);
  log(`${p.modeles().length} model(s) ready, ${n} bee(s) for ${url}`);
  const abeilles = Array.from(
    { length: n },
    (_, i) =>
      new AbeilleApi({
        url,
        pool: p,
        signataire: signataire(identite),
        executeurs: executeursNode(),
        ...(opts.hive ? { ruche: opts.hive } : { ruches: () => chargerParticipation(home).ruches }),
        castes,
        stockage: stockageFichier(join(home, `abeille-${i + 1}.json`)),
        repos: () => {
          const q = chargerParticipation(home);
          if (q.pause) return 'paused';
          if (enHeuresCalmes(q)) return 'quiet hours';
          if (q.parJour && compteur.aujourdhui() >= q.parJour) return 'daily limit reached';
          return null;
        },
        compter: () => compteur.plusUn(),
        log: (l) => log(`#${i + 1} ${l}`),
      }),
  );
  if (opts['no-serve'] === undefined) {
    const port = Number(opts.port ?? c.port);
    const tableau: Tableau = {
      etat: async () => {
        const a = await acces();
        let compte: unknown = null;
        try {
          const r = await fetch(new URL(`/v0/contributors/${encodeURIComponent(identite.id)}`, url));
          if (r.ok) compte = await r.json();
        } catch {
          // the coordinator may be unreachable: the page still shows the engine
        }
        return { puissance: puissance(a), acces: a, participation: chargerParticipation(home), coordinateur: url, aujourdhui: compteur.aujourdhui(), compte, jeton: chargerConfig(home).jeton, bilan: p.bilan() };
      },
      basculerPause: () => {
        const q = chargerParticipation(home);
        enregistrerParticipation(home, appliquerOptions(q, q.pause ? { resume: true } : { pause: true }));
      },
      coordinateur: () => url,
      nomRuche: async (ruche, coordinateur) => {
        const r = await fetch(new URL(`/v0/hives/${encodeURIComponent(ruche)}`, coordinateur));
        return r.ok ? ((await r.json()) as { ruche: { nom: string } }).ruche.nom : ruche;
      },
      rejoindre: async (ruche) => {
        enregistrerParticipation(home, appliquerOptions(chargerParticipation(home), { ruche }));
        log(`joined ${ruche} from the engine's page`);
      },
    };
    serveurPerso(p, { jeton: c.jeton, autoriserGratuits: c.autoriserGratuitsPerso, log, tableau }).listen(port, '127.0.0.1', () => annoncerServeur(c, port));
  }
  if (opts.once !== undefined) {
    const issue = await abeilles[0]!.tour();
    if (issue === 'rendu' || issue === 'garde') compteur.plusUn();
    log(`done: ${issue}`);
    process.exit(0);
  }
  const ctrl = new AbortController();
  process.on('SIGINT', () => ctrl.abort());
  process.on('SIGTERM', () => ctrl.abort());
  await Promise.all(abeilles.map((a) => a.suivre(ctrl.signal)));
  process.exit(0);
}
