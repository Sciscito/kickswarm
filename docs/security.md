# Swarm security

This document explains why you can trust the results of a network open to strangers, and how we defend against those who would try to fool it or attack it. It complements the spec ([§7](../spec/OSP-v0.1.md), [§9](../spec/OSP-v0.1.md) and [§19](../spec/OSP-v0.1.md)).

The principle is the spec's: **we do not verify the process, we verify the result.** All of security rests on probabilities that can be calculated and made as small as we want.

---

## 1. The mathematics of verification

### 1.1 Several independent guards

Assume each guard detects a false result with probability *p*, and that guards are independent. A false result is accepted only if every guard misses it:

```
P(false accepted) = (1 − p)^k
```

| Guards *k* | p = 0.9 | p = 0.99 |
|---|---|---|
| 1 | 10% | 1% |
| 2 | 1% | 0.01% |
| 3 | 0.1% | 0.0001% |

**Decision: V0 cells move to 2 guards**, on top of the automatic verifier. The parameter `gardiennes_v0` now defaults to 2. Each extra guard divides the risk by 10 when *p* = 0.9, for a cost that only grows linearly.

For a V0 cell, the automatic verifier already catches everything the tests catch. Guards protect against three things:
- a compromised or buggy coordinator;
- a result that depends on the environment (non-determinism, clock, randomness);
- an attempt to escape the sandbox.

Their real weight grows with V1 and V2, where judgment replaces tests.

### 1.2 Hidden and random tests

A worker sees the public tests. A dishonest worker could therefore write code that cheats on those exact tests, for example by hard-coding the answers. The defense has two parts:
- **Hidden tests.** Guards also replay tests the worker has never seen.
- **Property tests.** Guards generate random inputs and check properties (for example, `pgcd(a, b)` divides `a` and `b`), with a seed drawn after submission.

With *m* independent random inputs, code that only works on a fraction *f* of inputs passes with probability *f^m*. For *f* = 0.5 and *m* = 30: less than one chance in a billion.

### 1.3 Trap cells measure each guard

A share *τ* of verification tasks are traps whose answer the coordinator knows (4% by default, §9.4).

- **A lazy guard**, one that approves everything, gets caught at the first trap. The average number of verifications before it is exposed is 1/τ, that is 25 with τ = 4%.
- **Traps are also used to estimate each guard's *p*.** After *n* traps, *d* of them caught, we have an estimate of its reliability (§1.4). A guard whose estimated reliability falls below a threshold is removed.

Traps cannot be told apart beforehand, and they are revealed only after the verdict.

### 1.4 Bayesian reputation

The rule in §10.2 of the spec is a simple version of a cleaner model: the **Beta-Bernoulli** law.

- Each contributor has two counters: α (verdicts or results confirmed) and β (overturned or rejected). Both start at 1.
- Its estimated reliability is α / (α + β). The uncertainty can be read from the Beta(α, β) law itself.
- **Example.** A guard has caught 9 traps out of 10. Its estimated reliability is 10/12 ≈ 0.83. It is removed if P(p < 0.8) > 95%; here, it stays.
- **Forgetting.** α and β are multiplied by a factor λ = 0.99 at each event. Reputation thus follows recent behavior. This is the defense against those who build a reputation in order to betray later: a recent betrayal weighs more than a long honest history.

The move from §10.2 to this model is planned for v0.2.

### 1.5 Collusion against the random draw

An attacker who controls *m* guards out of a pool of *N* wants **all** the guards drawn for their own result to be theirs. The probability follows a hypergeometric law:

```
P = C(m, k) / C(N, k) ≈ (m / N)^k   when N is large
```

| Pool *N* | Attacker *m* | k = 2 | k = 3 |
|---|---|---|---|
| 10,000 | 500 (5%) | 0.25% | 0.012% |
| 10,000 | 100 (1%) | 0.01% | 0.0001% |

And even when they win this draw, their result is still exposed to the random audit (§1.7) and to the reputation-weighted draw, which lowers the weight of recent accounts.

**Why public, verifiable randomness (drand).** If the randomness is known or can be manipulated, the attacker can pick the moment of their submission to land on their accomplices. This is called *grinding*. The seed of the draw is therefore:

```
seed = sha256(first drand round published AFTER the submission ‖ id_resultat)
```

Nobody knows this round at submission time, and anyone can check the draw afterwards.

### 1.6 The cost of fake accounts (Sybil)

- **A new account starts with a reputation of 0.2** and has access to V0 cells only.
- **To become a V2 guard**, you need a reputation of 0.6. With the rule R ← R + 0.05 × (1 − R), you need *n* confirmations such that 0.8 × 0.95ⁿ ≤ 0.4, that is **at least 14 confirmed contributions**. Each fake account therefore costs real, verified work.
- **The square-root vote trap.** Splitting your honey *H* across *s* accounts gives a total weight of s × √(H/s) = √(s × H). So the weight grows with the number of accounts. The square root protects against the big players, but it **encourages fake accounts**. The defenses:
  - proof of personhood (v0.2), so that one voice matches one human;
  - a cap per person;
  - a minimum activity threshold to vote.

  Until proof of personhood exists, the council vote must stay cautious.

