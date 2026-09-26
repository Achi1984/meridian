# MERIDIAN — Decisions & Principles

This file records durable project decisions and the reasoning behind them. Read together with `MERIDIAN_CONTEXT.md` and `MERIDIAN_HANDOFF.md` before changing MERIDIAN.

## D-001 — Baseline 6.2 stays frozen

**Decision:** `6.2.0 / 6.2-SIGNAL-V1` remains the production-paper reference.

**Why:** Research only has value if the benchmark is stable. Quietly modifying the Baseline destroys comparability and makes historical conclusions unreliable.

**Rule:** Any change to Baseline entry, sizing, risk, exit or ledger behavior requires explicit approval and a clearly named migration.

## D-002 — Research must never auto-promote

**Decision:** Shadow, Challenger, Regime, Exit Lab and future variants remain research-only until explicit promotion.

**Why:** A short winning sample is insufficient evidence. Promotion requires common-window evaluation, adequate trade count, PF/expectancy, drawdown, frequency/opportunity cost and stability.

## D-003 — Avoid over-filtering

**Decision:** More observed/evidence data does not automatically become more hard entry gates.

**Why:** Hard filters can improve headline metrics simply by removing most trades and can hide opportunity cost. Prefer a few true safety gates plus soft scoring/confidence.

**Measure:** Every variant must track both avoided losers and missed winners, plus trade frequency/coverage versus Baseline.

## D-004 — LONG vs SHORT must be judged in regime context

**Decision:** Never conclude that one direction is inherently weaker from aggregate results alone.

**Why:** Directional performance can change dramatically between bull, bear, range, transition, expansion and chop environments.

## D-005 — Challenger architecture should become independent

**Current finding:** Challenger V2 uses soft confidence but its executable opportunity universe is still restricted by Baseline `READY`.

**Decision:** Challenger V3 should evaluate the broader valid scanner universe independently. Baseline status may remain evidence/feature, but not a hidden hard dependency.

**Why:** Otherwise Challenger can only reject Baseline opportunities; it cannot discover opportunities the Baseline would not trade.

## D-006 — Regime side changes require side-specific rescoring

**Current finding:** Regime V1 can change trade direction, while substantial score components may still reflect the original Baseline direction.

**Decision:** Regime V2 must recompute technical/candidate evidence for the final selected side before calculating final confidence.

**Why:** A SHORT trade must not be justified primarily by LONG-direction scores, and vice versa.

## D-007 — TP1 should transition into a protected runner in research

**Decision:** Test partial TP1 realization followed by protection of the remaining position rather than assuming full TP1 exit is optimal.

**Core candidate:** 50% at TP1; remaining position protected at break-even plus estimated fees/slippage; runner targets TP2.

**Why:** This locks part of the profit while retaining upside from strong trends.

## D-008 — Break-even protection itself must be tested, not assumed

**Decision:** Compare immediate TP1-touch BE against confirmed-close BE and positive-R protection levels.

**Current probes:** immediate BE+cost, confirmed 15m close through TP1, BE+0.10R, BE+0.25R.

**Why:** Immediate BE may protect capital but may also remove runners during normal volatility.

## D-009 — Exit research uses fixed entry cohorts

**Decision:** Exit models are compared using the same historical entry timestamps and subsequent 15m candles.

**Why:** If entry selection changes between models, we cannot attribute performance differences to exit logic.

**Guard:** Never use the entry candle after the entry timestamp as future information; replay only candles closing after `openedAt`.

## D-010 — Exit evaluation is multidimensional

**Decision:** Do not choose an exit model by P&L alone.

**Required evidence:** total R, average/median R, R win rate, giveback, TP1→BE stop rate, TP2 continuation, side/symbol/regime/exit splits and robustness across time windows.

## D-011 — Regime is primarily a soft allocator/risk layer candidate

**Decision:** Treat regime information as a strong candidate for strategy selection and risk sizing rather than a proliferation of hard blocks.

**Potential role:** Full risk / caution / skip, choice of pullback vs mean reversion vs momentum behavior, and adaptive exit policy.

## D-012 — Hybrid/Allocator is a future integration target, not an assumption

**Decision:** Challenger and Regime concepts may be combined only after each is corrected and independently measured.

**Why:** Combining two unverified models can hide which component creates or destroys edge.

## D-013 — Research telemetry is mandatory before rule changes

