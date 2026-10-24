# First trial with a real AI

The goal: watch a real AI (Claude, in the desktop app) work on a hive, from start to finish. It splits the project, writes the code and assembles it. Automatic guards check its work, then the audit confirms that everything holds up.

The trial hive is called **text-toolkit**. It is a small library of six functions for text: `slugify`, `titleCase`, `camelCase`, `wordCount`, `truncate` and `isAnagram`. It is small enough to take a few minutes, and new enough that the AI cannot copy a ready-made solution.

## What you need

- **The Claude app**, with the Code tab: you already have it.
- **Node.js**, already installed on your computer.
- Nothing else. The engine that runs the tests comes with the project.

## The 3 steps

### 1. Start the hive

Open a terminal in the project folder (`S:\Projet KickSwarmer`) and run:

```bash
node dist/cli.js trial
```

Leave this terminal open: it is the hive. You will see what the swarm does scroll by, live. The command also prepares a folder for the bee: `S:\Projet KickSwarmer\essai\abeille`.

### 2. Send the AI into the hive

In the Claude app, **Code** tab:

1. Open a **new session** in the folder `S:\Projet KickSwarmer\essai\abeille`.
2. If the app asks you to enable the **kickswarm** MCP server, accept. It is the plugin that connects the AI to the hive.
3. Simply write: **"Join the hive and work until the end."**

The AI reads the instructions in the folder (`CLAUDE.md`), joins the hive and goes from task to task on its own. Only the Kickswarm tools are allowed in advance: it cannot do anything else on your computer.

### 3. Watch, then check

- **Live**: open http://127.0.0.1:7777/hive in your browser to watch the cells fill up.
- **At the end**: the terminal shows "hive complete", then the audit result, with one "✓" line per check. It also gives the command to run the audit again later, for example:

  ```bash
  node dist/cli.js audit --data "S:\Projet KickSwarmer\essai\runs\<date>\data"
  ```

- **What the AI did**: ask it "show me your journal". It will call `swarm_journal`, the local log of everything it received and sent.

To stop the hive: **Ctrl+C** in the terminal.

## What is automatic during the trial, and why

| What is automatic | Why |
|---|---|
| **Backup guards** check the AI's work | An AI never verifies its own work. With only one AI, other guards are needed. These ones replay the tests honestly. |
| **Approval of splits** | Normally, the hive owner approves the first splits by hand. For the trial, it is automatic, and each approval is written to the registry. |
| **A target error rate of 1%** instead of 1 in 10,000 | This way, three guards per cell are enough. A real hive, with many bees, aims for 1 in 10,000. |

## If something gets stuck

- **The AI does not see the `swarm_…` tools**: check that the session was opened in `essai\abeille`, and that the "kickswarm" MCP server is enabled. The file that declares it is `essai\abeille\.mcp.json`.
- **"Nothing to do right now"**: this is normal, the guards are checking. The AI calls `swarm_next` again on its own.
- **As a fallback, without the app**: install Claude Code on the command line, then start it in the bee's folder.

  ```bash
  npm install -g @anthropic-ai/claude-code
  ```

  Then, in `S:\Projet KickSwarmer\essai\abeille`, run `claude`.

## A rehearsal without AI

To check that everything is in place before the trial, a scripted bee can play the AI's part:

```bash
node dist/cli.js trial --rehearse
```

It also checks that the plugin starts exactly the way Claude will start it, then goes all the way to the honey and the audit.
