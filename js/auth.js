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

  return (
    <div style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ maxWidth: 420, width: '100%' }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ width: 48, height: 48, background: COLORS.text, borderRadius: 12, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 700, fontSize: 22, marginBottom: 16 }}>P</div>
          <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0, letterSpacing: '-0.02em' }}>Patrimoine</h1>
          <p style={{ color: COLORS.muted, fontSize: 14, margin: '6px 0 0' }}>{t.title}</p>
        </div>
        <div style={{ background: 'white', border: `1px solid ${COLORS.border}`, borderRadius: 14, padding: 28, boxShadow: '0 1px 3px rgba(15,23,42,0.05)' }}>
          {error && <div style={{ padding: 10, marginBottom: 16, background: 'var(--danger-light)', color: COLORS.danger, fontSize: 13, borderRadius: 8 }}>{error}</div>}
          {info && <div style={{ padding: 10, marginBottom: 16, background: 'var(--success-light)', color: COLORS.success, fontSize: 13, borderRadius: 8 }}>{info}</div>}
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <label className="label">Email</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} className="input" required autoComplete="email" />
            </div>
            {mode !== 'reset' && (
              <div>
                <label className="label">Mot de passe</label>
                <input type="password" value={password} onChange={e => setPassword(e.target.value)} className="input" required minLength={6} autoComplete="current-password" />
              </div>
            )}
            <button type="submit" className="btn btn-accent btn-lg" disabled={busy} style={{ marginTop: 6, opacity: busy ? 0.6 : 1 }}>
              {busy ? 'Patiente...' : t.cta}
            </button>
          </form>
          <div style={{ marginTop: 20, paddingTop: 16, borderTop: `1px solid ${COLORS.border}`, fontSize: 13, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {mode === 'signin' && (
              <a onClick={() => setMode('reset')} style={{ color: COLORS.muted, cursor: 'pointer' }}>Mot de passe oublié</a>
            )}
            {mode !== 'signin' && (
              <a onClick={() => setMode('signin')} style={{ color: COLORS.muted, cursor: 'pointer' }}>← Retour à la connexion</a>
            )}
            <div style={{ color: COLORS.muted, fontSize: 12, marginTop: 4 }}>
              Besoin d'un compte&nbsp;? Adressez-vous à l'administrateur.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