**Decision:** New rules should be justified by measurable behavior in telemetry/backtests, not visual intuition alone.

**Key metrics:** expectancy, payoff, historical max DD, trade frequency, holding time, opportunity cost, side/asset/regime/exit splits.

## D-014 — Paper-only safety remains non-negotiable

**Decision:** Live trading stays disabled. Research work must not bypass the paper-only invariant.

**Why:** MERIDIAN is currently a research and paper-trading environment.

## D-015 — Security/privacy must not regress during research work

**Decision:** New research endpoints remain read-only/protected as appropriate; private financial state stays in PostgreSQL; secrets never enter public assets or source files.

## D-016 — UI and research are separated concerns

**Decision:** UI improvements may improve visibility and workflow, but must not silently alter model behavior. Research releases should avoid unrelated UI work when possible.

## D-017 — Continuity documentation is part of the release process

**Decision:** `MERIDIAN_CONTEXT.md`, `MERIDIAN_DECISIONS.md`, and `MERIDIAN_HANDOFF.md` are canonical project memory.

**Rule:** When a release changes architecture, a durable principle, a known limitation, a major finding or the next planned step, update the applicable continuity files in the same branch/PR.

**Reason:** Chat history and model memory are helpful but are not a reliable single source of truth for a long-running software/research project.

## D-018 — Exit Lab v7.51 does not justify promotion yet

**Evidence:** A 12-asset fixed-entry replay over 30/60/90-day windows showed that runner exits can materially outperform full TP1 in some windows, especially the 90-day window, but can underperform sharply in the 60-day window. The adaptive runner was strongest for Challenger in 30d and 90d, while the current full-TP1 exit was stronger in 60d. Protected BE variants also showed meaningful TP1→BE stop rates and were not uniformly superior.

**Decision:** Do not promote any runner/BE model into existing Paper execution yet. Challenger V3 must initially keep the current full-TP1 exit so its independent entry/scoring architecture can be evaluated without exit-policy contamination.

**Why:** Changing entry universe and exit logic simultaneously would make attribution impossible. Exit Lab remains a separate research axis and can be layered onto Challenger V3 after V3 entry behavior is measured.

## D-019 — Challenger V3 independence was valid architecturally but failed empirically

**Evidence:** Challenger V3 removed the Baseline `READY` hard dependency and found mostly new opportunities, but its 30d/60d evidence was materially worse than V2/Baseline. Roughly 78–89% of its trades in the tested windows were outside `READY`, with very poor PF/expectancy in 30d and 60d.

**Decision:** Do not merge or promote Challenger V3 as implemented. Preserve it only as a research checkpoint proving that simply widening the opportunity universe does not create edge.

## D-020 — Challenger V3.1 improved risk/selection but still did not justify promotion

**Evidence:** V3.1 strengthened soft penalties for entry distance/status and reduced risk outside READY. It improved materially over V3 and reduced 90d drawdown, but remained weaker than Challenger V2/Baseline on the main comparison and was still unstable across windows.

**Decision:** Do not promote V3.1. Do not continue threshold tuning blindly.

## D-021 — Confidence must be calibrated at signal level before Challenger V3.2

**Evidence:** Signal Calibration Lab sampled one candidate per symbol per 4h across the same 12 assets and evaluated normalized A_CURRENT R without portfolio gates. Every tested confidence bucket was negative over 30d, 60d and 90d; higher confidence was not monotonic with better outcomes.

**Decision:** Challenger V3.2 must not be another threshold-only or weight-only revision of the same compressed feature stack. First build a raw-feature edge map / attribution layer to identify which observations actually predict outcomes.

**Method rule:** Separate signal-quality calibration from portfolio-path effects such as max-open-position, daily-loss and max-drawdown gates. A profitable portfolio window is not proof that the confidence score itself is calibrated.

**Architecture rule:** Preserve the soft-scoring philosophy. Evidence that a bucket is weak does not automatically become another hard gate.

## D-022 — Portfolio current valuation has one source of truth

**Decision:** The current Depot portfolio value is defined once as `spotUsd + Pionex equity` and must be reused by the headline and final chart point. Individual UI components must not independently reconstruct current totals.

**Why:** Repeated Depot fixes showed that independent display paths can produce contradictory values even when each local calculation appears plausible.

