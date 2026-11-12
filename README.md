# Cockpit Coordo

Le cockpit de suivi AESH. **Ce dépôt sert de sauvegarde du code.**

👉 **Ouvrir l'appli :** https://cockpit-coordo.netlify.app/
👉 **Fiches élèves AESH (NFC / QR) :** https://fiches-eleves.netlify.app/

L'ancienne adresse https://cecilehanan-prog.github.io/cockpit-coordo/ renvoie automatiquement vers Netlify
(et retire l'ancienne appli installée depuis github.io, pour qu'elle ne reste pas en cache).

## Ce qu'il y a dans le dépôt

| Dossier | Contenu |
|---|---|
| `en-ligne/` | L'appli en ligne, telle qu'elle est déposée sur Netlify (site cockpit-coordo). |
| `mac/` | Le code de l'appli Mac (à copier dans iCloud › COORDO AESH › Documents › pas). |
| racine | Les pages de redirection servies par GitHub Pages. |

## Les données ne sont pas ici

Ce dépôt est public : il ne contient **aucune donnée d'élève ni d'AESH**, seulement le code.

- Dans `en-ligne/js/`, les fichiers de données (`data.js`, `pial-donnees.js`, `ess-donnees.js`,
  `dossiers-*.js`, `mopps-items.js`) sont vides. Les données arrivent par la synchro chiffrée
  ou par « Données & exports › Importer JSON » et restent sur l'appareil.
- Dans `mac/`, seuls les 8 fichiers de code sont sauvegardés. Les fichiers de données du dossier « pas »
  et le dossier « EDT AESH » restent sur le Mac. Dans `mac/js/app.js`, les questions pré-remplies
  (qui citaient des élèves) sont retirées : **ne pas recopier ce fichier par-dessus celui du Mac.**
  Pour mettre le Mac à jour, utiliser le zip livré dans le projet.

## Synchronisation chiffrée (Mac, iPad, iPhone)

`js/sync.js` chiffre toutes les données sur l'appareil (AES-GCM, clé tirée d'une phrase secrète) avant
de les envoyer dans le projet Firebase « cockpit-coordo ». Firebase ne stocke qu'un bloc illisible.
`js/sync-config.js` contient les identifiants **publics** de ce projet Firebase : ce n'est pas un secret,
la sécurité vient des règles Firestore et de la phrase secrète.
