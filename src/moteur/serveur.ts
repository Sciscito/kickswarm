import { timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { completer, refus, requeteBrute, type Message } from './fournisseurs.js';
import type { Pool } from './pool.js';

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
  return createServer(async (req, res) => {
    try {
      if (!autorise(req, o.jeton)) return erreur(res, 401, 'Use the key printed by kickswarm engine (Authorization: Bearer …)');
      const chemin = new URL(req.url ?? '/', 'http://localhost').pathname.replace(/\/+$/, '');
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
