// Presentation only. The caller owns validation, import state and DOM lifecycle.
// This module never authenticates evidence or grants execution authority.
const escape = value => String(value).replace(/[&<>"']/g, character => ({
  '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
}[character]));
const value = item => item === null || item === undefined ? 'Nicht verfügbar' : escape(item);
const text = item => item === null || item === undefined ? 'Nicht verfügbar' : String(item);
const json = item => item === null || item === undefined ? 'Nicht verfügbar' : escape(JSON.stringify(item));
const row = (label, item) => `<div><dt>${escape(label)}</dt><dd>${value(item)}</dd></div>`;
const STATES = Object.freeze({
  queued:'Wartend', claimed:'Übernommen', running:'Laufend', completed:'Abgeschlossen',
  failed:'Fehlgeschlagen', rejected:'Abgelehnt', timed_out:'Zeitlimit erreicht'
});
const DETAILS = Object.freeze(['provenance','controls','paths','screen','technical']);
const WRAP = 'min-width:0;overflow-wrap:anywhere';
const RAW = 'max-height:320px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere';
const CHECKS = Object.freeze([
  ['Primärer Diagnose-Nettoertrag positiv','primaryDiagnosticNetPositive'],
  ['Primärer Diagnose-Drawdown höchstens 25 %','primaryDiagnosticDrawdownAtMost25Percent'],
  ['Primärer Ertrag mindestens beide eingefrorenen Controls','primaryReturnAtLeastBothFrozenControls'],
  ['Primärer Drawdown höchstens beide eingefrorenen Controls','primaryDrawdownAtMostBothFrozenControls'],
  ['Relativer Drawdown-Rückgang mindestens 20 %','relativeDrawdownReductionAtLeast20Percent'],
  ['Primär bei 30 bp positiv','primaryNetPositiveAt30bpNonDelayed'],
  ['Primär bei 30 bp plus Verzögerung positiv','primaryNetPositiveAt30bpPlusDelay'],
  ['Mindestens 3/4 Nachbarn positiv bei 15 bp','atLeastThreeOfFourNeighboursPositiveAt15bp'],
  ['Mindestens 3/4 Nachbarn positiv bei 30 bp','atLeastThreeOfFourNeighboursPositiveAt30bpNonDelayed']
]);

function pathValue(result, variantId, scenarioId) {
  return result?.paths?.find(path => path.variantId === variantId &&
    path.scenarioId === scenarioId && path.segmentId === 'diagnostic') ?? null;
}

function pathRow(label, path) {
  return `<li><strong>${escape(label)}</strong><dl>${row('Status',path?.status)}${row('Nettoertrag',path?.netReturn)}${row('Maximaler Drawdown',path?.sampledDrawdown)}</dl></li>`;
}

function comparisonRow(label, path) {
  return `<tr><th scope="row">${escape(label)}</th><td>${value(path?.status)}</td><td>${value(path?.netReturn)}</td><td>${value(path?.sampledDrawdown)}</td></tr>`;
}

const FILTERS = Object.freeze([
  ['segmentId','Segment'],['variantId','Variante'],['scenarioId','Szenario'],['status','Status']
]);
const PATH_FIELDS = Object.freeze([
  ['pathId','pathId'],['Art','kind'],['Variante','variantId'],['Segment','segmentId'],
  ['Szenario','scenarioId'],['Status','status'],['Berechnet','computed'],['Versuche','attempts'],
  ['Nettoertrag','netReturn'],['Maximaler Drawdown','sampledDrawdown'],['Kosten','totalCosts'],
  ['Umsatznotional','turnoverNotional'],['Mittlere realisierte Exposition','meanRealizedExposure'],
  ['Maximale Drawdown-Dauer','maxDrawdownDuration']
]);
const TABLE = 'width:100%;table-layout:fixed;border-collapse:collapse';
const TARGET = 'min-height:44px;max-width:100%;white-space:normal;overflow-wrap:anywhere';

export function filterArenaResultPaths(paths, filters={}) {
  return paths.filter(path=>FILTERS.every(([key])=>!filters[key] || path[key]===filters[key]));
}

