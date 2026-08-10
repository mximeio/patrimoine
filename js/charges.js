// ============================================================
//  CHARGES — Budget de charges partagées (compte joint du foyer)
//
//  Données stockées dans le doc Firestore partagé `joint/main` :
//    { members:[uid...], people:[{id,label}x2],
//      baselineScenarioId, scenarios:[ {id,name,incomes,charges} ] }
//
//  - `members` est géré UNIQUEMENT en console (cf. firestore.rules) :
//    l'app ne l'écrit jamais.
//  - Répartition par charge, par scénario : '50/50', 'prorata' (au
//    prorata des salaires nets) ou 'perso' (montant fixe par personne).
//  - Le "virement mensuel" agrège les charges marquées "compte joint".
//
//  Reproduit la logique du fichier Charges.xlsx (scénarios Rennes/Paris).
// ============================================================

// Deux personnes fixes (libellés éditables dans l'app). Pas d'ajout/suppression
// de personne pour l'instant — la logique de répartition est pensée pour 2.
//
// ⚠️ NE PAS y remettre de vrais prénoms. Ce dépôt est PUBLIC : tout ce qui est
// écrit ici est lisible par n'importe qui. Les libellés réels vivent dans le
// document Firestore partagé `joint/main` (champ `people`), protégé par les
// règles Firestore et donc privé.
//
// Ces valeurs ne servent que de REPLI, si `joint/main` n'a pas de `people`
// valide (cf. l'appel plus bas) — auquel cas la première édition dans l'app les
// persisterait en base. Elles sont donc du code mort dès que `people` existe.
function DEFAULT_PEOPLE() {
  return [
    { id: 'p1', label: 'Personne 1', color: '#f59e0b' },
    { id: 'p2', label: 'Personne 2', color: '#10b981' },
  ];
}

// Scénario vide par défaut (utilisé seulement si le document partagé ne
// contient aucun scénario — la donnée réelle vient de Firestore après
// l'initialisation faite en console).
function emptyScenario() {
  return { id: uid(), name: 'Scénario', incomes: {}, charges: [] };
}

// ---------- Calculs ----------
function chargeTotalOf(charge) {
  const sp = charge.split || { mode: 'half' };
  if (sp.mode === 'perso') {
    const a = sp.amounts || {};
    return Object.values(a).reduce((s, v) => s + (Number(v) || 0), 0);
  }
  return Number(charge.total) || 0;
}

function chargeShareOf(charge, personId, nets, peopleCount) {
  const sp = charge.split || { mode: 'half' };
  if (sp.mode === 'perso') return Number(sp.amounts?.[personId]) || 0;
  const total = Number(charge.total) || 0;
  if (sp.mode === 'prorata') {
    const sum = Object.values(nets).reduce((s, v) => s + (Number(v) || 0), 0);
    return sum ? total * (Number(nets[personId]) || 0) / sum : 0;
  }
  if (sp.mode === 'percent') {
    const pct = sp.pct || {};
    const p = pct[personId] != null ? Number(pct[personId]) : (100 / (peopleCount || 2));
    return total * p / 100;
  }
  return total / (peopleCount || 2); // 'half' (legacy) = 50/50
}

// Arrondit un montant EXACTEMENT comme il sera affiché (même moteur Intl que
// fmt/eur). Indispensable ici : Math.round divergeait de l'affichage sur les
// demi-centimes (9.995 affiché « 10.00 » mais Math.round(9.99499…) = 9.99).
// On formate puis on re-parse (en retirant les espaces de milliers d'Intl).
const roundDisp = (n) => parseFloat(fmt(n).replace(/\s/g, '')) || 0;

function scenarioSummary(sc, people) {
  const nets = {};
  people.forEach(p => { nets[p.id] = Number(sc.incomes?.[p.id]?.net) || 0; });
  const aPayer = {}, restant = {}, virement = {}, provision = {};
  people.forEach(p => { aPayer[p.id] = 0; virement[p.id] = 0; provision[p.id] = 0; });
  (sc.charges || []).forEach(c => {
    const annual = c.period === 'annual';
    people.forEach(p => {
      // Part mensuelle : les charges annuelles sont réparties sur 12 mois.
      // Arrondie COMME L'AFFICHAGE avant de sommer → le total (À payer /
      // virement) correspond exactement à la somme des parts affichées.
      const sh = roundDisp(chargeShareOf(c, p.id, nets, people.length) / (annual ? 12 : 1));
      aPayer[p.id] += sh;
      if (c.joint) virement[p.id] += sh;
      // Provision : part mensuelle des charges ANNUELLES marquées « à
      // provisionner ». provision !== false → rétrocompatible (les anciennes
      // charges annuelles, sans le flag, restent provisionnées par défaut).
      if (annual && c.provision !== false) provision[p.id] += sh;
    });
  });
  people.forEach(p => {
    aPayer[p.id] = r2(aPayer[p.id]);
    virement[p.id] = r2(virement[p.id]);
    provision[p.id] = r2(provision[p.id]);
    restant[p.id] = r2((nets[p.id] || 0) - aPayer[p.id]);
  });
  return { nets, aPayer, restant, virement, provision };
}

const SPLIT_LABELS = { percent: 'Pourcentage', prorata: 'Prorata', perso: 'Montants' };

