#!/usr/bin/env python3
import hashlib, json, os, sys
from datetime import datetime, timezone
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'research'))

from cross_sectional_funding_carry_risk_budget_v2 import (
    ASSETS, FACTOR, RULESET, run_validation
)

DATA=Path(os.environ.get('FUNDING_RISK_V2_DATA_DIR','/tmp/meridian-funding-risk-v2'))
OUT=ROOT/'research'/'results'
START=int(datetime(2023,4,3,tzinfo=timezone.utc).timestamp()*1000)
END=int(datetime(2026,8,31,tzinfo=timezone.utc).timestamp()*1000)

def sha256(path):
    h=hashlib.sha256()
    with open(path,'rb') as f:
        for chunk in iter(lambda:f.read(1024*1024),b''):h.update(chunk)
    return h.hexdigest()

def compact(m):
    if not m:return None
    return {
      'periods':m['periods'],'activeWeeks':m['activeWeeks'],
      'returnPct':m['returnPct'],'priceOnlyReturnPct':m['priceOnlyReturnPct'],
      'profitFactor':m['profitFactor'],'sharpe':m['sharpe'],'maxDrawdownPct':m['maxDrawdownPct'],
      'positiveWindows':m['positiveWindows'],'windowsPct':m['windowsPct'],
      'fundingContribution':m['fundingContribution'],'costContribution':m['costContribution'],
      'turnover':m['turnover'],'longContribution':m['longContribution'],'shortContribution':m['shortContribution'],
      'assetAttribution':m['assetAttribution'],'positiveAssets':m['positiveAssets'],
      'positiveConcentrationPct':m['positiveConcentrationPct'],
      'flatByBreadthWeeks':m['flatByBreadthWeeks'],'flatByRiskDataWeeks':m['flatByRiskDataWeeks'],
      'meanGrossExposure':m['meanGrossExposure'],'medianGrossExposure':m['medianGrossExposure'],
      'meanRiskScale':m['meanRiskScale'],
      'meanSelectedAssetAnnualizedVol':m['meanSelectedAssetAnnualizedVol'],
      'meanPreScalePortfolioAnnualizedVol':m['meanPreScalePortfolioAnnualizedVol']
    }

manifest=json.loads((DATA/'manifest.json').read_text())
raw={}
for asset in ASSETS:
    p=DATA/(asset+'.json')
    if not p.exists():raise RuntimeError(f'missing collected asset file {asset}')
    raw[asset]=json.loads(p.read_text())

result=run_validation(raw,START,END)

summary={
  'generatedAt':datetime.now(timezone.utc).isoformat(),
  'ruleset':RULESET,
  'stage':'INDEPENDENT_VALIDATION',
  'source':'Binance Vision official public USD-M monthly archives',
  'foundation':'FUNDING-CARRY-RISK-BUDGET-V2-DATA-V1-FROZEN',
  'window':{
    'entryStart':'2023-04-03T00:00:00Z',
    'entryEndExclusive':'2026-08-31T00:00:00Z',
    'finalExit':'2026-08-31T00:00:00Z'
  },
  'assets':list(ASSETS),
  'factor':FACTOR,
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
sp=OUT/'cross-sectional-funding-carry-risk-budget-v2-summary.json'
fp=OUT/'cross-sectional-funding-carry-risk-budget-v2-full.json'
mp=OUT/'cross-sectional-funding-carry-risk-budget-v2.md'
sp.write_text(json.dumps(summary,indent=2)+'\n')
fp.write_text(json.dumps({'summary':summary,'rawResult':result},indent=2)+'\n')

if summary['dataIntegrityFailure']:
    md=f"""# Cross-Sectional Funding Carry Risk-Budget V2 — Validation

Generated: {summary['generatedAt']}

**Decision:** {summary['decision']}

**DATA INTEGRITY FAILURE:** {summary['error']}

No Paper or live promotion is authorized.
"""
else:
    r=summary['result'];st=summary['stress']
    attrs='\n'.join(f"| {a} | {r['assetAttribution'][a]*100:.2f}% |" for a in ASSETS)
    md=f"""# Cross-Sectional Funding Carry Risk-Budget V2 — Validation

Generated: {summary['generatedAt']}

Independent universe: TRX / ETC / XLM / ATOM / UNI / AAVE / FIL / NEAR.

| Metric | Result |
|---|---:|
| Completed periods | {r['periods']} |
| Active weeks | {r['activeWeeks']} |
| Net return | {r['returnPct']:.2f}% |
| Price-only return | {r['priceOnlyReturnPct']:.2f}% |
| Funding contribution | {r['fundingContribution']*100:.2f}% |
| Profit Factor | {r['profitFactor']:.3f} |
| Annualized Sharpe | {r['sharpe']:.3f} |
| Max drawdown | {r['maxDrawdownPct']:.2f}% |
| Positive windows | {r['positiveWindows']}/5 |
| 32 bps stress return | {st['returnPct']:.2f}% |
| Mean gross exposure | {r['meanGrossExposure']:.3f} |
| Median gross exposure | {r['medianGrossExposure']:.3f} |
| Mean risk scale | {r['meanRiskScale']:.3f} |
| Positive-PnL assets | {r['positiveAssets']}/8 |
| Positive-PnL concentration | {r['positiveConcentrationPct']:.2f}% |

## Asset attribution

| Asset | Attribution |
|---|---:|
{attrs}

**Gate:** {'PASS' if summary['gate']['pass'] else 'FAIL'}

**Decision:** {summary['decision']}

Gate reasons: {', '.join(summary['gate'].get('reasons',[])) or 'none'}

Research only. A PASS authorizes at most a separate prospective Paper-shadow step, never live execution.
"""
mp.write_text(md)

summary['artifactHashes']={
  'summaryPrehashSha256':sha256(sp),
  'fullSha256':sha256(fp),
  'markdownSha256':sha256(mp)
}
sp.write_text(json.dumps(summary,indent=2)+'\n')
print(json.dumps(summary,indent=2))
