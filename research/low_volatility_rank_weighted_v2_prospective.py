"""Prospective-only Paper/Shadow evidence engine for frozen Low-Volatility V2.

This module never places orders. It reuses the exact frozen V2 signal, weighting,
funding, turnover and cost mechanics and evaluates only observations whose full
holding period begins at or after the preregistered prospective start boundary.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
from statistics import mean

import low_volatility_rank_weighted_v2 as v2

RULESET=v2.RULESET
STAGE="PROSPECTIVE_PAPER_SHADOW"

PARENT_V2_ENGINE_BLOB="87302fdc0c1880a35e1bfd663be8191d5f6be429"
HOLDOUT_EVIDENCE_BLOB="f3e6c329fe57b3a5d6a4ee03dde693c33d4aa85b"
HOLDOUT_SUMMARY_BLOB="4e59899559fefe5c8f6697f9f4fc320fc9ed8516"
PROSPECTIVE_PREREGISTRATION_BLOB="738965343f5fc28835f15bbbcdc0a12d8cf3cfbe"
PROSPECTIVE_START_AUTHORIZATION_BLOB="1d4ec4f2386005b7a5094ea3f4ea2d3143b9b9a7"

ASSETS=v2.ASSETS
REQUIRED_ASSETS=v2.REQUIRED_ASSETS
HOUR=v2.HOUR
WEEK=v2.WEEK

# Frozen before any eligible prospective outcome exists.
PROSPECTIVE_START=1791590400000          # 2026-10-10T00:00:00Z
MIN_COMPLETED_OBSERVATIONS=12
MIN_ELAPSED_MS=12*WEEK
GATE_END=PROSPECTIVE_START+MIN_ELAPSED_MS # 2027-01-02T00:00:00Z

BASE_COST_BPS=v2.BASE_COST_BPS
STRESS_COST_BPS=v2.STRESS_COST_BPS
MIN_PROFIT_FACTOR=v2.MIN_PROFIT_FACTOR
MIN_SHARPE=v2.MIN_SHARPE
MAX_DRAWDOWN_PCT=v2.MAX_DRAWDOWN_PCT
ONE_SIDED_T_MIN=v2.ONE_SIDED_T_MIN
NW_LAG=v2.NW_LAG
MAX_NET_ABS=v2.MAX_NET_ABS
GROSS_TARGET=v2.GROSS_TARGET

PROSPECTIVE_BLOCKS=3
MIN_POSITIVE_BLOCKS=2
CANONICAL_SNAPSHOT_MAX_LAG_MS=36*HOUR
MAX_PROSPECTIVE_FUNDING_GAP_MS=8*HOUR+1000

WAITING="PROSPECTIVE_WAITING_FOR_START"
COLLECTING="PROSPECTIVE_COLLECTING"
PASS_REVIEW="PROSPECTIVE_PERFORMANCE_PASS_LEDGER_REVIEW_REQUIRED"
FAIL="PROSPECTIVE_FAIL_RESEARCH_STOP"


def git_blob_sha(path):
    body=Path(path).read_bytes()
    return hashlib.sha1(f"blob {len(body)}\0".encode()+body).hexdigest()


def verify_frozen_lineage():
    root=Path(__file__).resolve().parent
    checks={
        root/"low_volatility_rank_weighted_v2.py":PARENT_V2_ENGINE_BLOB,
        root/"LOW-VOLATILITY-RANK-WEIGHTED-V2-HOLDOUT-EVIDENCE.md":HOLDOUT_EVIDENCE_BLOB,
        root/"results"/"low-volatility-rank-weighted-v2-holdout-frozen-summary.json":HOLDOUT_SUMMARY_BLOB,
        root/"LOW-VOLATILITY-RANK-WEIGHTED-V2-PROSPECTIVE-REVIEW-PREREGISTRATION.md":PROSPECTIVE_PREREGISTRATION_BLOB,
        root/"LOW-VOLATILITY-RANK-WEIGHTED-V2-PROSPECTIVE-START-AUTHORIZATION.md":PROSPECTIVE_START_AUTHORIZATION_BLOB,
    }
    for path,expected in checks.items():
        if git_blob_sha(path)!=expected:
            raise ValueError(f"FROZEN_LINEAGE_BLOB_MISMATCH:{path.name}")
    summary=json.loads((root/"results"/"low-volatility-rank-weighted-v2-holdout-frozen-summary.json").read_text())
    if summary.get("decision")!="HOLDOUT_PASS_PROSPECTIVE_PAPER_REVIEW_ONLY":
        raise ValueError("FROZEN_HOLDOUT_NOT_PASS")
    if summary.get("dataIntegrityFailure") is not False:
        raise ValueError("FROZEN_HOLDOUT_INTEGRITY_FAILURE")
    if (summary.get("gate") or {}).get("pass") is not True:
        raise ValueError("FROZEN_HOLDOUT_GATE_NOT_PASS")
    return summary


def saturday_cutoff(now_ms):
    """Most recent Saturday 00:00 UTC not later than now_ms."""
    now=int(now_ms)
    day=24*HOUR
    midnight=(now//day)*day
    weekday=(now//day+3)%7  # Monday=0; Saturday=5
    days_since_saturday=(weekday-5)%7
    return midnight-days_since_saturday*day


def completed_anchors(cutoff_ms):
    cutoff=int(cutoff_ms)
    if cutoff<=PROSPECTIVE_START:
        return []
    n=(cutoff-PROSPECTIVE_START)//WEEK
    return [PROSPECTIVE_START+i*WEEK for i in range(int(n))]


def _summarize(weeks):
    rs=[float(x["net"]) for x in weeks]
    rank_ics=[float(x["rankIc"]) for x in weeks]
    blocks=v2._blocks(rs,PROSPECTIVE_BLOCKS)
    return {
        "periods":len(weeks),
        "returnPct":v2._compound(rs)*100.0 if rs else 0.0,
        "profitFactor":v2._profit_factor(rs) if rs else 0.0,
        "sharpe":v2._sharpe(rs) if len(rs)>=2 else 0.0,
        "maxDrawdownPct":v2._max_drawdown(rs)*100.0 if rs else 0.0,
        "positiveBlocks":sum(1 for x in blocks if x>0),
        "blocksPct":[x*100.0 for x in blocks],
        "turnover":sum(float(x["turnover"]) for x in weeks),
        "costContribution":-sum(float(x["cost"]) for x in weeks),
        "priceContribution":sum(float(x["price"]) for x in weeks),
        "fundingContribution":sum(float(x["funding"]) for x in weeks),
        "meanRankIc":mean(rank_ics) if rank_ics else 0.0,
        "rankIcNeweyWestT":v2.parent.newey_west_tstat(rank_ics,NW_LAG) if len(rank_ics)>=2 else 0.0,
        "minEligibleAssets":min((int(x["eligibleAssets"]) for x in weeks),default=0),
        "maxEligibleAssets":max((int(x["eligibleAssets"]) for x in weeks),default=0),
        "maxGrossDeviation":max((abs(float(x["grossExposure"])-GROSS_TARGET) for x in weeks),default=0.0),
        "maxAbsNetExposure":max((abs(float(x["netExposure"])) for x in weeks),default=0.0),
        "weekly":weeks,
    }



class ProspectiveFundingSeries:
    """Public REST funding coverage with a frozen maximum eight-hour gap.

    Exact funding rates/timestamps are used for accounting. The eight-hour cap
    is a prospective source-completeness rule; each canonical weekly collector
    additionally checks the current official funding interval for the newest
    completed week.
    """
    def __init__(self,asset,rows):
        self.asset=asset
        self.rows=[]
        last=None
        for row in rows:
            if len(row)<3:
                raise ValueError(f"{asset}:MALFORMED_PROSPECTIVE_FUNDING")
            t=int(row[0]);rate=float(row[2])
            if last is not None and t<=last:
                raise ValueError(f"{asset}:NONMONOTONIC_PROSPECTIVE_FUNDING")
            self.rows.append((t,rate))
            last=t

    def sum_for_hold(self,start,end):
        selected=[x for x in self.rows if start<x[0]<=end]
        if not selected:
            raise ValueError(f"{self.asset}:MISSING_PROSPECTIVE_FUNDING")
        if selected[0][0]-start>MAX_PROSPECTIVE_FUNDING_GAP_MS:
            raise ValueError(f"{self.asset}:PROSPECTIVE_FUNDING_HEAD_GAP")
        for prev,curr in zip(selected,selected[1:]):
            gap=curr[0]-prev[0]
            if gap<=0 or gap>MAX_PROSPECTIVE_FUNDING_GAP_MS:
                raise ValueError(f"{self.asset}:PROSPECTIVE_FUNDING_INTERNAL_GAP")
        if end-selected[-1][0]>MAX_PROSPECTIVE_FUNDING_GAP_MS:
            raise ValueError(f"{self.asset}:PROSPECTIVE_FUNDING_TAIL_GAP")
        return sum(x[1] for x in selected)


def prepare_prospective_dataset(raw_by_asset):
    if set(raw_by_asset)!=set(ASSETS):
        raise ValueError("PROSPECTIVE_ASSET_UNIVERSE_MISMATCH")
    price=v2.parent.prepare_dataset(raw_by_asset)
    funding={}
    for asset in ASSETS:
        payload=raw_by_asset[asset]
        funding[asset]=ProspectiveFundingSeries(asset,payload.get("funding",[]))
    return price,funding

def run_method(price,funding,anchors,cost_bps,terminal_close=False):
    prev={}
    weeks=[]
    for t in anchors:
        row=v2.period_row(price,funding,t,prev,cost_bps)
        weeks.append(row)
        prev=dict(row["weights"])

    # Monitoring snapshots do not close the shadow portfolio every week.
    # A synthetic terminal close is applied only to the fixed 12-week gate sample.
    if terminal_close and weeks:
        tr,cost,attr=v2.terminal_close(prev,cost_bps)
        weeks[-1]["turnover"]+=tr
        weeks[-1]["cost"]+=cost
        weeks[-1]["net"]-=cost
        for a,val in attr.items():
            weeks[-1]["attr"][a]+=val
    return _summarize(weeks)


def performance_gate(base,stress):
    reasons=[]
    if base["periods"]!=MIN_COMPLETED_OBSERVATIONS:
        reasons.append("PERIODS_NE_12")
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
        reasons.append("POSITIVE_BLOCKS_LT_2_OF_3")
    if not stress["returnPct"]>0:
        reasons.append("STRESS_20BPS_RETURN_NOT_POSITIVE")
    if not base["meanRankIc"]>0:
        reasons.append("MEAN_RANK_IC_NOT_POSITIVE")
    if base["rankIcNeweyWestT"]<ONE_SIDED_T_MIN:
        reasons.append("RANK_IC_NW_T_LT_1_645")
    return {
        "pass":not reasons,
        "reasons":reasons,
        "expectedPeriods":MIN_COMPLETED_OBSERVATIONS,
        "requiredAssets":REQUIRED_ASSETS,
        "baseCostBps":BASE_COST_BPS,
        "stressCostBps":STRESS_COST_BPS,
        "minProfitFactor":MIN_PROFIT_FACTOR,
        "minSharpe":MIN_SHARPE,
        "maxDrawdownPct":MAX_DRAWDOWN_PCT,
        "minPositiveBlocks":MIN_POSITIVE_BLOCKS,
        "blocks":PROSPECTIVE_BLOCKS,
        "rankIcNeweyWestLag":NW_LAG,
        "rankIcTMin":ONE_SIDED_T_MIN,
        "researchOnly":True,
        "executionImpact":False,
        "paperAuthorized":False,
        "liveAuthorized":False,
        "autoPromotion":False,
    }


def evaluate(raw_by_asset,cutoff_ms,collected_at_ms):
    try:
        holdout=verify_frozen_lineage()
        cutoff=saturday_cutoff(cutoff_ms)
        if cutoff>int(cutoff_ms):
            raise ValueError("CUTOFF_IN_FUTURE")
        collected=int(collected_at_ms)
        timely=(collected>=cutoff and collected-cutoff<=CANONICAL_SNAPSHOT_MAX_LAG_MS)

        if cutoff<PROSPECTIVE_START:
            return {
                "ruleset":RULESET,"stage":STAGE,"decision":WAITING,
                "prospectiveStart":PROSPECTIVE_START,"gateEnd":GATE_END,
                "cutoff":cutoff,"collectedAt":collected,"timely":timely,
                "completedObservations":0,"eligibleGateObservations":0,
                "researchOnly":True,"executionImpact":False,
                "paperAuthorized":False,"liveAuthorized":False,"autoPromotion":False,
                "holdoutDecision":holdout["decision"],"dataIntegrityFailure":False,
                "monitoring":None,"gateSample":None,"gate":None,
            }

        anchors=completed_anchors(cutoff)
        if not anchors:
            return {
                "ruleset":RULESET,"stage":STAGE,"decision":COLLECTING,
                "prospectiveStart":PROSPECTIVE_START,"gateEnd":GATE_END,
                "cutoff":cutoff,"collectedAt":collected,"timely":timely,
                "completedObservations":0,"eligibleGateObservations":0,
                "researchOnly":True,"executionImpact":False,
                "paperAuthorized":False,"liveAuthorized":False,"autoPromotion":False,
                "holdoutDecision":holdout["decision"],"dataIntegrityFailure":False,
                "monitoring":None,"gateSample":None,"gate":None,
            }

        price,funding=prepare_prospective_dataset(raw_by_asset)
        monitoring_base=run_method(price,funding,anchors,BASE_COST_BPS,terminal_close=False)
        monitoring_stress=run_method(price,funding,anchors,STRESS_COST_BPS,terminal_close=False)

        result={
            "ruleset":RULESET,"stage":STAGE,
            "prospectiveStart":PROSPECTIVE_START,"gateEnd":GATE_END,
            "cutoff":cutoff,"collectedAt":collected,"timely":timely,
            "completedObservations":len(anchors),
            "eligibleGateObservations":min(len(anchors),MIN_COMPLETED_OBSERVATIONS),
            "researchOnly":True,"executionImpact":False,
            "paperAuthorized":False,"liveAuthorized":False,"autoPromotion":False,
            "holdoutDecision":holdout["decision"],"dataIntegrityFailure":False,
            "monitoring":{"base":monitoring_base,"stressReturnPct":monitoring_stress["returnPct"]},
            "gateSample":None,"gate":None,
        }

        if len(anchors)<MIN_COMPLETED_OBSERVATIONS or cutoff<GATE_END:
            result["decision"]=COLLECTING
            return result

        gate_anchors=anchors[:MIN_COMPLETED_OBSERVATIONS]
        gate_base=run_method(price,funding,gate_anchors,BASE_COST_BPS,terminal_close=True)
        gate_stress=run_method(price,funding,gate_anchors,STRESS_COST_BPS,terminal_close=True)
        gate=performance_gate(gate_base,gate_stress)
        result["gateSample"]={"base":gate_base,"stressReturnPct":gate_stress["returnPct"]}
        result["gate"]=gate
        result["decision"]=PASS_REVIEW if gate["pass"] else FAIL
        return result
    except Exception as exc:
        return {
            "ruleset":RULESET,"stage":STAGE,"decision":FAIL,
            "researchOnly":True,"executionImpact":False,
            "paperAuthorized":False,"liveAuthorized":False,"autoPromotion":False,
            "dataIntegrityFailure":True,"error":str(exc),
        }
