# OSP v0.3: the harness

**Design proposal · status: draft, nothing implemented yet · builds on [OSP-v0.1](OSP-v0.1.md), [OSP-v0.2](OSP-v0.2-trust-engine.md) and [docs/security.md](../docs/security.md)**

> **Any group plugs its AIs into Kickswarm and reaches its goal. Kickswarm splits the work, checks it, keeps the record, and asks the humans only what only humans can decide.**

| | |
|---|---|
| Status | Draft, under discussion |
| Date | 24 October 2026 |
| Scope | Private hives, work on real repositories, questions to humans, verification beyond code, accounts and mobile, pooling of machines, the translation hive |
| First milestone | The private hive of the founder and their cousin, to build a Roblox game together (§9, P0) |

---

## 0. How to read this document

- RFC 2119 words (**MUST**, **SHOULD**, **MAY**) and *(parameter)* have the same meaning as in [OSP-v0.1 §0](OSP-v0.1.md).
- Every section ends with three short lists:
  - **Reused**: what already exists in the spec or the code, and is kept as is;
  - **New**: what this proposal adds;
  - **Risks**: what can go wrong, and what we do about it.
- **Naming.** Identifiers that already exist keep their French names (`ruche`, `alveole`, `miel`…). The identifiers introduced here are written in English, because v0.3 is the version planned for moving all identifiers to English. Renaming the existing ones is a separate work item, not part of this proposal.
- **Version slot.** The v0.1 roadmap (§23) gave v0.3 to coordinator federation. This proposal takes the v0.3 slot for the harness, because it is what real users ask for first, and moves federation to v0.4. This change needs a published decision (§14.6 of v0.1).

---

## 1. The idea: a harness in the cloud

Today, an AI agent works well alone, on one machine, for one person. As soon as two people and two AIs work on the same goal, the problems are human ones: who does what, who checks what, who decides, and where we are.

Kickswarm already solves most of this for **public** hives:

| Need of a group | What Kickswarm already has |
|---|---|
| Split a goal into tasks that can be done in parallel | The fractal loop: cells, scouts, builders (v0.1 §5, §6) |
| Know that a task is really done | Verification classes, hidden tests, mutation, Wald's test (v0.2 §3, §4) |
| Not depend on one AI provider | The MCP plugin works with any MCP agent (v0.1 §3) |
| Keep the memory of the project | The board: discoveries, dead ends, questions (v0.1 §13) |
| Know who did what, and prove it | The replayable, post-quantum-signed registry and `kickswarm audit` (v0.2 §6) |
| Let a human set the direction | Owner approval of the first splits, orientation, arbitration (v0.1 §6.3, §17; v0.2 §4.5) |

What is missing, and what this document designs:

1. **Privacy.** A family, a company or a lab does not want its project in a public registry (§2).
2. **Real projects.** Real work lives in a repository, in Luau or Python, not in a single JavaScript module (§3).
3. **Humans in the loop.** A hive must ask for a choice when it needs one, and only then (§3.4, §4.3).
4. **Work that tests cannot check**: design, writing, research, a business plan (§4).
5. **People, not just keys**: accounts, trophies for everyone, a phone in your pocket (§5).
6. **More than AI time**: the software and the compute of the members' machines (§7).

The word *harness* is meant literally: the AIs are the horses, Kickswarm is what lets several of them pull the same cart in the same direction.

---

## 2. Private hives by invitation

### 2.1 What stays the same

A private hive is a normal hive. It uses **the same protocol and the same audit**:

- the same signed objects (hive, cell, result, verdict, decision);
- the same cell lifecycle, castes and splitting;
- the same verifiers, sandboxes, hidden tests and trap cells;
- the same registry format, chained, sealed with SLH-DSA, replayable with `kickswarm audit`.

Only three things change: **who can enter**, **who can read**, and **who can verify**.

### 2.2 Invitations and codes

A hive gets a new field, `visibility`, set at creation and never changed afterwards: `public` (the default) or `private`.

An owner invites people with a signed **invitation**:

```json
{
  "type": "osp.invitation/0.3",
  "hive": "h_7Q2mX…",
  "role": "member",
  "code_hash": "sha256:…",
  "max_uses": 1,
  "expires": "2026-11-07T00:00:00Z",
  "author": "pq1:…",
  "sig": "…"
}
```

- The **code** is short and readable, for example `KSW-7H3QP-L9D2X` (10 characters in base 32 after the prefix, about 50 bits). The registry only stores `code_hash`, the hash of the code with the invitation's salt: reading the registry does not reveal it.
- An invitation is shared as a code or as a link to the existing way-in page (`web/join.html`): `https://<coordinator>/join#invite=KSW-7H3QP-L9D2X`. The code goes **after the `#`**, so it never reaches server logs. The public share links (`/join/<hive>`) do not change.
- To join, a person sends a signed `osp.membership/0.3` request that contains the code. The coordinator checks it, counts the use, and writes the membership in the hive's registry.
- An invitation MAY be addressed to a known identity (`"to": "pq1:…"`). It then needs no code at all.
- The owner MAY revoke an invitation that has not been used yet.
- A private hive's identifier is random (128 bits), not its name: a URL does not reveal what the project is.

### 2.3 Roles

| Role | Can do | Default |
|---|---|---|
| **Owner** | Everything a member can do, plus: invite, remove, change roles, approve splits, answer any question, arbitrate, close the hive | The creator. There is exactly one owner; ownership MAY be transferred by a signed decision. |
| **Member** | Send bees, read the registry and the board, answer the questions addressed to them, propose an orientation | Every invited person |
| **Guard** | Have their bees drawn to verify the work of others | Every member, unless the owner says otherwise |
| **Reviewer** | Give human verdicts (class V2-human, §3.6) | Chosen by the owner |
| **Observer** | Read only: dashboard, registry, board | For a parent, a teacher, an investor, a client |

- Every role change is a signed decision (`osp.decision`, new natures `role_grant` and `role_revoke`) written in the hive's registry, with its reason. This is principle 5 of v0.1, "all power is visible", applied inside the hive.
- A member MAY leave at any time. A removed member's bees lose access at once. **Their past work stays in the registry**, with their name: the registry is append-only, and a contribution remains a fact.
- The rule "a bee never verifies its own contributor's work" (v0.1 §7.3) stays absolute.

### 2.4 A registry for members only, and verifiable by them

**The choice: one registry per private hive.** Each private hive has its own chained, sealed registry, separate from the public one. Members, and only members, can download it and replay it with `kickswarm audit`, exactly like the public registry today.

Two other designs were considered and set aside:

| Design | Why it was set aside |
|---|---|
| Private entries encrypted inside the public registry | Metadata leaks (who works, when, how much); every auditor needs the keys; much more complex replay |
| Private hives with no registry at all | Members could no longer check who did what. This is the very thing Kickswarm is for. |

**A public anchor.** The coordinator regularly writes into the **public** registry an `anchor` entry: the opaque identifier of the private hive (a hash), the index and the hash of the head of its registry, and its last seal. This reveals nothing about the content, but it **commits** the coordinator: if it ever showed two members two different histories, or rewrote the past, the anchors would prove it. Every member's `kickswarm audit` checks its copy against the public anchors.

**What "private" means, honestly.** A private hive is private **from the public**, not from whoever runs the coordinator. The coordinator still reads the deliverables, because it runs the verifier on them. Groups that cannot accept this have two options:

- **run their own coordinator** (`kickswarm coordinator` is open source, see [docs/hosting.md](../docs/hosting.md));
- later, **verification on the members' machines only**, with the coordinator seeing hashes and encrypted payloads (§10, open question 1).

The dashboard and the docs MUST say this plainly.

### 2.5 Verification in a small hive

A hive of two people cannot reach "1 wrong cell in 10,000" with guards: Wald's test needs up to 7 newcomer guards (v0.2 §4.5), and there are two people. Pretending otherwise would break principle 1. So a private hive states what it really checks.

- **The automatic verifier stays mandatory** for V0 cells: visible tests, hidden tests, properties, test strength by mutation. For code, it does most of the work.
- **Cross-review.** Guard seats are drawn among the members' bees with the guard role, with drand and sealed verdicts as today. With two members, each one's bee verifies the other's work: this is a code review, made automatic.
- **Hidden tests keep their value**: the bee of the member who wrote the split's hidden tests SHOULD NOT be the worker on that cell.
- **Per-hive parameters.** The owner sets α\* (1% by default for a private hive, like the trial), the guard floor (0, 1 or 2) and the levels that need human approval. These choices are written in the registry at launch.
- **The final say belongs to a human.** For code, it is the merge of the pull request (§3.3). This is recorded as a V2-human verdict.
- **Honest display.** The dashboard shows, for each cell, *what checked it*: "tests + hidden tests + Cousin's Claude + merged by Owner". It shows the measured error rate only when there are enough trap cells for it to mean something.

