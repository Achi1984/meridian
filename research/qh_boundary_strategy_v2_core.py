#!/usr/bin/env python3
"""Deterministic research-only core for Quarter-Hour Boundary Imbalance Strategy V2.

V2 preserves the V1 rolling target arithmetic but samples that target only at
00:00 / 12:00 UTC and holds it between samples. No network, Paper, live-order,
exchange mutation, or account mutation path exists here.
"""
from __future__ import annotations
from collections import deque, defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone
import math

ASSETS=("BTCUSDT","ETHUSDT","XRPUSDT","SOLUSDT","DOGEUSDT","ADAUSDT")
STARTING_EQUITY=100_000.0
ASSET_GROSS_CAP=1.0/6.0
QUARTER_MS=15*60*1000
ROLLING_EVENTS=48
PRIMARY_COST_RATE=0.0006
LOW_COST_RATE=0.0003
HIGH_COST_RATE=0.0010
MS_DAY=24*60*60*1000
V1_TURNOVER_ON_STARTING_EQUITY=617.9115130049245
V2_MAX_TURNOVER_ON_STARTING_EQUITY=V1_TURNOVER_ON_STARTING_EQUITY*0.10
V1_REBALANCE_COUNT=350_202

def utc_ms(text:str)->int:
    return int(datetime.fromisoformat(text.replace("Z","+00:00")).timestamp()*1000)

EVALUATION_END_MS=utc_ms("2026-09-01T00:00:00Z")
FINAL_EXECUTABLE_BOUNDARY_MS=EVALUATION_END_MS-QUARTER_MS
FIRST_V2_SAMPLE_MS=utc_ms("2025-01-01T12:00:00Z")
FINAL_V2_FLATTEN_BOUNDARY_MS=utc_ms("2026-08-31T12:00:00Z")

BLOCKS=(
    ("B1",utc_ms("2025-01-01T00:00:00Z"),utc_ms("2025-06-01T00:00:00Z")),
    ("B2",utc_ms("2025-06-01T00:00:00Z"),utc_ms("2025-11-01T00:00:00Z")),
    ("B3",utc_ms("2025-11-01T00:00:00Z"),utc_ms("2026-04-01T00:00:00Z")),
    ("B4",utc_ms("2026-04-01T00:00:00Z"),utc_ms("2026-09-01T00:00:00Z")),
)

def block_id(ts_ms:int):
    for name,start,end in BLOCKS:
        if start<=ts_ms<end:return name
    return None

def is_sample_boundary(ts_ms:int)->bool:
    dt=datetime.fromtimestamp(ts_ms/1000,tz=timezone.utc)
    return dt.minute==0 and dt.second==0 and dt.hour in (0,12)

def cohort_weight(oi:float)->float:
    if not math.isfinite(oi) or oi < -1.0-1e-12 or oi > 1.0+1e-12:
        raise ValueError("invalid OI")
    return ASSET_GROSS_CAP*oi/ROLLING_EVENTS

def max_drawdown(equity_curve):
    peak=None;worst=0.0
    for x in equity_curve:
        if not math.isfinite(x) or x<=0:raise ValueError("equity must stay finite and positive")
        if peak is None or x>peak:peak=x
        worst=max(worst,(peak-x)/peak)
    return worst

def profit_factor(daily_pnls):
    pos=sum(x for x in daily_pnls if x>0)
    neg=-sum(x for x in daily_pnls if x<0)
    if neg==0:return math.inf if pos>0 else 0.0
    return pos/neg

def distribution(values):
    vals=sorted(float(x) for x in values if math.isfinite(float(x)))
    if not vals:return {"count":0,"min":None,"p10":None,"median":None,"p90":None,"max":None,"mean":None}
    def q(p):
        if len(vals)==1:return vals[0]
        pos=(len(vals)-1)*p;lo=int(math.floor(pos));hi=int(math.ceil(pos))
        if lo==hi:return vals[lo]
        return vals[lo]*(hi-pos)+vals[hi]*(pos-lo)
    return {"count":len(vals),"min":vals[0],"p10":q(.10),"median":q(.50),"p90":q(.90),"max":vals[-1],"mean":sum(vals)/len(vals)}

@dataclass
class AssetState:
    qty:float=0.0
    last_mark:float|None=None
    target_weight:float=0.0

