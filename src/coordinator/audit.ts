import { algoOf, isPostQuantum, verifyObject } from '../protocol/identity.js';
import { canonicalize, commitment, hashOf } from '../protocol/canonical.js';
import { blobsDuLivrable } from '../protocol/depot.js';
import type { ContributorId, EngagementVerdict, FusionDepot, Hash, Livrable, RecuDepot, Result, TestCase, Verdict } from '../protocol/types.js';
import { mutants } from '../verifier/mutation.js';
import { verifierV0 } from '../verifier/v0.js';
import { QUICKNET } from './balise.js';
import { Coordinator, type BaliseAnnoncee, type CommandeDonnees } from './coordinator.js';
import { COMMUN } from './ledger.js';
import type { Params } from './params.js';
import { verifyRegistry, type RegistryEntry } from './registry.js';

// The auditor (OSP v0.2, §6): anyone can replay the public registry from scratch, with the
// same reference code, and check that every entry follows from the signed objects it contains,
// that the final state is the one the coordinator announces, and that the invariants hold.

export interface AuditCheck {
  nom: string;
  ok: boolean;
  detail?: string;
}

export interface AuditReport {
  ok: boolean;
  entrees: number;
  commandes: number;
  /** Hash of the state rebuilt by the replay. */
  etat?: Hash;
  controles: AuditCheck[];
}

export interface AuditOptions {
  /** Re-run the V0 verifier on every deliverable, to check the recorded reports. */
  reverifier?: boolean;
  /** State hash announced by a live coordinator, to compare with the replay. */
  etatAnnonce?: Hash;
  /** For a private hive's registry: its anchors found in the public registry (OSP v0.3 §2.4). */
  ancres?: Array<{ seq: number; tete: Hash }>;
  /**
   * OSP v0.3 §3.3: checks a repo receipt's commit in a local clone of the repository
   * (see bridge/verifier.ts). Returns null when the commit holds exactly the deliverable.
   */
  verifierCommit?: (r: RecuDepot) => Promise<string | null>;
}

interface Lancement {
  fondateur: ContributorId;
  coordinateur: ContributorId;
  pieges?: ContributorId;
  params: Params;
  balise?: BaliseAnnoncee;
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

  // 1. The chain: no entry modified, deleted or inserted.
  const chain = verifyRegistry(entries);
  add('Hash chain intact', chain.ok, chain.ok ? undefined : chain.erreur);
  if (!chain.ok) return report();

  if (opts.ancres) {
    // OSP v0.3 §2.4: every public anchor of this private hive must point into this very history.
    // Checked before the replay: a rewritten history must be caught even when it no longer replays.
    const faux = opts.ancres.filter((a) => entries[a.seq]?.hash !== a.tete);
    const derniere = opts.ancres.reduce((m, a) => Math.max(m, a.seq), -1);
    add(
      'Matches the public anchors of this private hive',
      opts.ancres.length > 0 && faux.length === 0,
      !opts.ancres.length
        ? 'no anchor found in the public registry'
        : faux.length
          ? `${faux.length} anchor(s) point to a different history: ${faux.slice(0, 3).map((a) => `#${a.seq}`).join(', ')}`
          : `${opts.ancres.length} anchor(s) in the public registry, the last one covering entry #${derniere} of ${entries.length - 1}`,
    );
  }

  // 2. The launch announces the founder, the coordinator's public identities and the parameters.
  const first = entries[0];
  const L = first?.donnees as Lancement | undefined;
  if (!first || first.nature !== 'lancement' || !L?.pieges) {
    add('Launch entry', false, 'the first entry must be a launch announcing the founder, the coordinator and the trap identity');
    return report();
  }
  add('Launch entry', true);

