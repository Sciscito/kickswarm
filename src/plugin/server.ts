import { join } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { makeDecomposition, makeEngagement, makeResult, makeVerdict } from '../protocol/builders.js';
import { commitment, hashOf } from '../protocol/canonical.js';
import type { Assignment, CellSpec, Livrable, Propriete, Secrets, TestCase } from '../protocol/types.js';
import { validateCritere, verifierV0 } from '../verifier/v0.js';
import { CoordinatorClient } from './client.js';
import { consignes } from './consignes.js';
import { cloneDe, empreintes, lireDepot } from './depot-local.js';
import { horsPortee } from '../protocol/depot.js';
import { kickswarmHome, loadOrCreateIdentity } from './identite.js';
import { JournalLocal, resumer } from './journal.js';
import { chargerParticipation, CompteurJour, decrire, DEFAULT_PARTICIPATION, enHeuresCalmes, ROLE_OF, type Participation } from './participation.js';
import { Scelles, type VerdictScelle } from './scelles.js';

// The Kickswarm plugin: a local MCP server that connects any agent to the swarm (§3, §21.1).
// Keys stay here; the coordinator only ever receives signed objects.

type ToolResult = { content: Array<{ type: 'text'; text: string }>; isError?: boolean };
const texte = (text: string): ToolResult => ({ content: [{ type: 'text', text }] });
const erreur = (text: string): ToolResult => ({ content: [{ type: 'text', text }], isError: true });

function outil<A>(fn: (args: A) => Promise<ToolResult>): (args: A) => Promise<ToolResult> {
  return async (args) => {
    try {
      return await fn(args);
    } catch (e) {
      return erreur(`Error: ${(e as Error).message}`);
    }
  };
}

const testSchema = z.object({
  nom: z.string().optional(),
  fn: z.string().describe('Name of the exported function to call'),
  args: z.array(z.unknown()).describe('Arguments passed to the function'),
  attendu: z.unknown().describe('Expected value (deep-compared, as JSON)'),
});

const generateurSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.object({ type: z.literal('int'), min: z.number(), max: z.number() }),
    z.object({ type: z.literal('float'), min: z.number(), max: z.number() }),
    z.object({ type: z.literal('bool') }),
    z.object({ type: z.literal('string'), alphabet: z.string().optional(), maxLen: z.number() }),
    z.object({ type: z.literal('array'), of: generateurSchema, maxLen: z.number() }),
    z.object({ type: z.literal('oneOf'), values: z.array(z.unknown()) }),
  ]),
);

const proprieteSchema = z.object({
  nom: z.string(),
  fn: z.string(),
  args: z.array(generateurSchema).describe('One generator per argument'),
  verifie: z.string().describe('JavaScript expression over args, out and eq that must be true'),
  cas: z.number().optional(),
});

const enfantSchema = z.object({
  objectif: z.string(),
  capsule: z.string().describe('The context needed, and nothing more'),
  atomique: z.boolean(),
  critere_fini: z.object({
    module: z.string().describe('Name of the delivered module, e.g. gcd.mjs'),
    tests: z.array(testSchema),
    proprietes: z.array(proprieteSchema).optional().describe('Property tests on random inputs'),
    timeout_ms: z.number().optional(),
  }),
  tests_caches: z.array(testSchema).optional().describe('Hidden tests: the workers never see them'),
  depot: z
    .object({
      lecture: z.array(z.string()).optional().describe('Repository files this child needs to read'),
      ecriture: z.array(z.string()).describe('Its write scope: files, or folders ending in "/", inside yours'),
    })
    .optional()
    .describe('Repo cells only: what this child reads and writes in the repository'),
  reference: z.record(z.string(), z.string()).optional().describe('Your own implementation (file name → code), kept secret, used to measure how strong the tests are'),
});

type Revelation = { statut: string; piege?: boolean; correct?: boolean | null; renverse?: boolean };

function issueVerdict(r: Revelation): string {
  if (r.piege) return r.correct ? 'It was a trap cell, and you caught it (+12 g).' : 'It was a trap cell.';
  return r.renverse ? 'Your verdict was overturned.' : `Verdict recorded: ${r.statut}.`;
}

