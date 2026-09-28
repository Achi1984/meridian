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


## D-029 — Portfolio account totals require explicit canonical provenance

**Decision:** Pionex account equity in COMMAND/portfolio valuation must come from the canonical private portfolio fields (`portfolio.pionexEquityUsd` or its Pionex manual-venue balance fallback). Bot-risk or generic Pionex fields are not promoted to account-total authority by numerical similarity.

**Rule:** Magnitude heuristics such as “within 80% of the previous snapshot” are forbidden for source classification. A partial bot/COIN-M subtotal can be close to the account total by coincidence and must remain a partial diagnostic, not an account valuation.

**Fallback:** When canonical private Pionex equity is unavailable, retain the explicit screenshot/manual fallback and label it as a snapshot. Never infer a live account total from bot rows.

**Reason:** The canonical portfolio/history contract already defines Pionex equity through the private portfolio section; using a separate heuristic path made COMMAND capable of disagreeing with persisted portfolio history and overstating source freshness.


## D-030 — COMMAND portfolio current value reuses the canonical Spot + Pionex basis

**Decision:** MERIDIAN v10 COMMAND must use the same current valuation basis as DEPOT: non-Pionex holdings valued through the canonical portfolio contract plus canonical Pionex equity. COMMAND must not independently reconstruct the headline total from static Ledger values, screenshot-only OKX DCA bot equity, or other venue subtotals.

**Current-price rule:** Public spot prices are overlaid by downloading the full Binance spot ticker table, preserving the existing privacy rule that holding symbols, quantities and venues are never sent as holding-specific market queries. If that market overlay fails, stale persisted live prices are cleared and the canonical private snapshot fallback is labelled as such.

**History rule:** PostgreSQL canonical history remains the source for historical performance. Its latest point may be compared against current valuation and shown as drift diagnostics, but it does not replace the current canonical total.

**OKX DCA rule:** Screenshot-confirmed OKX Futures DCA equity remains a separate reference subtotal. It is not silently added to the canonical Spot + Pionex total unless the canonical portfolio contract is explicitly extended in a future decision.

**Safety:** This is display/data consistency only. Trading signals, Paper-bot parameters, bot matching, leverage, risk logic and execution paths are unchanged.


## D-031 — Portfolio freshness must describe component coverage, not just successful transport

**Decision:** A successful public Spot ticker fetch does not make the full portfolio “live/current”. Portfolio provenance must account for both Spot price coverage and the independent Pionex equity source.

**Classification:**
- **CANONICAL MIXED** — all non-Pionex holdings are resolved by the fresh public Spot overlay, while Pionex remains canonical private snapshot provenance.
- **CANONICAL PARTIAL** — the public Spot feed is available but one or more holdings require fallback valuation, or Pionex is using the explicit screenshot fallback.
- **PRIVATE SNAPSHOT** — no fresh public Spot overlay is available and the canonical valuation relies on private/stored fallback values.
- **INCOMPLETE** — the holdings basis required for the canonical total is unavailable.

**Rule:** Neither CANONICAL MIXED nor CANONICAL PARTIAL may be described as a fully live/exchange-live portfolio. Spot coverage is surfaced as resolved/requested counts. Pionex snapshot provenance remains explicit.

**Reason:** The privacy-safe all-ticker overlay can succeed while some held assets remain unsupported; separately, Pionex equity is intentionally a private/screenshot snapshot rather than a live account feed. A single transport-level `fresh=true` flag therefore cannot represent whole-portfolio freshness.

**Safety:** Valuation math stays Spot + Pionex. This decision changes provenance and UI semantics only; trading, Paper, risk and execution logic are unchanged.


## D-032 — Pionex portfolio equity age requires its own explicit timestamp

**Decision:** The age of Pionex portfolio equity must be derived only from the timestamp attached to that equity source (portfolio.pionexEquityUpdatedAt or the selected Pionex venue-row timestamp). Generic dashboard timestamps such as privateUpdatedAt must not be borrowed to make an older equity snapshot appear newer.

**Display rule:** MERIDIAN shows the Pionex equity source together with one of:
- a relative age when the explicit source timestamp is known,
- **NO TIMESTAMP** when the selected equity source has no explicit timestamp,
- **FUTURE TIMESTAMP** when the explicit source timestamp is more than 30 seconds ahead of the local evaluation time.

**No invented stale threshold:** r27 does not introduce a new age cutoff that invalidates the portfolio value. Age is disclosed as provenance only. Any future rule that blocks valuation because an equity snapshot is too old requires a separate documented decision and evidence.

**Seed rule:** A selected KNOWN_SEED source is shown as **STATIC SEED** rather than being implied to be live.

**Isolation:** Portfolio-equity age does not affect Bot API freshness, Risk Priority, NEXT ACTION, Paper-bot logic, leverage, signals or execution.


## D-033 — Bot coverage is measured against supported live rows, not the reference catalog

**Decision:** Bot-feed coverage is complete only when the current private bot snapshot is fresh, contains at least one supported live row, every supported live row is safely matched, and no ambiguous match remains. The historical reference catalog size is not a coverage denominator.

**Reason:** The reference catalog intentionally retains older/screenshot-known bots for reconciliation. A current API snapshot may legitimately expose fewer supported running bots. Comparing live matches against the full reference catalog can incorrectly label a fully reconciled live snapshot MIXED; conversely, comparing only reference matches can miss extra unmatched API rows.

