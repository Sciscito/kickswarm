import type { Playbook } from './index.js';

// The Roblox playbook (OSP v0.3 §3.6): pure logic first. Most of a game's rules can be written as
// Luau modules that depend on nothing but Luau; those are verified like the rest of Kickswarm
// (tests-luau@1, luau-checks@1). The scripts that connect them to the engine stay thin, and are
// left to humans until V1 and V2 verification exist.

const PUR = [
  'A **pure module** depends on nothing but Luau: coins, prices, inventory, save-data format, level rules, rewards, matchmaking, cooldowns computed from a time passed in.',
  'It never touches `game`, `workspace`, `Instance`, `script`, `task`, services, remote events or the UI: those exist only inside Roblox, and the swarm cannot test them.',
].join('\n');

export const ROBLOX: Playbook = {
  id: 'roblox-pure-logic-first',
  titre: 'Roblox game: pure logic first',
  eclaireuse: [
    PUR,
    '',
    '- **Split into pure modules and thin glue.** Each pure module is a child with `"verificateur": "tests-luau@1"`, `"portes": ["luau-checks@1"]` and a module path in the project, e.g. `src/shared/Shop.luau`.',
    '- **Tests**: `{ "fn", "args", "attendu" }`, where `fn` is a function of the table the module returns. Property tests take a Luau expression over `args`, `out` and `eq`, e.g. `"out >= 0 and out <= args[1]"`.',
    '- **Contract first**: shared types (`Types.luau`) and constants are a child of their own; the others read them (`depot.lecture`) instead of redefining them.',
    '- **Pass the engine in, never reach for it**: a function receives what it needs (a player\'s coins, the current time, a random number) and returns new values. The glue applies them.',
    '- **Glue is not a cell yet.** Server and client scripts, UI and remote events are reviewed and playtested by humans (V1, V2 come later). Name them in the parent\'s capsule as "glue for humans": short scripts that only call pure modules.',
    '- **Small write scopes**: one or two files per child, so that children run in parallel without touching the same file.',
    '- **A reference** for each child (your own implementation, kept secret) lets the swarm measure the strength of its tests with Luau mutants.',
  ].join('\n'),
  ouvriere: [
    PUR,
    '',
    '- Start the file with `--!strict`. The module returns a table of functions: `local Shop = {}` … `return Shop`.',
    '- Require other modules by relative path: `require("./Coins")`, `require("../shared/Types")`. Roblox supports these string paths, and with Rojo they map to the same files. Never `script.Parent`.',
    '- Annotate parameters and return values. No unused variable (prefix it with `_`). `--!nocheck`, `--!nonstrict` and `--!nolint` are refused: the gate (`luau-checks@1`) runs strict type checking and Luau\'s linter, and must report nothing.',
    '- Randomness: take a random number or a seed as an argument rather than calling `math.random`.',
    '- A function returns one value; a table is compared by its content.',
  ].join('\n'),
  batisseuse: [
    'Assemble the children\'s pure modules into the parent\'s module: require each child by relative path and expose its functions in the table you return. Keep the children\'s files as they are.',
    'Start with `--!strict`, and keep the assembly free of engine calls: it is still a pure module.',
  ].join('\n'),
};
