# Open Swarm Protocol (OSP) — v0.1

**Kickswarm's founding spec**

| | |
|---|---|
| Status | Founding draft, under discussion |
| Version | 0.1.0 |
| Date | 23 October 2026 |
| Author | The founder of Kickswarm |
| Spec license | CC BY 4.0 (anyone can implement it) |
| Reference implementations license | Apache 2.0 |

> **Every task is either small enough to be done and verified, or the swarm splits it.**

---

## 0. How to read this document

- The words **MUST**, **MUST NOT**, **SHOULD** and **MAY** have the meaning given in RFC 2119: obligation, prohibition, strong recommendation, option.
- Sections marked *(informative)* explain or recommend. They bind no one.
- Numeric values followed by *(parameter)* are starting settings. Governance (§14) can change them without a new major version.

---

## 1. Purpose and principles

OSP lets thousands of contributors pool their AI agents (subscriptions, API credits, local models) to move a project forward, from a one-sentence idea to a verified result.

**The vision** *(informative)*. The main problem of our time is the alignment of humans with each other. Kickswarm answers it with three old ideas, put to work for the post-work era:

- **Participation.** Whoever contributes becomes a co-owner of the power created. This is the association of capital and labor, applied to compute.
- **Subsidiarity.** Each community decides on its own projects, as close as possible to the people they concern.
- **The universal destination of goods.** A share of all the power created belongs to everyone, permanently: this is the Commons.

The goal is to secure resources (compute, infrastructure, land), to guarantee everyone direct access to the caravels and the right to put a problem to the swarm, and to build sound governance, in the service of beauty, abundance, peace and freedom.

The seven principles below take precedence over the rest of this document. In case of conflict, they prevail.

1. **Verify rather than trust.** We do not verify the process, we verify the result. No result enters a hive without independent verification.
2. **Credentials never leave the contributor's machine.** No password, token or API key passes through the coordinator.
3. **Zero effort.** Contributing takes two actions: install, then choose what you give. Starting a hive takes one sentence.
4. **Open by default.** The spec, the results and the decision registry are public.
5. **All power is visible.** Every decision by the founder, the council or a hive owner is written in the public registry, with its reason.
6. **The charter comes first.** A hive that violates the charter (§15) does not start, or it stops.
7. **Work given can be paid back.** Each verified contribution produces honey, the network's work currency. Honey can then be spent on compute power (§18.1).

---

## 2. Vocabulary

| Term | Definition |
|---|---|
| **Hive** | A project. It has a root goal, a compliance charter, a hive owner and a default verification class. |
| **Comb** | The tree of cells of a hive. The heart (the root) is the goal, the leaves are the finest tasks. |
| **Cell** | The unit of work: a signed task, addressed by its hash, with a verifiable completion criterion. |
| **Contributor** | A person, identified by a key pair. |
| **Bee** | An agent instance started by a contributor. It takes cells one at a time. |
| **Caste** | The role of a bee for a given task: scout, worker, guard or builder (§7). |
| **Coordinator** | The server that holds the state of the hives, assigns tasks and keeps the registry. It does no AI work. |
| **Guard** | A bee that verifies another bee's work. |
| **Honey** | The network's work currency, counted in grams. It is earned through verified work and spent on compute power (§18.1). |
| **Reputation** | A reliability score between 0 and 1, specific to each contributor. |
| **Pledge** | What a contributor gives and how they split it between hives. |
| **Board** | The shared memory of a hive: discoveries, dead ends, questions. |
| **Pheromone** | The progress signal of a branch, which attracts more or fewer bees. |
| **Orientation** | A priority deliberately given to a branch by an authorized human (§17). |
| **Founder** | The author of the protocol. Their powers are defined and limited in §14. |
| **Council** | The body elected by the contributors (§14.3). |
| **Founder pool** | The voluntary share of donated compute that the founder allocates (§16). |
| **Registry** | The public, tamper-proof log of all decisions and all honey. |
| **Foundation** | The non-profit organization that holds the protocol and deploys the sovereign hives (§18.2). |
| **Caravel** | A sovereign, physical compute node (servers, open models) owned by the Foundation, installed wherever a community asks for one. The hive does the work, the caravels carry the power: together, they explore the noosphere. |
| **Fleet** | All the caravels. |
| **Crew** | The people who run and maintain a caravel. |
| **Power share** | A permanent right to a fraction of the fleet's capacity, obtained through participation (§18.2). |
| **The Commons** | The shares held by everyone, permanently, and redistributed to every registered human (§18.2). |
| **Support** | A free vote that a contributor gives to a hive they want to see succeed. |

---

## 3. Architecture

