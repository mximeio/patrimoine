// ============================================================
//  FILET DE DIAGNOSTIC — posé AVANT TOUT LE RESTE
//
//  Pourquoi ce bloc est ICI, dans le PREMIER fichier chargé par index.html :
//  il n'y a pas de bundler, chaque fichier de js/ est évalué séparément. Si
//  l'un d'eux échoue (syntaxe, global absent), les suivants s'exécutent quand
//  même mais les fonctions du fichier fautif n'existent jamais — et l'app
//  blanchit sans un mot. Un piège posé dans app.js (dernier chargé) arriverait
//  APRÈS l'erreur qu'il doit attraper. Il faut donc être premier.
//
//  ⚠️ VOLONTAIREMENT DANS UN FICHIER EXTERNE, ET NON EN SCRIPT INLINE dans
//  index.html : le Content-Security-Policy n'autorise les scripts inline que
//  par EMPREINTE sha256 (cf. index.html). Ajouter un inline obligerait à
//  recalculer l'empreinte à la main, et l'oublier bloquerait le script —
//  silencieusement. Un fichier externe ne coûte rien de tout ça.
//
//  ⚠️ AUCUNE DÉPENDANCE : ni React, ni styles.css, ni les helpers de utils.js.
//  Ce code doit fonctionner précisément quand tout le reste a échoué. D'où le
//  DOM à la main et les styles en ligne.
//
//  Trois sources d'erreur sont couvertes :
//   1. `error` en phase de CAPTURE → attrape aussi les BALISES qui ne se
//      chargent pas (script CDN bloqué par un bloqueur de contenu, réseau
//      filtré). C'est le seul moyen de voir un `<script>` mort.
//   2. `unhandledrejection` → les promesses (Firestore, service worker).
//   3. `window.__patrimoineErreur(...)` → appelé par l'ErrorBoundary React
//      d'app.js pour les erreurs de RENDU, que window.onerror ne voit pas.
//
//  Et un CHIEN DE GARDE : si #root est encore vide quelques secondes après le
//  chargement, on affiche quand même — ça couvre la page blanche SANS erreur
//  levée (React qui démonte l'arbre, rendu qui n'arrive jamais).
// ============================================================
(function () {
  var erreurs = [];
  var affichee = false;
  var echecs = {};   // url -> true, pour distinguer « bloqué » de « inopérant »

  // Les globales que l'app attend. Leur absence est souvent LA cause, et la
  // voir d'un coup d'œil sur une capture d'écran évite un aller-retour.
  function etatDesGlobales() {
    var noms = ['React', 'ReactDOM', 'Recharts', 'firebase'];
    var out = [];
    for (var i = 0; i < noms.length; i++) {
      out.push(noms[i] + ' : ' + (typeof window[noms[i]] === 'undefined' ? 'ABSENT' : 'ok'));
    }
    return out.join('  ·  ');
  }

  // 🔴 « firebase : ok » ne dit RIEN d'utile : la globale existe dès que
  // firebase-app-compat est chargé, alors que ce sont les SOUS-ESPACES
  // (auth, firestore) qui portent le service. Le 11/09/2026, un appareil a
  // planté sur `firebase.firestore` indéfini alors que cette ligne annonçait
  // « ok ». Un indicateur qui ne peut pas dire non ne dit rien.
  function etatDeFirebase() {
    if (typeof window.firebase === 'undefined') return 'firebase ABSENT';
    var f = window.firebase, out = [];
    out.push('SDK ' + (f.SDK_VERSION || '?'));
    out.push('apps=' + (f.apps && f.apps.length !== undefined ? f.apps.length : '?'));
    out.push('initializeApp:' + typeof f.initializeApp);
    out.push('auth:' + typeof f.auth);
    out.push('firestore:' + typeof f.firestore);
    try {
      out.push('FieldPath:' + (f.firestore ? typeof f.firestore.FieldPath : 'n/a'));
      out.push('FieldValue:' + (f.firestore ? typeof f.firestore.FieldValue : 'n/a'));
    } catch (e) { out.push('statics: lecture impossible (' + e.message + ')'); }
    return out.join('  ·  ');
  }

  // État de CHAQUE script externe.
  //
  // 🔴 ON NE PEUT PAS SE FIER À L'ÉVÉNEMENT `error` POUR CES BALISES-LÀ : elles
  // sont déclarées dans index.html AVANT js/config.js, donc leur échec de
  // chargement survient AVANT que ce piège soit posé. Dire « chargé » parce
  // qu'aucun échec n'a été signalé serait un mensonge — exactement le travers
  // de l'ancien indicateur « firebase : ok ».
  // ⇒ On vérifie donc le RÉSULTAT : la globale que chaque script doit définir.
  //   C'est la seule preuve disponible après coup, et c'est celle qui compte —
  //   un script peut aussi se charger sans s'exécuter correctement.
  var GLOBALES_ATTENDUES = [
    ['react-dom', function () { return window.ReactDOM; }],
    ['react', function () { return window.React; }],
    ['prop-types', function () { return window.PropTypes; }],
    ['recharts', function () { return window.Recharts; }],
    ['firebase-app', function () { return window.firebase; }],
    ['firebase-auth', function () { return window.firebase && window.firebase.auth; }],
    ['firebase-firestore', function () { return window.firebase && window.firebase.firestore; }],
  ];

  function attenduPour(src) {
    // react-dom avant react : « react » est contenu dans « react-dom ».
    for (var i = 0; i < GLOBALES_ATTENDUES.length; i++) {
      if (src.indexOf(GLOBALES_ATTENDUES[i][0]) !== -1) return GLOBALES_ATTENDUES[i];
    }
    return null;
  }

  function etatDesScripts() {
    var out = [];
    var tags = document.getElementsByTagName('script');
    for (var i = 0; i < tags.length; i++) {
      var src = tags[i].src || '';
      if (!src || src.indexOf('://') === -1) continue;
      if (src.indexOf(window.location.origin) === 0) continue;   // nos propres fichiers
      var etat;
      if (echecs[src]) {
        etat = 'ÉCHEC DE CHARGEMENT';
      } else {
        var att = attenduPour(src);
        if (!att) etat = 'chargement non vérifiable';
        else {
          var v;
          try { v = att[1](); } catch (e) { v = undefined; }
          etat = (typeof v === 'undefined') ? 'GLOBALE ABSENTE (non exécuté ?)' : 'ok';
        }
      }
      out.push('  [' + etat + '] ' + src.replace(/^https:\/\//, ''));
    }
    return out.join('\n');
  }

  function texteComplet() {
    var l = [];
    l.push('Patrimoine — rapport d\'erreur');
    l.push('Version : ' + (window.APP_BUILD || 'inconnue'));
    l.push('Environnement : ' + (window.FIREBASE_ENV || '?'));
    l.push('URL : ' + window.location.href);
    l.push('Date : ' + new Date().toISOString());
    l.push('Navigateur : ' + navigator.userAgent);
    l.push('Globales : ' + etatDesGlobales());
    l.push('Firebase : ' + etatDeFirebase());
    l.push('En ligne : ' + (navigator.onLine === false ? 'non' : 'oui'));
    l.push('Écran : ' + window.innerWidth + ' x ' + window.innerHeight
      + '  (doc ' + (document.documentElement ? document.documentElement.scrollWidth : '?') + ')');
    l.push('Scripts externes :');
    l.push(etatDesScripts());
    l.push('');
    for (var i = 0; i < erreurs.length; i++) {
      var e = erreurs[i];
      l.push('--- ' + (i + 1) + '/' + erreurs.length + ' [' + e.origine + '] ---');
      if (e.firebase) l.push('Firebase à cet instant : ' + e.firebase);
      // La pile commence en général par le message : ne pas le répéter. Sur une
      // capture d'écran de téléphone, deux lignes gagnées sont deux lignes de
      // pile visibles en plus.
      if (!e.stack) l.push(e.message);
      else if (e.stack.indexOf(e.message) === -1) l.push(e.message);
      if (e.stack) l.push(e.stack);
      if (e.source) l.push('Composants : ' + e.source);
      l.push('');
    }
    return l.join('\n');
  }

  function bouton(libelle, fond, onClick, large) {
    var b = document.createElement('button');
    b.textContent = libelle;
    b.setAttribute('type', 'button');
    b.style.cssText = 'box-sizing:border-box;flex:1 1 ' + (large ? '100%' : '120px') + ';padding:11px 12px;border:0;'
      + 'border-radius:8px;font:600 14px/1.2 -apple-system,system-ui,sans-serif;'
      + 'color:#fff;background:' + fond + ';';
    b.onclick = onClick;
    return b;
  }

  function afficher() {
    if (affichee || !document.body) return;
    affichee = true;

    var fond = document.createElement('div');
    fond.id = 'patrimoine-erreur';
    fond.style.cssText = 'box-sizing:border-box;position:fixed;inset:0;z-index:2147483647;background:#0f172a;color:#e2e8f0;'
      + 'padding:16px;overflow-x:hidden;overflow-y:auto;font:14px/1.5 -apple-system,system-ui,sans-serif;'
      + '-webkit-text-size-adjust:100%;';

    var titre = document.createElement('div');
    titre.textContent = 'L\'application n\'a pas pu démarrer';
    titre.style.cssText = 'font-size:19px;font-weight:700;color:#fca5a5;margin-bottom:4px;';

    var sous = document.createElement('div');
    sous.textContent = 'Fais une capture de cet écran et envoie-la. Tes données ne sont pas touchées.';
    sous.style.cssText = 'color:#94a3b8;font-size:13px;margin-bottom:14px;';

    // Zone de texte plutôt qu'un <pre> : sur iPhone, c'est ce qui permet de
    // sélectionner et copier sans se battre avec la sélection de page.
    // ⚠️ UN <div>, ET NON UN <textarea> — mesuré le 11/09/2026. Un textarea ne
    // coupe QU'AUX ESPACES : une URL ou une ligne de pile, qui n'en contient
    // aucun, dépasse le cadre et sort de la capture d'écran. Or la capture est
    // le seul canal disponible quand la personne est sur iPhone sans Mac.
    // `overflow-wrap:anywhere` sur un div coupe n'importe où, et rien n'est perdu.
    var zone = document.createElement('div');
    zone.setAttribute('data-rapport', '1');
    zone.textContent = texteComplet();
    zone.style.cssText = 'box-sizing:border-box;width:100%;max-width:100%;max-height:56vh;overflow:auto;background:#020617;'
      + 'color:#e2e8f0;border:1px solid #334155;border-radius:8px;padding:10px;'
      + 'font:12px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;'
      + 'white-space:pre-wrap;overflow-wrap:anywhere;-webkit-user-select:text;user-select:text;';

    var actions = document.createElement('div');
    actions.style.cssText = 'box-sizing:border-box;display:flex;gap:8px;flex-wrap:wrap;'
      + 'margin-top:12px;max-width:100%;';

    actions.appendChild(bouton('Copier le rapport', '#4f46e5', function () {
      var txt = texteComplet();
      // Presse-papiers quand il est disponible ; sinon on SÉLECTIONNE le bloc,
      // ce qui laisse le geste « Copier » natif d'iOS accessible.
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(txt).then(function () {
          this.textContent = 'Rapport copié';
        }.bind(this), selectionner);
      } else { selectionner(); }
      function selectionner() {
        try {
          var r = document.createRange();
          r.selectNodeContents(zone);
          var sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(r);
        } catch (e) {}
      }
    }));

    actions.appendChild(bouton('Recharger', '#334155', function () {
      window.location.reload();
    }));

    // Purge complète : service worker + caches. C'est le geste qui répare les
    // pages blanches dues à un état local abîmé — et il est impossible à faire
    // à la main sur iPhone sans passer par les réglages du système.
    actions.appendChild(bouton('Vider le cache et recharger', '#b45309', function () {
      var fini = function () { window.location.reload(true); };
      try {
        var taches = [];
        if (window.caches && caches.keys) {
          taches.push(caches.keys().then(function (noms) {
            return Promise.all(noms.map(function (n) { return caches.delete(n); }));
          }));
        }
        if (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) {
          taches.push(navigator.serviceWorker.getRegistrations().then(function (rs) {
            return Promise.all(rs.map(function (r) { return r.unregister(); }));
          }));
        }
        Promise.all(taches).then(fini, fini);
        setTimeout(fini, 3000);   // filet : on recharge même si une purge coince
      } catch (e) { fini(); }
    }, true));

    fond.appendChild(titre);
    fond.appendChild(sous);
    fond.appendChild(zone);
    fond.appendChild(actions);
    document.body.appendChild(fond);
  }

  // Rafraîchit le rapport si d'autres erreurs tombent après l'affichage.
  function rafraichir() {
    var f = document.getElementById('patrimoine-erreur');
    if (!f) return;
    var z = f.querySelector('div[data-rapport]');
    if (z) z.textContent = texteComplet();
  }

  window.__patrimoineErreur = function (err, origine, source) {
    var e = err || {};
    erreurs.push({
      // ⚠️ Photo prise ICI, à l'instant de l'erreur — surtout pas au moment du
      // rendu de l'overlay. Un sous-espace Firebase peut être indéfini pendant
      // le plantage et présent une seconde plus tard : lire à l'affichage
      // masquerait précisément la cause.
      firebase: etatDeFirebase(),
      origine: origine || 'inconnue',
      message: String(e.message || e || 'erreur sans message'),
      stack: e.stack ? String(e.stack).split('\n').slice(0, 8).join('\n') : '',
      source: source ? String(source).replace(/^\s*\n?/, '').replace(/\n\s+/g, ' > ') : '',
    });
    // Une ressource manquante n'est pas forcément fatale (une police, par
    // exemple). On la CONSIGNE mais on laisse le chien de garde décider :
    // il n'affichera que si l'app n'a effectivement rien rendu.
    if (origine !== 'ressource') {
      if (document.body) afficher(); else document.addEventListener('DOMContentLoaded', afficher);
    }
    rafraichir();
    return true;
  };

  window.addEventListener('error', function (ev) {
    var cible = ev && ev.target;
    if (cible && cible !== window && (cible.tagName === 'SCRIPT' || cible.tagName === 'LINK')) {
      var url = cible.src || cible.href || '(url inconnue)';
      echecs[url] = true;
      window.__patrimoineErreur(new Error('Ressource non chargée'), 'ressource', url);
      return;
    }
    window.__patrimoineErreur(
      (ev && ev.error) || new Error((ev && ev.message) || 'erreur'), 'script',
      ev && ev.filename ? ev.filename + ':' + ev.lineno + ':' + ev.colno : '');
  }, true);   // CAPTURE : indispensable pour voir les balises qui échouent

  window.addEventListener('unhandledrejection', function (ev) {
    window.__patrimoineErreur((ev && ev.reason) || new Error('promesse rejetée'), 'promesse');
  });

  // --- Chien de garde : page blanche SANS erreur levée ---
  // React 18 démonte tout l'arbre quand un rendu lève : #root se retrouve vide,
  // et si l'ErrorBoundary n'a pas pris le relais, rien ne le dit. On regarde
  // donc le RÉSULTAT, pas l'intention.
  function surveiller() {
    var essais = 0;
    var t = setInterval(function () {
      essais++;
      var root = document.getElementById('root');
      var vide = !root || root.childElementCount === 0;
      if (!vide) { clearInterval(t); return; }      // l'app affiche : rien à dire
      if (essais >= 4) {                            // ~8 s de page vide
        clearInterval(t);
        if (erreurs.length === 0) {
          window.__patrimoineErreur(
            new Error('Aucune erreur JavaScript n\'a été signalée, mais l\'application '
              + 'n\'a rien affiché au bout de 8 secondes.'), 'chien-de-garde');
        } else {
          afficher();
        }
      }
    }, 2000);
  }
  if (document.readyState === 'complete') surveiller();
  else window.addEventListener('load', surveiller);
})();

// ============================================================
//  CONFIGURATION FIREBASE
//  Switch automatique selon l'environnement :
//   - localhost / 127.0.0.1 → projet de DEV (données de test, isolé)
//   - mximeio.github.io/patrimoine-dev/ → projet de DEV également
//     (dépôt GitHub Pages dédié aux tests sur smartphone AVANT la prod).
//     ⚠️ Le hostname est le MÊME que la prod (pages de projet GitHub) :
//     c'est donc le PATHNAME qui fait foi ici. Sans cette règle, le site
//     de dev taperait silencieusement dans les données réelles.
//   - tout le reste (mximeio.github.io, etc.) → projet de PROD
// ============================================================

const FIREBASE_CONFIG_PROD = {
  apiKey: "AIzaSyAPyx7tOV4siixbnGWj045x8YZC1Nj7diU",
  authDomain: "patrimoine-4e140.firebaseapp.com",
  projectId: "patrimoine-4e140",
  storageBucket: "patrimoine-4e140.firebasestorage.app",
  messagingSenderId: "231346070554",
  appId: "1:231346070554:web:05577b8d6afe52a5e45da3"
};

const FIREBASE_CONFIG_DEV = {
  apiKey: "AIzaSyDr5JNNdXkusJ-J8lJvD3fau9-hX57S4LU",
  authDomain: "patrimoine-dev-79e27.firebaseapp.com",
  projectId: "patrimoine-dev-79e27",
  storageBucket: "patrimoine-dev-79e27.firebasestorage.app",
  messagingSenderId: "190393082160",
  appId: "1:190393082160:web:9c7f0ea59a416e103668f5"
};

const isLocalhost = window.location.hostname === 'localhost'
                 || window.location.hostname === '127.0.0.1'
                 || window.location.hostname === '0.0.0.0';
// Dépôt GitHub Pages de dev : même hostname que la prod, mais servi sous
// /patrimoine-dev/ → environnement de DEV.
const isDevPages = window.location.pathname.startsWith('/patrimoine-dev');
const isDev = isLocalhost || isDevPages;

window.FIREBASE_CONFIG = isDev ? FIREBASE_CONFIG_DEV : FIREBASE_CONFIG_PROD;
window.FIREBASE_ENV = isDev ? 'dev' : 'prod';
window.CONFIG_NEEDED = Object.values(window.FIREBASE_CONFIG).some(v => !v || v === "REMPLACE_MOI");

// ============================================================
//  GESTION DES UTILISATEURS
//  Les comptes ne peuvent PAS être créés depuis l'application : ils sont
//  créés exclusivement depuis la console Firebase (Authentication → Users
//  → Add user), puis un mail d'invitation (Reset password) est envoyé à
//  l'utilisateur pour qu'il définisse son propre mot de passe.
//
//  Configuration recommandée côté Firebase :
//   - Authentication → Settings → User actions →
//     Désactiver "Enable create (sign-up)".
//   - Les Firestore rules (firestore.rules) appliquent ensuite la
//     restriction par UID, ce qui est suffisant puisque seuls les comptes
//     créés par l'administrateur peuvent exister.
// ============================================================

// Log pour ne pas se tromper de base par mégarde
console.info(`[Patrimoine] Firebase env: ${window.FIREBASE_ENV} (projet ${window.FIREBASE_CONFIG.projectId})`);
