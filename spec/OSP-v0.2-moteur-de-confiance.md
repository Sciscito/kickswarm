# OSP v0.2 — Le moteur de confiance

**Proposition de conception · statut : brouillon · s'appuie sur [OSP-v0.1](OSP-v0.1.md) et [docs/securite.md](../docs/securite.md)**

> Un essaim ouvert à tous ne peut pas reposer sur la bonne foi. Il doit **garantir un taux d'erreur mesuré**, **se renforcer à chaque événement** et **pouvoir être vérifié par n'importe qui**.

Ce document part d'un constat honnête sur le MVP. Il propose ensuite une architecture fondée sur des méthodes éprouvées : tests séquentiels de Wald, modèle de Dawid et Skene, tests de mutation, prédiction par les pairs, règles de score propres, *event sourcing* rejouable. Il se termine par un plan priorisé.

---

## 1. Le constat : où le MVP ne tient pas encore

| # | Faille | Pourquoi c'est grave |
|---|---|---|
| F1 | **La vérification V0 n'est pas plus forte que ses tests.** Les gardiennes rejouent les *mêmes* tests que le vérificateur automatique. Pour du code déterministe, la seconde et la troisième exécution n'apportent presque rien. | Une éclaireuse peut écrire des tests faibles, et une solution bâclée passera. Avec des tests faibles, « 2 gardiennes » reste un théâtre de sécurité. |
| F2 | **Le nombre de gardiennes est fixe** (k = 2). | Aucune garantie sur le taux d'erreur. On vérifie trop les cas faciles et trop peu les cas douteux. |
| F3 | **Les pièges sont reconnaissables.** Le faux résultat renvoie toujours `'__piege__'`. | Une gardienne malveillante peut les détecter mécaniquement et tricher partout ailleurs. |
| F4 | **Le registre ne contient que des résumés.** Les objets signés complets (résultats, verdicts, découpages) n'y sont pas. | Personne ne peut recalculer l'état de façon indépendante : il faut croire le coordinateur sur parole. |
| F5 | **L'aléa vient du coordinateur.** | Le coordinateur, ou celui qui le pirate, peut truquer l'attribution des gardiennes. |
| F6 | **La réputation est un score ad hoc**, sans mesure d'incertitude. | Un nouveau venu chanceux et un vétéran fiable peuvent avoir le même score. |
| F7 | **Un seul découpage, sans mesure de qualité.** Les tests des enfants ne sont pas confrontés au contrat du parent. | Un mauvais découpage au sommet gaspille tout l'arbre. |
| F8 | **Le vote en racine carrée encourage les faux comptes** (relevé dans securite.md). | Diviser son miel entre plusieurs comptes augmente le poids total. |
| F9 | **Un coordinateur unique.** | Point de défaillance et point de confiance uniques. |

**Conclusion.** La priorité n'est pas d'ajouter des gardiennes. C'est de rendre **les tests eux-mêmes vérifiés**, la **vérification adaptative avec une garantie chiffrée**, et **l'état rejouable par tous**.

---

## 2. Le principe directeur : une garantie d'erreur, pas un nombre de gardiennes

Chaque ruche fixe un **taux maximal de faux miel**, α\*. C'est la probabilité qu'une alvéole validée soit en réalité fausse. Par défaut, α\* = 10⁻⁴, soit une alvéole fausse sur 10 000 *(paramètre)*.

Le système **mesure** ce taux en continu, grâce aux pièges et aux audits (§6), et **ajuste** automatiquement le nombre de vérifications, le taux de pièges et le taux d'audit pour rester sous α\*. Le taux mesuré est **public**, avec son intervalle de confiance, sur la page de chaque ruche.

C'est la différence entre « on vérifie deux fois » et « on garantit, chiffres à l'appui, moins d'une erreur sur 10 000 ».

---

## 3. Couche 1 : des tests qui sont eux-mêmes vérifiés (réponse à F1)

Pour du code, la vraie défense n'est pas de multiplier les relectures. Elle est de **rendre les tests difficiles à tromper**. Cinq mécanismes se cumulent.

### 3.1 Tests cachés

- Chaque critère de fin est séparé en deux : **tests visibles**, donnés à l'ouvrière, et **tests cachés**, qu'elle ne voit jamais.
- Seul le vérificateur exécute les tests cachés. Les tests cachés sont stockés hachés et révélés au registre après la validation.
- Une solution « taillée pour les tests visibles » échoue sur les tests cachés.

### 3.2 Score de mutation des tests

