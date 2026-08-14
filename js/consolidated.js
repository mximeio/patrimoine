// ============================================================
//  VUE CONSOLIDÉE PATRIMOINE
// ============================================================

function ConsolidatedView({ ctx, onNavigate }) {
  const { profile, checkingAccounts, savings, portfolios, physical, snapshots } = ctx;
  const enabled = profile.modulesEnabled;
  const [showEvolution, setShowEvolution] = useState(false);

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
      <div className="card hero-card" style={{ borderLeft: `4px solid ${COLORS.accent}`, marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 500 }}>Patrimoine total</div>
          <div style={{
            width: 32, height: 32, borderRadius: 8,
            background: 'rgba(79,70,229,0.22)', color: '#a5b4fc',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}>
            <Icon name="wallet" size={16} />
          </div>
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

      <div className="grid-overview" style={{ marginBottom: 16, alignItems: 'stretch', gridTemplateColumns: '1fr 1fr' }}>
        <div className="card" style={{ background: 'white', display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontSize: 12, color: COLORS.muted, fontWeight: 500, marginBottom: 4 }}>RÉPARTITION</div>
          <h3 style={{ margin: '0 0 16px', fontSize: 16, fontWeight: 600 }}>Patrimoine par catégorie</h3>
          <div style={{ flex: 1, position: 'relative', minHeight: 240 }}>
            <ResponsiveContainer width="100%" height="100%" minHeight={240}>
              <PieChart>
                <Pie data={pieData} dataKey="value" nameKey="label" cx="50%" cy="50%" innerRadius="62%" outerRadius="90%" paddingAngle={3} stroke="none">
                  {pieData.map(p => <Cell key={p.id} fill={p.color} />)}
                </Pie>
                <Tooltip content={<CustomTooltip />} />
              </PieChart>
            </ResponsiveContainer>
            <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', textAlign: 'center', pointerEvents: 'none' }}>
              <div style={{ fontSize: 11, color: COLORS.muted }}>TOTAL</div>
              <div className="num" style={{ fontSize: 22, fontWeight: 600 }}>{fmtNoDec(totalPatrimoine)} €</div>
            </div>
          </div>
          {/* Légende retirée : redondante avec les cards de catégorie ci-contre
              (mêmes libellé / montant / %). */}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {categories.map(c => (
            <button key={c.id} className="card card-hover" onClick={() => onNavigate(c.id)} style={{ background: 'white', cursor: 'pointer', textAlign: 'left', display: 'flex', gap: 14, alignItems: 'center', borderLeft: `3px solid ${c.color}` }}>
              <div style={{ width: 40, height: 40, borderRadius: 10, background: c.color + '22', color: c.color, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Icon name={c.icon} size={18} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: c.color }}>{c.label}</div>
                <div style={{ fontSize: 11, color: COLORS.muted }}>{c.sub}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div className="num" style={{ fontSize: 17, fontWeight: 600, color: c.color }}>{fmt(c.value)}<span className="currency-muted"> €</span></div>
                <div style={{ fontSize: 11, color: COLORS.muted }}>
                  {totalPatrimoine > 0 ? ((c.value / totalPatrimoine) * 100).toFixed(2) : '0.00'}%
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* GRAPHIQUE D'ÉVOLUTION — replié par défaut */}
      <div style={{ marginBottom: 16 }}>
        {/* v530 : chevron vectoriel ROTATIF (règle v528) au lieu des deux
            glyphes ▴/▾ — dernier glyphe flèche de l'app. Le libellé garde
            ses deux états, seule la flèche pivote. */}
        <button className="btn-add evo-toggle" style={{ borderStyle: 'solid' }} onClick={() => setShowEvolution(s => !s)}>
          <span className={`evo-chev${showEvolution ? ' open' : ''}`}><Icon name="chevronDown" size={12} /></span>
          {showEvolution ? "Masquer l'évolution" : "Afficher l'évolution"}
        </button>
      </div>
      {showEvolution && (
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
      )}
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
      <div className="card" style={{ background: 'white', marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <div>
            <div style={{ fontSize: 12, color: COLORS.muted, fontWeight: 500 }}>ÉVOLUTION</div>
            <h3 style={{ margin: '2px 0 0', fontSize: 16, fontWeight: 600 }}>Patrimoine — répartition par catégorie</h3>
          </div>
        </div>
        <div style={{ padding: '32px 16px', textAlign: 'center', color: COLORS.muted, fontSize: 13 }}>
          Pas encore assez d'historique pour tracer une évolution.<br />
          <span style={{ fontSize: 12 }}>Les premières données apparaîtront au fil des mois.</span>
        </div>
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

  return (
    <div className="card" style={{ background: 'white', marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 10 }}>
        <div>
          <div style={{ fontSize: 12, color: COLORS.muted, fontWeight: 500 }}>ÉVOLUTION</div>
          <h3 style={{ margin: '2px 0 0', fontSize: 16, fontWeight: 600 }}>Patrimoine — répartition par catégorie</h3>
        </div>
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
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 10, paddingTop: 12, borderTop: `1px solid ${COLORS.border}`, fontSize: 12, color: COLORS.muted }}>
        {categories.map(c => (
          <div key={c.key} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: c.color }} />
            {c.label}
          </div>
        ))}
      </div>
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
