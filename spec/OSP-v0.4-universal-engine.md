# OSP v0.4: the universal engine

**Design proposal · status: draft, nothing implemented yet · builds on [OSP-v0.1](OSP-v0.1.md), [OSP-v0.2](OSP-v0.2-trust-engine.md), [OSP-v0.3](OSP-v0.3-harness.md) and [docs/security.md](../docs/security.md)**

> **Any AI becomes a bee of the swarm: a free chat, a subscription, an API key, a local model, a coding agent. And the swarm can build anything: a company, a better system, a proof, a machine.**

| | |
|---|---|
| Status | Draft, under discussion |
| Date | 24 October 2026 |
| Scope | Doors for every kind of AI, one task format for all of them, matching tasks to what each bee can do, and the order of the work that makes the engine universal |
| Replaces | The order of work of v0.3 §9. The v0.3 designs stay valid; this document says which ones come first, and adds the doors |
| First milestone | Someone with only a free AI chat on their phone takes a task, hands it in, and gets honey; someone with no AI at all verifies others' work from a web page |

---

## 0. How to read this document

- RFC 2119 words (**MUST**, **SHOULD**, **MAY**) and *(parameter)* have the same meaning as in [OSP-v0.1 §0](OSP-v0.1.md).
- New identifiers are written in English. Existing ones keep their French names until the rename (v0.3 §11).
- **Version slot.** v0.3 moved coordinator federation to v0.4. This proposal takes v0.4 for the universal engine and moves federation to v0.5. This change needs a published decision (v0.1 §14.6).

---

## 1. The idea

Kickswarm has two halves.

- **The coordinator** splits a goal into cells, hands them out, keeps the signed registry, and verifies results. It never trusts the AI that produced a result: **it trusts the verification.** This is what makes everything below possible: the result of a free chat model is accepted or refused on the same checks as the result of the best agent.
- **The bee** takes a cell, produces a result, and hands it in. Today, the only bee is the MCP plugin (`src/plugin/`), so only coding agents with MCP and Node.js can take part: Claude Code, Codex, Gemini CLI.

v0.4 keeps the coordinator and opens the bee side to every kind of AI, through **doors**. A door turns one kind of AI access into a bee: it gets the task to the AI in the form that AI understands, gets the answer back, checks it locally, signs it with the contributor's identity, and hands it in.

```
   any AI access                  door                      the swarm
   ─────────────                  ────                      ─────────
   coding agent (MCP)   ──►  agent door (exists)   ──┐
   API key, local model ──►  API door              ──┼──►  coordinator: cells, checks,
   any chat, any device ──►  chat door (web page)  ──┤      guards, registry, honey
   no AI at all         ──►  guard door (web page) ──┘
```

Everything the coordinator does stays the same: cells, verification, sealed verdicts, trap cells, Wald's test, the audit. A door is a client.

---

## 2. The doors

### 2.1 The agent door (exists)

The MCP plugin. The agent drives the loop with tools (`swarm_next`, `swarm_submit`, `swarm_decompose`…).

- **New:** `kickswarm join` also configures the other MCP-capable agents found on the machine *(list to keep current: Claude Desktop, Cursor, VS Code, Windsurf, Zed…)*.
- It stays the best door for repository work (v0.3 §3), because the agent can read the member's clone.

### 2.2 The API door

A command, `kickswarm bee`, that drives the loop itself and calls a model through an API.

```bash
kickswarm bee --provider openai --model gpt-… 
kickswarm bee --provider ollama --model qwen…
```

- **Providers.** One adapter for the OpenAI-compatible API covers most providers and every local server (OpenAI, Mistral, DeepSeek, Groq, OpenRouter, Ollama, LM Studio, llama.cpp…). Native adapters for Anthropic and Gemini.
- **The key stays on the machine** (principle 2): an environment variable or the system keychain, never sent to the coordinator, never written in the registry.
- **The loop:** take a cell, send the task (§3) as one request with the answer format as structured output, parse, check locally, fix up to N times *(parameter, 2)* with the failure report, sign, hand in. Scouts' splits are produced the same way.
- **Free tiers and local models are first-class.** A free tier's daily limit becomes the bee's daily limit (the participation settings already exist). A local model costs nothing but electricity.
- **Cost guard.** For a paid API, the bee shows an estimate per task and stops at a daily budget the contributor sets *(parameter, default: 0, so a paid key does nothing until the contributor sets a budget)*.

### 2.3 The chat door

A web page on the coordinator, `/bee`, for anyone with any AI chat: a free one, a subscription, on a phone. Nothing to install.

