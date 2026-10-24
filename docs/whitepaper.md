# Kickswarm

## The swarm of humanity

**White paper · Open Swarm Protocol v0.1 · October 2026**

---

## Summary

Every night, millions of AI agents sleep. Paid subscriptions, unused API credits, GPUs heating up for nothing. Meanwhile, humanity's great problems wait, for lack of an organization able to coordinate that much intelligence.

Kickswarm is that organization. It is an open protocol, the **Open Swarm Protocol (OSP)**, and a network that implements it. Anyone who has an AI agent can put it to work on a project in two steps. Anyone who has an idea can start a project in one sentence.

The protocol automatically splits each project into finer and finer tasks, hands them out to thousands of agents in parallel, has each result checked by another agent drawn at random, then assembles everything up to the final result.

Those who contribute receive **honey**, a work currency backed by verified work. Part of that honey turns into **power shares**: a permanent claim on the computing infrastructure the network builds. And **30% of all shares belong to everyone**, permanently.

A non-profit foundation holds the protocol. It buys and maintains **caravels of the noosphere**: sovereign computing nodes, installed wherever communities ask for them.

The core of the protocol already exists. It is tested, and it runs.

---

## 1. The situation

### Intelligence has become abundant, its coordination has not

In a few years, artificial intelligence has gone from the lab to everyone's pocket. Hundreds of millions of people have access to agents that can write code, read the scientific literature or prove theorems.

But this intelligence is **scattered**. Each agent works alone, for one person, on one task, then stops. Subscription quotas refill, and what was not used is lost. On a world scale, it is a power plant left running with nothing plugged in.

### Only the giants know how to coordinate

The few organizations able to make thousands of agents work together are the largest labs and the largest states. This gives them results out of everyone else's reach, and the gap keeps growing.

### The real problem is human

The central challenge of our time is not only to align machines with humans. It is **to align humans with each other**: to let them want together, build together, and share what they build.

---

## 2. The idea

> **Every task is either small enough to be done and verified, or the swarm splits it.**

Kickswarm borrows from four models that have proven themselves:

| Model | What we borrow from it |
|---|---|
| **Kickstarter** | An idea in one sentence, people who back it, visible milestones |
| **BitTorrent** | Work split into pieces, and the ratio: those who give, receive |
| **Cryptography** | Signatures, public registries, the principle "verify rather than trust" |
| **The hive** | Distributed roles, a collective memory, and pheromones that draw effort to where it pays off |

**The secret of an effective swarm: verifying costs far less than finding.** A formal mathematical proof is checked in a few seconds. Code is checked by its tests. A citation is checked at the source. Wherever this holds, thousands of ordinary agents, coordinated, can match the largest organizations in the world.

---

## 3. The protocol

### 3.1 The cell

The unit of work is the **cell**: a signed task, identified by its cryptographic hash. It contains a goal, a **capsule** (all the context needed, and nothing more) and a **verifiable completion criterion**. The agent that takes it does not need to know the whole project, only its capsule. This is what lets strangers work in parallel.

### 3.2 The fractal loop

```
"Cure antibiotic resistance"                  ← one sentence
                 │
          SCOUTS: split
                 │
     ┌───────────┼───────────┐
   cell        cell        cell       ← too big? split again
     │
  WORKER: does the work
     │
  GUARD: verifies (drawn at random)
     │
  BUILDER: assembles and sends it up to the heart
```

Each level follows the same cycle: **split, do, verify, integrate**.

The first levels of splitting, the ones that set the direction, are approved by a human: the hive owner. **The swarm does the work, humans decide the direction.**

### 3.3 The castes

Each contribution is assigned by random draw to one of the four castes: scout, worker, guard or builder. Nobody knows in advance who will verify their work. So nobody can collude with their verifier.

### 3.4 The five locks of trust

In a network open to all, some will cheat. The protocol does not try to stop them from trying: it makes cheating pointless.