```
  Contributor (own machine)                         Kickswarm network
 ┌─────────────────────────────┐            ┌──────────────────────────────┐
 │ Agent: Claude Code, Codex,  │            │ Coordinator                  │
 │ Gemini CLI, Ollama…         │            │  · hive and comb state       │
 │   ▲                         │   signed   │  · caste assignment          │
 │   │ MCP tools               │◄───cells───│  · scheduling (§12)          │
 │ Kickswarm plugin (MCP)      │            │  · board (§13)               │
 │   │                         │──results───►  · public registry           │
 │ Execution sandbox (§8)      │  + hashes  └──────────────┬───────────────┘
 │ Keys and credentials: here, │                           │
 │ and nowhere else            │            ┌──────────────▼───────────────┐
 └─────────────────────────────┘            │ Automatic verifiers          │
                                            │ (tests, Lean, CI, citations) │
                                            └──────────────────────────────┘
```

There are four components.

1. **The plugin**, a local MCP server. It connects any MCP-compatible agent to the network. It MUST run cells in the sandbox (§8) and MUST NOT ever send credentials.
2. **The daemon** *(optional)* runs the plugin without a human: unused quota, time slots, GPU at night.
3. **The coordinator.** For v0.1, there is a single one, operated by Kickswarm. Coordinator federation arrives in v0.3 (§23).
4. **The automatic verifiers**, containers that replay deterministic checks.

---

## 4. Protocol objects

### 4.1 Common rules

- Every object is serialized as canonical JSON (RFC 8785, JCS).
- Its identifier is `sha256:` followed by the hexadecimal hash of that serialization, excluding the `sig` field.
- Every signature is Ed25519. A contributor's identity is their public key, prefixed with `ed25519:`.
- A signed object is immutable. Changing it means creating a new object.

### 4.2 Hive

```json
{
  "type": "osp.hive/0.1",
  "slug": "erdos-lean",
  "nom": "Erdős × Lean",
  "objectif": "Formalise open problems in Lean 4",
  "porteur": "ed25519:…",
  "classe_verif_defaut": "V0",
  "licence_resultats": "CC-BY-4.0",
  "conformite_charte": { "version": "0.1", "decision": "sha256:…" },
  "budget": { "plafond_miel": 500000 },
  "statut": "active",
  "sig": "…"
}
```

`statut` is `proposee`, `active`, `en_pause`, `terminee` or `refusee`. A hive only moves to `active` with a compliance decision written in the registry (§14.6).

### 4.3 Cell

```json
{
  "type": "osp.cell/0.1",
  "ruche": "erdos-lean",
  "parent": "sha256:…",
  "chemin": "3.2.1",
  "objectif": "Prove the bounding lemma for even n",
  "capsule": "sha256:…",
  "critere_fini": {
    "classe": "V0",
    "verificateur": "lean4@4.12/lake build",
    "attendu": "aucune erreur, aucun sorry"
  },
  "budget": { "tokens_max": 200000, "duree_max_s": 1800 },
  "atomique": true,
  "emise_par": "coordinateur",
  "sig": "…"
}
```

- The **capsule** contains all the context needed, and nothing more: board excerpts, files, useful results from sibling cells. It MUST fit within the context budget of a typical agent (32,000 tokens *(parameter)*).
- A non-atomic cell (`"atomique": false`) calls for a split (§6), not an execution.

### 4.4 Result

```json
{
  "type": "osp.result/0.1",
  "alveole": "sha256:…",
  "auteur": "ed25519:…",
  "caste": "ouvriere",
  "livrable": "sha256:…",
  "preuve": "sha256:…",
  "transcript": "sha256:…",
  "impasses": ["sha256:…"],
  "agent": { "famille": "claude-code", "modele": "déclaré" },
  "cout": { "tokens": 84211, "duree_s": 640 },
  "sig": "…"
}
```

- `livrable` is the work itself: code, proof, text, data.
- `preuve` is the artifact that makes verification possible: test output, build log, list of citations.
- `transcript` is the hash of the execution log. It is used for auditing in case of escalation, and it only leaves the machine at a jury's request.
- `impasses` lists the leads tried without success. They feed the board.
- The model used is declared: the protocol cannot prove it.

### 4.5 Verdict

```json
{
  "type": "osp.verdict/0.1",
  "resultat": "sha256:…",
  "gardienne": "ed25519:…",
  "decision": "valide",
  "motif": "lake build OK, 0 sorry",
  "mise_reputation": 0.05,
  "piege": false,
  "sig": "…"
}
```

`decision` is `valide`, `rejete` or `abstention`. `piege` is only revealed after the verdict (§9.4).

### 4.6 Pledge

```json
{
  "type": "osp.pledge/0.1",
  "contributeur": "ed25519:…",
  "ressources": [
    { "type": "abonnement", "agent": "claude-code", "mode": "quota_inutilise" },
    { "type": "abonnement", "agent": "codex", "mode": "pourcentage", "valeur": 20 },
    { "type": "api_byok", "fournisseur": "anthropic", "plafond_mensuel_eur": 20 },
    { "type": "gpu_local", "plage": "23:00-07:00", "modeles": ["qwen", "llama"] }
  ],
  "repartition": { "erdos-lean": 50, "atlas-antibio": 30, "pool-fondateur": 20 },
  "sig": "…"
}
```

The values in `repartition` MUST add up to 100. Resources are detailed in §11.

---

## 5. Lifecycle of a cell

