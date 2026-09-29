#!/usr/bin/env python3
"""Recover Data V1 from the frozen 120-shard aggregate plus one corrected shard.

The original aggregate already proved that all 120 expected manifests were
present/unique and that SOLUSDT 2025-07 was the only failing shard. This
recovery verifies that frozen aggregate contract, verifies the corrected SOL
shard, and replaces only the failed shard's missing audit contribution.

No market signal, forward return, position, or PnL is calculated.
"""
import json
import os
from pathlib import Path

ORIGINAL=Path(os.environ.get(
    "QH_V1_ORIGINAL_SUMMARY",
    "research/results/qh-v1-original-summary/quarter-hour-boundary-imbalance-v1-data-v1-summary.json"
))
SOL=Path(os.environ.get(
    "QH_V1_CORRECTED_SOL",
    "research/results/qh-v1-corrected/SOLUSDT-2025-07.json"
))
OUT=Path(os.environ.get("QH_V1_RECOVERY_OUT","research/results"))
OUT.mkdir(parents=True,exist_ok=True)

orig=json.loads(ORIGINAL.read_text())
sol=json.loads(SOL.read_text())
errors=[]

def req(cond,msg):
    if not cond:
        errors.append(msg)

family="PERPETUAL-QUARTER-HOUR-BOUNDARY-IMBALANCE-V1"
expected_original_reasons={
    "SOLUSDT:2025-07:SHARD_GATE_FAIL",
    "SOLUSDT:2025-07:aggTrades_COVERAGE_FAIL",
    "SOLUSDT:2025-07:klines1m_COVERAGE_FAIL",
    "SOLUSDT:2025-07:fundingRate_COVERAGE_FAIL",
    "SOLUSDT:2025-07:UNEXPECTED_AGGTRADES_TIMESTAMP_UNIT",
    "SOLUSDT:2025-07:UNEXPECTED_KLINE_TIMESTAMP_UNIT",
}

req(orig.get("family")==family,"original family mismatch")
req(orig.get("stage")=="DATA_V1_SHARDED_FULL_DATA_QUALITY","original stage mismatch")
req(orig.get("expectedShards")==120,"original expectedShards != 120")
req(orig.get("observedShards")==120,"original observedShards != 120")
req(orig.get("missingShards")==[],"original missingShards not empty")
req(orig.get("duplicateShards")==[],"original duplicateShards not empty")
req(orig.get("unexpectedShards")==[],"original unexpectedShards not empty")
req(orig.get("decision")=="FOUNDATION_DATA_V1_FAIL_DATA_QUALITY","original decision changed")
req(set(orig.get("gateReasons",[]))==expected_original_reasons,
    f"original failure set changed: {orig.get('gateReasons',[])}")

for flag in (
    "directionalOrderImbalanceCalculated",
    "forwardReturnsCalculated",
    "signalReturnRelationshipCalculated",
    "positionsCalculated",
    "strategyPnlCalculated",
    "executionImpact",
    "paperAuthorized",
    "liveAuthorized",
):
    req(orig.get(flag) is False,f"original {flag} must be false")

req(sol.get("family")==family,"corrected SOL family mismatch")
req(sol.get("stage")=="DATA_V1_SHARD_QUALITY","corrected SOL stage mismatch")
req(sol.get("asset")=="SOLUSDT" and sol.get("month")=="2025-07",
    "corrected shard identity mismatch")
req(sol.get("gate",{}).get("pass") is True,"corrected SOL shard not PASS")
req(sol.get("gate",{}).get("decision")=="DATA_V1_SHARD_PASS",
    "corrected SOL decision mismatch")
req(sol.get("audits",{}).get("aggTrades",{}).get("coveragePass") is True,
    "corrected SOL aggTrades coverage not PASS")
req(sol.get("audits",{}).get("klines1m",{}).get("coveragePass") is True,
    "corrected SOL kline coverage not PASS")
req(sol.get("audits",{}).get("fundingRate",{}).get("coveragePass") is True,
    "corrected SOL funding coverage not PASS")
req(sol.get("audits",{}).get("aggTrades",{}).get("equalAggregateTradeIdEvents")==1,
    "corrected SOL equal aggregate-ID evidence != 1")
req(sol.get("audits",{}).get("aggTrades",{}).get("timestampUnitDetected")=="MILLISECOND",
    "corrected SOL aggTrades timestamp unit mismatch")
