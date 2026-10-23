import type { CellSpec, CritereV0 } from '../protocol/types.js';
import type { BeeScript } from './scripted-bee.js';

// The English demo hive: a small math toolkit, two levels deep (14 cells), so the live view has life.

const test = (module: string, tests: CritereV0['tests']): CritereV0 => ({ classe: 'V0', verificateur: 'tests-js@1', module, tests });

const SOLUTIONS: Record<string, string> = {
  'gcd.mjs': 'export function gcd(a, b) {\n  a = Math.abs(a); b = Math.abs(b);\n  while (b) [a, b] = [b, a % b];\n  return a;\n}\n',
  'lcm.mjs': 'const g = (a, b) => (b ? g(b, a % b) : Math.abs(a));\nexport function lcm(a, b) {\n  return a && b ? Math.abs(a * b) / g(a, b) : 0;\n}\n',
  'prime.mjs': 'export function isPrime(n) {\n  if (n < 2) return false;\n  for (let d = 2; d * d <= n; d++) if (n % d === 0) return false;\n  return true;\n}\n',
  'fibonacci.mjs': 'export function fibonacci(n) {\n  let a = 0, b = 1;\n  for (let i = 0; i < n; i++) [a, b] = [b, a + b];\n  return a;\n}\n',
  'factorial.mjs': 'export function factorial(n) {\n  let r = 1;\n  for (let i = 2; i <= n; i++) r *= i;\n  return r;\n}\n',
  'sumdigits.mjs': "export function sumDigits(n) {\n  return String(Math.abs(n)).split('').reduce((s, d) => s + Number(d), 0);\n}\n",
  'palindrome.mjs': "export function isPalindrome(s) {\n  const t = String(s).toLowerCase().replace(/[^a-z0-9]/g, '');\n  return t === [...t].reverse().join('');\n}\n",
  'digitalroot.mjs': 'export function digitalRoot(n) {\n  n = Math.abs(n);\n  return n === 0 ? 0 : 1 + ((n - 1) % 9);\n}\n',
  'triangular.mjs': 'export function triangular(n) {\n  return (n * (n + 1)) / 2;\n}\n',
  'collatz.mjs': 'export function collatzSteps(n) {\n  let s = 0;\n  while (n !== 1) { n = n % 2 ? 3 * n + 1 : n / 2; s++; }\n  return s;\n}\n',
  'perfect.mjs':
    'export function isPerfect(n) {\n  if (n < 2) return false;\n  let s = 1;\n  for (let d = 2; d * d <= n; d++) if (n % d === 0) { s += d; if (d * d !== n) s += n / d; }\n  return s === n;\n}\n',
};

const BUGS: Record<string, string> = {
  'prime.mjs': 'export function isPrime(n) { return n % 2 === 1; }\n',
  'collatz.mjs': 'export function collatzSteps(n) { return Math.floor(Math.log2(n)); }\n',
};

export const TOOLKIT_ROOT: CellSpec = {
  objectif: 'Ship a tiny open math toolkit: gcd, lcm, isPrime, fibonacci, factorial, a digits pack and a sequences pack',
  capsule: 'An ES module library. Every function is re-exported from toolkit.mjs. No dependencies.',
  atomique: false,
  critere_fini: test('toolkit.mjs', [
    { fn: 'gcd', args: [84, 36], attendu: 12 },
    { fn: 'lcm', args: [4, 6], attendu: 12 },
    { fn: 'isPrime', args: [7919], attendu: true },
    { fn: 'fibonacci', args: [20], attendu: 6765 },
    { fn: 'factorial', args: [10], attendu: 3628800 },
    { fn: 'digitalRoot', args: [493193], attendu: 2 },
    { fn: 'collatzSteps', args: [27], attendu: 111 },
    { fn: 'isPerfect', args: [8128], attendu: true },
  ]),
};

const DIGITS: CellSpec = {
  objectif: 'Build the digits pack: sumDigits, isPalindrome, digitalRoot',
  capsule: 'Three small functions about digits, re-exported from digits.mjs.',
  atomique: false,
  critere_fini: test('digits.mjs', [
    { fn: 'sumDigits', args: [9875], attendu: 29 },
    { fn: 'isPalindrome', args: ['A man, a plan, a canal: Panama'], attendu: true },
    { fn: 'digitalRoot', args: [16], attendu: 7 },
  ]),
};

