#!/usr/bin/env python3
import hashlib, json, os, sys
from datetime import datetime, timezone
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'research'))

from perpetual_relative_value_reversal_v3 import (
    BENCHMARKS, PRIMARY_ASSETS, TRANSFER_ASSETS, RULESET, run_stage
)

DATA=Path(os.environ.get('PERP_RV_V3_PRIMARY_DATA_DIR','/tmp/meridian-perp-rv-v3-primary'))
OUT=ROOT/'research'/'results'

def sha256(path):
    h=hashlib.sha256()
    with open(path,'rb') as f:
        for chunk in iter(lambda:f.read(1024*1024),b''):h.update(chunk)
    return h.hexdigest()

manifest=json.loads((DATA/'manifest.json').read_text())
if manifest.get('stage')!='PRIMARY_VALIDATION':
    raise RuntimeError('unexpected V3 stage')
if manifest.get('range')!={'start':'2024-01','end':'2026-08'}:
    raise RuntimeError('unexpected V3 primary raw-data range')
if list(manifest.get('candidateAssets',[]))!=list(PRIMARY_ASSETS):
    raise RuntimeError('V3 primary candidate universe mismatch')
if list(manifest.get('benchmarkAssets',[]))!=list(BENCHMARKS):
    raise RuntimeError('V3 benchmark universe mismatch')
if manifest.get('transferAssetsLoaded') is not False:
    raise RuntimeError('transfer assets must remain unloaded before primary PASS')
if set(manifest.get('candidateAssets',[])) & set(TRANSFER_ASSETS):
    raise RuntimeError('transfer asset leaked into primary manifest')

raw_candidates={}
for asset in PRIMARY_ASSETS:
    p=DATA/('candidate-'+asset+'.json')
    if not p.exists():raise RuntimeError(f'missing primary candidate file {asset}')
    raw_candidates[asset]=json.loads(p.read_text())

raw_benchmarks={}
for asset in BENCHMARKS:
    p=DATA/('benchmark-'+asset+'.json')
    if not p.exists():raise RuntimeError(f'missing benchmark file {asset}')
    raw_benchmarks[asset]=json.loads(p.read_text())

result=run_stage(raw_candidates,raw_benchmarks,'PRIMARY_VALIDATION')
r=result.get('result');st=result.get('stress')
summary={
  'generatedAt':datetime.now(timezone.utc).isoformat(),
  'ruleset':RULESET,
  'stage':'PRIMARY_VALIDATION',
  'source':'Binance Vision official public USD-M monthly archives',
  'rawWindow':'2024-01..2026-08',
  'validationWindow':'2025-01-06..2026-08-31',
  'candidateAssets':list(PRIMARY_ASSETS),
  'benchmarkAssets':list(BENCHMARKS),
  'transferAssetsLoaded':False,
  'dataIntegrityFailure':result.get('dataIntegrityFailure',False),
  'error':result.get('error'),
  'result':None if r is None else {
    'periods':r['periods'],'activeWeeks':r['activeWeeks'],'activeFraction':r['activeFraction'],
    'returnPct':r['returnPct'],'priceOnlyReturnPct':r['priceOnlyReturnPct'],
    'profitFactor':r['profitFactor'],'sharpe':r['sharpe'],'maxDrawdownPct':r['maxDrawdownPct'],
    'positiveWindows':r['positiveWindows'],'windowsPct':r['windowsPct'],
    'fundingContribution':r['fundingContribution'],'costContribution':r['costContribution'],
    'turnover':r['turnover'],'longContribution':r['longContribution'],'shortContribution':r['shortContribution'],
    'assetAttribution':r['assetAttribution'],'positiveAssets':r['positiveAssets'],
    'positiveConcentrationPct':r['positiveConcentrationPct'],
    'meanSelectedLoserMinusWinnerNextWeek':r['meanSelectedLoserMinusWinnerNextWeek'],
    'maxAbsEstimatedBetaExposure':r['maxAbsEstimatedBetaExposure'],
    'meanAbsEstimatedBetaExposure':r['meanAbsEstimatedBetaExposure'],
    'meanLongGross':r['meanLongGross'],'meanShortGross':r['meanShortGross'],
    'realizedMarketBeta':r['realizedMarketBeta'],
  },
  'stress':None if st is None else {
    'returnPct':st['returnPct'],'profitFactor':st['profitFactor'],'sharpe':st['sharpe'],
    'maxDrawdownPct':st['maxDrawdownPct'],'positiveWindows':st['positiveWindows']
  },
  'gate':result.get('gate'),
  'decision':result.get('decision'),
  'researchOnly':True,'executionImpact':False,'autoPromotion':False,
}

OUT.mkdir(parents=True,exist_ok=True)
sp=OUT/'perpetual-relative-value-reversal-v3-primary-summary.json'
fp=OUT/'perpetual-relative-value-reversal-v3-primary-full.json'
mp=OUT/'perpetual-relative-value-reversal-v3-primary.md'
sp.write_text(json.dumps(summary,indent=2)+'\n')
fp.write_text(json.dumps({'summary':summary,'rawResult':result},indent=2)+'\n')

if summary['dataIntegrityFailure']:
    md=f"""# Perpetual Relative-Value Reversal V3 — PRIMARY_VALIDATION

Generated: {summary['generatedAt']}

**Decision:** {summary['decision']}

**DATA INTEGRITY FAILURE:** {summary['error']}

Transfer remains locked. No Paper or live promotion.
"""
else:
    x=summary['result'];sx=summary['stress']
    md=f"""# Perpetual Relative-Value Reversal V3 — PRIMARY_VALIDATION

Generated: {summary['generatedAt']}

Transfer assets loaded: **false**

| Metric | Primary |
|---|---:|
| Weekly anchors | {x['periods']} |
| Active weeks | {x['activeWeeks']} |
| Net return | {x['returnPct']:.3f}% |
| Price-only return | {x['priceOnlyReturnPct']:.3f}% |
| Profit Factor | {x['profitFactor']:.3f} |
| Annualized Sharpe | {x['sharpe']:.3f} |
| Max drawdown | {x['maxDrawdownPct']:.3f}% |
| Positive windows | {x['positiveWindows']}/5 |
| Stress return | {sx['returnPct']:.3f}% |
| Positive assets | {x['positiveAssets']}/{len(PRIMARY_ASSETS)} |
| Positive concentration | {x['positiveConcentrationPct']:.2f}% |
| Mean loser-minus-winner next-week spread | {x['meanSelectedLoserMinusWinnerNextWeek']*100:.3f}% |
| Max abs estimated beta | {x['maxAbsEstimatedBetaExposure']:.3e} |
| Ex-post realized market beta | {x['realizedMarketBeta'] if x['realizedMarketBeta'] is not None else 'n/a'} |

**Gate:** {'PASS' if summary['gate']['pass'] else 'FAIL'}

**Decision:** {summary['decision']}

Gate reasons: {', '.join(summary['gate'].get('reasons',[])) or 'none'}

A PASS authorizes only the already-frozen ASSET_TRANSFER_HOLDOUT. It does not authorize Paper or live execution.
"""
mp.write_text(md)
summary['artifactHashes']={
  'summaryPrehashSha256':sha256(sp),
  'fullSha256':sha256(fp),
  'markdownSha256':sha256(mp),
}
sp.write_text(json.dumps(summary,indent=2)+'\n')
print(json.dumps(summary,indent=2))
