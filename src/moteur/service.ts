import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// The engine in the background (OSP v0.4 §2.6): `kickswarm engine start` runs `kickswarm bee` as a
// detached process, with its log next to the identity, and stops it on `kickswarm engine stop`.
// Starting at login is opt-in, and only writes the usual per-user file of each system (the Startup
// folder on Windows, a LaunchAgent on macOS, an autostart entry on Linux), which `--no-autostart`
// removes. Nothing is installed system-wide.

const PID = 'moteur.pid';
const JOURNAL = 'moteur.log';

/** The compiled CLI to run: this package's dist/cli.js. */
export function cheminCli(): string {
  const ici = fileURLToPath(import.meta.url);
  const cli = ici.endsWith('.ts') ? resolve(dirname(ici), '..', '..', 'dist', 'cli.js') : resolve(dirname(ici), '..', 'cli.js');
  if (!existsSync(cli)) throw new Error(`Compiled CLI not found at ${cli}. Run “npm run build” first.`);
  return cli;
}

function vivant(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export function etat(home: string): { actif: boolean; pid?: number; journal: string } {
  const f = join(home, PID);
  const journal = join(home, JOURNAL);
  if (!existsSync(f)) return { actif: false, journal };
  const pid = Number(readFileSync(f, 'utf8').trim());
  if (Number.isInteger(pid) && pid > 0 && vivant(pid)) return { actif: true, pid, journal };
  rmSync(f, { force: true });
  return { actif: false, journal };
}

export function demarrer(home: string, url: string, o: { cli?: string; args?: string[] } = {}): { pid: number; journal: string; deja: boolean } {
  const e = etat(home);
  if (e.actif) return { pid: e.pid!, journal: e.journal, deja: true };
  mkdirSync(home, { recursive: true });
  const sortie = openSync(e.journal, 'a');
  const enfant = spawn(process.execPath, [o.cli ?? cheminCli(), ...(o.args ?? ['bee', '--url', url])], {
    detached: true,
    stdio: ['ignore', sortie, sortie],
    windowsHide: true,
    env: { ...process.env, KICKSWARM_HOME: home, KICKSWARM_URL: url },
  });
  enfant.unref();
  writeFileSync(join(home, PID), String(enfant.pid));
  return { pid: enfant.pid!, journal: e.journal, deja: false };
}

export function arreter(home: string): boolean {
  const e = etat(home);
  if (!e.actif) return false;
  try {
    process.kill(e.pid!);
  } catch {
    // already gone
  }
  rmSync(join(home, PID), { force: true });
  return true;
}

/** Where each system looks for a user's programs to start at login (KICKSWARM_STARTUP_DIR overrides it, for tests). */
export function dossierDemarrage(env: Record<string, string | undefined> = process.env): string | null {
  if (env.KICKSWARM_STARTUP_DIR) return env.KICKSWARM_STARTUP_DIR;
  if (process.platform === 'win32') return env.APPDATA ? join(env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup') : null;
  if (process.platform === 'darwin') return join(homedir(), 'Library', 'LaunchAgents');
  return join(env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'autostart');
}

function fichierDemarrage(dossier: string, plateforme: NodeJS.Platform): string {
  return join(dossier, plateforme === 'win32' ? 'kickswarm-engine.cmd' : plateforme === 'darwin' ? 'org.kickswarm.engine.plist' : 'kickswarm-engine.desktop');
}

/** Writes the per-user start-at-login entry. Returns its path. */
export function installerDemarrageAuto(home: string, url: string, o: { env?: Record<string, string | undefined>; plateforme?: NodeJS.Platform; cli?: string } = {}): string {
  const dossier = dossierDemarrage(o.env);
  if (!dossier) throw new Error('No start-at-login folder found on this system');
  const plateforme = o.plateforme ?? process.platform;
  const cli = o.cli ?? cheminCli();
  mkdirSync(dossier, { recursive: true });
  const f = fichierDemarrage(dossier, plateforme);
  const echapXml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const contenu =
    plateforme === 'win32'
      ? `@echo off\r\nrem Kickswarm: starts your engine at login. Remove with: kickswarm engine autostart off\r\nset "KICKSWARM_HOME=${home}"\r\n"${process.execPath}" "${cli}" engine start --url "${url}"\r\n`
      : plateforme === 'darwin'
        ? `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>\n<key>Label</key><string>org.kickswarm.engine</string>\n<key>ProgramArguments</key><array><string>${echapXml(process.execPath)}</string><string>${echapXml(cli)}</string><string>engine</string><string>start</string><string>--url</string><string>${echapXml(url)}</string></array>\n<key>EnvironmentVariables</key><dict><key>KICKSWARM_HOME</key><string>${echapXml(home)}</string></dict>\n<key>RunAtLoad</key><true/>\n</dict></plist>\n`
        : `[Desktop Entry]\nType=Application\nName=Kickswarm engine\nComment=Your Kickswarm engine. Remove with: kickswarm engine autostart off\nExec=env KICKSWARM_HOME="${home}" "${process.execPath}" "${cli}" engine start --url "${url}"\nX-GNOME-Autostart-enabled=true\n`;
  writeFileSync(f, contenu, 'utf8');
  return f;
}

export function retirerDemarrageAuto(o: { env?: Record<string, string | undefined>; plateforme?: NodeJS.Platform } = {}): boolean {
  const dossier = dossierDemarrage(o.env);
  if (!dossier) return false;
  const f = fichierDemarrage(dossier, o.plateforme ?? process.platform);
  if (!existsSync(f)) return false;
  rmSync(f, { force: true });
  return true;
}
