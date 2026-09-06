# MERIDIAN RESUME — 2026-09-06

## Production / app
- Canonical repository: `Achi1984/meridian`; production default branch `main`.
- Baseline `6.2.0 / 6.2-SIGNAL-V1` is frozen. No live trading. No research auto-promotion.
- Five production root views: CENTER / DEPOT / TRADE / PAPER / MORE.
- Current production UI work through R17/R18 remains read-only. Pionex bots are explicitly out of scope for now.
- Current Pionex risk snapshot seen in UI: BTC-S30 WATCH 8.99% buffer, HBAR-L3 SAFE 27.33%, XRP-L5 SAFE 40.65%; do not modify unless user explicitly reopens Pionex work.

## Portfolio valuation finding
- User noticed CENTER repeatedly showing roughly `$27.313`, raising suspicion that the total was not actually live.
- Existing `v8-clean/data.js` computes spot from holdings using `portfolio.livePrices` when present, then adds protected Pionex/trading equity.
- Re-fetching `/api/private/dashboard` with `cache:no-store` does not guarantee fresh prices if the backend's persisted `livePrices` are stale.
- Current handoff records a Clean R18 near-live Spot valuation approach: overlay fresh public Binance ticker prices client-side onto the protected dashboard snapshot, preserve aliases `BETH -> ETH` and `OKSOL -> SOL`, stablecoins at 1 USD, and retain canonical fallback for unsupported assets.
- Important semantic constraint: Spot can be near-live on the frontend refresh cadence; Pionex/trading equity remains protected snapshot/manual data, so total portfolio must not be labeled fully exchange-live unless that trading component becomes live too.
- Next validation: observe CENTER/DEPOT across at least two refresh cycles and verify value movement while coin prices move.

## Paperbot / Challenger findings
- Challenger V2 is the strongest legacy paperbot but still not promoted.
- Current PAPER cohort board shows Challenger around `-$30`, EXP about `-$1`, PF `0.98`, versus Baseline around `-$854`, EXP `-$28`, PF `0.63`.
- SIDE: SHORT is the first adequate positive cohort: 19 trades, EXP about `+$6`, PF `1.11`; LONG only 4 trades, EXP about `-$36`, PF `0.29` and sample too small.
- REGIME: RANGE is very strong but under-sampled: 7 trades, EXP about `+$87`, PF `5.75`; TRANSITION has 14 trades, EXP about `-$44`, PF `0.39` but improves materially versus Baseline; BEAR is under-sampled.
- ASSET: ETHUSDT is the strongest adequate asset cohort: 9 trades, EXP about `+$20`, PF `1.38`; SOLUSDT 8 trades roughly break-even (PF `0.98`); BTCUSDT 6 trades weak and under-sampled.
- Do not create SHORT-only, ETH-only, RANGE-only or other hard filters from these cohorts. Use cohort reliability as soft evidence only after robust OOS validation.

## Hybrid Alpha programme
### Thesis mix
Hybrid Alpha combines soft evidence rather than stacking hard gates:
- trend / time-series momentum,
- relative strength,
- mean reversion weighted more in RANGE/CHOP,
- carry/funding when available,
- order flow / microstructure when available,
- macro BTC drift overlay,
- volatility targeting, liquidity haircut and reversal-risk attenuation.
Missing features are not fabricated; available weights re-normalize. Risk multipliers may only reduce risk, never lever above 1x.

### v7.89–v7.93 key findings
- 4h horizon rejected.
- 12h mixed.
- 24h strongest.
- v7.92 macro trend overlay improved PF/DD across 24h windows without hard direction gates.
- v7.93 added one predeclared soft attenuation: `TRANSITION × SHORT` risk multiplied by `0.60`; no trade blocked and trade count unchanged.
- On the earlier 3-asset universe, v7.93 24h looked strong: PF roughly `2.11 / 1.56 / 1.59` across 30/60/90d, with the previously bad middle chronological fold improved near break-even rather than fully fixed.

