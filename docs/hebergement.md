# Héberger Kickswarm gratuitement

Ce dont le réseau a besoin, et où le mettre sans payer, ou presque.

## Ce qu'il faut héberger

| Pièce | Besoins |
|---|---|
| **Le coordinateur** | Node 22+, un disque persistant (`etat.json`, `registre.jsonl`), des connexions longues pour le flux temps réel (SSE). Docker est inutile : les tests tournent dans le bac à sable WebAssembly, réseau et disque coupés, comme chez les gardiennes. |
| **La ruche en direct** | Servie par le coordinateur lui-même, sur `/hive` |
| **Le site, le white paper, la spec** | Des pages statiques |
| **Un nom de domaine et le HTTPS** | Le seul vrai coût : environ 10 à 15 € par an pour le domaine |

## Les options

Les offres gratuites changent souvent. **Vérifie les conditions du jour avant de t'engager.**

| Option | Gratuit ? | Docker (sandbox) | Disque persistant | Verdict |
|---|---|---|---|---|
| **Oracle Cloud « Always Free »** : VM ARM Ampere, jusqu'à 4 cœurs et 24 Go de RAM | Oui, sans limite de durée selon les conditions actuelles. Carte demandée à l'inscription, et une instance inactive peut être récupérée. | ✅ | ✅ | **Recommandé pour le coordinateur** |
| **Google Cloud, offre gratuite e2-micro** : 1 vCPU partagé, 1 Go | Oui, dans certaines régions | ⚠️ Possible mais à l'étroit | ✅ | Suffisant pour un petit pilote |
| **Render, service web gratuit** | Oui | ❌ | ❌ | Se met en veille et perd son disque : pour une démo seulement |
| **Fly.io, Railway** | Plus de vraie gratuité pour les nouveaux comptes (essai ou crédits) | Selon l'offre | Selon l'offre | À vérifier |
| **Cloudflare Tunnel** | Oui | — | — | **Excellent complément** : expose le coordinateur en HTTPS sans ouvrir de port, avec une protection anti-DDoS |
| **GitHub Pages ou Cloudflare Pages** | Oui | — | — | **Recommandé pour le site, le white paper et la spec** |
| **Un serveur à la maison** (vieux PC, Raspberry Pi 5) + Cloudflare Tunnel | Oui, si tu as le matériel | ✅ | ✅ | Bien pour les pionniers, moins fiable qu'un cloud |
| **Programmes de crédits pour l'open source et les associations** | Crédits offerts | ✅ | ✅ | À demander dès que la fondation existe |

## La pile recommandée

1. **Coordinateur** : une VM Oracle Cloud Always Free (Ubuntu, ARM).

   ```bash
   kickswarm coordinator --host 0.0.0.0 --data /srv/kickswarm
   ```

   Devant lui, **Caddy** (HTTPS automatique) ou **Cloudflare Tunnel** (aucun port ouvert).
2. **Site et documents** : GitHub Pages, sur le même dépôt que le code.
3. **Sauvegardes** : copie quotidienne de `registre.jsonl` et `etat.json` vers un stockage d'objets ou un dépôt git privé.
   - Le registre est chaîné par hash : n'importe qui peut vérifier qu'une copie est intègre.
   - Une migration vers un autre hébergeur est donc vérifiable de bout en bout.
4. **Nom de domaine** : le seul achat indispensable.

## Les limites à garder en tête

- **Un seul coordinateur, c'est un point de défaillance unique.** La fédération (v0.3) le supprimera. D'ici là : sauvegardes, et une seconde VM prête à reprendre.
- **Un coordinateur public exige un bac à sable qui coupe le réseau** : WebAssembly (par défaut) ou conteneur. Il refuse de démarrer au-delà de `localhost` avec le mode processus.
- **Les offres gratuites peuvent changer ou fermer.** Le registre vérifiable rend la migration sûre ; garde-la prête.
- **Créer les comptes chez les hébergeurs te revient** : ils demandent ton identité et parfois une carte.
