import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { generateIdentity, isContributorId, type Identity } from '../protocol/identity.js';

// L'identité du contributeur vit sur sa machine, et nulle part ailleurs (principe 2).

export function kickswarmHome(): string {
  return process.env.KICKSWARM_HOME ?? join(homedir(), '.kickswarm');
}

export function loadOrCreateIdentity(dir = kickswarmHome()): { identite: Identity; fichier: string; creee: boolean } {
  const fichier = join(dir, 'identite.json');
  if (existsSync(fichier)) {
    const identite = JSON.parse(readFileSync(fichier, 'utf8')) as Identity;
    if (!isContributorId(identite.id) || !identite.privateKeyPem) throw new Error(`Identité illisible : ${fichier}`);
    return { identite, fichier, creee: false };
  }
  mkdirSync(dir, { recursive: true });
  const identite = generateIdentity();
  writeFileSync(fichier, JSON.stringify(identite, null, 2), { encoding: 'utf8', mode: 0o600 });
  return { identite, fichier, creee: true };
}
