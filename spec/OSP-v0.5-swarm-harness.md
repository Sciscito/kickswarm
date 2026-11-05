# OSP v0.5: the swarm harness

**Design proposal · status: draft, nothing implemented yet · builds on [OSP-v0.1](OSP-v0.1.md), [OSP-v0.2](OSP-v0.2-trust-engine.md), [OSP-v0.3](OSP-v0.3-harness.md), [OSP-v0.4](OSP-v0.4-universal-engine.md) and [docs/security.md](../docs/security.md)**

> **A harness of harnesses. Each person lends the agent they already pay for, through its official tool, unattended and within its rules. The swarm draws the work, seals it, verifies it, learns from every result, and gets better on its own, without ever touching its own rules of trust.**

| | |
|---|---|
| Status | Draft, under discussion; H1 implemented (§10.1) |
| Date | 5 November 2026 |
| Scope | Unattended contribution with subscriptions through official agents; hives on GitHub; sealed, interaction-free work; a living pool; self-organization and self-optimization within fixed rules |
| Version slot | v0.4 moved federation to v0.5. This proposal takes v0.5 for the swarm harness and moves federation to v0.6. This change needs a published decision (v0.1 §14.6) |
| First milestone | A contributor forks a hive once, adds two secrets, and their Claude Pro subscription takes a drawn task every few hours, unattended, through the official Claude Code Action; the result is verified, merged, and earns honey, without anyone touching a keyboard |

---

## 0. How to read this document

- RFC 2119 words (**MUST**, **SHOULD**, **MAY**) and *(parameter)* have the same meaning as in [OSP-v0.1 §0](OSP-v0.1.md).
- New identifiers are written in English. Existing ones keep their French names until the rename (v0.3 §11).
- Facts about providers' products come from their official documentation, read on 5 November 2026 (§11). They change often: each adapter (§2.3) MUST be checked against the provider's current documentation before it ships, and again at every release.

---

## 1. The idea

### 1.1 Three floors

A **harness** is the software around a model: tools, memory, execution, guardrails. Claude Code, Codex, Jules, Copilot, OpenHands and Goose are harnesses: each equips one model for one person.

Kickswarm is a harness one floor up: it equips a **swarm** of models and people.

| Floor | Job | Who builds it |
|---|---|---|
| 1. The swarm | Plan, draw tasks, route each task to the right kind of model, verify, learn, keep the registry | Kickswarm (the coordinator, v0.1 to v0.4) |
| 2. The executors | Do one task, in one pass, in a sandbox | The existing harnesses: official agents for subscriptions (§2.3), an open source harness for API keys and local models (§2.7) |
| 3. The adapters | Turn a Kickswarm task into what each executor takes, and bring the result back | Kickswarm (the plugin, the doors of v0.4, and the runner of §2) |

Kickswarm **MUST NOT** rebuild what floor 2 already does well. Every improvement of an existing harness reaches the swarm through its adapter, at no cost.

### 1.2 Habits change, the immune system does not

The swarm adjusts on its own whatever makes it work better: which model gets which task, how small tasks are cut, how often traps come, which instructions work best (§6, §7). It **MUST NOT** adjust on its own whatever makes it trustworthy:

