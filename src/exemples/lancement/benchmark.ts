import type { CellSpec } from '../../protocol/types.js';
import { cellule, type ProjetLancement } from './commun.js';

// The uncopyable benchmark (docs/projets.md): problems whose hidden tests nobody sees before a cell is
// validated, so a solution has to solve the problem, not recite an answer. Each one also has property
// tests on hundreds of random inputs, seeded by the deliverable itself.

const SERIE = `export function longestRun(xs) {
  if (xs.length === 0) return 0;
  let best = 1, run = 1;
  for (let i = 1; i < xs.length; i++) {
    run = xs[i] === xs[i - 1] ? run + 1 : 1;
    best = Math.max(best, run);
  }
  return best;
}
`;

const COUVERT = `export function coveredLength(intervals) {
  const xs = intervals.filter((p) => p.length === 2).slice().sort((p, q) => p[0] - q[0]);
  let total = 0, end = -Infinity;
  for (const [a, b] of xs) {
    total += Math.max(0, b - Math.max(a, end));
    end = Math.max(end, b);
  }
  return total;
}
`;

const ILOTS = `export function islands(grid) {
  const g = grid.map((row) => row.split(''));
  const fill = (y, x) => {
    if (g[y]?.[x] !== '#') return;
    g[y][x] = '.';
    fill(y + 1, x);
    fill(y - 1, x);
    fill(y, x + 1);
    fill(y, x - 1);
  };
  let n = 0;
  for (let y = 0; y < g.length; y++) for (let x = 0; x < g[y].length; x++) if (g[y][x] === '#') { n++; fill(y, x); }
  return n;
}
`;

const JOURS = `const bissextile = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const dansMois = (y, m) => [31, bissextile(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
export function addDays(date, n) {
  let [y, m, d] = date.split('-').map(Number);
  while (n > 0) { d++; if (d > dansMois(y, m)) { d = 1; m++; if (m > 12) { m = 1; y++; } } n--; }
  while (n < 0) { d--; if (d < 1) { m--; if (m < 1) { m = 12; y--; } d = dansMois(y, m); } n++; }
  return String(y).padStart(4, '0') + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
}
`;

const PIECES = `export function minCoins(amount, coins) {
  const best = new Array(amount + 1).fill(Infinity);
  best[0] = 0;
  for (let a = 1; a <= amount; a++) for (const c of coins) if (c > 0 && c <= a && best[a - c] + 1 < best[a]) best[a] = best[a - c] + 1;
  return best[amount] === Infinity ? -1 : best[amount];
}
`;

