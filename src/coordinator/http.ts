import { readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { isContributorId } from '../protocol/identity.js';
import type { Adhesion, CellSpec, Decision, Decomposition, EngagementVerdict, FusionDepot, Hash, Hive, Invitation, LienGithub, Livrable, RecuDepot, Requete, Result, Secrets, Verdict } from '../protocol/types.js';
import { Coordinator, OspError } from './coordinator.js';
import { Hote } from './hote.js';
import { COMMUN } from './ledger.js';

// Coordinator HTTP API (spec §21.2). Every request that changes the state carries a signed object.

const MAX_BODY = 1024 * 1024;

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new OspError('Request body too large (1 MB maximum)', 413));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
      } catch {
        reject(new OspError('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

/** A JSON answer. Private routes carry no cross-origin permission: no other site may read them. */
function send(res: ServerResponse, status: number, body: unknown, prive = false): void {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(json),
    ...(prive ? { 'cache-control': 'no-store' } : { 'access-control-allow-origin': '*' }),
  });
  res.end(json);
}

// The pages the coordinator serves itself: the way in (web/join.html) and the live hive (web/hive.html).
const PAGES = { join: new URL('../../web/join.html', import.meta.url), hive: new URL('../../web/hive.html', import.meta.url) };

async function sendPage(res: ServerResponse, page: keyof typeof PAGES): Promise<void> {
  const html = await readFile(PAGES[page], 'utf8');
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'x-content-type-options': 'nosniff', 'cache-control': 'no-cache' });
  res.end(html);
}

/** Real-time stream (Server-Sent Events): one notification per new registry entry, for one registry. */
function streamEvents(coord: Coordinator, req: IncomingMessage, res: ServerResponse, prive = false): void {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    ...(prive ? {} : { 'access-control-allow-origin': '*' }),
  });
  res.write('retry: 2000\n\n');
  const off = coord.registry.onAppend((e) => res.write(`event: registre\ndata: ${JSON.stringify({ seq: e.seq, nature: e.nature })}\n\n`));
  const ping = setInterval(() => res.write(': ping\n\n'), 15_000);
  req.on('close', () => {
    off();
    clearInterval(ping);
  });
}

/** The read ticket of a private route: `Authorization: Bearer …`, or `?ticket=` for the event stream. */
function ticketDe(req: IncomingMessage, url: URL): string | null {
  const h = req.headers.authorization;
  if (h?.startsWith('Bearer ')) return h.slice(7).trim();
  return url.searchParams.get('ticket');
}

const ID_PRIVE = /^p[0-9a-f]{32}$/;

/**
 * The coordinator's HTTP server. Public hives answer at /v0/…; each private hive answers at
 * /v0/p/{id}/… from its own coordinator instance (OSP v0.3 §2.8), where every read needs a ticket.
 */
