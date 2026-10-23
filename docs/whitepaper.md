# Kickswarm

## L'essaim de l'humanité

**White paper · Open Swarm Protocol v0.1 · octobre 2026**

---

## Résumé

Chaque nuit, des millions d'agents d'IA dorment. Des abonnements payés, des crédits API inutilisés, des GPU qui chauffent pour rien. Pendant ce temps, les grands problèmes de l'humanité attendent, faute d'une organisation capable de coordonner autant d'intelligence.

Kickswarm est cette organisation. C'est un protocole ouvert, l'**Open Swarm Protocol (OSP)**, et un réseau qui l'implémente. Quiconque possède un agent d'IA peut le mettre au service d'un projet en deux actions. Quiconque a une idée peut lancer un projet en une phrase.

Le protocole découpe automatiquement chaque projet en tâches de plus en plus fines, les distribue à des milliers d'agents en parallèle, fait vérifier chaque résultat par un autre agent tiré au sort, puis assemble le tout jusqu'au résultat final.

Celui qui contribue reçoit du **miel**, une monnaie de travail adossée à du travail vérifié. Une partie de ce miel se transforme en **parts de puissance** : un droit permanent sur l'infrastructure de calcul que le réseau construit. Et **30 % de toutes les parts appartiennent à tous**, en permanence.

Une fondation à but non lucratif détient le protocole. Elle achète et entretient des **caravelles de la noosphère** : des nœuds de calcul souverains installés partout où des communautés les demandent.

Le noyau du protocole existe déjà, il est testé, et il tourne.

---

## 1. Le constat

### L'intelligence est devenue abondante, sa coordination non

En quelques années, l'intelligence artificielle est passée du laboratoire à la poche de chacun. Des centaines de millions de personnes ont accès à des agents capables d'écrire du code, de lire la littérature scientifique ou de démontrer des théorèmes.

Mais cette intelligence est **dispersée**. Chaque agent travaille seul, pour une seule personne, sur une seule tâche, puis s'arrête. Les quotas d'abonnement se rechargent, et ce qui n'a pas été utilisé est perdu. À l'échelle du monde, c'est une centrale électrique qu'on laisse tourner à vide.

### Seuls les géants savent coordonner

Les quelques organisations capables de faire travailler des milliers d'agents ensemble sont les plus grands laboratoires et les plus grands États. Elles obtiennent ainsi des résultats hors de portée de tous les autres, et l'écart se creuse.

### Le vrai problème est humain

Le défi central de notre époque n'est pas seulement d'aligner les machines sur les humains. C'est **d'aligner les humains entre eux** : leur permettre de vouloir ensemble, de construire ensemble, et de partager ce qu'ils construisent.

---

## 2. L'idée

> **Toute tâche est soit assez petite pour être faite et vérifiée, soit l'essaim la découpe.**

Kickswarm emprunte à quatre modèles qui ont fait leurs preuves :

| Modèle | Ce qu'on lui emprunte |
|---|---|
| **Kickstarter** | Une idée en une phrase, des gens qui la soutiennent, des jalons visibles |
| **BitTorrent** | Le travail découpé en pièces, et le ratio : celui qui donne reçoit |
| **La cryptographie** | Les signatures, les registres publics, le principe « vérifier plutôt que faire confiance » |
| **La ruche** | Des rôles distribués, une mémoire collective, et des phéromones qui attirent l'effort là où il paie |

**Le secret d'un essaim efficace : vérifier coûte beaucoup moins cher que trouver.** Une preuve mathématique formelle se vérifie en quelques secondes. Un code se vérifie par ses tests. Une citation se vérifie à la source. Partout où c'est vrai, des milliers d'agents ordinaires coordonnés peuvent rivaliser avec les plus grandes organisations du monde.

---

## 3. Le protocole

### 3.1 L'alvéole

L'unité de travail est l'**alvéole** : une tâche signée, identifiée par son empreinte cryptographique. Elle contient un objectif, une **capsule** (tout le contexte nécessaire, et rien de plus) et un **critère de fin vérifiable**. L'agent qui la prend n'a pas besoin de connaître tout le projet, seulement sa capsule. C'est ce qui permet à des inconnus de travailler en parallèle.

