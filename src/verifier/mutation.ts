import type { Livrable } from '../protocol/types.js';

// Moteur de mutation (OSP v0.2, §3.2) : il injecte un petit bug à la fois dans du JavaScript
// (opérateur inversé, comparaison décalée, booléen ou constante modifiés) sans jamais toucher
// aux chaînes, aux gabarits, aux commentaires ni aux expressions régulières.
// Une bonne suite de tests doit « tuer » ces mutants : c'est le score de mutation.

export interface Mutant {
  fichier: string;
  ligne: number;
  avant: string;
  apres: string;
  livrable: Livrable;
}

/** Remplacements, du plus long au plus court pour que `===` ne soit jamais lu comme `==`. */
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
/** Jetons à sauter tels quels : les muter casserait la syntaxe ou n'aurait pas de sens. */
const SKIP = ['>>>=', '>>>', '**=', '<<=', '>>=', '...', '=>', '++', '--', '**', '?.', '??', '<<', '>>', '&=', '|=', '^='];
const IDENT = /[A-Za-z0-9_$]/;
/** Après ces caractères, un `/` ouvre une expression régulière, pas une division. */
const REGEX_BEFORE = new Set(['', '(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '<', '>', '~', '^']);

interface Site {
  index: number;
  avant: string;
  apres: string;
}

/** Repère les sites de mutation dans le code, hors chaînes, commentaires et expressions régulières. */
export function mutationSites(src: string): Site[] {
  const sites: Site[] = [];
  let i = 0;
  let lastSignificant = '';
  while (i < src.length) {
    const ch = src[i]!;
    const next = src[i + 1];
    // Commentaires.
    if (ch === '/' && next === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (ch === '/' && next === '*') { const end = src.indexOf('*/', i + 2); i = end < 0 ? src.length : end + 2; continue; }
    // Chaînes et gabarits (le contenu des `${…}` n'est pas muté : prudence).
    if (ch === '"' || ch === "'" || ch === '`') {
      const q = ch;
      i++;
      while (i < src.length && src[i] !== q) { if (src[i] === '\\') i++; i++; }
      i++;
      lastSignificant = 'a';
      continue;
    }
    // Expressions régulières.
    if (ch === '/' && REGEX_BEFORE.has(lastSignificant) && !/[\w)\]]/.test(lastSignificant)) {
      i++;
      let inClass = false;
      while (i < src.length && (src[i] !== '/' || inClass)) {
        if (src[i] === '\\') i++;
        else if (src[i] === '[') inClass = true;
        else if (src[i] === ']') inClass = false;
        else if (src[i] === '\n') break;
        i++;
      }
      i++;
      while (i < src.length && /[a-z]/i.test(src[i]!)) i++;
      lastSignificant = 'a';
      continue;
    }
    // Identifiants et mots-clés (true / false), nombres.
    if (IDENT.test(ch)) {
      let j = i;
      while (j < src.length && IDENT.test(src[j]!)) j++;
      const word = src.slice(i, j);
      if (word === 'true') sites.push({ index: i, avant: 'true', apres: 'false' });
      else if (word === 'false') sites.push({ index: i, avant: 'false', apres: 'true' });
      else if (/^\d+$/.test(word) && src[j] !== '.' && src[i - 1] !== '.') {
        const n = Number(word);
        sites.push({ index: i, avant: word, apres: String(n === 0 ? 1 : n === 1 ? 0 : n + 1) });
      }
      i = j;
      lastSignificant = 'a';
      continue;
    }
    if (/\s/.test(ch)) { i++; continue; }
    // Opérateurs.
    const skip = SKIP.find((t) => src.startsWith(t, i));
    if (skip) { i += skip.length; lastSignificant = skip.slice(-1); continue; }
    const op = OPERATORS.find(([t]) => src.startsWith(t, i));
    if (op) {
      // Un « - » ou « + » unaire (après un opérateur ou une parenthèse ouvrante) n'est pas muté.
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

/** Génère au plus `max` mutants du livrable, répartis régulièrement sur tous les sites. */
export function mutants(livrable: Livrable, opts: { max?: number; fichiers?: string[] } = {}): Mutant[] {
  const max = opts.max ?? 40;
  const all: Mutant[] = [];
  for (const [fichier, src] of Object.entries(livrable.fichiers)) {
    if (!/\.(mjs|js)$/.test(fichier) || (opts.fichiers && !opts.fichiers.includes(fichier))) continue;
    for (const s of mutationSites(src)) {
      const ligne = src.slice(0, s.index).split('\n').length;
      const muted = src.slice(0, s.index) + s.apres + src.slice(s.index + s.avant.length);
      all.push({ fichier, ligne, avant: s.avant, apres: s.apres, livrable: { fichiers: { ...livrable.fichiers, [fichier]: muted } } });
    }
  }
  if (all.length <= max) return all;
  return Array.from({ length: max }, (_, k) => all[Math.floor((k * all.length) / max)]!);
}
