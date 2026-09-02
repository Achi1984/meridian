import fs from 'node:fs';
const p='cloud-backtest.js';let s=fs.readFileSync(p,'utf8');
const old="export const __test={makeLedger,markLedger,gate,openPosition,closePosition,processExits,stats,replayPrepared,shadowDecision,challengerDecision,candidate,slip};";
const neu="export const __test={makeLedger,markLedger,gate,openPosition,closePosition,processExits,stats,replayPrepared,shadowDecision,challengerDecision,candidate,slip,prepareEvents,fetchKlines};";
if(!s.includes(neu)){
  if(!s.includes(old))throw new Error('cloud-backtest __test anchor missing');
  s=s.replace(old,neu);
}
fs.writeFileSync(p,s);
console.log('Feature Lab helpers exposed research-only');