**SSOT rule:** v9 DATA TRUTH, the legacy header source state, and v10 DATA GUARD must consume the same botFeedCoverage helper. BOT MATCH is displayed as matched / supported-live-rows. Extra or ambiguous API rows fail coverage closed.

**Isolation:** This changes bot data-status semantics only. Matching thresholds, PnL handling, liquidation calculations, Profit Lock, NEXT ACTION, Paper bots, leverage and execution are unchanged.


## D-034 — ACTIONABLE and DECISION READY share one readiness contract

**Decision:** A bot is decision-ready only when the private bot snapshot is fresh, the bot is safely matched, liquidation/safety data is usable, snapshot PnL is available, and the asset market-intel used for the decision is fresh.

**SSOT rule:** v9 ACTIONABLE and v10 DECISION READY must consume the same shared helpers. ACTIONABLE must not count rows that are missing liquidation data or whose market-intel is stale.

**Safety-ready distinction:** Safety-ready remains a weaker state: fresh matched bot data plus usable liquidation/safety information. It is intentionally allowed without fresh PnL or market-intel so liquidation protection can remain visible even when decision support is blocked.

**Isolation:** This aligns status/count semantics only. It does not change market indicators, risk thresholds, Profit Lock rules, NEXT ACTION ordering, Paper-bot parameters, leverage or execution.


## D-035 — Bot snapshot age must respect timestamp trust and the existing future-tolerance rule

**Decision:** Bot snapshot age displayed to the user must be derived from the same timestamp state used by bot-feed freshness. A generic private-state timestamp that is explicitly marked untrusted must never be shown as if it were the age of the Pionex bot snapshot.

**Display rule:** NO TRUSTED TIMESTAMP is shown when the bot feed has no trusted Pionex-specific timestamp. FUTURE TIMESTAMP is shown when the trusted timestamp exceeds the existing +5 minute future tolerance. Otherwise the normal relative age is shown.

**No threshold change:** r30 preserves the existing freshness behavior exactly: a trusted timestamp may be at most 15 minutes old, and timestamps up to 5 minutes in the future remain tolerated. The change only makes the displayed provenance match that behavior.

**SSOT rule:** v9 DATA TRUTH, stale-action explanations and v10 DATA GUARD consume the same botFeedAgeLabel/time-state helpers.

**Isolation:** No matching, PnL, signal, risk, Profit Lock, NEXT ACTION, Paper-bot, leverage or execution logic changes.


## D-036 — Full DECISION READY requires every matched live row to be decision-ready

**Decision:** A bot layer may be labelled DECISION READY / READY only when match coverage is complete and every currently matched supported live row satisfies the shared decisionReadyBot contract. Any nonzero but incomplete decision-ready subset is PARTIAL READY.

**Reason:** Match coverage and decision readiness are different dimensions. Complete matching alone must not promote 2/3 decision-ready rows to a fully ready state.

**Action-count rule:** PROFIT WATCH / LOCK summaries must be calculated only from rows that satisfy the same shared decisionReadyBot contract. A matched row missing usable liquidation/safety data must not contribute to action counts even if PnL and market intel are present.

**SSOT rule:** syncHealth exposes decisionComplete; both the header readiness and DATA GUARD use that field.

**Isolation:** No Profit Lock formula, signal threshold, liquidation threshold, NEXT ACTION priority, Paper-bot parameter, leverage or execution behavior changes.


## D-037 — v10 header status uses one semantic tone vocabulary

**Decision:** The active v10 system header uses only the semantic status tones safe, watch, danger and muted. Legacy presentation labels mixed and reference are not runtime CSS-state values in v10.

**Mapping:** MARKET READY = safe; MARKET PARTIAL/STALE = watch. BOT READY = safe; BOT PARTIAL/SAFETY = watch; BOT ERROR = danger; BOT REF/BLOCKED = muted.

**SSOT rule:** marketReadiness and botReadiness emit the final semantic tone. The COMMAND source strip and sticky system header consume that tone directly instead of translating legacy class names locally.

**Reason:** r22 added explicit semantic header colors, but the runtime still emitted legacy mixed/reference class names and depended on inherited v9 CSS. The visible state therefore had two vocabularies for the same readiness result.

**Isolation:** Readiness conditions and labels are unchanged. This is presentation/status semantics only; no market signal, bot matching, risk, Profit Lock, Paper-bot, leverage or execution logic changes.


## D-038 — Exposure completeness includes unmatched current live rows

**Decision:** A bot exposure or hedge percentage is complete only when the current bot snapshot is fresh, at least one bot is safely matched in the requested scope, every matched bot in that scope has a usable USD investment, and no current supported live row in that scope remains unmatched.

**Scope rule:** Asset-level exposure checks only unmatched rows for the same asset. Portfolio-level exposure checks all current unmatched live rows. Known matched notional may still be shown as known exposure, but an exact hedge ratio is withheld while exposure is incomplete.

**Hedge safety:** assetPairRisk may calculate hedgePct only when same-asset exposureIntegrity is complete. An unmatched same-asset live row therefore makes hedgePct unavailable and prevents the existing hedgeLow branch from treating an incomplete ratio as below 15%. The 15% threshold itself is unchanged.

**UI rule:** Active v10 pair cards and the COMMAND live overview consume the same exposureIntegrity helper. They show PARTIAL/unknown values instead of COMPLETE when supported live exposure is not fully reconciled.

