#!/usr/bin/env python3
import hashlib, json, os, sys
from datetime import datetime, timezone
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'research'))

from cross_sectional_perpetual_factor_v1 import (
    DISCOVERY_ASSETS, FACTORS, RULESET, run_temporal_validation
)

DATA=Path(os.environ.get('XSEC_FACTOR_V1_DATA_DIR','/tmp/meridian-xsec-factor-v1'))
OUT=ROOT/'research'/'results'
START=int(datetime(2025,1,6,tzinfo=timezone.utc).timestamp()*1000)
END=int(datetime(2026,8,31,tzinfo=timezone.utc).timestamp()*1000)

def sha256(path):
    h=hashlib.sha256()
    with open(path,'rb') as f:
        for chunk in iter(lambda:f.read(1024*1024),b''):h.update(chunk)
    return h.hexdigest()

def compact(m):
    if not m:return None
    return {
      'method':m['method'],'periods':m['periods'],'activeWeeks':m['activeWeeks'],
      'returnPct':m['returnPct'],'priceOnlyReturnPct':m['priceOnlyReturnPct'],
      'profitFactor':m['profitFactor'],'sharpe':m['sharpe'],'maxDrawdownPct':m['maxDrawdownPct'],
      'positiveWindows':m['positiveWindows'],'windowsPct':m['windowsPct'],
      'fundingContribution':m['fundingContribution'],'costContribution':m['costContribution'],
      'turnover':m['turnover'],'longContribution':m['longContribution'],'shortContribution':m['shortContribution'],
      'assetAttribution':m['assetAttribution'],'positiveAssets':m['positiveAssets'],
      'positiveConcentrationPct':m['positiveConcentrationPct'],
      'factorBooks':m['factorBooks'],
      'factorFlatMissingInput':m.get('factorFlatMissingInput'),
      'factorBreadth':m.get('factorBreadth')
    }

manifest=json.loads((DATA/'manifest.json').read_text())
raw={}
for asset in DISCOVERY_ASSETS:
    p=DATA/(asset+'.json')
    if not p.exists():raise RuntimeError(f'missing collected asset file {asset}')
    raw[asset]=json.loads(p.read_text())

result=run_temporal_validation(raw,START,END)

summary={
  'generatedAt':datetime.now(timezone.utc).isoformat(),
  'ruleset':RULESET,
  'stage':'TEMPORAL_VALIDATION',
  'source':'Binance Vision official public USD-M monthly archives',
  'developmentEvidenceStatus':'SEEN_NOT_GATING',
  'developmentEvidence':{
    'window':'2023-04-03..2024-12-30',
    'netReturnPct':34.0556,
    'profitFactor':1.4621,
    'sharpe':0.835,
    'maxDrawdownPct':13.0427
  },
  'window':{
    'entryStart':'2025-01-06T00:00:00Z',
    'entryEndExclusive':'2026-08-31T00:00:00Z',
    'finalExit':'2026-08-31T00:00:00Z'
  },
  'assets':list(DISCOVERY_ASSETS),
  'factors':list(FACTORS),
  'collected':manifest['files'],
  'dataIntegrityFailure':result.get('dataIntegrityFailure',False),
  'error':result.get('error'),
  'result':compact(result.get('result')),
  'stress':compact(result.get('stress')),
  'gate':result.get('gate'),
  'decision':result.get('decision'),
  'researchOnly':True,'executionImpact':False,'autoPromotion':False
}

OUT.mkdir(parents=True,exist_ok=True)
sp=OUT/'cross-sectional-perpetual-factor-v1-summary.json'
fp=OUT/'cross-sectional-perpetual-factor-v1-full.json'
mp=OUT/'cross-sectional-perpetual-factor-v1.md'
sp.write_text(json.dumps(summary,indent=2)+'\n')
fp.write_text(json.dumps({'summary':summary,'rawResult':result},indent=2)+'\n')

if summary['dataIntegrityFailure']:
    md=f"""# Cross-Sectional Perpetual Factor V1 — Temporal Validation

Generated: {summary['generatedAt']}

**Decision:** {summary['decision']}

**DATA INTEGRITY FAILURE:** {summary['error']}

The unseen validation is failed closed. No transfer validation is authorized.
"""
else:
    r=summary['result']; st=summary['stress']
    rows='\n'.join(
      f"| {f} | {r['factorBooks'][f]['returnPct']:.2f}% | {r['factorBooks'][f]['activeWeeks']} |"
      for f in FACTORS
    )
    md=f"""# Cross-Sectional Perpetual Factor V1 — Temporal Validation

Generated: {summary['generatedAt']}

This is the **first independent gating evaluation** of the previously seen Cross-Sectional hypothesis.

| Metric | Unseen 2025–2026 result |
|---|---:|
| Completed periods | {r['periods']} |
| Active weeks | {r['activeWeeks']} |
| Net return | {r['returnPct']:.2f}% |
| Price-only return | {r['priceOnlyReturnPct']:.2f}% |
| Profit Factor | {r['profitFactor']:.3f} |
| Annualized Sharpe | {r['sharpe']:.3f} |
| Max drawdown | {r['maxDrawdownPct']:.2f}% |
| Positive windows | {r['positiveWindows']}/5 |
| 4x-cost stress | {st['returnPct']:.2f}% |

## Independent factor books

| Factor | Return | Active weeks |
|---|---:|---:|
{rows}

**Gate:** {'PASS' if summary['gate']['pass'] else 'FAIL'}

**Decision:** {summary['decision']}

Gate reasons: {', '.join(summary['gate'].get('reasons',[])) or 'none'}

Research only. A temporal pass would authorize only the frozen transfer validation, not Paper or live execution.
"""
mp.write_text(md)

summary['artifactHashes']={
  'summaryPrehashSha256':sha256(sp),
  'fullSha256':sha256(fp),
  'markdownSha256':sha256(mp)
}
sp.write_text(json.dumps(summary,indent=2)+'\n')
print(json.dumps(summary,indent=2))
