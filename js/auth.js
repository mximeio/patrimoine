// ============================================================
//  ÉCRAN D'AUTHENTIFICATION
//  Les comptes sont créés par l'administrateur depuis la console Firebase.
//  L'utilisateur reçoit un mail de réinitialisation pour définir son
//  mot de passe initial. Il n'y a donc pas de mode "créer un compte" ici.
// ============================================================

function AuthScreen() {
  const [mode, setMode] = useState('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [info, setInfo] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null); setInfo(null); setBusy(true);
    try {
      if (mode === 'signin') await Adapter.signIn(email, password);
      else if (mode === 'reset') {
        await Adapter.sendReset(email);
        setInfo('Email de réinitialisation envoyé. Vérifie ta boîte (et les spams).');
      }
    } catch (err) { setError(Adapter.translateAuthError(err)); }
    finally { setBusy(false); }
  };

  const titles = {
    signin: { title: 'Connexion', cta: 'Se connecter' },
    reset: { title: 'Réinitialiser le mot de passe', cta: 'Envoyer le mail' },
  };
  const t = titles[mode];

  // LA FORME C' (modernisation, 14/11/2026) : la carte sombre de l'accueil, posée sur la pile des quatre rubriques
  // dont on voit dépasser les bords (indigo, cyan, vert, ambre) — on reconnaît l'app avant même d'y entrer. Puis le
  // formulaire sur le fond blanc, sans cadre, aux champs de toute l'app, et le grand bouton des fenêtres.
  return (
    <div className="auth">
      <div className="auth-colonne">
        <div className="auth-pile" aria-hidden="true">
          <span className="auth-bord auth-bord--physical" />
          <span className="auth-bord auth-bord--investments" />
          <span className="auth-bord auth-bord--savings" />
          <span className="auth-bord auth-bord--checking" />
        </div>
        <div className="auth-carte">
          <LogoPatrimoine size={44} />
          <div>
            <h1>Patrimoine</h1>
            <p>{t.title}</p>
          </div>
        </div>
        {error && <div className="auth-msg auth-msg--erreur" role="alert">{error}</div>}
        {info && <div className="auth-msg auth-msg--info" role="status">{info}</div>}
        <form onSubmit={handleSubmit} className="auth-form">
          <div>
            <label className="label" htmlFor="auth-email">Email</label>
            <input id="auth-email" type="email" value={email} onChange={e => setEmail(e.target.value)} className="input" required autoComplete="email" />
          </div>
          {mode !== 'reset' && (
            <div>
              <label className="label" htmlFor="auth-mdp">Mot de passe</label>
              <input id="auth-mdp" type="password" value={password} onChange={e => setPassword(e.target.value)} className="input" required minLength={6} autoComplete="current-password" />
            </div>
          )}
          <button type="submit" className="btn btn-accent btn-lg auth-bouton" disabled={busy}>
            {busy ? 'Patiente...' : t.cta}
          </button>
        </form>
        <div className="auth-pied">
          {mode === 'signin' && (
            <button type="button" className="auth-lien" onClick={() => setMode('reset')}>Mot de passe oublié</button>
          )}
          {mode !== 'signin' && (
            <button type="button" className="auth-lien" onClick={() => setMode('signin')}>← Retour à la connexion</button>
          )}
          <div className="auth-note">Besoin d'un compte&nbsp;? Adressez-vous à l'administrateur.</div>
        </div>
      </div>
    </div>
  );
}
