"""Frozen Low-Volatility Rank-Weighted V2 Development engine.

Research only. Reuses the exact frozen Low-Volatility V1 feature and adds one
predeclared continuous rank-weighted, dollar-neutral portfolio construction.
No Holdout evaluator, Paper execution, or live execution is present here.
"""
from __future__ import annotations

from math import isfinite,sqrt
from statistics import mean,stdev
from pathlib import Path
import hashlib

import cross_sectional_low_volatility_v1 as parent

RULESET="LOW-VOLATILITY-RANK-WEIGHTED-V2-FROZEN"
PARENT_V1_ENGINE_BLOB="d161b6b4553d5a18fc7064570f4a4e956178d0c9"

ASSETS=parent.ASSETS
REQUIRED_ASSETS=12
HOUR=parent.HOUR
WEEK=parent.WEEK

DEVELOPMENT_START=parent.DISCOVERY_START
DEVELOPMENT_END=parent.DISCOVERY_END
DEVELOPMENT_EXPECTED_PERIODS=48

# Seal only; no Holdout evaluator exists in V2 Development.
HOLDOUT_START=parent.HOLDOUT_START
HOLDOUT_END=parent.HOLDOUT_END
HOLDOUT_EXPECTED_PERIODS=34

BASE_COST_BPS=10.0
STRESS_COST_BPS=20.0
GROSS_TARGET=1.0
MAX_NET_ABS=1e-12
NW_LAG=4
ONE_SIDED_T_MIN=1.645
BLOCKS=4
MIN_POSITIVE_BLOCKS=3

MIN_PROFIT_FACTOR=1.15
MIN_SHARPE=0.75
MAX_DRAWDOWN_PCT=20.0

# Binance Vision funding settlement timestamps can differ from their nominal
# interval grid by a few milliseconds. This tolerance is coverage-validation
# metadata only: it does not change which rows are included in (t, t+7d].
FUNDING_TIME_TOLERANCE_MS=1000

PASS_DECISION="DEVELOPMENT_PASS_HOLDOUT_REQUIRED"
FAIL_DECISION="DEVELOPMENT_FAIL_RESEARCH_STOP"


def git_blob_sha(path):
    body=Path(path).read_bytes()
    return hashlib.sha1(f"blob {len(body)}\0".encode()+body).hexdigest()


def _finite(v):
    x=float(v)
    if not isfinite(x):
        raise ValueError("NONFINITE_VALUE")
    return x


class FundingSeries:
    """Frozen public funding rows: [timestamp_ms, interval_hours, rate]."""
    def __init__(self,asset,rows):
        self.asset=asset
        self.rows=[]
        last=None
        for row in rows:
            if len(row)<3:
                raise ValueError(f"{asset}:MALFORMED_FUNDING")
            t=int(row[0]);interval=int(float(row[1]));rate=_finite(row[2])
            if interval<=0 or interval>24:
                raise ValueError(f"{asset}:INVALID_FUNDING_INTERVAL")
            if last is not None and t<=last:
                raise ValueError(f"{asset}:NONMONOTONIC_FUNDING")
            self.rows.append((t,interval,rate))
            last=t

    def sum_for_hold(self,start,end):
        selected=[x for x in self.rows if start<x[0]<=end]
        if not selected:
            raise ValueError(f"{self.asset}:MISSING_FUNDING_COVERAGE")

        first_t,first_int,_=selected[0]
        if first_t-start>first_int*HOUR+FUNDING_TIME_TOLERANCE_MS:
            raise ValueError(f"{self.asset}:FUNDING_HEAD_GAP")

        for prev,curr in zip(selected,selected[1:]):
            gap=curr[0]-prev[0]
            allowed=max(prev[1],curr[1])*HOUR
            if gap<=0 or gap>allowed+FUNDING_TIME_TOLERANCE_MS:
                raise ValueError(f"{self.asset}:FUNDING_INTERNAL_GAP")

        last_t,last_int,_=selected[-1]
        tail=end-last_t
        if tail<0 or tail>last_int*HOUR+FUNDING_TIME_TOLERANCE_MS:
            raise ValueError(f"{self.asset}:FUNDING_TAIL_GAP")

        return sum(x[2] for x in selected)


def prepare_dataset(raw_by_asset):
    if set(raw_by_asset)!=set(ASSETS):
        raise ValueError("ASSET_UNIVERSE_MISMATCH")
    price=parent.prepare_dataset(raw_by_asset)
    funding={}
    for asset in ASSETS:
        rows=raw_by_asset[asset].get("funding",[])
        funding[asset]=FundingSeries(asset,rows)
    return price,funding


