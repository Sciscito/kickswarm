import type { Livrable } from '../protocol/types.js';
import { mutationSitesLuau } from './mutation-luau.js';

// Mutation engine (OSP v0.2, §3.2): it injects one small bug at a time into JavaScript
// (flipped operator, shifted comparison, changed boolean or constant) without ever touching
// strings, templates or comments.
// A good test suite must “kill” these mutants: that is the mutation score.
//
// Version 2: it also mutates the inside of regular expressions (quantifiers, anchors,
// negated classes, \d \s \w, flags) and methods that have an opposite (toLowerCase ↔
// toUpperCase, startsWith ↔ endsWith, some ↔ every, min ↔ max…). The first trial with a real
// AI showed why: a reference written cleanly with regexes otherwise offered “nothing to mutate”.
// Version 3 (OSP v0.3 §3.6): it also mutates Luau files (mutation-luau.ts).
// The engine is part of the replay (traps depend on it): a registry announces its version.

/** The engine version that new registries announce. */
export const MOTEUR_MUTATION = 3;

/** Methods that have an opposite, or nearly: calling one for the other is a plausible bug. */
const METHODES: Record<string, string> = {
  toLowerCase: 'toUpperCase',
  toUpperCase: 'toLowerCase',
  toLocaleLowerCase: 'toLocaleUpperCase',
  toLocaleUpperCase: 'toLocaleLowerCase',
  startsWith: 'endsWith',
  endsWith: 'startsWith',
  indexOf: 'lastIndexOf',
  lastIndexOf: 'indexOf',
  some: 'every',
  every: 'some',
  min: 'max',
  max: 'min',
  floor: 'ceil',
  ceil: 'floor',
  trim: 'trimStart',
  trimStart: 'trimEnd',
  trimEnd: 'trimStart',
  padStart: 'padEnd',
  padEnd: 'padStart',
  push: 'unshift',
  unshift: 'push',
  pop: 'shift',
  shift: 'pop',
  reduce: 'reduceRight',
  reduceRight: 'reduce',
};

export interface Mutant {
  fichier: string;
  ligne: number;
  avant: string;
  apres: string;
  livrable: Livrable;
}

