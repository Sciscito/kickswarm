import { availableParallelism } from 'node:os';
import type { IncomingMessage } from 'node:http';
import { OspError } from './coordinator.js';

// The public coordinator's guard (`kickswarm coordinator --public`): nobody tests the network before
// everyone comes in, so the coordinator protects itself. Each address has a budget of reads, writes and
// project proposals; real-time streams are capped; the heavy work (running deliverables, measuring tests)
// waits in a bounded queue instead of piling up. Requests from this machine itself (the operator, the
// launch of the prepared projects) are not counted.

export interface OptionsGarde {
  /** Behind a reverse proxy on this machine (Caddy): the client's address is the last X-Forwarded-For hop. */
  proxy?: boolean;
  lecturesParMinute?: number;
  ecrituresParMinute?: number;
  propositionsParHeure?: number;
  privesParJour?: number;
  fluxParAdresse?: number;
  fluxMax?: number;
  /** Heavy requests run at most this many at a time (default: the number of processor cores). */
  lourdesSimultanees?: number;
  /** And at most this many wait; beyond that the coordinator answers "busy, retry". */
  fileMax?: number;
}

const BOUCLE = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const MINUTE = 60_000;

export class Garde {
  private readonly fenetres = new Map<string, { n: number; fin: number }>();
  private readonly flux = new Map<string, number>();
  private fluxTotal = 0;
  private enCours = 0;
  private readonly file: Array<() => void> = [];
  private readonly menage: NodeJS.Timeout;

  constructor(readonly opts: OptionsGarde = {}) {
    this.menage = setInterval(() => {
      const now = Date.now();
      for (const [k, f] of this.fenetres) if (f.fin < now) this.fenetres.delete(k);
    }, MINUTE);
    this.menage.unref();
  }

  /** The client's address: the socket's, or, behind the local proxy, the last hop it added. */
  adresse(req: IncomingMessage): string {
    const brute = req.socket.remoteAddress ?? 'unknown';
    const xff = req.headers['x-forwarded-for'];
    if (this.opts.proxy && BOUCLE.has(brute) && typeof xff === 'string' && xff.trim()) return xff.split(',').at(-1)!.trim();
    return brute;
  }

  /** A request from this machine itself, not relayed by the proxy: the operator or the coordinator's own scripts. */
  estLocal(req: IncomingMessage): boolean {
    return BOUCLE.has(req.socket.remoteAddress ?? '') && req.headers['x-forwarded-for'] === undefined;
  }

  /** Counts one request in a fixed window; past the budget, a 429 the client can read. */
  compter(adresse: string, seau: string, max: number, fenetreMs: number, message: string): void {
    const cle = `${seau}:${adresse}`;
    const now = Date.now();
    const f = this.fenetres.get(cle);
    if (!f || f.fin < now) {
      this.fenetres.set(cle, { n: 1, fin: now + fenetreMs });
      return;
    }
    if (++f.n > max) throw new OspError(message, 429);
  }

  /** Checks the budgets of one request: reads, writes, and the rarer actions. */
  admettre(req: IncomingMessage, route: string): void {
    if (this.estLocal(req)) return;
    const a = this.adresse(req);
    if (req.method === 'GET') {
      this.compter(a, 'r', this.opts.lecturesParMinute ?? 900, MINUTE, 'Too many requests from your address: wait a minute');
      return;
    }
    this.compter(a, 'w', this.opts.ecrituresParMinute ?? 90, MINUTE, 'Too many actions from your address: wait a minute');
    if (route === 'POST /v0/hives') this.compter(a, 'p', this.opts.propositionsParHeure ?? 6, 60 * MINUTE, 'Too many project proposals from your address: wait an hour');
    if (route === 'POST /v0/private') this.compter(a, 'v', this.opts.privesParJour ?? 5, 24 * 60 * MINUTE, 'Too many private hives created from your address today');
  }

  /** Opens a real-time stream, within the caps; the returned function closes it. */
  ouvrirFlux(req: IncomingMessage): () => void {
    const local = this.estLocal(req);
    const a = this.adresse(req);
    const n = this.flux.get(a) ?? 0;
    if (!local && n >= (this.opts.fluxParAdresse ?? 8)) throw new OspError('Too many live pages open from your address', 429);
    if (this.fluxTotal >= (this.opts.fluxMax ?? 5000)) throw new OspError('The live feed is full: the page refreshes by itself every few seconds', 503);
    this.flux.set(a, n + 1);
    this.fluxTotal++;
    let ferme = false;
    return () => {
      if (ferme) return;
      ferme = true;
      this.fluxTotal--;
      const m = (this.flux.get(a) ?? 1) - 1;
      if (m > 0) this.flux.set(a, m);
      else this.flux.delete(a);
    };
  }

  /** Runs heavy work within the concurrency cap; a full queue answers 503 at once. */
  async lourd<T>(fn: () => Promise<T>): Promise<T> {
    const max = this.opts.lourdesSimultanees ?? Math.max(1, availableParallelism());
    if (this.enCours >= max) {
      if (this.file.length >= (this.opts.fileMax ?? 300)) throw new OspError('The network is very busy: your bee will try again in a minute', 503);
      // The slot is handed over by the request that leaves: nobody can jump the queue.
      await new Promise<void>((ok) => this.file.push(ok));
    } else this.enCours++;
    try {
      return await fn();
    } finally {
      const suivante = this.file.shift();
      if (suivante) suivante();
      else this.enCours--;
    }
  }

  /** For the health check and the operator. */
  charge(): { lourdes: number; attente: number; flux: number } {
    return { lourdes: this.enCours, attente: this.file.length, flux: this.fluxTotal };
  }
}
