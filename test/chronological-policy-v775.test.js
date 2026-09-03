import test from 'node:test';
import assert from 'node:assert/strict';
import { selectPolicyFromPeriod, evaluateChronologicalPolicy } from '../chronological-policy-v775.js';

const mk=(avgRDelta,pfDelta,displaced=10)=>({equalCoverage:true,comparison:{avgRDelta,pfDelta},opportunity:{displaced}});

test('selector prefers avgR, then PF, then lower churn',()=>{
  const p={results:{
    LR_MTF3:mk(0.01,0.02,20),
    LR_VOLUME:mk(0.01,0.02,100),
    LR_MTF3_VOLUME:mk(0.005,0.01,1),
  }};
  assert.equal(selectPolicyFromPeriod(p).policy,'LR_MTF3');
});

test('chronological evaluation never uses test period to select its policy',()=>{
  const report={periods:{
    P3:{results:{LR_MTF3:mk(-0.004,-0.006,10),LR_VOLUME:mk(-0.01,-0.018,90),LR_MTF3_VOLUME:mk(0,0,0)}},
    P2:{results:{LR_MTF3:mk(0.008,0.015,18),LR_VOLUME:mk(0.008,0.015,105),LR_MTF3_VOLUME:mk(0.003,0.005,3)}},
    P1:{results:{LR_MTF3:mk(0,0,44),LR_VOLUME:mk(0.012,0.021,100),LR_MTF3_VOLUME:mk(0.002,0.002,6)}},
    P0:{results:{LR_MTF3:mk(0.011,0.022,19),LR_VOLUME:mk(-0.002,-0.002,83),LR_MTF3_VOLUME:mk(0,0,2)}},
  }};
  const r=evaluateChronologicalPolicy(report);
  assert.deepEqual(r.steps.map(x=>x.selectedPolicy),['LR_MTF3_VOLUME','LR_MTF3','LR_VOLUME']);
  assert.equal(r.summary.positivePeriods,1);
  assert.equal(r.summary.neutralPeriods,1);
  assert.equal(r.summary.negativePeriods,1);
  assert.equal(r.summary.persistent,false);
  assert.equal(r.nextStep,'REJECT_PERIOD_SWITCHING_POLICY');
});