def rebalance_transition(equity:float,state:AssetState,price:float,target_weight:float,cost_rate:float):
    if price<=0 or not math.isfinite(price):raise ValueError("invalid rebalance price")
    if abs(target_weight)>ASSET_GROSS_CAP+1e-10:raise ValueError("asset gross cap exceeded")
    if cost_rate<0:raise ValueError("negative cost")
    price_pnl=0.0 if state.last_mark is None else state.qty*(price-state.last_mark)
    marked_equity=equity+price_pnl
    if marked_equity<=0:raise RuntimeError("non-positive marked equity")
    old_notional=state.qty*price
    target_notional=target_weight*marked_equity
    turnover=abs(target_notional-old_notional)
    cost=turnover*cost_rate
    after=marked_equity-cost
    if after<=0:raise RuntimeError("non-positive equity after costs")
    return {
        "equityBefore":equity,"markedEquity":marked_equity,"equityAfter":after,
        "pricePnl":price_pnl,"turnoverNotional":turnover,"cost":cost,
        "oldQty":state.qty,"newQty":target_notional/price,"oldNotional":old_notional,
        "targetNotional":target_notional,"targetWeight":target_weight,"price":price
    },AssetState(qty=target_notional/price,last_mark=price,target_weight=target_weight)

def funding_transition(equity:float,state:AssetState,reference_price:float|None,funding_rate:float):
    if not math.isfinite(funding_rate):raise ValueError("invalid funding rate")
    if reference_price is None:
        if state.qty!=0:raise RuntimeError("funding reference price missing with non-zero exposure")
        return {"equityBefore":equity,"markedEquity":equity,"equityAfter":equity,"pricePnl":0.0,"fundingPnl":0.0,"qty":0.0,"referencePrice":None,"fundingRate":funding_rate},state
    if reference_price<=0 or not math.isfinite(reference_price):raise ValueError("invalid funding reference price")
    price_pnl=0.0 if state.last_mark is None else state.qty*(reference_price-state.last_mark)
    marked_equity=equity+price_pnl
    funding_pnl=-state.qty*reference_price*funding_rate
    after=marked_equity+funding_pnl
    if after<=0:raise RuntimeError("non-positive equity after funding")
    return {
        "equityBefore":equity,"markedEquity":marked_equity,"equityAfter":after,
        "pricePnl":price_pnl,"fundingPnl":funding_pnl,"qty":state.qty,
        "referencePrice":reference_price,"fundingRate":funding_rate
    },AssetState(qty=state.qty,last_mark=reference_price,target_weight=state.target_weight)

def evaluate_dev_gate(metrics):
    blocks=metrics["blocks"];assets=metrics["assets"]
    positive_assets=sum(1 for x in assets.values() if x["netPnl"]>0)
    positive_total=sum(max(0.0,x["netPnl"]) for x in assets.values())
    concentration=(max((max(0.0,x["netPnl"]) for x in assets.values()),default=0.0)/positive_total) if positive_total>0 else math.inf
    gates={
        "fullWindowNetReturnPositive":metrics["netReturn"]>0,
        "maxDrawdownBelow15Pct":metrics["maxDrawdown"]<0.15,
        "atLeast3Of4BlocksPositive":sum(1 for x in blocks.values() if x["netReturn"]>0)>=3,
        "finalBlockB4Positive":blocks["B4"]["netReturn"]>0,
        "atLeast4Of6AssetsPositive":positive_assets>=4,
        "singleAssetPositivePnlConcentrationAtMost40Pct":concentration<=0.40,
        "turnoverAtLeast90PctBelowV1":metrics["turnoverOnStartingEquity"]<=V2_MAX_TURNOVER_ON_STARTING_EQUITY,
    }
    passed=all(gates.values())
    return {
        "pass":passed,"gates":gates,"positiveAssetCount":positive_assets,
        "positivePnlConcentration":concentration,
        "v1TurnoverOnStartingEquity":V1_TURNOVER_ON_STARTING_EQUITY,
        "maxAllowedTurnoverOnStartingEquity":V2_MAX_TURNOVER_ON_STARTING_EQUITY,
        "decision":"STRATEGY_V2_DEV_PASS_HOLDOUT_REQUIRED" if passed else "STRATEGY_V2_DEV_FAIL"
    }

