import type { CellSpec, CritereLuau, CritereV0, TestCase } from '../protocol/types.js';
import { lireJson } from './lecteur.js';

// Framing a project (docs/host-your-hive.md): a creator describes an idea in their own words; their own
// AI turns it into the heart of the hive (one module and the examples the finished module must pass)
// and a first plan (the parts, each a module with its own examples). The creator reads the examples as
// plain sentences before anything is created: they define "done". With the plan written, every next
// task is writing or assembling, which any AI chat can take: nobody needs a coding agent to start.
// Isomorphic: the creation page runs it in the browser, the coordinator runs it again on what it receives.

export type LangageProjet = 'javascript' | 'luau';

export interface Idee {
  nom: string;
  /** The goal, in the creator's words. */
  objectif: string;
  langage: LangageProjet;
  /** Anything else the creator wants the AI to know. */
  details?: string;
}

export interface Cadrage {
  slug: string;
  nom: string;
  objectif: string;
  playbook?: string;
  racine: CellSpec;
  /** The first plan: one atomic cell per part, assembled by the heart. */
  enfants: CellSpec[];
}

export class ErreurCadrage extends Error {}

const FONCTION = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const MODULE_JS = /^[a-z0-9][a-z0-9-]{0,47}\.mjs$/;
const MODULE_LUAU = /^src\/shared\/[A-Z][A-Za-z0-9]{0,47}\.luau$/;
const EXEMPLES = { min: 3, max: 40 };
const FONCTIONS_MAX = 20;
const PARTIES = { min: 2, max: 8 };

/** A hive's slug from its name: lowercase letters, digits and hyphens, 3 to 40 characters. */
export function slugDe(nom: string): string {
  const s = nom
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');
  return s.length >= 3 ? s : `${s || 'project'}-hive`.slice(0, 40);
}

/** Checks the creator's own words. Throws ErreurCadrage with what to fix. */
export function verifierIdee(idee: Idee): void {
  const nom = idee.nom?.trim() ?? '';
  const objectif = idee.objectif?.trim() ?? '';
  if (nom.length < 3 || nom.length > 60) throw new ErreurCadrage('Give the project a name of 3 to 60 characters.');
  if (objectif.length < 10 || objectif.length > 600) throw new ErreurCadrage('Describe the goal in 10 to 600 characters.');
  if ((idee.details ?? '').length > 4000) throw new ErreurCadrage('Keep the details under 4,000 characters.');
  if (idee.langage !== 'javascript' && idee.langage !== 'luau') throw new ErreurCadrage('Pick JavaScript or Luau (Roblox).');
}

/** The one message the creator pastes into their AI: it asks for the heart and the first plan, as JSON. */
export function promptCadrage(idee: Idee): string {
  verifierIdee(idee);
  const luau = idee.langage === 'luau';
  const quoi = luau
    ? 'ONE Luau ModuleScript that returns a table of pure functions (Roblox game logic, without any game service: no Players, no Instances, no RemoteEvents)'
    : 'ONE JavaScript ES module that exports pure functions';
  const fichier = luau ? '"src/shared/Name.luau"' : '"name.mjs"';
  const partie = luau ? '"src/shared/Part.luau"' : '"part.mjs"';
  const importer = luau ? 'with require("./Part")' : "with import { … } from './part.mjs'";
  return [
    'You are helping a creator open a project on Kickswarm, where many people’s AIs build software together and every piece of work is checked by tests.',
    '',
    `Project name: ${idee.nom.trim()}`,
    `The goal, in the creator’s words: ${idee.objectif.trim()}`,
    ...(idee.details?.trim() ? ['', 'More from the creator:', idee.details.trim()] : []),
    '',
    `Turn this goal into the heart of the project: ${quoi}, with examples that the finished module must pass. Then plan it: ${PARTIES.min} to ${PARTIES.max} parts, each a small module of its own that one AI can write in one go. The heart only assembles the parts, ${importer}. The swarm writes the code; you only describe what "done" means.`,
    '',
    'Rules:',
    '- Pure functions only: no network, no files, no clock, no randomness, no user interface.',
    `- Clear English function names in camelCase. The heart has 2 to 12 functions; each part has 1 to 6.`,
    `- File names: ${luau ? 'src/shared/ then a PascalCase name, ending in .luau' : 'lowercase letters, digits and hyphens, ending in .mjs'}. Every module has its own file.`,
    '- The heart has 8 to 20 examples, each part 3 to 10, covering normal cases and edge cases. Each example gives the function, its arguments as a JSON array, and the exact expected result.',
    '- Arguments and results are plain JSON: numbers, strings, true/false, null, arrays, objects.',
    '- Every example must be exactly right: compute each expected result carefully. The parts’ examples must agree with the heart’s.',
    '',
    'Answer with this JSON only, in one ```json block:',
    '```json',
    '{',
    `  "module": ${fichier},`,
    '  "description": "2 to 5 sentences: what the project does and how its parts fit together, for the AIs that will build it",',
    '  "functions": ["firstFunction", "secondFunction"],',
    '  "examples": [',
    '    { "fn": "firstFunction", "args": [1, 2], "expected": 3 }',
    '  ],',
    '  "parts": [',
    '    {',
    `      "module": ${partie},`,
    '      "goal": "one sentence: what this part does",',
    '      "functions": ["helperFunction"],',
    '      "examples": [{ "fn": "helperFunction", "args": [2], "expected": 4 }]',
    '    }',
    '  ]',
    '}',
    '```',
  ].join('\n');
}

