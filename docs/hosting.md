# Hosting Kickswarm for free

What the network needs, and where to put it without paying, or almost.

## What needs hosting

| Piece | Needs |
|---|---|
| **The coordinator** | Node 22+, a persistent disk (`etat.json`, `registre.jsonl`), long-lived connections for the real-time feed (SSE). Docker is not needed: the tests run in the WebAssembly sandbox, with network and disk cut off, just as on the guards' machines. |
| **The live hive** | Served by the coordinator itself, at `/hive` |
| **The website, the white paper, the spec** | Static pages |
| **A domain name and HTTPS** | The only real cost: about 10 to 15 € a year for the domain |

## The options

Free offers change often. **Check the current terms before you commit.**

| Option | Free? | Docker (sandbox) | Persistent disk | Verdict |
|---|---|---|---|---|
| **Oracle Cloud "Always Free"**: ARM Ampere VM, up to 4 cores and 24 GB of RAM | Yes, with no time limit under the current terms. A card is required at sign-up, and an idle instance can be reclaimed. | ✅ | ✅ | **Recommended for the coordinator** |
| **Google Cloud, e2-micro free tier**: 1 shared vCPU, 1 GB | Yes, in some regions | ⚠️ Possible but tight | ✅ | Enough for a small pilot |
| **Render, free web service** | Yes | ❌ | ❌ | Goes to sleep and loses its disk: for a demo only |
| **Fly.io, Railway** | No real free tier anymore for new accounts (trial or credits) | Depends on the offer | Depends on the offer | To check |
| **Cloudflare Tunnel** | Yes | — | — | **Excellent complement**: exposes the coordinator over HTTPS without opening a port, with DDoS protection |
| **GitHub Pages or Cloudflare Pages** | Yes | — | — | **Recommended for the website, the white paper and the spec** |
| **A server at home** (old PC, Raspberry Pi 5) + Cloudflare Tunnel | Yes, if you have the hardware | ✅ | ✅ | Good for the pioneers, less reliable than a cloud |
| **Credit programs for open source and nonprofits** | Free credits | ✅ | ✅ | To apply for as soon as the foundation exists |

## The recommended stack

1. **Coordinator**: an Oracle Cloud Always Free VM (Ubuntu, ARM).

   ```bash
   kickswarm coordinator --host 0.0.0.0 --data /srv/kickswarm
   ```

   In front of it, **Caddy** (automatic HTTPS) or **Cloudflare Tunnel** (no open port).
2. **Website and documents**: GitHub Pages, on the same repository as the code.
3. **Backups**: a daily copy of `registre.jsonl` and `etat.json` to object storage or a private git repository.
   - The registry is hash-chained: anyone can check that a copy is intact.
   - A move to another host can therefore be verified end to end.
4. **Domain name**: the only purchase you cannot skip.

## Limits to keep in mind

- **A single coordinator is a single point of failure.** Federation (v0.3) will remove it. Until then: backups, and a second VM ready to take over.
- **A public coordinator requires a sandbox that cuts off the network**: WebAssembly (the default) or container. It refuses to start beyond `localhost` in process mode.
- **Free offers can change or shut down.** The verifiable registry makes migration safe; keep it ready.
- **Creating the accounts with the hosts is up to you**: they ask for your identity and sometimes a card.
