import {MAX_INSPECTION_REPORT_BYTES, parseArenaInspectionReport} from './arena-inspection-report.js?v=B16-M11-RELEASE1';
import {MAX_HISTORICAL_FIXTURE_BYTES, parseArenaHistoricalResultFixture} from './arena-historical-result.js?v=B16-M11-RELEASE1';
import {MAX_HISTORICAL_EXPORT_BYTES, parseArenaHistoricalExport} from './arena-historical-export.js?v=B16-M11-RELEASE1';
import {renderArenaResultView} from './arena-result-view.js?v=B16-M11-RELEASE1';
import {ARENA_CANDIDATES, ARENA_RULESET, ARENA_SYMBOLS, replayStrategyPaperArena} from '../research/strategy-paper-arena.js';

const DIAGNOSTIC_PATH = 'research/results/strategy-arena-20261016/';
const PROVENANCE_PATH = `${DIAGNOSTIC_PATH}manifest.json`;
const PROVENANCE_BLOB = 'f06444cb129d39aa60c7ea3c44c8179c163a2270';
const names = {'H1-B':'Trend + Cash','H1-E':'Trend mit Kostenpuffer','H7-B':'Defensive Spot-Auswahl','H7-R':'Defensive Auswahl mit Rangpuffer',H9:'Basis datierter Futures'};
let resultViewInstanceCount = 0;
const FOCUS_CONTROLS = Object.freeze([
  ['[data-arena-provenance]','provenance-button'],
  ['[data-arena-stored]','stored-button'],
  ['[data-arena-export]','export-button'],
  ['[data-arena-input]','snapshot-input'],
  ['[data-arena-inspection]','inspection-input'],
  ['[data-arena-historical-fixture]','fixture-input'],
  ['[data-arena-historical-export]','producer-input']
]);
const escapeHtml = value => String(value ?? 'Unbekannt').replace(/[&<>"']/g, character => ({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
}[character]));
const formatNumber = value => Number.isFinite(value)
  ? new Intl.NumberFormat('de-DE',{maximumFractionDigits:2}).format(value) : 'Unbekannt';
const tone = value => !Number.isFinite(value) || value === 0 ? 'muted' : value < 0 ? 'danger' : 'safe';
const validHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);

export function canonicalArenaInput(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalArenaInput).join(',')}]`;
  return `{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${canonicalArenaInput(value[key])}`).join(',')}}`;
}

async function digestText(text, subtle=globalThis.crypto?.subtle) {
  if (!subtle) throw Error('SHA-256 ist in diesem Browser nicht verfügbar.');
  return [...new Uint8Array(await subtle.digest('SHA-256',new TextEncoder().encode(text)))]
    .map(value=>value.toString(16).padStart(2,'0')).join('');
}

export async function evaluateArenaImport(text, subtle=globalThis.crypto?.subtle) {
  if (typeof text !== 'string' || text.length > 4_000_000) throw Error('Snapshot zu groß oder ungültig (max. 4 MB).');
  const parsed = JSON.parse(text);
  const input = parsed && typeof parsed === 'object' && parsed.input ? parsed.input : parsed;
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('Snapshot-Eingabe ungültig.');
  if ((parsed.ruleset && parsed.ruleset !== ARENA_RULESET) ||
      (parsed.result?.ruleset && parsed.result.ruleset !== ARENA_RULESET)) {
    throw Error('Abweichende Regelversion. Ergebnisse nicht übernommen.');
  }
  const digest = await digestText(`${canonicalArenaInput(input)}\n`,subtle);
  if (parsed.inputSha256 && parsed.inputSha256 !== digest) throw Error('Snapshot-Hash stimmt nicht.');
  if (parsed.receipt?.inputSha256 && parsed.receipt.inputSha256 !== digest) {
    throw Error('Quellbeleg und Snapshot stimmen nicht überein.');
  }
  return {
    input,
    result:replayStrategyPaperArena(input),
    digest,
    sourceReceipt:parsed.receipt || null
  };
}

async function readBounded(fetchImpl,url) {
  const response = await fetchImpl(url,{cache:'no-store',signal:AbortSignal.timeout(12000)});
  if (!response.ok) throw Error('Gespeicherte Diagnose oder Belegdaten nicht verfügbar.');
  const text = await response.text();
  if (text.length > 262_144) throw Error('Diagnosedatei zu groß.');
  return text;
}

