import fs from 'node:fs';
import {evaluateFundingCarry,FUNDING_CARRY_V1_RULESET} from '../funding-carry-v1.js';

const SPOT='https://api.binance.com',FUT='https://fapi.binance.com',SYMBOLS=['BTCUSDT','ETHUSDT','SOLUSDT'],WINDOWS=[30,60,90],DAY=86400000,HOUR=3600000;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function json(url){let last;for(let i=0;i<5;i++){try{const r=await fetch(url,{headers:{'user-agent':'ACHI-MERIDIAN-FUNDING-RESEARCH/1'}});if(!r.ok)throw new Error(`HTTP ${r.status}`);return await r.json();}catch(e){last=e;await sleep(400*2**i);}}throw last;}
async function klines(base,symbol,start,end){const out=[];let cursor=start;while(cursor<end){const url=`${base}/${base===SPOT?'api/v3':'fapi/v1'}/klines?symbol=${symbol}&interval=1h&startTime=${cursor}&endTime=${end}&limit=1000`,j=await json(url);if(!Array.isArray(j)||!j.length)break;for(const k of j)out.push({ts:+k[6],close:+k[4]});const next=+j.at(-1)[0]+HOUR;if(next<=cursor)break;cursor=next;await sleep(80);}return [...new Map(out.map(x=>[x.ts,x])).values()].sort((a,b)=>a.ts-b.ts);}
async function funding(symbol,start,end){const j=await json(`${FUT}/fapi/v1/fundingRate?symbol=${symbol}&startTime=${start}&endTime=${end}&limit=1000`);return j.map(x=>({ts:+x.fundingTime,rate:+x.fundingRate,markPrice:+x.markPrice}));}

const end=Date.now(),start=end-Math.max(...WINDOWS)*DAY,market={};
for(const symbol of SYMBOLS){console.log(`Loading ${symbol}`);const [spot,perp,rates]=await Promise.all([klines(SPOT,symbol,start-2*HOUR,end),klines(FUT,symbol,start-2*HOUR,end),funding(symbol,start,end)]);market[symbol]={spot,perp,rates};}
const results=[];
for(const days of WINDOWS)for(const symbol of SYMBOLS){const m=market[symbol];results.push(evaluateFundingCarry({symbol,spot:m.spot,perp:m.perp,funding:m.rates,start:end-days*DAY,end,notional:10000,feeBps:5,slippageBps:3}));}
const out={schemaVersion:FUNDING_CARRY_V1_RULESET,generatedAt:new Date().toISOString(),method:'CONTINUOUS_LONG_SPOT_SHORT_PERPETUAL_EQUAL_BASE_QUANTITY',assumptions:{notionalPerLeg:10000,conservativeCapital:20000,feeBpsPerFill:5,slippageBpsPerFill:3,executionLegs:4,noLeverage:true},results};
fs.writeFileSync('research/funding-carry-v1-evidence-r35.json',JSON.stringify(out,null,2));
const money=v=>`${v<0?'-':''}$${Math.abs(v).toFixed(2)}`,pct=v=>`${Number(v).toFixed(3)}%`;
let md=`# MERIDIAN R35 — Funding Carry V1 evidence\n\nGenerated: ${out.generatedAt}\n\nResearch only. No Paper or live execution. Long spot and short USD-M perpetual with equal base quantity. Results include funding, start/end basis change, four fills, 5 bps fee and 3 bps slippage per fill. Return uses conservative capital of $20,000 for $10,000 on each leg.\n\n| Window | Asset | Funding | Basis P&L | Costs | Net | Capital return | Annualized | Decision |\n|---:|---|---:|---:|---:|---:|---:|---:|---|\n`;
for(const x of results)md+=Number.isFinite(x.days)?`| ${Math.round(x.days)}d | ${x.symbol} | ${money(x.fundingIncome)} | ${money(x.basisPnl)} | ${money(x.costs)} | ${money(x.netPnl)} | ${pct(x.returnOnConservativeCapitalPct)} | ${pct(x.annualizedPct)} | ${x.decision} |\n`:`| unavailable | — | — | — | — | — | — | — | ${x.reasons?.[0]||'REJECT'} |\n`;
md+='\nA positive historical window is only a screening result. Prospective Paper eligibility requires positive net carry after costs, adequate margin buffer, a rule for funding reversal, basis divergence limits and no post-hoc asset selection.\n';
fs.writeFileSync('research/funding-carry-v1-evidence-r35.md',md);
console.log(JSON.stringify(out,null,2));