req(sol.get("audits",{}).get("klines1m",{}).get("timestampUnitsDetected")==["MILLISECOND"],
    "corrected SOL kline timestamp unit mismatch")
for flag in (
    "directionalOrderImbalanceCalculated",
    "forwardReturnsCalculated",
    "signalReturnRelationshipCalculated",
    "positionsCalculated",
    "strategyPnlCalculated",
    "executionImpact",
    "paperAuthorized",
    "liveAuthorized",
    "rawArchivesRetained",
):
    req(sol.get(flag) is False,f"corrected SOL {flag} must be false")

if errors:
    for e in errors:
        print("FAIL:",e)
    raise SystemExit(2)

oa=orig["downloadedBytes"]
sa=sol["downloads"]
final={
    "schema":2,
    "family":family,
    "stage":"DATA_V1_SHARDED_FULL_DATA_QUALITY_RECOVERED",
    "recoveryMethod":"FROZEN_ORIGINAL_120_SHARD_AGGREGATE_PLUS_SINGLE_CORRECTED_SOL_SHARD",
    "originalFullRun":36613725640,
    "originalFullRunHead":"78e8975b061b926733d66734ab409dcf56e11bfe",
    "originalExpectedShards":120,
    "originalObservedShards":120,
    "originalOnlyFailedShard":"SOLUSDT:2025-07",
    "correctedShard":{
        "asset":"SOLUSDT",
        "month":"2025-07",
        "gate":"PASS",
        "aggregateTradeRows":sol["audits"]["aggTrades"]["rows"],
        "equalAggregateTradeIdEvents":sol["audits"]["aggTrades"]["equalAggregateTradeIdEvents"],
        "quarterHourBins":sol["audits"]["aggTrades"]["nonEmptyQuarterHourBins"],
        "expectedQuarterHourBins":sol["audits"]["aggTrades"]["expectedQuarterHourBins"],
        "kline1mRows":sol["audits"]["klines1m"]["rows"],
        "fundingRows":sol["audits"]["fundingRate"]["rows"],
        "aggTradesSha256":sa["aggTrades"]["sha256"],
        "klines1mSha256":sa["klines1m"]["sha256"],
        "fundingRateSha256":sa["fundingRate"]["sha256"],
    },
    "expectedShards":120,
    "passingShards":120,
    "missingShards":[],
    "duplicateShards":[],
    "unexpectedShards":[],
    "aggregateTradeRows":orig["aggregateTradeRows"]+sol["audits"]["aggTrades"]["rows"],
    "equalAggregateTradeIdEvents":sol["audits"]["aggTrades"]["equalAggregateTradeIdEvents"],
    "emptyQuarterHourBins":orig["emptyQuarterHourBins"]+sol["audits"]["aggTrades"]["emptyQuarterHourBins"],
    "kline1mRows":orig["kline1mRows"]+sol["audits"]["klines1m"]["rows"],
    "fundingRows":orig["fundingRows"]+sol["audits"]["fundingRate"]["rows"],
    "downloadedBytes":{
        "aggTrades":oa["aggTrades"]+sa["aggTrades"]["bytes"],
        "klines1m":oa["klines1m"]+sa["klines1m"]["bytes"],
        "fundingRate":oa["fundingRate"]+sa["fundingRate"]["bytes"],
    },
    "gateReasons":[],
    "decision":"FOUNDATION_DATA_V1_PASS_PROTOCOL_PREREGISTRATION_REQUIRED",
    "directionalOrderImbalanceCalculated":False,
    "forwardReturnsCalculated":False,
    "signalReturnRelationshipCalculated":False,
    "positionsCalculated":False,
    "strategyPnlCalculated":False,
    "executionImpact":False,
    "paperAuthorized":False,
    "liveAuthorized":False,
}
# Cross-check against V0 publication totals. This proves the recovered byte
# accounting covers the complete 360-object corpus originally selected.
req(final["downloadedBytes"]=={
    "aggTrades":39135762018,
    "klines1m":210752875,
    "fundingRate":111054,
},"recovered archive byte totals do not match frozen V0")

if errors:
    for e in errors:
        print("FAIL:",e)
    raise SystemExit(2)

path=OUT/"quarter-hour-boundary-imbalance-v1-data-v1-recovered-summary.json"
path.write_text(json.dumps(final,indent=2)+"\n")
print(json.dumps(final,indent=2))
