# Kickswarm launch plan

> **One real result is worth a thousand promises.** We are not launching an idea, we are launching a proof. The viral moment is the sentence: *"strangers plugged their AIs together for one night, and here is what they solved"*.

This plan is internal. Nothing is published before the launch condition is met.

---

## 0. Launch condition: a version that impresses

We publish nothing until every line of this list is checked.

### The product

- [ ] **A real agent end to end.** Claude Code, Codex and a local Ollama model work together on the same hive through the plugin, with no human intervention, for at least one hour.
- [ ] **The live hive.** The visual prototype is connected to a real coordinator: you see real bees fill real cells, in real time.
- [ ] **One-command install.** `npx kickswarm join <ruche>` detects the agent, adds the plugin and launches the bees.
- [ ] **The unused quota.** The daemon launches bees when the agent is idle, within the provider profiles (§20 of the spec).
- [ ] **Growth.** One-level referral, community codes and pioneer bonuses are coded and tested.
- [ ] **Profiles and sharing.** Each contributor has a profile page: their honey, shares, badges and cells. A card can be shared on X in one click.

### Security

- [ ] **Armored sandbox.** The verifier runs in a container, network cut off, with CPU and memory quotas.
- [ ] **External audit** of the verifier and the plugin, or at least a public review with a bug bounty program.
- [ ] **The random draw wired to drand**, the public, verifiable randomness beacon.

### The framework

- [ ] **Legal opinion** on honey, shares and referral (MiCA, financial law, pyramid selling).
- [ ] **Endowment fund** registered, or at least being set up.
- [ ] **Licenses** in the repository: Apache 2.0 for the code, CC BY 4.0 for the spec. Plus a CONTRIBUTING file and a code of conduct.

### The proof

- [ ] **A successful flagship hive**, with a verifiable and spectacular result (see §2).

---

## 1. The sequence

| Phase | When | Goal |
|---|---|---|
| **Building** | Now → D-30 | Meet the launch condition |
| **Closed pioneers** | D-30 → D-7 | 50 to 200 hand-picked testers, on Discord, run the flagship hive |
| **Teasing** | D-14 → D-1 | 15 s teaser, waiting list, contacts with creators under embargo |
| **Launch** | D0, a Tuesday | Show HN, X thread, 45 s video, Product Hunt, Reddit, creators |
| **Wildfire** | D+1 → D+90 | Referral, communities, a hive of the week, live streams, hackathons |

---

## 2. The flagship hive

It must meet three criteria:

- **Verifiable without discussion**, in V0;
- **Understandable in one sentence** by anyone;
- **Impossible for one person alone**, but doable by a swarm.

| Candidate | Why it works | Risk |
|---|---|---|
| **Erdős × Lean**: formalize open problems in Lean 4 | The compiler verifies, the prestige is huge, the math community is active | Needs the Lean verifier (V0, to be coded) |
| **Open source shield**: tests for critical libraries | Useful right away, verifiable by CI, speaks to every developer | Less spectacular |
| **Antibiotics atlas**: the literature on resistance | A cause that affects everyone | V1/V2 verification, not coded yet |

**Recommendation:** Open source shield for the pioneers (the `tests-js` verifier already exists), then Erdős × Lean for the public launch, once the Lean verifier is written.

---

## 3. The channels

| Priority | Channel | Why | Format | Metric |
|---|---|---|---|---|
| ★★★ | **GitHub** | Credibility, and developers' first reflex | README with a GIF of the live hive, one-command demo | Stars, forks, contributors |
| ★★★ | **X** | The AI ecosystem lives there | Launch thread, 45 s video, shared profile cards | Impressions, sign-ups |
| ★★★ | **Hacker News** | The most demanding audience; a good Show HN launches a project | A plain, technical "Show HN" | Position on the front page |
| ★★★ | **AI YouTube creators** | Long-form teaching and trust | Live demo, interview | Sign-ups via creator code |
| ★★ | **Reddit** | Targeted communities | r/LocalLLaMA (local models), r/ClaudeAI, r/OpenAI, r/singularity, r/opensource. Read each sub's rules before posting. | Votes, sign-ups |
| ★★ | **Discord** | The community's headquarters | Kickswarm server, and a code for each partner server | Active members |
| ★★ | **TikTok, Reels, Shorts** | The general public, in vertical format | 9:16 version of the film, behind the scenes of the swarm | Views, sign-ups |
| ★★ | **LinkedIn** | Businesses (Enterprise offer) and institutions (caravels) | The founder's article, the vision | Business contacts |
| ★ | **Product Hunt** | One day of visibility | Product page | Daily ranking |
| ★ | **Tech press** | Legitimacy | Press release with the flagship hive's result | Articles |
| ★ | **Universities, schools, hackerspaces** | The first community swarms | Community code, one-hour workshop | Communities created |

---

## 4. Creators to approach

This list comes from my general knowledge. **Before any contact, check** each one's current audience, editorial line and recent activity.

**International**
- **David Shapiro**: he talks about post-labor economics. The ideal match with the vision.
- **Matthew Berman** and **Wes Roth**: AI agent news, they test tools.
- **Two Minute Papers** and **AI Explained**: teaching and rigor. Perfect for the flagship hive.
- **Fireship**: developer audience, short and viral format.
- **Yannic Kilcher**: technical audience, open source.

**In France**
- **Micode** and **Underscore_**: tech for the general public, very large audience.
- **Defend Intelligence**: AI, in French.
- **Monsieur Phi**: philosophy, AI and ethics. For the vision and governance.

**The approach:** a short, personal message, early access to a hive, a creator code, and the freedom to criticize. No disguised paid placement: any paid collaboration is disclosed.

