import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Verdict } from '../protocol/types.js';

// Sealed verdicts (OSP v0.2, P1-3): the commitment has been sent, the verdict waits until every
// guard of the result has committed. They are kept on disk, salt included: a guard that does not
// reveal in time loses more reputation than with the worst verdict.

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