function quarterlyView(path, idPrefix) {
  const quarters = path.quarterlyReturns;
  if (!Array.isArray(quarters) || !quarters.length) return '<p>Quartalsrenditen: Nicht verfügbar</p>';
  const numeric = quarters.filter(item=>typeof item.netReturn==='number' && Number.isFinite(item.netReturn));
  const scale = Math.max(...numeric.map(item=>Math.abs(item.netReturn)),0) || 1;
  const height = Math.max(80,quarters.length*28);
  const chart = `<svg role="img" aria-labelledby="${idPrefix}-chart-title" viewBox="0 0 600 ${height}" style="display:block;width:100%;max-height:360px"><title id="${idPrefix}-chart-title">Gelieferte Quartals-Nettoerträge · Null in der Mitte; exakte Werte in der Tabelle</title><line x1="300" x2="300" y1="0" y2="${height}" stroke="currentColor"/>${quarters.map((item,index)=>{
    if (typeof item.netReturn!=='number' || !Number.isFinite(item.netReturn)) return '';
    const x = 300 + item.netReturn/scale*280;
    const y = index*28+14;
    return `<g><title>${value(item.quarter)}: ${value(item.netReturn)}</title><line x1="300" x2="${x}" y1="${y}" y2="${y}" stroke="currentColor" stroke-width="6"/><circle cx="${x}" cy="${y}" r="4" fill="currentColor"/></g>`;
  }).join('')}</svg>`;
  return `<figure style="margin:0;${WRAP}"><figcaption>Quartals-Nettoerträge · gelieferte Werte, keine rekonstruierte Equitykurve</figcaption>${chart}<table style="${TABLE}"><caption>Identische Producerwerte zur Grafik · keine Prozentumrechnung</caption><thead><tr><th scope="col">Quartal</th><th scope="col">netReturn</th></tr></thead><tbody>${quarters.map(item=>`<tr><th scope="row">${value(item.quarter)}</th><td>${value(item.netReturn)}</td></tr>`).join('')}</tbody></table></figure>`;
}

