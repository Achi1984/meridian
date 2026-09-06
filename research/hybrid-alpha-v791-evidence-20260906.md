# MERIDIAN v7.91 — Reliability Router Evidence

Status: RESEARCH ONLY. No execution impact. No promotion.

Final reproducible evidence run: `34023767761` on head `b8590cf84f1e50d576401e3f4d7da265ddcf5e8d`.
Artifact: `9986377435`, digest `sha256:35c449ce4f2e37159c9e94654ef086ca6592822c3bdfcd86beed90992fa359e4`.
Cutoff: `2026-09-06T08:45:00Z`.

Important methodology fix before this run: the evidence clock is anchored to the latest completed 15m candle and decision samples are anchored to UTC 4h/12h/24h boundaries. This removes phase drift between repeated runs. Transaction costs scale with research risk. Outcome windows do not overlap within each symbol/horizon.

## V1 baseline on reproducible evidence

- 4h: 30/60/90d PF `0.76 / 0.83 / 0.94` — negative.
- 12h: PF `1.26 / 1.02 / 1.10`; 90d EXP `+0.146R`, but chronological folds are PF `1.29 / 0.85 / 1.27`.
- 24h: PF `1.87 / 1.36 / 1.40`; 90d EXP `+0.877R`, but folds are PF `1.51 / 0.87 / 1.83`.

24h is the strongest horizon but still fails strict temporal robustness because the middle fold is negative.

90d structural signal:
- 12h LONG PF 1.39 / EXP +0.501R; SHORT PF 0.81 / EXP -0.321R.
- 24h LONG PF 2.00 / EXP +2.066R; SHORT PF 0.70 / EXP -0.684R.
- 12h RANGE PF 1.88; 24h TRANSITION PF 2.24. This regime disagreement reinforces that one global hard regime gate is inappropriate.
- SOL is positive across 4h/12h/24h, but no asset allow-list is justified.

## v7.91 prior-only reliability router

The router uses only earlier matured outcomes from side/regime/symbol cohorts, shrinks expectancy toward neutral, and may only reduce V1 risk. It never blocks a trade and never increases risk above V1.

Result: **REJECT v7.91.**

It does not improve the strategy robustly. Examples:
- 4h 30d EXP improves from -0.209R to -0.168R and DD falls slightly, but 60d/90d DD worsens.
- 12h 90d EXP falls from +0.146R to +0.111R and DD rises materially.
- 24h 90d EXP falls from +0.877R to +0.802R and DD rises from 63.867R to 82.433R.

Interpretation: trailing cohort expectancy is too unstable / too correlated with recent outcomes to serve as a useful generic risk attenuator in this form. De-risking after weak cohorts can suppress subsequent recovery winners and worsen path-dependent drawdown.

## Next thesis

Do not tune v7.91 shrinkage constants. Next candidate should address a more structural omission in V1: the alpha stack has intraday 15m/1h/4h trend evidence but no slow daily-scale directional context. Test a **Macro Trend Overlay** as soft evidence / risk context using only prior BTC market information (e.g. 7d/30d trend and volatility-normalized drift). It must be symmetric: it may attenuate LONG when macro drift is negative and SHORT when macro drift is positive; it must not hard-ban either side or increase risk above V1.
