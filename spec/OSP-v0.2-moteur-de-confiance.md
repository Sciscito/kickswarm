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

### 3.6 Ce qui est implémenté (P0-2)

- **Tests cachés.**
  - Le critère publie seulement un **engagement**, `tests_caches_hash` : le sha256 de la forme canonique des tests.
  - Les tests eux-mêmes voyagent **à côté** de l'objet signé, jamais dedans. Le coordinateur les garde dans un **coffre privé**, hors de l'état et du registre.
  - Le vérificateur les exécute. Leurs échecs ne sont **jamais détaillés** : ni arguments, ni valeur attendue, ni valeur obtenue.
  - Ils sont **révélés au registre à la validation** (`secrets_reveles`). L'auditeur s'en sert alors pour revérifier.
  - Ouvrières et gardiennes ne les voient jamais.
- **Tests par propriétés.**
  - Générateurs : entiers, flottants, booléens, chaînes, tableaux, choix parmi des valeurs.
  - Une expression doit être vraie sur des centaines d'entrées tirées au hasard.
  - **La graine est dérivée du hash du livrable**, à la manière de Fiat-Shamir : modifier le code change les entrées tirées, donc impossible de viser des cas à l'avance. Pourtant, chacun peut reproduire exactement les mêmes tirages.
  - En cas d'échec, on donne un contre-exemple concret.
- **Moteur de mutation.**
  - Il inverse les opérateurs, décale les comparaisons, échange `&&` et `||`, change les booléens et les constantes.
  - Il ne touche jamais aux chaînes, aux gabarits, aux commentaires ni aux expressions régulières.
- **Force des tests à l'entrée.** Quand une éclaireuse fournit une référence secrète (`reference_hash`), le découpage n'est accepté que si la référence passe ses propres tests et que ces tests détectent au moins **80 %** de ses mutants. Le score est inscrit au registre, puis porté par chaque alvéole (`force_tests`). Le paramètre `reference_obligatoire` permet de l'exiger partout.
- **Le vérificateur `tests-de-tests@1`.** Pour les tâches qui consistent à *écrire des tests* (la ruche « Bouclier open source »), le livrable est une suite de tests. Elle doit passer sur la vraie cible et tuer au moins 80 % de ses mutants. C'est un critère objectif et vérifiable par n'importe qui.
- **Une faille corrigée au passage.** Dans le MVP, le code testé pouvait imprimer une fausse ligne « tous les tests passent ». Désormais :
  - les tests arrivent par l'entrée standard, consommée avant le chargement du module ;
  - le résultat porte un **jeton secret** propre à chaque exécution ;
  - le lanceur capture ses primitives (`JSON`, `Object.keys`, la sortie) avant tout chargement ;
  - la comparaison est faite par une égalité profonde maison, que le module testé ne peut pas remplacer.

**Limites assumées :**

- **Les mutants équivalents** (une mutation qui ne change rien au comportement) abaissent un peu le score : le seuil de 80 % en tient compte.
- **Une propriété ne vaut que par son expression.** Les tests montrent qu'un code qui renvoie toujours 1 passe « divise les deux », mais pas « est le plus grand ».
- **Avant la révélation, le coordinateur a les tests cachés en main.** L'engagement garantit qu'il ne peut pas les changer après coup, mais pas qu'il ne les divulgue pas à un complice. Les parades viennent en P3 : chiffrement à seuil entre plusieurs coordinateurs.

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

*§5.1 et §5.2 sont implémentés : voir §6.8.*

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

- Les tirages utilisent la **balise publique drand**, celle de la *League of Entropy* : graine = hash(aléa du tour drand ‖ demande signée). *Implémenté : voir §6.6.*
- **Engagement puis révélation.** Chaque gardienne publie d'abord le hash de son verdict, puis le verdict. Personne ne peut copier les autres ni s'aligner sur eux. *Implémenté : voir §6.7.*

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
- Un tirage aléatoire modifié **sans effet sur le déroulé** est indétectable, mais aussi sans conséquence. Contre un opérateur qui choisirait ses tirages pour truquer l'attribution, la parade est la balise publique drand (P1-3, §6.6) : les tirages y sont recalculés, donc vérifiés.
- Les livrables vivent dans le registre lui-même. Au-delà de quelques milliers d'alvéoles, il faudra un stockage par hash, à côté du registre.

