import { commitment } from '../../protocol/canonical.js';
import type { CellSpec, CritereV0, Propriete, Secrets, TestCase } from '../../protocol/types.js';

// Launch projects (docs/projets.md): hives prepared down to their first split, with tests, hidden tests
// and reference implementations, so that `kickswarm launch <project>` opens real work at once.

export interface ProjetLancement {
  slug: string;
  nom: string;
  objectif: string;
  racine: CellSpec;
  enfants: CellSpec[];
  /** Hidden tests and references, in the order of the children (sent next to the split, never inside it). */
  secrets: Secrets[];
}

/** A worker cell with its visible tests, hidden tests and reference: the commitments go into the criterion. */
export function cellule(o: {
  objectif: string;
  capsule: string;
  module: string;
  tests: TestCase[];
  caches?: TestCase[];
  proprietes?: Propriete[];
  reference?: string;
}): { spec: CellSpec; secrets: Secrets } {
  const secrets: Secrets = {
    ...(o.caches?.length ? { tests_caches: o.caches } : {}),
    ...(o.reference ? { reference: { fichiers: { [o.module]: o.reference } } } : {}),
  };
  const critere: CritereV0 = {
    classe: 'V0',
    verificateur: 'tests-js@1',
    module: o.module,
    tests: o.tests,
    ...(o.proprietes?.length ? { proprietes: o.proprietes } : {}),
    ...(secrets.tests_caches ? { tests_caches_hash: commitment(secrets.tests_caches) } : {}),
    ...(secrets.reference ? { reference_hash: commitment(secrets.reference) } : {}),
  };
  return { spec: { objectif: o.objectif, capsule: o.capsule, atomique: true, critere_fini: critere }, secrets };
}
