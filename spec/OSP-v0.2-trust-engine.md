# OSP v0.2: the trust engine

**Design proposal · status: draft · builds on [OSP-v0.1](OSP-v0.1.md) and [docs/security.md](../docs/security.md)**

> A swarm open to everyone cannot rest on good faith. It must **guarantee a measured error rate**, **grow stronger with every event** and **be verifiable by anyone**.

This document starts from an honest assessment of the MVP. It then proposes an architecture built on proven methods: Wald's sequential tests, the Dawid-Skene model, mutation testing, peer prediction, proper scoring rules, replayable *event sourcing*. It ends with a prioritized plan.

---

## 1. The assessment: where the MVP does not hold up yet

| # | Flaw | Why it matters |
|---|---|---|
| F1 | **V0 verification is no stronger than its tests.** Guards rerun the *same* tests as the automatic verifier. For deterministic code, the second and third runs add almost nothing. | A scout can write weak tests, and a sloppy solution will pass. With weak tests, "2 guards" is just security theater. |
| F2 | **The number of guards is fixed** (k = 2). | No guarantee on the error rate. Easy cases are over-checked and doubtful cases under-checked. |
| F3 | **Trap cells are recognizable.** The fake result always returns `'__piege__'`. | A malicious guard can detect them mechanically and cheat everywhere else. |
| F4 | **The registry holds only summaries.** The full signed objects (results, verdicts, splits) are not in it. | Nobody can recompute the state independently: you have to take the coordinator's word for it. |
| F5 | **Randomness comes from the coordinator.** | The coordinator, or whoever hacks it, can rig the assignment of guards. |
| F6 | **Reputation is an ad hoc score**, with no measure of uncertainty. | A lucky newcomer and a reliable veteran can have the same score. |
| F7 | **A single split, with no measure of quality.** The children's tests are not checked against the parent's contract. | A bad split at the top wastes the whole tree. |
| F8 | **Square-root voting encourages fake accounts** (noted in security.md). | Splitting your honey across several accounts increases your total weight. |
| F9 | **A single coordinator.** | A single point of failure and a single point of trust. |

**Conclusion.** The priority is not to add guards. It is to make **the tests themselves verified**, **verification adaptive with a numerical guarantee**, and **the state replayable by everyone**.

---

## 2. The guiding principle: an error guarantee, not a number of guards

Each hive sets a **maximum false honey rate**, α\*. This is the probability that a validated cell is actually wrong. By default, α\* = 10⁻⁴, that is one wrong cell in 10,000 *(parameter)*.

The system **measures** this rate continuously, through trap cells and audits (§6), and **adjusts** the number of checks, the trap cell rate and the audit rate automatically to stay below α\*. The measured rate is **public**, with its confidence interval, on each hive's page.

This is the difference between "we check twice" and "we guarantee, with numbers to back it, fewer than one error in 10,000".

---

## 3. Layer 1: tests that are themselves verified (answer to F1)

For code, the real defense is not more reviews. It is **making the tests hard to fool**. Five mechanisms add up.

### 3.1 Hidden tests

- Each completion criterion is split in two: **visible tests**, given to the worker, and **hidden tests**, which they never see.
- Only the verifier runs the hidden tests. Hidden tests are stored hashed and revealed to the registry after validation.
- A solution "tailored to the visible tests" fails the hidden tests.

### 3.2 Test mutation score

- When a scout proposes a child's tests, they also provide a **reference implementation**.
- The verifier automatically generates **mutants** of this reference: flipped operators, changed constants, negated conditions, deleted lines.
- A test suite is accepted only if it **kills at least 80% of the mutants** *(parameter)*. Tests that are too weak are refused before they are even handed out.
- This is the mutation testing technique (DeMillo, Lipton and Sayward, 1978), used here as an entry filter.

### 3.3 Property-based tests

- On top of `{ fn, args, attendu }` examples, a criterion can declare **properties**: "the result is sorted", "gcd(a, b) divides a and b", "f(x) = g(x) for 1,000 random inputs".
- The verifier generates hundreds of random inputs, from a public seed. A solution that only memorizes the examples fails.

### 3.4 N-version programming

- For critical cells, **two or three workers from different model families** each write their own solution, without seeing each other's.
- The verifier compares them on thousands of generated inputs: this is differential testing.
- If all versions agree, confidence rises sharply, because different models make different mistakes. A disagreement reveals a bug, and the input that revealed it becomes a new test.

### 3.5 The hunter caste: a bounty for counterexamples

- A new caste, the **hunter**, attacks cells that are already validated: they look for an input that makes the solution fail, or that breaks a property.
- If they find one, and the verifier confirms it:
  - the cell is **reopened**;
  - the counterexample becomes a **permanent test**;
  - the hunter collects a bounty;
  - the author and the guards who validated lose reputation.
- **This is the self-reinforcement engine.** Every flaw found makes the swarm harder to fool, for good.

### 3.6 What is implemented (P0-2)

