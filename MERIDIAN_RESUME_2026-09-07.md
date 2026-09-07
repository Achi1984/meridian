# MERIDIAN RESUME — 2026-09-07

Status: current chat-transfer SSOT. Read this file first together with `MERIDIAN_HANDOFF.md` before changing code.

## 1. Working rules / hard invariants

- Canonical repository: `Achi1984/meridian`; production branch: `main`.
- Current `main` at checkpoint creation: `995b65d32193809712c002a0c9d4205cdfcb35da`.
- German, compact, decision-oriented. If user says `Go`, execute without repeating questions unless a real safety/architecture blocker appears.
- Every meaningful checkpoint must be saved to GitHub with descriptive commits.
- Always create/use a branch before writes. Never add temporary/noop files to `main`.
- Research remains on named research branches until deliberate human review/promotion.
- Release Safety must be checked on the exact intended final head. For merges use `expected_head_sha`.
- Baseline `6.2.0 / 6.2-SIGNAL-V1` is frozen. Do not modify Baseline entries, sizing, risk, exits or ledger behavior without explicit approval.
- Live trading remains disabled. Research is disconnected from Paper/live execution and cannot auto-promote.
- `server.js` stays untouched unless there is an explicit justified architecture decision.
- Pionex bots are out of scope for now. User explicitly said to prioritize Paper/Research bots and leave Pionex unchanged.
- Do not over-filter. Prefer few hard gates and soft scoring/risk attenuation. More evidence must not automatically create more entry conditions.
- Evaluate performance + opportunity frequency, DD, LONG/SHORT × regime, asset concentration, avoided losers + missed winners, sample adequacy and walk-forward/OOS.

## 2. Production v8 status

Five real production root views remain:

`CENTER · DEPOT · TRADE · PAPER · MORE`

Production is read-only. No legacy renderer/view ownership inside `v8-clean/`.

### R18 near-live portfolio valuation — completed and validated

The user noticed CENTER appearing stuck near `$27,313`. Root cause was not browser HTTP cache: `/api/private/dashboard` could repeatedly return a persisted PostgreSQL `livePrices` snapshot, so a `cache:no-store` GET could still re-read stale market prices.

R18 / PR #70 fixed this in the frontend read adapter:

- protected portfolio holdings remain the canonical private quantity/venue source;
- browser overlays fresh public Binance spot prices before canonical `spot + trading` valuation;
- privacy-preserving full ticker table is fetched, so held symbols/quantities/venues are not sent as holding-specific queries;
- aliases preserved: `BETH -> ETH`, `OKSOL -> SOL`;
- USD/USDT/USDC/FDUSD/DAI treated as 1 USD;
- unsupported assets use existing canonical fallback instead of invented prices;
- if the public feed fails, stale persisted `livePrices` are cleared for that read so they are not mislabeled as live;
- visible-view refresh cadence is about 30 seconds;
- Pionex/Trading equity remains protected snapshot/manual data, so total is **near-live spot + snapshot trading**, not fully exchange-live.

PR #70 exact final head: `53c20a90080dd35ec6944c20d5973ba7cc8c375f`; merge commit `11c22b128feb1d88f69fa5c12f411bd772cee609`; Release Safety #787 green.

Physical iPhone validation was later supplied by the user:

- CENTER moved from the suspicious old ~$27,313 to about `$27,846`.
- DEPOT showed about `$27,867`.
- DEPOT reconciled to Spot `$26,972` + Trading/Bots `$896` ≈ `$27,868` within display rounding.
- CENTER/DEPOT delta ~$21 (~0.075%) is plausible from different refresh instants.

Documentation validation PR #79 is merged; `main` checkpoint `995b65d...` records this validation. Do **not** reopen backend/Pionex investigation unless new evidence shows a problem.

### UI state

- R14 removed the redundant customer-view banner.
- R15 established the current CENTER spacing rhythm.
- R16 compressed DEPOT/TRADE/PAPER/MORE while preserving content.
- R17 fixed false `$0` placeholders and shortened the DEPOT technical history label.
- PAPER Cohort Board is live/read-only from protected research telemetry.

## 3. Current Pionex status — observe only

Last UI snapshot used for risk display:

- BTC-S30: SHORT 30x, WATCH, ~8.99% liquidation buffer.
- HBAR-L3: LONG 3x, SAFE, ~27.33% buffer.
- XRP-L5: LONG 5x, SAFE, ~40.65% buffer.

User explicitly decided: **do not touch Pionex for now**. No margin, leverage, SL/TP or bot changes.

## 4. Paperbot / Challenger V2 live telemetry

Challenger V2 remains the strongest legacy paperbot but is not promoted.

Visible PAPER comparison around the latest screenshots:

- Baseline: about `-$854`, EXP `-$28`, PF `0.63`.
- Challenger V2: about `-$30`, EXP `-$1`, PF `0.98`.

