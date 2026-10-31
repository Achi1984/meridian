import {buildDepotReadModel} from './depot-read-model.js?v=B16-M11-RELEASE1';
export const DEPOT_WINDOWS=Object.freeze({'1h':3600000,'1d':86400000,'1w':604800000});
// Captured values only: no extrapolation, resampling, cash-flow or return claim.
export function buildDepotHistoryModel(raw,{now=Date.now(),range='1d'}={}){
  const end=now,start=now-(DEPOT_WINDOWS[range]||DEPOT_WINDOWS['1d']);
  const empty={status:'unavailable',start,end,points:[],segments:[],gaps:false};
  if(!Number.isSafeInteger(now)||now<=0||raw?.version!=='7.64-CANONICAL-PORTFOLIO-HISTORY-V3'||raw?.source!=='POSTGRES_CANONICAL_HISTORY'||
    !Array.isArray(raw.points)||raw.points.length>2200||!Number.isSafeInteger(raw.rawPointCount)||raw.rawPointCount>2200||
    !Number.isSafeInteger(raw.excludedIncompletePoints)||raw.excludedIncompletePoints<0||raw.rawPointCount!==raw.points.length+raw.excludedIncompletePoints)return empty;
  let previous=0;const points=[];
  for(const p of raw.points){
    if(!Number.isSafeInteger(p?.timestamp)||p.timestamp<=previous||p.timestamp>now)return empty;
    previous=p.timestamp;
    const model=buildDepotReadModel({...raw,points:[p],rawPointCount:1,excludedIncompletePoints:0},{now:p.timestamp});
    if(model.status!=='FRESH_SNAPSHOT')return empty;
    if(p.timestamp>=start)points.push({timestamp:p.timestamp,totalUsd:model.totalUsd});
  }
  const segments=[];let segment=[];let gaps=raw.excludedIncompletePoints>0;
  for(const p of points){
    if(segment.length&&(raw.excludedIncompletePoints>0||p.timestamp-segment.at(-1).timestamp>900000)){
      segments.push(segment);segment=[];gaps=true;
    }
    segment.push(p);
  }
  if(segment.length)segments.push(segment);
  return {status:points.length?'ready':'empty',start,end,points,segments,gaps};
}
