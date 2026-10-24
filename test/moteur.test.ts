import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { auditRegistry } from '../src/coordinator/audit.js';
import { Coordinator } from '../src/coordinator/coordinator.js';
import { createCoordinatorServer } from '../src/coordinator/http.js';
import { seededRng } from '../src/coordinator/scheduler.js';
import { ENFANTS, RACINE, SOLUTIONS } from '../src/exemples/maths.js';
import { AbeilleApi } from '../src/moteur/abeille.js';
import { ajouterFournisseur, chargerConfig, fournisseursActifs } from '../src/moteur/config.js';
import { duree, type Fournisseur } from '../src/moteur/fournisseurs.js';
import { Pool } from '../src/moteur/pool.js';
import { serveurPerso } from '../src/moteur/serveur.js';
import { makeDecision, makeDecomposition, makeHive, makeRequete, signataire } from '../src/protocol/builders.js';
import { generateIdentity } from '../src/protocol/identity.js';
import { executeursNode } from '../src/verifier/v0.js';

// OSP v0.4 U3: the API door and the local engine. A fake provider plays OpenRouter (free models, a
// test model, a paid one, an embedding model, one that is out of quota) and a fake local server plays
// Ollama: the engine is tested over real HTTP, with no real key.

interface Fausse {
  url: string;
  appels: Array<{ modele: string; stream: boolean; correction: boolean }>;
  ajouterGratuit(id: string): void;
  fermer(): Promise<void>;
}