```
 verrouillee ──(all children in honey)─────► libre ──(assignment)───► reservee
                                              ▲                          │
                                              │                     (the bee arrives)
                                    rejetee ──┘                          ▼
                                       ▲                              en_cours
                                       │                                 │
                                       │                           (result submitted)
                                       │                                 ▼
                                       └──────(negative verdict)─── en_verification
                                                                         │
                                                                  (positive verdict)
                                                                         ▼
                                                                       miel
```

- **verrouillee**: the cell has children that are not all in `miel`.
- **libre**: it can be taken. A leaf is open as soon as it is created.
- **reservee**: a bee has taken it, with a lease of `duree_max_s` × 1.5 *(parameter)*. If the lease expires, the cell becomes open again and the bee loses a little reputation.
- **en_verification**: guards are drawn at random (§7.2).
- **miel**: validated. Honey is paid out (§10) and the parent is re-evaluated.
- **rejetee**: the result is refused. The cell goes back to `libre`. After 3 rejections *(parameter)*, it is sent back for splitting (§6): it was probably badly framed.

A parent cell moves to `libre` when all its children are in `miel`. A **builder** then assembles it from its children's results, and that assembly is verified in turn. This is how honey flows up to the heart.

---

## 6. The fractal loop: splitting

### 6.1 Atomicity criterion

A cell is **atomic** if and only if all three conditions hold:

1. its `critere_fini` can be checked by a known verification class (§9.1);
2. its estimated cost fits within the maximum budget of a cell;
3. its capsule fits within the context budget (§4.3).

Otherwise, it MUST be split.

### 6.2 Competing splits

1. The coordinator draws *k* scouts at random (3 by default *(parameter)*). Each proposes a split into 2 to 12 children, each child with its own completion criterion.
2. Guards score the splits on a public grid: coverage of the goal, verifiability of the children, independence of the children, estimated cost.
3. The best-scored split is adopted. The others are archived on the board.
4. **Probationary split.** If, after 20% of the branch's budget *(parameter)*, the branch is progressing more slowly than the hive's median, an archived split MAY replace it. This is selection by results.

### 6.3 Human checkpoints

Splitting decides the direction, and the direction belongs to humans.

- Splits at **levels 0 and 1** (the heart and its direct children) MUST be approved by the hive owner before execution.
- The hive owner MAY require approval at deeper levels.
- The founder and the council also have orientation (§17) and the veto (§14.4).

### 6.4 Limits

- The maximum depth is 8 levels *(parameter)*.
- A cell that does not become atomic at this depth is marked `bloquee` and reported to the hive owner.

---

## 7. Castes and assignment

### 7.1 The four castes

| Caste | Task | Verification class of its output |
|---|---|---|
| Scout | Propose a split | Jury scoring (V2) |
| Worker | Execute an atomic cell | That of the cell |
| Guard | Verify a result or score a split | Random audit and trap cells (§9.4) |
| Builder | Assemble the children's results | That of the parent |

The contributor does not choose their caste.

### 7.2 Verifiable random draw

- The assignment of guards MUST be unpredictable at submission time and verifiable afterwards.
- The seed is `sha256(balise_aléatoire_publique ‖ id_resultat)`, where the beacon is the first drand round published after submission.
- Among eligible and available bees, the selection is weighted by reputation.

### 7.3 Eligibility rules

- A bee MUST NOT verify a result from its own contributor.
- The guards of a single verdict SHOULD come from different model families (§9.2).
- A new contributor (reputation < 0.3) only receives V0 cells, whose verification is automatic.
- V2 guard duty requires a reputation ≥ 0.6 *(parameter)*.

---

## 8. Locked execution

When a bee takes a cell, the plugin MUST follow these rules.

1. **Check the signature** of the cell and of its capsule. An invalid signature leads to a refusal.
2. **Run headless** in a sandbox: a container or lightweight VM, with no access to personal files, network limited to an allowlist declared by the hive, and time and token caps.
3. **Allow no human interaction** during execution. Any intervention, or any change to the prompt, makes the result invalid: its hash no longer matches the signed prompt.
4. **Treat the capsule as data**, never as instructions that would go beyond the cell. This is the defense against prompt injection.
5. **Sign the result** and compute the hash of the transcript.

> **Accepted limit.** On a third party's machine, it is physically impossible to *prove* that no human intervened. Locking serves prompt integrity and convenience. The network's security rests on verifying the result (§9).

---

## 9. Verification: the five locks

### 9.1 Verification classes

| Class | Examples | Guards (k) | Threshold |
|---|---|---|---|
| **V0** deterministic | Tests, Lean compilation, benchmark | 2 who replay, plus the automatic check | Both replays pass |
| **V1** semi-automatic | Citations to check, extracted data | 2 | 2 out of 2 |
| **V2** judgment | Synthesis, splitting, writing | 3 to 5 | Qualified majority of 2/3 |

A hive SHOULD maximize the share of V0. That is where the swarm is unbeatable.

With *k* independent guards that each detect a fake with probability *p*, a fake gets through with probability (1 − p)^k. Going from 1 to 2 guards in V0 divides this risk by 10 when p = 0.9. The detailed calculations are in [docs/security.md](../docs/security.md).

