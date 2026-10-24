import { commitment } from '../protocol/canonical.js';
import type { CellSpec, CritereLuau, Secrets } from '../protocol/types.js';
import type { BeeScript } from './scripted-bee.js';

// A demo hive in Luau (OSP v0.3 P0-3): the economy of a small Roblox game, written as pure
// modules, as the "pure logic first" playbook asks. Each module is checked by tests-luau@1 and the
// luau-checks@1 gate; the children come with hidden tests and a reference, so the swarm measures
// the strength of their tests with Luau mutants.

export const COINS = `--!strict
local Coins = {}

Coins.MAX = 999999

function Coins.add(wallet: number, amount: number): number
  return math.clamp(wallet + amount, 0, Coins.MAX)
end

function Coins.canAfford(wallet: number, price: number): boolean
  return price >= 0 and wallet >= price
end

return Coins
`;

export const SHOP = `--!strict
local Shop = {}

local PRICES: { [string]: number } = { sword = 50, shield = 30, potion = 5 }

function Shop.price(item: string, quantity: number): number
  local unit = PRICES[item]
  if unit == nil or quantity <= 0 then
    return 0
  end
  local total = unit * quantity
  if quantity >= 10 then
    total = math.floor(total * 0.9)
  end
  return total
end

function Shop.total(basket: { [string]: number }): number
  local sum = 0
  for item, quantity in basket do
    sum += Shop.price(item, quantity)
  end
  return sum
end

return Shop
`;

export const SOLUTIONS_LUAU: Record<string, string> = {
  'src/shared/Coins.luau': COINS,
  'src/shared/Shop.luau': SHOP,
};

/** A subtle bug: the bulk discount starts one item too late. Only the hidden tests see it. */
export const BUGS_LUAU: Record<string, string> = {
  'src/shared/Shop.luau': SHOP.replace('quantity >= 10', 'quantity > 10'),
};

const critere = (module: string, tests: CritereLuau['tests'], extra: Partial<CritereLuau> = {}): CritereLuau => ({
  classe: 'V0',
  verificateur: 'tests-luau@1',
  module,
  tests,
  ...extra,
});

export const RACINE_ROBLOX: CellSpec = {
  objectif: 'The economy of the game: coins and the shop, as pure Luau modules',
  capsule: 'src/shared/Economy.luau exposes the functions of Coins and Shop. Glue for humans: the shop UI and the purchase remote event call these functions.',
  atomique: false,
  critere_fini: critere('src/shared/Economy.luau', [
    { fn: 'add', args: [10, 5], attendu: 15 },
    { fn: 'canAfford', args: [50, 50], attendu: true },
    { fn: 'price', args: ['sword', 2], attendu: 100 },
    { fn: 'total', args: [{ sword: 1, potion: 2 }], attendu: 60 },
  ]),
};

/** Hidden tests and references: the workers never see them; the references let the swarm measure the tests. */
export const SECRETS_ROBLOX: Array<Secrets> = [
  {
    tests_caches: [
      { fn: 'add', args: [0, 0], attendu: 0 },
      { fn: 'canAfford', args: [10, -1], attendu: false },
      { fn: 'canAfford', args: [0, 0], attendu: true },
    ],
    reference: { fichiers: { 'src/shared/Coins.luau': COINS } },
  },
  {
    tests_caches: [
      { fn: 'price', args: ['shield', 10], attendu: 270 },
      { fn: 'price', args: ['shield', 9], attendu: 270 },
      { fn: 'price', args: ['sword', 0], attendu: 0 },
    ],
    reference: { fichiers: { 'src/shared/Shop.luau': SHOP } },
  },
];

export const ENFANTS_ROBLOX: CellSpec[] = [
  {
    objectif: 'Coins: add to a wallet (never below 0 nor above Coins.MAX) and check a purchase is affordable',
    capsule: 'Coins.add(wallet, amount) clamps to [0, 999999]. Coins.canAfford(wallet, price) is false for a negative price.',
    atomique: true,
    critere_fini: critere(
      'src/shared/Coins.luau',
      [
        { fn: 'add', args: [10, 5], attendu: 15 },
        { fn: 'add', args: [3, -10], attendu: 0 },
        { fn: 'add', args: [999990, 100], attendu: 999999 },
        { fn: 'canAfford', args: [50, 50], attendu: true },
        { fn: 'canAfford', args: [49, 50], attendu: false },
      ],
      {
        proprietes: [
          { nom: 'stays in range', fn: 'add', args: [{ type: 'int', min: 0, max: 999999 }, { type: 'int', min: -2000000, max: 2000000 }], verifie: 'out >= 0 and out <= 999999' },
        ],
        portes: ['luau-checks@1'],
        tests_caches_hash: commitment(SECRETS_ROBLOX[0]!.tests_caches),
        reference_hash: commitment(SECRETS_ROBLOX[0]!.reference),
      },
    ),
  },
  {
    objectif: 'Shop: the price of a quantity of an item, with 10% off from 10 items, and the total of a basket',
    capsule: 'Prices: sword 50, shield 30, potion 5. An unknown item or a quantity of 0 or less costs 0. From 10 items, 10% off, rounded down.',
    atomique: true,
    critere_fini: critere(
      'src/shared/Shop.luau',
      [
        { fn: 'price', args: ['sword', 2], attendu: 100 },
        { fn: 'price', args: ['potion', 20], attendu: 90 },
        { fn: 'price', args: ['dragon', 1], attendu: 0 },
        { fn: 'total', args: [{ sword: 1, potion: 2 }], attendu: 60 },
      ],
      {
        proprietes: [
          { nom: 'never negative', fn: 'price', args: [{ type: 'oneOf', values: ['sword', 'shield', 'potion', 'x'] }, { type: 'int', min: -5, max: 50 }], verifie: 'out >= 0' },
        ],
        portes: ['luau-checks@1'],
        tests_caches_hash: commitment(SECRETS_ROBLOX[1]!.tests_caches),
        reference_hash: commitment(SECRETS_ROBLOX[1]!.reference),
      },
    ),
  },
];

export const ROBLOX_SCRIPT: BeeScript = {
  decompositions: { [RACINE_ROBLOX.objectif]: ENFANTS_ROBLOX },
  solutions: SOLUTIONS_LUAU,
  bugs: BUGS_LUAU,
  secrets: { [RACINE_ROBLOX.objectif]: SECRETS_ROBLOX },
};
