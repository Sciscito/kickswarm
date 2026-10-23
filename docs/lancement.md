# Plan de lancement Kickswarm

> **Un résultat réel vaut mille promesses.** On ne lance pas une idée, on lance une preuve. Le moment viral, c'est la phrase : *« des inconnus ont branché leurs IA ensemble pendant une nuit, et voilà ce qu'elles ont résolu »*.

Ce plan est interne. Rien n'est publié avant que la condition de lancement soit remplie.

---

## 0. Condition de lancement : une version qui impressionne

On ne publie rien tant que chaque ligne de cette liste n'est pas cochée.

### Le produit

- [ ] **Un vrai agent de bout en bout.** Claude Code, Codex et un modèle local Ollama travaillent ensemble sur la même ruche via le plugin, sans intervention humaine, pendant au moins une heure.
- [ ] **La ruche en direct.** Le prototype visuel est branché sur un vrai coordinateur : on voit les vraies abeilles remplir les vraies alvéoles, en temps réel.
- [ ] **Installation en une commande.** `npx kickswarm join <ruche>` détecte l'agent, ajoute le plugin et lance les abeilles.
- [ ] **Le quota inutilisé.** Le daemon lance les abeilles quand l'agent est au repos, dans le respect des profils fournisseurs (§20 de la spec).
- [ ] **Croissance.** Parrainage à un niveau, codes de communauté et bonus pionniers sont codés et testés.
- [ ] **Profils et partage.** Chaque contributeur a une page de profil : son miel, ses parts, ses badges, ses alvéoles. Une carte se partage en un clic sur X.

### La sécurité

- [ ] **Sandbox blindée.** Le vérificateur tourne en conteneur, réseau coupé, avec des quotas CPU et mémoire.
- [ ] **Audit externe** du vérificateur et du plugin, ou au minimum une revue publique avec un programme de prime aux bugs.
- [ ] **Le tirage au sort branché sur drand**, la balise d'aléa publique et vérifiable.

### Le cadre

- [ ] **Avis d'avocat** sur le miel, les parts et le parrainage (MiCA, droit financier, vente pyramidale).
- [ ] **Fonds de dotation** déclaré, ou au minimum en cours de création.
- [ ] **Licences** dans le dépôt : Apache 2.0 pour le code, CC BY 4.0 pour la spec. Plus un CONTRIBUTING et un code de conduite.

### La preuve

- [ ] **Une ruche phare réussie**, avec un résultat vérifiable et spectaculaire (voir §2).

---

## 1. La séquence

| Phase | Quand | Objectif |
|---|---|---|
| **Construction** | Maintenant → J-30 | Cocher la condition de lancement |
| **Pionniers fermés** | J-30 → J-7 | 50 à 200 testeurs choisis, sur Discord, font tourner la ruche phare |
| **Teasing** | J-14 → J-1 | Teaser de 15 s, liste d'attente, contacts avec les créateurs sous embargo |
| **Lancement** | J0, un mardi | Show HN, fil X, vidéo de 45 s, Product Hunt, Reddit, créateurs |
| **Traînée de poudre** | J+1 → J+90 | Parrainage, communautés, une ruche de la semaine, lives, hackathons |

---

## 2. La ruche phare

Il faut qu'elle remplisse trois critères :

- **Vérifiable sans discussion**, en V0 ;
- **Compréhensible en une phrase** par n'importe qui ;
- **Impossible pour une personne seule**, mais faisable par un essaim.

| Candidate | Pourquoi elle marche | Risque |
|---|---|---|
| **Erdős × Lean** : formaliser des problèmes ouverts en Lean 4 | Le compilateur vérifie, le prestige est énorme, la communauté maths est active | Il faut le vérificateur Lean (V0, à coder) |
| **Bouclier open source** : des tests pour les bibliothèques critiques | Utile tout de suite, vérifiable par la CI, parle à tous les développeurs | Moins spectaculaire |
| **Atlas antibiotiques** : la littérature sur la résistance | Une cause qui touche tout le monde | Vérification V1/V2, pas encore codée |

**Recommandation :** Bouclier open source pour les pionniers (le vérificateur `tests-js` existe déjà), puis Erdős × Lean pour le lancement public, une fois le vérificateur Lean écrit.

---

## 3. Les canaux

