import { createHash } from 'node:crypto';
import { bls12_381 } from '@noble/curves/bls12-381.js';
import type { Rng } from './scheduler.js';

// The public randomness beacon (OSP v0.2, P1-3): drand, the League of Entropy network.
// Every 3 seconds, independent organizations jointly produce a threshold BLS signature
// on the round number; the randomness is the sha256 of that signature. Nobody, neither a
// contributor nor the coordinator, can predict or choose it, and everyone can verify it.
//
// Draw rule: a work request signed at time `ts` is drawn with round
// tourA(ts) + offset, which does not exist yet when the contributor signs. The seed is
// sha256(round randomness ‖ hash of the signed request), and the draws follow from it (SHA-256 in counter mode).

export interface BaliseInfo {
  /** Hash of the drand chain (identifies the network and its key). */
  chaine: string;
  /** Public key of the group, in hexadecimal (G2, 96 bytes). */
  cle_publique: string;
  /** Round 1 published at this time, in Unix seconds. */
  genese: number;
  /** Seconds between two rounds. */
  periode: number;
  schema: 'bls-unchained-g1-rfc9380';
}

export interface Balise {
  round: number;
  randomness: string;
  signature: string;
}

export interface SourceBalise {
  info: BaliseInfo;
  get(round: number): Promise<Balise>;
}

/** The League of Entropy's public drand "quicknet" network. */
export const QUICKNET: BaliseInfo = {
  chaine: '52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971',
  cle_publique:
    '83cf0f2896adee7eb8b5f01fcad3912212c437e0073e911fb90022d3e760183c8c4b450b6a0a6c3ac6a5776a2d1064510d1fec758c921cc22b0e17e63aaf4bcb5ed66304de9cf809bd274ca73bab4af5a6e9c76a4bc09e76eae8991ef5ece45a',
  genese: 1692803367,
  periode: 3,
  schema: 'bls-unchained-g1-rfc9380',
};

const DST = 'BLS_SIG_BLS12381G1_XMD:SHA-256_SSWU_RO_NUL_';
const sha256 = (x: string | Buffer) => createHash('sha256').update(x).digest();
const HEX = /^[0-9a-f]+$/;

/** The last round published at time `ms`. */
export function tourA(info: BaliseInfo, ms: number): number {
  return Math.floor((ms / 1000 - info.genese) / info.periode) + 1;
}

/** The publication time of a round, in milliseconds. */
export function publication(info: BaliseInfo, round: number): number {
  return Math.round((info.genese + (round - 1) * info.periode) * 1000);
}

function messageDuTour(round: number) {
  const rb = Buffer.alloc(8);
  rb.writeBigUInt64BE(BigInt(round));
  return bls12_381.shortSignatures.hash(sha256(rb), DST);
}

/** Verifies a beacon's BLS signature and the derivation of its randomness. */
export function verifierBalise(info: BaliseInfo, b: Balise): boolean {
  try {
    if (!Number.isInteger(b.round) || b.round < 1) return false;
    if (typeof b.signature !== 'string' || b.signature.length !== 96 || !HEX.test(b.signature)) return false;
    if (b.randomness !== sha256(Buffer.from(b.signature, 'hex')).toString('hex')) return false;
    return bls12_381.shortSignatures.verify(Buffer.from(b.signature, 'hex'), messageDuTour(b.round), Buffer.from(info.cle_publique, 'hex'));
  } catch {
    return false;
  }
}

/** The seed of a draw: the round's public randomness, bound to the signed request that triggers it. */
export function graine(b: Balise, demande: string): string {
  return sha256(`${b.randomness}:${demande}`).toString('hex');
}

/** Deterministic draws from a seed: SHA-256 in counter mode, 53 bits per draw. */
export function rngDepuis(g: string): Rng {
  let n = 0;
  return () => {
    const h = sha256(`${g}:${n++}`);
    return (h.readUIntBE(0, 6) * 32 + (h[6]! >>> 3)) / 2 ** 53;
  };
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** The real drand network, over HTTP, with several relays and systematic verification. */
export class DrandHttp implements SourceBalise {
  private readonly cache = new Map<number, Balise>();

  constructor(
    readonly info: BaliseInfo = QUICKNET,
    private readonly relais: string[] = ['https://api.drand.sh', 'https://drand.cloudflare.com', 'https://api2.drand.sh', 'https://api3.drand.sh'],
  ) {}

  async get(round: number): Promise<Balise> {
    const hit = this.cache.get(round);
    if (hit) return hit;
    const attente = publication(this.info, round) - Date.now();
    if (attente > 0) await sleep(attente + 150);
    let derniere = 'no relay reachable';
    for (let essai = 0; essai < 4; essai++) {
      for (const base of this.relais) {
        try {
          const r = await fetch(`${base}/${this.info.chaine}/public/${round}`, { signal: AbortSignal.timeout(4000) });
          if (!r.ok) { derniere = `${base}: HTTP ${r.status}`; continue; }
          const b = (await r.json()) as Balise;
          if (b.round !== round || !verifierBalise(this.info, b)) { derniere = `${base}: invalid beacon`; continue; }
          this.cache.set(round, b);
          if (this.cache.size > 2000) this.cache.delete(this.cache.keys().next().value!);
          return b;
        } catch (e) {
          derniere = `${base}: ${(e as Error).message}`;
        }
      }
      await sleep(1000);
    }
    throw new Error(`drand beacon for round ${round} not found (${derniere})`);
  }
}

/**
 * A local beacon, with its own BLS key: same scheme as drand, for tests and offline
 * work. The audit flags it: it does not come from the public network.
 */
export class BaliseLocale implements SourceBalise {
  readonly info: BaliseInfo;
  private readonly secret: Uint8Array;

  constructor(periodeMs = 100) {
    const { secretKey, publicKey } = bls12_381.shortSignatures.keygen();
    this.secret = secretKey;
    const cle = Buffer.from(publicKey.toBytes()).toString('hex');
    this.info = {
      chaine: `locale-${sha256(cle).toString('hex').slice(0, 16)}`,
      cle_publique: cle,
      genese: Math.floor(Date.now() / 1000) - 60,
      periode: periodeMs / 1000,
      schema: 'bls-unchained-g1-rfc9380',
    };
  }

  async get(round: number): Promise<Balise> {
    const attente = publication(this.info, round) - Date.now();
    if (attente > 0) await sleep(attente);
    const sig = Buffer.from(bls12_381.shortSignatures.sign(messageDuTour(round), this.secret).toBytes());
    return { round, randomness: sha256(sig).toString('hex'), signature: sig.toString('hex') };
  }
}
