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
const roundDisp = (n) => lireMontant(fmt(n)) || 0; // lireMontant : fmt rend le vrai moins (14/11/2026)

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
// Le TEXTE d'une personne (initiales, nom) prend la nuance 600 de sa couleur, comme tout texte coloré de l'app (règle du
// 22/10/2026) ; la couleur pleine ne sert plus qu'à ses pastilles rondes.
const personTextAt = (i) => couleurIcone(personColorAt(i));
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
// Version 2 de Mockup-Repartition-Charges (15/11/2026) : la ligne d'une charge a la forme d'une ligne d'opération —
// poignée, libellé, une ligne grise qui dit EN MOTS le partage et le compte (« 50/50 · compte joint », « Maxime L · livret
// · 6.90 €/mois »), montant souligné en pointillé dont la bulle donne la part de chacun, crayon. Plus d'icône, de
// pastille « 50/50 » ni de point de couleur. La bulle sert à la souris comme au doigt (même comportement partout).
function partageEnMots(c, people) {
  const sp = c.split || {};
  if (sp.mode === 'prorata') return 'Au prorata';
  if (sp.mode === 'perso') {
    const amts = sp.amounts || {};
    const avec = people.filter(p => (Number(amts[p.id]) || 0) > 0);
    if (avec.length === 1) return avec[0].label;
    return 'Montants fixés';
  }
  if (sp.mode === 'percent') {
    const pct = sp.pct || {};
    const vals = people.map(p => Math.round(pct[p.id] != null ? Number(pct[p.id]) : 100 / people.length));
    return vals.join('/');
  }
  return '50/50'; // ancien mode 'half'
}

