export const GRID_PATH_SIMULATOR_V1_RULESET='GRID-PATH-SIMULATOR-V1-FROZEN';
export const GRID_PATH_MODES=Object.freeze(['PAPER_OLHC','ALT_OHLC']);
export const GRID_LEVEL_MODES=Object.freeze(['GEOMETRIC','ARITHMETIC']);
export const GRID_PATH_SIMULATOR_V1_CONFIG=Object.freeze({maxGapMs:120000});

const finite=x=>Number.isFinite(Number(x));
const n=x=>Number(x);

export function buildGridLevels({center,stepPct,halfLevels,mode='GEOMETRIC'}={}){
  center=n(center);stepPct=n(stepPct);halfLevels=Number(halfLevels);
  if(!(center>0&&stepPct>0&&Number.isInteger(halfLevels)&&halfLevels>=1))throw new Error('invalid grid parameters');
  if(!GRID_LEVEL_MODES.includes(mode))throw new Error('unsupported grid level mode');
  const levels=[];
  if(mode==='GEOMETRIC'){
    for(let i=halfLevels;i>=1;i--)levels.push(center/((1+stepPct)**i));
    levels.push(center);
    for(let i=1;i<=halfLevels;i++)levels.push(center*((1+stepPct)**i));
  }else{
    const step=center*stepPct;
    for(let i=-halfLevels;i<=halfLevels;i++)levels.push(center+i*step);
  }
  if(levels.some(x=>!(x>0))||levels.some((x,i)=>i&&!(x>levels[i-1])))throw new Error('non-positive or non-monotonic grid');
  return levels;
}

export function validateMinuteBars(raw,{maxGapMs=GRID_PATH_SIMULATOR_V1_CONFIG.maxGapMs}={}){
  if(!Array.isArray(raw)||!raw.length)throw new Error('minute bars required');
  const bars=raw.map((x,i)=>({
    openTime:n(x?.openTime??x?.t??x?.time),
    open:n(x?.open??x?.o),high:n(x?.high??x?.h),low:n(x?.low??x?.l),close:n(x?.close??x?.c),
    closeTime:n(x?.closeTime??x?.T??x?.openTime??x?.t??x?.time)
  }));
  for(let i=0;i<bars.length;i++){
    const b=bars[i];
    if(![b.openTime,b.open,b.high,b.low,b.close,b.closeTime].every(finite)||Math.min(b.open,b.high,b.low,b.close)<=0)throw new Error('invalid minute bar');
    if(b.high<Math.max(b.open,b.close,b.low)||b.low>Math.min(b.open,b.close,b.high))throw new Error('inconsistent minute OHLC');
    if(i){
      const prev=bars[i-1];
      if(b.openTime<=prev.openTime)throw new Error('minute timestamps must be strictly increasing');
      if(b.openTime-prev.openTime>maxGapMs)throw new Error('minute data gap');
    }
  }
  return bars;
}

function validateLevels(levels,currentIndex){
  if(!Array.isArray(levels)||levels.length<3||levels.some(x=>!(Number(x)>0)))throw new Error('invalid grid levels');
  for(let i=1;i<levels.length;i++)if(!(Number(levels[i])>Number(levels[i-1])))throw new Error('grid levels must be strictly increasing');
  if(!Number.isInteger(currentIndex)||currentIndex<0||currentIndex>=levels.length)throw new Error('invalid current grid index');
}

export function crossSegment({start,end,levels,currentIndex,meta={}}={}){
  start=n(start);end=n(end);validateLevels(levels,currentIndex);
  if(!(start>0&&end>0))throw new Error('invalid path segment');
  const events=[];let idx=currentIndex;
  if(end>start){
    while(idx<levels.length-1){
      const level=Number(levels[idx+1]);
      if(!(start<level&&level<=end))break;
      events.push({...meta,side:'SELL',price:level,fromLevelIndex:idx,toLevelIndex:idx+1});
      idx++;
    }
  }else if(end<start){
    while(idx>0){
      const level=Number(levels[idx-1]);
      if(!(end<=level&&level<start))break;
      events.push({...meta,side:'BUY',price:level,fromLevelIndex:idx,toLevelIndex:idx-1});
      idx--;
    }
  }
  return{events,currentIndex:idx,atLowerBoundary:idx===0,atUpperBoundary:idx===levels.length-1};
}

function pathPoints(bar,previousClose,pathMode,first){
  const start=first?bar.open:previousClose;
  if(pathMode==='PAPER_OLHC')return[start,bar.low,bar.high,bar.close];
  if(pathMode==='ALT_OHLC')return[start,bar.high,bar.low,bar.close];
  throw new Error('unsupported path mode');
}

export function traceGridCrossings({bars:rawBars,levels,currentIndex,pathMode='PAPER_OLHC',maxGapMs=GRID_PATH_SIMULATOR_V1_CONFIG.maxGapMs}={}){
  const bars=validateMinuteBars(rawBars,{maxGapMs});validateLevels(levels,currentIndex);
  if(!GRID_PATH_MODES.includes(pathMode))throw new Error('unsupported path mode');
  const initialIndex=currentIndex,events=[];let idx=currentIndex,previousClose=null;
  for(let bi=0;bi<bars.length;bi++){
    const bar=bars[bi],points=pathPoints(bar,previousClose,pathMode,bi===0);
    for(let si=0;si<points.length-1;si++){
      const r=crossSegment({start:points[si],end:points[si+1],levels,currentIndex:idx,meta:{barIndex:bi,openTime:bar.openTime,segmentIndex:si,pathMode}});
      events.push(...r.events);idx=r.currentIndex;
    }
    previousClose=bar.close;
  }
  return{
    ruleset:GRID_PATH_SIMULATOR_V1_RULESET,
    researchOnly:true,executionImpact:false,
    pathMode,initialIndex,currentIndex:idx,
    events,
    buyCount:events.filter(x=>x.side==='BUY').length,
    sellCount:events.filter(x=>x.side==='SELL').length,
    atLowerBoundary:idx===0,
    atUpperBoundary:idx===levels.length-1,
    barsProcessed:bars.length
  };
}

export function tracePathEnvelope(args={}){
  return Object.freeze({
    PAPER_OLHC:traceGridCrossings({...args,pathMode:'PAPER_OLHC'}),
    ALT_OHLC:traceGridCrossings({...args,pathMode:'ALT_OHLC'})
  });
}