### 6.5 Une cryptographie post-quantique (P0-5, implémenté)

| Brique | Algorithme | Pourquoi |
|---|---|---|
| **Identité des contributeurs** (`pq1:`) | **Hybride Ed25519 + ML-DSA-65** (FIPS 204) | Une signature n'est valide que si les **deux** le sont. Il faudrait casser à la fois la courbe elliptique (exposée à Shor) et le réseau euclidien (le pari post-quantique). |
| **Coordinateur et sceaux du registre** (`slh1:`) | **SLH-DSA-SHA2-128f** (FIPS 205) | Sa sécurité repose **uniquement sur la fonction de hachage**. C'est le choix le plus conservateur qui existe. |
| **Registre, engagements, identifiants** | SHA-256 | Résiste déjà : l'algorithme de Grover laisse 128 bits de sécurité. |
| Ancienne identité (`ed25519:`) | Ed25519 | Toujours acceptée, mais signalée comme non post-quantique par l'audit. |

**Les choix de conception :**

- **Un identifiant court** : c'est l'**empreinte SHA-256** des clés publiques. La signature transporte les clés, qui sont vérifiées contre cette empreinte.
- **Le type exact de chaque clé est contrôlé.** Une clé faible, Ed25519 par exemple, ne peut pas se faire passer pour une clé ML-DSA ou SLH-DSA, même si l'empreinte correspond : la substitution d'algorithme est impossible, et c'est testé.
- **Le registre est scellé par points de contrôle**, comme les journaux de transparence des certificats. Un sceau est la signature SLH-DSA du coordinateur sur le hash de la dernière entrée ; comme ce hash enchaîne toute l'histoire, un sceau authentifie tout ce qui le précède. Le lancement est scellé tout de suite, puis toutes les 2 secondes ou toutes les 50 commandes *(paramètres)*.
- **L'audit vérifie chaque sceau et rejoue l'histoire avec les sceaux en place.** Il indique jusqu'où le registre est scellé, et quelle part des signatures de contributeurs est post-quantique.

**Mesures sur la machine de développement** (Node 24, OpenSSL 3.5) :

| Algorithme | Temps de signature | Taille de la signature |
|---|---|---|
| ML-DSA-65 | 1 ms | 3,3 Ko |
| SLH-DSA-SHA2-128f | 18 ms | 17 Ko |
| SLH-DSA-SHA2-128s | 340 ms | 7,8 Ko |

La variante 128s, trop lente pour sceller souvent, est écartée.

**Limites assumées :**

- **Les signatures post-quantiques sont lourdes.** Une requête hybride pèse environ 7 Ko et une alvéole signée par le coordinateur environ 23 Ko. Le registre grossit vite : un annuaire de clés (enregistrer une clé une fois, puis signer sans la transporter) et un stockage par hash viendront ensuite.
- **Les entrées postérieures au dernier sceau** ne sont garanties que par le chaînage, jusqu'au sceau suivant. L'audit les compte.
- **« Mathématiquement incassable » n'existe pas en signature.** SLH-DSA est ce qui s'en approche le plus : le casser demande de casser la fonction de hachage elle-même.

### 6.6 Des tirages que personne ne choisit : drand (P1-3, implémenté)

