import { readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { isContributorId } from '../protocol/identity.js';
import type { CellSpec, Decision, Decomposition, Hive, Livrable, Requete, Result, Secrets, Verdict } from '../protocol/types.js';
import { Coordinator, OspError } from './coordinator.js';
import { COMMUN } from './ledger.js';

// API HTTP du coordinateur (spec §21.2). Toute requête qui modifie l'état porte un objet signé.

const MAX_BODY = 1024 * 1024;

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new OspError('Corps de requête trop gros (1 Mo maximum)', 413));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
      } catch {
        reject(new OspError('JSON invalide'));
      }
    });
    req.on('error', reject);
  });
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(json),
    'access-control-allow-origin': '*',
  });
  res.end(json);
}

// La ruche en direct (web/hive.html), servie par le coordinateur lui-même.
const PAGE = new URL('../../web/hive.html', import.meta.url);

async function sendPage(res: ServerResponse): Promise<void> {
  const html = await readFile(PAGE, 'utf8');
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'x-content-type-options': 'nosniff', 'cache-control': 'no-cache' });
  res.end(html);
}

/** Flux temps réel (Server-Sent Events) : une notification par nouvelle entrée du registre. */
function streamEvents(coord: Coordinator, req: IncomingMessage, res: ServerResponse): void {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'access-control-allow-origin': '*',
  });
  res.write('retry: 2000\n\n');
  const off = coord.registry.onAppend((e) => res.write(`event: registre\ndata: ${JSON.stringify({ seq: e.seq, nature: e.nature })}\n\n`));
  const ping = setInterval(() => res.write(': ping\n\n'), 15_000);
  req.on('close', () => {
    off();
    clearInterval(ping);
  });
}

export function createCoordinatorServer(coord: Coordinator): Server {
  return createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    const route = `${req.method} /${parts.slice(0, 3).join('/')}`;
    try {
      if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/hive')) return await sendPage(res);
      if (route === 'GET /v0/events') return streamEvents(coord, req, res);
      if (parts[0] !== 'v0') throw new OspError('Route inconnue', 404);
      const body = req.method === 'POST' ? ((await readBody(req)) as Record<string, unknown>) : {};
      switch (true) {
        case route === 'GET /v0':
          return send(res, 200, { protocole: 'OSP', version: '0.1', fondateur: coord.fondateur, coordinateur: coord.identite.id });
        case route === 'GET /v0/hives' && parts.length === 2:
          return send(res, 200, coord.listHives());
        case route.startsWith('GET /v0/hives/') && parts.length === 3:
          return send(res, 200, coord.hiveView(parts[2]!));
        case route === 'POST /v0/hives':
          return send(res, 201, coord.proposeHive(body.ruche as Hive, body.racine as CellSpec, body.secrets as Secrets | undefined));
        case route === 'POST /v0/work/claim':
          return send(res, 200, { assignation: await coord.reclamer(body as unknown as Requete) });
        case route === 'POST /v0/work/start':
          return send(res, 200, coord.start(body as unknown as Requete));
        case route === 'POST /v0/work/release':
          return send(res, 200, coord.release(body as unknown as Requete));
        case route === 'POST /v0/work/submit':
          return send(res, 200, await coord.submitResult(body.resultat as Result, body.livrable as Livrable));
        case route === 'POST /v0/work/decompose':
          // Les secrets voyagent à côté de l'objet signé : { decomposition, secrets }. Le format nu reste accepté.
          if (body.type === 'osp.decomposition/0.1') return send(res, 200, await coord.submitDecomposition(body as unknown as Decomposition));
          return send(res, 200, await coord.submitDecomposition(body.decomposition as Decomposition, (body.secrets as Secrets[] | undefined) ?? []));
        case route === 'POST /v0/work/verdict':
          return send(res, 200, await coord.submitVerdict(body as unknown as Verdict));
        case route.startsWith('GET /v0/live/') && parts.length === 3:
          return send(res, 200, coord.liveView(parts[2]!));
        case route.startsWith('GET /v0/board/') && parts.length === 3:
          return send(res, 200, coord.board(parts[2]!));
        case route === 'GET /v0/state-hash':
          return send(res, 200, { seq: coord.registry.entries.length - 1, etat: coord.stateHash(), sceau: coord.dernierSceauInscrit() ?? null });
        case route === 'GET /v0/registry': {
          const since = Number(url.searchParams.get('since') ?? 0);
          return send(res, 200, coord.registry.since(Number.isFinite(since) ? since : 0));
        }
        case route.startsWith('GET /v0/contributors/') && parts.length === 3: {
          const id = parts[2]!;
          if (id !== COMMUN && !isContributorId(id)) throw new OspError('Identifiant invalide');
          return send(res, 200, coord.account(id as Parameters<Coordinator['account']>[0]));
        }
        case route === 'POST /v0/decisions':
          return send(res, 201, coord.decide(body as unknown as Decision));
        default:
          throw new OspError('Route inconnue', 404);
      }
    } catch (e) {
      const status = e instanceof OspError ? e.status : 500;
      const message = e instanceof Error ? e.message : String(e);
      if (status === 500) console.error(`[coordinateur] ${route} :`, e);
      if (!res.headersSent) send(res, status, { erreur: message });
    }
  });
}
