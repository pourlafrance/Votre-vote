# Qu'auriez-vous voté ?

Site statique **une page**, en **quiz une question à la fois** : pour chaque texte
voté à l'Assemblée nationale (adopté ou rejeté), l'utilisateur répond **Pour /
Contre / Abstention**, voit un **contexte** du texte, puis découvre **ce qu'ont
voté les groupes politiques** et peut **lire le texte**. Filtres par **thématique**
et par **année** ; on passe au texte suivant après avoir répondu.

## Principe : aucune donnée collectée

Les réponses **restent dans le navigateur, en mémoire**, et ne sont **envoyées
nulle part** ni stockées durablement. Le but est seulement de confronter ses idées
aux choix des partis, sur des **faits publics et sourcés**. Site 100 % statique,
aucun serveur ne reçoit quoi que ce soit.

## Comment ça marche

- `index.html` + `styles.css` + `app.js` : la page. `app.js` charge `data.json` et
  fait tout côté navigateur. Aucune librairie, aucun build.
- `data.json` : généré par `scripts/build-votes.mjs` à partir de deux sources open
  data officielles :
  - **Scrutins de l'Assemblée nationale** (qui a voté quoi, nominativement) ;
  - **Datan** (data.gouv, d'après l'AN) pour relier chaque député à son **groupe**.

Le script ne garde que les **votes « sur l'ensemble » d'un texte** (votes finaux,
pas les amendements), agrège par groupe et calcule la position majoritaire de
chaque groupe.

## Contexte des textes

Chaque texte affiche un contexte. Par défaut, une phrase **factuelle** (type,
lecture, thématique). Pour un vrai laïus explicatif, renseigner `contextes.json`
(clé = numéro de scrutin, valeur = phrase **neutre et sourcée**) : cette surcouche
est prioritaire et **n'est jamais écrasée** par la mise à jour automatique.

## Mise à jour automatique

`.github/workflows/update-data.yml` tourne **chaque lundi** (et à la demande) : il
régénère `data.json` puis redéploie. Rien à faire à la main.

- **Fail-safe** : si une source est indisponible, le script sort sans écraser
  `data.json` — le site garde les dernières données valides.

## Limites assumées

- **Classement par thématique automatique** (mots-clés sur l'intitulé) : utile mais
  imparfait, d'où une catégorie « Autre ».
- Le groupe d'un député est son groupe **actuel** : un changement de groupe en cours
  de législature n'est pas rétro-appliqué aux votes anciens.

## Sources et licence

Open data de l'Assemblée nationale (scrutins publics) et Datan, sous **Licence
Ouverte / Etalab**. Citer : « d'après l'Assemblée nationale ».
