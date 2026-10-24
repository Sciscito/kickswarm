import { signataire } from '../protocol/builders.js';
import type { Caste } from '../protocol/types.js';
import { loadOrCreateIdentity } from '../plugin/identite.js';
import { chargerParticipation, CompteurJour, enHeuresCalmes, ROLE_OF } from '../plugin/participation.js';
import { executeursNode } from '../verifier/v0.js';
import { AbeilleApi } from './abeille.js';
import { ajouterFournisseur, chargerConfig, enregistrerConfig, fournisseursActifs, retirerFournisseur, type ConfigMoteur } from './config.js';
import { CATALOGUE } from './fournisseurs.js';
import { Pool } from './pool.js';
import { serveurPerso } from './serveur.js';

// The local engine's commands (OSP v0.4 §2.6): `kickswarm engine …` to set it up and see it,
// `kickswarm bee` to put it to work for the swarm, with the personal endpoint on by default.

export const AIDE_MOTEUR = `The local engine: all your free AI, for you first, then for the swarm.

  kickswarm engine                         Your providers, their models, what was used today
  kickswarm engine add <provider> [--key K] [--base URL] [--models a,b] [--per-day N] [--confidential]
  kickswarm engine remove <provider>
  kickswarm engine set [--reserve 0.3] [--paid-per-day 0] [--personal-free on|off]
  kickswarm engine serve [--port 7790]     Only the personal endpoint, for your own tools
  kickswarm bee [--hive <slug>] [--port 7790] [--no-serve] [--once]   Work for the swarm (and serve you first)

Providers: ${Object.values(CATALOGUE).map((c) => `${c.id} (${c.aide}${c.env ? `; or set ${c.env}` : ''})`).join('\n           ')}

Consumer chat apps (ChatGPT, Claude.ai, Gemini…) are not driven by the engine: their terms forbid it.
Use them by hand on the /bee page. One key per provider and per person.`;

function pool(c: ConfigMoteur, log: (l: string) => void): Pool {
  return new Pool(fournisseursActifs(c), { reservePerso: c.reservePerso, payantsParJour: c.payantsParJour, log });
}

async function decouvrirEtDire(p: Pool, log: (l: string) => void): Promise<void> {
  const r = await p.decouvrir();
  // A local server that is not running is not news: it is optional.
  for (const e of r.erreurs) if (!p.fournisseurs.find((f) => f.id === e.fournisseur)?.local) log(`  ${e.fournisseur}: not reachable (${e.erreur.split('\n')[0]})`);
}

function annoncerServeur(c: ConfigMoteur, port: number): void {
  console.log(`\nYour personal endpoint: http://127.0.0.1:${port}/v1   (OpenAI-compatible)`);
  console.log(`Its key: ${c.jeton}`);
  console.log('Point your editor or chat app at it, model "auto": it gets every free model above, and the swarm waits while you use it.');
  if (c.autoriserGratuitsPerso) console.log('Note: free and test models may be used by their provider to train its models. For private work: kickswarm engine set --personal-free off');
}

export async function commandeMoteur(home: string, args: string[], opts: Record<string, string>): Promise<void> {
  let c = chargerConfig(home);
  const log = (l: string) => console.log(l);
  switch (args[0]) {
    case undefined: {
      const p = pool(c, log);
      const actifs = p.fournisseurs;
      if (!actifs.some((f) => !f.local)) console.log('No provider with a key yet. Add one, for example: kickswarm engine add openrouter --key sk-or-…');
      console.log('Looking for models…');
      await decouvrirEtDire(p, log);
      for (const b of p.bilan()) {
        const f = actifs.find((x) => x.id === b.fournisseur)!;
        if (f.local && !b.modeles) continue;
        console.log(`  ${b.fournisseur.padEnd(11)} ${String(b.modeles).padStart(3)} model(s)  ${f.gratuit ? 'free' : 'paid'}${f.confidentiel ? ', confidential' : ''}${b.parJour !== undefined ? `, ${b.parJour}/day` : ''}`);
      }
      const n = p.modeles().length;
      console.log(`\n${n} model(s) ready. ${Math.round(c.reservePerso * 100)}% of known daily quotas kept for you; paid calls for the swarm: ${c.payantsParJour}/day.`);
      annoncerServeur(c, c.port);
      return;
    }
    case 'add': {
      const id = args[1];
      if (!id) throw new Error('Usage: kickswarm engine add <provider> [--key K] [--base URL] [--models a,b] [--per-day N] [--confidential]');
      c = ajouterFournisseur(c, {
        id,
        ...(opts.key ? { cle: opts.key } : {}),
        ...(opts.base ? { url: opts.base.replace(/\/+$/, '') } : {}),
        ...(opts.models ? { modeles: opts.models.split(',').map((s) => s.trim()).filter(Boolean) } : {}),
        ...(opts['per-day'] ? { parJour: Number(opts['per-day']) } : {}),
        ...(opts.confidential !== undefined ? { confidentiel: true } : {}),
      });
      enregistrerConfig(home, c);
      console.log(`Saved ${id} (its key stays in ${home}). See it with: kickswarm engine`);
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
      enregistrerConfig(home, c);
      console.log(`Saved: ${Math.round(c.reservePerso * 100)}% kept for you, ${c.payantsParJour} paid call(s) a day for the swarm, free models for personal use: ${c.autoriserGratuitsPerso ? 'on' : 'off'}.`);
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

/** `kickswarm bee`: the swarm loop, and the personal endpoint unless --no-serve. */
export async function commandeAbeille(home: string, url: string, opts: Record<string, string>): Promise<void> {
  const c = chargerConfig(home);
  const log = (l: string) => console.log(`[bee] ${l}`);
  const p = pool(c, log);
  await decouvrirEtDire(p, log);
  log(`${p.modeles().length} model(s) ready for ${url}`);
  const participation = chargerParticipation(home);
  const castes = (Object.keys(ROLE_OF) as Caste[]).filter((k) => participation.roles.includes(ROLE_OF[k]) && k !== 'eclaireuse');
  const compteur = new CompteurJour(home);
  const abeille = new AbeilleApi({
    url,
    pool: p,
    signataire: signataire(loadOrCreateIdentity(home).identite),
    executeurs: executeursNode(),
    ...(opts.hive ? { ruche: opts.hive } : participation.ruches.length ? { ruche: participation.ruches.at(-1)! } : {}),
    castes,
    repos: () => {
      const q = chargerParticipation(home);
      if (q.pause) return 'paused';
      if (enHeuresCalmes(q)) return 'quiet hours';
      if (q.parJour && compteur.aujourdhui() >= q.parJour) return 'daily limit reached';
      return null;
    },
    log,
  });
  if (opts['no-serve'] === undefined) {
    const port = Number(opts.port ?? c.port);
    serveurPerso(p, { jeton: c.jeton, autoriserGratuits: c.autoriserGratuitsPerso, log }).listen(port, '127.0.0.1', () => annoncerServeur(c, port));
  }
  if (opts.once !== undefined) {
    const issue = await abeille.tour();
    if (issue === 'rendu' || issue === 'garde') compteur.plusUn();
    log(`done: ${issue}`);
    process.exit(0);
  }
  const ctrl = new AbortController();
  process.on('SIGINT', () => ctrl.abort());
  await abeille.suivre(ctrl.signal);
}