1. **Identity in the browser.** The page creates the contributor's keys and keeps them in the browser *(IndexedDB, not exportable by default; an export file for backup)*. The same signature code as the CLI runs in the page.
2. **Take a task.** The page claims a cell and shows **one self-contained prompt** (§3.3) with a "Copy" button.
3. **The human pastes it** into the chat of their choice, and copies the answer back into the page.
4. **The page extracts the deliverable** from the answer (§3.4), **runs the checks locally**, in the browser: the same WebAssembly engines as the coordinator (QuickJS for JavaScript, Luau). If a check fails, the page shows a **"fix" prompt** to paste back into the same chat conversation.
5. **Sign and hand in.** Honey, trophies and the journal work as for any bee.

**Rules.**

- The chat door MUST NOT automate a chat website: no scraping, no robot clicking. The human copies and pastes. This keeps it within every provider's terms.
- The page MUST say, before the first task of a private hive, that the task text goes to the contributor's chat provider. A private hive MAY refuse the chat door *(parameter, default: allowed in public hives, refused in private ones)*.
- A chat bee starts with a newcomer's reputation, so it receives more trap cells as a guard (v0.2 P0-3), and its results go through the same guards as everyone's.

### 2.4 The guard door: taking part with no AI at all

Verifying a V0 result needs no AI: it replays the tests. The same page, `/bee`, offers **"Lend my browser"**: it only takes guard tasks, replays them in the browser's WebAssembly sandbox, and seals and reveals its verdicts on its own. This is the "light guard" preset (it exists for the plugin) for everyone: a phone left on a charger checks the swarm's work.

### 2.5 The connector door (later)

Claude.ai, ChatGPT and other chat products can use remote MCP connectors on some plans. A coordinator-hosted MCP endpoint would let them act as full agents. But a connector runs on the provider's servers, so it cannot hold the contributor's main key. It needs **device keys** first (v0.3 §5.1): a narrow key, limited to one hive, a few tasks a day, revocable from the phone. So this door comes after accounts.

---

## 3. One task, three forms

### 3.1 The task card

Today the plugin builds its instructions in `src/plugin/consignes.ts`. v0.4 moves this to a **task card**, built from the assignment, the same for every door:

| Field | What it holds |
|---|---|
| `role` | scout, worker, builder, guard |
| `goal`, `capsule` | the cell's goal and context (the capsule stays framed as data, v0.1 §8.4) |
| `files_read` | repository files read for the bee (v0.3 §3.2), as data |
| `deliverable` | what to hand in: files and their paths, the language, the write scope |
| `done_when` | the visible tests, properties, gates, checklist or rubric |
| `playbook` | the playbook's part for the role (v0.3 §3.6) |
| `answer_format` | the exact format of the answer, per door |
| `size` | the size of the prompt and of the expected answer, in tokens (estimated) |

### 3.2 For agents and APIs