// Étiquette d'affichage d'une charge : "50/50", "60/40", "Prorata" ou "Montants".
function splitLabel(charge, people) {
  const sp = charge.split || {};
  if (sp.mode === 'prorata') return 'Prorata';
  if (sp.mode === 'perso') {
    // Charge « personnelle » : si une seule personne a un montant > 0,
    // on l'affiche « Perso · XX » au lieu de « Montants ».
    const amts = sp.amounts || {};
    const withAmt = people.filter(p => (Number(amts[p.id]) || 0) > 0);
    if (withAmt.length === 1) return `Perso · ${initials(withAmt[0].label)}`;
    return 'Montants';
  }
  if (sp.mode === 'percent') {
    const pct = sp.pct || {};
    const vals = people.map(p => Math.round(pct[p.id] != null ? Number(pct[p.id]) : 100 / people.length));
    const even = vals.every(v => v === vals[0]);
    return even ? '50/50' : '%';
  }
  return '50/50'; // legacy 'half'
}

// Champ montant des Charges : réutilise AmountInput (clavier décimal iOS,
// accepte la virgule, ne se vide pas pendant la frappe). Composant défini
// au niveau module → identité stable, donc pas de remontage (ni perte de
// focus) à chaque re-rendu de la modale.
function ChargesAmount({ value, onChange }) {
  return (
    <AmountInput
      value={value}
      onChange={onChange}
      className="charges-input charges-input--num num"
      style={{ textAlign: 'right' }}
      placeholder="0"
    />
  );
}

// Couleurs fixes des deux personnes (utilisées par la modale et le formulaire).
const PERSON_COLORS = ['#f59e0b', '#10b981'];
const personColorAt = (i) => PERSON_COLORS[i] || (i === 0 ? '#f59e0b' : '#10b981');
// Versions claires (fond des avatars en style stat-card, cohérent avec l'app).
const PERSON_COLORS_LIGHT = ['#fffbeb', '#ecfdf5'];
const personLightAt = (i) => PERSON_COLORS_LIGHT[i] || (i === 0 ? '#fffbeb' : '#ecfdf5');

// Montant avec le « € » en symbole atténué (cohérent avec le reste de l'app).
const eurEl = (n) => <>{fmt(n)} <span className="cur">€</span></>;
// Initiales du libellé (ex. "Jean Dupont" → "JD", "Marie-Claire B" → "MCB").
const initials = (label) => {
  const caps = (label || '').match(/[A-ZÀ-Ý]/g);
  if (caps && caps.length) return caps.join('').slice(0, 3);
  return (label || '?').trim().slice(0, 2).toUpperCase();
};

// ============================================================
//  ChargeRow — ligne de charge (lecture seule) avec glisser-déposer
// ============================================================
function ChargeRow({ c, index, people, nets, onEdit, onRemove, onDrop }) {
  const dragRef = useDragHandle({ scope: 'charges', list: 'charges', index, item: c });
  const dropRef = useDropTarget({ scope: 'charges', list: 'charges', index, item: c, noNest: true }, onDrop);
  // Charge « perso » (une seule personne avec un montant) → on affiche le badge
  // de la personne (initiales colorées) au lieu du tag « Perso · XX ».
  const sp = c.split || {};
  const persoWith = sp.mode === 'perso' ? people.filter(p => (Number(sp.amounts?.[p.id]) || 0) > 0) : [];
  const persoSolo = persoWith.length === 1 ? persoWith[0] : null;
  const persoIdx = persoSolo ? people.indexOf(persoSolo) : -1;
  // Équivalent mensuel d'une charge annuelle : on ne l'affiche que si une seule
  // personne est concernée, si le partage est 50/50, OU si le mode « Montants »
  // répartit des montants tous égaux entre les personnes concernées (cas
  // équivalent à un 50/50). Sinon ce total /12 unique n'est pas parlant — ce
  // sont les parts par personne qui comptent. On le calcule comme la SOMME des
  // parts mensuelles arrondies → cohérent avec les parts affichées (pas d'écart
  // d'arrondi avec le total ÷ 12).
  const persoAmountsEqual = sp.mode === 'perso' && persoWith.length >= 2 &&
    persoWith.every(p => (Number(sp.amounts?.[p.id]) || 0) === (Number(sp.amounts?.[persoWith[0].id]) || 0));
  const showMonthlyEquiv = !!persoSolo || splitLabel(c, people) === '50/50' || persoAmountsEqual;
  const monthlyEquiv = people.reduce((s, p) => s + roundDisp(chargeShareOf(c, p.id, nets, people.length) / 12), 0);
  return (
    <div ref={dropRef} className="charge-row charge-row--ro">
      <span ref={dragRef} className="charge-badge" title="Glisser pour réordonner"><Icon name="receipt" size={14} /></span>
      <div className="charge-main">
        <span className="charge-name">
          <span className="charge-name-text">{c.label || '(sans libellé)'}</span>
          {persoSolo
            ? <span className="charge-person-tag" style={{ background: personLightAt(persoIdx), color: personColorAt(persoIdx) }} title={`Charge personnelle · ${persoSolo.label}`}>{initials(persoSolo.label)}</span>
            : <span className="charge-tag">{splitLabel(c, people)}</span>}
          {c.joint && <span className="charge-vir-dot" title="Incluse dans le virement mensuel" aria-label="Virement mensuel" />}
          {c.period === 'annual' && c.provision !== false && <span className="charge-prov-dot" title="Provision annuelle (charge annuelle ÷ 12)" aria-label="Provision annuelle" />}
        </span>
      </div>
      <div className="charge-amount-block">
        {c.period === 'annual' ? (
          <>
            <span className="charge-total-ro" style={{ color: 'var(--danger)' }}>{eurEl(chargeTotalOf(c))}{showMonthlyEquiv && <span className="charge-monthly-equiv"> · − {eurEl(monthlyEquiv)}/mois</span>}</span>
            <span className="charge-split-mini">
              {people.map((p, i) => {
                const sh = chargeShareOf(c, p.id, nets, people.length) / 12;
                if (roundDisp(sh) === 0) return null; // on masque une part à 0
                return (
                  <span key={p.id} className="csm-item">
                    <span className="csm-name" style={{ color: personColorAt(i) }}>{initials(p.label)}</span> {eur(sh)}
                  </span>
                );
              })}
            </span>
          </>
        ) : (
          <>
            <span className="charge-total-ro" style={{ color: 'var(--danger)' }}>− {eurEl(chargeTotalOf(c))}</span>
            <span className="charge-split-mini">
              {people.map((p, i) => {
                const sh = chargeShareOf(c, p.id, nets, people.length);
                if (roundDisp(sh) === 0) return null; // on masque une part à 0
                return (
                  <span key={p.id} className="csm-item">
                    <span className="csm-name" style={{ color: personColorAt(i) }}>{initials(p.label)}</span> {eur(sh)}
                  </span>
                );
              })}
            </span>
          </>
        )}
      </div>
      <button className="tx-edit" onClick={onEdit} title="Modifier"><Icon name="pencil" size={13} /></button>
    </div>
  );
}

