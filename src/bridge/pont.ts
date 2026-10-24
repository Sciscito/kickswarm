import { randomBytes } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DetailCellule } from '../coordinator/coordinator.js';
import { makeFusionDepot, makeRecuDepot } from '../protocol/builders.js';
import { blobsDuLivrable, brancheGit, gitBlobSha1 } from '../protocol/depot.js';
import type { Identity } from '../protocol/identity.js';
import type { Hash } from '../protocol/types.js';
import type { CoordinatorClient } from '../plugin/client.js';
import { git, memeDepot, run } from './git.js';

// OSP v0.3 §3.3: the GitHub bridge. It runs on the machine of a member who can write to the
// repository, with their own git and gh logins: the coordinator never holds a credential
// (principle 2). Each cell turned into honey becomes one commit on a kickswarm/… branch, and one
// pull request per branch of the comb (or per cell). A signed receipt then lets anyone check that
// the commit holds exactly the validated deliverable.

/** The code forge (GitHub through `gh`, or a stand-in in the tests). */
export interface Forge {
  /** Opens the branch's pull request, or returns the one already open. */
  ouvrirPr(o: { clone: string; branche: string; base: string; titre: string; corps: string }): Promise<string | null>;
  /** Has a human merged it? */
  etatPr(o: { clone: string; pr: string }): Promise<{ fusionnee: boolean; par?: string; commit?: string } | null>;
}

/** GitHub, with the member's own `gh` login. */
export const GH: Forge = {
  async ouvrirPr({ clone, branche, base, titre, corps }) {
    const ouverte = JSON.parse(await run('gh', clone, ['pr', 'list', '--head', branche, '--state', 'open', '--json', 'url', '--limit', '1'])) as Array<{ url: string }>;
    if (ouverte[0]) return ouverte[0].url;
    const out = await run('gh', clone, ['pr', 'create', '--head', branche, '--base', base, '--title', titre, '--body', corps]);
    return out.trim().split('\n').pop()?.trim() || null;
  },
  async etatPr({ clone, pr }) {
    const v = JSON.parse(await run('gh', clone, ['pr', 'view', pr, '--json', 'state,mergedBy,mergeCommit'])) as {
      state: string;
      mergedBy?: { login?: string } | null;
      mergeCommit?: { oid?: string } | null;
    };
    return v.state === 'MERGED' ? { fusionnee: true, par: v.mergedBy?.login, commit: v.mergeCommit?.oid } : { fusionnee: false };
  },
};

export interface PontOptions {
  client: CoordinatorClient;
  identite: Identity;
  /** The member's local clone of the repository. */
  clone: string;
  remote?: string;
  /** The branch pull requests go into. */
  base?: string;
  /** One pull request per cell instead of one per branch of the comb. */
  parCellule?: boolean;
  /** null: push the branches, open no pull request. */
  forge?: Forge | null;
  log?: (ligne: string) => void;
}

export interface PontRapport {
  commits: Array<{ alveole: Hash; chemin: string; branche: string; commit: string; pr: string | null; recu: Hash }>;
  fusions: Array<{ recu: string; pr: string; par: string }>;
  ignorees: Array<{ alveole: Hash; chemin: string; raison: string }>;
}

