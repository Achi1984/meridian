import fs from 'node:fs';
const p='cloud-backtest.js';let s=fs.readFileSync(p,'utf8');
s=s.replace("version:'7.52-CHALLENGER-V3-RESEARCH'","version:'7.49-EXIT-LAB-REPLAY-V1',challengerModel:'7.52-CHALLENGER-V3'");
if(!s.includes("challengerModel:'7.52-CHALLENGER-V3'"))throw new Error('Challenger V3 model metadata injection failed');
fs.writeFileSync(p,s);
