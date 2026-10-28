import {createHash} from 'node:crypto';

const VERSION='SYNTHETIC-PAPER-ACCOUNTING-MODEL/1';
const sha256=value=>createHash('sha256').update(value).digest('hex');
const isPositiveBigInt=value=>typeof value==='bigint'&&value>0n;
const isNonnegativeBigInt=value=>typeof value==='bigint'&&value>=0n;
const isSafeTime=value=>Number.isSafeInteger(value)&&value>=0;
const frozen=value=>Object.freeze(value);

function stateDigest(identity,sequence,account){
  return sha256(JSON.stringify([
    VERSION,identity,String(sequence),String(account.cashCents),
    String(account.holdingsShares),String(account.costBasisCents),
    String(account.feesCents),[...account.feeIdentities].sort(),
  ]));
}

function eventDigest(action){
  return sha256(JSON.stringify([
    action.kind,action.eventIdentity,action.syntheticIdentity,
    String(action.quantityShares??''),String(action.priceCentsPerShare??''),
    String(action.feeCents??''),action.feeIdentity??'',
    String(action.eventTimeMs??''),String(action.decisionDurableAtMs??''),
    action.causalProof?.strictlyAfter===true,
  ]));
}

export function fakeDecision(kind,details={}){
  if(kind==='NO_ACTION')return frozen({kind});
  if(kind==='ACTION_PROPOSAL')return frozen({kind,details:frozen({...details})});
  throw new TypeError('unsupported fake decision');
}