  // 3. The replay: a fresh coordinator, with no private key, reproduces every entry from the signed objects.
  const coord = new Coordinator({
    fondateur: L.fondateur,
    params: L.params,
    now: () => Date.parse(first.date),
    replay: { coordinateur: L.coordinateur, pieges: L.pieges, ...(L.balise ? { balise: L.balise } : {}) },
  });
  let divergence = coord.registry.entries[0]?.hash === first.hash ? undefined : 'the launch entry differs';
  const reverif: string[] = [];
  // Hidden tests revealed at validation: only those allow re-verifying a cell that had some.
  const reveles = new Map<string, TestCase[]>();
  for (const e of entries) {
    const d = e.donnees as { tests_caches?: TestCase[] };
    if (e.nature === 'secrets_reveles' && d.tests_caches) reveles.set(commitment(d.tests_caches), d.tests_caches);
  }
  const nonReveles: { n: number; sandbox?: string } = { n: 0 };
  const sceaux = { n: 0, invalides: [] as string[], dernier: -1 };
  for (const e of entries) {
    if (divergence) break;
    if (e.nature === 'sceau') {
      // The seal: the coordinator's post-quantum signature on the registry head.
      const sc = e.donnees as { type: string; coordinateur: string; seq: number; tete: string };
      const prev = entries[e.seq - 1];
      const valide = sc.type === 'osp.sceau/0.1' && sc.coordinateur === L.coordinateur && prev !== undefined && sc.seq === prev.seq && sc.tete === prev.hash && verifyObject(sc, L.coordinateur);
      if (!valide) {
        sceaux.invalides.push(`#${e.seq}`);
        divergence = `seal #${e.seq} is invalid`;
        break;
      }
      sceaux.n++;
      sceaux.dernier = sc.seq;
      try {
        coord.importSceau(e.date, sc);
      } catch (err) {
        divergence = `seal #${e.seq} could not be replayed: ${(err as Error).message}`;
        break;
      }
      const mine = coord.registry.entries;
      if (mine.length !== e.seq + 1 || mine[e.seq]!.hash !== e.hash) divergence = firstDifference(mine, entries, e.seq);
      continue;
    }
    if (e.nature === 'ancre') {
      // OSP v0.3 §2.4: the head of a private hive's registry. Opaque here; each member checks it against their copy.
      coord.importAncre(e.date, e.donnees as { ruche: Hash; seq: number; tete: Hash });
      const mine = coord.registry.entries;
      if (mine.length !== e.seq + 1 || mine[e.seq]!.hash !== e.hash) divergence = firstDifference(mine, entries, e.seq);
      continue;
    }
    if (e.nature !== 'commande') continue;
    commandes++;
    const c = e.donnees as CommandeDonnees;
    if (opts.reverifier) await reverify(coord, c, e.seq, reverif, reveles, nonReveles, L.params.pieges_essais, L.params.moteur_mutation ?? 1);
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
  if (divergence) {
    if (sceaux.invalides.length) add('Registry sealed by the coordinator', false, `invalid seal at ${sceaux.invalides.join(', ')}`);
    return report();
  }

  // 3a. The seals: who vouches for the registry, with which cryptography, and up to where.
  const contenu = entries.filter((e) => e.nature !== 'sceau');
  const derniereEntree = contenu.length ? contenu[contenu.length - 1]!.seq : -1;
  const nonScelles = sceaux.dernier < 0 ? contenu.length : contenu.filter((e) => e.seq > sceaux.dernier).length;
  const algo = algoOf(L.coordinateur);
  add(
    'Registry sealed by the coordinator with a post-quantum signature',
    sceaux.n > 0 && isPostQuantum(L.coordinateur),
    sceaux.n === 0
      ? 'no seal found'
      : `${sceaux.n} seal(s) by ${algo === 'slh1' ? 'SLH-DSA-SHA2-128f (FIPS 205)' : algo}; the last one covers entry #${sceaux.dernier}${nonScelles ? `, ${nonScelles} newer entr${nonScelles > 1 ? 'ies' : 'y'} not sealed yet (up to #${derniereEntree})` : ''}`,
  );

  // P1-3: do the draws come from a public beacon that nobody controls?
  const claims = entries.filter((e) => e.nature === 'commande' && (e.donnees as CommandeDonnees).type === 'claim');
  const avecBalise = claims.filter((e) => (e.donnees as CommandeDonnees).balise).length;
  if (!L.balise) {
    add('Random draws from a public beacon', true, 'off: the coordinator draws its own random numbers (start it with the drand beacon to make every draw verifiable)');
  } else {
    const officielle = L.balise.chaine === QUICKNET.chaine && L.balise.cle_publique === QUICKNET.cle_publique;
    const manque = claims.length - avecBalise;
    add(
      'Random draws from a public beacon',
      manque === 0,
      manque
        ? `${manque} work request(s) drawn without the announced beacon`
        : `${avecBalise} draw(s), each from a BLS-verified round ${L.balise.decalage} rounds after the signed request, on ${officielle ? 'the League of Entropy drand network (quicknet)' : `a private beacon (${L.balise.chaine}), not the public drand network`}`,
    );
  }

  // P1-3: every revealed verdict matches a signed commitment, written before it.
  // Recomputed here from the signed objects alone, independently of the coordinator's logic.
  const engages = new Map<string, Hash>();
  const sansEngagement: string[] = [];
  let nVerdicts = 0;
  for (const e of entries) {
    if (e.nature !== 'commande') continue;
    const c = e.donnees as CommandeDonnees;
    if (c.type === 'engageVerdict') {
      const en = (c.entree as { engagement: EngagementVerdict }).engagement;
      if (verifyObject(en, en.gardienne)) engages.set(`${en.resultat}|${en.gardienne}`, en.engagement);
    } else if (c.type === 'submitVerdict') {
      const v = (c.entree as { verdict: Verdict }).verdict;
      const cle = `${v.resultat}|${v.gardienne}`;
      if (engages.get(cle) !== hashOf(v) || typeof v.sel !== 'string' || v.sel.length < 64) sansEngagement.push(`#${e.seq}`);
      engages.delete(cle);
      nVerdicts++;
    }
  }
  const expires = entries.filter((e) => e.nature === 'engagement_expire').length;
  const scelles = Math.max(0, engages.size - expires);
  add(
    'Guards committed to their verdicts before any was revealed',
    sansEngagement.length === 0,
    sansEngagement.length
      ? `${sansEngagement.length} verdict(s) revealed without a matching earlier commitment: ${sansEngagement.slice(0, 5).join(', ')}`
      : nVerdicts
        ? `${nVerdicts} verdict(s), each matching a signed, salted commitment written before it; the replay enforces that none was revealed while another guard of the same result was still deciding` +
          `${expires ? `; ${expires} commitment(s) never revealed, penalized` : ''}${scelles ? `; ${scelles} still sealed` : ''}`
        : 'no verdict yet',
  );

  // P0-3: are traps drawn at the announced rate for each guard? The replay recomputed every
  // draw (rate based on the reputation at that moment, mutant picked among those of the real deliverable); we compare the
  // number of traps with its expected value, to expose a coordinator that would overuse or spare them.
  const tirages = coord.journalPieges;
  const attendu = tirages.reduce((s, t) => s + t.taux, 0);
  const variance = tirages.reduce((s, t) => s + t.taux * (1 - t.taux), 0);
  const observes = tirages.filter((t) => t.piege).length;
  const z = variance > 0 ? (observes - attendu) / Math.sqrt(variance) : 0;
  add(
    'Trap cells drawn at each guard’s announced rate',
    Math.abs(z) <= 4,
    tirages.length
      ? `${observes} trap(s) in ${tirages.length} guard draw(s), ${attendu.toFixed(1)} expected (z = ${z.toFixed(2)}); each one a single-bug mutant of the real deliverable awaiting verification, rejected by the guards’ own checks`
      : 'no guard draw on a deliverable that could be mimicked yet',
  );

  // P0-4: did every honey validated by guards reach the target error rate α*? The log-odds are
  // recomputed here from the weights recorded with each verdict alone, independently of the coordinator.
  const somme = new Map<string, number>();
  for (const e of entries) {
    const d = e.donnees as { resultat?: string; decision?: string; poids?: number };
    if (e.nature === 'verdict' && d.decision === 'valide' && typeof d.poids === 'number') somme.set(String(d.resultat), (somme.get(String(d.resultat)) ?? 0) + d.poids);
  }
  const alpha = L.params.alpha_faux;
  const plancher = Math.max(1, L.params.gardiennes_v0 ?? 1);
  const cote0 = Math.log(L.params.p_juste_initiale / (1 - L.params.p_juste_initiale));
  const miels = entries.filter((e) => e.nature === 'alveole_miel').map((e) => ({ seq: e.seq, ...(e.donnees as { resultat: string; gardiennes: string[]; cote?: number; p_faux?: number; arbitrage?: boolean }) }));
  const parGardiennes = miels.filter((m) => m.gardiennes?.length && !m.arbitrage);
  const hors: string[] = [];
  for (const m of parGardiennes) {
    const cote = cote0 + (somme.get(m.resultat) ?? 0);
    const pFaux = 1 / (1 + Math.exp(cote));
    if (m.gardiennes.length < plancher || pFaux > alpha * (1 + 1e-6) || m.cote === undefined || Math.abs(m.cote - cote) > 1e-6) hors.push(`#${m.seq}`);
  }
  const arbitres = miels.filter((m) => m.arbitrage).length;
  const nG = parGardiennes.map((m) => m.gardiennes.length);
  const pire = parGardiennes.reduce((p, m) => Math.max(p, m.p_faux ?? 0), 0);
  add(
    'Every honey cell reached the target error rate (Wald sequential test)',
    hors.length === 0,
    hors.length
      ? `${hors.length} validation(s) below the target or inconsistent with the recorded verdict weights: ${hors.slice(0, 5).join(', ')}`
      : parGardiennes.length
        ? `${parGardiennes.length} cell(s) validated by guards, each with P(false) ≤ α* = ${alpha} (worst ${pire.toPrecision(3)}), recomputed from the weights of their verdicts; ${Math.min(...nG)}–${Math.max(...nG)} guards per cell` +
          `${arbitres ? `; ${arbitres} settled by the hive owner after escalation` : ''}`
        : `no cell validated by guards yet${arbitres ? `; ${arbitres} settled by the hive owner after escalation` : ''}`,
  );

  // Share of contributor signatures that resist a quantum computer.
  const signataires: string[] = [];
  for (const e of entries) {
    if (e.nature !== 'commande') continue;
    const en = (e.donnees as CommandeDonnees).entree as Record<string, Record<string, unknown> | undefined>;
    for (const [obj, champ] of [
      ['requete', 'contributeur'], ['ruche', 'porteur'], ['decision', 'auteur'], ['resultat', 'auteur'], ['decomposition', 'auteur'], ['engagement', 'gardienne'], ['verdict', 'gardienne'],
      ['recu', 'auteur'], ['lien', 'contributeur'], ['fusion', 'auteur'],
    ] as const) {
      const v = en[obj]?.[champ];
      if (typeof v === 'string') signataires.push(v);
    }
  }
  const pq = signataires.filter(isPostQuantum).length;
  add(
    'Contributor signatures',
    true,
    signataires.length
      ? `${pq}/${signataires.length} (${Math.round((pq / signataires.length) * 100)}%) are post-quantum hybrid (Ed25519 + ML-DSA-65)${pq < signataires.length ? '; the rest use Ed25519 only' : ''}`
      : 'no contributor signature yet',
  );

  // 4. The invariants, on the now-proven history.
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
  if (L.params.prive) {
    // OSP v0.3 §2.6: a private hive's honey stays local. Not a single power share may come out of it.
    const sansParts = totalParts === 0 && coord.account(COMMUN).parts === 0;
    add('Private hive: honey stays local, no power share issued', sansParts, sansParts ? `${gagne.size} member(s) earned local honey` : `${totalParts.toFixed(3)} shares issued`);
  } else {
    add(
      'The Commons holds 30% of every power share',
      communOk,
      communOk ? `Commons ${(share * 100).toFixed(2)}% of ${totalParts.toFixed(3)} shares` : `bad split at ${communIssues.slice(0, 5).join(', ') || 'global share'}; share ${(share * 100).toFixed(2)}%`,
    );
  }

  // OSP v0.3 §3.3: each repo receipt names exactly the validated deliverable. Recomputed here from the
  // signed objects alone: the result that turned the cell into honey, and the git hash of each of its files.
  const recus: Array<{ seq: number; recu: RecuDepot }> = [];
  const fusions: FusionDepot[] = [];
  const livrables = new Map<string, Livrable>();
  const valide = new Map<string, string>();
  for (const e of entries) {
    if (e.nature === 'alveole_miel') {
      const d = e.donnees as { alveole: string; resultat: string };
      valide.set(d.alveole, d.resultat);
    }
    if (e.nature !== 'commande') continue;
    const c = e.donnees as CommandeDonnees;
    if (c.type === 'submitResult') {
      const en = c.entree as { resultat: Result; livrable: Livrable };
      livrables.set(hashOf(en.resultat), en.livrable);
    } else if (c.type === 'recuDepot') recus.push({ seq: e.seq, recu: (c.entree as { recu: RecuDepot }).recu });
    else if (c.type === 'fusionDepot') fusions.push((c.entree as { fusion: FusionDepot }).fusion);
  }
  if (recus.length) {
    const faux = recus.filter(({ recu }) => {
      const l = livrables.get(recu.resultat);
      return (
        !l ||
        valide.get(recu.alveole) !== recu.resultat ||
        canonicalize(recu.fichiers) !== canonicalize(blobsDuLivrable(l)) ||
        canonicalize(recu.supprimes) !== canonicalize([...(l.supprimes ?? [])].sort())
      );
    });
    const doubles = recus.length - new Set(recus.map((r) => r.recu.alveole)).size;
    add(
      'Repo receipts name exactly the validated deliverables',
      faux.length === 0,
      faux.length
        ? `${faux.length} receipt(s) do not match their validated deliverable: ${faux.slice(0, 5).map((r) => `#${r.seq}`).join(', ')}`
        : `${recus.length} receipt(s), each with the git hash of every validated file${doubles ? `; ${doubles} cell(s) written twice (two bridges), harmless` : ''}`,
    );
    if (opts.verifierCommit) {
      const problemes: string[] = [];
      for (const { seq, recu } of recus) {
        const p = await opts.verifierCommit(recu);
        if (p) problemes.push(`#${seq}: ${p}`);
      }
      add(
        'Each receipt’s commit holds exactly that deliverable (checked in your clone)',
        problemes.length === 0,
        problemes.length ? problemes.slice(0, 3).join('; ') : `${recus.length} commit(s): right parent, right files, nothing else`,
      );
    }
    add(
      'External evidence, not replayable offline',
      true,
      fusions.length
        ? `${fusions.length} pull request(s) merged by a human, as seen by the bridge: ${fusions.slice(0, 3).map((f) => `${f.pr} by ${f.fusionnee_par}`).join('; ')}`
        : 'no merge recorded yet; GitHub facts (merges, CI runs) are listed apart because only GitHub can attest them',
    );
  }

  if (opts.reverifier) {
    const notes = [
      nonReveles.sandbox ? `re-run in ${nonReveles.sandbox}` : '',
      nonReveles.n ? `${nonReveles.n} check(s) skipped: their hidden tests are not revealed yet` : '',
    ].filter(Boolean).join('; ');
    add('Verifier reports reproduced by re-running every deliverable', reverif.length === 0, reverif.slice(0, 3).join('; ') || notes || undefined);
  }

  const etat = coord.stateHash();
  if (opts.etatAnnonce) add('The live coordinator holds exactly the replayed state', opts.etatAnnonce === etat, opts.etatAnnonce === etat ? undefined : `announced ${opts.etatAnnonce.slice(0, 20)}…, replay ${etat.slice(0, 20)}…`);
  return report(etat);
}

/** Re-runs the V0 verifier on a command's deliverable, before replaying it. */
async function reverify(
  coord: Coordinator,
  c: CommandeDonnees,
  seq: number,
  issues: string[],
  reveles: Map<string, TestCase[]>,
  nonReveles: { n: number; sandbox?: string },
  piegesEssais = 8,
  moteur = 1,
): Promise<void> {
  const recorded = c.verifs?.[0];
  if (!recorded) return;
  let cible: { critere: NonNullable<ReturnType<Coordinator['critereOf']>>; livrable: Livrable } | undefined;
  if (c.type === 'submitResult') {
    const e = c.entree as { resultat: Result; livrable: Livrable };
    const critere = coord.critereOf(e.resultat.alveole);
    if (critere) cible = { critere, livrable: e.livrable };
    // P0-3: the mutants prepared as traps, re-run with the guards' checks only.
    if (critere && c.verifs.length > 1) {
      const ms = mutants(e.livrable, { max: piegesEssais, version: moteur });
      for (const [i, rapport] of c.verifs.slice(1).entries()) {
        const m = ms[i];
        const again = m ? await verifierV0(critere, m.livrable, { sansCaches: true }) : undefined;
        if (!again || again.ok !== rapport.ok) issues.push(`#${seq}: trap mutant ${i + 1} is recorded as ${rapport.ok ? 'passing' : 'failing'} the guards’ checks, a fresh run disagrees`);
      }
    }
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
  nonReveles.sandbox ??= again.sandbox;
  if (again.ok !== recorded.ok) issues.push(`#${seq}: the registry says ${recorded.ok ? 'passed' : 'failed'}, a fresh run says ${again.ok ? 'passed' : 'failed'} (${again.motif})`);
}
