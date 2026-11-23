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
const SESSION_ACCUEIL = { periode: '12' };

// L'ANIMATION DU GRAPHIQUE D'ÉVOLUTION. Recharts anime l'entrée en 1,5 s par défaut, et la rejouait à chaque bascule et à chaque retour sur l'onglet : ce n'était pas un calcul.
// Règle : AUCUNE entrée animée, même au premier affichage de la session (décision de l'utilisateur du 23/11/2026, sur la
// question du 22/10 « l'animation est là juste pour faire joli ? » ; jusque-là, 300 ms la première fois) — elle n'apprend rien
// et retarde la lecture ; un changement de données affiché garde sa transition courte, qui montre ce qui a bougé ; rien du
// tout avec « Réduire les animations », que le bloc `prefers-reduced-motion` de styles.css n'atteint pas — l'animation est en
// JavaScript.
const DUREE_ANIMATION_GRAPHIQUE = 300;
function dureeAnimationGraphique(reduit, entree) {
  if (reduit || entree) return 0;
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
  useEffect(() => { entree.current = false; }, []);
  const reduit = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  return dureeAnimationGraphique(reduit, entree.current);
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
      <>
        <div style={{ padding: '32px 16px', textAlign: 'center', color: COLORS.muted, fontSize: 13 }}>
          Pas encore assez d'historique pour tracer une évolution.<br />
          <span style={{ fontSize: 12 }}>Les premières données apparaîtront au fil des mois.</span>
        </div>
      </>
    );
  }
  // Les rubriques ne se dessinent plus (une seule courbe, le total — modernisation C', 14/11/2026), mais la lecture d'un mois
  // les détaille toujours, dans l'ORDRE FIXE de l'app — celui de la barre des onglets et des cartes (15/11/2026, décision de
  // l'utilisateur).
  const categories = [
    enabled.checking !== false && { key: 'checking', label: checkingModuleLabel(profile), color: MODULE_COLORS.checking },
    enabled.savings && { key: 'savings', label: 'Épargne', color: MODULE_COLORS.savings },
    enabled.investments && { key: 'investments', label: 'Investissements', color: MODULE_COLORS.investments },
    enabled.physical && { key: 'physical', label: 'Actifs physiques', color: MODULE_COLORS.physical },
  ].filter(Boolean);
  // LA LIGNE DU REPOS : la VARIATION DE LA PÉRIODE affichée (23/11/2026, décision de l'utilisateur). Elle remplace « dont … de
  // plus-value », qui troublait à côté de la pastille de la carte de tête (« +4 810.12 € depuis juin 26 ») : deux mesures
  // différentes — la plus-value compte depuis l'achat et ne suit pas la période — sous des boutons de période. Désormais, à 12M,
  // le même chiffre que la pastille ; à 3M et « Tout », celui de la période. La plus-value reste en tête des pages
  // Investissements et Actifs physiques (et sur la carte de tête tant qu'il n'y a pas de courbe).
  const variation = r2(data[data.length - 1].total - data[0].total);
  const ligneValeur = (
    <div className="evo-sous">
      <span className={`num evo-variation ${variation >= 0 ? 'evo-ecart--pos' : 'evo-ecart--neg'}`}>{variation >= 0 ? '+' : ''}{fmt(variation)} €</span> depuis {data[0].label}
    </div>
  );
  return <EvolutionLue data={data} categories={categories} ligneValeur={ligneValeur} />;
}

