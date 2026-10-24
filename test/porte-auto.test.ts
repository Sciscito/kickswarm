import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createServer, request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { AGENTS, executerAgent } from '../src/moteur/agents.js';
import { configurerMoteur } from '../src/moteur/cli.js';
import { chargerConfig, fournisseursActifs } from '../src/moteur/config.js';
import { detecterAcces, puissance } from '../src/moteur/detection.js';
import { CATALOGUE, ErreurFournisseur, type Fournisseur } from '../src/moteur/fournisseurs.js';
import { connecterOpenRouter } from '../src/moteur/openrouter-oauth.js';
import { Pool } from '../src/moteur/pool.js';
import { serveurPerso, type Tableau } from '../src/moteur/serveur.js';
import { arreter, demarrer, etat, installerDemarrageAuto, retirerDemarrageAuto } from '../src/moteur/service.js';

// OSP v0.4 §2.6, the automatic door: subscriptions through their official tools, locked down;
// OpenRouter connected in one click; what this machine can lend, and the swarm power it gives; the
// engine in the background; one-click join from a project page, confirmed on the engine's own page.

/** Fake `claude`, `gemini` and `codex` commands that report how they were started. */
function faussesCommandes() {
  const dir = mkdtempSync(join(tmpdir(), 'osp-cli-'));
  const faux = join(dir, 'faux.mjs');
  writeFileSync(
    faux,
    `import { readdirSync } from 'node:fs';
const [outil, ...args] = process.argv.slice(2);
let entree = '';
process.stdin.on('data', (d) => (entree += d));
process.stdin.on('end', () => {
  const mode = process.env.FAKE_MODE ?? 'ok';
  if (mode === 'old') { process.stderr.write("error: unknown option '--safe-mode'\\n"); process.exit(1); }
  if (mode === 'limit') { process.stdout.write("You've hit your session limit · resets 4pm\\n"); process.exit(1); }
  if (mode === 'auth') { process.stdout.write('Not logged in · Please run /login\\n'); process.exit(1); }
  const rapport = JSON.stringify({ outil, args, fichiers: readdirSync(process.cwd()), debut: entree.slice(0, 60) });
  if (outil === 'gemini') process.stdout.write(JSON.stringify({ response: rapport, stats: {} }));
  else process.stdout.write(rapport + '\\n');
});
`,
  );
  const chemins: Record<string, string> = {};
  for (const t of ['claude', 'gemini', 'codex']) {
    if (process.platform === 'win32') {
      chemins[t] = join(dir, `${t}.cmd`);
      writeFileSync(chemins[t], `@"${process.execPath}" "${faux}" ${t} %*\r\n`);
    } else {
      chemins[t] = join(dir, t);
      writeFileSync(chemins[t], `#!/bin/sh\nexec "${process.execPath}" "${faux}" ${t} "$@"\n`);
      chmodSync(chemins[t], 0o755);
    }
  }
  return { chemins, fermer: () => rmSync(dir, { recursive: true, force: true }) };
}

const fournisseur = (id: 'claude-code' | 'gemini-cli' | 'codex'): Fournisseur => {
  const { env: _e, aide: _a, ...f } = CATALOGUE[id]!;
  return f;
};

async function avecMode<T>(mode: string, f: () => Promise<T>): Promise<T> {
  process.env.FAKE_MODE = mode;
  try {
    return await f();
  } finally {
    delete process.env.FAKE_MODE;
  }
}