- the verification (tests, hidden tests, guards, traps, Wald's test, α\*);
- the signatures and the registry;
- the audit.

These change only through a published decision (v0.1 §14). This is the **constitution** of the swarm.

### 1.3 Why verification is the real defence

A contributor controls their own machine and their own fork. They can always change a prompt there, or let an injection through. The protocol detects what it can (§3), but it does not depend on it: **a wrong result fails the hidden tests and the guards, whatever the prompt said.** An injection can make an agent write anything; it cannot make that anything pass for correct work.

---

## 2. The runner: contributing with a subscription, unattended, within the rules

### 2.1 The rule we design around

Subscriptions (Claude Pro or Max, ChatGPT, Google AI) may be used only through the provider's own products. Anthropic states that subscription OAuth tokens may not be used "in any other product, tool, or service", and its consumer terms forbid automated access except with an API key "or where we otherwise explicitly permit it" (§11).

So the runner never touches a subscription itself. **It asks the provider's own agent to do the work, through the automation that provider offers for it.** Where a provider offers no such automation for subscriptions, the subscription is not automated (§2.6).

### 2.2 Where the runner lives

A contributor **forks the hive's repository once** and enables a workflow from a template the hive provides: `.github/workflows/kickswarm-runner.yml`. The runner is that workflow. It runs on GitHub's machines, triggered on a schedule the contributor chooses (`on: schedule`), so nothing runs on the contributor's computer and nothing needs them present.

The same runner MAY run elsewhere: `kickswarm bee` on the contributor's own machine (v0.4 §2.6), with the executors of §2.7.

### 2.3 The executors

| Executor | Credential | Unattended start | Status |
|---|---|---|---|
| Claude Code Action | A Pro or Max OAuth token made by the contributor with `claude setup-token`, or an API key | Yes: a scheduled workflow or an `issues: opened` event, with an explicit prompt, in a repository the contributor administers (their fork) | Usable |
| Jules | A Jules API key from the contributor's Jules settings; their plan sets a daily task quota (15, 100 or 300); whether API sessions count against it is to be confirmed | Yes: `POST /v1alpha/sessions` with the prompt, the fork as source, `AUTO_CREATE_PR` | Usable; the API is labelled `v1alpha` |
| GitHub Copilot cloud agent | The contributor's own user token (fine-grained, read and write on contents, issues, pull requests, actions) | Yes: assign an issue to `copilot-swe-agent[bot]` through the REST or GraphQL API, with `target_repo` = the fork | Usable; the API is in public preview |
| Codex with a ChatGPT plan | — | No: a cloud task starts from a person's click or `@codex` comment | Manual only (§2.6) |
| codex-action, OpenHands, Goose, Gemini CLI | An API key, a free key, or a local model | Yes: they run inside the workflow | Usable (§2.7) |

An adapter **MUST** use only the start mechanism its provider documents, with the contributor's own credential, on the contributor's own fork. It **MUST NOT** relay, store or proxy a subscription credential anywhere else: credentials live in the fork's GitHub secrets, read only by the executor's own step.

### 2.4 Three jobs, three sets of secrets

The workflow is split so that the agent never sees the contributor's Kickswarm key, and the steps that talk to the coordinator never see the agent's credential:

1. **`draw`.** Holds the **runner key** (§2.5). Claims a task from the coordinator, verifies the coordinator's signature on the sealed card (§3.2), and passes the card to the next job as an artifact.
2. **`work`.** Holds only the executor's credential. Checks out the fork at the card's commit, runs the executor once with the card as its whole prompt (§3.3), and saves the files it changed as an artifact. The job has read-only repository permissions; the executor's own sandbox applies.
3. **`submit`.** Holds the runner key. Reads the artifact, signs the result, opens the pull request to the hive's repository, and hands the result to the coordinator with the commit's hash.

### 2.5 The runner key

A contributor's main identity stays on their machine. For the runner they make a **runner key**: a separate hybrid identity, with a delegation the main identity signs:

```json
{ "type": "osp.delegation/0.5", "main": "pq1:…", "runner": "pq1:…",
  "hive": "<slug>", "share": { "per_day": 5 }, "expires": "2027-02-05T00:00:00Z" }
```

- Its scope is one hive, a daily share, and an expiry (90 days at most) *(parameter)*.
- Honey, reputation and trophies go to the main identity.
- The main identity revokes it with one signed decision, written to the registry. A leaked runner key costs at most one hive's share until revoked.

### 2.6 The share, and what stays manual

- **The share.** The contributor chooses how much of their quota goes to the swarm: a number of tasks per day, and a schedule. The default is modest: 3 tasks a day *(parameter)*. The coordinator refuses claims beyond the delegation's share.
- **Ordinary use.** Subscriptions come with usage limits and assume ordinary, individual use. The template's defaults stay well inside them; the hive's page says so before anyone enables a runner.
- **What stays manual.** Codex with a ChatGPT plan, and every chat app, are used by hand through the chat door (v0.4 §2.3). That is not a failure: a person with a phone and five minutes is a bee.

### 2.7 The open harness for keys and local models

For API keys, free keys and local models, the runner embeds an open source harness instead of writing its own agent loop. The candidate is chosen by three criteria: a permissive license, a one-shot non-interactive mode, and a way to cut its network and shell. OpenHands (MIT), Goose and Gemini CLI (Apache 2.0) are the first to evaluate. The engine's model pool (v0.4 §2.6) stays the way it picks the model.

---

## 3. Sealed work: no choice, no tampering, no interaction

### 3.1 Nobody chooses their task

A runner asks for work; it does not pick it. The coordinator draws the task and the role from the public drand beacon (v0.2 §6.6), as it does today, and writes the draw to the registry. A runner MAY state what it can do (its executor, its model tier, its languages, §5.1); it MUST NOT name a cell.

### 3.2 The sealed card

What the runner receives is a **sealed card**: the task card of v0.4 §3, rendered for its executor, and signed by the coordinator:

```json
{ "type": "osp.sealed-card/0.5", "cell": "<hash>", "lease": "<hash>",
  "executor": "claude-code-action", "prompt": "…", "prompt_hash": "sha256:…",
  "base_commit": "<sha>", "write_scope": ["src/…"], "expires": "…",
  "coordinator": "slh1:…", "sig": "…" }
```

- The prompt's hash is written to the registry with the lease.
- The result **MUST** carry `prompt_hash`. The coordinator refuses a result whose hash differs from the lease's, or whose files leave `write_scope` (v0.3 §3.2).
- A contributor can still change the prompt inside their own workflow. Nothing prevents it; §1.3 says why it does not matter.

### 3.3 One pass, no interaction

- The executor runs **once**, with the sealed prompt as its whole instruction, and no conversation. The work job takes no input from issues, comments or anyone's messages.
- When an executor needs an issue as its starting point (Copilot), the runner opens it in the fork with the sealed prompt as its body. The submit job checks that the issue was not edited and has no comment from a person between its creation and the pull request; otherwise the result is not submitted, and the lease is released.
- A run that asks a question, waits for approval, or stops half-way is a failed run: the lease is released, with no penalty for the first time *(parameter)*.

### 3.4 What an injection can and cannot do

The capsule and the files read stay framed as data in every card (v0.1 §8.4). On top of that:

| An injection tries to… | What stops it |
|---|---|
| Make the agent write wrong or malicious code | Visible and hidden tests, guards, traps (v0.2); the sandbox when it runs (v0.2 §8.1) |
| Steal the contributor's Kickswarm key | The work job does not have it (§2.4) |
| Steal the executor's credential | The executor's own sandbox and permissions; the template gives the work job read-only repository rights and no other secret. This risk is the executor's own and stays a risk (§9) |
| Reach the contributor's computer | The runner runs on GitHub's machines or in the provider's cloud, not on the contributor's computer |
| Change other files of the hive | `write_scope`, checked by the coordinator and by the bridge (v0.3 §3) |

---

## 4. Hives on GitHub

A hive MAY live on a GitHub repository, as in v0.3 §3, with GitHub doing the hosting:

- **The repository** holds the code, the visible tests, the runner template and a `kickswarm.json` that names the coordinator.
- **Pull requests** carry results. GitHub Actions runs the visible tests on them, free for public repositories, as a convenience for readers; it is never the verdict.
- **The verdict** stays with the coordinator: hidden tests, guards, traps, Wald's test. Hidden tests cannot live in a public repository, so the coordinator keeps them (v0.2 §3).
- **Issues** MAY mirror cells, for people who browse; they carry no instruction a runner obeys.
- **Merging** is done by the bridge (v0.3 §3.3) for results the coordinator validated, with the author as co-author.

What still needs a server: the coordinator, small and cheap, because it holds the hidden tests, the registry and the draws. A load test on one 8-core desktop held a thousand active agents (October 2026); a free Oracle instance is the first target.

---

## 5. The living pool

### 5.1 Who is in the pool

Each runner, or door, declares a **profile** (v0.4 §4.1), signed by its key: the executor, the model and its tier, the languages, the share. A runner that has not claimed for 3 days *(parameter)* leaves the pool's estimates; it comes back with its next claim.

### 5.2 Keeping it current

- **Leases.** A claimed task not handed in before its lease ends goes back to the draw (v0.1). The lease length follows the executor's measured time: the 90th percentile of its recent runs, between 10 minutes and 6 hours *(parameter)*.
- **Liveness.** Each runner's ratio of tasks handed in to tasks claimed is measured. Under 50% over its last 10 claims *(parameter)*, it gets only small tasks until it recovers.
- **Capacity.** The coordinator sums the pool's declared shares and measured pace per tier. The dashboard's simulator (v0.4) and the splitting of §6.2 use this estimate.

---

## 6. Self-organization

### 6.1 Tiers

Every cell states the tier it needs, and every profile the tier it offers *(parameter: tier list)*:

| Tier | For | Examples of models |
|---|---|---|
| `frontier` | Splitting a goal, assembling, arbitrating, writing hidden tests | The best model of each provider |
| `standard` | Writing a module of moderate size | Mid-range models |
| `economy` | Writing a small, well-tested function | Free and low-cost models, local models |
| `none` | Verifying | No model: the guard replays tests (v0.4 §2.4) |

Splitting cells keep the tier of their scout's request; writing cells start at `economy` unless the scout asks for more.

### 6.2 The cascade

A cell first goes to the tier it states. After 2 verified failures at a tier *(parameter)*, it moves up one tier. After a failure at `frontier`, it goes back to a scout to be split more finely. The swarm thus pays for strong models only where they are needed, and cuts work down to what small models can do.

### 6.3 Honey follows difficulty

The honey of a cell is multiplied by its tier: ×1 for `economy`, ×2 for `standard`, ×4 for `frontier` *(parameter)*. Contributors with the best models then keep them for the tasks that need them.

---

## 7. Self-optimization

### 7.1 The loop

Every verified result says which kind of model succeeded or failed at which kind of task, in how long. The swarm learns from it, then adjusts:

```
draw → work → verify → record → learn → adjust → draw …
                                        ▲
              the constitution (§1.2): never adjusted by the loop
```

### 7.2 Routing that learns

- Each pair (task class, model) has a Beta distribution of its success, updated by verified outcomes, with the forgetting factor of v0.2 §4 *(parameter)*. A task class is the verifier and language, the role, and a size bucket.
- When several profiles could take a cell, the draw weighs them by **Thompson sampling**: one value drawn from each pair's distribution, divided by the tier's cost. Good and cheap models get more work; unproven ones still get a share, so they can prove themselves.
- The random values come from the drand beacon, as every other draw, so the audit replays the routing exactly.

### 7.3 Adjusted parameters

| Parameter | Adjusted from | Bounds |
|---|---|---|
| Starting tier of a task class | Its measured success at `economy` | Never above `frontier`, never below `economy` |
| Size of writing cells | The failure rate per size bucket | Between the hive's minimum and maximum cell size |
| Lease length | Measured run times | 10 minutes to 6 hours |
| Individual trap rate | Already adaptive (v0.2 P0-3) | The floor of v0.2 |
| Playbook variant | A/B comparison (§7.4) | Only variants approved by the hive owner |

### 7.4 Instructions compared in the open

A playbook (v0.3 §3.6) MAY have variants, each approved by the hive's owner. Cells draw a variant at random; the variant that gives more verified success at equal cost becomes the default after 200 cells per variant *(parameter)*. The comparison is computed from the registry, so anyone can check it.

### 7.5 Every adjustment is a command

- Each adjustment is a deterministic function of the registry and the beacon. It is written to the registry as a command, with its inputs, and the audit recomputes it.
- No adjustment may change anything listed in §1.2. An implementation that does fails the audit.
- An owner MAY freeze any adjustment for their hive.

---

## 8. Infrastructure and cost

| What | Who pays | Cost |
|---|---|---|
| The models' work | Each contributor, within their own plans and keys | Nothing for Kickswarm |
| The runners | GitHub Actions on public forks | Free for public repositories, within GitHub's terms |
| Code, tests, pull requests, the hive's site | GitHub | Free for public repositories |
| Verifications | Guards' browsers and machines | Nothing for Kickswarm |
| The coordinator | The hive's host: a creator (v0.4 hosting) or us | One small server; free on Oracle |

---

## 9. Risks and open questions

- **Providers' terms change.** Each adapter follows its provider's documented automation and nothing else (§2.3). Kickswarm SHOULD seek a written agreement with each provider for unattended contribution to public-interest hives.
- **Forks of other people's repositories.** No provider's documentation addresses automation on a fork of a repository owned by someone else. The fork is the contributor's own repository, which is what these products work on; this needs confirmation from each provider.
- **GitHub's own rules.** Scheduled workflows in forks must be enabled by their owner, and GitHub disables schedules in inactive repositories. Automated pull requests must stay within GitHub's acceptable use: small, real, verified contributions, a modest default share, and no pull request for a result the coordinator did not validate.
- **The executor's credential.** It sits in the fork's secrets and the agent runs with it. A prompt injection that reaches the executor's own tools could misuse it within that executor's permissions. The template uses the narrowest permissions each executor allows; this risk is documented on the hive's page.
- **Preview APIs.** Jules (`v1alpha`) and Copilot's assignment API (public preview) can change without notice.
- **Refused tasks.** When an executor refuses a task, the refusal is recorded and the cell goes to the hive's owner. It is **never** routed to another model to get around a provider's rules.
- **Learning on small numbers.** The routing of §7.2 starts from priors and needs volume; until then the tiers of §6.1 do the work.

---

## 10. Order of work

| Step | What | Done when |
|---|---|---|
| H1 | Tiers and the cascade (§6) | A hive finishes with most cells done at `economy`, and the cost per cell is measured |
| H2 | Sealed cards and runner keys (§2.5, §3.2) | A result with a different prompt hash, or from a revoked runner key, is refused, and the audit shows why |
| H3 | The GitHub runner with Claude Code Action (§2.2 to §2.4) | The first milestone of this document |
| H4 | Jules and Copilot adapters | One task each, unattended, verified and merged |
| H5 | Routing that learns (§7.2) and adjusted parameters (§7.3) | The audit recomputes every adjustment from the registry |
| H6 | The open harness for keys and local models (§2.7) | A free model takes a task in the runner with no network and no shell |

Federation of coordinators moves to v0.6.

### 10.1 What is implemented (H1)

- **Tiers** (`Tier`: `economy`, `standard`, `frontier`). A cell spec MAY ask for a starting tier, which goes into the signed cell. Without one, a writing cell starts at `economy`; splitting and assembling need `frontier`, and so does a cell sent back to a scout. A claim MAY state the bee's best tier; it then gets only cells that tier can do. A claim that states none takes anything, as before, so agents and chats keep working unchanged.
- **The cascade.** After `rejets_par_niveau` failures at a tier (2), a writing cell moves up one tier (`niveau_releve` in the registry); after one failure at `frontier`, it goes back to a scout (`redecoupage`, with `apres: frontier`). With tiers, this replaces the rule of v0.1 §5 (three rejections, then a scout).
- **What counts as a failure.** A rejected result, and also a release that says `echec: true`: the bee tried and could not do it. Without that, a cell that cheap models cannot do would be given back in silence, again and again, and never move up. A false `echec` can only move a cell to a stronger, better-paid tier.
- **Honey by tier** (`miel_par_niveau`: ×1, ×2, ×4) for writing and assembling cells, and for their guards' share; the validation records the tier.
- **The doors.** The local engine states the tier of what its pool can lend (a subscription's official tool: `frontier`; a paid key: `standard`; free and local models: `economy`) and releases with `echec` when its models could not do a task. The chat page shows how strong an AI a task needs.
- **Old registries.** The version (`niveaux`) is written in the launch entry. A registry that does not announce it replays without tiers, exactly as before; a cell spec with a tier is refused there.
- Tests: `test/niveaux.test.ts`.

### 10.2 What is implemented (H2)

- **Sealed cards.** A claim MAY name its `executor` (a short name: `claude-code-action`, `jules`…). It then gets only writing work (worker or builder), and the assignment carries a sealed card signed by the coordinator. The prompt is rendered from the cell alone by `src/protocol/carte.ts` (prompt version 1): the rules of one pass, the goal, the files to write, the visible tests and properties, the parts to assemble and the context, each piece of data framed as data. That text is part of the protocol and does not change; a new rendering will be a new version, written at launch.
- **The lease.** The prompt's hash is written to the registry with the lease (`bail_scelle`). A result under a sealed lease MUST carry the same `prompt_hash`, or it is refused; a result under an ordinary lease MUST NOT carry one.
- **Runner keys.** `POST /v0/runners` takes a delegation signed by the main identity (`osp.delegation/0.5`: `main`, `runner`, `hive`, `share.per_day`, `expires`). The runner key must be fresh (it has never worked on its own), cannot delegate in turn, lasts 90 days at most (`runner_duree_max_ms`), and its daily share is 1 to 50 tasks (`runner_part_max`). `GET /v0/runners/<main>` lists a main identity's keys.
- **What a runner key may do.** Claim only in its hive, only with an executor (so only from sealed cards), only writing work, and within its share for the current UTC day. Honey, reputation, reliability, trophies and membership go to the main identity; neither the main identity nor its runner may verify the other's work.
- **Revocation.** One signed decision by the main identity (`runner_revoque`, target: the runner key). The runner's open leases go back to the draw (`bail_revoque`); every later claim, start or result from it is refused.
- **The audit.** It recomputes every sealed lease on replay, and adds a check, "Sealed cards and runner keys": every result under a sealed lease carries that lease's prompt hash, and no revoked key worked after its revocation. Self-verification is checked across a runner key and its main identity. Refused submissions are not written to the registry; the registry shows the lease's hash and the revocation that explain them.
- Old registries: nothing changes, since only the new objects and fields start the new behaviour.
- Tests: `test/runners.test.ts`.

---

## 11. Sources

Read on 5 November 2026. They change often; check again before building each adapter.

- Anthropic, Claude Code legal and compliance: <https://code.claude.com/docs/en/legal-and-compliance>
- The Register, "Anthropic clarifies ban on third-party Claude access", 20 February 2026: <https://www.theregister.com/2026/02/20/anthropic_clarifies_ban_third_party_claude_access>
- Claude Code Action: <https://github.com/anthropics/claude-code-action> (docs/setup.md, docs/solutions.md, docs/security.md)
- Jules documentation and API: <https://jules.google/docs>, <https://jules.google/docs/api/reference/overview>, <https://jules.google/docs/usage-limits/>
- GitHub Copilot cloud agent through the API: <https://docs.github.com/en/copilot/how-tos/use-copilot-agents/cloud-agent/use-cloud-agent-via-the-api>
- OpenAI Codex with GitHub: <https://learn.chatgpt.com/docs/third-party/github>, <https://learn.chatgpt.com/docs/cloud>, <https://github.com/openai/codex-action>

---

## 12. Summary

**Reused.** The coordinator and everything it verifies; the drand draws; the registry and the audit; Beta reliability and its forgetting; trap rates; the task card and the doors of v0.4; repositories, write scopes and the bridge of v0.3; the creator's server.

**New.** The runner (a workflow in the contributor's fork) and its three jobs; executor adapters for official agents; runner keys with delegations; sealed cards; interaction-free runs; tiers, the cascade and honey by tier; routing that learns by Thompson sampling; adjustments written and replayed as commands; the constitution that no adjustment may touch.

**The test of success.** A contributor forks a hive and adds two secrets. Their subscription works for the hive a few times a day, unattended, within its provider's rules. Every result is verified, and every adjustment the swarm makes to itself can be replayed by anyone.
