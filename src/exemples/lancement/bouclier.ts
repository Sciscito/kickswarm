import type { CellSpec, CritereTestsDeTests } from '../../protocol/types.js';
import type { ProjetLancement } from './commun.js';

// The open source shield (docs/projets.md): test suites for the kinds of small code the world depends on.
// Each cell gives the code; the deliverable is tests.json, which must pass on that code and catch most of
// its mutants (copies with one small bug injected): `tests-de-tests@1`. First on small, self-contained
// targets written for this project, then on real libraries.

const SEMVER = `export function compareVersions(a, b) {
  const x = a.split('.').map((s) => parseInt(s, 10) || 0), y = b.split('.').map((s) => parseInt(s, 10) || 0);
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) {
    const p = x[i] ?? 0, q = y[i] ?? 0;
    if (p > q) return 1;
    if (p < q) return -1;
  }
  return 0;
}
`;

const SLUG = `export function slugify(s) {
  return s
    .normalize('NFD').replace(/[\\u0300-\\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
`;

const QUERY = `export function parseQuery(q) {
  const out = {};
  for (const part of q.replace(/^\\?/, '').split('&')) {
    if (!part) continue;
    const i = part.indexOf('=');
    const k = decodeURIComponent((i < 0 ? part : part.slice(0, i)).replace(/\\+/g, ' '));
    const v = i < 0 ? '' : decodeURIComponent(part.slice(i + 1).replace(/\\+/g, ' '));
    if (!k) continue;
    if (k in out) out[k] = [].concat(out[k], v);
    else out[k] = v;
  }
  return out;
}
`;

const CSV = `export function parseCsvLine(line) {
  const out = [];
  let cur = '', inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else cur += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}
`;

const EGAL = `export function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && deepEqual(a[k], b[k]));
}
`;

function cellule(objectif: string, module: string, code: string, fonctions: string[], capsule: string): CellSpec {
  const critere: CritereTestsDeTests = { classe: 'V0', verificateur: 'tests-de-tests@1', module, cible: { fichiers: { [module]: code } }, fonctions, score_min: 0.8 };
  return { objectif, capsule, atomique: true, critere_fini: critere };
}

const enfants: CellSpec[] = [
  cellule('Test suite for compareVersions(a, b), dotted version numbers', 'semver.mjs', SEMVER, ['compareVersions'], 'compareVersions compares "1.2.10" and "1.2.9" segment by segment as numbers; a missing segment counts as 0. It returns -1, 0 or 1. Write tests that would catch any small bug in it: boundaries, equal versions, different lengths.'),
  cellule('Test suite for slugify(s), text to URL slugs', 'slug.mjs', SLUG, ['slugify'], 'slugify removes accents, lowercases, turns every run of other characters into one "-", and trims "-" at both ends. Write tests that would catch any small bug in it.'),
  cellule('Test suite for parseQuery(q), URL query strings', 'query.mjs', QUERY, ['parseQuery'], 'parseQuery reads "?a=1&b=two&a=3" into { a: ["1", "3"], b: "two" }: a leading "?" is optional, "+" means a space, %XX is decoded, a key seen twice becomes a list, an empty key is skipped, a key without "=" has the value "". Write tests that would catch any small bug in it.'),
  cellule('Test suite for parseCsvLine(line), one line of CSV', 'csv.mjs', CSV, ['parseCsvLine'], 'parseCsvLine splits on commas; a field in double quotes may contain commas, and "" inside quotes is one quote. Write tests that would catch any small bug in it.'),
  cellule('Test suite for deepEqual(a, b), structural equality', 'egal.mjs', EGAL, ['deepEqual'], 'deepEqual compares numbers, strings, booleans, null, arrays and plain objects by content; an array never equals an object. Write tests that would catch any small bug in it.'),
];

// The heart: one suite for the five, against a module that gathers them.
const TOUT = `export { compareVersions } from './semver.mjs';\nexport { slugify } from './slug.mjs';\nexport { parseQuery } from './query.mjs';\nexport { parseCsvLine } from './csv.mjs';\nexport { deepEqual } from './egal.mjs';\n`;
const racine: CellSpec = {
  objectif: 'The open source shield, first round: strong test suites for five kinds of everyday code',
  capsule: 'Each child writes the tests of one module; the heart gathers them into one tests.json for shield.mjs, which re-exports the five functions.',
  atomique: false,
  critere_fini: {
    classe: 'V0',
    verificateur: 'tests-de-tests@1',
    module: 'shield.mjs',
    cible: { fichiers: { 'shield.mjs': TOUT, 'semver.mjs': SEMVER, 'slug.mjs': SLUG, 'query.mjs': QUERY, 'csv.mjs': CSV, 'egal.mjs': EGAL } },
    fonctions: ['compareVersions', 'slugify', 'parseQuery', 'parseCsvLine', 'deepEqual'],
    score_min: 0.8,
  },
};

export const BOUCLIER: ProjetLancement = {
  slug: 'open-source-shield',
  nom: 'The open source shield',
  objectif: 'Strong test suites for the code the world depends on',
  racine,
  enfants,
  secrets: enfants.map(() => ({})),
};

