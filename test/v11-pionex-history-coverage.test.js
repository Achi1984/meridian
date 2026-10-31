import test from 'node:test';
import assert from 'node:assert/strict';
import {buildPionexHistoryModel} from '../v11/pionex-history-model.js';
import {createDepotHistoryView} from '../v11/depot-history-view.js';

const now=Date.parse('2026-10-31T18:00:00Z');
const point=(sourceAt,valueUsd=0)=>({sourceAt,timestamp:sourceAt+1000,valueUsd,scope:'PIONEX',
  currency:'USD/USDT',source:'PIONEX_WALLET_READ_API',authorityVersion:'PIONEX_FRESH_V1'});
const payload=(points=[],extra={})=>({version:'PIONEX_HISTORY_V1',source:'POSTGRES_PIONEX_HISTORY',
  scope:'PIONEX',currency:'USD/USDT',generatedAt:new Date(now).toISOString(),points,...extra});

// Minimal DOM with persistent nodes and real view event handlers; no network or credentials.
class Node {
  constructor(tag,document){this.tagName=tag;this.ownerDocument=document;this.children=[];this.dataset={};this.attributes={};this.events={};this.text='';}
  set textContent(value){this.text=value;this.children=[];}
  get textContent(){return this.text+this.children.map(n=>n.textContent).join(' ');}
  append(...nodes){this.children.push(...nodes);}
  replaceChildren(...nodes){this.text='';this.children=nodes;}
  setAttribute(key,value){this.attributes[key]=String(value);}
  addEventListener(event,handler){this.events[event]=handler;}
}
const nodes=(root,tag)=>[...(root.tagName===tag?[root]:[]),...root.children.flatMap(n=>nodes(n,tag))];
function mounted(){
  const document={createElement:tag=>new Node(tag,document),createElementNS:(_ns,tag)=>new Node(tag,document)};
  const root=new Node('section',document);let selected;
  const view=createDepotHistoryView(root,{pionexOnly:true,onRange:range=>{selected=range;}});
  return {root,view,selected:()=>selected};
}
test('coverage flag is explicit, backward compatible and cannot alter genuine values or segments',()=>{
  const points=[point(now-600000,0),point(now-300000,42)];
  const baseline=buildPionexHistoryModel(payload(points),{now});
  assert.equal(baseline.truncated,false);
  const limited=buildPionexHistoryModel(payload(points,{truncated:true}),{now});
  assert.equal(limited.truncated,true);assert.equal(limited.status,'ready');
  assert.deepEqual(limited.points,baseline.points);assert.deepEqual(limited.segments,baseline.segments);
  assert.equal(limited.gaps,false);assert.equal(limited.points[0].totalUsd,0);
  assert.equal(buildPionexHistoryModel(payload(points,{truncated:false}),{now}).truncated,false);
  for(const truncated of ['true','false',1,0,null,{},[]]){
    const invalid=buildPionexHistoryModel(payload(points,{truncated}),{now});
    assert.equal(invalid.status,'unavailable');assert.equal(invalid.truncated,false);assert.deepEqual(invalid.points,[]);
  }
});
test('Pionex limited history is visibly labelled, preserves chart and clears the notice on a complete read',()=>{
  const {root,view,selected}=mounted(),points=[point(now-600000),point(now-300000,42)];
  view.render(buildPionexHistoryModel(payload(points,{truncated:true}),{now}));
  assert.match(root.textContent,/Begrenzter Verlauf/);assert.match(root.textContent,/höchstens 2\.200 der neuesten/);
  assert.match(root.textContent,/Ältere Punkte sind nicht enthalten/);
  assert.equal(nodes(root,'circle').length,2);assert.equal(nodes(root,'polyline').length,1);
  assert.match(root.textContent,/Keine P\/L- oder Renditeberechnung/);
  const buttons=nodes(root,'button');buttons[2].events.click();assert.equal(selected(),'1w');
  view.render(buildPionexHistoryModel(payload(points,{truncated:false}),{now}),'1w');
  assert.doesNotMatch(root.textContent,/Begrenzter Verlauf/);assert.equal(nodes(root,'circle').length,2);
  assert.equal(nodes(root,'button')[2],buttons[2]);assert.equal(buttons[2].attributes['aria-pressed'],'true');
});
test('empty Pionex interval and unavailable data stay distinct and never render a fabricated zero chart',()=>{
  const {root,view}=mounted();
  view.render(buildPionexHistoryModel(payload([]),{now}));
  assert.match(root.textContent,/Noch keine Pionex-Verlaufspunkte im gewählten Zeitraum/);
  assert.doesNotMatch(root.textContent,/nicht verfügbar|0,00|Begrenzter Verlauf/);assert.equal(nodes(root,'svg').length,0);
  view.render(buildPionexHistoryModel(payload([],{truncated:true}),{now}));
  assert.match(root.textContent,/Begrenzter Verlauf/);assert.match(root.textContent,/Noch keine Pionex-Verlaufspunkte/);
  view.render(buildPionexHistoryModel(null,{now}));
  assert.match(root.textContent,/Verlauf nicht verfügbar/);
  assert.doesNotMatch(root.textContent,/Noch keine|Begrenzter Verlauf|0,00/);assert.equal(nodes(root,'svg').length,0);
});

test('rejected records without usable points are unavailable, while a valid empty range remains empty',()=>{
  const {root,view}=mounted();
  for(const raw of [payload([],{excludedPoints:1}),payload([{...point(now-2000),valueUsd:null}]),payload([null]),
    payload([{...point(now-2000),authorityVersion:'UNKNOWN'}])]){
    const model=buildPionexHistoryModel(raw,{now});
    assert.equal(model.status,'unavailable');assert.deepEqual(model.points,[]);view.render(model);
    assert.match(root.textContent,/Verlauf nicht verfügbar/);assert.doesNotMatch(root.textContent,/Noch keine Pionex/);
    assert.equal(nodes(root,'svg').length,0);
  }
  const outside=buildPionexHistoryModel(payload([point(now-7200000)]),{now,range:'1h'});
  assert.equal(outside.status,'empty');view.render(outside,'1h');
  assert.match(root.textContent,/Noch keine Pionex-Verlaufspunkte im gewählten Zeitraum/);
  const partial=buildPionexHistoryModel(payload([point(now-2000)],{excludedPoints:1,truncated:true}),{now});
  assert.equal(partial.status,'ready');assert.equal(partial.gaps,true);view.render(partial);
  assert.match(root.textContent,/höchstens 2\.200/);assert.equal(nodes(root,'circle').length,1);
});