export async function loadStoredArena(fetchImpl=globalThis.fetch, subtle=globalThis.crypto?.subtle) {
  const base = new URL(`../${DIAGNOSTIC_PATH}`,import.meta.url);
  const manifest = JSON.parse(await readBounded(fetchImpl,new URL('manifest.json',base).href));
  if (manifest.schemaVersion !== 'MERIDIAN_ARENA_CHUNKED_INPUT_V1' ||
      manifest.ruleset !== ARENA_RULESET || !Array.isArray(manifest.chunks) ||
      manifest.chunks.length !== ARENA_SYMBOLS.length || !manifest.receipt?.inputSha256) {
    throw Error('Diagnose-Manifest ungültig.');
  }
  const input = structuredClone(manifest.inputTemplate);
  input.data = {};
  if (!input.collection) throw Error('Quellenbeleg fehlt.');
  input.collection.rawResponses = {};
  const seen = new Set();
  for (const entry of manifest.chunks) {
    if (!ARENA_SYMBOLS.includes(entry.symbol) || seen.has(entry.symbol) ||
        entry.path !== `${entry.symbol}.json` || !validHash(entry.sha256)) {
      throw Error('Diagnose-Dateiverweis ungültig.');
    }
    seen.add(entry.symbol);
    const text = await readBounded(fetchImpl,new URL(entry.path,base).href);
    if (await digestText(text,subtle) !== entry.sha256) throw Error('Diagnosedatei: Hash stimmt nicht.');
    const chunk = JSON.parse(text);
    if (chunk.symbol !== entry.symbol) throw Error('Diagnosesymbol stimmt nicht.');
    input.data[entry.symbol] = chunk.rows;
    input.collection.rawResponses[entry.symbol] = chunk.rawResponse;
  }
  if (seen.size !== ARENA_SYMBOLS.length) throw Error('Diagnose-Universum unvollständig.');
  return evaluateArenaImport(JSON.stringify({ruleset:manifest.ruleset,input,receipt:manifest.receipt}),subtle);
}

export function describeArenaProvenance(manifest) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return {status:'UNKNOWN',message:'Belegmetadaten unbekannt.'};
  }
  const candidates = manifest.summary?.candidates;
  const ids = Array.isArray(candidates) ? candidates.map(row=>row?.id) : [];
  if (!Array.isArray(candidates) || ids.length !== ARENA_CANDIDATES.length || new Set(ids).size !== ids.length ||
      ids.some(id=>!ARENA_CANDIDATES.includes(id))) {
    return {status:'INVALID',message:'Kandidatenzuordnung ungültig; kein Beleg wird zugeordnet.'};
  }
  const receipt = manifest.receipt && typeof manifest.receipt === 'object' ? manifest.receipt : {};
  const window = manifest.summary?.window || {};
  const chunks = Array.isArray(manifest.chunks) ? manifest.chunks : [];
  const hashes = ['inputSha256','rawInputSha256','engineSha256','protocolSha256','rulesSha256']
    .map(key=>({key,value:validHash(receipt[key]) ? receipt[key] : null}));
  return {
    status:manifest.schemaVersion === 'MERIDIAN_ARENA_CHUNKED_INPUT_V1' &&
      manifest.ruleset === ARENA_RULESET ? 'PRESENT_UNVERIFIED' : 'INVALID',
    message:'Metadaten der historischen Diagnose · vorhanden, nicht bestätigt.',
    market:typeof receipt.collectorProvider === 'string' ? `${receipt.collectorProvider} · ${receipt.quoteCurrency || 'Unbekannte Währung'}` : 'Unbekannt',
    universe:chunks.map(row=>row?.symbol).filter(value=>typeof value === 'string').join(', ') || 'Unbekannt',
    coverage:Number.isSafeInteger(window.warmupStart) && Number.isSafeInteger(window.end)
      ? `${new Date(window.warmupStart).toISOString().slice(0,10)} – ${new Date(window.end).toISOString().slice(0,10)} UTC`
      : 'Unbekannt',
    sealedAt:typeof receipt.sealedAt === 'string' ? receipt.sealedAt : 'Unbekannt',
    hashes,
    source:PROVENANCE_PATH
  };
}

export async function loadStoredArenaProvenance(fetchImpl=globalThis.fetch) {
  return describeArenaProvenance(JSON.parse(await readBounded(fetchImpl,new URL(`../${PROVENANCE_PATH}`,import.meta.url).href)));
}

function provenanceDetails(provenance) {
  if (!provenance) return '';
  const rows = provenance.hashes.map(({key,value})=>`<li>${escapeHtml(key)} · ${value ? escapeHtml(value) : 'Unbekannt'}</li>`).join('');
  return `<details class="arena-evidence-details"><summary>Technische Belegdetails · Prüfsummen</summary><p>${escapeHtml(provenance.source)}</p><p>Git-Blob · ${PROVENANCE_BLOB}</p><p>Versiegelung · ${escapeHtml(provenance.sealedAt)}</p><ul>${rows}</ul></details>`;
}

function historicalProvenanceSection(provenance) {
  if (!provenance) return '';
  const details = provenance.status === 'PRESENT_UNVERIFIED'
    ? `<p>Markt: ${escapeHtml(provenance.market)}</p><p>Universum: ${escapeHtml(provenance.universe)}</p><p>Abdeckung: ${escapeHtml(provenance.coverage)}</p>${provenanceDetails(provenance)}`
    : '';
  return `<section class="arena-historical-metadata" aria-label="Separate historische Belegmetadaten"><h3>Separate historische Belegmetadaten</h3><p>Archivquelle vom 16.10.2026 · nicht den importierten Ergebnissen zugeordnet. Keine bestätigte Herkunft oder unabhängige Prüfung des aktuellen Imports.</p><p>${escapeHtml(provenance.message)}</p>${details}</section>`;
}