- **Hidden tests.**
  - The criterion publishes only a **commitment**, `tests_caches_hash`: the sha256 of the canonical form of the tests.
  - The tests themselves travel **alongside** the signed object, never inside it. The coordinator keeps them in a **private vault**, outside the state and the registry.
  - The verifier runs them. Their failures are **never detailed**: no arguments, no expected value, no actual value.
  - They are **revealed to the registry at validation** (`secrets_reveles`). The auditor then uses them to re-verify.
  - Workers and guards never see them.
- **Property-based tests.**
  - Generators: integers, floats, booleans, strings, arrays, choice among values.
  - An expression must hold on hundreds of randomly drawn inputs.
  - **The seed is derived from the hash of the deliverable**, in the style of Fiat-Shamir: changing the code changes the drawn inputs, so nobody can target cases in advance. Yet anyone can reproduce exactly the same draws.
  - On failure, a concrete counterexample is given.
- **Mutation engine.**
  - It flips operators, shifts comparisons, swaps `&&` and `||`, changes booleans and constants.
  - It never touches strings, templates or comments.
  - **Version 2**, born from the first trial with a real AI. It also mutates the inside of regular expressions:
    - `+` becomes `{2,}`, that is "at least two" instead of "at least one", the quantifier boundary error;
    - `*` becomes `+`, a `?` quantifier is removed;
    - the `^` and `$` anchors are removed;
    - a class and its opposite are swapped (`[a-z]` ↔ `[^a-z]`), as are `\d` ↔ `\D` (and `\s`, `\w`);
    - the `g`, `i`, `m` and `s` flags are removed.
    
    It also swaps methods that have an opposite: `toLowerCase` ↔ `toUpperCase`, `startsWith` ↔ `endsWith`, `indexOf` ↔ `lastIndexOf`, `some` ↔ `every`, `min` ↔ `max`, `floor` ↔ `ceil`, `trimStart` ↔ `trimEnd`, `push` ↔ `unshift`…
  - **Why version 2.** During the trial, the scout AI had written a clean `slugify` reference, made only of regular expressions. The engine found "nothing to mutate", and the split was refused even though the work was good. The AI got around it by rewriting its references with loops; others could have got stuck.
  - **`+` → `*` is left out on purpose.** In a replacement with an empty string, a pattern that accepts the empty string changes nothing: `/^-*|-*$/g` behaves like `/^-+|-+$/g`. This mutant would be equivalent, impossible to expose, and capped the score of that reference at 78%.
  - **The engine is part of the replay**, because trap cells depend on it. The launch announces its version (`moteur_mutation`), and a registry that does not announce it is replayed with version 1. On replay, the launch entry also takes the parameters exactly as they were announced. Without this, every parameter added since then made old registries impossible to audit from their very first entry.
- **Test strength at entry.** When a scout provides a secret reference (`reference_hash`), the split is accepted only if the reference passes its own tests and those tests detect at least **80%** of its mutants. The score is written to the registry, then carried by each cell (`force_tests`). The `reference_obligatoire` parameter makes it mandatory everywhere.
  - **A reference in which the engine truly finds nothing to mutate** (`(x) => x`) is accepted without measurement, like a cell with no reference: the scout could have provided that instead. When `reference_obligatoire` is on, the measurement is still required.
- **The `tests-de-tests@1` verifier.** For tasks that consist of *writing tests* (the "Open source shield" hive), the deliverable is a test suite. It must pass on the real target and kill at least 80% of its mutants. This is an objective criterion that anyone can verify.
- **A flaw fixed along the way.** In the MVP, the code under test could print a fake "all tests pass" line. Now:
  - the tests arrive on standard input, consumed before the module is loaded;
  - the result carries a **secret token** unique to each run;
  - the runner captures its primitives (`JSON`, `Object.keys`, the output) before anything is loaded;
  - the comparison uses a home-made deep equality that the module under test cannot replace.

**Known limits:**

- **Equivalent mutants** (a mutation that changes nothing in the behavior) lower the score a little: the 80% threshold accounts for this.
- **A property is only as good as its expression.** The tests show that code that always returns 1 passes "divides both", but not "is the greatest".
- **Before the reveal, the coordinator holds the hidden tests.** The commitment guarantees that it cannot change them afterwards, but not that it does not leak them to an accomplice. The countermeasures come in P3: threshold encryption across several coordinators.

---

## 4. Layer 2: adaptive verification with a guarantee (answer to F2)

### 4.1 The model

Each verifier *i* (human-agent guard, or automatic verifier) has two qualities, estimated continuously:

- **Sensitivity** sᵢ: the probability that it rejects a wrong result;
- **Specificity** cᵢ: the probability that it validates a correct result.

This is the Dawid and Skene model (1979). It is estimated:

- first on **trap cells**, where the truth is known;
- then, on ordinary cells, with the EM algorithm, which estimates each one's reliability from agreements, without knowing the truth.

### 4.2 Wald's sequential test

k is no longer fixed. Guards are drawn **one at a time**, and the probability that the result is correct is updated:

```
log-odds ← initial log-odds (author reputation, difficulty, automatic verifier)
for each verdict:
    if "valid":     log-odds += log( cᵢ / (1 − sᵢ) )
    if "rejected":  log-odds −= log( sᵢ / (1 − cᵢ) )
stop when:
    log-odds ≥ log( (1 − α*) / α* )   → honey   (P(wrong) ≤ α*)
    log-odds ≤ log( ρ / (1 − ρ) )     → reject  (P(correct) ≤ ρ, ρ = 1% by default)
```

