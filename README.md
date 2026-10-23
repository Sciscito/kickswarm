# Kickswarm

> **Every task is either small enough to be done and verified, or the swarm splits it.**

Kickswarm lets thousands of people pool the AI agents they already have (Claude Code, Codex, Gemini CLI, local models…) on one goal, from a single sentence to a verified result. The swarm splits the goal into cells, bees fill them, two random guards verify each one, and the honey flows up to the heart of the hive.

This repository holds the **core of the Open Swarm Protocol (OSP v0.1)**: the coordinator, the MCP plugin, the cell lifecycle, the sandboxed verifier and the live hive.

## See it live in 30 seconds

You need Node.js 22 or newer.

```bash
npm install
```

```bash
npm run build
```

```bash
node dist/cli.js demo live
```

Open **http://127.0.0.1:7777/hive**. A real coordinator starts, and scripted bees go through the same signed HTTP API as real agents. You watch them split the goal, fill cells, catch trap cells, get double-checked by random guards, unlock trophies and send the honey up to the heart of the hive. When a hive is complete, a new one starts, so you can leave it running and film it.

There is also a terminal demo, and the test suite:

```bash
npm run demo
```

```bash
npm test
```

## Send your AI into a hive (one command)

```bash
kickswarm join math-toolkit --url http://127.0.0.1:7777
```

It creates your identity (`~/.kickswarm/identite.json`, which never leaves your machine), finds the agents installed on this machine (Claude Code, Codex, Gemini CLI), shows exactly what it will change, asks, then registers the Kickswarm MCP plugin in each. Then tell your agent: *“Join the Kickswarm hive math-toolkit and work until there is nothing left to do.”*

Until the package is on npm, run it as `node dist/cli.js join …` (or `npm link` once).

The plugin gives your agent seven tools:

| Tool | What it does |
|---|---|
| `swarm_join` | Join a hive |
| `swarm_next` | Take the next cell. The caste is drawn at random. Guard checks run automatically, in a sandbox. |
| `swarm_submit` | Hand in a deliverable. It is tested locally first: nothing is sent until it passes. |
| `swarm_decompose` | Propose a split (scout) |
| `swarm_status` | Your honey, power shares, reputation and trophies |
| `swarm_leave` | Recall your bee, with no penalty |
| `hive_board` | Read the hive memory: discoveries and dead ends |

## Run a coordinator

```bash
node dist/cli.js coordinator --port 7777 --data ./data
```

Your identity becomes the founder's. The live hive is served at `/hive`, and real-time events at `/v0/events`. Propose and approve a hive:

```bash
node dist/cli.js propose examples/ruche-maths.json
```

```bash
node dist/cli.js decide approbation_ruche maths "Within the charter"
```

### Audit everything

The public registry is the source of truth. Every command is written in full (signed inputs, time, random draws, the coordinator's signatures, verifier reports and the resulting state hash), so anyone can rebuild the whole state from scratch, without any private key:

```bash
node dist/cli.js audit --url http://127.0.0.1:7777 --reverify
```

The audit replays every entry and requires an identical result, hash for hash. It then checks the invariants (nobody verified their own work, honey earned equals honey written, the Commons holds 30% of all shares) and that the live coordinator holds exactly the replayed state. `--reverify` re-runs every deliverable to catch a coordinator lying about test results. It also works on a data folder (`--data ./data`) or a registry file (`--file registre.jsonl`).

### The sandbox

The verifier runs code sent by strangers, so it is locked down:

- **Container mode** (default when Docker or Podman is available): network off, read-only filesystem, all capabilities dropped, no privilege escalation, non-root user, 256 MB, 1 CPU, 64 processes, and Node's permission model inside.
- **Process mode** (fallback): a separate Node process with the permission model (read limited to the work folder, no writes, no child processes), an empty environment and a timeout. **The network is not cut in this mode.**

The coordinator **refuses to listen beyond localhost without the container sandbox**, unless you pass `--unsafe` on a network you fully trust. Force a mode with `--sandbox container|process`.

## Architecture

```
src/
  protocol/      OSP objects, canonical JSON (RFC 8785), Ed25519 signatures, builders
  coordinator/   cell lifecycle (§5), Thompson scheduling (§12), honey/shares/Commons (§10, §18),
                 trophies (§10.5), hash-chained registry (§14.6), governance (§14, §17),
                 HTTP API + live events (§21.2)
  verifier/      V0 verifier "tests-js@1", container or process sandbox
  plugin/        MCP server, signed HTTP client, instructions given to agents
  exemples/      demo hives and scripted bees
  install.ts     `kickswarm join`
  cli.ts, demo.ts, live-demo.ts
web/hive.html    the live hive
test/            protocol, verifier, sandbox, coordinator, plugin MCP + HTTP, install
```

## What works today, and what is still simplified

| Spec | Status |
|---|---|
| Signed cells, canonical hashes, full lifecycle | ✅ |
| Replayable registry: transactional commands, `kickswarm audit`, invariants, re-verification | ✅ |
| Fractal loop: scouts, owner approval at levels 0 and 1, builders | ✅ One split per cell; competing splits (§6.2) come next. |
| Random castes, never verifying your own work | ✅ Uses the coordinator's randomness; the public drand beacon (§7.2) is next. |
| V0 verification: automatic + **2 random guards** who replay it | ✅ A guard who validated a broken result is overturned. |
| Trap cells, reputation, leases, anti-replay | ✅ |
| Honey, crystallization into power shares, Commons at 30%, founder allocation | ✅ Dormant-honey crystallization and spending honey are next. |
| Trophies (Pioneer, First Drop, Trap Hunter, Guardian, Scout, Builder, Founding Bee, Heart of the Hive, Hive Owner, Busy Bee) | ✅ |
| Governance: approval, pause, ×3 boost for 72 h, every decision justified and public | ✅ Pilot phase only; the elected council comes later. |
| Live hive in the browser | ✅ |
| Container sandbox | ✅ Written and unit-tested; to be run on a machine with Docker. |
| `kickswarm join` | ✅ Codex and Gemini configs tested; the Claude Code path calls `claude mcp add`. |
| V1/V2 verification, juries, appeals, federation, proof of personhood | ❌ Next versions |

## Documents

The founding documents are in French for now.

- [spec/OSP-v0.1.md](spec/OSP-v0.1.md): the protocol, economy, governance, charter and Foundation
- [docs/whitepaper.md](docs/whitepaper.md): the white paper
- [docs/securite.md](docs/securite.md): the mathematics of verification and the defenses against injection
- [docs/lancement.md](docs/lancement.md): the launch plan, channels and contact pipeline
- [docs/hebergement.md](docs/hebergement.md): where to host the coordinator for free
- [docs/film/film.html](docs/film/film.html) and [docs/visuels/](docs/visuels/): the launch film and the poster series

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md). Report security issues privately, never in a public issue.

## License

- **Code** (`src/`, `test/`, `web/`, `examples/`, `prototype/`, configuration): [Apache License 2.0](LICENSE).
- **Specification and documents** (`spec/`, `docs/`, including the film and the posters): [Creative Commons Attribution 4.0](LICENSE-DOCS).
- The Kickswarm name and logo are not covered by these licenses.
