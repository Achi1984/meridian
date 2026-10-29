import {createHash} from 'node:crypto';

const VERSION='SYNTHETIC-PAPER-ACCOUNTING-MODEL/1';
const sha256=value=>createHash('sha256').update(value).digest('hex');
const isPositiveBigInt=value=>typeof value==='bigint'&&value>0n;
const isNonnegativeBigInt=value=>typeof value==='bigint'&&value>=0n;
const isSafeTime=value=>Number.isSafeInteger(value)&&value>=0;
const frozen=value=>Object.freeze(value);

function stateDigest(identity,sequence,account,parentStateIdentity=null,receiptIdentity=null,eventIdentity=null,payloadDigest=null){
  return sha256(JSON.stringify([
    VERSION,identity,String(sequence),String(account.cashCents),
    String(account.holdingsShares),String(account.costBasisCents),
    String(account.feesCents),[...account.feeIdentities].sort(),
    parentStateIdentity??'',receiptIdentity??'',eventIdentity??'',payloadDigest??'',
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

function freezeAccount(account){
  return frozen({
    cashCents:account.cashCents,
    holdingsShares:account.holdingsShares,
    costBasisCents:account.costBasisCents,
    feesCents:account.feesCents,
    feeIdentities:frozen([...account.feeIdentities].sort()),
  });
}

export function fakeDecision(kind){
  if(kind==='NO_ACTION')return frozen({kind});
  if(kind==='ACTION_PROPOSAL')return frozen({kind});
  throw new TypeError('unsupported fake decision');
}

export function createSyntheticPaperHarness({
  syntheticIdentity,
  clock,
  initialCashCents,
  limits:providedLimits,
}){
  if(typeof providedLimits!=='object'||providedLimits===null)throw new TypeError('finite fixture limits required');
  const limits={
    maxInitialCashCents:providedLimits.maxInitialCashCents,
    maxQuantityPerFillShares:providedLimits.maxQuantityPerFillShares,
    maxAggregateShares:providedLimits.maxAggregateShares,
    maxPriceCentsPerShare:providedLimits.maxPriceCentsPerShare,
    maxFeePerFillCents:providedLimits.maxFeePerFillCents,
    maxAggregateFeesCents:providedLimits.maxAggregateFeesCents,
    maxEvents:providedLimits.maxEvents,
    maxAttempts:providedLimits.maxAttempts,
    maxIdentityChars:providedLimits.maxIdentityChars,
    maxMarkAgeMs:providedLimits.maxMarkAgeMs,
    maxProjectionReceipts:providedLimits.maxProjectionReceipts,
  };
  if(!isPositiveBigInt(limits.maxInitialCashCents)
    ||!isPositiveBigInt(limits.maxQuantityPerFillShares)
    ||!isPositiveBigInt(limits.maxAggregateShares)
    ||!isPositiveBigInt(limits.maxPriceCentsPerShare)
    ||!isNonnegativeBigInt(limits.maxFeePerFillCents)
    ||!isNonnegativeBigInt(limits.maxAggregateFeesCents)
    ||!Number.isSafeInteger(limits.maxEvents)||limits.maxEvents<1
    ||!Number.isSafeInteger(limits.maxAttempts)||limits.maxAttempts<1
    ||!Number.isSafeInteger(limits.maxIdentityChars)||limits.maxIdentityChars<1
    ||!Number.isSafeInteger(limits.maxMarkAgeMs)||limits.maxMarkAgeMs<0
    ||!Number.isSafeInteger(limits.maxProjectionReceipts)||limits.maxProjectionReceipts<1){
    throw new TypeError('finite fixture limits required');
  }
  frozen(limits);
  const generatedIdentitySuffix=Math.max(
    ':receipt:'.length+String(limits.maxEvents).length,
    ':fence:'.length+String(limits.maxAttempts).length,
  );
  if(typeof syntheticIdentity!=='string'||!syntheticIdentity.startsWith('synthetic-test:')
    ||syntheticIdentity.length===0
    ||syntheticIdentity.length+generatedIdentitySuffix>limits.maxIdentityChars){
    throw new TypeError('bounded isolated synthetic identity required');
  }
  if(typeof clock!=='function')throw new TypeError('generated clock required');
  if(!isNonnegativeBigInt(initialCashCents)||initialCashCents>limits.maxInitialCashCents){
    throw new TypeError('initial cash outside fixture bounds');
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
  let lostAck=null;
  let haltedReason=null;
  const attempts=[];
  const receipts=[];
  const events=new Map();
  const proposalRecords=new WeakMap();
  const claimRecords=new WeakMap();
  let lastOutcome=null;

  const result=(status,reason=null,extra={})=>frozen({
    status,reason,syntheticIdentity,...extra,
  });
  const reject=(reason,extra={})=>result('REJECTED',reason,extra);
  const currentState=()=>unresolvedUnknown||lostAck?'UNKNOWN':haltedReason?'HALTED':'MODELED';
  const eligible=()=>{
    if(unresolvedUnknown||lostAck)return reject('RECONCILIATION_REQUIRED',{state:'UNKNOWN'});
    if(haltedReason)return reject(haltedReason,{state:'HALTED'});
    return null;
  };
  const identityIsBounded=value=>typeof value==='string'
    &&value.length>0&&value.length<=limits.maxIdentityChars;
  const snapshotAccount=()=>freezeAccount(account);

  function makeProposal(fields,record){
    const proposal=result('PROPOSED',null,fields);
    proposalRecords.set(proposal,record);
    return proposal;
  }

  function propose(action){
    if(!action||typeof action!=='object')return reject('PAYLOAD_INVALID');
    const blocked=eligible();
    if(blocked)return blocked;
    if(action.syntheticIdentity!==syntheticIdentity)return reject('SYNTHETIC_IDENTITY_MISMATCH');
    if(typeof action.eventIdentity!=='string'||action.eventIdentity.length===0){
      return reject('IDENTITY_MISSING');
    }
    if(action.eventIdentity.length>limits.maxIdentityChars)return reject('BOUND_EXCEEDED');

    if(action.kind==='ACTION_PROPOSAL'){
      if(action.decision!=='ACTION_PROPOSAL')return reject('PAYLOAD_INVALID');
      return makeProposal({kind:'ACTION_PROPOSAL',expectedStateIdentity:stateIdentity},{
        kind:'ACTION_PROPOSAL',expectedStateIdentity:stateIdentity,
      });
    }

    const digest=eventDigest(action);
    const prior=events.get(action.eventIdentity);
    if(prior){
      if(prior.digest===digest)return result('IDEMPOTENT',null,{priorResult:prior.result});
      return result('HALT','IDENTITY_CONFLICT',{eventIdentity:action.eventIdentity});
    }
    if(events.size>=limits.maxEvents)return reject('BOUND_EXCEEDED');

    if(action.kind==='NO_ACTION'){
      const candidate={...account,feeIdentities:new Set(account.feeIdentities)};
      const receiptIdentity=`${syntheticIdentity}:receipt:${sequence+1}`;
      const proposedStateIdentity=stateDigest(
        syntheticIdentity,sequence+1,candidate,stateIdentity,receiptIdentity,
        action.eventIdentity,digest,
      );
      return makeProposal({
        kind:'NO_ACTION',eventIdentity:action.eventIdentity,payloadDigest:digest,
        expectedStateIdentity:stateIdentity,receiptIdentity,proposedStateIdentity,
        nextAccount:freezeAccount(candidate),
      },{
        kind:'NO_ACTION',eventIdentity:action.eventIdentity,payloadDigest:digest,
        expectedStateIdentity:stateIdentity,receiptIdentity,proposedStateIdentity,candidate,
      });
    }
    if(action.kind!=='FILL')return reject('PAYLOAD_INVALID');
    if(!isPositiveBigInt(action.quantityShares)
      ||!isPositiveBigInt(action.priceCentsPerShare)
      ||!isNonnegativeBigInt(action.feeCents)
      ||!identityIsBounded(action.feeIdentity)){
      return reject('PAYLOAD_INVALID');
    }
    if(action.quantityShares>limits.maxQuantityPerFillShares
      ||action.priceCentsPerShare>limits.maxPriceCentsPerShare
      ||action.feeCents>limits.maxFeePerFillCents){
      return reject('BOUND_EXCEEDED');
    }
    if(!isSafeTime(action.eventTimeMs)||!isSafeTime(action.decisionDurableAtMs)
      ||action.eventTimeMs<=action.decisionDurableAtMs
      ||action.causalProof?.strictlyAfter!==true){
      return reject('LATE_OR_PAST_EVENT');
    }
    if(account.feeIdentities.has(action.feeIdentity))return reject('COST_DUPLICATE');

    const notionalCents=action.quantityShares*action.priceCentsPerShare;
    const candidate={
      initialCashCents:account.initialCashCents,
      cashCents:account.cashCents-notionalCents-action.feeCents,
      holdingsShares:account.holdingsShares+action.quantityShares,
      costBasisCents:account.costBasisCents+notionalCents,
      feesCents:account.feesCents+action.feeCents,
      feeIdentities:new Set(account.feeIdentities).add(action.feeIdentity),
    };
    if(action.quantityShares>limits.maxAggregateShares-account.holdingsShares
      ||action.feeCents>limits.maxAggregateFeesCents-account.feesCents){
      return reject('BOUND_EXCEEDED');
    }
    if(candidate.cashCents<0n||candidate.cashCents>limits.maxInitialCashCents){
      return reject('BALANCE_INVARIANT');
    }
    const receiptIdentity=`${syntheticIdentity}:receipt:${sequence+1}`;
    const proposedStateIdentity=stateDigest(
      syntheticIdentity,sequence+1,candidate,stateIdentity,receiptIdentity,
      action.eventIdentity,digest,
    );
    return makeProposal({
      kind:'FILL',eventIdentity:action.eventIdentity,payloadDigest:digest,
      feeIdentity:action.feeIdentity,expectedStateIdentity:stateIdentity,
      receiptIdentity,proposedStateIdentity,nextAccount:freezeAccount(candidate),
    },{
      kind:'FILL',eventIdentity:action.eventIdentity,payloadDigest:digest,
      feeIdentity:action.feeIdentity,expectedStateIdentity:stateIdentity,
      receiptIdentity,proposedStateIdentity,candidate,
    });
  }

  function claim(expectedStateIdentity){
    const blocked=eligible();
    if(blocked){lastOutcome=blocked;return blocked;}
    if(activeFence||expectedStateIdentity!==stateIdentity)return reject('CAS_LOSER');
    if(attempts.length>=limits.maxAttempts)return reject('BOUND_EXCEEDED');
    const record=frozen({
      token:`${syntheticIdentity}:fence:${++nextFence}`,
      expectedStateIdentity,attempt:attempts.length+1,
    });
    attempts.push(record);
    activeFence=record;
    const claimResult=result('CLAIMED',null,{
      fenceToken:record.token,attempt:record.attempt,
    });
    claimRecords.set(claimResult,record);
    return claimResult;
  }

  function recordHalt(proposal){
    if(proposal?.status!=='HALT'||proposal.reason!=='IDENTITY_CONFLICT'){
      return reject('PAYLOAD_INVALID');
    }
    haltedReason='IDENTITY_CONFLICT';
    lastOutcome=result('HALTED','IDENTITY_CONFLICT',{eventIdentity:proposal.eventIdentity});
    return lastOutcome;
  }

  function commit(claimResult,proposal,options={}){
    const blocked=eligible();
    if(blocked){lastOutcome=blocked;return blocked;}
    const claimRecord=claimRecords.get(claimResult);
    const proposalRecord=proposalRecords.get(proposal);
    if(!claimRecord||!proposalRecord||proposal.status!=='PROPOSED'){
      return reject('PAYLOAD_INVALID');
    }
    if(!activeFence||claimRecord!==activeFence
      ||proposalRecord.expectedStateIdentity!==stateIdentity
      ||claimRecord.expectedStateIdentity!==stateIdentity){
      return reject('STALE_FENCE');
    }
    if(proposalRecord.kind==='ACTION_PROPOSAL')return reject('PAYLOAD_INVALID');
    const outcome=options&&typeof options==='object'?(options.outcome??'COMMITTED'):'COMMITTED';
    const ack=options&&typeof options==='object'?(options.ack??'ACK'):'ACK';
    if(!['COMMITTED','UNKNOWN'].includes(outcome)||!['ACK','LOST'].includes(ack)){
      return reject('PAYLOAD_INVALID');
    }
    if(outcome==='UNKNOWN'){
      unresolvedUnknown=frozen({
        fenceToken:activeFence.token,
        receiptIdentity:proposalRecord.receiptIdentity,
      });
      const unknown=result('UNKNOWN','PERSISTENCE_UNKNOWN',{
        fenceToken:activeFence.token,receiptIdentity:unresolvedUnknown.receiptIdentity,
      });
      lastOutcome=unknown;
      return unknown;
    }

    const candidate=proposalRecord.candidate;
    if(!candidate||!candidate.feeIdentities
      ||candidate.cashCents+candidate.costBasisCents+candidate.feesCents
        !==candidate.initialCashCents){
      return reject('BALANCE_INVARIANT');
    }
    if(proposalRecord.kind==='NO_ACTION'
      &&(candidate.cashCents!==account.cashCents
        ||candidate.holdingsShares!==account.holdingsShares
        ||candidate.costBasisCents!==account.costBasisCents
        ||candidate.feesCents!==account.feesCents
        ||candidate.feeIdentities.size!==account.feeIdentities.size
        ||[...candidate.feeIdentities].some(id=>!account.feeIdentities.has(id)))){
      return reject('BALANCE_INVARIANT');
    }
    if(proposalRecord.kind==='FILL'
      &&(candidate.feeIdentities.size!==account.feeIdentities.size+1
        ||!candidate.feeIdentities.has(proposalRecord.feeIdentity))){
      return reject('COST_DUPLICATE');
    }
    const now=clock();
    if(!isSafeTime(now))return reject('PAYLOAD_INVALID');
    const nextSequence=sequence+1;
    const receiptIdentity=`${syntheticIdentity}:receipt:${nextSequence}`;
    const nextIdentity=stateDigest(
      syntheticIdentity,nextSequence,candidate,stateIdentity,receiptIdentity,
      proposalRecord.eventIdentity,proposalRecord.payloadDigest,
    );
    if(proposalRecord.receiptIdentity!==receiptIdentity
      ||proposalRecord.proposedStateIdentity!==nextIdentity){
      return reject('STATE_IDENTITY_MISMATCH');
    }
    const receipt=frozen({
      receiptIdentity,eventIdentity:proposalRecord.eventIdentity,
      payloadDigest:proposalRecord.payloadDigest,fenceToken:activeFence.token,
      sequence:nextSequence,stateIdentity:nextIdentity,
      parentStateIdentity:stateIdentity,durableAtLocalMs:now,
      account:freezeAccount(candidate),kind:proposalRecord.kind,
    });
    const committed=result('COMMITTED',null,{receipt});

    account.cashCents=candidate.cashCents;
    account.holdingsShares=candidate.holdingsShares;
    account.costBasisCents=candidate.costBasisCents;
    account.feesCents=candidate.feesCents;
    account.feeIdentities=new Set(candidate.feeIdentities);
    sequence=nextSequence;
    stateIdentity=nextIdentity;
    activeFence=null;
    receipts.push(receipt);
    events.set(proposalRecord.eventIdentity,{digest:proposalRecord.payloadDigest,result:committed});
    if(ack==='LOST'){
      lostAck=frozen({fenceToken:receipt.fenceToken,receiptIdentity:receipt.receiptIdentity});
      lastOutcome=result('UNKNOWN','PERSISTENCE_UNKNOWN',{
        fenceToken:receipt.fenceToken,receiptIdentity:receipt.receiptIdentity,
      });
      return lastOutcome;
    }
    lastOutcome=committed;
    return committed;
  }

  function lookup(receiptIdentity,fenceToken){
    const receipt=receipts.find(item=>item.receiptIdentity===receiptIdentity
      &&item.fenceToken===fenceToken);
    if(receipt)return result('COMMITTED',null,{receipt,lookupOnly:true});
    return result('UNKNOWN','PERSISTENCE_UNKNOWN',{lookupOnly:true,exactMatch:false});
  }

  function mark(markEvent){
    const now=clock();
    if(!markEvent||markEvent.syntheticIdentity!==syntheticIdentity
      ||!identityIsBounded(markEvent.markIdentity)
      ||!isPositiveBigInt(markEvent.priceCentsPerShare)
      ||markEvent.priceCentsPerShare>limits.maxPriceCentsPerShare
      ||!isSafeTime(markEvent.markTimeMs)||!isSafeTime(now)
      ||markEvent.markTimeMs>now||now-markEvent.markTimeMs>limits.maxMarkAgeMs){
      return result('UNAVAILABLE','MARK_UNAVAILABLE',{
        equityCents:null,valuation:'UNAVAILABLE',
      });
    }
    return result('VALUED',null,{
      equityCents:account.cashCents+account.holdingsShares*markEvent.priceCentsPerShare,
      valuation:'AVAILABLE',
    });
  }

  function project(outcome=lastOutcome){
    const recent=receipts.slice(-limits.maxProjectionReceipts).map(receipt=>frozen({
      receiptIdentity:receipt.receiptIdentity,sequence:receipt.sequence,
      stateIdentity:receipt.stateIdentity,
    }));
    const state=currentState();
    return frozen({
      version:VERSION,scope:'SYNTHETIC_TEST_ONLY',identity:syntheticIdentity,
      state,status:state==='UNKNOWN'?'UNKNOWN':outcome?.status??'IDLE',
      reason:state==='UNKNOWN'?'PERSISTENCE_UNKNOWN':outcome?.reason??null,
      account:snapshotAccount(),stateIdentity,
      receiptCount:receipts.length,recentReceipts:frozen(recent),
      activeFence:activeFence?.token??unresolvedUnknown?.fenceToken??null,
    });
  }

  return Object.freeze({
    propose,claim,commit,recordHalt,lookup,mark,project,
    get stateIdentity(){return stateIdentity;},
    get attempts(){return attempts.length;},
    get receipts(){return receipts.length;},
    get account(){return snapshotAccount();},
    get feeIdentities(){return frozen([...account.feeIdentities]);},
  });
}