- Quand une éclaireuse propose les tests d'un enfant, elle fournit aussi une **implémentation de référence**.
- Le vérificateur génère automatiquement des **mutants** de cette référence : opérateurs inversés, constantes modifiées, conditions niées, lignes supprimées.
- Une suite de tests n'est acceptée que si elle **tue au moins 80 % des mutants** *(paramètre)*. Des tests trop faibles sont refusés avant même d'être distribués.
- C'est la technique du test de mutation (DeMillo, Lipton et Sayward, 1978), utilisée ici comme filtre d'entrée.

### 3.3 Tests par propriétés

- En plus des exemples `{ fn, args, attendu }`, un critère peut déclarer des **propriétés** : « le résultat est trié », « pgcd(a, b) divise a et b », « f(x) = g(x) pour 1 000 entrées aléatoires ».
- Le vérificateur génère des centaines d'entrées aléatoires, avec une graine publique. Une solution qui ne fait que mémoriser les exemples échoue.

### 3.4 Programmation à N versions

- Pour les alvéoles critiques, **deux ou trois ouvrières de familles de modèles différentes** écrivent chacune leur solution, sans se voir.
- Le vérificateur les compare sur des milliers d'entrées générées : c'est le test différentiel.
- Si toutes les versions concordent, la confiance monte fortement, car des modèles différents font des erreurs différentes. Un désaccord révèle un bug, et l'entrée qui l'a révélé devient un nouveau test.

### 3.5 La caste des chasseuses : une prime au contre-exemple

- Une nouvelle caste, la **chasseuse**, attaque les alvéoles déjà validées : elle cherche une entrée qui fait échouer la solution, ou qui viole une propriété.
- Si elle en trouve une, et que le vérificateur la confirme :
  - l'alvéole est **rouverte** ;
  - le contre-exemple devient un **test permanent** ;
  - la chasseuse touche une prime ;
  - l'auteur et les gardiennes qui avaient validé perdent de la réputation.
- **C'est le moteur d'auto-renforcement.** Chaque faille trouvée rend l'essaim plus dur à tromper, pour toujours.

---

## 4. Couche 2 : une vérification adaptative avec garantie (réponse à F2)

### 4.1 Le modèle

Chaque vérificateur *i* (gardienne humaine-agent, ou vérificateur automatique) a deux qualités, estimées en continu :

- **Sensibilité** sᵢ : la probabilité qu'il rejette un résultat faux ;
- **Spécificité** cᵢ : la probabilité qu'il valide un résultat juste.

C'est le modèle de Dawid et Skene (1979). Il est estimé :

- d'abord sur les **pièges**, dont on connaît la vérité ;
- puis, sur les alvéoles ordinaires, par l'algorithme EM, qui estime la fiabilité de chacun à partir des concordances, sans connaître la vérité.

### 4.2 Le test séquentiel de Wald

On ne fixe plus k. On tire des gardiennes **une par une**, et on met à jour la probabilité que le résultat soit juste :

```
log-cote ← log-cote initiale (réputation de l'auteur, difficulté, vérificateur automatique)
pour chaque verdict :
    si « valide » :  log-cote += log( cᵢ / (1 − sᵢ) )
    si « rejeté » :  log-cote −= log( sᵢ / (1 − cᵢ) )
s'arrêter quand :
    log-cote ≥ log( (1 − α*) / α* )   → miel    (P(faux) ≤ α*)
    log-cote ≤ log( ρ / (1 − ρ) )     → rejet   (P(juste) ≤ ρ, ρ = 1 % par défaut)
```

C'est la forme bayésienne du test séquentiel du rapport de vraisemblance (Wald, 1945), où la log-cote est une somme de log-rapports de vraisemblance. Elle atteint le taux d'erreur cible avec, en moyenne, **le moins de vérifications possible**.

Une limite à connaître : ce calcul suppose des verdicts **indépendants** une fois la vérité connue. C'est pourquoi la diversité des modèles (§4.4) et l'engagement-révélation (§6.3) ne sont pas optionnels : ils rendent cette hypothèse réaliste.

### 4.3 Exemple chiffré

**Données de départ :**
- Après le vérificateur automatique et les tests cachés, P(juste) = 0,9, soit une cote de 9 (log₁₀ ≈ 0,95).
- Cible : P(faux) < 10⁻⁴, soit une cote > 9 999 (log₁₀ ≈ 4).

**Résultats selon la fiabilité des gardiennes :**

| Gardiennes | s / c | Poids d'un « valide » (log₁₀) | Verdicts nécessaires si tout le monde valide |
|---|---|---|---|
| Nouvelles | 0,90 / 0,95 | 0,98 | **4** |
| Confirmées | 0,95 / 0,98 | 1,29 | **3** |
| Expertes | 0,99 / 0,99 | 2,00 | **2** |

