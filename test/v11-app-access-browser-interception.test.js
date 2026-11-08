import test from 'node:test';
import assert from 'node:assert/strict';
import {unlockAppThroughGate,VERIFY_ENDPOINT} from './helpers/v11-app-access-browser.mjs';

const PAPER='https://fixture.example/private/paper';
const HOST='https://fixture.example/private/host8h';
function transport(){
  const listeners=new Set(),commands=[];let unlocked=false,patterns=[],paperReads=0;
  const event=(url,id)=>({requestId:id,request:{url,method:'GET',headers:{authorization:'Bearer synthetic-browser-gate-password'}}});
  const call=async(method,args={})=>{
    commands.push({method,args});
    if(method==='Fetch.enable')patterns=args.patterns.map(p=>p.urlPattern);
    if(method==='Fetch.disable')patterns=[];
    if(method==='Fetch.fulfillRequest'&&args.requestId==='verify')unlocked=true;
    if(method==='Runtime.evaluate'){
      if(args.expression.includes('form:!!'))return {result:{value:{hidden:true,gateHidden:false,form:true}}};
      if(args.expression.includes('requestSubmit()')){
        assert.ok(patterns.includes(VERIFY_ENDPOINT));
        for(const fn of listeners)fn(event(VERIFY_ENDPOINT,'verify'));
        await new Promise(resolve=>setImmediate(resolve));
        if(patterns.includes(HOST)){
          for(const fn of listeners)fn(event(HOST,'host'));
          await new Promise(resolve=>setImmediate(resolve));
        }
        return {result:{value:true}};
      }
      if(args.expression.includes('status:'))return {result:{value:{hidden:!unlocked,status:'Zugang geprüft'}}};
      return {result:{value:''}};
    }
    return {};
  };
  call.onEvent=(_name,fn)=>{listeners.add(fn);return()=>listeners.delete(fn);};
  return {call,commands,listeners,patterns:()=>patterns,paperReads:()=>paperReads,
    ownReports(){return call.onEvent('Fetch.requestPaused',event=>{
      if([PAPER,HOST].includes(event.request.url)){paperReads++;void call('Fetch.fulfillRequest',{requestId:event.requestId,responseCode:503});}
    });}};
}
test('gate unlock composes exact report interception and restores it without disabling Fetch',async()=>{
  const h=transport(),off=h.ownReports();
  await unlockAppThroughGate(h.call,{additionalFetchUrls:[PAPER,HOST]});
  assert.deepEqual(h.commands.filter(c=>c.method==='Fetch.enable').map(c=>c.args.patterns.map(p=>p.urlPattern)),
    [[VERIFY_ENDPOINT,PAPER,HOST],[PAPER,HOST]]);
  assert.equal(h.commands.some(c=>c.method==='Fetch.disable'),false);
  assert.equal(h.paperReads(),1);assert.equal(h.listeners.size,1,'only the report owner remains');
  assert.deepEqual(h.patterns(),[PAPER,HOST]);off();
});
test('standalone gate unlock retains exact verification-only lifecycle',async()=>{
  const h=transport();await unlockAppThroughGate(h.call);
  assert.deepEqual(h.commands.filter(c=>c.method==='Fetch.enable').map(c=>c.args.patterns.map(p=>p.urlPattern)),[[VERIFY_ENDPOINT]]);
  assert.equal(h.commands.filter(c=>c.method==='Fetch.disable').length,1);
  assert.equal(h.listeners.size,0);
});
test('composed gate interception refuses wildcard ownership',async()=>{
  const h=transport();await assert.rejects(unlockAppThroughGate(h.call,{additionalFetchUrls:[PAPER+'*']}));
  assert.equal(h.commands.length,0);
});
