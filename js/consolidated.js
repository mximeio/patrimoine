// ============================================================
//  VUE CONSOLIDÉE PATRIMOINE
// ============================================================

// Le fond de la carte de tête de la vue d'ensemble (21/10/2026) : son liseré prend les QUATRE couleurs des
// rubriques, dans l'ordre de la barre — le tout est la somme des parties. Il était indigo, la couleur du compte
// courant : deux pages différentes se ressemblaient.
// ⚠️ Toujours les quatre, même si l'utilisateur n'a pas activé toutes les rubriques (décision de
// l'utilisateur) : c'est une marque, pas une donnée — les montants réels sont dans le graphique en dessous.
// SEGMENTS FONDUS depuis la DEV v1094 (choix de l'utilisateur, _maquettes/Mockup-Lisere-Accueil-Degrade.html, 4) :
// chaque couleur tient son quart, puis se fond dans la suivante sur ~14 % de la hauteur. Ils étaient séparés par
// 3 px transparents. ✖ Écarté : un dégradé continu, qui passait par un vert olive entre le vert et l'ambre et ne
// laissait chaque couleur pure qu'en un point. Mélange en OKLCH ; un navigateur qui ne le connaît pas rejette la
// déclaration et garde le fond de `.hero-card`, sans liseré. Peint dans le fond par `styleCarteDeTete` (ui.js).
// ⚠️ Le gris clair a été écarté : 1,4:1 avec le fond de page, il s'y fondait.
const LISERE_PATRIMOINE = (() => {
  const c = [MODULE_COLORS.checking, MODULE_COLORS.savings, MODULE_COLORS.investments, MODULE_COLORS.physical];
  return `linear-gradient(to bottom in oklch, ${c[0]} 0 18%, ${c[1]} 32% 43%, ${c[2]} 57% 68%, ${c[3]} 82% 100%)`;
})();