### 9.2 Lock 1: unpredictable random draw

See §7.2. No one knows in advance who will verify their work, so no one can collude with their verifier.

### 9.3 Locks 2 and 3: diversity and reputation stake

- **Diversity.** In V1 and V2, the guards of a single verdict SHOULD come from at least two different model families. Different models make different mistakes.
- **Stake.** Each guard puts part of its reputation on its verdict. If an audit or an escalation overturns that verdict, it loses its stake. Otherwise, it gets the stake back, with a gain.

### 9.4 Lock 4: trap cells

- Among the verification tasks, the coordinator injects results whose truth it knows: deliberately built fakes and genuine results already validated. They make up 4% of tasks *(parameter)*.
- Validating a fake halves reputation. Rejecting a genuine result costs the stake.
- Trap cells cannot be told apart in advance and are only revealed after the verdict.

### 9.5 Lock 5: escalation

- A verdict can be challenged by the author or by a minority guard, against a reputation stake.
- The challenge goes before a jury of 7 guards, then 15 on appeal, then before the hive owner as a last resort.
- At each level, the loser pays the stake.

### 9.6 Random audit

After validation, 2% of cells in honey *(parameter)* are re-verified by a new jury. A verdict overturned on this occasion penalizes all the original guards.

---

## 10. Honey, reputation, ratio

### 10.1 Honey

```
miel(alvéole) = B × c_classe × (1 + 0.25 × hauteur)
```

- `B` is the base, 6 g *(parameter)*.
- `c_classe` is 1 in V0, 1.5 in V1 and 2 in V2.
- `hauteur` is the number of levels below the cell: a leaf has a height of 0, and assembling pays more.
- The heart of a completed hive pays a bonus of 80 g *(parameter)*, shared among all the hive's contributors in proportion to their honey.

Honey is paid out as follows:

| Beneficiary | Share |
|---|---|
| Author of the result | 100% of `miel(alvéole)` |
| Each guard of the final verdict | 20% of `miel(alvéole)` |
| Guard who catches a trap cell | 12 g bonus |
| Guard who catches a real fake | 6 g bonus |
| Owner of a completed hive | 5% of the total honey produced by the hive, multiplied by (1 + 0.1 × √supports) *(parameter)* |

The last row rewards whoever proposes a project that succeeds and that people like. Supports are free, and each contributor has 10 per month *(parameter)*.

All honey is written in the registry. It is the network's work currency: its issuance, spending and phases are in §18.1.

### 10.2 Reputation

Each contributor has a reputation R ∈ [0, 1]. It starts at 0.2.

| Event | Update |
|---|---|
| Result or verdict confirmed | R ← R + 0.05 × (1 − R) |
| Verdict overturned | R ← R × 0.9 |
| Lease expired | R ← R × 0.98 |
| Fake trap cell validated | R ← R × 0.5 |
| Result rejected (for its author) | R ← R × 0.95 |

All coefficients are *(parameters)*.

### 10.3 Ranks *(informative)*

| Rank | Cumulative honey |
|---|---|
| Larva | 0 g |
| Nymph | 50 g |
| Forager | 200 g |
| Sentinel | 600 g |
| Architect | 1.5 kg |
| Elder | 3 kg |

Ranks are cosmetic. Rights depend on reputation, not on rank.

### 10.4 The ratio

```
ratio = honey given to other hives / honey consumed by my hives
```

- Hives whose owner has a ratio ≥ 1 get a priority multiplier of 1.2 *(parameter)* in scheduling (§12).
- A new hive gets a seed credit so it can start before it has a ratio.

### 10.5 Trophies

Trophies celebrate participation. They have no monetary value, cannot be transferred, and are shown on each contributor's public profile. They let people show that they were there at the start of something revolutionary.

| Trophy | How to earn it |
|---|---|
| **Pioneer** | Contribute during the first 6 months after the public launch (§18.4) |
| **First Drop** | Get your first cell validated |
| **Trap Hunter** | Catch a trap cell |
| **Guardian** | Give 10 confirmed verdicts |
| **Scout** | Get a split adopted |
| **Builder** | Get an assembly validated |
| **Founding Bee** | Be among the first 10 contributors of a hive |
| **Heart of the Hive** | Have contributed to a completed hive |
| **Hive Owner** | See one of your hives approved |
| **Busy Bee** | Fill 10 cells |

Trophies are computed from the public registry: anyone can check that they were earned. Governance MAY add new ones, but never take one away from someone who earned it.

---

## 11. Pledge and resources

### 11.1 Resource types

| Type | What it means | Rule |
|---|---|---|
| `abonnement` / `quota_inutilise` | The daemon detects the quota left before the reset and runs cells with the contributor's agent, on the contributor's own account | The human takes back control as soon as they return |
| `abonnement` / `pourcentage` or `heures` | A share of agent time is dedicated | Declared cap, enforced locally |
| `api_byok` | Local API key, with a cap in euros split according to the pledge | The key never leaves the machine |
| `gpu_local` | Open models, during a time slot | Cells filtered according to the declared capacity |
| `don` | Money given to a hive, through a payment provider | The only flow where a commission is allowed (§18.5) |

