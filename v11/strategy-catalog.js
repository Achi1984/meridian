import {B17_EVIDENCE_SNAPSHOT, projectResearchEvidence} from './research-evidence.js';

export const CAMPAIGN_SOURCE = '../docs/strategy-lab/campaign-20261013.json';
export const FAMILY_IDS = Object.freeze(['H1','H2','H3','H4','H5','H6','H7','H8','H9','H10','H11','H12']);

const explanations = {
  H1: ['Trendfolge mit Spot und Cash', 'Tägliche Signale: Einstieg nach Schluss über SMA200 und positivem 90-Tage-Trend; Ausstieg nach SMA200-Bruch oder vorab festgelegtem Risikostopp.', 'SPOT', 'BULL', 'Tägliche Signale; Haltedauer nicht festgelegt', 'Point-in-time-Universum, vollständige Tageskurse inklusive Delistings und unabhängiges Testfenster fehlen.'],
  H2: ['Reaktion auf institutionelle Nachfrageereignisse', 'Prüft den vorab definierten 24-Stunden-Kursüberschuss nach der ersten Veröffentlichung; keine Orders in der Ereignisstudie.', 'EVENT_STUDY', 'BULL', '24 Stunden nach Erstveröffentlichung', 'Originale Veröffentlichungszeitpunkte, revisionsfeste Ereignisse und unabhängige Vergleichsereignisse fehlen.'],
  H3: ['Relative Schwäche im Bärenmarkt', 'Prüft zuerst, ob relative Schwäche bei fallendem Gesamtmarkt zusätzliche Verluste ankündigt; ein Handelsdesign ist noch nicht belegt.', 'PERPETUAL', 'BEAR', 'Feature-Prüfung zuerst; Handelsdauer unbekannt', 'Zeitpunktgerechte Regime- und Renditedaten, Instrumentverfügbarkeit und unabhängige Feature-Prüfung fehlen.'],
  H4: ['Systematische Absicherung in Stressphasen', 'Untersucht, ob eine begrenzte Short-Absicherung extreme Verluste eines Spot-Portfolios nach Absicherungskosten verringert.', 'PERPETUAL', 'BEAR · HYBRID', 'Stressabhängig; Haltedauer nicht festgelegt', 'Portfolioexposition, Mark-/Indexpreise, Funding und ein Tail-Risk-Vergleich fehlen.'],
  H5: ['Schock und bestätigte Rückeroberung', 'Nach einem starken 5-Minuten-Schock wird eine Rückeroberung des Mittelpunkts abgewartet; Stop, Zeitlimit und maximal ein Versuch je Ereignis sind skizziert.', 'PERPETUAL', 'RANGE · HYBRID', '5-Minuten-Signale; höchstens 6 Bars laut Skizze', 'Tick-/Minutendaten, stabile Signalzeitpunkte, zweiseitige Kosten und unabhängige Ereignisse fehlen.'],
  H6: ['Rückkehr eines stabilen Preisverhältnisses', 'Prüft zunächst die Stabilität des BTC/ETH-Preisrests; ein Entwurf sieht danach synchronisierte, kostenbewertete Mehrbein-Positionen vor.', 'MULTI_LEG', 'RANGE · HYBRID', 'Stündliche Schätzung; Entwurf mit 24-Stunden-Grenze', 'Unabhängiger Stabilitätstest, beide Orderbücher und ein zeitpunktgerechter Hedgefaktor fehlen.'],
  H7: ['Defensive Spot-Auswahl mit Cash', 'Skizziert eine wöchentliche Auswahl von bis zu drei geeigneten, schwankungsarmen Assets; mindestens 25 % Cash bleiben bei der Zuteilung frei.', 'SPOT', 'BULL · BEAR · HYBRID', 'Wöchentliche Rangprüfung; tägliche SMA200-Ausstiege', 'Audit der eingefrorenen LowVol-Referenz, point-in-time-Daten, Ausführungsmodell und unabhängige Prüfung der geänderten Exposition fehlen.'],
  H8: ['Verifizierte externe Börsenflüsse', 'Untersucht echte, zeitlich belegte externe Transfers oberhalb eines vorab festgelegten Schwellenwerts gegen einen Preis-/Volumenvergleich.', 'EVENT_STUDY', 'BULL · BEAR · HYBRID', '60-Minuten-Ereignisfenster', 'Historische Wallet-Klassifikation, Empfangszeitpunkte, ausreichende Lizenzdaten und Vergleichsereignisse fehlen.'],
  H9: ['Konvergenz eines datierten Futures-Basis', 'Untersucht die gleichzeitig ausführbare Spot-/Futures-Basis nach Finanzierung und Kosten. Ohne vollständige Daten gibt es keine virtuellen Trades.', 'MULTI_LEG', 'HYBRID', 'Bis Abrechnung oder vorab definierte Spread-Grenze', 'Datiertes Kontrakt- und Abrechnungsmodell, synchronisierte Zwei-Bein-Kurse, Finanzierung und Margin-Stress fehlen.'],
  H10: ['Nachfrageeffekt um Funding-Abrechnungen', 'Prüft Kursreaktionen um tatsächliche Funding-Zeitpunkte anhand der vor der Abrechnung bekannten Erwartungen.', 'EVENT_STUDY', 'HYBRID', 'Vorab festgelegtes Ereignisfenster fehlt', 'Historische Abrechnungspläne, erwartete und realisierte Sätze sowie hochauflösende Zeitstempel fehlen.'],
  H11: ['Nachfrage durch angekündigte Indexanpassungen', 'Vergleicht den vorab bestimmten Effekt zwischen erster Ankündigung und Wirksamkeit mit zeitpunktgerechten Markt- und Liquiditätskontrollen.', 'EVENT_STUDY', 'BULL · BEAR · HYBRID', 'Ankündigung bis Wirksamkeit; Nachfenster nicht festgelegt', 'Verifizierte Ankündigungen, genügend unabhängige Ereignisse, point-in-time-Bestandteile und Vergleichsgruppen fehlen.'],
  H12: ['Kausale Risikoallokation nach Marktregime', 'Skizziert eine verzögerte Regimezuordnung für bereits unabhängig validierte Spezialstrategien; fehlende Spezialisten bedeuten Cash.', 'ALLOCATOR', 'BULL · BEAR · RANGE · HYBRID', 'Tägliche, verzögerte Regimeentscheidung', 'Unabhängig validierte Spezialisten, eingefrorene Gewichte und faire Fixgewicht-Kontrolle fehlen.']
};

