#!/usr/bin/env python3
import hashlib, json, os, sys
from datetime import datetime, timezone
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'research'))

from perpetual_taker_order_flow_v1 import ASSETS, RULESET, run_stage

DATA=Path(os.environ.get('TAKER_FLOW_V1_DEVELOPMENT_DATA_DIR','/tmp/meridian-taker-flow-v1-development'))
OUT=ROOT/'research'/'results'

def sha256(path):
    h=hashlib.sha256()
    with open(path,'rb') as f:
        for chunk in iter(lambda:f.read(1024*1024),b''):h.update(chunk)
    return h.hexdigest()

manifest=json.loads((DATA/'manifest.json').read_text())
if manifest.get('stage')!='DEVELOPMENT':
    raise RuntimeError('development runner refuses non-development manifest')
if manifest.get('range')!={'start':'2023-01','end':'2024-12'}:
    raise RuntimeError('unexpected development raw-data range')
if list(manifest.get('assets',[]))!=list(ASSETS):
    raise RuntimeError('development asset universe mismatch')
if manifest.get('holdoutLoaded') is not False:
    raise RuntimeError('development runner refuses holdoutLoaded != false')
if manifest.get('postDevelopmentDataLoaded') is not False:
    raise RuntimeError('development runner refuses post-development data')

raw={}
for asset in ASSETS:
    p=DATA/(asset+'.json')
    if not p.exists():raise RuntimeError(f'missing development asset file {asset}')
    raw[asset]=json.loads(p.read_text())

result=run_stage(raw,'DEVELOPMENT')
r=result.get('result');st=result.get('stress')

def compact(x):
    if x is None:return None
    return {
      'periods':x['periods'],
      'returnPct':x['returnPct'],
      'priceOnlyReturnPct':x['priceOnlyReturnPct'],
      'profitFactor':x['profitFactor'],
      'sharpe':x['sharpe'],
      'maxDrawdownPct':x['maxDrawdownPct'],
      'positiveWindows':x['positiveWindows'],
      'windowsPct':x['windowsPct'],
      'fundingContribution':x['fundingContribution'],
      'costContribution':x['costContribution'],
      'turnover':x['turnover'],
      'longContribution':x['longContribution'],
      'shortContribution':x['shortContribution'],
      'assetAttribution':x['assetAttribution'],
      'positiveAssets':x['positiveAssets'],
      'positiveConcentrationPct':x['positiveConcentrationPct'],
      'longWeeksByAsset':x['longWeeksByAsset'],
      'shortWeeksByAsset':x['shortWeeksByAsset'],
      'minEligibleAssets':x['minEligibleAssets'],
      'maxEligibleAssets':x['maxEligibleAssets'],
      'sideCounts':x['sideCounts'],
      'meanLongSignal':x['meanLongSignal'],
      'meanShortSignal':x['meanShortSignal'],
      'meanLongNextWeekReturn':x['meanLongNextWeekReturn'],
      'meanShortNextWeekReturn':x['meanShortNextWeekReturn'],
      'meanHighMinusLowNextWeek':x['meanHighMinusLowNextWeek'],
    }

summary={
  'generatedAt':datetime.now(timezone.utc).isoformat(),
  'ruleset':RULESET,
  'stage':'DEVELOPMENT',
  'source':'Binance Vision official public USD-M monthly archives',
  'rawWindow':'2023-01..2024-12',
  'tradeWindow':'2023-01-14..2024-12-28',
  'assets':list(ASSETS),
  'holdoutLoaded':False,
  'postDevelopmentDataLoaded':False,
  'dataIntegrityFailure':result.get('dataIntegrityFailure',False),
  'error':result.get('error'),
  'result':compact(r),
  'stress':compact(st),
  'gate':result.get('gate'),
  'decision':result.get('decision'),
  'researchOnly':True,'executionImpact':False,'autoPromotion':False,
}

OUT.mkdir(parents=True,exist_ok=True)
sp=OUT/'perpetual-taker-order-flow-v1-development-summary.json'
fp=OUT/'perpetual-taker-order-flow-v1-development-full.json'
mp=OUT/'perpetual-taker-order-flow-v1-development.md'
sp.write_text(json.dumps(summary,indent=2)+'\n')
fp.write_text(json.dumps({'summary':summary,'rawResult':result},indent=2)+'\n')

if summary['dataIntegrityFailure']:
    md=f"""# Perpetual Taker Order Flow V1 — DEVELOPMENT

Generated: {summary['generatedAt']}

**Decision:** {summary['decision']}

**DATA INTEGRITY FAILURE:** {summary['error']}

Temporal holdout remains unloaded and unauthorized. No Paper or live promotion.
"""
else:
    x=summary['result'];sx=summary['stress']
    attrs='\n'.join(
      f"| {a} | {x['assetAttribution'][a]*100:.3f}% | {x['longWeeksByAsset'][a]} | {x['shortWeeksByAsset'][a]} |"
      for a in ASSETS
    )
    md=f"""# Perpetual Taker Order Flow V1 — DEVELOPMENT

Generated: {summary['generatedAt']}

Temporal holdout loaded: **false**

| Metric | Development |
|---|---:|
| Weekly periods | {x['periods']} |
| Net return | {x['returnPct']:.3f}% |
| Price-only return | {x['priceOnlyReturnPct']:.3f}% |
| Profit Factor | {x['profitFactor']:.3f} |
| Annualized Sharpe | {x['sharpe']:.3f} |
| Max drawdown | {x['maxDrawdownPct']:.3f}% |
| Positive windows | {x['positiveWindows']}/5 |
| Stress return | {sx['returnPct']:.3f}% |
| Positive assets | {x['positiveAssets']}/{len(ASSETS)} |
| Positive concentration | {x['positiveConcentrationPct']:.2f}% |
| Mean long FLOW | {x['meanLongSignal']:.6f} |
| Mean short FLOW | {x['meanShortSignal']:.6f} |
| High-minus-low next-week spread | {x['meanHighMinusLowNextWeek']*100:.3f}% |

## Asset attribution

| Asset | Net attribution | Long weeks | Short weeks |
|---|---:|---:|---:|
{attrs}

**Gate:** {'PASS' if summary['gate']['pass'] else 'FAIL'}

**Decision:** {summary['decision']}

Gate reasons: {', '.join(summary['gate'].get('reasons',[])) or 'none'}

A development PASS authorizes only the already-frozen temporal holdout. No Paper or live promotion.
"""
mp.write_text(md)

summary['artifactHashes']={
  'summaryPrehashSha256':sha256(sp),
  'fullSha256':sha256(fp),
  'markdownSha256':sha256(mp),
}
sp.write_text(json.dumps(summary,indent=2)+'\n')
print(json.dumps(summary,indent=2))
