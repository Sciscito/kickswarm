# Sécurité de l'essaim

Ce document explique pourquoi on peut faire confiance aux résultats d'un réseau ouvert à des inconnus, et comment on se défend contre ceux qui voudraient le tromper ou l'attaquer. Il complète la spec ([§7](../spec/OSP-v0.1.md), [§9](../spec/OSP-v0.1.md) et [§19](../spec/OSP-v0.1.md)).

Le principe reste celui de la spec : **on ne vérifie pas le processus, on vérifie le résultat.** Toute la sécurité repose sur des probabilités qu'on peut calculer et rendre aussi petites qu'on veut.

---

## 1. Les mathématiques de la vérification

### 1.1 Plusieurs gardiennes indépendantes

On suppose que chaque gardienne détecte un résultat faux avec une probabilité *p*, et que les gardiennes sont indépendantes. Un résultat faux n'est accepté que si toutes les gardiennes le ratent :

```
P(faux accepté) = (1 − p)^k
```

| Gardiennes *k* | p = 0,9 | p = 0,99 |
|---|---|---|
| 1 | 10 % | 1 % |
| 2 | 1 % | 0,01 % |
| 3 | 0,1 % | 0,0001 % |

**Décision : les alvéoles V0 passent à 2 gardiennes**, en plus du vérificateur automatique. Le paramètre `gardiennes_v0` vaut désormais 2 par défaut. Chaque gardienne supplémentaire divise le risque par 10 quand *p* = 0,9, pour un coût qui ne croît que linéairement.

Pour une alvéole V0, le vérificateur automatique attrape déjà tout ce que les tests attrapent. Les gardiennes protègent contre trois choses :
- un coordinateur compromis ou buggé ;
- un résultat qui dépend de l'environnement (non déterminisme, horloge, aléa) ;
- une tentative d'évasion de la sandbox.

Leur vrai poids augmente avec V1 et V2, là où le jugement remplace les tests.

### 1.2 Les tests cachés et aléatoires

Une ouvrière voit les tests publics. Une ouvrière malhonnête pourrait donc écrire du code qui triche sur ces tests précis, par exemple en codant les réponses en dur. La parade est double :
- **Tests cachés.** Les gardiennes rejouent aussi des tests que l'ouvrière n'a jamais vus.
- **Tests par propriétés.** Les gardiennes génèrent des entrées aléatoires et vérifient des propriétés (par exemple, `pgcd(a, b)` divise `a` et `b`), avec une graine tirée après la soumission.

Avec *m* entrées aléatoires indépendantes, un code qui ne marche que sur une fraction *f* des entrées passe avec une probabilité *f^m*. Pour *f* = 0,5 et *m* = 30 : moins d'une chance sur un milliard.

### 1.3 Les alvéoles-pièges mesurent chaque gardienne

Une part *τ* des tâches de vérification sont des pièges dont le coordinateur connaît la réponse (4 % par défaut, §9.4).

- **Une gardienne paresseuse**, qui valide tout, se fait prendre au premier piège. Le nombre moyen de vérifications avant d'être démasquée est 1/τ, soit 25 avec τ = 4 %.
- **Les pièges servent aussi à estimer le *p* de chaque gardienne.** Après *n* pièges, dont *d* déjoués, on a une estimation de sa fiabilité (§1.4). Une gardienne dont la fiabilité estimée tombe sous un seuil est écartée.

Les pièges sont indiscernables a priori, et ils ne sont révélés qu'après le verdict.

### 1.4 La réputation bayésienne

La règle du §10.2 de la spec est une version simple d'un modèle plus propre : la loi **Bêta-Bernoulli**.

- Chaque contributeur a deux compteurs : α (verdicts ou résultats confirmés) et β (renversés ou rejetés). Les deux commencent à 1.
- Sa fiabilité estimée vaut α / (α + β). L'incertitude se lit dans la loi Bêta(α, β) elle-même.
- **Exemple.** Une gardienne a déjoué 9 pièges sur 10. Sa fiabilité estimée vaut 10/12 ≈ 0,83. On l'écarte si P(p < 0,8) > 95 % ; ici, elle reste.
- **L'oubli.** On multiplie α et β par un facteur λ = 0,99 à chaque événement. La réputation suit ainsi le comportement récent. C'est la défense contre ceux qui bâtissent leur réputation pour trahir ensuite : une trahison récente pèse plus qu'une longue histoire honnête.

