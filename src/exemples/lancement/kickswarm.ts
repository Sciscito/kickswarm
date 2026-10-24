import type { CellSpec } from '../../protocol/types.js';
import { cellule, type ProjetLancement } from './commun.js';

// Kickswarm builds Kickswarm (docs/projets.md): the swarm writes building blocks the protocol and its
// pages use (cell paths, durations, bee names, identifiers), then, through the GitHub bridge, its
// features. The references are this repository's own code.

const CHEMIN = `export function cheminCompare(a, b) {
  const x = a.split('.').map(Number), y = b.split('.').map(Number);
  for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  return x.length === y.length ? 0 : x.length < y.length ? -1 : 1;
}
`;

const DUREE = `export function duree(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return '—';
  const m = ms / 60000;
  if (m < 1) return 'under a minute';
  if (m < 90) return Math.round(m) + ' min';
  if (m < 48 * 60) return Math.round(m / 60) + ' h';
  return Math.round(m / 1440) + ' days';
}
`;

const NOM = `const ADJ = ['Swift', 'Bright', 'Calm', 'Brave', 'Keen', 'Sunny', 'Quiet', 'Golden', 'Nimble', 'Clever', 'Bold', 'Gentle', 'Lucky', 'Steady', 'Merry', 'Witty'];
const BEE = ['Bumblebee', 'Honeybee', 'Mason Bee', 'Carpenter Bee', 'Leafcutter', 'Sweat Bee', 'Digger Bee', 'Orchid Bee'];
export function nomAbeille(id) {
  let h = 2166136261;
  for (const c of id) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  h >>>= 0;
  return ADJ[h % ADJ.length] + ' ' + BEE[(h >>> 8) % BEE.length];
}
`;

const IDENTITE = `export function estIdentifiant(s) {
  return typeof s === 'string' && /^(pq1|slh1|ed25519):[A-Za-z0-9_-]{43}$/.test(s);
}
`;

const ID = 'pq1:EY3dBAF3jx_6l-g3gNs4_PwTvkDJXjJb_7ryhpMD4f4';
const CHEMINS = ['0', '1', '2', '10', '1.1', '1.2', '1.10', '2.3.1', '9'];

