import {ARENA_RULESET, ARENA_CANDIDATES, ARENA_SYMBOLS, replayStrategyPaperArena} from '../research/strategy-paper-arena.js';

const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number = value => Number.isFinite(value) ? new Intl.NumberFormat('de-DE',{maximumFractionDigits:2}).format(value) : '—';
const tone = value => !Number.isFinite(value) || value === 0 ? 'muted' : value < 0 ? 'danger' : 'safe';
const names = {'H1-B':'Trend + Cash','H1-E':'Trend mit Kostenpuffer','H7-B':'Defensive Spot-Auswahl','H7-R':'Defensive Auswahl mit Rangpuffer',H9:'Basis datierter Futures'};
export function canonicalArenaInput(value) {
  if(value===null || typeof value!=='object') return JSON.stringify(value);
  if(Array.isArray(value)) return '['+value.map(canonicalArenaInput).join(',')+']';
  return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonicalArenaInput(value[key])).join(',')+'}';
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

export function arenaHtml({result=null, error='', busy=false, digest=''}={}) {
  const rows = result?.candidates || ARENA_CANDIDATES.map(id => ({id}));
  const cards = rows.map(row => {
    const m=row.baseline, stress=row.stress, blocked=row.id==='H9';
    return `<article class="paper-model-card arena-model"><div class="paper-model-head"><div><span>${escape(row.id)} · ${escape(names[row.id] || row.id)}</span><b>${blocked?'DATEN FEHLEN':m?'HISTORISCHE DIAGNOSE':'NOCH NICHT AUSGEWERTET'}</b></div><strong class="tone-${tone(m?.netPnl)}">${m?number(m.netPnl)+' '+escape(m.currency):'—'}</strong></div>${blocked?'<p>Ausführbare Kurse beider Legs, Abrechnung, Finanzierung und Margin-Verlauf fehlen. Keine simulierten Trades.</p>':`<div class="paper-model-grid"><span>NETTO <b class="tone-${tone(m?.netReturnPct)}">${m?number(m.netReturnPct)+' %':'—'}</b></span><span>MAX. DD · TAGESSCHLUSS <b>${m?number(m.maxDrawdownPct)+' %':'—'}</b></span><span>KOSTEN <b>${m?number(m.costs)+' '+escape(m.currency):'—'}</b></span><span>VERKAUFSTEILE <b>${m?number(m.closedTrades):'—'}</b></span><span>PF <b>${number(m?.profitFactor)}</b></span><span>KOSTENSTRESS · NETTO <b class="tone-${tone(stress?.netReturnPct)}">${stress?number(stress.netReturnPct)+' %':'—'}</b></span></div>`}<small>${m?'10.000 '+escape(m.currency)+' je getrenntem Modell · 1× Spot · keine EUR-Umrechnung':'Keine Performance behauptet.'}</small></article>`;
  }).join('');
  const controls=result?`<p class="arena-controls">Vergleich im selben Zeitraum: gleichgewichtetes Buy &amp; Hold <b class="tone-${tone(result.controls?.buyAndHold?.baseline?.netReturnPct)}">${number(result.controls?.buyAndHold?.baseline?.netReturnPct)} %</b> · Cash ${number(result.controls?.cash?.baseline?.netReturnPct)} %. Kein risikogleicher Benchmark.</p>`:'';
  return `<section class="strategy-arena"><div class="section-title"><h2>STRATEGIE-ARENA</h2><small>H1 · H7 · H9</small></div><p>Getrennte Paper-Simulationen. Historische Ergebnisse sind kein unabhängiger Nachweis und kein laufender Paper-Bot. Keine automatische Siegerwahl.</p><div class="arena-toolbar"><label class="arena-import">Daten-Snapshot importieren<input data-arena-input type="file" accept="application/json,.json" ${busy?'disabled':''}></label><button data-arena-stored type="button" ${busy?'disabled':''}>Gespeicherte Marktdiagnose laden</button><button data-arena-export type="button" ${result&&!busy?'':'disabled'}>Ergebnis + Quelle exportieren</button></div>${busy?'<p role="status">Snapshot prüfen und berechnen …</p>':''}${error?`<p role="alert" class="tone-danger">${escape(error)}</p>`:''}<p class="arena-evidence">${result?.sourceKind==='SYNTHETIC'?'SYNTHETISCHE TESTDATEN · KEINE MARKTEVIDENZ':result?'RETROSPEKTIVE DIAGNOSE · FORWARD-NACHWEIS OFFEN':'Noch keine Marktdaten oder Paper-Ergebnisse importiert.'}</p>${result?`<p>Zeitraum: ${escape(new Date(result.window.firstExecution).toISOString().slice(0,10))} bis ${escape(new Date(result.window.end).toISOString().slice(0,10))} · ${number(result.window.bars)} Tage. ${result.model.baselineCostBps}/${result.model.stressCostBps} Basispunkte je Kauf/Verkauf sind Modellannahmen.</p>`:''}<div class="paper-model-stack">${cards}</div>${controls}<details><summary>Was ist belegt – was fehlt?</summary><p>Regeln: ${escape(ARENA_RULESET)}. Kosten, Slippage, Universum und historische Datenverfügbarkeit sind noch nicht unabhängig bestätigt. Kein zukünftiges Ergebnis ist nachgewiesen.</p><p>Diese Portfoliomodelle haben keinen festen Stop/TP. CRV-Kompatibilität ist ungeklärt; keine Freigabe für echte oder serverseitige Paper-Orders. Die Modelle können eingesetztes Spot-Kapital verlieren. Drawdown wird an Tagesschlüssen gemessen. PF ohne realisierte Verluste bleibt undefiniert; Verkaufsteile sind keine unabhängigen Trades.</p><p>Offene Positionen sind markiert, sofern keine ausdrücklich gekennzeichnete diagnostische Endliquidation gewählt wurde. Historische Daten sind kein frischer Holdout. Für die laufende Beobachtung fehlen noch ein geprüfter Collector, unveränderliche Zeitstempel und ein vorab festgelegtes Beobachtungsfenster.</p>${digest?`<p class="arena-digest">SHA-256 des importierten Inputs: ${escape(digest)}. Integritätswert, kein Echtheitsnachweis.</p>`:''}</details></section>`;
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
  let state={result:null,error:'',busy:false,digest:''}, input=null, sourceReceipt=null;
  return {
    html:()=>arenaHtml(state),
    bind(root){
      const repaint=()=>{const host=root.querySelector('[data-strategy-arena]');if(host){host.innerHTML=arenaHtml(state);this.bind(root);}};
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