def build_sample_hold_rebalance_events(shards_by_asset):
    out=[];diagnostics={}
    horizon_ms=ROLLING_EVENTS*QUARTER_MS
    for asset in ASSETS:
        rows=[]
        for shard in shards_by_asset.get(asset,[]):rows.extend(shard.get("boundaries",[]))
        rows.sort(key=lambda x:x["boundaryMs"])
        if not rows:
            diagnostics[asset]={
                "positiveOiEvents":0,"negativeOiEvents":0,"zeroOiEvents":0,
                "missingSignalEvents":0,"rightCensoredSignalEvents":0,
                "oiDistribution":distribution([]),
                "sampledAbsoluteTargetWeightDistribution":distribution([]),
                "scheduledSampleCount":0,"warmupSampleCount":0,
                "skippedExecutionReferences":0,"executableSampleCount":0,
                "terminalTargetWeight":0.0
            }
            continue
        cohorts=deque()
        targets=[];all_oi=[]
        pos=neg=zero=missing=right_censored=0
        scheduled=warmup=skipped=executable=0
        terminal_target=None
        for row in rows:
            t=int(row["boundaryMs"])
            while cohorts and cohorts[0][0]<=t:cohorts.popleft()
            oi=row.get("oi")
            if oi is None:
                missing+=1
            else:
                oi=float(oi);all_oi.append(oi)
                if oi>0:pos+=1
                elif oi<0:neg+=1
                else:zero+=1
                expiry=t+horizon_ms
                if expiry>FINAL_EXECUTABLE_BOUNDARY_MS:
                    right_censored+=1
                else:
                    cohorts.append((expiry,cohort_weight(oi)))
            if not is_sample_boundary(t):continue
            scheduled+=1
            if t<FIRST_V2_SAMPLE_MS:
                warmup+=1
                continue
            target=0.0 if t==FINAL_V2_FLATTEN_BOUNDARY_MS else sum(x[1] for x in cohorts)
            if t>FINAL_V2_FLATTEN_BOUNDARY_MS:
                continue
            if abs(target)>ASSET_GROSS_CAP+1e-10:raise RuntimeError(f"{asset} sampled target cap exceeded")
            targets.append(abs(target));terminal_target=target
            px=row.get("executionPrice");xt=row.get("executionTimestampMs")
            if px is None or xt is None:
                skipped+=1
                if t==FINAL_V2_FLATTEN_BOUNDARY_MS:
                    raise RuntimeError(f"{asset} terminal flatten execution unavailable")
                continue
            executable+=1
            out.append({
                "type":"rebalance","ts":int(xt),"boundaryMs":t,"asset":asset,
                "price":float(px),"targetWeight":target
            })
        if terminal_target is None or abs(terminal_target)>1e-12:
            raise RuntimeError(f"{asset} terminal sampled target not flat")
        diagnostics[asset]={
            "positiveOiEvents":pos,"negativeOiEvents":neg,"zeroOiEvents":zero,
            "missingSignalEvents":missing,"rightCensoredSignalEvents":right_censored,
            "oiDistribution":distribution(all_oi),
            "sampledAbsoluteTargetWeightDistribution":distribution(targets),
            "scheduledSampleCount":scheduled,"warmupSampleCount":warmup,
            "skippedExecutionReferences":skipped,"executableSampleCount":executable,
            "terminalTargetWeight":terminal_target
        }
    return out,diagnostics