function ConsolidatedView({ ctx, onNavigate }) {
  const { profile, checkingAccounts, savings, portfolios, physical, snapshots } = ctx;
  const enabled = profile.modulesEnabled;
  // La vue du graphique de la carte « Répartition » : l'anneau ou l'évolution. On ouvre toujours sur l'anneau.
  const [vue, setVue] = useState('repartition');

  // Référence = mois calendaire courant (on ignore les mois futurs créés pour planifier).
  // À défaut, le mois créé le plus récent qui n'est pas dans le futur.
  // Multi-comptes : on agrège tous les comptes courants.
  const cur = currentMonthKey();
  const checkingPerAccount = (checkingAccounts || []).map(acc => {
    const realKeys = Object.keys(acc.months || {}).filter(k => k <= cur).sort();
    const refKey = realKeys[realKeys.length - 1] || null;
    const stats = refKey ? computeMonth(acc, refKey) : null;
    return { refKey, balance: stats ? stats.balanceProjected : (acc.initialBalance || 0) };
  });
  const checkingBalance = checkingPerAccount.reduce((s, p) => s + p.balance, 0);
  const refKeysAll = checkingPerAccount.map(p => p.refKey).filter(Boolean).sort();
  const latestRefKey = refKeysAll[refKeysAll.length - 1] || null;
  const checkingSub = latestRefKey
    ? (checkingAccounts.length > 1
        ? `${checkingAccounts.length} comptes · proj. fin ${monthLabel(latestRefKey).toLowerCase()}`
        : `Projeté fin ${monthLabel(latestRefKey).toLowerCase()}`)
    : 'Solde initial';

  const savingsTotal = savings.reduce((s, a) => s + computeSavingsBalance(a), 0);

  const investmentsCurrent = portfolios.reduce((s, p) => {
    return s + (p.data?.etfs || []).reduce((ss, e) => ss + (p.data?.currentValues?.[e.id] || 0), 0);
  }, 0);
  const investmentsCash = portfolios.reduce((s, p) => {
    const ps = computePortfolioStats(p.data);
    return s + ps.cashRemaining;
  }, 0);
  const investmentsTotal = investmentsCurrent + investmentsCash;

  const physicalTotal = physical.reduce((s, a) => s + physicalCurrentValue(a), 0);
  const physicalInvestedTotal = physical.reduce((s, a) => s + physicalInvested(a), 0);

  const checkingEnabled = enabled.checking !== false;
  const categories = [
    checkingEnabled && { id: 'checking', label: checkingModuleLabel(profile), icon: 'creditCard', color: MODULE_COLORS.checking, value: checkingBalance, sub: checkingSub },
    enabled.savings && { id: 'savings', label: 'Épargne', icon: 'piggy', color: MODULE_COLORS.savings, value: savingsTotal, sub: `${savings.length} compte${savings.length > 1 ? 's' : ''}` },
    enabled.investments && { id: 'investments', label: 'Investissements', icon: 'chart', color: MODULE_COLORS.investments, value: investmentsTotal, sub: `${portfolios.length} enveloppe${portfolios.length > 1 ? 's' : ''}` },
    enabled.physical && { id: 'physical', label: 'Actifs physiques', icon: 'coin', color: MODULE_COLORS.physical, value: physicalTotal, sub: `${physical.length} actif${physical.length > 1 ? 's' : ''}` },
  ].filter(Boolean);

  const totalPatrimoine = categories.reduce((s, c) => s + c.value, 0);
  const pieData = categories.map(c => ({ ...c, name: c.label }));

  const investmentsGain = portfolios.reduce((s, p) => {
    const ps = computePortfolioStats(p.data);
    return s + ps.totalGain;
  }, 0);
  const physicalGainTotal = physicalTotal - physicalInvestedTotal;

  const totalGain = (enabled.investments ? investmentsGain : 0) + (enabled.physical ? physicalGainTotal : 0);
  const totalGainPositive = totalGain >= 0;
  return (
    <div>
      <div className="card hero-card" style={{ ...styleCarteDeTete(LISERE_PATRIMOINE), marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 500 }}>Patrimoine total</div>
          <ModuleBadge module="overview" />
        </div>
        <div className="num hero-value-big" style={{ marginTop: 6 }}>{fmt(totalPatrimoine)} €</div>
        {(enabled.investments || enabled.physical) && (
          <div style={{ display: 'flex', gap: 24, marginTop: 16, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)' }}>Plus-value totale</div>
              <div className="num" style={{ fontSize: 16, fontWeight: 600, color: totalGainPositive ? '#86efac' : '#fca5a5' }}>
                {totalGainPositive ? '+' : ''}{fmt(totalGain)} €
              </div>
            </div>
          </div>
        )}
      </div>

      {/* La répartition en UNE carte (21/10/2026, maquette Mockup-Vue-Ensemble-Rubriques, P2) : l'anneau, puis la
          liste des rubriques, qui en est la légende. Chaque rubrique était une carte à part (≈ 70 px + 12 px d'écart,
          316 px pour quatre) avec sa couleur répétée quatre fois — liseré, tuile, titre, montant — et un texte coloré
          illisible pour le cyan, le vert et l'ambre (2,1 à 2,5:1). Désormais les lignes de 60 px du reste de l'app
          (`.portfolio-list-row`, comme « Mes comptes d'épargne », chevron compris) : texte noir, la couleur ne
          marque plus que la tuile, avec la nuance foncée du module (`MODULE_FONCES`).
          La même carte montre aussi l'ÉVOLUTION (21/10/2026, maquette Mockup-Vue-Ensemble-Evolution) : une bascule à
          deux icônes, au coin, fait passer de l'anneau aux aires empilées, à la même hauteur (240 px) — la liste reste
          la légende des deux vues. Elle remplace le bouton « Afficher l'évolution » et le second graphique déplié.
          L'en-tête court sur TOUTE la largeur : sur ordinateur, les deux colonnes du dessous prennent la même hauteur et
          le graphique s'y centre — avec l'en-tête dans la colonne de gauche, l'anneau et la liste n'avaient pas le même
          centre (≈ 30 px d'écart, relevé par l'utilisateur). */}
      <div className="card repartition-card" style={{ marginBottom: 16 }}>
        <div className="repartition-tete">
          <div>
            <div style={{ fontSize: 12, color: COLORS.muted, fontWeight: 500, marginBottom: 4 }}>{vue === 'evolution' ? 'ÉVOLUTION' : 'RÉPARTITION'}</div>
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>{vue === 'evolution' ? 'Patrimoine dans le temps' : 'Patrimoine par catégorie'}</h3>
          </div>
          <div className="period-toggle bascule-vue" role="group" aria-label="Vue du graphique">
            <button type="button" className={vue === 'repartition' ? 'active' : ''} aria-pressed={vue === 'repartition'} aria-label="Répartition" title="Répartition" onClick={() => setVue('repartition')}>
              <Icon name="repartition" size={14} />
            </button>
            <button type="button" className={vue === 'evolution' ? 'active' : ''} aria-pressed={vue === 'evolution'} aria-label="Évolution" title="Évolution" onClick={() => setVue('evolution')}>
              <Icon name="evolution" size={14} />
            </button>
          </div>
        </div>
        <div className="repartition-corps">
          <div className="repartition-graphe">
            {vue === 'evolution' ? (
              <PatrimoineEvolutionChart
                snapshots={snapshots}
                currentSnapshot={{
                  checking: checkingBalance,
                  savings: savingsTotal,
                  investments: investmentsTotal,
                  physical: physicalTotal,
                  total: totalPatrimoine,
                }}
                enabled={enabled}
                profile={profile}
              />
            ) : (
              <div style={{ position: 'relative', height: 240 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={pieData} dataKey="value" nameKey="label" cx="50%" cy="50%" innerRadius="62%" outerRadius="90%" paddingAngle={3} stroke="none">
                      {pieData.map(p => <Cell key={p.id} fill={p.color} />)}
                    </Pie>
                    {/* `zIndex` : l'étiquette « TOTAL » du centre est posée APRÈS le graphique
                        dans la page, donc dessinée par-dessus la bulle quand celle-ci tombe au
                        centre — d'où l'effet de bulle « transparente » signalé sur iPhone et sur
                        ordinateur (19/10/2026). La bulle doit passer devant. */}
                    <Tooltip content={<CustomTooltip />} wrapperStyle={{ zIndex: 2 }} />
                  </PieChart>
                </ResponsiveContainer>
                <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', textAlign: 'center', pointerEvents: 'none' }}>
                  <div style={{ fontSize: 11, color: COLORS.muted }}>TOTAL</div>
                  <div className="num" style={{ fontSize: 22, fontWeight: 600 }}>{fmtNoDec(totalPatrimoine)} €</div>
                </div>
              </div>
            )}
          </div>

          <div className="repartition-liste">
            {categories.map(c => (
              <button key={c.id} className="portfolio-list-row" onClick={() => onNavigate(c.id)} aria-label={`Ouvrir ${c.label}`}>
                <div className="portfolio-list-icon" style={{ background: c.color + '26', color: MODULE_FONCES[c.id] }}>
                  <Icon name={c.icon} size={12} />
                </div>
                <div className="portfolio-list-main">
                  <div className="portfolio-list-name">{c.label}</div>
                  <div className="portfolio-list-sub">{c.sub}</div>
                </div>
                <div className="portfolio-list-right">
                  <div className="num" style={{ fontSize: 14, fontWeight: 600 }}>{fmt(c.value)}<span className="currency-muted"> €</span></div>
                  <div className="portfolio-list-sub num">
                    {totalPatrimoine > 0 ? ((c.value / totalPatrimoine) * 100).toFixed(2) : '0.00'}%
                  </div>
                </div>
                <span className="portfolio-list-arrow" aria-hidden="true">›</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================
//  GRAPHIQUE D'ÉVOLUTION (aires empilées par catégorie)
// ============================================================
function PatrimoineEvolutionChart({ snapshots, currentSnapshot, enabled, profile }) {
  const [period, setPeriod] = useState('12');

  // On reconstruit la série en intégrant le mois courant à la volée
  // (au cas où le snapshot du mois courant n'aurait pas encore été écrit).
  const series = useMemo(() => {
    const curKey = currentMonthKey();
    const merged = (snapshots || []).filter(s => s.monthKey !== curKey).slice();
    merged.push({ monthKey: curKey, ...currentSnapshot });
    merged.sort((a, b) => a.monthKey.localeCompare(b.monthKey));
    return merged.map(s => ({
      monthKey: s.monthKey,
      label: monthLabelShort(s.monthKey),
      labelFull: monthLabel(s.monthKey),
      checking: r2(s.checking || 0),
      savings: r2(s.savings || 0),
      investments: r2(s.investments || 0),
      physical: r2(s.physical || 0),
      total: r2(s.total || 0),
    }));
  }, [snapshots, currentSnapshot]);

  const data = useMemo(() => {
    if (period === '3') return series.slice(-3);
    if (period === '12') return series.slice(-12);
    return series;
  }, [series, period]);

  // Si on n'a qu'un seul point, l'AreaChart n'a rien à tracer.
  if (data.length < 2) {
    return (
      <div style={{ padding: '32px 16px', textAlign: 'center', color: COLORS.muted, fontSize: 13 }}>
        Pas encore assez d'historique pour tracer une évolution.<br />
        <span style={{ fontSize: 12 }}>Les premières données apparaîtront au fil des mois.</span>
      </div>
    );
  }

  const categories = [
    // Fix : `enabled &&` (objet toujours truthy) incluait le Compte courant
    // même module désactivé — l'ancien fallback unshift datait d'avant la
    // possibilité de désactiver le module (v6).
    enabled.checking !== false && { key: 'checking', label: checkingModuleLabel(profile), color: MODULE_COLORS.checking },
    enabled.savings && { key: 'savings', label: 'Épargne', color: MODULE_COLORS.savings },
    enabled.investments && { key: 'investments', label: 'Investissements', color: MODULE_COLORS.investments },
    enabled.physical && { key: 'physical', label: 'Actifs physiques', color: MODULE_COLORS.physical },
  ].filter(Boolean);

  // Empilement trié par TAILLE (moyenne sur la période affichée), la plus
  // grosse catégorie EN BAS : seule la bande du bas repose sur une ligne
  // droite (le zéro) et se lit fidèlement — celles du dessus chevauchent
  // les ondulations des bandes inférieures. Avant ce tri, le Compte
  // courant (petit et volatil) était en bas et propageait ses dents de
  // scie à tout l'empilement. Moyenne (et non dernier point) pour un
  // ordre stable dans la vue. Le tooltip suit le même ordre.
  const avgByKey = {};
  for (const c of categories) {
    avgByKey[c.key] = data.length
      ? data.reduce((s, d) => s + (d[c.key] || 0), 0) / data.length
      : 0;
  }
  const sortedCategories = [...categories].sort((a, b) => avgByKey[b.key] - avgByKey[a.key]);

  const periods = [
    { key: '3', label: '3M' },
    { key: '12', label: '12M' },
    { key: 'all', label: 'Tout' },
  ];

  // Rendu DANS la carte « Répartition » depuis le 21/10/2026 : ni carte, ni titre (c'est l'en-tête de la carte qui
  // dit « Évolution »), ni légende — la liste des rubriques, sous le graphique, en tient lieu. La période se pose au-
  // dessus du graphique, à droite ; période + graphique = la hauteur réservée à l'anneau (`.repartition-graphe`).
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
        <div className="period-toggle">
          {periods.map(p => (
            <button
              key={p.key}
              className={period === p.key ? 'active' : ''}
              onClick={() => setPeriod(p.key)}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>
      <ResponsiveContainer width="100%" height={240}>
        <AreaChart data={data} margin={{ top: 6, right: 8, left: -10, bottom: 0 }}>
          <CartesianGrid stroke={COLORS.border} strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: COLORS.muted }} tickLine={false} axisLine={{ stroke: COLORS.border }} />
          <YAxis
            tick={{ fontSize: 11, fill: COLORS.muted }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v) => v >= 1000 ? `${Math.round(v / 1000)}k` : `${v}`}
            width={50}
          />
          <Tooltip content={<EvolutionTooltip categories={sortedCategories} />} cursor={{ stroke: COLORS.muted, strokeWidth: 1, strokeDasharray: '3 3' }} />
          {/* Premier <Area> rendu = bande du BAS de l'empilement */}
          {sortedCategories.map(c => (
            <Area
              key={c.key}
              type="monotone"
              dataKey={c.key}
              stackId="1"
              stroke={c.color}
              strokeWidth={1}
              fill={c.color}
              fillOpacity={0.85}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

// Tooltip du graphique d'évolution — fond BLANC, aligné sur le tooltip
// standard des autres graphiques (CustomTooltip dans ui.js) : c'était le
// seul habillage sombre de l'app hors hero cards (héritage v1), l'ombre et
// le liseré suffisent à le détacher des aires colorées.
function EvolutionTooltip({ active, payload, categories }) {
  if (!active || !payload || !payload.length) return null;
  const d = payload[0].payload;
  return (
    <div style={{
      background: COLORS.surface, color: COLORS.text,
      border: `1px solid ${COLORS.border}`,
      padding: '10px 14px', borderRadius: 10,
      fontSize: 12.5, boxShadow: '0 8px 24px rgba(15,23,42,0.10)',
      minWidth: 200,
    }}>
      <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 8, paddingBottom: 6, borderBottom: `1px solid ${COLORS.border}` }}>
        {d.labelFull}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 14, marginBottom: 6, paddingBottom: 6, borderBottom: `1px solid ${COLORS.border}`, fontWeight: 600 }}>
        <span>Total</span>
        <span className="num">{fmt(d.total)} €</span>
      </div>
      {categories.map(c => (
        <div key={c.key} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, marginTop: 4, color: COLORS.text }}>
          <span style={{ width: 8, height: 8, borderRadius: 2, background: c.color, flexShrink: 0 }} />
          <span style={{ flex: 1, color: COLORS.muted }}>{c.label}</span>
          <span className="num" style={{ fontWeight: 600 }}>{fmt(d[c.key])} €</span>
        </div>
      ))}
    </div>
  );
}