// ============================================================
//  ChargeForm — formulaire d'ajout / édition d'une charge (sous-modale)
// ============================================================
function ChargeForm({ initial, people, nets, onSubmit, onDelete, defaultPeriod = 'monthly' }) {
  const isEdit = !!initial;
  // Valeurs de DÉPART, calculées UNE SEULE FOIS : elles initialisent les états
  // ET servent de référence à la garde « modifications non enregistrées » plus
  // bas. Source unique volontaire — les écrire deux fois les ferait diverger au
  // premier champ ajouté, et c'est la garde qui mentirait sans que rien ne le
  // signale.
  //  · Fréquence : 'monthly' (montant mensuel) ou 'annual' (montant annuel ÷ 12).
  //  · 'half' (legacy) et tout mode inconnu → 'percent' (50/50 modifiable).
  //  · Charge annuelle « à provisionner » : par défaut oui (et rétrocompatible :
  //    une ancienne charge annuelle sans le flag est considérée comme provisionnée).
  const departRef = useRef(null);
  if (departRef.current === null) {
    const a = {}, o = {};
    people.forEach(p => {
      a[p.id] = initial?.split?.amounts?.[p.id] ?? 0;
      o[p.id] = initial?.split?.pct?.[p.id] ?? Math.round(100 / people.length);
    });
    departRef.current = {
      period: initial ? (initial.period === 'annual' ? 'annual' : 'monthly') : (defaultPeriod === 'annual' ? 'annual' : 'monthly'),
      label: initial?.label || '',
      mode: ['prorata', 'perso', 'percent'].includes(initial?.split?.mode) ? initial.split.mode : 'percent',
      total: initial?.total ?? 0,
      amounts: a,
      pct: o,
      mensuel: !!initial?.joint,
      provision: initial?.provision !== false,
    };
  }
  const depart = departRef.current;
  const [period, setPeriod] = useState(depart.period);
  const annual = period === 'annual';
  const [label, setLabel] = useState(depart.label);
  const [mode, setMode] = useState(depart.mode);
  const [total, setTotal] = useState(depart.total);
  // Copies : l'état ne doit JAMAIS partager sa référence avec `depart`, sinon une
  // mutation en place rendrait la comparaison aveugle.
  const [amounts, setAmounts] = useState(() => ({ ...depart.amounts }));
  const [pct, setPct] = useState(() => ({ ...depart.pct }));
  const [mensuel, setMensuel] = useState(depart.mensuel);
  const [provision, setProvision] = useState(depart.provision);

  // Pour 2 personnes : ajuster une part met l'autre à 100 − part.
  const setPctFor = (id, val) => {
    let v = Math.max(0, Math.min(100, Math.round(Number(val) || 0)));
    setPct(prev => {
      const next = { ...prev, [id]: v };
      if (people.length === 2) { const other = people.find(p => p.id !== id); if (other) next[other.id] = 100 - v; }
      return next;
    });
  };

  const buildSplit = () => mode === 'perso' ? { mode: 'perso', amounts }
    : mode === 'prorata' ? { mode: 'prorata' }
    : { mode: 'percent', pct };
  const tempCharge = { total: mode === 'perso' ? 0 : (Number(total) || 0), split: buildSplit() };

  // La charge telle qu'elle SERAIT écrite, à partir d'un jeu de valeurs — sans
  // `id`, qui n'appartient pas à la comparaison (un `uid()` neuf en création
  // rendrait le formulaire « modifié » dès l'ouverture, cf. le piège des
  // composantes au §10). Une seule fonction pour l'enregistrement ET pour la
  // garde : c'est ce qui garantit que la garde juge exactement ce qui sera écrit.
  // Mensuelle → toggle « Virement mensuel (compte joint) » (joint).
  // Annuelle  → toggle « Provision mensuelle (livret) » (provision), pas de virement.
  const construire = (v) => {
    const est = v.period === 'annual';
    const base = { label: (v.label || '').trim() || 'Charge',
      ...(est ? { period: 'annual', joint: false, provision: v.provision } : { joint: v.mensuel }) };
    // 🔴 Coercition « vide → 0 » ICI, à l'écriture (chantier du 10/08/2026) :
    // `AmountInput` propage désormais '' sur un champ vidé, et une CHAÎNE dans un
    // champ montant de `joint/main` casserait tous les calculs qui le lisent.
    const montants = {};
    Object.keys(v.amounts || {}).forEach(k => { montants[k] = r2(parseFloat(v.amounts[k]) || 0); });
    return v.mode === 'perso'
      ? { ...base, total: 0, split: { mode: 'perso', amounts: montants } }
      : { ...base, total: Number(v.total) || 0,
          split: v.mode === 'prorata' ? { mode: 'prorata' } : { mode: 'percent', pct: v.pct } };
  };

  // 🔴 Garde « modifications non enregistrées ». Ce formulaire n'en avait AUCUNE
  // avant le 10/08/2026 — `charges.js` ne contenait pas un seul `markDirty` —, il
  // retombait donc sur l'heuristique générique de `Modal` et cumulait les DEUX
  // directions du défaut décrit au §10 :
  //  · l'heuristique ne se démarque jamais → modifier puis revenir à la valeur
  //    d'origine réclamait une confirmation alors qu'il n'y avait plus rien à perdre ;
  //  · surtout, elle est AVEUGLE AUX CONTRÔLES À CLIC : « Fréquence » et
  //    « Répartition » sont des <button>, qui n'émettent ni `input` ni `change`.
  //    Passer une charge de mensuelle à annuelle puis fermer jetait donc la
  //    modification SANS RIEN DEMANDER. C'est la direction grave — une perte
  //    silencieuse, pas une confirmation de trop.
  // ⚠️ On compare la charge CONSTRUITE, pas les états bruts : en mode « perso »
  // le total n'est pas écrit (forcé à 0), et le comparer ferait signaler une
  // modification qui n'en serait pas une.
  // ⚠️ Les montants s'arrondissent au centime avant comparaison (§10 : sinon
  // 12 ≠ 12.00) et les parts s'entièrent.
  const empreinte = (v) => {
    const c = construire(v);
    return JSON.stringify({
      label: c.label,
      period: c.period || 'monthly',
      joint: !!c.joint,
      provision: c.period === 'annual' ? !!c.provision : null,
      mode: c.split.mode,
      total: r2(Number(c.total) || 0),
      amounts: people.map(p => r2(Number(c.split.amounts?.[p.id]) || 0)),
      pct: people.map(p => Math.round(Number(c.split.pct?.[p.id]) || 0)),
    });
  };
  const markDirty = React.useContext(ModalDirtyContext);
  const formDirty = empreinte({ period, label, mode, total, amounts, pct, mensuel, provision }) !== empreinte(depart);
  useEffect(() => { if (markDirty) markDirty(formDirty); }, [formDirty]); // eslint-disable-line

  const submit = (e) => {
    e.preventDefault();
    onSubmit({ id: initial?.id || uid(), ...construire({ period, label, mode, total, amounts, pct, mensuel, provision }) });
  };

  return (
    <form noValidate className="charge-form" onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <label className="label">Libellé</label>
        <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Ex. Loyer, Internet…" />
      </div>

      <div>
        <label className="label">Fréquence</label>
        <div className="seg">
          <button type="button" className={`seg-btn${!annual ? ' on' : ''}`} onClick={() => setPeriod('monthly')}>Mensuelle</button>
          <button type="button" className={`seg-btn${annual ? ' on' : ''}`} onClick={() => setPeriod('annual')}>Annuelle</button>
        </div>
      </div>

      <div>
        <label className="label">Répartition</label>
        <div className="seg">
          {['percent', 'prorata', 'perso'].map(m => (
            <button type="button" key={m} className={`seg-btn${mode === m ? ' on' : ''}`} onClick={() => setMode(m)}>{SPLIT_LABELS[m]}</button>
          ))}
        </div>
      </div>

      {mode === 'perso' ? (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          {people.map((p, i) => (
            <div key={p.id}>
              <label className="label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 9, height: 9, borderRadius: '50%', background: personColorAt(i), display: 'inline-block' }}></span>{p.label}
              </label>
              <AmountInput className="input" value={amounts[p.id]} onChange={(v) => setAmounts(a => ({ ...a, [p.id]: v }))} placeholder="0.00" />
            </div>
          ))}
        </div>
      ) : (
        <>
          <div>
            <label className="label">{annual ? 'Total annuel (€)' : 'Total mensuel (€)'}</label>
            <AmountInput className="input" value={total} onChange={setTotal} placeholder="0.00" />
            {annual && <div className="field-hint">Réparti sur 12 mois → ≈ {eur((Number(total) || 0) / 12)} / mois.</div>}
            {mode === 'prorata' && <div className="field-hint">Réparti au prorata des salaires nets.</div>}
          </div>
          {mode === 'percent' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              {people.map((p, i) => (
                <div key={p.id}>
                  <label className="label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ width: 9, height: 9, borderRadius: '50%', background: personColorAt(i), display: 'inline-block' }}></span>{p.label} (%)
                  </label>
                  <input type="number" inputMode="numeric" min="0" max="100" className="input" value={pct[p.id]} onChange={(e) => setPctFor(p.id, e.target.value)} />
                </div>
              ))}
            </div>
          )}
        </>
      )}

      <div className="field-hint">
        {people.map((p, i) => (
          <span key={p.id}>{i > 0 ? ' · ' : 'Part : '}<strong style={{ color: personColorAt(i) }}>{p.label}</strong> {eur(chargeShareOf(tempCharge, p.id, nets, people.length))}</span>
        ))}
      </div>

      <div className="charge-mensuel-row">
        <span>{annual ? 'Provision mensuelle (livret)' : 'Virement mensuel (compte joint)'}</span>
        <label className="toggle">
          <input type="checkbox"
            checked={annual ? provision : mensuel}
            onChange={(e) => annual ? setProvision(e.target.checked) : setMensuel(e.target.checked)} />
          <span className="toggle-slider"></span>
        </label>
      </div>

      <div className="form-actions">
        <button type="submit" className="btn btn-accent btn-lg">{isEdit ? 'Enregistrer' : 'Ajouter'}</button>
        {isEdit && onDelete && (
          <button type="button" className="btn-delete-line" onClick={onDelete}>
            <Icon name="trash" size={14} /> Supprimer
          </button>
        )}
      </div>
    </form>
  );
}