This is the Bayesian form of the sequential probability ratio test (Wald, 1945), where the log-odds is a sum of log-likelihood ratios. It reaches the target error rate with, on average, **the fewest checks possible**.

One limit to keep in mind: this calculation assumes verdicts that are **independent** once the truth is known. This is why model diversity (§4.4) and commit-reveal (§6.3) are not optional: they make this assumption realistic.

### 4.3 Worked example

**Starting data:**
- After the automatic verifier and the hidden tests, P(correct) = 0.9, that is odds of 9 (log₁₀ ≈ 0.95).
- Target: P(wrong) < 10⁻⁴, that is odds > 9,999 (log₁₀ ≈ 4).

**Results by guard reliability:**

| Guards | s / c | Weight of a "valid" (log₁₀) | Verdicts needed if everyone validates |
|---|---|---|---|
| New | 0.90 / 0.95 | 0.98 | **4** |
| Experienced | 0.95 / 0.98 | 1.29 | **3** |
| Expert | 0.99 / 0.99 | 2.00 | **2** |

**What to take away:**
- A single disagreement automatically triggers more draws.
- Easy cases cost little and doubtful cases get dug into.
- The guarantee holds in every case.

### 4.4 Safeguards

- **Floor.** At least 2 independent verdicts for every cell, even with expert guards *(parameter)*.
- **Diversity.** At least 2 model families among the verdicts.
- **Ceiling.** Beyond 9 verdicts without a conclusion, the cell is escalated: a wider jury, then the hive owner.

### 4.5 What is implemented (P0-4)

**Each guard's reliability** is tracked by two Beta laws (`src/coordinator/fiabilite.ts`):

- **sensitivity** s, measured on results known to be wrong: trap cells, and results exposed by the replay;
- **specificity** c, measured on validated results, and on rejections that the replay overturns.

The priors are those of a newcomer in the example of §4.3: Beta(9, 1), that is s = 0.90 on average, and Beta(19, 1), that is c = 0.95 *(parameters)*. Each new observation discounts the older ones by a factor of 0.995: this is gradual forgetting. Late reveals (§6.7) count too. The incomplete Beta function and its quantiles are computed with no dependency (Lanczos, continued fraction, bisection) and checked against closed forms.

**The weight of a "valid"** is log(c / (1 − s)), computed on the **lower bound** of each law, the 5% quantile (§5.3). A lucky newcomer stays cautiously weighted until they have proven themselves.

**Wald's test**:

- Each result that passes the automatic verifier starts from a log-odds of logit(0.9) *(parameter)*. Each revealed "valid" adds its weight.
- The result becomes honey when the log-odds crosses logit(1 − α\*), with at least the floor of 2 validations. α\* is 10⁻⁴ by default.
- The guard seats opened are those that guards of unknown reliability would need to cross the threshold. More reliable guards conclude sooner, and the extra seats close.
- Each validation publishes its log-odds and its probability of being wrong in the registry. Each verdict publishes its weight.

**What this gives:**

| Guards | Validations needed at α\* = 10⁻⁴ |
|---|---|
| Newcomers (lower bound of the priors) | **7** |
| Very reliable | **2**, the floor, never 1 |

This is more than the 4 in the example of §4.3, which used point values. The lower bound is the price of a cautious guarantee. A hive that accepts a greater risk tunes α\*: at 1%, 3 newcomers are enough, and the live demo, which has only 6 bees, uses that.

**In V0, a rejection is settled by the replay**, as before: either the result is wrong, or the guard made a mistake. Wald's test therefore governs the number of validations. The decrement "log-odds −= log(s / (1 − c))" will serve verification classes without deterministic replay.

**Escalation.** Beyond 9 verdicts without a conclusion, or after 2 hours of waiting *(parameters)*, the result goes to arbitration. No more guards are drawn. The hive owner decides with a public, reasoned decision (`arbitrage_valide` or `arbitrage_rejet`), and honey validated this way is marked as arbitrated.

**What the audit checks.** The check "Every honey cell reached the target error rate" **recomputes the log-odds of each honey** from the weights recorded with its verdicts alone, independently of the coordinator. It checks that P(wrong) ≤ α\*, that the floor is respected, and that the published log-odds matches. It counts separately the honey arbitrated by the hive owner.

**Known limits:**

- **The independence assumption** (§4.2) is strong in V0: guards rerun the same tests as the automatic verifier. Sealed verdicts (§6.7) and trap cells (§6.8) make it more realistic. Model family diversity (§4.4) is still to do, because verdicts do not declare their model yet.
- **The truth used for specificity** is the validation itself, a simplified version of the Dawid and Skene EM algorithm.
- **The initial log-odds** does not yet take into account the author's reputation or the cell's difficulty.
- **A small hive** that does not have enough eligible guards for α\* waits, then goes to arbitration.

---

## 5. Layer 3: incentives that make honesty pay (answers to F3 and F6)

### 5.1 Trap cells that cannot be told apart, made by mutation

*§5.1 and §5.2 are implemented: see §6.8.*