/** One pass: every honey cell of the hive without a receipt becomes a commit, then merges are recorded. */
export async function pontUneFois(o: PontOptions): Promise<PontRapport> {
  const remote = o.remote ?? 'origin';
  const forge = o.forge === undefined ? GH : o.forge;
  const log = o.log ?? (() => {});
  const rapport: PontRapport = { commits: [], fusions: [], ignorees: [] };
  const urlRemote = await git(o.clone, ['config', '--get', `remote.${remote}.url`]).catch(() => '');
  if (!urlRemote) throw new Error(`The clone ${o.clone} has no remote “${remote}”`);

  const miels = await o.client.mielsDepot();
  if (!miels.length) return rapport;
  await git(o.clone, ['fetch', '--quiet', remote]);
  // In the order the cells became honey: a later cell on the same file comes after.
  const ordre = new Map<string, number>();
  for (const e of (await o.client.registry()) as Array<{ seq: number; nature: string; donnees: { alveole?: string } }>) {
    if (e.nature === 'alveole_miel' && e.donnees.alveole) ordre.set(e.donnees.alveole, e.seq);
  }
  const rang = (id: string) => ordre.get(id) ?? Number.MAX_SAFE_INTEGER;
  const aFaire = miels.filter((m) => m.recus === 0).sort((a, b) => rang(a.id) - rang(b.id) || a.chemin.localeCompare(b.chemin));
  const titres = new Map<string, string>();

  for (const m of aFaire) {
    const d = await o.client.cellule(m.id);
    const depot = d.cell.depot!;
    if (!memeDepot(depot.url, urlRemote)) {
      rapport.ignorees.push({ alveole: m.id, chemin: m.chemin, raison: `for ${depot.url}, this clone is ${urlRemote}` });
      continue;
    }
    if (!d.resultat) continue;
    const branche = brancheGit(d.cell.ruche, d.cell.chemin, o.parCellule ?? false);
    const fait = await appliquer(o.clone, remote, d, branche);
    log(`${fait.reutilise ? 'Found' : 'Pushed'} ${fait.commit.slice(0, 10)} on ${branche}: cell ${d.cell.chemin}, “${d.cell.objectif.slice(0, 60)}”`);
    let pr: string | null = null;
    if (forge) {
      try {
        pr = await forge.ouvrirPr({ clone: o.clone, branche, base: o.base ?? 'main', titre: await titrePr(o.client, d, o.parCellule ?? false, titres), corps: corpsPr(d) });
        if (pr) log(`Pull request: ${pr}`);
      } catch (e) {
        log(`No pull request for ${branche}: ${(e as Error).message}`);
      }
    }
    const recu = makeRecuDepot(o.identite, {
      alveole: m.id,
      resultat: d.resultat.id,
      depot: depot.url,
      branche,
      commit: fait.commit,
      parent: fait.parent,
      fichiers: blobsDuLivrable(d.resultat.livrable),
      supprimes: [...(d.resultat.livrable.supprimes ?? [])].sort(),
      pr,
    });
    const r = await o.client.recuDepot(recu);
    rapport.commits.push({ alveole: m.id, chemin: m.chemin, branche, commit: fait.commit, pr, recu: r.recu });
  }

  // Merges: the pull requests a human merged since the last pass.
  if (forge) {
    for (const m of miels) {
      const d = await o.client.cellule(m.id);
      for (const r of d.recus) {
        if (!r.pr || r.fusion) continue;
        const etat = await forge.etatPr({ clone: o.clone, pr: r.pr }).catch(() => null);
        if (!etat?.fusionnee || !etat.par || !etat.commit) continue;
        try {
          await o.client.fusionDepot(makeFusionDepot(o.identite, { recu: r.id as Hash, pr: r.pr, fusionnee_par: etat.par, commit_fusion: etat.commit }));
          rapport.fusions.push({ recu: r.id, pr: r.pr, par: etat.par });
          log(`Merged by ${etat.par}: ${r.pr}`);
        } catch (e) {
          // Several receipts can share one pull request (one per branch): the first one records the merge.
          if ((e as { status?: number }).status !== 409) throw e;
        }
      }
    }
  }
  return rapport;
}

/** Follows the hive: a pass now, then one every `intervalleMs`, until the signal stops it. */
export async function suivrePont(o: PontOptions & { intervalleMs?: number; signal?: AbortSignal }): Promise<void> {
  const log = o.log ?? (() => {});
  while (!o.signal?.aborted) {
    try {
      await pontUneFois(o);
    } catch (e) {
      log(`Bridge pass failed, next try soon: ${(e as Error).message}`);
    }
    await new Promise<void>((resolve) => {
      const t = setTimeout(resolve, o.intervalleMs ?? 30_000);
      o.signal?.addEventListener('abort', () => (clearTimeout(t), resolve()), { once: true });
    });
  }
}

/**
 * Writes the deliverable as one commit, with git's plumbing and a temporary index: the member's
 * working tree, index and current branch are never touched. Files are written byte for byte.
 */