const instrumentLabels = {
  SPOT: 'Spotmarkt',
  PERPETUAL: 'Perpetual-Futures',
  MULTI_LEG: 'Mehrbeiniger Markt',
  EVENT_STUDY: 'Ereignisstudie',
  ALLOCATOR: 'Portfolio-Allokation'
};

const arenaEvidence = {
  H1: ['H1-B', 'H1-E'],
  H7: ['H7-B', 'H7-R'],
  H9: ['H9']
};

const allPrerequisite = 'Für neue Kandidaten sind ein verifiziertes endliches Auszahlungsmodell mit mindestens 3:1 Netto-CRV nach konservativen Kosten sowie die jeweils unabhängigen Daten- und Prüfbelege offen. Das Register selbst erteilt keine Freigabe.';

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function unknownCatalog(reason) {
  return {status:'UNKNOWN', source:CAMPAIGN_SOURCE, reason, families:[], candidate: B17_CANDIDATE};
}

export const B17_CANDIDATE = Object.freeze({
  id:'B1-7',
  stage:'IN ENTWICKLUNG',
  assets:7,
  plannedPaths:44,
  baselineCostBps:15,
  stressCostBps:30,
  horizon:'R3: Annahmen für den Stresstest: 15 bp Basis / 30 bp Stress / +1 Tag.',
  evidence:'Keine Ergebnisse; ausschließlich Entwicklungskandidat.',
  blocker:'D1-Manifest nicht eingefroren; D2, Paper und Live benötigen getrennte Freigaben.',
  source:'M11-Arbeitsauftrag B12 · kein Arena-Ergebnis'
});

