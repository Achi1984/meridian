#!/usr/bin/env python3
import hashlib, json, os, sys
from datetime import datetime, timezone
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'research'))

from perpetual_relative_value_reversal_v3 import (
    RULESET, PRIMARY_ASSETS, TRANSFER_ASSETS, BENCHMARKS, run_stage
)

DATA=Path(os.environ.get('PERP_RV_V3_PRIMARY_DATA_DIR','/tmp/meridian-perp-rv-v3-primary'))
OUT=ROOT/'research'/'results'

def sha256(path):
    h=hashlib.sha256()
    with open(path,'rb') as f:
        for chunk in iter(lambda:f.read(1024*1024),b''):
            h.update(chunk)
    return h.hexdigest()

def compact(m):
    if not m:return None
    return {
      'stage':m['stage'],
      'periods':m['periods'],
      'activeWeeks':m['activeWeeks'],
      'activeFraction':m['activeFraction'],
      'returnPct':m['returnPct'],
      'priceOnlyReturnPct':m['priceOnlyReturnPct'],
      'profitFactor':m['profitFactor'],
      'sharpe':m['sharpe'],
      'maxDrawdownPct':m['maxDrawdownPct'],
      'positiveWindows':m['positiveWindows'],
      'windowsPct':m['windowsPct'],
      'fundingContribution':m['fundingContribution'],
      'costContribution':m['costContribution'],
      'turnover':m['turnover'],
      'longContribution':m['longContribution'],
      'shortContribution':m['shortContribution'],
      'assetAttribution':m['assetAttribution'],
      'positiveAssets':m['positiveAssets'],
      'positiveConcentrationPct':m['positiveConcentrationPct'],
      'meanSelectedLoserMinusWinnerNextWeek':m['meanSelectedLoserMinusWinnerNextWeek'],
      'maxAbsEstimatedBetaExposure':m['maxAbsEstimatedBetaExposure'],
      'meanAbsEstimatedBetaExposure':m['meanAbsEstimatedBetaExposure'],
      'meanLongGross':m['meanLongGross'],
      'meanShortGross':m['meanShortGross'],
      'realizedMarketBeta':m['realizedMarketBeta'],
    }

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
    raise RuntimeError('V3 transfer data must remain unloaded before primary PASS')
if set(manifest.get('candidateAssets',[])) & set(TRANSFER_ASSETS):
    raise RuntimeError('V3 transfer candidate leaked into primary manifest')
if manifest.get('dataAfter2026_08Loaded') is not False:
    raise RuntimeError('data after frozen validation window not allowed')

raw_candidates={}
for a in PRIMARY_ASSETS:
    p=DATA/'candidates'/(a+'.json')
    if not p.exists():raise RuntimeError(f'missing V3 primary candidate file {a}')
    raw_candidates[a]=json.loads(p.read_text())

raw_benchmarks={}
for b in BENCHMARKS:
    p=DATA/'benchmarks'/(b+'.json')
    if not p.exists():raise RuntimeError(f'missing V3 benchmark file {b}')
    raw_benchmarks[b]=json.loads(p.read_text())

result=run_stage(raw_candidates,raw_benchmarks,'PRIMARY_VALIDATION')
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
  'transferAssetsCalculated':False,
  'dataIntegrityFailure':result.get('dataIntegrityFailure',False),
  'error':result.get('error'),
  'result':compact(result.get('result')),
  'stress':compact(result.get('stress')),
  'gate':result.get('gate'),
  'decision':result.get('decision'),
  'transferAuthorized':bool(result.get('gate',{}).get('pass',False)),
  'researchOnly':True,
  'executionImpact':False,
  'autoPromotion':False,
  'paperAuthorized':False,
  'liveAuthorized':False,
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

Transfer data remained unloaded. No Paper or live promotion.
"""
else:
    r=summary['result'];st=summary['stress']
    attrs='\n'.join(
      f"| {a} | {r['assetAttribution'][a]*100:.3f}% |"
      for a in PRIMARY_ASSETS
    )
    md=f"""# Perpetual Relative-Value Reversal V3 — PRIMARY_VALIDATION

Generated: {summary['generatedAt']}

Transfer candidates loaded: **false**

| Metric | Primary |
|---|---:|
| Weekly anchors | {r['periods']} |
| Active weeks | {r['activeWeeks']} |
| Net return | {r['returnPct']:.3f}% |
| Price-only return | {r['priceOnlyReturnPct']:.3f}% |
| Profit Factor | {r['profitFactor']:.3f} |
| Annualized Sharpe | {r['sharpe']:.3f} |
| Max drawdown | {r['maxDrawdownPct']:.3f}% |
| Positive windows | {r['positiveWindows']}/5 |
| Stress return | {st['returnPct']:.3f}% |
| Positive-PnL assets | {r['positiveAssets']}/{len(PRIMARY_ASSETS)} |
| Positive concentration | {r['positiveConcentrationPct']:.2f}% |
| Mean loser-minus-winner next-week spread | {r['meanSelectedLoserMinusWinnerNextWeek']*100:.3f}% |
| Max abs estimated beta | {r['maxAbsEstimatedBetaExposure']:.3e} |
| Ex-post realized market beta | {r['realizedMarketBeta'] if r['realizedMarketBeta'] is not None else 'n/a'} |

## Candidate attribution

| Asset | Net attribution |
|---|---:|
{attrs}

**Gate:** {'PASS' if summary['gate']['pass'] else 'FAIL'}

**Decision:** {summary['decision']}

Gate reasons: {', '.join(summary['gate'].get('reasons',[])) or 'none'}

Transfer data remained unloaded during this run. A PASS authorizes only the already-frozen ASSET_TRANSFER_HOLDOUT under unchanged rules.
"""
mp.write_text(md)

summary['artifactHashes']={
  'summaryPrehashSha256':sha256(sp),
  'fullSha256':sha256(fp),
  'markdownSha256':sha256(mp),
}
sp.write_text(json.dumps(summary,indent=2)+'\n')
print(json.dumps(summary,indent=2))