// LA LECTURE D'UN MOIS, À UN ENDROIT FIXE (rang 3 du backlog ; maquette Claude Design « Courbe d'évolution, lecture fixe »,
// forme E3, validée par l'utilisateur le 23/11/2026). Plus de bulle : au doigt, elle couvrait la moitié du graphique, posée sur
// les mois voisins — ceux avec lesquels on compare. Principe posé le 19/10/2026 : une valeur de graphique s'affiche à un
// endroit FIXE, jamais sous le doigt. La ligne du haut de la carte devient la lecture :
// - au repos : la variation de la période (« +4 810.12 € depuis juin 26 ») et l'invite « Touchez (Survolez) la courbe pour lire un mois » ;
// - en lecture : le mois (13 px, 600), l'écart depuis le début de la période AVANT le total (règle des deltas, 13/08/2026 ;
//   modèle `.total-fen`), le total (14 px, 600) ; dessous, les rubriques — la première à gauche, la dernière à droite sous le
//   total, les autres réparties ; chaque montant a la largeur du plus long de la période, pour que RIEN NE BOUGE pendant la
//   lecture ; on écrit LE PLUS COMPLET QUI TIENT (23/11/2026) : noms et centimes (ordinateur), noms seuls (768 px), centimes
//   seuls (iPhone 17 Pro Max, 440 px), sinon les pastilles et les euros ronds (iPhone 15 Pro, 393 px) — `detailRubriques`.
// La zone a une hauteur fixe ; la courbe rend ce qu'elle prend : la carte garde sa hauteur d'avant (258 px au téléphone).
// LE GESTE (règle Apple des gestes ambigus) : le doigt qui part à l'HORIZONTALE (10 px) lit et suit le doigt, puis au lever on
// revient au repos ; à la VERTICALE la page défile et rien ne s'affiche (règle « rien pendant un glissement » de la DEV v1291) ;
// un TOUCHER FRANC affiche le mois au lever, jusqu'au toucher suivant ailleurs ou au défilement. À la souris : le survol.
// Pas d'animation d'arrivée (décision du 23/11/2026) ; un changement de période garde sa transition courte.
const HAUTEUR_COURBE = 172;
function EvolutionLue({ data, categories, ligneValeur }) {
  const [lu, setLu] = useState(null);       // l'indice du mois lu ; null = au repos
  const surface = useRef(null);
  const zone = useRef(null);
  const geste = useRef(null);               // un toucher en cours : { x, y, etat: 'attente' | 'lecture' }
  const fixe = useRef(false);               // la lecture vient d'un toucher franc : elle reste affichée
  const [largeurZone, setLargeurZone] = useState(0);
  const n = data.length;
  // Une autre période remet au repos (la clé, et non le tableau, recréé à chaque rendu de la vue).
  const cle = `${n}:${data[0].monthKey}`;
  useEffect(() => { fixe.current = false; setLu(null); }, [cle]);
  useEffect(() => {
    const el = zone.current;
    if (!el) return undefined;
    const maj = () => setLargeurZone(el.clientWidth);
    maj();
    const ro = window.ResizeObserver ? new ResizeObserver(maj) : null;
    if (ro) ro.observe(el);
    return () => { if (ro) ro.disconnect(); };
  }, []);
  // La lecture d'un toucher franc se ferme au toucher suivant hors de la courbe et au défilement — comme les bulles d'aide.
  useEffect(() => {
    const ailleurs = (e) => {
      if (fixe.current && surface.current && !surface.current.contains(e.target)) { fixe.current = false; setLu(null); }
    };
    const defile = () => { if (fixe.current) { fixe.current = false; setLu(null); } };
    document.addEventListener('pointerdown', ailleurs, { capture: true, passive: true });
    document.addEventListener('scroll', defile, { capture: true, passive: true });
    return () => {
      document.removeEventListener('pointerdown', ailleurs, { capture: true });
      document.removeEventListener('scroll', defile, { capture: true });
    };
  }, []);

  const indexDe = (clientX) => {
    const r = surface.current.getBoundingClientRect();
    return indexMoisLu(clientX - r.left, r.width, n);
  };
  const appui = (e) => {
    if (e.pointerType === 'mouse') return;
    fixe.current = false;
    geste.current = { x: e.clientX, y: e.clientY, etat: 'attente' };
  };
  const deplacement = (e) => {
    if (e.pointerType === 'mouse') { setLu(indexDe(e.clientX)); return; }
    const g = geste.current;
    if (!g) return;
    if (g.etat === 'attente') {
      const intention = intentionGeste(e.clientX - g.x, e.clientY - g.y);
      if (intention === 'defilement') { geste.current = null; return; }
      if (intention !== 'lecture') return;
      g.etat = 'lecture';
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch (_) { /* le doigt est déjà sorti : la lecture suit quand même */ }
    }
    setLu(indexDe(e.clientX));
  };
  const lever = (e) => {
    if (e.pointerType === 'mouse') return;
    const g = geste.current;
    geste.current = null;
    if (!g) return;
    if (g.etat === 'attente') { fixe.current = true; setLu(indexDe(e.clientX)); }   // toucher franc : le mois s'affiche et reste
    else setLu(null);                                                              // fin d'une lecture : retour au repos
  };
  const annuler = () => { geste.current = null; if (!fixe.current) setLu(null); };
  const sortie = (e) => { if (e.pointerType === 'mouse') setLu(null); };

  // Les largeurs fixes des montants (le plus long de la période, chiffres comptés comme des « 0 » : le canvas ignore
  // `tabular-nums`), en euros ronds et avec les centimes, et celles des noms : de quoi décider ce qui tient.
  const largeursDe = (centimes) => categories.map((c) =>
    Math.ceil(Math.max(...data.map((d) => mesurerTexte(montantRubrique(d[c.key], centimes).replace(/\d/g, '0'), 500, 12)))) + 1);
  const largeurs = { true: largeursDe(true), false: largeursDe(false) };
  const largeursNoms = categories.map((c) => Math.ceil(mesurerTexte(c.label, 400, 12)));
  const besoin = (noms, centimes) => categories.reduce((s, c, k) => s + 8 + 6 + (noms ? largeursNoms[k] + 6 : 0) + largeurs[centimes][k], 0)
    + 16 * (categories.length - 1);
  const ecrit = detailRubriques(largeurZone, besoin);
  const indice = (window.matchMedia && window.matchMedia('(hover: hover)').matches)
    ? 'Survolez la courbe pour lire un mois.' : 'Touchez la courbe pour lire un mois.';

  const iLu = lu == null ? null : Math.min(lu, n - 1);
  const d = iLu == null ? null : data[iLu];
  const ecart = d ? r2(d.total - data[0].total) : 0;
  return (
    <>
      <div className="evo-lecture" ref={zone}>
        {d ? (
          <>
            <div className="evo-l1">
              <span className="evo-mois">{d.labelFull}</span>
              <span className="evo-droite">
                {iLu === 0
                  ? <span className="evo-ecart evo-ecart--debut">début de la période</span>
                  : <span className={`evo-ecart num ${ecart >= 0 ? 'evo-ecart--pos' : 'evo-ecart--neg'}`}>{ecart >= 0 ? '+' : ''}{fmt(ecart)} €</span>}
                <span className="evo-total num">{fmt(d.total)} €</span>
              </span>
            </div>
            <div className="evo-rub">
              {categories.map((c, k) => (
                <span key={c.key} className="evo-r">
                  <span className="evo-r-pt" style={{ background: c.color }} />
                  {ecrit.noms && <span className="evo-r-nom">{c.label}</span>}
                  <span className="evo-r-mt num" style={{ minWidth: largeurs[ecrit.centimes][k], textAlign: k === categories.length - 1 ? 'right' : 'left' }}>
                    {montantRubrique(d[c.key], ecrit.centimes)}
                  </span>
                </span>
              ))}
            </div>
          </>
        ) : (
          <>
            {ligneValeur}
            <div className="evo-indice">{indice}</div>
          </>
        )}
      </div>
      <div className="evo-cadre">
        <RedessinARotation>
          <ResponsiveContainer width="100%" height={HAUTEUR_COURBE}>
            <EvolutionAiresChart data={data} lu={iLu} />
          </ResponsiveContainer>
        </RedessinARotation>
        {/* La surface qui lit le geste, posée SUR la courbe : `touch-action: pan-y` laisse la page défiler à la verticale et
            garde l'horizontale pour la lecture. */}
        <div ref={surface} className="evo-surface" role="img"
          aria-label={`Courbe du patrimoine total, de ${data[0].labelFull.toLowerCase()} à ${data[n - 1].labelFull.toLowerCase()}`}
          onPointerDown={appui} onPointerMove={deplacement} onPointerUp={lever} onPointerCancel={annuler} onPointerLeave={sortie} />
      </div>
    </>
  );
}

