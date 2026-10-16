import test from 'node:test';
import assert from 'node:assert/strict';
import {sizeSpotEntry} from '../docs/strategy-lab/spot-risk-sizing.mjs';
import {applySpotFill} from '../docs/strategy-lab/spot-ledger.mjs';

const base = {currency:'EUR',cashMicros:'1000',riskBudgetMicros:'1000',
  remainingExposureMicros:'1000',entryPriceMicrosPerLot:'100',
  stressedExitPriceMicrosPerLot:'90',feeBps:0};
const run = patch => {const r=sizeSpotEntry({...base,...patch});assert.equal(r.valid,true,r.errors);return r;};

test('cash limits largest quantity',()=>{
  const r=run({cashMicros:'299'});assert.equal(r.sizing.lots,'2');
  assert.equal(r.sizing.cashRemainingMicros,'99');
});
test('gross exposure limits quantity',()=>{
  assert.equal(run({remainingExposureMicros:'399'}).sizing.lots,'3');
});
test('modeled risk limits quantity inclusively',()=>{
  const r=run({riskBudgetMicros:'40'});assert.equal(r.sizing.lots,'4');
  assert.equal(r.sizing.modeledRiskMicros,'40');
  assert.equal(run({riskBudgetMicros:'39'}).sizing.lots,'3');
});
test('both fees round upward on aggregate side notionals',()=>{
  const r=run({feeBps:1,riskBudgetMicros:'22'}).sizing;
  assert.equal(r.lots,'2');assert.equal(r.entryFeeMicros,'1');
  assert.equal(r.stressedExitFeeMicros,'1');assert.equal(r.modeledRiskMicros,'22');
  assert.equal(run({feeBps:1,cashMicros:'200'}).sizing.lots,'1');
});
test('zero feasible quantity is valid and not a candidate',()=>{
  for(const field of ['cashMicros','riskBudgetMicros','remainingExposureMicros']) {
    const r=run({[field]:'0'});assert.equal(r.candidate,false);
    assert.equal(r.sizing.lots,'0');assert.equal(r.sizing.entryFeeMicros,'0');
  }
});
test('fee bound 10000 allowed, others rejected',()=>{
  const r=run({feeBps:10000}).sizing;assert.equal(r.lots,'5');
  assert.equal(r.stressedExitCreditMicros,'0');assert.equal(r.modeledRiskMicros,'1000');
  for(const feeBps of [-1,10001,1.5,NaN,Infinity,'10'])
    assert.equal(sizeSpotEntry({...base,feeBps}).valid,false);
});
test('canonical amounts reject malformed and newline values',()=>{
  for(const value of ['', '01','-1','1.0','1e2','1\n',' 1','1 ',1,'1'.repeat(31)])
    assert.equal(sizeSpotEntry({...base,cashMicros:value}).valid,false);
});
test('strict schema currency and adverse price orientation',()=>{
  for(const input of [null,[],{...base,extra:1},{...base,currency:'USD'},
    {...base,entryPriceMicrosPerLot:'0'},{...base,stressedExitPriceMicrosPerLot:'0'},
    {...base,stressedExitPriceMicrosPerLot:'100'},{...base,stressedExitPriceMicrosPerLot:'101'}])
    assert.equal(sizeSpotEntry(input).valid,false);
  const missing={...base};delete missing.riskBudgetMicros;
  assert.equal(sizeSpotEntry(missing).valid,false);
});
test('30-digit extremes stay exact and bounded',()=>{
  const maximum='9'.repeat(30);
  const r=run({cashMicros:maximum,riskBudgetMicros:maximum,remainingExposureMicros:maximum,
    entryPriceMicrosPerLot:'2',stressedExitPriceMicrosPerLot:'1'}).sizing;
  assert.equal(r.lots,((10n**30n-1n)/2n).toString());
  assert.equal(r.cashRemainingMicros,'1');
  for(const n of Object.values(r)) assert.ok(n.length<=30);
  assert.equal(run({cashMicros:maximum,riskBudgetMicros:maximum,remainingExposureMicros:maximum,
    entryPriceMicrosPerLot:maximum,stressedExitPriceMicrosPerLot:'1',feeBps:10000}).sizing.lots,'0');
});
test('input unchanged and output JSON serializable without authority',()=>{
  const input=Object.freeze({...base}),before=JSON.stringify(input);
  const r=sizeSpotEntry(input);assert.equal(JSON.stringify(input),before);
  assert.deepEqual(JSON.parse(JSON.stringify(r)),r);
  assert.equal(r.executionAuthorized,false);assert.equal(r.researchOnly,true);
});
test('small exhaustive reference proves maximality across budget and fee combinations',()=>{
  // Independent integer Number reference: these fixtures remain far below 2^53.
  for(const feeBps of [0,1,125,5000,10000]) for(const cash of [0,7,24,60])
    for(const exposure of [0,11,30,60]) for(const risk of [0,3,13,60]) {
      let expected=0;
      for(let q=1;q<=60;q++) {
        const debit=q*7+Math.ceil(q*7*feeBps/10000);
        const loss=debit-q*4+Math.ceil(q*4*feeBps/10000);
        if(debit<=cash && q*7<=exposure && loss<=risk) expected=q;
      }
      const r=run({cashMicros:String(cash),remainingExposureMicros:String(exposure),
        riskBudgetMicros:String(risk),entryPriceMicrosPerLot:'7',stressedExitPriceMicrosPerLot:'4',feeBps});
      assert.equal(r.sizing.lots,String(expected));
      const next=Number(r.sizing.lots)+1;
      const nextDebit=next*7+Math.ceil(next*7*feeBps/10000);
      const nextRisk=nextDebit-next*4+Math.ceil(next*4*feeBps/10000);
      assert.ok(nextDebit>cash || next*7>exposure || nextRisk>risk);
    }
});
test('synthetic sized entry integrates exact fees and nonnegative cash with ledger',()=>{
  for(const cashMicros of ['201','999','1000']) {
    const sized=run({cashMicros,feeBps:1,riskBudgetMicros:'1000'}).sizing;
    const r=applySpotFill({account:{currency:'EUR',cashMicros,positions:[],processedFillIds:[]},
      fill:{id:'synthetic-buy',symbol:'SYNTH',side:'BUY',lots:sized.lots,
        priceMicrosPerLot:base.entryPriceMicrosPerLot,feeMicros:sized.entryFeeMicros,
        signalAvailableAtMs:1,quoteAtMs:2,quoteReceivedAtMs:3,fillAtMs:3},maxQuoteAgeMs:1000});
    assert.equal(r.valid,true,r.errors);assert.equal(r.account.cashMicros,sized.cashRemainingMicros);
    assert.ok(BigInt(r.account.cashMicros)>=0n);
    assert.equal(BigInt(cashMicros)-BigInt(r.account.cashMicros),BigInt(sized.entryDebitMicros));
    assert.deepEqual(r.account.positions,[{symbol:'SYNTH',lots:sized.lots}]);
  }
});
test('independent EUR reference counts fees on both sides',()=>{
  const s=run({cashMicros:'10000000000',riskBudgetMicros:'50000000',
    remainingExposureMicros:'2500000000',entryPriceMicrosPerLot:'100000000',
    stressedExitPriceMicrosPerLot:'95000000',feeBps:10}).sizing;
  assert.equal(s.lots,'9');assert.equal(s.entryFeeMicros,'900000');
  assert.equal(s.stressedExitFeeMicros,'855000');assert.equal(s.modeledRiskMicros,'46755000');
});
