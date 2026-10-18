import {ARENA_RULESET, ARENA_CANDIDATES, ARENA_SYMBOLS, replayStrategyPaperArena} from '../research/strategy-paper-arena.js';

const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number = value => Number.isFinite(value) ? new Intl.NumberFormat('de-DE',{maximumFractionDigits:2}).format(value) : '—';
const tone = value => !Number.isFinite(value) || value === 0 ? 'muted' : value < 0 ? 'danger' : 'safe';
const names = {'H1-B':'Trend + Cash','H1-E':'Trend mit Kostenpuffer','H7-B':'Defensive Spot-Auswahl','H7-R':'Defensive Auswahl mit Rangpuffer',H9:'Basis datierter Futures'};
const PROVENANCE_CANDIDATES = new Set(['H1-B','H1-E','H7-B','H7-R']);
const PROVENANCE_PATH = 'research/results/strategy-arena-20261016/manifest.json';
const PROVENANCE_BLOB = 'f06444cb129d39aa60c7ea3c44c8179c163a2270';
const unknownField = () => ({status:'UNKNOWN',value:null});
function provenanceField(value, valid, format=x=>x) {
  if(value===undefined || value===null)return unknownField();
  if(!valid(value))return {status:'INVALID',value:null};
  return {status:'PRESENT_UNVERIFIED',value:format(value)};
}
const validHash = value => typeof value==='string' && /^[a-f0-9]{64}$/i.test(value);
const validText = value => typeof value==='string' && value.trim().length>0;
const DAY = 86400000;
const utcDate = value => {
  if(!Number.isSafeInteger(value) || !Number.isFinite(new Date(value).getTime()))return null;
  return new Date(value).toISOString().slice(0,10);
};
function dateField(value) {
  return provenanceField(value, value=>utcDate(value)!==null, value=>new Intl.DateTimeFormat('de-DE',{timeZone:'UTC',day:'2-digit',month:'2-digit',year:'numeric'}).format(value));
}
function strictTimestamp(value) {
  if(typeof value!=='string')return null;
  const match=/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,3}))?Z$/.exec(value);
  if(!match)return null;
  const date=new Date(value);
  if(!Number.isFinite(date.getTime()))return null;
  const canonical=match[1]+'.'+(match[2]||'').padEnd(3,'0')+'Z';
  return date.toISOString()===canonical?date.getTime():null;
}
function timestampField(value) {
  return provenanceField(value,value=>strictTimestamp(value)!==null,value=>new Date(strictTimestamp(value)).toISOString());
}
function provenanceStatus(field) {
  return field.status==='PRESENT_UNVERIFIED'?'vorhanden · nicht bestätigt':field.status==='INVALID'?'ungültig':'unbekannt';
}
function provenanceValue(field) {
  return field.status==='PRESENT_UNVERIFIED'?escape(field.value):field.status==='INVALID'?'Ungültig':'Unbekannt';
}
function unavailableProvenance(candidateId,status) {
  const field=status==='INVALID'?{status:'INVALID',value:null}:unknownField();
  return {candidateId,associationStatus:status,blocked:candidateId==='H9',fields:{market:{...field},universe:{...field},coverage:{...field},warmup:{...field},scored:{...field}},receipt:unknownField(),ruleset:{...field},technical:{schema:{...field},provider:{...field},sealed:{...field}},hashes:Object.fromEntries(['inputSha256','rawInputSha256','engineSha256','protocolSha256','rulesSha256'].map(key=>[key,{...field}]))};
}
function provenanceDetails(record) {
  const hashes=['inputSha256','rawInputSha256','engineSha256','protocolSha256','rulesSha256'];
  const field=key=>`<li><b>${escape(key)} · ${provenanceStatus(record.hashes[key])}</b> <span>${provenanceValue(record.hashes[key])}</span></li>`;
  return `<details><summary>Technische Belegdetails und vollständige Prüfsummen</summary><p>Beleg-ID · ${provenanceStatus(record.receipt)}: ${provenanceValue(record.receipt)}</p><p>Belegdatei · Git-Blob ${PROVENANCE_BLOB}</p><p>Regelsatz · ${provenanceStatus(record.ruleset)}: ${provenanceValue(record.ruleset)}</p><p>Schema · ${provenanceStatus(record.technical.schema)}: ${provenanceValue(record.technical.schema)}</p><p>Quelle · ${provenanceStatus(record.technical.provider)}: ${provenanceValue(record.technical.provider)}</p><p>Versiegelungszeit · ${provenanceStatus(record.technical.sealed)}: ${provenanceValue(record.technical.sealed)}</p><ul>${hashes.map(field).join('')}</ul></details>`;
}
function provenanceCard(candidateId,provenance) {
  const record=provenance?.[candidateId]||unavailableProvenance(candidateId,'UNKNOWN');
  if(record.blocked)return `<section class="arena-provenance" aria-label="${escape(candidateId)} Herkunft"><h3>Rückblickende Herkunft</h3><p><b>Daten fehlen.</b> H9: kein passender Beleg; Kraken-USD-Daten werden nicht zugeordnet. CRV ungeklärt · keine Zukunftsdaten.</p></section>`;
  if(record.associationStatus!=='PRESENT_UNVERIFIED')return `<section class="arena-provenance" aria-label="${escape(candidateId)} Herkunft"><h3>Rückblickende Herkunft</h3><p>${record.associationStatus==='INVALID'?'Kandidatenzuordnung ungültig.':'Kandidatenbeleg unbekannt.'} Kein Beleg zugeordnet.</p></section>`;
  const fields=[['Markt',record.fields.market],['Universum',record.fields.universe],['Abdeckung',record.fields.coverage],['Aufwärmphase',record.fields.warmup],['Auswertungszeitraum',record.fields.scored]];
  return `<section class="arena-provenance" aria-label="${escape(candidateId)} Herkunft"><h3>Rückblickende Herkunft</h3><p class="arena-provenance-status">Quellenangaben · nicht bestätigt · keine Zukunftsdaten.</p><dl>${fields.map(([label,value])=>`<div><dt>${escape(label)} <small>${provenanceStatus(value)}</small></dt><dd>${provenanceValue(value)}</dd></div>`).join('')}</dl>${provenanceDetails(record)}<p>CRV ungeklärt · keine Aussage zu Ertrag oder Einsatzbereitschaft.</p></section>`;
}
export function canonicalArenaInput(value) {
  if(value===null || typeof value!=='object') return JSON.stringify(value);
  if(Array.isArray(value)) return '['+value.map(canonicalArenaInput).join(',')+']';
  return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonicalArenaInput(value[key])).join(',')+'}';
}
export function adaptArenaProvenance(manifest) {
  const root=manifest && typeof manifest==='object' && !Array.isArray(manifest) ? manifest : {};
  const receipt=root.receipt && typeof root.receipt==='object' && !Array.isArray(root.receipt) ? root.receipt : {};
  const template=root.inputTemplate && typeof root.inputTemplate==='object'&&!Array.isArray(root.inputTemplate)?root.inputTemplate:{};
  const collection=template.collection && typeof template.collection==='object'&&!Array.isArray(template.collection)?template.collection:{};
  const summary=root.summary && typeof root.summary==='object'&&!Array.isArray(root.summary)?root.summary:{};
  const window=summary.window && typeof summary.window==='object'&&!Array.isArray(summary.window)?summary.window:{};
  const model=summary.model && typeof summary.model==='object'&&!Array.isArray(summary.model)?summary.model:{};
  const schema=provenanceField(root.schemaVersion,value=>value==='MERIDIAN_ARENA_CHUNKED_INPUT_V1');
  const receiptSchema=provenanceField(receipt.schemaVersion,value=>value==='MERIDIAN_ARENA_RECEIPT_V1');
  const ruleset=provenanceField(root.ruleset,value=>value===ARENA_RULESET);
  const summaryRuleset=provenanceField(summary.ruleset,value=>value===ARENA_RULESET);
  const candidateRows=summary.candidates;
  let associationStatus='PRESENT_UNVERIFIED';
  if(candidateRows===undefined || candidateRows===null)associationStatus='UNKNOWN';
  else if(!Array.isArray(candidateRows))associationStatus='INVALID';
  else {
    const candidateIds=candidateRows.map(candidate=>candidate&&typeof candidate==='object'&&!Array.isArray(candidate)?candidate.id:undefined);
    if(candidateIds.some(id=>typeof id!=='string'||!ARENA_CANDIDATES.includes(id)) || new Set(candidateIds).size!==candidateIds.length)associationStatus='INVALID';
    else if(ARENA_CANDIDATES.some(id=>!candidateIds.includes(id)))associationStatus='UNKNOWN';
    else if(candidateRows.some(candidate=>
      (candidate.ruleset!==undefined && candidate.ruleset!==null && candidate.ruleset!==ARENA_RULESET) ||
      (candidate.id==='H9' && candidate.status!=='BLOCKED_DATA')))associationStatus='INVALID';
  }
  const optionalRulesets=[];
  for(const [owner,key] of [[template,'ruleset'],[receipt,'ruleset'],...(Array.isArray(candidateRows)?candidateRows.map(candidate=>[candidate,'ruleset']):[])])
    if(Object.prototype.hasOwnProperty.call(owner,key))optionalRulesets.push(provenanceField(owner[key],value=>value===ARENA_RULESET));
  if(optionalRulesets.some(field=>field.status==='INVALID'))associationStatus='INVALID';
  else if(optionalRulesets.some(field=>field.status==='UNKNOWN')&&associationStatus==='PRESENT_UNVERIFIED')associationStatus='UNKNOWN';
  const requiredEnvelope=[schema,receiptSchema,ruleset,summaryRuleset];
  if(requiredEnvelope.some(field=>field.status==='INVALID'))associationStatus='INVALID';
  else if(requiredEnvelope.some(field=>field.status==='UNKNOWN') && associationStatus==='PRESENT_UNVERIFIED')associationStatus='UNKNOWN';

  const provider=provenanceField(receipt.collectorProvider,validText);
  const sourceKind=provenanceField(receipt.sourceKind,value=>value==='MARKET_DIAGNOSTIC');
  const summarySource=provenanceField(summary.sourceKind,value=>value==='MARKET_DIAGNOSTIC');
  const quote=provenanceField(receipt.quoteCurrency,value=>value==='USD'||value==='USDT');
  const inputQuote=provenanceField(template.quoteCurrency,value=>value==='USD'||value==='USDT');
  const summaryQuote=provenanceField(summary.quoteCurrency,value=>value==='USD'||value==='USDT');
  const fxApplied=provenanceField(summary.fxConversionApplied,value=>value===false);
  const fxCollection=provenanceField(collection.fxConversion,value=>value===false);
  const marketFields=[provider,sourceKind,summarySource,quote,inputQuote,summaryQuote,fxApplied,fxCollection];
  const disagrees=(left,right)=>left.status==='PRESENT_UNVERIFIED'&&right.status==='PRESENT_UNVERIFIED'&&left.value!==right.value;
  let market=unknownField();
  if(marketFields.some(field=>field.status==='INVALID') ||
    disagrees(sourceKind,summarySource)||disagrees(quote,inputQuote)||disagrees(quote,summaryQuote))market={status:'INVALID',value:null};
  else if(marketFields.every(field=>field.status==='PRESENT_UNVERIFIED')) {
    const source=provider.value==='KRAKEN_SPOT_PUBLIC_OHLC'?'Kraken Spot':provider.value;
    market={status:'PRESENT_UNVERIFIED',value:`${source} · ${quote.value} (nicht ${quote.value==='USD'?'USDT':'USD'})`};
  }

  let universe=unknownField();
  if(root.chunks===null || (root.chunks!==undefined && !Array.isArray(root.chunks)))universe={status:'INVALID',value:null};
  else if(Array.isArray(root.chunks)) {
    const symbols=root.chunks.map(chunk=>chunk?.symbol);
    if(symbols.some(symbol=>typeof symbol!=='string'||!ARENA_SYMBOLS.includes(symbol)) || new Set(symbols).size!==symbols.length)universe={status:'INVALID',value:null};
    else if(symbols.length===ARENA_SYMBOLS.length && ARENA_SYMBOLS.every(symbol=>symbols.includes(symbol)))universe={status:'PRESENT_UNVERIFIED',value:`${symbols.length} Werte: ${symbols.join(', ')}`};
    else universe=unknownField();
  }

  const warmupRaw=window.warmupStart, decisionRaw=window.firstDecision, executionRaw=window.firstExecution, endRaw=window.end;
  const warmup=dateField(warmupRaw), decision=dateField(decisionRaw), execution=dateField(executionRaw), end=dateField(endRaw);
  const bars=provenanceField(window.bars,value=>Number.isSafeInteger(value)&&value>0);
  const warmupBars=provenanceField(model.warmupBars,value=>Number.isSafeInteger(value)&&value>0);
  let timelineStatus='PRESENT_UNVERIFIED';
  const timelineFields=[warmup,decision,execution,end,bars,warmupBars];
  if(timelineFields.some(field=>field.status==='INVALID'))timelineStatus='INVALID';
  else if(timelineFields.some(field=>field.status==='UNKNOWN'))timelineStatus='UNKNOWN';
  else {
    const aligned=(value,close)=>value%DAY===(close?DAY-1:0);
    const scoredCount=(endRaw-executionRaw+1)/DAY;
    const warmupCount=(decisionRaw-warmupRaw+1)/DAY;
    if(![warmupRaw,decisionRaw,executionRaw,endRaw].every(Number.isSafeInteger) ||
      !aligned(warmupRaw,false)||!aligned(decisionRaw,true)||!aligned(executionRaw,false)||!aligned(endRaw,true) ||
      !(warmupRaw<decisionRaw && decisionRaw+1===executionRaw && executionRaw<=endRaw) ||
      !Number.isInteger(scoredCount)||scoredCount!==bars.value ||
      !Number.isInteger(warmupCount)||warmupCount!==warmupBars.value)timelineStatus='INVALID';
  }
  const coverage=timelineStatus==='PRESENT_UNVERIFIED'?{status:timelineStatus,value:`${warmup.value} – ${end.value} UTC`}:{status:timelineStatus,value:null};
  const warmupRange=timelineStatus==='PRESENT_UNVERIFIED'?{status:timelineStatus,value:`${warmup.value} – ${decision.value} UTC · ${warmupBars.value} Tage`}:{status:timelineStatus,value:null};
  const scored=timelineStatus==='PRESENT_UNVERIFIED'?{status:timelineStatus,value:`${execution.value} – ${end.value} UTC · ${bars.value} Tage`}:{status:timelineStatus,value:null};

  const sealed=timestampField(receipt.sealedAt);
  const collected=timestampField(collection.collectedAt), completed=timestampField(collection.completedAt);
  const asOf=provenanceField(receipt.asOf,value=>Number.isSafeInteger(value)&&value===template.asOf&&value===summary.asOf);
  const cutoff=provenanceField(collection.eventTimeCutoff,value=>Number.isSafeInteger(value)&&value===endRaw);
  const timeFields=[sealed,collected,completed,asOf,cutoff];
  let receiptTimeline='PRESENT_UNVERIFIED';
  if(timeFields.some(field=>field.status==='INVALID'))receiptTimeline='INVALID';
  else if(timeFields.some(field=>field.status==='UNKNOWN'))receiptTimeline='UNKNOWN';
  else if(strictTimestamp(collection.collectedAt)>strictTimestamp(collection.completedAt) ||
    strictTimestamp(collection.completedAt)>strictTimestamp(receipt.sealedAt))receiptTimeline='INVALID';
  if(timelineStatus==='INVALID'||receiptTimeline==='INVALID')associationStatus='INVALID';
  else if((timelineStatus==='UNKNOWN'||receiptTimeline==='UNKNOWN')&&associationStatus==='PRESENT_UNVERIFIED')associationStatus='UNKNOWN';

  const receiptIdentity=receiptTimeline==='PRESENT_UNVERIFIED' && receiptSchema.status==='PRESENT_UNVERIFIED'
    ?{status:'PRESENT_UNVERIFIED',value:`${PROVENANCE_PATH} · ${receipt.schemaVersion} · ${sealed.value}`}
    :{status:receiptTimeline==='INVALID'?'INVALID':'UNKNOWN',value:null};
  const hashes=Object.fromEntries(['inputSha256','rawInputSha256','engineSha256','protocolSha256','rulesSha256'].map(key=>[key,provenanceField(receipt[key],validHash)]));
  const common={
    fields:{market,universe,coverage,warmup:warmupRange,scored},
    receipt:receiptIdentity,
    ruleset,
    technical:{schema:receiptSchema,provider, sealed},
    hashes
  };
  const result={};
  for(const candidateId of ARENA_CANDIDATES) {
    if(candidateId==='H9')result[candidateId]=unavailableProvenance(candidateId,'BLOCKED_DATA');
    else if(associationStatus!=='PRESENT_UNVERIFIED' || !PROVENANCE_CANDIDATES.has(candidateId))
      result[candidateId]=unavailableProvenance(candidateId,associationStatus);
    else result[candidateId]={candidateId,blocked:false,associationStatus,...common,hashes:{...common.hashes}};
  }
  return result;
}
export async function loadStoredArenaProvenance(fetchImpl=globalThis.fetch) {
  const url=new URL('../research/results/strategy-arena-20261016/manifest.json',import.meta.url);
  const response=await fetchImpl(url.href,{cache:'no-store',signal:AbortSignal.timeout(12000)});
  if(!response.ok)throw Error('Gespeicherte Receipt-Metadaten nicht verfügbar.');
  const text=await response.text();
  if(text.length>262144)throw Error('Receipt-Metadaten zu groß.');
  return adaptArenaProvenance(JSON.parse(text));
}
function metricSummary(result) {
  return JSON.parse(JSON.stringify(result,(key,value)=>['positions','decisions','fills','trades','equityCurve'].includes(key)?undefined:value));
}
async function digestText(text, subtle=globalThis.crypto?.subtle) {
  if(!subtle)throw Error('SHA-256 in diesem Browser nicht verfügbar.');
  return [...new Uint8Array(await subtle.digest('SHA-256',new TextEncoder().encode(text)))].map(x=>x.toString(16).padStart(2,'0')).join('');
}
export async function loadStoredArena(fetchImpl=globalThis.fetch, subtle=globalThis.crypto?.subtle) {
  const base=new URL('../research/results/strategy-arena-20261016/',import.meta.url);
  const read=async name=>{
    const response=await fetchImpl(new URL(name,base).href,{cache:'no-store',signal:AbortSignal.timeout(12000)});
    if(!response.ok)throw Error('Gespeicherte Diagnose nicht verfügbar.');
    const text=await response.text();if(text.length>262144)throw Error('Diagnose-Datei zu groß.');return text;
  };
  const manifest=JSON.parse(await read('manifest.json'));
  if(manifest.schemaVersion!=='MERIDIAN_ARENA_CHUNKED_INPUT_V1'||manifest.ruleset!==ARENA_RULESET||!Array.isArray(manifest.chunks)||manifest.chunks.length!==8||!manifest.receipt?.inputSha256)throw Error('Diagnose-Manifest ungültig.');
  const input=structuredClone(manifest.inputTemplate);input.data={};
  if(!input.collection)throw Error('Quellenbeleg fehlt.');input.collection.rawResponses={};
  const seen=new Set();
  for(const entry of manifest.chunks){
    if(!ARENA_SYMBOLS.includes(entry.symbol)||seen.has(entry.symbol)||entry.path!==entry.symbol+'.json'||!/^[a-f0-9]{64}$/.test(entry.sha256))throw Error('Diagnose-Dateiverweis ungültig.');
    seen.add(entry.symbol);const text=await read(entry.path);
    if(await digestText(text,subtle)!==entry.sha256)throw Error('Diagnose-Datei: Hash stimmt nicht.');
    const chunk=JSON.parse(text);if(chunk.symbol!==entry.symbol)throw Error('Diagnose-Symbol stimmt nicht.');
    input.data[entry.symbol]=chunk.rows;input.collection.rawResponses[entry.symbol]=chunk.rawResponse;
  }
  return evaluateArenaImport(JSON.stringify({ruleset:manifest.ruleset,input,receipt:manifest.receipt}),subtle);
}