Cohort Deep Dive findings:

- SIDE SHORT: 19 trades, EXP about `+$6`, PF `1.11`, adequate sample and first positive adequate cohort.
- SIDE LONG: 4 trades, EXP about `-$36`, PF `0.29`, under-sampled.
- REGIME RANGE: 7 trades, EXP about `+$87`, PF `5.75`, interesting but under-sampled.
- REGIME TRANSITION: 14 trades, EXP about `-$44`, PF `0.39`, but materially better than Baseline.
- ASSET ETHUSDT: 9 trades, EXP about `+$20`, PF `1.38`, strongest adequate asset cohort.
- SOLUSDT: 8 trades, near break-even PF `0.98`.
- BTCUSDT: 6 trades, weak and under-sampled.

Do not create SHORT-only, ETH-only or RANGE-only hard filters from this evidence. Challenger V2 also retains the historical Baseline-READY dependency audit flag.

## 5. Hybrid Alpha programme — current research comparator is frozen v7.97

### Design philosophy

Hybrid Alpha mixes transparent soft evidence:

- trend / time-series momentum,
- relative strength,
- mean reversion with larger weight in RANGE/CHOP,
- macro BTC drift,
- volatility targeting,
- liquidity quality,
- reversal-risk attenuation,
- funding/carry and microstructure only when real leakage-safe data exists.

Missing features are not fabricated. Risk multipliers can reduce risk but do not increase leverage above the base research risk.

### v7.89–v7.96 path

- 4h rejected; 12h mixed; 24h became the only serious horizon.
- v7.92 macro overlay helped 24h PF/DD.
- v7.93 predeclared `TRANSITION × SHORT` risk factor `0.60`.
- v7.94 seven-asset test exposed poor chronological robustness and concentration.
- v7.95 failure attribution found repeated weakness in `|alpha| 0.20–0.35` and `liquidityQuality <0.50`.
- v7.96 weak-alpha attenuation (same fixed 0.60 factor) improved 24h aggregate PF/EXP/DD without removing trades, but Fold 2 stayed negative.

### v7.97 low-liquidity attenuation — frozen strategy-level comparator

Draft PR #73; branch `research/hybrid-alpha-v797-low-liquidity`.

Predeclared change on v7.96: if decision-time `liquidityQuality <0.50`, multiply existing research risk by fixed `0.60`; no gate, no opportunity removal, no side/regime/asset selection.

Original exact-head evidence at cutoff 2026-09-06T13:45Z:

- 30d: PF `2.04`, EXP `+1.533R`, DD `34.327R`, n=131.
- 60d: PF `1.19`, EXP `+0.334R`, DD `112.477R`, n=274.
- 90d: PF `1.36`, EXP `+0.544R`, DD `101.560R`, n=421.
- Fold 2 still materially negative: PF `0.63`, EXP `-0.782R`.
- 90d LONG PF `1.71`; SHORT PF `0.91`.
- Only TRANSITION positive; RANGE/BULL/BEAR negative.
- AVAX remains materially negative but may not be retrospectively dropped.

Exact evidence logic head `9f99e11d1f0980b7f1792b229fdba6289d0be828`; artifact `9990883267`; digest `sha256:fdaafdbb04aea217607c3c4f1333f5e2864965247473c2392fd5b1a08cc9fa3c`.

The rolling comparator naturally changed as the cutoff advanced. In the later v7.101 run at cutoff `2026-09-07T09:00Z`, frozen v7.97 itself measured approximately:

- 30d PF `2.29`, EXP `+1.845R`, DD `32.595R`, n=131.
- 60d PF `1.29`, EXP `+0.513R`, DD `85.043R`, n=273.
- 90d PF `1.44`, EXP `+0.653R`, DD `99.298R`, n=419.

This is a rolling-window update, not parameter tuning. Logic remains frozen.

**Decision:** v7.97 is the current strategy-level research comparator, but still NO PROMOTION because chronological robustness remains unresolved.

## 6. Real microstructure research — v7.98 to v7.100 all rejected

After v7.97 the threshold/indicator series was stopped and research moved to real external microstructure data.

### PR #80 — Binance public source audit

Branch `research/market-microstructure-data-v1`.

Official Binance USDⓈ-M public funding/OI/taker endpoints returned HTTP `451` for all seven assets on the GitHub runner because of location eligibility restrictions.

Decision:

- transport/source FAIL;
- no proxy/VPN/alternate undocumented endpoint;
- no interpolation or venue substitution under a Binance label;
- no alpha experiment permitted from that source.

Exact final head `57c613003347fc5f9785dbf7cf8c8eadb4e84e30`; artifact `9994770167`; Release Safety #812 green.

### PR #81 — OKX public data foundation V2

Branch `research/market-microstructure-okx-v2`.