function candidateCard(row) {
  const metrics = row.baseline;
  const stress = row.stress;
  const cells = metrics ? [
    ['Netto',`${formatNumber(metrics.netReturnPct)} %`],
    ['Max. Drawdown · Tagesschluss',`${formatNumber(metrics.maxDrawdownPct)} %`],
    ['Kostenannahme',`${formatNumber(metrics.costs)} ${metrics.currency}`],
    ['Verkaufsteile',formatNumber(metrics.closedTrades)],
    ['Gewinnfaktor',formatNumber(metrics.profitFactor)],
    ['Kostenstress · Netto',`${formatNumber(stress?.netReturnPct)} %`]
  ].map(([label,value])=>`<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join('') : '';
  return `<article class="arena-model-card"><header><div><strong>${escapeHtml(row.id)} · ${escapeHtml(names[row.id] || row.id)}</strong><span>${row.id === 'H9'?'DATEN FEHLEN':metrics?'MANUELLE DIAGNOSE':'NOCH NICHT AUSGEWERTET'}</span></div><b class="tone-${tone(metrics?.netPnl)}">${metrics ? `${formatNumber(metrics.netPnl)} ${escapeHtml(metrics.currency)}` : '—'}</b></header>${row.id === 'H9' ? '<p>Datiertes Kontrakt-, Zwei-Bein-, Finanzierungs- und Marginmodell fehlen. Keine simulierten Trades.</p>' : `<dl>${cells}</dl><p>${metrics ? '10.000 nominale Einheiten je getrenntem Modell · 1× Spot · keine EUR-Umrechnung.' : 'Keine Performance behauptet.'}</p>`}${row.id === 'H9' ? '<p class="arena-blocked">H9 · BLOCKED_DATA. Keine Trades.</p>' : ''}</article>`;
}

function metricSummary(result) {
  return JSON.parse(JSON.stringify(result,(key,value)=>
    ['positions','decisions','fills','trades','equityCurve'].includes(key) ? undefined : value));
}

function inspectionSection(inspection, busy) {
  const projected = inspection || parseArenaInspectionReport(null);
  const report = projected.report;
  const details = report ? `<p>SYNTHETIC_ONLY · Status: ${escapeHtml(report.state)} · Versuch ${report.attempts} · Fence ${report.fence}</p><p>Pfade begonnen: ${report.pathsStarted} / 44 · abgeschlossen: ${report.pathsCompleted} / 44</p><p>${report.requiresExplicitReconciliation ? 'Ungeklärter Lauf · ausdrückliche Abstimmung erforderlich. Kein Wiederanlauf ausgelöst.' : 'Kein ungeklärter Fence laut Beleg; keine Wiederanlauf-Freigabe.'}</p><details class="arena-evidence-details" style="overflow-wrap:anywhere"><summary>Versuch und Belegidentitäten</summary><p>Trial: ${escapeHtml(report.trialId)}</p>${Object.entries(report.identities).map(([key,value])=>`<p>${escapeHtml(key)}: ${escapeHtml(value ?? 'Nicht vorhanden')}</p>`).join('')}${Object.entries(report.timestamps).map(([key,value])=>`<p>${escapeHtml(key)}: ${escapeHtml(value ?? 'Nicht vorhanden')}</p>`).join('')}<p>Grund: ${escapeHtml(report.reasonCode ?? 'Nicht angegeben')}</p></details>` : '';
  return `<section class="arena-historical-metadata" aria-label="Separater synthetischer Prüfbericht"><h3>Research-Prüfbericht · separat</h3><label class="arena-import">Prüfbericht importieren (max. 16 KiB)<input data-arena-inspection type="file" accept="application/json,.json"></label><p role="${projected.status === 'INVALID' ? 'alert' : 'status'}">${busy ? 'Prüfbericht wird gelesen …' : escapeHtml(projected.message)}</p>${details}<p>Nur Metadaten; keine Neuberechnung, Renditen oder Zuordnung zu Arena-Ergebnissen. Historische Belege, D1, Paper und Live bleiben getrennt. Keine Ausführungs- oder Handelsfreigabe.</p></section>`;
}

const historicalValue = value => value === null || value === undefined
  ? 'Nicht verfügbar' : escapeHtml(value);

function historicalPath(result, variantId, scenarioId) {
  return result?.paths?.find(path => path.variantId === variantId &&
    path.scenarioId === scenarioId && path.segmentId === 'diagnostic') ?? null;
}

function historicalPathRow(label, result, variantId, scenarioId) {
  const path = historicalPath(result,variantId,scenarioId);
  return `<li><strong>${escapeHtml(label)}</strong> · ${scenarioId}: Status ${historicalValue(path?.status)} · Nettoertrag ${historicalValue(path?.netReturn)} · maximaler Drawdown ${historicalValue(path?.sampledDrawdown)}</li>`;
}

function historicalResultSection(projection, busy, producerExport=false) {
  const report = projection?.status === 'PRESENT_UNVERIFIED' ? projection : null;
  const job = report?.job;
  const result = report?.result;
  const evidence = result?.evidence || {};
  const screen = result?.screen || {};
  const stopPolicy = screen.stopPolicy ?? evidence.stoppedPolicy;
  const controls = result?.controlDefinitions;
  const controlFields = [
    ['Status',controls?.status],
    ['Mittlere Exposition',controls?.meanExposure],
    ['Risikobasierte Exposition',controls?.riskExposure],
    ['Primäre Entwicklungs-SD',controls?.primaryDevelopmentSd ?? controls?.primarySd],
    ['Vollkorb-Entwicklungs-SD',controls?.fullBasketDevelopmentSd ?? controls?.benchmarkSd],
    ['Kalibrierung',controls?.calibration]
  ].map(([label,value])=>`<dt>${label}</dt><dd>${historicalValue(value)}</dd>`).join('');
  const neighbours = [
    ['Nachbar · Fenster 20 · Floor 0,25','neighbour-n20-f25'],
    ['Nachbar · Fenster 45 · Floor 0,25','neighbour-n45-f25'],
    ['Nachbar · Fenster 30 · Floor 0,20','neighbour-n30-f20'],
    ['Nachbar · Fenster 30 · Floor 0,35','neighbour-n30-f35']
  ];
  const checks = [
    ['Primärer Diagnose-Nettoertrag positiv','primaryDiagnosticNetPositive'],
    ['Primärer Diagnose-Drawdown höchstens 25 %','primaryDiagnosticDrawdownAtMost25Percent'],
    ['Primärer Ertrag mindestens beide eingefrorenen Controls','primaryReturnAtLeastBothFrozenControls'],
    ['Primärer Drawdown höchstens beide eingefrorenen Controls','primaryDrawdownAtMostBothFrozenControls'],
    ['Relativer Drawdown-Rückgang mindestens 20 %','relativeDrawdownReductionAtLeast20Percent'],
    ['Primär bei 30 bp positiv','primaryNetPositiveAt30bpNonDelayed'],
    ['Primär bei 30 bp plus Verzögerung positiv','primaryNetPositiveAt30bpPlusDelay'],
    ['Mindestens 3/4 Nachbarn bei 15 bp positiv','atLeastThreeOfFourNeighboursPositiveAt15bp'],
    ['Mindestens 3/4 Nachbarn bei 30 bp positiv','atLeastThreeOfFourNeighboursPositiveAt30bpNonDelayed']
  ];
  const screenChecks = checks.map(([label,key])=>
    `<li>${escapeHtml(label)} · ${historicalValue(screen.checks?.[key])}</li>`).join('');
  const payload = job ? `<section aria-label="Lifecycle-Zusammenfassung"><h4>Lifecycle</h4><p>Lifecycle: ${historicalValue(job.state)} · Versuch ${job.attempts} · Fence ${job.fence}</p><p>${job.unresolved
    ? 'Ungeklärter Lauf · Fence bleibt erhalten; ausdrückliche Abstimmung erforderlich. Keine Wiederherstellung ausgelöst.'
    : `Kein ungeklärter Lauf laut ${producerExport?'Export':'Fixture'}; keine Wiederherstellung oder Freigabe.`}</p><p>Unresolved: ${historicalValue(job.unresolved)} · Grund: ${historicalValue(job.reason)}</p><p>Inventar: ${job.pathIds.length} geplante Pfaddeskriptoren; dies ist kein Nachweis abgeschlossener Ergebnisse.</p></section><section aria-label="Engine-Zusammenfassung"><h4>Engine-Ergebnis</h4><p>Engine-Ergebnisstatus: ${historicalValue(result?.status)} · Abgeschlossene Ergebnisse: ${historicalValue(result?.completedPaths)} von ${historicalValue(result?.plannedPaths)} geplanten Pfaden · berechnet: ${historicalValue(result?.computedPaths)}</p><p>Abgeschlossene Ergebnisse sind kein Nachweis ausreichender Screen-Evidenz.</p><h5>Primärpfad · Diagnose</h5><ul>${historicalPathRow('Primär · Basis 15 bp',result,'primary-n30-f25','base-15bp')}${historicalPathRow('Primär · Stress 30 bp',result,'primary-n30-f25','stress-30bp')}${historicalPathRow('Primär · Stress 30 bp plus Verzögerung',result,'primary-n30-f25','stress-30bp-delay-1d')}</ul><h5>Controls · producerseitige Entwicklungsdefinitionen und Diagnosepfade</h5><dl>${controlFields}</dl><ul>${historicalPathRow('Vollkorb-Control',result,'full-basket-weekly','base-15bp')}${historicalPathRow('Control · mittlere Exposition',result,'frozen-mean-exposure','base-15bp')}${historicalPathRow('Control · risikobasierte Exposition',result,'frozen-risk-exposure','base-15bp')}${historicalPathRow('Cash-Control · Diagnose',result,'cash-zero','scenario-independent')}</ul><h5>Nachbarpfade · Diagnose</h5><ul>${neighbours.map(([label,variantId])=>historicalPathRow(label,result,variantId,'base-15bp')).join('')}${neighbours.map(([label,variantId])=>historicalPathRow(label,result,variantId,'stress-30bp')).join('')}</ul><p>Historische Einordnung: ${historicalValue(evidence.historyLabel)} · Holdout-Claim: ${historicalValue(evidence.holdoutClaim)}</p><p>Quellenauthentizität: ${historicalValue(evidence.sourceAuthenticity)} · Stoppregel: ${historicalValue(stopPolicy)} · Kostenmodell: ${historicalValue(evidence.costModel)} · Ausführungsevidenz: ${historicalValue(evidence.executionEvidence)}</p></section><section aria-label="Screen-Zusammenfassung"><h4>Screen</h4><p>Screenstatus: ${historicalValue(screen.status)} · Interpretation: ${historicalValue(screen.interpretation)} · Vergleichssegment: ${historicalValue(screen.comparisonSegment)}</p><p>Relativer Drawdown-Rückgang (Producerwert): ${historicalValue(screen.relativeDrawdownReduction)} · Nachbarn positiv, Basis 15 bp: ${historicalValue(screen.neighbourPositiveCounts?.base15bp)} von 4 · Stress 30 bp: ${historicalValue(screen.neighbourPositiveCounts?.stress30bp)} von 4</p><ul>${screenChecks || '<li>Screen-Prüfwerte: Nicht verfügbar</li>'}</ul><p>Neighbor-Stress: ${historicalValue(screen.neighbourStressScenario)} · Stoppregel: ${historicalValue(screen.stopPolicy)} · Trade-CRV: ${historicalValue(screen.tradeCRV?.status)} · Wert: ${historicalValue(screen.tradeCRV?.value)}</p></section><details class="arena-evidence-details" style="overflow-wrap:anywhere"><summary>Technische Belege · Identitäten und Rohdaten</summary><p>Deskriptorreihenfolge · pathIds</p><ol>${job.pathIds.map(id=>`<li>${escapeHtml(id)}</li>`).join('')}</ol><p>Berechnungsreihenfolge · computationPathIds</p><ol>${job.computationPathIds.map(id=>`<li>${escapeHtml(id)}</li>`).join('')}</ol><p>Fortschritt · paths</p><pre style="white-space:pre-wrap;overflow-wrap:anywhere">${escapeHtml(JSON.stringify(job.paths))}</pre><p>Controls · controlBindings</p><pre style="white-space:pre-wrap;overflow-wrap:anywhere">${escapeHtml(job.controls ?? 'Nicht verfügbar')}</pre><pre style="white-space:pre-wrap;overflow-wrap:anywhere">${escapeHtml(JSON.stringify(job.controlBindings ?? 'Nicht verfügbar'))}</pre><p>Serialisiertes Producer-Ergebnis · nicht neu berechnet</p><pre style="max-height:320px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere">${escapeHtml(job.result ?? 'Nicht verfügbar')}</pre><p>Job- und Ergebnisidentitäten</p>${Object.entries({trialId:job.trialId,trialKey:job.trialKey,profile:job.profile,protocolSha256:job.protocolSha256,sourceSha256:job.sourceSha256,dataSha256:job.dataSha256,manifestSha256:job.manifestSha256,resultSha256:job.resultSha256,summarySha256:job.summarySha256}).map(([key,value])=>`<p>${escapeHtml(key)}: ${escapeHtml(value ?? 'Nicht verfügbar')}</p>`).join('')}<p>Weitere Jobfelder · keine Freigabe</p><p>owner: ${escapeHtml(job.owner ?? 'Nicht verfügbar')}</p><p>timestamps: ${escapeHtml(JSON.stringify(job.timestamps))}</p><p>executionAuthorized: ${historicalValue(job.executionAuthorized)}</p><p>promotionAuthorized: ${historicalValue(job.promotionAuthorized)}</p><p>profitabilityInferred: ${historicalValue(job.profitabilityInferred)}</p></details>` : '';
  const label=producerExport?'Producer-Export':'UI-Fixture';
  const input=producerExport?'data-arena-historical-export':'data-arena-historical-fixture';
  const message = projection?.status === 'INVALID' ? projection.message :
    projection?.message ?? (producerExport
      ? 'Kein Producer-Export importiert. Keine authentifizierte Evidenz oder Berechtigung.'
      : 'Kein historischer Bericht bereitgestellt. Ein Producer-Export ist ein getrenntes Format.');
  const provenance=producerExport
    ? `<p>${report?.provenance?.syntheticFixture?'SYNTHETIC_ONLY · ':''}UNVERIFIED · CALLER_SUPPLIED_INSPECT_B1 · NOT_ESTABLISHED · syntheticFixture: ${historicalValue(report?.provenance?.syntheticFixture)}. Keine Herkunfts-, Zulassungs- oder Berechtigungsbestätigung.</p>`
    : '<p>SYNTHETIC_ONLY · Generierte Test-Fixture, kein Producer-Export, keine authentifizierte Evidenz und keine Zulassungs- oder Berechtigungsbestätigung. Prüfsummen und Schema beweisen keine Echtheit.</p>';
  return `<section class="arena-historical-metadata" aria-label="Separates historisches Arena-Ergebnis · ${label}"><h3>Historisches B1-Ergebnis · ${label}</h3><label class="arena-import">${producerExport?'Versionierten Producer-Export':'Vorgeschlagene historische UI-Fixture'} importieren<input ${input} type="file" accept="application/json,.json" ${busy?'disabled':''}></label><p role="${projection?.status === 'INVALID' ? 'alert' : 'status'}">${busy ? `${label} wird geprüft …` : escapeHtml(message)}</p>${report ? `${provenance}${payload}` : `<p>Kein ${producerExport?'authentischer':'echter'} Bericht importiert. Keine Marktdaten, Neuberechnung, Kennzahlenberechnung oder Ergebniszuordnung.</p>`}</section>`;
}

function historicalExportSection(projection,busy,expandedSections=[],idPrefix='arena-producer-export',explorer={}) {
  return `<section class="arena-historical-metadata" aria-label="Separates historisches Arena-Ergebnis · Producer-Export"><label class="arena-import">Versionierten Producer-Export importieren<input id="${idPrefix}-input" data-arena-historical-export type="file" accept="application/json,.json"></label>${renderArenaResultView({projection,busy,expandedSections,idPrefix,explorer})}</section>`;
}

export function arenaHtml({result=null,error='',busy=false,digest='',provenance=null,provenanceBusy=false,provenanceError='',inspection=null,inspectionBusy=false,historicalResult=null,historicalResultBusy=false,historicalExport=null,historicalExportBusy=false,historicalExportExpandedSections=[],historicalExportIdPrefix='arena-producer-export',historicalExportExplorer={}}={}) {
  const rows = result?.candidates || ARENA_CANDIDATES.map(id=>({id}));
  const evidence = result?.sourceKind === 'SYNTHETIC'
    ? 'SYNTHETISCHE TESTDATEN · KEINE MARKTEVIDENZ'
    : result ? 'RETROSPEKTIVE DIAGNOSE · UNABHÄNGIGE PRÜFUNG OFFEN'
      : 'Keine Marktdaten importiert. Es findet kein automatischer Replay statt.';
  const controls = result ? `<p class="arena-control">Vergleichswerte: gleichgewichteter Kauf &amp; Halt ${formatNumber(result.controls?.buyAndHold?.baseline?.netReturnPct)} % · Cash ${formatNumber(result.controls?.cash?.baseline?.netReturnPct)} %. Kein risikogleicher Benchmark; keine Gewinnerwahl.</p>` : '';
  const period = result ? `<p>Zeitraum: ${escapeHtml(new Date(result.window.firstExecution).toISOString().slice(0,10))} bis ${escapeHtml(new Date(result.window.end).toISOString().slice(0,10))} · ${formatNumber(result.window.bars)} Tage. Modellannahmen: ${formatNumber(result.model.baselineCostBps)}/${formatNumber(result.model.stressCostBps)} Basispunkte je Kauf/Verkauf.</p>` : '';
  const producer = historicalExportSection(historicalExport,historicalExportBusy,
    historicalExportExpandedSections,historicalExportIdPrefix,historicalExportExplorer);
  return `<section class="strategy-arena" aria-labelledby="arena-heading"><header class="section-title"><h2 id="arena-heading">Arena · H1 / H7 / H9</h2><span class="limited">Nur manuell</span></header><p>Vier auswertbare historische Modelle und H9 als datenbedingt gesperrtes Modell. Eine Diagnose ist weder unabhängiger Test noch laufendes Paper. Keine automatische Siegerwahl.</p><div class="arena-toolbar"><label class="arena-import">Synthetischen oder vorhandenen Snapshot importieren<input data-arena-input type="file" accept="application/json,.json" ${busy?'disabled':''}></label><button type="button" data-arena-provenance ${provenanceBusy?'disabled':''}>Historische Belegmetadaten laden</button><button type="button" data-arena-stored ${busy?'disabled':''}>Gespeicherte Diagnose manuell laden</button><button type="button" data-arena-export ${result&&!busy?'':'disabled'}>Diagnose + Quelle exportieren</button></div>${provenanceBusy?'<p role="status">Nur Belegmetadaten werden geladen; keine Kurse oder Neuberechnung.</p>':''}${provenanceError?`<p role="alert">${escapeHtml(provenanceError)}</p>`:''}${busy?'<p role="status">Snapshot wird geprüft und neu berechnet …</p>':''}${error?`<p role="alert">${escapeHtml(error)}</p>`:''}<p class="arena-evidence">${evidence}</p>${period}<div class="arena-models">${rows.map(row=>candidateCard(row)).join('')}</div>${controls}${historicalProvenanceSection(provenance)}${inspectionSection(inspection,inspectionBusy)}${historicalResultSection(historicalResult,historicalResultBusy)}${producer}<details><summary>Diagnose-Grenzen</summary><p>Regelsatz ${escapeHtml(ARENA_RULESET)}. Historische Daten, Kosten, Slippage und Universum sind keine unabhängig bestätigte Evidenz. Offene Positionen und abhängige Verkaufsteile sind keine eigenständigen Trades.</p><p>Die gespeicherte 8-Asset-Quelle und die separate historische Abdeckung von 448/955 Schlüssen bleiben unvollständig/fehlgeschlagen. Das ist kein Beleg für den neuen 7-Asset-B1-7-Kandidaten.</p><p>Keine verbundenen Paper-Orders, keine Ausführungsfreigabe und keine Live-Bereitschaft. Kosten sind die ursprünglichen Annahmen dieses Diagnoseprotokolls und werden nicht rückwirkend geändert.</p>${digest?`<p>SHA-256 des importierten Inputs · Integrität, kein Echtheitsnachweis: ${escapeHtml(digest)}</p>`:''}</details></section>`;
}

export function createStrategyArenaView(root, options={}) {
  if (!root) throw new TypeError('Arena-Ziel fehlt.');
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  let state = {result:null,error:'',busy:false,digest:'',provenance:null,provenanceBusy:false,provenanceError:'',
    historicalExportIdPrefix:`arena-producer-${++resultViewInstanceCount}`};
  let input = null;
  let receipt = null;
  let disposed = false;
  let focusId = null;
  let pendingFocusRestore = false;
  let inspectionGeneration = 0;
  let historicalResultGeneration = 0;
  let historicalExportGeneration = 0;
  const paint = () => {
    if (disposed) return;
    const active = globalThis.document?.activeElement;
    if (active && root.contains(active)) {
      const control = FOCUS_CONTROLS.find(([selector])=>active.matches?.(selector));
      focusId = active.id || (control ? `${state.historicalExportIdPrefix}-${control[1]}` : null);
      pendingFocusRestore = false;
    } else if (!(pendingFocusRestore && active === globalThis.document?.body)) {
      focusId = null;
      pendingFocusRestore = false;
    }
    const disclosures = root.querySelectorAll?.('[data-arena-result-section]') ?? [];
    if (disclosures.length) {
      state.historicalExportExpandedSections = [...disclosures]
        .filter(section=>section.open)
        .map(section=>section.dataset.arenaResultSection);
    }
    root.innerHTML = arenaHtml(state);
    for (const [selector,suffix] of FOCUS_CONTROLS) {
      const control = root.querySelector?.(selector);
      if (control && !control.id) control.id = `${state.historicalExportIdPrefix}-${suffix}`;
    }
    if (!focusId) return;
    const target = [...(root.querySelectorAll?.('[id]') ?? [])].find(element=>element.id===focusId);
    if (target) {
      if (target.disabled) {
        target.disabled = false;
        target.setAttribute('aria-busy','true');
      }
      target.focus({preventScroll:true});
      pendingFocusRestore = false;
    } else {
      pendingFocusRestore = true;
    }
  };
  const listen = async event => {
    if (disposed) return;
    const explorerControl = event.target?.closest?.('[data-arena-path-filter],[data-arena-path-select],[data-arena-path-detail],[data-arena-path-filter-reset],[data-arena-path-selection-reset]');
    if (explorerControl?.dataset && root.contains(explorerControl)) {
      const changeControl = explorerControl.matches('[data-arena-path-filter],[data-arena-path-select]');
      if (event.type !== (changeControl ? 'change' : 'click') ||
          state.historicalExportBusy || state.historicalExport?.status !== 'PRESENT_UNVERIFIED') return;
      const explorer = state.historicalExportExplorer ??= {filters:{},selectedPathIds:[],detailPathId:null};
      const {arenaPathFilter,arenaPathSelect,arenaPathDetail} = explorerControl.dataset;
      const paths = state.historicalExport.result?.paths ?? [];
      if (arenaPathFilter && ['segmentId','variantId','scenarioId','status'].includes(arenaPathFilter)) {
        explorer.filters[arenaPathFilter] = explorerControl.value;
      } else if (arenaPathSelect && paths.some(path=>path.pathId===arenaPathSelect)) {
        explorer.selectedPathIds = explorer.selectedPathIds.filter(id=>id!==arenaPathSelect);
        if (explorerControl.checked && explorer.selectedPathIds.length<2) explorer.selectedPathIds.push(arenaPathSelect);
      } else if (arenaPathDetail && paths.some(path=>path.pathId===arenaPathDetail)) {
        explorer.detailPathId = arenaPathDetail;
      } else if (explorerControl.hasAttribute('data-arena-path-filter-reset')) {
        explorer.filters = {};
      } else if (explorerControl.hasAttribute('data-arena-path-selection-reset')) {
        explorer.selectedPathIds = [];
      }
      paint();
      if (arenaPathDetail) {
        const detail = root.querySelector(`#${state.historicalExportIdPrefix}-detail-heading`);
        detail?.focus();
      }
      return;
    }
    const button = event.target?.closest?.('[data-arena-provenance],[data-arena-stored],[data-arena-export]');
    if (button && root.contains(button)) {
      if (button.hasAttribute('data-arena-provenance')) {
        if (state.provenanceBusy) return;
        state.provenanceBusy = true; state.provenanceError = ''; paint();
        try {
          const provenance = await loadStoredArenaProvenance(fetchImpl);
          if (!disposed) state.provenance = provenance;
        }
        catch (error) { state.provenanceError = String(error?.message || error).slice(0,220); }
        finally { state.provenanceBusy = false; paint(); }
      } else if (button.hasAttribute('data-arena-stored')) {
        if (state.busy) return;
        state = {...state,result:null,error:'',busy:true,digest:''}; input = null; receipt = null; paint();
        try {
          const evaluated = await loadStoredArena(fetchImpl);
          input = evaluated.input; receipt = evaluated.sourceReceipt;
          state.result = evaluated.result; state.digest = evaluated.digest;
        } catch (error) { state.error = String(error?.message || error).slice(0,220); }
        finally { state.busy = false; paint(); }
      } else if (input && state.result) {
        const blob = new Blob([JSON.stringify({
          ruleset:ARENA_RULESET,inputSha256:state.digest,input,
          result:metricSummary(state.result),
          resultScope:'METRIC_SUMMARY_RECOMPUTABLE_FROM_RETAINED_INPUT',
          receipt,receiptStatus:'UNVERIFIED_ORIGINAL_SOURCE_RECEIPT_LOCAL_REPLAY'
        })],{type:'application/json'});
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url; link.download = 'meridian-m11-arena-diagnostic.json'; link.click();
        setTimeout(()=>URL.revokeObjectURL(url),0);
      }
      return;
    }
    const inspectionInput = event.target?.closest?.('[data-arena-inspection]');
    if (inspectionInput && root.contains(inspectionInput)) {
      if (event.type === 'click') return;
      const file = inspectionInput.files?.[0];
      if (!file) return;
      const generation = ++inspectionGeneration;
      state.inspection = null; state.inspectionBusy = true; paint();
      try {
        const projection = !Number.isSafeInteger(file.size) || file.size < 0 || file.size > MAX_INSPECTION_REPORT_BYTES
          ? parseArenaInspectionReport('') : parseArenaInspectionReport(await file.text());
        if (!disposed && generation === inspectionGeneration) state.inspection = projection;
      } catch {
        if (!disposed && generation === inspectionGeneration) state.inspection = parseArenaInspectionReport('');
      } finally {
        if (!disposed && generation === inspectionGeneration) { state.inspectionBusy = false; paint(); }
      }
      return;
    }
    const historicalInput = event.target?.closest?.('[data-arena-historical-fixture]');
    if (historicalInput && root.contains(historicalInput)) {
      if (event.type === 'click') return;
      const file = historicalInput.files?.[0];
      if (!file) return;
      const generation = ++historicalResultGeneration;
      state.historicalResult = null; state.historicalResultBusy = true; paint();
      try {
        const projection = !Number.isSafeInteger(file.size) || file.size < 0 ||
          file.size > MAX_HISTORICAL_FIXTURE_BYTES
          ? parseArenaHistoricalResultFixture(null)
          : parseArenaHistoricalResultFixture(await file.text());
        if (!disposed && generation === historicalResultGeneration) state.historicalResult = projection;
      } catch {
        if (!disposed && generation === historicalResultGeneration) {
          state.historicalResult = parseArenaHistoricalResultFixture('');
        }
      } finally {
        if (!disposed && generation === historicalResultGeneration) {
          state.historicalResultBusy = false; paint();
        }
      }
      return;
    }
    const historicalExportInput = event.target?.closest?.('[data-arena-historical-export]');
    if (historicalExportInput && root.contains(historicalExportInput)) {
      if (event.type === 'click') return;
      const file = historicalExportInput.files?.[0];
      if (!file) return;
      const generation = ++historicalExportGeneration;
      state.historicalExportExplorer = {filters:{},selectedPathIds:[],detailPathId:null};
      focusId = null; pendingFocusRestore = false;
      state.historicalExport = null; state.historicalExportBusy = true; paint();
      try {
        const projection = !Number.isSafeInteger(file.size) || file.size < 0 ||
          file.size > MAX_HISTORICAL_EXPORT_BYTES
          ? await parseArenaHistoricalExport(new Uint8Array())
          : await parseArenaHistoricalExport(new Uint8Array(await file.arrayBuffer()));
        if (!disposed && generation === historicalExportGeneration) state.historicalExport = projection;
      } catch {
        if (!disposed && generation === historicalExportGeneration) {
          const projection = await parseArenaHistoricalExport(new Uint8Array());
          if (!disposed && generation === historicalExportGeneration) state.historicalExport = projection;
        }
      } finally {
        if (!disposed && generation === historicalExportGeneration) {
          state.historicalExportBusy = false; paint();
        }
      }
      return;
    }
    const fileInput = event.target?.closest?.('[data-arena-input]');
    const file = fileInput?.files?.[0];
    if (!file || state.busy) return;
    if (file.size > 4_000_000) {
      state = {...state,result:null,error:'Snapshot zu groß (max. 4 MB).',busy:false,digest:''};
      input = null; receipt = null; paint(); return;
    }
    state = {...state,result:null,error:'',busy:true,digest:''}; input = null; receipt = null; paint();
    try {
      const evaluated = await evaluateArenaImport(await file.text());
      input = evaluated.input; receipt = evaluated.sourceReceipt;
      state.result = evaluated.result; state.digest = evaluated.digest;
    } catch (error) {
      state.error = String(error?.message || error).slice(0,220);
    } finally { state.busy = false; paint(); }
  };
  root.addEventListener('click',listen);
  root.addEventListener('change',listen);
  paint();
  return {dispose(){
    disposed = true; historicalExportGeneration++;
    state.historicalExport = null; state.historicalExportExplorer = null;
    focusId = null; pendingFocusRestore = false;
    root.removeEventListener('click',listen);root.removeEventListener('change',listen);root.replaceChildren();
  }};
}