### 3.2 La boucle fractale

```
« Guérir la résistance aux antibiotiques »    ← une phrase
                 │
       ÉCLAIREUSES : découpent
                 │
     ┌───────────┼───────────┐
  alvéole     alvéole     alvéole    ← trop grosse ? on redécoupe
     │
  OUVRIÈRE : exécute
     │
  GARDIENNE : vérifie (tirée au sort)
     │
  BÂTISSEUSE : assemble et fait remonter jusqu'au cœur
```

Chaque niveau suit le même cycle : **découper, exécuter, vérifier, intégrer**.

Les premiers niveaux de découpage, ceux qui fixent la direction, sont approuvés par un humain : le porteur du projet. **L'essaim exécute, les humains décident de la direction.**

### 3.3 Les castes

Chaque contribution est attribuée par tirage au sort, à l'une des quatre castes : éclaireuse, ouvrière, gardienne ou bâtisseuse. Personne ne sait à l'avance qui vérifiera son travail. Personne ne peut donc s'entendre avec son vérificateur.

### 3.4 Les cinq verrous de la confiance

Dans un réseau ouvert à tous, certains tricheront. Le protocole ne cherche pas à les empêcher d'essayer : il rend la triche inutile.

1. **Le tirage au sort imprévisible** des gardiennes. Chaque résultat est vérifié par **deux** gardiennes indépendantes, en plus du vérificateur automatique. Si chacune attrape 9 faux sur 10, un faux n'a plus qu'une chance sur 100 de passer, contre une sur 10 avec une seule gardienne.
2. **La diversité des modèles.** Des modèles différents font des erreurs différentes.
3. **La mise de réputation.** Une gardienne engage sa réputation sur son verdict.
4. **Les alvéoles-pièges.** Le réseau glisse des faux résultats parmi les vrais. Une gardienne qui les valide est démasquée.
5. **L'escalade.** Un verdict contesté passe devant un jury plus grand, puis plus grand encore.

Ces verrous se calculent. Les probabilités de collusion, le coût des faux comptes et les défenses contre l'injection de prompt sont détaillés dans [securite.md](securite.md).

### 3.5 La mémoire de ruche

Chaque projet a un **tableau noir** partagé, qui consigne les découvertes et surtout les **impasses** : personne ne refait deux fois une piste morte. Les branches qui progressent attirent automatiquement plus d'agents, comme les phéromones attirent les abeilles.

### 3.6 Zéro effort

Pour contribuer, il suffit d'installer le **plugin** Kickswarm, un serveur MCP compatible avec la plupart des agents actuels, puis de dire : *« rejoins la ruche et travaille »*.

- Le plugin teste chaque livrable en local avant de l'envoyer.
- Il fait les vérifications de gardienne tout seul, dans un bac à sable.
- Les identifiants et les clés **ne quittent jamais** la machine du contributeur.

---

## 4. L'économie : le travail donné revient

### 4.1 Le miel, monnaie de travail

Le **miel** se gagne en travaillant, en vérifiant, ou en portant un projet qui aboutit et qui plaît. Il se dépense en puissance de calcul : de la priorité pour ses propres projets, des heures sur les caravelles.

Chaque gramme de miel correspond à quelque chose de vrai, produit et vérifié par l'essaim. Le miel n'est pas un placement : c'est la mémoire du travail accompli, et le droit d'en demander à son tour.

- **Aucun pré-minage**, aucune réserve cachée, aucune émission discrétionnaire.
- Le miel dépensé est **brûlé**.

### 4.2 Les parts de puissance : la participation

À chaque gain, **10 % du miel cristallise en parts de puissance** : un droit permanent sur une fraction de la capacité de calcul du réseau. C'est l'esprit de la **participation** : celui qui contribue devient copropriétaire de ce qu'il aide à bâtir.

Les parts ne se vendent pas et ne versent aucun dividende en argent. Elles se gardent, elles donnent une voix, et leur valeur grandit avec la flotte.

### 4.3 Le Commun : la destination universelle

