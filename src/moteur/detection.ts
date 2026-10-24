import { AGENTS, agentInstalle } from './agents.js';
import type { ConfigMoteur } from './config.js';
import { CATALOGUE } from './fournisseurs.js';

// What this machine can lend (OSP v0.4 §2.6): the subscription tools installed, the local model
// servers that answer, and the keys already given. `kickswarm join` shows it and asks; the engine's
// page shows it as "your swarm power".

export type TypeAcces = 'abonnement' | 'gratuit' | 'local' | 'payant';

export interface Acces {
  id: string;
  type: TypeAcces;
  aide: string;
  /** Installed, running, or with a key: it could work now. */
  disponible: boolean;
  /** Already lent (in the engine's settings, or found by itself: keys in the environment, local servers). */
  prete: boolean;
  /** Tasks a day it takes for the swarm, when known (subscriptions have a modest default). */
  parJour?: number;
  /** The tool could read this machine's files: off unless accepted. */
  risque?: boolean;
}

async function repond(url: string): Promise<boolean> {
  try {
    const r = await fetch(`${url}/models`, { signal: AbortSignal.timeout(1500) });
    return r.ok;
  } catch {
    return false;
  }
}

export async function detecterAcces(c: ConfigMoteur, env: Record<string, string | undefined> = process.env, installe: (cmd: string) => boolean = agentInstalle): Promise<Acces[]> {
  const out: Acces[] = [];
  for (const [id, base] of Object.entries(CATALOGUE)) {
    const reglage = c.fournisseurs.find((e) => e.id === id);
    if (base.api === 'cli') {
      const def = AGENTS[base.agent!];
      out.push({
        id,
        type: 'abonnement',
        aide: base.aide,
        disponible: installe(reglage?.commande ?? def.commande),
        prete: !!reglage && (!base.risqueLecture || !!reglage.accepteLecture),
        parJour: reglage?.parJour ?? base.parJour,
        ...(base.risqueLecture ? { risque: true } : {}),
      });
    } else if (base.local) {
      const marche = await repond(reglage?.url ?? base.url);
      out.push({ id, type: 'local', aide: base.aide, disponible: marche, prete: marche });
    } else {
      const cle = reglage?.cle ?? (base.env ? env[base.env] : undefined);
      out.push({ id, type: base.gratuit ? 'gratuit' : 'payant', aide: base.aide, disponible: !!cle, prete: !!cle, ...(reglage?.parJour ? { parJour: reglage.parJour } : {}) });
    }
  }
  return out;
}

/** Levels of the swarm power, for the page and the terminal: a little game, and an honest measure. */
const NIVEAUX = [
  { min: 0, nom: 'Egg', texte: 'Lend one AI to hatch your bee.' },
  { min: 1, nom: 'Larva', texte: 'One AI at work. Each new one adds a bee.' },
  { min: 2, nom: 'Worker', texte: 'Several AIs: your bees work side by side.' },
  { min: 4, nom: 'Forager', texte: 'A real hive of your own, around the clock.' },
  { min: 6, nom: 'Queen', texte: 'You lend everything you have. The swarm thanks you.' },
];

export interface Puissance {
  /** Accesses lent and working. */
  acces: number;
  /** Bees that can work at once (one per access, at most the coordinator's limit per contributor). */
  abeilles: number;
  /** Tasks a day, from the known limits; `illimite` when a local model is lent. */
  tachesParJour: number;
  illimite: boolean;
  niveau: { nom: string; texte: string; rang: number };
}

export function puissance(acces: Acces[], maxAbeilles = 3): Puissance {
  const pretes = acces.filter((a) => a.prete && a.disponible);
  const illimite = pretes.some((a) => a.type === 'local');
  // Free API tiers have limits that change: counted at a cautious 50 a day when unknown.
  const tachesParJour = pretes.reduce((s, a) => s + (a.parJour ?? (a.type === 'local' ? 0 : 50)), 0);
  let rang = 0;
  for (let i = 0; i < NIVEAUX.length; i++) if (pretes.length >= NIVEAUX[i]!.min) rang = i;
  const n = NIVEAUX[rang]!;
  return { acces: pretes.length, abeilles: Math.min(maxAbeilles, Math.max(pretes.length, 0)), tachesParJour, illimite, niveau: { nom: n.nom, texte: n.texte, rang } };
}
