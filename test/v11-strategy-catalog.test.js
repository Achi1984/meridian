import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {B17_CANDIDATE,buildStrategyCatalog,FAMILY_IDS,renderStrategyCatalog} from '../v11/strategy-catalog.js';
import {ARENA_CANDIDATES,ARENA_RULESET,ARENA_SYMBOLS} from '../research/strategy-paper-arena.js';
import {arenaHtml,createStrategyArenaView,describeArenaProvenance,evaluateArenaImport} from '../v11/strategy-arena.js';
import {webcrypto} from 'node:crypto';

const campaign=JSON.parse(readFileSync(new URL('../docs/strategy-lab/campaign-20261013.json',import.meta.url),'utf8'));

class Element {
  constructor(document,tag){this.ownerDocument=document;this.tagName=tag;this.children=[];this.attrs={};this.dataset={};this.text='';}
  set textContent(value){this.text=String(value);this.children=[];}
  get textContent(){return this.text+this.children.map(child=>child.textContent).join('');}
  set innerHTML(_){throw new Error('HTML rendering is forbidden for the strategy catalog');}
  append(...children){this.children.push(...children);}
  replaceChildren(...children){this.text='';this.children=children;}
  setAttribute(key,value){this.attrs[key]=String(value);}
}

function syntheticInput(){
  const start=Date.UTC(2025,0,1);
  const data=Object.fromEntries(ARENA_SYMBOLS.map(symbol=>[symbol,Array.from({length:210},(_,index)=>({
    openTime:start+index*86400000,closeTime:start+(index+1)*86400000-1,
    open:100+index,close:100+index+.5,high:101+index,low:99+index
  }))]));
  return {data,asOf:start+210*86400000,sourceKind:'SYNTHETIC',liquidateAtEnd:true};
}

test('campaign adapter exposes exactly the twelve source families and the separate B1-7 assumptions',()=>{
  const model=buildStrategyCatalog(campaign);
  assert.equal(model.status,'PRESENT_UNVERIFIED');
  assert.deepEqual(model.families.map(family=>family.id),FAMILY_IDS);
  for(const family of model.families){
    const source=campaign.families.find(row=>row.id===family.id);
    assert.equal(family.explanation,source.hypothesis);
    assert.equal(family.sourceStatus,source.status);
    assert.equal(family.validationStatus,source.validationStatus);
    assert.equal(family.cost,'Nicht festgelegt · keine verifizierte Kostenbasis.');
    assert.equal(family.independentStage,'NICHT BELEGT');
    assert.equal(family.paperStage,'KEIN LAUFENDER PAPER-BELEG');
    assert.equal(family.liveStage,'NICHT FREIGEGEBEN');
  }
  assert.deepEqual(model.families.find(family=>family.id==='H1').modelIds,['H1-B','H1-E']);
  assert.deepEqual(model.families.find(family=>family.id==='H7').modelIds,['H7-B','H7-R']);
  assert.equal(model.families.find(family=>family.id==='H9').diagnostic,'BLOCKED_DATA');
  assert.deepEqual(B17_CANDIDATE,{id:'B1-7',stage:'IN ENTWICKLUNG',assets:7,plannedPaths:44,
    baselineCostBps:15,stressCostBps:30,horizon:'R3: Annahmen für den Stresstest: 15 bp Basis / 30 bp Stress / +1 Tag.',
    evidence:'Keine Ergebnisse; ausschließlich Entwicklungskandidat.',
    blocker:'D1-Manifest nicht eingefroren; D2, Paper und Live benötigen getrennte Freigaben.',
    source:'M11-Arbeitsauftrag B12 · kein Arena-Ergebnis'});
});

test('empty, malformed and incomplete campaign sources remain unknown without invented families',()=>{
  for(const source of [null,{},[],{...campaign,families:[]},
    {...campaign,families:campaign.families.slice(1)},
    {...campaign,families:[...campaign.families,campaign.families[0]]}]){
    const result=buildStrategyCatalog(source);
    assert.equal(result.status,'UNKNOWN');
    assert.deepEqual(result.families,[]);
    assert.match(result.reason,/Register|Quellfamilien|Format|Einträge/);
  }
});

