"""Frozen Low-Volatility Rank-Weighted V2 Holdout engine.

Research only. Evaluates the untouched 34-period Holdout using the already
frozen V2 feature, portfolio construction, funding accounting, costs and gates.
No Paper/live execution path is present.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
from statistics import mean

import low_volatility_rank_weighted_v2 as v2

RULESET=v2.RULESET
PARENT_V2_ENGINE_BLOB="87302fdc0c1880a35e1bfd663be8191d5f6be429"
DEVELOPMENT_EVIDENCE_BLOB="e9babe1566c8667a21eb6cae8388ca6dfb77385e"
DEVELOPMENT_SUMMARY_BLOB="5b3ada9fd32abe4747fbc854bb5f5388e15e6763"

ASSETS=v2.ASSETS
REQUIRED_ASSETS=v2.REQUIRED_ASSETS
HOUR=v2.HOUR
WEEK=v2.WEEK

HOLDOUT_START=v2.HOLDOUT_START
HOLDOUT_END=v2.HOLDOUT_END
HOLDOUT_EXPECTED_PERIODS=v2.HOLDOUT_EXPECTED_PERIODS

BASE_COST_BPS=v2.BASE_COST_BPS
STRESS_COST_BPS=v2.STRESS_COST_BPS
GROSS_TARGET=v2.GROSS_TARGET
MAX_NET_ABS=v2.MAX_NET_ABS
NW_LAG=v2.NW_LAG
ONE_SIDED_T_MIN=v2.ONE_SIDED_T_MIN
MIN_POSITIVE_BLOCKS=v2.MIN_POSITIVE_BLOCKS
MIN_PROFIT_FACTOR=v2.MIN_PROFIT_FACTOR
MIN_SHARPE=v2.MIN_SHARPE
MAX_DRAWDOWN_PCT=v2.MAX_DRAWDOWN_PCT

PASS_DECISION="HOLDOUT_PASS_PROSPECTIVE_PAPER_REVIEW_ONLY"
FAIL_DECISION="HOLDOUT_FAIL_RESEARCH_STOP"


def git_blob_sha(path):
    body=Path(path).read_bytes()
    return hashlib.sha1(f"blob {len(body)}\0".encode()+body).hexdigest()


def verify_development_lineage():
    root=Path(__file__).resolve().parent
    parent_path=root/"low_volatility_rank_weighted_v2.py"
    evidence_path=root/"LOW-VOLATILITY-RANK-WEIGHTED-V2-DEVELOPMENT-EVIDENCE.md"
    summary_path=root/"results"/"low-volatility-rank-weighted-v2-development-frozen-summary.json"

    if git_blob_sha(parent_path)!=PARENT_V2_ENGINE_BLOB:
        raise ValueError("PARENT_V2_ENGINE_BLOB_MISMATCH")
    if git_blob_sha(evidence_path)!=DEVELOPMENT_EVIDENCE_BLOB:
        raise ValueError("DEVELOPMENT_EVIDENCE_BLOB_MISMATCH")
    if git_blob_sha(summary_path)!=DEVELOPMENT_SUMMARY_BLOB:
        raise ValueError("DEVELOPMENT_SUMMARY_BLOB_MISMATCH")

    summary=json.loads(summary_path.read_text())
    if summary.get("decision")!="DEVELOPMENT_PASS_HOLDOUT_REQUIRED":
        raise ValueError("FROZEN_DEVELOPMENT_NOT_PASS")
    if summary.get("holdoutEvaluated") is not False:
        raise ValueError("FROZEN_SUMMARY_HOLDOUT_NOT_SEALED")
    if summary.get("dataIntegrityFailure") is not False:
        raise ValueError("FROZEN_DEVELOPMENT_INTEGRITY_FAILURE")
    gate=summary.get("gate") or {}
    if gate.get("pass") is not True or gate.get("reasons") not in ([],None):
        raise ValueError("FROZEN_DEVELOPMENT_GATE_NOT_PASS")
    metrics=summary.get("metrics") or {}
    if int(metrics.get("periods",0))!=v2.DEVELOPMENT_EXPECTED_PERIODS:
        raise ValueError("FROZEN_DEVELOPMENT_PERIODS_MISMATCH")
    if float(metrics.get("maxGrossDeviation",99))>1e-12:
        raise ValueError("FROZEN_DEVELOPMENT_GROSS_INVARIANT_FAIL")
    if float(metrics.get("maxAbsNetExposure",99))>MAX_NET_ABS:
        raise ValueError("FROZEN_DEVELOPMENT_NET_INVARIANT_FAIL")
    return summary


def run_holdout_method(price,funding,cost_bps):
    prev={}
    weeks=[]
    asset_attr={a:0.0 for a in ASSETS}

    for t in v2.parent.weekly_anchors(HOLDOUT_START,HOLDOUT_END):
        row=v2.period_row(price,funding,t,prev,cost_bps)
        weeks.append(row)
        for a,val in row["attr"].items():
            asset_attr[a]+=val
        prev=dict(row["weights"])

    if weeks:
        tr,cost,attr=v2.terminal_close(prev,cost_bps)
        weeks[-1]["turnover"]+=tr
        weeks[-1]["cost"]+=cost
        weeks[-1]["net"]-=cost
        for a,val in attr.items():
            weeks[-1]["attr"][a]+=val
            asset_attr[a]+=val

    rs=[x["net"] for x in weeks]
    blocks=v2._blocks(rs)
    rank_ics=[x["rankIc"] for x in weeks]
    return {
        "periods":len(weeks),
        "returnPct":v2._compound(rs)*100.0,
        "profitFactor":v2._profit_factor(rs),
        "sharpe":v2._sharpe(rs),
        "maxDrawdownPct":v2._max_drawdown(rs)*100.0,
        "positiveBlocks":sum(1 for x in blocks if x>0),
        "blocksPct":[x*100.0 for x in blocks],
        "turnover":sum(x["turnover"] for x in weeks),
        "costContribution":-sum(x["cost"] for x in weeks),
        "priceContribution":sum(x["price"] for x in weeks),
        "fundingContribution":sum(x["funding"] for x in weeks),
        "assetAttribution":asset_attr,
        "meanRankIc":mean(rank_ics) if rank_ics else 0.0,
        "rankIcNeweyWestT":v2.parent.newey_west_tstat(rank_ics,NW_LAG) if rank_ics else 0.0,
        "minEligibleAssets":min((x["eligibleAssets"] for x in weeks),default=0),
        "maxEligibleAssets":max((x["eligibleAssets"] for x in weeks),default=0),
        "maxGrossDeviation":max((abs(x["grossExposure"]-GROSS_TARGET) for x in weeks),default=99.0),
        "maxAbsNetExposure":max((abs(x["netExposure"]) for x in weeks),default=99.0),
        "weekly":weeks,
    }


def holdout_gate(base,stress):
    reasons=[]
    if base["periods"]!=HOLDOUT_EXPECTED_PERIODS:
        reasons.append("PERIODS_NE_34")
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
        "expectedPeriods":HOLDOUT_EXPECTED_PERIODS,
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


def run_holdout(raw_by_asset):
    try:
        development=verify_development_lineage()
        price,funding=v2.prepare_dataset(raw_by_asset)
        base=run_holdout_method(price,funding,BASE_COST_BPS)
        stress=run_holdout_method(price,funding,STRESS_COST_BPS)
        gate=holdout_gate(base,stress)
        decision=PASS_DECISION if gate["pass"] else FAIL_DECISION
        return {
            "ruleset":RULESET,
            "stage":"UNTOUCHED_HOLDOUT",
            "researchOnly":True,
            "executionImpact":False,
            "autoPromotion":False,
            "developmentDecision":development["decision"],
            "developmentCanonicalWorkflowRun":development["canonicalWorkflowRun"],
            "dataIntegrityFailure":False,
            "result":base,
            "stress":stress,
            "gate":gate,
            "decision":decision,
        }
    except Exception as exc:
        return {
            "ruleset":RULESET,
            "stage":"UNTOUCHED_HOLDOUT",
            "researchOnly":True,
            "executionImpact":False,
            "autoPromotion":False,
            "dataIntegrityFailure":True,
            "error":str(exc),
            "result":None,
            "stress":None,
            "gate":{"pass":False,"reasons":["DATA_INTEGRITY_FAILURE"]},
            "decision":FAIL_DECISION,
        }