**Rules:** Pionex must not be double-counted as spot; current endpoint drift must be surfaced explicitly; `server.js` and trading execution remain outside this display/data-consistency change.

## D-023 — Historical portfolio metrics must come from persisted canonical snapshots

**Decision:** Portfolio history is persisted at capture time in PostgreSQL with Spot, Pionex/trading, total and cashflow metadata. Chart, High/Low and 1D Performance should consume the same stored series rather than reconstructing history from today's component values.

**Why:** A current-value SSOT alone cannot make old chart points trustworthy when Pionex equity changes over time.

**Warm-up rule:** A newly deployed canonical history must not immediately replace a longer legacy chart with a tiny sample. v7.64 only switches a time range after minimum point count and coverage are met; otherwise v7.63 current-value alignment remains the fallback.

**Privacy/safety:** The history endpoint remains bearer-protected and PostgreSQL-backed. This change does not alter Baseline 6.2, `server.js`, Paper execution or research logic.


## D-024 — Mandatory Main-Agent / Specialist / Review workflow

**Decision:** All tasks use the workflow defined in `MERIDIAN_AGENT_WORKFLOW.md`. The Main Agent is the only user-facing orchestrator and owns decomposition, integration, quality gates, PR/merge, and final delivery.

**Review rule:** Every specialist deliverable receives an independent review where the runtime supports true separate agents. A reviewer returns GREEN LIGHT or REVISION REQUIRED. Revision loops are capped at three. Work without GREEN LIGHT after three cycles is not silently approved or merged.

**Quality rule:** Quality is priority 1. Even small code/UI changes are reviewed. Code changes use syntax, existing tests, targeted tests, release-check/release-sync, runtime smoke, diff review, and relevant UI/data/security review when those checks are available.

**UI rule:** User-facing UI changes require dedicated iPhone/mobile review.

**Trading rule:** Signals, risk, Profit Lock, hedge, FIB, liquidation, leverage, re-entry, regime and backtest changes require both technical and methodology review.

**Data rule:** Material live/time-sensitive financial data requires a second source when technically possible. User screenshots can serve as an authoritative cross-check for current account/bot state.

**Merge rule:** The Main Agent may continue to create PRs and merge autonomously after all required gates are green.

**Runtime honesty:** Requested GPT-6 role assignments are target policy only when those models/agents are actually available. The system must never claim a model or independent agent performed work when it did not.


## D-025 — v9 Data Truth gates actions by source freshness

**Decision:** MERIDIAN v9 may display reference/snapshot bot metadata for context, but reference rows must not drive Profit Lock, hedge, liquidation-priority or NEXT ACTION decisions as though they were live.

**Rules:**
- Profit Lock requires a confidently matched live bot and live PnL.
- Live-matched bots without live PnL render SYNC and no Profit-Lock action.
- Unmatched reference rows render REFERENCE / VERIFY and are non-actionable.
- Risk Priority and signal summaries use live-matched bots only.
- Aggregate exposure is calculated only from live-confirmed capital/notional inputs; unknown exposure remains explicitly incomplete.
- Current market price is cross-checked between OKX and Binance when both are available; spread above the credibility threshold is not treated as two-source verified.
- Missing numeric values must remain missing; null/blank values must never coerce to zero.
- Small-value formatting must use absolute magnitude so negative USD values are not accidentally rendered as thousands-scale numbers.
- A mixed page must say MIXED rather than implying the whole dashboard is live.

**Reason:** r16 iPhone validation exposed that stale reference PnL could still produce apparently actionable Profit Lock outputs and that the generic money formatter treated all negative numbers as tiny values. Source provenance is therefore part of decision correctness, not merely presentation.


## D-026 — Private snapshot freshness is mandatory for trading actions

**Decision:** Data returned by `/api/private/dashboard` is a private persisted snapshot unless an explicit Pionex section timestamp proves freshness. It must not be described as a live Pionex API feed.

