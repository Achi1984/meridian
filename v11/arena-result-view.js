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

/**
 * Stable IDs and explicit disclosure state let the owning view preserve focus and
 * open panels when it updates the DOM. No DOM reads, listeners or timers here.
 * Pass a unique, stable idPrefix when more than one view is rendered.
 */
export function renderArenaResultView({projection=null, busy=false,
  expandedSections=[], idPrefix='arena-producer'}={}) {
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
  const assessment = `<section aria-label="Unabhängige Belegdimensionen"><h4>Getrennte Belegdimensionen · Producerangaben</h4><dl>${row('Technische Vollständigkeit',`${text(result?.status)} · abgeschlossen ${text(result?.completedPaths)} / geplant ${text(result?.plannedPaths)}`)}${row('Evidenzqualität',`${text(evidence?.sourceAuthenticity)} · ${text(evidence?.historyLabel)} · Holdout ${text(evidence?.holdoutClaim)}`)}${row('Autorisierung',`Execution ${text(job.executionAuthorized)} · Promotion ${text(job.promotionAuthorized)} · Profitabilität ${text(job.profitabilityInferred)}`)}</dl><p>Diese Dimensionen werden unabhängig angezeigt. Producer- oder Caller-Assertions erteilen keine Autorität.</p></section>`;
  const technicalBody = `<dl>${row('owner',job.owner)}${row('Grund',job.reason)}${row('Zeitstempel · createdAt',job.timestamps?.createdAt)}${row('Zeitstempel · startedAt',job.timestamps?.startedAt)}${row('Zeitstempel · finishedAt',job.timestamps?.finishedAt)}${row('executionAuthorized · Caller-Assertion',job.executionAuthorized)}${row('promotionAuthorized · Caller-Assertion',job.promotionAuthorized)}${row('profitabilityInferred · Caller-Assertion',job.profitabilityInferred)}${row('Result authority · Caller-Assertion',result?.authority===null||result?.authority===undefined?null:JSON.stringify(result.authority))}${row('Historische Einordnung',evidence?.historyLabel)}${row('Holdout-Claim',evidence?.holdoutClaim)}${row('Kostenmodell',evidence?.costModel)}${row('Ausführungsevidenz',evidence?.executionEvidence)}</dl>${[
    ['Deskriptorreihenfolge · pathIds',job.pathIds],
    ['Berechnungsreihenfolge · computationPathIds',job.computationPathIds],
    ['Fortschritt · paths',job.paths],['Control-Bindungen',job.controlBindings]
  ].map(([label,data])=>`<h5>${escape(label)}</h5><pre style="${RAW}">${json(data)}</pre>`).join('')}<h5>Controls · unveränderter Producertext</h5><pre style="${RAW}">${value(job.controls)}</pre><h5>Ergebnis · unveränderter Producertext</h5><pre style="${RAW}">${value(job.result)}</pre><p>Anzeige übernommener Identitäten; kein zusätzlicher Hash- oder Herkunftsnachweis.</p>`;
  return shell(`${summary}${identity}${missingNext}${provenanceText}${assessment}${result?`${primary}${details('controls','Control-Definitionen',controlsBody)}${details('paths','Baseline-, Control-, Cash-, Nachbar- und Stressvergleich',pathsBody)}${details('screen','Screen-Prüfwerte und Grenzen',screenBody)}`:''}${details('technical','Technische Belege · Identitäten und Rohdaten',technicalBody)}`,job.unresolved?'unresolved':'present');
}

export const ARENA_RESULT_DISCLOSURE_KEYS = DETAILS;
