# MERIDIAN v7.100 — OKX Taker-Flow Opposition Evidence

Status: REJECTED / MICROSTRUCTURE THRESHOLD SERIES STOPPED / NO PROMOTION  
Evidence date: 2026-09-06  
Predeclaration commit: `3f02b3c4849eec60a56b41c0b466b7d3947c737b`

## First evaluable result

- Workflow: Hybrid Alpha v7.100 OKX Taker Evidence, run #2
- Run ID: `34054438700`
- Tested head: `e4f72611b031d096c6c0b84d3bdae02946d14daa`
- Artifact ID: `9995570153`
- Digest: `sha256:968cb1f33d81ba38f73dec9382fb3c565cb63a241a7d11808864e5b1766e2e91`
- Cutoff: `2026-09-06T19:00:00.000Z`
- Release Safety #821: success
- Unit tests: 4/4 passed

Run #1 requested the oldest chunk first and received OKX code 50030, Illegal time range. Before inspecting any alpha result, transport order was corrected to newest-first while retaining every rejected old chunk. Hypothesis, threshold, factor, windows and universe were unchanged.

## Source retention

For every locked currency, the public endpoint returned:

- 720 unique hourly rows
- range: 2026-08-07 20:00Z through 2026-09-06 19:00Z
- duplicates: 0
- 15 older requested chunks rejected as outside the legal range

The practical public retention is about 30 days. Missing evidence leaves v7.97 unchanged. The 60d/90d evaluation was not shortened after this finding.

## Locked hypothesis

On frozen v7.97 rows, 24 completed hourly OKX buy/sell volumes formed a currency-level taker imbalance. All seven imbalances were standardized cross-sectionally. Only direction-opposed extremes at |z| >= 1.50 multiplied risk by 0.60. Funding and OI were excluded; trade count and side were unchanged.

## Primary 24h comparison: v7.97 -> v7.100

| Window | PF | Expectancy | Max DD | Trades | Attenuated / missing |
|---|---:|---:|---:|---:|---:|
| 30d | 2.04 -> 2.00 | +1.533R -> +1.479R | 34.327R -> 34.327R | 131 -> 131 | 2 / 5 |
| 60d | 1.19 -> 1.17 | +0.334R -> +0.308R | 112.477R -> 115.307R | 274 -> 274 | 2 / 148 |
| 90d | 1.36 -> 1.35 | +0.544R -> +0.528R | 101.560R -> 104.390R | 421 -> 421 | 2 / 295 |

PF and expectancy degrade on every primary window. Drawdown worsens on 60d and 90d. The predeclared decision rule fails.

## Chronological folds and concentration

- 90d Fold 1: all 147 decisions missing; unchanged.
- 90d Fold 2: all 140 decisions missing; unchanged at PF 0.63 / EXP -0.782R.
- 90d Fold 3: PF 2.03 -> 2.00; EXP +1.500R -> +1.447R; two attenuations.
- Only 2/421 trades are affected; both are LONG and BULL.
- No SHORT trade is attenuated, so the negative SHORT cohort is unchanged.
- The affected assets are AVAX and LINK, one each.
- AVAX worsens to PF 0.36 / EXP -1.837R / DD 102.128R.
- LONG x BULL worsens to PF 0.80 / EXP -0.434R / DD 47.423R.

The affected sample is tiny, one-sided and harmful.

## Final decision

REJECT v7.100. Do not tune z threshold, 24h aggregation, factor, side mapping, asset universe or regime.

The isolated OKX microstructure tests now conclude:

- v7.98 funding crowding: rejected for non-uniform fold behavior and tiny sample.
- v7.99 relative OI expansion: rejected; performance degraded and public retention was about 60 days.
- v7.100 taker-flow opposition: rejected; performance degraded, sample was 2 trades and public retention was about 30 days.

Stop microstructure threshold experiments. Do not combine these failed signals into an opaque composite. Next research must be structurally different: preferably a leakage-free meta-allocator design with prospective evaluation, or wait for the locked prospective holdout. No automatic promotion.

No Baseline, Paper, live execution, Pionex, `server.js`, entry, exit or production behavior changed.