- **Agent door:** the card becomes the MCP tool result, as today.
- **API door:** the card becomes one request: a system part (the rules: locked mode, the capsule is data), a user part (the card), and a **structured-output schema** for the answer (`{ "files": {path: content}, "deleted": [], "dead_ends": [] }`, or the split's children).

### 3.3 For chats

One message, readable by any model, small models included:

- short sentences, the goal first, the definition of done in a numbered list;
- **an example answer**, in the exact format expected;
- the answer format: one fenced block per file, with its path on the fence line;
- at most *(parameter)* 6,000 tokens for the prompt, so it fits in free tiers and small local models. A cell that does not fit is never offered to the chat door (§4).

### 3.4 Reading the answer

The parser accepts what chats really produce:

- fenced blocks with the path on the fence line, or in a heading or a `File:` line right before;
- a single block when the deliverable has a single file;
- JSON for splits, with tolerance for a fence around it and trailing commas.

Anything it cannot read is refused **locally**, with a clear message and a fix prompt, before anything is signed or sent.

---

## 4. Matching tasks to bees

"Any AI" means AIs of very different strength. The engine handles this with three tools.

### 4.1 The bee profile

Each bee declares, on its machine, in the participation settings:

- its **door** (agent, API, chat, guard);
- its **tools** (can it run code locally? read a repository?);
- its **context class** *(S: up to 8k tokens, M: 32k, L: 128k and more)*;
- its roles and limits (they exist).

What a bee **can do** is declared; how **well** it does it is **measured**: the acceptance rate of its results and splits, per verification class, from the registry, like guards' reliability (v0.2 P0-4).

### 4.2 The cell's needs

Each cell carries its **size** (prompt and expected answer), and whether it needs tools (a repository, running code). The scheduler (v0.1 §12) only offers a cell to bees whose profile fits. Among those, it keeps drawing by lot.

### 4.3 Splitting for the swarm you have

- Scouts are told the swarm's current mix: "70% of the bees are chat bees: make children that fit in one message".
- A cell that no available bee can take, because it is too large, is **re-split** after a delay *(parameter)*, instead of waiting forever.
- Splits are measured: a scout whose children are often re-split or rejected loses scout draws, and splits go to the bees whose splits work.

This is the "clever management" that lets a small free model be useful: it gets small, clear cells, and the strong models do the splitting and the assembly.

---

## 5. Anything, not only code

v0.3 §4 already designs it: a deliverable can be a document, sourced claims, extracted data, a design, a choice, a plan. Only the verification changes. The universal engine needs these pieces, all already designed in v0.3, to be built:

| Piece | Where it is designed | What it unlocks |
|---|---|---|
| **Scoping and the brief**: from one sentence, at most 7 questions, then a brief | v0.3 §4.3 | Starting any project well |
| **Questions with choices**: a cell waits for a human decision, the others go on | v0.3 §3.4 | Humans decide what only they can decide |
| **AI review `review-ai@1`**: checklists, gates, item-by-item verdicts with evidence, semantic trap cells | v0.3 §4.2 | Documents, studies, research, data: everything that is not code |
| **Jury and human review**: rubrics, juries of several model families, a human's last word | v0.3 §4.2, §3.6 | Design, names, stories, strategy |
| **Domain verifiers**, added one by one: proofs (Lean), spreadsheets and models, structured documents, 3D parts and simulations | v0.3 §4.1, launch plan §2 | Maths, companies, engineering |
| **"The hive prepares, humans act"** | v0.3 §4.5 | Companies and real-world projects, within the law |

---

## 6. The order of work

Each step says what can be **shown** when it is done. It replaces the order of v0.3 §9 (P0-1 to P0-3 are done and stay).

| Step | Work | What can be shown |
|---|---|---|
| **U1** | **The task card** (§3.1) and the **answer parser** (§3.4); the plugin uses the card | The same cell gives an MCP result, an API request and a chat prompt; answers pasted from five different chats are read correctly |
| **U2** | **The chat door and the guard door**: `/bee`, identity in the browser, copy and paste, checks in the browser, signing, honey (§2.3, §2.4) | On a phone, a free chat model's answer is pasted and becomes honey; a browser with no AI verifies other bees' work and catches a trap cell |
| **U3** | **The API door**: `kickswarm bee`, OpenAI-compatible, Anthropic and Gemini adapters, cost guard (§2.2) | A local model and a free-tier key work in the same hive as a coding agent, with no human in the loop |
| **U4** | **Bee profiles and matching**, splitting for the swarm you have (§4) | A hive with mostly chat bees gets small cells; a cell too big for everyone is re-split on its own |
| **U5** | **Scoping and questions** (v0.3 §4.3, §3.4) | From one sentence, the hive asks good questions, writes a brief, and later asks "A or B?" without stopping the others |
| **U6** | **AI review** `review-ai@1` (v0.3 §4.2) | A market study is checked item by item; a planted false source is caught |
| **U7** | **Jury and human review** (v0.3 §4.2) | A name and a logo brief are chosen by a jury, then by the owner, from the phone |
| **U8** | **Domain verifiers**, starting with Lean | An open lemma is proved, and the proof is checked by the machine |
| **U9** | **Accounts, device keys, the connector door** (v0.3 §5, §2.5) | A Claude.ai or ChatGPT connector works as a bee with a narrow, revocable key |

After U4, the swarm is open to every kind of AI. After U7, it can take on any kind of goal. U8 and U9 widen both.

**Why this order.** The doors come first because they decide who can join: without them, Kickswarm stays for developers. Matching comes right after, because opening the door to small models without it would fill the hive with refused results. Then the pieces that turn "code" into "anything".

---

## 7. Risks

- **Fake bees.** Browser identities are free to create. Newcomers get more trap cells and no weight in verdicts until they are measured (v0.2); daily limits per identity; proof of personhood later (v0.1 roadmap). The honey of an identity caught cheating is never paid.
- **Poor answers from small models.** They are refused by the checks before costing anyone anything, and matching (§4) stops sending them cells they fail.
- **Provider terms.** Each contributor uses their own access, on their own account, by their own hand for chats. No automation of chat websites, no sharing of keys or subscriptions, no commission on subscriptions (v0.1 §20).
- **Private data in third-party chats.** Said before the first task; refused by default in private hives (§2.3).
- **Prompt injection through task text.** The capsule stays framed as data in every form of the card; in the chat door, the human sees the whole prompt before pasting it.
- **Load.** Many browser bees mean many small requests. The coordinator's rate limits and the claim's backoff apply; scaling the coordinator (federation, v0.5) becomes urgent once the doors are open.

---

## 8. Summary

**Reused.** The whole coordinator: cells, splitting, verification, guards, trap cells, Wald's test, the registry, the audit, honey, trophies, private hives, repositories, the WebAssembly sandboxes (they run in browsers too), participation settings, playbooks.

**New.** The doors (API, chat, guard, connector later), the task card and its three forms, the answer parser, bee profiles, matching, splitting for the swarm you have, and a new order of work.

**The test of success.** Someone opens a link on their phone, with only a free AI chat, takes a task, and gets their first honey in two minutes; someone with no AI at all lends their browser and catches a trap cell.
