import {auditSeries} from './market-microstructure-data-v1.js';

export const OKX_MICROSTRUCTURE_V2=Object.freeze({
  instruments:Object.freeze(['BTC-USDT-SWAP','ETH-USDT-SWAP','SOL-USDT-SWAP','XRP-USDT-SWAP','ADA-USDT-SWAP','AVAX-USDT-SWAP','LINK-USDT-SWAP']),
  fundingDays:90,
  flowDays:30,
  hourMs:3600000,
  fundingMinCoverage:.90,
  flowMinCoverage:.95
});

export function baseCurrency(instId){return instId.split('-')[0]}
export function normalizeFunding(xs,{retrievedAt}){return xs.map((x,rawIndex)=>({source:'OKX_PUBLIC',endpointVersion:'api/v5/public/funding-rate-history',instrument:x.instId,eventTime:Number(x.fundingTime),availableAt:Number(x.fundingTime),retrievedAt,rawIndex,fundingRate:Number(x.realizedRate||x.fundingRate),validNumeric:Number.isFinite(Number(x.fundingTime))&&Number.isFinite(Number(x.realizedRate||x.fundingRate))}))}
export function normalizeOpenInterest(xs,{instrument,retrievedAt,hourMs=3600000}){return xs.map((x,rawIndex)=>({source:'OKX_PUBLIC',endpointVersion:'api/v5/rubik/stat/contracts/open-interest-history',instrument,eventTime:Number(x[0]),availableAt:Number(x[0])+hourMs,retrievedAt,rawIndex,openInterest:Number(x[1]),openInterestCcy:Number(x[2]),openInterestUsd:Number(x[3]),validNumeric:x.length>=4&&x.slice(0,4).every(v=>Number.isFinite(Number(v)))}))}
export function normalizeTakerFlow(xs,{instrument,retrievedAt,hourMs=3600000}){return xs.map((x,rawIndex)=>({source:'OKX_PUBLIC',endpointVersion:'api/v5/rubik/stat/taker-volume',instrument,eventTime:Number(x[0]),availableAt:Number(x[0])+hourMs,retrievedAt,rawIndex,sellVolume:Number(x[1]),buyVolume:Number(x[2]),validNumeric:x.length>=3&&x.slice(0,3).every(v=>Number.isFinite(Number(v)))}))}
export function okxAudit(rows,{requestedStart,cutoff,cadenceMs,minCoverage}){return auditSeries(rows.filter(x=>x.eventTime>=requestedStart&&x.eventTime<=cutoff),{requestedStart,cutoff,cadenceMs,minCoverage,maxGapMultiplier:2})}
export function okxFoundationDecision(features={}){const ready=Object.fromEntries(Object.entries(features).map(([key,byInstrument])=>[key,OKX_MICROSTRUCTURE_V2.instruments.every(x=>byInstrument?.[x]?.passed===true)]));return {featureReady:ready,allFeaturesReady:['funding','openInterest','takerFlow'].every(key=>ready[key]===true),alphaEvidence:false,experimentPermitted:false,promotionPermitted:false}}
