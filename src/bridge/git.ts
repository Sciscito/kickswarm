import { spawn } from 'node:child_process';

/**
 * Runs a command of the member's own tools (git, gh) in a folder and returns its output.
 * No shell: arguments go as they are, so a file name or a title cannot run anything.
 */
export function run(cmd: string, cwd: string, args: string[], opts: { input?: string; env?: Record<string, string> } = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd, env: { ...process.env, ...opts.env }, windowsHide: true });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    p.stdout.on('data', (b: Buffer) => out.push(b));
    p.stderr.on('data', (b: Buffer) => err.push(b));
    p.on('error', (e) => reject(Object.assign(new Error(`${cmd} not found or not runnable: ${e.message}`), { code: 'ENOENT' })));
    p.on('close', (code) => {
      if (code === 0) return resolve(Buffer.concat(out).toString('utf8'));
      const msg = Buffer.concat(err).toString('utf8').trim() || Buffer.concat(out).toString('utf8').trim();
      reject(new Error(`${cmd} ${args[0] ?? ''} failed: ${msg || `exit code ${code}`}`));
    });
    if (opts.input !== undefined) p.stdin.end(opts.input, 'utf8');
    else p.stdin.end();
  });
}

export const git = (cwd: string, args: string[], opts: { input?: string; env?: Record<string, string> } = {}) =>
  run('git', cwd, ['-c', 'core.autocrlf=false', '-c', 'core.safecrlf=false', ...args], opts).then((s) => s.replace(/\n$/, ''));

/** Same repository whatever the spelling: https://github.com/a/b.git, git@github.com:a/b, ssh://git@github.com/a/b. */
export function memeDepot(a: string, b: string): boolean {
  const norm = (u: string) =>
    u
      .trim()
      .replace(/^[a-z+]+:\/\//i, '')
      .replace(/^[^@/]+@/, '')
      .replace(/^([^/:]+):(?!\d)/, '$1/')
      .replace(/\.git\/?$/, '')
      .replace(/\/+$/, '')
      .toLowerCase();
  return norm(a) === norm(b);
}
