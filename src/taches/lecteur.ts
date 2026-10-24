import { couvre } from '../protocol/depot.js';
import type { Livrable } from '../protocol/types.js';

// Reading what chats really answer (OSP v0.4 §3.4): code blocks with the path on the fence line, or in
// a heading or a "File:" line right before; a single unnamed block for a single-file deliverable;
// "DELETE: path" lines. Anything unclear is refused here, with a message the human can act on, before
// anything is signed or sent. Isomorphic: the chat door runs it in the browser.

export class ErreurLecture extends Error {}

export interface Attendu {
  /** The main file of the deliverable. */
  module: string;
  /** A repo cell's write scope: every path must be inside it. */
  portee?: string[];
}

const CHEMIN = /(?:^|[\s`*"'(:=[{])((?:[A-Za-z0-9_-][A-Za-z0-9_.-]*\/)*[A-Za-z0-9_-][A-Za-z0-9_.-]*\.(?:luau|lua|mjs|js|json|ts|tsx|md|txt|css|html|yml|yaml|toml|csv|svg))(?=$|[\s`*"'):,\]}])/g;
const LANGAGES_TEXTE = new Set(['bash', 'sh', 'shell', 'console', 'text', 'txt', 'output', 'plaintext', 'diff']);
const SUPPRIMER = /^\s*(?:DELETE|Delete|delete|SUPPRIMER|Supprimer)\s*:\s*`?([^\s`]+)`?\s*$/;

interface Bloc {
  chemin?: string;
  langage?: string;
  contenu: string;
}

function dernierChemin(ligne: string): string | undefined {
  let trouve: string | undefined;
  for (const m of ligne.matchAll(CHEMIN)) trouve = m[1];
  return trouve?.replace(/^\.\//, '');
}

function blocs(texte: string): { blocs: Bloc[]; supprimes: string[] } {
  const lignes = texte.replace(/\r\n?/g, '\n').split('\n');
  const out: Bloc[] = [];
  const supprimes: string[] = [];
  let i = 0;
  while (i < lignes.length) {
    const ouverture = /^\s*(`{3,}|~{3,})\s*(.*)$/.exec(lignes[i]!);
    if (!ouverture) {
      const s = SUPPRIMER.exec(lignes[i]!);
      if (s) supprimes.push(s[1]!.replace(/^\.\//, ''));
      i++;
      continue;
    }
    const fence = ouverture[1]!;
    const info = ouverture[2]!.trim();
    let j = i + 1;
    const corps: string[] = [];
    while (j < lignes.length && !new RegExp(`^\\s*${fence[0] === '`' ? '`' : '~'}{${fence.length},}\\s*$`).test(lignes[j]!)) corps.push(lignes[j++]!);
    // The path: on the fence line ("```luau src/x.luau", "```js title=\"x.mjs\"", "```lua:src/x.lua"), or just above.
    const surFence = dernierChemin(info.replace(/^([A-Za-z0-9+#-]+):/, '$1 '));
    let chemin = surFence;
    if (!chemin) {
      for (let k = i - 1, vus = 0; k >= 0 && vus < 2; k--) {
        const l = lignes[k]!.trim();
        if (!l) continue;
        vus++;
        if (/^\s*(`{3,}|~{3,})/.test(l)) break;
        if (l.length <= 160) chemin = dernierChemin(l);
        if (chemin) break;
      }
    }
    const langage = /^[A-Za-z0-9+#-]+/.exec(info)?.[0]?.toLowerCase();
    out.push({ ...(chemin ? { chemin } : {}), ...(langage && langage !== chemin ? { langage } : {}), contenu: corps.join('\n') + '\n' });
    i = j + 1;
  }
  return { blocs: out, supprimes };
}

/** Reads the files of a deliverable from a chat's answer. Throws ErreurLecture with a clear message. */
export function lireReponse(texte: string, attendu: Attendu): Pick<Livrable, 'fichiers' | 'supprimes'> {
  const { blocs: tous, supprimes } = blocs(texte);
  if (!tous.length) throw new ErreurLecture('No code block found. Ask the AI to answer with the code inside ``` blocks, the file path right after the backticks.');
  const nommes = tous.filter((b) => b.chemin);
  let anonymes = tous.filter((b) => !b.chemin && !LANGAGES_TEXTE.has(b.langage ?? ''));
  const fichiers: Record<string, string> = {};
  for (const b of nommes) fichiers[b.chemin!] = b.contenu;
  if (!(attendu.module in fichiers) && anonymes.length) {
    if (anonymes.length > 1) {
      // Several unnamed blocks: keep the one in the module's language, if there is exactly one.
      const ext = /\.(luau|lua)$/.test(attendu.module) ? ['lua', 'luau'] : /\.json$/.test(attendu.module) ? ['json'] : ['js', 'javascript', 'mjs', 'ts', 'typescript'];
      const memes = anonymes.filter((b) => ext.includes(b.langage ?? ''));
      if (memes.length !== 1) throw new ErreurLecture(`Several code blocks without a file path. Ask the AI to write the path right after the backticks, for example: \`\`\`${ext[0]} ${attendu.module}`);
      anonymes = memes;
    }
    fichiers[attendu.module] = anonymes[0]!.contenu;
  }
  if (!Object.keys(fichiers).length) throw new ErreurLecture(`The answer has no code for ${attendu.module}.`);
  if (!(attendu.module in fichiers) && !supprimes.length) throw new ErreurLecture(`The answer does not contain ${attendu.module}. Found: ${Object.keys(fichiers).join(', ')}.`);
  if (attendu.portee) {
    const hors = [...Object.keys(fichiers), ...supprimes].filter((p) => !couvre(attendu.portee!, p));
    if (hors.length) throw new ErreurLecture(`Outside what this task may write (${attendu.portee.join(', ')}): ${hors.join(', ')}`);
  } else if (supprimes.length) throw new ErreurLecture('This task cannot delete files.');
  return { fichiers, ...(supprimes.length ? { supprimes } : {}) };
}

/** Reads a JSON answer (a split, an API's structured answer), tolerating a fence and trailing commas. */
export function lireJson(texte: string): unknown {
  const t = texte.replace(/\r\n?/g, '\n');
  const bloc = /```(?:json)?\s*\n([\s\S]*?)\n```/.exec(t)?.[1];
  const brut = bloc ?? t.slice(Math.min(...['{', '['].map((c) => (t.indexOf(c) < 0 ? Infinity : t.indexOf(c)))));
  for (const essai of [brut, brut.replace(/,(\s*[}\]])/g, '$1')]) {
    try {
      return JSON.parse(essai.trim()) as unknown;
    } catch {
      // next try
    }
  }
  throw new ErreurLecture('The answer is not valid JSON.');
}