export function buildStrategyCatalog(campaign, evidence=B17_EVIDENCE_SNAPSHOT) {
  if (!object(campaign) || campaign.schemaVersion !== 'MERIDIAN_STRATEGY_CAMPAIGN_DRAFT_V1' ||
      !Array.isArray(campaign.families) || campaign.families.length !== FAMILY_IDS.length) {
    return unknownCatalog('Das Familienregister fehlt, ist leer oder hat ein unbekanntes Format.');
  }
  const byId = new Map();
  for (const family of campaign.families) {
    if (!object(family) || typeof family.id !== 'string' || byId.has(family.id)) {
      return unknownCatalog('Familienregister enthält ungültige oder doppelte Einträge.');
    }
    byId.set(family.id, family);
  }
  if (FAMILY_IDS.some(id => !byId.has(id))) return unknownCatalog('Nicht alle zwölf Quellfamilien sind vorhanden.');

  const families = FAMILY_IDS.map(id => {
    const source = byId.get(id);
    const [title, rule, market, regimes, horizon, blockers] = explanations[id];
    const modelIds = arenaEvidence[id] || [];
    const diagnostic = id === 'H9' ? 'BLOCKED_DATA' :
      modelIds.length ? 'HISTORISCHE_DIAGNOSE_VORHANDEN · NICHT UNABHÄNGIG' : 'KEIN HISTORISCHER TESTBELEG IM REGISTER';
    return {
      id, title, sourceName:typeof source.name === 'string' ? source.name : 'Unbekannt',
      explanation:typeof source.hypothesis === 'string' ? source.hypothesis : 'Unbekannt',
      sourceStatus:typeof source.status === 'string' ? source.status : 'UNKNOWN',
      validationStatus:typeof source.validationStatus === 'string' ? source.validationStatus : 'UNKNOWN',
      market:`${instrumentLabels[market] || 'Unbekannt'} · ${regimes}`,
      marketCode:market, regimes, horizon, rule,
      cost:'Nicht festgelegt · keine verifizierte Kostenbasis.',
      diagnostic, modelIds,
      evidenceIdentity:id === 'H9' ? 'research/results/strategy-arena-20261016/manifest.json · BLOCKED_DATA, keine Auswertung' : modelIds.length
        ? 'research/results/strategy-arena-20261016/manifest.json · historische Diagnose, nicht unabhängig'
        : CAMPAIGN_SOURCE,
      sourceIdentity:CAMPAIGN_SOURCE,
      blockers,
      sourceEntry:typeof source.entrySketch === 'string' ? source.entrySketch : 'Unbekannt',
      sourceExit:typeof source.exitSketch === 'string' ? source.exitSketch : 'Unbekannt',
      sourcePrerequisites:Array.isArray(source.prerequisites) ? source.prerequisites.filter(x=>typeof x==='string') : [],
      failureRegime:typeof source.failureRegime === 'string' && source.failureRegime.trim()
        ? source.failureRegime : 'Unbekannt',
      lineage:typeof source.lineage === 'string' ? source.lineage : 'Unbekannt',
      historicalStage:id === 'H9' ? 'BLOCKED_DATA' : modelIds.length ? 'HISTORISCHE DIAGNOSE' : 'NICHT BELEGT',
      independentStage:'NICHT BELEGT',
      paperStage:'KEIN LAUFENDER PAPER-BELEG',
      liveStage:'NICHT FREIGEGEBEN'
    };
  });
  return {
    status:'PRESENT_UNVERIFIED',
    source:CAMPAIGN_SOURCE,
    sourceStatus:campaign.status === 'DRAFT' ? 'DRAFT' : 'UNKNOWN',
    families,
    candidate:B17_CANDIDATE,
    researchEvidence:projectResearchEvidence(evidence),
    sharedBlocker:allPrerequisite,
    knownEvidence:Array.isArray(campaign.knownEvidence) ? campaign.knownEvidence : []
  };
}

export function buildStrategyComparison(families, firstId, secondId) {
  const byId = new Map(Array.isArray(families) ? families.map(family=>[family.id,family]) : []);
  const first = byId.get(firstId) || null;
  const second = byId.get(secondId) || null;
  return {
    status:first && second ? 'PRESENT_UNVERIFIED' : 'UNKNOWN',
    first,
    second,
    identical:Boolean(first && second && first.id === second.id)
  };
}

function addText(document, parent, tag, text, className) {
  const node = document.createElement(tag);
  node.textContent = String(text ?? 'Unbekannt');
  if (className) node.className = className;
  parent.append(node);
  return node;
}

function addField(document, parent, label, value) {
  const row = document.createElement('div');
  addText(document,row,'dt',label);
  addText(document,row,'dd',value);
  parent.append(row);
}