**Isolation:** No PnL formula, market signal, liquidation threshold, Profit Lock percentage, hedge threshold, Paper-bot parameter, leverage or execution logic is changed. r33 only changes whether incomplete exposure data is eligible to produce an exact exposure/hedge statement.


## D-039 — Portfolio regime must disclose partial exposure basis

**Decision:** The legacy portfolioRegime score may remain mathematically unchanged, but the UI must disclose when its bot-risk concentration input is based on incomplete live exposure.

**Rule:** portfolioRegime carries exposureComplete and a COMPLETE/PARTIAL_EXPOSURE basis flag from the canonical exposureModel. When exposure is incomplete, every visible portfolio-regime label retained by the active v10 shell is marked **PARTIAL BASIS**.

**Reason:** assetExposureShare/riskV2 are older scoring components. Changing their concentration thresholds or penalty weights would be a trading-methodology change. r34 instead exposes the provenance limitation so a partial denominator is not presented as fully authoritative.

**Preserved scoring:** concentration thresholds remain 10% / 15% / 25%; average-risk penalties remain at 4 and 6; portfolio regime cutoffs remain +/-2. No score, threshold or signal is changed.

**Isolation:** Active v10 NEXT ACTION does not consume portfolioRegime. r34 is provenance/presentation only and changes no Profit Lock, hedge threshold, Paper-bot, leverage or execution behavior.


## D-040 — Pair PnL aggregate requires complete current asset rows

**Decision:** An aggregate PAIR PNL USD is authoritative only when the current bot snapshot is fresh, at least one bot for the asset is safely matched, no current supported live row for that asset is unmatched, and every matched row in that asset has live PnL.

**Scope rule:** An unmatched row for another asset does not invalidate the current asset's pair PnL. An unmatched row for the same asset does. Missing PnL on any matched row also makes the aggregate incomplete.

**UI rule:** The active v10 pair card consumes shared pnlIntegrity(symbol). If incomplete, the aggregate value is withheld and the card states PnL-Summe unvollständig. Individual verified bot-leg PnL remains unchanged and visible where already allowed.

**Isolation:** r35 changes aggregation provenance only. PnL formulas, Decision Ready, Profit Lock thresholds, hedge logic, market signals, Paper-bot parameters, leverage and execution are unchanged.


## D-041 — Pair PnL completeness requires a computable USD value

**Decision:** PAIR PNL USD may be aggregated only when every matched row in the asset scope produces a non-null USD PnL through the existing botPnlUsd contract. Generic live PnL presence is insufficient because a row can expose only profitPct without enough USD capital information to convert it.

**Null-integrity rule:** A percent-only row without raw USD PnL and without usable USD investment makes the Pair PnL aggregate incomplete. Null must never enter numeric reduction as implicit zero.

**Derived-value rule:** Existing validated USD derivation remains allowed: profitPct plus usable investUsd may produce PCT_X_USD_INVEST, and a raw valid USD PnL remains valid. The existing discrepancy/correction logic in botPnlUsd is unchanged.

**Scope rule:** Same-asset unmatched rows still invalidate the pair aggregate; unmatched rows for other assets remain out of scope.

**Isolation:** Decision Ready continues to use generic live PnL availability because percentage PnL is sufficient for its existing Profit Lock percentage logic. No Profit Lock threshold, hedge threshold, market signal, Paper-bot parameter, leverage or execution behavior changes.


## D-042 — Global NEXT ACTION fails closed on incomplete bot coverage, except safety

**Decision:** The global COMMAND NEXT ACTION may emit a momentum/profit/HOLD decision only when the current supported bot coverage is complete. If any supported live bot row is unmatched or ambiguous, the global recommendation becomes **KEINE AKTION · DATEN PRÜFEN** with matched/supported coverage details.

**Safety exception:** Liquidation-risk and explicit stop/protection-risk states remain visible even when global coverage is incomplete. A known urgent safety condition must not be hidden merely because another current row is unverified.

**Reason:** NEXT ACTION is a portfolio-wide priority selector. Selecting a non-safety action from the known subset while another supported current row cannot be evaluated can overstate certainty. Per-asset data may remain visible, but the global decision must disclose that the ranking universe is incomplete.

**Ordering rule:** DATA_STALE / MARKET_STALE / UNVERIFIED still fail closed first; LIQ_RISK and PROTECTION_RISK preserve safety priority; the coverage guard then blocks RISK_REVIEW, PROFIT_LOCK, WATCH_PROFIT and HOLD when coverage is incomplete.

**Isolation:** Pair-status formulas, signal ranks, liquidation thresholds, stop-loss checks, Profit Lock thresholds/percentages, hedge threshold, Paper-bot parameters, leverage and execution are unchanged. r37 changes only eligibility/precedence of the global displayed recommendation.


## D-043 — Per-asset pair status fails closed on same-asset unmatched rows, except safety

**Decision:** An asset pair may emit PROFIT LOCK, RISK REVIEW, WATCH PROFIT or HOLD only when every current supported live row for that same asset is safely matched. If an additional same-asset row remains unmatched or ambiguous, the pair status is UNVERIFIED.

**Asset scope:** An unmatched ETH row does not invalidate an otherwise complete BTC pair. The guard is scoped to the asset shown on the card, matching the exposure and Pair-PnL scoping established in r33–r36.

**Safety exception:** Known LIQ_RISK and explicit stop/protection risks from safely matched rows remain ahead of the match-completeness guard. A known urgent safety condition must remain visible even when another row for the same asset is unresolved.