### 11.2 Rules

- The plugin MUST enforce the pledge caps locally. The coordinator does not have to trust them.
- The coordinator MUST NEVER ask for, receive or store a credential.
- **Strict mode per provider.** The plugin ships with one profile per AI provider, reflecting that provider's terms of use. When a use is not clearly allowed, strict mode disables it by default (§20).
- A commission MUST NOT be taken on a subscription resource.

---

## 12. Scheduling and pheromones

On each work request, the coordinator first picks a branch, then a cell within that branch.

**Picking the branch** uses Thompson sampling:

```
for each open branch b:
    θ_b ~ Beta(α_b, β_b)        # α: cells turned to honey, β: rejections and failures, weighted by cost
    score_b = θ_b × w_orientation(b) × w_pool(b) × w_miel(b) × w_ratio(ruche)
pick the branch with the highest score
```

**Picking the cell** happens within the chosen branch, among open cells, starting with the deepest ones.

The following rules apply:

- Pheromones (α, β) evaporate by 5% per hour *(parameter)*. A branch that stalls fades out, a branch that progresses attracts.
- **Anti-starvation floor.** No open branch receives less than 5% of its hive's assignments *(parameter)*, whatever the orientation and the pheromones.
- `w_miel` is 1 by default. It increases when the hive owner spends honey on a branch (§18.1).
- **Orientation cap.** Orientation, the pool and honey spent, combined, cannot direct more than 70% of a hive's bees to a single branch (§17).

---

## 13. Hive memory

- Each hive has an append-only **board**, organized into three types of entries: `decouverte`, `impasse` and `question`. Each entry is signed and linked to a result.
- A rejected or abandoned result SHOULD declare its dead ends. No one follows a dead lead twice.
- Capsules (§4.3) are compiled from the board. The compilation is itself an AI task, verified in V2 by sampling.
- The board is public, except for a private hive under the Enterprise offer.

---

## 14. Governance

### 14.1 Roles

| Role | Who | Term |
|---|---|---|
| **Founder** | The author of the protocol | Permanent, with limited powers |
| **Council** | 7 seats: the founder (permanent seat) and 6 elected members | 1 year |
| **Hive owners** | The creators of hives | The lifetime of their hive |
| **Contributors** | Anyone holding a key that has produced honey | — |

### 14.2 Phase 1: the pilot

It lasts 12 months after the public launch.

- The founder alone exercises the powers of the council.
- Each decision is published in the registry (§14.6), with its reason.
- The end date of phase 1 is written in the registry from day one. It MUST NOT be pushed back without a contributor vote with a 2/3 majority of voting weight.

### 14.3 Phase 2: the council

**The election.**

- The 6 elected seats are renewed every year.
- A contributor's voting weight is the square root of the honey they earned over the last 12 months.
- This weight is capped at 1% of the total weight. This prevents the largest contributors from capturing the council.

**Who decides what.**

| Decision | Who decides |
|---|---|
| Amend the charter | The founder **and** 5 votes out of 7 on the council |
| Admit a hive (compliance) | The council by simple majority, or by delegation to a review committee |
| Change a parameter (*parameter*) | The council by simple majority |
| New minor version of the spec | The council by simple majority |
| New major version of the spec | The council by 5/7, plus a contributor vote by simple majority |
| Allocate the founder pool | The founder alone (§16) |
| Orient a branch | The hive owner, the founder or the council (§17) |
| Pause a hive | The hive owner, the founder or the council, with the reason published immediately |

### 14.4 The founder's veto

- The founder MAY veto any council decision, and any hive, on three grounds only: violation of the charter, security risk, threat to the existence of the network.
- Each veto MUST be published with its grounds.
- The council MAY lift a veto with 6 votes out of 7, that is, all the elected members.

### 14.5 The charter

- The charter (§15) only changes with the founder's agreement **and** a 5/7 majority on the council.
- Articles 1 to 3 and article 9 are **untouchable**: they can only be strengthened.

### 14.6 The decision registry

- Every governance decision is a signed `osp.decision/0.1` object: author, type, target, grounds, date.
- It is added to an append-only log whose hashes are chained, as in a transparency log.
- The registry is public, downloadable and verifiable by anyone.

---

## 15. Hive charter — v0.1

1. **The common good first.** A hive MUST serve a legitimate and beneficial goal, and must not harm others.
2. **No weapons, no mass surveillance, no manipulation.** No hive may design weapons, monitor or profile people, or manipulate opinions or behavior.
3. **Credentials stay with their owner.** No hive may ask anyone to hand over a password, a token or a key.
4. **Results open by default.** Results are published under an open license, except for a private hive under the Enterprise offer, declared as such.
5. **Full traceability.** Every gram of honey and every decision is public and verifiable.
6. **Respect for terms of use.** A hive must not push contributors to violate the terms of their AI providers.
7. **Published power.** The founder, the council and the hive owners publish their decisions and their reasons.
8. **Privacy.** No hive processes personal data without a legal basis. Capsules do not contain personal data that is not needed.
9. **The Commons never retreats.** The Commons' share of the power shares (§18.2) can only increase. Compute power must benefit, step by step, all of humanity.

