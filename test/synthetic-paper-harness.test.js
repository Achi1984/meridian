import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createSyntheticPaperHarness,
  fakeDecision,
} from '../test-support/synthetic-paper/harness.mjs';

const ID='synthetic-test:paper-990:fixture-a';
const limits=overrides=>({
  maxCashCents:1000000n,
  maxQuantityShares:3n,
  maxPriceCentsPerShare:100000n,
  maxFeeCents:10000n,
  maxEvents:10,
  maxIdentityChars:128,
  maxMarkAgeMs:100,
  maxProjectionReceipts:2,
  ...overrides,
});

function harness(overrides={}){
  let time=1000;
  return createSyntheticPaperHarness({
    syntheticIdentity:ID,
    clock:()=>time++,
    initialCashCents:100000n,
    limits:limits(overrides),
  });
}

function fill(eventIdentity,overrides={}){
  return {
    kind:'FILL',
    eventIdentity,
    syntheticIdentity:ID,
    quantityShares:2n,
    priceCentsPerShare:10000n,
    feeCents:100n,
    feeIdentity:`fee:${eventIdentity}`,
    eventTimeMs:200,
    decisionDurableAtMs:100,
    causalProof:{strictlyAfter:true},
    ...overrides,
  };
}

function commit(h,action,options={}){
  const proposal=h.propose(action);
  assert.equal(proposal.status,'PROPOSED');
  const claim=h.claim(h.stateIdentity);
  assert.equal(claim.status,'CLAIMED');
  return {proposal,claim,result:h.commit(claim,proposal,options)};
}

test('duplicate identity and digest returns the prior result without another effect',()=>{
  const h=harness();
  const action=fill('event:duplicate');
  const first=commit(h,action).result;
  const before={account:h.account,stateIdentity:h.stateIdentity,attempts:h.attempts,receipts:h.receipts};
  const duplicate=h.propose({...action});
  assert.equal(duplicate.status,'IDEMPOTENT');
  assert.equal(duplicate.priorResult.receipt.receiptIdentity,first.receipt.receiptIdentity);
  assert.deepEqual({account:h.account,stateIdentity:h.stateIdentity,attempts:h.attempts,receipts:h.receipts},before);
});

test('conflicting digest halts while preserving the previous committed state and account',()=>{
  const h=harness();
  commit(h,fill('event:conflict'));
  const before={account:h.account,stateIdentity:h.stateIdentity,attempts:h.attempts,receipts:h.receipts};
  const conflict=h.propose(fill('event:conflict',{priceCentsPerShare:11000n}));
  assert.equal(conflict.status,'HALT');
  assert.equal(conflict.reason,'IDENTITY_CONFLICT');
  assert.equal(h.recordHalt(conflict).status,'HALTED');
  assert.deepEqual({account:h.account,stateIdentity:h.stateIdentity,attempts:h.attempts,receipts:h.receipts},before);
  assert.equal(h.project().state,'HALTED');
});

test('past, equal, and causally unproven events reject without mutation',()=>{
  const h=harness();
  const before={account:h.account,stateIdentity:h.stateIdentity,attempts:h.attempts,receipts:h.receipts};
  for(const [id,eventTimeMs,causalProof] of [
    ['event:past',99,{strictlyAfter:true}],
    ['event:equal',100,{strictlyAfter:true}],
    ['event:missing-proof',101,undefined],
  ]){
    const proposal=h.propose(fill(id,{eventTimeMs,causalProof}));
    assert.equal(proposal.status,'REJECTED');
    assert.equal(proposal.reason,'LATE_OR_PAST_EVENT');
  }
  assert.deepEqual({account:h.account,stateIdentity:h.stateIdentity,attempts:h.attempts,receipts:h.receipts},before);
});

