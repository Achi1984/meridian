#!/usr/bin/env python3
import hashlib, json, os, sys
from datetime import datetime, timezone
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'research'))

from self_history_perp_factor_v3 import (
    DISCOVERY_ASSETS, FACTORS, RULESET, run_discovery
)

DATA=Path(os.environ.get('SELF_HISTORY_V2_DATA_DIR','/tmp/meridian-self-history-v2'))
OUT=ROOT/'research'/'results'
START=int(datetime(2023,4,3,tzinfo=timezone.utc).timestamp()*1000)
END=int(datetime(2024,12,30,tzinfo=timezone.utc).timestamp()*1000)

def sha256(path):
    h=hashlib.sha256()
    with open(path,'rb') as f:
        for chunk in iter(lambda:f.read(1024*1024),b''):h.update(chunk)
    return h.hexdigest()

def compact_method(m):
    if not m:return None
    return {
      'method':m['method'],'periods':m['periods'],'activeWeeks':m['activeWeeks'],
      'returnPct':m['returnPct'],'priceOnlyReturnPct':m['priceOnlyReturnPct'],
      'profitFactor':m['profitFactor'],'sharpe':m['sharpe'],'maxDrawdownPct':m['maxDrawdownPct'],
      'positiveWindows':m['positiveWindows'],'windowsPct':m['windowsPct'],
      'fundingContribution':m['fundingContribution'],'costContribution':m['costContribution'],
      'turnover':m['turnover'],'longContribution':m['longContribution'],'shortContribution':m['shortContribution'],
      'assetAttribution':m['assetAttribution'],'positiveAssets':m['positiveAssets'],
      'positiveConcentrationPct':m['positiveConcentrationPct'],'factorBooks':m['factorBooks']
    }

manifest=json.loads((DATA/'manifest.json').read_text())
raw={}
for asset in DISCOVERY_ASSETS:
    p=DATA/(asset+'.json')
    if not p.exists():raise RuntimeError(f'missing collected asset file {asset}')
    raw[asset]=json.loads(p.read_text())

result=run_discovery(raw,START,END)

summary={
  'generatedAt':datetime.now(timezone.utc).isoformat(),
  'ruleset':RULESET,
  'stage':'DISCOVERY',
  'source':'Binance Vision official public USD-M monthly archives',
  'foundation':'PERPETUAL-FACTOR-DATA-V1',
  'window':{
    'entryStart':'2023-04-03T00:00:00Z',
    'entryEndExclusive':'2024-12-30T00:00:00Z',
    'finalExit':'2024-12-30T00:00:00Z'
  },
  'assets':list(DISCOVERY_ASSETS),
  'factors':list(FACTORS),
  'collected':manifest['files'],
  'dataIntegrityFailure':result.get('dataIntegrityFailure',False),
  'error':result.get('error'),
  'own':compact_method(result.get('own')),
  'xsec':compact_method(result.get('xsec')),
  'ownStress':compact_method(result.get('ownStress')),
  'gate':result.get('gate'),
  'decision':result.get('decision'),
  'researchOnly':True,'executionImpact':False,'autoPromotion':False
}

OUT.mkdir(parents=True,exist_ok=True)
sp=OUT/'self-history-perp-factor-v3-summary.json'
fp=OUT/'self-history-perp-factor-v3-full.json'
mp=OUT/'self-history-perp-factor-v3.md'
sp.write_text(json.dumps(summary,indent=2)+'\n')
fp.write_text(json.dumps({'summary':summary,'result':result},indent=2)+'\n')

if summary['dataIntegrityFailure']:
    md=f"""# Self-History Perpetual Factor V3 — Discovery

Generated: {summary['generatedAt']}

**Decision:** {summary['decision']}

**DATA INTEGRITY FAILURE:** {summary['error']}

No economic promotion decision is allowed from this run.

Research only. No Paper or live promotion.
"""
else:
    o=summary['own']; x=summary['xsec']; st=summary['ownStress']
    rows=[]
    for f in FACTORS:
        rows.append(
          f"| {f} | {o['factorBooks'][f]['returnPct']:.2f}% | "
          f"{x['factorBooks'][f]['returnPct']:.2f}% | "
          f"{o['factorBooks'][f]['activeWeeks']} |"
        )
    md=f"""# Self-History Perpetual Factor V3 — Discovery

Generated: {summary['generatedAt']}

Source: official Binance Vision USD-M 4h perpetual + premium + funding archives.

| Metric | Own-history | Cross-sectional |
|---|---:|---:|
| Periods | {o['periods']} | {x['periods']} |
| Active weeks | {o['activeWeeks']} | {x['activeWeeks']} |
| Net return | {o['returnPct']:.2f}% | {x['returnPct']:.2f}% |
| Price-only return | {o['priceOnlyReturnPct']:.2f}% | {x['priceOnlyReturnPct']:.2f}% |
| Profit Factor | {o['profitFactor']:.3f} | {x['profitFactor']:.3f} |
| Annualized Sharpe | {o['sharpe']:.3f} | {x['sharpe']:.3f} |
| Max drawdown | {o['maxDrawdownPct']:.2f}% | {x['maxDrawdownPct']:.2f}% |
| Positive windows | {o['positiveWindows']}/5 | {x['positiveWindows']}/5 |
| 4x-cost stress | {st['returnPct']:.2f}% | n/a |

## Independent factor books

| Factor | Own-history return | Cross-sectional return | Own active weeks |
|---|---:|---:|---:|
{chr(10).join(rows)}

**Gate:** {'PASS' if summary['gate']['pass'] else 'FAIL'}

**Decision:** {summary['decision']}

Gate reasons: {', '.join(summary['gate'].get('reasons',[])) or 'none'}

Research only. Discovery cannot directly authorize Paper or live execution.
"""

mp.write_text(md)
summary['artifactHashes']={
  'summarySha256':sha256(sp),
  'fullSha256':sha256(fp),
  'markdownSha256':sha256(mp)
}
sp.write_text(json.dumps(summary,indent=2)+'\n')
print(json.dumps(summary,indent=2))
