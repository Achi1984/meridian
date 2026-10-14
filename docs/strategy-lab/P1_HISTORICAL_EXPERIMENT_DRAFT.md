# P1 historical engineering experiment — proposed contract v1

Status: DRAFT_BLOCKED, not frozen and not executed. Owner delegated research design;
this document does not grant empirical execution, PnL, Discovery, Validation,
Holdout, Paper or Live permission. No strategy outputs have been inspected here.
The companion JSON pins the proposed inputs and records unmet prerequisites.
No source flag or checklist can authenticate an external approval.

## Question and scope

Does the Williams-%R entry filter add value to a daily SMA200 trend entry when
position sizing, stop rules, exits, execution delay and costs are otherwise equal?
This is a bounded two-asset engineering comparison, not a historical Top20 study,
an unseen test, or a reproduction of Larry Williams' trading record.

P1 retains its existing rules: close>SMA200; previous %R10<=-80 and
-80<current %R10<-20; initial stop=current low minus 0.5 arithmetic ATR14.
Exit on close<SMA200, %R10>=-20 or ten daily closes strictly after entry, with a
standing stop. No fixed target, no mandatory 3:1 reward/risk and no leverage.
C1 differs ONLY in removing the previous-%R<=-80 crossing requirement: it enters
when flat, close>SMA200 and -80<current %R10<-20. It retains every other P1 rule.
Thus C1 is a matched non-crossing control, not a pure SMA-only strategy. This narrow
contrast isolates the crossing requirement; it does not measure the entire %R
family's contribution. Neither candidate can re-enter on an exit day.

Reserve proposed IDs H1.P1.DAILY.V1 and H1.C1.NONCROSSING.V1. BOTH count as selectable
candidates in H1 and the campaign, even if C1 loses or a run fails. Do not start
until the full earlier H1/H5/H7/cross-market/manual-trial ledger is reconciled with
the four-candidate first tranche, three-per-family and 36-total caps. These are
proposals, not proof that slots remain. The stale universal-3:1 campaign/validator
contract requires a separately reviewed migration; no frozen reference is edited.
Three cost scenarios below are compulsory sensitivities, not selectable variants.
Record all six candidate/scenario combinations, rejected runs and any manual edits.

## Data and clocks

Use only the pinned Binance BTCUSDT and ETHUSDT daily archives: 652 bars each,
2023-01-01 through 2024-10-13 open dates. First 201 bars warm up each signal.
All this history is inspected development material. No resplit creates a holdout.
BTC/ETH are selected survivors, not evidence of contemporaneous universe membership.
Do not fill gaps from another venue. A hash/schema/day-sequence failure invalidates
the experiment; do not silently remove an asset or interval.

Propose ASSUMED_PUBLICATION_V1 with a fixed 60,000ms publication delay and decision
at exclusive UTC close +60,000ms. This is an unvalidated assumption, not measured
historical availability. Retain the actual 2026 archive receipt in immutable data.
Do not backdate availableAtMs and do not feed historical bars to the synthetic-only
adapter by relabeling them. A separate reviewed historical adapter/shared signal
math separation is required; existing live-time guards stay intact.

Daily prices cannot provide a quote just after the decision. The proposed coarse
model therefore queues a signal for the FIRST daily open STRICTLY AFTER decision
time (normally almost 24 hours later), never the open simultaneous with the signal
candle close. The delay is deliberately part of this experiment, not a claim of
best execution or an unnoticed proxy for immediate execution. No interpolation.
Only closes with a subsequent supported fill day can create orders. Terminal
signals are recorded as unfilled; no extrapolated fill or forced terminal sale.

## Proposed daily execution ordering

For each instrument day, process the open before that day's range and close:
1. For a carried position, a gap open at/below stop closes at that open. Otherwise
   a previously queued exit closes at open. At most one sale; clear its pending exit.
2. A queued entry may fill at open only if flat, no exit that day, signal not
   consumed, fill price after cost below neither stop nor zero, and all limits pass.
   Specifically require BOTH raw open and cost-adjusted buy price > initial stop;
   otherwise cancel the candidate. Expiry is that designated open only. No chasing.
3. Any position still held, including a new open entry, is stopped if daily low
   <=stop: modeled raw exit=stop, then adverse sell costs. Open-gap precedence above
   prevents a favorable stop-price fill through a gap. Do not use the low as an
   observed executable bid. This range-touch model is hypothetical and can miss
   worse intraday gaps, spread spikes and outages; it is NOT a worst-case bound.
4. At close, value holdings and evaluate the closed-data signal after the assumed
   publication delay. Exits override entries; canceled/rejected/consumed IDs remain
   recorded. No same-day stop/re-entry, future high/low at open sizing, or target.

Every signal, no-action result, rejection, fill and state transition needs a durable
audit record binding the input window hash, rule version, timestamps and policy.
The existing synthetic adapter does not yet persist no-action/window provenance.
Open positions at sample end stay open and marked; unrealized value is reported
separately. Terminal liquidation is not silently substituted for marked equity.

## Capital, sizing, denomination and costs

