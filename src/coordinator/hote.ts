import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { idRuchePrivee, normaliserCode } from '../protocol/builders.js';
import { sha256 } from '../protocol/canonical.js';
import { isContributorId, verifyObject } from '../protocol/identity.js';
import type { Adhesion, CellSpec, ContributorId, Decision, Hash, Hive, Requete, RolePrive, Secrets } from '../protocol/types.js';
import type { SourceBalise } from './balise.js';
import { Coordinator, OspError } from './coordinator.js';

// The host (OSP v0.3 §2.7): one coordinator holds the public hives, and each private hive runs in a
// coordinator instance of its own, with its own registry, state, vault and data folder. The whole
// trust engine is reused unchanged. The host routes requests, hands out read tickets, and writes the
// head of every private registry into the public one (anchors): the operator is then committed to a
// single history for each private hive, which every member can check.

export interface HoteOptions {
  /** The public coordinator's data folder: private hives live in `prives/<id>/` inside it. */
  dataDir?: string;
  balise?: SourceBalise;
  /** A read ticket lasts this long. */
  dureeTicketMs?: number;
  /** At most this many join attempts per address in `fenetreEssaisMs` (codes must not be guessable). */
  essaisMax?: number;
  fenetreEssaisMs?: number;
}

/** A private hive's defaults (§2.5): a 5% target error rate and one guard, so two members can cross-review. */
const PRIVE_ALPHA = 0.05;
const PRIVE_GARDIENNES = 1;

export class Hote {
  private readonly prives = new Map<string, Coordinator>();
  private readonly tickets = new Map<string, { contributeur: ContributorId; ruche: string; expire: number }>();
  private readonly essais = new Map<string, { n: number; depuis: number }>();
  private readonly ancresDues = new Set<string>();
  private minuteur: NodeJS.Timeout | null = null;

  constructor(
    readonly publique: Coordinator,
    private readonly opts: HoteOptions = {},
  ) {
    // Private hives already on disk come back with the host.
    const dossier = this.dossierPrives();
    if (dossier && existsSync(dossier)) {
      for (const id of readdirSync(dossier)) {
        const meta = join(dossier, id, 'hote.json');
        if (!existsSync(meta)) continue;
        const { fondateur, params } = JSON.parse(readFileSync(meta, 'utf8')) as { fondateur: ContributorId; params: Record<string, unknown> };
        this.brancher(id, new Coordinator({ fondateur, dataDir: join(dossier, id), params, ...(opts.balise ? { balise: opts.balise } : {}) }));
      }
    }
  }

  private dossierPrives(): string | undefined {
    return this.opts.dataDir ? join(this.opts.dataDir, 'prives') : undefined;
  }

  /** Opaque in the public registry: the hash of the private hive's identifier. */
  static cleAncre(id: string): Hash {
    return sha256(`osp.ancre:${id}`);
  }

  private brancher(id: string, c: Coordinator): void {
    this.prives.set(id, c);
    // After a restart, the last anchor already in the public registry: no duplicate for an unchanged head.
    const derniere = this.ancres(id).at(-1);
    if (derniere) this.dernieresAncres.set(id, derniere.tete);
    c.registry.onAppend(() => this.planifierAncre(id));
    this.planifierAncre(id);
  }

  /** Anchors are written just after the private command that changed the head, never during it. */
  private planifierAncre(id: string): void {
    this.ancresDues.add(id);
    this.minuteur ??= setTimeout(() => {
      this.minuteur = null;
      for (const r of this.ancresDues) this.ancrer(r);
      this.ancresDues.clear();
    }, 0);
  }

  private readonly dernieresAncres = new Map<string, Hash>();

  private ancrer(id: string): void {
    const c = this.prives.get(id);
    const tete = c?.registry.entries.at(-1);
    if (!tete || this.dernieresAncres.get(id) === tete.hash) return;
    this.publique.ancrer(Hote.cleAncre(id), tete.seq, tete.hash);
    this.dernieresAncres.set(id, tete.hash);
  }

  /** Writes pending anchors now (tests, and before answering an audit). */
  ancrerMaintenant(): void {
    if (this.minuteur) clearTimeout(this.minuteur);
    this.minuteur = null;
    for (const r of this.ancresDues) this.ancrer(r);
    this.ancresDues.clear();
  }