test('catalog rendering uses text nodes and exposes rules, blockers, stage progression and scanner subsection',()=>{
  const document={createElement:tag=>new Element(document,tag)};
  const root=new Element(document,'div');
  const result=renderStrategyCatalog(root,campaign,document);
  assert.equal(result.families.length,12);
  assert.equal(root.children.filter(child=>child.dataset.strategyId?.startsWith('H')).length,12);
  assert.match(root.textContent,/Hypothese/);
  assert.match(root.textContent,/Historischer Test/);
  assert.match(root.textContent,/Prospektives Paper/);
  assert.match(root.textContent,/Live-Bereitschaft/);
  assert.match(root.textContent,/B1-7/);
  assert.match(root.textContent,/Quellcode unabhängig geprüft/);
  assert.match(root.textContent,/D1 technisch geprüft/);
  assert.match(root.textContent,/NOT_FROZEN/);
  assert.match(root.textContent,/2026-10-19/);
  assert.match(root.textContent,/finale Abnahme und Integration zum Belegstand ausstehend/);
  for (const label of ['D2 / Strategieausführung gesperrt', 'Paper-Betrieb gesperrt', 'Live-Betrieb gesperrt']) {
    assert.ok(root.textContent.includes(label));
  }
  assert.match(root.textContent,/448\/955/);
  assert.match(root.textContent,/Scanner · geplanter Unterbereich/);
  assert.equal(root.children.some(child=>child.id==='strategy-scanner'),true);
  const candidate = root.children.find(child=>child.dataset.strategyId==='B1-7');
  const evidenceDetails = candidate.children.find(child=>child.tagName==='details');
  assert.equal(evidenceDetails.className,'arena-evidence-details');
  const receipts = evidenceDetails.children.filter(child=>child.textContent.includes('https://github.com/'));
  assert.equal(receipts.length,2);
  assert.ok(receipts.every(child=>child.attrs.style==='overflow-wrap:anywhere'));
});

test('Arena shows five models and preserves unknowns, blocked H9 and the legacy coverage failure',()=>{
  const html=arenaHtml();
  for(const id of ['H1-B','H1-E','H7-B','H7-R','H9']) assert.ok(html.includes(id));
  assert.match(html,/Keine Performance behauptet/);
  assert.match(html,/BLOCKED_DATA/);
  assert.match(html,/448\/955/);
  assert.match(html,/unvollständig\/fehlgeschlagen/);
  assert.match(html,/keine automatische Siegerwahl/i);
  assert.match(html,/Keine Marktdaten importiert/);
  assert.doesNotMatch(html,/v10|iframe/i);
});

test('manual import recomputes synthetic fixtures and rejects forged receipt, oversized and malformed input',async()=>{
  const input=syntheticInput();
  const evaluated=await evaluateArenaImport(JSON.stringify({input,result:{ruleset:ARENA_RULESET,candidates:[{id:'H1-B',baseline:{netPnl:1e9}}]}}),webcrypto.subtle);
  assert.ok(evaluated.result.candidates[0].baseline.netPnl<1e9);
  assert.equal(evaluated.result.sourceKind,'SYNTHETIC');
  assert.match(arenaHtml({result:evaluated.result,digest:evaluated.digest}),/SYNTHETISCHE TESTDATEN · KEINE MARKTEVIDENZ/);
  await assert.rejects(evaluateArenaImport(JSON.stringify({input,receipt:{inputSha256:'0'.repeat(64)}}),webcrypto.subtle),/Quellbeleg/);
  await assert.rejects(evaluateArenaImport('x'.repeat(4_000_001),webcrypto.subtle),/Snapshot zu groß/);
  await assert.rejects(evaluateArenaImport('{',webcrypto.subtle));
  await assert.rejects(evaluateArenaImport(JSON.stringify({input,ruleset:'OTHER'}),webcrypto.subtle),/Regelversion/);
});

test('provenance unknowns and caller-controlled strings are not trusted as HTML',()=>{
  assert.equal(describeArenaProvenance(null).status,'UNKNOWN');
  assert.equal(describeArenaProvenance({schemaVersion:'bad',ruleset:'bad',summary:{candidates:[]}}).status,'INVALID');
  const html=arenaHtml({error:'<SCRIPT>alert(1)</SCRIPT>'});
  assert.doesNotMatch(html,/<script\b/i);
  assert.match(html,/&lt;SCRIPT&gt;/);
});