- Trap cells are no longer crude fakes. They are **mutants of real validated solutions**: same style, same length, one subtle bug.
- Every validated cell thus becomes an **endless source of realistic trap cells**.
- A guard cannot tell a trap cell from a real result, except by actually verifying.

### 5.2 Trap cells dosed by trust

- The trap cell rate is **individual**. It is high for newcomers and for suspicious profiles, low for very reliable guards (but never below 1%).
- This is not a penalty: it is the cheapest way to measure everyone.

### 5.3 A Bayesian reputation, with its uncertainty

- Each participant's reliability is a Beta(a, b) law, per caste and per verification class, with gradual forgetting (old results weigh less).
- **Decisions use the lower bound.** For eligibility, the 5% quantile of the Beta law is used, not its mean. A lucky newcomer stays cautiously ranked until they have proven themselves.

### 5.4 Rewarding the truth, even without knowing it

- **Verdicts with confidence.** Each guard states a probability ("95% correct") and not just a yes or a no. They are rewarded by a **proper scoring rule** (logarithmic score) when the truth is known, through trap cells, audits and hunters. Stating their true belief is then mathematically the best strategy.
- **Peer prediction.** On cells with no known truth, part of the reward depends on agreement with a randomly drawn guard, corrected so that a systematic "valid" earns nothing (Miller, Resnick and Zeckhauser, 2005). Laziness no longer pays.

---

## 6. Layer 4: a state that anyone can recompute (answers to F4, F5 and F9)

### 6.1 Full *event sourcing*

- **The registry becomes the source of truth.** Each signed object (hive, split, result, hashed deliverable, verdict, decision, draw request) is written to it in full.
- The state (cells, honey, shares, reputations, trophies) is now just a **pure function of the registry**.
- Anyone can run `kickswarm audit`: the command replays the whole registry from scratch, recomputes the state and checks that it matches, down to the hash, the one the coordinator publishes.

### 6.2 Invariants checked at all times

The auditor checks at every entry that:

- the Commons holds exactly 30% of the shares;
- the honey issued matches the validated work exactly;
- nobody verified their own work;
- every cell transition is allowed by the state machine;
- every signature is valid;
- every random draw follows from the public beacon.

A single violation, and the alert is public.

### 6.3 Randomness that nobody controls

- Draws use the **drand public beacon**, the one run by the *League of Entropy*: seed = hash(drand round randomness ‖ signed request). *Implemented: see §6.6.*
- **Commit-reveal.** Each guard first publishes the hash of their verdict, then the verdict. Nobody can copy the others or align with them. *Implemented: see §6.7.*

### 6.4 What is implemented (P0-1)

- **Each command is a transaction.** If it fails, the state and the registry roll back exactly: no phantom nonce, lease or event.
- **Each successful command is written in full** in a `commande` entry:
  - the signed objects received (requests, hives, splits, results and their deliverables, verdicts, decisions);
  - the frozen time of the command;
  - each random draw;
  - each coordinator signature;
  - each verifier report;
  - the hash of the resulting state.
- **`kickswarm audit`** (file, data folder or online coordinator) creates a fresh coordinator, **with no private key at all**, and replays the whole history. It requires every entry to be reproduced identically, down to the hash. It then checks that nobody verified themselves, that the honey earned equals the honey recorded, that the Commons holds 30% of the shares, and that the online coordinator's state is the replay's state.
- **`--reverify`** reruns the verifier on every deliverable. It is the only defense against a coordinator that would lie about test results, and it is tested: a lying verifier passes the replay but not the re-verification.
- **A coordinator refuses to start** if its state on disk does not match the hash announced by the last command in the registry.

**Known limits:**

- The auditor replays with the **reference code**. An independent auditor must therefore read this code, or implement it again from the spec.
- A random draw changed **with no effect on the course of events** is undetectable, but also harmless. Against an operator who would choose its draws to rig the assignment, the countermeasure is the drand public beacon (P1-3, §6.6): draws are recomputed there, and therefore verified.
- Deliverables live in the registry itself. Beyond a few thousand cells, hash-addressed storage alongside the registry will be needed.

### 6.5 Post-quantum cryptography (P0-5, implemented)

| Building block | Algorithm | Why |
|---|---|---|
| **Contributor identity** (`pq1:`) | **Hybrid Ed25519 + ML-DSA-65** (FIPS 204) | A signature is valid only if **both** are. One would have to break both the elliptic curve (exposed to Shor) and the lattice (the post-quantum bet). |
| **Coordinator and registry seals** (`slh1:`) | **SLH-DSA-SHA2-128f** (FIPS 205) | Its security rests **only on the hash function**. It is the most conservative choice there is. |
| **Registry, commitments, identifiers** | SHA-256 | Already resistant: Grover's algorithm leaves 128 bits of security. |
| Legacy identity (`ed25519:`) | Ed25519 | Still accepted, but flagged as non-post-quantum by the audit. |

**The design choices:**

