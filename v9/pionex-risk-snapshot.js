function parseTs(value){
  const timestamp=Date.parse(String(value||''));
  return Number.isFinite(timestamp)?timestamp:null;
}

function explicitlyIncomplete(risk,sync={}){
  return sync.truncated===true||risk?.paginationComplete===false||
    risk?.coverage?.paginationComplete===false||
    String(risk?.coverage?.status||'').toUpperCase()==='PARTIAL';
}

function freshRisk(risk,now){
  const timestamp=parseTs(risk?.updatedAt||risk?.snapshotAt);
  return timestamp!=null&&timestamp<=now+5*60*1000&&now-timestamp<=15*60*1000;
}

export function selectPionexRisk(data={},now=Date.now()){
  const primary=data?.pionexRisk||null,wallet=data?.pionexAccount?.walletBotRisk||null,
    primarySync=data?.pionexBotSync||{},walletSync=data?.pionexAccountSync||{},
    primaryStatus=String(primarySync.status||'UNKNOWN'),accountStatus=String(walletSync.status||'UNKNOWN');
  const primaryOk=primaryStatus==='OK'&&!explicitlyIncomplete(primary,primarySync)&&
    freshRisk(primary,now)&&Array.isArray(primary?.bots)&&primary.bots.length>0&&primary?.detailsComplete===true;
  const walletOk=accountStatus==='OK'&&!explicitlyIncomplete(wallet,walletSync)&&
    freshRisk(wallet,now)&&wallet?.detailsComplete===true&&Array.isArray(wallet?.bots)&&wallet.bots.length>0;
  if(primaryOk)return{risk:primary,status:'BOT_API_OK',kind:'BOT_API'};
  if(walletOk)return{risk:wallet,status:'WALLET_DETAIL_OK',kind:'WALLET_DETAIL'};
  const primaryIncomplete=explicitlyIncomplete(primary,primarySync)||primary?.detailsComplete===false||
    primaryStatus==='PARTIAL';
  return{risk:primary,status:primaryIncomplete?'PARTIAL':primaryStatus,kind:'BOT_API'};
}

export function pionexFeedComplete(feed,selectedStatus){
  return feed?.detailsComplete===true&&!explicitlyIncomplete(feed)&&
    ['BOT_API_OK','WALLET_DETAIL_OK'].includes(selectedStatus);
}

export function pionexCandidateValid({trustedTs,monotonicTs,liveLength,actionComplete,identityComplete,feed,selectedStatus}={}){
  return !!trustedTs&&!!monotonicTs&&liveLength>0&&!!actionComplete&&!!identityComplete&&
    pionexFeedComplete(feed,selectedStatus);
}

export function publishPionexSnapshot(state,snapshot,now,valid=true){
  if(valid!==true||!state||!snapshot||!Array.isArray(snapshot.bots))return false;
  Object.assign(state,snapshot);
  state.lastGoodBotSnapshot={...snapshot,bots:snapshot.bots.map(bot=>({...bot})),publishedAt:now};
  return true;
}