/** Strong suites, one per target: they show each cell can be done (and serve demos). */
export const EXEMPLES_BOUCLIER: Record<string, { tests: Array<{ fn: string; args: unknown[]; attendu: unknown }> }> = {
  'semver.mjs': {
    tests: [
      { fn: 'compareVersions', args: ['1.2.10', '1.2.9'], attendu: 1 },
      { fn: 'compareVersions', args: ['1.2.9', '1.2.10'], attendu: -1 },
      { fn: 'compareVersions', args: ['1.0', '1.0.0'], attendu: 0 },
      { fn: 'compareVersions', args: ['1.0.1', '1.0'], attendu: 1 },
      { fn: 'compareVersions', args: ['1', '1.0.1'], attendu: -1 },
      { fn: 'compareVersions', args: ['2.0.0', '10.0.0'], attendu: -1 },
      { fn: 'compareVersions', args: ['3.4.5', '3.4.5'], attendu: 0 },
      { fn: 'compareVersions', args: ['0.0.1', '0.0.0'], attendu: 1 },
      { fn: 'compareVersions', args: ['1.x', '1.0'], attendu: 0 },
      { fn: 'compareVersions', args: ['0.1', '0.2'], attendu: -1 },
    ],
  },
  'slug.mjs': {
    tests: [
      { fn: 'slugify', args: ['Hello World'], attendu: 'hello-world' },
      { fn: 'slugify', args: ['Crème brûlée'], attendu: 'creme-brulee' },
      { fn: 'slugify', args: ['  --Spaces & symbols!!  '], attendu: 'spaces-symbols' },
      { fn: 'slugify', args: ['a__b'], attendu: 'a-b' },
      { fn: 'slugify', args: ['ABC123'], attendu: 'abc123' },
      { fn: 'slugify', args: [''], attendu: '' },
      { fn: 'slugify', args: ['---'], attendu: '' },
      { fn: 'slugify', args: ['Ça va? Oui.'], attendu: 'ca-va-oui' },
      { fn: 'slugify', args: ['z'], attendu: 'z' },
      { fn: 'slugify', args: ['x9y'], attendu: 'x9y' },
    ],
  },
  'query.mjs': {
    tests: [
      { fn: 'parseQuery', args: ['?a=1&b=two&a=3'], attendu: { a: ['1', '3'], b: 'two' } },
      { fn: 'parseQuery', args: ['x=hello+world'], attendu: { x: 'hello world' } },
      { fn: 'parseQuery', args: ['name=%C3%A9t%C3%A9'], attendu: { name: 'été' } },
      { fn: 'parseQuery', args: ['flag&k=v'], attendu: { flag: '', k: 'v' } },
      { fn: 'parseQuery', args: ['=skip&ok=1'], attendu: { ok: '1' } },
      { fn: 'parseQuery', args: [''], attendu: {} },
      { fn: 'parseQuery', args: ['a=1&&b=2'], attendu: { a: '1', b: '2' } },
      { fn: 'parseQuery', args: ['a=1&a=2&a=3'], attendu: { a: ['1', '2', '3'] } },
      { fn: 'parseQuery', args: ['eq=a=b'], attendu: { eq: 'a=b' } },
      { fn: 'parseQuery', args: ['my+key=1'], attendu: { 'my key': '1' } },
      { fn: 'parseQuery', args: ['q=why?'], attendu: { q: 'why?' } },
      { fn: 'parseQuery', args: ['a+b+c=x+y+z'], attendu: { 'a b c': 'x y z' } },
    ],
  },
  'csv.mjs': {
    tests: [
      { fn: 'parseCsvLine', args: ['a,b,c'], attendu: ['a', 'b', 'c'] },
      { fn: 'parseCsvLine', args: ['"a,b",c'], attendu: ['a,b', 'c'] },
      { fn: 'parseCsvLine', args: ['"say ""hi""",x'], attendu: ['say "hi"', 'x'] },
      { fn: 'parseCsvLine', args: [''], attendu: [''] },
      { fn: 'parseCsvLine', args: [',,'], attendu: ['', '', ''] },
      { fn: 'parseCsvLine', args: ['a,'], attendu: ['a', ''] },
      { fn: 'parseCsvLine', args: ['"",b'], attendu: ['', 'b'] },
      { fn: 'parseCsvLine', args: ['x"y,z'], attendu: ['xy,z'] },
      { fn: 'parseCsvLine', args: ['"a""",b'], attendu: ['a"', 'b'] },
    ],
  },
  'egal.mjs': {
    tests: [
      { fn: 'deepEqual', args: [{ a: [1, 2] }, { a: [1, 2] }], attendu: true },
      { fn: 'deepEqual', args: [{ a: 1 }, { a: 2 }], attendu: false },
      { fn: 'deepEqual', args: [[1, 2], [1, 2, 3]], attendu: false },
      { fn: 'deepEqual', args: [[], {}], attendu: false },
      { fn: 'deepEqual', args: [null, null], attendu: true },
      { fn: 'deepEqual', args: [null, {}], attendu: false },
      { fn: 'deepEqual', args: [{}, null], attendu: false },
      { fn: 'deepEqual', args: [1, '1'], attendu: false },
      { fn: 'deepEqual', args: [{ a: 1, b: 2 }, { b: 2, a: 1 }], attendu: true },
      { fn: 'deepEqual', args: [{ a: 1 }, { b: 1 }], attendu: false },
      { fn: 'deepEqual', args: [{ a: { b: [1, { c: 'x' }] } }, { a: { b: [1, { c: 'x' }] } }], attendu: true },
      { fn: 'deepEqual', args: [{ a: { b: [1, { c: 'x' }] } }, { a: { b: [1, { c: 'y' }] } }], attendu: false },
      { fn: 'deepEqual', args: [true, false], attendu: false },
      { fn: 'deepEqual', args: ['s', 's'], attendu: true },
      { fn: 'deepEqual', args: [1, {}], attendu: false },
      { fn: 'deepEqual', args: [{}, 'x'], attendu: false },
      { fn: 'deepEqual', args: [[1], { 0: 1 }], attendu: false },
    ],
  },
};