- **A short identifier**: it is the **SHA-256 fingerprint** of the public keys. The signature carries the keys, which are checked against this fingerprint.
- **The exact type of each key is checked.** A weak key, Ed25519 for example, cannot pass itself off as an ML-DSA or SLH-DSA key, even if the fingerprint matches: algorithm substitution is impossible, and this is tested.
- **The registry is sealed at checkpoints**, like certificate transparency logs. A seal is the coordinator's SLH-DSA signature on the hash of the last entry; since this hash chains the whole history, a seal authenticates everything before it. The launch is sealed right away, then every 2 seconds or every 50 commands *(parameters)*.
- **The audit checks every seal and replays the history with the seals in place.** It reports how far the registry is sealed, and what share of contributor signatures is post-quantum.

**Measurements on the development machine** (Node 24, OpenSSL 3.5):

| Algorithm | Signing time | Signature size |
|---|---|---|
| ML-DSA-65 | 1 ms | 3.3 KB |
| SLH-DSA-SHA2-128f | 18 ms | 17 KB |
| SLH-DSA-SHA2-128s | 340 ms | 7.8 KB |

The 128s variant, too slow for frequent sealing, is ruled out.

**Known limits:**

- **Post-quantum signatures are heavy.** A hybrid request weighs about 7 KB and a cell signed by the coordinator about 23 KB. The registry grows fast: a key directory (register a key once, then sign without carrying it) and hash-addressed storage will come next.
- **Entries after the last seal** are guaranteed only by the chaining, until the next seal. The audit counts them.
- **"Mathematically unbreakable" does not exist for signatures.** SLH-DSA comes closest: breaking it requires breaking the hash function itself.

### 6.6 Draws that nobody chooses: drand (P1-3, implemented)

All of the coordinator's draws (a bee's caste, the cell it receives, the review it is given, the possible trap cell) happen during a work request. They now follow from the **drand quicknet public beacon** of the *League of Entropy*: every 3 seconds, independent organizations jointly produce a threshold BLS signature on the round number, and the randomness is the SHA-256 of that signature.

**The draw rule:**

- A request signed by the contributor at time `ts` is drawn with round **`tourA(ts) + 3`**, where `tourA(ts)` is the last round published at `ts`. This round is published **at least 6 seconds after the signature**: when signing, the contributor cannot know the randomness.
- **seed = SHA-256(round randomness ‖ hash of the signed request)**. The draws follow from it through SHA-256 in counter mode (53 bits per draw). Two bees that request in the same round get different draws.
- **The clock window is 4 seconds.** The coordinator refuses a request whose time differs from its own by more than 4 s. Since 4 s < 6 s, a request is always signed before its round is published. And a contributor who signs several requests to keep the one that suits them cannot do so: when the randomness appears, their requests have expired.
- **The coordinator chooses neither the round nor the seed.** The round follows from the time *signed by the contributor*, and the seed from the request itself.

**What the registry keeps and what the audit checks:**

- The launch announces the beacon: network, group public key, genesis, period and offset.
- Each request records the beacon used (round, randomness, BLS signature). On replay, the auditor **recomputes** the draws instead of copying them. It checks the BLS signature offline, with drand's public key alone, and checks that the round follows the rule.
- **Cheating on a draw, on the randomness or on the round makes the replay diverge**, even without the seals, and this is tested. A request drawn without a beacon when a beacon was announced fails the "Random draws from a public beacon" check.
- A private beacon, used for tests or offline work, follows the same scheme but the audit flags it: it does not come from the public network.

**In practice:** `kickswarm coordinator` uses drand by default and checks at startup that it can reach it; `--beacon none` falls back to internal draws, which the audit flags as non-public. `kickswarm demo live --beacon drand` shows a whole hive drawn by drand. Beacon values are fetched from several relays (api.drand.sh, drand.cloudflare.com…), always verified, and cached.

**Known limits:**

- **The coordinator can still drop a request.** It sees the randomness before answering: it could refuse a request whose draw it dislikes, and the contributor would sign another one. This censorship leaves no trace in the registry. It does leave one in the contributor's local log, which records every request and every refusal. Multiple auditors (§6.9), then federation, will make it visible.
- **Each work request waits for its round**, 6 to 9 seconds. This is negligible next to the time an AI spends working on a cell.
- **If drand cannot be reached**, the coordinator answers 503 instead of drawing on its own. Work stops rather than lose its guarantee.
### 6.7 Sealed verdicts: commit-reveal (P1-3, implemented)

Before, each verdict entered the public registry as soon as it was sent. The second guard could read the first one's verdict and copy it without verifying anything. Now a verdict is given in two steps.

1. **The commitment** (`osp.engagement/0.1`, `POST /v0/work/commit`). The guard sends, signed, only the hash of their verdict. The verdict carries a **salt of 32 random bytes**: without it, trying the three possible decisions would be enough to find the verdict behind the hash.
2. **The reveal** (`osp.verdict/0.1`, `POST /v0/work/verdict`). It is accepted only once **all the guard seats for the result are committed**. Before that, the coordinator answers `425 Too Early`. The revealed verdict must have exactly the promised hash: changing your mind after seeing the other one is impossible.

**The incentives:**

