#!/usr/bin/env python3
import hashlib, json, os, sys
from datetime import datetime, timezone
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'research'))

from perpetual_cross_sectional_reversal_v1 import ASSETS, RULESET, run_discovery

DATA=Path(os.environ.get('PERP_REVERSAL_V1_DATA_DIR','/tmp/meridian-perp-reversal-v1'))
OUT=ROOT/'research'/'results'

def sha256(path):
    h=hashlib.sha256()
    with open(path,'rb') as f:
        for chunk in iter(lambda:f.read(1024*1024),b''):h.update(chunk)
    return h.hexdigest()

def compact(m):
    if not m:return None
    return {
      'periods':m['periods'],
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
      'longWeeksByAsset':m['longWeeksByAsset'],
      'shortWeeksByAsset':m['shortWeeksByAsset'],
      'minEligibleAssets':m['minEligibleAssets'],
      'maxEligibleAssets':m['maxEligibleAssets'],
      'sideCounts':m['sideCounts'],
      'meanLongFormationReturn':m['meanLongFormationReturn'],
      'meanShortFormationReturn':m['meanShortFormationReturn'],
      'meanLongNextWeekReturn':m['meanLongNextWeekReturn'],
      'meanShortNextWeekReturn':m['meanShortNextWeekReturn'],
      'meanLoserMinusWinnerNextWeek':m['meanLoserMinusWinnerNextWeek'],
    }

manifest=json.loads((DATA/'manifest.json').read_text())
if manifest.get('holdoutLoaded') is not False:
    raise RuntimeError('discovery runner refuses data manifest with holdoutLoaded != false')
if manifest.get('range')!={'start':'2023-11','end':'2024-12'}:
    raise RuntimeError('unexpected discovery raw-data range')
if list(manifest.get('assets',[]))!=list(ASSETS):
    raise RuntimeError('manifest asset universe mismatch')

raw={}
for asset in ASSETS:
    p=DATA/(asset+'.json')
    if not p.exists():raise RuntimeError(f'missing collected asset file {asset}')
    raw[asset]=json.loads(p.read_text())

result=run_discovery(raw)

summary={
  'generatedAt':datetime.now(timezone.utc).isoformat(),
  'ruleset':RULESET,
  'stage':'DISCOVERY',
  'source':'Binance Vision official public USD-M monthly archives',
  'rawWindow':'2023-11..2024-12',
  'tradeWindow':'2024-01-08..2024-12-30',
  'formationWeeks':8,
  'skipWeeks':1,
  'holdingWeeks':1,
  'assets':list(ASSETS),
  'holdoutLoaded':False,
  'dataIntegrityFailure':result.get('dataIntegrityFailure',False),
  'error':result.get('error'),
  'result':compact(result.get('result')),
  'stress':compact(result.get('stress')),
  'gate':result.get('gate'),
  'decision':result.get('decision'),
  'researchOnly':True,'executionImpact':False,'autoPromotion':False,
}

OUT.mkdir(parents=True,exist_ok=True)
sp=OUT/'perpetual-cross-sectional-reversal-v1-summary.json'
fp=OUT/'perpetual-cross-sectional-reversal-v1-full.json'
mp=OUT/'perpetual-cross-sectional-reversal-v1.md'

sp.write_text(json.dumps(summary,indent=2)+'\n')
fp.write_text(json.dumps({'summary':summary,'rawResult':result},indent=2)+'\n')

if summary['dataIntegrityFailure']:
    md=f"""# Perpetual Cross-Sectional Reversal V1 — Discovery

Generated: {summary['generatedAt']}

**Decision:** {summary['decision']}

**DATA INTEGRITY FAILURE:** {summary['error']}

Holdout remains unauthorized. No Paper or live promotion.
"""
else:
    r=summary['result'];st=summary['stress']
    attrs='\n'.join(
      f"| {a} | {r['assetAttribution'][a]*100:.3f}% | {r['longWeeksByAsset'][a]} | {r['shortWeeksByAsset'][a]} |"
      for a in ASSETS
    )
    md=f"""# Perpetual Cross-Sectional Reversal V1 — Discovery

Generated: {summary['generatedAt']}

Frozen design:
- 8-week formation
- 1-week skip
- 1-week hold
- equal-weight bottom-quintile LONG / top-quintile SHORT
- no volatility conditioning
- holdout not loaded

| Metric | Discovery |
|---|---:|
| Weekly periods | {r['periods']} |
| Net return | {r['returnPct']:.3f}% |
| Price-only return | {r['priceOnlyReturnPct']:.3f}% |
| Profit Factor | {r['profitFactor']:.3f} |
| Annualized Sharpe | {r['sharpe']:.3f} |
| Max drawdown | {r['maxDrawdownPct']:.3f}% |
| Positive windows | {r['positiveWindows']}/5 |
| Stress return | {st['returnPct']:.3f}% |
| Positive-PnL assets | {r['positiveAssets']}/{len(ASSETS)} |
| Positive-PnL concentration | {r['positiveConcentrationPct']:.2f}% |
| Min eligible assets | {r['minEligibleAssets']} |
| Loser-minus-winner next-week price spread | {r['meanLoserMinusWinnerNextWeek']*100:.3f}% |

## Asset attribution

| Asset | Net attribution | Long weeks | Short weeks |
|---|---:|---:|---:|
{attrs}

**Gate:** {'PASS' if summary['gate']['pass'] else 'FAIL'}

**Decision:** {summary['decision']}

Gate reasons: {', '.join(summary['gate'].get('reasons',[])) or 'none'}

Research only. A discovery PASS authorizes only the frozen temporal holdout.
"""
mp.write_text(md)

summary['artifactHashes']={
  'summaryPrehashSha256':sha256(sp),
  'fullSha256':sha256(fp),
  'markdownSha256':sha256(mp),
}
sp.write_text(json.dumps(summary,indent=2)+'\n')
print(json.dumps(summary,indent=2))