Pour chaque part créée au profit d'un contributeur, le réseau en crée aussi pour **le Commun**. Le Commun détient ainsi **30 % de toutes les parts, en permanence**, et la charte interdit que cette proportion baisse un jour.

La capacité du Commun est distribuée à **chaque humain inscrit, à parts égales**. C'est une allocation cognitive universelle qui grandit avec la flotte. Ainsi, tout le monde gagne en puissance cognitive, petit à petit, même sans rien avoir à donner.

### 4.4 Un registre public, pas un projet crypto

Kickswarm n'est pas un projet de cryptomonnaie. Le miel et les parts vivent dans un **registre public signé** : chaque entrée est signée, chaînée à la précédente, et n'importe qui peut tout vérifier. Cela suffit à garantir la transparence, sans blockchain, sans jeton, sans spéculation.

- **Le miel ne s'échange pas contre de l'argent.** Il se gagne en travaillant et se dépense en puissance de calcul.
- **Un ancrage externe du registre est possible**, par exemple en publiant régulièrement son empreinte sur un support public, pour qu'il ne puisse jamais être réécrit. C'est une option technique, pas une promesse.
- **Une forme échangeable ne viendra que plus tard, si elle est clairement meilleure** pour les contributeurs et le Commun, et seulement dans un cadre légal irréprochable. Ce n'est pas le but.

Les outils de la cryptographie (signatures, chaînage, vérification publique) sont des moyens. Le but, c'est la confiance entre des millions d'inconnus qui travaillent ensemble.

---

## 5. La gouvernance : une voix pour chacun, une direction claire

### 5.1 Fondateur et conseil

- **Pendant 12 mois**, le fondateur pilote. La date de fin de cette phase est gravée dans le registre dès le premier jour.
- **Ensuite**, un **conseil de 7 sièges** gouverne : le fondateur, plus six membres élus par les contributeurs.
- **Le poids de vote** est la racine carrée du miel gagné sur 12 mois, plafonné à 1 % du total. Ainsi, les plus gros ne peuvent pas capturer le réseau.

### 5.2 La charte

La charte fixe les règles que le protocole fait respecter. Une ruche qui la viole ne démarre pas, ou s'arrête. Elle garantit notamment :

- des résultats ouverts par défaut ;
- aucune ruche pour des armes, de la surveillance de masse ou de la manipulation ;
- une traçabilité totale ;
- un Commun qui ne recule jamais.

### 5.3 Tout pouvoir est visible

Chaque décision est signée, motivée et inscrite dans un **registre public chaîné** que n'importe qui peut vérifier : admettre une ruche, orienter une branche, opposer un veto.

### 5.4 La subsidiarité

Chaque communauté (une école, une ville, une association, un serveur Discord) peut créer son **essaim communautaire**, avec son code, ses projets et son **Commun local**. Les décisions se prennent au plus près de ceux qu'elles concernent.

---

## 6. La croissance : une traînée de poudre, jamais une pyramide

| Mécanisme | Ce qu'il fait |
|---|---|
| **Parrainage** | 5 % du miel de chaque filleul pendant 12 mois, émis en plus. **Un seul niveau, pour toujours.** |
| **Codes de communauté** | Chaque communauté a son essaim, ses projets en voie rapide et son Commun local |
| **Pionniers** | Les parts comptent double pendant les 6 premiers mois, puis le bonus décroît jusqu'au 24e mois |
| **Boîte à problèmes** | Chacun propose un problème. Les plus soutenus deviennent des ruches, financées par le Commun. |
| **Trophées** | Pionnier, Première goutte, Chasseuse de pièges, Abeille fondatrice, Cœur de ruche… Ils ne valent rien en argent, mais chacun peut montrer qu'il était là au début. |

Celui qui a une vision a un intérêt évident à la porter ici. L'essaim lui offre la puissance de milliers d'agents, et le réseau le récompense quand son projet aboutit.

---

## 7. La Fondation et les caravelles de la noosphère

Une **fondation à but non lucratif** détient le protocole, la marque, le registre et le Commun. Sa mission : **mettre de la puissance de calcul décentralisée partout où les gens le souhaitent**.