**Reason:** r33–r36 already withhold incomplete asset aggregates, and r37 blocks global non-safety NEXT ACTION on incomplete coverage. The individual pair status must not still present a trading decision from a partial same-asset leg set.

**Isolation:** Matching thresholds themselves, pair-status ranks, signal formulas, liquidation thresholds, stop-loss checks, Profit Lock thresholds/percentages, hedge threshold, Paper-bot parameters, leverage and execution are unchanged.


## D-044 — Terminal releases are single-writer and lease-based

**Decision:** Only the Main Agent may allocate terminalBuild, own a terminal release branch, open the release PR, or merge it. Parallel specialists/subagents may analyze, test, review, or prepare isolated patch proposals, but they may not independently allocate release numbers or merge competing terminal releases.

**Lease rule:** A terminal release must be exactly one revision ahead of current main. The v10-rNN branch suffix and version.json terminalBuild must agree. If multiple open PRs target the same revision, the oldest open PR owns that revision; later contenders are invalid.

**Freshness rule:** Release Safety results are bound to one exact PR head SHA. Immediately before merge, the Main Agent must re-read current main, PR head/base, branch compare, competing release PRs, and gate results. If main advanced or the branch is behind, the release plan is invalidated and the scoped work is ported to the next free revision with fresh gates.

**Interruption rule:** After any streaming/tool interruption or resumed conversation, repo state is re-read before the next write. Already-landed changes are never replayed from chat state alone.

**Automation:** scripts/release-coordinator.mjs enforces release-number/branch consistency and same-revision lease ownership inside Release Safety. A main-push sweep automatically closes stale open v10-rNN PRs whose revision is now current or older.

**Isolation:** This is release orchestration only. It changes no trading rules, Paper-bot parameters, signals, risk thresholds, leverage, portfolio math or execution behavior.


## D-045 — OKX DCA reference equity requires a complete snapshot

**Decision:** OKX Futures DCA remains a reference-only snapshot outside the canonical portfolio total. Its displayed equity may be shown as an exact value only when every snapshot row has both an explicit USD investment and an explicit USD total PnL.

**Null-integrity rule:** Missing investment or missing totalPnlUsd makes the OKX DCA reference equity incomplete. Missing values must not be coerced to zero. Explicit zero PnL remains valid data.

**Fallback rule:** The stale manual OKX fallback must not replace an incomplete DCA snapshot with a numeric zero or another unrelated value. Incomplete reference equity is shown as unavailable and labelled REFERENCE PARTIAL.

**Canonical isolation:** OKX DCA remains outside CANONICAL TOTAL, which stays Spot + Pionex.

**Continuity:** r37 global NEXT ACTION coverage guard and r38 per-asset match-completeness guard remain unchanged.

**Trading isolation:** No bot matching, Decision Ready, Profit Lock, hedge threshold, market signal, Paper-bot parameter, leverage, execution or Pionex mutation behavior changes.


## D-046 — Unmatched live-row blocks must expose privacy-safe diagnostics

**Decision:** When current supported Pionex bot rows are unmatched or ambiguous, the active v10 UI must expose enough row-level metadata to explain the block: asset, side, leverage, match reason, and whether PnL / USD capital fields are present.

**Privacy rule:** Diagnostics do not render bot IDs or private numeric amounts. They expose only resolution metadata already required to understand why matching/coverage failed.

**SSOT rule:** COMMAND Data Guard and the BOTS view reuse the same unmatchedDiagnostics renderer over state.unmatchedLive. The BOTS details disclosure preserves its open/closed state across forced refreshes.

**Decision isolation:** Diagnostics do not change bot matching, match thresholds, coverageComplete, pairStatus, NEXT ACTION, Profit Lock, hedge thresholds, market signals or risk calculations. r37/r38 fail-closed behavior remains authoritative.

**Execution isolation:** No Paper-bot parameter, leverage, execution or Pionex mutation path changes.
## D-047 — Pionex running-bot summaries require complete read-only detail hydration

**Decision:** A successful Pionex Bot API snapshot is built in two read-only stages: list running bot summaries, then load the official Futures Grid detail endpoint for every supported active futures-grid / hedge-grid row before publishing fresh bot structure.

**Fail-closed rule:** Missing IDs, duplicate IDs, detail-ID mismatches, incomplete detail payloads, pagination truncation, authentication/API/network failures, or any failed supported-row detail load must not publish a partial bot set as a fresh snapshot. The previous Pionex risk snapshot remains authoritative-but-stale under the existing freshness gates.

**Coverage rule:** The snapshot records listRows, supportedRows, detailRows and detailsComplete separately. DATA TRUTH exposes BOT DETAIL independently from BOT MATCH so API retrieval completeness and local matching completeness cannot be conflated.

**Read-only boundary:** The implementation uses only GET /api/v1/bot/orders and GET /api/v1/bot/orders/futuresGrid/order. It introduces no create, adjust, reduce, cancel, transfer or other mutation call.

**Isolation:** Matching thresholds, Decision Ready, Profit Lock, hedge threshold, market signals, portfolio math, Paper-bot parameters, leverage and execution are unchanged. Live trading remains disabled.
## D-048 — Pionex API integration remains read-only and split by permission domain

**Decision:** MERIDIAN may read Pionex account/futures state through Enable reading and bot state through Bot reading (Beta), but must not request or implement trading, transfer, bot-trading, leverage-update, margin-mode-update or other mutation capabilities.

