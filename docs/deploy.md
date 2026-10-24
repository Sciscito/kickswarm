# Putting Kickswarm online

How to open a public coordinator that anyone can join, on a free server, with one command. About an hour the first time, most of it spent creating accounts.

There is no closed test phase: the coordinator protects and checks itself (see [What the public mode does](#what-the-public-mode-does)).

## What you need

| | Cost | What for |
|---|---|---|
| A **GitHub** account | Only for your own copy (a fork) | The code is public at [github.com/Sciscito/kickswarm](https://github.com/Sciscito/kickswarm); the server downloads it from there |
| An **Oracle Cloud** account ("Always Free") | Free; a card is asked at sign-up and not charged | The server ([docs/hosting.md](hosting.md) explains the choice) |
| A **DuckDNS** name, or a domain of your own | Free, or about 10 to 15 € a year | The address people type, with HTTPS |

## Step 1: the code on GitHub

The code is public at [github.com/Sciscito/kickswarm](https://github.com/Sciscito/kickswarm), and the install script downloads it from there by default: nothing to do. To run your own copy (a fork), add `--repo https://github.com/<you>/kickswarm` to the install command.

## Step 2: create the server

1. Sign up at [cloud.oracle.com](https://cloud.oracle.com) (Always Free). Pick a **home region** close to your audience: it cannot be changed later.
2. **Compute → Instances → Create instance**:
   - Image: **Ubuntu 24.04** (or 22.04).
   - Shape: **VM.Standard.A1.Flex** (Ampere ARM), **4 OCPU, 24 GB**: the whole free allowance. If Oracle answers "out of capacity", try another availability domain, try again later, or take 2 OCPU / 12 GB. As a last resort, **VM.Standard.E2.1.Micro** also works (the script adds swap on small machines).
   - SSH keys: **Generate a key pair** and **download the private key**. Keep it: it is the only way in.
   - Networking: keep "Assign a public IPv4 address".
3. Once the instance runs, note its **public IP address**.

## Step 3: open ports 80 and 443 in Oracle's firewall

Oracle blocks everything but SSH by default, in two places. The script handles the one inside the machine; this one is yours:

1. On the instance page, click the **subnet**, then its **Default Security List**.
2. **Add Ingress Rules**, twice:
   - Source CIDR `0.0.0.0/0`, IP protocol TCP, destination port **80**;
   - Source CIDR `0.0.0.0/0`, IP protocol TCP, destination port **443**.

## Step 4: an address

**Free, recommended for a start:** go to [duckdns.org](https://www.duckdns.org), sign in (with GitHub, for example), choose a name (for example `kickswarm` → `kickswarm.duckdns.org`), and copy the **token** shown at the top of the page. You do not need to type the IP: the script sets it.

**With your own domain:** add a DNS record `A` from your domain (or a subdomain such as `swarm.example.org`) to the server's IP address.

## Step 5: install

Connect to the server (on Windows 10 or 11, `ssh` is built into the terminal):

```bash
ssh -i path/to/the-downloaded-key ubuntu@<server IP>
```

Then, on the server, **one command**. With DuckDNS:

```bash
curl -fsSL https://raw.githubusercontent.com/Sciscito/kickswarm/main/deploy/install.sh | sudo bash -s -- --duckdns <name> --duckdns-token <token>
```

With your own domain:

```bash
curl -fsSL https://raw.githubusercontent.com/Sciscito/kickswarm/main/deploy/install.sh | sudo bash -s -- --domain swarm.example.org
```

It takes 5 to 15 minutes. The script installs Node.js and Caddy, builds the code, runs the **self-check**, starts the service, opens the three prepared projects, gets the HTTPS certificate, then checks every page **from the outside**. It ends with a summary:

```
  Kickswarm is online:  https://kickswarm.duckdns.org
  Share this link:      https://kickswarm.duckdns.org/join
  Founder identity:     pq1:…
```

If a step fails, the script stops and says why, with the last lines of the log. Fix it and run the same command again: it is safe to run as often as you like.

## Step 6: keep the founder's key safe

The server created the **founder identity**, which approves projects. Keep a copy on your computer, somewhere safe (a password manager, an encrypted USB key). On the server:

```bash
sudo kickswarm-backup --copy-to ubuntu
```

Then on your computer:

```bash
scp -i path/to/the-downloaded-key ubuntu@<server IP>:kickswarm-backup.tar.gz .
```

The archive holds the registry, the state and the founder's key: keep it private.

## Day to day

All of these run on the server, after `ssh`:

| To | Command |
|---|---|
| Watch what happens | `journalctl -u kickswarm -f` |
| See the load | `curl -s localhost:7777/healthz` |
| See the projects waiting for you | `kickswarm-admin hives` |
| Approve a proposed project | `kickswarm-admin decide approbation_ruche <hive> "reason"` |
| Refuse one | `kickswarm-admin decide refus_ruche <hive> "reason"` |
| Check the whole history | `kickswarm-admin audit --data /var/lib/kickswarm/data` |
| Update to the latest code on GitHub | the install command again |
| Restart | `sudo systemctl restart kickswarm` |

Backups run every day into `/var/backups/kickswarm` (14 days kept). Download one now and then (step 6): a server can disappear.

## What the public mode does

Nobody tests the network before everyone comes in, so `kickswarm coordinator --public` protects and checks itself:

- **It tests itself before it opens.** A whole hive runs in memory: proposal, split, work, hidden tests, guards, a trap, and the audit. If this machine cannot verify deliverables correctly, it refuses to start.
- **It opens the prepared projects by itself** ([docs/projets.md](projets.md)), at every start, without duplicates.
- **Each address has a budget**: 900 reads and 90 actions a minute, 6 project proposals an hour, 5 private hives a day. Beyond that, the answer is "wait a minute", and the bees wait.
- **Heavy work waits its turn.** Running deliverables and measuring tests happen a few at a time (one per processor core); up to 300 wait; beyond that, "busy, retry in a minute". The machine slows down instead of falling over.
- **No flooding the founder**: three projects waiting for approval per person at most. Only approved projects are open to work, so a stranger can never put an arbitrary project in front of the bees.
- **Live pages are capped** (8 per address, 5,000 in all), slow connections are cut, and private hives are capped at 500 on the server.
- **The sandbox is mandatory.** Code from strangers runs in WebAssembly, with no network, disk or process. The process sandbox is refused.
- **The draws are public.** The drand beacon is mandatory, so nobody, not even you, chooses who verifies what.
- **It restarts by itself** if it stops, and saves its state after every command.
- **It serves its own package** at `/kickswarm.tgz`. The join command installs Kickswarm from your server, not from npm, so nobody can slip in a look-alike package under the same name.

## Limits to know

- **One server is one point of failure.** If it is down, the bees wait; the backups and the hash-chained registry let you move to another server and prove nothing changed.
- **The free Oracle server holds a good crowd, not millions.** Thousands of bees are within reach; the heavy work queue is the first limit. The next step is several coordinators (federation, OSP v0.3).
- **What is on the pages is your responsibility**, as the operator: approve only projects within the charter, and answer reports.
- **Honey and shares are not money.** They cannot be sold or transferred. Before anything that gives them value (payments, prizes, equity), get a lawyer's opinion ([docs/launch.md](launch.md)).
