# Premier essai avec une vraie IA

Le but : regarder une vraie IA (Claude, dans l'application de bureau) travailler sur une ruche, du début à la fin. Elle découpe le projet, écrit le code et l'assemble. Des gardiennes automatiques vérifient son travail, puis l'audit confirme que tout tient.

La ruche de l'essai s'appelle **text-toolkit**. C'est une petite bibliothèque de six fonctions sur le texte : `slugify`, `titleCase`, `camelCase`, `wordCount`, `truncate` et `isAnagram`. C'est assez petit pour durer quelques minutes, et assez neuf pour que l'IA ne puisse pas recopier une solution toute faite.

## Ce qu'il faut

- **L'application Claude**, avec l'onglet Code : tu l'as déjà.
- **Node.js**, déjà installé sur ta machine.
- Rien d'autre. Le moteur qui exécute les tests est fourni avec le projet.

## Les 3 étapes

### 1. Lancer la ruche

Ouvre un terminal dans le dossier du projet (`S:\Projet KickSwarmer`) et lance :

```bash
node dist/cli.js trial
```

Laisse ce terminal ouvert : c'est la ruche. Tu y verras défiler, en direct, ce que fait l'essaim. La commande prépare aussi un dossier pour l'abeille : `S:\Projet KickSwarmer\essai\abeille`.

### 2. Envoyer l'IA dans la ruche

Dans l'application Claude, onglet **Code** :

1. Ouvre une **nouvelle session** dans le dossier `S:\Projet KickSwarmer\essai\abeille`.
2. Si l'application demande d'activer le serveur MCP **kickswarm**, accepte. C'est le plugin qui relie l'IA à la ruche.
3. Écris simplement : **« Rejoins la ruche et travaille jusqu'au bout. »**

L'IA lit les consignes du dossier (`CLAUDE.md`), rejoint la ruche et enchaîne les tâches toute seule. Seuls les outils Kickswarm lui sont autorisés d'avance : elle ne peut rien faire d'autre sur ta machine.

### 3. Regarder, puis vérifier

- **En direct** : ouvre http://127.0.0.1:7777/hive dans ton navigateur pour voir les alvéoles se remplir.
- **À la fin** : le terminal affiche « hive complete » puis le résultat de l'audit, avec une ligne « ✓ » par contrôle. Il donne aussi la commande pour refaire l'audit plus tard, par exemple :

  ```bash
  node dist/cli.js audit --data "S:\Projet KickSwarmer\essai\runs\<date>\data"
  ```

- **Ce que l'IA a fait** : demande-lui « montre-moi ton journal ». Elle appellera `swarm_journal`, le journal local de tout ce qu'elle a reçu et envoyé.

Pour arrêter la ruche : **Ctrl+C** dans le terminal.

## Ce qui est automatique pendant l'essai, et pourquoi

| Ce qui est automatique | Pourquoi |
|---|---|
| **Des gardiennes d'appoint** vérifient le travail de l'IA | Une IA ne vérifie jamais son propre travail. Avec une seule IA, il faut d'autres gardiennes. Celles-ci rejouent honnêtement les tests. |
| **L'approbation des découpages** | Normalement, le porteur de la ruche approuve les premiers découpages à la main. Pour l'essai, c'est automatique, et chaque approbation est inscrite au registre. |
| **Un taux d'erreur cible de 1 %** au lieu de 1 sur 10 000 | Trois gardiennes suffisent ainsi par alvéole. Une vraie ruche, avec beaucoup d'abeilles, vise 1 sur 10 000. |

## Si quelque chose coince

- **L'IA ne voit pas les outils `swarm_…`** : vérifie que la session a bien été ouverte dans `essai\abeille`, et que le serveur MCP « kickswarm » est activé. Le fichier qui le déclare est `essai\abeille\.mcp.json`.
- **« Nothing to do right now »** : c'est normal, les gardiennes vérifient. L'IA rappelle `swarm_next` d'elle-même.
- **En secours, sans l'application** : installe Claude Code en ligne de commande, puis lance-le dans le dossier de l'abeille.

  ```bash
  npm install -g @anthropic-ai/claude-code
  ```

  Ensuite, dans `S:\Projet KickSwarmer\essai\abeille`, lance `claude`.

## Une répétition sans IA

Pour vérifier que tout est en place avant l'essai, une abeille scriptée peut jouer le rôle de l'IA :

```bash
node dist/cli.js trial --rehearse
```

Elle vérifie aussi que le plugin démarre exactement comme Claude le lancera, puis va jusqu'au miel et à l'audit.
