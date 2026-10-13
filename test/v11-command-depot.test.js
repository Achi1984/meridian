import test from 'node:test';
import assert from 'node:assert/strict';
import {createDepotReadView} from '../v11/depot-read-view.js';
class Node {
  constructor(document,tag){this.ownerDocument=document;this.tagName=tag;this.children=[];this.dataset={};this.attrs={};this.listeners=new Map();this.text='';}
  set textContent(value){this.text=String(value);this.children=[];}
  get textContent(){return this.text+this.children.map(x=>x.textContent).join('');}
  set innerHTML(_){throw new Error('HTML rendering forbidden');}
  append(...nodes){this.children.push(...nodes);}
  replaceChildren(...nodes){this.text='';this.children=nodes;}
  contains(node){return this===node||this.children.some(child=>child.contains(node));}
  setAttribute(key,value){this.attrs[key]=String(value);}
  getAttribute(key){return this.attrs[key]??null;}
  addEventListener(type,fn){if(!this.listeners.has(type))this.listeners.set(type,new Set());this.listeners.get(type).add(fn);}
  removeEventListener(type,fn){this.listeners.get(type)?.delete(fn);}
  click(){if(!this.disabled)for(const fn of this.listeners.get('click')||[])fn();}
}

test('Command shares validated value, stored fallback labels and every clearing state',()=>{
 const d={createElement:tag=>new Node(d,tag)},root=d.createElement('div');
 const fields=new Map(['.portfolio-value','.state-label','.portfolio-description','.caption','[data-command-depot-status]'].map(s=>[s,d.createElement('span')]));
 const command={dataset:{},querySelector:s=>fields.get(s)};let publish;
 const view=createDepotReadView(root,{commandRoot:command,getToken:()=>null,createClient:o=>{publish=o.onChange;return {refresh(){},lock(){},revalidate(){},dispose(){}};}});
 const state={status:'fresh',model:{status:'FRESH_SNAPSHOT',readOnly:true,executionAllowed:false,totalUsd:0,spotUsd:0,tradingUsd:0,snapshotAt:'2026-10-13T21:00:00Z',sourceAt:'2026-10-13T21:00:00Z',source:'SERVER_PORTFOLIO_CURRENT'}};
 publish(state);assert.match(fields.get('.portfolio-value').textContent,/0,00/);assert.match(fields.get('.portfolio-description').textContent,/Serverseitige/);
 publish({...state,model:{...state.model,source:'STORED'}});assert.match(fields.get('.portfolio-description').textContent,/Gespeicherte/);
 for(const status of ['loading','locked','stale','unavailable']){publish(state);publish({status});assert.equal(fields.get('.portfolio-value').textContent,'—');assert.doesNotMatch(fields.get('.caption').textContent,/21:00/);}
 publish({...state,model:{...state.model,totalUsd:null}});assert.equal(fields.get('.portfolio-value').textContent,'—');
 publish(state);view.dispose();assert.equal(fields.get('.portfolio-value').textContent,'—');publish(state);assert.equal(fields.get('.portfolio-value').textContent,'—');
});
