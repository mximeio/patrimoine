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

// L'ACCUEIL SE COMPORTE COMME UN ONGLET D'APP iPHONE : il garde son état et ne rejoue pas son entrée (décision de
// l'utilisateur, 22/10/2026). ⚠️ La vue est DÉMONTÉE quand on quitte l'onglet (`app.js` ne la rend que sur le sien) :
// un `useState` repartirait de zéro au retour. Ce qui doit durer vit donc au niveau du FICHIER : ça survit au
// démontage et disparaît au rechargement, exactement la durée d'une session.
// ⚠️ Pas de `localStorage` : c'est un réglage de LECTURE, pas un endroit où l'on travaille. À la relance, 12M.
// (La bascule anneau / évolution et son champ `vue` ont disparu avec l'anneau, le 14/11/2026 : modernisation C'.)
const SESSION_ACCUEIL = { periode: '12', dejaAffiche: false };

// L'ANIMATION DU GRAPHIQUE D'ÉVOLUTION. Recharts anime l'entrée en 1,5 s par défaut, et la rejouait à chaque bascule et à chaque retour sur l'onglet : ce n'était pas un calcul.
// Règle : entrée en 300 ms au PREMIER affichage de la session, puis plus aucune entrée animée (elle n'apprend rien et
// retarde la lecture) ; un changement de données affiché garde sa transition courte, qui montre ce qui a bougé ; rien
// du tout avec « Réduire les animations », que le bloc `prefers-reduced-motion` de styles.css n'atteint pas —
// l'animation est en JavaScript.
const DUREE_ANIMATION_GRAPHIQUE = 300;
function dureeAnimationGraphique(reduit, entree, dejaAffiche) {
  if (reduit) return 0;
  if (entree && dejaAffiche) return 0;
  return DUREE_ANIMATION_GRAPHIQUE;
}

// La durée à passer à UN graphique — par instance.
// 🔴 Une DURÉE NULLE, jamais `isAnimationActive` qu'on basculerait : dans Recharts 2.12.7, passer `isAnimationActive`
//  de faux à vrai REJOUE l'entrée entière (vécu sur l'anneau, retiré depuis).
//  Une durée nulle fait poser l'état final dès la construction de l'animation (react-smooth, `duration <= 0`).
// 🔴 Le hook s'appelle DANS le composant que rend `ResponsiveContainer` (`EvolutionAiresChart`), jamais au-dessus. `ResponsiveContainer` ne monte le graphique qu'au rendu SUIVANT, une fois
//  sa taille mesurée dans son effet, en clonant ses enfants DU MOMENT. Appelé dans le parent (DEV v1099), le hook
//  décidait au premier rendu de la carte : qu'un état d'`App` soit posé dans la même vague d'effets, et la carte se
//  redessinait en « mise à jour » (300 ms) avant la naissance du graphique — l'entrée s'animait au retour sur l'onglet
//  (reproduit sur banc le 22/10/2026). Ici, le premier rendu du composant EST la naissance du graphique, quel que soit
//  le minutage ; `entree` passe à faux dans son effet, après.
function useDureeAnimationGraphique() {
  const entree = useRef(true);
  const dejaAffiche = useRef(SESSION_ACCUEIL.dejaAffiche);
  useEffect(() => { entree.current = false; SESSION_ACCUEIL.dejaAffiche = true; }, []);
  const reduit = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  return dureeAnimationGraphique(reduit, entree.current, dejaAffiche.current);
}