**Account read scope:** GET /api/v1/account/balances, GET /uapi/v1/account/balances and GET /uapi/v1/account/positions.

**Bot read scope:** GET /api/v1/bot/orders and GET /api/v1/bot/orders/futuresGrid/order.

**Fail-closed rule:** Failed account reads update diagnostics only; the previous account snapshot is not refreshed. Missing credentials keep ACCOUNT API/BOT API visibly OFF rather than implying live connectivity.

**Secrets rule:** Credentials live only in the runtime secret store. No API key or secret may be committed, logged, embedded in frontend assets, issues, PR text, screenshots or chat.

**Execution isolation:** Trading rules, Profit Lock, hedge thresholds, market signals, Paper-bot parameters, leverage and execution remain unchanged. Live trading stays disabled.
## D-049 — Pionex Bot list must explicitly request supported Futures bot types

**Decision:** The read-only Bot API list request must send `status=running` plus `buOrderTypes=futures_grid` and `buOrderTypes=future_hedge_grid` instead of relying on an unfiltered list response.

**Reason:** The first live r42 connection reached Pionex successfully but entered `EMPTY_GUARD`. The dashboard was also showing stale API row counts from the preserved snapshot, which obscured the current list result.

**Diagnostics:** On `EMPTY_GUARD`, MERIDIAN may persist only aggregate `listRows`, `typeCounts`, `statusCounts`, and requested type names. No bot IDs, symbols, amounts, prices, PnL, or other private row data are added to diagnostics.

**Safety:** The zero-bot guard remains fail-closed. Trading rules, PaperBots, leverage, Profit Lock, hedge thresholds and execution logic are unchanged.
## D-050 — Avoid repeated-array query parameters in Pionex signed GETs

**Decision:** For Bot API list reads, MERIDIAN issues one signed GET per supported bot type (`futures_grid`, `future_hedge_grid`) instead of sending a repeated `buOrderTypes` array in one signed query.

**Reason:** The first live r43 request returned `INVALID_SIGNATURE` only after the repeated array filter was introduced. Pionex documents `buOrderTypes` as an array and requires HMAC over the sorted GET query. Separate scalar requests remove duplicate-key serialization ambiguity while preserving the same read scope.

**Safety:** Requests remain GET-only, the zero-bot guard remains fail-closed, and no trading/Paper/execution behavior changes.
## D-051 — Pionex running-bot discovery is unfiltered; Futures safety allowlist is local

**Decision:** MERIDIAN calls `GET /api/v1/bot/orders?status=running` without `buOrderTypes` and applies its supported Futures allowlist locally.

**Reason:** The first live r44 connection authenticated successfully but Pionex returned zero rows for type-filtered requests. Pionex's official OpenAPI states that omitting `buOrderTypes` returns all bot types, so unfiltered discovery is the least assumption-heavy read path.

**Diagnostics:** Aggregate `listRows`, `typeCounts`, and `statusCounts` are retained for troubleshooting. Bot IDs, balances, prices and PnL are not added to diagnostics.

**Safety:** Only locally supported Futures rows are hydrated/actionable. Unknown bot types remain excluded. `EMPTY_GUARD` remains fail-closed. No trading/Paper/execution behavior changes.
## D-052 — Separate live Futures account positions from bot identity

**Decision:** When Pionex Bot API does not enumerate existing bots, MERIDIAN may still use the read-only Futures account position feed as a separate live risk layer.

**Source:** GET /uapi/v1/account/positions under normal Pionex reading permission.

**Allowed use:** Display live account-position fields returned by Pionex such as side, leverage, average price, mark price, liquidation price, size and unrealized PnL.

**Forbidden inference:** An account position must not be assigned to a specific Grid Bot unless an independently verified bot identifier/match exists. Account positions therefore cannot unlock bot-specific Grid/TP/Profit-Lock decisions.

**Safety:** Bot decision readiness remains bound to the existing Bot API matching/freshness guards. The account position layer is informational/risk visibility only. No trading/Paper/execution behavior changes.
## D-053 — Discover Pionex Bot Account through full-wallet read before bot mapping

**Decision:** MERIDIAN adds the read-only `GET /api/v1/wallet/balancesFull` endpoint to discover Bot Account categories and entry structure before attempting any further bot mapping.

**Reason:** Live r46 proved the Futures Trader Account exposes only one XRP position while the user's Asset Watch reference contains many active Pionex bots. Pionex's Wallet API explicitly separates Bot Account and Trader Account, so the Bot Account is the next authoritative read surface.

**Safety:** The Wallet call is fail-soft and cannot invalidate the existing Futures position snapshot. Diagnostics expose only category types/counts and returned field names. No list entry values are made public and no category unlocks bot actions without an independently verified mapping.
## D-054 — Wallet Bot IDs may be probed read-only before promotion

**Decision:** MERIDIAN may retain private Bot Account entries from `TRADING_BOT` and `FUTURES_LITE` and probe their `buOrderId` values through `GET /api/v1/bot/orders/futuresGrid/order`.

**Reason:** r47 proved that Wallet API exposes the user's bot-account entries with `buOrderId`, `buOrderType` and `cateType`, while the Bot list endpoint itself returns zero rows.

**Privacy:** Bot IDs, investment amounts, profit and detail payloads remain in private state only. Public health/UI diagnostics expose only aggregate type/category counts and probe success/failure counts.

**Promotion rule:** Successful detail reads are discovery evidence only in r48. They do not enter the actionable Bot Risk layer until a later release explicitly validates normalization/matching and passes release gates.
## D-055 — Validated Wallet futures_grid details may serve as a live Bot fallback

