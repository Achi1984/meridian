import fs from 'node:fs';

const p='cloud-backtest.js';
let s=fs.readFileSync(p,'utf8');
const imp="import { challengerV31Decision, CHALLENGER_V31_RULESET } from './challenger-v31.js';";
const anchor="import { challengerV3Decision, CHALLENGER_V3_RULESET } from './challenger-v3.js';";
if(!s.includes(imp)){
  if(!s.includes(anchor))throw new Error('V3 import anchor missing');
  s=s.replace(anchor,anchor+'\n'+imp);
}

s=s.replace("challengerV3:makeLedger('CHALLENGER_V3',cfg),regime:makeLedger('REGIME_V1',cfg)","challengerV3:makeLedger('CHALLENGER_V3',cfg),challengerV31:makeLedger('CHALLENGER_V3_1',cfg),regime:makeLedger('REGIME_V1',cfg)");

const rd="const rd=regimeDecision(sig,{fullRiskPct:cfg.riskPerTradePct,cautionRiskPct:Math.max(.1,round(cfg.riskPerTradePct*.5,3))});";
const c31="const c31=challengerV31Decision(sig,{fullRiskPct:cfg.riskPerTradePct,cautionRiskPct:Math.max(.1,round(cfg.riskPerTradePct*.30,3))});if(c31.decision==='TRADE'||c31.decision==='CAUTION'){const L=ledgers.challengerV31,g=gate(L,sig,c31.riskPct,ev.t,cfg);if(g.ok)openPosition(L,sig,c31.riskPct,ev.t,{modelDecision:c31.decision,confidence:c31.confidence,challengerRuleset:CHALLENGER_V31_RULESET,baselineStatusAtEntry:sig.status,baselineReadyDependency:false,statusRiskFactor:c31.statusRiskFactor},cfg)}";
if(!s.includes('challengerV31Decision(sig')){
  if(!s.includes(rd))throw new Error('Regime decision anchor missing');
  s=s.replace(rd,c31+rd);
}

s=s.replace("challengerV3:stats(ledgers.challengerV3,cfg),regime:stats(ledgers.regime,cfg)","challengerV3:stats(ledgers.challengerV3,cfg),challengerV31:stats(ledgers.challengerV31,cfg),regime:stats(ledgers.regime,cfg)");

s=s.replace("challengerV3=compactStats(r.challengerV3),regime=compactStats(r.regime)","challengerV3=compactStats(r.challengerV3),challengerV31=compactStats(r.challengerV31),regime=compactStats(r.regime)");
s=s.replace("windows.push({i:i+1,from,to,...baseline,baseline,shadow,challenger,challengerV3,regime});","windows.push({i:i+1,from,to,...baseline,baseline,shadow,challenger,challengerV3,challengerV31,regime});");
s=s.replace("variantStability('CHALLENGER V3','challengerV3',windows,whole.challengerV3),\n      variantStability('REGIME V1'","variantStability('CHALLENGER V3','challengerV3',windows,whole.challengerV3),\n      variantStability('CHALLENGER V3.1','challengerV31',windows,whole.challengerV31),\n      variantStability('REGIME V1'");

s=s.replace("challengerV3:{...compactStats(ledgers.challengerV3),tradeList:ledgers.challengerV3.tradeList,equityCurve:ledgers.challengerV3.equityCurve,byAsset:assetBreakdown(ledgers.challengerV3.tradeList)},regime:","challengerV3:{...compactStats(ledgers.challengerV3),tradeList:ledgers.challengerV3.tradeList,equityCurve:ledgers.challengerV3.equityCurve,byAsset:assetBreakdown(ledgers.challengerV3.tradeList)},challengerV31:{...compactStats(ledgers.challengerV31),tradeList:ledgers.challengerV31.tradeList,equityCurve:ledgers.challengerV31.equityCurve,byAsset:assetBreakdown(ledgers.challengerV31.tradeList)},regime:");

if(!s.includes("makeLedger('CHALLENGER_V3_1'"))throw new Error('V3.1 ledger wiring failed');
if(!s.includes("variantStability('CHALLENGER V3.1'"))throw new Error('V3.1 walk-forward wiring failed');
if(!s.includes('challengerV31:{...compactStats'))throw new Error('V3.1 result wiring failed');

fs.writeFileSync(p,s);
console.log('Challenger V3.1 wired into research backtest');
