import type { ContributorId } from '../protocol/types.js';
import type { Params } from './params.js';
import type { Registry } from './registry.js';

/** A contributor's account: spendable honey, power shares, reputation (§10, §18). */
export interface Account {
  miel: number;
  parts: number;
  reputation: number;
  miel_gagne: number;
}

/** The Commons: the shares held by everyone (§18.2). */
export const COMMUN = 'commun';
export type AccountId = ContributorId | typeof COMMUN;

export type ReputationEvent = 'confirme' | 'renverse' | 'bail_expire' | 'piege_valide' | 'resultat_rejete' | 'non_revele';

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

  /** Account to modify: created if it does not exist. Call only inside a command. */
  get(id: AccountId): Account {
    let a = this.accounts[id];
    if (!a) {
      a = this.fresh(id);
      this.accounts[id] = a;
    }
    return a;
  }

  /** Pure read: creates nothing. A mere lookup must never change the state. */
  peek(id: AccountId): Account {
    return { ...(this.accounts[id] ?? this.fresh(id)) };
  }

  private fresh(id: AccountId): Account {
    return { miel: 0, parts: 0, reputation: id === COMMUN ? 1 : this.params.reputation_initiale, miel_gagne: 0 };
  }

  /**
   * Pays out earned honey. 10% crystallizes into shares (§18.2); for each share of the
   * contributor, 3/7 of a share goes to the Commons; for 4 years, 2% of the contributor-side
   * shares go to the founder.
   */
  award(id: ContributorId, grammes: number, raison: string, ruche?: string): void {
    if (grammes <= 0) return;
    const p = this.params;
    const compte = this.get(id);
    // OSP v0.3 §2.6: in a private hive, honey stays local. Two friends validating each other's work
    // in private must not be able to print public power shares.
    const cristallise = p.prive ? 0 : p.taux_cristallisation;
    const liquide = grammes * (1 - cristallise);
    const parts = grammes * cristallise * p.parts_par_gramme;
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
      case 'non_revele':
        a.reputation *= p.facteur_non_revele;
        break;
    }
    a.reputation = Math.round(a.reputation * 10_000) / 10_000;
    return a.reputation;
  }
}
