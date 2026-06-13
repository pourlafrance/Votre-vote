# Et vous, vous auriez voté quoi ?

Site statique **une page**, qui liste les textes votés à l'Assemblée nationale
(adoptés ou rejetés). Pour chaque texte, l'utilisateur répond **Pour / Contre /
Abstention**, puis découvre **ce qu'ont voté les groupes politiques** et peut
**lire le texte** en entier. Tri par date (plus récents d'abord) et filtre par
**thématique**.

## Principe : aucune donnée collectée

Les réponses de l'utilisateur **restent dans le navigateur, en mémoire**, et ne
sont **envoyées nulle part** ni stockées durablement. Le but est uniquement de
confronter ses idées aux choix des partis, sur des **faits publics et sourcés**.
Le site est 100 % statique : il n'y a pas de serveur qui reçoit quoi que ce soit.

## Comment ça marche

- `index.html` + `styles.css` + `app.js` : la page. `app.js` charge `data.json`
  et fait tout côté navigateur. Aucune librairie, aucun build.
- `data.json` : généré par `scripts/build-votes.mjs` à partir de deux sources
  open data officielles :
  - **Scrutins de l'Assemblée nationale** (qui a voté quoi, nominativement) ;
  - **Datan** (data.gouv, d'après l'AN) pour relier chaque député à son **groupe**.

Le script ne garde que les **votes « sur l'ensemble » d'un texte** (les votes
finaux qui comptent, pas les amendements), agrège par groupe, calcule la position
majoritaire de chaque groupe, et un **taux de présence** par groupe (part des
votes auxquels ses membres ont effectivement pris part).

## Mise à jour automatique

`.github/workflows/update-data.yml` tourne **chaque lundi** (et à la demande) :
il régénère `data.json` puis redéploie. Rien à faire à la main.

- **Fail-safe** : si une source est indisponible, le script sort sans écraser
  `data.json` — le site garde les dernières données valides.

## Limites assumées

- Le **classement par thématique est automatique** (mots-clés sur l'intitulé du
  texte) : utile mais pas parfait, d'où une rubrique « Autre ».
- Le groupe d'un député est son groupe **actuel** ; un changement de groupe en
  cours de législature n'est pas rétro-appliqué aux votes anciens.
- Le taux de présence porte sur les **votes solennels / sur l'ensemble**, pas sur
  le travail en commission ou en circonscription (non disponibles proprement en
  open data).

## Sources et licence

Open data de l'Assemblée nationale (scrutins publics) et Datan, sous
**Licence Ouverte / Etalab**. Citer : « d'après l'Assemblée nationale ».

## Déploiement

Dépôt public → Settings → Pages → Source : **GitHub Actions**. Le workflow
`deploy.yml` publie le contenu du dépôt tel quel (site statique).