def rank_weights(signals):
    if set(signals)!=set(ASSETS):
        raise ValueError("SIGNAL_UNIVERSE_MISMATCH")
    values=[_finite(signals[a]) for a in ASSETS]
    ranks=parent.average_ranks(values)
    midpoint=(REQUIRED_ASSETS+1)/2.0
    centered={a:r-midpoint for a,r in zip(ASSETS,ranks)}
    denom=sum(abs(x) for x in centered.values())
    if denom<=0:
        raise ValueError("DEGENERATE_RANK_CROSS_SECTION")
    weights={a:centered[a]/denom for a in ASSETS}
    gross=sum(abs(x) for x in weights.values())
    net=sum(weights.values())
    if abs(gross-GROSS_TARGET)>1e-12:
        raise ValueError("GROSS_EXPOSURE_NOT_ONE")
    if abs(net)>MAX_NET_ABS:
        raise ValueError("NET_EXPOSURE_NOT_ZERO")
    return weights


def turnover(prev,new):
    return sum(abs(new.get(a,0.0)-prev.get(a,0.0)) for a in ASSETS)


def period_row(price,funding,t,prev,cost_bps):
    signals={}
    outcomes={}
    funding_sums={}
    for asset in ASSETS:
        signals[asset]=_finite(price[asset].lowvol_signal(t))
        outcomes[asset]=_finite(price[asset].entry_exit_return(t))
        funding_sums[asset]=_finite(funding[asset].sum_for_hold(t,t+WEEK))

    weights=rank_weights(signals)
    price_contrib={a:weights[a]*outcomes[a] for a in ASSETS}
    funding_contrib={a:-weights[a]*funding_sums[a] for a in ASSETS}
    tr=turnover(prev,weights)
    cost=tr*cost_bps/10000.0
    cost_attr={a:-abs(weights[a]-prev.get(a,0.0))*cost_bps/10000.0 for a in ASSETS}
    attr={a:price_contrib[a]+funding_contrib[a]+cost_attr[a] for a in ASSETS}

    p=sum(price_contrib.values())
    f=sum(funding_contrib.values())
    gross=sum(abs(x) for x in weights.values())
    netexp=sum(weights.values())
    rank_ic=parent.spearman([signals[a] for a in ASSETS],[outcomes[a] for a in ASSETS])

    return {
        "t":int(t),
        "eligibleAssets":REQUIRED_ASSETS,
        "weights":weights,
        "grossExposure":gross,
        "netExposure":netexp,
        "rankIc":rank_ic,
        "price":p,
        "funding":f,
        "turnover":tr,
        "cost":cost,
        "net":p+f-cost,
        "attr":attr,
    }


def terminal_close(prev,cost_bps):
    tr=sum(abs(prev.get(a,0.0)) for a in ASSETS)
    cost=tr*cost_bps/10000.0
    attr={a:-abs(prev.get(a,0.0))*cost_bps/10000.0 for a in ASSETS}
    return tr,cost,attr


def _compound(rs):
    equity=1.0
    for r in rs:
        equity*=1.0+r
    return equity-1.0


def _profit_factor(rs):
    gains=sum(x for x in rs if x>0)
    losses=-sum(x for x in rs if x<0)
    if losses>0:return gains/losses
    return 99.0 if gains>0 else 0.0


def _sharpe(rs):
    if len(rs)<2:return 0.0
    sd=stdev(rs)
    if sd>0:return mean(rs)/sd*sqrt(52.0)
    return 99.0 if mean(rs)>0 else 0.0


def _max_drawdown(rs):
    equity=1.0;peak=1.0;worst=0.0
    for r in rs:
        equity*=1.0+r
        peak=max(peak,equity)
        if peak>0:
            worst=max(worst,(peak-equity)/peak)
    return worst


def _blocks(rs,parts=BLOCKS):
    out=[]
    n=len(rs)
    for i in range(parts):
        a=n*i//parts
        b=n*(i+1)//parts
        out.append(_compound(rs[a:b]) if b>a else 0.0)
    return out


def run_method(price,funding,cost_bps):
    prev={}
    weeks=[]
    asset_attr={a:0.0 for a in ASSETS}

    for t in parent.weekly_anchors(DEVELOPMENT_START,DEVELOPMENT_END):
        row=period_row(price,funding,t,prev,cost_bps)
        weeks.append(row)
        for a,v in row["attr"].items():
            asset_attr[a]+=v
        prev=dict(row["weights"])

    if weeks:
        tr,cost,attr=terminal_close(prev,cost_bps)
        weeks[-1]["turnover"]+=tr
        weeks[-1]["cost"]+=cost
        weeks[-1]["net"]-=cost
        for a,v in attr.items():
            weeks[-1]["attr"][a]+=v
            asset_attr[a]+=v

    rs=[x["net"] for x in weeks]
    blocks=_blocks(rs)
    rank_ics=[x["rankIc"] for x in weeks]
    return {
        "periods":len(weeks),
        "returnPct":_compound(rs)*100.0,
        "profitFactor":_profit_factor(rs),
        "sharpe":_sharpe(rs),
        "maxDrawdownPct":_max_drawdown(rs)*100.0,
        "positiveBlocks":sum(1 for x in blocks if x>0),
        "blocksPct":[x*100.0 for x in blocks],
        "turnover":sum(x["turnover"] for x in weeks),
        "costContribution":-sum(x["cost"] for x in weeks),
        "priceContribution":sum(x["price"] for x in weeks),
        "fundingContribution":sum(x["funding"] for x in weeks),
        "assetAttribution":asset_attr,
        "meanRankIc":mean(rank_ics) if rank_ics else 0.0,
        "rankIcNeweyWestT":parent.newey_west_tstat(rank_ics,NW_LAG) if rank_ics else 0.0,
        "minEligibleAssets":min((x["eligibleAssets"] for x in weeks),default=0),
        "maxEligibleAssets":max((x["eligibleAssets"] for x in weeks),default=0),
        "maxGrossDeviation":max((abs(x["grossExposure"]-GROSS_TARGET) for x in weeks),default=99.0),
        "maxAbsNetExposure":max((abs(x["netExposure"]) for x in weeks),default=99.0),
        "weekly":weeks,
    }


