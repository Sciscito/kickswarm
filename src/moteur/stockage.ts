import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Stockage } from '../web/porte.js';

/**
 * A bee's small state in a file (its task in progress, its sealed verdicts): a background engine that
 * restarts can still reveal the verdicts it committed to, instead of being penalized for silence.
 */
export function stockageFichier(fichier: string): Stockage {
  const lire = (): Record<string, string> => {
    try {
      return existsSync(fichier) ? (JSON.parse(readFileSync(fichier, 'utf8')) as Record<string, string>) : {};
    } catch {
      return {};
    }
  };
  const ecrire = (d: Record<string, string>) => {
    mkdirSync(dirname(fichier), { recursive: true });
    writeFileSync(`${fichier}.tmp`, JSON.stringify(d));
    renameSync(`${fichier}.tmp`, fichier);
  };
  return {
    lire: (k) => lire()[k] ?? null,
    ecrire: (k, v) => ecrire({ ...lire(), [k]: v }),
    effacer: (k) => {
      const d = lire();
      delete d[k];
      ecrire(d);
    },
  };
}