function renderFamily(document, family) {
  const article = document.createElement('article');
  article.className = 'card strategy-family';
  article.dataset.strategyId = family.id;
  const header = document.createElement('div');
  header.className = 'strategy-card-head';
  addText(document,header,'span',family.id,'strategy-id');
  addText(document,header,'span',family.sourceStatus === 'DRAFT' ? 'Hypothese · Entwurf' : 'Quellstatus unbekannt','limited');
  article.append(header);
  addText(document,article,'h2',family.title);
  addText(document,article,'p',family.explanation);
  const summary = document.createElement('dl');
  summary.className = 'strategy-summary';
  addField(document,summary,'Markt / Regime',family.market);
  addField(document,summary,'Horizont',family.horizon);
  addField(document,summary,'Kosten',family.cost);
  addField(document,summary,'Historischer Beleg',family.diagnostic);
  article.append(summary);
  const progression = document.createElement('ol');
  progression.className = 'strategy-progression';
  progression.setAttribute('aria-label',`${family.id}: Entwicklungsstand`);
  for (const [stage,label] of [
    ['Hypothese',family.sourceStatus === 'DRAFT' ? 'Entwurf' : 'Unbekannt'],
    ['Historischer Test',family.historicalStage],
    ['Unabhängige Prüfung',family.independentStage],
    ['Prospektives Paper',family.paperStage],
    ['Live-Bereitschaft',family.liveStage]
  ]) {
    const item = document.createElement('li');
    addText(document,item,'strong',stage);
    addText(document,item,'span',label);
    progression.append(item);
  }
  article.append(progression);
  const details = document.createElement('details');
  const summaryNode = addText(document,details,'summary','Regeln, Belege und Hindernisse');
  summaryNode.setAttribute('tabindex','0');
  const body = document.createElement('div');
  body.className = 'details-body';
  addText(document,body,'p',`Regelidee: ${family.rule}`);
  addText(document,body,'p',`Quellskizze · Einstieg: ${family.sourceEntry}`);
  addText(document,body,'p',`Quellskizze · Ausstieg: ${family.sourceExit}`);
  addText(document,body,'p',`Hindernis: ${family.blockers}`);
  addText(document,body,'p',`Zusätzliche Quellvoraussetzungen: ${family.sourcePrerequisites.join(' · ') || 'Unbekannt'}`);
  addText(document,body,'p',`Linie: ${family.lineage}`);
  addText(document,body,'p',`Letzte Quell-/Evidenzidentität: ${family.evidenceIdentity}`);
  addText(document,body,'p',`Kampagnenquelle: ${family.sourceIdentity}`);
  details.append(body);
  article.append(details);
  return article;
}

function renderComparisonFamily(document, parent, family) {
  const article = document.createElement('article');
  article.className = 'arena-model-card';
  article.dataset.comparisonFamily = family.id;
  const header = document.createElement('header');
  const identity = document.createElement('div');
  addText(document,identity,'strong',`${family.id} · ${family.sourceName}`);
  addText(document,identity,'span',
    `Quelle: ${CAMPAIGN_SOURCE} · ${family.sourceStatus} · Research: ${family.validationStatus}`);
  header.append(identity);
  article.append(header);
  const fields = document.createElement('dl');
  for (const [label,value] of [
    ['Hypothese',family.explanation],
    ['Markt / Regime',family.market],
    ['Horizont',family.horizon],
    ['Einstiegsskizze',family.sourceEntry],
    ['Ausstiegsskizze',family.sourceExit],
    ['Fehlermodus',family.failureRegime],
    ['Voraussetzungen',family.sourcePrerequisites.join(' · ') || 'Unbekannt'],
    ['Linie',family.lineage]
  ]) addField(document,fields,label,value);
  article.append(fields);
  parent.append(article);
}