async function faux(): Promise<Fausse> {
  const modeles = [
    { id: 'acme/fort:free', pricing: { prompt: '0', completion: '0' }, context_length: 65_536 },
    { id: 'acme/apprenti:free', pricing: { prompt: '0', completion: '0' }, context_length: 32_768 },
    { id: 'acme/limite:free', pricing: { prompt: '0', completion: '0' }, context_length: 32_768 },
    { id: 'acme/cher', pricing: { prompt: '0.000003', completion: '0.000015' }, context_length: 200_000 },
    { id: 'acme/embed:free', pricing: { prompt: '0', completion: '0' }, context_length: 8192 },
  ];
  const appels: Fausse['appels'] = [];
  const http: Server = createServer((req, res) => {
    let corps = '';
    req.on('data', (c) => (corps += c));
    req.on('end', () => {
      const chemin = req.url ?? '';
      const envoyer = (status: number, j: unknown, h: Record<string, string> = {}) => {
        res.writeHead(status, { 'content-type': 'application/json', ...h });
        res.end(JSON.stringify(j));
      };
      if (req.method === 'GET' && chemin === '/api/v1/models') return envoyer(200, { data: modeles });
      if (req.method === 'GET' && chemin === '/local/v1/models') return envoyer(200, { data: [{ id: 'qwen-local' }, { id: 'nomic-embed-text' }] });
      if (req.method !== 'POST') return envoyer(404, {});
      const b = JSON.parse(corps) as { model: string; stream?: boolean; messages: Array<{ role: string; content: string }> };
      const correction = b.messages.some((m) => m.role === 'user' && m.content.includes('Your code was checked'));
      appels.push({ modele: b.model, stream: !!b.stream, correction });
      if (b.model === 'acme/limite:free') return envoyer(429, { error: { message: 'rate limited' } }, { 'retry-after': '120' });
      const prompt = b.messages.map((m) => m.content).join('\n');
      const module = /`([A-Za-z0-9_.\/-]+\.mjs)`/.exec(prompt)?.[1];
      let texte = chemin.startsWith('/local') ? 'local answer' : `Hello from ${b.model}`;
      if (module && SOLUTIONS[module]) {
        const juste = b.model !== 'acme/apprenti:free' || correction;
        const code = juste ? SOLUTIONS[module]! : SOLUTIONS[module]!.replace(/return/, 'return 1 + ');
        texte = `Here is the solution:\n\n\`\`\`js ${module}\n${code}\`\`\`\n`;
      }
      if (b.stream) {
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: texte } }] })}\n\n`);
        return res.end('data: [DONE]\n\n');
      }
      envoyer(200, { id: 'x', object: 'chat.completion', model: b.model, choices: [{ index: 0, message: { role: 'assistant', content: texte }, finish_reason: 'stop' }] });
    });
  });
  await new Promise<void>((ok) => http.listen(0, '127.0.0.1', ok));
  const url = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
  return {
    url,
    appels,
    ajouterGratuit: (id) => modeles.push({ id, pricing: { prompt: '0', completion: '0' }, context_length: 131_072 }),
    fermer: async () => {
      http.closeAllConnections();
      await new Promise<void>((ok) => http.close(() => ok()));
    },
  };
}

const openrouter = (url: string, extra: Partial<Fournisseur> = {}): Fournisseur => ({ id: 'openrouter', api: 'openai', url: `${url}/api/v1`, cle: 'sk-test', gratuit: true, confidentiel: false, decouverte: 'openrouter-gratuits', ...extra });
const local = (url: string): Fournisseur => ({ id: 'ollama', api: 'openai', url: `${url}/local/v1`, gratuit: true, confidentiel: true, decouverte: 'liste', local: true });
const payant = (url: string): Fournisseur => ({ id: 'payant', api: 'openai', url: `${url}/api/v1`, cle: 'sk-paid', gratuit: false, confidentiel: true, decouverte: 'aucune', modeles: ['acme/cher'] });

test('the pool: OpenRouter’s free models found automatically, quotas, you first, privacy, fallback', async () => {
  const f = await faux();
  try {
    const p = new Pool([openrouter(f.url, { parJour: 10 }), local(f.url), payant(f.url)], { reservePerso: 0.3, payantsParJour: 0 });
    await p.decouvrir();
    assert.deepEqual(p.modeles().map((m) => m.id).sort(), ['ollama/qwen-local', 'openrouter/acme/apprenti:free', 'openrouter/acme/fort:free', 'openrouter/acme/limite:free', 'payant/acme/cher'], 'zero-price text models only, no paid or embedding model from the free list');
    // A test model offered free tomorrow is used tomorrow.
    f.ajouterGratuit('stealth/nouveau:free');
    await p.decouvrir();
    assert.ok(p.modeles().some((m) => m.id === 'openrouter/stealth/nouveau:free'));

    const essaim = { tokens: 1000, maxTokens: 1000, usage: 'essaim' as const, confidentiel: false };
    // Cloud models first, best measured first, local model as the fallback; the paid model needs a budget.
    p.noterQualite([{ modele: 'openrouter/acme/apprenti:free', valides: 9, rejetes: 1 }]);
    const ordre = p.candidats(essaim).map((m) => m.id);
    assert.equal(ordre[0], 'openrouter/acme/apprenti:free');
    assert.equal(ordre.at(-1), 'ollama/qwen-local');
    assert.ok(!ordre.includes('payant/acme/cher'), 'no paid call for the swarm without a budget');
    assert.ok(p.candidats({ ...essaim, usage: 'perso' }).some((m) => m.id === 'payant/acme/cher'), 'your paid key serves you');
    // Private work: confidential models only.
    assert.deepEqual(p.candidats({ ...essaim, confidentiel: true }).map((m) => m.id), ['ollama/qwen-local']);
    assert.deepEqual(p.candidats({ ...essaim, confidentiel: true, usage: 'perso' }).map((m) => m.id), ['payant/acme/cher', 'ollama/qwen-local']);
    // A request too large for a model's context skips it.
    assert.ok(!p.candidats({ ...essaim, tokens: 60_000 }).some((m) => m.contexte < 61_000));

    // You first: of 10 requests a day, the swarm takes 7 at most.
    const m = p.modeles().find((x) => x.id === 'openrouter/acme/fort:free')!;
    for (let i = 0; i < 7; i++) p.noterAppel(m);
    assert.ok(!p.candidats(essaim).some((x) => x.fournisseur === 'openrouter'), 'the swarm stops at 70% of the quota');
    assert.ok(p.candidats({ ...essaim, usage: 'perso' }).some((x) => x.fournisseur === 'openrouter'), 'the rest is kept for you');

    // Fallback: the best-ranked model is out of quota (429, retry in 120 s): it is paused, the next answers.
    const q = new Pool([openrouter(f.url)]);
    await q.decouvrir();
    q.noterQualite([{ modele: 'openrouter/acme/limite:free', valides: 50, rejetes: 0 }]);
    const r = await q.completer(essaim, [{ role: 'user', content: 'hi' }]);
    assert.notEqual(r.modele.id, 'openrouter/acme/limite:free');
    assert.ok(!q.candidats(essaim).some((x) => x.id === 'openrouter/acme/limite:free'), 'paused after its refusal');
    assert.equal(duree('1m30s'), 90_000);
    assert.equal(duree('2'), 2000);
  } finally {
    await f.fermer();
  }
});

test('kickswarm bee: a free model takes a task, fixes it after a failed check, the guard validates it, the leaderboard shows it', async () => {
  const f = await faux();
  const fondateur = generateIdentity();
  const c = new Coordinator({ fondateur: fondateur.id, params: { alpha_faux: 0.05, taux_pieges: 0, gardiennes_v0: 1 }, rng: seededRng(9) });
  c.proposeHive(makeHive(fondateur, { slug: 'maths', nom: 'Maths', objectif: RACINE.objectif }), RACINE);
  c.decide(makeDecision(fondateur, 'approbation_ruche', 'maths', 'ok'));
  const sc = generateIdentity();
  const s = c.claim(makeRequete(sc, 'claim', { castes: ['eclaireuse'] }))!;
  const d = await c.submitDecomposition(makeDecomposition(sc, s.alveole_id, ENFANTS));
  c.decide(makeDecision(fondateur, 'approbation_decoupage', d.decoupage, 'ok'));
  const http = createCoordinatorServer(c);
  await new Promise<void>((ok) => http.listen(0, '127.0.0.1', ok));
  const url = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
  try {
    const p = new Pool([openrouter(f.url)]);
    await p.decouvrir();
    // The apprentice is ranked first: its first answer is wrong, it fixes it when told what failed.
    p.noterQualite([{ modele: 'openrouter/acme/apprenti:free', valides: 20, rejetes: 0 }]);
    const lignes: string[] = [];

    // You first: while a personal request runs on the same pool, the swarm waits.
    const occupe = new Pool([openrouter(f.url)]);
    await occupe.decouvrir();
    const enAttente = new AbeilleApi({ url, pool: occupe, signataire: signataire(generateIdentity()), executeurs: executeursNode(), castes: ['ouvriere'] });
    let liberer!: () => void;
    const perso = occupe.pourMoi(() => new Promise<void>((ok) => (liberer = ok)));
    assert.equal(await enAttente.tour(), 'pause');
    liberer();
    await perso;
    assert.equal(await enAttente.tour(), 'pause', 'and for a moment after');

    const bee2 = new AbeilleApi({ url, pool: p, signataire: signataire(generateIdentity()), executeurs: executeursNode(), castes: ['ouvriere'], log: (l) => lignes.push(l) });
    assert.equal(await bee2.tour(), 'rendu', lignes.join('\n'));
    const apprenti = f.appels.filter((a) => a.modele === 'acme/apprenti:free');
    assert.deepEqual(apprenti.map((a) => a.correction), [false, true], 'one wrong answer, then the fix after the failure report');

    // A guard (no AI needed) validates it: honey.
    const garde = new AbeilleApi({ url, pool: new Pool([]), signataire: signataire(generateIdentity()), executeurs: executeursNode(), castes: ['gardienne'] });
    assert.equal(await garde.tour(), 'garde');
    const classement = (await (await fetch(`${url}/v0/models`)).json()) as { modeles: Array<{ modele: string; famille: string; valides: number; score: number }> };
    const ligne = classement.modeles.find((m) => m.modele === 'openrouter/acme/apprenti:free')!;
    assert.equal(ligne.famille, 'api');
    assert.equal(ligne.valides, 1);
    assert.ok(ligne.score > 0.5);

    // The engine takes the leaderboard into account.
    await bee2.rafraichirQualite();
    assert.ok(p.score(p.modeles().find((m) => m.id === 'openrouter/acme/apprenti:free')!) > 0.5);

    const report = await auditRegistry(c.registry.entries, { reverifier: true, etatAnnonce: c.stateHash() });
    assert.ok(report.ok, JSON.stringify(report.controles.filter((x) => !x.ok)));
  } finally {
    http.closeAllConnections();
    await new Promise<void>((ok) => http.close(() => ok()));
    await f.fermer();
  }
});

test('the personal endpoint: one local address for every free model, with a key, streaming, fallback and privacy', async () => {
  const f = await faux();
  const p = new Pool([openrouter(f.url), local(f.url)]);
  await p.decouvrir();
  p.noterQualite([{ modele: 'openrouter/acme/limite:free', valides: 50, rejetes: 0 }]);
  const lancer = async (autoriserGratuits: boolean) => {
    const s = serveurPerso(p, { jeton: 'ks-secret', autoriserGratuits });
    await new Promise<void>((ok) => s.listen(0, '127.0.0.1', ok));
    return { s, url: `http://127.0.0.1:${(s.address() as AddressInfo).port}` };
  };
  const { s, url } = await lancer(true);
  const auth = { authorization: 'Bearer ks-secret', 'content-type': 'application/json' };
  try {
    assert.equal((await fetch(`${url}/v1/models`)).status, 401, 'no key, no AI');
    assert.equal((await fetch(`${url}/v1/models`, { headers: { authorization: 'Bearer wrong-secret' } })).status, 401);
    const liste = (await (await fetch(`${url}/v1/models`, { headers: auth })).json()) as { data: Array<{ id: string }> };
    assert.equal(liste.data[0]!.id, 'auto');
    assert.ok(liste.data.some((m) => m.id === 'openrouter/acme/fort:free'));

    // The best-ranked model is out of quota: the request goes to the next one, transparently.
    const r = await fetch(`${url}/v1/chat/completions`, { method: 'POST', headers: auth, body: JSON.stringify({ model: 'auto', messages: [{ role: 'user', content: 'hello' }] }) });
    assert.equal(r.status, 200);
    assert.notEqual(r.headers.get('x-kickswarm-model'), 'openrouter/acme/limite:free');
    const j = (await r.json()) as { choices: Array<{ message: { content: string } }> };
    assert.match(j.choices[0]!.message.content, /^Hello from acme\//);
    assert.ok(!p.essaimPeutTravailler(), 'the swarm waits a moment after a personal request');

    // Streaming passes through.
    const flux = await fetch(`${url}/v1/chat/completions`, { method: 'POST', headers: auth, body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }], stream: true }) });
    assert.match(flux.headers.get('content-type')!, /event-stream/);
    assert.match(await flux.text(), /data: \[DONE\]/);
  } finally {
    s.close();
  }
  // Personal data stays on confidential models when free ones are not allowed.
  const prive = await lancer(false);
  try {
    const liste = (await (await fetch(`${prive.url}/v1/models`, { headers: auth })).json()) as { data: Array<{ id: string }> };
    assert.deepEqual(liste.data.map((m) => m.id), ['auto', 'ollama/qwen-local']);
    const r = await fetch(`${prive.url}/v1/chat/completions`, { method: 'POST', headers: auth, body: JSON.stringify({ messages: [{ role: 'user', content: 'my private notes' }] }) });
    assert.equal(r.headers.get('x-kickswarm-model'), 'ollama/qwen-local');
  } finally {
    prive.s.close();
    await f.fermer();
  }
});

