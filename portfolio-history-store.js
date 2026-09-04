// MERIDIAN v7.64 — Canonical Portfolio History
// Private PostgreSQL persistence for one portfolio valuation basis.

import { canonicalPortfolioSnapshot } from './portfolio-data-contract.js';

export const PORTFOLIO_HISTORY_VERSION='7.64-CANONICAL-PORTFOLIO-HISTORY-V1';
const num=v=>Number.isFinite(Number(v))?Number(v):null;

export function historySnapshot(data={},opts={}){
  const base=canonicalPortfolioSnapshot(data,opts.timestamp??Date.now());
  const cumulative=num(opts.cumulativeCashflowUsd??data?.portfolio?.cumulativeCashflowUsd);
  return{
    version:PORTFOLIO_HISTORY_VERSION,
    timestamp:base.timestamp,
    spotUsd:base.spotUsd,
    tradingUsd:base.tradingUsd,
    totalUsd:base.totalUsd,
    cashflowAdjustedTotalUsd:cumulative==null?null:Math.round((base.totalUsd-cumulative)*100)/100,
    cumulativeCashflowUsd:cumulative,
    sourceRevision:Number.isInteger(data?.privateRevision)?data.privateRevision:null,
    sourceStatus:base.sourceStatus
  };
}

export async function ensurePortfolioHistorySchema(db){
  if(!db)return false;
  await db.query(`CREATE TABLE IF NOT EXISTS meridian_portfolio_history(
    id BIGSERIAL PRIMARY KEY,
    captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    spot_usd DOUBLE PRECISION NOT NULL,
    trading_usd DOUBLE PRECISION NOT NULL,
    total_usd DOUBLE PRECISION NOT NULL,
    cashflow_adjusted_total_usd DOUBLE PRECISION NULL,
    cumulative_cashflow_usd DOUBLE PRECISION NULL,
    source_revision INTEGER NULL,
    source_status JSONB NOT NULL DEFAULT '{}'::jsonb
  )`);
  await db.query('CREATE INDEX IF NOT EXISTS meridian_portfolio_history_captured_idx ON meridian_portfolio_history(captured_at)');
  return true;
}

export async function appendPortfolioHistory(db,data={},opts={}){
  if(!db)return{ok:false,reason:'NO_DATABASE'};
  const s=historySnapshot(data,opts);
  if(!(s.totalUsd>=0))return{ok:false,reason:'INVALID_TOTAL'};
  const dedupeMs=Math.max(0,Number(opts.dedupeMs??5*60*1000)||0);
  const latest=await db.query(`SELECT captured_at,spot_usd,trading_usd,total_usd,cashflow_adjusted_total_usd
    FROM meridian_portfolio_history ORDER BY captured_at DESC LIMIT 1`);
  const row=latest.rows?.[0];
  if(row){
    const age=s.timestamp-Date.parse(row.captured_at);
    const same=Math.abs(Number(row.spot_usd)-s.spotUsd)<0.01&&Math.abs(Number(row.trading_usd)-s.tradingUsd)<0.01&&Math.abs(Number(row.total_usd)-s.totalUsd)<0.01;
    if(same&&Number.isFinite(age)&&age>=0&&age<dedupeMs)return{ok:true,inserted:false,reason:'UNCHANGED_WITHIN_DEDUPE_WINDOW',snapshot:s};
  }
  await db.query(`INSERT INTO meridian_portfolio_history(
      captured_at,spot_usd,trading_usd,total_usd,cashflow_adjusted_total_usd,cumulative_cashflow_usd,source_revision,source_status)
    VALUES(to_timestamp($1/1000.0),$2,$3,$4,$5,$6,$7,$8::jsonb)`,[
      s.timestamp,s.spotUsd,s.tradingUsd,s.totalUsd,s.cashflowAdjustedTotalUsd,s.cumulativeCashflowUsd,s.sourceRevision,JSON.stringify(s.sourceStatus)
    ]);
  return{ok:true,inserted:true,snapshot:s};
}

export function normalizeHistoryRows(rows=[]){
  return rows.map(r=>({
    timestamp:new Date(r.captured_at).getTime(),
    spotUsd:Number(r.spot_usd),
    tradingUsd:Number(r.trading_usd),
    totalUsd:Number(r.total_usd),
    cashflowAdjustedTotalUsd:r.cashflow_adjusted_total_usd==null?null:Number(r.cashflow_adjusted_total_usd),
    cumulativeCashflowUsd:r.cumulative_cashflow_usd==null?null:Number(r.cumulative_cashflow_usd),
    sourceRevision:r.source_revision==null?null:Number(r.source_revision),
    sourceStatus:r.source_status||{}
  })).filter(x=>Number.isFinite(x.timestamp)&&Number.isFinite(x.totalUsd));
}

export async function readPortfolioHistory(db,opts={}){
  if(!db)return{version:PORTFOLIO_HISTORY_VERSION,source:'NO_DATABASE',points:[]};
  const now=Number(opts.now??Date.now());
  const rangeMs=Math.min(366*86400000,Math.max(60*60*1000,Number(opts.rangeMs??24*60*60*1000)||24*60*60*1000));
  const limit=Math.min(5000,Math.max(2,Number(opts.limit??1500)||1500));
  const r=await db.query(`SELECT captured_at,spot_usd,trading_usd,total_usd,cashflow_adjusted_total_usd,cumulative_cashflow_usd,source_revision,source_status
    FROM meridian_portfolio_history
    WHERE captured_at>=to_timestamp($1/1000.0) AND captured_at<=to_timestamp($2/1000.0)
    ORDER BY captured_at ASC LIMIT $3`,[now-rangeMs,now,limit]);
  return{version:PORTFOLIO_HISTORY_VERSION,source:'POSTGRES_CANONICAL_HISTORY',generatedAt:new Date(now).toISOString(),rangeMs,points:normalizeHistoryRows(r.rows||[])};
}