def development_gate(base,stress):
    reasons=[]
    if base["periods"]!=DEVELOPMENT_EXPECTED_PERIODS:
        reasons.append("PERIODS_NE_48")
    if base["minEligibleAssets"]!=REQUIRED_ASSETS or base["maxEligibleAssets"]!=REQUIRED_ASSETS:
        reasons.append("ELIGIBLE_ASSETS_NE_12")
    if base["maxGrossDeviation"]>1e-12:
        reasons.append("GROSS_EXPOSURE_NE_1")
    if base["maxAbsNetExposure"]>MAX_NET_ABS:
        reasons.append("NET_EXPOSURE_NOT_ZERO")
    if not base["returnPct"]>0:
        reasons.append("RETURN_NOT_POSITIVE")
    if base["profitFactor"]<MIN_PROFIT_FACTOR:
        reasons.append("PF_LT_1_15")
    if base["sharpe"]<MIN_SHARPE:
        reasons.append("SHARPE_LT_0_75")
    if base["maxDrawdownPct"]>MAX_DRAWDOWN_PCT:
        reasons.append("DD_GT_20")
    if base["positiveBlocks"]<MIN_POSITIVE_BLOCKS:
        reasons.append("POSITIVE_BLOCKS_LT_3_OF_4")
    if not stress["returnPct"]>0:
        reasons.append("STRESS_20BPS_RETURN_NOT_POSITIVE")
    if not base["meanRankIc"]>0:
        reasons.append("MEAN_RANK_IC_NOT_POSITIVE")
    if base["rankIcNeweyWestT"]<ONE_SIDED_T_MIN:
        reasons.append("RANK_IC_NW_T_LT_1_645")
    return {
        "pass":not reasons,
        "reasons":reasons,
        "expectedPeriods":DEVELOPMENT_EXPECTED_PERIODS,
        "requiredAssets":REQUIRED_ASSETS,
        "baseCostBps":BASE_COST_BPS,
        "stressCostBps":STRESS_COST_BPS,
        "minProfitFactor":MIN_PROFIT_FACTOR,
        "minSharpe":MIN_SHARPE,
        "maxDrawdownPct":MAX_DRAWDOWN_PCT,
        "minPositiveBlocks":MIN_POSITIVE_BLOCKS,
        "rankIcNeweyWestLag":NW_LAG,
        "rankIcTMin":ONE_SIDED_T_MIN,
        "researchOnly":True,
        "executionImpact":False,
        "autoPromotion":False,
    }


def run_development(raw_by_asset):
    try:
        parent_path=Path(__file__).with_name("cross_sectional_low_volatility_v1.py")
        if git_blob_sha(parent_path)!=PARENT_V1_ENGINE_BLOB:
            raise ValueError("PARENT_V1_ENGINE_BLOB_MISMATCH")
        price,funding=prepare_dataset(raw_by_asset)
        base=run_method(price,funding,BASE_COST_BPS)
        stress=run_method(price,funding,STRESS_COST_BPS)
        gate=development_gate(base,stress)
        decision=PASS_DECISION if gate["pass"] else FAIL_DECISION
        return {
            "ruleset":RULESET,
            "stage":"DEVELOPMENT",
            "researchOnly":True,
            "executionImpact":False,
            "autoPromotion":False,
            "holdoutEvaluated":False,
            "dataIntegrityFailure":False,
            "result":base,
            "stress":stress,
            "gate":gate,
            "decision":decision,
        }
    except Exception as exc:
        return {
            "ruleset":RULESET,
            "stage":"DEVELOPMENT",
            "researchOnly":True,
            "executionImpact":False,
            "autoPromotion":False,
            "holdoutEvaluated":False,
            "dataIntegrityFailure":True,
            "error":str(exc),
            "result":None,
            "stress":None,
            "gate":{"pass":False,"reasons":["DATA_INTEGRITY_FAILURE"]},
            "decision":FAIL_DECISION,
        }
