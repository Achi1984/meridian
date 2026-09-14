import {IDS,newLedger,stepLedger,ledgerSummary} from './r42-ledger.js';
import {collectMarket} from './r42-market.js';
import {createSingleFlight} from '../state-serial.js';
// Separate durable keys, no writes to any existing bot ledger.
export function createResearchRuntime({getState,setState,fetchJson,spotBase,perpBase,clock=Date.now}){
  const single=createSingleFlight();
  async function tick(){return single(async()=>{
    const now=clock(),states=await Promise.all(IDS.map(id=>getState(`r42_${id}`,null)));
    const oldest=Math.min(now,...states.filter(s=>s?.basket).map(s=>s.basket.openedAt));
    const market=await collectMarket(fetchJson,spotBase,perpBase,now,oldest,clock);
    for(let i=0;i<IDS.length;i++){
      const next=stepLedger(states[i]||newLedger(IDS[i]),market,clock());
      next.dataHealth={collectedAt:market.collectedAt,requestErrors:market.errors,dataErrors:market.dataErrors};
      await setState(`r42_${IDS[i]}`,next);
    }
  });}
  async function summary(){return Promise.all(IDS.map(async id=>{const s=await getState(`r42_${id}`,null);return s?{...ledgerSummary(s),dataHealth:{collectedAt:s.dataHealth?.collectedAt??null,requestErrors:(s.dataHealth?.requestErrors||[]).map(e=>({symbol:e.symbol??null,endpoint:e.endpoint??null,reason:e.reason})),dataErrors:(s.dataHealth?.dataErrors||[]).map(e=>({symbol:e.symbol,reason:e.reason}))}}:{id,lifecycle:'NOT_STARTED',closedTrades:0,openTrades:0,pnl:null,profitFactor:null,reasons:['AWAITING_FIRST_SCAN']};}));}
  return {tick,summary};
}