test('subscriptions through their official tools, locked down: no tool, no MCP, no settings, an empty folder, the prompt on stdin', async () => {
  const f = faussesCommandes();
  try {
    const messages = [
      { role: 'system' as const, content: 'You are one bee.' },
      { role: 'user' as const, content: 'Write pgcd.mjs' },
    ];
    const claude = JSON.parse(await executerAgent(fournisseur('claude-code'), messages, { commande: f.chemins.claude! })) as { args: string[]; fichiers: string[]; debut: string };
    // Every tool off (an empty --tools survives the trip through cmd.exe on Windows), every MCP tool denied.
    assert.equal(claude.args[claude.args.indexOf('--tools') + 1], '');
    for (const a of ['-p', '--safe-mode', '--strict-mcp-config', '--no-session-persistence', '*', 'mcp__*']) assert.ok(claude.args.includes(a), a);
    assert.deepEqual(claude.fichiers, ['mcp.json'], 'a fresh folder, with only the empty MCP list');
    assert.match(claude.debut, /^You are one bee\.\n\nWrite pgcd\.mjs/, 'the prompt arrives on stdin');

    const gemini = JSON.parse(await executerAgent(fournisseur('gemini-cli'), messages, { commande: f.chemins.gemini! })) as { args: string[]; fichiers: string[] };
    assert.deepEqual(gemini.args.slice(0, 4), ['--approval-mode', 'plan', '--extensions', 'none']);
    assert.deepEqual(gemini.fichiers, []);
    const codex = JSON.parse(await executerAgent(fournisseur('codex'), messages, { commande: f.chemins.codex! })) as { args: string[] };
    assert.ok(codex.args.includes('read-only') && codex.args.at(-1) === '-');

    // Limits and problems become what the pool needs.
    await avecMode('limit', async () => {
      await assert.rejects(executerAgent(fournisseur('claude-code'), messages, { commande: f.chemins.claude! }), (e: ErreurFournisseur) => e.status === 429 && e.attendreMs === 3_600_000);
    });
    await avecMode('auth', async () => {
      await assert.rejects(executerAgent(fournisseur('claude-code'), messages, { commande: f.chemins.claude! }), (e: ErreurFournisseur) => e.definitif && /not logged in/.test(e.message));
    });
    // A version that does not know a locking option fails: it never runs unlocked.
    await avecMode('old', async () => {
      await assert.rejects(executerAgent(fournisseur('claude-code'), messages, { commande: f.chemins.claude! }), (e: ErreurFournisseur) => e.definitif && /too old for the locked-down mode/.test(e.message));
    });
  } finally {
    f.fermer();
  }
});

