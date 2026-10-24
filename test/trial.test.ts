import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { trial, TRIAL_SLUG } from '../src/trial.js';

// The trial with a real AI, rehearsed: a scripted bee plays the agent, helper guards verify,
// splits are approved automatically, and the finished hive passes the audit.

test('essai : la répétition générale va jusqu’au miel, et l’audit passe', async () => {
  const sortie = mkdtempSync(join(tmpdir(), 'osp-essai-'));
  const lignes: string[] = [];
  // Sans pièges ici (la répétition « kickswarm trial --rehearse » les couvre) : la suite de tests tourne en parallèle.
  const run = await trial({ port: 0, rehearse: true, smoke: false, pace: 150, sortie, params: { taux_pieges: 0 }, log: (s) => lignes.push(s) });
  try {
    let garde: NodeJS.Timeout | undefined;
    const { ok } = await Promise.race([
      run.done,
      new Promise<never>((_, rej) => {
        garde = setTimeout(() => rej(new Error(`trial still running:\n${lignes.slice(-15).join('\n')}`)), 240_000);
      }),
    ]).finally(() => clearTimeout(garde));
    assert.equal(ok, true, lignes.join('\n'));
    assert.ok(lignes.some((l) => /owner approved the split/.test(l)), 'le découpage de l’IA est approuvé automatiquement');
    assert.ok(lignes.some((l) => /is honey/.test(l)));

    // Le dossier de l'abeille : de quoi brancher une session Claude Code sur cette ruche.
    const mcp = JSON.parse(readFileSync(join(run.abeille, '.mcp.json'), 'utf8')) as { mcpServers: { kickswarm: { command: string; args: string[]; env: Record<string, string> } } };
    assert.equal(mcp.mcpServers.kickswarm.command, process.execPath);
    assert.deepEqual(mcp.mcpServers.kickswarm.args.slice(-1), ['plugin']);
    assert.equal(mcp.mcpServers.kickswarm.env.KICKSWARM_URL, run.url);
    assert.ok(mcp.mcpServers.kickswarm.env.KICKSWARM_HOME!.startsWith(run.abeille), 'l’identité de l’abeille reste dans son dossier');
    const settings = JSON.parse(readFileSync(join(run.abeille, '.claude', 'settings.json'), 'utf8')) as { permissions: { allow: string[] } };
    assert.deepEqual(settings.permissions.allow, ['mcp__kickswarm'], 'seuls les outils Kickswarm sont pré-autorisés');
    assert.match(readFileSync(join(run.abeille, 'CLAUDE.md'), 'utf8'), new RegExp(`swarm_join.*${TRIAL_SLUG}`));
    assert.ok(existsSync(join(run.dossier, 'data', 'registre.jsonl')), 'le registre de l’essai est sur disque, pour un audit ultérieur');
  } finally {
    await run.stop();
    rmSync(sortie, { recursive: true, force: true });
  }
});
