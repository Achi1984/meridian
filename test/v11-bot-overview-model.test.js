import test from 'node:test';
import assert from 'node:assert/strict';
import {buildBotOverviewModel} from '../v11/bot-overview-model.js';

const bot = (ref, symbol, side, category, leverage, pnl) => ({
  ref: ref.repeat(20), symbol, side, category,
  metrics: {leverage, pnlUsd: pnl}
});
const snapshot = () => ({status: 'FRESH_SNAPSHOT', readOnly: true, executionAllowed: false,
  source: 'PIONEX_BOT_API', snapshotAt: '2026-10-18T10:00:00Z', bots: [
    bot('a', 'ETHUSDT', 'SHORT', 'linear', 3, -8),
    bot('b', 'BTCUSD', 'LONG', 'inverse', 5, 0),
    bot('c', 'ETHUSDT', 'NEUTRAL', 'linear', null, -2),
    bot('d', 'ADAUSDT', null, null, 10, null)
  ]});

test('overview filters preserve bot identity and distinguish snapshot count from matches', () => {
  const result = buildBotOverviewModel(snapshot(), {query: 'eth', direction: 'short', category: 'linear'});
  assert.equal(result.count, 4);
  assert.equal(result.bots.length, 1);
  assert.equal(result.bots[0].ref, 'a'.repeat(20));
  assert.equal(result.bots[0].direction, 'short');
  assert.deepEqual(buildBotOverviewModel(snapshot(), {query: 'missing'}).bots, []);
  assert.equal(buildBotOverviewModel({...snapshot(), bots: []}).count, 0);
});

test('sorts deterministically with unknown leverage and P/L last and V1 zero unconfirmed', () => {
  const source = snapshot();
  const sortedSymbol = buildBotOverviewModel(source).bots;
  assert.deepEqual(sortedSymbol.map(row => row.ref[0]), ['d', 'b', 'a', 'c']);
  const sortedLeverage = buildBotOverviewModel(source, {sort: 'leverage'}).bots;
  assert.deepEqual(sortedLeverage.map(row => row.ref[0]), ['d', 'b', 'a', 'c']);
  const sortedPnl = buildBotOverviewModel(source, {sort: 'pnl'}).bots;
  assert.deepEqual(sortedPnl.map(row => row.ref[0]), ['a', 'c', 'd', 'b']);
  assert.equal(sortedPnl[2].pnl, null);
  assert.deepEqual(buildBotOverviewModel(source).distribution, {long: 1, short: 1, neutral: 1, unknown: 1});
});

test('Moon with confirmed leverage sorts before unknown leverage in the cockpit snapshot', () => {
  const source = {...snapshot(), bots: [
    bot('a', 'BTCUSDT', 'LONG', 'inverse', 5, -25),
    bot('b', 'BTCUSDT', 'SHORT', 'linear', 2, -25),
    bot('c', 'ETHUSDT', 'NEUTRAL', 'linear', 8, -3.5),
    bot('d', 'ADAUSDT', null, null, null, null),
    bot('e', 'XRPUSDT', 'SHORT', 'inverse', 3, 0.005),
    bot('f', 'SOLUSDT', 'LONG', 'linear', null, 0),
    {ref:'f00df00df00df00df00d',symbol:'MOONUSDT',side:'LONG',category:null,
      productCategory:'FUTURES_MOON',metrics:{leverage:1,pnlUsd:null}}
  ]};
  const sortedLeverage = buildBotOverviewModel(source, {sort: 'leverage'}).bots;
  const sortedPnl = buildBotOverviewModel(source, {sort: 'pnl'}).bots;

  assert.equal(sortedLeverage.length, 7);
  assert.deepEqual(sortedLeverage.map(row => row.symbol),
    ['ETHUSDT','BTCUSDT','XRPUSDT','BTCUSDT','MOONUSDT','ADAUSDT','SOLUSDT']);
  assert.deepEqual(sortedPnl.map(row => row.symbol),
    ['BTCUSDT','BTCUSDT','ETHUSDT','XRPUSDT','ADAUSDT','MOONUSDT','SOLUSDT']);
});

test('Command losses include only confirmed negative source P/L and are capped at three', () => {
  const source = snapshot();
  source.bots.push(bot('e', 'XRPUSDT', 'LONG', 'linear', 2, -1));
  source.bots.push(bot('f', 'SOLUSDT', 'SHORT', 'linear', 4, -12));
  assert.deepEqual(buildBotOverviewModel(source).losses.map(row => row.pnl), [-12, -8, -2]);
});

test('malformed or duplicate bot references fail closed', () => {
  const source = snapshot();
  source.bots[1].ref = source.bots[0].ref;
  assert.deepEqual(buildBotOverviewModel(source), {status: 'unavailable', bots: []});
  assert.deepEqual(buildBotOverviewModel({...snapshot(), readOnly: false}), {status: 'unavailable', bots: []});
});

