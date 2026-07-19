/* ============================================================
   Service worker — mode hors ligne (introduit en v522)

   Rôle : mettre en cache la coquille de l'app (HTML, CSS, JS,
   manifest, icônes) et les dépendances CDN pour que la PWA
   démarre et fonctionne sans réseau. Les DONNÉES, elles, sont
   déjà hors ligne via la persistance Firestore (adapter.js,
   enablePersistence) : ce fichier ne s'occupe QUE des fichiers.

   Mise à jour : la chaîne '?v=NNN' ci-dessous est réécrite par
   le MÊME sed que le cache-busting d'index.html — la routine de
   bump doit donc s'appliquer à index.html ET sw.js. Un bump
   change le contenu de ce fichier → le navigateur installe un
   nouveau SW en arrière-plan → l'app affiche le toast
   « Nouvelle version disponible » (voir app.js) → « Recharger »
   envoie SKIP_WAITING ici, controllerchange recharge la page.
   « Plus tard » : la nouvelle version s'activera d'elle-même au
   prochain démarrage complet de la PWA.

   Jamais intercepté : les domaines Firebase (Firestore/Auth
   temps réel gèrent eux-mêmes leur hors-ligne), et sw.js
   lui-même n'est jamais mis en cache (le navigateur doit
   toujours pouvoir détecter une nouvelle version).
   ============================================================ */

const VERSION = '?v=547'.replace('?v=', 'v'); // réécrit par le sed de bump
const CACHE = 'patrimoine-' + VERSION;
const RUNTIME = 'patrimoine-runtime-' + VERSION;

// --- Coquille de l'app (même origine) — URLs identiques à index.html ---
const APP_SHELL = [
  './',
  'index.html',
  'styles.css?v=547',
  'manifest.json?v=547',
  'manifest-dev.json?v=547',
  'apple-touch-icon.png?v=547',
  'icon-192.png',
  'icon-512.png',
  'icon-maskable-512.png',
  'js/config.js?v=547',
  'js/utils.js?v=547',
  'js/adapter.js?v=547',
  'js/compute.js?v=547',
  'js/ui.js?v=547',
  'js/dnd.js?v=547',
  'js/auth.js?v=547',
  'js/settings.js?v=547',
  'js/checking.js?v=547',
  'js/savings.js?v=547',
  'js/physical.js?v=547',
  'js/investments.js?v=547',
  'js/consolidated.js?v=547',
  'js/search.js?v=547',
  'js/charges.js?v=547',
  'js/app.js?v=547',
];

// --- Dépendances CDN (versions pinées, immuables) ---
// index.html les charge avec crossorigin="anonymous" + SRI : il faut donc
// mettre en cache des réponses CORS COMPLÈTES (une réponse opaque ferait
// échouer le contrôle d'intégrité). unpkg et gstatic servent tous deux
// Access-Control-Allow-Origin: *.
const CDN = [
  'https://unpkg.com/react@18.3.1/umd/react.production.min.js',
  'https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js',
  'https://unpkg.com/prop-types@15.8.1/prop-types.min.js',
  'https://unpkg.com/recharts@2.12.7/umd/Recharts.js',
  'https://unpkg.com/@babel/standalone@7.29.7/babel.min.js',
  'https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth-compat.js',
  'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore-compat.js',
];

// --- Domaines JAMAIS interceptés (temps réel Firebase) ---
const PASSTHROUGH_HOSTS = [
  'firestore.googleapis.com',
  'identitytoolkit.googleapis.com',
  'securetoken.googleapis.com',
  'www.googleapis.com',
  'firebaseinstallations.googleapis.com',
];

self.addEventListener('install', (event) => {
  // PAS de skipWaiting ici : le nouveau SW attend sagement que
  // l'utilisateur choisisse « Recharger » (ou le prochain démarrage).
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(APP_SHELL);
    await Promise.all(CDN.map(async (url) => {
      const resp = await fetch(url, { mode: 'cors', credentials: 'omit' });
      if (!resp.ok) throw new Error('Pré-cache CDN échoué : ' + url);
      await cache.put(url, resp);
    }));
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // Purge des caches des versions précédentes
    const names = await caches.keys();
    await Promise.all(names.map((n) => {
      if (n.indexOf('patrimoine-') === 0 && n !== CACHE && n !== RUNTIME) {
        return caches.delete(n);
      }
      return null;
    }));
    // Prend la main sur les onglets ouverts (le reload post-mise à jour
    // est déclenché côté page par controllerchange, avec garde-fou pour
    // ne PAS recharger lors de la toute première installation).
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch (e) { return; }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return;
  if (PASSTHROUGH_HOSTS.indexOf(url.hostname) !== -1) return;

  // Navigation (démarrage de la PWA) : RÉSEAU d'abord — index.html n'est
  // pas versionné, c'est lui qui porte les ?v=NNN — puis cache si hors ligne.
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const cache = await caches.open(CACHE);
        cache.put('index.html', fresh.clone());
        return fresh;
      } catch (e) {
        const cached = await caches.match('index.html');
        return cached || Response.error();
      }
    })());
    return;
  }

  // Tout le reste : CACHE d'abord (les fichiers versionnés sont immuables),
  // réseau sinon, avec mise en cache runtime au passage (polices Google
  // notamment, dont les URLs varient selon le navigateur).
  event.respondWith((async () => {
    const cached = await caches.match(req);
    if (cached) return cached;
    const resp = await fetch(req);
    if (resp && (resp.ok || resp.type === 'opaque')) {
      const runtime = await caches.open(RUNTIME);
      runtime.put(req, resp.clone());
    }
    return resp;
  })());
});
