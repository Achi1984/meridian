# MERIDIAN RESUME — 2026-09-06

## Production / app
- Canonical repository: `Achi1984/meridian`; production default branch `main`.
- Baseline `6.2.0 / 6.2-SIGNAL-V1` is frozen. No live trading. No research auto-promotion.
- Five production root views: CENTER / DEPOT / TRADE / PAPER / MORE.
- Current production UI work through R18 remains read-only. Pionex bots are explicitly out of scope for now.
- Current Pionex risk snapshot seen in UI: BTC-S30 WATCH 8.99% buffer, HBAR-L3 SAFE 27.33%, XRP-L5 SAFE 40.65%; do not modify unless user explicitly reopens Pionex work.

## Portfolio valuation finding + fix
- User noticed CENTER repeatedly showing roughly `$27.313`, raising suspicion that the total was not actually live.
- Existing `v8-clean/data.js` computes spot from holdings using `portfolio.livePrices` when present, then adds protected Pionex/trading equity.
- Root cause: `/api/private/dashboard` can return persisted PostgreSQL `livePrices`; repeated browser GETs with `cache:no-store` may therefore re-read the same stale market snapshot.
- Clean R18 / PR #70 is merged. It overlays fresh public Binance spot ticker prices in-browser onto the protected dashboard snapshot before existing canonical `spot + trading` valuation runs.
- Privacy rule: the browser fetches the full public ticker table; held symbols, quantities and venues are not sent as holding-specific Binance query parameters.
- Pricing aliases preserved: `BETH -> ETH`, `OKSOL -> SOL`; USD/USDT/USDC/FDUSD/DAI are treated as 1 USD; unsupported assets keep the canonical fallback instead of receiving invented prices.
- If the public feed is unavailable, persisted stale `livePrices` are cleared for that read so stale values are not mislabeled as live.
- Spot valuation is near-live at the existing visible-view refresh cadence (~30s). Pionex/trading equity remains protected snapshot/manual data, therefore the aggregate total must not be called fully exchange-live.
- PR #70 exact final head `53c20a90080dd35ec6944c20d5973ba7cc8c375f`, merge commit `11c22b128feb1d88f69fa5c12f411bd772cee609`, Release Safety #787 green.
- Next validation in the new chat: observe CENTER and DEPOT across at least two 30-second refresh cycles while prices move and verify the value changes coherently.

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
- PR #69 remains draft / research only. Exact-head Release Safety #780 and exact-head Failure Attribution run #44 both completed green on head `f0b42dbb292ed673016830643de60e49dda7daee`.

### v7.96 weak-alpha risk attenuation — completed evidence
- Isolated branch: `research/hybrid-alpha-v796-weak-alpha`.
- Candidate was locked before the run: for `|alpha|` in `[0.20, 0.35)`, multiply existing v7.93 research risk by the already-used factor `0.60`.
- No new parameter search, no hard gate, no trade blocking, no asset dropping, no factor tuning after evidence.
- 24h primary horizon versus frozen v7.93:
  - 30d: PF `1.82 -> 1.96`; EXP `+1.473R -> +1.490R`; DD `46.753R -> 37.511R`; trades `131 -> 131`.
  - 60d: PF `1.11 -> 1.15`; EXP `+0.233R -> +0.281R`; DD `144.889R -> 123.038R`; trades `274 -> 274`.
  - 90d: PF `1.25 -> 1.32`; EXP `+0.470R -> +0.502R`; DD `125.899R -> 112.760R`; trades `421 -> 421`.
- This is a genuine aggregate improvement on all three 24h windows with unchanged opportunity count.
- 90d chronological folds under v7.96:
  - Fold 1: PF `1.89`, EXP `+0.914R`, DD `27.406R`, 147 trades.
  - Fold 2: PF `0.62`, EXP `-0.847R`, DD `126.798R`, 140 trades.
  - Fold 3: PF `1.96`, EXP `+1.459R`, DD `118.890R`, 134 trades.