- **Staying silent costs more than being wrong.** A committed guard who does not reveal in time loses half their reputation (`facteur_non_revele` = 0.5, like validating a trap cell). This is worse than an overturned verdict (×0.9). Holding back a verdict that looks like a loser therefore never pays.
- **Revealing late is still judged.** If another guard gets the result rejected while their verdict is sealed, the guard reveals anyway. A "valid" on a wrong result is then overturned, a "rejected" is confirmed.
- **The reveal window runs only while it is open.** A guard is never penalized because another one is slow to commit. If a seat frees up (abstention, expired lease, overturned rejection), the reveal closes until a new guard commits.
- **A trap cell follows exactly the same path.** Commitment, then reveal. A guard cannot recognize a trap cell from the procedure before they are committed. Once committed, knowing is of no use to them.
- **A sealed verdict no longer ties up a bee.** The guard can take another task in the meantime.

**On the contributor side:** the plugin writes the sealed verdict to disk (`~/.kickswarm/verdicts-scelles.json`, salt included) before sending the commitment. It reveals it on its own as soon as the reveal opens, on every tool call and in the background every 3 seconds. The local log records the commitment, then the reveal.

**What the audit checks.** A new check, "Guards committed to their verdicts before any was revealed", recomputes from the signed objects alone that each revealed verdict matches a signed commitment, recorded before it, with a salt of the right length. It also counts the commitments never revealed (penalized) and those still sealed. The replay also enforces the opening rule: no verdict revealed while another guard on the same result was still deciding. Removing a commitment from the registry makes the audit fail, and this is tested.

**Known limits:**

- **The coordinator sees the commitments, not the verdicts**, but it knows the automatic verifier's result. The commitment protects guards from each other, not from a coordinator that would whisper the answer to them.
- **After an abstention**, the guard drawn as a replacement sees the verdicts already revealed for that result. This happens only if a guard abstains, and every abstention is recorded in the registry.

### 6.8 Trap cells that cannot be told apart (P0-3, implemented)

**The assessment.** The MVP made crude trap cells, and the public registry added more ways to recognize them. A guard could spot a trap cell in five ways, without verifying anything:

1. the deliverable returned `'__piege__'`;
2. the result was signed by the "trap cells" identity, announced at launch;
3. the live view displayed a `piege` field;
4. the trap cell often targeted a cell that was not waiting for any verification;
5. above all, since the registry is public and replayable in real time, it was enough to replay it, or to recompute one's own drand draw, to see the trap cell before committing.

**What is done:**

- **A trap cell is a mutant of the real pending delivery.** When a deliverable passes the automatic verifier, the coordinator tries up to 8 of its mutants *(parameter)* with only the checks that guards rerun: visible tests and property-based tests, without the hidden tests. It keeps those that guards reject and that still pass some of the tests, from most subtle to least subtle. A trap cell therefore has the style, length and names of the real code, with a single bug. Nothing crude: only real verification exposes it.
- **It takes the place of the real one, on the same cell.** When a guard is drawn to verify a result, they receive, with a probability specific to them, a mutant of that result instead. The trap cell takes a guard seat, with the same lease, and the guard appears in the public view like the others. As long as their trap cell is open, they do not receive the real deliverable.
- **Verification is anonymous.** A guard receives the cell, the deliverable and an opaque identifier to quote in their verdict. Neither the author nor the signed result. It is also fairer: the work is judged, not the person.
- **The rate is individual** (§5.2). It is `taux_pieges` (10%) for a newcomer and drops with reputation, never below 1% *(parameters)*.
- **The trap cell draw comes from secret randomness.** It does not follow from the drand beacon, which a guard can recompute. It comes from a cryptographic generator and is recorded separately (`alea_secret`) in the command. The other default draws are now cryptographic too: published after the fact, they must not make it possible to guess the next ones.
- **Registry contents are published under embargo.** While a result is waiting for its guards, its submission and everything after it stay under embargo. Otherwise a guard would compare the deliverable they received with the published deliverable. The embargo lifts as soon as the result is settled, and after 2 hours at the latest *(parameter)*. Past that delay, the result no longer serves as a template for trap cells.
- **The registry head, however, stays public in real time.** `GET /v0/state-hash` gives the index and hash of the last entry, with the last SLH-DSA seal, alongside the published horizon and the state that follows from it. Since the head chains everything before it, an observer who notes it would see any rewriting of what is still under embargo.
- **The public board no longer cites the source result** of a dead end, for the same reason.

**What the audit checks:**

- The replay recomputes each trap cell: the mutants are reproduced identically (the engine is deterministic), the rate follows the reputation at that moment, and the choice comes from the recorded secret draws. Removing a secret draw, or falsifying a mutant's report, makes the audit fail, and this is tested.
- A new check, "Trap cells drawn at each guard's announced rate", compares the number of trap cells with its expected value (the sum of the announced rates). It fails beyond 4 standard deviations: a coordinator that overused trap cells, or spared a friendly guard, would be seen.
- `--reverify` also reruns each mutant prepared as a trap cell with the guards' checks.
- `kickswarm audit --url` audits up to the published horizon and reports how many entries remain under embargo.

**Known limits:**