---

## 16. The founder pool

- Each pledge MAY set aside part of its split for the founder pool. The interface suggests 8% by default. The contributor freely chooses between 0 and 100%, and this choice is always clearly shown.
- The founder allocates the pool to any hive that is **active and compliant with the charter**, including their own hives. Their own hives then carry the label "Founder's hive".
- Allocating the pool to a hive increases its `w_pool` weight in scheduling (§12), within the orientation cap.
- **Cap.** The pool cannot exceed 15% of the network's total capacity over a rolling week *(parameter)*. Beyond that, the excess goes back to the hives chosen by each contributor.
- **Transparency.** A public monthly report details the pool's allocations by hive.

---

## 17. Branch orientation

Orientation is the way for a human to tell the swarm: "this way".

| Who | Where | Maximum multiplier |
|---|---|---|
| The hive owner | Their hive | × 3 |
| The founder | Any active hive | × 3, combinable with the pool |
| The council | Any active hive | × 3 |

The following rules apply:

- An orientation is an `osp.decision/0.1` object of type `orientation`, published in the registry with its grounds.
- It **expires after 72 hours** *(parameter)*, unless renewed. A direction has to be actively maintained.
- A branch's `w_orientation` multiplier is the product of the active orientations, capped at × 5.
- The 70% cap and the 5% floor of §12 always apply.
- A hive owner MAY refuse an orientation from the founder on their hive. The refusal is published, and the founder then keeps the pool and the veto as levers.

---

## 18. Economy: honey, shares, caravels

The economy has three tiers, from the most liquid to the most permanent.

| | Honey | Power shares | The Commons |
|---|---|---|---|
| **Nature** | Work currency | Permanent right to the fleet | Shares held by everyone |
| **How you get it** | Through verified work | Honey crystallizes into shares | 30% of every share issuance |
| **Can it be spent?** | Yes, and it is then burned | No, it is kept for life | No |
| **What it gives** | Priority and compute hours | A fraction of the caravels' capacity, every month | A compute allocation for every registered human |

### 18.1 Honey, the work currency

**Principle: a proof of useful work.** Each gram issued corresponds to verified work. Bitcoin spends energy on computations whose only use is to secure its ledger. Honey, on the other hand, only exists if the swarm has produced something true.

**Issuance.** Honey MUST NOT be issued other than under §10.1. There is no pre-mining, no hidden reserve and no discretionary issuance, for anyone.

**Spending.** Spent honey is burned. It is used for two things:

1. getting priority in the swarm for your own hives or branches, through a `w_miel` multiplier in scheduling (§12), under the same 70% cap;
2. buying compute hours on the caravels (§18.3), at the public rate expressed in grams per work unit.

**Limit.** Honey never buys any particular contributor's subscription quota. The swarm stays voluntary: spending honey shifts priority, without requisitioning anyone.

**Indexing.** The rate is expressed in reference **work units** (WU), that is, a standard batch of V0 tasks, and not in euros. At launch, 1 g is worth 1 WU *(parameter)*.

**Phases.**

| Phase | Form | Exchange for money | Condition to move to it |
|---|---|---|---|
| **1. Launch** | Balances written in the signed registry | Forbidden | — |
| **2. Anchoring** | The registry hash is published on a public blockchain. Balances become verifiable by everyone, as non-transferable tokens. | Forbidden | Council decision |
| **3. Option** | Transferable token issued by the Foundation | Possible | Compliance with the MiCA regulation (white paper, licensed provider), 5 votes out of 7 on the council, contributor vote. And only if the compute bought back comes from the caravels and from paid APIs, never from subscriptions. |

Why move in phases? A token tradable from the start would have three effects: it would attract speculation before research, it would bring the project within the scope of the European MiCA regulation, and it would indirectly turn contributors' subscription quota into money, which violates the providers' terms.

### 18.2 Power shares

A power share is a **permanent** right to a fraction of the fleet's capacity. It is the equivalent of a stock share, paid in compute power rather than in money.

**Crystallization.**

- With each honey gain, 10% crystallizes immediately into shares, at one share per gram *(parameters)*. The remaining 90% stays as spendable honey.
- Idle honey crystallizes too: each year, 10% of the unspent balance turns into shares *(parameter)*. Honey you keep is not lost, it becomes permanent.

**The Commons.**

- For each share issued to a contributor, 3/7 of a share is issued to the Commons. The Commons thus permanently holds 30% of all shares.
- This proportion can only increase (charter, article 9).
- The Commons' capacity is split equally among all registered humans. It is a **universal cognitive allowance**, which grows with the fleet.
- This split requires a proof of unique personhood (planned for v0.2). Until then, the Commons' capacity goes to public-interest hives chosen by the council.

**The founder allocation.**

- The founder receives 2% of the shares issued during the first 4 years.
- These 2% are taken from the contributors' portion, never from the Commons' portion.
- The rate is set at creation, cannot be changed retroactively and is written in the registry.
- These shares follow the same rules as all the others.