**Decision:** When the classic Bot list endpoint is unavailable/empty, MERIDIAN may select a Wallet-derived bot risk snapshot as the active live Bot feed only if all supported `futures_grid` Wallet candidates have successful detail reads, all details normalize successfully, IDs are unique, the account sync is OK, and the Wallet-derived snapshot is no older than 15 minutes.

**Scope:** Only `buOrderType=futures_grid` is promoted in r49. `futures_lite` and every other unsupported Wallet bot type remain excluded and UNVERIFIED.

**Precedence:** A fresh, complete classic Bot API snapshot remains preferred. A stale classic snapshot must never override a fresh, complete Wallet-detail fallback.

**Safety:** Promotion changes data provenance only. Existing reference matching, Safety Ready, Decision Ready, Profit Lock, hedge thresholds, PaperBots and execution rules remain unchanged.
## D-056 — Diagnose Wallet live-risk normalization before relaxing any guard

**Decision:** When Wallet detail probing succeeds but the Wallet-derived risk snapshot is not complete, MERIDIAN exposes only aggregate normalization diagnostics before changing any source-selection or action-readiness rule.

**Diagnostics:** Aggregate status counts, trend counts, reject reasons, missing-base count, and returned field-name sets. No bot IDs, asset amounts, PnL values, prices, or other private row values are exposed publicly.

**Safety:** r50 is diagnostic-only. Wallet detail still requires complete normalization before it can become the active live Bot source. Existing matching, Safety Ready, Decision Ready, Profit Lock, hedge thresholds, PaperBots, and execution logic are unchanged.
## D-057 — Normalize surrounding whitespace on documented Pionex bot enums

**Decision:** MERIDIAN trims leading/trailing whitespace before evaluating documented Pionex bot type, bot status and bot trend enum values.

**Reason:** r50 live diagnostics showed all 32 Wallet futures_grid detail rows had valid semantic values (running; long/short; base present) while the production normalizer rejected all 32. The diagnostic path trimmed enum strings whereas the production normalizer did not.

**Safety:** Trimming does not broaden any allowlist. Supported types remain futures_grid and future_hedge_grid; active statuses remain unchanged; directions remain long, short and no_trend only. No action-readiness, trading, PaperBot, Profit Lock, hedge or execution thresholds change.
## D-058 — Use the production normalizer itself for stage diagnostics

**Decision:** MERIDIAN exposes a shared `inspectPionexBotOrder()` path used by the production normalizer and by Wallet-risk diagnostics.

**Reason:** r51 proved that separate diagnostic normalization can still diverge from production behavior. r52 therefore measures the exact four production gates: supported bot type, active status, symbol resolution and side/direction resolution.

**Privacy:** Public diagnostics expose only aggregate pass counts and coarse asset classes (asset, stable_quote, missing, unresolved). They do not expose bot IDs, symbols, balances, prices, investments or PnL.

**Safety:** r52 is diagnostic-only. It does not change any accepted bot type/status/direction, source-selection rule, matching rule, Safety Ready, Decision Ready, Profit Lock, hedge threshold, PaperBot or execution behavior.
## D-059 — Resolve inverse Coin-M symbols from quote when base is the stable side

**Decision:** For Pionex futures-grid details that are explicitly marked `inverse`, MERIDIAN resolves the asset symbol from `quote` only when `base` classifies as a stable/quote currency and `quote` classifies as an asset.

**Reason:** r52 live diagnostics showed all 32 supported Wallet futures-grid rows passed type, status and side checks, while symbol resolution failed 32/32. The same rows classified as BASE=stable_quote 32 and QUOTE=asset 32.

**Safety:** The fallback is restricted to explicit inverse semantics. Normal/non-inverse futures-grid rows continue to resolve symbols from `base`. No matching threshold, Safety Ready, Decision Ready, Profit Lock, hedge, PaperBot or execution rule changes.
## D-060 — Preserve Wallet cateType through bot-detail normalization

**Decision:** When Wallet Bot Account discovery supplies a bot `cateType`, MERIDIAN carries that category into the internal futures-grid summary and preserves it through detail merging.

**Reason:** r53 live diagnostics still showed SYMBOL 0/32 even though BASE=stable_quote and QUOTE=asset. Code inspection showed the Wallet row already carried `cateType=inverse`, but buildWalletBotRisk omitted that field before calling the production normalizer, so the inverse-only symbol fallback could not activate reliably.

**Safety:** r54 does not synthesize or broaden category values. It only preserves the category already returned by the read-only Wallet API. Existing bot-type/status/direction allowlists, matching, Safety Ready, Decision Ready, Profit Lock, hedge thresholds, PaperBots and execution rules remain unchanged.
## D-061 — Diagnose live/reference matching by stage before changing matcher thresholds

**Decision:** When normalized Wallet bots are complete but none can be matched to the Asset-Watch reference snapshot, MERIDIAN must diagnose the existing matcher stage-by-stage before any threshold or acceptance rule is changed.

**Diagnostics:** Aggregate per-live-row pass counts for asset, side, exact leverage, structural evidence, strong candidate and final accepted match; aggregate live/reference side distributions; aggregate live field availability for leverage, range, break-even, liquidation and TP.

