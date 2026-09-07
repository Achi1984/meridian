import test from 'node:test';
import assert from 'node:assert/strict';
import {applyPortfolioBudget} from '../hybrid-alpha-portfolio-v7101.js';
const row=(timestamp,symbol,risk)=>({timestamp,symbol,riskMultiplier:risk,grossR:2*risk,costR:.03*risk,netR:1.97*risk});
test('simultaneous risk is capped proportionally at one unit',()=>{const out=applyPortfolioBudget([row('t','A',.8),row('t','B',.4)]);assert.equal(out.reduce((a,x)=>a+x.riskMultiplier,0),1);assert.equal(out[0].portfolioRiskScale,out[1].portfolioRiskScale);assert.equal(out[0].portfolioBundleSize,2)});
test('relative risk is preserved within output precision',()=>{const [a,b]=applyPortfolioBudget([row('t','A',.8),row('t','B',.4)]);assert.ok(Math.abs(a.riskMultiplier/b.riskMultiplier-2)<.01)});
test('small and separate bundles remain unchanged',()=>{const out=applyPortfolioBudget([row('a','A',.6),row('b','B',.7)]);assert.deepEqual(out.map(x=>x.riskMultiplier),[.6,.7]);assert.ok(out.every(x=>!x.portfolioScaled))});
test('opportunity count and risk monotonicity are invariant',()=>{const input=[row('t','A',1),row('t','B',1),row('t','C',.5)],out=applyPortfolioBudget(input);assert.equal(out.length,input.length);assert.ok(out.every((x,i)=>x.riskMultiplier<=input[i].riskMultiplier));assert.ok(out.every(x=>x.portfolioOutgoingRisk<=1))});
