# Contributing to Kickswarm

Thank you for wanting to make the swarm stronger. Kickswarm is built in the open, and every contribution, from a typo to a new verifier, is welcome.

## Before you start

- **Read the spec.** [spec/OSP-v0.1.md](spec/OSP-v0.1.md) is the source of truth. If your change alters the protocol (objects, lifecycle, economy, governance), open an issue first so it can be discussed and written into the spec.
- **Small and focused beats big.** One pull request, one idea.
- **Check what exists.** Search the open issues and pull requests before starting.

## Set up

You need Node.js 22 or newer.

```bash
npm install
```

```bash
npm test
```

```bash
npm run typecheck
```

To see your change working end to end, run the live hive and open http://127.0.0.1:7777/hive:

```bash
npm run build
```

```bash
node dist/cli.js demo live
```

## What a good pull request looks like

- **Tests.** New behavior comes with tests in `test/`. Bug fixes come with a test that failed before the fix.
- **The suite passes.** `npm test` and `npm run typecheck` are green.
- **The code reads like the code around it.** Follow the existing naming, structure and comment density. Protocol fields keep the French names used by the spec (`alveole`, `critere_fini`, `miel`…): they are part of the wire format.
- **User-facing text is in English**, short and plain. Every text in the live hive sits on a solid surface and stays readable in light and dark themes.
- **No secrets.** Never commit keys, identities (`identite.json`), `data/` folders or `.env` files.
- **Commit messages** say what changed and why, in the imperative: `Add Lean verifier`, `Fix lease expiry for guards`.

## Security

The verifier runs code sent by strangers, and the plugin runs on contributors' machines. Security issues are taken very seriously.

- **Do not open a public issue for a vulnerability.** Report it privately to the maintainers. A dedicated security contact will be published before the public launch; until then, use GitHub's private vulnerability reporting on the repository.
- Read [docs/security.md](docs/security.md) for the threat model, the mathematics of verification and the defenses against injection.

## Ground rules

- **The charter applies to the project itself.** No contribution may help build weapons, mass surveillance or manipulation tools ([spec §15](spec/OSP-v0.1.md)).
- **Be kind and direct.** Critique ideas, never people. Harassment, discrimination and personal attacks are not tolerated, and maintainers may remove anything or anyone that breaks this rule.
- **Respect the AI providers' terms.** Contributions must not push contributors to break the terms of their AI subscriptions ([spec §20](spec/OSP-v0.1.md)).

## Licensing of contributions

- **Code** (`src/`, `test/`, `web/`, `examples/`, `prototype/`, configuration) is licensed under the [Apache License 2.0](LICENSE).
- **Specification and documents** (`spec/`, `docs/`, including the film and the posters) are licensed under [Creative Commons Attribution 4.0](LICENSE-DOCS).
- By submitting a contribution, you agree that it is licensed under the license that covers the files you change, as described in section 5 of the Apache License for code.
- **The Kickswarm name and logo are not covered by these licenses.** You can fork the protocol freely; please give your fork its own name.
