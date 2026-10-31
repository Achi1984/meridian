const WINDOWS={'1h':3600000,'1d':86400000,'1w':604800000};
export function buildPionexHistoryModel(payload,{now=Date.now(),range='1d'}={}){
  const end=now,start=end-(WINDOWS[range]||WINDOWS['1d']);
  const out={status:'unavailable',scope:'PIONEX',currency:'USD/USDT',start,end,points:[],segments:[],gaps:false,truncated:false};
  if(payload?.version!=='PIONEX_HISTORY_V1'||payload.source!=='POSTGRES_PIONEX_HISTORY'||payload.scope!=='PIONEX'||payload.currency!=='USD/USDT'||!Array.isArray(payload.points)||payload.points.length>2200)return out;
  if(payload.truncated!==undefined&&typeof payload.truncated!=='boolean')return out;
  const generated=Date.parse(payload.generatedAt);
  if(!Number.isFinite(generated)||generated>now+30000||now-generated>900000)return out;
  out.truncated=payload.truncated===true;
  let segment=[],previous=-Infinity,rejected=false;
  const cut=()=>{if(segment.length)out.segments.push(segment);segment=[];out.gaps=true;};
  for(const p of payload.points){
    const valid=p?.scope==='PIONEX'&&p.currency==='USD/USDT'&&p.authorityVersion==='PIONEX_FRESH_V1'&&
      typeof p.source==='string'&&p.source.trim()&&!['UNKNOWN','MISSING','MISSING_OR_STALE'].includes(p.source)&&
      typeof p.valueUsd==='number'&&Number.isFinite(p.valueUsd)&&p.valueUsd>=0&&
      Number.isSafeInteger(p.timestamp)&&p.timestamp>0&&Number.isSafeInteger(p.sourceAt)&&p.sourceAt>0&&p.sourceAt<=p.timestamp&&p.timestamp-p.sourceAt<=900000&&p.timestamp<=generated+30000;
    if(!valid){rejected=true;cut();continue;}
    if(p.sourceAt<=previous){rejected=true;cut();continue;}previous=p.sourceAt;
    if(p.sourceAt<start||p.sourceAt>end){cut();continue;}
    const point={timestamp:p.sourceAt,capturedAt:p.timestamp,totalUsd:p.valueUsd};
    if(segment.length&&point.timestamp-segment.at(-1).timestamp>900000)cut();
    segment.push(point);out.points.push(point);
  }
  if(segment.length)out.segments.push(segment);
  // Excluded stored records have no reliable position: never connect across an unknown exclusion.
  if(payload.excludedPoints>0){out.segments=out.points.map(p=>[p]);out.gaps=true;}
  out.status=out.points.length?'ready':rejected||payload.excludedPoints>0?'unavailable':'empty';return out;
}