async function appliquer(clone: string, remote: string, d: DetailCellule, branche: string): Promise<{ commit: string; parent: string; reutilise: boolean }> {
  const depot = d.cell.depot!;
  const livrable = d.resultat!.livrable;
  const suivi = `refs/remotes/${remote}/${branche}`;
  const tete = await git(clone, ['rev-parse', '--verify', '--quiet', `${suivi}^{commit}`]).catch(() => '');
  // Already pushed by an earlier pass that could not write its receipt: reuse that commit.
  if (tete) {
    const deja = await git(clone, ['log', suivi, '-n', '1', '--format=%H %P', '--fixed-strings', `--grep=Kickswarm-Cell: ${d.cell.chemin} ${d.resultat!.id}`]);
    if (deja) {
      const [commit, parent] = deja.split(' ');
      return { commit: commit!, parent: parent!, reutilise: true };
    }
  }
  let parent = tete;
  if (!parent) {
    const present = await git(clone, ['cat-file', '-e', `${depot.commit}^{commit}`]).then(() => true, () => false);
    if (!present) await git(clone, ['fetch', '--quiet', remote, depot.commit]);
    parent = depot.commit;
  }
  const index = join(tmpdir(), `kickswarm-index-${randomBytes(6).toString('hex')}`);
  const env = { GIT_INDEX_FILE: index };
  try {
    await git(clone, ['read-tree', parent], { env });
    const chemins = Object.keys(livrable.fichiers).sort();
    const modes = new Map<string, string>();
    if (chemins.length) {
      for (const l of (await git(clone, ['ls-tree', '-r', parent, '--', ...chemins])).split('\n').filter(Boolean)) {
        const [meta, chemin] = l.split('\t');
        modes.set(chemin ?? '', (meta ?? '').split(' ')[0] ?? '100644');
      }
    }
    for (const chemin of chemins) {
      const contenu = livrable.fichiers[chemin]!;
      const blob = await git(clone, ['hash-object', '-w', '--no-filters', '--stdin'], { input: contenu });
      if (blob !== gitBlobSha1(contenu)) throw new Error(`git stored ${chemin} differently from the deliverable`);
      const mode = modes.get(chemin) === '100755' ? '100755' : '100644';
      await git(clone, ['update-index', '--add', '--cacheinfo', `${mode},${blob},${chemin}`], { env });
    }
    for (const chemin of livrable.supprimes ?? []) await git(clone, ['update-index', '--force-remove', '--', chemin], { env });
    const arbre = await git(clone, ['write-tree'], { env });
    const commit = await git(clone, ['commit-tree', arbre, '-p', parent, '-F', '-'], { input: messageCommit(d) });
    await git(clone, ['push', '--quiet', remote, `${commit}:refs/heads/${branche}`]);
    await git(clone, ['update-ref', suivi, commit]);
    return { commit, parent, reutilise: false };
  } finally {
    await rm(index, { force: true });
  }
}

/** The commit message: the cell, the result, what verified it, and the credits (§3.3, point 3). */
export function messageCommit(d: DetailCellule): string {
  const r = d.resultat!;
  const premiere = d.cell.objectif.split('\n')[0]!.trim();
  const titre = premiere.length > 66 ? `${premiere.slice(0, 65)}…` : premiere;
  const crit = d.cell.critere_fini;
  const n = r.validee_par.length;
  const verif = `${crit.verificateur} (V0 tests${crit.verificateur === 'tests-js@1' && crit.tests_caches_hash ? ' and hidden tests' : ''})${n ? `, then ${n} guard${n > 1 ? 's' : ''}` : ''}`;
  const credits = [
    d.github ? `Co-authored-by: ${d.github} <${d.github}@users.noreply.github.com>` : undefined,
    `AI: ${r.agent.famille}${r.agent.modele ? ` (${r.agent.modele})` : ''}`,
    `Kickswarm-Author: ${r.auteur}`,
    `Kickswarm-Cell: ${d.cell.chemin} ${r.id}`,
  ].filter(Boolean);
  return [
    `kickswarm(${d.cell.chemin}): ${titre}`,
    '',
    `Cell ${d.cell.chemin} of the hive “${d.cell.ruche}”, turned into honey.`,
    `Verified by: ${verif}.`,
    `Base commit: ${d.cell.depot!.commit}`,
    '',
    ...credits,
    '',
  ].join('\n');
}

async function titrePr(client: CoordinatorClient, d: DetailCellule, parCellule: boolean, cache: Map<string, string>): Promise<string> {
  if (parCellule) return `Kickswarm ${d.cell.chemin}: ${d.cell.objectif.split('\n')[0]!.slice(0, 80)}`;
  const b = d.cell.chemin.split('.')[0]!;
  const cle = `${d.cell.ruche}/${b}`;
  if (!cache.has(cle)) {
    const h = await client.hive(d.cell.ruche).catch(() => null);
    const racine = h?.alveoles.find((a) => a.chemin === b);
    cache.set(cle, `Kickswarm · ${h?.ruche.nom ?? d.cell.ruche}, branch ${b}${racine ? `: ${racine.objectif.split('\n')[0]!.slice(0, 70)}` : ''}`);
  }
  return cache.get(cle)!;
}

function corpsPr(d: DetailCellule): string {
  return [
    `Honey from the Kickswarm hive “${d.cell.ruche}”. Each commit is one cell, verified before this pull request existed.`,
    '',
    'Every commit has a signed receipt in the hive\'s registry. Any member can check that it holds exactly the validated deliverable, nothing more:',
    '',
    '```',
    'kickswarm audit --hive <hive id> --clone <path to your clone>',
    '```',
    '',
    'Your CI runs as usual. Merging is your decision: the bridge records it in the registry.',
  ].join('\n');
}