function renderStrategyComparison(document, catalog) {
  const section = document.createElement('section');
  section.className = 'card strategy-comparison';
  section.setAttribute('aria-labelledby','strategy-comparison-heading');
  addText(document,section,'h2','Hypothesen vergleichen').id = 'strategy-comparison-heading';
  addText(document,section,'p',
    'Zwei Familien aus dem Entwurfsregister nebeneinander. Gleiche Auswahl wird auf beiden Seiten gezeigt; keine Rangfolge oder Bewertung.');

  const controls = document.createElement('div');
  controls.className = 'arena-toolbar';
  const selectors = [];
  for (const [id,label,attribute,defaultId] of [
    ['strategy-comparison-first','Erste Familie','first','H1'],
    ['strategy-comparison-second','Zweite Familie','second','H2']
  ]) {
    const wrapper = document.createElement('label');
    wrapper.className = 'arena-control';
    wrapper.setAttribute('for',id);
    addText(document,wrapper,'span',label);
    const select = document.createElement('select');
    select.id = id;
    select.dataset.strategyCompare = attribute;
    select.setAttribute('style','box-sizing:border-box;width:100%;min-width:0;min-height:48px;padding:8px');
    for (const family of catalog.families) {
      const option = document.createElement('option');
      option.value = family.id;
      option.textContent = `${family.id} · ${family.sourceName}`;
      select.append(option);
    }
    select.value = defaultId;
    wrapper.append(select);
    controls.append(wrapper);
    selectors.push(select);
  }
  const reset = document.createElement('button');
  reset.type = 'button';
  reset.dataset.strategyCompareReset = '';
  reset.textContent = 'Auswahl zurücksetzen';
  controls.append(reset);
  section.append(controls);

  const comparison = document.createElement('div');
  comparison.className = 'arena-toolbar';
  comparison.setAttribute('aria-label','Vergleich der ausgewählten Hypothesen');
  comparison.setAttribute('aria-live','polite');
  const update = () => {
    comparison.replaceChildren();
    const model = buildStrategyComparison(catalog.families,selectors[0].value,selectors[1].value);
    if (model.status !== 'PRESENT_UNVERIFIED') {
      addText(document,comparison,'p','Auswahl nicht verfügbar. Fehlende Quellfelder bleiben unbekannt.','arena-unknown');
      return;
    }
    if (model.identical) {
      addText(document,comparison,'p',`Dieselbe Familie (${model.first.id}) ist auf beiden Seiten ausgewählt.`);
    }
    renderComparisonFamily(document,comparison,model.first);
    renderComparisonFamily(document,comparison,model.second);
  };
  selectors.forEach(select=>select.addEventListener('change',update));
  reset.addEventListener('click',()=>{
    selectors[0].value = 'H1';
    selectors[1].value = 'H2';
    update();
  });
  update();
  section.append(comparison);
  return section;
}

function renderHistoricalResearch(document, catalog) {
  const section = document.createElement('section');
  section.className = 'card card-muted strategy-history';
  section.setAttribute('aria-labelledby','strategy-history-heading');
  addText(document,section,'h2','Bisherige Forschung').id = 'strategy-history-heading';
  addText(document,section,'p',
    `Quelle: Historische Zusammenfassungen aus dem Entwurfsregister (${catalog.source}); nicht neu verifizierte Evidenz. Keine Zuordnung zu H1–H12, keine Vererbung von PASS und keine Paper-Freigabe.`);

  const entries = catalog.knownEvidence
    .filter(object)
    .map(entry => ({
      family:typeof entry.family === 'string' && entry.family.trim() ? entry.family :
        typeof entry.name === 'string' && entry.name.trim() ? entry.name : 'Unbekannt',
      decision:typeof entry.decision === 'string' && entry.decision.trim() ? entry.decision :
        typeof entry.status === 'string' && entry.status.trim() ? entry.status : 'Unbekannt',
      reason:typeof entry.reason === 'string' && entry.reason.trim() ? entry.reason :
        typeof entry.rationale === 'string' && entry.rationale.trim() ? entry.rationale : 'Unbekannt'
    }));
  const controls = document.createElement('div');
  controls.className = 'arena-toolbar';
  const label = document.createElement('label');
  label.className = 'arena-control';
  label.setAttribute('for','strategy-history-search');
  addText(document,label,'span','Historische Zusammenfassungen durchsuchen (Familie, Entscheidung, Begründung)');
  const search = document.createElement('input');
  search.id = 'strategy-history-search';
  search.type = 'search';
  search.value = '';
  search.setAttribute('style','box-sizing:border-box;width:100%;min-width:0;min-height:48px;padding:8px');
  label.append(search);
  controls.append(label);
  const reset = document.createElement('button');
  reset.type = 'button';
  reset.dataset.strategyHistoryReset = '';
  reset.textContent = 'Suche zurücksetzen';
  controls.append(reset);
  section.append(controls);

  const count = addText(document,section,'p',`0 von ${entries.length} Zusammenfassungen angezeigt.`);
  count.setAttribute('role','status');
  count.setAttribute('aria-live','polite');
  const results = document.createElement('div');
  results.className = 'arena-models';
  section.append(count,results);

  const update = () => {
    const query = search.value.trim().toLowerCase();
    const matches = entries.filter(entry =>
      [entry.family,entry.decision,entry.reason].some(value=>value.toLowerCase().includes(query)));
    count.textContent = `${matches.length} von ${entries.length} Zusammenfassungen angezeigt.`;
    results.replaceChildren();
    if (!matches.length) {
      addText(document,results,'p',entries.length
        ? 'Keine historischen Zusammenfassungen entsprechen der Suche.'
        : 'Keine historischen Zusammenfassungen verfügbar.','arena-unknown');
      return;
    }
    for (const entry of matches) {
      const card = document.createElement('article');
      card.className = 'arena-model-card';
      const fields = document.createElement('dl');
      addField(document,fields,'Familie / Name',entry.family);
      addField(document,fields,'Entscheidung / Status',entry.decision);
      addField(document,fields,'Vollständige Begründung',entry.reason);
      card.append(fields);
      results.append(card);
    }
  };
  search.addEventListener('input',update);
  reset.addEventListener('click',()=>{
    search.value = '';
    update();
  });
  update();
  return section;
}

