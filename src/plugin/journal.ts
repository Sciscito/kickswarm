import { chmodSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { Registry, verifyRegistry, type RegistryEntry } from '../coordinator/registry.js';
import { kickswarmHome } from './identite.js';

// The local journal: everything your AI does for the swarm, on your machine, and only there.
// Instructions received, deliverables sent (full code), replayed checks, verdicts, splits,
// errors. It is hash-chained like the public registry: an entry changed after the fact shows.

export class JournalLocal {
  readonly fichier: string;
  private readonly reg: Registry;

  constructor(dir = kickswarmHome()) {
    mkdirSync(dir, { recursive: true });
    this.fichier = join(dir, 'journal.jsonl');
    let reg: Registry;
    try {
      reg = new Registry(this.fichier);
    } catch {
      // An altered journal is not erased: it is set aside, and a new one is opened.
      const cote = join(dir, `journal.altere-${Date.now()}.jsonl`);
      renameSync(this.fichier, cote);
      console.error(`[kickswarm] Local journal altered: set aside in ${cote}`);
      reg = new Registry(this.fichier);
    }
    this.reg = reg;
  }

  note(nature: string, donnees: Record<string, unknown>): void {
    const nouveau = !existsSync(this.fichier);
    this.reg.append(nature, donnees);
    if (nouveau) {
      try {
        chmodSync(this.fichier, 0o600);
      } catch {
        /* no effect on Windows */
      }
    }
  }

  dernieres(n: number): RegistryEntry[] {
    return this.reg.entries.slice(-n);
  }

  verifier(): { ok: true } | { ok: false; erreur: string } {
    return verifyRegistry(this.reg.entries);
  }
}

/** One readable line per journal entry. */
export function resumer(e: RegistryEntry): string {
  const d = e.donnees as Record<string, unknown>;
  const t = new Date(e.date).toLocaleString('en-GB');
  const cell = d.chemin !== undefined ? ` cell ${String(d.chemin)}` : '';
  switch (e.nature) {
    case 'rejoint': return `${t}  joined hive “${String(d.ruche)}”`;
    case 'consigne': return `${t}  received a ${String(d.caste)} task:${cell} · ${String(d.objectif ?? '').slice(0, 80)}`;
    case 'verification': return `${t}  replayed a check as guard:${cell} → ${d.ok ? 'valid' : 'rejected'} (${String(d.motif ?? '')})${d.piege ? ' · it was a trap cell' : ''}`;
    case 'engagement': return `${t}  sealed verdict “${String(d.decision)}”${cell}: only its hash was sent, revealed once every guard has committed`;
    case 'verdict': return `${t}  revealed verdict “${String(d.decision)}”${cell} → ${String(d.statut ?? '')}`;
    case 'controle_local': return `${t}  local check failed${cell}: ${String(d.motif ?? '')} (nothing sent)`;
    case 'livraison': return `${t}  delivered${cell}: ${Object.keys((d.fichiers as object) ?? {}).join(', ')} → ${String(d.statut ?? '')}`;
    case 'decoupage': return `${t}  proposed a split${cell} into ${String(d.n)} cells → ${String(d.statut ?? '')}`;
    case 'rappel': return `${t}  recalled the bee${cell}`;
    case 'erreur': return `${t}  error in ${String(d.outil)}: ${String(d.erreur)}`;
    default: return `${t}  ${e.nature}`;
  }
}