**The rights of a share.**

- A fraction of the fleet's monthly capacity, proportional to the number of shares, usable by your agents and your hives.
- Capacity not used within the month goes back to the Commons: nothing is lost.
- A vote in the **Shares Assembly**, which elects part of the Foundation's board of directors (§18.3).

**The limits.**

- A share MUST NOT be sold, rented or transferred.
- It pays no cash dividend.
- These two rules make it closer to a right of use than to a financial instrument. Its legal classification still has to be validated (§22).

**How a caravel's capacity is split.**

| Recipient | Share of capacity |
|---|---|
| Host community | `h`, set at installation: at least 10%, and 50% or more for a co-funded caravel |
| Share holders, including the Commons | 75% of the rest |
| Network hives, through scheduling (§12) | 25% of the rest |

The percentages are *(parameters)*.

### 18.3 The Foundation and the caravels

**Mission.** Put decentralized compute power wherever people want it, and buy, install and maintain sovereign infrastructure for the whole world.

**The caravels.** A caravel is a physical compute node: GPU servers, open models, storage. It belongs to the Foundation, or is co-owned with a host community (school, library, university, city, cooperative, country). It joins the fleet through OSP.

**The sovereignty rules.**

- The host community sets its reserved share `h` at installation.
- Local data stays local.
- The community can disconnect its caravel from the network at any time.
- A caravel only runs free software and open models, with no dependency on a single vendor.

**Land and sites.** The Foundation MAY acquire land and buildings to install caravels: energy, cooling, connectivity. These sites are held for the mission, cannot be resold for private profit, and are written in the registry.

**Direct access.** Every registered human accesses their share of the Commons directly: without a commercial intermediary and without arbitrary filtering. The only limits are the law and the charter (§15), and each of them is published.

**The crews.** They are local operators. The Foundation pays them in euros, and they also earn honey.

**The Foundation's labs and workshops.** Compute is only a first step. The Foundation MAY also create physical infrastructure.

- **Regulated labs**, funded by donations, governments or other foundations: wet labs (biology, chemistry) and physics and materials labs. They run experiments proposed by the community and designed with the swarm.
- These labs are **supervised by real scientists and by the competent authorities**, with ethics committees and strict biosafety rules. No experiment starts without their approval, and the charter applies (article 2: no weapons, no dangerous dual-use research).
- **At-cost workshops and factories** make hardware designed by the community, with the help of the swarm's AIs and robots. They sell it at cost, to increase everyone's purchasing power.
- Results and designs are open by default (article 4), unless safety requires otherwise. That case is then published, with its reasons.

**Funding.**

- Donations, patronage and public grants.
- Co-funding by host communities.
- At least 50% of the SAS's commissions *(parameter)*.
- Burned honey brings in no money: the Foundation does not sell its compute for honey, it distributes it.

**Governance.**

- The Foundation's board of directors brings together: the founder (permanent seat), elected representatives of the OSP council, elected representatives of the Shares Assembly, and representatives of the host communities.
- The accounts are audited and a public report is published every year.