### 2.6 Honey, trophies and the charter in a private hive

- **Honey is local.** A private hive counts honey, ranks and contributions with the same formulas, but **this honey stays inside the hive**. It does not crystallize into power shares and does not feed the Commons. The reason is simple: two friends who validate each other's work in private could otherwise print public honey at will. Public honey must only come from public, verifiable work.
- **The local record is still valuable.** It shows each member's share of the work. For a game that earns money, this record can help a group agree on how to share it. It is a fact, not a contract: the contract is the group's own business.
- **Trophies.** Members earn trophies in private hives too (§5.3). On a public profile, they appear as "in a private hive", unless the hive chooses to show its name.
- **The charter still applies.** Article 4 of v0.1 already allows private hives "declared as such". There is no public compliance review, since nobody outside may read the project. Instead:
  - the owner signs a **charter attestation** when creating the hive;
  - any member MAY report the hive to the operator;
  - the operator MAY suspend a private hive for a serious breach, with a public decision that names the breached article but not the content.

### 2.7 What changes in the coordinator (`src/coordinator/coordinator.ts`)

The coordinator today holds **one** state and **one** registry for all its hives. The simplest design that keeps all the trust engine intact is:

> **A private hive is a coordinator of its own.** Each private hive runs in its own `Coordinator` instance, with its own registry, state, vault and data folder. A small host object routes requests to the right instance.

This reuses, unchanged, the transactions, the replay, the seals, drand, sealed verdicts, Wald's test and trap cells. The changes inside `Coordinator` are limited:

| Change | Where today |
|---|---|
| **Membership check**: only members claim cells (`claim`), only guards are drawn (`doClaim`), only members commit and reveal verdicts | `checkRequete`, `doClaim`, `doEngagerVerdict`, `doSubmitVerdict` |
| **New commands**: `invitation`, `membership`, `role_grant` / `role_revoke`, `leave`, `question` / `answer` (§3.4), `repo_receipt` (§3.3) | the command list (`CommandeType`) and `replayCommande` |
| **New cell state** `attente_decision` (waiting for a decision, §3.4). The scheduler skips it, the rest of the hive keeps going | `CellState` in `src/protocol/types.ts`, `doClaim`, `normalizeState` |
| **Local honey**: no share issuance, no Commons in a private instance. The audit invariant "the Commons holds 30%" becomes "no shares issued" | `validate`, `completeHive`, `ledger.ts`, `audit.ts` |
| **Per-hive parameters** written at launch: α\*, guard floor, approval levels | `params.ts` (already per coordinator) |
| **Write scopes** of cells (§3.2): two open cells MUST NOT write the same file | `validateSpec`, `applyDecomposition` |
| **Repo capsules** (§3.2) | `CellSpec`, `emitCell` |
| **A richer live view**: questions, members' lanes, pull requests | `liveView`, `LiveView` |
| **Anchors**: the public instance records the head of each private registry | a new `anchor` entry, written by the host |

### 2.8 What changes in the API (`src/coordinator/http.ts`)

| Change | Why |
|---|---|
| Private routes under `/v0/p/{hive}/…`, mirroring the existing ones (`/work/claim`, `/work/submit`, `/work/commit`, `/work/verdict`, `/live`, `/board`, `/registry`, `/state-hash`, `/events`) | One router, the same handlers, the right `Coordinator` instance |
| `POST /v0/p/{hive}/join` with the invitation code; `POST /v0/p/{hive}/invitations`, `/roles`, `/leave` | Invitations and roles (§2.2, §2.3) |
| **Signed reads.** Every `GET` on a private route requires a short-lived **read ticket**: the member signs a challenge, the coordinator returns a ticket valid 1 hour *(parameter)*, sent as `Authorization: Bearer …` | Today every `GET` is public and unsigned. Signing each read with a 7 KB post-quantum signature would be too heavy; one signature per hour is not. |
| `GET /v0/hives` keeps listing **public** hives only. A signed `GET /v0/me/hives` lists the private hives I belong to | No private hive appears in a public list |
| The event stream (`/v0/events`) is per hive. Today it announces every registry entry to anyone | A public stream must not show that a private hive is active |
| `GET /v0/contributors/{id}` hides private hive names in trophies (§2.6) | Today trophies carry the hive slug |
| No `access-control-allow-origin: *` on private routes | Today every answer allows any origin |
| Rate limits per identity and per address on `join` | Codes must not be guessable by brute force |

Writes are already signed objects, so they need no new authentication: only the membership check.

### 2.9 What is implemented (P0-1)

- **One coordinator instance per private hive** (`src/coordinator/hote.ts`). The host routes `/v0/p/{id}/…` to it, and private hives come back after a restart. The instance launches with `prive: true` and the hive's own guarantee in its launch entry.
- **Invitations and codes.**
  - The owner signs an `osp.invitation/0.3`. It carries the role, the number of uses, the expiry (at most 90 days) and `code_hash = sha256(salt ":" code)`.
  - The code (`KSW-XXXXX-XXXXX`) never leaves the owner's terminal before it is shared.
  - The invitee signs an `osp.adhesion/0.3` that contains the code. The host asks each private hive whether the code opens one of its invitations.
  - The links `…/join#invite=CODE` keep the code after the `#`, so it never reaches the server. The join page shows the matching command.
  - Join attempts are limited per address (20 per 10 minutes by default).
- **Roles.**
  - Owner, member and observer, plus a per-member "guards" flag. Decisions `role_attribue`, `role_retire`, `depart` and `invitation_revoquee` are written in the hive's registry.
  - A removed member loses their open leases and their read ticket at once. Their past work stays.
  - In a private hive, every way in (claim, result, split, commitment, verdict) checks membership. Only members who guard are drawn to verify.
- **Reads need a ticket.** A member signs a `lire` request and gets a ticket valid for 1 hour. Private answers carry no cross-origin permission. The public hive list never shows a private hive.
- **Local honey.** In a private instance, honey does not crystallize into shares and feeds no Commons. The audit then checks "no power share issued" instead of the 30% Commons.
- **Public anchors.** After every private command, the host writes into the public registry the head of the private registry: an opaque key, an index and a hash. The public audit replays anchors like seals. `kickswarm audit --hive <id>` checks a member's copy against every anchor, before the replay, so a rewritten history is caught even when it no longer replays.
- **Commands.**
  - `kickswarm private create|invite|members|role|remove|revoke|leave`
  - `kickswarm join --invite <code>`
  - `kickswarm audit --hive <id>`
  - The plugin's `swarm_join` accepts a private hive's identifier.

**Different from §2.2 to §2.8, for now:**

- **The default guarantee is α\* = 5% with a floor of one guard, not 1%.** With two members, 1% would need three newcomer guards, which two people cannot provide. With 5% and one guard, each member's bee reviews the other's work. The owner can choose both values at creation (`--alpha`, `--guards`).
- **Not done yet:**
  - invitations addressed to an identity (`"to"`, without a code);
  - transferring ownership;
  - the reviewer role (it comes with V2-human verdicts);
  - the charter attestation;
  - per-hive questions, the bridge and the dashboard (P0-2 to P0-5).

### 2.10 Summary

**Reused.** The whole protocol, the trust engine, the registry format, the audit, drand, seals, sandboxes. The `Coordinator` class, almost unchanged, as one instance per private hive.

**New.** `visibility`, invitations and codes, memberships, roles, one registry per private hive, public anchors, read tickets, local honey, the charter attestation.

**Risks.**

- *The operator can read private hives.* Said plainly; self-hosting available now; members-only verification later.
- *Leaked code.* Single use and expiry by default; the owner sees every join and can remove a member at once.
- *A small hive gives a weak guarantee.* It is displayed honestly; the human merge is the final check.
- *Private hives used against the charter.* Attestation, reports, suspension. This is a real tension between privacy and control, and it is decided in favor of privacy, with a reporting path.
- *Many instances on one server.* Each instance is small; registries are separate files. Fine for hundreds of hives; beyond that, the hosting plan must change.

---

## 3. The driving use case: a Roblox game between cousins

### 3.1 The story

The owner and their cousin want to build a Roblox game. Each has their own AI subscription, for example Claude for one and Codex for the other. The project lives in a shared GitHub repository, synced to Roblox Studio with Rojo.

1. **The owner creates the hive** in one sentence: *"A Roblox obstacle game with 10 levels, coins, a shop and a leaderboard."* They link the repository and invite their cousin with a code.
2. **The hive asks its first questions** (§4.3): "R15 or R6 avatars?", "Should coins be lost on death?", "Which levels first?". Each question has choices and a recommended answer. The owner answers in two minutes.
3. **The scouts split the game**: core logic (coins, shop, save data), levels, user interface, leaderboard. Each part declares its interface first, so the parts can be built at the same time (v0.2 §7.1, "contract first").
4. **Both cousins tell their AI**: *"Join our hive and work until there is nothing left to do."* Their bees take cells from different branches. Nobody waits for the other.
5. **Each deliverable is checked**: Luau tests in a sandbox, then the other cousin's AI reviews it.
6. **Validated work becomes a pull request** on the repository. The owner, or the cousin, merges it.
7. **When the hive needs a human**, for example "this jump feels too hard, keep it or make it easier?", it asks the right person, on their phone (§5.4). Only that branch waits.
8. **Both see the same dashboard**: what is done, who is doing what, what is waiting for them.