/** Replacements, longest first so that `===` is never read as `==`. */
const OPERATORS: Array<[string, string]> = [
  ['===', '!=='],
  ['!==', '==='],
  ['&&', '||'],
  ['||', '&&'],
  ['<=', '<'],
  ['>=', '>'],
  ['==', '!='],
  ['!=', '=='],
  ['+=', '-='],
  ['-=', '+='],
  ['<', '<='],
  ['>', '>='],
  ['+', '-'],
  ['-', '+'],
  ['*', '/'],
  ['/', '*'],
  ['%', '*'],
];
/** Tokens to skip as they are: mutating them would break the syntax or make no sense. */
const SKIP = ['>>>=', '>>>', '**=', '<<=', '>>=', '...', '=>', '++', '--', '**', '?.', '??', '<<', '>>', '&=', '|=', '^='];
const IDENT = /[A-Za-z0-9_$]/;
/** After these characters, a `/` opens a regular expression, not a division. */
const REGEX_BEFORE = new Set(['', '(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '<', '>', '~', '^']);

interface Site {
  index: number;
  avant: string;
  apres: string;
}

/** Finds the mutation sites in the code, outside strings and comments (and outside regexes in version 1). */
export function mutationSites(src: string, version = MOTEUR_MUTATION): Site[] {
  const sites: Site[] = [];
  let i = 0;
  let lastSignificant = '';
  while (i < src.length) {
    const ch = src[i]!;
    const next = src[i + 1];
    // Comments.
    if (ch === '/' && next === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (ch === '/' && next === '*') { const end = src.indexOf('*/', i + 2); i = end < 0 ? src.length : end + 2; continue; }
    // Strings and templates (the content of `${…}` is not mutated: caution).
    if (ch === '"' || ch === "'" || ch === '`') {
      const q = ch;
      i++;
      while (i < src.length && src[i] !== q) { if (src[i] === '\\') i++; i++; }
      i++;
      lastSignificant = 'a';
      continue;
    }
    // Regular expressions: skipped in version 1, mutated from the inside in version 2.
    if (ch === '/' && REGEX_BEFORE.has(lastSignificant) && !/[\w)\]]/.test(lastSignificant)) {
      const regex: Site[] = [];
      i++;
      let inClass = false;
      while (i < src.length && (src[i] !== '/' || inClass)) {
        const c = src[i]!;
        if (c === '\n') break;
        if (c === '\\') {
          const e = src[i + 1] ?? '';
          // \d ↔ \D, \s ↔ \S, \w ↔ \W.
          if ('dDsSwW'.includes(e) && e) regex.push({ index: i + 1, avant: e, apres: e === e.toLowerCase() ? e.toUpperCase() : e.toLowerCase() });
          i += 2;
          continue;
        }
        if (inClass) {
          if (c === ']') inClass = false;
          i++;
          continue;
        }
        if (c === '[') {
          inClass = true;
          // A class and its opposite: [a-z] ↔ [^a-z].
          if (src[i + 1] === '^') {
            regex.push({ index: i + 1, avant: '^', apres: '' });
            i += 2;
          } else {
            regex.push({ index: i + 1, avant: '', apres: '^' });
            i++;
          }
          continue;
        }
        // “at least one” → “at least two”: the off-by-one error of quantifiers. (+ → * would often give
        // an equivalent mutant: in a replacement by '', a pattern that accepts the empty string changes nothing.)
        if (c === '+') regex.push({ index: i, avant: '+', apres: '{2,}' });
        else if (c === '*') regex.push({ index: i, avant: '*', apres: '+' });
        // A quantifier “?” (not the one in (?: …), nor the one of a lazy quantifier).
        else if (c === '?' && !'(+*?}'.includes(src[i - 1] ?? '')) regex.push({ index: i, avant: '?', apres: '' });
        else if (c === '^' || c === '$') regex.push({ index: i, avant: c, apres: '' });
        i++;
      }
      const ferme = src[i] === '/';
      i++;
      while (i < src.length && /[a-z]/i.test(src[i]!)) {
        if ('gims'.includes(src[i]!)) regex.push({ index: i, avant: src[i]!, apres: '' });
        i++;
      }
      if (version >= 2 && ferme) sites.push(...regex);
      lastSignificant = 'a';
      continue;
    }
    // Identifiers and keywords (true / false), numbers.
    if (IDENT.test(ch)) {
      let j = i;
      while (j < src.length && IDENT.test(src[j]!)) j++;
      const word = src.slice(i, j);
      if (word === 'true') sites.push({ index: i, avant: 'true', apres: 'false' });
      else if (word === 'false') sites.push({ index: i, avant: 'false', apres: 'true' });
      // A method called instead of its opposite: s.toLowerCase() → s.toUpperCase().
      else if (version >= 2 && src[i - 1] === '.' && src[i - 2] !== '.' && Object.hasOwn(METHODES, word)) sites.push({ index: i, avant: word, apres: METHODES[word]! });
      else if (/^\d+$/.test(word) && src[j] !== '.' && src[i - 1] !== '.') {
        const n = Number(word);
        sites.push({ index: i, avant: word, apres: String(n === 0 ? 1 : n === 1 ? 0 : n + 1) });
      }
      i = j;
      lastSignificant = 'a';
      continue;
    }
    if (/\s/.test(ch)) { i++; continue; }
    // Operators.
    const skip = SKIP.find((t) => src.startsWith(t, i));
    if (skip) { i += skip.length; lastSignificant = skip.slice(-1); continue; }
    const op = OPERATORS.find(([t]) => src.startsWith(t, i));
    if (op) {
      // A unary “-” or “+” (after an operator or an opening parenthesis) is not mutated.
      const unary = (op[0] === '-' || op[0] === '+') && REGEX_BEFORE.has(lastSignificant) && !/[\w)\]]/.test(lastSignificant);
      if (!unary) sites.push({ index: i, avant: op[0], apres: op[1] });
      i += op[0].length;
      lastSignificant = op[0].slice(-1);
      continue;
    }
    lastSignificant = ch;
    i++;
  }
  return sites;
}

/** Generates at most `max` mutants of the deliverable, spread evenly over all the sites. */
export function mutants(livrable: Livrable, opts: { max?: number; fichiers?: string[]; version?: number } = {}): Mutant[] {
  const max = opts.max ?? 40;
  const all: Mutant[] = [];
  for (const [fichier, src] of Object.entries(livrable.fichiers)) {
    if (opts.fichiers && !opts.fichiers.includes(fichier)) continue;
    const luau = /\.(luau|lua)$/.test(fichier);
    if (luau ? (opts.version ?? MOTEUR_MUTATION) < 3 : !/\.(mjs|js)$/.test(fichier)) continue;
    for (const s of luau ? mutationSitesLuau(src) : mutationSites(src, opts.version)) {
      const ligne = src.slice(0, s.index).split('\n').length;
      const muted = src.slice(0, s.index) + s.apres + src.slice(s.index + s.avant.length);
      all.push({ fichier, ligne, avant: s.avant, apres: s.apres, livrable: { ...livrable, fichiers: { ...livrable.fichiers, [fichier]: muted } } });
    }
  }
  if (all.length <= max) return all;
  return Array.from({ length: max }, (_, k) => all[Math.floor((k * all.length) / max)]!);
}