// ============================================================
//  Modale Charges
// ============================================================
function ChargesModal({ ctx, onClose }) {
  const [data, setData] = useState(() => {
    const j = ctx.joint || {};
    const scenarios = (Array.isArray(j.scenarios) && j.scenarios.length) ? j.scenarios : [emptyScenario()];
    return {
      people: (Array.isArray(j.people) && j.people.length === 2) ? j.people : DEFAULT_PEOPLE(),
      scenarios,
      baselineScenarioId: (j.baselineScenarioId && scenarios.some(s => s.id === j.baselineScenarioId)) ? j.baselineScenarioId : scenarios[0].id,
    };
  });

  // Écriture Firestore debouncée. On saute le 1er run (lecture initiale,
  // aucune modif) ; toute édition ultérieure est persistée.
  const skipFirstWrite = useRef(true);
  useEffect(() => {
    if (skipFirstWrite.current) { skipFirstWrite.current = false; return; }
    const t = setTimeout(() => {
      // 🔴 COERCITION « vide → 0 » AVANT d'écrire, et c'est le SEUL endroit
      // possible : ce chemin n'a pas de submit (effet debouncé à 700 ms), et
      // `AmountInput` propage désormais '' sur un champ vidé (10/08/2026).
      // Sans ça, la chaîne '' partirait dans le document PARTAGÉ, où tous les
      // calculs « au prorata des salaires nets » la liraient comme un montant.
      // ⚠️ Ne PAS remonter cette coercition dans `setIncome` : ce setter nourrit
      // aussi l'affichage, et le champ se remplirait d'un 0 au blur.
      const scenarios = (data.scenarios || []).map(sc => {
        const incomes = {};
        Object.keys(sc.incomes || {}).forEach(pid => {
          const src = sc.incomes[pid] || {};
          const dst = {};
          Object.keys(src).forEach(k => { dst[k] = r2(parseFloat(src[k]) || 0); });
          incomes[pid] = dst;
        });
        return { ...sc, incomes };
      });
      ctx.updateJoint({
        people: data.people,
        scenarios,
        baselineScenarioId: data.baselineScenarioId,
      });
    }, 700);
    return () => clearTimeout(t);
  }, [data]);

  const people = data.people;
  // v617 — On ouvre sur le scénario de RÉFÉRENCE (celui marqué ★), pas sur le
  // premier du tableau : la référence est le scénario canonique, c'est celui
  // qu'on veut voir en arrivant. Sans ça, le module s'ouvrait sur scenarios[0]
  // par simple effet de bord de l'ordre de stockage (cas réel : ouverture sur
  // « Rennes » alors que la référence était « Paris »).
  // Sûr : baselineScenarioId est validé à l'initialisation de `data` ci-dessus
  // (repli sur scenarios[0].id si l'id stocké ne correspond à aucun scénario).
  const [activeId, setActiveId] = useState(data.baselineScenarioId);
  const active = data.scenarios.find(s => s.id === activeId) || data.scenarios[0];

  // ---- Mutateurs ----
  const patchScenario = (id, patch) =>
    setData(d => ({ ...d, scenarios: d.scenarios.map(s => s.id === id ? { ...s, ...patch } : s) }));
  const patchActive = (patch) => patchScenario(active.id, patch);

  const setCharges = (fn) => patchActive({ charges: fn(active.charges) });
  const updateChargeField = (chId, patch) =>
    setCharges(cs => cs.map(c => c.id === chId ? { ...c, ...patch } : c));
  const removeCharge = (chId) => setCharges(cs => cs.filter(c => c.id !== chId));
  const onChargeDrop = (drop) => patchActive({ charges: performDrop(active.charges, drop.source, drop) });
  const submitCharge = (charge) => {
    setCharges(cs => cs.some(c => c.id === charge.id) ? cs.map(c => c.id === charge.id ? charge : c) : [...cs, charge]);
    setEditingCharge(null);
  };

  const netsActive = {};
  people.forEach(p => { netsActive[p.id] = Number(active.incomes?.[p.id]?.net) || 0; });

  const changeMode = (chId, mode) => setCharges(cs => cs.map(c => {
    if (c.id !== chId) return c;
    if (mode === 'perso') {
      const amounts = {};
      people.forEach(p => { amounts[p.id] = r2(chargeShareOf(c, p.id, netsActive, people.length)); });
      return { ...c, split: { mode: 'perso', amounts } };
    }
    return { ...c, split: { mode }, total: chargeTotalOf(c) };
  }));
  const setCustomAmount = (chId, personId, val) => setCharges(cs => cs.map(c =>
    c.id === chId
      ? { ...c, split: { mode: 'perso', amounts: { ...(c.split?.amounts || {}), [personId]: val } } }
      : c));

  // ⚠️ AUCUNE coercition ici, et c'est VOULU : ce setter alimente aussi
  // l'AFFICHAGE du champ. Y forcer « vide → 0 » remettait « 0 » dans la case dès
  // le blur (l'effet de resynchronisation d'`AmountInput` relit `value`), donc
  // ramenait exactement le défaut qu'on corrige. La coercition se fait à
  // l'ÉCRITURE, dans l'effet debouncé ci-dessous.
  const setIncome = (personId, field, val) =>
    patchActive({ incomes: { ...active.incomes, [personId]: { ...(active.incomes?.[personId] || {}), [field]: val } } });
  const setPersonLabel = (personId, label) =>
    setData(d => ({ ...d, people: d.people.map(p => p.id === personId ? { ...p, label } : p) }));

  const addScenario = () => {
    const id = uid();
    const copy = {
      id,
      name: 'Nouveau scénario',
      incomes: JSON.parse(JSON.stringify(active.incomes || {})),
      charges: (active.charges || []).map(c => ({ ...c, id: uid(), split: JSON.parse(JSON.stringify(c.split || { mode: 'half' })) })),
    };
    setData(d => ({ ...d, scenarios: [...d.scenarios, copy] }));
    setActiveId(id);
  };
  const renameScenario = (name) => patchActive({ name });
  const deleteScenario = () => {
    if (data.scenarios.length <= 1) return;
    if (!confirm(`Supprimer le scénario "${active.name}" ?`)) return;
    const fallback = data.scenarios.find(s => s.id !== active.id);
    setData(d => {
      const scenarios = d.scenarios.filter(s => s.id !== active.id);
      const baselineScenarioId = d.baselineScenarioId === active.id ? scenarios[0].id : d.baselineScenarioId;
      return { ...d, scenarios, baselineScenarioId };
    });
    setActiveId(fallback.id);
  };

  const baseScenario = data.scenarios.find(s => s.id === data.baselineScenarioId) || data.scenarios[0];
  const baseSum = scenarioSummary(baseScenario, people);
  const sum = scenarioSummary(active, people);
  const isBaseline = active.id === baseScenario.id;

  // Champ montant (réutilise le composant stable défini au niveau module)
  const Num = ChargesAmount;

  // Vue active : 'scenario' (édition d'un scénario) ou 'compare' (comparaison).
  const [view, setView] = useState('scenario');

  // Segmented des scénarios : pastille foncée glissante (même mécanique que
  // la nav desktop — hook useSlideIndicator défini dans app.js, disponible
  // au moment du rendu). En vue 'compare', aucun segment actif → la
  // pastille se replie (width 0), c'est le bouton « Comparer » épinglé qui
  // porte l'état foncé.
  const railRef = useRef(null);
  const railIndRef = useRef(null);
  // Mode compositeur (v506) : cf. AppBar — translateX via --tx.
  // Les LIBELLÉS entrent dans les deps, exactement comme la nav desktop depuis
  // la v569 — et pour la même raison. Les deps précédentes (`activeId`, `view`,
  // `scenarios.length`) ne bougeaient pas quand seul le TEXTE d'un onglet
  // changeait : renommer le scénario actif, ou déplacer l'étoile de référence,
  // redimensionnait l'onglet sans rejouer la mesure. La pastille gardait alors
  // sa largeur précédente — elle débordait sur l'onglet voisin (texte sombre sur
  // fond foncé, illisible) ou laissait dépasser l'onglet actif (texte blanc sur
  // fond clair, invisible). Mesuré : « P » → onglet 70 px, pastille restée à 93.
  // ⚠️ La chaîne doit refléter le libellé RENDU, étoile comprise : le « ★ » vaut
  // 15 px de large et se déplace d'un onglet à l'autre sans changer aucun nom.
  const railLabels = data.scenarios
    .map(s => (s.name || '(sans nom)') + (s.id === baseScenario.id ? ' ★' : ''))
    .join('|');
  useSlideIndicator(railRef, railIndRef, '.seg-tab-active', [activeId, view, railLabels], undefined, true);
  // null = fermé, 'new' = création, objet charge = édition
  const [editingCharge, setEditingCharge] = useState(null);
  const personColor = personColorAt;

  // ---- Comparaison ----
  const scMetrics = (s) => {
    const ss = scenarioSummary(s, people);
    const netTotal = people.reduce((t, p) => t + (ss.nets[p.id] || 0), 0);
    const chargesTotal = (s.charges || []).reduce((t, c) => t + chargeTotalOf(c), 0);
    return { ss, netTotal, chargesTotal };
  };
  const cmpList = data.scenarios.map(s => ({ s, m: scMetrics(s) }));
  const baseM = (cmpList.find(x => x.s.id === baseScenario.id) || cmpList[0]).m;
  // dir : 'more-good' (plus = favorable), 'more-bad' (plus = défavorable), 'neutral'
  // Valeur en double rendu : exact (paysage/desktop) + arrondi (portrait mobile),
  // bascule via media-query CSS (.cmpd-exact / .cmpd-round).
  const cmpEur = (n) => (
    <span className="v">
      <span className="cmpd-exact">{fmt(n)} <span className="cur">€</span></span>
      <span className="cmpd-round">{fmtNoDec(n)} <span className="cur">€</span></span>
    </span>
  );
  const cmpDelta = (val, baseVal, dir) => {
    if (val == null || baseVal == null || baseVal === 0) return <span className="cmp-delta neu">—</span>;
    const d = (val - baseVal) / baseVal;
    if (Math.abs(d) < 0.0005) return <span className="cmp-delta neu">=</span>;
    const cls = dir === 'neutral' ? 'neu' : (((d > 0) === (dir === 'more-good')) ? 'up' : 'down');
    const sign = d > 0 ? '+' : '';
    return (
      <span className={`cmp-delta ${cls}`}>
        <span className="cmpd-exact">{sign}{(d * 100).toFixed(1)} %</span>
        <span className="cmpd-round">{sign}{(d * 100).toFixed(0)} %</span>
      </span>
    );
  };
  // Postes comparés (colonnes du tableau D1).
  const cmpRows = [
    { label: 'Revenu net', key: 'nets', dir: 'more-good' },
    { label: 'Charges', key: 'aPayer', dir: 'more-bad' },
    { label: 'Il reste', key: 'restant', dir: 'more-good' },
    { label: 'Virement', key: 'virement', dir: 'neutral' },
  ];

  return (
    <Modal title="Répartition des charges" size="xl" onClose={onClose}>
      {/* Barre d'onglets : rail segmented des scénarios (défilant, pastille
          glissante) + « + » (action, hors rail) + « Comparer » épinglé à
          droite — TOUJOURS visible, icône + texte, même sur mobile. */}
      <div className="charges-tabbar">
        <div className="seg-bar" style={{ flex: 1, minWidth: 0 }}>
          <div className="seg-rail" ref={railRef}>
            <div className="seg-indicator" ref={railIndRef} />
            {data.scenarios.map(s => (
              <button
                key={s.id}
                className={`seg-tab${view === 'scenario' && s.id === active.id ? ' seg-tab-active' : ''}`}
                onClick={(e) => {
                  setActiveId(s.id); setView('scenario');
                  // Recentre le scénario cliqué si le rail défile : tous les
                  // scénarios restent accessibles et visibles après sélection.
                  try { e.currentTarget.scrollIntoView({ behavior: 'smooth', inline: 'nearest', block: 'nearest' }); } catch (err) {}
                }}
              >
                <Icon name="receipt" size={14} />
                <span>{s.name || '(sans nom)'}{s.id === baseScenario.id ? ' ★' : ''}</span>
              </button>
            ))}
          </div>
          <button className="seg-add" onClick={() => { if (confirm('Créer un nouveau scénario (copie du scénario courant) ?')) { addScenario(); setView('scenario'); } }} title="Ajouter un scénario" aria-label="Ajouter un scénario">+</button>
          {data.scenarios.length > 1 && (
            <button className={`seg-solo${view === 'compare' ? ' on' : ''}`} onClick={() => setView('compare')} aria-label="Comparer" title="Comparer">
              <Icon name="chart" size={15} />
              <span>Comparer</span>
            </button>
          )}
        </div>
      </div>

      {view === 'scenario' ? (
        <>
          {/* En-tête scénario : nom éditable, référence, suppression */}
          <div className="charges-scenario-head">
            <input
              type="text" className="input scen-name"
              value={active.name} onChange={(e) => renameScenario(e.target.value)} placeholder="Nom du scénario"
            />
            <div className="charges-head-actions">
              <button
                className={`btn-icon star-btn${isBaseline ? ' on' : ''}`}
                onClick={() => setData(d => ({ ...d, baselineScenarioId: active.id }))}
                title={isBaseline ? 'Scénario de référence' : 'Définir comme référence pour la comparaison'}
                aria-label="Scénario de référence"
              >★</button>
              {data.scenarios.length > 1 && (
                <button className="btn-icon btn-icon-danger" onClick={deleteScenario} title="Supprimer ce scénario">
                  <Icon name="trash" size={15} />
                </button>
              )}
            </div>
          </div>

          {/* Revenus nets */}
          <h3 className="settings-group-title">Revenus nets</h3>
          <div className="inc-row">
            {people.map((p, i) => (
              <div key={p.id} className="inc-fld">
                <span className="inc-ava" style={{ background: personLightAt(i), color: personColor(i) }}>{initials(p.label)}</span>
                <span className="inc-name">{p.label}</span>
                <div className="inc-lbl">Revenu net</div>
                <div className="inc-amt">
                  <AmountInput
                    value={active.incomes?.[p.id]?.net}
                    onChange={(v) => setIncome(p.id, 'net', v)}
                    className="inc-amt-input num"
                    style={{ width: `${Math.max(3, String(Math.round(active.incomes?.[p.id]?.net || 0)).length) + 0.5}ch` }}
                  />
                  <span className="cur">€</span>
                </div>
              </div>
            ))}
          </div>

          {/* Charges — deux tables (mensuelles / annuelles), édition via sous-modale.
              On garde l'index d'origine dans active.charges pour le glisser-déposer. */}
          {(() => {
            const indexed = (active.charges || []).map((c, index) => ({ c, index }));
            const monthly = indexed.filter(x => x.c.period !== 'annual');
            const annual = indexed.filter(x => x.c.period === 'annual');
            const renderRow = ({ c, index }) => (
              <ChargeRow
                key={c.id}
                c={c}
                index={index}
                people={people}
                nets={netsActive}
                onEdit={() => setEditingCharge(c)}
                onRemove={() => { if (confirm(`Supprimer la charge « ${c.label || 'cette ligne'} » ?`)) removeCharge(c.id); }}
                onDrop={onChargeDrop}
              />
            );
            const emptyMsg = (txt) => <div style={{ padding: '14px 16px', fontSize: 13, color: 'var(--text-muted)' }}>{txt}</div>;
            return (
              <>
                <h3 className="settings-group-title">Charges mensuelles</h3>
                <div className="settings-card" style={{ padding: 0 }}>
                  <div className="charge-list">
                    {monthly.length ? monthly.map(renderRow) : emptyMsg('Aucune charge mensuelle pour ce scénario.')}
                  </div>
                  <div className="charge-list-footer">
                    <button className="btn-add" onClick={() => setEditingCharge('new')}>+ Ajouter une charge mensuelle</button>                  </div>
                </div>

                <h3 className="settings-group-title">Charges annuelles</h3>
                <div className="settings-card" style={{ padding: 0 }}>
                  <div className="charge-list">
                    {annual.length ? annual.map(renderRow) : emptyMsg('Aucune charge annuelle. Elles sont réparties automatiquement sur 12 mois.')}
                  </div>
                  <div className="charge-list-footer">
                    <button className="btn-add" onClick={() => setEditingCharge('new-annual')}>+ Ajouter une charge annuelle</button>                  </div>
                </div>
              </>
            );
          })()}

          {/* Légende globale du code couleur des ronds. */}
          <div className="charges-legend-global">
            <span><span className="charge-vir-dot" /> Virement mensuel (compte joint)</span>
            <span><span className="charge-prov-dot" /> Provision mensuelle (livret)</span>
          </div>

          {/* Synthèse propre au scénario */}
          <h3 className="settings-group-title">Synthèse — {active.name}</h3>
          <div className="pcards">
            {people.map((p, i) => (
              <div key={p.id} className="pcard">
                <span className="pc-ava" style={{ background: personLightAt(i), color: personColor(i) }}>{initials(p.label)}</span>
                <div className="pc-name">{p.label}</div>
                <div className="pcard-hero">
                  <div className="pcard-hero-label">Il reste</div>
                  <div className="pcard-hero-val" style={{ color: sum.restant[p.id] >= 0 ? 'var(--success)' : 'var(--danger)' }}>{eurEl(sum.restant[p.id])}</div>
                </div>
                <div className="pcard-sub">
                  À payer <b>{eurEl(sum.aPayer[p.id])}</b>
                  {' · '}<span className="charge-vir-dot" /> <b>{eurEl(sum.virement[p.id])}</b>
                  {sum.provision[p.id] > 0 && <>{' · '}<span className="charge-prov-dot" /> <b>{eurEl(sum.provision[p.id])}</b></>}
                </div>
                {(() => {
                  // Répartition de « Il reste » (déjà net du virement et de la
                  // provision, qui sont dans « À payer »).
                  //  - Provision : arrondie au 5 SUPÉRIEUR (v526 — l'ancienne
                  //    dizaine au plus proche pouvait SOUS-provisionner :
                  //    223,08 affiché 220). Virement rond, jamais en dessous
                  //    du besoin, dépassement ≤ 4,99.
                  //  - Le DÉPASSEMENT (provision arrondie − exacte) est retiré
                  //    du reste avant le partage PEA/Tampon : chaque euro
                  //    n'apparaît qu'une seule fois, la somme des lignes colle
                  //    au centime à l'argent réel (variante « B » validée).
                  //  - Tampon : au moins TAMPON_MIN → on arrondit le PEA À L'INFÉRIEUR.
                  //  - PEA : cran de 5 (v527 — avant : 50, qui laissait dormir
                  //    jusqu'à 45 € sur le compte commun). Règle unique de la
                  //    carte : tout s'arrondit à 5 près — le Livret vers le
                  //    HAUT (besoin), le PEA vers le BAS (le tampon d'abord).
                  //    Tampon résultant : entre 300 et 304,99.
                  const restant = sum.restant[p.id];
                  const virement = sum.virement[p.id];
                  const provisionExact = sum.provision[p.id] || 0;
                  const provision = Math.ceil(provisionExact / 5) * 5;
                  const alloue = r2(restant - r2(provision - provisionExact));
                  const TAMPON_MIN = 300;
                  const pea = Math.max(0, Math.floor((alloue - TAMPON_MIN) / 5) * 5);
                  const tampon = r2(alloue - pea);
                  return (
                    <div className="pcard-alloc">
                      {virement > 0 && (
                        <div className="pcard-alloc-row">
                          <span className="charge-vir-dot" />
                          <span className="pcard-alloc-lbl">Virement mensuel (compte joint)</span>
                          <span className="pcard-alloc-val">{eurEl(virement)}</span>
                        </div>
                      )}
                      {provision > 0 && (
                        <div className="pcard-alloc-row">
                          <span className="charge-prov-dot" />
                          <span className="pcard-alloc-lbl">Provision mensuelle (livret)</span>
                          <span className="pcard-alloc-val">{eurEl(provision)}</span>
                        </div>
                      )}
                      <div className="pcard-alloc-row">
                        <span className="charge-pea-dot" />
                        <span className="pcard-alloc-lbl">PEA</span>
                        <span className="pcard-alloc-val">{eurEl(pea)}</span>
                      </div>
                      <div className="pcard-alloc-row">
                        <span className="charge-tampon-dot" />
                        <span className="pcard-alloc-lbl">Tampon (compte courant)</span>
                        <span className="pcard-alloc-val">{eurEl(tampon)}</span>
                      </div>
                    </div>
                  );
                })()}
              </div>
            ))}
          </div>
        </>
      ) : (
        /* ---- Vue Comparaison : une carte par personne, scénarios en lignes ---- */
        <div className="cmp-d1">
          {people.map((p, i) => (
            <div key={p.id} className="cmpp">
              <div className="cmpp-head">
                <span className="cmpp-ava" style={{ background: personLightAt(i), color: personColor(i) }}>{initials(p.label)}</span>
                <span className="cmpp-name">{p.label}</span>
              </div>
              <div className="cmpp-scroll">
                <table className="cmpp-tab">
                  <thead>
                    <tr>
                      <th className="cmpp-sc">Scénario</th>
                      {cmpRows.map(r => <th key={r.key}>{r.label}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {cmpList.map(({ s, m }) => {
                      const isBase = s.id === baseScenario.id;
                      return (
                        <tr key={s.id} className={isBase ? 'ref' : ''}>
                          <td className="cmpp-sc">{s.name || '(sans nom)'}{isBase && <span className="cmp-star"> ★</span>}</td>
                          {cmpRows.map(r => (
                            <td key={r.key} className="num">
                              {cmpEur(m.ss[r.key][p.id])}
                              {!isBase && cmpDelta(m.ss[r.key][p.id], baseM.ss[r.key][p.id], r.dir)}
                            </td>
                          ))}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}

      {editingCharge !== null && (() => {
        const isNew = editingCharge === 'new' || editingCharge === 'new-annual';
        return (
        <Modal title={isNew ? 'Nouvelle charge' : 'Modifier la charge'} onClose={() => setEditingCharge(null)}>
          <ChargeForm
            initial={isNew ? null : editingCharge}
            defaultPeriod={editingCharge === 'new-annual' ? 'annual' : 'monthly'}
            people={people}
            nets={netsActive}
            onSubmit={submitCharge}
            onDelete={!isNew ? () => {
              if (!confirm(`Supprimer la charge « ${editingCharge.label || 'cette ligne'} » ?`)) return;
              removeCharge(editingCharge.id);
              setEditingCharge(null);
            } : undefined}
          />
        </Modal>
        );
      })()}
    </Modal>
  );
}