export function createSyntheticPaperHarness({
  syntheticIdentity,
  clock,
  initialCashCents,
  limits,
}){
  if(typeof syntheticIdentity!=='string'||!syntheticIdentity.startsWith('synthetic-test:')){
    throw new TypeError('isolated synthetic identity required');
  }
  if(typeof clock!=='function')throw new TypeError('generated clock required');
  if(!isNonnegativeBigInt(initialCashCents))throw new TypeError('initial cash must be nonnegative BigInt cents');
  if(!limits||!isPositiveBigInt(limits.maxQuantityShares)
    ||!isPositiveBigInt(limits.maxCashCents)
    ||!isPositiveBigInt(limits.maxPriceCentsPerShare)
    ||!isNonnegativeBigInt(limits.maxFeeCents)
    ||initialCashCents>limits.maxCashCents
    ||!Number.isSafeInteger(limits.maxEvents)||limits.maxEvents<1
    ||!Number.isSafeInteger(limits.maxIdentityChars)||limits.maxIdentityChars<1
    ||!Number.isSafeInteger(limits.maxMarkAgeMs)||limits.maxMarkAgeMs<0
    ||!Number.isSafeInteger(limits.maxProjectionReceipts)||limits.maxProjectionReceipts<1){
    throw new TypeError('finite fixture limits required');
  }

  const account={
    initialCashCents,
    cashCents:initialCashCents,
    holdingsShares:0n,
    costBasisCents:0n,
    feesCents:0n,
    feeIdentities:new Set(),
  };
  let sequence=0;
  let stateIdentity=stateDigest(syntheticIdentity,sequence,account);
  let nextFence=0;
  let activeFence=null;
  let unresolvedUnknown=null;
  let haltedReason=null;
  const attempts=[];
  const receipts=[];
  const events=new Map();
  let lastOutcome=null;

  const snapshotAccount=source=>frozen({
    cashCents:source.cashCents,
    holdingsShares:source.holdingsShares,
    costBasisCents:source.costBasisCents,
    feesCents:source.feesCents,
  });
  const result=(status,reason=null,extra={})=>frozen({
    status,reason,syntheticIdentity,...extra,
  });
  const reject=(reason,extra={})=>result('REJECTED',reason,extra);
  const currentState=()=>unresolvedUnknown?'UNKNOWN':haltedReason?'HALTED':'MODELED';
  const eligible=()=>{
    if(unresolvedUnknown)return reject('RECONCILIATION_REQUIRED',{state:'UNKNOWN'});
    if(haltedReason)return reject(haltedReason,{state:'HALTED'});
    return null;
  };

  function propose(action){
    if(!action||typeof action!=='object')return reject('PAYLOAD_INVALID');
    const blocked=eligible();
    if(blocked)return blocked;
    if(action.syntheticIdentity!==syntheticIdentity)return reject('SYNTHETIC_IDENTITY_MISMATCH');
    if(typeof action.eventIdentity!=='string'||action.eventIdentity.length===0)return reject('IDENTITY_MISSING');
    if(action.eventIdentity.length>limits.maxIdentityChars)return reject('BOUND_EXCEEDED');
    if(action.kind==='NO_ACTION'){
      const digest=eventDigest(action);
      const prior=events.get(action.eventIdentity);
      if(prior){
        if(prior.digest===digest)return result('IDEMPOTENT',null,{priorResult:prior.result});
        return result('HALT','IDENTITY_CONFLICT',{eventIdentity:action.eventIdentity});
      }
      return result('PROPOSED',null,{
        kind:'NO_ACTION',eventIdentity:action.eventIdentity,payloadDigest:digest,
        expectedStateIdentity:stateIdentity,proposedStateIdentity:null,
        nextAccount:snapshotAccount(account),
      });
    }
    if(action.kind==='ACTION_PROPOSAL'){
      return result('PROPOSED',null,{
        kind:'ACTION_PROPOSAL',decision:action.decision,
        expectedStateIdentity:stateIdentity,
      });
    }
    if(action.kind!=='FILL')return reject('PAYLOAD_INVALID');

    const digest=eventDigest(action);
    const prior=events.get(action.eventIdentity);
    if(prior){
      if(prior.digest===digest)return result('IDEMPOTENT',null,{priorResult:prior.result});
      return result('HALT','IDENTITY_CONFLICT',{eventIdentity:action.eventIdentity});
    }
    if(!isPositiveBigInt(action.quantityShares)
      ||action.quantityShares>limits.maxQuantityShares
      ||!isPositiveBigInt(action.priceCentsPerShare)
      ||action.priceCentsPerShare>limits.maxPriceCentsPerShare
      ||!isNonnegativeBigInt(action.feeCents)
      ||typeof action.feeIdentity!=='string'||action.feeIdentity.length===0){
      return reject(action.quantityShares>limits.maxQuantityShares?'BOUND_EXCEEDED':'PAYLOAD_INVALID');
    }
    if(action.feeCents>limits.maxFeeCents
      ||action.feeIdentity.length>limits.maxIdentityChars
      ||action.priceCentsPerShare>limits.maxPriceCentsPerShare){
      return reject('BOUND_EXCEEDED');
    }
    if(!isSafeTime(action.eventTimeMs)||!isSafeTime(action.decisionDurableAtMs)
      ||action.eventTimeMs<=action.decisionDurableAtMs
      ||action.causalProof?.strictlyAfter!==true){
      return reject('LATE_OR_PAST_EVENT');
    }
    if(account.feeIdentities.has(action.feeIdentity))return reject('COST_DUPLICATE');
    if(events.size>=limits.maxEvents)return reject('BOUND_EXCEEDED');

    const notionalCents=action.quantityShares*action.priceCentsPerShare;
    const nextAccount={
      initialCashCents:account.initialCashCents,
      cashCents:account.cashCents-notionalCents-action.feeCents,
      holdingsShares:account.holdingsShares+action.quantityShares,
      costBasisCents:account.costBasisCents+notionalCents,
      feesCents:account.feesCents+action.feeCents,
      feeIdentities:new Set(account.feeIdentities).add(action.feeIdentity),
    };
    if(nextAccount.cashCents<0n)return reject('BALANCE_INVARIANT');
    const proposedStateIdentity=stateDigest(syntheticIdentity,sequence+1,nextAccount);
    return result('PROPOSED',null,{
      kind:'FILL',eventIdentity:action.eventIdentity,payloadDigest:digest,
      feeIdentity:action.feeIdentity,expectedStateIdentity:stateIdentity,
      proposedStateIdentity,nextAccount:snapshotAccount(nextAccount),
      nextFeeIdentities:[...nextAccount.feeIdentities],
    });
  }

  function claim(expectedStateIdentity){
    const blocked=eligible();
    if(blocked){lastOutcome=blocked;return blocked;}
    if(activeFence)return reject('CAS_LOSER');
    if(expectedStateIdentity!==stateIdentity)return reject('CAS_LOSER');
    const token=`${syntheticIdentity}:fence:${++nextFence}`;
    const claimRecord=frozen({
      token,expectedStateIdentity,attempt:attempts.length+1,
    });
    attempts.push(claimRecord);
    activeFence=claimRecord;
    return result('CLAIMED',null,{fenceToken:token,attempt:claimRecord.attempt});
  }

  function recordHalt(proposal){
    if(proposal?.status!=='HALT'||proposal.reason!=='IDENTITY_CONFLICT'){
      return reject('PAYLOAD_INVALID');
    }
    haltedReason='IDENTITY_CONFLICT';
    lastOutcome=result('HALTED','IDENTITY_CONFLICT',{eventIdentity:proposal.eventIdentity});
    return lastOutcome;
  }

  function commit(claimResult,proposal,{outcome='COMMITTED',ack='ACK'}={}){
    const blocked=eligible();
    if(blocked){lastOutcome=blocked;return blocked;}
    if(!activeFence||claimResult?.fenceToken!==activeFence.token
      ||proposal?.expectedStateIdentity!==stateIdentity
      ||activeFence.expectedStateIdentity!==stateIdentity){
      const stale=reject('STALE_FENCE');
      lastOutcome=stale;
      return stale;
    }
    if(proposal.status!=='PROPOSED'||!['FILL','NO_ACTION'].includes(proposal.kind)){
      const invalid=reject('PAYLOAD_INVALID');
      activeFence=null;
      lastOutcome=invalid;
      return invalid;
    }
    if(outcome==='UNKNOWN'){
      unresolvedUnknown=frozen({
        fenceToken:activeFence.token,
        receiptIdentity:`${syntheticIdentity}:receipt:${sequence+1}`,
      });
      const unknown=result('UNKNOWN','PERSISTENCE_UNKNOWN',{
        fenceToken:activeFence.token,
        receiptIdentity:unresolvedUnknown.receiptIdentity,
      });
      lastOutcome=unknown;
      return unknown;
    }
    if(outcome!=='COMMITTED'){
      const invalid=reject('PAYLOAD_INVALID');
      activeFence=null;
      lastOutcome=invalid;
      return invalid;
    }

    const candidate={
      initialCashCents:account.initialCashCents,
      cashCents:proposal.nextAccount.cashCents,
      holdingsShares:proposal.nextAccount.holdingsShares,
      costBasisCents:proposal.nextAccount.costBasisCents,
      feesCents:proposal.nextAccount.feesCents,
      feeIdentities:new Set(proposal.nextFeeIdentities??account.feeIdentities),
    };
    if(candidate.cashCents+candidate.costBasisCents+candidate.feesCents
      !==candidate.initialCashCents){
      const invalid=reject('BALANCE_INVARIANT');
      activeFence=null;
      lastOutcome=invalid;
      return invalid;
    }
    if(proposal.kind==='FILL'
      &&(candidate.feeIdentities.size!==account.feeIdentities.size+1
        ||!candidate.feeIdentities.has(proposal.feeIdentity))){
      const invalid=reject('COST_DUPLICATE');
      activeFence=null;
      lastOutcome=invalid;
      return invalid;
    }

    const now=clock();
    if(!isSafeTime(now)){
      activeFence=null;
      const invalid=reject('PAYLOAD_INVALID');
      lastOutcome=invalid;
      return invalid;
    }
    const nextSequence=sequence+1;
    const nextIdentity=stateDigest(syntheticIdentity,nextSequence,candidate);
    const receipt=frozen({
      receiptIdentity:`${syntheticIdentity}:receipt:${nextSequence}`,
      eventIdentity:proposal.eventIdentity,
      payloadDigest:proposal.payloadDigest,
      fenceToken:activeFence.token,
      sequence:nextSequence,
      stateIdentity:nextIdentity,
      parentStateIdentity:stateIdentity,
      durableAtLocalMs:now,
      account:snapshotAccount(candidate),
      kind:proposal.kind,
    });
    const committed=result('COMMITTED',null,{receipt});

    account.cashCents=candidate.cashCents;
    account.holdingsShares=candidate.holdingsShares;
    account.costBasisCents=candidate.costBasisCents;
    account.feesCents=candidate.feesCents;
    account.feeIdentities=candidate.feeIdentities;
    sequence=nextSequence;
    stateIdentity=nextIdentity;
    activeFence=null;
    receipts.push(receipt);
    events.set(proposal.eventIdentity,{digest:proposal.payloadDigest,result:committed});
    lastOutcome=ack==='LOST'
      ?result('UNKNOWN','PERSISTENCE_UNKNOWN',{
        fenceToken:receipt.fenceToken,receiptIdentity:receipt.receiptIdentity,
      })
      :committed;
    return lastOutcome;
  }

  function lookup(receiptIdentity,fenceToken){
    const receipt=receipts.find(item=>item.receiptIdentity===receiptIdentity
      &&item.fenceToken===fenceToken);
    if(receipt)return result('COMMITTED',null,{receipt,lookupOnly:true});
    return result('UNKNOWN','PERSISTENCE_UNKNOWN',{
      receiptIdentity,fenceToken,lookupOnly:true,
    });
  }

  function mark(mark){
    const now=clock();
    if(!mark||!isPositiveBigInt(mark.priceCentsPerShare)
      ||!isSafeTime(mark.markTimeMs)||!isSafeTime(now)
      ||mark.markTimeMs>now||now-mark.markTimeMs>limits.maxMarkAgeMs){
      return result('UNAVAILABLE','MARK_UNAVAILABLE',{
        equityCents:null,valuation:'UNAVAILABLE',
      });
    }
    return result('VALUED',null,{
      equityCents:account.cashCents+account.holdingsShares*mark.priceCentsPerShare,
      valuation:'AVAILABLE',
    });
  }

  function project(outcome=lastOutcome){
    const recent=receipts.slice(-limits.maxProjectionReceipts).map(receipt=>({
      receiptIdentity:receipt.receiptIdentity,
      sequence:receipt.sequence,
      stateIdentity:receipt.stateIdentity,
    }));
    return frozen({
      version:VERSION,
      scope:'SYNTHETIC_TEST_ONLY',
      identity:syntheticIdentity,
      state:currentState(),
      status:outcome?.status??'IDLE',
      reason:outcome?.reason??null,
      account:snapshotAccount(account),
      stateIdentity,
      receiptCount:receipts.length,
      recentReceipts:frozen(recent),
      activeFence:activeFence?.token??unresolvedUnknown?.fenceToken??null,
    });
  }

  return Object.freeze({
    propose,claim,commit,recordHalt,lookup,mark,project,
    get stateIdentity(){return stateIdentity;},
    get attempts(){return attempts.length;},
    get receipts(){return receipts.length;},
    get account(){return snapshotAccount(account);},
    get feeIdentities(){return frozen([...account.feeIdentities]);},
  });
}

export {eventDigest};