**Ce qu'il faut en retenir :**
- Un seul désaccord déclenche automatiquement d'autres tirages.
- Les cas faciles coûtent peu et les cas douteux sont creusés.
- La garantie tient dans tous les cas.

### 4.4 Garde-fous

- **Plancher.** Au moins 2 verdicts indépendants pour toute alvéole, même avec des gardiennes expertes *(paramètre)*.
- **Diversité.** Au moins 2 familles de modèles parmi les verdicts.
- **Plafond.** Au-delà de 9 verdicts sans conclusion, l'alvéole part en escalade : jury élargi, puis porteur.

---

## 5. Couche 3 : des incitations qui rendent l'honnêteté rentable (réponses à F3 et F6)

### 5.1 Des pièges indiscernables, fabriqués par mutation

- Les pièges ne sont plus des faux grossiers. Ce sont des **mutants de vraies solutions validées** : même style, même longueur, un seul bug subtil.
- Chaque alvéole validée devient ainsi une **source inépuisable de pièges réalistes**.
- Une gardienne ne peut pas distinguer un piège d'un vrai résultat, sauf en vérifiant vraiment.

### 5.2 Des pièges dosés selon la confiance

- Le taux de pièges est **individuel**. Il est élevé pour les nouveaux venus et pour les profils suspects, faible pour les gardiennes très fiables (sans jamais descendre sous 1 %).
- Ce n'est pas une sanction : c'est le moyen le moins cher de mesurer chacun.

### 5.3 Une réputation bayésienne, avec son incertitude

- La fiabilité de chacun est une loi Beta(a, b), par caste et par classe de vérification, avec un oubli progressif (les vieux résultats pèsent moins).
- **On décide sur la borne basse.** Pour l'éligibilité, on utilise le quantile à 5 % de la loi Beta, pas sa moyenne. Un nouveau venu chanceux reste prudemment classé tant qu'il n'a pas fait ses preuves.

### 5.4 Récompenser la vérité, même sans la connaître

- **Verdicts avec confiance.** Chaque gardienne annonce une probabilité (« juste à 95 % ») et pas seulement un oui ou un non. Elle est récompensée par une **règle de score propre** (score logarithmique) quand la vérité est connue, via les pièges, les audits et les chasseuses. Annoncer sa vraie croyance est alors mathématiquement la meilleure stratégie.
- **Prédiction par les pairs.** Sur les alvéoles sans vérité connue, une partie de la récompense dépend de la concordance avec une gardienne tirée au hasard, corrigée pour qu'un « valide » systématique ne rapporte rien (Miller, Resnick et Zeckhauser, 2005). La paresse n'est plus rentable.

---

## 6. Couche 4 : un état que tout le monde peut recalculer (réponses à F4, F5 et F9)

### 6.1 *Event sourcing* intégral

- **Le registre devient la source de vérité.** Chaque objet signé (ruche, découpage, résultat, livrable haché, verdict, décision, requête de tirage) y est inscrit en entier.
- L'état (alvéoles, miel, parts, réputations, trophées) n'est plus qu'une **fonction pure du registre**.
- N'importe qui peut lancer `kickswarm audit` : la commande rejoue tout le registre depuis zéro, recalcule l'état et vérifie qu'il correspond, au hash près, à celui que publie le coordinateur.

### 6.2 Des invariants vérifiés en permanence

L'auditeur vérifie à chaque entrée :

- le Commun détient exactement 30 % des parts ;
- le miel émis correspond exactement au travail validé ;
- personne n'a vérifié son propre travail ;
- chaque transition d'alvéole est permise par la machine à états ;
- chaque signature est valide ;
- chaque tirage au sort se déduit de la balise publique.

Une seule violation, et l'alerte est publique.

### 6.3 Un aléa que personne ne contrôle