### 3.2 Working on a shared repository

Today a capsule is a block of text, and a deliverable is a set of files of at most 256 KB, for a single JavaScript module. A real project needs three additions.

**Repo capsules.** A cell can point to the repository instead of copying it:

```json
"repo": {
  "url": "https://github.com/owner/game",
  "commit": "9f2c1e…",
  "read": ["src/shared/Coins.luau", "src/shared/Types.luau"],
  "read_hashes": { "src/shared/Coins.luau": "sha256:…" },
  "write": ["src/shared/Shop.luau", "tests/Shop.spec.json"]
}
```

- The plugin reads the listed files from the member's **local clone**, at the exact commit, and checks their hashes. The capsule stays small, and the files are pinned by the signed cell.
- The capsule's text still frames the files as **data**, never as instructions (v0.1 §8.4).

**Write scopes.** Each cell declares the files it may create or change (`write`). The coordinator **MUST refuse** to open two cells whose write scopes overlap at the same time. This is what really makes "nobody blocks the other" true: two bees never edit the same file in parallel, so there are no merge conflicts between cells. Shared files (type definitions, interfaces) are written first, by the cell that fixes the contract.

**Repo deliverables.** The deliverable lists the new content of the files in its write scope, and the files it deletes. Its hash is in the result, as today. The size limits become *(parameters)* per hive.

**Assisted mode.** In a public hive, the bee works in **locked mode** (v0.1 §8): no human help, and only the Kickswarm tools, as in the trial. In a private hive, the owner MAY allow **assisted mode**: the bee works in the member's own clone, with its agent's usual tools, and the member MAY help it. This is safe for the hive, because security rests on verifying the result, not the process (v0.1 §8, "accepted limit"). It is the member's own choice on their own machine, and the result says which mode produced it.

### 3.3 The GitHub bridge

**Principle 2 decides the design: credentials never leave the contributor's machine.** The coordinator MUST NOT hold a GitHub token. So the link to GitHub runs **on a member's machine**.

**The bridge** is a `kickswarm bridge` command that runs on the machine of a member with write access to the repository, usually the owner's. It uses that member's own `git` and `gh` login.

1. It follows the hive's private registry.
2. For each cell turned into honey, it applies the deliverable on a branch, `kickswarm/<branch-path>`, starting from the cell's base commit.
3. The commit message carries the cell, the result and the verdicts. It credits the member with a `Co-authored-by` line, and the AI with a trailer (`AI: claude-code`, as declared).
4. It opens or updates **one pull request per branch of the comb** *(parameter: or one per cell)*. One per branch keeps the noise low: a milestone, a pull request.
5. It signs a **repo receipt** (`osp.repo_receipt/0.3`: cell, commit SHA, PR URL) and writes it in the registry.
6. When a human approves and merges the pull request, the bridge records it as a **V2-human verdict** signed by the bridge, with the GitHub reviewer's name. The member's GitHub name is linked to their Kickswarm identity once, by a signed statement.

**What the audit checks.** For each receipt, anyone with access to the repository can check that the commit contains **exactly** the validated deliverable: the bridge cannot slip in a change. The audit computes the git hashes of the deliverable's files and compares them with the commit's tree. GitHub facts (a merge, a CI run) are **external evidence**: the audit lists them separately, because it cannot replay them offline.

**Continuous integration.** The repository's own CI (GitHub Actions) runs on each pull request: type checking, linting, tests. Its status is shown on the dashboard. It is a useful extra check, not a replacement for the verifier: the verifier runs before the pull request exists.

**When the bridge's machine is off**, honey waits in the registry, and the pull requests appear when it comes back. A second member MAY run a bridge too; the receipts make duplicates visible and harmless.

**Later, an optional GitHub App** would let the bridge run in the cloud. It means a credential held by the coordinator for the hive (not for a contributor). Principle 2 talks about contributors' credentials, but the spirit is wider: this option needs an explicit, published decision first (§11).

### 3.4 Questions with choices

**When does a hive ask?** Only when a decision is the humans' to make: a matter of taste, of direction, of money, of law, or a contradiction between two instructions. A bee MUST NOT ask a question that the capsule, the board or an earlier answer already settles.

**The question object:**

```json
{
  "type": "osp.question/0.3",
  "hive": "h_7Q2mX…",
  "cell": "sha256:…",
  "author": "pq1:…",
  "text": "The jump in level 3 fails 4 times out of 10 in playtests. Keep it, or make it easier?",
  "why": "Difficulty decides whether young players stay.",
  "kind": "taste",
  "options": [
    { "id": "a", "label": "Keep it", "consequence": "Level 3 stays hard" },
    { "id": "b", "label": "Make it easier", "consequence": "Gap reduced from 14 to 11 studs" }
  ],
  "recommended": "b",
  "default": "b",
  "deadline": "2026-10-26T18:00:00Z",
  "blocks": "cell",
  "sig": "…"
}
```

- It is written on the board, whose `question` entry type already exists (v0.1 §13), and in the registry.
- **It blocks as little as possible**: by default only its cell, which moves to `attente_decision`; at most its branch (`"blocks": "branch"`). The rest of the hive keeps working.
- **A default answer and a deadline** MAY be set. Without an answer by the deadline, the default applies, and the registry says "default applied". The owner MAY forbid defaults for some kinds (money, law).
- **The answer** is an `osp.answer/0.3` object, signed by the human: the chosen option, and an optional comment. The comment joins the capsules of the cells that follow.
- **Plugin tools.** A bee asks with a new MCP tool, `swarm_ask`. A member answers on the dashboard, on the phone, with `kickswarm answer`, or by telling their own AI, which uses `swarm_answers` to list the questions and send the member's choice. The AI MUST NOT choose on its own: the answer is signed with the member's key only after the member has said it.

**Whom it asks:**

| Kind of question | Who answers |
|---|---|
| `direction`, `money`, `legal`, anything irreversible | The owner, always |
| A question inside a branch that a member has claimed ("I take care of the UI") | That member first, then the owner after the deadline |
| `taste`, when the owner turned on team votes | All members; majority, ties broken by the owner |
| A question addressed to a role (`reviewer`, a client as `observer`) | The people with that role |

**Against noise:**

- each branch has a question budget *(parameter: 3 open questions)*;
- a question that repeats an earlier one is merged with it;
- the human who answers MAY mark a question "not needed". That feedback lowers the asking bee's reputation a little, and teaches the playbooks (v0.2 §7.3) what not to ask.

**Against manipulation.** A question is text written by an AI, read by a human: it is a new path for prompt injection, now aimed at people. So:

- questions are shown as plain text, links are not clickable, options are labels only;
- a question that asks for a password, a key, a payment or personal data is **refused** by the coordinator (charter, article 3), and the screen says: "Kickswarm never asks for your passwords";
- answering never runs anything on the human's machine.

### 3.5 The progress dashboard (extending `web/hive.html`)

The live hive already has: the honeycomb, four counters (progress, bees, cells, honey), a legend, a leaderboard, a live feed, the Commons, and the join command. The private view keeps all of it and adds:

| Panel | What it shows |
|---|---|
| **Needs you** (at the top) | The questions and approvals waiting for *me*, with their deadline and their default answer. One tap to answer. |
| **Lanes** | One line per member: their bees, the cell each bee is on, what comes next, their remaining AI quota as reported by their plugin ("Cousin's Codex: limit reached until 18:00, their cells go to others"). |
| **Milestones** | The branches of the comb as milestones, with progress, open pull requests and CI status. |
| **Waiting** | The cells that wait, and why: a question, a guard, a busy file, the bridge. |
| **What checked it** | For any cell: tests, hidden tests, which AI reviewed it, who merged it (§2.5). |
| **Repository** | The latest receipts: commit, pull request, merged or not. |

- The data comes from the private live view (`GET /v0/p/{hive}/live`), an extended `LiveView`.
- **Opening it.** `kickswarm open <hive>` gets a read ticket and opens the browser with the ticket after the `#`. The page sends it as a header and never stores it longer than the ticket lives. On the phone, the account does this (§5.4).
- The public page does not change.

### 3.6 Roblox and Luau: what verification needs

**What exists.** V0 verification only knows `tests-js@1` and `tests-de-tests@1`: JavaScript modules, run in QuickJS compiled to WebAssembly. A Roblox game is written in **Luau**, and much of it calls the Roblox engine (players, physics, user interface, remote events), which only exists inside Roblox.

