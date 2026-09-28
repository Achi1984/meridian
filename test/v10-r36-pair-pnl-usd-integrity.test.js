import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const v9=fs.readFileSync(new URL('../v9/v9.js',import.meta.url),'utf8');
const v10=fs.readFileSync(new URL('../v10/v10.js',import.meta.url),'utf8');
const release=JSON.parse(fs.readFileSync(new URL('../version.json',import.meta.url),'utf8'));

function pnlRuntime({bots=[],unmatched=[],fresh=true,symbol='BTC'}={}){
  const a=v9.indexOf('function pnlIntegrity('),b=v9.indexOf('function token()',a);
  assert.ok(a>=0&&b>a,'PnL integrity source missing');
  const src=v9.slice(a,b);
  const state={bots,unmatchedLive:unmatched};
  const num=v=>v===null||v===undefined||v===''?null:(Number.isFinite(Number(v))?Number(v):null);
  const liveMatched=x=>!!x?._liveMatched;
  const factory=new Function('state','botFeedFresh','liveMatched','num','symbol',
    src+';return {integrity:pnlIntegrity(symbol),values:state.bots.filter(liveMatched).map(botPnlUsd)};');
  return factory(state,()=>fresh,liveMatched,num,symbol);
}

test('r36 pair PnL requires an actually computable USD value on every matched row',()=>{
  const raw={symbol:'BTC',_liveMatched:true,_livePnl:true,pnl:5,profitPct:null,investUsd:null};
  const derived={symbol:'BTC',_liveMatched:true,_livePnl:true,pnl:null,profitPct:10,investUsd:100};
  const pctOnly={symbol:'BTC',_liveMatched:true,_livePnl:true,pnl:null,profitPct:10,investUsd:null};

  const good=pnlRuntime({bots:[raw,derived]});
  assert.equal(good.integrity.complete,true);
  assert.deepEqual(good.values.map(x=>x.value),[5,10]);

  const bad=pnlRuntime({bots:[raw,pctOnly]});
  assert.equal(bad.integrity.missingPnl,1);
  assert.equal(bad.integrity.complete,false);
  assert.equal(bad.values[1].value,null);
});

test('r36 same-asset unmatched rows still fail closed while other assets stay scoped out',()=>{
  const raw={symbol:'BTC',_liveMatched:true,_livePnl:true,pnl:5};
  assert.equal(pnlRuntime({bots:[raw],unmatched:[{symbol:'BTC'}]}).integrity.complete,false);
  assert.equal(pnlRuntime({bots:[raw],unmatched:[{symbol:'ETH'}]}).integrity.complete,true);
  assert.equal(pnlRuntime({bots:[raw],fresh:false}).integrity.complete,false);
});

test('r36 pair card never reduces null USD PnL values into zero',()=>{
  const pair=v10.slice(v10.indexOf('function pairCard'),v10.indexOf('function criticalPair'));
  assert.match(pair,/pnlComplete=\(pnlState\?!!pnlState\.complete:\(fresh&&rows\.length>0\)\)&&pnlVals\.length===rows\.length&&pnlVals\.every\(x=>x!=null\)/);
  assert.match(pair,/pnl=pnlComplete\?pnlVals\.reduce\(\(a,b\)=>a\+b,0\):null/);
  assert.match(pair,/pnlComplete\?'':' · PnL-Summe unvollständig'/);
});

test('r36 keeps decision readiness and Profit Lock thresholds unchanged',()=>{
  assert.match(v9,/function decisionReadyBot\(b\)\{return safetyReadyBot\(b\)&&livePnlAvailable\(b\)&&marketIntelFresh/);
  const plan=v9.slice(v9.indexOf('function profitLockPlan'),v9.indexOf('function topProfitPlan'));
  for(const token of ["pnl>=20","pnl>=12","pnl>=10","pnl>=8","pnl>=3"])assert.ok(plan.includes(token),token);
  assert.match(v9,/hedgePct<15/);
});

test('r36 release identity remains canonical and execution-neutral',()=>{
  assert.match(release.terminalBuild,/^10\.0-r\d+$/);
  assert.ok(Number(release.terminalBuild.split('-r')[1])>=36);
  assert.equal(release.terminalExecutionImpact,false);
  assert.ok(v9.includes("portfolio-data-contract.js?v="+release.terminalBuild));
  assert.ok(v10.includes("const BUILD='"+release.terminalBuild+"'"));
  assert.doesNotThrow(()=>new Function(v10.replace(/^import .*$/gm,'')));
});