**Rules:**
- A Pionex bot row may be matched to a tracked bot for context, but it is actionable only when the `pionexRisk` section carries a trusted `updatedAt` or `snapshotAt` no older than 15 minutes and the row contains PnL.
- Generic `privateUpdatedAt` is display-only legacy provenance because other private sections can refresh it without refreshing bot state.
- Stale or untimestamped bot snapshots cannot drive Profit Lock, NEXT ACTION, Risk Priority, aggregate bot exposure, or asset-pair Risk Cockpit recommendations.
- Public market prices may remain fresh independently and are still cross-checked between OKX and Binance.
- The dashboard must show raw private API bot-row count, matched count, unmatched count and snapshot age so a backend coverage problem is distinguishable from a matcher problem.
- Bot top-right status labels are explicitly scoped to liquidation risk (LIQ SAFE/WATCH/MARGIN) rather than implying overall safety.
- Any authenticated `pionexRisk` update without its own timestamp is stamped server-side with the update time.

**Reason:** r17 iPhone validation showed only 2/25 tracked bots matched while 14 assets had two-source market prices. The private dashboard backend is a persisted snapshot store, not proof of a live Pionex bot feed. Correctness therefore requires freshness to be part of the action contract.


## D-027 — OKX manual positions closed; Futures DCA bots become authoritative snapshot

**Decision:** The previous OKX INJ/XRP manual futures-position snapshot is retired. User screenshots from 25.09.2026 06:22 are the new authoritative OKX state.

**Current OKX bots:**
- INJUSD UM X-Perp Futures DCA — LONG 3x — investment 65.32 USDC — total PnL +0.1729 USDC (+0.26%) — variable PnL +0.1824 (+0.27%) — last price 7.977 — TP 8.28 — average cost 7.908 — safety orders 0/7 — estimated liquidation unavailable in OKX UI.
- XRPUSD UM X-Perp Futures DCA — LONG 3x — investment 65.32 USDC — total PnL -0.014 USDC (-0.03%) — variable PnL -0.0048 (-0.01%) — last price 1.5291 — TP 1.5924 — average cost 1.5296 — safety orders 0/9 — estimated liquidation unavailable in OKX UI.

**Rules:**
- Old OKX manual position records are removed from the active dashboard snapshot.
- No liquidation price is inferred where OKX displays none.
- OKX DCA rows are screenshot snapshots, not a live account feed; they do not drive Pionex Profit Lock / Risk Priority action logic.
- Public price can be refreshed/cross-checked with OKX + Binance, while investment, PnL, TP, average cost and safety-order state remain screenshot provenance.
- Known OKX bot equity is derived as investment plus total PnL for the screenshot-confirmed bots. This is a known-bot subtotal, not proof of total OKX account equity.


## D-028 — Pionex bot state must come from read-only Bot API or remain non-actionable

**Decision:** MERIDIAN no longer treats the persisted `pionexRisk` snapshot as self-refreshing. A dedicated read-only Pionex Bot API synchronizer is the authoritative path for live bot-structure refreshes.

**Runtime contract:**
- Read endpoint only: `GET /api/v1/bot/orders`.
- Credentials: `PIONEX_BOT_READ_API_KEY` + `PIONEX_BOT_READ_API_SECRET`; generic `PIONEX_API_KEY/SECRET` are accepted only as read-call fallback.
- Recommended API-key permission: Pionex **Bot reading** only.
- Successful reads update `pionexRisk.source=PIONEX_BOT_API`, `snapshotAt`, `updatedAt`, raw API-row count and normalized running futures bot rows.
- Failed reads update only `pionexBotSync` diagnostics; they do **not** refresh the old `pionexRisk.updatedAt` timestamp or make stale rows actionable.
- Missing credentials publish one disabled diagnostic on startup and do not create a repeated write loop.
- Refresh cadence defaults to 5 minutes and remains read-only.
- Public market prices stay independently cross-checked through OKX/Binance.
- Account-specific PnL is used only when Pionex actually returns a recognized PnL field; it is never inferred from margin or withdrawn-profit fields.
- Coin-margined investment is not labeled USD unless Pionex exposes `usdtInvestment` or explicitly declares the investment coin as USDT.

**UI contract:**
- Data Truth r20 exposes Pionex raw API rows, normalized bot rows, match coverage, Bot API state, bot source, snapshot age, PnL coverage and actionable count.
- Existing 15-minute freshness gate remains mandatory for Risk Priority / Profit Lock / NEXT ACTION.
- A fresh structural bot row may restore liquidation-risk monitoring even when PnL is absent; Profit Lock still requires fresh PnL.

**Reason:** r19 physical iPhone validation showed 3 private rows, only 2/25 matched, and a 23-day-old bot snapshot. The root cause was absence of a Pionex bot-data producer, not the frontend matcher.
