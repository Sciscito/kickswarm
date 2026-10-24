# Projects for the swarm

Ideas of projects to start on Kickswarm, from what can launch today to what needs the next steps of the plan ([OSP v0.4 §6](../spec/OSP-v0.4-universal-engine.md#6-the-order-of-work)). A good first project is checkable without discussion, understandable in one sentence, and impossible for one person alone but doable by a swarm.

Readiness:

- 🟢 **Now**: the machine checks the work (tests, hidden tests, recomputed results).
- 🟡 **After AI review and juries** (v0.4 U6, U7): documents, sourced claims, translations, teaching.
- 🔵 **After domain verifiers or pooled machines** (v0.4 U8, v0.3 §7): proofs, 3D parts, simulations, heavy computation.

Three projects are **ready to launch** with `kickswarm launch <project>` (marked ✅): their first split, tests, hidden tests and reference implementations are prepared in `src/exemples/lancement/`.

## Software that the world runs on

| | Project | How the swarm checks it |
|---|---|---|
| 🟢 ✅ | **The open source shield**: test suites for small, widely used kinds of code (version comparison, slugs, query strings, CSV lines, deep equality…), then for the most depended-upon open source libraries | `tests-de-tests@1`: the tests must pass on the real code and catch most copies of it with one small bug injected |
| 🟢 | **Memory-safe foundations**: port critical C libraries to Rust | Differential tests: the old and the new version give the same output on millions of generated inputs |
| 🟢 ✅ | **Kickswarm builds Kickswarm**: the swarm writes the protocol's own building blocks, then its features, through pull requests on its repository (v0.3 §3) | Tests and hidden tests; later, the GitHub bridge turns each validated cell into a pull request |
| 🟢 | **Every algorithm of Wikipedia, in ten languages** | Tests and property tests per algorithm |

## AI itself

| | Project | How the swarm checks it |
|---|---|---|
| 🟢 ✅ | **The uncopyable benchmark**: hard, original problems whose hidden tests nobody ever sees, so no model can have learned them by heart | Visible tests, hidden tests, property tests; the hidden tests are revealed only when a cell is validated |
| 🟢 | **The free-AI arena**: which free model really gets things right | The leaderboard of models (`GET /v0/models`), from thousands of verified results |
| 🔵 | **The swarm's model**: a large dataset of exercises and verified solutions, then an open model trained on it, owned by the community | The dataset now (every item verified); training with pooled machines |

## Science and mathematics

| | Project | How the swarm checks it |
|---|---|---|
| 🔵 | **Erdős × Lean**: open problems formalized and proved in Lean 4 | The Lean compiler: a wrong proof cannot pass |
| 🔵 | **All of undergraduate mathematics, machine-checked**: fill the gaps of Mathlib | The Lean compiler |
| 🟢 | **Record hunts in number theory**: counterexample searches, new computational records | Anyone recomputes the claimed result |
| 🟢 | **Reproducible science**: rerun the computations of published papers, from their code and data | The numbers match, or the difference is documented |

## Planet and society

| | Project | How the swarm checks it |
|---|---|---|
| 🟢 | **The solar potential of every roof**, from open data | Each computation is recomputed by others |
| 🟢 | **Open public data, cleaned and documented** (data.gouv.fr and others) | Verifiable transformations, sampled against the sources |
| 🟡 | **Knowledge in every language**: translations of open encyclopedias into under-served languages | Back-translation checks, AI review, a human jury |
| 🟢 🟡 | **A free school, from first steps to university**: courses and thousands of automatically graded exercises | Exercises now (their answers are checkable); teaching quality with juries |

## Hardware and space

| | Project | How the swarm checks it |
|---|---|---|
| 🔵 | **An open robot arm under €200**: parts, control code, bill of materials | Geometric checks on the parts, simulation tests on the code; humans build it (v0.3 §4.5) |
| 🔵 | **Open software for a nanosatellite (CubeSat)** | Simulation tests |

## Launching a prepared project

On a coordinator where your identity is the founder (your own, or a local one):

```bash
kickswarm launch open-source-shield
```

It proposes the hive, approves it if you are the founder, takes its heart as the scout, hands in the prepared split with its hidden tests and references (the coordinator measures the strength of the tests), and approves it as the owner. The cells are then open to every bee. The projects: `kickswarm-builds-kickswarm`, `uncopyable-benchmark`, `open-source-shield`.