// Ce qu'on écrit pour chaque rubrique : le plus complet qui TIENT, dans cet ordre — noms et centimes, noms seuls, centimes
// seuls, puis euros ronds (23/11/2026, décision de l'utilisateur : le nom de la rubrique passe avant le centime). `place` = la
// largeur utile, `besoin(noms, centimes)` = celle de la ligne. Pure, testée.
function detailRubriques(place, besoin) {
  const ordre = [[true, true], [true, false], [false, true]];
  for (const [noms, centimes] of ordre) if (place > 0 && besoin(noms, centimes) <= place) return { noms, centimes };
  return { noms: false, centimes: false };
}
// Le montant d'une rubrique, avec ou sans centimes.
function montantRubrique(valeur, centimes) {
  return `${centimes ? fmt(valeur) : fmtNoDec(valeur)} €`;
}
// L'intention d'un toucher posé sur la courbe, d'après son déplacement depuis l'appui (pure, testée) : rien tant qu'il reste
// sous le seuil ; « lecture » s'il part plutôt à l'horizontale, « defilement » plutôt à la verticale.
function intentionGeste(dx, dy, seuil = 10) {
  const ax = Math.abs(dx), ay = Math.abs(dy);
  if (ax < seuil && ay < seuil) return null;
  return ax >= ay ? 'lecture' : 'defilement';
}
// Le mois sous un point de la courbe (pure, testée) : les mois sont espacés régulièrement du bord gauche (le premier) au bord
// droit (le dernier) — échelle « point » de Recharts, marges latérales nulles.
function indexMoisLu(x, largeur, n) {
  if (n < 2 || !(largeur > 0)) return 0;
  const f = Math.min(1, Math.max(0, x / largeur));
  return Math.round(f * (n - 1));
}
// La largeur d'un texte, mesurée au canvas dans la police de l'app.
let CANVAS_TEXTE = null;
let POLICE_TEXTE = null;
function mesurerTexte(texte, graisse, taille) {
  if (!CANVAS_TEXTE) {
    CANVAS_TEXTE = document.createElement('canvas').getContext('2d');
    POLICE_TEXTE = getComputedStyle(document.body).fontFamily;
  }
  CANVAS_TEXTE.font = `${graisse} ${taille}px ${POLICE_TEXTE}`;
  return CANVAS_TEXTE.measureText(texte).width;
}

