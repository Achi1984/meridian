import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {getPaperReadiness} from '../v11/paper-readiness.js';
import {renderPaperReadiness} from '../v11/paper-readiness-view.js';

class Element{
  constructor(document,tag){this.ownerDocument=document;this.tagName=tag;this.children=[];this.attrs={};this.text='';}
  set textContent(value){this.text=String(value);this.children=[];}
  get textContent(){return this.text+this.children.map(child=>child.textContent).join('');}
  set innerHTML(_){throw Error('Readiness must render text nodes');}
  append(...nodes){this.children.push(...nodes);}
  replaceChildren(...nodes){this.text='';this.children=nodes;}
  setAttribute(key,value){this.attrs[key]=String(value);}
}
function harness(){
  const document={createElement:tag=>new Element(document,tag)};
  const root=new Element(document,'section');
  return {root,document};
}
const visit=node=>[node,...node.children.flatMap(visit)];

test('actual readiness projection separates source preparation, unmet gates and parameter groups',()=>{
  const {root}=harness();
  const model=getPaperReadiness();
  const original=JSON.stringify(model);
  assert.deepEqual(renderPaperReadiness(root,model),{status:'NOT_READY'});
  assert.equal(JSON.stringify(model),original);
  for(const label of ['Technik vorhanden','Noch zu bauen / prüfen','Betriebsparameter festlegen','Nächster Schritt','kein laufender Paper-Betrieb'])assert.ok(root.textContent.includes(label));
  for(const row of [...model.prepared,...model.gates,...model.choices]){
    assert.ok(root.textContent.includes(row.label));
    assert.ok(root.textContent.includes(row.detail));
  }
  assert.equal(model.choices.length,12);
  assert.match(root.textContent,/12 offene Gruppen/);
  const nodes=visit(root);
  assert.equal(nodes.some(node=>['button','input','select','form','a'].includes(node.tagName)),false,
    'source readiness must not offer activation, parameter submission or untrusted navigation');
  assert.equal(root.attrs['aria-labelledby'],nodes.find(node=>node.tagName==='h2').id);
  assert.ok(root.attrs.style.includes('overflow-wrap:anywhere'));
});

test('unknown and authority-bearing projections cannot become ready or show stale source rows',()=>{
  const {root}=harness();
  const valid=getPaperReadiness();
  for(const bad of [null,{},[],{...valid,status:'READY'},{...valid,canStart:true},
    {...valid,paperAuthorized:true},{...valid,liveAuthorized:true},
    {...valid,scope:'PAPER_RUNTIME'},{...valid,gates:[null]}]){
    renderPaperReadiness(root,valid);
    assert.deepEqual(renderPaperReadiness(root,bad),{status:'UNKNOWN'});
    assert.match(root.textContent,/Vorbereitungsstand nicht verfügbar/);
    assert.doesNotMatch(root.textContent,/Technik vorhanden/);
    assert.equal(visit(root).some(node=>node.tagName==='button'),false);
  }
});

test('untrusted labels, details and source references remain inert text; implementation fields are hidden',()=>{
  const {root}=harness();
  const model=structuredClone(getPaperReadiness());
  const injection='<img src=x onerror=alert(1)>';
  model.prepared[0]={...model.prepared[0],label:injection,detail:injection,evidencePath:'javascript:alert(1)'};
  model.choices[0].fields=['internalFieldNotForProductFlow'];
  renderPaperReadiness(root,model);
  assert.ok(root.textContent.includes(injection));
  assert.ok(root.textContent.includes('javascript:alert(1)'));
  assert.doesNotMatch(root.textContent,/internalFieldNotForProductFlow/);
  assert.equal(visit(root).some(node=>['img','a','script'].includes(node.tagName)),false);
});

test('readiness mounts once in the existing workspace without a new fetch or activation handler',()=>{
  const source=readFileSync(new URL('../v11/strategy-workspace-bootstrap.js',import.meta.url),'utf8');
  assert.equal((source.match(/renderPaperReadiness\(readinessRoot\)/g)||[]).length,1);
  assert.match(source,/insertBefore\(readinessRoot,catalogRoot\)/);
  const view=readFileSync(new URL('../v11/paper-readiness-view.js',import.meta.url),'utf8');
  assert.doesNotMatch(view,/\bfetch\s*\(|\bsetInterval\s*\(|localStorage|sessionStorage|\.innerHTML\s*=/);
});
