# Cockpit Coordo

Le cockpit de suivi AESH, en appli installable sur le téléphone et l'ordinateur.

👉 **Ouvrir l'appli :** https://cecilehanan-prog.github.io/cockpit-coordo/

Sur le téléphone : ouvre le lien, puis « Ajouter à l'écran d'accueil ».

## Les données ne sont pas ici

Ce dépôt est public : il ne contient **aucune donnée d'élève ni d'AESH**, seulement le code de l'appli.
La première fois, l'appli est vide. Dans **Données & exports › Importer JSON**, charge le JSON exporté depuis
l'appli du Mac. Les données restent dans le navigateur de l'appareil, jamais sur GitHub.

## Mettre à jour l'appli en ligne

La source reste le dossier « pas » sur iCloud (celui qu'ouvre l'appli Mac). Après une modification :

```sh
python3 outils/publier.py "<chemin du dossier pas>"
```

Le script recopie le code et remplace tous les fichiers de données par des fichiers vides,
puis on enregistre (commit) et on envoie (push). Les fonctions propres au Mac (lecture des dossiers
« Aménagements / Notifications » et « EDT AESH ») ne fonctionnent que dans l'appli Mac.
