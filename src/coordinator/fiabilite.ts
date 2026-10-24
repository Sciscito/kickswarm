// Guard reliability (OSP v0.2, §4.1 and §5.3), in the Dawid-Skene model:
// - sensitivity s: the probability of rejecting a false result;
// - specificity c: the probability of validating a correct result.
// Each follows a Beta(a, b) distribution: a prior, plus the observations, with gradual forgetting.
// We decide on the lower bound (the 5% quantile): a lucky newcomer stays cautiously
// weighted until they have proven themselves.
//
// Wald's sequential test (§4.2) adds, for each "valid", log(c / (1 − s)) to the
// result's log-odds; we validate when P(false) drops below α*.

/** A guard's observations, beyond the prior (already damped by forgetting). */
export interface Fiabilite {
  s_ok: number;
  s_ko: number;
  c_ok: number;
  c_ko: number;
}

export interface ParamsFiabilite {
  /** Prior of the sensitivity: Beta(a, b). */
  prior_sensibilite: [number, number];
  /** Prior of the specificity: Beta(a, b). */
  prior_specificite: [number, number];
  /** Quantile used to decide (the lower bound). */
  quantile_fiabilite: number;
  /** Each new observation multiplies the old ones by this factor. */
  oubli_fiabilite: number;
}

export const VIERGE: Fiabilite = { s_ok: 0, s_ko: 0, c_ok: 0, c_ko: 0 };

/** Log of the Gamma function (Lanczos approximation, g = 7, precision ~1e-15). */
export function lnGamma(x: number): number {
  const g = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lnGamma(1 - x);
  x -= 1;
  let a = g[0]!;
  const t = x + 7.5;
  for (let i = 1; i < 9; i++) a += g[i]! / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

/** Continued fraction of the incomplete Beta function (modified Lentz). */
function betaFraction(x: number, a: number, b: number): number {
  const TINY = 1e-300;
  let c = 1;
  let d = 1 - ((a + b) * x) / (a + 1);
  if (Math.abs(d) < TINY) d = TINY;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 300; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((a + m2 - 1) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < TINY) d = TINY;
    c = 1 + aa / c;
    if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (a + b + m) * x) / ((a + m2) * (a + m2 + 1));
    d = 1 + aa * d;
    if (Math.abs(d) < TINY) d = TINY;
    c = 1 + aa / c;
    if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-15) break;
  }
  return h;
}

/** Regularized incomplete Beta function I_x(a, b): the cumulative distribution function of Beta(a, b). */
export function betaRepartition(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const front = Math.exp(lnGamma(a + b) - lnGamma(a) - lnGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? (front * betaFraction(x, a, b)) / a : 1 - (front * betaFraction(1 - x, b, a)) / b;
}

/** Quantile of Beta(a, b), by bisection (60 steps: precision far better than 1e-12). */
export function betaQuantile(p: number, a: number, b: number): number {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (betaRepartition(mid, a, b) < p) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Rounding that makes computations reproducible from one machine to another, beyond the last bit. */
const net = (x: number) => Math.round(x * 1e9) / 1e9;

/** Lower bounds of the sensitivity and the specificity. */
export function bornes(f: Fiabilite, p: ParamsFiabilite): { s: number; c: number } {
  const [sa, sb] = p.prior_sensibilite;
  const [ca, cb] = p.prior_specificite;
  return {
    s: net(betaQuantile(p.quantile_fiabilite, sa + f.s_ok, sb + f.s_ko)),
    c: net(betaQuantile(p.quantile_fiabilite, ca + f.c_ok, cb + f.c_ko)),
  };
}

/** Weight of a "valid" in the Wald test: log(c / (1 − s)), in nats, on the lower bounds. */
export function poidsValide(f: Fiabilite, p: ParamsFiabilite): number {
  const { s, c } = bornes(f, p);
  return net(Math.log(c / (1 - s)));
}

/** An observation: the guard was right (ok) or wrong against a false (s) or correct (c) result. */
export function observer(f: Fiabilite, quoi: 's' | 'c', ok: boolean, oubli: number): void {
  f.s_ok = net(f.s_ok * oubli);
  f.s_ko = net(f.s_ko * oubli);
  f.c_ok = net(f.c_ok * oubli);
  f.c_ko = net(f.c_ko * oubli);
  if (quoi === 's') ok ? f.s_ok++ : f.s_ko++;
  else ok ? f.c_ok++ : f.c_ko++;
}

export const logit = (p: number): number => Math.log(p / (1 - p));