function reviewedSnapshot() {
  const source = snapshot();
  source.ageMs = 1000;source.expiresAt = Date.parse(source.snapshotAt) + 900000;
  for (const [index,matches] of [[0,false],[1,true],[2,false]]) {
    const row=source.bots[index];
    row.takeProfitEvidence='PRICE_SET';row.metrics.takeProfit=110;row.metrics.upper=100;
    row.takeProfitCheck={set:true,matchesUpper:matches};
  }
  source.bots[1].metrics.pnlEvidence='EXPLICIT_USD_VALUE';
  return source;
}

test('TP and P/L snapshot counts stay global while combined filters change visible matches only', () => {
  const source=reviewedSnapshot(),before=structuredClone(source);
  const all=buildBotOverviewModel(source),filtered=buildBotOverviewModel(source,{query:'ETH',direction:'short',category:'linear',tpStatus:'mismatch',pnlAvailability:'available'});
  assert.deepEqual(all.counts,{tp:{mismatch:2,match:1,unknown:1},pnl:{available:3,unavailable:1}});
  assert.deepEqual(filtered.counts,all.counts);assert.equal(filtered.count,4);assert.equal(filtered.visibleCount,1);
  assert.equal(filtered.bots[0].ref,'a'.repeat(20));assert.equal(filtered.bots[0].tpStatus,'mismatch');
  assert.deepEqual(filtered.losses,all.losses);assert.deepEqual(source,before);
  const unknown=buildBotOverviewModel(source,{tpStatus:'unknown',pnlAvailability:'unavailable'});
  assert.equal(unknown.visibleCount,1);assert.equal(unknown.bots[0].ref,'d'.repeat(20));
  assert.equal(buildBotOverviewModel(source,{tpStatus:'match',pnlAvailability:'unavailable'}).visibleCount,0);
  assert.equal(buildBotOverviewModel({...source,bots:[]}).counts.pnl.available,0);
});

test('TP status consumes the existing comparison and requires complete positive evidence', () => {
  const source=reviewedSnapshot();
  // Deliberately different raw prices: overview must not implement a second comparison.
  assert.equal(buildBotOverviewModel(source,{tpStatus:'match'}).bots[0].ref,'b'.repeat(20));
  for(const mutate of [
    b=>{delete b.takeProfitCheck;},b=>{b.takeProfitCheck.matchesUpper='true';},
    b=>{b.takeProfitCheck.set=false;},b=>{b.takeProfitEvidence='UNKNOWN';},
    b=>{b.metrics.takeProfit=null;},b=>{b.metrics.takeProfit='110';},
    b=>{b.metrics.upper=0;},b=>{b.metrics.upper=-1;},b=>{b.metrics.upper=Infinity;}
  ]){
    const input=reviewedSnapshot();mutate(input.bots[0]);
    assert.equal(buildBotOverviewModel(input).bots.find(b=>b.ref==='a'.repeat(20)).tpStatus,'unknown');
  }
});

test('TP ordering is mismatch then unknown then match with deterministic symbol and identity ties', () => {
  const source=reviewedSnapshot();
  assert.deepEqual(buildBotOverviewModel(source,{sort:'tp'}).bots.map(b=>b.ref[0]),['a','c','d','b']);
  const zero=buildBotOverviewModel(source,{pnlAvailability:'available',sort:'pnl'});
  assert.deepEqual(zero.bots.map(b=>b.pnl),[-8,-2,0]);
  delete source.bots[1].metrics.pnlEvidence;
  assert.equal(buildBotOverviewModel(source).counts.pnl.available,2);
  assert.equal(buildBotOverviewModel(source,{pnlAvailability:'unavailable'}).visibleCount,2);
  assert.ok(buildBotOverviewModel(reviewedSnapshot()).losses.every(b=>b.pnl<0));
});

test('unrecognized filter inputs safely use defaults and stale or locked snapshots expose no counts', () => {
  const source=reviewedSnapshot();
  assert.deepEqual(buildBotOverviewModel(source,{tpStatus:'missing',pnlAvailability:true,sort:'risk'}),buildBotOverviewModel(source));
  for(const status of ['STALE','UNKNOWN','LOCKED'])assert.deepEqual(buildBotOverviewModel({...source,status}),{status:'unavailable',bots:[]});
});

test('freshness metadata is bounded source metadata without a new clock or inferred expiry', () => {
  const source=reviewedSnapshot(),result=buildBotOverviewModel(source);
  assert.equal(result.ageMs,1000);assert.equal(result.expiresAt,source.expiresAt);
  assert.equal(buildBotOverviewModel(snapshot()).expiresAt,null);
  assert.equal(buildBotOverviewModel(snapshot()).ageMs,null);
  for(const ageMs of [null,'1000',true,-1,900001,Infinity])assert.equal(buildBotOverviewModel({...source,ageMs}).ageMs,null);
  for(const expiresAt of [null,'1',true,Date.parse(source.snapshotAt),source.expiresAt+1,Infinity])assert.equal(buildBotOverviewModel({...source,expiresAt}).expiresAt,null);
  assert.equal(buildBotOverviewModel({...source,ageMs:1001,expiresAt:Date.parse(source.snapshotAt)+1000}).expiresAt,null);
});
