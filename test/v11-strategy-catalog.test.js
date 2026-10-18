import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {B17_CANDIDATE,buildStrategyCatalog,FAMILY_IDS,renderStrategyCatalog} from '../v11/strategy-catalog.js';
import {ARENA_RULESET,ARENA_SYMBOLS} from '../research/strategy-paper-arena.js';
import {arenaHtml,describeArenaProvenance,evaluateArenaImport} from '../v11/strategy-arena.js';
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
    blocker:'Unabhängige Prüfung, Marktbelege und jede weitere Freigabe fehlen.',
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
  assert.match(root.textContent,/448\/955/);
  assert.match(root.textContent,/Scanner · geplanter Unterbereich/);
  assert.equal(root.children.some(child=>child.id==='strategy-scanner'),true);
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
  const html=arenaHtml({error:'<script>alert(1)</script>'});
  assert.doesNotMatch(html,/<script>/);
  assert.match(html,/&lt;script&gt;/);
});