**The rule that makes it work: pure logic first.** A scout playbook (v0.2 §7.3) for Roblox games tells scouts to split the game into:

- **pure modules**: coins, shop prices, inventory, save-data format, level rules, matchmaking. They depend on nothing but Luau, so they can be tested automatically (V0);
- **thin glue**: the scripts that connect these modules to the engine. They are short and are reviewed (V1, V2) and playtested by a human.

The more logic sits in pure modules, the more of the game is verified like the rest of Kickswarm.

**New verification classes:**

| Class | Verifier | What it checks | How |
|---|---|---|---|
| V0 | **`tests-luau@1`** | A pure Luau module passes its visible, hidden and property tests | The open-source Luau virtual machine compiled to WebAssembly, in a throwaway thread, like QuickJS today: same pinned engine for the coordinator, guards and auditors, so the same verdict everywhere. Tests in the same JSON form as `tests-js@1`. |
| V0 gate | **`luau-checks@1`** | Strict type checking (`luau-analyze`), the linter (Selene) and the formatter (StyLua) report nothing | Run before the tests. A gate proves the code is clean, not that it is correct. |
| V0 (later) | **`roblox-place@1`** | Tests that need the engine run in a real place on Roblox's servers | Roblox's Open Cloud offers a way to run Luau in a place *(availability, quotas and terms to check)*. It needs a Roblox key: it runs through the bridge, on the owner's machine, never on the coordinator. Its report is external evidence. |
| V1 | **`review-ai@1`** | An AI review against a checklist written in the cell (§4.2) | Guards' AIs, from different model families when possible, answer each item with evidence |
| V2-human | **`review-human@1`** | A person approves: playtest, look and feel, merge | A reviewer's signed verdict, from the dashboard or the phone; a merge recorded by the bridge |

**The mutation engine for Luau.** Test strength (v0.2 §3.2) and trap cells (v0.2 §6.8) both rely on mutants. A Luau version of the engine flips `==` and `~=`, `and` and `or`, `<` and `<=`, removes `not`, changes constants, and swaps `math.min` and `math.max`, `math.floor` and `math.ceil`. A trap cell for a Luau review is then a real deliverable with one subtle bug, as for JavaScript.

### 3.7 Provider terms

Using your own AI subscription, yourself, for your own project, is ordinary use. But v0.1 §20 only allows by default "the contributor's agent, by the contributor, on their own account, for **public-interest** hives". A private game is not a public-interest hive. §20 MUST therefore add: **"or for a private hive the contributor is a member of"**. The rest stays strict:

- no use of one person's subscription for a project they are not a member of;
- the "unused quota" daemon mode stays off by default and is enabled provider by provider (§20);
- for companies, whether employees' personal plans may be used for company work depends on each provider's terms: the plugin's provider profiles say so.

### 3.8 What is implemented (P0-2)

Protocol identifiers stay French until the v0.3 rename (§11): `repo` is `depot`, `read` is `lecture`, `read_hashes` is `empreintes_lecture`, `write` is `ecriture`, and `osp.repo_receipt/0.3` is `osp.recu_depot/0.3`.

- **Repo capsules** (`src/protocol/depot.ts`). A cell MAY carry `depot = { url, commit, lecture, empreintes_lecture, ecriture }`. The coordinator checks it: an https address, a full git hash, plain relative paths (no `..`, no hidden file, at most 8 folders), one sha256 hash per file read. The signed cell carries it as is.
  - The plugin reads each file of `lecture` from the member's own clone, with `git cat-file blob <commit>:<path>`, and gives it to the agent only if its hash matches. The files are framed as data. The member says where their clone is with `kickswarm settings --clone <url>=<path>`.
  - A scout's children MAY carry `depot = { lecture, ecriture }`. The plugin completes them with the parent's repository and commit, and pins the files read with their hashes (an agent cannot hash).
  - A child stays on its parent's repository, inside its parent's write scope.
- **Write scopes.** `ecriture` lists files, or folders ending in `/`. When it hands out work, the coordinator never opens a cell whose scope overlaps a cell of the same repository that is reserved, in progress or being verified. The check is deterministic, so the replay and the audit enforce it too.
- **Repo deliverables.**
  - File names are now repository paths, with more text extensions (`.luau`, `.lua`, `.ts`, `.md`, `.json`, …). Luau modules are tested since P0-3 (§3.9).
  - `supprimes` lists the files the deliverable deletes.
  - Every path written or deleted must be inside the cell's scope: the plugin checks before sending, and the coordinator refuses the rest (403).
  - **`contexte`, a necessary addition.** The coordinator runs the tests but has no copy of the repository. So a repo deliverable carries the files of `lecture` it needs, exactly as pinned: the coordinator checks each one against its hash. They are present when the tests run and never written to the repository. The plugin attaches them on its own.
- **The bridge** (`src/bridge/pont.ts`, `kickswarm bridge <hive> --clone <path>`). It runs on a member's machine, with their own `git` and `gh`. The coordinator holds no credential.
  1. It reads the cells turned into honey that have no receipt yet, in the order they became honey.
  2. It builds each commit with git's plumbing and a temporary index, starting from the branch's head or the cell's base commit. The member's working tree, index and current branch are never touched, and files are written byte for byte.
  3. The commit message names the cell, the result, the verifier and the number of guards. It carries `Co-authored-by` for the author's linked GitHub name, `AI: <family>` as declared, `Kickswarm-Author` and `Kickswarm-Cell`.
  4. It pushes to `kickswarm/<hive>/branch-<n>`, or `…/cell-<path>` with `--per-cell`, and opens one pull request per branch through `gh` (`--no-pr` to skip).
  5. It signs an `osp.recu_depot/0.3` receipt: cell, result, repository, branch, commit, parent, the git hash of every file, the files deleted and the pull request. The coordinator recomputes those git hashes from the validated deliverable and refuses any difference. A commit already pushed by a pass that could not write its receipt is found again by its trailer, not pushed twice.
  6. When a human merges the pull request, the next pass signs an `osp.fusion_depot/0.3` statement: receipt, pull request, GitHub reviewer, merge commit.
- **GitHub names.** A member links theirs once with `kickswarm github <name>`, a signed `osp.lien_github/0.3`. One name, one identity.
- **The audit.**
  - It checks that every receipt names exactly the validated deliverable, recomputed from the signed objects alone.
  - `kickswarm audit … --clone <path>` also checks each commit in the member's clone: its only parent is the stated one, every file has the right git hash, the deleted files are gone, and nothing else changed (`src/bridge/verifier.ts`).
  - Merges are listed apart, as external evidence.
- **API.** `GET /v0/cells/{id}` (cell, capsule, validated honey, receipts), `GET /v0/repo/honey`, `POST /v0/repo/receipts`, `POST /v0/repo/github`, `POST /v0/repo/merges`. On a private hive they sit under `/v0/p/{id}/…`, with a ticket for reads. In a public hive, only the hive owner writes repository facts.

**Different from §3.2 and §3.3, for now:**