// La courbe du total, rendue PAR `ResponsiveContainer` : la durée s'y décide, et le nom finit par `Chart` pour
// recevoir son `style` (cf. le commentaire de `useDureeAnimationGraphique`). Un changement de période la redessine
// sans la remonter : la transition courte montre ce qui a bougé.
// La courbe du TOTAL en gris ardoise, la couleur de la carte « Patrimoine total » (15/11/2026, décision de l'utilisateur) :
// en indigo, elle se lisait comme celle du compte courant, dont la carte est juste au-dessus.
const COURBE_TOTAL = '#2a2f4a';
// La largeur d'un texte de l'axe, mesurée au canvas dans la police de l'app (11 px) — pour `etiquettesAxeMois` (utils.js).
let CANVAS_AXE = null;
function mesurerTexteAxe(texte) {
  if (!CANVAS_AXE) {
    CANVAS_AXE = document.createElement('canvas').getContext('2d');
    CANVAS_AXE.font = `11px ${getComputedStyle(document.body).fontFamily}`;
  }
  return CANVAS_AXE.measureText(texte).width;
}
// L'étiquette d'un mois : le nom, et l'année en petit dessous quand l'échelle la porte (1re étiquette, janvier).
function TickAxeMois({ x, y, payload, parLibelle }) {
  const e = parLibelle && parLibelle.get(payload.value);
  if (!e) return null;
  return (
    <g transform={`translate(${x},${y})`}>
      <text dy={12} textAnchor="middle" fontSize={11} fill={COLORS.muted}>{e.texte}</text>
      {e.an && <text dy={25} textAnchor="middle" fontSize={10} fill={COLORS.muted}>{e.an}</text>}
    </g>
  );
}
function EvolutionAiresChart({ data, lu, width, height, style }) {
  const duree = useDureeAnimationGraphique();
  // L'axe des mois : l'échelle de `etiquettesAxeMois` (utils.js), recalculée à chaque largeur et à chaque période.
  const axe = useMemo(() => {
    if (!width || !data || data.length < 2) return null;
    // 12 px visés entre deux noms : le texte dessiné par le SVG est un peu plus large que la mesure du canvas (9 px relevés pour
    // 10 visés, DEV v1274).
    const r = etiquettesAxeMois(data.map(d => d.monthKey), width, mesurerTexteAxe, 12);
    const parLibelle = new Map(r.etiquettes.map(e => [data[e.i].label, e]));
    return { ticks: r.etiquettes.map(e => data[e.i].label), parLibelle, avecAn: r.etiquettes.some(e => e.an) };
  }, [data, width]);
  // Le mois lu (`EvolutionLue`) : une ligne PLEINE de 1 px en `--text-subtle` — 3:1, la couleur des signes ; le pointillé, dans
  // l'app, veut dire « vide, à faire » — et le point sur la courbe. Recharts ne suit plus rien lui-même (plus de `Tooltip`).
  const point = lu == null ? null : data[lu];
  return (
    <AreaChart width={width} height={height} style={style} data={data} margin={{ top: 8, right: 0, left: 0, bottom: 0 }}>
      <defs>
        <linearGradient id="evo-fond" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor={COURBE_TOTAL} stopOpacity={0.18} />
          <stop offset="1" stopColor={COURBE_TOTAL} stopOpacity={0} />
        </linearGradient>
      </defs>
      {axe
        ? <XAxis dataKey="label" ticks={axe.ticks} interval={0} tick={<TickAxeMois parLibelle={axe.parLibelle} />} tickLine={false} axisLine={false} height={axe.avecAn ? 34 : 22} />
        : <XAxis dataKey="label" tick={{ fontSize: 11, fill: COLORS.muted }} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={16} />}
      <YAxis hide domain={['dataMin', 'dataMax']} />
      <Area type="monotone" dataKey="total" stroke={COURBE_TOTAL} strokeWidth={2.5} fill="url(#evo-fond)" activeDot={false}
        animationBegin={0} animationDuration={duree} />
      {point && <ReferenceLine x={point.label} stroke={COLORS.subtle} strokeWidth={1} />}
      {point && <ReferenceDot x={point.label} y={point.total} r={5} fill={COURBE_TOTAL} stroke="#ffffff" strokeWidth={2} ifOverflow="visible" />}
    </AreaChart>
  );
}
