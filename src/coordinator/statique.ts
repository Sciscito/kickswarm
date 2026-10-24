import { existsSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import type { ServerResponse } from 'node:http';
import { dirname, extname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// The files the chat and guard doors need in a browser (OSP v0.4 §2.3), served by the coordinator
// itself, with no build step:
//  - /app/<path>.js: this package's own modules (the task card, the answer reader, the verifier core,
//    the signatures…), from the folder this code runs from (dist), or compiled on the fly from src
//    when the coordinator runs from its sources (tsx);
//  - /vendor/<package>/<path>: the few libraries they import (the @noble cryptography, QuickJS and
//    Luau in WebAssembly), from node_modules, by an allowlist. The page maps them with an import map.
// Only JavaScript and WebAssembly files, never a path that leaves its folder.

const ICI = dirname(fileURLToPath(import.meta.url));
/** The package's root of modules: dist/ in production, src/ under tsx. */
const RACINE = join(ICI, '..');
const SOURCES = extname(fileURLToPath(import.meta.url)) === '.ts';
const DOSSIERS_APP = new Set(['protocol', 'taches', 'verifier', 'web', 'playbooks', 'plugin']);
export const VENDOR = [
  '@noble/hashes',
  '@noble/curves',
  '@noble/post-quantum',
  '@noble/ciphers',
  'quickjs-emscripten-core',
  '@jitl/quickjs-ffi-types',
  '@jitl/quickjs-wasmfile-release-sync',
  '@luau-rs/luau',
  'valibot',
] as const;
const TYPES: Record<string, string> = { '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.wasm': 'application/wasm' };
const SEGMENT_SUR = /^[A-Za-z0-9_][A-Za-z0-9_.@-]*$/;

const racines = new Map<string, string | null>();
/** A package's folder: the nearest node_modules above this code that holds it (as Node resolves it). */
function racinePaquet(nom: string): string | null {
  if (!racines.has(nom)) {
    let r: string | null = null;
    for (let d = ICI; ; d = dirname(d)) {
      const candidat = join(d, 'node_modules', ...nom.split('/'));
      if (existsSync(join(candidat, 'package.json'))) {
        r = candidat;
        break;
      }
      if (dirname(d) === d) break;
    }
    racines.set(nom, r);
  }
  return racines.get(nom)!;
}

function cheminSur(parties: string[]): boolean {
  return parties.length > 0 && parties.every((p) => SEGMENT_SUR.test(p) && p !== '..' && !p.startsWith('.'));
}

const compiles = new Map<string, { mtime: number; code: string }>();

/** A module of this package, compiled from TypeScript on the fly when the coordinator runs from src. */
async function moduleApp(parties: string[]): Promise<string | null> {
  const rel = parties.join(sep);
  const js = join(RACINE, rel);
  if (!SOURCES) return existsSync(js) ? readFile(js, 'utf8') : null;
  const ts = js.replace(/\.js$/, '.ts');
  if (!existsSync(ts)) return null;
  const mtime = (await stat(ts)).mtimeMs;
  const deja = compiles.get(ts);
  if (deja?.mtime === mtime) return deja.code;
  const { transform } = (await import('esbuild')) as typeof import('esbuild');
  const { code } = await transform(await readFile(ts, 'utf8'), { loader: 'ts', format: 'esm', target: 'es2022', sourcefile: ts });
  compiles.set(ts, { mtime, code });
  return code;
}

/** Serves /app/… and /vendor/… Returns false when the path is not one of them. */
export async function servirStatique(pathname: string, res: ServerResponse): Promise<boolean> {
  const parties = pathname.split('/').filter(Boolean).map(decodeURIComponent);
  let corps: string | Buffer | null = null;
  let type: string | undefined;
  if (parties[0] === 'app') {
    const reste = parties.slice(1);
    if (!cheminSur(reste) || !DOSSIERS_APP.has(reste[0]!) || extname(reste.at(-1)!) !== '.js') return refuser(res);
    corps = await moduleApp(reste);
    type = TYPES['.js'];
  } else if (parties[0] === 'vendor') {
    const reste = parties.slice(1);
    const n = reste[0]?.startsWith('@') ? 2 : 1;
    const nom = reste.slice(0, n).join('/');
    const fichier = reste.slice(n);
    if (!(VENDOR as readonly string[]).includes(nom) || !cheminSur(fichier)) return refuser(res);
    type = TYPES[extname(fichier.at(-1)!)];
    const racine = racinePaquet(nom);
    if (!type || !racine) return refuser(res);
    const chemin = join(racine, ...fichier);
    if (!chemin.startsWith(racine + sep) || !existsSync(chemin)) return refuser(res);
    corps = await readFile(chemin);
  } else return false;
  if (corps === null) return refuser(res);
  res.writeHead(200, { 'content-type': type!, 'x-content-type-options': 'nosniff', 'cache-control': SOURCES ? 'no-cache' : 'public, max-age=3600' });
  res.end(corps);
  return true;
}

function refuser(res: ServerResponse): true {
  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
  res.end('Not found');
  return true;
}
