import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { spawn } from 'node:child_process';

// Connecting OpenRouter in one click (OSP v0.4 §2.6): OpenRouter's official OAuth flow with PKCE.
// The engine opens the contributor's browser on OpenRouter's consent page; when they approve,
// OpenRouter calls back a one-time local address with a code, which the engine exchanges for a key.
// No key is copied by hand, and the key goes straight into the engine's settings on this machine.

export interface OptionsConnexion {
  /** Opens a URL in the contributor's browser (the default uses the system's own opener). */
  ouvrir?: (url: string) => void;
  /** OpenRouter's site (for tests: a stand-in). */
  base?: string;
  delaiMs?: number;
}

export function ouvrirNavigateur(url: string): void {
  const [cmd, args] =
    process.platform === 'win32' ? ['cmd', ['/c', 'start', '""', url.replace(/&/g, '^&')]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  spawn(cmd, args as string[], { stdio: 'ignore', detached: true, windowsHide: true }).unref();
}

const b64url = (b: Buffer) => b.toString('base64url');

/** Runs the flow and returns the new key. Rejects after the delay (5 min) if nobody approves. */
export async function connecterOpenRouter(o: OptionsConnexion = {}): Promise<string> {
  const base = (o.base ?? 'https://openrouter.ai').replace(/\/+$/, '');
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash('sha256').update(verifier).digest());
  return new Promise<string>((resolve, reject) => {
    let fini = false;
    const serveur = createServer(async (req, res) => {
      const u = new URL(req.url ?? '/', 'http://localhost');
      if (u.pathname !== '/callback' || fini) {
        res.writeHead(404).end();
        return;
      }
      const code = u.searchParams.get('code');
      const page = (titre: string, texte: string) => {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(`<!doctype html><meta charset="utf-8"><title>Kickswarm</title><body style="font-family:system-ui;background:#F1EFF7;color:#1D1931;display:grid;place-items:center;min-height:90vh"><div style="background:#fff;border:1px solid #D3CCE3;border-radius:16px;padding:24px;max-width:420px"><h1 style="font-size:22px;margin:0 0 8px">${titre}</h1><p style="margin:0">${texte}</p></div></body>`);
      };
      if (!code) {
        page('Not connected', 'OpenRouter did not send a code. Run the command again.');
        return terminer(new Error('OpenRouter did not send a code'));
      }
      try {
        const r = await fetch(`${base}/api/v1/auth/keys`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ code, code_verifier: verifier, code_challenge_method: 'S256' }),
        });
        const j = (await r.json().catch(() => ({}))) as { key?: string };
        if (!r.ok || !j.key) throw new Error(`OpenRouter refused the code (${r.status})`);
        page('OpenRouter is connected', 'Your free models are now part of your Kickswarm engine. You can close this tab.');
        terminer(undefined, j.key);
      } catch (e) {
        page('Not connected', (e as Error).message);
        terminer(e as Error);
      }
    });
    const minuteur = setTimeout(() => terminer(new Error('No answer from OpenRouter within 5 minutes')), o.delaiMs ?? 5 * 60_000);
    function terminer(err?: Error, cle?: string) {
      if (fini) return;
      fini = true;
      clearTimeout(minuteur);
      serveur.close();
      if (cle) resolve(cle);
      else reject(err);
    }
    serveur.listen(0, '127.0.0.1', () => {
      const port = (serveur.address() as AddressInfo).port;
      const params = new URLSearchParams({ callback_url: `http://localhost:${port}/callback`, code_challenge: challenge, code_challenge_method: 'S256' });
      (o.ouvrir ?? ouvrirNavigateur)(`${base}/auth?${params}`);
    });
  });
}