const enfants = [
  cellule({
    objectif: 'longestRun(xs): the length of the longest run of equal neighbours',
    capsule: 'xs is an array of numbers or strings. A run is a stretch of consecutive equal values (===). Return the length of the longest one; 0 for an empty array. Module serie.mjs.',
    module: 'serie.mjs',
    tests: [
      { fn: 'longestRun', args: [[1, 1, 2, 2, 2, 3]], attendu: 3 },
      { fn: 'longestRun', args: [[]], attendu: 0 },
      { fn: 'longestRun', args: [['a']], attendu: 1 },
    ],
    caches: [
      { fn: 'longestRun', args: [[5, 5, 5, 5]], attendu: 4 },
      { fn: 'longestRun', args: [[1, 2, 1, 2]], attendu: 1 },
      { fn: 'longestRun', args: [['x', 'x', 'y', 'y', 'y', 'x']], attendu: 3 },
      { fn: 'longestRun', args: [[0, 0, 1, 1, 1, 1, 0]], attendu: 4 },
    ],
    proprietes: [
      { nom: 'between 1 and the length', fn: 'longestRun', args: [{ type: 'array', of: { type: 'int', min: 0, max: 3 }, maxLen: 30 }], verifie: 'args[0].length === 0 ? out === 0 : out >= 1 && out <= args[0].length' },
    ],
    reference: SERIE,
  }),
  cellule({
    objectif: 'coveredLength(intervals): the total length covered by intervals that may overlap',
    capsule: 'intervals is an array of [start, end] pairs of integers, half-open [start, end). Overlapping parts count once. An interval with end <= start covers nothing. Module couvert.mjs.',
    module: 'couvert.mjs',
    tests: [
      { fn: 'coveredLength', args: [[[1, 4], [2, 6]]], attendu: 5 },
      { fn: 'coveredLength', args: [[[0, 2], [5, 7]]], attendu: 4 },
      { fn: 'coveredLength', args: [[]], attendu: 0 },
    ],
    caches: [
      { fn: 'coveredLength', args: [[[0, 10], [2, 3], [4, 5]]], attendu: 10 },
      { fn: 'coveredLength', args: [[[3, 3], [5, 4]]], attendu: 0 },
      { fn: 'coveredLength', args: [[[1, 2], [2, 3]]], attendu: 2 },
      { fn: 'coveredLength', args: [[[-5, -1], [-3, 2]]], attendu: 7 },
    ],
    proprietes: [
      { nom: 'never more than the sum of the lengths', fn: 'coveredLength', args: [{ type: 'array', of: { type: 'array', of: { type: 'int', min: -20, max: 20 }, maxLen: 2 }, maxLen: 8 }], verifie: 'out >= 0 && out <= args[0].filter((p) => p.length === 2).reduce((s, [a, b]) => s + Math.max(0, b - a), 0)' },
    ],
    reference: COUVERT,
  }),
  cellule({
    objectif: 'islands(grid): how many islands on a map',
    capsule: 'grid is an array of strings, "#" for land and "." for water. Land cells touching up, down, left or right belong to the same island. Rows may have different lengths. Module ilots.mjs.',
    module: 'ilots.mjs',
    tests: [
      { fn: 'islands', args: [['##..', '#...', '..##']], attendu: 2 },
      { fn: 'islands', args: [['....']], attendu: 0 },
      { fn: 'islands', args: [['#.#', '.#.', '#.#']], attendu: 5 },
    ],
    caches: [
      { fn: 'islands', args: [[]], attendu: 0 },
      { fn: 'islands', args: [['###', '#.#', '###']], attendu: 1 },
      { fn: 'islands', args: [['#', '##', '..#']], attendu: 2 },
      { fn: 'islands', args: [['#..#', '#..#', '####']], attendu: 1 },
      { fn: 'islands', args: [['.#', '##']], attendu: 1 },
      { fn: 'islands', args: [['##', '#.']], attendu: 1 },
    ],
    reference: ILOTS,
  }),
  cellule({
    objectif: 'addDays(date, n): the date n days later, without any date library',
    capsule: 'date is "YYYY-MM-DD" in the Gregorian calendar; n is an integer, possibly negative. Leap years: divisible by 4, except by 100, unless by 400. Return "YYYY-MM-DD". Do not use Date or any date library. Module jours.mjs.',
    module: 'jours.mjs',
    tests: [
      { fn: 'addDays', args: ['2024-02-28', 1], attendu: '2024-02-29' },
      { fn: 'addDays', args: ['2023-12-31', 1], attendu: '2024-01-01' },
      { fn: 'addDays', args: ['2024-03-01', -1], attendu: '2024-02-29' },
    ],
    caches: [
      { fn: 'addDays', args: ['1900-02-28', 1], attendu: '1900-03-01' },
      { fn: 'addDays', args: ['2000-02-28', 1], attendu: '2000-02-29' },
      { fn: 'addDays', args: ['2024-01-01', 366], attendu: '2025-01-01' },
      { fn: 'addDays', args: ['2025-03-01', -365], attendu: '2024-03-01' },
      { fn: 'addDays', args: ['2024-05-10', 0], attendu: '2024-05-10' },
    ],
    reference: JOURS,
  }),
  cellule({
    objectif: 'minCoins(amount, coins): the fewest coins that make an amount',
    capsule: 'amount is an integer from 0 to 2000; coins lists positive coin values, each usable any number of times. Return the fewest coins whose values sum to amount, or -1 if it cannot be done. Module pieces.mjs.',
    module: 'pieces.mjs',
    tests: [
      { fn: 'minCoins', args: [11, [1, 2, 5]], attendu: 3 },
      { fn: 'minCoins', args: [3, [2]], attendu: -1 },
      { fn: 'minCoins', args: [0, [7]], attendu: 0 },
    ],
    caches: [
      { fn: 'minCoins', args: [6, [1, 3, 4]], attendu: 2 },
      { fn: 'minCoins', args: [27, [5, 10]], attendu: -1 },
      { fn: 'minCoins', args: [100, [1, 5, 10, 25]], attendu: 4 },
      { fn: 'minCoins', args: [7, [2, 4]], attendu: -1 },
      { fn: 'minCoins', args: [10, [1, 10]], attendu: 1 },
    ],
    proprietes: [
      { nom: 'with a 1 coin, never more coins than the amount', fn: 'minCoins', args: [{ type: 'int', min: 0, max: 300 }, { type: 'oneOf', values: [[1, 3, 4], [1, 5, 10, 25], [1, 7]] }], verifie: 'out >= 0 && out <= args[0]' },
    ],
    reference: PIECES,
  }),
];

const racine: CellSpec = {
  objectif: 'The uncopyable benchmark: five original problems, solved for real',
  capsule: 'benchmark.mjs exports longestRun, coveredLength, islands, addDays and minCoins.',
  atomique: false,
  critere_fini: {
    classe: 'V0',
    verificateur: 'tests-js@1',
    module: 'benchmark.mjs',
    tests: [
      { fn: 'longestRun', args: [[2, 2, 3]], attendu: 2 },
      { fn: 'coveredLength', args: [[[0, 3], [1, 2]]], attendu: 3 },
      { fn: 'islands', args: [['#.', '.#']], attendu: 2 },
      { fn: 'addDays', args: ['2024-12-31', 1], attendu: '2025-01-01' },
      { fn: 'minCoins', args: [8, [1, 4]], attendu: 2 },
    ],
  },
};

export const BENCHMARK: ProjetLancement = {
  slug: 'uncopyable-benchmark',
  nom: 'The uncopyable benchmark',
  objectif: 'Hard problems with hidden tests: no model can have learned them by heart',
  racine,
  enfants: enfants.map((e) => e.spec),
  secrets: enfants.map((e) => e.secrets),
};

export const SOLUTIONS_BENCHMARK: Record<string, string> = { 'serie.mjs': SERIE, 'couvert.mjs': COUVERT, 'ilots.mjs': ILOTS, 'jours.mjs': JOURS, 'pieces.mjs': PIECES };
