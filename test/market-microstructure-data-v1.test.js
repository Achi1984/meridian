import test from 'node:test';
import assert from 'node:assert/strict';
import {MICROSTRUCTURE_V1,auditSeries,foundationDecision} from '../market-microstructure-data-v1.js';

const H=3600000,rows=n=>Array.from({length:n},(_,i)=>({eventTime:i*H,validNumeric:true,value:i}));
test('complete hourly series passes without fabrication',()=>{const x=auditSeries(rows(24),{requestedStart:0,cutoff:23*H,cadenceMs:H,minCoverage:.95});assert.equal(x.passed,true);assert.equal(x.uniqueRows,24);assert.equal(x.duplicates,0)});
test('duplicate and invalid observations fail explicitly',()=>{const xs=[...rows(24),{eventTime:2*H,validNumeric:true},{eventTime:25*H,validNumeric:false}],x=auditSeries(xs,{requestedStart:0,cutoff:23*H,cadenceMs:H,minCoverage:.95});assert.equal(x.passed,false);assert.equal(x.duplicates,1);assert.equal(x.invalidRows,1)});
test('partial universe never becomes foundation-ready',()=>{const good={passed:true},features={funding:Object.fromEntries(MICROSTRUCTURE_V1.symbols.slice(0,6).map(s=>[s,good]))};const x=foundationDecision(features);assert.equal(x.featureReady.funding,false);assert.equal(x.experimentPermitted,false);assert.equal(x.promotionPermitted,false)});