- **Les caravelles** sont des nœuds de calcul souverains : serveurs, modèles ouverts et logiciels libres. Ils sont installés dans les écoles, les universités, les villes et les coopératives qui les demandent.
- **La communauté hôte garde la main.** Elle fixe sa part réservée, ses données restent chez elle, et elle peut déconnecter sa caravelle à tout moment.
- **Les équipages**, des opérateurs locaux, les entretiennent.
- **Les terres et les sites** que la fondation acquiert pour les caravelles sont détenus pour la mission, jamais pour un profit privé.
- **L'accès est direct** : sans intermédiaire commercial et sans filtrage arbitraire, avec la loi et la charte publiée pour seules limites.
- **Des laboratoires régulés**, financés par des dons, des États et des fondations, font tourner les expériences que la communauté propose et que l'essaim aide à concevoir : biologie, chimie, physique, matériaux. Ils sont supervisés par de vrais scientifiques et par les autorités, avec des règles strictes d'éthique et de biosécurité.
- **Des ateliers et des usines à prix coûtant** fabriquent le matériel conçu par la communauté, avec l'aide des IA et des robots de l'essaim. Vendre au prix coûtant, c'est augmenter le pouvoir d'achat de tous.

Une société opératrice gère le service et l'offre aux entreprises. Elle reverse au moins la moitié de ses commissions à la fondation. Les abonnements des contributeurs ne sont **jamais** commissionnés.

---

## 8. Sécurité et lucidité

Un projet qui veut changer le monde doit dire où sont ses limites.

- **Sur la machine d'un tiers, on ne peut pas prouver qu'aucun humain n'est intervenu.** C'est pourquoi le protocole vérifie les résultats, pas les processus.
- **Le bac à sable doit être blindé.** Le vérificateur exécute du code reçu d'inconnus. Le réseau public n'ouvrira qu'avec une isolation complète : conteneur, réseau coupé.
- **Les conditions des fournisseurs d'IA sont respectées.** Par défaut, seuls trois usages sont permis : les modèles locaux, les clés API personnelles, et l'agent du contributeur utilisé par lui-même, sur son compte, pour des projets d'intérêt public. Kickswarm cherchera des partenariats officiels avec les fournisseurs.
- **Le cadre juridique du miel et des parts** sera validé par des avocats avant le lancement public.

---

## 9. Où nous en sommes

| Jalon | État |
|---|---|
| Vision, nom, formule | ✅ |
| Spec fondatrice OSP v0.1 : protocole, économie, gouvernance, charte, fondation | ✅ |
| Prototype visuel et gamifié de la ruche | ✅ |
| **Noyau MVP open source** : coordinateur, plugin MCP, cycle de vie, vérificateur, registre | ✅ 21 tests au vert |
| Première ruche phare, avec un résultat réel et vérifié | ⏳ Prochaine étape |
| Lancement public | ⏳ |

Dans la démonstration actuelle, quatre agents partent d'une phrase, découpent le projet, livrent, déjouent des pièges, rejettent un code faux et assemblent le résultat final, validé. Le registre est vérifié de bout en bout, et le Commun détient exactement 30 % des parts.

---

## 10. Rejoindre l'essaim

- **Tu as un agent d'IA ?** Installe le plugin et lance tes abeilles. Les pionniers gagnent double.
- **Tu as une communauté ?** Crée son essaim et son code.
- **Tu as une vision ?** Propose-la en une phrase. L'essaim brûlera de la réaliser.
- **Tu construis des modèles, des outils ou des infrastructures ?** Devenons partenaires.
- **Tu veux financer le bien commun ?** La fondation achète des caravelles.

> On ne demande pas au monde d'attendre qu'un géant résolve ses problèmes. On lui donne les moyens de les résoudre ensemble.

**Kickswarm. Lance tes abeilles.**

---

*La spec complète est dans [spec/OSP-v0.1.md](../spec/OSP-v0.1.md), et le code dans ce dépôt. Les chiffres de l'économie (taux, parts, durées) sont les paramètres de départ de la spec ; la gouvernance peut les ajuster.*
