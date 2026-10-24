import { createHash } from 'node:crypto';
import { bls12_381 } from '@noble/curves/bls12-381.js';
import type { Rng } from './scheduler.js';

// La balise d'aléa public (OSP v0.2, P1-3) : drand, le réseau de la League of Entropy.
// Toutes les 3 secondes, des organisations indépendantes produisent ensemble une signature BLS
// à seuil sur le numéro du tour ; l'aléa est le sha256 de cette signature. Personne, ni un
// contributeur ni le coordinateur, ne peut la prévoir ni la choisir, et tout le monde peut la vérifier.
//
// Règle du tirage : une demande de travail signée à l'instant `ts` est tirée avec le tour
// tourA(ts) + décalage, qui n'existe pas encore quand le contributeur signe. La graine est
// sha256(aléa du tour ‖ hash de la demande signée), et les tirages en découlent (SHA-256 en mode compteur).

export interface BaliseInfo {
  /** Hash de la chaîne drand (identifie le réseau et sa clé). */
  chaine: string;
  /** Clé publique du groupe, en hexadécimal (G2, 96 octets). */
  cle_publique: string;
  /** Tour 1 publié à cet instant, en secondes Unix. */
  genese: number;
  /** Secondes entre deux tours. */
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

/** Le réseau public drand « quicknet » de la League of Entropy. */
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

/** Le dernier tour publié à l'instant `ms`. */
export function tourA(info: BaliseInfo, ms: number): number {
  return Math.floor((ms / 1000 - info.genese) / info.periode) + 1;
}

/** L'instant de publication d'un tour, en millisecondes. */
export function publication(info: BaliseInfo, round: number): number {
  return Math.round((info.genese + (round - 1) * info.periode) * 1000);
}

function messageDuTour(round: number) {
  const rb = Buffer.alloc(8);
  rb.writeBigUInt64BE(BigInt(round));
  return bls12_381.shortSignatures.hash(sha256(rb), DST);
}

/** Vérifie la signature BLS d'une balise et la dérivation de son aléa. */
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

/** La graine d'un tirage : l'aléa public du tour, lié à la demande signée qui le déclenche. */
export function graine(b: Balise, demande: string): string {
  return sha256(`${b.randomness}:${demande}`).toString('hex');
}

/** Tirages déterministes à partir d'une graine : SHA-256 en mode compteur, 53 bits par tirage. */
export function rngDepuis(g: string): Rng {
  let n = 0;
  return () => {
    const h = sha256(`${g}:${n++}`);
    return (h.readUIntBE(0, 6) * 32 + (h[6]! >>> 3)) / 2 ** 53;
  };
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Le vrai réseau drand, par HTTP, avec plusieurs relais et une vérification systématique. */
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
    let derniere = 'aucun relais joignable';
    for (let essai = 0; essai < 4; essai++) {
      for (const base of this.relais) {
        try {
          const r = await fetch(`${base}/${this.info.chaine}/public/${round}`, { signal: AbortSignal.timeout(4000) });
          if (!r.ok) { derniere = `${base} : HTTP ${r.status}`; continue; }
          const b = (await r.json()) as Balise;
          if (b.round !== round || !verifierBalise(this.info, b)) { derniere = `${base} : balise invalide`; continue; }
          this.cache.set(round, b);
          if (this.cache.size > 2000) this.cache.delete(this.cache.keys().next().value!);
          return b;
        } catch (e) {
          derniere = `${base} : ${(e as Error).message}`;
        }
      }
      await sleep(1000);
    }
    throw new Error(`Balise drand du tour ${round} introuvable (${derniere})`);
  }
}

/**
 * Une balise locale, avec sa propre clé BLS : même schéma que drand, pour les tests et le travail
 * hors ligne. L'audit la signale : elle ne vient pas du réseau public.
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