- **The embargo delays transparency**, typically by the length of one verification. The full replay of an entry waits for the end of its embargo. What is under embargo stays committed by the public head and by the seals.
- **The coordinator still chooses the secret randomness.** It could target or spare a guard, but the statistical check exposes it as soon as the gap becomes noticeable. Seeds committed in advance, then revealed, would remove even this margin.
- **A trap cell exists only if the visible tests kill at least one mutant.** This is the case as soon as the tests are strong enough (P0-2). Otherwise, that result gets no trap cell.
- **Two guards who collude** can compare their deliverables. This is collusion, handled by proof of unique personhood (P3).

### 6.9 Several auditors, then several coordinators

- **Step 1:** independent auditors (communities, universities, the foundation) replay the registry continuously and publish their state hash.
- **Step 2:** federation. Several coordinators share the registry and verify each other. There is no longer a single point of trust.

---

## 7. Layer 5: projects that structure themselves (answer to F7)

### 7.1 Contract first

A split is valid only if it is **consistent with its parent**:

- each child declares its interface: its functions, their types and its tests;
- the split provides an **assembly plan**;
- the verifier makes sure that a mock assembly, built from the children's reference implementations, **passes the parent's tests**.

This way, a split that cannot succeed is rejected before it has cost a single hour of agent time.

### 7.2 Competing splits, judged on the evidence

- **Several scouts** each propose their own split.
- **Ranking.** Each split is scored on:
  - the mutation score of its tests;
  - the independence of its children;
  - the estimated cost;
  - the success history of similar splits.
- **Adoption** uses Thompson sampling (already in place, §12 of v0.1), with the option of switching to an archived split if the branch stalls.

### 7.3 A memory that learns

- **Winning split patterns** become *playbooks*, reused by the scouts of similar hives: "for a library, split by module, property-based tests on every pure function".
- **Cost and difficulty estimation** learns from every finished cell. It automatically sets:
  - each cell's budget;
  - the verification level;
  - the reward: an easy cell earns less, which kills "farming".

---

## 8. Layer 6: a swarm that secures itself

| Area | Measure |
|---|---|
| **Execution** | A sandbox ladder: process → WebAssembly (done, default everywhere) and container (done, on request) → gVisor or Firecracker micro-VM for the public coordinator. seccomp profiles, no network, quotas. *See §8.1.* |
| **Supply chain** | Pinned lockfiles, signed releases (Sigstore), build provenance (SLSA), dependency audit on every release. |
| **The swarm's own code** | A **permanent security hive**, where the swarm reviews, tests and fuzzes its own code. Continuous fuzzing of the verifier and the API. Public bug bounty. |
| **Abnormal behavior** | Detection on the registry: throughput spikes, pairs of guards that always agree, especially on missed trap cells (a sign of collusion), reputations that rise too fast. Automatic quarantine and human review. |
| **Prompt injection** | Capsules signed and marked as data, strict-schema outputs, no tools outside the swarm for the agent, canary tokens. For future V2 judgments, the quarantined-LLM pattern: the model that reads untrusted content has no power to act. |
| **Formal methods** | The cell state machine and the economic rules are specified in **TLA+** and verified by model checking, on top of property-based tests on the invariants. |
| **Governance** | Proof of unique personhood before any vote, to fix F8. In the meantime: one vote per verified contributor, weighted by trophies that cannot be bought. |

### 8.1 The WebAssembly sandbox (implemented)

**The problem.** Guards run code written by strangers on their own machine. Without Docker, which is the case for most people, the verifier used a Node process with the permission model: disk reads were restricted, but **the network stayed open**.

**The solution.** By default, tests run in **QuickJS compiled to WebAssembly** (`quickjs-emscripten`, pinned version):

- **A fresh engine for each run**, in a disposable thread that stops and takes all its memory with it.
- **What the code under test finds**: the JavaScript language, and the deliverable's files as modules. Nothing else: no network, no disk, no processes, no Node or browser API. This is not a ban that could be bypassed: these functions do not exist in the engine.
- **What is bounded**: memory (256 MB), stack (1 MB) and time. At the deadline, an interrupt stops even an infinite loop, and the code cannot catch it. The thread itself is bounded and stopped if it goes over.
- **Nothing to install**: the engine is part of the package.

**Frozen primitives, in every mode.** While preparing this work, a flaw turned up in the existing Node runner. It captured `JSON.stringify` and a few other tools before loading the deliverable, but not everything. A deliverable could rewrite `Array.prototype.push`, `Object.prototype.toJSON` or `Array.prototype.every`, and the report, or a property's expression, would have used these rigged versions. Now both runners freeze all JavaScript built-in objects, prototypes included, and lock their global names before loading the code. As in SES, the names that ordinary code reassigns on its own objects (`toString`, `name`, `message`, `constructor`…) stay reassignable on instances.

**What is tested:**

- no network API exists, and no import (`http://`, `node:http`, `node:net`) reaches a local server that counts connections;
- no system module and no file outside the deliverable loads;
- the infinite loop, the memory bomb and endless recursion are stopped cleanly;
- five tampering attempts on the runner and on properties fail, in WebAssembly as in process mode;
- ordinary code still works: error classes, custom `toString`, `console.log`, multi-file modules, async functions;
- the same deliverable gives the same report, down to the detail.

