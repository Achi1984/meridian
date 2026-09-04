import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateProspectiveHoldout, eligibleProspectiveRows, HOLDOUT_START_MS, HORIZON_DAYS, RAW_CONTEXT } from '../prospective-holdout.js';

const DAY=86400000;
const row=(ts,r,key=RAW_CONTEXT)=>{const [side,regime,volatility]=key.split('|');return{ts,realizedR:r,observations:{side,regime,volatility}}};

test('holdout excludes pre-lock and immature rows',()=>{
  const now=HOLDOUT_START_MS+(HORIZON_DAYS+2)*DAY;
  const rows=[row(HOLDOUT_START_MS-DAY,1),row(HOLDOUT_START_MS+DAY,.5),row(now-DAY,.7)];
  const eligible=eligibleProspectiveRows(rows,{nowMs:now});
  assert.equal(eligible.length,1);
});

test('holdout context and thresholds are locked',()=>{
  const now=HOLDOUT_START_MS+(HORIZON_DAYS+20)*DAY;
  const rows=Array.from({length:30},(_,i)=>row(HOLDOUT_START_MS+i*1000,.2));
  const r=evaluateProspectiveHoldout(rows,{nowMs:now});
  assert.equal(r.lock.rawContext,'LONG|TRANSITION|NORMAL');
  assert.equal(r.rawContext.n,30);
  assert.equal(r.readiness.status,'READY_FOR_REVIEW');
  assert.equal(r.promotion.allowed,false);
});