- The middle fold remains materially negative. Chronological robustness still fails, therefore NO PROMOTION.
- Horizon specificity matters: 4h remains negative and v7.96 slightly worsens it; 12h is mixed and weakened; 24h is the only horizon with consistent aggregate improvement.
- Do not generalize v7.96 across horizons. Do not tune `0.60` or the `[0.20,0.35)` band.
- Exact-head evidence run #3 on head `9f07a2c5b1f2d7919b2a917e3e5b798d759bf3f9`; artifact `9988042124`; digest `sha256:67475d7d66738a22fecf6f1db0da021b40b80a9ac253922663b6f0ba055cfc49`; cutoff `2026-09-06T10:45:00Z`.
- Branch current head `b4478ff632ea7eb172f3aaba19da9cb38988e85e` pins the exact-head evidence reference.

## Research branches / PRs
- PR #67: v7.89–v7.93 Hybrid Alpha research, draft/no promotion.
- PR #68: v7.94 7-asset robustness gate, draft/no promotion.
- PR #69: v7.95 failure-state attribution, draft/no promotion.
- v7.96 branch `research/hybrid-alpha-v796-weak-alpha`: evidence complete, still isolated/no promotion.
- v7.79 prospective holdout remains locked and separate.
- v7.86 Retest/Hold Breakout V2 remains separate research.
- Meta Allocator remains design/research only.

## Immediate next actions for new chat
1. First read `MERIDIAN_RESUME_2026-09-06.md` and `MERIDIAN_HANDOFF.md` from canonical GitHub before changing code.
2. Validate Clean R18 near-live portfolio value on iPhone across at least two ~30s refresh cycles; if stale, inspect only the read-only market overlay/refresh path first, not backend execution.
3. Continue Hybrid Alpha from v7.96 evidence. The unresolved research problem is the persistent negative middle chronological fold. Any v7.97 hypothesis must be independently predeclared from already-known evidence; do not optimize against Fold 2 after seeing it.
4. Strong candidate for future research from v7.95 is LOW liquidity `<0.50`, but it must be tested as one isolated soft risk attenuation hypothesis, not combined with weak-alpha changes in the same experiment unless predeclared as a separate interaction study.
5. Pionex bots remain unchanged unless the user explicitly reopens them.

## Hard invariants for next chat
- Pionex bots stay untouched for now.
- Baseline 6.2 frozen.
- `server.js` untouched unless explicitly justified/approved.
- Paper/live execution remains disconnected from research.
- No automatic promotion.
- Do not over-filter: prefer soft scoring/risk attenuation over more hard entry gates.
- Always track performance + trade frequency/opportunity cost, LONG/SHORT × regime, asset concentration, DD, sample adequacy and walk-forward OOS.
- Save every meaningful checkpoint to GitHub with descriptive commits; research stays on named branches until deliberate review/merge.


## SSOT UPDATE — 2026-09-06 16:30 UTC

This section supersedes the earlier “Immediate next actions” and research-status sections where they conflict.

### Hybrid Alpha v7.97 — low-liquidity attenuation complete

- Draft PR #73; branch `research/hybrid-alpha-v797-low-liquidity`; current head `6905f7d2bc2386f0b5390acaff121718a52ce065`.
- One predeclared change on frozen v7.96: when decision-time `liquidityQuality <0.50`, multiply existing research risk by fixed factor `0.60`.
- No gate, trade blocking, parameter search, asset removal or opportunity-count change.
- 24h direct v7.93 / v7.96 / v7.97:
  - 30d PF `1.82 / 1.96 / 2.04`; EXP `+1.473 / +1.490 / +1.533R`; DD `46.753 / 37.511 / 34.327R`; n `131`.
  - 60d PF `1.11 / 1.15 / 1.19`; EXP `+0.233 / +0.281 / +0.334R`; DD `144.889 / 123.038 / 112.477R`; n `274`.
  - 90d PF `1.25 / 1.32 / 1.36`; EXP `+0.470 / +0.502 / +0.544R`; DD `125.899 / 112.760 / 101.560R`; n `421`.
- v7.97 improves every aggregate 24h window with unchanged trades.
- 90d Fold 2 remains negative: PF `0.63`, EXP `-0.782R`, DD `118.013R`, n `140`.
- SHORT remains negative; only TRANSITION is positive; AVAX remains materially negative. None becomes a hard filter.
- Decision: NO PROMOTION. Stop liquidity/alpha threshold search. Next Hybrid Alpha work requires structurally new, leakage-free evidence such as real funding/order-flow/microstructure or a clean meta-allocator.

### Independent FIB Level Bot research

All FIB work is isolated, research-only and disconnected from Paper/live/Pionex.

