import { git } from './git.js';

/** What the audit needs from a repo receipt to check its commit. */
export interface RecuACommit {
  commit: string;
  parent: string;
  fichiers: Record<string, string>;
  supprimes: string[];
}

/**
 * OSP v0.3 §3.3: checks, in a local clone, that a receipt's commit holds exactly the validated
 * deliverable: built on the stated parent, every file with the right git hash, the deleted files
 * gone, and no other change. Returns null when it does, or what is wrong.
 */
export async function verifierCommit(clone: string, r: RecuACommit): Promise<string | null> {
  const court = r.commit.slice(0, 10);
  try {
    await git(clone, ['cat-file', '-e', `${r.commit}^{commit}`]);
  } catch {
    return `commit ${court} is not in this clone (run git fetch first)`;
  }
  const parents = (await git(clone, ['rev-list', '--parents', '-n', '1', r.commit])).split(' ').slice(1);
  if (parents.length !== 1 || parents[0] !== r.parent) return `commit ${court} is not built on ${r.parent.slice(0, 10)} alone`;
  const changes = (await git(clone, ['diff-tree', '-r', '--no-commit-id', '--name-status', '--no-renames', r.parent, r.commit]))
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      const [statut, ...chemin] = l.split('\t');
      return { statut: statut ?? '', chemin: chemin.join('\t') };
    });
  const supprimes = new Set(r.supprimes);
  const glisses = changes.filter((c) => (c.statut === 'D' ? !supprimes.has(c.chemin) : !(c.chemin in r.fichiers)));
  if (glisses.length) return `commit ${court} changes files outside the deliverable: ${glisses.slice(0, 5).map((c) => c.chemin).join(', ')}`;
  const chemins = [...Object.keys(r.fichiers), ...r.supprimes];
  const arbre = new Map<string, string>();
  if (chemins.length) {
    for (const l of (await git(clone, ['ls-tree', '-r', r.commit, '--', ...chemins])).split('\n').filter(Boolean)) {
      const [meta, chemin] = l.split('\t');
      arbre.set(chemin ?? '', (meta ?? '').split(' ')[2] ?? '');
    }
  }
  for (const [chemin, blob] of Object.entries(r.fichiers)) {
    if (arbre.get(chemin) !== blob) return `in commit ${court}, ${chemin} is not the validated file`;
  }
  for (const chemin of r.supprimes) if (arbre.has(chemin)) return `in commit ${court}, ${chemin} should be deleted`;
  return null;
}