**Safety:** r55 is diagnostic-only. MATCH_MAX_SCORE, MATCH_MIN_GAP, ambiguity handling, per-asset UNVERIFIED guards, Safety Ready, Decision Ready, Profit Lock, hedge thresholds, PaperBots and execution logic remain unchanged.
## D-062 — Validate Pionex trend against economic liquidation geometry before any side remap

**Decision:** A mismatch between Pionex `trend` and the legacy Asset-Watch side must not be corrected by blindly flipping LONG/SHORT. MERIDIAN first validates declared side against economic risk geometry derived from break-even and liquidation price.

**Diagnostic rule:** when both BE and LIQ are positive and separated by at least 0.2%, `LIQ < BE` is classified as economic LONG and `LIQ > BE` as economic SHORT. This classification is diagnostic only in r56.

**Additional cross-checks:** Compare matching potential by asset while ignoring declared side, then repeat against the economic side. Report only aggregate counts.

**Safety:** No normalized bot side is changed. Matcher thresholds, ambiguity handling, Safety Ready, Decision Ready, Profit Lock, hedge thresholds, PaperBots and execution logic remain unchanged.
## D-063 — Promote complete Wallet detail rows to API-native bot identity

**Decision:** A fresh Pionex Wallet-detail snapshot may identify live bots directly without matching against the historical Asset-Watch screenshot snapshot when and only when all supported rows are normalized, detailsComplete=true, every row has a non-empty unique bot ID, and supportedRows=normalizedRows=live rows.

**Reason:** The 27.09 Asset-Watch snapshot is historical and can legitimately diverge from the current bot inventory. The private Pionex API already provides stable bot IDs plus current range, leverage, liquidation, position-open and TP/SL fields.

**Side validation:** For explicit inverse/Coin-M rows, when direct positionOpenPrice and direct liquidationPrice are both present and clearly separated, MERIDIAN derives economic side from liquidation geometry. The original Pionex trend is retained as declaredSide for diagnostics.

**Safety:** API-native identity replaces only legacy screenshot identity matching. Freshness, risk availability, PnL availability, capital completeness, market-data freshness, Safety Ready, Decision Ready, Profit Lock, hedge thresholds, PaperBots and execution remain independently fail-closed.


## D-064 — Manual screenshots validate live identity but never define current inventory

**Decision:** User screenshots may be used as point-in-time validation samples for individual bot direction and structural fields, but they must not be promoted into a canonical statement about the full current Pionex bot inventory.

**Evidence:** The earlier DOT SHORT sample from 28.09.2026 18:58 was closed immediately afterwards and is historical only. The fresher 19:05–19:06 SUI COIN-M screenshots show both directions simultaneously: a SHORT 4x bot with current price 1.1556, creation price 1.0043, break-even 1.0252 and liquidation 1.5636, and a LONG 4x bot with current price 1.1556, creation price 1.2463, break-even 1.2218 and liquidation 0.6859.

**Implication:** Economic side remains derived for explicit inverse/Coin-M rows from direct positionOpenPrice vs liquidationPrice when clear. Complete fresh Wallet-detail rows with unique bot IDs remain the current identity source. Older Asset-Watch screenshots and newer spot-check screenshots are historical/validation evidence only and cannot justify global assumptions such as "all current bots are LONG" or "there are no SHORT bots."

**Safety:** This changes documentation and validation evidence only. No trading, transfer, PaperBot, Profit Lock, hedge threshold, leverage, matcher threshold or execution behavior changes.


## D-065 — Normalize quote-inverse Coin-M prices before side or risk interpretation

**Decision:** When a Pionex futures-grid row is explicitly inverse and resolves its asset from `quote` because `base` is a stable quote currency, MERIDIAN treats positive API price fields as reciprocal pair prices and converts them to asset/USD with `1 / raw` before using them for display, matching, liquidation geometry or action-readiness inputs.

**Scope:** The conversion is restricted to rows whose production symbol resolver reports `quote_inverse`. Normal asset-base rows remain unchanged.

**Direction:** The original Pionex `trend` remains available as `declaredSide`, but quote-inverse LONG/SHORT is translated into the asset perspective as `assetDeclaredSide`. When normalized entry and liquidation are both available and clearly separated, economic liquidation geometry remains authoritative for the normalized side.

**Liquidation safety:** Estimated liquidation candidates are converted first and accepted only if they fall on the correct side of normalized entry for the resolved asset direction. Ambiguous candidates remain unavailable rather than being guessed.

**Evidence:** r57 live UI showed BTC reciprocal values such as BE 0.000011999 and TP 0.000010526 against a market price near 83,530 USD, and reported an implausible BTC 0 LONG / 5 SHORT distribution. The current SUI screenshots provide simultaneous LONG and SHORT control samples with conventional asset prices.

**Safety:** This is a data-normalization correction. No execution permission, trading logic, PaperBot strategy, leverage, Profit Lock, hedge threshold, matcher acceptance threshold or fail-closed decision gate is loosened.


## D-066 — One authoritative COMMAND layer and Wallet equity before screenshots

**Decision:** In v10, legacy v9 COMMAND panels are implementation scaffolding only. If v9 repaints them asynchronously, the v10 observer must treat their presence as a reason to re-run COMMAND decoration, and CSS must suppress them as a final visual guard. The user must see one DATA GUARD and one exposure model.

**Exposure semantics:** Values calculated as confirmed bot investment USD multiplied by leverage are not generic capital figures. They are labeled LONG/SHORT/NET NOTIONAL.