**Message template:**

> Hello [first name],
> I am building Kickswarm, an open source protocol that lets thousands of people plug their AI agents together on the same problem. Results are verified by other agents drawn at random, and 30% of the power created goes back to everyone.
> Our first hive has just [result]. I would like to give you early access before the launch on [date]: you launch your bees with one command and watch the swarm work live.
> No obligation to talk about it, and all criticism is welcome.

---

## 5. Launch texts

### Show HN

**Title:** `Show HN: Kickswarm – an open protocol to pool AI agents on one problem, with verified results`

**First comment:** what it is, how it works (cells, guards drawn at random, trap cells), what is done and what is not, the link to the spec. Plain tone. Answer every comment for 6 hours.

### X thread (draft)

1. Every night, millions of AIs sleep. What if we woke them up, together? 🐝 We are launching Kickswarm, open source.
2. You give one sentence: "[flagship hive goal]". The swarm splits it into hundreds of small tasks.
3. Strangers plug in their agents (Claude, GPT, Gemini, local models) and each takes a cell.
4. Every result is verified by another AI, drawn at random. We even slip in trap cells to expose cheaters.
5. Result: [the flagship hive's real result, with the link].
6. What you give comes back to you: honey, then permanent shares of the power created. And 30% of everything belongs to everyone.
7. The protocol is open, the governance public, the registry verifiable by all.
8. Launch your bees: `npx kickswarm join [ruche]` · [link]

### Short hooks

- "Your AI subscription sleeps at night. Lend it to humanity."
- "Kickstarter funded ideas. Kickswarm solves them."
- "Thousands of AIs. One problem. Every result verified."
- "Humanity's computing power, for humanity."

---

## 6. The films

The 45 s film is prototyped in motion design: `kickswarm-film`, exportable in 16:9, 9:16 and 1:1 by screen capture.

| Film | Length | For whom | Structure |
|---|---|---|---|
| **Teaser** | 15 s | X, Shorts, TikTok | Sleeping AIs, then the swarm lights up, then "Coming soon. Launch your bees." |
| **Explainer** | 45 s | Launch, README, creators | The situation → one sentence → the swarm splits → the bees fill → verification → the honey flows up → what you earn and the Commons → the call to action |
| **Manifesto** | 60 s | LinkedIn, institutions, press | The founder's voice: aligning humans with each other, participation, the foundation, the caravels, abundance |
| **Proof** | 90 s | After the flagship hive | Time-lapse of a real hive, from the first split to the verified result, with the real figures |

---

## 7. Pitfalls to avoid

- **Never promise money gains.** Honey is not an investment. No "airdrop" or "token" in the launch communication.
- **Never present referral as a source of income.** It is one level and nothing more.
- **Do not launch before the sandbox is armored.** A single flaw exploited on launch day kills trust forever.
- **Do not exaggerate.** Every published figure must come from the public registry.
- **Respect AI providers' terms.** Contributors getting banned would make the headlines.

---

## 8. Metrics

| Metric | Target at D+30 |
|---|---|
| Active bees per day | 1,000 |
| Cells turned into honey per day | 10,000 |
| GitHub stars | 5,000 |
| Community swarms | 100 |
| Problems proposed in the box | 1,000 |

These targets are indicative, to be reviewed after the pioneer phase.

---

## 9. Contact pipeline

If it takes off, hundreds of messages will arrive every day: creators, journalists, labs, businesses, local governments, patrons. One important message lost is one partnership lost. The pipeline must be ready **before** the launch.

### 9.1 Segments

| Segment | Examples | First response time | Owner before hiring |
|---|---|---|---|
| **Creators** | YouTubers, streamers, X accounts | 24 h | Founder |
| **Press** | Tech and general journalists | 12 h | Founder |
| **Researchers and labs** | Universities, institutes, laboratories | 48 h | Scientific lead (volunteer at first) |
| **Businesses** | Enterprise offer, technical partnerships | 48 h | Founder |
| **States and local governments** | Cities, regions, ministries, caravels | 72 h | Founder |
| **Investors and patrons** | Donations to the foundation, funding for the operating company (SAS) | 48 h | Founder |
| **Communities** | Schools, nonprofits, Discord servers | 72 h | Community moderators |
| **Contributors** | Questions, bugs, ideas | 72 h, or redirect to Discord and GitHub | Community |

### 9.2 The flow

1. **A single intake form** on the website, with a "You are…" menu that sets the segment. A single email address forwards to the same tool.
2. **Automatic acknowledgment**, tailored per segment: what will happen next, and within what time.
3. **Automatic routing** to the segment's queue, with the assigned owner.
4. **Daily triage**: each new contact is qualified or closed within 24 h.
5. **Weekly review**: contacts in discussion, follow-ups, partnerships to sign.

### 9.3 The stages

**New → Qualified → In discussion → Partner**, or **Closed** at any time, with a reason. Each contact carries: segment, source, owner, next action and follow-up date.

### 9.4 The tool

No need for expensive software at first.
- **An open source CRM**, self-hosted;
- or **a shared database** (a structured spreadsheet or an online database) with a linked form.

The criterion: one place for everything, views per segment, and easy export. We migrate the day the volume requires it, not before.

### 9.5 Response templates

Before the launch, prepare a standard reply per segment, in French and in English: acknowledgment, request for information, call proposal, polite refusal, press kit (white paper, film, registry figures, photos, contact).

### 9.6 Privacy

- GDPR compliance: legal basis (legitimate interest or consent), information notice on the form, retention period (for example 24 months without contact), right of access and erasure.
- No contact data in the public registry. The registry only contains contributor identifiers.
- Access to the CRM limited to the people who need it, with strong authentication.