#### V1 — intratimeframe pivots

- Draft PR #74; branch `research/fib-level-bot-v1`; head `c3cc6dd38ab5bdb54abbee4863e4e9d444cdb12f`.
- Fixed 0.382/0.500/0.618/0.786 entries, 1.000 stop, 0.236/0.000 targets and conservative fills.
- Primary 1h fails; 15m rejected.
- Diagnostic 4h/365d was positive: n `357`, PF `1.27`, EXP `+0.117R`, DD `10.410R`, but was not primary.
- Exact-head Evidence #3 artifact `9991209951`, digest `sha256:7ac988811dff986d93dd24dd738454d9b428678e2a43dbe55886a40aa89ac103`; Release Safety #799 green.
- NO PROMOTION.

#### V2 — unchanged 4h replication

- Draft PR #75; branch `research/fib-level-bot-v2-4h-replication`; head `b8fc8edf66394f4a2ab63b48f511e3a37a80b00d`.
- Temporally disjoint primary year on seven assets fails: n `791`, PF `0.89`, EXP `-0.059R`, net `-46.962R`, DD `77.372R`.
- Fold PF `1.02 / 1.14 / 0.65`; SHORT PF `0.76`; only four of seven assets positive; CORE PF `0.69`; LINK contributes `48.5%` of positive net R.
- Discovery-year secondary remains positive but is not independent confirmation.
- Exact-head Evidence #2 artifact `9991403533`, digest `sha256:e5b8ef90574d7469812afad0fbcea033b55b0ab9ea81264dea66a576be9b1170`; Release Safety #801 green.
- HISTORICAL REPLICATION FAIL. NO PROMOTION.

#### V3 — Daily anchors / 4h execution

- Draft PR #76; branch `research/fib-level-bot-v3-daily-anchor`; head `7b15a8b37431af317bc5d8b50ef960024b353982`.
- Structural change only: confirmed Daily swings anchor the unchanged FIB ladder; orders execute on 4h. No ATR/indicator/regime/asset/side gate.
- Primary unused historical year: n `190`, PF `1.34`, EXP `+0.150R`, net `+28.416R`, DD `6.609R`.
- Fold PF `1.31 / 1.01 / 1.74`; LONG PF `1.25`; SHORT PF `1.41`; CORE PF `1.50`; EXPANSION PF `1.22`.
- Secondary years: PF `1.38` and `1.43`; two-year aggregate n `404`, PF `1.41`, EXP `+0.159R`, DD `14.009R`.
- Eight of nine gates pass. Concentration fails because SOL contributes `59.2%` of positive primary net R versus locked maximum `40%`.
- Exact-head Evidence #2 artifact `9992170844`, digest `sha256:f8013c81e199bf3090f2ecdbb5aadfdde1ddb1b3b8a1cb1f72ca6113b21dec5f`; Release Safety #803 green.
- Strong near-pass, but `historicallyRobust=false`; NO PROMOTION and no retrospective SOL isolation/weighting.

#### V3 prospective holdout

- Draft PR #77; branch `research/fib-level-bot-v3-prospective-holdout`; head `3a5650a2c5b14276969bf5ef9c0dc818204f8d09`.
- Strategy frozen to V3 head; holdout begins `2026-09-06T14:15:00Z`.
- Formal evaluation requires both >=180 elapsed days and >=100 closed prospective baskets; earliest date `2027-03-05T14:15:00Z`.
- Initial exact-head snapshot: zero prospective setups/fills/closed/open; six pre-cutoff carry-over baskets detected and excluded; full 4h coverage for all seven assets; status `NOT_ELIGIBLE`.
- Exact-head artifact `9992985734`, digest `sha256:8948d353ba21e3615da405ea1aa2f375b254425d928c4141f8d9a9b6ad3c1c67`; Release Safety #805 green.
- Passing later permits review only, never automatic promotion.

### Current next actions

1. User must still validate R18 on the physical iPhone across at least two ~30-second cycles. This has not been claimed complete.
2. Do not modify the FIB V3 candidate during its prospective holdout.
3. Do not perform further Hybrid Alpha threshold search; choose structurally new leakage-free evidence before another experiment.
4. Keep PRs #67–#69 and #73–#77 draft/research-only until deliberate review.
5. Pionex bots, Baseline 6.2, `server.js` and Paper/live execution remain untouched.
