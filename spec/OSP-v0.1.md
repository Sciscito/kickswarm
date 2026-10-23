# Open Swarm Protocol (OSP) — v0.1

**Spec fondatrice de Kickswarm**

| | |
|---|---|
| Statut | Brouillon fondateur, en discussion |
| Version | 0.1.0 |
| Date | 23 octobre 2026 |
| Auteur | Le fondateur de Kickswarm |
| Licence de la spec | CC BY 4.0 (tout le monde peut l'implémenter) |
| Licence des implémentations de référence | Apache 2.0 |

> **Toute tâche est soit assez petite pour être faite et vérifiée, soit l'essaim la découpe.**

---

## 0. Comment lire ce document

- Les mots **DOIT**, **NE DOIT PAS**, **DEVRAIT** et **PEUT** ont le sens de la RFC 2119 : obligation, interdiction, recommandation forte, option.
- Les sections marquées *(informatif)* expliquent ou recommandent. Elles n'obligent personne.
- Les valeurs numériques suivies de *(paramètre)* sont des réglages de départ. La gouvernance (§14) peut les modifier sans changer de version majeure.

---

## 1. Objet et principes

OSP permet à des milliers de contributeurs de mettre en commun leurs agents d'IA (abonnements, crédits API, modèles locaux) pour faire avancer un projet, de l'idée en une phrase jusqu'au résultat vérifié.

**La vision** *(informatif)*. Le problème principal de notre temps est l'alignement des humains entre eux. Kickswarm y répond par trois idées anciennes, mises au service de l'ère post-travail :

- **La participation.** Celui qui contribue devient copropriétaire de la puissance créée. C'est l'association du capital et du travail, appliquée au calcul.
- **La subsidiarité.** Chaque communauté décide de ses propres projets, au plus près de ceux qu'ils concernent.
- **La destination universelle des biens.** Une part de toute la puissance créée revient à tous, en permanence : c'est le Commun.

Le but est de sécuriser des ressources (calcul, infrastructures, terres), de garantir à chacun un accès direct aux caravelles et le droit de proposer un problème à l'essaim, et de bâtir une gouvernance saine, au service de la beauté, de l'abondance, de la paix et de la liberté.

Les sept principes ci-dessous priment sur tout le reste du document. En cas de conflit, ils l'emportent.

1. **Vérifier plutôt que faire confiance.** On ne vérifie pas le processus, on vérifie le résultat. Aucun résultat n'entre dans une ruche sans vérification indépendante.
2. **Les identifiants ne quittent jamais la machine du contributeur.** Ni mot de passe, ni jeton, ni clé API ne transitent par le coordinateur.
3. **Zéro effort.** Contribuer prend deux actions : installer, puis choisir ce qu'on donne. Lancer une ruche prend une phrase.
4. **Ouvert par défaut.** La spec, les résultats et le registre des décisions sont publics.
5. **Tout pouvoir est visible.** Chaque décision du fondateur, du conseil ou d'un porteur de ruche est écrite dans le registre public, avec sa raison.
6. **La charte d'abord.** Une ruche qui viole la charte (§15) ne démarre pas, ou s'arrête.
7. **Le travail donné peut être rendu.** Chaque contribution vérifiée produit du miel, la monnaie de travail du réseau. Le miel se dépense ensuite en puissance de calcul (§18.1).

---

## 2. Vocabulaire

| Terme | Définition |
|---|---|
| **Ruche** | Un projet. Elle a un objectif racine, une charte de conformité, un porteur et une classe de vérification par défaut. |
| **Rayon** | L'arbre des alvéoles d'une ruche. Le cœur (la racine) est l'objectif, les feuilles sont les tâches les plus fines. |
| **Alvéole** | L'unité de travail : une tâche signée, adressée par son hash, avec son critère de fin vérifiable. |
| **Contributeur** | Une personne, identifiée par une paire de clés. |
| **Abeille** | Une instance d'agent lancée par un contributeur. Elle prend des alvéoles une par une. |
| **Caste** | Le rôle d'une abeille pour une tâche donnée : éclaireuse, ouvrière, gardienne ou bâtisseuse (§7). |
| **Coordinateur** | Le serveur qui tient l'état des ruches, attribue les tâches et tient le registre. Il ne fait aucun travail d'IA. |
| **Gardienne** | Une abeille qui vérifie le travail d'une autre. |
| **Miel** | La monnaie de travail du réseau, comptée en grammes. Elle se gagne par du travail vérifié et se dépense en puissance de calcul (§18.1). |
| **Réputation** | Un score de fiabilité entre 0 et 1, propre à chaque contributeur. |
| **Pledge** | Ce qu'un contributeur donne et comment il le répartit entre les ruches. |
| **Tableau noir** | La mémoire partagée d'une ruche : découvertes, impasses, questions. |
| **Phéromone** | Le signal de progrès d'une branche, qui attire plus ou moins d'abeilles. |
| **Orientation** | Une priorité donnée volontairement à une branche par un humain habilité (§17). |
| **Fondateur** | L'auteur du protocole. Ses pouvoirs sont définis et bornés au §14. |
| **Conseil** | L'organe élu par les contributeurs (§14.3). |
| **Pool fondateur** | La part volontaire du calcul donné que le fondateur alloue (§16). |
| **Registre** | Le journal public et inaltérable de toutes les décisions et de tout le miel. |
| **Fondation** | L'organisation à but non lucratif qui détient le protocole et déploie les ruches souveraines (§18.2). |
| **Caravelle** | Un nœud de calcul souverain et physique (serveurs, modèles ouverts) de la fondation, installé là où une communauté le demande. La ruche travaille, les caravelles portent la puissance : ensemble, elles explorent la noosphère. |
| **Flotte** | L'ensemble des caravelles. |
| **Équipage** | Les personnes qui font tourner et entretiennent une caravelle. |
| **Part de puissance** | Un droit permanent sur une fraction de la capacité de la flotte, obtenu par la participation (§18.2). |
| **Le Commun** | Les parts détenues par tout le monde, en permanence, et redistribuées à chaque humain inscrit (§18.2). |
| **Soutien** | Un vote gratuit qu'un contributeur donne à une ruche qu'il veut voir aboutir. |

---

## 3. Architecture

```
  Contributeur (sa machine)                         Réseau Kickswarm
 ┌─────────────────────────────┐            ┌──────────────────────────────┐
 │ Agent : Claude Code, Codex, │            │ Coordinateur                 │
 │ Gemini CLI, Ollama…         │            │  · état des ruches et rayons │
 │   ▲                         │  alvéoles  │  · attribution des castes    │
 │   │ outils MCP              │◄──signées──│  · ordonnancement (§12)      │
 │ Plugin kickswarm (MCP)      │            │  · tableau noir (§13)        │
 │   │                         │──résultats─►  · registre public           │
 │ Sandbox d'exécution (§8)    │  + hashes  └──────────────┬───────────────┘
 │ Clés et identifiants : ici, │                           │
 │ et nulle part ailleurs      │            ┌──────────────▼───────────────┐
 └─────────────────────────────┘            │ Vérificateurs automatiques   │
                                            │ (tests, Lean, CI, citations) │
                                            └──────────────────────────────┘
```

Il y a quatre composants.

1. **Le plugin**, un serveur MCP local. Il relie n'importe quel agent compatible MCP au réseau. Il DOIT exécuter les alvéoles dans la sandbox (§8) et NE DOIT jamais envoyer d'identifiants.
2. **Le daemon** *(optionnel)* fait tourner le plugin sans humain : quota inutilisé, plages horaires, GPU de nuit.
3. **Le coordinateur.** Pour v0.1, il est unique et opéré par Kickswarm. La fédération de coordinateurs arrive en v0.3 (§23).
4. **Les vérificateurs automatiques**, des conteneurs qui rejouent les vérifications déterministes.

---

## 4. Les objets du protocole

### 4.1 Règles communes

- Tout objet est sérialisé en JSON canonique (RFC 8785, JCS).
- Son identifiant est `sha256:` suivi du hash hexadécimal de cette sérialisation, champ `sig` exclu.
- Toute signature est en Ed25519. L'identité d'un contributeur est sa clé publique, préfixée `ed25519:`.
- Un objet signé est immuable. Le modifier, c'est créer un nouvel objet.

### 4.2 Ruche

```json
{
  "type": "osp.hive/0.1",
  "slug": "erdos-lean",
  "nom": "Erdős × Lean",
  "objectif": "Formaliser des problèmes ouverts en Lean 4",
  "porteur": "ed25519:…",
  "classe_verif_defaut": "V0",
  "licence_resultats": "CC-BY-4.0",
  "conformite_charte": { "version": "0.1", "decision": "sha256:…" },
  "budget": { "plafond_miel": 500000 },
  "statut": "active",
  "sig": "…"
}
```

`statut` vaut `proposee`, `active`, `en_pause`, `terminee` ou `refusee`. Une ruche ne passe à `active` qu'avec une décision de conformité inscrite au registre (§14.6).

### 4.3 Alvéole

```json
{
  "type": "osp.cell/0.1",
  "ruche": "erdos-lean",
  "parent": "sha256:…",
  "chemin": "3.2.1",
  "objectif": "Prouver le lemme d'encadrement pour n pair",
  "capsule": "sha256:…",
  "critere_fini": {
    "classe": "V0",
    "verificateur": "lean4@4.12/lake build",
    "attendu": "aucune erreur, aucun sorry"
  },
  "budget": { "tokens_max": 200000, "duree_max_s": 1800 },
  "atomique": true,
  "emise_par": "coordinateur",
  "sig": "…"
}
```

- La **capsule** contient tout le contexte nécessaire, et rien de plus : extraits du tableau noir, fichiers, résultats des alvéoles sœurs utiles. Elle DOIT tenir dans le budget de contexte d'un agent courant (32 000 tokens *(paramètre)*).
- Une alvéole non atomique (`"atomique": false`) appelle un découpage (§6), pas une exécution.

### 4.4 Résultat

```json
{
  "type": "osp.result/0.1",
  "alveole": "sha256:…",
  "auteur": "ed25519:…",
  "caste": "ouvriere",
  "livrable": "sha256:…",
  "preuve": "sha256:…",
  "transcript": "sha256:…",
  "impasses": ["sha256:…"],
  "agent": { "famille": "claude-code", "modele": "déclaré" },
  "cout": { "tokens": 84211, "duree_s": 640 },
  "sig": "…"
}
```

- `livrable` est le travail lui-même : code, preuve, texte, données.
- `preuve` est l'artefact qui permet de vérifier : sortie de test, journal de compilation, liste de citations.
- `transcript` est le hash du journal d'exécution. Il sert à l'audit en cas d'escalade et ne quitte la machine que sur demande d'un jury.
- `impasses` liste les pistes essayées sans succès. Elles alimentent le tableau noir.
- Le modèle utilisé est déclaratif : le protocole ne peut pas le prouver.

### 4.5 Verdict

```json
{
  "type": "osp.verdict/0.1",
  "resultat": "sha256:…",
  "gardienne": "ed25519:…",
  "decision": "valide",
  "motif": "lake build OK, 0 sorry",
  "mise_reputation": 0.05,
  "piege": false,
  "sig": "…"
}
```

`decision` vaut `valide`, `rejete` ou `abstention`. `piege` n'est révélé qu'après le verdict (§9.4).

### 4.6 Pledge

```json
{
  "type": "osp.pledge/0.1",
  "contributeur": "ed25519:…",
  "ressources": [
    { "type": "abonnement", "agent": "claude-code", "mode": "quota_inutilise" },
    { "type": "abonnement", "agent": "codex", "mode": "pourcentage", "valeur": 20 },
    { "type": "api_byok", "fournisseur": "anthropic", "plafond_mensuel_eur": 20 },
    { "type": "gpu_local", "plage": "23:00-07:00", "modeles": ["qwen", "llama"] }
  ],
  "repartition": { "erdos-lean": 50, "atlas-antibio": 30, "pool-fondateur": 20 },
  "sig": "…"
}
```

La somme de `repartition` DOIT faire 100. Le détail des ressources est au §11.

---

## 5. Cycle de vie d'une alvéole

```
 verrouillee ──(tous les enfants en miel)──► libre ──(attribution)──► reservee
                                              ▲                          │
                                              │                     (l'abeille arrive)
                                    rejetee ──┘                          ▼
                                       ▲                              en_cours
                                       │                                 │
                                       │                            (résultat soumis)
                                       │                                 ▼
                                       └──────(verdict négatif)──── en_verification
                                                                         │
                                                                   (verdict positif)
                                                                         ▼
                                                                       miel
```

- **verrouillee** : l'alvéole a des enfants qui ne sont pas tous en `miel`.
- **libre** : elle peut être prise. Une feuille est libre dès sa création.
- **reservee** : une abeille l'a prise, avec un bail de `duree_max_s` × 1,5 *(paramètre)*. Si le bail expire, l'alvéole redevient libre et l'abeille perd un peu de réputation.
- **en_verification** : les gardiennes sont tirées au sort (§7.2).
- **miel** : validée. Le miel est versé (§10) et le parent est réévalué.
- **rejetee** : le résultat est refusé. L'alvéole redevient `libre`. Après 3 rejets *(paramètre)*, elle est renvoyée en découpage (§6) : elle était sans doute mal posée.

Une alvéole parente passe à `libre` quand tous ses enfants sont en `miel`. Une **bâtisseuse** l'assemble alors à partir des résultats de ses enfants, et cet assemblage est vérifié à son tour. Le miel remonte ainsi jusqu'au cœur.

---

## 6. La boucle fractale : le découpage

### 6.1 Critère d'atomicité

Une alvéole est **atomique** si et seulement si les trois conditions sont réunies :

1. son `critere_fini` est vérifiable par une classe de vérification connue (§9.1) ;
2. son coût estimé tient dans le budget maximal d'une alvéole ;
3. sa capsule tient dans le budget de contexte (§4.3).

Sinon, elle DOIT être découpée.

### 6.2 Découpages concurrents

1. Le coordinateur tire au sort *k* éclaireuses (3 par défaut *(paramètre)*). Chacune propose un découpage en 2 à 12 enfants, chaque enfant avec son critère de fin.
2. Des gardiennes notent les découpages sur une grille publique : couverture de l'objectif, vérifiabilité des enfants, indépendance des enfants, coût estimé.
3. Le découpage le mieux noté est adopté. Les autres sont archivés au tableau noir.
4. **Découpage probatoire.** Si, après 20 % du budget de la branche *(paramètre)*, la branche progresse moins vite que la médiane de la ruche, un découpage archivé PEUT la remplacer. C'est la sélection par les résultats.

### 6.3 Points de contrôle humains

Le découpage décide de la direction, et la direction appartient aux humains.

- Les découpages des **niveaux 0 et 1** (le cœur et ses enfants directs) DOIVENT être approuvés par le porteur de la ruche avant exécution.
- Le porteur PEUT exiger une approbation à des niveaux plus profonds.
- Le fondateur et le conseil disposent en plus de l'orientation (§17) et du veto (§14.4).

### 6.4 Limites

- La profondeur maximale est de 8 niveaux *(paramètre)*.
- Une alvéole qui ne devient pas atomique à cette profondeur est marquée `bloquee` et signalée au porteur.

---

## 7. Castes et attribution

### 7.1 Les quatre castes

| Caste | Tâche | Classe de vérification de sa production |
|---|---|---|
| Éclaireuse | Proposer un découpage | Notation par jury (V2) |
| Ouvrière | Exécuter une alvéole atomique | Celle de l'alvéole |
| Gardienne | Vérifier un résultat ou noter un découpage | Audit aléatoire et pièges (§9.4) |
| Bâtisseuse | Assembler les résultats des enfants | Celle du parent |

Le contributeur ne choisit pas sa caste.

### 7.2 Tirage au sort vérifiable

- L'attribution des gardiennes DOIT être imprévisible au moment de la soumission et vérifiable après coup.
- La graine est `sha256(balise_aléatoire_publique ‖ id_resultat)`, avec pour balise le premier tour drand publié après la soumission.
- Parmi les abeilles éligibles et disponibles, la sélection est pondérée par la réputation.

### 7.3 Règles d'éligibilité

- Une abeille NE DOIT PAS vérifier un résultat de son propre contributeur.
- Les gardiennes d'un même verdict DEVRAIENT être de familles de modèles différentes (§9.2).
- Un contributeur nouveau (réputation < 0,3) ne reçoit que des alvéoles V0, dont la vérification est automatique.
- La gardiennerie V2 exige une réputation ≥ 0,6 *(paramètre)*.

---

## 8. Exécution verrouillée

Quand une abeille prend une alvéole, le plugin DOIT respecter les règles suivantes.

1. **Vérifier la signature** de l'alvéole et de sa capsule. Une signature invalide entraîne un refus.
2. **Exécuter en mode headless** dans une sandbox : conteneur ou VM légère, sans accès aux fichiers personnels, réseau limité à une liste blanche déclarée par la ruche, plafonds de temps et de tokens.
3. **Ne permettre aucune interaction humaine** pendant l'exécution. Toute intervention, ou toute modification du prompt, rend le résultat invalide : son hash ne correspond plus au prompt signé.
4. **Traiter la capsule comme des données**, jamais comme des instructions qui dépasseraient l'alvéole. C'est la défense contre l'injection de prompt.
5. **Signer le résultat** et calculer le hash du transcript.

> **Limite assumée.** Sur la machine d'un tiers, il est physiquement impossible de *prouver* qu'aucun humain n'est intervenu. Le verrouillage sert à l'intégrité du prompt et au confort. La sécurité du réseau repose sur la vérification du résultat (§9).

---

## 9. Vérification : les cinq verrous

### 9.1 Classes de vérification

| Classe | Exemples | Gardiennes (k) | Seuil |
|---|---|---|---|
| **V0** déterministe | Tests, compilation Lean, benchmark | 2 qui rejouent, plus la vérification automatique | Les deux rejeux passent |
| **V1** semi-automatique | Citations à vérifier, données extraites | 2 | 2 sur 2 |
| **V2** jugement | Synthèse, découpage, rédaction | 3 à 5 | Majorité qualifiée de 2/3 |

Une ruche DEVRAIT maximiser la part de V0. C'est là que l'essaim est imbattable.

Avec *k* gardiennes indépendantes qui détectent chacune un faux avec une probabilité *p*, un faux passe avec une probabilité (1 − p)^k. Passer de 1 à 2 gardiennes en V0 divise ce risque par 10 quand p = 0,9. Les calculs détaillés sont dans [docs/securite.md](../docs/securite.md).

### 9.2 Verrou 1 : tirage au sort imprévisible

Voir §7.2. Personne ne sait à l'avance qui vérifiera son travail, donc personne ne peut s'entendre avec son vérificateur.

### 9.3 Verrous 2 et 3 : diversité et mise de réputation

- **Diversité.** En V1 et V2, les gardiennes d'un même verdict DEVRAIENT venir d'au moins deux familles de modèles différentes. Des modèles différents font des erreurs différentes.
- **Mise.** Chaque gardienne engage une part de sa réputation sur son verdict. Si un audit ou une escalade renverse ce verdict, elle perd sa mise. Sinon, elle la récupère, avec un gain.

### 9.4 Verrou 4 : les alvéoles-pièges

- Le coordinateur injecte, parmi les tâches de vérification, des résultats dont il connaît la vérité : des faux construits exprès et des vrais déjà validés. Ils représentent 4 % des tâches *(paramètre)*.
- Valider un faux divise la réputation par deux. Rejeter un vrai coûte la mise.
- Les pièges sont indiscernables a priori et ne sont révélés qu'après le verdict.

### 9.5 Verrou 5 : l'escalade

- Un verdict peut être contesté par l'auteur ou par une gardienne minoritaire, contre une mise de réputation.
- La contestation part devant un jury de 7 gardiennes, puis de 15 en appel, puis devant le porteur de la ruche en dernier ressort.
- À chaque niveau, le perdant paie la mise.

### 9.6 Audit aléatoire

Après validation, 2 % des alvéoles en miel *(paramètre)* sont revérifiées par un nouveau jury. Un verdict renversé à cette occasion pénalise toutes les gardiennes initiales.

---

## 10. Miel, réputation, ratio

### 10.1 Le miel

```
miel(alvéole) = B × c_classe × (1 + 0,25 × hauteur)
```

- `B` est la base, 6 g *(paramètre)*.
- `c_classe` vaut 1 en V0, 1,5 en V1 et 2 en V2.
- `hauteur` est le nombre de niveaux sous l'alvéole : une feuille a une hauteur de 0, et assembler rapporte plus.
- Le cœur d'une ruche complétée verse un bonus de 80 g *(paramètre)*, partagé entre tous les contributeurs de la ruche au prorata de leur miel.

Le miel est versé ainsi :

| Bénéficiaire | Part |
|---|---|
| Auteur du résultat | 100 % de `miel(alvéole)` |
| Chaque gardienne du verdict final | 20 % de `miel(alvéole)` |
| Gardienne qui démasque un piège | Bonus de 12 g |
| Gardienne qui démasque un faux réel | Bonus de 6 g |
| Porteur d'une ruche complétée | 5 % du miel total produit par la ruche, multiplié par (1 + 0,1 × √soutiens) *(paramètre)* |

La dernière ligne récompense celui qui propose un projet qui aboutit et qui plaît. Les soutiens sont gratuits, et chaque contributeur en a 10 par mois *(paramètre)*.

Tout le miel est inscrit au registre. C'est la monnaie de travail du réseau : son émission, sa dépense et ses phases sont au §18.1.

### 10.2 La réputation

Chaque contributeur a une réputation R ∈ [0, 1]. Elle commence à 0,2.

| Événement | Mise à jour |
|---|---|
| Résultat ou verdict confirmé | R ← R + 0,05 × (1 − R) |
| Verdict renversé | R ← R × 0,9 |
| Bail expiré | R ← R × 0,98 |
| Piège faux validé | R ← R × 0,5 |
| Résultat rejeté (pour son auteur) | R ← R × 0,95 |

Tous les coefficients sont des *(paramètres)*.

### 10.3 Les rangs *(informatif)*

| Rang | Miel cumulé |
|---|---|
| Larve | 0 g |
| Nymphe | 50 g |
| Butineuse | 200 g |
| Sentinelle | 600 g |
| Architecte | 1,5 kg |
| Ancienne | 3 kg |

Les rangs sont cosmétiques. Les droits dépendent de la réputation, pas du rang.

### 10.4 Le ratio

```
ratio = miel donné aux autres ruches / miel consommé par mes ruches
```

- Les ruches dont le porteur a un ratio ≥ 1 reçoivent un multiplicateur de priorité de 1,2 *(paramètre)* dans l'ordonnancement (§12).
- Une nouvelle ruche reçoit un crédit d'amorçage pour démarrer avant d'avoir un ratio.

### 10.5 Les trophées

Les trophées célèbrent la participation. Ils ne valent rien en argent, ne se transfèrent pas, et s'affichent sur le profil public de chaque contributeur. Ils permettent de montrer qu'on était là au début de quelque chose de révolutionnaire.

| Trophée | Comment l'obtenir |
|---|---|
| **Pionnier** | Contribuer pendant les 6 premiers mois après le lancement public (§18.4) |
| **Première goutte** | Faire valider sa première alvéole |
| **Chasseuse de pièges** | Déjouer une alvéole-piège |
| **Gardienne** | Rendre 10 verdicts confirmés |
| **Éclaireuse** | Faire adopter un découpage |
| **Bâtisseuse** | Faire valider un assemblage |
| **Abeille fondatrice** | Faire partie des 10 premiers contributeurs d'une ruche |
| **Cœur de ruche** | Avoir contribué à une ruche complétée |
| **Porteur** | Voir une de ses ruches approuvée |
| **Abeille infatigable** | Remplir 10 alvéoles |

Les trophées se calculent à partir du registre public : n'importe qui peut vérifier qu'ils sont mérités. La gouvernance PEUT en ajouter, jamais en retirer à quelqu'un qui les a obtenus.

---

## 11. Pledge et ressources

### 11.1 Types de ressources

| Type | Ce que ça veut dire | Règle |
|---|---|---|
| `abonnement` / `quota_inutilise` | Le daemon détecte le quota restant avant remise à zéro et lance des alvéoles avec l'agent du contributeur, sur son propre compte | L'humain reprend la main dès qu'il revient |
| `abonnement` / `pourcentage` ou `heures` | Une part du temps d'agent est dédiée | Plafond déclaré et respecté localement |
| `api_byok` | Clé API locale, avec un plafond en euros réparti selon le pledge | La clé ne quitte jamais la machine |
| `gpu_local` | Modèles ouverts, sur une plage horaire | Alvéoles filtrées selon la capacité déclarée |
| `don` | Argent donné à une ruche, via un prestataire de paiement | Seul flux où une commission est permise (§18.5) |

### 11.2 Règles

- Le plugin DOIT faire respecter localement les plafonds du pledge. Le coordinateur n'a pas à leur faire confiance.
- Le coordinateur NE DOIT JAMAIS demander, recevoir ou stocker un identifiant.
- **Mode strict par fournisseur.** Le plugin embarque un profil par fournisseur d'IA, qui reflète ses conditions d'utilisation. Quand un usage n'est pas clairement permis, le mode strict le désactive par défaut (§20).
- Aucune commission NE DOIT être prélevée sur une ressource d'abonnement.

---

## 12. Ordonnancement et phéromones

À chaque demande de travail, le coordinateur choisit d'abord une branche, puis une alvéole dans cette branche.

**Le choix de la branche** utilise un échantillonnage de Thompson :

```
pour chaque branche b ouverte :
    θ_b ~ Beta(α_b, β_b)        # α : alvéoles mises en miel, β : rejets et échecs, pondérés par le coût
    score_b = θ_b × w_orientation(b) × w_pool(b) × w_miel(b) × w_ratio(ruche)
choisir la branche de score maximal
```

**Le choix de l'alvéole** se fait dans la branche retenue, parmi les alvéoles libres, en commençant par les plus profondes.

Les règles suivantes s'appliquent :

- Les phéromones (α, β) s'évaporent de 5 % par heure *(paramètre)*. Une branche qui stagne s'éteint, une branche qui progresse attire.
- **Plancher anti-famine.** Aucune branche ouverte ne reçoit moins de 5 % des attributions de sa ruche *(paramètre)*, quelles que soient l'orientation et les phéromones.
- `w_miel` vaut 1 par défaut. Il augmente quand le porteur dépense du miel pour une branche (§18.1).
- **Plafond d'orientation.** L'orientation, le pool et le miel dépensé, combinés, ne peuvent pas diriger plus de 70 % des abeilles d'une ruche vers une seule branche (§17).

---

## 13. La mémoire de ruche

- Chaque ruche a un **tableau noir** en ajout seul, organisé en trois types d'entrées : `decouverte`, `impasse` et `question`. Chaque entrée est signée et reliée à un résultat.
- Un résultat rejeté ou abandonné DEVRAIT déclarer ses impasses. Personne ne refait deux fois une piste morte.
- Les capsules (§4.3) sont compilées depuis le tableau noir. La compilation est elle-même une tâche d'IA, vérifiée en V2 par échantillonnage.
- Le tableau noir est public, sauf pour une ruche privée de l'offre Entreprise.

---

## 14. Gouvernance

### 14.1 Les rôles

| Rôle | Qui | Mandat |
|---|---|---|
| **Fondateur** | L'auteur du protocole | Permanent, avec des pouvoirs bornés |
| **Conseil** | 7 sièges : le fondateur (siège permanent) et 6 élus | 1 an |
| **Porteurs** | Les créateurs de ruches | Le temps de leur ruche |
| **Contributeurs** | Tout détenteur d'une clé ayant produit du miel | — |

### 14.2 Phase 1 : le pilote

Elle dure 12 mois après le lancement public.

- Le fondateur exerce seul les pouvoirs du conseil.
- Chaque décision est publiée au registre (§14.6), avec sa raison.
- La date de fin de la phase 1 est inscrite au registre dès le premier jour. Elle NE PEUT PAS être repoussée sans un vote des contributeurs à la majorité de 2/3 du poids électoral.

### 14.3 Phase 2 : le conseil

**L'élection.**

- Les 6 sièges élus sont renouvelés chaque année.
- Le poids de vote d'un contributeur est la racine carrée du miel qu'il a gagné sur les 12 derniers mois.
- Ce poids est plafonné à 1 % du poids total. Cela évite que les plus gros contributeurs capturent le conseil.

**Qui décide quoi.**

| Décision | Qui décide |
|---|---|
| Modifier la charte | Le fondateur **et** 5 voix sur 7 au conseil |
| Admettre une ruche (conformité) | Le conseil à la majorité simple, ou par délégation à un comité de revue |
| Modifier un paramètre (*paramètre*) | Le conseil à la majorité simple |
| Nouvelle version mineure de la spec | Le conseil à la majorité simple |
| Nouvelle version majeure de la spec | Le conseil à 5/7, plus un vote des contributeurs à la majorité simple |
| Allouer le pool fondateur | Le fondateur seul (§16) |
| Orienter une branche | Le porteur, le fondateur ou le conseil (§17) |
| Mettre une ruche en pause | Le porteur, le fondateur ou le conseil, avec publication immédiate de la raison |

### 14.4 Le veto du fondateur

- Le fondateur PEUT opposer un veto à toute décision du conseil, et à toute ruche, pour trois motifs seulement : violation de la charte, risque de sécurité, menace pour l'existence du réseau.
- Chaque veto DOIT être publié avec son motif.
- Le conseil PEUT lever un veto à 6 voix sur 7, c'est-à-dire tous les élus.

### 14.5 La charte

- La charte (§15) ne change qu'avec l'accord du fondateur **et** une majorité de 5/7 au conseil.
- Les articles 1 à 3 et l'article 9 sont **intangibles** : ils ne peuvent être que renforcés.

### 14.6 Le registre des décisions

- Toute décision de gouvernance est un objet signé `osp.decision/0.1` : auteur, type, cible, motif, date.
- Elle est ajoutée à un journal en ajout seul, dont les hashes sont chaînés comme dans un journal de transparence.
- Le registre est public, téléchargeable et vérifiable par n'importe qui.

---

## 15. Charte de la ruche — v0.1

1. **Le bien commun d'abord.** Une ruche DOIT servir un objectif légitime et bénéfique, et ne pas nuire à autrui.
2. **Pas d'armes, pas de surveillance de masse, pas de manipulation.** Aucune ruche pour concevoir des armes, surveiller ou ficher des personnes, ni manipuler des opinions ou des comportements.
3. **Les identifiants restent chez leur propriétaire.** Aucune ruche ne peut demander de transmettre un mot de passe, un jeton ou une clé.
4. **Résultats ouverts par défaut.** Les résultats sont publiés sous licence ouverte, sauf pour une ruche privée de l'offre Entreprise, déclarée comme telle.
5. **Traçabilité totale.** Chaque gramme de miel et chaque décision sont publics et vérifiables.
6. **Respect des conditions d'utilisation.** Une ruche ne doit pas pousser les contributeurs à violer les conditions de leurs fournisseurs d'IA.
7. **Pouvoir publié.** Le fondateur, le conseil et les porteurs publient leurs décisions et leurs raisons.
8. **Vie privée.** Aucune ruche ne traite de données personnelles sans base légale. Les capsules ne contiennent pas de données personnelles non nécessaires.
9. **Le Commun ne recule jamais.** La part du Commun dans les parts de puissance (§18.2) ne peut qu'augmenter. La puissance de calcul doit profiter, petit à petit, à toute l'humanité.

---

## 16. Le pool fondateur

- Chaque pledge PEUT réserver une part de sa répartition au pool fondateur. L'interface propose 8 % par défaut. Le contributeur choisit librement entre 0 et 100 %, et ce choix est toujours affiché clairement.
- Le fondateur alloue le pool à n'importe quelle ruche **active et conforme à la charte**, y compris ses propres ruches. Ses propres ruches portent alors le label « Ruche du fondateur ».
- Allouer le pool à une ruche augmente son poids `w_pool` dans l'ordonnancement (§12), dans la limite du plafond d'orientation.
- **Plafond.** Le pool ne peut pas dépasser 15 % de la capacité totale du réseau sur une semaine glissante *(paramètre)*. Au-delà, l'excédent retourne aux ruches choisies par chaque contributeur.
- **Transparence.** Un rapport mensuel public détaille les allocations du pool par ruche.

---

## 17. Orientation des branches

L'orientation est le moyen, pour un humain, de dire à l'essaim : « c'est par là ».

| Qui | Où | Multiplicateur maximal |
|---|---|---|
| Le porteur | Sa ruche | × 3 |
| Le fondateur | Toute ruche active | × 3, cumulable avec le pool |
| Le conseil | Toute ruche active | × 3 |

Les règles suivantes s'appliquent :

- Une orientation est un objet `osp.decision/0.1` de type `orientation`, publié au registre avec son motif.
- Elle **expire après 72 heures** *(paramètre)*, sauf renouvellement. Une direction se maintient activement.
- Le multiplicateur `w_orientation` d'une branche est le produit des orientations actives, plafonné à × 5.
- Le plafond de 70 % et le plancher de 5 % du §12 s'appliquent toujours.
- Un porteur PEUT refuser une orientation du fondateur sur sa ruche. Le refus est publié, et le fondateur garde alors le pool et le veto comme leviers.

---

## 18. Économie : le miel, les parts, les caravelles

L'économie a trois étages, du plus liquide au plus permanent.

| | Miel | Parts de puissance | Le Commun |
|---|---|---|---|
| **Nature** | Monnaie de travail | Droit permanent sur la flotte | Parts détenues par tous |
| **Comment on l'obtient** | Par du travail vérifié | Le miel cristallise en parts | 30 % de chaque émission de parts |
| **Se dépense ?** | Oui, et il est alors brûlé | Non, il se garde à vie | Non |
| **Ce que ça donne** | De la priorité et des heures de calcul | Une fraction de la capacité des caravelles, chaque mois | Une allocation de calcul pour chaque humain inscrit |

### 18.1 Le miel, monnaie de travail

**Principe : une preuve de travail utile.** Chaque gramme émis correspond à du travail vérifié. Le Bitcoin dépense de l'énergie sur des calculs qui ne servent qu'à sécuriser son registre. Le miel, lui, n'existe que si l'essaim a produit quelque chose de vrai.

**Émission.** Le miel NE PEUT être émis que selon le §10.1. Il n'y a pas de pré-minage, pas de réserve cachée et pas d'émission discrétionnaire, pour personne.

**Dépense.** Le miel dépensé est brûlé. Il sert à deux choses :

1. obtenir de la priorité dans l'essaim pour ses propres ruches ou branches, via un multiplicateur `w_miel` dans l'ordonnancement (§12), sous le même plafond de 70 % ;
2. acheter des heures de calcul sur les caravelles (§18.3), au tarif public exprimé en grammes par unité de travail.

**Limite.** Le miel n'achète jamais le quota d'abonnement d'un contributeur en particulier. L'essaim reste volontaire : dépenser du miel déplace la priorité, sans réquisitionner personne.

**Indexation.** Le tarif est exprimé en **unités de travail** de référence (UT), c'est-à-dire un lot étalon de tâches V0, et non en euros. Au lancement, 1 g vaut 1 UT *(paramètre)*.

**Phases.**

| Phase | Forme | Échange contre de l'argent | Condition pour y passer |
|---|---|---|---|
| **1. Lancement** | Soldes inscrits dans le registre signé | Interdit | — |
| **2. Ancrage** | Le hash du registre est publié sur une blockchain publique. Les soldes deviennent vérifiables par tous, sous forme de jetons non transférables. | Interdit | Décision du conseil |
| **3. Option** | Jeton transférable émis par la fondation | Possible | Conformité au règlement MiCA (livre blanc, prestataire agréé), 5 voix sur 7 au conseil, vote des contributeurs. Et seulement si le calcul racheté vient des caravelles et d'API payées, jamais des abonnements. |

Pourquoi avancer par phases ? Un jeton échangeable dès le départ aurait trois effets : il attirerait la spéculation avant la recherche, il ferait entrer le projet dans le champ du règlement européen MiCA, et il transformerait indirectement le quota d'abonnement des contributeurs en argent, ce qui viole les conditions des fournisseurs.

### 18.2 Les parts de puissance

Une part de puissance est un droit **permanent** sur une fraction de la capacité de la flotte. C'est l'équivalent d'une action, payée en puissance de calcul plutôt qu'en argent.

**La cristallisation.**

- À chaque gain de miel, 10 % cristallisent immédiatement en parts, à raison d'une part par gramme *(paramètres)*. Les 90 % restants restent du miel dépensable.
- Le miel qui dort cristallise aussi : chaque année, 10 % du solde non dépensé se change en parts *(paramètre)*. Le miel qu'on garde ne se perd pas, il devient permanent.

**Le Commun.**

- Pour chaque part émise au profit d'un contributeur, 3/7 de part sont émises au profit du Commun. Le Commun détient ainsi en permanence 30 % de toutes les parts.
- Cette proportion ne peut qu'augmenter (charte, article 9).
- La capacité du Commun est répartie à parts égales entre tous les humains inscrits. C'est une **allocation cognitive universelle**, qui grandit avec la flotte.
- Cette répartition exige une preuve de personne unique (prévue en v0.2). D'ici là, la capacité du Commun va aux ruches d'intérêt public choisies par le conseil.

**L'allocation fondateur.**

- Le fondateur reçoit 2 % des parts émises pendant les 4 premières années.
- Ces 2 % sont prélevés sur la part des contributeurs, jamais sur celle du Commun.
- Le taux est fixé à la création, ne peut pas être modifié rétroactivement et est inscrit au registre.
- Ces parts obéissent aux mêmes règles que toutes les autres.

**Les droits d'une part.**

- Une fraction de la capacité mensuelle de la flotte, proportionnelle au nombre de parts, utilisable par ses agents et ses ruches.
- La capacité non utilisée dans le mois retourne au Commun : rien ne se perd.
- Une voix à l'**Assemblée des parts**, qui élit une partie du conseil d'administration de la fondation (§18.3).

**Les limites.**

- Une part NE DOIT PAS être vendue, louée ni transférée.
- Elle ne verse aucun dividende en argent.
- Ces deux règles la rapprochent d'un droit d'usage plutôt que d'un instrument financier. Sa qualification juridique reste à valider (§22).

**La répartition de la capacité d'une caravelle.**

| Destinataire | Part de la capacité |
|---|---|
| Communauté hôte | `h`, fixée à l'installation : au moins 10 %, et 50 % ou plus pour une caravelle cofinancée |
| Détenteurs de parts, dont le Commun | 75 % du reste |
| Ruches du réseau, via l'ordonnancement (§12) | 25 % du reste |

Les pourcentages sont des *(paramètres)*.

### 18.3 La Fondation et les caravelles

**Mission.** Mettre de la puissance de calcul décentralisée partout où les gens le souhaitent, et acheter, installer et entretenir des infrastructures souveraines pour le monde entier.

**Les caravelles.** Une caravelle est un nœud de calcul physique : serveurs GPU, modèles ouverts, stockage. Elle appartient à la fondation, ou est copossédée avec une communauté hôte (école, bibliothèque, université, ville, coopérative, pays). Elle rejoint la flotte via OSP.

**Les règles de souveraineté.**

- La communauté hôte fixe sa part réservée `h` à l'installation.
- Les données locales restent locales.
- La communauté peut déconnecter sa caravelle du réseau à tout moment.
- Une caravelle ne fait tourner que des logiciels libres et des modèles ouverts, sans dépendance à un fournisseur unique.

**Les terres et les sites.** La fondation PEUT acquérir des terrains et des bâtiments pour y installer des caravelles : énergie, refroidissement, connectivité. Ces sites sont détenus pour la mission, ne peuvent pas être revendus pour un profit privé, et sont inscrits au registre.

**L'accès direct.** Chaque humain inscrit accède à sa part du Commun directement : sans intermédiaire commercial et sans filtrage arbitraire. Les seules limites sont la loi et la charte (§15), et chacune d'elles est publiée.

**Les équipages.** Ce sont des opérateurs locaux. La fondation les rémunère en euros, et ils gagnent aussi du miel.

**Les laboratoires et les ateliers de la Fondation.** Le calcul n'est qu'une première étape. La fondation PEUT aussi créer des infrastructures physiques.

- **Des laboratoires régulés**, financés par des dons, des États ou d'autres fondations : laboratoires humides (biologie, chimie) et laboratoires de physique et de matériaux. Ils font tourner les expériences proposées par la communauté et conçues avec l'essaim.
- Ces laboratoires sont **supervisés par de vrais scientifiques et par les autorités compétentes**, avec des comités d'éthique et des règles strictes de biosécurité. Aucune expérience ne démarre sans leur accord, et la charte s'applique (article 2 : ni armes, ni recherche à double usage dangereuse).
- **Des ateliers et des usines à prix coûtant** fabriquent du matériel conçu par la communauté, avec l'aide des IA et des robots de l'essaim. Ils le vendent à prix coûtant, pour augmenter le pouvoir d'achat de tous.
- Les résultats et les plans sont ouverts par défaut (article 4), sauf quand la sécurité exige le contraire. Ce cas est alors publié et motivé.

**Le financement.**

- Dons, mécénat et subventions publiques.
- Cofinancement par les communautés hôtes.
- Au moins 50 % des commissions de la SAS *(paramètre)*.
- Le miel brûlé ne rapporte pas d'argent : la fondation ne vend pas son calcul contre du miel, elle le distribue.

**La gouvernance.**

- Le conseil d'administration de la fondation réunit : le fondateur (siège permanent), des représentants élus du conseil OSP, des représentants élus de l'Assemblée des parts, et des représentants des communautés hôtes.
- Les comptes sont audités et un rapport public est publié chaque année.

**La forme juridique.** En France, la voie la plus simple est de démarrer en **fonds de dotation** : il se crée par simple déclaration en préfecture, avec une dotation initiale minimale de l'ordre de 15 000 € (à vérifier). Il pourra évoluer vers une fondation reconnue d'utilité publique quand sa dotation le permettra. Des entités sœurs à l'étranger viendront plus tard.

### 18.4 La croissance : parrainage, communautés, pionniers, boîte à problèmes

Le réseau doit se répandre comme une traînée de poudre, sans jamais devenir une pyramide. Quatre mécanismes y contribuent.

**Le parrainage.**

- Chaque contributeur a un lien de parrainage.
- Pendant les 12 mois qui suivent l'arrivée d'un filleul, le parrain reçoit un bonus égal à 5 % du miel que ce filleul gagne *(paramètres)*.
- Ce bonus est **émis en plus** : il n'est jamais prélevé sur le filleul.
- Le parrainage est à **un seul niveau**. Le parrain d'un parrain ne reçoit rien. Ce choix est **intangible** : un système à plusieurs niveaux serait une vente pyramidale, interdite en droit français.
- Comme le bonus ne naît que de miel *vérifié*, de faux filleuls ne rapportent rien.

**Les codes de communauté.**

- Une communauté (association, école, ville, entreprise, serveur Discord…) crée un **essaim communautaire**, avec son propre code. Les membres le rejoignent avec ce code.
- Une communauté PEUT proposer ses ruches en voie rapide, et ses membres PEUVENT les orienter (§17), dans les mêmes limites que les porteurs.
- **Le Commun local** : chaque membre PEUT reverser, en opt-in, une part de ses parts nouvellement cristallisées (5 % suggérés) à des parts collectives de sa communauté. Ces parts financent ses propres projets. C'est la subsidiarité appliquée.

**Les pionniers.**

- Les parts cristallisées pendant les 6 premiers mois après le lancement public sont multipliées par 2 *(paramètre)*.
- Le multiplicateur décroît ensuite de façon linéaire jusqu'à 1 au 24e mois.
- Le Commun reçoit toujours ses 3/7 sur les parts *après* multiplication : sa part de 30 % ne baisse jamais (charte, article 9).
- C'est la gratitude du réseau envers ceux qui s'engagent dès maintenant, inscrite dans la règle dès le premier jour.

**La boîte à problèmes.**

- Toute personne inscrite PEUT soumettre gratuitement un problème qu'elle voudrait voir l'essaim résoudre.
- Les contributeurs le soutiennent avec leurs soutiens (§10.1).
- Chaque mois, les problèmes les plus soutenus et conformes à la charte deviennent des ruches, financées par la capacité du Commun.
- Ainsi, n'importe qui, même sans calcul à donner, peut mettre le monde au travail sur ce qui compte pour lui.

### 18.5 Revenus *(informatif)*

| Source | Mécanisme | Statut v0.1 |
|---|---|---|
| Dons et primes | Commission de 5 à 8 % sur les flux monétaires vers les ruches | Prévue |
| Kickswarm Entreprise | Ruches privées où une entreprise coordonne **ses propres** licences d'IA | Prévue |
| Abonnements des contributeurs | **Aucune commission, jamais** | Interdit par §11.2 |
| Reversement à la fondation | Au moins 50 % des commissions | Prévu |

### 18.6 Structure *(informatif)*

- **La Fondation**, à but non lucratif, détient la spec, la marque, le registre, la flotte et le Commun.
- **La SAS Kickswarm** opère le coordinateur et l'offre Entreprise sous licence de la fondation, et lui reverse au moins 50 % de ses commissions. Le fondateur peut y être salarié et actionnaire. C'est là que se trouve son intérêt financier, séparé de la mission.
- Ce montage est à valider avec un juriste.

---

## 19. Sécurité et abus

Les calculs de probabilité et les défenses contre l'injection sont détaillés dans [docs/securite.md](../docs/securite.md).

| Menace | Défense |
|---|---|
| **Sybil** (faux comptes en masse) | Réputation de départ basse, V0 seulement pour les nouveaux, poids de vote en racine carrée et plafonné. Preuve de personne unique envisagée en v0.2. |
| **Collusion** | Tirage au sort vérifiable, diversité des modèles, pièges, audit aléatoire. |
| **Injection de prompt** dans les capsules | Capsules signées, traitées comme des données, sandbox sans accès personnel, liste blanche réseau. |
| **Exfiltration** depuis la machine du contributeur | La sandbox n'a pas accès aux fichiers personnels. Le transcript ne sort que sur demande d'un jury. |
| **Ruche malveillante** | Revue de conformité avant activation, pause d'urgence, veto, signalement par les contributeurs. |
| **Coordinateur compromis** | Registre chaîné et vérifiable par tous, signatures de bout en bout, fédération en v0.3. |
| **Résultat dangereux** (par exemple une faille découverte) | Divulgation responsable obligatoire, avec embargo géré par le porteur. |
| **Accaparement** du miel ou des parts | Le miel n'est émis que par du travail vérifié, il est brûlé à la dépense et non échangeable en phases 1 et 2. Les parts sont non transférables, le Commun garde au moins 30 % et le poids de vote est en racine carrée et plafonné. |
| **Faux humains** pour capter l'allocation du Commun | Pas d'allocation individuelle sans preuve de personne unique (v0.2). |

---

## 20. Conformité aux conditions des fournisseurs

- Le plugin maintient un profil par fournisseur d'IA. Ce profil liste les modes de contribution autorisés par défaut.
- **Par défaut, le mode strict n'autorise que :**
  - les modèles locaux ;
  - les clés API du contributeur (BYOK) ;
  - l'usage de l'agent du contributeur, par lui, sur son compte, pour des ruches d'intérêt public, sans revente.
- Tout mode supplémentaire (par exemple le quota inutilisé en mode daemon) est activé fournisseur par fournisseur, après lecture de ses conditions. Le contributeur en est informé.
- Kickswarm DEVRAIT chercher des partenariats officiels avec les fournisseurs.

---

## 21. Interfaces

### 21.1 Outils MCP exposés par le plugin

| Outil | Rôle |
|---|---|
| `swarm_join(ruche, pledge?)` | Rejoindre une ruche, éventuellement avec un pledge |
| `swarm_next()` | Recevoir la prochaine alvéole signée, avec sa caste |
| `swarm_submit(resultat)` | Soumettre un résultat ou un verdict signé |
| `swarm_status()` | Voir ses abeilles, son quota restant, son miel, sa réputation |
| `swarm_leave()` | Rappeler ses abeilles |
| `hive_board(ruche, requete)` | Lire le tableau noir |

### 21.2 API HTTP du coordinateur (v0.1)

```
POST /v0/hives                     proposer une ruche
GET  /v0/hives/{slug}              état de la ruche et du rayon
POST /v0/work/claim                demander une alvéole (signé)
POST /v0/work/submit               soumettre un résultat ou un verdict (signé)
GET  /v0/board/{slug}              tableau noir
GET  /v0/registry?since=…          registre public (décisions et miel)
POST /v0/decisions                 publier une décision de gouvernance (signée)
```

Toute requête qui modifie l'état DOIT être signée par la clé du contributeur.

---

## 22. Hors périmètre de v0.1 et questions ouvertes

**Hors périmètre :**

- la fédération de coordinateurs ;
- la preuve de personne unique ;
- l'entraînement distribué de modèles ;
- les paiements entre contributeurs.

**Questions ouvertes :**

1. Comment estimer le coût d'une alvéole avant de l'exécuter, de façon fiable ?
2. Faut-il un taux de pièges variable selon la réputation de la gardienne ?
3. Quelle grille de notation commune pour les découpages (§6.2) ?
4. Comment gérer les ruches dont les résultats ont une valeur commerciale (licences, brevets) ?
5. Quel partenariat proposer aux fournisseurs d'IA pour le quota inutilisé ?
6. Quelle est la qualification juridique exacte du miel et des parts de puissance au regard de MiCA et du droit financier français ? Il faut un avis d'avocat avant le lancement.
7. Les parts de puissance se transmettent-elles par succession ?
8. Quel taux de cristallisation garde le miel assez liquide tout en faisant grandir les parts ?
9. Comment fixer le tarif en UT des heures de caravelle quand le matériel évolue ?

---

## 23. Feuille de route de la spec

| Version | Contenu |
|---|---|
| **v0.1** (ce document) | Objets, cycle de vie, castes, cinq verrous, miel et parts, gouvernance, charte, pool, orientation, fondation et caravelles |
| **v0.2** | Retours de la première ruche phare, grille de découpage, preuve de personne unique (qui ouvre l'allocation du Commun), estimation des coûts, ancrage du registre sur une blockchain publique (phase 2 du miel) |
| **v0.3** | Fédération de coordinateurs, registre répliqué, première caravelle |
| **v1.0** | Spec stable, après 6 mois de production et un vote du conseil |
