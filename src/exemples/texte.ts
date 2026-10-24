import type { CellSpec, CritereV0 } from '../protocol/types.js';
import type { BeeScript } from './scripted-bee.js';

// The trial hive: a small text toolkit, new to every AI. The real agent splits it, writes it and
// assembles it; the script below only exists to rehearse the trial without an AI.

const test = (module: string, tests: CritereV0['tests']): CritereV0 => ({ classe: 'V0', verificateur: 'tests-js@1', module, tests });

export const TEXT_ROOT: CellSpec = {
  objectif: 'Ship a small open text toolkit: slugify, titleCase, camelCase, wordCount, truncate and isAnagram, all re-exported from text.mjs',
  capsule: [
    'An ES module library with no dependencies. Every function is exported from text.mjs.',
    '- slugify(s): lower case, every run of characters other than a-z and 0-9 becomes one "-", no "-" at either end. slugify("Hello, World!") = "hello-world".',
    '- titleCase(s): upper-case the first letter of every word, lower-case the rest; words are separated by spaces. titleCase("the QUICK brown fox") = "The Quick Brown Fox".',
    '- camelCase(s): words separated by spaces, dashes or underscores; first word in lower case, the next ones capitalised, joined. camelCase("hello big-world") = "helloBigWorld".',
    '- wordCount(s): number of words separated by whitespace; wordCount("") = 0.',
    '- truncate(s, n): s if it has at most n characters, otherwise its first n - 1 characters followed by "…". truncate("Hello world", 8) = "Hello w…".',
    '- isAnagram(a, b): same letters, ignoring case and spaces. isAnagram("Listen", "Silent") = true.',
  ].join('\n'),
  atomique: false,
  critere_fini: test('text.mjs', [
    { fn: 'slugify', args: ['Hello, World!'], attendu: 'hello-world' },
    { fn: 'titleCase', args: ['the QUICK brown fox'], attendu: 'The Quick Brown Fox' },
    { fn: 'camelCase', args: ['hello big-world'], attendu: 'helloBigWorld' },
    { fn: 'wordCount', args: ['  one two   three '], attendu: 3 },
    { fn: 'truncate', args: ['Hello world', 8], attendu: 'Hello w…' },
    { fn: 'isAnagram', args: ['Listen', 'Silent'], attendu: true },
  ]),
};

const SOLUTIONS: Record<string, string> = {
  'slugify.mjs': "export function slugify(s) {\n  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');\n}\n",
  'titlecase.mjs': "export function titleCase(s) {\n  return String(s).split(' ').map((w) => (w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w)).join(' ');\n}\n",
  'camelcase.mjs':
    "export function camelCase(s) {\n  const w = String(s).split(/[\\s_-]+/).filter(Boolean).map((x) => x.toLowerCase());\n  return w.map((x, i) => (i ? x[0].toUpperCase() + x.slice(1) : x)).join('');\n}\n",
  'wordcount.mjs': 'export function wordCount(s) {\n  return String(s).split(/\\s+/).filter(Boolean).length;\n}\n',
  'truncate.mjs': "export function truncate(s, n) {\n  s = String(s);\n  return s.length <= n ? s : s.slice(0, n - 1) + '…';\n}\n",
  'anagram.mjs':
    "const key = (s) => String(s).toLowerCase().replace(/\\s+/g, '').split('').sort().join('');\nexport function isAnagram(a, b) {\n  return key(a) === key(b);\n}\n",
};

const leaf = (objectif: string, capsule: string, module: string, tests: CritereV0['tests']): CellSpec => ({ objectif, capsule, atomique: true, critere_fini: test(module, tests) });

export const TEXT_SCRIPT: BeeScript = {
  solutions: SOLUTIONS,
  decompositions: {
    [TEXT_ROOT.objectif]: [
      leaf('Write slugify(s)', 'Lower case; every run of characters other than a-z0-9 becomes one "-"; no "-" at either end.', 'slugify.mjs', [
        { fn: 'slugify', args: ['Hello, World!'], attendu: 'hello-world' },
        { fn: 'slugify', args: ['  --Kick  Swarm--  '], attendu: 'kick-swarm' },
      ]),
      leaf('Write titleCase(s)', 'Upper-case the first letter of every space-separated word, lower-case the rest.', 'titlecase.mjs', [
        { fn: 'titleCase', args: ['the QUICK brown fox'], attendu: 'The Quick Brown Fox' },
        { fn: 'titleCase', args: ['a'], attendu: 'A' },
      ]),
      leaf('Write camelCase(s)', 'Words separated by spaces, dashes or underscores; first word lower case, the next ones capitalised.', 'camelcase.mjs', [
        { fn: 'camelCase', args: ['hello big-world'], attendu: 'helloBigWorld' },
        { fn: 'camelCase', args: ['Make_IT_work'], attendu: 'makeItWork' },
      ]),
      leaf('Write wordCount(s)', 'Number of whitespace-separated words; 0 for an empty string.', 'wordcount.mjs', [
        { fn: 'wordCount', args: ['  one two   three '], attendu: 3 },
        { fn: 'wordCount', args: [''], attendu: 0 },
      ]),
      leaf('Write truncate(s, n)', 's when it has at most n characters, otherwise its first n - 1 characters and "…".', 'truncate.mjs', [
        { fn: 'truncate', args: ['Hello world', 8], attendu: 'Hello w…' },
        { fn: 'truncate', args: ['short', 10], attendu: 'short' },
      ]),
      leaf('Write isAnagram(a, b)', 'Same letters, ignoring case and spaces.', 'anagram.mjs', [
        { fn: 'isAnagram', args: ['Listen', 'Silent'], attendu: true },
        { fn: 'isAnagram', args: ['Kick', 'Swarm'], attendu: false },
      ]),
    ],
  },
};
