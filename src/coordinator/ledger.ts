import type { ContributorId } from '../protocol/types.js';
import type { Params } from './params.js';
import type { Registry } from './registry.js';

/** Compte d'un contributeur : miel dépensable, parts de puissance, réputation (§10, §18). */
export interface Account {
  miel: number;
  parts: number;
  reputation: number;
  miel_gagne: number;
}

/** Le Commun : les parts détenues par tous (§18.2). */
export const COMMUN = 'commun';
export type AccountId = ContributorId | typeof COMMUN;

export type ReputationEvent = 'confirme' | 'renverse' | 'bail_expire' | 'piege_valide' | 'resultat_rejete';

const round = (x: number) => Math.round(x * 1000) / 1000;

export class Ledger {
  accounts: Record<string, Account> = {};

  constructor(
    private readonly params: Params,
    private readonly fondateur: ContributorId,
    private readonly lancement: number,
    private readonly registry: Registry,
    private readonly now: () => number,
  ) {}

  get(id: AccountId): Account {
    let a = this.accounts[id];
    if (!a) {
      a = { miel: 0, parts: 0, reputation: id === COMMUN ? 1 : this.params.reputation_initiale, miel_gagne: 0 };
      this.accounts[id] = a;
    }
    return a;
  }

  /**
   * Verse du miel gagné. 10 % cristallisent en parts (§18.2) ; pour chaque part du
   * contributeur, 3/7 de part vont au Commun ; pendant 4 ans, 2 % des parts côté
   * contributeur vont au fondateur.
   */
  award(id: ContributorId, grammes: number, raison: string, ruche?: string): void {
    if (grammes <= 0) return;
    const p = this.params;
    const compte = this.get(id);
    const liquide = grammes * (1 - p.taux_cristallisation);
    const parts = grammes * p.taux_cristallisation * p.parts_par_gramme;
    const enPeriodeFondateur = this.now() - this.lancement < p.allocation_fondateur_duree_ms;
    const partFondateur = enPeriodeFondateur ? parts * p.allocation_fondateur : 0;
    const partCommun = parts * p.ratio_commun;

    compte.miel = round(compte.miel + liquide);
    compte.miel_gagne = round(compte.miel_gagne + grammes);
    compte.parts = round(compte.parts + parts - partFondateur);
    if (partFondateur > 0) {
      const f = this.get(this.fondateur);
      f.parts = round(f.parts + partFondateur);
    }
    const commun = this.get(COMMUN);
    commun.parts = round(commun.parts + partCommun);

    this.registry.append('miel', {
      beneficiaire: id,
      grammes: round(grammes),
      raison,
      ruche,
      parts: round(parts - partFondateur),
      parts_commun: round(partCommun),
      parts_fondateur: round(partFondateur),
    });
  }

  reputation(id: ContributorId, event: ReputationEvent): number {
    const p = this.params;
    const a = this.get(id);
    switch (event) {
      case 'confirme':
        a.reputation += p.gain_reputation * (1 - a.reputation);
        break;
      case 'renverse':
        a.reputation *= p.facteur_verdict_renverse;
        break;
      case 'bail_expire':
        a.reputation *= p.facteur_bail_expire;
        break;
      case 'piege_valide':
        a.reputation *= p.facteur_piege_valide;
        break;
      case 'resultat_rejete':
        a.reputation *= p.facteur_resultat_rejete;
        break;
    }
    a.reputation = Math.round(a.reputation * 10_000) / 10_000;
    return a.reputation;
  }
}
