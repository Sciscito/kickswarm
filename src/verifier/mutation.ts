import type { Livrable } from '../protocol/types.js';

// Moteur de mutation (OSP v0.2, §3.2) : il injecte un petit bug à la fois dans du JavaScript
// (opérateur inversé, comparaison décalée, booléen ou constante modifiés) sans jamais toucher
// aux chaînes, aux gabarits ni aux commentaires.
// Une bonne suite de tests doit « tuer » ces mutants : c'est le score de mutation.
//
// Version 2 : il mute aussi l'intérieur des expressions régulières (quantificateurs, ancres,
// négation des classes, \d \s \w, drapeaux) et les méthodes qui ont un contraire (toLowerCase ↔
// toUpperCase, startsWith ↔ endsWith, some ↔ every, min ↔ max…). Le premier essai avec une vraie
// IA l'a montré : une référence écrite proprement avec des regex n'offrait sinon « rien à muter ».
// Le moteur fait partie du rejeu (les pièges en dépendent) : un registre annonce sa version.

/** La version du moteur que les nouveaux registres annoncent. */
export const MOTEUR_MUTATION = 2;

/** Méthodes qui ont un contraire, ou presque : appeler l'une pour l'autre est un bug plausible. */
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

/** Repère les sites de mutation dans le code, hors chaînes et commentaires (et hors regex en version 1). */
export function mutationSites(src: string, version = MOTEUR_MUTATION): Site[] {
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
    // Expressions régulières : ignorées en version 1, mutées de l'intérieur en version 2.
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
          // Une classe et son contraire : [a-z] ↔ [^a-z].
          if (src[i + 1] === '^') {
            regex.push({ index: i + 1, avant: '^', apres: '' });
            i += 2;
          } else {
            regex.push({ index: i + 1, avant: '', apres: '^' });
            i++;
          }
          continue;
        }
        // « au moins un » → « au moins deux » : l'erreur de borne des quantificateurs. (+ → * donnerait souvent
        // un mutant équivalent : dans un remplacement par '', un motif qui accepte le vide ne change rien.)
        if (c === '+') regex.push({ index: i, avant: '+', apres: '{2,}' });
        else if (c === '*') regex.push({ index: i, avant: '*', apres: '+' });
        // Un « ? » quantificateur (pas celui de (?: …), ni celui d'un quantificateur paresseux).
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
    // Identifiants et mots-clés (true / false), nombres.
    if (IDENT.test(ch)) {
      let j = i;
      while (j < src.length && IDENT.test(src[j]!)) j++;
      const word = src.slice(i, j);
      if (word === 'true') sites.push({ index: i, avant: 'true', apres: 'false' });
      else if (word === 'false') sites.push({ index: i, avant: 'false', apres: 'true' });
      // Une méthode appelée pour son contraire : s.toLowerCase() → s.toUpperCase().
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
export function mutants(livrable: Livrable, opts: { max?: number; fichiers?: string[]; version?: number } = {}): Mutant[] {
  const max = opts.max ?? 40;
  const all: Mutant[] = [];
  for (const [fichier, src] of Object.entries(livrable.fichiers)) {
    if (!/\.(mjs|js)$/.test(fichier) || (opts.fichiers && !opts.fichiers.includes(fichier))) continue;
    for (const s of mutationSites(src, opts.version)) {
      const ligne = src.slice(0, s.index).split('\n').length;
      const muted = src.slice(0, s.index) + s.apres + src.slice(s.index + s.avant.length);
      all.push({ fichier, ligne, avant: s.avant, apres: s.apres, livrable: { fichiers: { ...livrable.fichiers, [fichier]: muted } } });
    }
  }
  if (all.length <= max) return all;
  return Array.from({ length: max }, (_, k) => all[Math.floor((k * all.length) / max)]!);
}