function explorerView(result, job, explorer, idPrefix) {
  const paths = Array.isArray(result.paths) ? result.paths : [];
  const filters = explorer.filters ?? {};
  const selected = paths.filter(path=>(explorer.selectedPathIds ?? []).includes(path.pathId)).slice(0,2);
  const matching = filterArenaResultPaths(paths,filters);
  const fields = path=>`<dl>${PATH_FIELDS.map(([label,key])=>row(label,path[key])).join('')}</dl>`;
  const filterControls = FILTERS.map(([key,label])=>{
    const options = [...new Set(paths.map(path=>path[key]).filter(item=>typeof item==='string'))];
    return `<label for="${idPrefix}-filter-${key}" style="${WRAP}">${label}<select id="${idPrefix}-filter-${key}" data-arena-path-filter="${key}" style="display:block;width:100%;${TARGET}"><option value="">Alle</option>${options.map(item=>`<option value="${escape(item)}"${filters[key]===item?' selected':''}>${escape(item)}</option>`).join('')}</select></label>`;
  }).join('');
  const rows = matching.map(path=>{
    const index = paths.indexOf(path);
    const checked = selected.includes(path);
    return `<tr data-arena-path-row="${escape(path.pathId)}"><th scope="row">${value(path.pathId)}<br>${value(path.variantId)}<br><button id="${idPrefix}-detail-${index}" type="button" data-arena-path-detail="${escape(path.pathId)}" aria-controls="${idPrefix}-path-detail" style="${TARGET}">Details</button><label style="display:flex;align-items:center;min-height:44px;${WRAP}"><input id="${idPrefix}-select-${index}" type="checkbox" data-arena-path-select="${escape(path.pathId)}" aria-label="Pfad ${escape(path.pathId)} vergleichen" style="flex-shrink:0;min-height:44px"${checked?' checked':''}${!checked&&selected.length===2?' disabled':''}>Vergleichen</label></th><td>${value(path.segmentId)}</td><td>${value(path.scenarioId)}</td><td>${value(path.status)}</td><td>${value(path.netReturn)}</td><td>${value(path.sampledDrawdown)}</td><td>${value(path.totalCosts)}</td></tr>`;
  }).join('');
  const different = selected.length===2
    ? `<p>Segmente: ${selected[0].segmentId===selected[1].segmentId?'gleich':'unterschiedlich'} · Szenarien: ${selected[0].scenarioId===selected[1].scenarioId?'gleich':'unterschiedlich'}. Keine Aussage zur Vergleichbarkeit, kein Leistungsdelta, keine Gewinnerwahl.</p>` : '';
  const comparison = `<section aria-labelledby="${idPrefix}-comparison-heading"><h5 id="${idPrefix}-comparison-heading">Zwei Pfade · Originalwerte</h5><p role="status">${selected.length} von 2 Pfaden ausgewählt · Auswahl bleibt beim Filtern erhalten.</p><button id="${idPrefix}-selection-reset" type="button" data-arena-path-selection-reset style="${TARGET}">Vergleich zurücksetzen</button>${different}<div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px">${selected.map(path=>`<article style="${WRAP}" aria-label="Vergleichspfad ${escape(path.pathId)}">${fields(path)}</article>`).join('')}</div></section>`;
  const detail = typeof explorer.detailPathId==='string'
    ? paths.find(path=>path.pathId===explorer.detailPathId) : null;
  const detailBody = detail ? `${fields(detail)}<h6>Gelieferte Ausführungsmetadaten</h6><pre style="${RAW}">${json(job.paths?.find(path=>path.pathId===detail.pathId))}</pre><dl>${row('Fehler · Producerangabe',detail.failure===undefined?null:JSON.stringify(detail.failure))}</dl>${quarterlyView(detail,`${idPrefix}-quarterly`)}` : '<p>Über „Details“ einen Pfad auswählen.</p>';
  const listing = matching.length
    ? `<p>Pfadtabelle bei Bedarf horizontal scrollen.</p><div id="${idPrefix}-path-table" role="region" aria-label="Gefilterte Producerpfade · horizontal scrollbar" tabindex="0" style="max-width:100%;overflow-x:auto"><table style="${TABLE};min-width:840px"><caption>Gelieferte Pfadwerte · nicht ausgeführte Werte bleiben nicht verfügbar</caption><thead><tr>${['Pfad / Variante / Auswahl','Segment','Szenario','Status','Nettoertrag','Drawdown','Kosten'].map((label,index)=>`<th scope="col"${index===0?' style="width:200px"':''}>${label}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>`
    : '<p>Keine Pfade entsprechen den Filtern.</p>';
  return `<section data-arena-path-explorer aria-labelledby="${idPrefix}-explorer-heading" style="${WRAP}"><h4 id="${idPrefix}-explorer-heading">Alle 44 Pfade</h4><p>Producer-Deskriptorreihenfolge · keine Rangfolge. UNVERIFIED · Herkunft nicht bestätigt.</p><div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px">${filterControls}</div><button id="${idPrefix}-filter-reset" type="button" data-arena-path-filter-reset style="${TARGET}">Filter zurücksetzen</button><p role="status" data-arena-path-count>${matching.length} von ${paths.length} Pfaden angezeigt.</p>${listing}${comparison}<section id="${idPrefix}-path-detail" aria-labelledby="${idPrefix}-detail-heading" style="${WRAP}"><h5 id="${idPrefix}-detail-heading"${detail?' tabindex="-1"':''}>Pfaddetail · Originalwerte</h5>${detailBody}</section></section>`;
}

/**
 * Stable IDs and explicit disclosure state let the owning view preserve focus and
 * open panels when it updates the DOM. No DOM reads, listeners or timers here.
 * Pass a unique, stable idPrefix when more than one view is rendered.
 */