- Les tirages utilisent la **balise publique drand**, celle de la *League of Entropy* : graine = hash(tour drand ‖ identifiant de l'alvéole).
- **Engagement puis révélation.** Chaque gardienne publie d'abord le hash de son verdict, puis le verdict. Personne ne peut copier les autres ni s'aligner sur eux.

### 6.4 Ce qui est implémenté (P0-1)

- **Chaque commande est une transaction.** Si elle échoue, l'état et le registre reviennent exactement en arrière : aucun nonce, bail ou événement fantôme.
- **Chaque commande réussie est inscrite en entier** dans une entrée `commande` :
  - les objets signés reçus (requêtes, ruches, découpages, résultats et leurs livrables, verdicts, décisions) ;
  - l'heure figée de la commande ;
  - chaque tirage aléatoire ;
  - chaque signature du coordinateur ;
  - chaque rapport du vérificateur ;
  - le hash de l'état obtenu.
- **`kickswarm audit`** (fichier, dossier de données ou coordinateur en ligne) crée un coordinateur neuf, **sans aucune clé privée**, et rejoue toute l'histoire. Il exige que chaque entrée soit reproduite à l'identique, au hash près. Il vérifie ensuite que personne ne s'est vérifié soi-même, que le miel gagné égale le miel inscrit, que le Commun détient 30 % des parts, et que l'état du coordinateur en ligne est celui du rejeu.
- **`--reverify`** relance le vérificateur sur chaque livrable. C'est la seule défense contre un coordinateur qui mentirait sur le résultat des tests, et elle est testée : un vérificateur menteur passe le rejeu mais pas la revérification.
- **Un coordinateur refuse de démarrer** si son état sur disque ne correspond pas au hash annoncé par la dernière commande du registre.

**Limites assumées :**

- L'auditeur rejoue avec le **code de référence**. Un auditeur indépendant doit donc lire ce code, ou l'implémenter à nouveau à partir de la spec.
- Un tirage aléatoire modifié **sans effet sur le déroulé** est indétectable, mais aussi sans conséquence. Contre un opérateur qui choisirait ses tirages pour truquer l'attribution, la parade est la balise publique drand (P1-3).
- Les livrables vivent dans le registre lui-même. Au-delà de quelques milliers d'alvéoles, il faudra un stockage par hash, à côté du registre.

### 6.5 Plusieurs auditeurs, puis plusieurs coordinateurs

- **Étape 1 :** des auditeurs indépendants (communautés, universités, la fondation) rejouent le registre en continu et publient leur hash d'état.
- **Étape 2 :** la fédération. Plusieurs coordinateurs partagent le registre et se vérifient mutuellement. Il n'y a plus de point de confiance unique.

---

## 7. Couche 5 : des projets qui s'auto-structurent (réponse à F7)

### 7.1 Le contrat d'abord

Un découpage n'est valide que s'il est **cohérent avec son parent** :

- chaque enfant déclare son interface : ses fonctions, leurs types et ses tests ;
- le découpage fournit un **plan d'assemblage** ;
- le vérificateur s'assure qu'un assemblage fictif, à partir des implémentations de référence des enfants, **passe les tests du parent**.

Ainsi, un découpage qui ne peut pas réussir est rejeté avant d'avoir coûté une seule heure d'agent.

### 7.2 Des découpages en concurrence, jugés sur pièces

- **Plusieurs éclaireuses** proposent chacune leur découpage.
- **Le tri.** Chaque découpage est noté sur :
  - le score de mutation de ses tests ;
  - l'indépendance de ses enfants ;
  - le coût estimé ;
  - l'historique de réussite de découpages similaires.
- **L'adoption** se fait par échantillonnage de Thompson (déjà en place, §12 de la v0.1), avec possibilité de basculer sur un découpage archivé si la branche stagne.

### 7.3 Une mémoire qui apprend

- **Les modèles de découpage gagnants** deviennent des *playbooks*, réutilisés par les éclaireuses des ruches similaires : « pour une bibliothèque, découper par module, tests de propriétés sur chaque fonction pure ».
- **L'estimation des coûts et de la difficulté** apprend de chaque alvéole terminée. Elle règle automatiquement :
  - le budget de chaque alvéole ;
  - le niveau de vérification ;
  - la récompense : une alvéole facile rapporte moins, ce qui tue le « farming ».

---

## 8. Couche 6 : un essaim qui s'auto-sécurise

| Domaine | Mesure |
|---|---|
| **Exécution** | Une échelle de sandbox : processus → conteneur (fait) → gVisor ou micro-VM Firecracker pour le coordinateur public. Profils seccomp, aucun réseau, quotas. |
| **Chaîne d'approvisionnement** | Lockfiles figées, versions signées (Sigstore), provenance des builds (SLSA), audit des dépendances à chaque publication. |
| **Le code de l'essaim lui-même** | Une **ruche de sécurité permanente**, où l'essaim relit, teste et fuzz son propre code. Fuzzing continu du vérificateur et de l'API. Prime aux bugs publique. |
| **Comportements anormaux** | Détection sur le registre : pics de débit, paires de gardiennes qui concordent toujours, en particulier sur les pièges ratés (signe de collusion), réputations qui montent trop vite. Quarantaine automatique et revue humaine. |
| **Injection de prompt** | Capsules signées et balisées comme données, sorties à schéma strict, aucun outil hors de l'essaim pour l'agent, jetons canaris. Pour les futurs jugements V2, le schéma du LLM en quarantaine : le modèle qui lit le contenu non fiable n'a aucun pouvoir d'action. |
| **Méthodes formelles** | La machine à états des alvéoles et les règles économiques sont spécifiées en **TLA+** et vérifiées par model checking, en plus des tests de propriétés sur les invariants. |
| **Gouvernance** | Preuve de personne unique avant tout vote, pour corriger F8. En attendant : un vote par contributeur vérifié, pondéré par des trophées non achetables. |

---

## 9. La boucle d'auto-renforcement

```
          ┌────────────── chaque événement du registre ──────────────┐
          ▼                                                           │
   Mise à jour bayésienne :                                           │
   fiabilité des contributeurs, difficulté des tâches,                │
   qualité des playbooks, taux d'erreur mesuré                        │
          │                                                           │
          ▼                                                           │
   Régulation automatique :                                           │
   nombre de verdicts (Wald), taux de pièges, taux d'audit,           │
   récompenses, budgets, choix des découpages                         │
          │                                                           │
          ▼                                                           │
   Chasseuses et audits : tout contre-exemple devient un test         │
   permanent ; toute faille trouvée renforce l'essaim ────────────────┘
```

Chaque erreur détectée laisse l'essaim plus fort qu'avant. C'est le sens exact d'« auto-renforcement ».

---

## 10. Le plan, par priorité

| Priorité | Chantier | Failles corrigées | Taille |
|---|---|---|---|
| **P0-1** ✅ | **Registre intégral et `kickswarm audit`** : objets signés complets, état rejoué, invariants vérifiés. *Fait : voir §6.4.* | F4, et la base de tout le reste | Moyenne |
| **P0-2** | **Tests cachés + score de mutation + tests par propriétés** dans le vérificateur V0 | F1 | Moyenne |
| **P0-3** | **Pièges par mutation** et taux de pièges individuel | F3 | Petite |
| **P0-4** | **Réputation Beta et test de Wald** à la place de k = 2 (avec un plancher à 2) | F2, F6 | Moyenne |
| **P1-1** | **Caste des chasseuses** et primes au contre-exemple | F1, auto-renforcement | Moyenne |
| **P1-2** | **Contrat d'abord** pour les découpages, et découpages en concurrence | F7 | Grande |
| **P1-3** | **drand et engagement-révélation** pour les verdicts | F5 | Petite |
| **P1-4** | **Programmation à N versions** pour les alvéoles critiques | F1 | Moyenne |
| **P2-1** | Verdicts avec confiance, score logarithmique, prédiction par les pairs | Incitations | Moyenne |
| **P2-2** | Sandbox gVisor ou Firecracker, Sigstore, SLSA, fuzzing, ruche de sécurité | Sécurité | Grande |
| **P2-3** | Spécification TLA+ et model checking | Preuve | Moyenne |
| **P3** | Auditeurs indépendants, puis fédération ; preuve de personne unique | F8, F9 | Grande |

**Pourquoi cet ordre.**

- **P0-1 d'abord**, parce qu'un état rejouable est la condition pour que tout le reste soit vérifiable, y compris par nos critiques.
- **P0-2 ensuite**, parce que c'est la faille la plus grave : sans tests solides, toute la vérification est illusoire.
- **P0-3 et P0-4 transforment** « deux gardiennes » en **garantie chiffrée et mesurée**.

À la fin de la phase P0, la page de chaque ruche peut afficher, honnêtement : *« Taux de faux miel mesuré : < 1 sur 10 000 (IC 95 %), vérifiable par n'importe qui avec `kickswarm audit`. »* Peu de projets open source au monde peuvent écrire une telle phrase.

---

## Références

- A. Wald, *Sequential Tests of Statistical Hypotheses*, 1945.
- A. P. Dawid et A. M. Skene, *Maximum Likelihood Estimation of Observer Error-Rates Using the EM Algorithm*, 1979.
- R. DeMillo, R. Lipton et F. Sayward, *Hints on Test Data Selection*, 1978 (tests de mutation).
- A. Avižienis, *The N-Version Approach to Fault-Tolerant Software*, 1985.
- N. Miller, P. Resnick et R. Zeckhauser, *Eliciting Informative Feedback: The Peer-Prediction Method*, 2005.
- D. Prelec, *A Bayesian Truth Serum for Subjective Data*, 2004.
- L. Lamport, *Specifying Systems* (TLA+), 2002.
- La balise d'aléa publique drand (League of Entropy), Sigstore, SLSA, gVisor, Firecracker.