  /**
   * Creates a private hive: its own instance, launched with the owner as founder and the hive's own
   * guarantee, then the hive itself, approved by its owner's signed decision.
   */
  creer(ruche: Hive, racine: CellSpec, approbation: Decision, secrets?: Secrets): { id: string; slug: string } {
    if (ruche?.type !== 'osp.hive/0.1' || ruche.visibilite !== 'privee') throw new OspError('Expected a private hive (visibilite: "privee")');
    if (!isContributorId(ruche.porteur) || !verifyObject(ruche, ruche.porteur)) throw new OspError('Invalid hive signature', 401);
    if (typeof ruche.sel !== 'string' || ruche.sel.length < 16) throw new OspError('A private hive needs a random salt');
    if (approbation?.nature !== 'approbation_ruche' || approbation.auteur !== ruche.porteur || approbation.cible !== ruche.slug) {
      throw new OspError('The owner approves their own private hive with a signed decision', 400);
    }
    const alpha = ruche.parametres?.alpha_faux ?? PRIVE_ALPHA;
    const gardiennes = ruche.parametres?.gardiennes_v0 ?? PRIVE_GARDIENNES;
    if (!(alpha >= 1e-6 && alpha <= 0.5)) throw new OspError('The target error rate is between 0.000001 and 0.5');
    if (!(Number.isInteger(gardiennes) && gardiennes >= 0 && gardiennes <= 3)) throw new OspError('The guard floor is 0, 1, 2 or 3');
    const id = idRuchePrivee(ruche);
    if (this.prives.has(id)) throw new OspError('This private hive already exists', 409);
    const params = { prive: true, alpha_faux: alpha, gardiennes_v0: gardiennes };
    const dossier = this.dossierPrives() ? join(this.dossierPrives()!, id) : undefined;
    const c = new Coordinator({ fondateur: ruche.porteur, ...(dossier ? { dataDir: dossier } : {}), params, ...(this.opts.balise ? { balise: this.opts.balise } : {}) });
    c.proposeHive(ruche, racine, secrets);
    c.decide(approbation);
    if (dossier) {
      mkdirSync(dossier, { recursive: true });
      writeFileSync(join(dossier, 'hote.json'), JSON.stringify({ fondateur: ruche.porteur, params }, null, 2), 'utf8');
    }
    this.brancher(id, c);
    return { id, slug: ruche.slug };
  }

  instance(id: string): Coordinator {
    const c = this.prives.get(id);
    if (!c) throw new OspError('Unknown private hive', 404);
    return c;
  }

  /** Joins with a code: the host asks each private hive whether the code opens one of its invitations. */
  rejoindre(a: Adhesion, adresse = 'local'): { id: string; slug: string; role: RolePrive } {
    this.compterEssai(adresse);
    const code = normaliserCode(String(a?.code ?? ''));
    for (const [id, c] of this.prives) {
      if (!c.trouverInvitation(code)) continue;
      const r = c.rejoindre(a);
      return { id, slug: r.ruche, role: r.role };
    }
    throw new OspError('Unknown, used or expired invitation code', 404);
  }

  private compterEssai(adresse: string): void {
    const max = this.opts.essaisMax ?? 20;
    const fenetre = this.opts.fenetreEssaisMs ?? 10 * 60_000;
    const now = Date.now();
    const e = this.essais.get(adresse);
    if (!e || now - e.depuis > fenetre) {
      this.essais.set(adresse, { n: 1, depuis: now });
      return;
    }
    if (++e.n > max) throw new OspError('Too many join attempts: wait a few minutes', 429);
  }

  /** A read ticket on a private hive, for one hour: one post-quantum signature per hour, not per read. */
  ticket(id: string, r: Requete): { ticket: string; expire: string } {
    const contributeur = this.instance(id).verifierLecteur(r);
    const ticket = randomBytes(24).toString('base64url');
    const expire = Date.now() + (this.opts.dureeTicketMs ?? 3600_000);
    this.tickets.set(ticket, { contributeur, ruche: id, expire });
    for (const [t, v] of this.tickets) if (v.expire < Date.now()) this.tickets.delete(t);
    return { ticket, expire: new Date(expire).toISOString() };
  }

  /** The member a ticket stands for, if it is valid for this hive and they are still a member. */
  lecteur(id: string, ticket: string | null | undefined): ContributorId {
    const t = ticket ? this.tickets.get(ticket) : undefined;
    if (!t || t.ruche !== id || t.expire < Date.now()) throw new OspError('This hive is private: ask for a read ticket first', 401);
    if (!this.instance(id).membres().some((m) => m.id === t.contributeur)) throw new OspError('You are no longer a member of this hive', 403);
    return t.contributeur;
  }

  /** The anchors of a private hive found in the public registry, for a member's audit. */
  ancres(id: string): Array<{ seq: number; tete: Hash }> {
    const cle = Hote.cleAncre(id);
    return this.publique.registry.entries
      .filter((e) => e.nature === 'ancre' && (e.donnees as { ruche: string }).ruche === cle)
      .map((e) => ({ seq: (e.donnees as { seq: number }).seq, tete: (e.donnees as { tete: Hash }).tete }));
  }
}
