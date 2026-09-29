#!/usr/bin/env python3
import hashlib, json, os, sys
from datetime import datetime, timezone
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'research'))

from high_volatility_perpetual_cross_sectional_reversal_v2 import ASSETS, RULESET, run_validation

DATA=Path(os.environ.get('PERP_REVERSAL_V2_DATA_DIR','/tmp/meridian-perp-reversal-v2'))
OUT=ROOT/'research'/'results'

def sha256(path):
    h=hashlib.sha256()
    with open(path,'rb') as f:
        for chunk in iter(lambda:f.read(1024*1024),b''):h.update(chunk)
    return h.hexdigest()

def compact(m):
    if not m:return None
    return {
      'periods':m['periods'],'returnPct':m['returnPct'],'priceOnlyReturnPct':m['priceOnlyReturnPct'],
      'profitFactor':m['profitFactor'],'sharpe':m['sharpe'],'maxDrawdownPct':m['maxDrawdownPct'],
      'positiveWindows':m['positiveWindows'],'windowsPct':m['windowsPct'],
      'fundingContribution':m['fundingContribution'],'costContribution':m['costContribution'],
      'turnover':m['turnover'],'longContribution':m['longContribution'],'shortContribution':m['shortContribution'],
      'assetAttribution':m['assetAttribution'],'positiveAssets':m['positiveAssets'],
      'positiveConcentrationPct':m['positiveConcentrationPct'],
      'longWeeksByAsset':m['longWeeksByAsset'],'shortWeeksByAsset':m['shortWeeksByAsset'],
      'minEligibleAssets':m['minEligibleAssets'],'maxEligibleAssets':m['maxEligibleAssets'],
      'minHighVolAssets':m['minHighVolAssets'],'maxHighVolAssets':m['maxHighVolAssets'],
      'sideCounts':m['sideCounts'],
      'meanHighVolAnnualizedVol':m['meanHighVolAnnualizedVol'],
      'medianHighVolAnnualizedVol':m['medianHighVolAnnualizedVol'],
      'meanLongFormationReturn':m['meanLongFormationReturn'],
      'meanShortFormationReturn':m['meanShortFormationReturn'],
      'meanLongNextWeekReturn':m['meanLongNextWeekReturn'],
      'meanShortNextWeekReturn':m['meanShortNextWeekReturn'],
      'meanLoserMinusWinnerNextWeek':m['meanLoserMinusWinnerNextWeek'],
    }

manifest=json.loads((DATA/'manifest.json').read_text())
if manifest.get('range')!={'start':'2024-11','end':'2026-08'}:
    raise RuntimeError('unexpected V2 validation raw-data range')
if manifest.get('stage')!='INDEPENDENT_VALIDATION':
    raise RuntimeError('unexpected V2 data stage')
if manifest.get('dataAfter2026_08Loaded') is not False:
    raise RuntimeError('data after frozen validation end is not allowed')
if list(manifest.get('assets',[]))!=list(ASSETS):
    raise RuntimeError('V2 validation universe mismatch')

raw={}
for asset in ASSETS:
    p=DATA/(asset+'.json')
    if not p.exists():raise RuntimeError(f'missing collected asset file {asset}')
    raw[asset]=json.loads(p.read_text())

result=run_validation(raw)
summary={
  'generatedAt':datetime.now(timezone.utc).isoformat(),
  'ruleset':RULESET,
  'stage':'INDEPENDENT_VALIDATION',
  'source':'Binance Vision official public USD-M monthly archives',
  'rawWindow':'2024-11..2026-08',
  'validationWindow':'2025-01-06..2026-08-31',
  'assets':list(ASSETS),
  'highVolRule':'upper half by pre-skip 8-week realized daily volatility',
  'v1DiscoveryReusedAsGate':False,
  'dataIntegrityFailure':result.get('dataIntegrityFailure',False),
  'error':result.get('error'),
  'result':compact(result.get('result')),
  'stress':compact(result.get('stress')),
  'gate':result.get('gate'),
  'decision':result.get('decision'),
  'researchOnly':True,'executionImpact':False,'autoPromotion':False,
}

OUT.mkdir(parents=True,exist_ok=True)
sp=OUT/'high-volatility-perpetual-cross-sectional-reversal-v2-summary.json'
fp=OUT/'high-volatility-perpetual-cross-sectional-reversal-v2-full.json'
mp=OUT/'high-volatility-perpetual-cross-sectional-reversal-v2.md'
sp.write_text(json.dumps(summary,indent=2)+'\n')
fp.write_text(json.dumps({'summary':summary,'rawResult':result},indent=2)+'\n')

if summary['dataIntegrityFailure']:
    md=f"""# High-Volatility Perpetual Cross-Sectional Reversal V2 — Independent Validation

Generated: {summary['generatedAt']}

**Decision:** {summary['decision']}

**DATA INTEGRITY FAILURE:** {summary['error']}

No transfer validation is authorized.
"""
else:
    r=summary['result'];st=summary['stress']
    attrs='\n'.join(f"| {a} | {r['assetAttribution'][a]*100:.3f}% | {r['longWeeksByAsset'][a]} | {r['shortWeeksByAsset'][a]} |" for a in ASSETS)
    md=f"""# High-Volatility Perpetual Cross-Sectional Reversal V2 — Independent Validation

Generated: {summary['generatedAt']}

This is the first strategy-PnL evaluation of V2 on the previously untouched 2025-2026 window.

| Metric | Result |
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
| Positive concentration | {r['positiveConcentrationPct']:.2f}% |
| Min full eligible assets | {r['minEligibleAssets']} |
| Min high-vol subset | {r['minHighVolAssets']} |
| Side counts | {r['sideCounts']} |
| Mean loser-minus-winner next-week spread | {r['meanLoserMinusWinnerNextWeek']*100:.3f}% |

## Asset attribution

| Asset | Net attribution | Long weeks | Short weeks |
|---|---:|---:|---:|
{attrs}

**Gate:** {'PASS' if summary['gate']['pass'] else 'FAIL'}

**Decision:** {summary['decision']}

Gate reasons: {', '.join(summary['gate'].get('reasons',[])) or 'none'}

Research only. Even a PASS authorizes only a separately frozen transfer validation.
"""
mp.write_text(md)

summary['artifactHashes']={
  'summaryPrehashSha256':sha256(sp),
  'fullSha256':sha256(fp),
  'markdownSha256':sha256(mp),
}
sp.write_text(json.dumps(summary,indent=2)+'\n')
print(json.dumps(summary,indent=2))