function historicalManifest(){
  return {schemaVersion:'MERIDIAN_ARENA_CHUNKED_INPUT_V1',ruleset:ARENA_RULESET,
    summary:{candidates:ARENA_CANDIDATES.map(id=>({id}))},
    receipt:{collectorProvider:'ARCHIVE_ONLY',inputSha256:'a'.repeat(64)},chunks:[]};
}
function deferred(){let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};}
function arenaRoot(){
  const listeners=new Map();
  return {innerHTML:'',listeners,paints:0,
    contains:()=>true,addEventListener:(name,fn)=>listeners.set(name,fn),
    removeEventListener:name=>listeners.delete(name),replaceChildren(){this.innerHTML='';},
    click(action){const button={hasAttribute:key=>key===action};return listeners.get('click')({target:{closest:()=>button}});},
    importFile(text){const input={files:[{size:text.length,text:async()=>text}]};return listeners.get('change')({target:{closest:selector=>selector==='[data-arena-input]'?input:null}});}
  };
}
function assertMetadataSeparated(html){
  const cards=[...html.matchAll(/<article class="arena-model-card">([\s\S]*?)<\/article>/g)];
  assert.equal(cards.length,5);
  for(const card of cards)assert.doesNotMatch(card[1],/ARCHIVE_ONLY|inputSha256|Historische Herkunft/);
  assert.match(html,/Separate historische Belegmetadaten/);
  assert.match(html,/nicht den importierten Ergebnissen zugeordnet/);
}

test('historical metadata requires the complete model set and H9 progression remains blocked',()=>{
  const manifest=historicalManifest();
  assert.equal(describeArenaProvenance(manifest).status,'PRESENT_UNVERIFIED');
  for(const candidates of [[],manifest.summary.candidates.slice(1),[...manifest.summary.candidates,{id:'H9'}]]){
    assert.equal(describeArenaProvenance({...manifest,summary:{candidates}}).status,'INVALID');
  }
  assert.equal(buildStrategyCatalog(campaign).families.find(x=>x.id==='H9').historicalStage,'BLOCKED_DATA');
});

test('historical metadata remains separate for different synthetic imports and either async completion order',async()=>{
  for(const metadataFirst of [true,false]){
    const gate=deferred(); const root=arenaRoot();
    const view=createStrategyArenaView(root,{fetchImpl:()=>gate.promise});
    const loading=root.click('data-arena-provenance');
    const complete=()=>gate.resolve({ok:true,text:async()=>JSON.stringify(historicalManifest())});
    if(metadataFirst){complete();await loading;}
    const first=syntheticInput();
    await root.importFile(JSON.stringify(first));
    if(!metadataFirst){complete();await loading;}
    assert.match(root.innerHTML,/SYNTHETISCHE TESTDATEN/);assertMetadataSeparated(root.innerHTML);
    const firstHtml=root.innerHTML;
    const second=syntheticInput();second.data[ARENA_SYMBOLS[0]][0].high+=1;
    await root.importFile(JSON.stringify(second));
    assert.notEqual(root.innerHTML,firstHtml,'distinct input digest is rendered');
    assertMetadataSeparated(root.innerHTML);
    view.dispose();
  }
});

test('disposed arena cannot repaint after late metadata success, failure or pending file import',async()=>{
  for(const failure of [false,true]){
    const gate=deferred(); const root=arenaRoot();
    const view=createStrategyArenaView(root,{fetchImpl:()=>gate.promise});
    const pending=root.click('data-arena-provenance');view.dispose();
    gate.resolve({ok:!failure,text:async()=>JSON.stringify(historicalManifest())});
    await pending;assert.equal(root.innerHTML,'');assert.equal(root.listeners.size,0);
  }
  const gate=deferred();const root=arenaRoot();const view=createStrategyArenaView(root);
  const input={files:[{size:10,text:()=>gate.promise}]};
  const pending=root.listeners.get('change')({target:{closest:selector=>selector==='[data-arena-input]'?input:null}});
  view.dispose();gate.resolve(JSON.stringify(syntheticInput()));await pending;
  assert.equal(root.innerHTML,'');assert.equal(root.listeners.size,0);
});


test('missing research receipts render unknown independently from the valid family register',()=>{
  const document={createElement:tag=>new Element(document,tag)};
  const root=new Element(document,'div');
  const result=renderStrategyCatalog(root,campaign,document,null);
  assert.deepEqual(result.families.map(family=>family.id),FAMILY_IDS);
  assert.equal(result.researchEvidence.source.state,'UNKNOWN');
  assert.equal(result.researchEvidence.d1.state,'UNKNOWN');
  assert.match(root.textContent,/Belegstand: unbekannt/);
  assert.match(root.textContent,/Prüfbeleg fehlt oder ist widersprüchlich/);
  assert.doesNotMatch(root.textContent,/D1 technisch geprüft|Quellcode unabhängig geprüft/);
});