### v7.94 locked 7-asset robustness gate
Universe locked before evidence read: BTC, ETH, SOL, XRP, ADA, AVAX, LINK.
24h v7.93 results:
- 30d: PF `1.82`, EXP `+1.473R`, DD `46.753R`, 131 trades.
- 60d: PF `1.11`, EXP `+0.233R`, DD `144.889R`, 274 trades.
- 90d: PF `1.25`, EXP `+0.470R`, DD `125.899R`, 421 trades.
90d chronological folds:
- Fold 1 PF `1.76`, EXP `+0.912R`.
- Fold 2 PF `0.64`, EXP `-0.922R`.
- Fold 3 PF `1.81`, EXP `+1.440R`.
Therefore robustness fails and there is NO PROMOTION.
90d breadth:
- BTC PF 1.45 / +0.814R
- ETH PF 2.11 / +1.763R
- SOL PF 1.29 / +0.491R
- XRP PF 1.05 / +0.082R
- ADA PF 1.62 / +0.872R
- AVAX PF 0.41 / -2.017R
- LINK PF 1.31 / +0.581R
Do not retrospectively drop AVAX.
Concentration:
- LONG PF 1.53 / +1.088R
- SHORT PF 0.90 / -0.157R
- TRANSITION PF 2.05 / +1.435R
- RANGE/BULL/BEAR all below PF 1.
Do not convert these observations into hard LONG-only or TRANSITION-only rules.

### v7.95 failure-state attribution
Predeclared decision-time buckets were used before reviewing results.
Two clean repeated failure states emerged:
1. WEAK alpha `|alpha| 0.20–0.35`: fold2 n=52, EXP `-0.507R`; full 90d n=129, EXP `-0.261R`; negative in the other folds too.
2. LOW liquidity `<0.50`: fold2 n=14, EXP `-1.411R`; full 90d n=52, EXP `-0.878R`; negative in the other folds too.
Descriptive but not promoted to rules: `BULL × macro-aligned` and `LONG × macro-aligned` are negative across folds, likely requiring interpretation as overextension rather than universal anti-trend evidence.

### v7.96 next hypothesis
- Isolated branch: `research/hybrid-alpha-v796-weak-alpha`.
- Test exactly one hypothesis: WEAK-alpha risk attenuation for `|alpha| 0.20–0.35` using the already-existing fixed factor `0.60`.
- No new parameter search, no hard gate, no trade blocking, no asset dropping, no factor tuning after seeing evidence.
- Required evaluation: 30/60/90d, same 7-asset universe, 24h primary horizon, chronological 3-fold walk-forward, PF/EXP/DD/trade count, and compare directly against frozen v7.93.
- Promotion remains prohibited unless common-window/OOS robustness, sample adequacy, positive expectancy/PF, acceptable DD, useful coverage and stability all pass with explicit human approval.

## Research branches / PRs
- PR #67: v7.89–v7.93 Hybrid Alpha research, draft/no promotion.
- PR #68: v7.94 7-asset robustness gate, draft/no promotion.
- PR #69: v7.95 failure-state attribution, draft/no promotion.
- v7.96 branch exists for weak-alpha attenuation research.
- v7.79 prospective holdout remains locked and separate.
- v7.86 Retest/Hold Breakout V2 remains separate research.
- Meta Allocator remains design/research only.

## Hard invariants for next chat
- Pionex bots stay untouched for now.
- Baseline 6.2 frozen.
- `server.js` untouched unless explicitly justified/approved.
- Paper/live execution remains disconnected from research.
- No automatic promotion.
- Do not over-filter: prefer soft scoring/risk attenuation over more hard entry gates.
- Always track performance + trade frequency/opportunity cost, LONG/SHORT × regime, asset concentration, DD, sample adequacy and walk-forward OOS.
- Save every meaningful checkpoint to GitHub with descriptive commits; research stays on named branches until deliberate review/merge.