// La courbe du bas de la carte de tête : le total, mois par mois, en SVG simple (pas de Recharts : 44 px, ni axe ni
// bulle). Bords francs à gauche et à droite, la carte la recadre.
function MiniCourbe({ valeurs }) {
  const W = 600, H = 44;
  const min = Math.min(...valeurs), max = Math.max(...valeurs);
  const ecart = max - min || 1;
  const x = (i) => (i / (valeurs.length - 1)) * W;
  const y = (v) => 4 + (1 - (v - min) / ecart) * (H - 8);
  let d = '';
  valeurs.forEach((v, i) => {
    if (!i) { d = `M0 ${y(v).toFixed(1)}`; return; }
    const cx = ((x(i - 1) + x(i)) / 2).toFixed(1);
    d += ` C${cx} ${y(valeurs[i - 1]).toFixed(1)} ${cx} ${y(v).toFixed(1)} ${x(i).toFixed(1)} ${y(v).toFixed(1)}`;
  });
  return (
    <div className="ct-courbe" aria-hidden="true">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        <defs>
          <linearGradient id="ct-courbe-fond" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="#818cf8" stopOpacity="0.45" />
            <stop offset="1" stopColor="#818cf8" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={`${d} L${W} ${H} L0 ${H}Z`} fill="url(#ct-courbe-fond)" />
        <path d={d} fill="none" stroke="#a5b4fc" strokeWidth="2" vectorEffect="non-scaling-stroke" />
      </svg>
    </div>
  );
}

