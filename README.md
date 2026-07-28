# Patrimoine

Application web personnelle de suivi de patrimoine : compte courant, épargne,
investissements et actifs physiques, avec une vue consolidée.

Progressive Web App installable sur mobile, fonctionnant hors ligne.

> **Projet personnel**, publié ici pour être hébergé par GitHub Pages. Le code
> est visible mais n'est pas conçu pour être réutilisé tel quel : il dépend d'un
> projet Firebase précis et de comptes créés à la main.

---

## Modules

| Module | Contenu |
|---|---|
| **Compte courant** | Entrées / sorties d'un mois, pointage bancaire, lignes composites, tickets restaurant, mois figés, opérations récurrentes pré-remplies. Plusieurs comptes possibles. |
| **Épargne** | Livrets, avec versements, retraits et intérêts ; solde calculé. |
| **Investissements** | Enveloppes (PEA, etc.) et supports/ETF. Versements, achats, ventes, dividendes, frais, réceptions gratuites. Valorisations saisies manuellement. |
| **Actifs physiques** | Métaux précieux, pièces — quantité × prix unitaire. |
| **Patrimoine** | Vue consolidée : total, répartition, évolution mensuelle. |
| **Répartition des charges** | Budget partagé entre deux personnes, par scénarios (50/50, prorata des revenus, montants fixes). Document Firestore partagé, accessible aux seuls membres. |

Recherche globale sur l'ensemble des modules (`Cmd/Ctrl + K`).

---

## Comment c'est construit

- **React 18** (build UMD) + **Recharts**, chargés depuis un CDN avec contrôle
  d'intégrité (SRI) et versions strictement épinglées.
- **Pas de bundler, pas de modules ES.** Chaque fichier de `js/` définit des
  fonctions et constantes globales ; **l'ordre des balises `<script>` dans
  `index.html` fait foi**. Un fichier ne peut référencer, au moment de son
  chargement, que ce qui a été chargé avant lui.
- **Firebase** : Authentification (email / mot de passe) et Firestore, avec
  persistance locale — l'application reste utilisable hors ligne et se
  resynchronise ensuite.
- **Service worker** (`sw.js`) : met la coquille de l'application en cache pour
  un démarrage sans réseau, et signale les nouvelles versions.
- **Tout le CSS dans un seul fichier** (`styles.css`).

---

## ⚠️ `js/` contient les sources, pas ce qui est servi

Les fichiers de `js/` sont écrits en **JSX** et **ne sont pas exécutables
directement par un navigateur**.

C'est la GitHub Action (`.github/workflows/deploy.yml`) qui les compile en
JavaScript avec [esbuild](https://esbuild.github.io/) et publie le résultat.
Autrement dit :

| | Dans ce dépôt | Sur le site publié |
|---|---|---|
| `js/ui.js` | JSX (source) | JavaScript compilé |

Servir ce dépôt tel quel produirait une avalanche de
`Uncaught SyntaxError: Unexpected token '<'` : le navigateur essaierait
d'exécuter du JSX. Il faut compiler d'abord.

---

## Déploiement

GitHub Pages, avec `Source: GitHub Actions`. À chaque envoi sur `main`, le
workflow :

1. vérifie les sources (17 fichiers dans `js/`, statiques présents, aucune trace
   de Babel) ;
2. compile chaque fichier de `js/` en JavaScript pur (cible `es2020`, **sans**
   minification — le code servi reste lisible) ;
3. attribue un numéro de version et l'applique aux paramètres `?v=` de
   `index.html` et `sw.js` ;
4. contrôle des invariants : une seule version référencée, et chaque fichier
   compilé présent à la fois dans `index.html` **et** dans la liste de pré-cache
   du service worker ;
5. publie le tout comme artefact Pages.

Le dépôt ne contient donc **jamais** de code compilé, et le déploiement est
atomique : `index.html`, `sw.js` et `js/` sont publiés ensemble. Le paramètre
`?v=` présent dans les sources n'est qu'un repère, réécrit à chaque publication.

Si le workflow échoue, rien n'est publié et le site reste sur la version
précédente.

---

## Développement local

`index.html` ne charge pas de compilateur : il faut compiler le JSX avant de
servir le dossier.

```bash
# compiler les sources dans un dossier de travail
mkdir -p /tmp/patrimoine/js
cp index.html styles.css sw.js manifest*.json *.png /tmp/patrimoine/
npx esbuild js/*.js --loader:.js=jsx --target=es2020 --outdir=/tmp/patrimoine/js

# servir
cd /tmp/patrimoine && python3 -m http.server 8000
```

Puis <http://localhost:8000>.

En `localhost`, `config.js` bascule automatiquement sur le projet Firebase de
développement : aucun risque de toucher aux données réelles.

Deux points utiles en développement :

- **Désactiver le service worker.** Il sert son cache en priorité, ce qui masque
  les recompilations. Le plus simple est de neutraliser son enregistrement dans
  la copie locale d'`index.html`.
- **Cible `es2020` minimum.** Une cible plus basse échoue : esbuild refuse de
  transformer le déstructurage pour `safari14` et antérieur.

---

## Données et sécurité

- Les données vivent dans **Firestore**, cloisonnées par utilisateur
  (`users/{uid}/…`). Le document partagé `joint/main` sert au module de
  répartition des charges, réservé à ses membres.
- **Aucune inscription depuis l'application.** Les comptes sont créés
  exclusivement depuis la console Firebase, puis l'utilisateur définit son mot de
  passe via un lien de réinitialisation.
- La configuration Firebase présente dans `config.js` est **publique par
  conception** : côté client, une clé d'API Firebase n'est pas un secret. La
  sécurité repose sur les **règles Firestore** et sur l'absence d'inscription
  libre.
- Deux environnements séparés, choisis automatiquement d'après l'adresse : un
  projet de développement en `localhost` et sous `/patrimoine-dev`, le projet
  réel partout ailleurs.
- Sauvegardes automatiques hebdomadaires restaurables, plus une sauvegarde
  systématique **avant** tout import ou toute restauration.

---

## Structure

```
index.html          ordre de chargement des scripts (fait foi)
styles.css          tout le CSS
sw.js               service worker (cache hors ligne, détection de mise à jour)
manifest.json       PWA (+ manifest-dev.json pour l'environnement de test)
js/
  config.js         configuration Firebase + choix de l'environnement
  utils.js          formatage, dates, helpers partagés
  adapter.js        accès Firestore, abonnements temps réel, migrations
  compute.js        calculs purs (aucune entrée/sortie)
  ui.js             composants transverses (modale, bulles, champs montants…)
  dnd.js            glisser-déposer des lignes
  auth.js           écran de connexion
  settings.js       réglages, supports, opérations récurrentes, export/import
  backups.js        sauvegardes et restauration
  checking.js       compte courant
  savings.js        épargne
  physical.js       actifs physiques
  investments.js    enveloppes et supports
  consolidated.js   vue patrimoine consolidée
  search.js         recherche globale
  charges.js        répartition des charges
  app.js            racine, routage, abonnements
```

---

## Licence

Aucune. Projet personnel publié pour son hébergement — pas de réutilisation
prévue, pas de support, pas de contributions attendues.