/** Plain JSON only: what a test can pass in and compare, the same in JavaScript and in Luau. */
function jsonSimple(v: unknown, profondeur = 0): boolean {
  if (profondeur > 8) return false;
  if (v === null || typeof v === 'boolean') return true;
  if (typeof v === 'string') return v.length <= 2000;
  if (typeof v === 'number') return Number.isFinite(v);
  if (Array.isArray(v)) return v.length <= 200 && v.every((x) => jsonSimple(x, profondeur + 1));
  if (typeof v === 'object') {
    const e = Object.entries(v as Record<string, unknown>);
    return e.length <= 100 && e.every(([k, x]) => k.length <= 100 && jsonSimple(x, profondeur + 1));
  }
  return false;
}

/** One module of the answer (the heart, or a part): its file, its functions and its examples. */
function lireModule(r: Record<string, unknown>, luau: boolean, qui: string): { module: string; fonctions: string[]; tests: TestCase[] } {
  const module = String(r.module ?? '').trim();
  if (luau ? !MODULE_LUAU.test(module) : !MODULE_JS.test(module)) {
    throw new ErreurCadrage(`${qui}: the file must look like ${luau ? '"src/shared/Name.luau"' : '"name.mjs"'} (found "${module.slice(0, 60)}").`);
  }
  const fonctions = Array.isArray(r.functions) ? r.functions.map(String) : [];
  if (!fonctions.length || fonctions.length > FONCTIONS_MAX) throw new ErreurCadrage(`${qui}: list 1 to ${FONCTIONS_MAX} functions in "functions".`);
  const mauvaise = fonctions.find((f) => !FONCTION.test(f));
  if (mauvaise !== undefined) throw new ErreurCadrage(`${qui}: “${mauvaise.slice(0, 40)}” is not a valid function name.`);
  if (new Set(fonctions).size !== fonctions.length) throw new ErreurCadrage(`${qui}: a function is listed twice.`);
  const exemples = Array.isArray(r.examples) ? r.examples : [];
  if (exemples.length < EXEMPLES.min || exemples.length > EXEMPLES.max) throw new ErreurCadrage(`${qui}: give ${EXEMPLES.min} to ${EXEMPLES.max} examples (found ${exemples.length}).`);
  const tests: TestCase[] = exemples.map((x, i) => {
    const e = (x ?? {}) as Record<string, unknown>;
    const fn = String(e.fn ?? '');
    if (!fonctions.includes(fn)) throw new ErreurCadrage(`${qui}, example ${i + 1}: “${fn.slice(0, 40)}” is not in its "functions".`);
    if (!Array.isArray(e.args) || e.args.length > 10 || !jsonSimple(e.args)) throw new ErreurCadrage(`${qui}, example ${i + 1}: "args" must be a JSON array of plain values.`);
    if (!('expected' in e) || !jsonSimple(e.expected)) throw new ErreurCadrage(`${qui}, example ${i + 1}: "expected" must be a plain JSON value.`);
    return { fn, args: e.args, attendu: e.expected };
  });
  const sansExemple = fonctions.filter((f) => !tests.some((t) => t.fn === f));
  if (sansExemple.length) throw new ErreurCadrage(`${qui}: every function needs at least one example (${sansExemple.join(', ')}).`);
  return { module, fonctions, tests };
}