export function renderArenaResultView({projection=null, busy=false,
  expandedSections=[], idPrefix='arena-producer', explorer={}}={}) {
  if (typeof idPrefix !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(idPrefix)) {
    throw new TypeError('Ungültige Arena-Ansichtskennung.');
  }
  const expanded = new Set(Array.isArray(expandedSections) ? expandedSections : []);
  const headingId = `${idPrefix}-heading`;
  const details = (key, label, content) => `<details id="${idPrefix}-${key}" data-arena-result-section="${key}" style="${WRAP}"${expanded.has(key)?' open':''}><summary id="${idPrefix}-${key}-summary" style="min-height:44px;display:list-item;align-content:center">${escape(label)}</summary>${content}</details>`;
  const shell = (content, status) => `<section class="arena-result-workspace" data-arena-result-state="${status}" aria-labelledby="${headingId}" aria-busy="${busy?'true':'false'}" style="${WRAP}"><h3 id="${headingId}">B1-Ergebnis · Producer-Export</h3>${content}<p>Nur Anzeige · keine Neuberechnung, Rangfolge, Wiederherstellung oder Ausführungsfreigabe. Paper und Live bleiben getrennt.</p></section>`;
  // Loading/invalid/absent replace the entire result. Never retain old metrics.
  if (busy) return shell('<p role="status">Producer-Export wird geprüft …</p>','loading');
  if (projection?.status === 'INVALID') return shell('<p role="alert">Export konnte nicht angenommen werden. Kein Ergebnis wird angezeigt.</p><p>Nächster Schritt: Format und Export prüfen und erneut importieren.</p>','invalid');
  if (projection?.status !== 'PRESENT_UNVERIFIED' || !projection.job) {
    return shell('<p role="status">Kein Producer-Ergebnis importiert.</p><p>Nächster Schritt: Einen unterstützten Producer-Export über den getrennten Dateiimport auswählen.</p>','absent');
  }
  const {job, result, provenance} = projection;
  const screen = result?.screen;
  const controls = result?.controlDefinitions;
  const evidence = result?.evidence;
  const identity = `<section aria-label="Experiment identity"><h4>Experiment · Produceridentität</h4><dl>${[
    ['Trial ID',job.trialId],['Trial key',job.trialKey],['Profil',job.profile],
    ['Protokoll SHA-256 · Job',job.protocolSha256],['Protokoll SHA-256 · Ergebnis',result?.protocolSha256],
    ['Quelle SHA-256',job.sourceSha256],
    ['Input SHA-256 · Job',job.dataSha256],['Input SHA-256 · Ergebnis',result?.identity?.inputSha256],
    ['Manifest SHA-256',job.manifestSha256],['Result SHA-256',job.resultSha256],
    ['Summary SHA-256',job.summarySha256],['Versuch',job.attempts]
  ].map(([label,item])=>row(label,item)).join('')}${row('Quelle · Provenienz',provenance?.source)}</dl></section>`;
  const stateLabel = job.unresolved ? 'Ungeklärt' : STATES[job.state] ?? 'Unbekannt';
  const missing = [
    ['Trial ID',job.trialId],['Profil',job.profile],['Protokoll SHA-256',job.protocolSha256],
    ['Quelle SHA-256',job.sourceSha256],['Input SHA-256',job.dataSha256],
    ['Manifest SHA-256',job.manifestSha256],['Ergebnis SHA-256',job.resultSha256],
    ['Zusammenfassung SHA-256',job.summarySha256],
    ...['createdAt','startedAt','finishedAt'].map(key=>[`Zeitstempel ${key}`,job.timestamps?.[key]])
  ].filter(([,item])=>item===null||item===undefined).map(([label])=>label);
  const next = job.unresolved
    ? 'Ungeklärten Lauf ausdrücklich abstimmen. Diese Ansicht startet keine Wiederherstellung.'
    : result ? 'Status und Belegdetails prüfen. Das Ergebnis gewährt keine weitere Freigabe.'
      : 'Es liegt kein Ergebnis vor. Nur einen separat bereitgestellten neueren Export importieren; kein Lauf wird gestartet.';
  const missingNext = missing.length
    ? `<p>Nächster Schritt für fehlende Angaben: ${escape(missing.join(', '))} im bereitgestellten Producer-Beleg prüfen; keine Werte ergänzen oder aus anderen Feldern ableiten.</p>`
    : '';
  const provenanceText = `<p class="arena-result-provenance">${provenance?.syntheticFixture === true?'SYNTHETIC_ONLY · ':''}UNVERIFIED · Herkunft nicht bestätigt.</p>${details('provenance','Herkunft und Aussagegrenzen',`<dl>${row('Quelle',provenance?.source)}${row('Authentizität',provenance?.sourceAuthenticity)}${row('Synthetische Fixture',provenance?.syntheticFixture)}</dl><p>Schema und Prüfsummen bestätigen keine Echtheit, Zulassung oder Berechtigung.</p>` )}`;
  const summary = `<p role="status">${escape(stateLabel)} · Lifecycle ${value(job.state)}</p><dl>${row('Engine-Ergebnis',result?.status)}${row('Screen',screen?.status)}${row('Screen-Interpretation',screen?.interpretation)}${row('Versuch',job.attempts)}${row('Fence',job.fence)}${row('Unresolved',job.unresolved)}${row('Ergebnisse abgeschlossen',result?.completedPaths)}${row('Pfade geplant',result?.plannedPaths)}</dl><p>Abgeschlossene Pfade sind kein Nachweis ausreichender Evidenz.</p><p>Nächster Schritt: ${escape(next)}</p>`;
  const primary = `<h4>Primärpfad · Diagnose</h4><ul>${pathRow('Basis 15 bp',pathValue(result,'primary-n30-f25','base-15bp'))}</ul>`;
  const controlsBody = `<dl>${row('Status',controls?.status)}${row('Mittlere Exposition',controls?.meanExposure)}${row('Risikobasierte Exposition',controls?.riskExposure)}${row('Primäre Entwicklungs-SD',controls?.primaryDevelopmentSd ?? controls?.primarySd)}${row('Vollkorb-Entwicklungs-SD',controls?.fullBasketDevelopmentSd ?? controls?.benchmarkSd)}${row('Kalibrierung',controls?.calibration)}</dl>`;
  const neighbours = [
    ['Fenster 20 · Floor 0,25','neighbour-n20-f25'],
    ['Fenster 45 · Floor 0,25','neighbour-n45-f25'],
    ['Fenster 30 · Floor 0,20','neighbour-n30-f20'],
    ['Fenster 30 · Floor 0,35','neighbour-n30-f35']
  ];
  const pathsBody = `<div style="max-width:100%;overflow-x:auto"><table style="width:100%;table-layout:fixed;border-collapse:collapse"><caption>Producerwerte · feste fachliche Reihenfolge, ohne Berechnung oder Sortierung</caption><thead><tr><th scope="col">Vergleich</th><th scope="col">Status</th><th scope="col">Nettoertrag</th><th scope="col">Maximaler Drawdown</th></tr></thead><tbody>${comparisonRow('Baseline · Primär · Basis 15 bp',pathValue(result,'primary-n30-f25','base-15bp'))}${comparisonRow('Control · Vollkorb',pathValue(result,'full-basket-weekly','base-15bp'))}${comparisonRow('Control · mittlere Exposition',pathValue(result,'frozen-mean-exposure','base-15bp'))}${comparisonRow('Control · risikobasierte Exposition',pathValue(result,'frozen-risk-exposure','base-15bp'))}${comparisonRow('Cash',pathValue(result,'cash-zero','scenario-independent'))}${neighbours.flatMap(([label,variant])=>['base-15bp','stress-30bp'].map(scenario=>comparisonRow(`Nachbar · ${label} · ${scenario}`,pathValue(result,variant,scenario)))).join('')}${comparisonRow('Stress · Primär · 30 bp',pathValue(result,'primary-n30-f25','stress-30bp'))}${comparisonRow('Stress · Primär · 30 bp plus Verzögerung',pathValue(result,'primary-n30-f25','stress-30bp-delay-1d'))}</tbody></table></div>`;
  const screenBody = `<dl>${row('Vergleichssegment',screen?.comparisonSegment)}${row('Relativer Drawdown-Rückgang (Producerwert)',screen?.relativeDrawdownReduction)}${row('Nachbarn positiv · 15 bp',screen?.neighbourPositiveCounts?.base15bp)}${row('Nachbarn positiv · 30 bp',screen?.neighbourPositiveCounts?.stress30bp)}${row('Neighbor-Stress',screen?.neighbourStressScenario)}${row('Stoppregel',screen?.stopPolicy ?? evidence?.stoppedPolicy)}${row('Trade-CRV',screen?.tradeCRV?.status)}${row('Trade-CRV-Wert',screen?.tradeCRV?.value)}</dl><dl>${CHECKS.map(([label,key])=>row(label,screen?.checks?.[key])).join('')}</dl>`;
  const assessment = `<section aria-label="Unabhängige Belegdimensionen"><h4>Getrennte Belegdimensionen · Producerangaben</h4><dl>${row('Technische Vollständigkeit',`${text(result?.status)} · abgeschlossen ${text(result?.completedPaths)} / geplant ${text(result?.plannedPaths)}`)}${row('Evidenzqualität',`Provenienz ${text(provenance?.sourceAuthenticity)} · Ergebnis ${text(evidence?.sourceAuthenticity)} · ${text(evidence?.historyLabel)} · Holdout ${text(evidence?.holdoutClaim)}`)}${row('Autorisierung · Caller-Assertions',`Execution ${text(job.executionAuthorized)} · Promotion ${text(job.promotionAuthorized)} · Profitabilität ${text(job.profitabilityInferred)}`)}</dl><p>Diese Dimensionen werden unabhängig angezeigt. Producer- oder Caller-Assertions erteilen keine Autorität.</p></section>`;
  const technicalBody = `<dl>${row('owner',job.owner)}${row('Grund',job.reason)}${row('Zeitstempel · createdAt',job.timestamps?.createdAt)}${row('Zeitstempel · startedAt',job.timestamps?.startedAt)}${row('Zeitstempel · finishedAt',job.timestamps?.finishedAt)}${row('executionAuthorized · Caller-Assertion',job.executionAuthorized)}${row('promotionAuthorized · Caller-Assertion',job.promotionAuthorized)}${row('profitabilityInferred · Caller-Assertion',job.profitabilityInferred)}${row('Result authority · Caller-Assertion',result?.authority===null||result?.authority===undefined?null:JSON.stringify(result.authority))}${row('Historische Einordnung',evidence?.historyLabel)}${row('Holdout-Claim',evidence?.holdoutClaim)}${row('Kostenmodell',evidence?.costModel)}${row('Ausführungsevidenz',evidence?.executionEvidence)}</dl>${[
    ['Deskriptorreihenfolge · pathIds',job.pathIds],
    ['Berechnungsreihenfolge · computationPathIds',job.computationPathIds],
    ['Fortschritt · paths',job.paths],['Control-Bindungen',job.controlBindings]
  ].map(([label,data])=>`<h5>${escape(label)}</h5><pre style="${RAW}">${json(data)}</pre>`).join('')}<h5>Controls · unveränderter Producertext</h5><pre style="${RAW}">${value(job.controls)}</pre><h5>Ergebnis · unveränderter Producertext</h5><pre style="${RAW}">${value(job.result)}</pre><p>Anzeige übernommener Identitäten; kein zusätzlicher Hash- oder Herkunftsnachweis.</p>`;
  return shell(`${summary}${identity}${missingNext}${provenanceText}${assessment}${result?`${primary}${explorerView(result,job,explorer,idPrefix)}${details('controls','Control-Definitionen',controlsBody)}${details('paths','Baseline-, Control-, Cash-, Nachbar- und Stressvergleich',pathsBody)}${details('screen','Screen-Prüfwerte und Grenzen',screenBody)}`:''}${details('technical','Technische Belege · Identitäten und Rohdaten',technicalBody)}`,job.unresolved?'unresolved':'present');
}

export const ARENA_RESULT_DISCLOSURE_KEYS = DETAILS;