- **A merge is recorded as external evidence, not as a V2-human verdict.** Verdicts go through the drawn guards' commit-reveal, and the honey is already validated when the pull request opens. Turning the merge into a verdict comes with V2-human verification (P1).
- **The size limits stay global** (32 files, 256 KB), not per hive.
- **Not done yet:**
  - assisted mode (the bee works in the member's clone with its usual tools);
  - showing CI status on the dashboard (P0-5);
  - the optional GitHub App.


### 3.9 What is implemented (P0-3)

- **The engine.** `@luau-rs/luau` 0.739.0, pinned exactly: the Luau compiler, virtual machine and analyzer of Luau release 739, compiled to WebAssembly. One build for the coordinator, the guards and the auditors, so the same verdict on every machine.
- **`tests-luau@1`** (`src/verifier/luau.ts`, `luau-worker.ts`, `luau-runner.ts`).
  - The criterion: `{ "verificateur": "tests-luau@1", "module": "src/shared/Shop.luau", "tests", "proprietes", "tests_caches_hash", "reference_hash", "portes" }`. The tests have the same form as `tests-js@1`: `fn` names a function of the table the module returns.
  - A function's first return value is compared with `attendu`, by content. Property cases are drawn by the host from the deliverable's hash, as for JavaScript. `verifie` is a Luau expression over `args`, `out` and `eq`.
  - The sandbox runs in a throwaway thread: Luau's sandbox mode with read-only libraries. It loads only `base`, `coroutine`, `table`, `string`, `math`, `utf8`, `bit32` and `buffer`, so there is no `os`, no `debug`, no `loadstring` and no host function. Memory is capped at 128 MB, and time by an interrupt and by the thread's own limit. `math.random` is seeded from the deliverable's hash.
  - `require` takes relative string paths only (`./Coins`, `../shared/Types`, with `.luau`, `.lua` and `init.luau` resolved as Luau does). It never leaves the deliverable.
  - Modules see neither `getfenv`, `setfenv` nor the real `_G`. The runner captures everything it needs before any delivered code runs, compares with raw operations only, compiles each property expression as a chunk of its own, and returns its report as its return value. The tests cover escape attempts, an endless loop, a memory bomb and a forged result.
- **`luau-checks@1`**, a gate in the criterion (`"portes": ["luau-checks@1"]`). Luau's own analyzer runs in strict mode with its linter, on the deliverable's own Luau files: the files it only reads (`contexte`) are not judged. One diagnostic fails the deliverable. `--!nocheck`, `--!nonstrict` and a bare `--!nolint` are refused. The gate does not count in test strength: a mutant only counts as caught when a test catches it.
- **The Luau mutation engine** (`src/verifier/mutation-luau.ts`), engine version 3. It flips `==`/`~=`, `<`/`<=`, `>`/`>=`, `and`/`or`, `+`/`-`, `*`/`/` and `+=`/`-=`. It removes `not`, changes integer constants and booleans, and swaps `math.min`/`math.max`, `math.floor`/`math.ceil` and `upper`/`lower`. It never touches strings, comments, type annotations, type declarations or generic parameters, so a mutant still loads. Test strength, trap cells and the audit use it like the JavaScript engine. A registry that announced version 2 replays without Luau mutants.
- **Playbooks** (`src/playbooks/`). A hive MAY name one (`"playbook": "roblox-pure-logic-first"`). The coordinator refuses unknown names and passes the name with each task. The plugin ships the text and adds the part for the bee's role: scout, worker or builder. A hive therefore cannot slip instructions into a playbook.
- **The Roblox playbook, "pure logic first"** (`src/playbooks/roblox.ts`, `docs/playbooks/roblox.md`). Pure modules are cells checked by `tests-luau@1` and `luau-checks@1`. Shared types come first, the engine is passed in rather than reached for, write scopes stay small, and each child has a reference. Glue scripts are left to humans until V1 and V2 exist.
- **The demo hive** (`src/exemples/roblox.ts`, `examples/ruche-roblox.json`): a game's economy, with coins and a shop as pure modules, hidden tests and references. In the tests, scripted bees complete it, a guard catches a mutated Luau trap, and the audit re-runs every verification.

**Different from §3.6, for now:**

- **No Selene, no StyLua.** Neither has a maintained WebAssembly build that could be pinned for every machine (StyLua's was last published in 2021). Luau's own linter replaces Selene for now. Formatting is left to the repository's CI, which runs on every pull request the bridge opens.
- **The Roblox engine is not emulated.** A pure module that touches `game` fails to load, which is the point: `roblox-place@1` stays a later step (P2-3).
- **A function's extra return values are ignored**, and an empty table equals both `[]` and `{}`: Luau has only tables.

### 3.10 Summary

**Reused.** Cells, splitting, contract first (v0.2 §7.1), playbooks, the board's `question` type, the WebAssembly sandbox model, the mutation engine design, trap cells, sealed verdicts, owner approvals and arbitration, `hive.html`.

**New.** Repo capsules, write scopes, repo deliverables, the bridge and its receipts, the `osp.question` and `osp.answer` objects, the `attente_decision` state, question routing, the private dashboard panels, `tests-luau@1`, `luau-checks@1`, `review-ai@1`, `review-human@1`, the Luau mutation engine, the Roblox playbook, the §20 amendment.

**Risks.**

- *A bee in assisted mode works in the member's real repository, with the agent's own tools.* In a private hive this is the members' own choice on their own project; the plugin's locked mode stays the default for public hives.
- *Engine code cannot be tested outside Roblox.* Pure-logic splitting, human playtests, the Open Cloud option later.
- *Too many questions.* Budget, merging, "not needed" feedback.
- *Questions as an injection channel toward humans.* Plain text, no links, credential requests refused.
- *GitHub as a trusted third party.* Its facts are labeled external; the verifier's checks stay independent of it.
- *Contract-first splitting is not implemented yet* (v0.2 P1-2). Without it, parallel branches will collide more often. It moves up in the plan (§9).

---

## 4. Beyond code: any goal

### 4.1 What a deliverable can be

A company, a research question, an association's project, a novel, a game: the fractal loop is the same. What changes is **how we know a cell is done**. The rule of v0.1 §9.1 stays: **maximize V0**, use V1 where claims can be checked, and V2 where only judgment can decide.

| Deliverable | Example | How it is checked | Class |
|---|---|---|---|
| Code, data transforms, formulas | A price simulator, a spreadsheet model | Tests, properties | V0 |
| A document with a required structure | A business plan with all mandatory sections, a grant application | Structure checks (sections, lengths, required fields), then review | V0 gate + V1 |
| Claims backed by sources | A market study, a literature review | Each claim has a source; guards check that the source exists and says it | V1 |
| Extracted data | 200 suppliers with price and lead time | Spot checks against the sources, by sampling | V1 |
| A synthesis, a design, a text | A pitch, a game's story, a logo brief | A jury scores against a rubric | V2 |
| A choice | Which market first, which name | It is not verified: it is **asked** (§4.4) | Question |
| An action in the world | Send emails, sign up for a service, pay | Not done by bees (§4.5) | — |

### 4.2 V1 and V2 in practice

v0.1 defined V1 and V2 in one line each. This is what they become.

**V1, checkable claims.** The cell's criterion is a **checklist** of items, each one objectively checkable by a careful reader:

```json
"critere_fini": {
  "classe": "V1",
  "verificateur": "review-ai@1",
  "checklist": [
    "Every number in the text has a source in the list",
    "Every source in the list exists and is reachable",
    "The text answers the three questions of the goal"
  ],
  "gates": ["structure-md@1"]
}
```

- Automatic **gates** run first: format, structure, length, presence of sources. They reject the obvious failures for free.
- Each guard answers **item by item**, with evidence: a quote, a line, a link. A bare "valid" is not accepted.
- Verdicts are sealed (commit, then reveal), as today.
- **Wald's test applies**, now with its decrement: v0.2 §4.5 noted that "log-odds −= log(s / (1 − c))" would serve classes without deterministic replay. This is that case. A rejection counts against the result instead of being settled by a replay.
- **Trap cells still work**, through **semantic mutants** of validated deliverables: a number changed, a negation added, a source swapped, a sentence removed. A guard who validates them is measured exactly like a guard who misses a code mutant.
- **The quarantined-model pattern** (security.md §2): the model that reads the deliverable has no tools, and only returns the structured verdict.

**V2, judgment.** The criterion is a **rubric**: a few criteria scored from 1 to 5, each with a description of what a 2 and a 4 look like.

- A jury of 3 to 5 guards, from at least two model families, scores in a sealed way. The cell is honey with a qualified majority of 2/3 above the threshold (v0.1 §9.1).
- Every score carries a short justification, kept on the board: it teaches the next attempt.
- **A human MAY have the last word**: the owner, or a reviewer, for anything that defines the project (its name, its story, its look).
- Later, verdicts with confidence and proper scoring rules (v0.2 §5.4, P2-1) reward honest juries.

**What V1 and V2 cannot promise.** An AI jury can share the same blind spot, and a rubric can miss what matters. The dashboard shows, for each V1 or V2 cell, the jury, its agreement, and the measured reliability of its members on trap cells. Nothing is presented as more certain than it is.

### 4.3 Scoping: asking the right questions at the start

Most failed projects fail at the start, on a misunderstanding. So a hive does not split its goal right away.

1. **A scoping cell** comes first. A scout reads the one-sentence goal and returns at most 7 questions *(parameter)*, ranked by how much each answer changes the work. Each question follows the format of §3.4: options, recommended answer, why it matters.
2. **The owner answers.** They MAY skip any question; the recommended answer then applies, and this is written down.
3. **The brief.** The goal, the answers and the assumptions become the **brief**, the root capsule of the hive, visible on the dashboard. Every later capsule starts from it.
4. **The first split** (levels 0 and 1) then goes to the owner for approval, as v0.1 §6.3 already requires.

The scoping cell is itself verified (V2): a jury checks that the questions are the ones that matter, and that none is answered by the goal itself. Good scoping questions become a playbook: "for a Roblox game, ask about the audience's age, the devices, the monetization".

### 4.4 Questions along the way

During the work, questions follow §3.4. Three sources, besides bees asking directly:

- **Contradictions.** Two results, or a result and the brief, disagree. The builder that finds it asks, rather than guessing.
- **Escalations.** A cell that reaches arbitration (v0.2 §4.5) becomes a question to the owner, with both sides' arguments as options.
- **Checkpoints.** The owner MAY ask for a review at each milestone: "here is what level 1 looks like; continue as planned?"

### 4.5 The hive prepares, humans act

Bees produce **deliverables**: drafts, files, plans, code. They do **not act in the world** on anyone's behalf: no sending emails, no posting, no payments, no sign-ups, no contracts. When a goal needs an action, the hive prepares it completely (the email, the form's content, the list of steps) and **a human does it**. The registry records "prepared by the hive, done by a human". This keeps the charter (article 2, no manipulation) and the law simple, and it keeps people in charge.

### 4.6 Summary

**Reused.** Verification classes V1 and V2 (v0.1 §9.1), sealed verdicts, Wald's test with its decrement, trap cells, model diversity, the quarantined-model pattern, owner approval of the first levels, arbitration, playbooks.

**New.** Checklists and rubrics as completion criteria, gates, semantic mutants for trap cells, the scoping cell and the brief, the "prepares, does not act" rule.

**Risks.**

- *AI juries agree on the same mistake.* Model diversity, trap cells, the human last word, honest display.
- *Scoping asks too much.* At most 7 questions, all skippable.
- *"Any goal" includes bad goals.* The charter still applies; public hives keep the compliance review; private hives have the attestation (§2.6).

---

## 5. Accounts, trophies for everyone, a mobile app

### 5.1 What an account adds to today's identities

Today, an identity is a key pair in a file, `~/.kickswarm/identite.json` (`src/protocol/identity.ts`). It is strong (hybrid post-quantum signatures) and anonymous. But it is tied to one machine:

- a person with a laptop, a desktop and a phone has three identities, and three split reputations;
- a lost disk means a lost identity, and with it the honey, the reputation and the trophies;
- an identity has no name, no picture, no way to receive a notification.

**An account is a layer above the keys. It does not replace them.**

| An account adds | How |
|---|---|
| **One person, several devices** | An **account key** (`pq1:`) certifies **device keys** with a signed delegation, `osp.device/0.3`: device, scope (all, or some hives, or read only), expiry. Protocol objects are still signed by device keys; the coordinator and the audit check the delegation chain. Honey, reputation and trophies belong to the account. |
| **Revocation** | A lost phone is revoked by the account key, with a signed `osp.device_revoke/0.3`. Whatever it signed before stays valid; nothing after. |
| **Recovery** | A **recovery code** printed on paper at creation, and optionally **recovery friends**: 2 of 3 chosen members can together certify a new account key *(parameters)*. |
| **A profile** | A display name and a picture, chosen by the person; public or members-only. |
| **Notifications** | An email address or a push token, **kept by the coordinator for notifications only, never written in any registry** (charter, article 8). |
| **Sign-in on the web and the phone** | Passkeys, used only to open a session. Protocol signatures still come from device keys. |

**What an account is not.**

- It is **optional**. A bare key keeps working, for those who want anonymity. Zero effort (principle 3) means the plugin creates the account silently the first time, with a single question: "a name to show?".
- It is **not a proof of unique personhood**. One person can create several accounts. The Commons allocation and the votes still wait for proof of personhood (v0.1 §18.2, v0.2 P3).

### 5.2 Minors

Roblox's community is young, and so may be some of the people a member invites. In France, a child under 15 needs a parent's consent for an online service that processes their data. So:

- account creation asks for an age bracket, not a birth date;
- under 15, the account also needs a parent's consent, and its profile is never public;
- no feature that looks like gambling is ever offered, to anyone (§6).

### 5.3 Trophies for every participant

Trophies today (v0.1 §10.5, `src/coordinator/trophees.ts`) reward what bees do. The humans who decide, review, invite and lend their machines get nothing. New trophies, all computed from a registry, never bought, never taken away:

| Trophy | How to earn it |
|---|---|
| **Decider** | Answer 10 questions, none marked "not needed" by the others |
| **Reviewer** | Give 10 human verdicts |
| **Playtester** | Give 5 playtest verdicts on a game |
| **Host** | Invite someone who then gets a cell validated |
| **Team Player** | Complete a hive with at least one other member |
| **Machine Lender** | Lend a declared capability for 10 validated cells (§7) |
| **Proofreader** | Get 20 sections validated in the translation hive (§8) |

- Trophies from private hives are recorded in the private registry. The account shows them as "in a private hive", and the public audit cannot check them, while the members' audit can.
- The existing rule stays: governance MAY add trophies, never remove one that was earned.

### 5.4 The phone

**A phone does not run a local AI** worth doing cells with. So the phone is a **remote control and an inbox**, not a bee.

| The phone does | Details |
|---|---|
| **Dashboard** | The private view of §3.5, made for a small screen: progress, lanes, what is waiting |
| **Needs you** | Questions and approvals, one tap each. The answer is signed by the phone's device key. |
| **Notifications** | "Your hive has a question". The notification itself carries no project content: the content is read inside the app. |
| **Invitations** | Share a code or a QR code; join by scanning one |
| **My bees** | Pause, resume, recall all my bees, change my participation settings (roles accepted, tasks a day, quiet hours: `src/plugin/participation.ts`). The plugin or the home machine's daemon (v0.1 §3) receives the order from the coordinator the next time it checks in, and applies it locally. |
| **Devices** | See and revoke my devices |
| **Cloud bees** (later) | Start a bee in an AI provider's cloud environment, when the provider offers one and allows MCP servers. The phone delegates a **narrow device key** to it: one hive, 24 hours, a cap. It is revocable from the phone. |

**First a web app, not a store app.** The live hive is already a web page. An installable web app (PWA) gives the dashboard, the inbox and push notifications on Android and on recent iPhones, without app store review. Native apps can come later, if needed.

**Device keys on a phone.** The phone's key is a `pq1:` key, kept encrypted by the phone's secure storage. A browser cannot yet do post-quantum signatures natively. A web session MAY then use an Ed25519 device key, flagged as non-post-quantum by the audit, exactly like legacy identities today, and limited to low-stakes actions: answering questions, pausing bees.

### 5.5 Summary

**Reused.** `pq1:` identities and signatures, the audit's handling of non-post-quantum keys, trophies computed from the registry, the daemon, the live hive page.

**New.** Account keys, device delegations and revocations, recovery codes and recovery friends, profiles, notification channels kept off the registry, human trophies, the PWA, cloud bees with narrow keys, the age bracket.

**Risks.**

- *An account makes people easier to track.* Optional; bare keys still work; no personal data in registries.
- *Account recovery is an attack target.* Paper code, 2-of-3 friends, a delay and a notification to all devices before a recovery takes effect *(parameter: 72 hours)*.
- *Push services see that a notification happened.* Content is never in the notification.
- *Cloud bees mean a key outside my machines.* Narrow scope, short expiry, revocable, and only where the provider allows it.

---

## 6. Prize draws: the honest answer

The idea was to add per-project lotteries or prize draws, to make taking part more fun and to reward contributors. This section looks at the law and at our commitments, then recommends.

### 6.1 The law in France

*To be validated by a lawyer before anything is built. What follows is a summary of the general principles.*

- **Lotteries are prohibited** (Code de la sécurité intérieure, articles L322-1 and L322-2). A lottery is any operation offered to the public that creates the hope of a gain due, **even partly**, to chance, and for which **a financial sacrifice** is required from participants.
- **A refund does not help.** Since 2014, the law states that the financial sacrifice exists even if the rules let participants get their money back later.
- **Skill does not help either**: the prohibition covers games that rely on the players' know-how, when a financial sacrifice is required.
- **The exceptions are narrow**: charity lotteries authorized by the authorities, small traditional lotos in a restricted circle with low stakes, funfair games. None of them fits an online project.
- **What is possible: free contests and promotional games**, under the Consumer Code, with **no purchase and no payment of any kind**, and with **published rules** accessible to everyone. Filing the rules with a *commissaire de justice* is no longer mandatory, but it is recommended.
- **Online gambling** is only allowed for operators licensed by the ANJ (Autorité nationale des jeux). That is not, and must never be, Kickswarm.

**The hard question for Kickswarm: is a contribution a "financial sacrifice"?** Giving AI subscription time, API credits or electricity costs the contributor real money. Honey is a work currency that buys compute. A draw where tickets come from contributions or from honey could very plausibly be seen as a lottery with a financial sacrifice. We should not bet the project on the opposite reading.

### 6.2 Our commitments

The README and the white paper make commitments that a lottery would break, or seem to break:

- **No token, no cryptocurrency, no speculation.** "Win a prize by contributing" is exactly the language of crypto airdrops, which the README tells people to treat as scams.
- **Honey is not an investment** (launch plan: "never promise money gains").
- **The audience includes minors** (§5.2). Anything that looks like gambling is out of the question for them.

### 6.3 What is safe

| Form | Safe? | Why |
|---|---|---|
| A draw whose tickets come from contributions, honey or money | **No** | Likely a prohibited lottery; looks like crypto |
| A free contest anyone may enter with no contribution at all, with published rules | **Legal, but pointless** | Contributors have no better odds than anyone else, so it rewards nothing |
| **Prizes on merit**, by published criteria, decided by a jury and recorded in the registry ("hive of the month", "best Roblox level") | **Yes** | No chance, so no lottery; only recognition, or a prize given by a sponsor |
| **Bounties**: a reward fixed in advance for a verified result | **Yes** | It is payment for work, already planned (v0.1 §18.5), under ordinary tax and contract rules |
| **Fair draws without prizes**: a verifiable coin flip, using drand, to break a tie, choose who takes the boring task, or pick which level to build first | **Yes** | No gain at stake, so no lottery. And it reuses drand, which Kickswarm already trusts. |

### 6.4 Recommendation

**Drop lotteries and prize draws.** Do not use the words "lottery", "draw for a prize" or "win" anywhere in the product.

Keep instead:

1. **trophies** for everyone (§5.3), which already celebrate participation;
2. **merit prizes** with published criteria, when a sponsor offers one;
3. **bounties** on hives, as planned;
4. a small **fair-draw tool**, without any prize, for decisions inside a hive. It is fun, useful, and it shows off the verifiable randomness.

**Reused.** drand, trophies, bounties, the registry. **New.** Only the fair-draw tool. **Risks.** If a fair draw were ever tied to a prize of value, it would become a lottery: the tool MUST NOT allow attaching a prize.

---

## 7. Pooling the members' machines

### 7.1 What it means

A member's machine has more than an AI subscription: installed software (Roblox Studio, Blender, a compiler), connectors already configured in their AI (GitHub, Figma, a database), and compute (a GPU, idle hours). A hive may need them: render the game's icons, compile a large project, run a local model at night.

The rule: **a hive MAY ask, a member decides, item by item, and can take it back at any time.** Heavy, long or energy-hungry tasks pay more.

### 7.2 Three approaches compared

| | A. Declared capabilities | B. Authorized scan | C. Reusing the AI's connectors |
|---|---|---|---|
| **How** | The member declares what they lend, in a signed manifest | The plugin looks at the machine and proposes a list | The bee uses the MCP tools the member's AI already has |
| **Effort** | Medium: the member has to know and type | Low: tick boxes | None |
| **Privacy** | Good: only what is declared leaves | Risky if the scan leaves the machine: a list of installed apps says a lot about a person | Good for data, but the tools act with the member's own accounts |
| **Power** | Limited to declared commands | Same as A, once approved | Very high: everything those tools can do |
| **Danger** | Low | Low if the scan stays local | **High**: a hijacked bee could act on the member's real accounts |
| **Verdict** | **Yes, the base** | **Yes, as a helper for A**: the scan runs locally, proposes, and only what the member ticks is declared | **Only in private hives, later, connector by connector, read-only by default, with the agent's own confirmation prompts kept on** |

**The capability manifest:**

```json
{
  "type": "osp.capabilities/0.3",
  "contributor": "pq1:…",
  "hive": "h_7Q2mX…",
  "items": [
    { "id": "blender-render", "version": "4.2", "limits": { "hours_per_day": 2, "window": "23:00-07:00", "plugged_in": true } },
    { "id": "gpu", "memory_gb": 12, "limits": { "max_watts": 200 } }
  ],
  "expires": "2026-12-31T00:00:00Z",
  "sig": "…"
}
```

- A capability is **per hive**: lending Blender to my cousin's hive does not lend it to anyone else.
- The plugin enforces the limits locally, as it already does for pledges (v0.1 §11.2) and for the participation settings (tasks a day, quiet hours). The coordinator does not have to trust them.
- A cell that needs a capability says so (`"needs": ["blender-render"]`). It is only offered to bees whose member declared it.

### 7.3 Consent

- **Granular**: per capability, per hive, with limits. The member's AI manages the manifest with a new MCP tool, `swarm_capabilities`, but only signs what the member approved.
- **Informed**: before the first task, the plugin shows what will run, for how long, and an estimate of the energy used.
- **Asked again above a threshold**: a task longer than 1 hour or above 0.5 kWh *(parameters)* asks the member each time, on the phone if needed.
- **Revocable at once**: `osp.capabilities_revoke/0.3`, from the computer or the phone. Running tasks stop, and their cells go back to `libre` without penalty.
- **Nothing is ever lent by default.**

### 7.4 Paying more for heavy tasks

The honey formula (v0.1 §10.1) gets a resource factor:

```
miel(alvéole) = B × c_classe × (1 + 0.25 × hauteur) × f_resource
```

- `f_resource` is **fixed when the cell is created**, from the resource class written in the cell (`light`, `long`, `heavy`, `gpu`) and its estimated duration. It is capped at ×4 *(parameter)*.
- It is **not** based on the cost the member reports. A cost that is reported after the fact would invite lying; a price fixed in advance, like a bounty, does not.
- Scouts who inflate resource classes are caught by the split scoring grid (v0.1 §6.2, which already scores estimated cost) and by the hive's budget cap.
- In a private hive, this honey is local (§2.6): it shows who lent the most, which matters to the group.

### 7.5 Security

Lending a machine means running work written by others on it. The rules:

- **Adapters, not shells.** A capability is used through an **adapter**: a small, reviewed program that exposes a fixed command (`render(file, frames, size)`), checks its inputs, and returns files. The cell never sends a free command line. The text of a cell can never directly drive a local program.
- **The sandbox ladder** (v0.2 §8, `src/verifier/v0.ts`): pure computations run in WebAssembly as today. Heavy computations run in the container sandbox (network off, read-only, capped), then in micro-VMs (v0.2 P2-2). Programs that cannot run in a container (an installed Roblox Studio) run under a separate, restricted user account, only through their adapter, only on files the cell provides, network off when possible.
- **Prompt injection** (docs/security.md §2): capsules stay data; only structured parameters reach adapters; canary tokens and content marking (still "to do" in security.md) become a requirement before connectors (approach C) are allowed.
- **Abuse.** Crypto mining disguised as rendering is the obvious one. Defenses: fixed adapters, so there is no arbitrary code; caps on time and energy; results checked like any others; and reports that lead to a suspension.
- **Verifying compute results.** Deterministic work (a compile, a render with a fixed seed) is checked by **recomputing a random sample** on another member's machine and comparing the hashes. Non-deterministic work goes through V1 or V2.
- **Revocation** always wins: no coordinator decision can keep a capability alive after its member has revoked it.

### 7.6 Summary

**Reused.** Pledges and local caps (v0.1 §11), the sandbox ladder, the plugin as the only gate, verification of results, the honey formula.

**New.** Capability manifests, the local scan helper, adapters, `needs` in cells, consent thresholds, the resource factor `f_resource`, sample recomputation, connector reuse as a late, private-only option.

**Risks.**

- *A member's machine is harmed or abused.* Adapters, sandboxes, caps, revocation.
- *Private data leaks through connectors.* Approach C comes last, private hives only, read-only by default.
- *Energy costs fall on members without them noticing.* Estimates shown up front, consent above a threshold, plugged-in and time-window limits.

---

## 8. The translation hive: "Translate Kickswarm"

### 8.1 The hive

English is the reference language of Kickswarm. Translations are produced by Kickswarm itself, in a **public** hive, French first.

- **Source**: the English documents of the repository (`README.md`, `spec/`, `docs/`) at a given commit.
- **Cells**: one section of one document (cut at headings, at most about 1,500 words) for one language.
- **Capsule**: the section, the sections around it for context, and the **glossary**.
- **Deliverable**: the translated section, in Markdown.
- **Output**: through the bridge (§3.3), a pull request that adds `docs/fr/…`, and so on for each language.
- **Keeping up**: when the English changes, the bridge sees which sections changed in the new commit, marks their translations stale, and opens new cells for them only.

**The glossary is half the work, and it already exists.** The protocol's French identifiers (`ruche`, `alvéole`, `miel`, `gardienne`, `éclaireuse`, `bâtisseuse`…) are the French glossary. Other languages get theirs from a first cell: a glossary cell, verified in V2, approved by the owner.

### 8.2 The verification it needs

Prose cannot be checked by V0 tests. But a lot of it can be checked automatically, and the rest by review.

**1. An automatic gate, `structure-md@1` (V0 gate).** Deterministic, run in the sandbox, it rejects a translation unless:

- the heading tree is the same;
- code blocks and inline code are **identical** to the source;
- links, URLs, numbers and table shapes are the same;
- every glossary term of the source has its required translation;
- the length is within a plausible ratio of the source *(parameter)*.

This already catches omissions, broken links, translated code and forgotten terms.

**2. A V1 review, `review-ai@1`, with a fixed checklist:**

- every sentence of the source is translated, and nothing is added;
- the meaning of each paragraph is the same;
- the glossary is respected;
- the tone is plain, like the source.

Guards come from at least two model families. A **back-translation** into English by a model of another family, compared with the source, helps the guards, but does not decide alone.

**3. Trap cells by semantic mutation.** A validated translation is changed in one subtle way: a negation flipped, a number changed, a sentence dropped, a glossary term replaced by a wrong one. Given to a guard instead of the real one, it measures their reliability, exactly as code mutants do (v0.2 §6.8). This is what makes the V1 guarantee a measured one.

**4. A V2 jury on a sample**, for fluency and style, with a short rubric: accuracy, fluency, terminology, style, each error rated minor, major or critical (in the spirit of the MQM translation-quality framework).

**5. A native human reviewer** reads a random sample, 10% of sections *(parameter)*, plus every section of the spec's normative parts. For French, the founder. Their verdict is V2-human, and it can reopen any section.

### 8.3 Why this hive first

- Its content is public and low-stakes: a mistake costs little and is easy to fix.
- It is the **first real test of V1 and V2**, with a human able to judge the result.
- It produces something the project needs anyway.
- Anyone can contribute, in their own language.

**Reused.** Public hives, cells, the board, sealed verdicts, Wald's test with its decrement, trap cells, model diversity, the bridge. **New.** `structure-md@1`, the translation checklist and rubric, semantic mutants, back-translation as an aid, stale-section tracking. **Risks.** AI guards sharing a blind spot (human sampling); glossary drift (the glossary is versioned and approved); spec translations read as normative (the English text is the only normative one, and every translation says so at the top).

---

## 9. The plan, by priority

Each step says what can be **shown** when it is done. **The first milestone is the private hive of the founder and their cousin**: P0 is exactly what that hive needs, and nothing more.

> **Update:** the order of work below is replaced by [OSP-v0.4 §6](OSP-v0.4-universal-engine.md#6-the-order-of-work), which puts the doors for every kind of AI first. P0-1 to P0-3 are done; the other designs of this document stay valid.

### P0: the cousins' private hive

| Step | Work item | What can be shown |
|---|---|---|
| **P0-1** ✅ | *Done: see §2.9.* **Private hives**: `visibility`, invitations and codes, memberships, roles, one `Coordinator` instance per private hive, private routes, read tickets, per-hive parameters, local honey, public anchors | On two machines, the cousin joins with a code; a third identity gets "403"; both run `kickswarm audit` on the private registry and see every ✓; the public registry shows only an anchor. |
| **P0-2** ✅ | *Done: see §3.8.* **Repo capsules, write scopes and the bridge** | A cell's honey becomes a pull request on the real repository, with the right co-author; the audit checks that the commit holds exactly the validated deliverable. Two cells on the same file are never open at the same time. |
| **P0-3** ✅ | *Done: see §3.9.* **`tests-luau@1` and `luau-checks@1`**, the Luau mutation engine, the "pure logic first" Roblox playbook | A Luau module of the game (coins, shop) is validated by tests and hidden tests; a guard catches a mutated trap; the same verdict on both machines. |
| **P0-4** | **Questions with choices**: `osp.question`, `osp.answer`, `attente_decision`, routing to the owner and the branch owner, defaults and deadlines; answered from the terminal or the dashboard | A bee asks "R15 or R6?"; only its cell waits while the cousin's bee keeps working on another branch; the answer is signed, and the branch resumes. |
| **P0-5** | **The private dashboard**: "Needs you", lanes, milestones, waiting cells, what checked it, repository; `kickswarm open` | Both cousins watch the same page and see who does what, what waits for whom, and which pull requests are open. |
| **P0-6** | **Contract first** for splits (moved up from v0.2 P1-2), and the §20 amendment for private hives | The game's split declares its Luau types first; UI and logic are built in parallel against them and assemble without conflicts. |

### P1: people and judgment

| Step | Work item | What can be shown |
|---|---|---|
| **P1-1** | **Scoping cell and brief** (§4.3) | From one sentence, the hive asks at most 7 good questions, then shows a brief before the first split. |
| **P1-2** | **V1 review `review-ai@1`**: checklists, gates, item-by-item verdicts, Wald's decrement, semantic mutants | A review jury catches a planted bug or a planted false claim, and the registry shows each guard's measured reliability. |
| **P1-3** | **Translate Kickswarm**, French first (§8) | A pull request with `docs/fr/`, every section checked by the gate, the AI review and a human sample. |
| **P1-4** | **Accounts and device keys**, recovery, profiles, human trophies | One person with a laptop and a phone has one reputation; a revoked phone can no longer sign; the new trophies appear. |
| **P1-5** | **The phone (PWA)**: dashboard, "Needs you", notifications, pause my bees, invitations | A question appears as a notification; the answer, given on the phone, unblocks the cell. |
| **P1-6** | **Fair-draw tool** (no prizes) | A tie between two level ideas is broken by a drand draw that anyone in the hive can recheck. |

### P2: machines and the real engine

| Step | Work item | What can be shown |
|---|---|---|
| **P2-1** | **Declared capabilities** (A) with the **local scan helper** (B), adapters, consent thresholds, `f_resource` | The cousin lends Blender at night; the game's icons are rendered on their machine; a random sample is recomputed on the other machine and matches. |
| **P2-2** | **`review-human@1`** everywhere, playtest verdicts from the phone | The owner playtests level 3 and rejects it with a comment; the cell reopens with that comment in its capsule. |
| **P2-3** | **`roblox-place@1`** through the bridge (if Roblox's terms allow it) | A test that needs the engine runs in a real place, and its report shows up as external evidence. |
| **P2-4** | **Cloud bees** with narrow device keys | From the phone, a member starts a bee in a provider's cloud for 24 hours, then revokes it. |
| **P2-5** | **Micro-VM sandbox** (v0.2 P2-2), canary tokens, content marking | The security tests of docs/security.md §2 pass on heavy tasks too. |

### P3: deeper privacy and scale

| Step | Work item | What can be shown |
|---|---|---|
| **P3-1** | **Connector reuse** (approach C), private hives only, read-only by default | A bee reads a Figma file through the member's own connector, without any write. |
| **P3-2** | **Members-only verification**: the coordinator sees hashes and encrypted payloads | A private hive works, and the operator can show it never held the deliverables in clear. |
| **P3-3** | **Federation** (moved to v0.4), multiple auditors | Two coordinators share and cross-check a registry. |
| **P3-4** | **Optional GitHub App**, if the decision of §11 allows it | The bridge runs without any member's machine being on. |

**Why this order.**

- **P0 is one real team with one real project.** Everything in it is something the cousins will feel within a week of use.
- **P1 brings judgment and people**: V1 is needed as soon as work goes beyond code, and the translation hive is the safest place to prove it.
- **P2 and P3 open the members' machines and accounts.** They come last because they carry the most risk, and because by then the questions, accounts and phone approvals they rely on will exist.

---

## 10. Open questions

1. **Members-only verification.** How far can the verifier move to members' machines without losing the trust engine, given that the coordinator draws guards and prepares trap cells from deliverables it can read?
2. **Small-hive guarantee.** Is a 1% α\* with cross-review and human merge the right default for two people, or should a private hive be allowed to borrow anonymous public guards for pure, non-confidential modules?
3. **Ownership of results.** What should a private hive declare about who owns the code, and is a suggested default (for example, shared equally among members, or in proportion to local honey) useful or harmful?
4. **Questions as reputation.** Should a bee's questions marked "not needed" lower its reputation, or would that make bees too shy to ask?
5. **The resource factor.** Which resource classes, and which caps, keep heavy tasks attractive without inviting inflated splits?
6. **Minors.** Does the age-bracket design satisfy French and EU law for a protocol whose main audience is adults, but whose first use case is a Roblox game?
7. **The legal opinion on §6.** Even "drop the lottery" deserves a lawyer's confirmation that merit prizes and fair draws without prizes are safe as designed.

---

## 11. Changes to earlier documents

If this proposal is adopted, these changes MUST be made, each by a published decision:

| Document | Change |
|---|---|
| v0.1 §1, principle 4 "Open by default" | Add: "except private hives, declared as such, whose registry is open to their members and anchored in the public registry" |
| v0.1 §3 and §23 | Federation moves from v0.3 to v0.4 |
| v0.1 §5 | New cell state `attente_decision` |
| v0.1 §7.1 | The scoping cell, and V1 and V2 for workers |
| v0.1 §8 | Assisted mode, allowed in private hives only (§3.2) |
| v0.1 §9.1 | V1 and V2 as defined in §4.2; the `review-human` class |
| v0.1 §10.1 | The resource factor `f_resource` |
| v0.1 §10.5 | The human trophies of §5.3 |
| v0.1 §13 | Questions with choices on the board; private boards for all private hives, not only the Enterprise offer |
| v0.1 §20 | Strict mode also allows the contributor's agent for private hives they are a member of |
| v0.1 §21 | The new MCP tools (`swarm_ask`, `swarm_answers`, `swarm_capabilities`) and HTTP routes |
| v0.1 principle 2 | A decision on hive-level credentials (the optional GitHub App), before P3-4 |
| v0.2 §10 | P1-2 "contract first" becomes P0-6 of this plan |