const SEQUENCES: CellSpec = {
  objectif: 'Build the sequences pack: triangular, collatzSteps, isPerfect',
  capsule: 'Three classic integer sequences, re-exported from sequences.mjs.',
  atomique: false,
  critere_fini: test('sequences.mjs', [
    { fn: 'triangular', args: [100], attendu: 5050 },
    { fn: 'collatzSteps', args: [6], attendu: 8 },
    { fn: 'isPerfect', args: [28], attendu: true },
  ]),
};

const leaf = (objectif: string, capsule: string, module: string, tests: CritereV0['tests']): CellSpec => ({ objectif, capsule, atomique: true, critere_fini: test(module, tests) });

export const TOOLKIT_SCRIPT: BeeScript = {
  solutions: SOLUTIONS,
  bugs: BUGS,
  decompositions: {
    [TOOLKIT_ROOT.objectif]: [
      leaf('Write gcd(a, b)', 'Greatest common divisor, Euclid’s algorithm.', 'gcd.mjs', [
        { fn: 'gcd', args: [12, 18], attendu: 6 },
        { fn: 'gcd', args: [0, 9], attendu: 9 },
      ]),
      leaf('Write lcm(a, b)', 'Least common multiple; lcm(x, 0) = 0.', 'lcm.mjs', [
        { fn: 'lcm', args: [4, 6], attendu: 12 },
        { fn: 'lcm', args: [7, 0], attendu: 0 },
      ]),
      leaf('Write isPrime(n)', 'Trial division up to √n.', 'prime.mjs', [
        { fn: 'isPrime', args: [1], attendu: false },
        { fn: 'isPrime', args: [91], attendu: false },
        { fn: 'isPrime', args: [97], attendu: true },
      ]),
      leaf('Write fibonacci(n)', 'fibonacci(0) = 0, fibonacci(1) = 1.', 'fibonacci.mjs', [
        { fn: 'fibonacci', args: [0], attendu: 0 },
        { fn: 'fibonacci', args: [10], attendu: 55 },
      ]),
      leaf('Write factorial(n)', 'factorial(0) = 1.', 'factorial.mjs', [
        { fn: 'factorial', args: [0], attendu: 1 },
        { fn: 'factorial', args: [5], attendu: 120 },
      ]),
      DIGITS,
      SEQUENCES,
    ],
    [DIGITS.objectif]: [
      leaf('Write sumDigits(n)', 'Sum of the decimal digits of |n|.', 'sumdigits.mjs', [{ fn: 'sumDigits', args: [123], attendu: 6 }]),
      leaf('Write isPalindrome(s)', 'Ignore case and non-alphanumeric characters.', 'palindrome.mjs', [
        { fn: 'isPalindrome', args: ['Racecar'], attendu: true },
        { fn: 'isPalindrome', args: ['hello'], attendu: false },
      ]),
      leaf('Write digitalRoot(n)', 'Repeated digit sum until one digit remains.', 'digitalroot.mjs', [
        { fn: 'digitalRoot', args: [942], attendu: 6 },
        { fn: 'digitalRoot', args: [0], attendu: 0 },
      ]),
    ],
    [SEQUENCES.objectif]: [
      leaf('Write triangular(n)', 'n-th triangular number.', 'triangular.mjs', [{ fn: 'triangular', args: [4], attendu: 10 }]),
      leaf('Write collatzSteps(n)', 'Steps for n to reach 1 under the Collatz map.', 'collatz.mjs', [
        { fn: 'collatzSteps', args: [1], attendu: 0 },
        { fn: 'collatzSteps', args: [27], attendu: 111 },
      ]),
      leaf('Write isPerfect(n)', 'n equals the sum of its proper divisors.', 'perfect.mjs', [
        { fn: 'isPerfect', args: [6], attendu: true },
        { fn: 'isPerfect', args: [12], attendu: false },
      ]),
    ],
  },
};