Le passage du §10.2 à ce modèle est prévu pour v0.2.

### 1.5 La collusion face au tirage au sort

Un attaquant qui contrôle *m* gardiennes sur un vivier de *N* veut que **toutes** les gardiennes tirées pour son propre résultat soient à lui. La probabilité suit une loi hypergéométrique :

```
P = C(m, k) / C(N, k) ≈ (m / N)^k   quand N est grand
```

| Vivier *N* | Attaquant *m* | k = 2 | k = 3 |
|---|---|---|---|
| 10 000 | 500 (5 %) | 0,25 % | 0,012 % |
| 10 000 | 100 (1 %) | 0,01 % | 0,0001 % |

Et même quand il gagne ce tirage, son résultat reste exposé à l'audit aléatoire (§1.7) et au tirage pondéré par la réputation, qui réduit le poids des comptes récents.

**Pourquoi un aléa public et vérifiable (drand).** Si l'aléa est connu ou manipulable, l'attaquant peut choisir le moment de sa soumission pour tomber sur ses complices. On appelle cela le *grinding*. La graine du tirage est donc :

```
graine = sha256(premier tour drand publié APRÈS la soumission ‖ id_resultat)
```

Personne ne connaît ce tour au moment de soumettre, et n'importe qui peut vérifier le tirage après coup.

### 1.6 Le coût des faux comptes (Sybil)

- **Un nouveau compte commence avec une réputation de 0,2** et n'a accès qu'aux alvéoles V0.
- **Pour devenir gardienne V2**, il faut une réputation de 0,6. Avec la règle R ← R + 0,05 × (1 − R), il faut *n* confirmations telles que 0,8 × 0,95ⁿ ≤ 0,4, soit **au moins 14 contributions confirmées**. Chaque faux compte coûte donc du vrai travail vérifié.
- **Le piège du vote en racine carrée.** Diviser son miel *H* entre *s* comptes donne un poids total de s × √(H/s) = √(s × H). Le poids augmente donc avec le nombre de comptes. La racine carrée protège contre les gros, mais elle **encourage les faux comptes**. Les parades :
  - la preuve de personne unique (v0.2), pour qu'une voix corresponde à un humain ;
  - un plafond par personne ;
  - un seuil d'activité minimale pour voter.

  Tant que la preuve de personne unique n'existe pas, le vote du conseil doit rester prudent.

### 1.7 L'audit aléatoire après validation

2 % des alvéoles déjà en miel sont revérifiées par un nouveau jury (§9.6). Un tricheur qui a fait accepter *F* résultats faux échappe à tous les audits avec une probabilité 0,98^F :

| Résultats faux *F* | Chance d'échapper à tout audit |
|---|---|
| 50 | 36 % |
| 100 | 13 % |
| 200 | 1,8 % |

Un seul audit raté suffit à faire tomber la réputation des gardiennes impliquées. Tricher à grande échelle devient donc presque certain d'échouer.

---

## 2. Se défendre contre les injections malveillantes

Une ruche est un texte écrit par un inconnu (le porteur, une éclaireuse) et lu par l'agent d'un autre inconnu. C'est la surface d'attaque principale : faire faire à l'agent autre chose que l'alvéole.

