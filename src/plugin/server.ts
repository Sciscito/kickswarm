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
import { kickswarmHome, loadOrCreateIdentity } from './identite.js';
import { JournalLocal, resumer } from './journal.js';
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
  options: { scelles?: Scelles; intervalleRevelationMs?: number; attenteMs?: number } = {},
): McpServer {
  // Quand rien n'est disponible, swarm_next patiente jusqu'à ce délai avant de répondre.
  const attente = options.attenteMs ?? 30_000;
  const server = new McpServer({ name: 'kickswarm', version: '0.1.0' });
  let ruche: string | undefined;
  let enCours: Assignment | undefined;
  // Tout ce que l'IA fait pour l'essaim est noté dans le journal local du contributeur.
  const note = (nature: string, donnees: Record<string, unknown>) => journal?.note(nature, { coordinateur: client.url, ...donnees });

  // Verdicts scellés (OSP v0.2, P1-3) : révélés dès que toutes les gardiennes se sont engagées,
  // à chaque appel d'outil et en tâche de fond, pour ne jamais laisser passer la fenêtre.
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
      inputSchema: { ruche: z.string().describe('Hive slug, e.g. math-toolkit') },
    },
    outil(journalise('swarm_join', async ({ ruche: slug }: { ruche: string }) => {
      const vue = await client.hive(slug);
      ruche = slug;
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
      if (enCours) return texte(`${prefixe}You already have a cell in progress.\n\n${consignes(enCours)}`);
      let a = await client.claim(ruche);
      // Rien à prendre, mais la ruche vit : les gardiennes vérifient. On patiente un peu plutôt que de
      // renvoyer l'agent tout de suite (il ne sait pas attendre seul).
      let terminee = false;
      const fin = Date.now() + attente;
      while (!a && Date.now() < fin) {
        if (ruche && (await client.hive(ruche)).statut === 'terminee') {
          terminee = true;
          break;
        }
        await new Promise((r) => setTimeout(r, Math.min(2000, attente)));
        await reveler();
        a = await client.claim(ruche);
      }
      if (!a) {
        if (terminee) return texte(`${prefixe}The hive is complete: every cell is honey. Nothing left to do. Call swarm_journal to see what you did.`);
        return texte(
          attente > 0
            ? `${prefixe}Nothing to do right now: cells are being verified by guards. Call swarm_next again.`
            : `${prefixe}Nothing left to do in this hive right now. Try again a bit later.`,
        );
      }

      if (a.caste === 'gardienne') {
        const cible = a.a_verifier!;
        const chemin = a.alveole.chemin;
        const rejeu = await verifierV0(a.alveole.critere_fini, cible.livrable, { sansCaches: true });
        const verdict = makeVerdict(client.identite, cible.id, rejeu.ok ? 'valide' : 'rejete', rejeu.motif);
        note('verification', { ruche, chemin, resultat: cible.id, ok: rejeu.ok, motif: rejeu.motif, sandbox: rejeu.sandbox });
        // Le verdict est gardé sur disque avant que son engagement parte : on pourra toujours le révéler.
        const s: VerdictScelle = { verdict, coordinateur: client.url, chemin, ...(ruche ? { ruche } : {}) };
        scelles.ajouter(s);
        try {
          await client.engager(makeEngagement(client.identite, verdict));
        } catch (e) {
          scelles.retirer(s);
          throw e;
        }
        note('engagement', { ruche, chemin, resultat: cible.id, decision: verdict.decision, engagement: hashOf(verdict) });
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
      const texteConsignes = consignes(a);
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
        fichiers: z.record(z.string(), z.string()).describe('File name → content'),
        impasses: z.array(z.string()).optional().describe('Approaches you tried that failed'),
        modele: z.string().optional().describe('Model used (self-declared)'),
      },
    },
    outil(journalise('swarm_submit', async ({ fichiers, impasses, modele }: { fichiers: Record<string, string>; impasses?: string[]; modele?: string }) => {
      const a = enCours;
      if (!a || (a.caste !== 'ouvriere' && a.caste !== 'batisseuse')) return erreur('No worker or builder cell in progress. Call swarm_next.');
      const livrable: Livrable = { fichiers };
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
      return texte(entrees.slice(-30).map((e) => `[${e.nature}] ${e.chemin} : ${e.texte}`).join('\n'));
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
  const server = createPluginServer(new CoordinatorClient(url, identite), journal, { scelles });
  await server.connect(new StdioServerTransport());
  console.error(`[kickswarm] MCP plugin ready. Coordinator: ${url} · identity ${identite.id} · journal ${journal.fichier}`);
}