export function createCoordinatorServer(coord: Coordinator, hote: Hote = new Hote(coord)): Server {
  return createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    let parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    // A private hive's routes mirror the public ones, on its own instance.
    const prive = parts[0] === 'v0' && parts[1] === 'p' && parts[2] !== undefined ? parts[2] : null;
    if (prive) parts = ['v0', ...parts.slice(3)];
    const route = `${req.method} /${parts.slice(0, 3).join('/')}`;
    try {
      let cible = coord;
      if (prive) {
        if (!ID_PRIVE.test(prive)) throw new OspError('Unknown private hive', 404);
        cible = hote.instance(prive);
        // Every read of a private hive needs a valid ticket of a current member.
        if (req.method === 'GET') hote.lecteur(prive, ticketDe(req, url));
      } else {
        if (req.method === 'GET' && url.pathname === '/hive') return await sendPage(res, 'hive');
        // The way in, and its share links: /join/<hive> opens with that hive picked.
        if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/join' || /^\/join\/[a-z0-9-]{1,40}\/?$/.test(url.pathname))) return await sendPage(res, 'join');
      }
      if (route === 'GET /v0/events') return streamEvents(cible, req, res, prive !== null);
      if (parts[0] !== 'v0') throw new OspError('Unknown route', 404);
      const body = req.method === 'POST' ? ((await readBody(req)) as Record<string, unknown>) : {};
      const ok = (status: number, b: unknown) => send(res, status, b, prive !== null);

      if (prive) {
        switch (route) {
          case 'POST /v0/ticket':
            return ok(200, hote.ticket(prive, body as unknown as Requete));
          case 'POST /v0/invitations':
            return ok(201, cible.inviter(body as unknown as Invitation));
          case 'GET /v0/members':
            return ok(200, cible.membres());
          case 'GET /v0/anchors':
            hote.ancrerMaintenant();
            return ok(200, hote.ancres(prive));
        }
      } else {
        switch (route) {
          case 'POST /v0/private':
            return ok(201, hote.creer(body.ruche as Hive, body.racine as CellSpec, body.approbation as Decision, body.secrets as Secrets | undefined));
          case 'POST /v0/join':
            return ok(200, hote.rejoindre(body as unknown as Adhesion, req.socket.remoteAddress ?? 'unknown'));
        }
      }

      switch (true) {
        case route === 'GET /v0':
          return ok(200, { protocole: 'OSP', version: '0.1', fondateur: cible.fondateur, coordinateur: cible.identite.id, ...(prive ? { prive } : {}) });
        case route === 'GET /v0/hives' && parts.length === 2:
          return ok(200, cible.listHives());
        case route.startsWith('GET /v0/hives/') && parts.length === 3:
          return ok(200, cible.hiveView(parts[2]!));
        case route === 'POST /v0/hives':
          return ok(201, cible.proposeHive(body.ruche as Hive, body.racine as CellSpec, body.secrets as Secrets | undefined));
        case route === 'POST /v0/work/claim':
          return ok(200, { assignation: await cible.reclamer(body as unknown as Requete) });
        case route === 'POST /v0/work/start':
          return ok(200, cible.start(body as unknown as Requete));
        case route === 'POST /v0/work/release':
          return ok(200, cible.release(body as unknown as Requete));
        case route === 'POST /v0/work/submit':
          return ok(200, await cible.submitResult(body.resultat as Result, body.livrable as Livrable));
        case route === 'POST /v0/work/decompose':
          // Secrets travel next to the signed object: { decomposition, secrets }. The bare format is still accepted.
          if (body.type === 'osp.decomposition/0.1') return ok(200, await cible.submitDecomposition(body as unknown as Decomposition));
          return ok(200, await cible.submitDecomposition(body.decomposition as Decomposition, (body.secrets as Secrets[] | undefined) ?? []));
        case route === 'POST /v0/work/commit':
          return ok(200, cible.engagerVerdict(body as unknown as EngagementVerdict));
        case route === 'POST /v0/work/verdict':
          return ok(200, await cible.submitVerdict(body as unknown as Verdict));
        case route.startsWith('GET /v0/live/') && parts.length === 3:
          return ok(200, cible.liveView(parts[2]!));
        case route.startsWith('GET /v0/board/') && parts.length === 3:
          return ok(200, cible.board(parts[2]!));
        case route === 'GET /v0/state-hash':
          return ok(200, cible.etatPublie());
        case route === 'GET /v0/registry': {
          // The content is published up to the embargo horizon (OSP v0.2 P0-3).
          const since = Number(url.searchParams.get('since') ?? 0);
          return ok(200, cible.registry.entries.slice(Number.isFinite(since) ? Math.max(0, since) : 0, cible.horizon() + 1));
        }
        case route.startsWith('GET /v0/contributors/') && parts.length === 3: {
          const id = parts[2]!;
          if (id !== COMMUN && !isContributorId(id)) throw new OspError('Invalid identifier');
          return ok(200, cible.account(id as Parameters<Coordinator['account']>[0]));
        }
        case route === 'POST /v0/decisions':
          return ok(201, cible.decide(body as unknown as Decision));
        // OSP v0.3 §3.3: what the bridge reads and writes. It runs on a member's machine, with their own git.
        case route.startsWith('GET /v0/cells/') && parts.length === 3:
          return ok(200, cible.detailCellule(parts[2]! as Hash));
        case route === 'GET /v0/repo/honey':
          return ok(200, cible.mielsDepot());
        case route === 'POST /v0/repo/receipts':
          return ok(201, cible.recuDepot(body as unknown as RecuDepot));
        case route === 'POST /v0/repo/github':
          return ok(201, cible.lienGithub(body as unknown as LienGithub));
        case route === 'POST /v0/repo/merges':
          return ok(201, cible.fusionDepot(body as unknown as FusionDepot));
        default:
          throw new OspError('Unknown route', 404);
      }
    } catch (e) {
      const status = e instanceof OspError ? e.status : 500;
      const message = e instanceof Error ? e.message : String(e);
      if (status === 500) console.error(`[coordinator] ${route}:`, e);
      if (!res.headersSent) send(res, status, { erreur: message }, prive !== null);
    }
  });
}