Official unauthenticated OKX public REST audit passed across BTC/ETH/SOL/XRP/ADA/AVAX/LINK:

- Funding 90d coverage ~99.63%, 7/7 PASS.
- Open interest 30d/1h coverage 100%, 7/7 PASS.
- Taker flow 30d/1h coverage ~99.72%, 7/7 PASS.
- No duplicates, stale terminal rows or excessive gaps after bounded retry/backoff for 429.

This is **data foundation only**, not alpha evidence.

Exact head `73821d452848fe39586e7cb5c0b30c6254b68abb`; artifact `9994972803`; digest `sha256:bc52679ae9cc4c11272ada611d87a6a400bb75e0152d75632e3ffd42acca647c`; Release Safety #815 green.

### v7.98 — OKX funding crowding attenuation: REJECTED

Draft PR #82. One predeclared rule: direction-aligned extreme realized funding (30-observation z, |z|>=2) attenuates risk by 0.60.

Result versus frozen v7.97:

- 30d PF unchanged ~2.04 but EXP slightly worse `1.533 -> 1.522R`.
- 60d modestly better.
- 90d modestly better aggregate, but Fold 1/3 degradation and Fold 2 still negative.
- Only 16/421 trades affected, 15 SHORT / 1 LONG.

Decision: REJECT; no z/lookback/factor/side/regime search.

Exact head `166e6a389b656f921095df20761d4d67dbff91a0`; artifact `9995193416`; Release Safety #817 green.

### v7.99 — OKX relative OI expansion: REJECTED

Draft PR #83. Predeclared: leakage-safe 24h USD-OI expansion cross-sectional z >=1.50 attenuates risk by 0.60.

Result:

- PF/EXP degrade in every primary 30/60/90d window.
- 90d middle fold worsens to PF ~0.62, EXP ~-0.800R.
- OKX OI retention only covered about 2026-07-08 onward despite longer request; missing earlier evidence correctly leaves decisions unchanged.

Decision: REJECT; no threshold search.

Exact head `fff045674e9fcd26733c4e4b201857b10b1fb65c`; artifact `9995395859`; Release Safety #819 green.

### v7.100 — OKX taker-flow imbalance: REJECTED; microstructure threshold series stopped

Draft PR #84. Predeclared direction-opposed extreme 24h taker imbalance attenuation.

Result:

- only two trades affected;
- PF/EXP degrade on all primary windows;
- effect harmful and too small;
- public taker retention about 30 days.

Decision: REJECT. Funding/OI/taker isolated threshold hypotheses are all rejected. **No more microstructure threshold/factor/horizon tuning and no opaque composite.**

Exact head `b13ec77495ec0b97d14a5461c7dc7fa6be508eb3`; artifact `9995640417`; Release Safety #822 green.

## 7. v7.101 simultaneous portfolio risk budget — REJECTED

Draft PR #85; branch `research/hybrid-alpha-v7101-portfolio-budget`.

Structural, outcome-free allocator: simultaneous trade bundles are proportionally normalized to max 1.00 aggregate research-risk unit. Opportunity count and within-bundle relative risk are preserved.

Latest 24h result versus frozen v7.97 at cutoff `2026-09-07T09:00Z`:

- 30d: PF `2.29 -> 2.20`, EXP `+1.845R -> +0.587R`, DD `32.595R -> 14.650R`, n=131.
- 60d: PF `1.29 -> 1.22`, EXP `+0.513R -> +0.134R`, DD `85.043R -> 32.297R`, n=273.
- 90d: PF `1.44 -> 1.28`, EXP `+0.653R -> +0.154R`, DD `99.298R -> 38.892R`, n=419.

90d v7.101 folds: PF `1.50 / 0.58 / 2.07`; middle fold still negative.

Scaling diagnostics on 90d:

- 398/419 trades scaled;
- 77/88 timestamp bundles scaled;
- average scale ~0.407;
- max incoming bundle risk ~6.089;
- max outgoing risk exactly 1.000.

Conclusion: the cap works mechanically and cuts DD heavily, but is far too blunt and destroys too much expectancy/PF. Net-R/max-DD also degrades on all primary windows.

**Decision: REJECT v7.101. Do not tune the 1.00 cap or search alternate flat budgets.**

Useful architectural finding: simultaneous cross-asset exposure is materially concentrated. A future allocator, if researched, must be separately predeclared and model **correlated/cluster risk or marginal portfolio contribution**, rather than uniformly shrinking nearly every simultaneous bundle.

PR #85 current head at checkpoint: `f9ba678426a90ef03f196e59b2a3ec1fcaf7c7e8`. PR body records latest exact verified evidence head `740fa533a90f00aa8e894cfc2d116def86a82d01`, Evidence run #5 / run ID `34105646801`, artifact `10012272223`, digest `sha256:b357d9da6d21fc11f1bc813d992856ccea7f4d498b49604ccd42ec7da7db6cbc`, Release Safety #827 green. The research report also preserves an earlier successful reproducible run; before any future promotion/merge decision, always verify the exact current intended head again.

