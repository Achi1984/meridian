import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createAssetWatchAccessDialog} from '../v10/asset-watch-access-dialog.js';
const v9=fs.readFileSync(new URL('../v9/v9.js',import.meta.url),'utf8');
const v10=fs.readFileSync(new URL('../v10/v10.js',import.meta.url),'utf8');
function element(){return{value:'',open:false,events:{},addEventListener(k,f){this.events[k]=f},setAttribute(){},focus(){},showModal(){this.open=true},close(){this.open=false;this.events.close?.()}}}
function dom(){const input=element(),form=element(),cancel=element(),dialog=element();dialog.querySelector=s=>s==='input'?input:s==='form'?form:cancel;return{input,form,cancel,dialog,document:{visibilityState:'visible',createElement:()=>dialog,body:{appendChild(){}}}}}
test('dialog does not submit on opening or typing; clears before explicit submit and on cancel',()=>{
 const d=dom(),calls=[];const ui=createAssetWatchAccessDialog({document:d.document,submit:(...args)=>{assert.equal(d.input.value,'');calls.push(args)}});
 ui.open();d.input.value='synthetic-password';ui.open();assert.equal(d.input.value,'synthetic-password');assert.equal(calls.length,0);
 d.form.events.submit({preventDefault(){},submitter:{value:'rotate'}});
 assert.deepEqual(calls,[['rotate','synthetic-password']]);assert.equal(d.dialog.open,false);
 ui.open();d.input.value='discard';d.cancel.events.click();assert.equal(d.input.value,'');assert.equal(calls.length,1);
 ui.open();d.input.value='escape';d.dialog.events.cancel();assert.equal(d.input.value,'');
});
function transport(fetchImpl,base='https://p01--achi-meridian--ttvk44grdlp7.code.run'){
 const context=vm.createContext({API_BASE:base,token:()=> 'synthetic-saved',AbortController,setTimeout,clearTimeout,fetch:fetchImpl});
 vm.runInContext(v9.slice(v9.indexOf('async function manageAssetWatchShare('),v9.indexOf('const PORTFOLIO_TICKER_CACHE_MS')),context);return context.manageAssetWatchShare;
}
test('one-use access travels in header only; saved access still used without override',async()=>{
 const requests=[];const manage=transport(async(url,options)=>{requests.push({url,options});return{ok:true,json:async()=>({sharePath:'/api/private/asset-watch?share=synthetic'})}});
 await manage('rotate','synthetic-once');await manage('revoke');
 assert.equal(requests[0].options.headers.authorization,'Bearer synthetic-once');
 assert.equal(requests[1].options.headers.authorization,'Bearer synthetic-saved');
 assert.equal(requests[0].options.body,'{"action":"rotate"}');assert.ok(!requests[0].url.includes('synthetic-once'));
 for(const {options}of requests){assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error');assert.equal(options.referrerPolicy,'no-referrer');assert.equal(options.cache,'no-store');}
});
test('invalid action/access and untrusted endpoint fail before fetch',async()=>{
 let calls=0;const fetch=async()=>{calls++;throw new Error('unexpected')};const manage=transport(fetch);
 for(const c of [null,false,{},'', 'https://example.test/?share=secret','x\ny','x'.repeat(4097)])await assert.rejects(manage('rotate',c));
 await assert.rejects(manage('unknown','valid'));await assert.rejects(transport(fetch,'https://example.test')('rotate','valid'));assert.equal(calls,0);
});
for(const hideEvent of ['visibilitychange','pagehide'])test(hideEvent+' clears typed access and aborts/fences late response',async()=>{
 let resolve,requestSignal;const d=dom(),events={},winEvents={};d.document.addEventListener=(k,f)=>events[k]=f;
 const context=vm.createContext({document:d.document,window:{addEventListener:(k,f)=>winEvents[k]=f},createAssetWatchAccessDialog,AbortController,H:()=>({manageAssetWatchShare:(_action,_credential,signal)=>{requestSignal=signal;return new Promise(r=>resolve=r)}}),renderBots(){},esc:String,navigator:{clipboard:{writeText(){throw new Error('no automatic clipboard')}}}});
 vm.runInContext("const assetWatchShareUi={busy:false,shareUrl:null,message:'',tone:'muted'};"+v10.slice(v10.indexOf('let assetWatchShareGeneration='),v10.indexOf('function bindBotOverviewControls'))+';globalThis.ui=assetWatchShareUi',context);
 context.assetWatchShareAction('access');d.input.value='discard-on-hide';
 const pending=context.assetWatchShareAction('rotate','synthetic');
 if(hideEvent==='visibilitychange'){d.document.visibilityState='hidden';events.visibilitychange();}else winEvents.pagehide();
 assert.equal(d.input.value,'');assert.equal(d.dialog.open,false);assert.equal(requestSignal.aborted,true);resolve({shareUrl:'must-not-return'});await pending;
 assert.equal(context.ui.shareUrl,null);assert.equal(context.ui.busy,false);
});