export function arenaHtml({result=null, error='', busy=false, digest='', provenance=null, provenanceBusy=false, provenanceError=''}={}) {
  const rows = result?.candidates || ARENA_CANDIDATES.map(id => ({id}));
  const cards = rows.map(row => {
    const m=row.baseline, stress=row.stress, blocked=row.id==='H9';
    return `<article class="paper-model-card arena-model"><div class="arena-model-head"><div><span>${escape(row.id)} · ${escape(names[row.id] || row.id)}</span><b>${blocked?'DATEN FEHLEN':m?'HISTORISCHE DIAGNOSE':'NOCH NICHT AUSGEWERTET'}</b></div><strong class="tone-${tone(m?.netPnl)}">${m?number(m.netPnl)+' '+escape(m.currency):'—'}</strong></div>${blocked?'<p>Ausführbare Kurse beider Legs, Abrechnung, Finanzierung und Margin-Verlauf fehlen. Keine simulierten Trades.</p>':`<div class="paper-model-grid"><span>NETTO <b class="tone-${tone(m?.netReturnPct)}">${m?number(m.netReturnPct)+' %':'—'}</b></span><span>MAX. DD · TAGESSCHLUSS <b>${m?number(m.maxDrawdownPct)+' %':'—'}</b></span><span>KOSTEN <b>${m?number(m.costs)+' '+escape(m.currency):'—'}</b></span><span>VERKAUFSTEILE <b>${m?number(m.closedTrades):'—'}</b></span><span>PF <b>${number(m?.profitFactor)}</b></span><span>KOSTENSTRESS · NETTO <b class="tone-${tone(stress?.netReturnPct)}">${stress?number(stress.netReturnPct)+' %':'—'}</b></span></div>`}<small>${m?'10.000 '+escape(m.currency)+' je getrenntem Modell · 1× Spot · keine EUR-Umrechnung':'Keine Performance behauptet.'}</small>${provenanceCard(row.id,provenance)}</article>`;
  }).join('');
  const controls=result?`<p class="arena-controls">Vergleich im selben Zeitraum: gleichgewichtetes Buy &amp; Hold <b class="tone-${tone(result.controls?.buyAndHold?.baseline?.netReturnPct)}">${number(result.controls?.buyAndHold?.baseline?.netReturnPct)} %</b> · Cash ${number(result.controls?.cash?.baseline?.netReturnPct)} %. Kein risikogleicher Benchmark.</p>`:'';
  return `<section class="strategy-arena"><div class="section-title"><h2>STRATEGIE-ARENA</h2><small>H1 · H7 · H9</small></div><p>Getrennte Paper-Simulationen. Historische Ergebnisse sind kein unabhängiger Nachweis und kein laufender Paper-Bot. Keine automatische Siegerwahl.</p><div class="arena-toolbar"><label class="arena-import">Daten-Snapshot importieren<input data-arena-input type="file" accept="application/json,.json" ${busy?'disabled':''}></label><button data-arena-provenance type="button" ${provenanceBusy?'disabled':''}>Vorhandene Belegdaten anzeigen</button><button data-arena-stored type="button" ${busy?'disabled':''}>Gespeicherte Marktdiagnose laden</button><button data-arena-export type="button" ${result&&!busy?'':'disabled'}>Ergebnis + Quelle exportieren</button></div>${provenanceBusy?'<p role="status">Belegdaten werden gelesen – keine Kursdaten oder Neuberechnung.</p>':''}${provenanceError?`<p role="alert" class="tone-danger">${escape(provenanceError)}</p>`:''}${busy?'<p role="status">Snapshot prüfen und berechnen …</p>':''}${error?`<p role="alert" class="tone-danger">${escape(error)}</p>`:''}<p class="arena-evidence">${result?.sourceKind==='SYNTHETIC'?'SYNTHETISCHE TESTDATEN · KEINE MARKTEVIDENZ':result?'RETROSPEKTIVE DIAGNOSE · FORWARD-NACHWEIS OFFEN':'Noch keine Marktdaten oder Paper-Ergebnisse importiert.'}</p>${result?`<p>Zeitraum: ${escape(new Date(result.window.firstExecution).toISOString().slice(0,10))} bis ${escape(new Date(result.window.end).toISOString().slice(0,10))} · ${number(result.window.bars)} Tage. ${result.model.baselineCostBps}/${result.model.stressCostBps} Basispunkte je Kauf/Verkauf sind Modellannahmen.</p>`:''}<div class="paper-model-stack">${cards}</div>${controls}<details><summary>Was ist belegt – was fehlt?</summary><p>Regeln: ${escape(ARENA_RULESET)}. Kosten, Slippage, Universum und historische Datenverfügbarkeit sind noch nicht unabhängig bestätigt. Kein zukünftiges Ergebnis ist nachgewiesen.</p><p>Diese Portfoliomodelle haben keinen festen Stop/TP. CRV-Kompatibilität ist ungeklärt; keine Freigabe für echte oder serverseitige Paper-Orders. Die Modelle können eingesetztes Spot-Kapital verlieren. Drawdown wird an Tagesschlüssen gemessen. PF ohne realisierte Verluste bleibt undefiniert; Verkaufsteile sind keine unabhängigen Trades.</p><p>Offene Positionen sind markiert, sofern keine ausdrücklich gekennzeichnete diagnostische Endliquidation gewählt wurde. Historische Daten sind kein frischer Holdout. Für die laufende Beobachtung fehlen noch ein geprüfter Collector, unveränderliche Zeitstempel und ein vorab festgelegtes Beobachtungsfenster.</p>${digest?`<p class="arena-digest">SHA-256 des importierten Inputs: ${escape(digest)}. Integritätswert, kein Echtheitsnachweis.</p>`:''}</details></section>`;
}