export function createPluginServer(
  client: CoordinatorClient,
  journal?: JournalLocal,
  options: {
    scelles?: Scelles;
    intervalleRevelationMs?: number;
    attenteMs?: number;
    /** The contributor's settings, read before every task so a change applies at once. */
    participation?: () => Participation;
    compteur?: { aujourdhui(): number; plusUn(): void };
  } = {},
): McpServer {
  // When nothing is available, swarm_next waits up to this delay before answering.
  const attente = options.attenteMs ?? 30_000;
  const participation = options.participation ?? (() => DEFAULT_PARTICIPATION);
  let tachesEnMemoire = 0;
  const compteur = options.compteur ?? { aujourdhui: () => tachesEnMemoire, plusUn: () => void tachesEnMemoire++ };
  /** Why the bee rests right now, if it does: paused, quiet hours, or today's share already done. */
  const repos = (p: Participation): string | null => {
    if (p.pause) return 'Your bee is paused. Resume with: kickswarm settings --resume';
    if (enHeuresCalmes(p)) return `Quiet hours: your bee rests from ${p.heuresCalmes![0]}:00 to ${p.heuresCalmes![1]}:00. Change it with: kickswarm settings --quiet off`;
    if (p.parJour && compteur.aujourdhui() >= p.parJour) return `Your bee has done its ${p.parJour} tasks for today. Thank you! Raise the limit with: kickswarm settings --per-day <n>`;
    return null;
  };
  const server = new McpServer({ name: 'kickswarm', version: '0.1.0' });
  let ruche: string | undefined;
  let enCours: Assignment | undefined;
  let consignesEnCours: string | undefined;
  /** OSP v0.3 §3.2: the repository files read for the current cell, sent with the deliverable for its tests. */
  let contexteEnCours: Record<string, string> | undefined;
  // Everything the AI does for the swarm is noted in the contributor's local journal.
  const note = (nature: string, donnees: Record<string, unknown>) => journal?.note(nature, { coordinateur: client.url, ...donnees });

  // Sealed verdicts (OSP v0.2, P1-3): revealed as soon as every guard has committed,
  // on each tool call and in the background, so the window is never missed.
  const scelles = options.scelles ?? new Scelles();
  type Revele = { scelle: VerdictScelle; r: Revelation };
  const revelerScelles = async (): Promise<Revele[]> => {
    const reveles: Revele[] = [];
    for (const scelle of scelles.tous.filter((x) => x.coordinateur === client.url)) {
      try {
        const r = await client.verdict(scelle.verdict);
        scelles.retirer(scelle);
        const v = scelle.verdict;
        note('verdict', { ruche: scelle.ruche, chemin: scelle.chemin, resultat: v.resultat, decision: v.decision, statut: r.statut, piege: r.piege ?? false });
        reveles.push({ scelle, r });
      } catch (e) {
        if ((e as { status?: number }).status === 425) continue;
        scelles.retirer(scelle);
        note('erreur', { outil: 'revelation', chemin: scelle.chemin, erreur: (e as Error).message });
      }
    }
    return reveles;
  };
  let enVol: Promise<Revele[]> | null = null;
  const reveler = (): Promise<Revele[]> => (enVol ??= revelerScelles().finally(() => (enVol = null)));
  const lignes = (reveles: Revele[]) => reveles.map(({ scelle, r }) => `Your sealed verdict on cell ${scelle.chemin} is revealed. ${issueVerdict(r)}\n`).join('');
  const intervalle = options.intervalleRevelationMs ?? 3000;
  if (intervalle > 0) {
    setInterval(() => {
      if (scelles.tous.length) reveler().catch(() => undefined);
    }, intervalle).unref();
  }
  /**
   * Enters a hive by slug, or a private hive by its identifier (OSP v0.3: `p` + 32 hex). For a private
   * hive, every call then goes to its own instance, with a read ticket; the hive's slug comes back.
   */
  const entrer = async (demande: string): Promise<string> => {
    if (/^p[0-9a-f]{32}$/.test(demande)) {
      client.utiliserRuchePrivee(demande);
      const liste = await client.hives();
      if (!liste[0]) throw new Error('This private hive has no hive in it yet');
      ruche = liste[0].slug;
    } else {
      client.utiliserRuchePrivee(undefined);
      ruche = demande;
    }
    return ruche;
  };
  const journalise = <A,>(nom: string, fn: (args: A) => Promise<ToolResult>) => async (args: A): Promise<ToolResult> => {
    try {
      return await fn(args);
    } catch (e) {
      note('erreur', { outil: nom, erreur: (e as Error).message });
      throw e;
    }
  };

  server.registerTool(
    'swarm_join',
    {
      title: 'Join a hive',
      description: 'Joins a Kickswarm hive. The next cells will come from this hive.',
      inputSchema: { ruche: z.string().describe('Hive slug, e.g. math-toolkit, or a private hive identifier (p followed by 32 hex characters)') },
    },
    outil(journalise('swarm_join', async ({ ruche: demande }: { ruche: string }) => {
      const slug = await entrer(demande);
      const vue = await client.hive(slug);
      note('rejoint', { ruche: slug, nom: vue.ruche.nom, statut: vue.statut });
      return texte(
        `You joined “${vue.ruche.nom}” (${vue.statut}). ${vue.progression.miel}/${vue.progression.total} cells verified.\n` +
          `Goal: ${vue.ruche.objectif}\nCall swarm_next to receive a cell.`,
      );
    })),
  );

  server.registerTool(
    'swarm_next',
    {
      title: 'Take the next cell',
      description:
        'Takes the next task from the swarm. The caste is drawn at random: worker, builder, scout or guard. Guard verifications are done automatically by the plugin, in a sandbox.',
      inputSchema: {},
    },
    outil(journalise('swarm_next', async () => {
      const avant = await reveler();
      const prefixe = avant.length ? `${lignes(avant)}\n` : '';
      if (enCours) return texte(`${prefixe}You already have a cell in progress.\n\n${consignesEnCours ?? consignes(enCours)}`);
      const p = participation();
      const pourquoi = repos(p);
      if (pourquoi) return texte(`${prefixe}${pourquoi}`);
      // Without swarm_join, the last hive joined from the command line (a private one included).
      if (!ruche && p.ruches.length) await entrer(p.ruches.at(-1)!);
      const cible = ruche;
      // Only the roles the contributor accepts: any other task goes straight back to the swarm, with no penalty.
      let ecarte = false;
      const prendre = async (): Promise<Assignment | null> => {
        for (let i = 0; i < 5; i++) {
          const x = await client.claim(cible);
          if (!x) return null;
          if (p.roles.includes(ROLE_OF[x.caste])) return x;
          ecarte = true;
          await client.release(x.alveole_id);
        }
        return null;
      };
      let a = await prendre();
      // Nothing to take, but the hive is alive: guards are verifying. Wait a little rather than
      // sending the agent back right away (it cannot wait on its own).
      let terminee = false;
      const fin = Date.now() + attente;
      while (!a && Date.now() < fin) {
        if (cible && (await client.hive(cible)).statut === 'terminee') {
          terminee = true;
          break;
        }
        await new Promise((r) => setTimeout(r, Math.min(2000, attente)));
        await reveler();
        a = await prendre();
      }
      if (!a) {
        if (terminee) return texte(`${prefixe}The hive is complete: every cell is honey. Nothing left to do. Call swarm_journal to see what you did.`);
        if (ecarte) return texte(`${prefixe}Nothing matching your settings right now (you take: ${p.roles.join(', ')}). Call swarm_next again a bit later.`);
        return texte(
          attente > 0
            ? `${prefixe}Nothing to do right now: cells are being verified by guards. Call swarm_next again.`
            : `${prefixe}Nothing left to do in this hive right now. Try again a bit later.`,
        );
      }
      compteur.plusUn();

      if (a.caste === 'gardienne') {
        const aVerifier = a.a_verifier!;
        const chemin = a.alveole.chemin;
        const rejeu = await verifierV0(a.alveole.critere_fini, aVerifier.livrable, { sansCaches: true });
        const verdict = makeVerdict(client.identite, aVerifier.id, rejeu.ok ? 'valide' : 'rejete', rejeu.motif);
        note('verification', { ruche, chemin, resultat: aVerifier.id, ok: rejeu.ok, motif: rejeu.motif, sandbox: rejeu.sandbox });
        // The verdict is kept on disk before its commitment is sent: it can always be revealed.
        const s: VerdictScelle = { verdict, coordinateur: client.url, chemin, ...(ruche ? { ruche } : {}) };
        scelles.ajouter(s);
        try {
          await client.engager(makeEngagement(client.identite, verdict));
        } catch (e) {
          scelles.retirer(s);
          throw e;
        }
        note('engagement', { ruche, chemin, resultat: aVerifier.id, decision: verdict.decision, engagement: hashOf(verdict) });
        const apres = await reveler();
        const mien = apres.find((x) => x.scelle === s);
        const issue = mien
          ? issueVerdict(mien.r)
          : 'Your verdict is sealed: only its hash was sent. The plugin reveals it on its own once the other guards have committed, so nobody can copy anybody.';
        return texte(
          `${prefixe}Drawn as a guard for cell ${chemin}. The plugin replayed the verification in a sandbox: ${rejeu.ok ? 'valid' : 'rejected'} (${rejeu.motif}).\n${issue}\n` +
            `${lignes(apres.filter((x) => x !== mien))}Call swarm_next to continue.`,
        );
      }

      await client.start(a.alveole_id);
      enCours = a;
      // OSP v0.3 §3.2: a repo cell's files come from this member's clone, checked against the signed cell.
      const lu = a.alveole.depot ? await lireDepot(a.alveole.depot, p.depots) : undefined;
      const texteConsignes = consignes(a, lu);
      consignesEnCours = texteConsignes;
      contexteEnCours = lu && Object.keys(lu.fichiers).length ? lu.fichiers : undefined;
      note('consigne', { ruche, caste: a.caste, chemin: a.alveole.chemin, alveole: a.alveole_id, objectif: a.alveole.objectif, consignes: texteConsignes });
      return texte(texteConsignes);
    })),
  );

  server.registerTool(
    'swarm_submit',
    {
      title: 'Hand in your work',
      description:
        'Hands in the deliverable of the current cell (worker or builder). The plugin runs the tests locally first: if one fails, nothing is sent and you can fix it.',
      inputSchema: {
        fichiers: z.record(z.string(), z.string()).describe('File name → content (in a repo cell: path in the repository → content)'),
        supprimes: z.array(z.string()).optional().describe('Repo cells only: files of your write scope to delete'),
        impasses: z.array(z.string()).optional().describe('Approaches you tried that failed'),
        modele: z.string().optional().describe('Model used (self-declared)'),
      },
    },
    outil(journalise('swarm_submit', async ({ fichiers, supprimes, impasses, modele }: { fichiers: Record<string, string>; supprimes?: string[]; impasses?: string[]; modele?: string }) => {
      const a = enCours;
      if (!a || (a.caste !== 'ouvriere' && a.caste !== 'batisseuse')) return erreur('No worker or builder cell in progress. Call swarm_next.');
      const livrable: Livrable = { fichiers, ...(supprimes?.length ? { supprimes } : {}), ...(a.alveole.depot && contexteEnCours ? { contexte: contexteEnCours } : {}) };
      if (a.alveole.depot) {
        const hors = horsPortee(a.alveole.depot, livrable);
        if (hors.length) return erreur(`Outside your write scope (${a.alveole.depot.ecriture.join(', ')}): ${hors.join(', ')}\nNothing was sent.`);
      } else if (supprimes?.length) return erreur('Only a repo cell deletes files. Nothing was sent.');
      const local = await verifierV0(a.alveole.critere_fini, livrable, { sansCaches: true });
      if (!local.ok) {
        note('controle_local', { ruche, chemin: a.alveole.chemin, motif: local.motif, fichiers });
        return erreur(`Not yet: ${local.motif}\nFix it and call swarm_submit again. Nothing was sent.`);
      }
      const resultat = makeResult(client.identite, a.alveole_id, a.caste, livrable, {
        impasses,
        agent: { famille: 'mcp', ...(modele ? { modele } : {}) },
      });
      const r = await client.submit(resultat, livrable);
      note('livraison', { ruche, chemin: a.alveole.chemin, fichiers, impasses: impasses ?? [], resultat: r.resultat, statut: r.statut, motif: r.rapport.motif });
      enCours = undefined;
      consignesEnCours = undefined;
      contexteEnCours = undefined;
      return texte(
        `Delivered: ${r.rapport.motif}. Status: ${r.statut}.` +
          (r.statut === 'en_verification' ? ' Two random guards will now check it; the honey arrives once they confirm.' : '') +
          '\nCall swarm_next to continue.',
      );
    })),
  );

  server.registerTool(
    'swarm_decompose',
    {
      title: 'Propose a split',
      description: 'Hands in the split of the current cell (scout): 2 to 12 sub-cells, each with its tests.',
      inputSchema: { enfants: z.array(enfantSchema).min(2).max(12) },
    },
    outil(journalise('swarm_decompose', async ({ enfants }: { enfants: z.infer<typeof enfantSchema>[] }) => {
      const a = enCours;
      if (!a || a.caste !== 'eclaireuse') return erreur('No scout cell in progress. Call swarm_next.');
      // Secrets (hidden tests, reference) never enter the signed object: only their commitments do.
      const secrets: Secrets[] = enfants.map((e) => ({
        ...(e.tests_caches?.length ? { tests_caches: e.tests_caches as TestCase[] } : {}),
        ...(e.reference ? { reference: { fichiers: e.reference } } : {}),
      }));
      // OSP v0.3 §3.2: a child's repo capsule, completed here: the parent's repository and commit, and the hashes of the files read.
      const parent = a.alveole.depot;
      const depots: Array<CellSpec['depot']> = [];
      for (const e of enfants) {
        if (!e.depot) {
          depots.push(undefined);
          continue;
        }
        if (!parent) return erreur('This cell does not work on a repository: its children cannot either.');
        const lecture = e.depot.lecture ?? [];
        const clone = cloneDe(parent.url, participation().depots);
        if (lecture.length && !clone) return erreur(`No local clone of ${parent.url} on this machine to pin the files read. The member sets it with: kickswarm settings --clone ${parent.url}=<path>`);
        let pins: Record<string, `sha256:${string}`> = {};
        try {
          pins = lecture.length ? await empreintes(clone!, parent.commit, lecture) : {};
        } catch (err) {
          return erreur(`Could not read a file to pin from ${clone}: ${(err as Error).message}`);
        }
        depots.push({ url: parent.url, commit: parent.commit, lecture, empreintes_lecture: pins, ecriture: e.depot.ecriture });
      }
      const specs: CellSpec[] = enfants.map((e, i) => ({
        objectif: e.objectif,
        capsule: e.capsule,
        atomique: e.atomique,
        critere_fini: {
          classe: 'V0',
          verificateur: 'tests-js@1',
          module: e.critere_fini.module,
          tests: e.critere_fini.tests as TestCase[],
          ...(e.critere_fini.proprietes?.length ? { proprietes: e.critere_fini.proprietes as Propriete[] } : {}),
          ...(secrets[i]!.tests_caches ? { tests_caches_hash: commitment(secrets[i]!.tests_caches) } : {}),
          ...(secrets[i]!.reference ? { reference_hash: commitment(secrets[i]!.reference) } : {}),
          ...(e.critere_fini.timeout_ms ? { timeout_ms: e.critere_fini.timeout_ms } : {}),
        },
        ...(depots[i] ? { depot: depots[i] } : {}),
      }));
      for (const s of specs) validateCritere(s.critere_fini);
      const r = await client.decompose(makeDecomposition(client.identite, a.alveole_id, specs), secrets);
      note('decoupage', { ruche, chemin: a.alveole.chemin, n: specs.length, enfants: specs, secrets_envoyes: secrets.some((x) => x.tests_caches || x.reference), statut: r.statut });
      enCours = undefined;
      return texte(
        r.statut === 'adopte'
          ? `Split adopted: ${r.enfants.length} new cells in the swarm.`
          : 'Split proposed. At the first levels, the hive owner must approve it (§6.3).',
      );
    })),
  );

  server.registerTool(
    'swarm_status',
    { title: 'My status', description: 'Your honey, power shares, reputation, trophies and current cell.', inputSchema: {} },
    outil(async () => {
      const c = await client.account();
      return texte(
        [
          `Identity: ${client.identite.id}`,
          `Hive: ${ruche ?? 'none (call swarm_join)'}`,
          `Honey: ${c.miel} g (earned in total: ${c.miel_gagne} g)`,
          `Power shares: ${c.parts}`,
          `Reputation: ${c.reputation}`,
          `Trophies: ${c.trophees?.length ? c.trophees.map((t) => t.id).join(', ') : 'none yet'}`,
          `In progress: ${enCours ? `${enCours.caste} · cell ${enCours.alveole.chemin}` : 'nothing'}`,
          `Your settings: ${decrire(participation())} · ${compteur.aujourdhui()} task(s) today`,
        ].join('\n'),
      );
    }),
  );

  server.registerTool(
    'swarm_leave',
    { title: 'Recall your bee', description: 'Gives the current cell back to the swarm, with no penalty.', inputSchema: {} },
    outil(async () => {
      if (!enCours) return texte('No cell in progress.');
      await client.release(enCours.alveole_id);
      const chemin = enCours.alveole.chemin;
      note('rappel', { ruche, chemin });
      enCours = undefined;
      return texte(`Bee recalled: cell ${chemin} goes back to the swarm.`);
    }),
  );

  server.registerTool(
    'hive_board',
    {
      title: 'Hive board',
      description: 'Reads the hive memory: discoveries and dead ends already met.',
      inputSchema: { ruche: z.string().optional() },
    },
    outil(async ({ ruche: slug }: { ruche?: string }) => {
      const cible = slug ?? ruche;
      if (!cible) return erreur('Give a hive, or call swarm_join.');
      const entrees = await client.board(cible);
      if (!entrees.length) return texte('The hive board is empty for now.');
      return texte(entrees.slice(-30).map((e) => `[${e.nature}] ${e.chemin}: ${e.texte}`).join('\n'));
    }),
  );

  server.registerTool(
    'swarm_journal',
    {
      title: 'What my AI did',
      description: 'Shows the local journal: every task your AI received, every deliverable it sent, every check and verdict. It lives only on this machine.',
      inputSchema: { n: z.number().optional().describe('How many entries, 15 by default') },
    },
    outil(async ({ n }: { n?: number }) => {
      if (!journal) return texte('No local journal on this plugin.');
      const lignes = journal.dernieres(Math.min(Math.max(1, n ?? 15), 200)).map(resumer);
      return texte(lignes.length ? `Local journal (${journal.fichier}):\n${lignes.join('\n')}` : 'The local journal is empty for now.');
    }),
  );

  return server;
}

export async function startPlugin(url: string): Promise<void> {
  const { identite, fichier, creee } = loadOrCreateIdentity();
  if (creee) console.error(`[kickswarm] New identity created: ${fichier}`);
  const journal = new JournalLocal();
  const scelles = new Scelles(join(kickswarmHome(), 'verdicts-scelles.json'));
  const home = kickswarmHome();
  const server = createPluginServer(new CoordinatorClient(url, identite), journal, {
    scelles,
    participation: () => chargerParticipation(home),
    compteur: new CompteurJour(home),
  });
  await server.connect(new StdioServerTransport());
  console.error(`[kickswarm] MCP plugin ready. Coordinator: ${url} · identity ${identite.id} · journal ${journal.fichier}`);
}