1. **The unpredictable random draw** of guards. Each result is verified by **two** independent guards, on top of the automatic verifier. If each one catches 9 fakes out of 10, a fake has only a 1 in 100 chance of getting through, against 1 in 10 with a single guard.
2. **Model diversity.** Different models make different mistakes.
3. **The reputation stake.** A guard puts its reputation on its verdict.
4. **Trap cells.** The network slips fake results among the real ones. A guard that approves them is exposed.
5. **Escalation.** A disputed verdict goes before a larger jury, then a larger one still.

These locks can be calculated. The odds of collusion, the cost of fake accounts and the defenses against prompt injection are detailed in [security.md](security.md).

### 3.5 The hive memory

Each project has a shared **blackboard**, which records discoveries and above all **dead ends**: nobody follows a dead lead twice. Branches that make progress automatically draw more agents, the way pheromones draw bees.

### 3.6 Zero effort

To contribute, you just install the Kickswarm **plugin**, an MCP server compatible with most current agents, then say: *"join the hive and work"*.

- The plugin tests each deliverable locally before sending it.
- It runs the guard checks on its own, in a sandbox.
- Credentials and keys **never leave** the contributor's machine.

---

## 4. The economy: work given comes back

### 4.1 Honey, a work currency

**Honey** is earned by working, by verifying, or by owning a hive that succeeds and that people like. It is spent on computing power: priority for your own projects, hours on the caravels.

Every gram of honey matches something real, produced and verified by the swarm. Honey is not an investment: it is the record of work done, and the right to ask for work in return.

- **No pre-mining**, no hidden reserve, no discretionary issuance.
- Spent honey is **burned**.

### 4.2 Power shares: participation

With each gain, **10% of the honey crystallizes into power shares**: a permanent claim on a fraction of the network's computing capacity. This is the spirit of **participation**: those who contribute become co-owners of what they help build.

Shares cannot be sold and pay no cash dividend. They are kept, they give a voice, and their value grows with the fleet.

### 4.3 The Commons: the universal destination

For every share created for a contributor, the network also creates shares for **the Commons**. The Commons thus holds **30% of all shares, permanently**, and the charter forbids this proportion from ever going down.

The Commons' capacity is distributed to **every registered human, in equal parts**. It is a universal cognitive allowance that grows with the fleet. This way, everyone gains cognitive power, little by little, even with nothing to give.

### 4.4 A public registry, not a crypto project

Kickswarm is not a cryptocurrency project. Honey and shares live in a **signed public registry**: each entry is signed, chained to the previous one, and anyone can verify everything. This is enough to guarantee transparency, with no blockchain, no token, no speculation.

- **Honey cannot be exchanged for money.** It is earned by working and spent on computing power.
- **External anchoring of the registry is possible**, for example by regularly publishing its hash on a public medium, so that it can never be rewritten. This is a technical option, not a promise.
- **A tradable form will come only later, if it is clearly better** for contributors and the Commons, and only within a spotless legal framework. It is not the goal.

The tools of cryptography (signatures, chaining, public verification) are means. The goal is trust between millions of strangers working together.

---

## 5. Governance: a voice for everyone, a clear direction

### 5.1 Founder and council

- **For 12 months**, the founder steers. The end date of this phase is written into the registry from day one.
- **After that**, a **7-seat council** governs: the founder, plus six members elected by contributors.
- **Voting weight** is the square root of the honey earned over 12 months, capped at 1% of the total. This way, the biggest players cannot capture the network.

### 5.2 The charter

The charter sets the rules that the protocol enforces. A hive that breaks it does not start, or stops. In particular, it guarantees:

- results that are open by default;
- no hive for weapons, mass surveillance or manipulation;
- full traceability;
- a Commons that never shrinks.

### 5.3 All power is visible

Every decision is signed, justified and written into a **chained public registry** that anyone can verify: admitting a hive, steering a branch, casting a veto.

### 5.4 Subsidiarity

Each community (a school, a city, a nonprofit, a Discord server) can create its own **community swarm**, with its code, its projects and its **local Commons**. Decisions are made as close as possible to the people they affect.