// L'ACCUEIL C' (modernisation, 14/11/2026 — maquette _maquettes/Mockup-Modernisation-Design/cartes2.html) :
// - la carte de tête, avec la courbe des douze derniers mois en pied et la variation sur la période en pastille ;
// - (l'encart « Ce mois-ci » et l'alerte de valorisation, à sa droite sur ordinateur, sont retirés depuis le 15/11/2026) ;
// - « Mes rubriques » : une carte pleine de sa couleur par rubrique, EMPILÉES sur téléphone (le haut de chacune
//   dépasse, la dernière est entière), côte à côte sur ordinateur ;
// - « Évolution » : la courbe du total, avec la période en tête de section.
// L'anneau de répartition est retiré : la part de chaque rubrique est écrite sur sa carte (« … % du total »).
function ConsolidatedView({ ctx, onNavigate }) {
  const { profile, checkingAccounts, savings, portfolios, physical, snapshots } = ctx;
  const enabled = profile.modulesEnabled;
  // La période de la section « Évolution », retenue pour la session (cf. `SESSION_ACCUEIL`).
  const [period, setPeriodEtat] = useState(SESSION_ACCUEIL.periode);
  const setPeriod = (p) => { SESSION_ACCUEIL.periode = p; setPeriodEtat(p); };

  // Référence = mois calendaire courant (on ignore les mois futurs créés pour planifier).
  // À défaut, le mois créé le plus récent qui n'est pas dans le futur.
  // Multi-comptes : on agrège tous les comptes courants.
  const cur = currentMonthKey();
  const checkingPerAccount = (checkingAccounts || []).map(acc => {
    const realKeys = Object.keys(acc.months || {}).filter(k => k <= cur).sort();
    const refKey = realKeys[realKeys.length - 1] || null;
    const stats = refKey ? computeMonth(acc, refKey) : null;
    return { refKey, stats, balance: stats ? stats.balanceProjected : (acc.initialBalance || 0) };
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
  // « % du total » → PARTS DES AVOIRS (15/11/2026, décision de l'utilisateur, après un cas pratique) : la part d'une rubrique se
  // calcule sur la somme des rubriques POSITIVES. Tant que tout est positif, c'est exactement le « % du total » d'avant ; dès
  // qu'une rubrique est négative (en pratique, le compte courant à découvert), les autres affichent « x % des avoirs » — juste,
  // stable quand le compte courant bouge, et jamais 112 % ou 337 % comme l'ancien calcul sur le total net (−33 105 € de
  // découvert) — et la rubrique négative n'affiche pas de part (celle d'une dette n'a pas de sens).
  const avoirs = categories.reduce((s, c) => s + Math.max(0, c.value), 0);
  const aDecouvert = categories.some(c => c.value < 0);
  const libellePart = aDecouvert ? 'des avoirs' : 'du total';
  const part = (c) => (c.value >= 0 && avoirs > 0) ? `${fmtPct((c.value / avoirs) * 100, { signe: false })} ${libellePart}` : null;

  const investmentsGain = portfolios.reduce((s, p) => {
    const ps = computePortfolioStats(p.data);
    return s + ps.totalGain;
  }, 0);
  const physicalGainTotal = physicalTotal - physicalInvestedTotal;

  const totalGain = (enabled.investments ? investmentsGain : 0) + (enabled.physical ? physicalGainTotal : 0);
  const totalGainPositive = totalGain >= 0;
  const avecPlusValue = enabled.investments || enabled.physical;

  // La série mensuelle, mois courant intégré à la volée (au cas où son instantané n'aurait pas encore été écrit).
  const currentSnapshot = { checking: checkingBalance, savings: savingsTotal, investments: investmentsTotal, physical: physicalTotal, total: totalPatrimoine };
  const series = useMemo(() => {
    const merged = (snapshots || []).filter(s => s.monthKey !== cur).slice();
    merged.push({ monthKey: cur, ...currentSnapshot });
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
  }, [snapshots, cur, checkingBalance, savingsTotal, investmentsTotal, physicalTotal, totalPatrimoine]);

  // La carte de tête porte TOUJOURS les douze derniers mois, quelle que soit la période de la section « Évolution ».
  const douze = series.slice(-12);
  const avecCourbe = douze.length >= 2;
  const variation = avecCourbe ? r2(douze[douze.length - 1].total - douze[0].total) : 0;

  const evolution = period === '3' ? series.slice(-3) : period === '12' ? series.slice(-12) : series;

  // Plus d'alerte de valorisation sur l'accueil (15/11/2026, décision de l'utilisateur, ordinateur compris) : elle reste en haut
  // de la page Investissements. Plus d'encart « Ce mois-ci » non plus (même jour) : la projection est déjà sur la carte du compte
  // courant, et « à pointer » ne sert à rien à qui pointe au jour le jour. La carte de tête prend toute la largeur.

  const periods = [{ key: '3', label: '3M' }, { key: '12', label: '12M' }, { key: 'all', label: 'Tout' }];
  const signe = (n) => `${n >= 0 ? '+' : ''}${fmt(n)} €`;

  return (
    <div>
      <div className="accueil-haut">
        <CarteDeTete
          module="overview" libelle="Patrimoine total" montant={totalPatrimoine}
          droite={avecCourbe && <span className="ct-pill">{signe(variation)} depuis {monthLabelShort(douze[0].monthKey)}</span>}
          pied={avecCourbe ? [] : [avecPlusValue && { label: 'Plus-value totale', value: signe(totalGain) }]}
        >
          {avecCourbe && <MiniCourbe valeurs={douze.map(p => p.total)} />}
        </CarteDeTete>
      </div>

      <section className="section-accueil">
        <div className="section-tete"><h2>Mes rubriques</h2></div>
        <div className="pile-rub" style={{ '--n': categories.length }}>
          {categories.map(c => (
            <button key={c.id} type="button" className={`carte-rub carte-rub--${c.id}`} style={{ background: CARTE_FONDS[c.id] }}
              onClick={() => onNavigate(c.id)} aria-label={`Ouvrir ${c.label}`}>
              {/* Le pourcentage est écrit DEUX fois : sous le montant (téléphone, où les cartes se chevauchent et où seul le haut
                  de chacune se voit — 15/11/2026) et en pied de carte (ordinateur, cartes côte à côte) ; le CSS n'en montre qu'un. */}
              <span className="carte-rub-rang">
                {/* L'info de la rubrique (« 3 comptes », « 2 actifs »…) sous le nom au téléphone, comme le pourcentage sous le
                    montant (maquette Mockup-Cartes-Accueil-Telephone, piste B, 15/11/2026) ; en pied sur ordinateur. */}
                <span className="carte-rub-nom"><i><Icon name={c.icon} size={17} /></i>
                  <span className="carte-rub-nomw"><span>{c.label}</span><span className="carte-rub-sub">{c.sub}</span></span>
                </span>
                <span className="carte-rub-droite">
                  <span className="carte-rub-mt num">{eur(c.value)}</span>
                  {part(c) && <span className="carte-rub-pc num">{part(c)}</span>}
                </span>
              </span>
              <span className="carte-rub-bas">
                <span>{c.sub}</span>
                {part(c) && <span className="num carte-rub-pc-bas">{part(c)}</span>}
              </span>
            </button>
          ))}
        </div>
      </section>

      <section className="section-accueil">
        <div className="section-tete">
          <h2>Évolution</h2>
          <div className="period-toggle" role="group" aria-label="Période">
            {periods.map(p => (
              <button key={p.key} type="button" className={period === p.key ? 'active' : ''} aria-pressed={period === p.key} onClick={() => setPeriod(p.key)}>{p.label}</button>
            ))}
          </div>
        </div>
        <div className="card evo-carte">
          {avecPlusValue && <div className="evo-sous">dont <b className="num">{signe(totalGain)}</b> de plus-value</div>}
          <PatrimoineEvolutionChart data={evolution} enabled={enabled} profile={profile} />
        </div>
      </section>
    </div>
  );
}

// ============================================================
//  GRAPHIQUE D'ÉVOLUTION (aires empilées par catégorie)
// ============================================================
function PatrimoineEvolutionChart({ data, enabled, profile }) {
  // Si on n'a qu'un seul point, l'AreaChart n'a rien à tracer.
  if (data.length < 2) {
    return (
      <div style={{ padding: '32px 16px', textAlign: 'center', color: COLORS.muted, fontSize: 13 }}>
        Pas encore assez d'historique pour tracer une évolution.<br />
        <span style={{ fontSize: 12 }}>Les premières données apparaîtront au fil des mois.</span>
      </div>
    );
  }
  // Les rubriques ne se dessinent plus (une seule courbe, le total — modernisation C', 14/11/2026), mais la bulle les
  // détaille toujours, dans l'ORDRE FIXE de l'app — celui de la barre des onglets et des cartes (15/11/2026, décision de
  // l'utilisateur : l'ordre par montant, utile quand les aires s'empilaient, changeait avec la période).
  const categories = [
    enabled.checking !== false && { key: 'checking', label: checkingModuleLabel(profile), color: MODULE_COLORS.checking },
    enabled.savings && { key: 'savings', label: 'Épargne', color: MODULE_COLORS.savings },
    enabled.investments && { key: 'investments', label: 'Investissements', color: MODULE_COLORS.investments },
    enabled.physical && { key: 'physical', label: 'Actifs physiques', color: MODULE_COLORS.physical },
  ].filter(Boolean);
  return (
    <RedessinARotation>
    <ResponsiveContainer width="100%" height={200}>
      <EvolutionAiresChart data={data} categories={categories} />
    </ResponsiveContainer>
    </RedessinARotation>
  );
}

// La courbe du total, rendue PAR `ResponsiveContainer` : la durée s'y décide, et le nom finit par `Chart` pour
// recevoir son `style` (cf. le commentaire de `useDureeAnimationGraphique`). Un changement de période la redessine
// sans la remonter : la transition courte montre ce qui a bougé.
// La courbe du TOTAL en gris ardoise, la couleur de la carte « Patrimoine total » (15/11/2026, décision de l'utilisateur) :
// en indigo, elle se lisait comme celle du compte courant, dont la carte est juste au-dessus.
const COURBE_TOTAL = '#2a2f4a';
function EvolutionAiresChart({ data, categories, width, height, style }) {
  const duree = useDureeAnimationGraphique();
  return (
    <AreaChart width={width} height={height} style={style} data={data} margin={{ top: 8, right: 0, left: 0, bottom: 0 }}>
      <defs>
        <linearGradient id="evo-fond" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor={COURBE_TOTAL} stopOpacity={0.18} />
          <stop offset="1" stopColor={COURBE_TOTAL} stopOpacity={0} />
        </linearGradient>
      </defs>
      <XAxis dataKey="label" tick={{ fontSize: 11, fill: COLORS.muted }} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={16} />
      <YAxis hide domain={['dataMin', 'dataMax']} />
      <Tooltip content={<EvolutionTooltip categories={categories} />} cursor={{ stroke: COLORS.muted, strokeWidth: 1, strokeDasharray: '3 3' }} />
      <Area type="monotone" dataKey="total" stroke={COURBE_TOTAL} strokeWidth={2.5} fill="url(#evo-fond)"
        animationBegin={0} animationDuration={duree} />
    </AreaChart>
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
      padding: '10px 14px', borderRadius: 'var(--r-touche)',
      fontSize: 12, boxShadow: '0 8px 24px rgba(15,23,42,0.10)',
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
