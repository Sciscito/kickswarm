import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CATALOGUE, type Fournisseur } from './fournisseurs.js';

// The local engine's settings (OSP v0.4 §2.6), next to the identity, on this machine only:
// the providers and their keys, the share of quotas kept for personal use, the paid budget, and the
// personal endpoint's token. Keys never leave this file and this machine (principle 2).

export interface EntreeFournisseur extends Partial<Omit<Fournisseur, 'id'>> {
  id: string;
}

export interface ConfigMoteur {
  fournisseurs: EntreeFournisseur[];
  /** Share of each known daily quota kept for personal use. */
  reservePerso: number;
  /** Paid calls per day the swarm may use (0: paid keys serve personal requests only). */
  payantsParJour: number;
  /** Free models (which may train on prompts) for personal requests too. */
  autoriserGratuitsPerso: boolean;
  /** The personal endpoint's key. */
  jeton: string;
  port: number;
  /** The coordinator the engine works for (set by kickswarm join). */
  coordinateur?: string;
  /** How many bees the engine runs at once (each takes one task at a time). */
  abeilles?: number;
}

const FICHIER = 'moteur.json';

export function chargerConfig(home: string): ConfigMoteur {
  const f = join(home, FICHIER);
  const defaut: ConfigMoteur = { fournisseurs: [], reservePerso: 0.3, payantsParJour: 0, autoriserGratuitsPerso: true, jeton: `ks-${randomBytes(24).toString('base64url')}`, port: 7790 };
  if (!existsSync(f)) {
    enregistrerConfig(home, defaut);
    return defaut;
  }
  const lu = JSON.parse(readFileSync(f, 'utf8')) as Partial<ConfigMoteur>;
  return { ...defaut, ...lu, fournisseurs: Array.isArray(lu.fournisseurs) ? lu.fournisseurs : [] };
}

export function enregistrerConfig(home: string, c: ConfigMoteur): string {
  mkdirSync(home, { recursive: true });
  const f = join(home, FICHIER);
  writeFileSync(f, JSON.stringify(c, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
  return f;
}

/**
 * The providers to use: those the contributor added, those whose key is in the environment, and the
 * local servers (Ollama, LM Studio), which are skipped if they do not answer.
 */
export function fournisseursActifs(c: ConfigMoteur, env: Record<string, string | undefined> = process.env): Fournisseur[] {
  const out = new Map<string, Fournisseur>();
  for (const e of c.fournisseurs) {
    const base = CATALOGUE[e.id];
    if (!base && !e.url) continue;
    const { env: varEnv, aide: _aide, ...defaut } = base ?? { id: e.id, api: 'openai' as const, url: e.url!, gratuit: true, confidentiel: false, decouverte: 'liste' as const, env: undefined, aide: '' };
    const cle = e.cle ?? (varEnv ? env[varEnv] : undefined);
    const f: Fournisseur = { ...defaut, ...e, ...(cle ? { cle } : {}) };
    // A subscription tool needs no key: being in the settings means the contributor said yes.
    if (!f.cle && !f.local && f.api !== 'cli') continue;
    out.set(f.id, f);
  }
  for (const [id, base] of Object.entries(CATALOGUE)) {
    // Subscription tools are never added on their own: only with the contributor's yes (kickswarm join).
    if (base.api === 'cli' || out.has(id) || c.fournisseurs.some((e) => e.id === id)) continue;
    const { env: varEnv, aide: _aide, ...f } = base;
    const cle = varEnv ? env[varEnv] : undefined;
    if (cle) out.set(id, { ...f, cle });
    else if (f.local) out.set(id, { ...f });
  }
  return [...out.values()];
}

export function ajouterFournisseur(c: ConfigMoteur, e: EntreeFournisseur): ConfigMoteur {
  if (!CATALOGUE[e.id] && !e.url) throw new Error(`Unknown provider “${e.id}”: give its --base (the address of an OpenAI-compatible API), or pick one of ${Object.keys(CATALOGUE).join(', ')}`);
  const reste = c.fournisseurs.filter((x) => x.id !== e.id);
  return { ...c, fournisseurs: [...reste, { ...c.fournisseurs.find((x) => x.id === e.id), ...e }] };
}

export function retirerFournisseur(c: ConfigMoteur, id: string): ConfigMoteur {
  return { ...c, fournisseurs: c.fournisseurs.filter((x) => x.id !== id) };
}