test('the pool: subscriptions only for the swarm, Codex only if its file reads are accepted, never added without a yes', async () => {
  const p = new Pool([fournisseur('claude-code'), fournisseur('codex'), { ...fournisseur('gemini-cli'), parJour: 20 }]);
  await p.decouvrir();
  const besoin = { tokens: 1000, maxTokens: 1000, usage: 'essaim' as const, confidentiel: false };
  assert.deepEqual(p.candidats(besoin).map((m) => m.id).sort(), ['claude-code/subscription', 'gemini-cli/subscription']);
  assert.deepEqual(p.candidats({ ...besoin, usage: 'perso' }), [], 'you already use these tools yourself');
  assert.deepEqual(p.candidats({ ...besoin, confidentiel: true }), [], 'not for private work: consumer plans may train on prompts');
  const q = new Pool([{ ...fournisseur('codex'), accepteLecture: true }]);
  await q.decouvrir();
  assert.equal(q.candidats(besoin).length, 1);
  // Installed is not enough: a subscription tool is used only once it is in the settings.
  const home = mkdtempSync(join(tmpdir(), 'osp-auto-'));
  try {
    const c = chargerConfig(home);
    assert.ok(!fournisseursActifs(c, {}).some((f) => f.api === 'cli'));
    assert.ok(fournisseursActifs({ ...c, fournisseurs: [{ id: 'claude-code' }] }, {}).some((f) => f.id === 'claude-code'));
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('what this machine can lend, and the swarm power it gives', async () => {
  const home = mkdtempSync(join(tmpdir(), 'osp-auto-'));
  try {
    const c = { ...chargerConfig(home), fournisseurs: [{ id: 'claude-code' }] };
    const acces = await detecterAcces(c, { GROQ_API_KEY: 'g' }, (cmd) => cmd === 'claude' || cmd === 'codex');
    const par = Object.fromEntries(acces.map((a) => [a.id, a]));
    assert.deepEqual([par['claude-code']!.disponible, par['claude-code']!.prete, par['claude-code']!.parJour], [true, true, 10]);
    assert.deepEqual([par['codex']!.disponible, par['codex']!.prete, par['codex']!.risque], [true, false, true]);
    assert.deepEqual([par['gemini-cli']!.disponible, par['groq']!.prete, par['openrouter']!.prete], [false, true, false]);
    const p = puissance(acces);
    assert.deepEqual([p.acces, p.abeilles, p.tachesParJour, p.niveau.nom], [2, 2, 60, 'Worker']);
    assert.equal(puissance([]).niveau.nom, 'Egg');
    assert.equal(puissance([{ id: 'ollama', type: 'local', aide: '', disponible: true, prete: true }]).illimite, true);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('OpenRouter in one click: the official OAuth flow with PKCE, no key copied by hand', async () => {
  let verifie = false;
  const or: Server = createServer((req, res) => {
    let corps = '';
    req.on('data', (c) => (corps += c));
    req.on('end', () => {
      const b = JSON.parse(corps || '{}') as { code?: string; code_verifier?: string };
      const attendu = createHash('sha256').update(b.code_verifier ?? '').digest('base64url');
      verifie = req.url === '/api/v1/auth/keys' && b.code === 'code-123' && attendu === defi;
      res.writeHead(verifie ? 200 : 400, { 'content-type': 'application/json' });
      res.end(JSON.stringify(verifie ? { key: 'sk-or-v1-new' } : { error: 'bad' }));
    });
  });
  let defi = '';
  await new Promise<void>((ok) => or.listen(0, '127.0.0.1', ok));
  const base = `http://127.0.0.1:${(or.address() as AddressInfo).port}`;
  try {
    let pageRetour = '';
    const cle = await connecterOpenRouter({
      base,
      // The browser: OpenRouter's consent page, then the redirect to the engine's one-time address.
      ouvrir: (url) => {
        const u = new URL(url);
        assert.equal(u.origin + u.pathname, `${base}/auth`);
        assert.equal(u.searchParams.get('code_challenge_method'), 'S256');
        defi = u.searchParams.get('code_challenge')!;
        const retour = new URL(u.searchParams.get('callback_url')!);
        assert.equal(retour.hostname, 'localhost');
        void fetch(`${retour}?code=code-123`).then(async (r) => (pageRetour = await r.text()));
      },
    });
    assert.equal(cle, 'sk-or-v1-new');
    assert.ok(verifie, 'the code was exchanged with the PKCE verifier');
    await new Promise((ok) => setTimeout(ok, 50));
    assert.match(pageRetour, /OpenRouter is connected/);
    await assert.rejects(connecterOpenRouter({ base, ouvrir: () => {}, delaiMs: 200 }), /within 5 minutes/);
  } finally {
    or.close();
  }
});

test('kickswarm join, engine step: subscriptions lent with a yes, the engine started, nothing at login unless asked', async () => {
  const home = mkdtempSync(join(tmpdir(), 'osp-auto-'));
  try {
    const lignes: string[] = [];
    let lance = '';
    await configurerMoteur(home, 'http://127.0.0.1:7777', {
      oui: true,
      installe: (cmd) => cmd === 'claude' || cmd === 'codex',
      env: {},
      lancer: (_h, url) => ((lance = url), { deja: false }),
      log: (l) => lignes.push(l),
    });
    const c = chargerConfig(home);
    assert.equal(c.coordinateur, 'http://127.0.0.1:7777');
    assert.deepEqual(c.fournisseurs.map((f) => f.id), ['claude-code'], 'the safe subscription is lent; Codex (file reads) is not, without an explicit yes');
    assert.equal(lance, 'http://127.0.0.1:7777');
    assert.ok(lignes.some((l) => /Swarm power: level 2, Larva/.test(l)), lignes.join('\n'));
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('the engine in the background, and start at login only on request (per-user file)', async () => {
  const home = mkdtempSync(join(tmpdir(), 'osp-auto-'));
  const demarrage = mkdtempSync(join(tmpdir(), 'osp-startup-'));
  try {
    // A stand-in for the CLI that stays alive, like `kickswarm bee`.
    const cli = join(home, 'faux-cli.mjs');
    writeFileSync(cli, 'setInterval(() => {}, 1000);\n');
    const d = demarrer(home, 'http://127.0.0.1:7777', { cli, args: [] });
    assert.ok(!d.deja && d.pid > 0);
    assert.ok(etat(home).actif);
    assert.ok(demarrer(home, 'http://127.0.0.1:7777', { cli, args: [] }).deja, 'never two engines');
    assert.ok(arreter(home));
    await new Promise((ok) => setTimeout(ok, 300));
    assert.ok(!etat(home).actif);

    const env = { KICKSWARM_STARTUP_DIR: demarrage };
    for (const plateforme of ['win32', 'darwin', 'linux'] as const) {
      const f = installerDemarrageAuto(home, 'http://127.0.0.1:7777', { env, plateforme, cli: '/opt/kickswarm/cli.js' });
      const contenu = readFileSync(f, 'utf8');
      assert.match(contenu, /engine/);
      assert.match(contenu, /http:\/\/127\.0\.0\.1:7777/);
      assert.ok(retirerDemarrageAuto({ env, plateforme }));
      assert.ok(!existsSync(f));
    }
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(demarrage, { recursive: true, force: true });
  }
});

/** A raw request, with a chosen Host and Origin (fetch does not let us set Host). */
function brut(port: number, o: { methode?: string; chemin: string; host?: string; origin?: string; corps?: unknown }): Promise<{ status: number; corps: string; entetes: Record<string, unknown> }> {
  return new Promise((ok, ko) => {
    const donnees = o.corps === undefined ? undefined : JSON.stringify(o.corps);
    const r = request(
      { host: '127.0.0.1', port, method: o.methode ?? 'GET', path: o.chemin, headers: { host: o.host ?? `127.0.0.1:${port}`, ...(o.origin ? { origin: o.origin } : {}), ...(donnees ? { 'content-type': 'application/json' } : {}) } },
      (res) => {
        let c = '';
        res.on('data', (d) => (c += d));
        res.on('end', () => ok({ status: res.statusCode ?? 0, corps: c, entetes: res.headers }));
      },
    );
    r.on('error', ko);
    r.end(donnees);
  });
}

test('the engine’s page and one-click join: presence for any page, everything else only from the engine’s own page', async () => {
  const rejoints: string[] = [];
  let pauses = 0;
  const tableau: Tableau = {
    etat: async () => ({ puissance: puissance([]), acces: [] }),
    basculerPause: () => void pauses++,
    coordinateur: () => 'http://127.0.0.1:7777',
    nomRuche: async () => 'Mini maths library',
    rejoindre: async (ruche) => void rejoints.push(ruche),
  };
  const s = serveurPerso(new Pool([]), { jeton: 'ks-secret', autoriserGratuits: true, tableau });
  await new Promise<void>((ok) => s.listen(0, '127.0.0.1', ok));
  const port = (s.address() as AddressInfo).port;
  const moi = `http://127.0.0.1:${port}`;
  try {
    // Any project page may ask whether an engine runs here (and nothing more).
    const presence = await brut(port, { chemin: '/v0/engine', host: 'example.org' });
    assert.equal(presence.status, 200);
    assert.equal(presence.entetes['access-control-allow-origin'], '*');
    assert.equal(presence.entetes['access-control-allow-private-network'], 'true');
    assert.deepEqual(JSON.parse(presence.corps), { kickswarm: 'engine', version: 1 });
    // The rest answers only under the engine's own address: no DNS rebinding.
    assert.equal((await brut(port, { chemin: '/v0/engine/state', host: 'attacker.example:80' })).status, 403);
    assert.match((await brut(port, { chemin: '/' })).corps, /Your <em>swarm power<\/em>/);
    // The personal endpoint keeps its key.
    assert.equal((await brut(port, { chemin: '/v1/models' })).status, 401);

    const page = await brut(port, { chemin: '/join?hive=maths&coordinator=http%3A%2F%2F127.0.0.1%3A7777' });
    assert.match(page.corps, /Join <em>Mini maths library<\/em>\?/);
    const nonce = /"nonce":"([^"]+)"/.exec(page.corps)![1]!;
    const demande = { ruche: 'maths', coordinateur: 'http://127.0.0.1:7777', nonce };
    // Another site cannot confirm in your place, even with the nonce.
    assert.equal((await brut(port, { methode: 'POST', chemin: '/v0/engine/join', origin: 'https://evil.example', corps: demande })).status, 403);
    assert.equal((await brut(port, { methode: 'POST', chemin: '/v0/engine/join', corps: demande })).status, 403);
    assert.equal((await brut(port, { methode: 'POST', chemin: '/v0/engine/join', origin: moi, corps: demande })).status, 200);
    assert.deepEqual(rejoints, ['maths']);
    assert.equal((await brut(port, { methode: 'POST', chemin: '/v0/engine/join', origin: moi, corps: demande })).status, 403, 'a confirmation works once');
    // The project page may say localhost where the engine says 127.0.0.1: the same coordinator.
    assert.match((await brut(port, { chemin: '/join?hive=maths&coordinator=http%3A%2F%2Flocalhost%3A7777' })).corps, /Yes, join/);
    // A project on another coordinator: the page says how, it does not switch on its own.
    assert.match((await brut(port, { chemin: '/join?hive=other&coordinator=https%3A%2F%2Fother.example' })).corps, /kickswarm join other --url https:\/\/other\.example/);
    assert.equal((await brut(port, { methode: 'POST', chemin: '/v0/engine/pause', origin: 'https://evil.example' })).status, 403);
    assert.equal((await brut(port, { methode: 'POST', chemin: '/v0/engine/pause', origin: moi })).status, 200);
    assert.equal(pauses, 1);
  } finally {
    s.close();
  }
});

test('the agents table matches the catalogue', () => {
  for (const [id, def] of Object.entries(AGENTS)) assert.equal(CATALOGUE[id]!.agent, def.id);
});
