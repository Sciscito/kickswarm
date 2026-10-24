// Playbooks (OSP v0.2 §7.3, v0.3 §3.6): split patterns that worked, reused by the bees of similar
// hives. A hive names its playbook when it is created; the plugin ships the playbooks' text and adds
// the part for the bee's role to its instructions. The text comes with the plugin, not from the
// coordinator, so a hive cannot slip instructions into it.

import { ROBLOX } from './roblox.js';

export interface Playbook {
  id: string;
  titre: string;
  /** For the scout: how to split. */
  eclaireuse: string;
  /** For the worker: how to write one cell's deliverable. */
  ouvriere: string;
  /** For the builder: how to assemble. */
  batisseuse: string;
}

export const PLAYBOOKS: Record<string, Playbook> = { [ROBLOX.id]: ROBLOX };

export function playbook(id: string | undefined): Playbook | undefined {
  return id !== undefined && Object.hasOwn(PLAYBOOKS, id) ? PLAYBOOKS[id] : undefined;
}
