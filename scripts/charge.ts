// Load test: the real public coordinator (`kickswarm coordinator --public`, drand beacon, guard, heavy
// queue), and waves of simulated bees, each with its own address as Caddy would relay it.
//
//   npm run build && node --import tsx scripts/charge.ts [--waves 100,300,1000,2000] [--seconds 120] [--hives 300]
//
// The bees do the whole job (split, work, assembly, guard verdicts with commit and reveal), but they
// do not re-run deliverables themselves: real guards do that on their own machines, and here it would
// eat the server's processor. A guard recognises a trap by comparing the files with the known solution.

import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { assemble } from '../src/exemples/scripted-bee.js';
import { makeDecision, makeDecomposition, makeEngagement, makeHive, makeRequete, makeResult, makeVerdict } from '../src/protocol/builders.js';
import { generateIdentity, type Identity } from '../src/protocol/identity.js';
import type { Assignment, CellSpec, CritereV0, Livrable, Verdict } from '../src/protocol/types.js';
import { loadOrCreateIdentity } from '../src/plugin/identite.js';

const arg = (k: string, d: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1]! : d;
};
const VAGUES = arg('waves', '100,300,1000,2000').split(',').map(Number);
const SECONDES = Number(arg('seconds', '120'));
const RUCHES = Number(arg('hives', '300'));
const PORT = Number(arg('port', '7800'));
const BASE = `http://127.0.0.1:${PORT}`;
const DIR = resolve(arg('dir', join(tmpdir(), `kickswarm-charge-${Date.now()}`)));
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- measures

interface Mesure { n: number; ms: number[]; statuts: Record<string, number> }
let mesures = new Map<string, Mesure>();
const noter = (route: string, ms: number, statut: number) => {
  const m = mesures.get(route) ?? { n: 0, ms: [], statuts: {} };
  m.n++;
  if (m.ms.length < 50_000) m.ms.push(ms);
  m.statuts[statut] = (m.statuts[statut] ?? 0) + 1;
  mesures.set(route, m);
};
const centile = (xs: number[], p: number) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]!;
};

async function appel(methode: 'GET' | 'POST', chemin: string, corps?: unknown, ip?: string, route = `${methode} ${chemin}`): Promise<any> {
  const t0 = performance.now();
  let statut = 0;
  try {
    const res = await fetch(BASE + chemin, {
      method: methode,
      headers: { ...(corps === undefined ? {} : { 'content-type': 'application/json' }), ...(ip ? { 'x-forwarded-for': ip } : {}) },
      body: corps === undefined ? undefined : JSON.stringify(corps),
      signal: AbortSignal.timeout(90_000),
    });
    statut = res.status;
    const data = (await res.json().catch(() => ({}))) as { erreur?: string };
    if (!res.ok) throw Object.assign(new Error(data.erreur ?? `HTTP ${res.status}`), { status: res.status });
    return data;
  } catch (e) {
    if (!statut) statut = (e as Error).name === 'TimeoutError' ? 599 : 598;
    throw Object.assign(e as Error, { status: (e as { status?: number }).status ?? statut });
  } finally {
    noter(route, performance.now() - t0, statut);
  }
}

// ---------------------------------------------------------------- synthetic hives

const SOLUTIONS = new Map<string, string>();
const DECOUPAGES = new Map<string, CellSpec[]>();
const test = (module: string, tests: CritereV0['tests']): CritereV0 => ({ classe: 'V0', verificateur: 'tests-js@1', module, tests });

