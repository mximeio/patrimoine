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