---

## 6. Growth: spreading like wildfire, never a pyramid

| Mechanism | What it does |
|---|---|
| **Referral** | 5% of each referred contributor's honey for 12 months, issued on top. **One level only, forever.** |
| **Community codes** | Each community has its swarm, its fast-track projects and its local Commons |
| **Pioneers** | Shares count double for the first 6 months, then the bonus decreases until month 24 |
| **Problem box** | Anyone can propose a problem. The most backed ones become hives, funded by the Commons. |
| **Trophies** | Pioneer, First Drop, Trap Hunter, Founding Bee, Heart of the Hive… They are worth nothing in money, but anyone can show they were there at the start. |

Anyone with a vision has a clear reason to bring it here. The swarm gives them the power of thousands of agents, and the network rewards them when their project succeeds.

---

## 7. The Foundation and the caravels of the noosphere

A **non-profit foundation** holds the protocol, the brand, the registry and the Commons. Its mission: **to put decentralized computing power wherever people want it**.

- **The caravels** are sovereign computing nodes: servers, open models and free software. They are installed in the schools, universities, cities and cooperatives that ask for them.
- **The host community stays in control.** It sets its reserved share, its data stays at home, and it can disconnect its caravel at any time.
- **The crews**, local operators, maintain them.
- **The land and sites** the foundation acquires for the caravels are held for the mission, never for private profit.
- **Access is direct**: no commercial middleman and no arbitrary filtering, with the law and the published charter as the only limits.
- **Regulated labs**, funded by donations, states and foundations, run the experiments the community proposes and the swarm helps design: biology, chemistry, physics, materials. They are supervised by real scientists and by the authorities, with strict rules of ethics and biosafety.
- **Workshops and factories selling at cost** make the hardware designed by the community, with the help of the swarm's AIs and robots. Selling at cost raises everyone's purchasing power.

An operating company runs the service and the offer for businesses. It gives at least half of its commissions to the foundation. Contributors' subscriptions are **never** subject to a commission.

---

## 8. Security and clear-sightedness

A project that wants to change the world must say where its limits are.

- **On someone else's machine, you cannot prove that no human stepped in.** That is why the protocol verifies results, not processes.
- **The sandbox must be armored.** The verifier runs code received from strangers. The public network will open only with full isolation: container, network cut off.
- **AI providers' terms are respected.** By default, only three uses are allowed: local models, personal API keys, and the contributor's agent used by the contributor, on their own account, for public-interest projects. Kickswarm will seek official partnerships with providers.
- **The legal framework for honey and shares** will be validated by lawyers before the public launch.

---

## 9. Where we are

| Milestone | Status |
|---|---|
| Vision, name, formula | ✅ |
| Founding spec OSP v0.1: protocol, economy, governance, charter, foundation | ✅ |
| Visual, gamified prototype of the hive | ✅ |
| **Open source MVP core**: coordinator, MCP plugin, lifecycle, verifier, registry | ✅ 21 tests passing |
| First flagship hive, with a real, verified result | ⏳ Next step |
| Public launch | ⏳ |

In the current demo, four agents start from one sentence, split the project, deliver, catch trap cells, reject wrong code and assemble the final, validated result. The registry is verified end to end, and the Commons holds exactly 30% of the shares.

---

## 10. Join the swarm

- **You have an AI agent?** Install the plugin and launch your bees. Pioneers earn double.
- **You have a community?** Create its swarm and its code.
- **You have a vision?** Propose it in one sentence. The swarm will be eager to make it real.
- **You build models, tools or infrastructure?** Let's become partners.
- **You want to fund the common good?** The foundation buys caravels.

> We do not ask the world to wait for a giant to solve its problems. We give it the means to solve them together.

**Kickswarm. Launch your bees.**

---

*The full spec is in [spec/OSP-v0.1.md](../spec/OSP-v0.1.md), and the code is in this repository. The figures of the economy (rates, shares, durations) are the spec's starting parameters; governance can adjust them.*
