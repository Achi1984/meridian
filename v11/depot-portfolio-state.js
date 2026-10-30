const SOURCES=new Set(['SERVER_PORTFOLIO_CURRENT','POSTGRES_CANONICAL_HISTORY']);
const STATUSES=new Set(['locked','not_loaded','loading','stale','unavailable']);
const validTime=value=>{
  if(typeof value!=='string')return false;
  const time=Date.parse(value);
  return Number.isFinite(time)&&Number.isFinite(new Date(time).getTime())&&new Date(time).toISOString()===value;
};
const copy=state=>state.model?{status:state.status,model:{...state.model}}:{status:state.status,model:null};

let current={status:'not_loaded',model:null};
const listeners=new Set();

export function publishDepotPortfolioState(state={}){
  const status=String(state?.status||'unavailable');
  if(status==='fresh'){
    const model=state?.model;
    if(model?.status==='FRESH_SNAPSHOT'&&model.readOnly===true&&model.executionAllowed===false&&
      SOURCES.has(model.source)&&typeof model.totalUsd==='number'&&Number.isFinite(model.totalUsd)&&model.totalUsd>=0&&
      validTime(model.snapshotAt)&&validTime(model.sourceAt)&&Number.isSafeInteger(model.expiresAt)&&
      model.expiresAt>0&&model.expiresAt<=8640000000000000){
      current={status,model:{totalUsd:model.totalUsd,currency:'USD',snapshotAt:model.snapshotAt,
        sourceAt:model.sourceAt,source:model.source,expiresAt:model.expiresAt}};
    }else current={status:'unavailable',model:null};
  }else current={status:STATUSES.has(status)?status:'unavailable',model:null};
  const emitted=copy(current);
  for(const listener of listeners)try{listener(copy(emitted));}catch{}
  return copy(current);
}

export function subscribeDepotPortfolio(listener){
  if(typeof listener!=='function')throw new Error('Depot portfolio subscriber must be a function');
  listeners.add(listener);
  try{listener(copy(current));}catch{}
  return()=>listeners.delete(listener);
}
