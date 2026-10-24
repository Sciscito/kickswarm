// The mutation engine for Luau (OSP v0.3 §3.6): the same idea as for JavaScript, one small bug at a
// time, for test strength and trap cells. It flips == and ~=, and and or, < and <=, > and >=, + and -,
// * and /, removes not, changes constants and booleans, and swaps math.min and math.max, math.floor
// and math.ceil, upper and lower. It never touches strings, comments or type annotations, so that
// a mutant is still valid Luau: a mutant that does not even load would be a trap anyone could spot.

export interface SiteLuau {
  index: number;
  avant: string;
  apres: string;
}

const OPERATEURS: Array<[string, string]> = [
  ['==', '~='],
  ['~=', '=='],
  ['<=', '<'],
  ['>=', '>'],
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
/** Tokens left as they are. */
const PASSER = ['...', '..=', '//=', '*=', '/=', '%=', '^=', '//', '..', '->', '::', '^', '#'];
/** Swapped when called on `math.` (or, for upper/lower, as a string method). */
const MATH: Record<string, string> = { min: 'max', max: 'min', floor: 'ceil', ceil: 'floor' };
const CHAINES: Record<string, string> = { upper: 'lower', lower: 'upper' };
/** After these keywords, a value starts: a `-` there is unary, and a type annotation has ended. */
const MOTS_VALEUR = new Set(['return', 'and', 'or', 'not', 'then', 'do', 'else', 'elseif', 'in', 'local', 'if', 'while', 'until', 'repeat', 'end', 'for', 'function']);
const IDENT = /[A-Za-z0-9_]/;

/** The level of a long bracket `[==[` at `i`, or -1. */
function niveauLong(src: string, i: number): number {
  if (src[i] !== '[') return -1;
  let j = i + 1;
  while (src[j] === '=') j++;
  return src[j] === '[' ? j - i - 1 : -1;
}

function finLong(src: string, i: number, niveau: number): number {
  const fin = src.indexOf(`]${'='.repeat(niveau)}]`, i + niveau + 2);
  return fin < 0 ? src.length : fin + niveau + 2;
}

/** The index right after the `>` that closes the `<` at `i` (generic parameters). */
function finChevrons(src: string, i: number): number {
  let prof = 0;
  for (let j = i; j < src.length; j++) {
    if (src[j] === '<') prof++;
    else if (src[j] === '>' && --prof === 0) return j + 1;
    else if (src[j] === '\n' || src[j] === '=') return j;
  }
  return src.length;
}

export function mutationSitesLuau(src: string): SiteLuau[] {
  const sites: SiteLuau[] = [];
  let i = 0;
  /** The last significant token: an identifier or keyword, `)`/`]`/`}`, a value, or an operator character. */
  let dernier = '';
  let motPrecedent = '';
  /** Was the last token a keyword after which a value starts (return, and, if…)? */
  let apresMotCle = false;
  // Type context: after `x: `, `): `, `::`, `->`, and in `type X = …`, until it ends at depth 0.
  let enType = false;
  let declarationType = false;
  let prof = 0;
  const finType = () => {
    enType = false;
    declarationType = false;
  };
  while (i < src.length) {
    const c = src[i]!;
    // Comments: --[[ … ]], --[==[ … ]==], -- to the end of the line.
    if (c === '-' && src[i + 1] === '-') {
      const n = niveauLong(src, i + 2);
      if (n >= 0) i = finLong(src, i + 2, n);
      else while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    if (c === '\n') {
      if (enType && prof <= 0) finType();
      i++;
      continue;
    }
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    // Any token but a keyword clears the flag (keywords set it again below).
    const motCle = apresMotCle;
    apresMotCle = false;
    // Strings: "…", '…', `…` (interpolated: left whole), [[ … ]].
    if (c === '"' || c === "'" || c === '`') {
      i++;
      while (i < src.length && src[i] !== c && src[i] !== '\n') i += src[i] === '\\' ? 2 : 1;
      i++;
      dernier = 'a';
      continue;
    }
    const n = niveauLong(src, i);
    if (n >= 0) {
      i = finLong(src, i, n);
      dernier = 'a';
      continue;
    }
    if (IDENT.test(c)) {
      let j = i;
      while (j < src.length && IDENT.test(src[j]!)) j++;
      // A number: integers only (no 0x…, no 1.5, no 1e3).
      if (/\d/.test(c)) {
        while (j < src.length && /[A-Za-z0-9_.]/.test(src[j]!)) j++;
        const mot = src.slice(i, j);
        if (!enType && /^\d+$/.test(mot)) {
          const v = Number(mot);
          sites.push({ index: i, avant: mot, apres: String(v === 0 ? 1 : v === 1 ? 0 : v + 1) });
        }
        i = j;
        dernier = 'a';
        continue;
      }
      const mot = src.slice(i, j);
      const debutLigne = src.slice(src.lastIndexOf('\n', i - 1) + 1, i);
      if (mot === 'type' && /^\s*(export\s+)?$/.test(debutLigne) && /^\s+[A-Za-z_]/.test(src.slice(j))) {
        // `type Name = …` or `export type Name = …`: the whole declaration is a type.
        enType = true;
        declarationType = true;
        prof = 0;
      } else if (enType && prof <= 0 && MOTS_VALEUR.has(mot)) {
        finType();
      }
      if (!enType) {
        if (mot === 'and') sites.push({ index: i, avant: 'and', apres: 'or' });
        else if (mot === 'or') sites.push({ index: i, avant: 'or', apres: 'and' });
        else if (mot === 'true') sites.push({ index: i, avant: 'true', apres: 'false' });
        else if (mot === 'false') sites.push({ index: i, avant: 'false', apres: 'true' });
        else if (mot === 'not') {
          let k = j;
          while (src[k] === ' ' || src[k] === '\t') k++;
          sites.push({ index: i, avant: src.slice(i, k), apres: '' });
        } else if (src[i - 1] === '.' && src.slice(Math.max(0, i - 5), i) === 'math.' && Object.hasOwn(MATH, mot)) sites.push({ index: i, avant: mot, apres: MATH[mot]! });
        else if ((src[i - 1] === ':' || src.slice(Math.max(0, i - 7), i) === 'string.') && Object.hasOwn(CHAINES, mot)) sites.push({ index: i, avant: mot, apres: CHAINES[mot]! });
      }
      // Generic parameters right after a function's name: function f<T>(…).
      if (src[j] === '<' && (motPrecedent === 'function' || dernier === '.' || dernier === ':') && !enType) {
        motPrecedent = mot;
        i = finChevrons(src, j);
        dernier = 'a';
        continue;
      }
      motPrecedent = mot;
      apresMotCle = MOTS_VALEUR.has(mot);
      dernier = 'a';
      i = j;
      continue;
    }
    // A type annotation starts: `name: T`, `): T`, `x :: T`, `-> T`. A method call `a:b(` has no space.
    if (c === ':' && src[i + 1] === ':') {
      enType = true;
      prof = 0;
      i += 2;
      dernier = ':';
      continue;
    }
    if (c === ':' && !enType && (dernier === 'a' || dernier === ')') && /[\s{(]/.test(src[i + 1] ?? '')) {
      enType = true;
      prof = 0;
      i++;
      dernier = ':';
      continue;
    }
    if (c === '-' && src[i + 1] === '>') {
      enType = true;
      prof = 0;
      i += 2;
      dernier = '>';
      continue;
    }
    if (enType) {
      if ('({[<'.includes(c)) prof++;
      else if (')}]>'.includes(c)) {
        if (prof <= 0 && !declarationType) {
          finType();
          dernier = c;
          i++;
          continue;
        }
        prof--;
      } else if (prof <= 0 && (c === ',' || c === ';' || (c === '=' && !declarationType && src[i + 1] !== '='))) finType();
      else if (prof <= 0 && c === '=' && declarationType) {
        // `type X = …`: what follows the = is still a type.
      }
      i++;
      dernier = c;
      continue;
    }
    if ('([{'.includes(c)) prof++;
    else if (')]}'.includes(c)) prof = Math.max(0, prof - 1);
    const passe = PASSER.find((t) => src.startsWith(t, i));
    if (passe) {
      i += passe.length;
      dernier = passe.slice(-1);
      continue;
    }
    const op = OPERATEURS.find(([t]) => src.startsWith(t, i));
    if (op) {
      // A unary minus (at the start of a value) stays as it is.
      const unaire = op[0] === '-' && (dernier === '' || motCle || (dernier !== 'a' && !')]}'.includes(dernier)));
      if (!unaire) sites.push({ index: i, avant: op[0], apres: op[1] });
      i += op[0].length;
      dernier = op[0].slice(-1);
      continue;
    }
    dernier = c;
    i++;
  }
  return sites;
}
