import crypto from 'node:crypto';

export const V2_LEDGER_KIND='EVENT_SOURCED_V2';
export const V2_LEDGER_VERSION=1;
export const V2_LEDGER_NOTIONAL_PER_LEG=10000;
export const V2_LEDGER_RESERVED_CAPITAL=20000;

const VENUES=Object.freeze(['BINANCE','OKX']);
const SIDES=Object.freeze(['LONG','SHORT']);
const HOUR=60*60*1000;

function fail(code){throw new Error(code)}
function strictFinite(value,code='CROSS_VENUE_V2_INVALID_LEDGER_INPUT'){
  if(typeof value!=='number'||!Number.isFinite(value))fail(code);
  return value;
}
function strictPositive(value,code='CROSS_VENUE_V2_INVALID_LEDGER_INPUT'){
  const n=strictFinite(value,code); if(n<=0)fail(code); return n;
}
function strictNonNegative(value,code='CROSS_VENUE_V2_INVALID_LEDGER_INPUT'){
  const n=strictFinite(value,code); if(n<0)fail(code); return n;
}
function strictTime(value){
  if(typeof value!=='number'||!Number.isSafeInteger(value)||value<=0)fail('CROSS_VENUE_V2_INVALID_LEDGER_TIME');
  return value;
}
function sha256(value){return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex')}
function venueOrder(v){return v==='BINANCE'?0:1}
function sideSign(side){return side==='LONG'?1:-1}
function almostEqual(a,b,tol=1e-8){return Math.abs(a-b)<=tol}

function normalizeFill(row){
  if(!row||typeof row!=='object'||Array.isArray(row))fail('CROSS_VENUE_V2_INVALID_LEDGER_FILL');
  if(!VENUES.includes(row.venue)||!SIDES.includes(row.side))fail('CROSS_VENUE_V2_INVALID_LEDGER_FILL');
  const time=strictTime(row.time);
  const qty=strictPositive(row.qty,'CROSS_VENUE_V2_INVALID_LEDGER_FILL');
  const markOpen=strictPositive(row.markOpen,'CROSS_VENUE_V2_INVALID_LEDGER_FILL');
  const feeBps=strictNonNegative(row.feeBps,'CROSS_VENUE_V2_INVALID_LEDGER_FILL');
  const slipBps=strictNonNegative(row.slipBps,'CROSS_VENUE_V2_INVALID_LEDGER_FILL');
  return Object.freeze({venue:row.venue,side:row.side,qty,markOpen,time,feeBps,slipBps});
}
function normalizeFunding(row){
  if(!row||typeof row!=='object'||Array.isArray(row))fail('CROSS_VENUE_V2_INVALID_LEDGER_FUNDING');
  if(!VENUES.includes(row.venue))fail('CROSS_VENUE_V2_INVALID_LEDGER_FUNDING');
  const time=strictTime(row.time);
  const rate=strictFinite(row.rate,'CROSS_VENUE_V2_INVALID_LEDGER_FUNDING');
  const fundingMark=strictPositive(row.fundingMark,'CROSS_VENUE_V2_INVALID_LEDGER_FUNDING');
  return Object.freeze({venue:row.venue,rate,fundingMark,time});
}
function normalizeMark(row){
  if(!row||typeof row!=='object'||Array.isArray(row))fail('CROSS_VENUE_V2_INVALID_LEDGER_MARK');
  if(!VENUES.includes(row.venue))fail('CROSS_VENUE_V2_INVALID_LEDGER_MARK');
  const time=strictTime(row.time);
  const mark=strictPositive(row.mark,'CROSS_VENUE_V2_INVALID_LEDGER_MARK');
  return Object.freeze({venue:row.venue,time,mark});
}
function groupByTime(rows){
  const out=new Map();
  for(const row of rows){
    if(!out.has(row.time))out.set(row.time,[]);
    out.get(row.time).push(row);
  }
  return out;
}
function assertUniqueVenueTime(rows,code){
  const seen=new Set();
  for(const row of rows){
    const key=`${row.time}:${row.venue}`;
    if(seen.has(key))fail(code);
    seen.add(key);
  }
}
function canonicalLedgerPayload(ledger){
  return {
    ledgerKind:ledger.ledgerKind,
    ledgerVersion:ledger.ledgerVersion,
    openingEquity:ledger.openingEquity,
    closingEquity:ledger.closingEquity,
    notionalPerLeg:ledger.notionalPerLeg,
    opsBufferBps:ledger.opsBufferBps,
    cashByVenue:ledger.cashByVenue,
    events:ledger.events,
    equityPath:ledger.equityPath
  };
}
function ledgerDigestFor(ledger){return sha256(canonicalLedgerPayload(ledger))}

export function verifyV2Ledger(ledger){
  if(!ledger||typeof ledger!=='object'||Array.isArray(ledger)||ledger.ledgerKind!==V2_LEDGER_KIND||ledger.ledgerVersion!==V2_LEDGER_VERSION)
    fail('CROSS_VENUE_V2_INVALID_LEDGER_OBJECT');
  if(typeof ledger.ledgerDigest!=='string'||ledger.ledgerDigest!==ledgerDigestFor(ledger))
    fail('CROSS_VENUE_V2_LEDGER_DIGEST_MISMATCH');
  return true;
}

export function buildV2EventSourcedLedger({
  fills=[],
  funding=[],
  marks=[],
  opsBufferBps=5,
  openingEquity=V2_LEDGER_RESERVED_CAPITAL,
  notionalPerLeg=V2_LEDGER_NOTIONAL_PER_LEG
}={}){
  if(!Array.isArray(fills)||!Array.isArray(funding)||!Array.isArray(marks))
    fail('CROSS_VENUE_V2_INVALID_LEDGER_INPUT');
  const openEq=strictPositive(openingEquity);
  const notional=strictPositive(notionalPerLeg);
  const opsBps=strictNonNegative(opsBufferBps);
  const xs=fills.map(normalizeFill).sort((a,b)=>a.time-b.time||venueOrder(a.venue)-venueOrder(b.venue));
  const fs=funding.map(normalizeFunding).sort((a,b)=>a.time-b.time||venueOrder(a.venue)-venueOrder(b.venue));
  const ms=marks.map(normalizeMark).sort((a,b)=>a.time-b.time||venueOrder(a.venue)-venueOrder(b.venue));
  assertUniqueVenueTime(xs,'CROSS_VENUE_V2_DUPLICATE_LEDGER_FILL');
  assertUniqueVenueTime(fs,'CROSS_VENUE_V2_DUPLICATE_LEDGER_FUNDING');
  assertUniqueVenueTime(ms,'CROSS_VENUE_V2_DUPLICATE_LEDGER_MARK');

  const fillGroups=groupByTime(xs),fundingGroups=groupByTime(fs),markGroups=groupByTime(ms);
  const fillTimes=[...fillGroups.keys()].sort((a,b)=>a-b);
  if(fillTimes.length%2!==0)fail('CROSS_VENUE_V2_LEDGER_POSITION_LEFT_OPEN');
  for(let i=0;i<fillTimes.length;i+=2){
    const entryTime=fillTimes[i],exitTime=fillTimes[i+1];
    if(exitTime<=entryTime||(exitTime-entryTime)%HOUR!==0)fail('CROSS_VENUE_V2_LEDGER_MARK_GAP');
    for(let t=entryTime;t<=exitTime;t+=HOUR){
      const pair=markGroups.get(t)||[];
      if(pair.length!==2||new Set(pair.map(x=>x.venue)).size!==2)
        fail('CROSS_VENUE_V2_UNPAIRED_LEDGER_MARK');
    }
  }
  const timeline=[...new Set([...fillGroups.keys(),...fundingGroups.keys(),...markGroups.keys()])].sort((a,b)=>a-b);
  const cash={BINANCE:openEq/2,OKX:openEq/2};
  const pos={
    BINANCE:{qty:0,avgEntry:null,side:null},
    OKX:{qty:0,avgEntry:null,side:null}
  };
  const events=[],equityPath=[];
  let cycleOpen=false,lastValuationTime=null;

  const positionOpen=()=>pos.BINANCE.qty!==0||pos.OKX.qty!==0;
  const pairOpen=()=>pos.BINANCE.qty!==0&&pos.OKX.qty!==0;
  const pairFlat=()=>pos.BINANCE.qty===0&&pos.OKX.qty===0;

  for(const time of timeline){
    for(const f of fundingGroups.get(time)||[]){
      const p=pos[f.venue];
      if(p.qty===0)continue;
      const cashDelta=-p.qty*f.fundingMark*f.rate;
      cash[f.venue]+=cashDelta;
      events.push(Object.freeze({kind:'FUNDING',venue:f.venue,time,rate:f.rate,fundingMark:f.fundingMark,positionQty:p.qty,cashDelta}));
    }

    const group=fillGroups.get(time)||[];
    if(group.length){
      if(group.length!==2||new Set(group.map(x=>x.venue)).size!==2)
        fail('CROSS_VENUE_V2_UNPAIRED_LEDGER_FILL');
      if(pairFlat()){
        for(const f of group){
          if(!almostEqual(f.qty*f.markOpen,notional,1e-6))
            fail('CROSS_VENUE_V2_LEDGER_NOTIONAL_MISMATCH');
          const p=pos[f.venue];
          p.qty=sideSign(f.side)*f.qty;
          p.avgEntry=f.markOpen;
          p.side=f.side;
          const feeUsd=notional*f.feeBps/10000;
          const slippageUsd=notional*f.slipBps/10000;
          cash[f.venue]-=feeUsd+slippageUsd;
          events.push(Object.freeze({kind:'FILL_OPEN',venue:f.venue,time,side:f.side,qty:f.qty,markOpen:f.markOpen,feeUsd,slippageUsd,cashDelta:-(feeUsd+slippageUsd)}));
        }
        if(!pairOpen())fail('CROSS_VENUE_V2_UNPAIRED_LEDGER_POSITION');
        cycleOpen=true;
        lastValuationTime=null;
      }else if(pairOpen()){
        for(const f of group){
          const p=pos[f.venue];
          if(f.side!==p.side||!almostEqual(f.qty,Math.abs(p.qty),1e-12))
            fail('CROSS_VENUE_V2_LEDGER_CLOSE_MISMATCH');
          const realizedPnlUsd=p.qty*(f.markOpen-p.avgEntry);
          const feeUsd=notional*f.feeBps/10000;
          const slippageUsd=notional*f.slipBps/10000;
          const cashDelta=realizedPnlUsd-feeUsd-slippageUsd;
          cash[f.venue]+=cashDelta;
          events.push(Object.freeze({kind:'FILL_CLOSE',venue:f.venue,time,side:f.side,qty:f.qty,markOpen:f.markOpen,realizedPnlUsd,feeUsd,slippageUsd,cashDelta}));
          p.qty=0;p.avgEntry=null;p.side=null;
        }
        if(!pairFlat())fail('CROSS_VENUE_V2_UNPAIRED_LEDGER_POSITION');
        const opsUsd=notional*opsBps/10000;
        cash.BINANCE-=opsUsd/2;
        cash.OKX-=opsUsd/2;
        events.push(Object.freeze({kind:'OPS_BUFFER',venue:'PAIR',time,opsBufferBps:opsBps,cashDelta:-opsUsd}));
        cycleOpen=false;
      }else{
        fail('CROSS_VENUE_V2_UNPAIRED_LEDGER_POSITION');
      }
    }

    const valuationRows=markGroups.get(time)||[];
    if(valuationRows.length){
      if(valuationRows.length!==2||new Set(valuationRows.map(x=>x.venue)).size!==2)
        fail('CROSS_VENUE_V2_UNPAIRED_LEDGER_MARK');
      if(lastValuationTime!==null&&positionOpen()&&time-lastValuationTime!==HOUR)
        fail('CROSS_VENUE_V2_LEDGER_MARK_GAP');
      const map=new Map(valuationRows.map(x=>[x.venue,x.mark]));
      let unrealized=0;
      for(const venue of VENUES){
        const p=pos[venue];
        if(p.qty!==0)unrealized+=p.qty*(map.get(venue)-p.avgEntry);
      }
      const equity=cash.BINANCE+cash.OKX+unrealized;
      equityPath.push(Object.freeze({time,equity,cash:cash.BINANCE+cash.OKX,unrealized}));
      lastValuationTime=time;
    }
  }

  if(cycleOpen||!pairFlat())fail('CROSS_VENUE_V2_LEDGER_POSITION_LEFT_OPEN');
  const closingEquity=cash.BINANCE+cash.OKX;
  const base={
    ledgerKind:V2_LEDGER_KIND,
    ledgerVersion:V2_LEDGER_VERSION,
    openingEquity:openEq,
    closingEquity,
    notionalPerLeg:notional,
    opsBufferBps:opsBps,
    cashByVenue:Object.freeze({BINANCE:cash.BINANCE,OKX:cash.OKX}),
    events:Object.freeze(events),
    equityPath:Object.freeze(equityPath)
  };
  return Object.freeze({...base,ledgerDigest:ledgerDigestFor(base)});
}

export function reconcileLedger({ledger,decomposition,tolerance=1e-8}={}){
  verifyV2Ledger(ledger);
  if(!decomposition||typeof decomposition!=='object'||Array.isArray(decomposition)||!Array.isArray(decomposition.fundingCashflows))
    fail('CROSS_VENUE_V2_INVALID_DECOMPOSITION');
  const funding=decomposition.fundingCashflows.map(x=>strictFinite(x,'CROSS_VENUE_V2_INVALID_DECOMPOSITION'));
  const basis=strictFinite(decomposition.basisPnlUsd,'CROSS_VENUE_V2_INVALID_DECOMPOSITION');
  const costs=strictNonNegative(decomposition.costsUsd,'CROSS_VENUE_V2_INVALID_DECOMPOSITION');
  const tol=strictNonNegative(tolerance,'CROSS_VENUE_V2_INVALID_DECOMPOSITION');
  const expectedDelta=funding.reduce((a,b)=>a+b,0)+basis-costs;
  const actualDelta=ledger.closingEquity-ledger.openingEquity;
  const reconciliationError=actualDelta-expectedDelta;
  if(Math.abs(reconciliationError)>tol)fail('CROSS_VENUE_V2_LEDGER_RECONCILIATION');
  return Object.freeze({ok:true,expectedDelta,actualDelta,reconciliationError,ledgerDigest:ledger.ledgerDigest});
}

export function ledgerMaxDrawdownUsd(ledger){
  verifyV2Ledger(ledger);
  let peak=ledger.openingEquity,maxDrawdownUsd=0;
  for(const point of ledger.equityPath){
    if(point.equity>peak)peak=point.equity;
    maxDrawdownUsd=Math.max(maxDrawdownUsd,peak-point.equity);
  }
  return maxDrawdownUsd;
}
