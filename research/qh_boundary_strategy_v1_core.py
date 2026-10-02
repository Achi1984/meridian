#!/usr/bin/env python3
"""Pure deterministic core for MERIDIAN Quarter-Hour Boundary Imbalance Strategy V1.

This module implements only the preregistered research mechanics. It has no
network, Paper, live-order, exchange mutation, or portfolio-account mutation path.
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
PRIMARY_HORIZON_EVENTS=48
PRIMARY_COST_RATE=0.0006
LOW_COST_RATE=0.0003
HIGH_COST_RATE=0.0010
MS_DAY=24*60*60*1000

def utc_ms(text:str)->int:
    return int(datetime.fromisoformat(text.replace("Z","+00:00")).timestamp()*1000)

EVALUATION_END_MS=utc_ms("2026-09-01T00:00:00Z")
FINAL_EXECUTABLE_BOUNDARY_MS=EVALUATION_END_MS-QUARTER_MS

BLOCKS=(
    ("B1",utc_ms("2025-01-01T00:00:00Z"),utc_ms("2025-06-01T00:00:00Z")),
    ("B2",utc_ms("2025-06-01T00:00:00Z"),utc_ms("2025-11-01T00:00:00Z")),
    ("B3",utc_ms("2025-11-01T00:00:00Z"),utc_ms("2026-04-01T00:00:00Z")),
    ("B4",utc_ms("2026-04-01T00:00:00Z"),utc_ms("2026-09-01T00:00:00Z")),
)

def signed_direction(is_buyer_maker:bool)->float:
    return -1.0 if is_buyer_maker else 1.0

def normalized_imbalance(signed_qty:float,total_qty:float):
    if total_qty<=0:
        return None
    x=signed_qty/total_qty
    if x>1+1e-12 or x<-1-1e-12:
        raise ValueError("normalized imbalance outside [-1,1]")
    return max(-1.0,min(1.0,x))

def cohort_weight(oi:float,horizon_events:int=PRIMARY_HORIZON_EVENTS)->float:
    if horizon_events<=0:
        raise ValueError("horizon_events must be positive")
    if not math.isfinite(oi) or oi < -1.0-1e-12 or oi > 1.0+1e-12:
        raise ValueError("invalid OI")
    return ASSET_GROSS_CAP*oi/horizon_events

def funding_coincident_boundary(boundary_ms:int)->bool:
    dt=datetime.fromtimestamp(boundary_ms/1000,tz=timezone.utc)
    return dt.minute==0 and dt.second==0 and dt.hour in (0,8,16)

def block_id(ts_ms:int):
    for name,start,end in BLOCKS:
        if start<=ts_ms<end:
            return name
    return None

def max_drawdown(equity_curve):
    peak=None
    worst=0.0
    for x in equity_curve:
        if not math.isfinite(x) or x<=0:
            raise ValueError("equity must stay finite and positive")
        if peak is None or x>peak:
            peak=x
        worst=max(worst,(peak-x)/peak)
    return worst

def profit_factor(daily_pnls):
    pos=sum(x for x in daily_pnls if x>0)
    neg=-sum(x for x in daily_pnls if x<0)
    if neg==0:
        return math.inf if pos>0 else 0.0
    return pos/neg

def distribution(values):
    vals=sorted(float(x) for x in values if math.isfinite(float(x)))
    if not vals:
        return {"count":0,"min":None,"p10":None,"median":None,"p90":None,"max":None,"mean":None}
    def q(p):
        if len(vals)==1:return vals[0]
        pos=(len(vals)-1)*p
        lo=int(math.floor(pos));hi=int(math.ceil(pos))
        if lo==hi:return vals[lo]
        return vals[lo]*(hi-pos)+vals[hi]*(pos-lo)
    return {
        "count":len(vals),"min":vals[0],"p10":q(.10),"median":q(.50),
        "p90":q(.90),"max":vals[-1],"mean":sum(vals)/len(vals)
    }

def evaluate_primary_gate(metrics):
    blocks=metrics["blocks"]
    assets=metrics["assets"]
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
    }
    return {
        "pass":all(gates.values()),
        "gates":gates,
        "positiveAssetCount":positive_assets,
        "positivePnlConcentration":concentration,
        "decision":"STRATEGY_V1_PASS_PAPER_RESEARCH_PROPOSAL_REQUIRED" if all(gates.values()) else "STRATEGY_V1_FAIL"
    }

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
    new_qty=target_notional/price
    return {
        "equityBefore":equity,"markedEquity":marked_equity,"equityAfter":after,
        "pricePnl":price_pnl,"turnoverNotional":turnover,"cost":cost,
        "oldQty":state.qty,"newQty":new_qty,"oldNotional":old_notional,
        "targetNotional":target_notional,"targetWeight":target_weight,
        "price":price
    },AssetState(qty=new_qty,last_mark=price,target_weight=target_weight)

def funding_transition(equity:float,state:AssetState,reference_price:float|None,funding_rate:float):
    if not math.isfinite(funding_rate):raise ValueError("invalid funding rate")
    if reference_price is None:
        if state.qty!=0:
            raise RuntimeError("funding reference price missing with non-zero exposure")
        return {
            "equityBefore":equity,"markedEquity":equity,"equityAfter":equity,
            "pricePnl":0.0,"fundingPnl":0.0,"qty":state.qty,
            "referencePrice":None,"fundingRate":funding_rate
        },state
    if reference_price<=0 or not math.isfinite(reference_price):raise ValueError("invalid funding reference price")
    price_pnl=0.0 if state.last_mark is None else state.qty*(reference_price-state.last_mark)
    marked_equity=equity+price_pnl
    funding_pnl=-state.qty*reference_price*funding_rate
    after=marked_equity+funding_pnl
    if after<=0:raise RuntimeError("non-positive equity after funding")
    return {
        "equityBefore":equity,"markedEquity":marked_equity,"equityAfter":after,
        "pricePnl":price_pnl,"fundingPnl":funding_pnl,
        "qty":state.qty,"referencePrice":reference_price,"fundingRate":funding_rate
    },AssetState(qty=state.qty,last_mark=reference_price,target_weight=state.target_weight)

def build_rebalance_events(shards_by_asset,horizon_events=PRIMARY_HORIZON_EVENTS,suppress_funding_boundaries=False):
    """Translate compact source events into executable rebalances with virtual cohort state."""
    horizon_ms=horizon_events*QUARTER_MS
    out=[]
    diagnostics={}
    for asset in ASSETS:
        rows=[]
        for shard in shards_by_asset.get(asset,[]):
            rows.extend(shard.get("boundaries",[]))
        rows.sort(key=lambda x:x["boundaryMs"])
        cohorts=deque()
        oi_values=[]
        targets=[]
        closed=0
        right_censored=0
        pos=neg=zero=missing=0
        for row in rows:
            t=int(row["boundaryMs"])
            while cohorts and cohorts[0][0]<=t:
                cohorts.popleft();closed+=1
            oi=row.get("oi")
            if oi is None:
                missing+=1
            else:
                oi=float(oi);oi_values.append(oi)
                if oi>0:pos+=1
                elif oi<0:neg+=1
                else:zero+=1
                expiry=t+horizon_ms
                if expiry>FINAL_EXECUTABLE_BOUNDARY_MS:
                    right_censored+=1
                elif not (suppress_funding_boundaries and funding_coincident_boundary(t)):
                    cohorts.append((expiry,cohort_weight(oi,horizon_events)))
            target=sum(x[1] for x in cohorts)
            if abs(target)>ASSET_GROSS_CAP+1e-10:
                raise RuntimeError(f"{asset} target cap exceeded")
            targets.append(abs(target))
            px=row.get("executionPrice")
            xt=row.get("executionTimestampMs")
            if px is not None and xt is not None:
                out.append({
                    "type":"rebalance","ts":int(xt),"boundaryMs":t,"asset":asset,
                    "price":float(px),"targetWeight":target
                })
            elif t==FINAL_EXECUTABLE_BOUNDARY_MS and abs(target)<=1e-12:
                raise RuntimeError(f"{asset} terminal flatten execution unavailable")
        diagnostics[asset]={
            "positiveOiEvents":pos,"negativeOiEvents":neg,"zeroOiEvents":zero,
            "missingSignalEvents":missing,"rightCensoredSignalEvents":right_censored,
            "oiDistribution":distribution(oi_values),
            "absoluteTargetWeightDistribution":distribution(targets),
            "closedCohortEquivalentCount":closed,
            "terminalTargetWeight":targets[-1] if targets else 0.0
        }
    return out,diagnostics

def run_portfolio(shards_by_asset,cost_rate=PRIMARY_COST_RATE,horizon_events=PRIMARY_HORIZON_EVENTS,suppress_funding_boundaries=False):
    rebalances,signal_diag=build_rebalance_events(shards_by_asset,horizon_events,suppress_funding_boundaries)
    ledger=list(rebalances)
    for asset in ASSETS:
        for shard in shards_by_asset.get(asset,[]):
            for f in shard.get("funding",[]):
                ref_price=f.get("referencePrice")
                ref_ts=f.get("referenceTimestampMs")
                ledger.append({
                    "type":"funding","ts":int(f["timestampMs"]),"asset":asset,
                    "rate":float(f["fundingRate"]),"price":None if ref_price is None else float(ref_price),
                    "referenceTimestampMs":None if ref_ts is None else int(ref_ts)
                })
    priority={"funding":0,"rebalance":1}
    ledger.sort(key=lambda x:(x["ts"],priority[x["type"]],x["asset"]))

    states={a:AssetState() for a in ASSETS}
    equity=STARTING_EQUITY
    equity_curve=[equity]
    asset_pnl={a:{"pricePnl":0.0,"fundingPnl":0.0,"transactionCosts":0.0,"netPnl":0.0} for a in ASSETS}
    daily=defaultdict(float)
    block_pnl=defaultdict(float)
    block_start={}
    block_end={}
    turnover=0.0
    rebalance_weight_changes=[]
    side={"longPriceFundingPnl":0.0,"shortPriceFundingPnl":0.0,"flatPriceFundingPnl":0.0,"transactionCosts":0.0}
    prev_ts=None
    exposure_time=0
    gross_time=0.0
    net_time=0.0

    def exposure():
        gross=net=0.0
        if equity<=0:return 0.0,0.0
        for a,s in states.items():
            if s.last_mark is None:continue
            w=(s.qty*s.last_mark)/equity
            gross+=abs(w);net+=w
        return gross,net

    for ev in ledger:
        ts=ev["ts"];asset=ev["asset"];state=states[asset]
        if prev_ts is not None and ts>prev_ts:
            g,n=exposure()
            dt=ts-prev_ts
            gross_time+=g*dt;net_time+=n*dt;exposure_time+=dt
        before=equity
        old_sign=1 if state.qty>0 else (-1 if state.qty<0 else 0)
        if ev["type"]=="funding":
            tr,new_state=funding_transition(equity,state,ev["price"],ev["rate"])
            cost=0.0
            funding=tr["fundingPnl"]
            price_pnl=tr["pricePnl"]
        else:
            tr,new_state=rebalance_transition(equity,state,ev["price"],ev["targetWeight"],cost_rate)
            cost=tr["cost"];funding=0.0;price_pnl=tr["pricePnl"]
            turnover+=tr["turnoverNotional"]
            rebalance_weight_changes.append(tr["turnoverNotional"]/tr["markedEquity"])
        equity=tr["equityAfter"];states[asset]=new_state
        delta=equity-before
        asset_pnl[asset]["pricePnl"]+=price_pnl
        asset_pnl[asset]["fundingPnl"]+=funding
        asset_pnl[asset]["transactionCosts"]+=cost
        asset_pnl[asset]["netPnl"]+=delta
        price_funding=price_pnl+funding
        if old_sign>0:side["longPriceFundingPnl"]+=price_funding
        elif old_sign<0:side["shortPriceFundingPnl"]+=price_funding
        else:side["flatPriceFundingPnl"]+=price_funding
        side["transactionCosts"]+=cost
        day=(ts//MS_DAY)*MS_DAY
        daily[day]+=delta
        bid=block_id(ts)
        if bid:
            if bid not in block_start:block_start[bid]=before
            block_end[bid]=equity
            block_pnl[bid]+=delta
        equity_curve.append(equity)
        prev_ts=ts

    blocks={}
    for name,_,__ in BLOCKS:
        start=block_start.get(name)
        end=block_end.get(name,start)
        pnl=block_pnl.get(name,0.0)
        block_days=[v for d,v in daily.items() if block_id(d)==name]
        blocks[name]={
            "netPnl":pnl,
            "netReturn":(end/start-1.0) if start and end else 0.0,
            "dailyProfitFactor":profit_factor(block_days),
            "dailyObservations":len(block_days)
        }

    gross_price=sum(x["pricePnl"] for x in asset_pnl.values())
    funding_pnl=sum(x["fundingPnl"] for x in asset_pnl.values())
    costs=sum(x["transactionCosts"] for x in asset_pnl.values())
    metrics={
        "startingEquity":STARTING_EQUITY,
        "endingEquity":equity,
        "netReturn":equity/STARTING_EQUITY-1.0,
        "grossPriceReturn":gross_price/STARTING_EQUITY,
        "grossPricePnl":gross_price,
        "fundingPnl":funding_pnl,
        "transactionCosts":costs,
        "maxDrawdown":max_drawdown(equity_curve),
        "dailyProfitFactor":profit_factor(daily.values()),
        "turnoverNotional":turnover,
        "turnoverOnStartingEquity":turnover/STARTING_EQUITY,
        "averageGrossExposure":gross_time/exposure_time if exposure_time else 0.0,
        "averageNetExposure":net_time/exposure_time if exposure_time else 0.0,
        "averageAbsoluteRebalanceSize":sum(rebalance_weight_changes)/len(rebalance_weight_changes) if rebalance_weight_changes else 0.0,
        "rebalanceCount":len(rebalance_weight_changes),
        "closedCohortEquivalentCount":sum(x["closedCohortEquivalentCount"] for x in signal_diag.values()),
        "assets":asset_pnl,
        "blocks":blocks,
        "signalDiagnostics":signal_diag,
        "sideAttribution":side,
        "costRate":cost_rate,
        "horizonEvents":horizon_events,
        "suppressFundingCoincidentBoundaries":suppress_funding_boundaries,
        "executionImpact":False,
        "paperAuthorized":False,
        "liveAuthorized":False,
    }
    metrics["primaryGate"]=evaluate_primary_gate(metrics) if (cost_rate==PRIMARY_COST_RATE and horizon_events==PRIMARY_HORIZON_EVENTS and not suppress_funding_boundaries) else None
    return metrics

def build_full_report(shards_by_asset):
    primary=run_portfolio(shards_by_asset,PRIMARY_COST_RATE,48,False)
    diagnostics={
        "horizon4h":run_portfolio(shards_by_asset,PRIMARY_COST_RATE,16,False),
        "horizon8h":run_portfolio(shards_by_asset,PRIMARY_COST_RATE,32,False),
        "cost3bp":run_portfolio(shards_by_asset,LOW_COST_RATE,48,False),
        "cost10bp":run_portfolio(shards_by_asset,HIGH_COST_RATE,48,False),
        "suppressFundingCoincidentNewCohorts":run_portfolio(shards_by_asset,PRIMARY_COST_RATE,48,True),
    }
    return {
        "schema":1,
        "family":"PERPETUAL-QUARTER-HOUR-BOUNDARY-IMBALANCE-V1",
        "stage":"STRATEGY_V1_RESEARCH_RESULT",
        "ruleset":"QUARTER-HOUR-BOUNDARY-IMBALANCE-STRATEGY-V1-FROZEN",
        "primary":primary,
        "robustnessDiagnostics":diagnostics,
        "executionImpact":False,
        "paperAuthorized":False,
        "liveAuthorized":False,
    }
