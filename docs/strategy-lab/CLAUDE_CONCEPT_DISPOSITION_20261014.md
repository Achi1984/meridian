# Strategy concept review: lead disposition

Source: mailbox571 comment6160871680, request strategy-concept-20261014-a3f0314,
run38511337000. Claude reviewed parts of the documentation at a3f0314, not the
subsequent payoff migration, code, tests or full JSON contract. Its answer is
CONCEPT_REVIEW_ONLY; it is neither an implementation review nor run authorization.
This disposition adopts or corrects suggestions before any outcomes are observed.

## Adopted research priorities

1. Preserve slow trend as the reference question. P1/C1 isolates the previous-%R
   crossing requirement only, with frequency/exposure consequences; it cannot
   attribute all differences to independent alpha or evaluate the whole %R family.
2. Add a non-selectable SMA200 Long/Cash context specification below. It is not a
   third selectable candidate or permission to evade the cumulative trial ledger.
3. Treat the deliberately delayed daily-open model as a coarse engineering/delay
   stress test. A later executable baseline needs finer same-venue observations
   after decision availability, plus spread/impact/cost evidence. It is a new
   versioned model, never a silent replacement after inspecting outcomes.
4. Before empirical PnL, bind code/data/rules/costs and all decisions (including
   no-action) to an immutable manifest and reconcile every prior trial. Those gates
   remain. Next code package separates signal mathematics from time admission using
   synthetic fixtures only; actual archive receipt must remain unchanged.

## Corrections and limits

- With exclusive close D, decision D+60,000ms and first subsequent daily open
  D+86,400,000ms, decision-to-fill delay is exactly 86,340,000ms =23h59m under the
  complete regular-day model. Relative to signal-bar opening it is two days.
  Claude's suggestion that decision delay is 24h-plus is not adopted.
- Numerical cost bands are assumptions, not demonstrated sufficient conservatism.
  Their effect on ranking and concentration is unmeasured. Do not call costs
  adequate or irrelevant before executable venue/size evidence exists.
- EUR accounting is not merely a display conversion. Different trade timings,
  EUR cash retention, FX costs and EUR-based sizing can change relative results.
  For example, abstract profits10quote units at0.8EUR/unit versus9 at1.2 produce
  EUR8 versus10.8; this arithmetic is not a strategy result. A separate USDT-native
  engineering account could simplify an additional experiment, but it would have
  a different numeraire/cash/risk contract and could not establish EUR performance.
  The current EUR10,000 design remains; no assumed USDT/USD parity or depeg immunity.
- No measured regime composition, expected trade count, independence or correlation
  was established by this document-only review. BTC/ETH survivor selection and
  inspected development scope are already limitations; use actual future authorized
  diagnostics rather than declaring this entire window a single measured regime.
- Pooled trade counts are not independent observations. Shared dates/exposure and
  overlapping trades must remain visible; doubling assets does not double evidence.

## Prospective interpretation rule (proposed before results)

The comparison remains DESCRIPTIVE_ONLY for every outcome. Report completed-trade
counts per asset/candidate/scenario, overlapping holding dates and exposure alongside
paired daily differences. If either P1 or C1 has fewer than30 completed trades
pooled across BTC/ETH, add SPARSE_SAMPLE_DO_NOT_RANK. Thirty is a transparent
engineering warning threshold, NOT a statistically validated adequacy or power
criterion. At or above30, still no significance, robust-edge, independence, PASS or
promotion claim. Do not run a signal-count experiment to tune this threshold.
This is a proposed addendum to the blocked experiment, not a frozen executable gate.

## Non-selectable simple trend context

SMA200 uses the same available completed daily closes and explicit60s assumption.
Each EUR5,000 sleeve starts cash: if flat and close>SMA200, queue an entry for the
same delayed daily-open proxy; if held and close<SMA200, queue a full exit. Equality
keeps state. No oscillator, stop, fixed target or ten-day timeout. Allocate at most
the sleeve's cash after fees at entry, rounding by the still-unresolved instrument
manifest; no leverage, cross-sleeve transfer or same-day re-entry. Other data,
cost/FX, audit, end-marking and invalid-run rules stay identical.
This context uses cash allocation, NOT P1's stop-based0.25% risk sizing: exposures
and risk are unmatched and must be reported, not interpreted as isolated signal
value. It provides trend/beta context only. Record its runs in the ledger. Any
selection/tuning/promotion would count as a candidate and require a revised budget.
No context source implementation or empirical run is claimed here.

## Two deferred hypotheses, not new empirical candidates

### A. Volatility scaling overlay — existing trend/allocator research

Hypothesis: lagged volatility scaling may reduce drawdown/recovery costs enough to
justify turnover. Proposed sketch: once weekly after the last completed UTC daily
close is available, compute sample standard deviation of the prior30 log returns,
annualized by sqrt(365); weight=min(1,0.15/vol). Zero/invalid volatility means no
new allocation and an explicit data fault, not unlimited exposure. Apply to an
otherwise unchanged long/cash signal. Rebalance only at the declared later fill;
one parameter choice, no per-asset tuning. Compare first with fixed50% exposure
chosen before results, same dates and all costs. Report exposure differences.
Matching the full-sample average weight afterward is descriptive attribution only,
not an implementable baseline: it would use future information.
Main failure: volatility rises after losses, then de-risking misses recovery;
rebalancing costs may dominate. Required: eligible prices, actual sizing/fill model,
costs, causal weekly timestamps. This overlaps existing trend/H7/H12 work and must
consume a variant slot if ever selected. No claim of new independent alpha.

### B. Funding-context event study — existing positioning/funding research

Hypothesis: unusually high known funding may predict different three-day spot
outcomes after conditioning on trend/volatility. Proposed sketch: at a confirmed
funding publication, compare the observed rate with strictly earlier90-day rates
of the SAME instrument/venue/schedule; an upper-decile event starts a forward
three-day observation only after availability. No order, leveraged position or
short is implied. Collapse overlapping events with a predeclared three-day embargo.
Primary control must match lagged trend, volatility and calendar context using
prior information; unconditional/random days alone confound momentum. The matching
algorithm and thresholds still require preregistration before any observation.
Main failure: funding tracks a continuing trend; timestamp errors, schedule changes
and selection can manufacture the effect. Needed: historical published/received
rates, schedule changes, instrument eligibility and corresponding spot observations.
These data are not present/verified. Related failed funding/flow lines remain in the
lineage; this is not a new budget or a rescue of earlier failures.

Neither hypothesis is registered for evaluation. Current P1/control work and the
four-candidate first-tranche/cumulative caps remain binding. Further empirical
selection requires ledger reconciliation and the existing research gates.

## Resource handoff

The single conceptual Claude call completed. No follow-up request or model retry
is needed for this disposition. M11 retains priority on Claude; this strategy
package uses internal implementation/review agents and its isolated draft branch.
No platform, workflow, scheduler, permission, merge or trading changes are included.