/** Reads the AI's answer and builds the hive's heart and first plan. Throws ErreurCadrage with a message for the creator. */
export function lireCadrage(texte: string, idee: Idee): Cadrage {
  verifierIdee(idee);
  let brut: unknown;
  try {
    brut = lireJson(texte);
  } catch {
    throw new ErreurCadrage('No JSON found in the answer. Ask your AI to answer with the JSON block only.');
  }
  if (!brut || typeof brut !== 'object' || Array.isArray(brut)) throw new ErreurCadrage('The answer is not a JSON object with "module", "functions", "examples" and "parts".');
  const r = brut as Record<string, unknown>;
  const luau = idee.langage === 'luau';
  const tete = lireModule(r, luau, 'The heart');
  const description = String(r.description ?? '').trim();
  if (description.length < 10 || description.length > 2000) throw new ErreurCadrage('The description must be 10 to 2,000 characters.');
  const parties = Array.isArray(r.parts) ? r.parts : [];
  if (parties.length < PARTIES.min || parties.length > PARTIES.max) throw new ErreurCadrage(`Plan ${PARTIES.min} to ${PARTIES.max} parts in "parts" (found ${parties.length}).`);
  const plan = parties.map((x, i) => {
    const p = (x ?? {}) as Record<string, unknown>;
    const qui = `Part ${i + 1}`;
    const m = lireModule(p, luau, qui);
    const but = String(p.goal ?? '').trim();
    if (but.length < 5 || but.length > 300) throw new ErreurCadrage(`${qui}: "goal" must be one sentence of 5 to 300 characters.`);
    return { ...m, but };
  });
  const modules = [tete.module, ...plan.map((p) => p.module)];
  const double = modules.find((m, i) => modules.indexOf(m) !== i);
  if (double) throw new ErreurCadrage(`Two modules share the file ${double}: each part needs its own file.`);
  const critere = (m: { module: string; tests: TestCase[] }): CritereV0 | CritereLuau =>
    luau
      ? { classe: 'V0', verificateur: 'tests-luau@1', module: m.module, tests: m.tests, portes: ['luau-checks@1'] }
      : { classe: 'V0', verificateur: 'tests-js@1', module: m.module, tests: m.tests };
  const nom = idee.nom.trim();
  const objectif = idee.objectif.trim();
  const listeParties = plan.map((p) => `${p.module} (${p.fonctions.join(', ')})`).join('; ');
  return {
    slug: slugDe(nom),
    nom,
    objectif,
    ...(luau ? { playbook: 'roblox-pure-logic-first' } : {}),
    racine: {
      objectif,
      capsule: `${description}\n\nFunctions of ${tete.module}: ${tete.fonctions.join(', ')}.\nIt assembles the parts: ${listeParties}.`,
      atomique: false,
      critere_fini: critere(tete),
    },
    enfants: plan.map((p) => ({
      objectif: p.but,
      capsule: `A part of “${nom}”: ${objectif}\n\n${description}\n\nThis part is ${p.module}, with ${p.fonctions.join(', ')}. The heart, ${tete.module}, assembles it with the other parts.`,
      atomique: true,
      critere_fini: critere(p),
    })),
  };
}

/** A value as it reads in a sentence: JSON, cut when long. */
function montrer(v: unknown): string {
  const s = JSON.stringify(v);
  return s.length > 80 ? `${s.slice(0, 77)}…` : s;
}

/** An example as the creator reads it: `slugify("Hello World") gives "hello-world"`. */
export function phraseTest(t: TestCase): string {
  return `${t.fn}(${t.args.map(montrer).join(', ')}) gives ${montrer(t.attendu)}`;
}
