import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { trial, TRIAL_SLUG } from '../src/trial.js';

// The trial with a real AI, rehearsed: a scripted bee plays the agent, helper guards verify,
// splits are approved automatically, and the finished hive passes the audit.

test('trial: the dress rehearsal goes all the way to honey, and the audit passes', async () => {
  const sortie = mkdtempSync(join(tmpdir(), 'osp-essai-'));
  const lignes: string[] = [];
  // No traps here (the "kickswarm trial --rehearse" rehearsal covers them): the test suite runs in parallel.
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
    assert.ok(lignes.some((l) => /owner approved the split/.test(l)), 'the AI’s split is approved automatically');
    assert.ok(lignes.some((l) => /is honey/.test(l)));

    // The bee's folder: everything needed to plug a Claude Code session into this hive.
    const mcp = JSON.parse(readFileSync(join(run.abeille, '.mcp.json'), 'utf8')) as { mcpServers: { kickswarm: { command: string; args: string[]; env: Record<string, string> } } };
    assert.equal(mcp.mcpServers.kickswarm.command, process.execPath);
    assert.deepEqual(mcp.mcpServers.kickswarm.args.slice(-1), ['plugin']);
    assert.equal(mcp.mcpServers.kickswarm.env.KICKSWARM_URL, run.url);
    assert.ok(mcp.mcpServers.kickswarm.env.KICKSWARM_HOME!.startsWith(run.abeille), 'the bee’s identity stays in its folder');
    const settings = JSON.parse(readFileSync(join(run.abeille, '.claude', 'settings.json'), 'utf8')) as { permissions: { allow: string[] } };
    assert.deepEqual(settings.permissions.allow, ['mcp__kickswarm'], 'only the Kickswarm tools are pre-approved');
    assert.match(readFileSync(join(run.abeille, 'CLAUDE.md'), 'utf8'), new RegExp(`swarm_join.*${TRIAL_SLUG}`));
    assert.ok(existsSync(join(run.dossier, 'data', 'registre.jsonl')), 'the trial’s registry is on disk, for a later audit');
  } finally {
    await run.stop();
    rmSync(sortie, { recursive: true, force: true });
  }
});