| Défense | Ce qu'elle fait | État |
|---|---|---|
| **La capsule est une donnée** | Les consignes du plugin encadrent la capsule et disent à l'agent d'ignorer toute instruction qu'elle contient | ✅ |
| **Marquage du contenu non fiable** (*spotlighting*, *datamarking*) | Le contenu non fiable est entouré de balises uniques et aléatoires, ou ses mots sont entrelacés d'un marqueur, pour que le modèle distingue la donnée de la consigne | À faire |
| **Capsules signées** | Le coordinateur signe chaque alvéole ; le plugin refuse une capsule modifiée | ✅ (signature) · vérification côté plugin à ajouter |
| **Sorties contraintes par un schéma** | L'agent ne peut rendre que des fichiers texte, des impasses, ou un découpage au format strict, validés avant envoi | ✅ |
| **Moindre privilège** | Le plugin n'expose aucun outil de fichier, de réseau ou de shell. Un agent détourné ne peut que rendre un mauvais livrable, qui sera rejeté. | ✅ |
| **Bac à sable WebAssembly** | Par défaut partout : le coordinateur, les gardiennes et les auditeurs exécutent le même moteur, donc le même verdict. Le code reçu tourne dans QuickJS compilé en WebAssembly, un moteur neuf dans un thread jetable : le langage et les fichiers du livrable, rien d'autre. Ni réseau, ni disque, ni processus, ni API de Node ; mémoire, pile et temps bornés. | ✅ |
| **Primitives gelées** | Avant de charger le livrable, le lanceur gèle les objets intégrés de JavaScript : le code testé ne peut pas réécrire ce dont dépendent le rapport ou une propriété | ✅ |
| **Conteneur réseau coupé** | Docker ou Podman, sans réseau, avec quotas CPU et mémoire, système de fichiers en lecture seule | ✅ écrit · à éprouver sur une machine avec Docker |
| **Processus isolé** | Sur demande explicite seulement : un processus Node avec le modèle de permissions. Le réseau n'y est pas coupé. | ✅ |
| **Double LLM** (*dual-LLM*, LLM en quarantaine) | Pour les jugements V2 : un modèle « en quarantaine » lit le contenu non fiable mais n'a aucun outil ; il ne transmet qu'une sortie structurée (un score, un verdict) au modèle qui agit | Prévu avec V2 |
| **Jetons canaris** | Des chaînes secrètes placées dans le contexte de l'agent. Si l'une d'elles apparaît dans un livrable ou une requête, il y a eu fuite ou injection, et l'alvéole est mise en quarantaine. | À faire |
| **Limites de taille** | Livrable plafonné à 256 Ko et 32 fichiers, sortie de vérification à 1 Mo, corps de requête à 1 Mo | ✅ |
| **Limites de débit** | Baux simultanés plafonnés (3 abeilles par contributeur), fenêtre anti-rejeu, et à ajouter : quotas par identité et par adresse | Partiel |

**Règle d'or :** aucune défense textuelle ne suffit seule contre l'injection de prompt. La vraie protection, c'est qu'un agent détourné **ne puisse rien faire de grave** (moindre privilège, sandbox) et que son livrable soit **vérifié par d'autres** (§1).

---

## 3. La revue de code à grande échelle

L'essaim peut se protéger lui-même, et protéger les logiciels dont le monde dépend.

### 3.1 Une classe de ruche « revue de sécurité »

- **Analyse statique** : des outils comme Semgrep ou CodeQL tournent dans la sandbox. Leurs alertes deviennent des alvéoles.
- **Analyse des dépendances** : versions vulnérables, paquets abandonnés, typosquatting.
- **Jurys de revue par IA**, avec diversité de modèles : chaque finding est confirmé par au moins deux familles de modèles avant d'être retenu.
- **Preuve exigée** : un finding n'est validé que s'il est accompagné d'un test qui reproduit le problème. C'est du V0 : vérifiable sans discussion.
- **Divulgation responsable** obligatoire, avec embargo géré par le porteur (§19 de la spec).

La première cible est le code de Kickswarm lui-même.

### 3.2 Une prime aux bugs publique

Avant le lancement public : un programme de prime aux bugs sur le coordinateur, le plugin et la sandbox, avec un barème publié et des récompenses en euros versées par la fondation.

### 3.3 Accéder aux meilleures IA de défense

Les outils de défense les plus avancés sont souvent réservés aux partenaires des laboratoires d'IA et des programmes de sécurité. Kickswarm cherchera activement ces partenariats :
- accès à des modèles spécialisés en sécurité ;
- crédits de calcul dédiés à la revue de code ;
- audits par des équipes reconnues.

Un réseau ouvert qui protège le logiciel libre est un partenaire naturel pour ces programmes. Aucun partenariat n'existe à ce jour.

---

## 4. Ce qui reste à faire, par priorité

1. Conteneur réseau coupé pour toute vérification (bloquant pour le lancement).
2. 2 gardiennes en V0 (en cours dans le code).
3. Tirage au sort branché sur drand.
4. Tests cachés et tests par propriétés dans le vérificateur V0.
5. Vérification des signatures de capsule côté plugin, marquage du contenu non fiable, jetons canaris.
6. Réputation bayésienne avec oubli (v0.2).
7. Preuve de personne unique avant tout vote du conseil (v0.2).
8. Audit externe et prime aux bugs avant le lancement public.