function ruche(i: number): { slug: string; racine: CellSpec } {
  const enfants: CellSpec[] = [];
  for (let k = 0; k < 12; k++) {
    const mod = `h${i}f${k}.mjs`;
    SOLUTIONS.set(mod, `export function f${k}(x) {\n  return x * ${k + 2} + ${i};\n}\n`);
    enfants.push({ objectif: `Hive ${i}: write f${k}(x)`, capsule: `f${k}(x) = x * ${k + 2} + ${i}`, atomique: true, critere_fini: test(mod, [
      { fn: `f${k}`, args: [1], attendu: k + 2 + i },
      { fn: `f${k}`, args: [5], attendu: 5 * (k + 2) + i },
    ]) });
  }
  const objectif = `Load test hive ${i}: twelve small functions re-exported from h${i}.mjs`;
  DECOUPAGES.set(objectif, enfants);
  return {
    slug: `load-${i}`,
    racine: { objectif, capsule: 'Synthetic load test.', atomique: false, critere_fini: test(`h${i}.mjs`, [{ fn: 'f0', args: [1], attendu: 2 + i }, { fn: 'f11', args: [1], attendu: 13 + i }]) },
  };
}

// ---------------------------------------------------------------- the founder (on the server's machine: not counted by the guard)

let fondateur: Identity;
async function approuver(nature: 'approbation_ruche' | 'approbation_decoupage', cible: string): Promise<void> {
  await appel('POST', '/v0/decisions', makeDecision(fondateur, nature, cible, 'Load test'), undefined, `POST /v0/decisions (${nature})`);
}

// ---------------------------------------------------------------- a bee

const stats = { travaux: 0, verdicts: 0, attentes: 0, refus: 0, erreurs: 0 };
let enCours = true;

async function abeille(n: number): Promise<void> {
  const id = generateIdentity();
  const ip = `10.${(n >> 16) & 255}.${(n >> 8) & 255}.${n & 255}`;
  const scelles: Verdict[] = [];
  const post = (chemin: string, corps: unknown) => appel('POST', chemin, corps, ip);
  while (enCours) {
    try {
      // Sealed verdicts first, as the plugin does.
      for (const v of [...scelles]) {
        try {
          await post('/v0/work/verdict', v);
          scelles.splice(scelles.indexOf(v), 1);
          stats.verdicts++;
        } catch (e) {
          if ((e as { status?: number }).status !== 425) scelles.splice(scelles.indexOf(v), 1);
        }
      }
      const r = (await post('/v0/work/claim', makeRequete(id, 'claim'))) as { assignation: Assignment | null };
      const a = r.assignation;
      if (!a) {
        stats.attentes++;
        await sleep(5000);
        continue;
      }
      if (a.caste === 'gardienne') {
        const fichiers = a.a_verifier!.livrable.fichiers;
        const juste = Object.entries(fichiers).every(([f, c]) => !SOLUTIONS.has(f) || SOLUTIONS.get(f) === c);
        const v = makeVerdict(id, a.a_verifier!.id, juste ? 'valide' : 'rejete', juste ? 'matches' : 'differs');
        const e = (await post('/v0/work/commit', makeEngagement(id, v))) as { revelation: boolean };
        if (e.revelation) {
          await post('/v0/work/verdict', v);
          stats.verdicts++;
        } else scelles.push(v);
        continue;
      }
      await post('/v0/work/start', makeRequete(id, 'start', { alveole: a.alveole_id }));
      const crit = a.alveole.critere_fini as CritereV0;
      if (a.caste === 'eclaireuse') {
        const enfants = DECOUPAGES.get(a.alveole.objectif);
        if (!enfants) throw new Error('unknown objective');
        const d = (await post('/v0/work/decompose', { decomposition: makeDecomposition(id, a.alveole_id, enfants), secrets: [] })) as { statut: string; decoupage: string };
        if (d.statut === 'en_attente_porteur') await approuver('approbation_decoupage', d.decoupage);
      } else {
        const livrable: Livrable = a.caste === 'batisseuse' ? assemble(a.enfants_valides ?? [], crit.module!) : { fichiers: { [crit.module!]: SOLUTIONS.get(crit.module!)! } };
        await post('/v0/work/submit', { resultat: makeResult(id, a.alveole_id, a.caste, livrable, { agent: { famille: 'script' } }), livrable });
      }
      stats.travaux++;
    } catch (e) {
      const s = (e as { status?: number }).status ?? 0;
      if (s === 429 || s === 503) {
        stats.refus++;
        await sleep(15_000);
      } else {
        stats.erreurs++;
        await sleep(3000);
      }
    }
  }
}