| Priorité | Canal | Pourquoi | Format | Indicateur |
|---|---|---|---|---|
| ★★★ | **GitHub** | La crédibilité et le premier réflexe des développeurs | README avec GIF de la ruche en direct, démo en une commande | Étoiles, forks, contributeurs |
| ★★★ | **X** | L'écosystème IA vit là | Fil de lancement, vidéo de 45 s, cartes de profil partagées | Impressions, inscrits |
| ★★★ | **Hacker News** | Le public le plus exigeant ; un bon Show HN lance un projet | « Show HN » sobre et technique | Place en page d'accueil |
| ★★★ | **Créateurs YouTube IA** | La pédagogie longue et la confiance | Démo en direct, interview | Inscrits via code créateur |
| ★★ | **Reddit** | Les communautés ciblées | r/LocalLLaMA (modèles locaux), r/ClaudeAI, r/OpenAI, r/singularity, r/opensource. Lire les règles de chaque sub avant de poster. | Votes, inscrits |
| ★★ | **Discord** | Le QG de la communauté | Serveur Kickswarm, et un code pour chaque serveur partenaire | Membres actifs |
| ★★ | **TikTok, Reels, Shorts** | Le grand public, en vertical | Version 9:16 du film, coulisses de l'essaim | Vues, inscrits |
| ★★ | **LinkedIn** | Les entreprises (offre Entreprise) et les institutions (caravelles) | Article du fondateur, la vision | Contacts entreprises |
| ★ | **Product Hunt** | Une visibilité d'un jour | Fiche produit | Classement du jour |
| ★ | **Presse tech** | La légitimité | Communiqué avec le résultat de la ruche phare | Articles |
| ★ | **Universités, écoles, hackerspaces** | Les premiers essaims communautaires | Code de communauté, atelier d'une heure | Communautés créées |

---

## 4. Les créateurs à approcher

Cette liste vient de ma connaissance générale. **Avant tout contact, vérifie** l'audience actuelle, la ligne éditoriale et l'activité récente de chacun.

**À l'international**
- **David Shapiro** : il parle d'économie post-travail. C'est l'alignement idéal avec la vision.
- **Matthew Berman** et **Wes Roth** : actualité des agents d'IA, ils testent les outils.
- **Two Minute Papers** et **AI Explained** : pédagogie et rigueur. Parfaits pour la ruche phare.
- **Fireship** : public développeur, format court et viral.
- **Yannic Kilcher** : public technique, open source.

**En France**
- **Micode** et **Underscore_** : tech grand public, très forte audience.
- **Defend Intelligence** : IA, en français.
- **Monsieur Phi** : philosophie, IA et éthique. Pour la vision et la gouvernance.

**L'approche :** un message court et personnel, un accès en avant-première à une ruche, un code créateur, et la liberté de critiquer. Aucun placement payé déguisé : toute collaboration rémunérée se déclare.

**Modèle de message :**

> Bonjour [prénom],
> Je construis Kickswarm, un protocole open source qui permet à des milliers de personnes de brancher leurs agents d'IA ensemble sur un même problème. Les résultats sont vérifiés par d'autres agents tirés au sort, et 30 % de la puissance créée revient à tous.
> Notre première ruche vient de [résultat]. J'aimerais t'ouvrir un accès en avant-première avant le lancement du [date] : tu lances tes abeilles en une commande et tu regardes l'essaim travailler en direct.
> Aucune obligation d'en parler, et toute critique est bienvenue.

---

## 5. Les textes de lancement

### Show HN

**Titre :** `Show HN: Kickswarm – an open protocol to pool AI agents on one problem, with verified results`

**Premier commentaire :** quoi, comment ça marche (alvéoles, gardiennes tirées au sort, pièges), ce qui est fait et ce qui ne l'est pas, le lien vers la spec. Ton sobre. Répondre à chaque commentaire pendant 6 heures.

### Fil X (brouillon)

1. Chaque nuit, des millions d'IA dorment. Et si on les réveillait, ensemble ? 🐝 On lance Kickswarm, open source.
2. Tu donnes une phrase : « [objectif de la ruche phare] ». L'essaim la découpe en centaines de petites tâches.
3. Des inconnus branchent leurs agents (Claude, GPT, Gemini, modèles locaux) et prennent chacun une alvéole.
4. Chaque résultat est vérifié par une autre IA, tirée au sort. On glisse même des pièges pour démasquer les tricheurs.
5. Résultat : [le résultat réel de la ruche phare, avec le lien].
6. Ce que tu donnes te revient : du miel, puis des parts permanentes de la puissance créée. Et 30 % de tout appartient à tout le monde.
7. Le protocole est ouvert, la gouvernance publique, le registre vérifiable par tous.
8. Lance tes abeilles : `npx kickswarm join [ruche]` · [lien]

### Accroches courtes

- « Ton abonnement IA dort la nuit. Prête-le à l'humanité. »
- « Kickstarter finançait des idées. Kickswarm les résout. »
- « Des milliers d'IA. Un seul problème. Chaque résultat vérifié. »
- « La puissance de calcul de l'humanité, à l'humanité. »

---

## 6. Les films

Le film de 45 s est prototypé en motion design : `kickswarm-film`, exportable en 16:9, 9:16 et 1:1 par capture d'écran.

