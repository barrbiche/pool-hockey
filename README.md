# Pool de hockey

Pool de hockey familial bâti autour des matchs du Canadien de Montréal.
À chaque match du CH, chaque participant choisit **un joueur** de
l'alignement. Les points sont calculés automatiquement après le match à
partir des vraies statistiques de la LNH.

## Comment ça marche

**Ordre de choix** — rotation fixe sur trois participants. Le premier à
choisir tombe dernier au match suivant. L'ordre de chaque match est figé
dans la colonne `ordre_choix` au moment où le match est créé en base.

**Pointage** — 2 points par but, 1 point par passe, 3 points de bonus pour
un tour du chapeau.

**Délais** — la 1re personne doit avoir choisi 1h30 avant le match, la 2e
1h avant, la 3e 30 min avant. Qui manque son délai se fait auto-assigner
son joueur du match précédent, sinon le meilleur pointeur encore libre.

**Notifications** — rappel push 2h avant le match à la personne dont c'est
le tour, notification quand quelqu'un change son choix, et résultat
personnel après le match.

## Pile technique

- **React 19 + Vite** pour le site (mobile d'abord)
- **Supabase** pour la base de données et l'authentification
- **Netlify** pour l'hébergement et les fonctions
- **API publique `api-web.nhle.com`** pour l'alignement, le calendrier,
  les pointages et les statistiques

## Développement

```bash
npm install
npm run dev
```

Il faut un fichier `.env` à la racine (jamais commité) :

```
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
```

Et, côté Netlify, ces variables d'environnement pour les fonctions :

```
SUPABASE_URL           # même URL que ci-dessus
SUPABASE_SECRET_KEY    # clé service_role — jamais côté navigateur
VAPID_PUBLIC_KEY       # notifications push
VAPID_PRIVATE_KEY
```

## Tâches planifiées (crons Netlify)

| Fonction | Fréquence | Rôle |
|---|---|---|
| `creer-matchs-a-venir` | aux 6 h | crée en base les matchs du CH des 30 prochains jours avec leur ordre de choix |
| `calculer-points` | aux 15 min | détecte les matchs terminés et calcule les points |
| `auto-assigner-choix` | aux 15 min | assigne un joueur à qui a manqué son délai |
| `rappel-2h` | aux 15 min | rappel push 2h avant le match |

## Ménagement de l'API de la LNH

L'API `api-web.nhle.com` est gratuite et non documentée — rien ne garantit
qu'elle tolère un gros volume. Deux règles à ne pas briser :

1. **Les crons ne touchent jamais à un match futur.** `calculer-points`
   filtre sur `date_match < maintenant`, sinon il interroge une vingtaine
   de matchs pas encore joués à chaque passage.
2. **Toute fonction lue par le site est mise en cache** par le réseau de
   Netlify (`Netlify-CDN-Cache-Control`). `stats-equipe` est la plus
   coûteuse : elle va chercher le boxscore de chaque match déjà joué de la
   saison, ce qui dépasse 70 appels en fin de saison. Sans cache, chaque
   ouverture de l'onglet les refait.

Un échec n'est jamais mis en cache (`Cache-Control: no-store`), sinon il
serait resservi à tout le monde jusqu'à expiration.

## Schéma de base

- `matchs` — `nhl_game_id`, `date_match`, `adversaire`, `statut`,
  `ordre_choix`, `numero_match`, `rappel_envoye`
- `choix` — `match_id`, `user_id`, `joueur_id`
- `resultats` — `match_id`, `user_id`, `joueur_id`, `buts`, `passes`,
  `tour_chapeau`, `points`
- `joueurs` — `nhl_id`, `nom`
- `abonnements_push` — `user_id`, `subscription`

Les identifiants des participants et l'ordre de base sont dans
`netlify/functions/_participants.js` — seul endroit à modifier si un
compte est recréé.
