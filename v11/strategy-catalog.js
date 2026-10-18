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
  blocker:'Unabhängige Prüfung, Marktbelege und jede weitere Freigabe fehlen.',
  source:'M11-Arbeitsauftrag B12 · kein Arena-Ergebnis'
});

export function buildStrategyCatalog(campaign) {
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
      evidenceIdentity:modelIds.length
        ? 'research/results/strategy-arena-20261016/manifest.json · historische Diagnose, nicht unabhängig'
        : CAMPAIGN_SOURCE,
      sourceIdentity:CAMPAIGN_SOURCE,
      blockers,
      sourceEntry:typeof source.entrySketch === 'string' ? source.entrySketch : 'Unbekannt',
      sourceExit:typeof source.exitSketch === 'string' ? source.exitSketch : 'Unbekannt',
      sourcePrerequisites:Array.isArray(source.prerequisites) ? source.prerequisites.filter(x=>typeof x==='string') : [],
      lineage:typeof source.lineage === 'string' ? source.lineage : 'Unbekannt',
      historicalStage:modelIds.length ? 'HISTORISCHE DIAGNOSE' : 'NICHT BELEGT',
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
    sharedBlocker:allPrerequisite,
    knownEvidence:Array.isArray(campaign.knownEvidence) ? campaign.knownEvidence : []
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

export function renderStrategyCatalog(root, campaign, document=root?.ownerDocument || globalThis.document) {
  if (!root || !document) return unknownCatalog('Ansicht nicht verfügbar.');
  const catalog = buildStrategyCatalog(campaign);
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
  for (const family of catalog.families) root.append(renderFamily(document,family));

  const candidate = document.createElement('article');
  candidate.className = 'card strategy-candidate';
  candidate.dataset.strategyId = catalog.candidate.id;
  addText(document,candidate,'span','IN ENTWICKLUNG','limited');
  addText(document,candidate,'h2','B1-7 · separater Research-Kandidat');
  addText(document,candidate,'p','7 Assets · 44 geplante Pfade. R3-Annahmen: 15 bp Basis, 30 bp Stress, +1 Tag. Es gibt keine Ergebnisse.');
  addText(document,candidate,'p','Diese 7-Asset-Vorstudie ist strikt getrennt von der bestehenden 8-Asset-Arena-Diagnose und der historischen Abdeckung von 448/955 Schlüssen. Keine Werte oder Fehler werden zwischen den Datensätzen übertragen.');
  addText(document,candidate,'p','Quelle: M11-Arbeitsauftrag B12 · Kosten und Zeitfenster sind Annahmen, keine Marktevidenz.');
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
