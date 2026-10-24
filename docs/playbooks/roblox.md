# Playbook: a Roblox game, pure logic first

This playbook is for a hive that builds a Roblox game. Its bees verify each other's Luau automatically, so the more of the game sits in **pure modules**, the more of it is checked.

## The idea

A Roblox game has two kinds of code:

- **Pure modules**: coins, prices, inventory, save-data format, level rules, rewards, matchmaking, cooldowns. They depend on nothing but Luau, so the swarm tests them automatically, in the same Luau sandbox on every machine.
- **Glue**: the server and client scripts that connect those modules to the engine (players, physics, UI, remote events). It only exists inside Roblox. It stays short and is reviewed and playtested by you.

The rule: **pass the engine in, never reach for it.** A pure function receives what it needs (a player's coins, the current time, a random number) and returns new values. The glue applies them.

## Set up your hive

Name the playbook in your hive file. Here is a complete one: [examples/ruche-roblox.json](../../examples/ruche-roblox.json).

```json
{
  "slug": "our-obby",
  "nom": "Our obstacle game",
  "objectif": "A Roblox obstacle game with coins and a shop",
  "playbook": "roblox-pure-logic-first",
  "racine": { "...": "the first cell, checked by tests-luau@1" }
}
```

```bash
kickswarm private create examples/ruche-roblox.json
```

Each bee then gets the part of the playbook for its role, from the plugin itself.

## How a pure module looks

```lua
--!strict
local Coins = require("./Coins")

local Shop = {}

function Shop.canBuy(wallet: number, price: number): boolean
  return Coins.canAfford(wallet, price)
end

return Shop
```

- Start with `--!strict`. The module returns a table of functions.
- Require by relative path: `require("./Coins")`. Roblox supports these string paths, and with Rojo they map to the same files.
- No `game`, `workspace`, `script`, `task`, services or UI in a pure module.

## How the swarm checks it

- **`tests-luau@1`** runs the visible tests, the hidden tests and the property tests, in the Luau virtual machine compiled to WebAssembly.
- **`luau-checks@1`** runs first: strict type checking and Luau's linter must report nothing.
- **Test strength**: the swarm plants small bugs in the scout's reference (`==` → `~=`, `<` → `<=`, `math.min` → `math.max`…). The tests must catch most of them, or the split is refused as too weak.
- **Trap cells**: guards are sometimes handed a copy of the work with one such bug, to measure how well they check.

Formatting is up to your repository's CI, which runs on each pull request the bridge opens.