**One engine for everyone.** WebAssembly is the default sandbox **everywhere**, whether Docker is installed or not. The coordinator, guards and auditors run the same pinned version of QuickJS, so a deliverable gets the same verdict on every machine. Before, a machine with Docker ran V8, another QuickJS, and they could diverge on an edge case: an honest guard would then have been penalized wrongly. The container (V8) stays available on request (`--sandbox container`) for heavy computation. Process mode is used only on request, and a coordinator refuses to open beyond `localhost` in that mode. Starting QuickJS takes a few milliseconds, against about a second for a container: the many small runs (mutants, trap cells) benefit.

**Known limits:**

- **QuickJS computes more slowly than V8** on heavy code, because it is an interpreter. A demanding task can exceed its time limit: its hive will then ask for the container. QuickJS does not have `Intl` (locale-aware formatting), and a deliverable that depends on it fails.
- **QuickJS only does JavaScript.** Future verification classes in other languages will need containers.
- **No timers** (`setTimeout`) and no input-output in the sandbox. Code that depends on them fails, which is intended for a V0 deliverable.
- **Importing a JSON file** is accepted as is by QuickJS, whereas Node requires `with { type: 'json' }`.

---

## 9. The self-reinforcement loop

```
          ┌──────────────── every registry event ────────────────────┐
          ▼                                                           │
   Bayesian update:                                                   │
   contributor reliability, task difficulty,                          │
   playbook quality, measured error rate                              │
          │                                                           │
          ▼                                                           │
   Automatic regulation:                                              │
   number of verdicts (Wald), trap cell rate, audit rate,             │
   rewards, budgets, choice of splits                                 │
          │                                                           │
          ▼                                                           │
   Hunters and audits: every counterexample becomes a                 │
   permanent test; every flaw found strengthens the swarm ────────────┘
```

Every error detected leaves the swarm stronger than before. That is the exact meaning of "self-reinforcement".

---

## 10. The plan, by priority

| Priority | Work item | Flaws fixed | Size |
|---|---|---|---|
| **P0-1** ✅ | **Full registry and `kickswarm audit`**: complete signed objects, replayed state, checked invariants. *Done: see §6.4.* | F4, and the basis for everything else | Medium |
| **P0-2** ✅ | **Hidden tests + mutation score + property-based tests** in the V0 verifier. *Done: see §3.6.* | F1 | Medium |
| **P0-3** ✅ | **Mutation trap cells** and individual trap cell rate; anonymous verification, secret randomness and registry embargo so they stay indistinguishable. *Done: see §6.8.* | F3 | Medium |
| **P0-4** ✅ | **Beta reputation and Wald's test** instead of k = 2 (with a floor of 2). *Done: see §4.5.* | F2, F6 | Medium |
| **P0-5** ✅ | *Done: see §6.5.* **Post-quantum signatures**: hybrid Ed25519 + ML-DSA-65 identities (FIPS 204), coordinator and registry signed with SLH-DSA (FIPS 205, security based on hash functions alone). Node 24 provides them natively. | Quantum threat to Ed25519 | Medium |
| **P1-1** | **Hunter caste** and counterexample bounties | F1, self-reinforcement | Medium |
| **P1-2** | **Contract first** for splits, and competing splits | F7 | Large |
| **P1-3** ✅ | **drand and commit-reveal** for verdicts. *Done: see §6.6 and §6.7.* | F5 | Small |
| **P1-4** | **N-version programming** for critical cells | F1 | Medium |
| **P2-1** | Verdicts with confidence, logarithmic score, peer prediction | Incentives | Medium |
| **P2-2** | gVisor or Firecracker sandbox, Sigstore, SLSA, fuzzing, security hive | Security | Large |
| **P2-3** | TLA+ specification and model checking | Proof | Medium |
| **P3** | Independent auditors, then federation; proof of unique personhood | F8, F9 | Large |

**Why this order.**

- **P0-1 first**, because a replayable state is the condition for everything else to be verifiable, including by our critics.
- **P0-2 next**, because it is the most serious flaw: without solid tests, all verification is an illusion.
- **P0-3 and P0-4 turn** "two guards" into a **numerical, measured guarantee**.

At the end of phase P0, each hive's page can honestly display: *"Measured false honey rate: < 1 in 10,000 (95% CI), verifiable by anyone with `kickswarm audit`."* Few open source projects in the world can write such a sentence.

---

## References

- A. Wald, *Sequential Tests of Statistical Hypotheses*, 1945.
- A. P. Dawid and A. M. Skene, *Maximum Likelihood Estimation of Observer Error-Rates Using the EM Algorithm*, 1979.
- R. DeMillo, R. Lipton and F. Sayward, *Hints on Test Data Selection*, 1978 (mutation testing).
- A. Avižienis, *The N-Version Approach to Fault-Tolerant Software*, 1985.
- N. Miller, P. Resnick and R. Zeckhauser, *Eliciting Informative Feedback: The Peer-Prediction Method*, 2005.
- D. Prelec, *A Bayesian Truth Serum for Subjective Data*, 2004.
- L. Lamport, *Specifying Systems* (TLA+), 2002.
- The drand public randomness beacon (League of Entropy), Sigstore, SLSA, gVisor, Firecracker.