function ChargeRow({ c, index, people, nets, onEdit, onRemove, onDrop }) {
  const dragRef = useDragHandle({ scope: 'charges', list: 'charges', index, item: c });
  const dropRef = useDropTarget({ scope: 'charges', list: 'charges', index, item: c, noNest: true }, onDrop);
  const annuelle = c.period === 'annual';
  const total = chargeTotalOf(c);
  const parts = people
    .map((p, i) => ({ p, i, v: chargeShareOf(c, p.id, nets, people.length) / (annuelle ? 12 : 1) }))
    .filter((x) => roundDisp(x.v) !== 0);
  const partsTexte = parts.map((x) => `${x.p.label} ${eur(x.v)}`).join(' · ');
  // Repères (version A′ de Mockup-Charges-Reperes, 15/11/2026) : des pastilles SANS FOND — un filet clair, le texte en
  // couleur — pour le partage, la personne qui paie seule, et le compte par lequel la charge passe. Elles disent leur nom :
  // plus de légende. L'équivalent mensuel d'une charge annuelle reste en texte simple.
  const sp = c.split || {};
  const seule = sp.mode === 'perso'
    ? (() => { const avec = people.filter(p => (Number(sp.amounts?.[p.id]) || 0) > 0); return avec.length === 1 ? avec[0] : null; })()
    : null;
  const iSeule = seule ? people.indexOf(seule) : -1;
  const reperes = (
    <>
      {seule
        ? <span className="ch-tag" style={{ color: personTextAt(iSeule), borderColor: `color-mix(in srgb, ${personColorAt(iSeule)} 35%, #fff)` }}>{seule.label}</span>
        : <span className="ch-tag">{partageEnMots(c, people) === 'Au prorata' ? 'Prorata' : partageEnMots(c, people) === 'Montants fixés' ? 'Montants' : partageEnMots(c, people)}</span>}
      {c.joint && <span className="ch-tag ch-tag--joint">Compte joint</span>}
      {annuelle && c.provision !== false && <span className="ch-tag ch-tag--livret">Livret</span>}
      {annuelle && <span className="ch-tag-txt">{eur(total / 12)}/mois</span>}
    </>
  );
  const bulleParts = (
    <>
      {annuelle && 'Par mois : '}
      {parts.map((x, k) => (
        <React.Fragment key={x.p.id}>
          {k > 0 && ' · '}
          <span className="csm-name" style={{ color: personTextAt(x.i) }}>{x.p.label}</span> {eur(x.v)}
        </React.Fragment>
      ))}
      {annuelle && <span className="infotip-sous">{eur(total)} par an</span>}
    </>
  );
  // Le pointillé ne souligne que le CHIFFRE : le « € » reste hors de la bulle, en gris, comme dans les listes d'opérations.
  const chiffre = `${annuelle ? '' : '−'}${fmt(total)}`; // signe collé (règle du 14/11/2026)
  return (
    <div ref={dropRef} className="ch-ligne">
      <span ref={dragRef} className="ch-grip" title="Glisser pour réordonner"><Icon name="poignee" size={14} /></span>
      <span className="ch-nom">
        <b>{c.label || '(sans libellé)'}</b>
        <small className="ch-reperes">{reperes}</small>
      </span>
      <span className="ch-montant">
        <span className="ch-montant-val">
          {parts.length > 0
            ? <InfoTip className="charge-montant-tip" popClassName="infotip-pop--wrap" label={`${annuelle ? 'Par mois : ' : ''}${partsTexte}`} content={bulleParts}>{chiffre}</InfoTip>
            : chiffre}
        </span> <span className="cur">€</span>
      </span>
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
        <label className="label">Répartition<AideChamp>{people.map((p, i) => (
          <span key={p.id}>{i > 0 ? ' · ' : 'Part : '}<strong style={{ color: personTextAt(i) }}>{p.label}</strong> {eur(chargeShareOf(tempCharge, p.id, nets, people.length))}</span>
        ))}</AideChamp></label>
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
            <label className="label">{annual ? 'Total annuel (€)' : 'Total mensuel (€)'}<AideChamp>{(annual || mode === 'prorata') && <>
              {annual && <>Réparti sur 12 mois : ≈ {eur((Number(total) || 0) / 12)} / mois.</>}
              {annual && mode === 'prorata' && ' '}
              {mode === 'prorata' && 'Réparti au prorata des salaires nets.'}
            </>}</AideChamp></label>
            <AmountInput className="input" value={total} onChange={setTotal} placeholder="0.00" />
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
// Fenêtre « Scénario » (version 2, 15/11/2026) : le nom, l'interrupteur « Scénario de référence » et la suppression, comme
// les Réglages d'une enveloppe. Le scénario de référence ne se retire pas d'ici (il en faut toujours un) : on en choisit un
// autre.
function ScenarioForm({ nom, estReference, peutSupprimer, onClose, onSubmit, onDelete, refuserReference }) {
  const [valeur, setValeur] = useState(nom || '');
  const [reference, setReference] = useState(!!estReference);
  return (
    <Modal title="Scénario" icon="receipt" subtitle="Répartition des charges" onClose={onClose} dirty={valeur !== (nom || '') || reference !== !!estReference}>
      <form noValidate onSubmit={(e) => { e.preventDefault(); onSubmit(valeur.trim() || 'Sans nom', reference); }} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <label className="label">Nom du scénario</label>
          <input type="text" className="input" value={valeur} onChange={(e) => setValeur(e.target.value)} placeholder="ex: Paris, Rennes…" />
        </div>
        <div className="settings-groupe">
          <ModuleToggleRow
            label="Scénario de référence"
            hint="Base de la comparaison (★)"
            enabled={reference}
            onChange={(v) => { if (!v && estReference) { refuserReference(); return; } setReference(v); }}
          />
        </div>
        {peutSupprimer && (
          <div className="zone-danger">
            <b>Supprimer ce scénario</b>
            <small>Ses charges et ses revenus seront supprimés.</small>
            <button type="button" className="btn btn-danger" onClick={onDelete}>
              <Icon name="trash" size={14} /> Supprimer
            </button>
          </div>
        )}
        <button type="submit" className="btn btn-accent btn-lg">Enregistrer</button>
      </form>
    </Modal>
  );
}

// Fenêtre « Revenu net » d'une personne, pour le scénario affiché.
function RevenuForm({ personne, scenario, valeur, onClose, onSubmit }) {
  const [v, setV] = useState(valeur);
  return (
    <Modal title="Revenu net" icon="receipt" subtitle={`${scenario} · ${personne}`} onClose={onClose} dirty={String(v ?? '') !== String(valeur ?? '')}>
      <form noValidate onSubmit={(e) => { e.preventDefault(); onSubmit(v); }} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <label className="label">Revenu net mensuel</label>
          <div className="unite-eur"><AmountInput className="input" value={v} onChange={setV} placeholder="0.00" /></div>
        </div>
        <button type="submit" className="btn btn-accent btn-lg">Enregistrer</button>
      </form>
    </Modal>
  );
}

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
  useSlideIndicator(railRef, railIndRef, '.seg-tab-active', [activeId, view, railLabels], view, true);
  // « COMPARER » N'EST PAS UN ONGLET DU RAIL (15/11/2026, relevé de l'utilisateur) : la pastille se rétractait vers sa gauche
  // pendant que « Comparer » fonçait, et l'œil y voyait une couleur glisser du scénario jusqu'au bouton. `view` est passé en
  // `followKey` : à chaque bascule scénario ↔ comparaison, useSlideIndicator colle la pastille SANS transition (son suivi
  // image par image) — effacée d'un coup vers « Comparer », posée sans grandir au retour. Entre deux scénarios, `view` ne
  // change pas : elle glisse toujours. ⚠️ Une coupure de transition posée HORS du hook est annulée par son nettoyage (piège
  // noté dans useSlideIndicator, app.js) — d'où ce paramètre. La classe `.en-comparaison` masque la pastille dès le rendu.
  // null = fermé, 'new' = création, objet charge = édition
  const [editingCharge, setEditingCharge] = useState(null);
  const [editingScenario, setEditingScenario] = useState(false); // fenêtre « Scénario » (nom, référence, suppression)
  const [editingRevenu, setEditingRevenu] = useState(null); // id de la personne dont on modifie le revenu net
  const showToastCharges = ctx.showToast;

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
    return (
      <span className={`cmp-delta ${cls}`}>
        <span className="cmpd-exact">{fmtPct(d * 100)}</span>
        <span className="cmpd-round">{fmtPct(d * 100, { dec: 0 })}</span>
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
    <Modal liste title="Répartition des charges" icon="receipt" subtitle="Compte partagé" size="xl" onClose={onClose}>
      {/* Barre d'onglets : rail segmented des scénarios (défilant, pastille
          glissante) + « + » (action, hors rail) + « Comparer » épinglé à
          droite — TOUJOURS visible, icône + texte, même sur mobile. */}
      <div className="charges-tabbar">
        <div className="seg-bar" style={{ flex: 1, minWidth: 0 }}>
          <div className={`seg-rail${view === 'compare' ? ' en-comparaison' : ''}`} ref={railRef}>
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
                <span>{s.name || '(sans nom)'}{s.id === baseScenario.id ? ' ★' : ''}</span>
              </button>
            ))}
          </div>
          <button className="seg-add" onClick={() => { if (confirm('Créer un nouveau scénario (copie du scénario courant) ?')) { addScenario(); setView('scenario'); } }} title="Ajouter un scénario" aria-label="Ajouter un scénario">+</button>
          {data.scenarios.length > 1 && (
            <button className={`seg-solo${view === 'compare' ? ' on' : ''}`} onClick={() => setView('compare')} aria-label="Comparer" title="Comparer">
              <span>Comparer</span>
            </button>
          )}
          {/* « ⋯ » : les réglages du scénario affiché (nom, référence, suppression), dans leur fenêtre — comme les
              Réglages d'une enveloppe ou d'un livret (version 2, 15/11/2026). */}
          {view === 'scenario' && (
            <button type="button" className="seg-solo seg-kebab" onClick={() => setEditingScenario(true)} aria-label="Réglages du scénario" title="Réglages du scénario">⋯</button>
          )}
        </div>
      </div>

      {view === 'scenario' ? (
        <>
          {/* Revenus nets : une ligne par personne, le crayon ouvre la fenêtre « Revenu net » (on ne saisit rien
              directement dans une liste — règle de l'app). */}
          <h3 className="settings-group-title">Revenus nets</h3>
          <div className="ch-liste">
            {people.map((p, i) => (
              <div key={p.id} className="ch-ligne ch-ligne--revenu">
                <span className="ch-av" style={{ background: personLightAt(i), color: personTextAt(i) }}>{initials(p.label)}</span>
                <span className="ch-nom"><b>{p.label}</b></span>
                <span className="ch-montant"><span className="ch-montant-val ch-montant-val--neutre">{fmt(Number(active.incomes?.[p.id]?.net) || 0)}</span> <span className="cur">€</span></span>
                <button className="tx-edit" onClick={() => setEditingRevenu(p.id)} title="Modifier"><Icon name="pencil" size={13} /></button>
              </div>
            ))}
          </div>

          {/* Charges — deux listes (mensuelles / annuelles), édition via sous-modale.
              On garde l'index d'origine dans active.charges pour le glisser-déposer. */}
          {(() => {
            const indexed = (active.charges || []).map((c, index) => ({ c, index }));
            const monthly = indexed.filter(x => x.c.period !== 'annual');
            const annual = indexed.filter(x => x.c.period === 'annual');
            const totalMensuel = monthly.reduce((t, x) => t + chargeTotalOf(x.c), 0);
            const totalAnnuel = annual.reduce((t, x) => t + chargeTotalOf(x.c), 0);
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
            const emptyMsg = (txt) => <div className="ch-vide">{txt}</div>;
            return (
              <>
                <h3 className="settings-group-title">Charges mensuelles<span className="ch-total">{eurEl(totalMensuel)}</span></h3>
                <div className="ch-liste">
                  {monthly.length ? monthly.map(renderRow) : emptyMsg('Aucune charge mensuelle pour ce scénario.')}
                </div>
                <button className="btn-add ch-ajout" onClick={() => setEditingCharge('new')}>Ajouter une charge mensuelle</button>

                <h3 className="settings-group-title">Charges annuelles<AideChamp>Réparties sur 12 mois ; celles marquées « livret » sont provisionnées chaque mois sur le livret.</AideChamp><span className="ch-total">par mois : {eurEl(totalAnnuel / 12)}</span></h3>
                <div className="ch-liste">
                  {annual.length ? annual.map(renderRow) : emptyMsg('Aucune charge annuelle.')}
                </div>
                <button className="btn-add ch-ajout" onClick={() => setEditingCharge('new-annual')}>Ajouter une charge annuelle</button>
              </>
            );
          })()}

          {/* Synthèse : une carte grise par personne, comme « Mettre à jour les valeurs ». */}
          <h3 className="settings-group-title">Synthèse — {active.name}<AideChamp>La provision du livret est arrondie aux 5 € supérieurs, le PEA aux 5 € inférieurs, et le tampon garde au moins 300 € sur le compte courant.</AideChamp></h3>
          {people.map((p, i) => {
            // Répartition de « Il reste » (déjà net du virement et de la provision, qui sont dans « À payer »).
            //  - Provision : arrondie au 5 SUPÉRIEUR (v526 — l'ancienne dizaine au plus proche pouvait SOUS-provisionner).
            //  - Le DÉPASSEMENT (provision arrondie − exacte) est retiré du reste avant le partage PEA/Tampon : chaque euro
            //    n'apparaît qu'une seule fois (variante « B » validée).
            //  - Tampon : au moins TAMPON_MIN → on arrondit le PEA À L'INFÉRIEUR, par crans de 5 (v527).
            const restant = sum.restant[p.id];
            const virement = sum.virement[p.id];
            const provisionExact = sum.provision[p.id] || 0;
            const provision = Math.ceil(provisionExact / 5) * 5;
            const alloue = r2(restant - r2(provision - provisionExact));
            const TAMPON_MIN = 300;
            const pea = Math.max(0, Math.floor((alloue - TAMPON_MIN) / 5) * 5);
            const tampon = r2(alloue - pea);
            return (
              <div key={p.id} className="ch-carte">
                <div className="ch-carte-tete">
                  <span className="ch-av ch-av--petit" style={{ background: personLightAt(i), color: personTextAt(i) }}>{initials(p.label)}</span>
                  <b>{p.label}</b>
                  <span className="ch-reste" style={{ color: restant >= 0 ? 'var(--success-fonce)' : 'var(--danger-fonce)' }}><small>Il reste</small>{eurEl(restant)}</span>
                </div>
                {virement > 0 && <div className="ch-carte-l"><span>Virement au compte joint</span><span>{eurEl(virement)}</span></div>}
                {provision > 0 && <div className="ch-carte-l"><span>Provision sur le livret</span><span>{eurEl(provision)}</span></div>}
                <div className="ch-carte-l"><span>PEA</span><span>{eurEl(pea)}</span></div>
                <div className="ch-carte-l"><span>Tampon sur le compte courant</span><span>{eurEl(tampon)}</span></div>
              </div>
            );
          })}
        </>
      ) : (
        /* ---- Vue Comparaison : une carte grise par personne, scénarios en lignes ---- */
        <div className="cmp-d1">
          {people.map((p, i) => (
            <div key={p.id} className="ch-carte cmpp">
              <div className="ch-carte-tete">
                <span className="ch-av ch-av--petit" style={{ background: personLightAt(i), color: personTextAt(i) }}>{initials(p.label)}</span>
                <b>{p.label}</b>
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

      {editingScenario && (
        <ScenarioForm
          nom={active.name}
          estReference={isBaseline}
          peutSupprimer={data.scenarios.length > 1}
          onClose={() => setEditingScenario(false)}
          onSubmit={(nom, reference) => {
            renameScenario(nom);
            if (reference && !isBaseline) setData(d => ({ ...d, baselineScenarioId: active.id }));
            setEditingScenario(false);
          }}
          onDelete={() => { setEditingScenario(false); deleteScenario(); }}
          refuserReference={() => refuser(showToastCharges, 'Choisis un autre scénario comme référence : il en faut toujours un.')}
        />
      )}

      {editingRevenu && (() => {
        const p = people.find(x => x.id === editingRevenu);
        if (!p) return null;
        return (
          <RevenuForm
            personne={p.label}
            scenario={active.name}
            valeur={active.incomes?.[p.id]?.net}
            onClose={() => setEditingRevenu(null)}
            onSubmit={(v) => { setIncome(p.id, 'net', v); setEditingRevenu(null); }}
          />
        );
      })()}

      {editingCharge !== null && (() => {
        const isNew = editingCharge === 'new' || editingCharge === 'new-annual';
        return (
        <Modal title={isNew ? 'Nouvelle charge' : 'Modifier la charge'} icon="receipt" subtitle="Répartition des charges" onClose={() => setEditingCharge(null)}>
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