export function renderStrategyCatalog(root, campaign, document=root?.ownerDocument || globalThis.document, evidence=B17_EVIDENCE_SNAPSHOT) {
  if (!root || !document) return unknownCatalog('Ansicht nicht verfügbar.');
  const catalog = buildStrategyCatalog(campaign, evidence);
  root.replaceChildren();
  if (catalog.status !== 'PRESENT_UNVERIFIED') {
    const status = addText(document,root,'p',catalog.reason,'strategy-source-error');
    status.setAttribute('role','status');
    return catalog;
  }
  const notice = document.createElement('section');
  notice.className = 'card strategy-source-notice';
  addText(document,notice,'p','12 Familien aus dem unveränderten Entwurfsregister. Stufen bezeichnen nur vorhandene Quellenbelege; kein automatischer Aufstieg, keine Gewinnerwahl.');
  addText(document,notice,'p',catalog.sharedBlocker);
  root.append(notice);
  root.append(renderStrategyComparison(document,catalog));
  root.append(renderHistoricalResearch(document,catalog));
  for (const family of catalog.families) root.append(renderFamily(document,family));

  const candidate = document.createElement('article');
  candidate.className = 'card strategy-candidate';
  candidate.dataset.strategyId = catalog.candidate.id;
  addText(document,candidate,'span','IN ENTWICKLUNG','limited');
  addText(document,candidate,'h2','B1-7 · separater Research-Kandidat');
  addText(document,candidate,'p','7 Assets · 44 geplante Pfade. R3-Annahmen: 15 bp Basis, 30 bp Stress, +1 Tag. Es gibt keine Ergebnisse.');
  addText(document,candidate,'p','Diese 7-Asset-Vorstudie ist strikt getrennt von der bestehenden 8-Asset-Arena-Diagnose und der historischen Abdeckung von 448/955 Schlüssen. Keine Werte oder Fehler werden zwischen den Datensätzen übertragen.');
  addText(document,candidate,'p','Quelle: M11-Arbeitsauftrag B12 · Kosten und Zeitfenster sind Annahmen, keine Marktevidenz.');
  const research = catalog.researchEvidence;
  addText(document,candidate,'p',`Dokumentierter Belegstand: ${research.asOf || 'unbekannt'} · statische Momentaufnahme, kein Live-Status. Belege werden hier angezeigt, nicht erneut verifiziert.`);
  const stages = document.createElement('dl');
  stages.className = 'strategy-summary';
  for (const [key, label] of [['source','Quellcode-Review'], ['d1','D1-Datenprüfung'],
    ['execution','Historische Strategieausführung'], ['paper','Paper-Betrieb'], ['live','Live-Betrieb']]) {
    addField(document,stages,label,research[key].label);
  }
  candidate.append(stages);
  const evidenceDetails = document.createElement('details');
  evidenceDetails.className = 'arena-evidence-details';
  addText(document,evidenceDetails,'summary','Prüfbelege und Abnahme');
  for (const provenance of [research.source.provenance, research.d1.provenance]) {
    const receipt = addText(document,evidenceDetails,'p',provenance);
    receipt.setAttribute('style','overflow-wrap:anywhere');
  }
  addText(document,evidenceDetails,'p','Keine Renditen, Eignungsbewertung oder Aktivierung werden aus diesen technischen Belegen abgeleitet.');
  candidate.append(evidenceDetails);
  root.append(candidate);

  const scanner = document.createElement('section');
  scanner.className = 'card card-muted';
  scanner.id = 'strategy-scanner';
  addText(document,scanner,'span','IN VORBEREITUNG','limited');
  addText(document,scanner,'h2','Scanner · geplanter Unterbereich');
  addText(document,scanner,'p','Noch keine Scanner-Ausgaben oder freigegebenen Signale. Die Hauptnavigation bleibt bei fünf M11-Tabs.');
  root.append(scanner);
  return catalog;
}