export async function evaluateArenaImport(text, subtle=globalThis.crypto?.subtle) {
  if(typeof text!=='string' || text.length>4_000_000) throw Error('Snapshot zu groß oder ungültig (max. 4 MB).');
  const parsed=JSON.parse(text), input=parsed.input || parsed;
  if((parsed.ruleset && parsed.ruleset!==ARENA_RULESET) || (parsed.result?.ruleset && parsed.result.ruleset!==ARENA_RULESET)) throw Error('Abweichende Regelversion. Ergebnisse nicht übernommen.');
  if(!subtle) throw Error('SHA-256 in diesem Browser nicht verfügbar.');
  const digest=await digestText(canonicalArenaInput(input)+'\n',subtle);
  if(parsed.inputSha256 && parsed.inputSha256!==digest) throw Error('Snapshot-Hash stimmt nicht.');
  if(parsed.receipt?.inputSha256 && parsed.receipt.inputSha256!==digest) throw Error('Quellbeleg und Snapshot stimmen nicht überein.');
  // Recompute every value; an imported performance table is never trusted.
  const result=replayStrategyPaperArena(input);
  return {input,result,digest,sourceReceipt:parsed.receipt || null};
}

export function createStrategyArenaView() {
  let state={result:null,error:'',busy:false,digest:'',provenance:null,provenanceBusy:false,provenanceError:''}, input=null, sourceReceipt=null;
  return {
    html:()=>arenaHtml(state),
    bind(root){
      const repaint=()=>{const host=root.querySelector('[data-strategy-arena]');if(host){host.innerHTML=arenaHtml(state);this.bind(root);}};
      root.querySelector('[data-arena-provenance]')?.addEventListener('click',async()=>{
        if(state.provenanceBusy)return;state.provenanceBusy=true;state.provenanceError='';repaint();
        try{state.provenance=await loadStoredArenaProvenance();}
        catch(error){state.provenanceError=String(error?.message||error).slice(0,220);}
        finally{state.provenanceBusy=false;repaint();}
      });
      root.querySelector('[data-arena-stored]')?.addEventListener('click',async()=>{
        if(state.busy)return;state={result:null,error:'',busy:true,digest:''};input=null;sourceReceipt=null;repaint();
        try{const evaluated=await loadStoredArena();input=evaluated.input;sourceReceipt=evaluated.sourceReceipt;state.result=evaluated.result;state.digest=evaluated.digest;}
        catch(error){state.error=String(error?.message||error).slice(0,220);}
        finally{state.busy=false;repaint();}
      });
      root.querySelector('[data-arena-input]')?.addEventListener('change',async event=>{
        const file=event.target.files?.[0];if(!file || state.busy)return;
        if(file.size>4_000_000){state.error='Snapshot zu groß (max. 4 MB).';repaint();return;}
        state={result:null,error:'',busy:true,digest:''};input=null;sourceReceipt=null;repaint();
        try {const evaluated=await evaluateArenaImport(await file.text());input=evaluated.input;sourceReceipt=evaluated.sourceReceipt;state.result=evaluated.result;state.digest=evaluated.digest;}
        catch(error){state.error=String(error?.message || error).slice(0,220);}
        finally {state.busy=false;repaint();}
      });
      root.querySelector('[data-arena-export]')?.addEventListener('click',()=>{
        if(!input || !state.result)return;
        const blob=new Blob([JSON.stringify({ruleset:ARENA_RULESET,inputSha256:state.digest,input,result:metricSummary(state.result),resultScope:'METRIC_SUMMARY_RECOMPUTABLE_FROM_RETAINED_INPUT',receipt:sourceReceipt,receiptStatus:'UNVERIFIED_ORIGINAL_SOURCE_RECEIPT_LOCAL_REPLAY'})],{type:'application/json'});
        const url=URL.createObjectURL(blob), link=document.createElement('a');link.href=url;link.download='meridian-paper-arena-diagnostic.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),0);
      });
    }
  };
}