// ---------------------------------------------------------------- the server, and watching it

function demarrer(home: string, data: string): Promise<ChildProcess> {
  return new Promise((ok, ko) => {
    const p = spawn(process.execPath, ['dist/cli.js', 'coordinator', '--public', '--port', String(PORT), '--data', data, '--launch', 'none'], {
      env: { ...process.env, KICKSWARM_HOME: home },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let sortie = '';
    p.stdout!.on('data', (d: Buffer) => {
      sortie += d.toString();
      if (sortie.includes('coordinator on')) ok(p);
    });
    p.stderr!.on('data', (d: Buffer) => process.stderr.write(`[server] ${d}`));
    p.on('exit', (c) => ko(new Error(`server exited (${c}): ${sortie.slice(-500)}`)));
  });
}

/** The server process's CPU and memory, sampled by PowerShell every two seconds. */
function surveiller(pid: number): { lire: () => { cpu: number; rss: number }[]; arreter: () => void } {
  const echantillons: { t: number; cpu: number; rss: number }[] = [];
  // Invariant culture: a French Windows would print "12,5" and break the parsing.
  const boucle = `$c = [Globalization.CultureInfo]::InvariantCulture; while ($true) { $p = Get-Process -Id ${pid} -ErrorAction SilentlyContinue; if (-not $p) { break }; Write-Output ([string]::Format($c, '{0};{1}', $p.TotalProcessorTime.TotalSeconds, $p.WorkingSet64)); Start-Sleep -Seconds 2 }`;
  const ps = spawn('powershell', ['-NoProfile', '-Command', boucle], { stdio: ['ignore', 'pipe', 'ignore'] });
  ps.stdout.on('data', (d: Buffer) => {
    for (const l of d.toString().split(/\r?\n/)) {
      const [c, r] = l.split(';').map(Number);
      if (Number.isFinite(c) && Number.isFinite(r)) echantillons.push({ t: Date.now(), cpu: c!, rss: r! });
    }
  });
  return {
    // CPU as a percentage of one core, between consecutive samples.
    lire: () => echantillons.slice(1).map((e, i) => ({ cpu: ((e.cpu - echantillons[i]!.cpu) / ((e.t - echantillons[i]!.t) / 1000)) * 100, rss: e.rss })),
    arreter: () => ps.kill(),
  };
}

const taille = (f: string) => {
  try {
    return statSync(f).size;
  } catch {
    return 0;
  }
};
const mo = (o: number) => `${(o / 1e6).toFixed(1)} MB`;

async function main(): Promise<void> {
  const home = join(DIR, 'home');
  const data = join(DIR, 'data');
  mkdirSync(home, { recursive: true });
  process.env.KICKSWARM_HOME = home;
  fondateur = loadOrCreateIdentity(home).identite;
  console.log(`Load test in ${DIR}\nStarting the public coordinator (self-check, drand)…`);
  const serveur = await demarrer(home, data);
  const veille = surveiller(serveur.pid!);

  console.log(`Opening ${RUCHES} synthetic hives (13 cells each)…`);
  const t0 = performance.now();
  for (let i = 0; i < RUCHES; i += 8) {
    await Promise.all(
      Array.from({ length: Math.min(8, RUCHES - i) }, async (_, j) => {
        const { slug, racine } = ruche(i + j);
        await appel('POST', '/v0/hives', { ruche: makeHive(fondateur, { slug, nom: `Load ${i + j}`, objectif: racine.objectif }), racine });
        await approuver('approbation_ruche', slug);
      }),
    );
  }
  console.log(`Opened in ${((performance.now() - t0) / 1000).toFixed(1)} s.`);

  // A probe: how long a trivial read takes, i.e. how responsive the server stays.
  const sondes: number[] = [];
  const charges: { lourdes: number; attente: number }[] = [];
  const sonde = setInterval(async () => {
    const t = performance.now();
    try {
      const h = (await (await fetch(`${BASE}/healthz`)).json()) as { lourdes: number; attente: number };
      sondes.push(performance.now() - t);
      charges.push(h);
    } catch {
      sondes.push(99_999);
    }
  }, 1000);

  const rapport: unknown[] = [];
  let lancees = 0;
  const abeilles: Promise<void>[] = [];
  let mielAvant = 0;
  for (const cible of VAGUES) {
    mesures = new Map();
    sondes.length = 0;
    charges.length = 0;
    const avant = { ...stats };
    const cpuDebut = veille.lire().length;
    // New bees join over ten seconds, not all at once.
    const nouvelles = cible - lancees;
    for (let k = 0; k < nouvelles; k++) {
      abeilles.push(abeille(lancees++));
      if (k % Math.max(1, Math.floor(nouvelles / 100)) === 0) await sleep(100);
    }
    console.log(`\n▶ ${cible} bees for ${SECONDES} s…`);
    await sleep(SECONDES * 1000);

    const hives = (await (await fetch(`${BASE}/v0/hives`)).json()) as Array<{ progression: { miel: number } }>;
    const miel = hives.reduce((s, h) => s + h.progression.miel, 0);
    const cpu = veille.lire().slice(cpuDebut);
    const ligne = {
      abeilles: cible,
      alveoles_miel_par_min: Math.round(((miel - mielAvant) / SECONDES) * 60),
      travaux_par_s: +((stats.travaux - avant.travaux) / SECONDES).toFixed(1),
      verdicts_par_s: +((stats.verdicts - avant.verdicts) / SECONDES).toFixed(1),
      refus_429_503: stats.refus - avant.refus,
      erreurs: stats.erreurs - avant.erreurs,
      cpu_moyen_pct: Math.round(cpu.reduce((s, x) => s + x.cpu, 0) / Math.max(1, cpu.length)),
      cpu_max_pct: Math.round(Math.max(0, ...cpu.map((x) => x.cpu))),
      memoire: mo(Math.max(0, ...cpu.map((x) => x.rss))),
      sonde_p50_ms: Math.round(centile(sondes, 50)),
      sonde_p95_ms: Math.round(centile(sondes, 95)),
      file_lourde_max: Math.max(0, ...charges.map((c) => c.attente)),
      etat_json: mo(taille(join(data, 'etat.json'))),
      registre: mo(taille(join(data, 'registre.jsonl'))),
      routes: Object.fromEntries(
        [...mesures].map(([r, m]) => [r, { n: m.n, p50: Math.round(centile(m.ms, 50)), p95: Math.round(centile(m.ms, 95)), max: Math.round(Math.max(...m.ms)), statuts: m.statuts }]),
      ),
    };
    mielAvant = miel;
    rapport.push(ligne);
    const { routes, ...court } = ligne;
    console.log(JSON.stringify(court));
    for (const [r, m] of Object.entries(routes)) console.log(`   ${r.padEnd(46)} n=${String(m.n).padStart(6)}  p50=${String(m.p50).padStart(6)} ms  p95=${String(m.p95).padStart(6)} ms  max=${String(m.max).padStart(6)} ms  ${JSON.stringify(m.statuts)}`);
  }

  enCours = false;
  clearInterval(sonde);
  console.log('\nStopping the bees…');
  await Promise.race([Promise.all(abeilles), sleep(30_000)]);
  veille.arreter();
  serveur.kill();
  const { writeFileSync } = await import('node:fs');
  writeFileSync(join(DIR, 'rapport.json'), JSON.stringify(rapport, null, 2));
  console.log(`\nReport: ${join(DIR, 'rapport.json')}`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
