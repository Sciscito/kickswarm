import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Verdict } from '../protocol/types.js';

// Les verdicts scellés (OSP v0.2, P1-3) : l'engagement est parti, le verdict attend que toutes les
// gardiennes du résultat se soient engagées. Ils sont gardés sur disque, sel compris : une gardienne
// qui ne révèle pas à temps perd plus de réputation qu'avec le pire verdict.

export interface VerdictScelle {
  verdict: Verdict;
  coordinateur: string;
  chemin: string;
  ruche?: string;
}

export class Scelles {
  private liste: VerdictScelle[];

  constructor(readonly fichier?: string) {
    this.liste = fichier && existsSync(fichier) ? (JSON.parse(readFileSync(fichier, 'utf8')) as VerdictScelle[]) : [];
  }

  get tous(): readonly VerdictScelle[] {
    return this.liste;
  }

  ajouter(s: VerdictScelle): void {
    this.liste.push(s);
    this.ecrire();
  }

  retirer(s: VerdictScelle): void {
    this.liste = this.liste.filter((x) => x !== s);
    this.ecrire();
  }

  private ecrire(): void {
    if (!this.fichier) return;
    mkdirSync(dirname(this.fichier), { recursive: true });
    writeFileSync(this.fichier, JSON.stringify(this.liste, null, 2), { encoding: 'utf8', mode: 0o600 });
  }
}
