import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Caste } from '../protocol/types.js';

// How a contributor takes part: which roles their AI accepts, how many tasks a day, when it rests.
// The settings live on the contributor's machine, next to their identity, and the plugin reads
// them before every task, so a change (from the CLI or the join page's command) applies at once.

export type Role = 'scout' | 'worker' | 'builder' | 'guard';
export const ROLES: Role[] = ['scout', 'worker', 'builder', 'guard'];
export const ROLE_OF: Record<Caste, Role> = { eclaireuse: 'scout', ouvriere: 'worker', batisseuse: 'builder', gardienne: 'guard' };

export interface Participation {
  /** Roles the AI accepts. A guard's check runs in the local sandbox and costs almost no AI usage. */
  roles: Role[];
  /** At most this many tasks a day (0: no limit). */
  parJour: number;
  /** Local hours when the bee rests, e.g. [23, 7] for 23:00 to 07:00 (null: never). */
  heuresCalmes: [number, number] | null;
  pause: boolean;
  /** Hives joined, most recent last: the default hive when the agent does not pick one. */
  ruches: string[];
}

/** The default request: every role, a reasonable daily share, no quiet hours. */
export const DEFAULT_PARTICIPATION: Participation = { roles: [...ROLES], parJour: 20, heuresCalmes: null, pause: false, ruches: [] };

export const PRESETS: Record<string, { label: string; description: string; reglages: Partial<Participation> }> = {
  full: { label: 'Full bee', description: 'Every role, up to 20 tasks a day. The default.', reglages: { roles: [...ROLES], parJour: 20, heuresCalmes: null } },
  light: {
    label: 'Light guard',
    description: 'Only verify other bees’ work. Your machine replays the tests: it costs almost nothing on your AI subscription.',
    reglages: { roles: ['guard'], parJour: 50, heuresCalmes: null },
  },
  night: { label: 'Night shift', description: 'Every role, but only from 22:00 to 08:00, while you sleep.', reglages: { roles: [...ROLES], parJour: 30, heuresCalmes: [8, 22] } },
};

const FICHIER = 'participation.json';
const COMPTEUR = 'participation-jour.json';

export function chargerParticipation(home: string): Participation {
  const f = join(home, FICHIER);
  if (!existsSync(f)) return structuredClone(DEFAULT_PARTICIPATION);
  try {
    return valider({ ...DEFAULT_PARTICIPATION, ...(JSON.parse(readFileSync(f, 'utf8')) as Partial<Participation>) });
  } catch {
    return structuredClone(DEFAULT_PARTICIPATION);
  }
}

export function enregistrerParticipation(home: string, p: Participation): string {
  mkdirSync(home, { recursive: true });
  const f = join(home, FICHIER);
  writeFileSync(f, JSON.stringify(valider(p), null, 2) + '\n', 'utf8');
  return f;
}

function valider(p: Participation): Participation {
  const roles = [...new Set((p.roles ?? []).filter((r): r is Role => ROLES.includes(r as Role)))];
  if (!roles.length) throw new Error('Pick at least one role: scout, worker, builder or guard');
  const parJour = Number(p.parJour);
  if (!Number.isInteger(parJour) || parJour < 0 || parJour > 10_000) throw new Error('Tasks per day must be a whole number from 0 (no limit) to 10000');
  const h = p.heuresCalmes;
  if (h !== null && !(Array.isArray(h) && h.length === 2 && h.every((x) => Number.isInteger(x) && x >= 0 && x <= 23) && h[0] !== h[1])) {
    throw new Error('Quiet hours look like 23-7 (from 23:00 to 07:00), or off');
  }
  return { roles, parJour, heuresCalmes: h, pause: !!p.pause, ruches: [...new Set((p.ruches ?? []).filter((s) => typeof s === 'string'))] };
}

export interface OptionsParticipation {
  preset?: string;
  roles?: string;
  perDay?: string;
  quiet?: string;
  pause?: boolean;
  resume?: boolean;
  ruche?: string;
}

/** Applies command-line options (a preset first, then each explicit option) and validates the result. */
export function appliquerOptions(p: Participation, o: OptionsParticipation): Participation {
  let r: Participation = structuredClone(p);
  if (o.preset !== undefined) {
    const preset = PRESETS[o.preset];
    if (!preset) throw new Error(`Unknown preset “${o.preset}”: pick ${Object.keys(PRESETS).join(', ')}`);
    r = { ...r, ...structuredClone(preset.reglages) };
  }
  if (o.roles !== undefined) r.roles = o.roles.split(',').map((s) => s.trim()).filter(Boolean) as Role[];
  if (o.perDay !== undefined) r.parJour = Number(o.perDay);
  if (o.quiet !== undefined) {
    if (o.quiet === 'off' || o.quiet === '') r.heuresCalmes = null;
    else {
      const m = /^(\d{1,2})-(\d{1,2})$/.exec(o.quiet);
      if (!m) throw new Error('Quiet hours look like 23-7 (from 23:00 to 07:00), or off');
      r.heuresCalmes = [Number(m[1]), Number(m[2])];
    }
  }
  if (o.pause) r.pause = true;
  if (o.resume) r.pause = false;
  if (o.ruche) r.ruches = [...r.ruches.filter((s) => s !== o.ruche), o.ruche];
  return valider(r);
}

/** Is this local time inside the quiet hours? [23, 7] covers 23:00 to 06:59; [8, 22] covers 08:00 to 21:59. */
export function enHeuresCalmes(p: Participation, quand: Date = new Date()): boolean {
  if (!p.heuresCalmes) return false;
  const [de, a] = p.heuresCalmes;
  const h = quand.getHours();
  return de < a ? h >= de && h < a : h >= de || h < a;
}

/** A one-line summary, for the CLI and the plugin. */
export function decrire(p: Participation): string {
  const parts = [
    `roles: ${p.roles.join(', ')}`,
    p.parJour ? `up to ${p.parJour} tasks a day` : 'no daily limit',
    p.heuresCalmes ? `resting from ${String(p.heuresCalmes[0]).padStart(2, '0')}:00 to ${String(p.heuresCalmes[1]).padStart(2, '0')}:00` : 'no quiet hours',
  ];
  if (p.pause) parts.unshift('PAUSED');
  return parts.join(' · ');
}

/** Tasks taken today, counted on this machine (the day is the local date). */
export class CompteurJour {
  private readonly fichier: string;
  constructor(home: string) {
    this.fichier = join(home, COMPTEUR);
  }
  private jour(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  aujourdhui(): number {
    try {
      const c = JSON.parse(readFileSync(this.fichier, 'utf8')) as { jour: string; n: number };
      return c.jour === this.jour() ? c.n : 0;
    } catch {
      return 0;
    }
  }
  plusUn(): void {
    const n = this.aujourdhui() + 1;
    try {
      writeFileSync(this.fichier, JSON.stringify({ jour: this.jour(), n }), 'utf8');
    } catch {
      /* a counter that cannot be written only loosens the daily limit */
    }
  }
}