test('generated accounting events are confined to their isolated synthetic identity',()=>{
  const h=harness();
  const rejected=h.propose(fill('event:foreign',{syntheticIdentity:'synthetic-test:other'}));
  assert.equal(rejected.reason,'SYNTHETIC_IDENTITY_MISMATCH');
  commit(h,fill('event:local'));
  const projection=h.project();
  assert.equal(projection.scope,'SYNTHETIC_TEST_ONLY');
  assert.equal(projection.identity,ID);
  assert.equal(Object.hasOwn(projection,'forwardCount'),false);
  assert.equal(Object.hasOwn(projection,'performance'),false);
  assert.equal(projection.account.holdingsShares,2n);
});

test('one fee is booked once and exact balances do not deduct it again at valuation',()=>{
  const h=harness();
  const action=fill('event:accounting-example');
  const {result:first}=commit(h,action);
  assert.equal(first.status,'COMMITTED');
  assert.equal(h.account.cashCents,79900n);
  assert.equal(h.account.holdingsShares,2n);
  assert.equal(h.account.costBasisCents,20000n);
  assert.equal(h.account.feesCents,100n);
  assert.deepEqual(h.feeIdentities,['fee:event:accounting-example']);
  const marked=h.mark({priceCentsPerShare:11000n,markTimeMs:950});
  assert.equal(marked.valuation,'AVAILABLE');
  assert.equal(marked.equityCents,101900n);
  assert.notEqual(marked.equityCents,101800n);
  const before={account:h.account,stateIdentity:h.stateIdentity,receipts:h.receipts};
  const duplicateFee=h.propose(fill('event:second-fee-attempt',{
    quantityShares:1n,feeIdentity:'fee:event:accounting-example',
  }));
  assert.equal(duplicateFee.reason,'COST_DUPLICATE');
  assert.deepEqual({account:h.account,stateIdentity:h.stateIdentity,receipts:h.receipts},before);
});

test('conservation failure rejects the entire commit without partial account or receipt mutation',()=>{
  const h=harness();
  const proposal=h.propose(fill('event:bad-conservation'));
  const claim=h.claim(h.stateIdentity);
  const tampered={
    ...proposal,
    nextAccount:{...proposal.nextAccount,cashCents:proposal.nextAccount.cashCents+1n},
  };
  const before={account:h.account,stateIdentity:h.stateIdentity,receipts:h.receipts};
  const rejected=h.commit(claim,tampered);
  assert.equal(rejected.reason,'BALANCE_INVARIANT');
  assert.deepEqual({account:h.account,stateIdentity:h.stateIdentity,receipts:h.receipts},before);
});

test('missing and stale marks project unavailable rather than zero or carry-forward',()=>{
  const h=harness();
  const before={account:h.account,stateIdentity:h.stateIdentity,receipts:h.receipts};
  const missing=h.mark(null);
  const stale=h.mark({priceCentsPerShare:12000n,markTimeMs:800});
  assert.equal(missing.status,'UNAVAILABLE');
  assert.equal(missing.reason,'MARK_UNAVAILABLE');
  assert.equal(missing.equityCents,null);
  assert.equal(stale.status,'UNAVAILABLE');
  assert.equal(stale.valuation,'UNAVAILABLE');
  assert.deepEqual(h.project(missing).account,before.account);
  assert.deepEqual({account:h.account,stateIdentity:h.stateIdentity,receipts:h.receipts},before);
});

test('CAS loser has no attempt, proposal, receipt, or account effect and leaves winner eligible',()=>{
  const h=harness();
  const initial=h.stateIdentity;
  const winner=h.claim(initial);
  const beforeLoser={attempts:h.attempts,receipts:h.receipts,account:h.account};
  const loser=h.claim(initial);
  assert.equal(loser.status,'REJECTED');
  assert.equal(loser.reason,'CAS_LOSER');
  assert.deepEqual({attempts:h.attempts,receipts:h.receipts,account:h.account},beforeLoser);
  const proposal=h.propose(fill('event:cas-winner'));
  assert.equal(h.commit(winner,proposal).status,'COMMITTED');
  assert.equal(h.receipts,1);
});

