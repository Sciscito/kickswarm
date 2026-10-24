import type { Coordinator } from '../coordinator/coordinator.js';
import { makeDecomposition, makeRequete, makeResult, makeVerdict } from '../protocol/builders.js';
import type { Identity } from '../protocol/identity.js';
import type { Assignment, Caste, CellSpec, Decomposition, Hash, Livrable, Result, Secrets, Verdict } from '../protocol/types.js';
import type { CoordinatorClient } from '../plugin/client.js';
import { verifierV0 } from '../verifier/v0.js';

// Scripted bees: they claim work and do it like an agent would, but from a known script
// (decompositions and solutions). Used by the demos and the tests. Real contributors use the MCP plugin.

export interface BeeScript {
  /** Decomposition for each non-atomic cell, keyed by the cell's objective. */
  decompositions: Record<string, CellSpec[]>;
  /** Correct code for each module. */
  solutions: Record<string, string>;
  /** Wrong code, used when a bee is told to deliver a bug. */
  bugs?: Record<string, string>;
  /** Hidden tests and references sent with each decomposition, keyed by the parent's objective. */
  secrets?: Record<string, Array<Secrets | undefined>>;
}

/** Same work loop, whether the bee talks to an in-process coordinator or over HTTP. */
export interface HiveAccess {
  identite: Identity;
  claim(): Promise<Assignment | null>;
  start(alveole: Hash): Promise<unknown>;
  submit(resultat: Result, livrable: Livrable): Promise<{ statut: string; rapport: { motif: string } }>;
  decompose(d: Decomposition, secrets?: Array<Secrets | undefined>): Promise<{ statut: string; decoupage: Hash }>;
  verdict(v: Verdict): Promise<{ statut: string; piege?: boolean; correct?: boolean | null; renverse?: boolean }>;
}

export function directAccess(c: Coordinator, identite: Identity, ruche?: string): HiveAccess {
  return {
    identite,
    claim: () => c.reclamer(makeRequete(identite, 'claim', ruche ? { ruche } : {})),
    start: async (alveole) => c.start(makeRequete(identite, 'start', { alveole })),
    submit: (r, l) => c.submitResult(r, l),
    decompose: (d, secrets) => c.submitDecomposition(d, secrets),
    verdict: (v) => c.submitVerdict(v),
  };
}

export function httpAccess(client: CoordinatorClient, ruche?: string): HiveAccess {
  return {
    identite: client.identite,
    claim: () => client.claim(ruche),
    start: (alveole) => client.start(alveole),
    submit: (r, l) => client.submit(r, l),
    decompose: (d, secrets) => client.decompose(d, secrets),
    verdict: (v) => client.verdict(v),
  };
}

export type Outcome =
  | 'decomposition_proposed'
  | 'decomposition_adopted'
  | 'delivered'
  | 'rejected'
  | 'assembled'
  | 'assembly_rejected'
  | 'verified'
  | 'confirmed'
  | 'fake_caught'
  | 'overturned'
  | 'trap_caught'
  | 'trap_missed';

export interface BeeAction {
  caste: Caste;
  chemin: string;
  objectif: string;
  outcome: Outcome;
  motif?: string;
  decoupage?: Hash;
}

/** The builder merges the children's files and re-exports each child's module from `module`. */
export function assemble(enfants: Array<{ module: string; livrable: Livrable }>, module: string): Livrable {
  const fichiers: Record<string, string> = {};
  for (const e of enfants) Object.assign(fichiers, e.livrable.fichiers);
  fichiers[module] = enfants.map((e) => `export * from './${e.module}';`).join('\n') + '\n';
  return { fichiers };
}

export async function scriptedBee(
  h: HiveAccess,
  script: BeeScript,
  opts: { bug?: boolean; pause?: (caste: Caste) => Promise<void> } = {},
): Promise<BeeAction | null> {
  const a = await h.claim();
  if (!a) return null;
  const base = { caste: a.caste, chemin: a.alveole.chemin, objectif: a.alveole.objectif };
  if (a.caste !== 'gardienne') await h.start(a.alveole_id);
  if (opts.pause) await opts.pause(a.caste);

  switch (a.caste) {
    case 'eclaireuse': {
      const enfants = script.decompositions[a.alveole.objectif];
      if (!enfants) throw new Error(`No scripted decomposition for “${a.alveole.objectif}”`);
      const r = await h.decompose(makeDecomposition(h.identite, a.alveole_id, enfants), script.secrets?.[a.alveole.objectif]);
      return { ...base, outcome: r.statut === 'adopte' ? 'decomposition_adopted' : 'decomposition_proposed', decoupage: r.decoupage };
    }
    case 'ouvriere': {
      const crit = a.alveole.critere_fini;
      const mod = crit.verificateur === 'tests-js@1' ? (crit.module ?? 'solution.mjs') : 'tests.json';
      const fns = crit.verificateur === 'tests-js@1' ? [...new Set([...crit.tests.map((t) => t.fn), ...(crit.proprietes ?? []).map((p) => p.fn)])] : crit.fonctions;
      const wrong = fns.map((f) => `export function ${f}() { return -1; }`).join('\n');
      const code = opts.bug ? (script.bugs?.[mod] ?? wrong) : (script.solutions[mod] ?? wrong);
      const livrable: Livrable = { fichiers: { [mod]: code } };
      const r = await h.submit(makeResult(h.identite, a.alveole_id, 'ouvriere', livrable, { agent: { famille: 'script' } }), livrable);
      return { ...base, outcome: r.statut === 'rejete' ? 'rejected' : 'delivered', motif: r.rapport.motif };
    }
    case 'batisseuse': {
      const crit = a.alveole.critere_fini;
      const livrable = assemble(a.enfants_valides ?? [], crit.verificateur === 'tests-js@1' ? (crit.module ?? 'solution.mjs') : crit.module);
      const r = await h.submit(makeResult(h.identite, a.alveole_id, 'batisseuse', livrable, { agent: { famille: 'script' } }), livrable);
      return { ...base, outcome: r.statut === 'rejete' ? 'assembly_rejected' : 'assembled', motif: r.rapport.motif };
    }
    case 'gardienne': {
      const cible = a.a_verifier!;
      const rejeu = await verifierV0(a.alveole.critere_fini, cible.livrable, { sansCaches: true });
      const r = await h.verdict(makeVerdict(h.identite, cible.id, rejeu.ok ? 'valide' : 'rejete', rejeu.motif));
      if (r.piege) return { ...base, outcome: r.correct ? 'trap_caught' : 'trap_missed' };
      const outcome: Outcome = r.statut === 'miel' ? 'verified' : r.statut === 'rejete' ? 'fake_caught' : r.renverse ? 'overturned' : 'confirmed';
      return { ...base, outcome, motif: rejeu.motif };
    }
  }
}