def run_portfolio(shards_by_asset,cost_rate=PRIMARY_COST_RATE):
    rebalances,signal_diag=build_sample_hold_rebalance_events(shards_by_asset)
    ledger=list(rebalances)
    for asset in ASSETS:
        for shard in shards_by_asset.get(asset,[]):
            for f in shard.get("funding",[]):
                ref=f.get("referencePrice");ref_ts=f.get("referenceTimestampMs")
                ledger.append({
                    "type":"funding","ts":int(f["timestampMs"]),"asset":asset,
                    "rate":float(f["fundingRate"]),"price":None if ref is None else float(ref),
                    "referenceTimestampMs":None if ref_ts is None else int(ref_ts)
                })
    priority={"funding":0,"rebalance":1}
    ledger.sort(key=lambda x:(x["ts"],priority[x["type"]],x["asset"]))

    states={a:AssetState() for a in ASSETS}
    equity=STARTING_EQUITY;equity_curve=[equity]
    asset_pnl={a:{"pricePnl":0.0,"fundingPnl":0.0,"transactionCosts":0.0,"netPnl":0.0} for a in ASSETS}
    daily=defaultdict(float);block_pnl=defaultdict(float);block_start={};block_end={}
    turnover=0.0;rebalance_weight_changes=[]
    side={"longPriceFundingPnl":0.0,"shortPriceFundingPnl":0.0,"flatPriceFundingPnl":0.0,"transactionCosts":0.0}
    prev_ts=None;exposure_time=0;gross_time=0.0;net_time=0.0

    def exposure():
        gross=net=0.0
        if equity<=0:return 0.0,0.0
        for s in states.values():
            if s.last_mark is None:continue
            w=(s.qty*s.last_mark)/equity;gross+=abs(w);net+=w
        return gross,net

    for ev in ledger:
        ts=ev["ts"];asset=ev["asset"];state=states[asset]
        if prev_ts is not None and ts>prev_ts:
            g,n=exposure();dt=ts-prev_ts;gross_time+=g*dt;net_time+=n*dt;exposure_time+=dt
        before=equity;old_sign=1 if state.qty>0 else (-1 if state.qty<0 else 0)
        if ev["type"]=="funding":
            tr,new_state=funding_transition(equity,state,ev["price"],ev["rate"])
            cost=0.0;funding=tr["fundingPnl"];price_pnl=tr["pricePnl"]
        else:
            tr,new_state=rebalance_transition(equity,state,ev["price"],ev["targetWeight"],cost_rate)
            cost=tr["cost"];funding=0.0;price_pnl=tr["pricePnl"]
            turnover+=tr["turnoverNotional"]
            rebalance_weight_changes.append(tr["turnoverNotional"]/tr["markedEquity"])
        equity=tr["equityAfter"];states[asset]=new_state
        delta=equity-before
        asset_pnl[asset]["pricePnl"]+=price_pnl;asset_pnl[asset]["fundingPnl"]+=funding
        asset_pnl[asset]["transactionCosts"]+=cost;asset_pnl[asset]["netPnl"]+=delta
        pf=price_pnl+funding
        if old_sign>0:side["longPriceFundingPnl"]+=pf
        elif old_sign<0:side["shortPriceFundingPnl"]+=pf
        else:side["flatPriceFundingPnl"]+=pf
        side["transactionCosts"]+=cost
        daily[(ts//MS_DAY)*MS_DAY]+=delta
        bid=block_id(ts)
        if bid:
            if bid not in block_start:block_start[bid]=before
            block_end[bid]=equity;block_pnl[bid]+=delta
        equity_curve.append(equity);prev_ts=ts

    blocks={}
    for name,_,__ in BLOCKS:
        start=block_start.get(name);end=block_end.get(name,start);pnl=block_pnl.get(name,0.0)
        days=[v for d,v in daily.items() if block_id(d)==name]
        blocks[name]={
            "netPnl":pnl,"netReturn":(end/start-1.0) if start and end else 0.0,
            "dailyProfitFactor":profit_factor(days),"dailyObservations":len(days)
        }

    gross_price=sum(x["pricePnl"] for x in asset_pnl.values())
    funding_pnl=sum(x["fundingPnl"] for x in asset_pnl.values())
    costs=sum(x["transactionCosts"] for x in asset_pnl.values())
    metrics={
        "startingEquity":STARTING_EQUITY,"endingEquity":equity,
        "netReturn":equity/STARTING_EQUITY-1.0,
        "grossPriceReturn":gross_price/STARTING_EQUITY,"grossPricePnl":gross_price,
        "fundingPnl":funding_pnl,"transactionCosts":costs,
        "maxDrawdown":max_drawdown(equity_curve),"dailyProfitFactor":profit_factor(daily.values()),
        "turnoverNotional":turnover,"turnoverOnStartingEquity":turnover/STARTING_EQUITY,
        "turnoverReductionVsV1":1.0-(turnover/STARTING_EQUITY)/V1_TURNOVER_ON_STARTING_EQUITY,
        "averageGrossExposure":gross_time/exposure_time if exposure_time else 0.0,
        "averageNetExposure":net_time/exposure_time if exposure_time else 0.0,
        "averageAbsoluteRebalanceSize":sum(rebalance_weight_changes)/len(rebalance_weight_changes) if rebalance_weight_changes else 0.0,
        "rebalanceCount":len(rebalance_weight_changes),
        "rebalanceCountReductionVsV1":1.0-len(rebalance_weight_changes)/V1_REBALANCE_COUNT,
        "assets":asset_pnl,"blocks":blocks,"signalDiagnostics":signal_diag,
        "sideAttribution":side,"costRate":cost_rate,
        "executionImpact":False,"paperAuthorized":False,"liveAuthorized":False
    }
    metrics["developmentGate"]=evaluate_dev_gate(metrics) if cost_rate==PRIMARY_COST_RATE else None
    return metrics

def build_full_report(shards_by_asset):
    primary=run_portfolio(shards_by_asset,PRIMARY_COST_RATE)
    return {
        "schema":1,
        "family":"PERPETUAL-QUARTER-HOUR-BOUNDARY-IMBALANCE-V2",
        "stage":"STRATEGY_V2_DEVELOPMENT_RESULT",
        "ruleset":"QUARTER-HOUR-BOUNDARY-IMBALANCE-STRATEGY-V2-SAMPLE-HOLD-FROZEN",
        "primary":primary,
        "robustnessDiagnostics":{
            "cost3bp":run_portfolio(shards_by_asset,LOW_COST_RATE),
            "cost10bp":run_portfolio(shards_by_asset,HIGH_COST_RATE),
        },
        "v1NegativeControl":{
            "decision":"STRATEGY_V1_FAIL",
            "turnoverOnStartingEquity":V1_TURNOVER_ON_STARTING_EQUITY,
            "rebalanceCount":V1_REBALANCE_COUNT
        },
        "executionImpact":False,"paperAuthorized":False,"liveAuthorized":False
    }
