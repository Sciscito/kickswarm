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

### 2.6 The local engine: all your free AI, for you first, then for the swarm

The API door grows into a **local engine**: one program on the contributor's machine that gathers every AI access they are allowed to automate, uses it for **them** first, and lends what is left to the swarm.

**What it gathers.**

- **Free API tiers**, one key per provider: OpenRouter's free models, and the free tiers of providers that offer one (Gemini, Mistral, Groq…). Their limits change often: the engine reads them from each answer (rate-limit headers, `429` with `Retry-After`) rather than trusting a fixed table.
- **OpenRouter's free models, found automatically.** The engine reads OpenRouter's model list and takes every model whose price is zero, including models offered free for a test period. A new free model is used the day it appears; a model that stops being free is dropped.
- **Local models** (Ollama, LM Studio, llama.cpp): free, unlimited, and private.
- **Paid keys**, only with a budget the contributor sets *(parameter: paid calls per day, default 0)*.

**What it never does.** It never drives a consumer chat website or app (ChatGPT, Claude.ai, Gemini…): their terms forbid it, and those stay with the chat door, by hand (§2.3). It never uses several accounts of the same provider to multiply quotas: one key per provider and per person.

**The pool.** Each model has a state: the requests used today, a cooldown after a `429`, its context size, and its **measured quality** (§2.6, leaderboard). For each request, the engine picks, among the models that fit (context, privacy), the best one that still has quota; on a refusal it moves to the next, and ends with a local model if there is one.

**You first.** The engine opens a **local endpoint** on the contributor's machine (`127.0.0.1`, an OpenAI-compatible API, protected by a token stored next to the identity). The contributor's own tools (editors, chat apps, scripts) point at it and get **all their free AI behind one address**. Personal requests always come first: while one is running, the swarm work pauses, and a share of each daily quota is kept for personal use *(parameter, default 30%)*. What is left goes to the swarm.

**Privacy.** Some free and test models may be used by their provider to train its models.

- Each provider is marked **confidential** or not. Local models are confidential. Free tiers are **not** confidential by default; the contributor MAY mark one confidential if its terms say so.
- Tasks of a private hive go only to confidential models.
- Personal requests go only to confidential models, unless the contributor allows free models for their personal use *(parameter, default: allowed, with a warning at start)*.

**The leaderboard of free models.** Every result says which model produced it (`agent.modele`), and the swarm verifies every result. So the coordinator can publish, from the registry alone, **how each model really does**: results handed in, validated, refused, per verification class. The engine uses it to rank models, and anyone can read it (`GET /v0/models`, and on `/bee`). It answers a question nobody answers today: *which free model actually gets things right?*

### 2.7 The automatic door: join in one click, the engine does the rest

Copying prompts by hand is the fallback, for a chat on a phone. The main way in is automatic.

1. **A project page or a shared link** (`/join/<hive>`): "Join".
2. **The first time, one command** (`npx kickswarm join <hive>`). It finds what this machine can lend, asks before using each, connects OpenRouter in one click, and starts the engine in the background. Start at login is offered, off by default.
3. **After that, one click**: the project page sees the engine running on the computer and opens the engine's own confirmation page. One "Yes", and the engine takes tasks from that project too.
4. **The engine works on its own**: one bee per AI lent, within the coordinator's limit per contributor, each AI within its daily share, the contributor's own use first.

**Subscriptions through their official tools.** A Claude subscription works through Claude Code, a Google account through Gemini CLI, a ChatGPT subscription through Codex: these are the providers' own tools, made to be run by programs. The engine runs them headless, locked down as far as each tool allows, because tasks are written by strangers:

- **Claude Code**: `--tools ""`, every tool and every MCP tool denied, no MCP server, `--safe-mode` (no memory files, hooks, plugins, skills), no prompt, no saved session, one turn.
- **Gemini CLI**: plan mode (no shell, no writes), no extension, no MCP server.
- **Codex**: its read-only sandbox still lets it run commands that read the machine's files, and it has no switch to turn the shell off. A task could make it read a private file and put it in its answer. It MUST NOT be used unless the contributor explicitly accepts that risk.

Every run happens in a fresh empty folder, with the prompt on stdin. If a tool does not know a locking option (an old version), the run fails: it never runs unlocked. Subscriptions serve the swarm only (the contributor already uses these tools directly), each with a modest daily share *(parameter: 10 tasks for Claude Code and Codex, 20 for Gemini CLI)*, and never private hives (consumer plans may train on prompts).

