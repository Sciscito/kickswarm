import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { completer, refus, requeteBrute, type Message } from './fournisseurs.js';
import type { Pool } from './pool.js';
import { pageRejoindre, pageTableau } from './tableau.js';

// The personal endpoint of the local engine (OSP v0.4 §2.6): an OpenAI-compatible API on this machine,
// protected by a token. The contributor's own tools point at it and get every free model they have
// behind one address. Personal requests come first: while one runs, the swarm waits. Requests are
// passed through to the provider (streaming included); on a refusal before anything was sent, the
// next model is tried. Listens on 127.0.0.1 only.

export interface OptionsServeur {
  jeton: string;
  /** Free (non-confidential) models for personal requests too; they may train on prompts. */
  autoriserGratuits: boolean;
  log?: (ligne: string) => void;
  /** The engine's own pages: the dashboard and the one-click join (absent: the endpoint only). */
  tableau?: Tableau;
}

export interface Tableau {
  etat: () => Promise<Record<string, unknown>>;
  basculerPause: () => void;
  /** The coordinator this engine works for, if any yet. */
  coordinateur: () => string | undefined;
  nomRuche: (ruche: string, coordinateur: string) => Promise<string>;
  rejoindre: (ruche: string, coordinateur: string) => Promise<void>;
}

const RUCHE = /^(p[0-9a-f]{32}|[a-z0-9][a-z0-9-]{1,39})$/;

/** The same coordinator, whatever the spelling: localhost and 127.0.0.1, a final slash. */
export function memeCoordinateur(a: string, b: string): boolean {
  const norme = (x: string) => {
    try {
      const u = new URL(x);
      if (u.hostname === 'localhost' || u.hostname === '[::1]') u.hostname = '127.0.0.1';
      return u.origin;
    } catch {
      return x.replace(/\/+$/, '');
    }
  };
  return norme(a) === norme(b);
}

const MAX_CORPS = 4 * 1024 * 1024;

function lire(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((ok, ko) => {
    const morceaux: Buffer[] = [];
    let taille = 0;
    req.on('data', (c: Buffer) => {
      taille += c.length;
      if (taille > MAX_CORPS) {
        ko(new Error('Request too large'));
        req.destroy();
      } else morceaux.push(c);
    });
    req.on('end', () => {
      try {
        ok(morceaux.length ? (JSON.parse(Buffer.concat(morceaux).toString('utf8')) as Record<string, unknown>) : {});
      } catch {
        ko(new Error('Invalid JSON'));
      }
    });
    req.on('error', ko);
  });
}

function json(res: ServerResponse, status: number, corps: unknown): void {
  const t = JSON.stringify(corps);
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(t) });
  res.end(t);
}

const erreur = (res: ServerResponse, status: number, message: string) => json(res, status, { error: { message, type: 'kickswarm_engine' } });

/**
 * The engine's pages. A project page anywhere may ask whether an engine runs here (/v0/engine), and
 * open the join page; everything else answers only under the engine's own address (no DNS rebinding),
 * and every change needs a request from the engine's own page (its Origin): no site can act for you.
 */
async function pages(req: IncomingMessage, res: ServerResponse, chemin: string, u: URL, t: Tableau, nonces: Map<string, { ruche: string; coordinateur: string; expire: number }>): Promise<void> {
  const port = req.socket.localPort;
  const origines = [`http://127.0.0.1:${port}`, `http://localhost:${port}`];
  if (chemin === '/v0/engine') {
    // Presence only, readable by any page: a project page uses it to offer one-click join.
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-private-network': 'true', 'access-control-allow-methods': 'GET', 'access-control-allow-headers': 'content-type' };
    if (req.method === 'OPTIONS') return void res.writeHead(204, cors).end();
    res.writeHead(200, { 'content-type': 'application/json', ...cors });
    return void res.end(JSON.stringify({ kickswarm: 'engine', version: 1 }));
  }
  if (!origines.map((x) => x.slice(7)).includes(req.headers.host ?? '')) return erreur(res, 403, 'Open this page at its own address: http://127.0.0.1:' + port);
  const html = (h: string) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'x-frame-options': 'DENY', 'cache-control': 'no-store' });
    res.end(h);
  };
  if (req.method === 'GET' && chemin === '/') return html(pageTableau());
  if (req.method === 'GET' && chemin === '/v0/engine/state') return json(res, 200, await t.etat());
  if (req.method === 'GET' && chemin === '/join') {
    const ruche = u.searchParams.get('hive') ?? '';
    const coordinateur = (u.searchParams.get('coordinator') ?? '').replace(/\/+$/, '');
    if (!RUCHE.test(ruche) || !/^https?:\/\/[^\s/]+$/.test(coordinateur)) return erreur(res, 400, 'A join link names a hive and its coordinator');
    const actuel = t.coordinateur();
    if (actuel && !memeCoordinateur(actuel, coordinateur)) return html(pageRejoindre({ ruche, nom: ruche, coordinateur, nonce: '', conflit: actuel }));
    const nonce = randomBytes(18).toString('base64url');
    nonces.set(nonce, { ruche, coordinateur, expire: Date.now() + 10 * 60_000 });
    return html(pageRejoindre({ ruche, nom: await t.nomRuche(ruche, coordinateur).catch(() => ruche), coordinateur, nonce }));
  }
  if (req.method === 'POST') {
    if (!origines.includes(req.headers.origin ?? '')) return erreur(res, 403, 'Only the engine’s own page can do this');
    if (chemin === '/v0/engine/pause') {
      t.basculerPause();
      return json(res, 200, { ok: true });
    }
    if (chemin === '/v0/engine/join') {
      const b = await lire(req);
      const n = nonces.get(String(b.nonce ?? ''));
      if (!n || n.expire < Date.now() || n.ruche !== b.ruche || n.coordinateur !== b.coordinateur) return erreur(res, 403, 'This join page has expired: open the project link again');
      nonces.delete(String(b.nonce));
      await t.rejoindre(n.ruche, n.coordinateur);
      return json(res, 200, { ok: true, ruche: n.ruche });
    }
  }
  return erreur(res, 404, 'Unknown page');
}

