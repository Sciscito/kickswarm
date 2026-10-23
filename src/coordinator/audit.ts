import { commitment } from '../protocol/canonical.js';
import type { ContributorId, Hash, Livrable, Result, TestCase, Verdict } from '../protocol/types.js';
import { verifierV0 } from '../verifier/v0.js';
import { Coordinator, type CommandeDonnees } from './coordinator.js';
import { COMMUN } from './ledger.js';
import type { Params } from './params.js';
import { verifyRegistry, type RegistryEntry } from './registry.js';

// L'auditeur (OSP v0.2, §6) : n'importe qui peut rejouer le registre public depuis zéro, avec le
// même code de référence, et vérifier que chaque entrée découle des objets signés qu'il contient,
// que l'état final est celui qu'annonce le coordinateur, et que les invariants tiennent.

export interface AuditCheck {
  nom: string;
  ok: boolean;
  detail?: string;
}

export interface AuditReport {
  ok: boolean;
  entrees: number;
  commandes: number;
  /** Hash de l'état reconstruit par le rejeu. */
  etat?: Hash;
  controles: AuditCheck[];
}

export interface AuditOptions {
  /** Relancer le vérificateur V0 sur chaque livrable, pour vérifier les rapports inscrits. */
  reverifier?: boolean;
  /** Hash d'état annoncé par un coordinateur en ligne, à comparer au rejeu. */
  etatAnnonce?: Hash;
}

interface Lancement {
  fondateur: ContributorId;
  coordinateur: ContributorId;
  pieges?: ContributorId;
  params: Params;
}

const close = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;

function firstDifference(mine: RegistryEntry[], theirs: RegistryEntry[], upto: number): string {
  for (let i = 0; i <= upto; i++) {
    const a = mine[i], b = theirs[i];
    if (a?.hash !== b?.hash) return `entry #${i}: replay produced “${a?.nature ?? 'nothing'}”, registry holds “${b?.nature ?? 'nothing'}”`;
  }
  return `the replay produced ${mine.length - upto - 1} extra entries`;
}

