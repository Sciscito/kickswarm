import type { Coordinator } from '../coordinator/coordinator.js';
import type { Identity } from '../protocol/identity.js';
import type { Caste, CellSpec, CritereV0 } from '../protocol/types.js';
import { directAccess, scriptedBee, type BeeScript, type Outcome } from './scripted-bee.js';

// Une ruche de démonstration : une mini-bibliothèque mathématique en trois fonctions.

export const SOLUTIONS: Record<string, string> = {
  'pgcd.mjs': 'export function pgcd(a, b) { return b === 0 ? Math.abs(a) : pgcd(b, a % b); }\n',
  'premier.mjs':
    'export function estPremier(n) {\n  if (n < 2) return false;\n  for (let d = 2; d * d <= n; d++) if (n % d === 0) return false;\n  return true;\n}\n',
  'fibonacci.mjs': 'export function fibonacci(n) {\n  let a = 0, b = 1;\n  for (let i = 0; i < n; i++) [a, b] = [b, a + b];\n  return a;\n}\n',
};

export const BUGS: Record<string, string> = {
  'premier.mjs': 'export function estPremier(n) { return n % 2 === 1; }\n',
};

const critere = (module: string, tests: CritereV0['tests']): CritereV0 => ({ classe: 'V0', verificateur: 'tests-js@1', module, tests });

export const RACINE: CellSpec = {
  objectif: 'Livrer une mini-bibliothèque mathématique : pgcd, estPremier, fibonacci',
  capsule: 'Bibliothèque ES module. Toutes les fonctions sont exportées depuis solution.mjs.',
  atomique: false,
  critere_fini: critere('solution.mjs', [
    { fn: 'pgcd', args: [12, 18], attendu: 6 },
    { fn: 'estPremier', args: [97], attendu: true },
    { fn: 'estPremier', args: [91], attendu: false },
    { fn: 'fibonacci', args: [10], attendu: 55 },
  ]),
};

export const ENFANTS: CellSpec[] = [
  {
    objectif: 'Écrire pgcd(a, b), le plus grand commun diviseur',
    capsule: 'Algorithme d’Euclide. Module pgcd.mjs.',
    atomique: true,
    critere_fini: critere('pgcd.mjs', [
      { fn: 'pgcd', args: [12, 18], attendu: 6 },
      { fn: 'pgcd', args: [17, 5], attendu: 1 },
      { fn: 'pgcd', args: [0, 9], attendu: 9 },
    ]),
  },
  {
    objectif: 'Écrire estPremier(n)',
    capsule: 'Test de primalité par divisions jusqu’à √n. Module premier.mjs.',
    atomique: true,
    critere_fini: critere('premier.mjs', [
      { fn: 'estPremier', args: [1], attendu: false },
      { fn: 'estPremier', args: [2], attendu: true },
      { fn: 'estPremier', args: [91], attendu: false },
      { fn: 'estPremier', args: [97], attendu: true },
    ]),
  },
  {
    objectif: 'Écrire fibonacci(n)',
    capsule: 'fibonacci(0) = 0, fibonacci(1) = 1. Module fibonacci.mjs.',
    atomique: true,
    critere_fini: critere('fibonacci.mjs', [
      { fn: 'fibonacci', args: [0], attendu: 0 },
      { fn: 'fibonacci', args: [1], attendu: 1 },
      { fn: 'fibonacci', args: [10], attendu: 55 },
    ]),
  },
];

/** Le script de la ruche « maths » pour les abeilles scriptées. */
export const MATHS_SCRIPT: BeeScript = { decompositions: { [RACINE.objectif]: ENFANTS }, solutions: SOLUTIONS, bugs: BUGS };

export interface ActionAbeille {
  caste: Caste;
  chemin: string;
  issue: string;
  piege?: boolean;
}

const ISSUES: Record<Outcome, string> = {
  decomposition_proposed: 'découpage proposé, en attente du porteur',
  decomposition_adopted: 'découpage adopté',
  delivered: 'livré',
  rejected: 'rejeté',
  assembled: 'assemblé',
  assembly_rejected: 'assemblage rejeté',
  sealed: 'verdict scellé, en attente des autres gardiennes',
  verified: 'validé : miel',
  confirmed: 'confirmé, en attente d’une seconde gardienne',
  fake_caught: 'faux résultat démasqué',
  overturned: 'verdict renversé',
  trap_caught: 'alvéole-piège déjouée',
  trap_missed: 'piège validé à tort',
};

/** Une abeille scriptée sur la ruche « maths », branchée directement sur un coordinateur en mémoire. */
export async function abeilleScriptee(c: Coordinator, bee: Identity, opts: { bug?: boolean } = {}): Promise<ActionAbeille | null> {
  const a = await scriptedBee(directAccess(c, bee), MATHS_SCRIPT, opts);
  if (!a) return null;
  const detail = a.outcome === 'rejected' ? ` : ${a.motif}` : a.outcome === 'delivered' || a.outcome === 'assembled' ? ` (${a.motif}), en vérification` : '';
  return { caste: a.caste, chemin: a.chemin, issue: ISSUES[a.outcome] + detail, piege: a.outcome.startsWith('trap') || undefined };
}
