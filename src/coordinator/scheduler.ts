// Scheduling (§12): Thompson sampling per branch, weighted by the orientation,
// with an anti-starvation floor, then the deepest free cell of the branch.

export type Rng = () => number;

/** Deterministic generator (mulberry32), for tests and the demo. */
export function seededRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rng: Rng): number {
  const u = Math.max(rng(), 1e-12);
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Gamma(k, 1) distribution by the Marsaglia-Tsang method. */
function sampleGamma(k: number, rng: Rng): number {
  if (k < 1) return sampleGamma(k + 1, rng) * Math.pow(Math.max(rng(), 1e-12), 1 / k);
  const d = k - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x: number;
    let v: number;
    do {
      x = gaussian(rng);
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = rng();
    if (u < 1 - 0.0331 * x ** 4 || Math.log(Math.max(u, 1e-12)) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

export function sampleBeta(alpha: number, beta: number, rng: Rng): number {
  const x = sampleGamma(alpha, rng);
  const y = sampleGamma(beta, rng);
  return x / (x + y);
}

/** Branch of a cell: first segment of its path (`0` for the heart). */
export function brancheOf(chemin: string): string {
  return chemin.split('.')[0] ?? chemin;
}

export interface Candidate {
  chemin: string;
  profondeur: number;
}

export interface ScheduleContext {
  stats: (branche: string) => { succes: number; echecs: number };
  multiplicateur: (branche: string) => number;
  plancher: number;
  rng: Rng;
}

export function chooseCandidate<T extends Candidate>(candidates: T[], ctx: ScheduleContext): T | null {
  if (candidates.length === 0) return null;
  const byBranch = new Map<string, T[]>();
  for (const c of candidates) {
    const b = brancheOf(c.chemin);
    const list = byBranch.get(b);
    if (list) list.push(c);
    else byBranch.set(b, [c]);
  }
  const branches = [...byBranch.keys()].sort();

  let chosen: string;
  if (ctx.rng() < ctx.plancher) {
    chosen = branches[Math.floor(ctx.rng() * branches.length)]!;
  } else {
    let best = -1;
    chosen = branches[0]!;
    for (const b of branches) {
      const s = ctx.stats(b);
      const score = sampleBeta(1 + s.succes, 1 + s.echecs, ctx.rng) * ctx.multiplicateur(b);
      if (score > best) {
        best = score;
        chosen = b;
      }
    }
  }

  const pool = byBranch.get(chosen)!;
  const deepest = Math.max(...pool.map((c) => c.profondeur));
  const deep = pool.filter((c) => c.profondeur === deepest);
  return deep[Math.floor(ctx.rng() * deep.length)]!;
}