export async function auditRegistry(entries: RegistryEntry[], opts: AuditOptions = {}): Promise<AuditReport> {
  const controles: AuditCheck[] = [];
  const add = (nom: string, ok: boolean, detail?: string) => controles.push({ nom, ok, ...(detail ? { detail } : {}) });
  let commandes = 0;
  const report = (etat?: Hash): AuditReport => ({ ok: controles.every((c) => c.ok), entrees: entries.length, commandes, ...(etat ? { etat } : {}), controles });

  // 1. Le chaînage : aucune entrée modifiée, supprimée ou insérée.
  const chain = verifyRegistry(entries);
  add('Hash chain intact', chain.ok, chain.ok ? undefined : chain.erreur);
  if (!chain.ok) return report();

  // 2. Le lancement annonce le fondateur, les identités publiques du coordinateur et les paramètres.
  const first = entries[0];
  const L = first?.donnees as Lancement | undefined;
  if (!first || first.nature !== 'lancement' || !L?.pieges) {
    add('Launch entry', false, 'the first entry must be a launch announcing the founder, the coordinator and the trap identity');
    return report();
  }
  add('Launch entry', true);

  // 3. Le rejeu : un coordinateur neuf, sans clé privée, reproduit chaque entrée à partir des objets signés.
  const coord = new Coordinator({
    fondateur: L.fondateur,
    params: L.params,
    now: () => Date.parse(first.date),
    replay: { coordinateur: L.coordinateur, pieges: L.pieges },
  });
  let divergence = coord.registry.entries[0]?.hash === first.hash ? undefined : 'the launch entry differs';
  const reverif: string[] = [];
  // Tests cachés révélés à la validation : seuls ceux-là permettent de revérifier une alvéole qui en avait.
  const reveles = new Map<string, TestCase[]>();
  for (const e of entries) {
    const d = e.donnees as { tests_caches?: TestCase[] };
    if (e.nature === 'secrets_reveles' && d.tests_caches) reveles.set(commitment(d.tests_caches), d.tests_caches);
  }
  const nonReveles = { n: 0 };
  for (const e of entries) {
    if (divergence) break;
    if (e.nature !== 'commande') continue;
    commandes++;
    const c = e.donnees as CommandeDonnees;
    if (opts.reverifier) await reverify(coord, c, e.seq, reverif, reveles, nonReveles);
    try {
      await coord.replayCommande(c);
    } catch (err) {
      divergence = `command #${e.seq} (${c.type}) failed on replay: ${(err as Error).message}`;
      break;
    }
    const mine = coord.registry.entries;
    if (mine.length !== e.seq + 1 || mine[e.seq]!.hash !== e.hash) divergence = firstDifference(mine, entries, e.seq);
  }
  if (!divergence && coord.registry.entries.length !== entries.length) {
    divergence = `${entries.length - coord.registry.entries.length} trailing entries are not produced by any command`;
  }
  add('Deterministic replay: every entry follows from the signed inputs', !divergence, divergence);
  if (divergence) return report();

  // 4. Les invariants, sur l'histoire désormais prouvée.
  const auteurs = new Map<string, string>();
  const selfChecks: string[] = [];
  const gagne = new Map<string, { total: number; n: number }>();
  const communIssues: string[] = [];
  let partsCommun = 0;
  let partsAutres = 0;
  for (const e of entries) {
    const d = e.donnees as Record<string, unknown>;
    if (e.nature === 'resultat_soumis') auteurs.set(String(d.id), String(d.auteur));
    if (e.nature === 'verdict' && auteurs.get(String(d.resultat)) === d.gardienne) selfChecks.push(`#${e.seq}`);
    if (e.nature === 'alveole_miel' && Array.isArray(d.gardiennes) && d.gardiennes.includes(d.auteur)) selfChecks.push(`#${e.seq}`);
    if (e.nature === 'miel') {
      const id = String(d.beneficiaire), g = Number(d.grammes);
      const acc = gagne.get(id) ?? { total: 0, n: 0 };
      acc.total += g; acc.n++;
      gagne.set(id, acc);
      const p = Number(d.parts) + Number(d.parts_fondateur), pc = Number(d.parts_commun);
      if (!close(pc, (p * 3) / 7, 0.002)) communIssues.push(`#${e.seq}`);
      partsCommun += pc;
      partsAutres += p;
    }
  }
  add('Nobody verified their own work', selfChecks.length === 0, selfChecks.length ? `violations at ${selfChecks.slice(0, 5).join(', ')}` : undefined);

  const conservation: string[] = [];
  for (const [id, { total, n }] of gagne) {
    const acc = coord.account(id as ContributorId);
    if (!close(acc.miel_gagne, total, 0.001 * n + 1e-9)) conservation.push(`${id.slice(0, 16)}…: account ${acc.miel_gagne} g, registry ${total.toFixed(3)} g`);
  }
  add('Honey earned equals the honey written in the registry', conservation.length === 0, conservation.slice(0, 3).join('; ') || undefined);

  const totalParts = partsCommun + partsAutres;
  const share = totalParts > 0 ? partsCommun / totalParts : 0.3;
  const communCompte = coord.account(COMMUN).parts;
  const communOk = communIssues.length === 0 && (totalParts < 1 || close(share, 0.3, 0.005)) && close(communCompte, partsCommun, 0.001 * (gagne.size + communIssues.length + 1) + 0.01);
  add(
    'The Commons holds 30% of every power share',
    communOk,
    communOk ? `Commons ${(share * 100).toFixed(2)}% of ${totalParts.toFixed(3)} shares` : `bad split at ${communIssues.slice(0, 5).join(', ') || 'global share'}; share ${(share * 100).toFixed(2)}%`,
  );

  if (opts.reverifier) {
    const note = nonReveles.n ? `${nonReveles.n} check(s) skipped: their hidden tests are not revealed yet` : undefined;
    add('Verifier reports reproduced by re-running every deliverable', reverif.length === 0, reverif.slice(0, 3).join('; ') || note);
  }

  const etat = coord.stateHash();
  if (opts.etatAnnonce) add('The live coordinator holds exactly the replayed state', opts.etatAnnonce === etat, opts.etatAnnonce === etat ? undefined : `announced ${opts.etatAnnonce.slice(0, 20)}…, replay ${etat.slice(0, 20)}…`);
  return report(etat);
}

/** Relance le vérificateur V0 sur le livrable d'une commande, avant de la rejouer. */
async function reverify(coord: Coordinator, c: CommandeDonnees, seq: number, issues: string[], reveles: Map<string, TestCase[]>, nonReveles: { n: number }): Promise<void> {
  const recorded = c.verifs?.[0];
  if (!recorded) return;
  let cible: { critere: NonNullable<ReturnType<Coordinator['critereOf']>>; livrable: Livrable } | undefined;
  if (c.type === 'submitResult') {
    const e = c.entree as { resultat: Result; livrable: Livrable };
    const critere = coord.critereOf(e.resultat.alveole);
    if (critere) cible = { critere, livrable: e.livrable };
  } else if (c.type === 'submitVerdict') {
    cible = coord.resultForReverify((c.entree as { verdict: Verdict }).verdict.resultat);
  }
  if (!cible) return;
  let caches: TestCase[] | undefined;
  if (cible.critere.verificateur === 'tests-js@1' && cible.critere.tests_caches_hash) {
    caches = reveles.get(cible.critere.tests_caches_hash);
    if (!caches) {
      nonReveles.n++;
      return;
    }
  }
  const again = await verifierV0(cible.critere, cible.livrable, { caches });
  if (again.ok !== recorded.ok) issues.push(`#${seq}: the registry says ${recorded.ok ? 'passed' : 'failed'}, a fresh run says ${again.ok ? 'passed' : 'failed'} (${again.motif})`);
}
