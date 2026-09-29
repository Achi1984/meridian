# Cross-Venue Funding Spread V1 — Frozen Transfer Holdout Result

Workflow run: **36527605999**  
Artifact: **11015656202**  
Artifact ZIP SHA-256: `f0cd07479fb1a534275feb9a3930c732117196ac002af54236b5c245248af7f7`  
Summary SHA-256: `030c92eebfe04e0cb71ea76a6036b8936d9480c912a530523501711f45448c78`  
Full evidence SHA-256: `6254df80b087de75634591a9d786ce8411156e1eaf7a603052699f8620949ad5`

This records the first untouched transfer-universe holdout of `CROSS-VENUE-FUNDING-SPREAD-V1-FROZEN`.

## Frozen result

- Holdout assets: DOGE, XRP, LINK, AVAX
- Valid asset-month cycles: 140
- Rejected cycles: 40
- Net return: **+5.5513%**
- Net PnL: **+$4,372.28**
- Profit Factor: **2.5827**
- Max closed-equity drawdown: **2.4434%**
- Funding PnL: **+$9,032.02**
- Cross-venue basis PnL: **-$179.74**
- Modeled base costs: **$4,480.00**
- Stress return (+5 bps/fill): **+1.9245%**
- Positive chronological windows: **4/5**
- Positive-PnL concentration: **51.19%**
- Frozen gate: **FAIL**

## Asset attribution

| Asset | Cycles | Net PnL | Stress PnL | Funding PnL | Basis PnL | Costs |
|---|---:|---:|---:|---:|---:|---:|
| DOGE | 35 | +$2,346.90 | +$1,646.90 | +$3,512.43 | -$45.53 | $1,120 |
| XRP | 35 | **-$212.00** | -$912.00 | +$966.29 | -$58.29 | $1,120 |
| LINK | 35 | +$1,545.82 | +$845.82 | +$2,743.30 | -$77.49 | $1,120 |
| AVAX | 35 | +$691.57 | -$8.43 | +$1,810.00 | +$1.57 | $1,120 |

## Frozen gate failure

`XRP_PNL_NOT_POSITIVE`

## Decision

**HOLDOUT_FAIL_RESEARCH_REDESIGN**

The aggregate portfolio is profitable, but the pre-committed holdout required every frozen transfer asset to be net positive. XRP fails that criterion. The gate is not relaxed, XRP is not removed, and the V1 strategy is not promoted to Paper shadow or live execution.

Any successor must use a newly frozen ruleset. No V1 threshold, venue direction, cost assumption, asset list or date window may be changed post hoc to rescue this result.