### 1.7 Random audit after validation

2% of cells already turned into honey are re-verified by a new jury (§9.6). A cheater who got *F* false results accepted escapes every audit with probability 0.98^F:

| False results *F* | Chance of escaping every audit |
|---|---|
| 50 | 36% |
| 100 | 13% |
| 200 | 1.8% |

A single failed audit is enough to bring down the reputation of the guards involved. Cheating at scale therefore becomes almost certain to fail.

---

## 2. Defending against malicious injections

A hive is a text written by a stranger (the hive owner, a scout) and read by another stranger's agent. This is the main attack surface: getting the agent to do something other than the cell.

| Defense | What it does | Status |
|---|---|---|
| **The capsule is data** | The plugin's instructions frame the capsule and tell the agent to ignore any instruction it contains | ✅ |
| **Marking untrusted content** (*spotlighting*, *datamarking*) | Untrusted content is wrapped in unique, random tags, or its words are interleaved with a marker, so the model can tell data from instructions | To do |
| **Signed capsules** | The coordinator signs each cell; the plugin refuses a modified capsule | ✅ (signature) · plugin-side check to add |
| **Schema-constrained outputs** | The agent can only return text files, dead ends, or a split in a strict format, validated before sending | ✅ |
| **Least privilege** | The plugin exposes no file, network or shell tool. A hijacked agent can only return a bad deliverable, which will be rejected. | ✅ |
| **WebAssembly sandbox** | The default everywhere: the coordinator, guards and auditors run the same engine, so the same verdict. Received code runs in QuickJS compiled to WebAssembly, a fresh engine in a throwaway thread: the language and the deliverable's files, nothing else. No network, no disk, no process, no Node API; memory, stack and time are bounded. | ✅ |
| **Frozen built-ins** | Before loading the deliverable, the runner freezes JavaScript's built-in objects: the code under test cannot rewrite what the report or a property relies on | ✅ |
| **Container with network cut off** | Docker or Podman, no network, with CPU and memory quotas, read-only filesystem | ✅ written · to be tested on a machine with Docker |
| **Isolated process** | On explicit request only: a Node process with the permission model. The network is not cut off in this mode. | ✅ |
| **Dual LLM** (*dual-LLM*, quarantined LLM) | For V2 judgments: a "quarantined" model reads the untrusted content but has no tools; it only passes a structured output (a score, a verdict) to the model that acts | Planned with V2 |
| **Canary tokens** | Secret strings placed in the agent's context. If one of them shows up in a deliverable or a request, there was a leak or an injection, and the cell is quarantined. | To do |
| **Size limits** | Deliverable capped at 256 KB and 32 files, verification output at 1 MB, request body at 1 MB | ✅ |
| **Rate limits** | Concurrent leases capped (3 bees per contributor), anti-replay window, and to add: quotas per identity and per address | Partial |

**Golden rule:** no text-based defense is enough on its own against prompt injection. The real protection is that a hijacked agent **cannot do anything serious** (least privilege, sandbox) and that its deliverable is **verified by others** (§1).

---

## 3. Code review at scale

The swarm can protect itself, and protect the software the world depends on.

### 3.1 A "security review" class of hive

- **Static analysis**: tools such as Semgrep or CodeQL run in the sandbox. Their alerts become cells.
- **Dependency analysis**: vulnerable versions, abandoned packages, typosquatting.
- **AI review juries**, with model diversity: each finding is confirmed by at least two model families before it is kept.
- **Proof required**: a finding is validated only if it comes with a test that reproduces the problem. This is V0: verifiable without discussion.
- **Responsible disclosure** is mandatory, with an embargo managed by the hive owner (§19 of the spec).

The first target is Kickswarm's own code.

### 3.2 A public bug bounty

Before the public launch: a bug bounty program on the coordinator, the plugin and the sandbox, with a published scale and rewards in euros paid by the foundation.

### 3.3 Access to the best defensive AI

The most advanced defensive tools are often reserved for partners of AI labs and security programs. Kickswarm will actively seek these partnerships:
- access to security-specialized models;
- compute credits dedicated to code review;
- audits by recognized teams.

An open network that protects free software is a natural partner for these programs. No partnership exists to date.

---

## 4. What remains to be done, by priority

1. Container with network cut off for every verification (blocking for the launch).
2. 2 guards in V0 (in progress in the code).
3. Random draw wired to drand.
4. Hidden tests and property tests in the V0 verifier.
5. Capsule signature check on the plugin side, marking of untrusted content, canary tokens.
6. Bayesian reputation with forgetting (v0.2).
7. Proof of personhood before any council vote (v0.2).
8. External audit and bug bounty before the public launch.