function autorise(req: IncomingMessage, jeton: string): boolean {
  const h = req.headers.authorization ?? '';
  const donne = Buffer.from(h.startsWith('Bearer ') ? h.slice(7).trim() : '');
  const attendu = Buffer.from(jeton);
  return donne.length === attendu.length && timingSafeEqual(donne, attendu);
}

/** Rough size of a request in tokens: enough to pick a model with room for it. */
function tokensDe(messages: unknown): number {
  return Math.ceil(JSON.stringify(messages ?? '').length / 4);
}

export function serveurPerso(pool: Pool, o: OptionsServeur): Server {
  const log = o.log ?? (() => {});
  const nonces = new Map<string, { ruche: string; coordinateur: string; expire: number }>();
  return createServer(async (req, res) => {
    try {
      const u = new URL(req.url ?? '/', 'http://localhost');
      const chemin = u.pathname.replace(/\/+$/, '') || '/';
      if (o.tableau && !chemin.startsWith('/v1/')) return await pages(req, res, chemin, u, o.tableau, nonces);
      if (!autorise(req, o.jeton)) return erreur(res, 401, 'Use the key printed by kickswarm engine (Authorization: Bearer …)');
      if (req.method === 'GET' && chemin === '/v1/models') {
        const liste = pool.modeles().filter((m) => o.autoriserGratuits || m.confidentiel);
        return json(res, 200, { object: 'list', data: [{ id: 'auto', object: 'model', owned_by: 'kickswarm' }, ...liste.map((m) => ({ id: m.id, object: 'model', owned_by: m.fournisseur, context_length: m.contexte }))] });
      }
      if (req.method !== 'POST' || chemin !== '/v1/chat/completions') return erreur(res, 404, 'Unknown route: this endpoint serves /v1/models and /v1/chat/completions');
      const corps = await lire(req);
      await pool.pourMoi(async () => {
        const maxTokens = typeof corps.max_tokens === 'number' ? corps.max_tokens : 4096;
        const besoin = { tokens: tokensDe(corps.messages), maxTokens, usage: 'perso' as const, confidentiel: !o.autoriserGratuits };
        const demande = typeof corps.model === 'string' && corps.model !== 'auto' ? corps.model : undefined;
        const candidats = pool.candidats(besoin).filter((m) => !demande || m.id === demande);
        if (!candidats.length) return erreur(res, demande ? 404 : 429, demande ? `Model ${demande} is not available now` : 'No model available right now: every quota is used or paused');
        for (const m of candidats) {
          const f = pool.fournisseurs.find((x) => x.id === m.fournisseur)!;
          pool.noterAppel(m);
          try {
            if (f.api === 'anthropic') {
              // No pass-through for this API: plain messages in, one answer out, in the OpenAI shape.
              const texte = await completer(f, m.nom, (corps.messages as Message[]) ?? [], { maxTokens });
              pool.noterSucces(m);
              return json(res, 200, { id: `ks-${Date.now()}`, object: 'chat.completion', created: Math.floor(Date.now() / 1000), model: m.id, choices: [{ index: 0, message: { role: 'assistant', content: texte }, finish_reason: 'stop' }] });
            }
            const amont = await requeteBrute(f, { ...corps, model: m.nom });
            if (!amont.ok) {
              pool.noterRefus(m, await refus(amont));
              continue;
            }
            pool.noterSucces(m);
            log(`personal request → ${m.id}`);
            res.writeHead(200, { 'content-type': amont.headers.get('content-type') ?? 'application/json', 'x-kickswarm-model': m.id });
            if (!amont.body) return res.end();
            for await (const morceau of amont.body as unknown as AsyncIterable<Uint8Array>) res.write(morceau);
            return res.end();
          } catch (e) {
            if (res.headersSent) return res.end();
            pool.noterRefus(m, e);
          }
        }
        return erreur(res, 429, 'Every model refused or is paused right now');
      });
    } catch (e) {
      if (!res.headersSent) erreur(res, 400, (e as Error).message);
      else res.end();
    }
  });
}