**Consumer chat websites and apps are never driven** (chatgpt.com, claude.ai, gemini.google.com and their apps): their terms forbid it, and it would add nothing, since it is the same subscription as the official tool.

**Your swarm power.** The engine's page (`http://127.0.0.1:7790`) shows what the contributor lends and what it gives: AIs lent, bees working at once, tasks a day, honey earned, and a level (Egg, Larva, Worker, Forager, Queen), with a pause button and the projects joined.

**Safety of the local pages.** Any page may only ask whether an engine runs (`/v0/engine`). Every other local page answers only under the engine's own address, so DNS rebinding cannot reach it. Every change needs a request from the engine's own page (its `Origin`), and a join confirmation carries a one-time token. No website can make an engine join a project, pause or leave.

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
| **U1** ✅ | *Done: see §6.1.* **The task card** (§3.1) and the **answer parser** (§3.4); the plugin uses the card | The same cell gives an MCP result, an API request and a chat prompt; answers pasted from five different chats are read correctly |
| **U2** ✅ | *Done: see §6.1.* **The chat door and the guard door**: `/bee`, identity in the browser, copy and paste, checks in the browser, signing, honey (§2.3, §2.4) | On a phone, a free chat model's answer is pasted and becomes honey; a browser with no AI verifies other bees' work and catches a trap cell |
| **U3** ✅ | *Done: see §6.2 and §6.3 (the automatic door, §2.7).* **The API door and the local engine**: `kickswarm bee`, OpenAI-compatible and Anthropic adapters, the pool of free providers, OpenRouter's free models found automatically, quotas, the personal endpoint, the leaderboard of free models, the cost guard (§2.2, §2.6) | A local model and a free-tier key work in the same hive as a coding agent, with no human in the loop; the contributor's own editor uses the same free models through one local address; the leaderboard shows which free model gets things right |
| **U4** | **Bee profiles and matching**, splitting for the swarm you have (§4) | A hive with mostly chat bees gets small cells; a cell too big for everyone is re-split on its own |
| **U5** | **Scoping and questions** (v0.3 §4.3, §3.4) | From one sentence, the hive asks good questions, writes a brief, and later asks "A or B?" without stopping the others |
| **U6** | **AI review** `review-ai@1` (v0.3 §4.2) | A market study is checked item by item; a planted false source is caught |
| **U7** | **Jury and human review** (v0.3 §4.2) | A name and a logo brief are chosen by a jury, then by the owner, from the phone |
| **U8** | **Domain verifiers**, starting with Lean | An open lemma is proved, and the proof is checked by the machine |
| **U9** | **Accounts, device keys, the connector door** (v0.3 §5, §2.5) | A Claude.ai or ChatGPT connector works as a bee with a narrow, revocable key |

After U4, the swarm is open to every kind of AI. After U7, it can take on any kind of goal. U8 and U9 widen both.

### 6.1 What is implemented (U1, U2)

