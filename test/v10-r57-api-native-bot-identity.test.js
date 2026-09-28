import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const bot=fs.readFileSync(new URL('../pionex-bot-auto-sync.js',import.meta.url),'utf8');
const v9=fs.readFileSync(new URL('../v9/v9.js',import.meta.url),'utf8');
const v10=fs.readFileSync(new URL('../v10/v10.js',import.meta.url),'utf8');
const root=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const v9html=fs.readFileSync(new URL('../v9/index.html',import.meta.url),'utf8');
const release=JSON.parse(fs.readFileSync(new URL('../version.json',import.meta.url),'utf8'));

function runtime(){
  const a=v9.indexOf('function pick('),b=v9.indexOf('function ema(',a);
  assert.ok(a>=0&&b>a);
  const source=v9.slice(a,b),state={unmatchedLive:[],matchAmbiguous:0,matchDiagnostics:null};
  const num=v=>{if(v==null||v==='')return null;const x=Number(v);return Number.isFinite(x)?Number(v):null};
  return{state,...new Function('FALLBACK','state','num',source+';return {normalizeLive,apiNativeIdentityEligible,markApiNativeIdentity};')([],state,num)};
}

test('r57 API-native identity requires complete Wallet detail and unique IDs',()=>{
  const rt=runtime();
  const live=[rt.normalizeLive({id:'a',symbol:'BTC',side:'LONG'}),rt.normalizeLive({id:'b',symbol:'ETH',side:'LONG'})];
  const feed={detailsComplete:true,supportedRows:2,normalizedRows:2};
  assert.equal(rt.apiNativeIdentityEligible(feed,{kind:'WALLET_DETAIL'},live),true);
  assert.equal(rt.apiNativeIdentityEligible({...feed,detailsComplete:false},{kind:'WALLET_DETAIL'},live),false);
  assert.equal(rt.apiNativeIdentityEligible(feed,{kind:'BOT_API'},live),false);
  assert.equal(rt.apiNativeIdentityEligible(feed,{kind:'WALLET_DETAIL'},[live[0],{...live[1],id:'a'}]),false);
  assert.equal(rt.apiNativeIdentityEligible({...feed,supportedRows:3},{kind:'WALLET_DETAIL'},live),false);
});

test('r57 API-native identity marks identity only and keeps data availability explicit',()=>{
  const rt=runtime();
  const [row]=rt.markApiNativeIdentity([rt.normalizeLive({
    id:'bot-1',symbol:'BTC',side:'LONG',leverage:5,liquidationPrice:53000,positionOpenPrice:83000,pnlUsd:null,investmentUsd:null
  })]);
  assert.equal(row._liveMatched,true);
  assert.equal(row._source,'LIVE_API_IDENTITY');
  assert.equal(row._matchEvidence,'API_IDENTITY');
  assert.equal(row._liveLiq,true);
  assert.equal(row._liveBe,true);
  assert.equal(row._livePnl,false);
  assert.equal(row._liveInvestUsd,false);
});

test('r57 API-native identity survives r58 asset-quoted inverse Coin-M normalization',()=>{
  assert.match(bot,/function directEconomicSide\(order,d\)/);
  assert.match(bot,/function assetPrice\(order,v\)/);
  assert.match(bot,/liquidationPrice/);
  assert.match(bot,/positionOpenPrice/);
  assert.match(bot,/source:'economic_inverse_asset'/);
  assert.match(bot,/declaredSide/);
  assert.match(bot,/assetDeclaredSide/);
});

test('r57 UI distinguishes API-native identity from legacy reference match',()=>{
  assert.match(v10,/API IDENTITY/);
  assert.match(v10,/IDENTITY MODE/);
  assert.match(v10,/API NATIVE/);
  assert.match(v10,/Asset Watch bleibt historische Referenz/);
});

test('r57 keeps decision readiness fail-closed beyond identity',()=>{
  const next=v10.slice(v10.indexOf('function nextAction(){'),v10.indexOf('function syncHealth(){'));
  assert.match(next,/if\(!g\.coverageComplete\)/);
  const sync=v10.slice(v10.indexOf('function syncHealth(){'),v10.indexOf('function marketReadiness'));
  assert.match(sync,/decisionReady<matched/);
  assert.match(v9,/function decisionReadyBot\(b\).*livePnlAvailable/s);
  assert.match(v9,/function exposureIntegrity/);
  assert.equal(release.terminalExecutionImpact,false);
});

test('successor release identity remains canonical after r57',()=>{
  assert.match(release.terminalBuild,/^10\.0-r\d+$/);
  const rev=release.terminalBuild.split('-').at(-1);
  assert.ok(root.includes(release.terminalBuild+'-production'));
  assert.ok(root.includes('./v10/?build='+rev));
  assert.ok(v10.includes("const BUILD='"+release.terminalBuild+"'"));
  assert.ok(v9.includes("qs.set('build','"+rev+"')"));
  assert.ok(v9html.includes("p.set('build','"+rev+"')"));
});