test('engine settings: keys from the file or the environment, local servers always tried, one entry per provider', () => {
  const home = mkdtempSync(join(tmpdir(), 'osp-moteur-'));
  try {
    let c = chargerConfig(home);
    assert.match(c.jeton, /^ks-/);
    assert.equal(chargerConfig(home).jeton, c.jeton, 'the endpoint key is kept');
    const ids = (env: Record<string, string>) => fournisseursActifs(c, env).map((f) => f.id).sort();
    assert.deepEqual(ids({}), ['lmstudio', 'ollama'], 'without keys: only the local servers');
    assert.deepEqual(ids({ GROQ_API_KEY: 'g' }), ['groq', 'lmstudio', 'ollama']);
    c = ajouterFournisseur(c, { id: 'openrouter', cle: 'sk-or', parJour: 50 });
    c = ajouterFournisseur(c, { id: 'openrouter', parJour: 1000 });
    assert.equal(c.fournisseurs.length, 1);
    const or = fournisseursActifs(c, {}).find((f) => f.id === 'openrouter')!;
    assert.deepEqual([or.cle, or.parJour, or.decouverte], ['sk-or', 1000, 'openrouter-gratuits']);
    assert.throws(() => ajouterFournisseur(c, { id: 'inconnu' }), /--base/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