- **One verifier core** (`src/verifier/coeur.ts`): validation, the runners, the suites, the reports and test strength now have no Node dependency. Only the executors differ: Node's thread, process and container sandboxes (`v0.ts`), or a browser (`src/web/executeurs.ts`). The engines' runs are shared too (`quickjs-exec.ts`, `luau-exec.ts`, `luau-checks.ts`). A test checks that a browser and the coordinator give the same verdicts, in JavaScript and Luau.
- **Isomorphic protocol.** SHA-256 and git hashes come from the audited `@noble/hashes`, in place of Node's crypto: same values everywhere. Requests, results and sealed verdicts are built by one module (`src/protocol/objets.ts`) for a Node key or a browser key.
- **Browser identity** (`src/protocol/identite-web.ts`): the same hybrid `pq1` identity as the CLI (Ed25519 + ML-DSA-65), with `@noble/curves` and `@noble/post-quantum`, pinned. Node verifies its signatures like any other. The keys stay in the browser's storage; a button saves a backup file.
- **Claim by caste.** A claim MAY list the castes the bee takes (`castes`). The chat door asks for workers and builders, the guard door for guards. Without the field, a claim behaves as before, so older registries replay the same.
- **The task card** (`src/taches/fiche.ts`, U1) gives the agent text (the plugin's instructions), an API request (system, user, structured-answer schema) and one chat message, with an example answer, the capsule framed as data, the playbook, and a size estimate. A card over 6,000 tokens is not offered to the chat door. Scouts get their card with the API door (U3).
- **The answer reader** (`src/taches/lecteur.ts`, U1): paths on the fence line, in a title attribute, in a bold or heading line before; a single unnamed block; `~~~` fences; `DELETE:` lines inside the write scope; JSON with a fence or trailing commas. Five chat styles are covered by a test.
- **The page `/bee`** (`web/bee.html`, U2), served by the coordinator with no build step: its modules come from `/app/…` (this package's compiled code, or compiled on the fly when the coordinator runs from its sources), and the libraries from `/vendor/…`, by an allowlist, through an import map. The chat door takes a task, shows the prompt with a Copy button, reads the pasted answer, checks it in the browser, gives a fix message when it fails, signs and hands it in. The guard door verifies, seals, reveals and catches traps. It was tried in a real browser at phone width, and `scripts/dev-bee.ts` starts a local coordinator with two demo hives.

**Different from §2.3 and §2.4, for now:**

- **The plugin still builds its own text.** The card's agent form is that text (`texteAgent`); moving the plugin onto the card's fields comes with the API door, which shares the same loop.
- **Public hives only.** The chat door does not open private hives yet; it will with read tickets in the browser, behind the consent of §2.3.
- **Repository cells that read files are not offered to the chat door**: the browser has no clone. Cells that only write can be.
- **The keys are kept in `localStorage`**, not in a non-exportable store: simple and portable, but readable by a script running on the same page. The page loads only its own modules and pinned libraries.

### 6.2 What is implemented (U3)

- **Providers** (`src/moteur/fournisseurs.ts`): one adapter for OpenAI-compatible APIs (OpenRouter, Gemini, Groq, Mistral, Ollama, LM Studio, OpenAI, or any address given with `--base`) and one for Anthropic. Model discovery: OpenRouter's zero-price text models (test models included, embedding and audio models left out), a provider's `/models` list, or a fixed list for paid keys. Refusals become pauses: `Retry-After`, `x-ratelimit-reset-…`, then a backoff doubling up to an hour; a bad key, no credit or an unknown model sets the model aside for the day.
- **The pool** (`src/moteur/pool.ts`): per request, the models that fit (context, privacy, quota) ranked cloud first, local last, then by measured quality (the leaderboard, with a prior), then by context. On a refusal, the next model. Quotas are counted per key per day; when a provider's daily limit is known (`--per-day`), the swarm stops at 70% of it *(parameter)*. Paid models serve the swarm only within the paid budget (default 0).
- **You first**: a personal request pauses the swarm while it runs and for 10 s after it.
- **`kickswarm bee`** (`src/moteur/abeille.ts`): reveals sealed verdicts, verifies others' results (no AI), then takes a writing task sized for the largest context it has, asks the pool, checks the answer locally, sends the failure report back up to twice, then hands in (`agent: { famille: "api", modele: "<provider>/<model>" }`) or gives the task back. It follows the participation settings (roles, pause, quiet hours, daily limit). It uses the same door client as the chat door, with the CLI's identity.
- **The personal endpoint** (`src/moteur/serveur.ts`): `127.0.0.1` only, a token compared in constant time, `/v1/models` (with `auto`) and `/v1/chat/completions`, passed through to the provider with streaming, trying the next model on a refusal before anything is sent. With `--personal-free off`, only confidential models (local, paid) serve personal requests.
- **The leaderboard** (`GET /v0/models`, and a table on `/bee`): per declared model, results handed in, validated, refused, in progress, and a score with a prior. The engine reads it to rank its models.
- **Settings** (`src/moteur/config.ts`, `kickswarm engine add|remove|set|serve`): `~/.kickswarm/moteur.json`, keys from the file or the environment, local servers always tried and skipped quietly when off.

**Different from §2.2 and §2.6, for now:**

- **The model is declared by the bee.** The leaderboard trusts `agent.modele`; a bee could lie about it. A lie does not change verification, only the ranking; signed attestations from providers do not exist.
- **The cost guard counts paid calls, not money**: prices differ by provider and are not all published in an API.
- **Answers use the chat format** (code blocks) rather than structured outputs: every model, small and free ones included, can follow it, and the reader already handles it. The card's API form (§3.2) stays for providers that support schemas.
- **Scouts and repository cells that read files are not taken yet**: splits need U4's matching to go to models that do them well; reading files needs the member's clone (v0.3 §3.2).

### 6.3 What is implemented (the automatic door)

- **Subscription tools** (`src/moteur/agents.ts`): the Claude Code, Gemini CLI and Codex drivers with the locks of §2.7. On Windows the command line is built and quoted here (the tools are `.cmd` shims) and passed verbatim to `cmd.exe`. Login, limit and old-version messages become what the pool needs: set aside, paused for an hour, or "update it".
- **One-click OpenRouter** (`src/moteur/openrouter-oauth.ts`, `kickswarm engine connect openrouter`): OpenRouter's OAuth with PKCE (S256), a one-time callback on `localhost`, and the key saved to the engine's settings.
- **Detection and the swarm power** (`src/moteur/detection.ts`): the tools installed, local servers that answer, the keys given, and a level. Free API tiers with unknown limits are counted at 50 tasks a day.
- **The engine step of `kickswarm join`** (`configurerMoteur`): it shows the power, asks for each subscription (Codex defaults to no, with the risk spelled out), offers OpenRouter in one click, starts the engine, and offers start at login. With `--yes`: the safe defaults (subscriptions and local models lent, no browser, no start at login). `join` no longer stops when no coding agent is installed.
- **Background** (`src/moteur/service.ts`, `kickswarm engine start|stop|status|autostart on|off`): a detached `kickswarm bee` with its log and pid next to the identity; start at login through the usual per-user file of each system (Startup folder, LaunchAgent, autostart entry).
- **Several bees at once** (`kickswarm bee`, `--bees` in the settings): one per AI lent, at most the coordinator's limit per contributor. They rotate over the projects joined, read at each round, and keep their sealed verdicts in a file, so a restart can still reveal them.
- **The engine's pages** (`src/moteur/tableau.ts`): the swarm-power dashboard and the join confirmation, with the protections of §2.7. The project page (`/join`) offers "Join with my engine" when an engine answers. The flow was tried in a real browser: project page, confirmation, the project listed on the dashboard, and the engine verifying a result with no AI.

**Different from §2.7, for now:**

- **The first install is still one command**, not a downloadable app: a signed desktop installer, and a `kickswarm://` link that opens it, come later.
- **Being logged in to Claude Code, Gemini CLI or Codex is not checked in advance**: a tool that is not logged in is set aside on its first refusal, with a message.
- **The default daily shares of subscriptions are guesses.** Each provider's limits differ by plan; the contributor sets their own (`kickswarm engine add claude-code --per-day N`).

### 6.4 What is implemented (project dashboards)

v0.3 §3.5 planned a private dashboard. This first version is public, for public projects: `/project/<hive>` on any coordinator, linked from every project card on `/join` and from the engine's page.

- **The data** (`Coordinator.tableauProjet`, `GET /v0/hives/<hive>/dashboard`), from the state and the registry up to the embargo horizon:
  - progress and four milestones (25, 50, 75, 100%), with the moment each was reached;
  - the branches of the comb and their progress;
  - who does what now: each lease (cell, role, bee, since when), each verification (guards seated, verdicts in);
  - bees at work, by role;
  - what waits for a human: the founder's approval, a split for the owner, an arbitration, a pause;
  - the AI models of the project (the leaderboard for this hive), the top contributors and their trophies, the honey shared;
  - a feed: honey, splits, traps caught, trophies, completion;
  - the pace: the median time from a cell's start to its honey, over the cells measured.
  It keeps the live view's discretion: a guard holding a trap counts like any guard seat, and nothing in the data tells a trap apart.
- **The page** (`web/projet.html`): a honeycomb gauge, the milestones as badges, tiles, "waiting for a decision", "who does what now" (each bee gets a friendly name and a colour from its identifier, the same everywhere), branches, a podium, the models, and the feed. It updates live from the event stream, at most every 2 seconds, with a slow poll as a safety net. Readable in light and dark, down to very narrow screens.
- **The simulator**: with the cells left and the measured time per cell (10 minutes until a measure exists, and said so), it shows how long the project would take with N bees, and how many bees would finish it within H hours. It is an estimate: assemblies wait for their pieces, and new splits add cells. The page says so.
- **A demo that moves**: `npx tsx scripts/dev-bee.ts --animate` runs scripted bees on two hives, so the dashboards fill up.

**Different from v0.3 §3.5, for now:** private hives have no dashboard yet (their reads need a member's ticket in the browser); questions with choices (v0.3 §3.4) are not in "waiting for a decision" until they exist; pull requests are not shown yet.

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