test('resolved historical fence cannot write through a stale writer',()=>{
  const h=harness();
  const {claim,proposal,result:first}=commit(h,fill('event:stale-writer'));
  const before={account:h.account,stateIdentity:h.stateIdentity,receipts:h.receipts};
  const stale=h.commit(claim,proposal);
  assert.equal(stale.reason,'STALE_FENCE');
  assert.deepEqual({account:h.account,stateIdentity:h.stateIdentity,receipts:h.receipts},before);
  assert.equal(first.receipt.fenceToken,claim.fenceToken);
});

test('lost ACK returns UNKNOWN and exact same-fence lookup retrieves the original result only',()=>{
  const h=harness();
  const {claim,result:unknown}=commit(h,fill('event:lost-ack'),{ack:'LOST'});
  assert.equal(unknown.status,'UNKNOWN');
  const afterCommit={account:h.account,stateIdentity:h.stateIdentity,receipts:h.receipts,attempts:h.attempts};
  const wrongFence=h.lookup(unknown.receiptIdentity,'synthetic-test:paper-990:wrong-fence');
  assert.equal(wrongFence.status,'UNKNOWN');
  const recovered=h.lookup(unknown.receiptIdentity,claim.fenceToken);
  assert.equal(recovered.status,'COMMITTED');
  assert.equal(recovered.lookupOnly,true);
  assert.equal(recovered.receipt.receiptIdentity,unknown.receiptIdentity);
  assert.deepEqual({account:h.account,stateIdentity:h.stateIdentity,receipts:h.receipts,attempts:h.attempts},afterCommit);
  assert.equal(h.project().status,'UNKNOWN');
});

test('ambiguous UNKNOWN retains its fence and blocks dependent proposals and retries',()=>{
  const h=harness();
  const {claim,proposal,result:unknown}=commit(h,fill('event:ambiguous'),{outcome:'UNKNOWN'});
  const after={account:h.account,stateIdentity:h.stateIdentity,receipts:h.receipts,attempts:h.attempts};
  assert.equal(unknown.status,'UNKNOWN');
  assert.equal(h.project().activeFence,claim.fenceToken);
  assert.equal(h.propose(fill('event:blocked')).reason,'RECONCILIATION_REQUIRED');
  assert.equal(h.claim(h.stateIdentity).reason,'RECONCILIATION_REQUIRED');
  assert.equal(h.lookup(unknown.receiptIdentity,claim.fenceToken).status,'UNKNOWN');
  assert.deepEqual({account:h.account,stateIdentity:h.stateIdentity,receipts:h.receipts,attempts:h.attempts},after);
  assert.equal(proposal.status,'PROPOSED');
});

test('exact configured bounds pass and limit plus one rejects atomically',()=>{
  const h=harness({maxQuantityShares:3n,maxEvents:1});
  const exact=commit(h,fill('event:at-limit',{quantityShares:3n,feeCents:0n}));
  assert.equal(exact.result.status,'COMMITTED');
  const before={account:h.account,stateIdentity:h.stateIdentity,receipts:h.receipts,attempts:h.attempts};
  assert.equal(h.propose(fill('event:quantity-over',{quantityShares:4n})).reason,'BOUND_EXCEEDED');
  assert.equal(h.propose(fill('event:event-over',{quantityShares:1n,feeIdentity:'fee:other'})).reason,'BOUND_EXCEEDED');
  assert.deepEqual({account:h.account,stateIdentity:h.stateIdentity,receipts:h.receipts,attempts:h.attempts},before);
});

test('NO_ACTION is explicit, committed as a bounded receipt, and has no account effect',()=>{
  const h=harness();
  const before=h.account;
  const decision=fakeDecision('NO_ACTION');
  assert.equal(decision.kind,'NO_ACTION');
  const action={...decision,eventIdentity:'event:no-action',syntheticIdentity:ID};
  const {proposal,result:committed}=commit(h,action);
  assert.equal(proposal.kind,'NO_ACTION');
  assert.equal(committed.status,'COMMITTED');
  assert.equal(committed.receipt.kind,'NO_ACTION');
  assert.deepEqual(h.account,before);
  assert.equal(h.receipts,1);
});
