// Pure projection of stored complete valuations. No account coverage or live-price claim.
const VERSION='7.64-CANONICAL-PORTFOLIO-HISTORY-V3';
const SOURCE='POSTGRES_CANONICAL_HISTORY';
const MAX_AGE=15*60*1000;
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const amount=x=>typeof x==='number'&&Number.isFinite(x)&&x>=0;
const epoch=x=>Number.isSafeInteger(x)&&x>0;
function timestamp(value){
  if(epoch(value)&&value<=8640000000000000)return value;
  const m=typeof value==='string'&&/^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?([Zz]|([+-])(\d{2}):(\d{2}))$/.exec(value);
  if(!m)return null;
  const [y,mo,d,h,mi,se]=m.slice(1,7).map(Number),oh=Number(m[10]||0),om=Number(m[11]||0);
  if(mo<1||mo>12||d<1||d>31||h>23||mi>59||se>59||oh>23||om>59)return null;
  const wall=Date.UTC(y,mo-1,d,h,mi,se,Number((m[7]||'').padEnd(3,'0').slice(0,3))),date=new Date(wall);
  if(date.getUTCFullYear()!==y||date.getUTCMonth()!==mo-1||date.getUTCDate()!==d)return null;
  const time=wall-(m[9]==='-'?-1:1)*(oh*60+om)*60000;
  return epoch(time)&&time<=8640000000000000?time:null;
}
export function buildDepotReadModel(snapshot,{now=Date.now()}={}){
  const empty={status:'UNKNOWN',readOnly:true,executionAllowed:false,totalUsd:null,spotUsd:null,
    tradingUsd:null,snapshotAt:null,sourceAt:null,source:null,expiresAt:null,excludedIncompletePoints:0};
  if(!object(snapshot)||!epoch(now)||snapshot.version!==VERSION||snapshot.source!==SOURCE||
    !Array.isArray(snapshot.points)||snapshot.points.length===0||snapshot.points.length>2200)return empty;
  if(!Number.isSafeInteger(snapshot.rawPointCount)||!Number.isSafeInteger(snapshot.excludedIncompletePoints)||
    snapshot.excludedIncompletePoints<0||snapshot.rawPointCount!==snapshot.points.length+snapshot.excludedIncompletePoints||
    snapshot.rawPointCount>2200)return empty;
  // Never silently fall back to an older apparently good point behind invalid newer data.
  let previous=0;
  for(const point of snapshot.points){
    if(!object(point)||!epoch(point.timestamp)||point.timestamp<=previous||point.timestamp>now)return empty;
    previous=point.timestamp;
  }
  const point=snapshot.points.at(-1),s=point.sourceStatus;
  if(![point.totalUsd,point.spotUsd,point.tradingUsd].every(amount)||
    !Number.isFinite(point.spotUsd+point.tradingUsd)||Math.abs(point.totalUsd-point.spotUsd-point.tradingUsd)>1||
    !object(s)||s.spot!=='STRICT_AUTHORITY'||s.trading!=='PIONEX_EQUITY'||s.tradingFresh!==true||
    s.tradingAuthorityVersion!=='PIONEX_FRESH_V1'||typeof s.tradingSource!=='string'||
    !/^[A-Z0-9_]{1,80}$/.test(s.tradingSource)||['MISSING','MISSING_OR_STALE'].includes(s.tradingSource))return empty;
  const sourceTime=timestamp(s.tradingUpdatedAt);
  if(sourceTime===null||sourceTime>point.timestamp||sourceTime>now)return empty;
  const expiresAt=Math.min(point.timestamp,sourceTime)+MAX_AGE;
  if(now>expiresAt)return {...empty,status:'STALE',source:SOURCE};
  return {...empty,status:'FRESH_SNAPSHOT',totalUsd:point.totalUsd,spotUsd:point.spotUsd,
    tradingUsd:point.tradingUsd,snapshotAt:new Date(point.timestamp).toISOString(),
    sourceAt:new Date(sourceTime).toISOString(),source:SOURCE,expiresAt,
    excludedIncompletePoints:snapshot.excludedIncompletePoints};
}