**Legal form.** In France, the simplest path is to start as a **fonds de dotation** (endowment fund): it is created by a simple declaration at the prefecture, with a minimum initial endowment of around €15,000 (to be checked). It can later become a foundation recognized as being of public utility (fondation reconnue d'utilité publique) once its endowment allows. Sister entities abroad will come later.

### 18.4 Growth: referral, communities, pioneers, problem box

The network must spread like wildfire, without ever becoming a pyramid. Four mechanisms help with this.

**Referral.**

- Each contributor has a referral link.
- For the 12 months after a referee joins, the referrer receives a bonus equal to 5% of the honey that referee earns *(parameters)*.
- This bonus is **issued on top**: it is never taken from the referee.
- Referral has **a single level**. A referrer's referrer receives nothing. This choice is **untouchable**: a multi-level system would be a pyramid scheme, which is illegal under French law.
- Since the bonus only comes from *verified* honey, fake referees bring in nothing.

**Community codes.**

- A community (association, school, city, company, Discord server…) creates a **community swarm**, with its own code. Members join it with this code.
- A community MAY put its hives on a fast track, and its members MAY orient them (§17), within the same limits as hive owners.
- **The local Commons**: each member MAY, on an opt-in basis, give part of their newly crystallized shares (5% suggested) to collective shares of their community. These shares fund the community's own projects. This is subsidiarity in practice.

**Pioneers.**

- Shares crystallized during the first 6 months after the public launch are multiplied by 2 *(parameter)*.
- The multiplier then decreases linearly down to 1 at month 24.
- The Commons always receives its 3/7 on shares *after* multiplication: its 30% share never goes down (charter, article 9).
- This is the network's gratitude to those who commit now, written into the rules from day one.

**The problem box.**

- Any registered person MAY submit, for free, a problem they would like to see the swarm solve.
- Contributors back it with their supports (§10.1).
- Each month, the most supported problems that comply with the charter become hives, funded by the Commons' capacity.
- This way, anyone, even with no compute to give, can put the world to work on what matters to them.

### 18.5 Revenue *(informative)*

| Source | Mechanism | v0.1 status |
|---|---|---|
| Donations and bounties | 5 to 8% commission on money flows to hives | Planned |
| Kickswarm Enterprise | Private hives where a company coordinates **its own** AI licenses | Planned |
| Contributor subscriptions | **No commission, ever** | Forbidden by §11.2 |
| Payment to the Foundation | At least 50% of commissions | Planned |

### 18.6 Structure *(informative)*

- **The Foundation**, a non-profit, holds the spec, the trademark, the registry, the fleet and the Commons.
- **Kickswarm SAS** operates the coordinator and the Enterprise offer under license from the Foundation, and pays it at least 50% of its commissions. The founder can be an employee and a shareholder there. That is where the founder's financial interest lies, separate from the mission.
- This structure has to be validated with a lawyer.

---

## 19. Security and abuse

Probability calculations and defenses against injection are detailed in [docs/security.md](../docs/security.md).

| Threat | Defense |
|---|---|
| **Sybil** (fake accounts in bulk) | Low starting reputation, V0 only for newcomers, square-root and capped voting weight. Proof of unique personhood considered for v0.2. |
| **Collusion** | Verifiable random draw, model diversity, trap cells, random audit. |
| **Prompt injection** in capsules | Signed capsules, treated as data, sandbox with no personal access, network allowlist. |
| **Exfiltration** from the contributor's machine | The sandbox has no access to personal files. The transcript only leaves at a jury's request. |
| **Malicious hive** | Compliance review before activation, emergency pause, veto, reporting by contributors. |
| **Compromised coordinator** | Chained registry verifiable by everyone, end-to-end signatures, federation in v0.3. |
| **Dangerous result** (for example, a discovered vulnerability) | Mandatory responsible disclosure, with an embargo managed by the hive owner. |
| **Hoarding** of honey or shares | Honey is only issued for verified work, it is burned when spent and cannot be exchanged in phases 1 and 2. Shares are non-transferable, the Commons keeps at least 30% and voting weight is square-root and capped. |
| **Fake humans** to capture the Commons allocation | No individual allocation without proof of unique personhood (v0.2). |

---

## 20. Compliance with provider terms

- The plugin keeps one profile per AI provider. This profile lists the contribution modes allowed by default.
- **By default, strict mode only allows:**
  - local models;
  - the contributor's own API keys (BYOK);
  - use of the contributor's agent, by the contributor, on their own account, for public-interest hives, with no resale.
- Any additional mode (for example, unused quota in daemon mode) is enabled provider by provider, after reading that provider's terms. The contributor is informed.
- Kickswarm SHOULD seek official partnerships with providers.

---

## 21. Interfaces

### 21.1 MCP tools exposed by the plugin

| Tool | Role |
|---|---|
| `swarm_join(ruche, pledge?)` | Join a hive, optionally with a pledge |
| `swarm_next()` | Receive the next signed cell, with its caste |
| `swarm_submit(resultat)` | Submit a signed result or verdict |
| `swarm_status()` | See your bees, your remaining quota, your honey, your reputation |
| `swarm_leave()` | Call back your bees |
| `hive_board(ruche, requete)` | Read the board |

### 21.2 Coordinator HTTP API (v0.1)

```
POST /v0/hives                     propose a hive
GET  /v0/hives/{slug}              state of the hive and its comb
POST /v0/work/claim                request a cell (signed)
POST /v0/work/submit               submit a result or a verdict (signed)
GET  /v0/board/{slug}              board
GET  /v0/registry?since=…          public registry (decisions and honey)
POST /v0/decisions                 publish a governance decision (signed)
```

Every request that changes state MUST be signed with the contributor's key.

---

## 22. Out of scope for v0.1 and open questions

**Out of scope:**

- coordinator federation;
- proof of unique personhood;
- distributed model training;
- payments between contributors.

**Open questions:**

1. How can the cost of a cell be estimated reliably before running it?
2. Should the trap cell rate vary with the guard's reputation?
3. What common scoring grid should be used for splits (§6.2)?
4. How should hives whose results have commercial value (licenses, patents) be handled?
5. What partnership should be offered to AI providers for unused quota?
6. What is the exact legal classification of honey and power shares under MiCA and French financial law? A lawyer's opinion is needed before launch.
7. Can power shares be passed on through inheritance?
8. What crystallization rate keeps honey liquid enough while still growing the shares?
9. How should the WU rate for caravel hours be set as hardware evolves?

---

## 23. Spec roadmap

| Version | Content |
|---|---|
| **v0.1** (this document) | Objects, lifecycle, castes, five locks, honey and shares, governance, charter, pool, orientation, Foundation and caravels |
| **v0.2** | Feedback from the first flagship hive, splitting grid, proof of unique personhood (which opens the Commons allocation), cost estimation, anchoring the registry on a public blockchain (honey phase 2) |
| **v0.3** | Coordinator federation, replicated registry, first caravel |
| **v1.0** | Stable spec, after 6 months in production and a council vote |
