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

**Required evidence:** total R, average/median R, R win rate, giveback, TP1→BE stop rate, TP2 continuation, side/symbol/regime splits and robustness across time windows.

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