Tous les tirages du coordinateur (la caste d'une abeille, l'alvéole qu'elle reçoit, la relecture qu'on lui confie, l'éventuelle alvéole piège) ont lieu pendant une demande de travail. Ils découlent désormais de la **balise publique drand quicknet** de la *League of Entropy* : toutes les 3 secondes, des organisations indépendantes produisent ensemble une signature BLS à seuil sur le numéro du tour, et l'aléa est le SHA-256 de cette signature.

**La règle du tirage :**

- Une demande signée par le contributeur à l'instant `ts` est tirée avec le tour **`tourA(ts) + 3`**, où `tourA(ts)` est le dernier tour publié à `ts`. Ce tour est publié **au moins 6 secondes après la signature** : au moment où il signe, le contributeur ne peut pas connaître l'aléa.
- **graine = SHA-256(aléa du tour ‖ hash de la demande signée)**. Les tirages en découlent par SHA-256 en mode compteur (53 bits par tirage). Deux abeilles qui demandent au même tour obtiennent des tirages différents.
- **La fenêtre d'horloge est de 4 secondes.** Le coordinateur refuse une demande dont l'heure s'écarte de plus de 4 s de la sienne. Comme 4 s < 6 s, une demande reste toujours signée avant la publication de son tour. Et un contributeur qui signerait plusieurs demandes pour garder celle qui l'arrange ne le peut pas : quand l'aléa paraît, ses demandes ont expiré.
- **Le coordinateur ne choisit ni le tour ni la graine.** Le tour se déduit de l'heure *signée par le contributeur*, et la graine de la demande elle-même.

**Ce que le registre conserve et ce que l'audit contrôle :**

- Le lancement annonce la balise : réseau, clé publique du groupe, genèse, période et décalage.
- Chaque demande inscrit la balise utilisée (tour, aléa, signature BLS). Au rejeu, l'auditeur **recalcule** les tirages au lieu de les reprendre. Il vérifie la signature BLS hors ligne, avec la seule clé publique de drand, et contrôle que le tour respecte la règle.
- **Tricher sur un tirage, sur l'aléa ou sur le tour fait diverger le rejeu**, même sans les sceaux, et c'est testé. Une demande tirée sans balise alors qu'une balise était annoncée fait échouer le contrôle « Random draws from a public beacon ».
- Une balise privée, utilisée pour les tests ou le travail hors ligne, suit le même schéma mais l'audit la signale : elle ne vient pas du réseau public.

**En pratique :** `kickswarm coordinator` utilise drand par défaut et vérifie au démarrage qu'il le joint ; `--beacon none` revient aux tirages internes, que l'audit signale comme non publics. `kickswarm demo live --beacon drand` montre une ruche entière tirée par drand. Les balises sont récupérées sur plusieurs relais (api.drand.sh, drand.cloudflare.com…), toujours vérifiées, et mises en cache.

**Limites assumées :**

- **Le coordinateur peut encore écarter une demande.** Il voit l'aléa avant de répondre : il pourrait refuser une demande dont le tirage lui déplaît, et le contributeur en signerait une autre. Cette censure ne laisse aucune trace dans le registre. Elle en laisse une dans le journal local du contributeur, qui note chaque demande et chaque refus. Les auditeurs multiples (§6.9), puis la fédération, la rendront visible.
- **Chaque demande de travail attend son tour**, de 6 à 9 secondes. C'est négligeable devant le temps de travail d'une IA sur une alvéole.
- **Si drand est injoignable**, le coordinateur répond 503 au lieu de tirer lui-même. Le travail s'arrête plutôt que de perdre sa garantie.
### 6.7 Des verdicts scellés : engagement puis révélation (P1-3, implémenté)

Avant, chaque verdict entrait dans le registre public dès son envoi. La seconde gardienne pouvait lire celui de la première et le recopier sans rien vérifier. Désormais, un verdict se donne en deux temps.

1. **L'engagement** (`osp.engagement/0.1`, `POST /v0/work/commit`). La gardienne envoie, signé, le seul hash de son verdict. Le verdict porte un **sel de 32 octets aléatoires** : sans lui, il suffirait d'essayer les trois décisions possibles pour retrouver le verdict derrière le hash.
2. **La révélation** (`osp.verdict/0.1`, `POST /v0/work/verdict`). Elle n'est acceptée que lorsque **toutes les places de gardienne du résultat sont engagées**. Avant, le coordinateur répond `425 Too Early`. Le verdict révélé doit avoir exactement le hash promis : changer d'avis après avoir vu l'autre est impossible.

**Les incitations :**

- **Se taire coûte plus cher que se tromper.** Une gardienne engagée qui ne révèle pas à temps perd la moitié de sa réputation (`facteur_non_revele` = 0,5, comme valider un piège). C'est pire qu'un verdict renversé (×0,9). Retenir un verdict qui s'annonce perdant n'est donc jamais rentable.
- **Révéler après coup reste jugé.** Si une autre gardienne fait rejeter le résultat pendant que son verdict est scellé, la gardienne révèle quand même. Un « valide » sur un résultat faux est alors renversé, un « rejeté » est confirmé.
- **La fenêtre de révélation ne court que lorsqu'elle est ouverte.** Une gardienne n'est jamais sanctionnée parce qu'une autre tarde à s'engager. Si une place se libère (abstention, bail expiré, rejet renversé), la révélation se referme jusqu'à ce qu'une nouvelle gardienne s'engage.
- **Un piège suit exactement le même chemin.** Engagement, puis révélation. Une gardienne ne peut pas reconnaître un piège à la procédure avant d'être engagée. Une fois engagée, le savoir ne lui sert plus à rien.
- **Un verdict scellé n'occupe plus d'abeille.** La gardienne peut prendre une autre tâche en attendant.

**Côté contributeur :** le plugin écrit le verdict scellé sur disque (`~/.kickswarm/verdicts-scelles.json`, sel compris) avant d'envoyer l'engagement. Il le révèle de lui-même dès que la révélation s'ouvre, à chaque appel d'outil et en tâche de fond toutes les 3 secondes. Le journal local note l'engagement puis la révélation.

**Ce que l'audit contrôle.** Un nouveau contrôle, « Guards committed to their verdicts before any was revealed », recalcule à partir des seuls objets signés que chaque verdict révélé correspond à un engagement signé, inscrit avant lui, avec un sel de la bonne longueur. Il compte aussi les engagements jamais révélés (sanctionnés) et ceux encore scellés. Le rejeu impose en plus la règle d'ouverture : aucun verdict révélé pendant qu'une autre gardienne du même résultat décidait encore. Retirer un engagement du registre fait échouer l'audit, et c'est testé.

**Limites assumées :**

- **Le coordinateur voit les engagements, pas les verdicts**, mais il connaît le résultat du vérificateur automatique. L'engagement protège les gardiennes les unes des autres, pas d'un coordinateur qui leur soufflerait la réponse.
- **Après une abstention**, la gardienne tirée en remplacement voit les verdicts déjà révélés pour ce résultat. Cela n'arrive que si une gardienne s'abstient, et chaque abstention est inscrite au registre.

### 6.8 Des pièges indiscernables (P0-3, implémenté)

**Le constat.** Le MVP fabriquait des pièges grossiers, et le registre public en a ajouté d'autres moyens de les reconnaître. Une gardienne pouvait repérer un piège de cinq façons, sans rien vérifier :

1. le livrable renvoyait `'__piege__'` ;
2. le résultat était signé par l'identité « pièges », annoncée au lancement ;
3. la vue en direct affichait un champ `piege` ;
4. le piège visait souvent une alvéole qui n'attendait aucune vérification ;
5. surtout, le registre étant public et rejouable en temps réel, il suffisait de le rejouer, ou de recalculer son propre tirage drand, pour voir le piège avant de s'engager.

**Ce qui est fait :**

- **Un piège est un mutant de la vraie livraison en attente.** Quand un livrable passe le vérificateur automatique, le coordinateur essaie jusqu'à 8 de ses mutants *(paramètre)* avec les seuls contrôles que rejouent les gardiennes : tests visibles et tests par propriétés, sans les tests cachés. Il garde ceux qu'elles rejettent et qui passent pourtant une partie des tests, du plus subtil au moins subtil. Un piège a donc le style, la longueur et les noms du vrai code, avec un seul bug. Rien de grossier : seule une vraie vérification le démasque.
- **Il prend la place du vrai, sur la même alvéole.** Quand une gardienne est tirée pour vérifier un résultat, elle reçoit, avec une probabilité qui lui est propre, un mutant de ce résultat à la place. Le piège occupe une place de gardienne, avec le même bail, et la gardienne figure dans la vue publique comme les autres. Tant que son piège est ouvert, elle ne reçoit pas le vrai livrable.
- **La vérification est anonyme.** Une gardienne reçoit l'alvéole, le livrable et un identifiant opaque à citer dans son verdict. Ni l'auteur, ni le résultat signé. C'est aussi plus juste : on juge le travail, pas la personne.
- **Le taux est individuel** (§5.2). Il vaut `taux_pieges` (10 %) pour une nouvelle venue et baisse avec la réputation, sans descendre sous 1 % *(paramètres)*.
- **Le tirage du piège vient d'un aléa secret.** Il ne découle pas de la balise drand, qu'une gardienne peut recalculer. Il vient d'un générateur cryptographique et est inscrit à part (`alea_secret`) dans la commande. Les autres tirages par défaut sont désormais cryptographiques eux aussi : publiés après coup, ils ne doivent pas permettre de deviner les suivants.
- **Le contenu du registre est publié avec un embargo.** Tant qu'un résultat attend ses gardiennes, sa soumission et tout ce qui suit restent sous embargo. Sinon une gardienne comparerait le livrable reçu au livrable publié. L'embargo tombe dès que le résultat est tranché, et au plus tard après 2 heures *(paramètre)*. Au-delà de ce délai, le résultat ne sert plus de modèle à des pièges.
- **La tête du registre, elle, reste publique en temps réel.** `GET /v0/state-hash` donne le rang et le hash de la dernière entrée, avec le dernier sceau SLH-DSA, à côté de l'horizon publié et de l'état qui en découle. Comme la tête enchaîne tout ce qui la précède, un observateur qui la note verrait toute réécriture de ce qui est encore sous embargo.
- **Le tableau noir public ne cite plus le résultat source** d'une impasse, pour la même raison.

**Ce que l'audit contrôle :**

- Le rejeu recalcule chaque piège : les mutants sont reproduits à l'identique (le moteur est déterministe), le taux suit la réputation du moment, et le choix vient des tirages secrets inscrits. Retirer un tirage secret, ou falsifier le rapport d'un mutant, fait échouer l'audit, et c'est testé.
- Un nouveau contrôle, « Trap cells drawn at each guard's announced rate », compare le nombre de pièges à son espérance (somme des taux annoncés). Il échoue au-delà de 4 écarts-types : un coordinateur qui abuserait des pièges, ou en épargnerait une gardienne amie, se verrait.
- `--reverify` rejoue aussi chaque mutant préparé comme piège avec les contrôles des gardiennes.
- `kickswarm audit --url` audite jusqu'à l'horizon publié et indique combien d'entrées restent sous embargo.

**Limites assumées :**

- **L'embargo retarde la transparence**, typiquement de la durée d'une vérification. Le rejeu complet d'une entrée attend la fin de son embargo. Ce qui est sous embargo reste engagé par la tête publique et par les sceaux.
- **Le coordinateur choisit encore l'aléa secret.** Il pourrait viser ou épargner une gardienne, mais le contrôle statistique le démasque dès que l'écart devient notable. Des graines engagées à l'avance, révélées ensuite, supprimeraient même cette marge.
- **Un piège n'existe que si les tests visibles tuent au moins un mutant.** C'est le cas dès que les tests sont assez forts (P0-2). Sinon, ce résultat ne reçoit pas de piège.
- **Deux gardiennes qui se concertent** peuvent comparer leurs livrables. C'est de la collusion, traitée par la preuve de personne unique (P3).

### 6.9 Plusieurs auditeurs, puis plusieurs coordinateurs

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
| **P0-2** ✅ | **Tests cachés + score de mutation + tests par propriétés** dans le vérificateur V0. *Fait : voir §3.6.* | F1 | Moyenne |
| **P0-3** ✅ | **Pièges par mutation** et taux de pièges individuel ; vérification anonyme, aléa secret et embargo du registre pour qu'ils restent indiscernables. *Fait : voir §6.8.* | F3 | Moyenne |
| **P0-4** | **Réputation Beta et test de Wald** à la place de k = 2 (avec un plancher à 2) | F2, F6 | Moyenne |
| **P0-5** ✅ | *Fait : voir §6.5.* **Signatures post-quantiques** : identités hybrides Ed25519 + ML-DSA-65 (FIPS 204), coordinateur et registre signés en SLH-DSA (FIPS 205, sécurité fondée sur les seules fonctions de hachage). Node 24 les fournit nativement. | Menace quantique sur Ed25519 | Moyenne |
| **P1-1** | **Caste des chasseuses** et primes au contre-exemple | F1, auto-renforcement | Moyenne |
| **P1-2** | **Contrat d'abord** pour les découpages, et découpages en concurrence | F7 | Grande |
| **P1-3** ✅ | **drand et engagement-révélation** pour les verdicts. *Fait : voir §6.6 et §6.7.* | F5 | Petite |
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
