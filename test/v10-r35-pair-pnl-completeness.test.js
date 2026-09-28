import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const v9=fs.readFileSync(new URL('../v9/v9.js',import.meta.url),'utf8');
const v10=fs.readFileSync(new URL('../v10/v10.js',import.meta.url),'utf8');
const release=JSON.parse(fs.readFileSync(new URL('../version.json',import.meta.url),'utf8'));

function pnlRuntime({bots=[],unmatched=[],fresh=true,symbol=null}={}){
  const a=v9.indexOf('function pnlIntegrity('),b=v9.indexOf('function token()',a);
  assert.ok(a>=0&&b>a,'pnlIntegrity source missing');
  const src=v9.slice(a,b);
  const state={bots,unmatchedLive:unmatched};
  const num=v=>v===null||v===undefined||v===''?null:(Number.isFinite(Number(v))?Number(v):null);
  const liveMatched=x=>!!x?._liveMatched;
  const factory=new Function('state','botFeedFresh','liveMatched','num','symbol',
    src+';return pnlIntegrity(symbol);');
  return factory(state,()=>fresh,liveMatched,num,symbol);
}

test('r35 pair PnL completeness fails closed on unmatched or missing-PnL rows',()=>{
  const bots=[
    {symbol:'BTC',_liveMatched:true,_livePnl:true,pnl:5},
    {symbol:'BTC',_liveMatched:true,_livePnl:true,pnl:-2}
  ];
  assert.deepEqual(pnlRuntime({bots}),{fresh:true,matched:2,unmatched:0,missingPnl:0,unknown:0,complete:true});
  assert.deepEqual(pnlRuntime({bots,unmatched:[{symbol:'BTC'}]}),{fresh:true,matched:2,unmatched:1,missingPnl:0,unknown:1,complete:false});
  const missing=[bots[0],{symbol:'BTC',_liveMatched:true,_livePnl:false,pnl:null}];
  assert.deepEqual(pnlRuntime({bots:missing}),{fresh:true,matched:2,unmatched:0,missingPnl:1,unknown:1,complete:false});
  assert.equal(pnlRuntime({bots,fresh:false}).complete,false);
});

test('r35 pair PnL scope ignores unmatched rows from other assets',()=>{
  const bots=[{symbol:'BTC',_liveMatched:true,_livePnl:true,pnl:5}];
  assert.equal(pnlRuntime({bots,unmatched:[{symbol:'ETH'}],symbol:'BTC'}).complete,true);
  assert.equal(pnlRuntime({bots,unmatched:[{symbol:'BTC'}],symbol:'BTC'}).complete,false);
});

test('r35 active pair card withholds aggregate PnL unless shared PnL integrity is complete',()=>{
  assert.match(v9,/helpers:\{[^}]*pnlIntegrity/s);
  const pair=v10.slice(v10.indexOf('function pairCard'),v10.indexOf('function criticalPair'));
  assert.ok(pair.includes('pnlState=h.pnlIntegrity?.(symbol)'));
  assert.match(pair,/pnlComplete=.*pnlState\?!!pnlState\.complete/);
  assert.ok(pair.includes('pnl=pnlComplete?pnlVals.reduce'));
  assert.ok(pair.includes("pnlComplete?'':' · PnL-Summe unvollständig'"));
  assert.ok(pair.includes('PAIR PNL USD'));
});

test('r35 individual PnL and decision rules remain unchanged',()=>{
  const plan=v9.slice(v9.indexOf('function profitLockPlan'),v9.indexOf('function topProfitPlan'));
  for(const token of ["pnl>=20","pnl>=12","pnl>=10","pnl>=8","pnl>=3"])assert.ok(plan.includes(token),token);
  assert.ok(v9.includes('function decisionReadyBot(b){return safetyReadyBot(b)&&livePnlAvailable(b)&&marketIntelFresh'));
});

test('r35 release identity remains canonical and execution-neutral',()=>{
  assert.match(release.terminalBuild,/^10\.0-r\d+$/);
  assert.ok(Number(release.terminalBuild.split('-r')[1])>=35);
  assert.equal(release.terminalExecutionImpact,false);
  assert.ok(v9.includes("portfolio-data-contract.js?v="+release.terminalBuild));
  assert.ok(v10.includes("const BUILD='"+release.terminalBuild+"'"));
  assert.doesNotThrow(()=>new Function(v10.replace(/^import .*$/gm,'')));
});
