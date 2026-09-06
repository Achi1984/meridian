import test from 'node:test';
import assert from 'node:assert/strict';
import {OKX_MICROSTRUCTURE_V2 as C,normalizeFunding,normalizeOpenInterest,normalizeTakerFlow,okxAudit,okxFoundationDecision} from '../market-microstructure-okx-v2.js';

const H=3600000;
test('normalizes OKX funding without inventing a value',()=>{const [x]=normalizeFunding([{instId:'BTC-USDT-SWAP',fundingTime:'1000',fundingRate:'0.001',realizedRate:''}],{retrievedAt:2000});assert.equal(x.fundingRate,.001);assert.equal(x.validNumeric,true)});
test('preserves native OI and separate taker sides',()=>{const [oi]=normalizeOpenInterest([['0','1','2','3']],{instrument:'BTC-USDT-SWAP',retrievedAt:1}),[flow]=normalizeTakerFlow([['0','4','5']],{instrument:'BTC-USDT-SWAP',retrievedAt:1});assert.equal(oi.openInterestUsd,3);assert.equal(flow.sellVolume,4);assert.equal(flow.buyVolume,5)});
test('hourly gaps fail the locked gate',()=>{const rows=Array.from({length:23},(_,i)=>({eventTime:(i+(i>10?2:0))*H,validNumeric:true})),x=okxAudit(rows,{requestedStart:0,cutoff:24*H,cadenceMs:H,minCoverage:.90});assert.equal(x.gate.maxGap,false);assert.equal(x.passed,false)});
test('partial universe cannot authorize an experiment',()=>{const features={funding:Object.fromEntries(C.instruments.slice(0,6).map(x=>[x,{passed:true}]))},x=okxFoundationDecision(features);assert.equal(x.featureReady.funding,false);assert.equal(x.experimentPermitted,false);assert.equal(x.promotionPermitted,false)});
