#!/usr/bin/env node
// MERIDIAN v7.67 — offline portfolio-path replay runner.
import fs from 'node:fs';
import { replayPortfolioPath, sliceRecentWindow } from '../portfolio-path-v767.js';

const args=process.argv.slice(2),valueOf=f=>{const i=args.indexOf(f);return i>=0?args[i+1]:null};
const out=valueOf('--out')||'research/portfolio-path-evidence-v767.json';
const inputs={P0:valueOf('--p0'),P1:valueOf('--p1'),P2:valueOf('--p2'),P3:valueOf('--p3')};
if(!inputs.P0)throw new Error('Missing --p0');
function load(file){const raw=JSON.parse(fs.readFileSync(file,'utf8'));if(Array.isArray(raw))return raw;for(const k of ['rows','samples','cohort','signals'])if(Array.isArray(raw?.[k]))return raw[k];throw new Error(`${file}: expected cohort rows`)}
const reports={};
const p0=load(inputs.P0);
for(const d of [30,60,90])reports[`${d}d`]=replayPortfolioPath(sliceRecentWindow(p0,d));
for(const [name,file] of Object.entries(inputs)){if(!file)continue;reports[name]=replayPortfolioPath(load(file));}
const periods=Object.fromEntries(Object.entries(reports).map(([name,r])=>[name,{baseline:r.baseline,challengerV32:r.challengerV32,opportunity:r.opportunity,comparison:r.comparison,universe:r.universe}]));
const comparable=['P0','P1','P2','P3'].filter(k=>periods[k]);
const summary={periods:comparable.length,v32BetterAvgR:comparable.filter(k=>periods[k].comparison.v32BetterAvgR).length,v32BetterPf:comparable.filter(k=>(periods[k].challengerV32.pf??0)>(periods[k].baseline.pf??0)).length,v32LowerRealizedDD:comparable.filter(k=>(periods[k].challengerV32.maxDrawdownPct??99)<(periods[k].baseline.maxDrawdownPct??99)).length};
summary.avgRWinPct=summary.periods?Math.round(summary.v32BetterAvgR/summary.periods*1000)/10:null;
const payload={schemaVersion:'7.67-PORTFOLIO-PATH-EVIDENCE-V1',generatedAt:new Date().toISOString(),researchOnly:true,executionImpact:false,method:'chronological cohort exit-event replay with identical portfolio gates; V3.2 ranking only uses information available at each sampledAt',drawdownCaveat:'realized-equity DD only; compact cohorts do not contain intratrade mark-to-market paths',periods,summary};
fs.mkdirSync(out.split('/').slice(0,-1).join('/')||'.',{recursive:true});fs.writeFileSync(out,JSON.stringify(payload,null,2)+'\n');
console.log(JSON.stringify({ok:true,out,summary},null,2));