const enfants = [
  cellule({
    objectif: 'cheminCompare(a, b): order two cell paths such as "1.2" and "1.10"',
    capsule: 'A cell path is digits separated by dots ("0", "1", "1.10", "2.3.1"). Compare segment by segment as numbers; a path that is a prefix of the other comes first. Return -1, 0 or 1. Module chemin.mjs.',
    module: 'chemin.mjs',
    tests: [
      { fn: 'cheminCompare', args: ['1.2', '1.10'], attendu: -1 },
      { fn: 'cheminCompare', args: ['1.10', '1.2'], attendu: 1 },
      { fn: 'cheminCompare', args: ['1', '1.1'], attendu: -1 },
      { fn: 'cheminCompare', args: ['2', '2'], attendu: 0 },
    ],
    caches: [
      { fn: 'cheminCompare', args: ['10', '9'], attendu: 1 },
      { fn: 'cheminCompare', args: ['3.1.4', '3.1.4'], attendu: 0 },
      { fn: 'cheminCompare', args: ['1.2.3', '1.2'], attendu: 1 },
      { fn: 'cheminCompare', args: ['0', '1'], attendu: -1 },
    ],
    proprietes: [
      { nom: 'a sign, zero only for equal paths', fn: 'cheminCompare', args: [{ type: 'oneOf', values: CHEMINS }, { type: 'oneOf', values: CHEMINS }], verifie: '[-1, 0, 1].includes(out) && ((out === 0) === (args[0] === args[1]))' },
    ],
    reference: CHEMIN,
  }),
  cellule({
    objectif: 'duree(ms): a duration a person reads at a glance',
    capsule: 'Under a minute: "under a minute". Under 90 minutes: "<n> min". Under 48 hours: "<n> h". Otherwise "<n> days". n is rounded to the nearest whole number. A value that is not a finite number gives "—". Module duree.mjs.',
    module: 'duree.mjs',
    tests: [
      { fn: 'duree', args: [30000], attendu: 'under a minute' },
      { fn: 'duree', args: [120000], attendu: '2 min' },
      { fn: 'duree', args: [5400000], attendu: '2 h' },
      { fn: 'duree', args: [259200000], attendu: '3 days' },
    ],
    caches: [
      { fn: 'duree', args: [5340000], attendu: '89 min' },
      { fn: 'duree', args: [null], attendu: '—' },
      { fn: 'duree', args: [169200000], attendu: '47 h' },
      { fn: 'duree', args: [172800000], attendu: '2 days' },
      { fn: 'duree', args: [60000], attendu: '1 min' },
    ],
    reference: DUREE,
  }),
  cellule({
    objectif: 'nomAbeille(id): a friendly bee name for an identifier, the same everywhere',
    capsule: [
      'Hash the identifier with 32-bit FNV-1a over its UTF-16 code units: h = 2166136261; for each code unit: h ^= unit; h = Math.imul(h, 16777619); finally h >>>= 0.',
      'Name = ADJ[h % 16] + " " + BEE[(h >>> 8) % 8] with',
      "ADJ = ['Swift', 'Bright', 'Calm', 'Brave', 'Keen', 'Sunny', 'Quiet', 'Golden', 'Nimble', 'Clever', 'Bold', 'Gentle', 'Lucky', 'Steady', 'Merry', 'Witty'] and",
      "BEE = ['Bumblebee', 'Honeybee', 'Mason Bee', 'Carpenter Bee', 'Leafcutter', 'Sweat Bee', 'Digger Bee', 'Orchid Bee']. Module nom-abeille.mjs.",
    ].join('\n'),
    module: 'nom-abeille.mjs',
    tests: [
      { fn: 'nomAbeille', args: ['pq1:abc'], attendu: 'Witty Honeybee' },
      { fn: 'nomAbeille', args: ['swarm'], attendu: 'Witty Bumblebee' },
      { fn: 'nomAbeille', args: [''], attendu: 'Sunny Sweat Bee' },
    ],
    caches: [
      { fn: 'nomAbeille', args: [ID], attendu: 'Brave Honeybee' },
      { fn: 'nomAbeille', args: ['ed25519:queen'], attendu: 'Quiet Leafcutter' },
      { fn: 'nomAbeille', args: ['kickswarm'], attendu: 'Clever Carpenter Bee' },
      { fn: 'nomAbeille', args: ['honey'], attendu: 'Keen Honeybee' },
    ],
    reference: NOM,
  }),
  cellule({
    objectif: 'estIdentifiant(s): is this a Kickswarm contributor identifier?',
    capsule: 'An identifier is "pq1:", "slh1:" or "ed25519:" followed by exactly 43 characters among A-Z a-z 0-9 _ and -. Anything else, including a value that is not a string, is false. Module identite.mjs.',
    module: 'identite.mjs',
    tests: [
      { fn: 'estIdentifiant', args: [ID], attendu: true },
      { fn: 'estIdentifiant', args: ['pq1:short'], attendu: false },
      { fn: 'estIdentifiant', args: [42], attendu: false },
    ],
    caches: [
      { fn: 'estIdentifiant', args: [`slh1:${ID.slice(4)}`], attendu: true },
      { fn: 'estIdentifiant', args: [`ed25519:${ID.slice(4)}`], attendu: true },
      { fn: 'estIdentifiant', args: [`rsa:${ID.slice(4)}`], attendu: false },
      { fn: 'estIdentifiant', args: [`${ID}x`], attendu: false },
      { fn: 'estIdentifiant', args: [`pq1:${ID.slice(5)}+`], attendu: false },
    ],
    reference: IDENTITE,
  }),
];

const racine: CellSpec = {
  objectif: 'Kickswarm’s building blocks: cell paths, durations, bee names and identifiers, in one module',
  capsule: 'kickswarm-utils.mjs exports cheminCompare, duree, nomAbeille and estIdentifiant. The pages and the protocol use them.',
  atomique: false,
  critere_fini: {
    classe: 'V0',
    verificateur: 'tests-js@1',
    module: 'kickswarm-utils.mjs',
    tests: [
      { fn: 'cheminCompare', args: ['1.9', '1.10'], attendu: -1 },
      { fn: 'duree', args: [600000], attendu: '10 min' },
      { fn: 'nomAbeille', args: ['pq1:abc'], attendu: 'Witty Honeybee' },
      { fn: 'estIdentifiant', args: [ID], attendu: true },
    ],
  },
};

export const KICKSWARM: ProjetLancement = {
  slug: 'kickswarm-builds-kickswarm',
  nom: 'Kickswarm builds Kickswarm',
  objectif: 'The swarm writes its own building blocks, then its own features',
  racine,
  enfants: enfants.map((e) => e.spec),
  secrets: enfants.map((e) => e.secrets),
};

/** The references, for tests and demos. */
export const SOLUTIONS_KICKSWARM: Record<string, string> = { 'chemin.mjs': CHEMIN, 'duree.mjs': DUREE, 'nom-abeille.mjs': NOM, 'identite.mjs': IDENTITE };
