import { createHash, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeDecision, makeDecomposition, makeHive, makeRequete } from '../protocol/builders.js';
import { generateIdentity, type Identity } from '../protocol/identity.js';
import type { Cadrage } from '../taches/cadrage.js';
import { OspError, type Coordinator } from './coordinator.js';

// A creator's own coordinator (docs/host-your-hive.md). The creator never handles keys: the owner's
// identity is made on the server, in the data folder, and is the coordinator's founder and the owner of
// every hive the creator opens. The creator acts from the creation page (/create) with the owner code
// chosen when the server was deployed. Everything the owner signs goes to the registry like any
// decision, so the audit checks it the same way.

export const FICHIER_PROPRIETAIRE = 'proprietaire.json';
/** Long enough that guessing it is hopeless, even without the guard's limit on wrong tries. */
export const CODE_MIN = 16;

const empreinte = (code: string) => createHash('sha256').update(code, 'utf8').digest();

export class Proprietaire {
  readonly identite: Identity;
  private readonly attendu: Buffer;

  constructor(dataDir: string, code: string) {
    if (code.length < CODE_MIN) throw new Error(`The owner code must have at least ${CODE_MIN} characters`);
    mkdirSync(dataDir, { recursive: true });
    const fichier = join(dataDir, FICHIER_PROPRIETAIRE);
    if (existsSync(fichier)) this.identite = JSON.parse(readFileSync(fichier, 'utf8')) as Identity;
    else {
      this.identite = generateIdentity();
      writeFileSync(fichier, JSON.stringify(this.identite, null, 2), { mode: 0o600 });
    }
    this.attendu = empreinte(code);
  }

  /** Compares in constant time: the answer's delay says nothing about how close a guess was. */
  verifier(code: unknown): boolean {
    return typeof code === 'string' && code.length <= 200 && timingSafeEqual(empreinte(code), this.attendu);
  }
}

/**
 * Opens a framed project, as `kickswarm launch` opens a prepared one: the owner proposes the hive and
 * approves it (they are the founder), takes its heart as the scout, hands in the first plan, and
 * approves it. Each step is a signed command in the registry. The parts are then open to every bee.
 */
export async function ouvrirProjet(coord: Coordinator, moi: Identity, c: Cadrage): Promise<{ slug: string; cellules: number }> {
  if (coord.fondateur !== moi.id) throw new OspError('Only the founder of this coordinator opens projects from the creation page', 403);
  if (coord.listHives().some((h) => h.slug === c.slug)) throw new OspError(`A project named “${c.slug}” already exists here: pick another name`, 409);
  coord.proposeHive(makeHive(moi, { slug: c.slug, nom: c.nom, objectif: c.objectif, ...(c.playbook ? { playbook: c.playbook } : {}) }), c.racine);
  coord.decide(makeDecision(moi, 'approbation_ruche', c.slug, 'Opened by its creator from the creation page'));
  const a = await coord.reclamer(makeRequete(moi, 'claim', { ruche: c.slug, castes: ['eclaireuse'] }));
  if (!a || a.caste !== 'eclaireuse') throw new OspError('The heart of the project could not be taken to hand in its plan', 500);
  coord.start(makeRequete(moi, 'start', { alveole: a.alveole_id }));
  const d = await coord.submitDecomposition(makeDecomposition(moi, a.alveole_id, c.enfants));
  if (d.statut === 'en_attente_porteur') coord.decide(makeDecision(moi, 'approbation_decoupage', d.decoupage, 'First plan, drafted with the creator’s AI'));
  return { slug: c.slug, cellules: c.enfants.length };
}