Each candidate/scenario has its own EUR10,000 virtual account split permanently
into BTC and ETH sleeves of EUR5,000. No transfer or compounding across sleeves.
Risk budget per entry=0.25% of that sleeve's previous completed daily EUR equity;
one position per sleeve; gross spend including fees cannot exceed available cash.
Before the first eligible fill, the risk reference is the initial EUR5,000 sleeve.
Do not spend unrealized gains. No borrowing, shorting, funding or derivatives.
The model may exceed planned loss after gaps; 0.25% is a sizing target, not a cap.

Before sizing, use stressed exit=90% of the rounded initial stop, a fixed assumed
gap buffer. Choose the largest permitted whole number of instrument lots that
fits cash and fee-inclusive modeled risk. Below-minimum orders cancel. Historical
tick/lot/minimum-notional specifications are missing: do not invent exchange
compliance from synthetic lots. No run until a versioned instrument manifest fixes
lot/tick rules and effective dates (or a separately reviewed idealized-lot design).

Signals and stops stay in USDT price units. EUR conversion is solely for cash,
risk and valuation; converting historical OHLC to EUR before %R/SMA would change
the strategy. EUR cash stays EUR; each modeled trade converts the exact USDT debit
or credit at event-time EUR-per-USDT. FX spread/fees must be frozen separately.
USDT/USD basis must be explicit; USDT=USD or missing FX=1 is forbidden.
FX source, publication/receipt times, maximum permitted age and conversion costs
are still unresolved. Missing valid FX blocks EUR accounting, not silently a row.
For a range-touch stop, daily OHLC does not reveal the intraday fill time. A frozen
modeled stop timestamp and corresponding FX rule are additionally required; never
use that day's later FX close as if it had already been known at the stop. This
unresolved timing issue is part of the FX and daily-engine blockers.
Do not substitute the most recent future FX rate. Weekend/holiday treatment must
be fixed before the manifest can be frozen.

Three pinned per-side cost assumptions, in basis points:

| Scenario | Fee | Half-spread | Adverse slippage |
|---|---:|---:|---:|
| Base | 10 | 5 | 5 |
| Stress | 20 | 10 | 20 |
| Shock | 20 | 30 | 60 |

For the DAILY_OPEN_RANGE_PROXY_V1 model, OHLC is a raw trade-price anchor,
NOT an observed midquote. Buy price=raw price*(1+(halfSpread+slippage)/10000);
sell price=raw price*(1-(halfSpread+slippage)/10000). Fees apply separately to each
side's resulting notional. Round buys up and sells down to the declared tick;
round fees up in the specified accounting unit. Validate positive prices.
This explicitly adapts the earlier quote-based cost assumptions to a coarse daily
proxy. Do not claim measured spread, depth, market impact or account fee rates.
Report all scenarios; do not select the cheapest result. A future observed bid/ask
model must replace proxy spread application to avoid counting spread twice.

## Required report and interpretation

Compare P1 and C1 on exactly the same dates, sleeves, costs and initial capital.
Report per asset, combined portfolio and every cost scenario: gross/net marked
equity, realized/unrealized decomposition, fees and FX costs, exposure, turnover,
completed trades, open positions, rejects/unfilled signals, daily-close drawdown,
recovery duration (unrecovered labeled), and paired P1-minus-C1 net return.
Combined equity sums both contemporaneous sleeves; never average Sharpe or add
percentage returns. Daily-close drawdown is not intraday drawdown.

Context controls: EUR cash with zero yield as an explicit assumption; passive
equal EUR sleeves bought at the first eligible modeled fill day using the same
rounding/cost/FX rules, then held and marked without rebalancing or terminal sale.
Neither contextual control is selectable; selecting/tuning one would count as a
candidate. Report net results for 2023 and 2024-to-end as fixed calendar diagnostics;
do not optimize dates or retrospectively label winning regimes. Common complete
window only; no asset exclusion based on outcomes.

Report counts and raw paired daily differences. Formal Sharpe significance,
bootstrap confidence or selection-adjusted claims are deferred until a separately
reviewed method and trial ledger exist. Sparse, selected and inspected data can
produce, at most, an engineering finding; positive results cannot yield PASS or
promotion. Technical failures are INVALID with reason; otherwise outcomes remain
DESCRIPTIVE_ONLY irrespective of sign. Preserve negative findings.

## Freeze checklist and next implementation

Unresolved items in the JSON must remain false/null until backed by evidence:
payoff-policy and trial-ledger reconciliation; historical indicator/time adapter;
daily fill engine and full audit trail; instrument rules; event-time FX including
costs; exact code/data hashes; independent review of final executable contract;
separate owner execution approval under the canonical checkpoint.
The second-venue audit and historical eligibility remain unverified and must be
disclosed even for an authorized engineering run. They block any claim of robust
tradability, not permission to silently switch datasets.

NEXT: migrate the stale payoff-policy/register coherently for new research while
preserving legacy/frozen evidence, then implement the separated historical signal
and daily model using synthetic boundary fixtures only. No Claude invocation,
M11 work, automation change, merge or historical strategy run in this packet.