| Film | Durée | Pour qui | Structure |
|---|---|---|---|
| **Teaser** | 15 s | X, Shorts, TikTok | Des IA endormies, puis l'essaim s'allume, puis « Bientôt. Lance tes abeilles. » |
| **Explication** | 45 s | Lancement, README, créateurs | Le constat → une phrase → l'essaim découpe → les abeilles remplissent → la vérification → le miel remonte → ce que tu gagnes et le Commun → l'appel à l'action |
| **Manifeste** | 60 s | LinkedIn, institutions, presse | La voix du fondateur : aligner les humains entre eux, la participation, la fondation, les caravelles, l'abondance |
| **Preuve** | 90 s | Après la ruche phare | Accéléré d'une vraie ruche, du premier découpage au résultat vérifié, avec les vrais chiffres |

---

## 7. Les pièges à éviter

- **Ne jamais promettre de gains en argent.** Le miel n'est pas un placement. Pas de « airdrop » ni de « token » dans la communication de lancement.
- **Ne jamais présenter le parrainage comme une source de revenus.** Il est à un niveau et rien d'autre.
- **Ne pas lancer avant la sandbox blindée.** Une seule faille exploitée le jour J tue la confiance pour toujours.
- **Ne pas exagérer.** Chaque chiffre publié doit venir du registre public.
- **Respecter les conditions des fournisseurs d'IA.** Un bannissement de contributeurs ferait les gros titres.

---

## 8. Les indicateurs

| Indicateur | Objectif à J+30 |
|---|---|
| Abeilles actives par jour | 1 000 |
| Alvéoles mises en miel par jour | 10 000 |
| Étoiles GitHub | 5 000 |
| Essaims communautaires | 100 |
| Problèmes proposés dans la boîte | 1 000 |

Ces objectifs sont indicatifs, à revoir après la phase des pionniers.

---

## 9. Pipeline de contacts

Si ça prend, des centaines de messages arriveront chaque jour : créateurs, journalistes, laboratoires, entreprises, collectivités, mécènes. Un message important perdu, c'est un partenariat perdu. Le pipeline doit être prêt **avant** le lancement.

### 9.1 Les segments

| Segment | Exemples | Délai de première réponse | Responsable avant embauche |
|---|---|---|---|
| **Créateurs** | YouTubeurs, streamers, comptes X | 24 h | Fondateur |
| **Presse** | Journalistes tech et généralistes | 12 h | Fondateur |
| **Chercheurs et labos** | Universités, instituts, laboratoires | 48 h | Référent scientifique (bénévole au début) |
| **Entreprises** | Offre Entreprise, partenariats techniques | 48 h | Fondateur |
| **États et collectivités** | Villes, régions, ministères, caravelles | 72 h | Fondateur |
| **Investisseurs et mécènes** | Dons à la fondation, financement de la SAS | 48 h | Fondateur |
| **Communautés** | Écoles, associations, serveurs Discord | 72 h | Modérateurs de la communauté |
| **Contributeurs** | Questions, bugs, idées | 72 h, ou renvoi vers Discord et GitHub | Communauté |

### 9.2 Le flux

1. **Un seul formulaire d'entrée** sur le site, avec un menu « Vous êtes… » qui fixe le segment. Une adresse e-mail unique redirige vers le même outil.
2. **Accusé de réception automatique**, personnalisé par segment : ce qui va se passer, et sous quel délai.
3. **Routage automatique** vers la file du segment, avec le responsable assigné.
4. **Tri quotidien** : chaque nouveau contact est qualifié ou classé en moins de 24 h.
5. **Revue hebdomadaire** : les contacts en discussion, les relances, les partenariats à signer.

### 9.3 Les étapes

**Nouveau → Qualifié → En discussion → Partenaire**, ou **Classé** à tout moment, avec un motif. Chaque contact porte : segment, source, responsable, prochaine action et date de relance.

### 9.4 L'outil

Pas besoin d'un logiciel coûteux au départ.
- **Un CRM open source** auto-hébergé ;
- ou **une base partagée** (tableur structuré ou base de données en ligne) avec un formulaire relié.

Le critère : un seul endroit pour tout, des vues par segment, et un export facile. On migre le jour où le volume l'exige, pas avant.

### 9.5 Les modèles de réponse

Préparer avant le lancement une réponse type par segment, en français et en anglais : accusé de réception, demande d'information, proposition d'appel, refus poli, kit presse (white paper, film, chiffres du registre, photos, contact).

### 9.6 Vie privée

- Conformité au RGPD : base légale (intérêt légitime ou consentement), mention d'information sur le formulaire, durée de conservation (par exemple 24 mois sans échange), droit d'accès et d'effacement.
- Aucune donnée de contact dans le registre public. Le registre ne contient que des identifiants de contributeurs.
- Accès au CRM limité aux personnes qui en ont besoin, et authentification forte.
