import { chmodSync, existsSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { Registry, verifyRegistry, type RegistryEntry } from '../coordinator/registry.js';
import { kickswarmHome } from './identite.js';

// Le journal local : tout ce que ton IA fait pour l'essaim, sur ta machine, et seulement là.
// Consignes reçues, livrables envoyés (code complet), vérifications rejouées, verdicts, découpages,
// erreurs. Il est chaîné par hash comme le registre public : une entrée modifiée après coup se voit.

export class JournalLocal {
  readonly fichier: string;
  private readonly reg: Registry;

  constructor(dir = kickswarmHome()) {
    this.fichier = join(dir, 'journal.jsonl');
    let reg: Registry;
    try {
      reg = new Registry(this.fichier);
    } catch {
      // Un journal altéré n'est pas effacé : on le met de côté, et on en ouvre un neuf.
      const cote = join(dir, `journal.altere-${Date.now()}.jsonl`);
      renameSync(this.fichier, cote);
      console.error(`[kickswarm] Journal local altéré : mis de côté dans ${cote}`);
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
        /* sans effet sous Windows */
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

/** Une ligne lisible par entrée du journal. */
export function resumer(e: RegistryEntry): string {
  const d = e.donnees as Record<string, unknown>;
  const t = new Date(e.date).toLocaleString('en-GB');
  const cell = d.chemin !== undefined ? ` cell ${String(d.chemin)}` : '';
  switch (e.nature) {
    case 'rejoint': return `${t}  joined hive “${String(d.ruche)}”`;
    case 'consigne': return `${t}  received a ${String(d.caste)} task:${cell} · ${String(d.objectif ?? '').slice(0, 80)}`;
    case 'verification': return `${t}  replayed a check as guard:${cell} → ${d.ok ? 'valid' : 'rejected'} (${String(d.motif ?? '')})${d.piege ? ' · it was a trap cell' : ''}`;
    case 'verdict': return `${t}  sent verdict “${String(d.decision)}”${cell} → ${String(d.statut ?? '')}`;
    case 'controle_local': return `${t}  local check failed${cell}: ${String(d.motif ?? '')} (nothing sent)`;
    case 'livraison': return `${t}  delivered${cell}: ${Object.keys((d.fichiers as object) ?? {}).join(', ')} → ${String(d.statut ?? '')}`;
    case 'decoupage': return `${t}  proposed a split${cell} into ${String(d.n)} cells → ${String(d.statut ?? '')}`;
    case 'rappel': return `${t}  recalled the bee${cell}`;
    case 'erreur': return `${t}  error in ${String(d.outil)}: ${String(d.erreur)}`;
    default: return `${t}  ${e.nature}`;
  }
}
