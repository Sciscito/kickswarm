import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { configureCodex, configureGemini, launchPrompt, type PluginCommand } from '../src/install.js';

const plugin: PluginCommand = { command: 'C:\\Program Files\\nodejs\\node.exe', args: ['C:\\kick swarm\\dist\\cli.js', 'plugin'], env: { KICKSWARM_URL: 'http://127.0.0.1:7777' } };

test('join : configuration Codex, idempotente, sans écraser le reste', () => {
  const home = mkdtempSync(join(tmpdir(), 'osp-home-'));
  try {
    mkdirSync(join(home, '.codex'));
    writeFileSync(join(home, '.codex', 'config.toml'), 'model = "o4"\n\n[mcp_servers.autre]\ncommand = "x"\n');
    configureCodex(plugin, home);
    configureCodex(plugin, home);
    const toml = readFileSync(join(home, '.codex', 'config.toml'), 'utf8');
    assert.equal(toml.match(/\[mcp_servers\.kickswarm\]/g)?.length, 1, 'un seul bloc kickswarm');
    assert.match(toml, /model = "o4"/);
    assert.match(toml, /\[mcp_servers\.autre\]/);
    assert.match(toml, /command = "C:\\\\Program Files\\\\nodejs\\\\node.exe"/);
    assert.match(toml, /KICKSWARM_URL = "http:\/\/127\.0\.0\.1:7777"/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('join : configuration Gemini CLI fusionnée dans settings.json', () => {
  const home = mkdtempSync(join(tmpdir(), 'osp-home-'));
  try {
    mkdirSync(join(home, '.gemini'));
    writeFileSync(join(home, '.gemini', 'settings.json'), JSON.stringify({ theme: 'dark', mcpServers: { autre: { command: 'x' } } }));
    configureGemini(plugin, home);
    const s = JSON.parse(readFileSync(join(home, '.gemini', 'settings.json'), 'utf8'));
    assert.equal(s.theme, 'dark');
    assert.ok(s.mcpServers.autre);
    assert.deepEqual(s.mcpServers.kickswarm, { command: plugin.command, args: plugin.args, env: plugin.env });
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('join : la consigne de lancement nomme la ruche et les outils', () => {
  const p = launchPrompt('math-toolkit');
  assert.match(p, /math-toolkit/);
  assert.match(p, /swarm_join/);
  assert.match(p, /swarm_next/);
});