## 8. FIB Level Bot strand

Independent, research-only, no Paper/live/Pionex connection.

### V1 / PR #74

- Intratimeframe confirmed pivots, FIB-only entries/exits.
- Primary 1h fails; 15m rejected.
- 4h discovery was promising but not primary.
- NO PROMOTION.

### V2 / PR #75

- Unchanged 4h replication on unseen year fails: n=791, PF ~0.89, EXP ~-0.059R, DD ~77.372R.
- NO PROMOTION.

### V3 Daily anchors / 4h execution / PR #76

- Structural change: confirmed Daily swing anchors; unchanged FIB ladder executes on 4h.
- Primary historical year: n=190, PF ~1.34, EXP ~+0.150R, DD ~6.609R.
- Both sides and chronological folds positive; secondary yearly PF ~1.38 / 1.43.
- Gate fails because SOL contributes ~59.2% of positive primary net R vs locked max 40%.
- Do not remove/overweight SOL or tune pivots.
- NO PROMOTION.

### FIB V3 prospective holdout / PR #77

- Strategy head locked: `7b15a8b37431af317bc5d8b50ef960024b353982`.
- Holdout start: `2026-09-06T14:15:00Z`.
- Formal decision blocked until >=180 elapsed days and >=100 closed baskets.
- Earliest calendar eligibility: `2027-03-05T14:15:00Z`.
- Seven-asset universe fixed; no parameter/side/asset/regime tuning.
- Initial snapshot: 0 prospective setups/fills/closed/open; 6 pre-cutoff carry-over baskets excluded.
- Passing only permits human review, never automatic promotion.

## 9. Other research strands to preserve

- v7.79 prospective Challenger-context holdout remains locked/prospective; earliest useful maturity review is tied to its own >=30 matured rule, not to be confused with FIB V3.
- v7.86 Retest/Hold Breakout V2 remains separate/unmerged research.
- Meta Allocator v7.80 design remains design/research only.
- All rejected experiments are negative controls and must remain recorded rather than quietly discarded.

## 10. Open research PR map at 2026-09-07 checkpoint

- #67 — Hybrid Alpha v7.89–v7.93 — draft/no promotion.
- #68 — v7.94 7-asset robustness — draft/no promotion.
- #69 — v7.95 failure-state attribution — draft/no promotion.
- #71 — v7.96 weak-alpha attenuation — draft/no promotion.
- #73 — v7.97 low-liquidity attenuation — current frozen Hybrid comparator, draft/no promotion.
- #74 — FIB V1 — draft/rejected primary.
- #75 — FIB V2 4h replication — draft/rejected.
- #76 — FIB V3 Daily-anchor — draft/historical near-pass but concentration fail.
- #77 — FIB V3 prospective holdout — locked.
- #80 — Binance microstructure source audit — transport fail.
- #81 — OKX public microstructure data audit — data foundation pass, not alpha.
- #82 — v7.98 funding crowding — rejected.
- #83 — v7.99 OI expansion — rejected.
- #84 — v7.100 taker flow — rejected, threshold series stopped.
- #85 — v7.101 flat simultaneous portfolio budget — rejected.

Research PRs stay open/draft as evidence branches; do not merge them into `main` merely to tidy history.

## 11. Immediate next actions for the new chat

1. Read this file and `MERIDIAN_HANDOFF.md` fully from GitHub before changing anything.
2. Treat R18 near-live portfolio valuation as validated unless the user provides new contradictory evidence. Do not call total fully exchange-live because Pionex/trading is snapshot/manual.
3. Pionex stays untouched.
4. Hybrid Alpha returns to **frozen v7.97** as comparator. v7.98–v7.101 are rejected; do not tune their thresholds/factors/caps after the fact.
5. If continuing Hybrid research, use a structurally new predeclared question. Best current architectural candidate: correlation/cluster-aware or marginal-contribution portfolio allocator. It must not be a flat cap and must be tested without looking at outcomes to define clusters/weights.
6. Alternatively pause new Hybrid experiments and let prospective holdouts accumulate; do not manufacture more hypotheses simply to get PF >1 in Fold 2.
7. Keep FIB V3 prospective holdout locked; do not consume it for tuning.
8. Save any new design, run, result and decision to GitHub immediately. Research branch first, exact-head Release Safety, no automatic promotion.

## 12. Resume-command convention

When starting the next chat, the user should paste the companion prompt in `MERIDIAN_RESUME_PROMPT_2026-09-07.txt`. The new assistant must treat this file as current SSOT over older dated resume sections where they conflict.
