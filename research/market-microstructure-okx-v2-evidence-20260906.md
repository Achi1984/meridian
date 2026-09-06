# MERIDIAN Market Microstructure — OKX Source Audit V2 Evidence

Status: DATA FOUNDATION PASS / RESEARCH ONLY / NO ALPHA EVIDENCE / NO PROMOTION  
Evidence date: 2026-09-06  
Predeclaration commit: `cd75df31fee67e460b1daff254ae272400118153`

## Reproducible evidence

- GitHub workflow: Market Microstructure OKX V2, run #2
- Run ID: `34052332118`
- Exact tested head: `a308e25ed3127e52d010d61a2312bc243c4e55bc`
- Artifact ID: `9994936981`
- Artifact digest: `sha256:b9b4540d32d02b5e5ce2ae7f72e8c692ead33eff19b12e83611991a8a4977b5e`
- Cutoff: `2026-09-06T17:00:00.000Z`
- Release Safety #814: success on the same head
- Unit tests: 4/4 passed

The first evidence run was transport-limited by HTTP 429 during taker-volume collection. Run #2 used bounded retry/backoff with every attempt retained in transport metadata. Windows, gates, universe and feature definitions were unchanged.

## Result

All locked instruments produced the same coverage profile and passed every predeclared gate.

| Feature | Requested | Rows per instrument | Expected | Coverage | Returned range | Duplicates / invalid | Gap / freshness | Result |
|---|---:|---:|---:|---:|---|---:|---|---|
| Funding | 90d | 270 | 271 | 99.63% | 2026-06-09 00:00Z — 2026-09-06 16:00Z | 0 / 0 | max 8h / age 1h | PASS 7/7 |
| Open interest | 30d 1H | 721 | 721 | 100.00% | 2026-08-07 17:00Z — 2026-09-06 17:00Z | 0 / 0 | max 1h / age 0h | PASS 7/7 |
| Taker flow | 30d 1H | 719 | 721 | 99.72% | 2026-08-07 19:00Z — 2026-09-06 17:00Z | 0 / 0 | max 1h / age 0h | PASS 7/7 |

Locked universe: BTC, ETH, SOL, XRP, ADA, AVAX and LINK USDT perpetual swaps.

## Decision

```json
{
  "featureReady": {
    "funding": true,
    "openInterest": true,
    "takerFlow": true
  },
  "allFeaturesReady": true,
  "alphaEvidence": false,
  "experimentPermitted": false,
  "promotionPermitted": false
}
```

The official unauthenticated OKX source is technically suitable as a venue-specific foundation for a separately predeclared alpha experiment. It is not interchangeable with Binance evidence: taker volume is requested by base currency with `instType=CONTRACTS`, while funding and open interest are instrument-specific.

No production, Paper, live execution, Pionex, Baseline, `server.js`, entry, exit or sizing behavior changed.

## Next research decision

If continued, create a new research branch and predeclare exactly one causal use of the OKX evidence before inspecting performance. Preferred first candidate: a soft risk attenuation based on one normalized microstructure state, with risk multiplier capped at 1 and no trade blocking. Evaluate 24h primary over 30/60/90d plus three chronological folds, unchanged opportunities, PF/EXP/DD, LONG/SHORT x regime, asset concentration and sample adequacy. Do not combine funding, OI and taker flow into an opaque composite in the first experiment.