**Pionex equity precedence:** If the canonical portfolio has no higher-priority private Pionex equity snapshot but the fresh read-only account snapshot contains `wallet.totalInUsdt`, that Wallet API total becomes the Pionex equity source. Screenshot fallback remains lower priority.

**Safety:** Wallet equity affects portfolio presentation only. It does not make bot rows decision-ready, does not synthesize PnL, and does not alter trading, leverage, Profit Lock, hedge thresholds or execution.


## D-067 — Data refresh must rebuild the active source view before v10 decoration

**Decision:** The v10 adapter may not assume that legacy source markup is current. When fresh private data arrives while COMMAND is active, the active v9 view is rebuilt from the current state before v10 decoration. Every navigation click also forces v10 decoration after the legacy tab renderer runs.

**Reason:** r59 live acceptance showed correct state in the v10 safety layer while the underlying COMMAND hero or BOTS layout could still display an older render. The problem was lifecycle ordering, not bot normalization.

**Wallet diagnostics:** Wallet total, Bot Account total and Trader Account total are displayed independently from their existing read-only normalized fields. Missing values remain unknown and are not replaced by zero or inferred sums.

**Safety:** This decision changes rendering and diagnostics only. It does not alter trading rules, PnL interpretation, leverage, Profit Lock, hedge logic, matcher thresholds, decision readiness or execution.


## D-068 — Explicit view lifecycle event and freshness-based Pionex equity precedence

**View authority:** Every legacy `go(v)` render emits `meridian:view` in v10 mode. The v10 adapter must force decoration from that event. DOM mutation and delegated click listeners remain defensive aids, not the sole authority.

**Pionex equity authority:** Source precedence is freshness-based. A successful Wallet API `totalInUsdt` may replace an untimestamped or older private equity snapshot. A valid fresher private snapshot may still outrank Wallet API.

**Reason:** r60 live acceptance showed COMMAND using current state while BOTS could remain on v9 markup, and showed an untimestamped private Pionex snapshot still displayed despite a fresh account-read layer.

**Safety:** This changes UI lifecycle and portfolio presentation provenance only. PnL, trading, leverage, Profit Lock, hedging, matcher thresholds and execution remain unchanged and fail-closed.


## D-069 — Terminal shell must self-heal across cached releases

**Decision:** A successful deployment is not sufficient evidence that an installed/mobile client is on the current terminal shell. The v10 shell must compare its local build against a no-store `version.json` probe and navigate to a cache-distinct URL when they differ.

**PWA launch:** The manifest start URL must track the current v10 terminal revision and must not remain pinned to a historical release.

**Release gate:** Runtime smoke verifies terminal HTML/JS, manifest launch revision, and the presence of the stale-build self-heal.

**Limitation:** A client already executing a pre-r62 cached shell does not contain the new recovery code. That client needs one explicit cache-busted load once; r62 then provides the ongoing recovery mechanism.

**Navigation authority:** Once the v10 adapter is loaded, it owns bottom-tab onclick handlers. It may use the v9 bridge to update the underlying source state/view, but the visible tab must then be rendered directly by v10. A renderer exception must surface as a visible diagnostic instead of silently leaving legacy markup.

**Safety:** Bootstrap/cache and presentation lifecycle behavior only. No market, bot, PnL, decision, strategy or execution behavior changes.


## D-070 — Portfolio total requires current venue authority, not merely fresh prices

**Decision:** A holding row is not current evidence of ownership simply because its symbol can be priced live. In the production v10 portfolio path, historical holdings are excluded unless they have current timestamped authority or are represented by a current venue-level balance.

**External venue contract:** Ledger and OKX are the currently expected non-Pionex venues. Their current account totals are stored as local device references with timestamps. Both expected venues must be current (24h authority window) before the external portfolio component is complete.

**Double-count prevention:** A current venue-balance reference supersedes asset-level holdings from the same venue. Old holdings from any other venue are excluded when their own timestamps are stale or missing.

**Pionex:** Fresh Wallet API equity remains authoritative. Private snapshots may remain fallback/reference sources but do not override a fresher Wallet API value.

**Privacy:** Current personal venue balances are not hard-coded or committed to GitHub. They remain local to the user device.

**Safety:** If current Ledger/OKX references are missing or stale, COMMAND must display an incomplete portfolio rather than reuse old quantities. No trading, PnL, leverage, Profit Lock, hedge, matcher or execution rules change.


## D-071 — Ledger is a confirmed holdings authority, not a fixed USD balance

**Decision:** Ledger valuation should move with the market between confirmations. The browser may use private Ledger quantities already present in the authenticated portfolio and value them with the existing all-ticker public Binance Spot feed.

**Confirmation:** Ledger ownership quantities require a local confirmation timestamp no older than 24h. A fresh r63 Ledger venue-reference timestamp may bootstrap the first r64 confirmation. After expiry, Ledger falls back to fail-closed until reconfirmed.

**Privacy:** The confirmation timestamp is local-only. No wallet quantity or account value is committed to source code or sent to a public per-asset pricing query.

**Canonical composition:** Ledger live-priced holdings + current OKX venue balance + current Pionex Wallet API equity. All other historical holdings are excluded from the production total.

**Completeness:** A required holding venue is complete only when it is present with current authority and every admitted holding is priced from a fresh market overlay. Missing Ledger pricing or missing OKX authority blocks the headline total.

**Safety:** Portfolio valuation/presentation only. No bot matching, PnL interpretation, strategy, leverage, Profit Lock, hedge or execution behavior changes.
