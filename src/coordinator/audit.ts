import { commitment, hashOf } from '../protocol/canonical.js';
import { algoOf, isPostQuantum, verifyObject } from '../protocol/identity.js';
import type { ContributorId, EngagementVerdict, Hash, Livrable, Result, TestCase, Verdict } from '../protocol/types.js';
import { mutants } from '../verifier/mutation.js';
import { verifierV0 } from '../verifier/v0.js';
import { QUICKNET } from './balise.js';
import { Coordinator, type BaliseAnnoncee, type CommandeDonnees } from './coordinator.js';
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
    replay: { coordinateur: L.coordinateur, pieges: L.pieges, ...(L.balise ? { balise: L.balise } : {}) },
  });
  let divergence = coord.registry.entries[0]?.hash === first.hash ? undefined : 'the launch entry differs';
  const reverif: string[] = [];
  // Tests cachés révélés à la validation : seuls ceux-là permettent de revérifier une alvéole qui en avait.
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
      // Le sceau : la signature post-quantique du coordinateur sur la tête du registre.
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

  // 3 bis. Les sceaux : qui garantit le registre, avec quelle cryptographie, et jusqu'où.
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

  // P1-3 : les tirages viennent-ils d'une balise publique que personne ne contrôle ?
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

  // P1-3 : chaque verdict révélé correspond à un engagement signé, inscrit avant lui.
  // Recalculé ici à partir des seuls objets signés, indépendamment de la logique du coordinateur.
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

  // P0-3 : les pièges sont-ils tirés au taux annoncé pour chaque gardienne ? Le rejeu a recalculé chaque
  // tirage (taux selon la réputation du moment, mutant choisi parmi ceux du vrai livrable) ; on compare le
  // nombre de pièges à son espérance, pour démasquer un coordinateur qui en abuserait ou en épargnerait.
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

  // P0-4 : chaque miel validé par les gardiennes a-t-il atteint le taux d'erreur cible α* ? La log-cote est
  // recalculée ici à partir des seuls poids inscrits avec chaque verdict, indépendamment du coordinateur.
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

  // Part des signatures de contributeurs qui résistent à un ordinateur quantique.
  const signataires: string[] = [];
  for (const e of entries) {
    if (e.nature !== 'commande') continue;
    const en = (e.donnees as CommandeDonnees).entree as Record<string, Record<string, unknown> | undefined>;
    for (const [obj, champ] of [
      ['requete', 'contributeur'], ['ruche', 'porteur'], ['decision', 'auteur'], ['resultat', 'auteur'], ['decomposition', 'auteur'], ['engagement', 'gardienne'], ['verdict', 'gardienne'],
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

/** Relance le vérificateur V0 sur le livrable d'une commande, avant de la rejouer. */
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
    // P0-3 : les mutants préparés comme pièges, rejoués avec les seuls contrôles des gardiennes.
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
