// La fiabilité des gardiennes (OSP v0.2, §4.1 et §5.3), dans le modèle de Dawid et Skene :
// - sensibilité s : la probabilité de rejeter un résultat faux ;
// - spécificité c : la probabilité de valider un résultat juste.
// Chacune suit une loi Beta(a, b) : un a priori, plus les observations, avec un oubli progressif.
// On décide sur la borne basse (le quantile à 5 %) : une nouvelle venue chanceuse reste prudemment
// pesée tant qu'elle n'a pas fait ses preuves.
//
// Le test séquentiel de Wald (§4.2) additionne, pour chaque « valide », log(c / (1 − s)) à la
// log-cote du résultat ; on valide quand P(faux) passe sous α*.

/** Observations d'une gardienne, au-delà de l'a priori (déjà amorties par l'oubli). */
export interface Fiabilite {
  s_ok: number;
  s_ko: number;
  c_ok: number;
  c_ko: number;
}

export interface ParamsFiabilite {
  /** A priori de la sensibilité : Beta(a, b). */
  prior_sensibilite: [number, number];
  /** A priori de la spécificité : Beta(a, b). */
  prior_specificite: [number, number];
  /** Quantile utilisé pour décider (la borne basse). */
  quantile_fiabilite: number;
  /** Chaque nouvelle observation multiplie les anciennes par ce facteur. */
  oubli_fiabilite: number;
}

export const VIERGE: Fiabilite = { s_ok: 0, s_ko: 0, c_ok: 0, c_ko: 0 };

/** Log de la fonction Gamma (approximation de Lanczos, g = 7, précision ~1e-15). */
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

/** Fraction continue de la fonction Beta incomplète (Lentz modifié). */
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

/** Fonction Beta incomplète régularisée I_x(a, b) : la fonction de répartition de Beta(a, b). */
export function betaRepartition(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const front = Math.exp(lnGamma(a + b) - lnGamma(a) - lnGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? (front * betaFraction(x, a, b)) / a : 1 - (front * betaFraction(1 - x, b, a)) / b;
}

/** Quantile de Beta(a, b), par dichotomie (60 pas : précision bien meilleure que 1e-12). */
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

/** Arrondi qui rend les calculs reproductibles d'une machine à l'autre, au-delà du dernier bit. */
const net = (x: number) => Math.round(x * 1e9) / 1e9;

/** Bornes basses de la sensibilité et de la spécificité. */
export function bornes(f: Fiabilite, p: ParamsFiabilite): { s: number; c: number } {
  const [sa, sb] = p.prior_sensibilite;
  const [ca, cb] = p.prior_specificite;
  return {
    s: net(betaQuantile(p.quantile_fiabilite, sa + f.s_ok, sb + f.s_ko)),
    c: net(betaQuantile(p.quantile_fiabilite, ca + f.c_ok, cb + f.c_ko)),
  };
}

/** Poids d'un « valide » dans le test de Wald : log(c / (1 − s)), en nats, sur les bornes basses. */
export function poidsValide(f: Fiabilite, p: ParamsFiabilite): number {
  const { s, c } = bornes(f, p);
  return net(Math.log(c / (1 - s)));
}

/** Une observation : la gardienne a eu raison (ok) ou tort face à un résultat faux (s) ou juste (c). */
export function observer(f: Fiabilite, quoi: 's' | 'c', ok: boolean, oubli: number): void {
  f.s_ok = net(f.s_ok * oubli);
  f.s_ko = net(f.s_ko * oubli);
  f.c_ok = net(f.c_ok * oubli);
  f.c_ko = net(f.c_ko * oubli);
  if (quoi === 's') ok ? f.s_ok++ : f.s_ko++;
  else ok ? f.c_ok++ : f.c_ko++;
}

export const logit = (p: number): number => Math.log(p / (1 - p));
