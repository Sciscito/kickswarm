// A local engine for trying the automatic door against scripts/dev-bee.ts, with its own settings
// folder (not your ~/.kickswarm): node scripts/dev-engine.mjs, then open http://127.0.0.1:7790
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const home = join(tmpdir(), 'kickswarm-dev-engine');
mkdirSync(home, { recursive: true });
const enfant = spawn(process.execPath, ['dist/cli.js', 'bee', '--url', 'http://127.0.0.1:7788'], { stdio: 'inherit', env: { ...process.env, KICKSWARM_HOME: home } });
process.on('SIGTERM', () => enfant.kill());
process.on('SIGINT', () => enfant.kill());
enfant.on('exit', (c) => process.exit(c ?? 0));
