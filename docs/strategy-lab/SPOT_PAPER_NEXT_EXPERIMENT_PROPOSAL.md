# BTC/EUR next paper experiment proposal

**Status: proposal only; no run, strategy result, or operating approval.**
This document extends the existing
[readiness packet](PAPER_READINESS_NEXT_PACKET.md),
[signal-replay contract](SPOT_PAPER_SIGNAL_REPLAY.md), and
[Arena protocol](PAPER_ARENA_PROTOCOL_20261016.md). It reuses the established
host evidence and assessment process; it creates no readiness framework and
does not authorize execution.

## Current eight-hour run: evidence still pending

The assessment target is exactly:

| Identity | Bound value |
| --- | --- |
| Host run | `btc-eur-paper-host-8h-001` |
| Northflank Job | `e7916ab3-3b3e-43f8-a07a-27204c066c15` |
| Source | `473943fb20d8ef25a5822c89a5abfb216437d782` |
| Start receipt | [Issue #1279 start receipt](https://github.com/Achi1984/meridian/issues/1279#issuecomment-6722330496) |
| Profile/model | `BTC_EUR_PAPER_HOST_8H_V1` / `BTC_EUR_SMA5_SMA20_V1` |

The receipt binds the start, not the result. No terminal status, exported
archive, verified hash, independent expected-context assessment, or run outcome
is established by this proposal. Until those retained artifacts are assessed,
each outcome below remains **PENDING**:

| Required finding | State |
| --- | --- |
| Terminal status and clean terminal report | PENDING |
| Archive and manifest integrity; archive hash and every listed file hash verified | PENDING |
| Expected context independently prepared and matched to the retained evidence | PENDING |
| Actual elapsed time, stop reason, and duration/cycle coverage | PENDING |
| Accepted observations, requests, bytes, gaps, and gap reasons | PENDING |
| Signal replay, accounting, and fill-causality assessment | PENDING |
| Fill count/details, turnover, and fees | PENDING |
| Realized/unrealized and marked PnL, terminal cash/equity, and ending inventory/mark age | PENDING |
| Independent assessment and disposition | PENDING |

Do not access or alter the active host to fill these gaps. Once the writer has
exited, use the existing read-only status/report, byte-preserving packaging and
authenticated retrieval, hash verification, and offline host assessment in
[SPOT_PAPER_HOST.md](SPOT_PAPER_HOST.md). Bind the independently reviewed
expected context to the exact run, reviewed manifest bytes, and runtime-source
fingerprint; do not derive expected values from the evidence being assessed.
Keep unavailable image/host identity fields unavailable as the existing
procedure specifies. Missing, mismatched, corrupt, or untrusted evidence is
not a pass. Report the measured elapsed duration and coverage; an earlier cycle,
request, or other bound is a shorter partial observation, not eight hours.
Preserve the raw observations, gaps, signals, fills, costs, marks, and ending
inventory in the assessment; do not force-close or infer absent values.

The [one-run egress exception](SPOT_PAPER_HOST_DEPLOYMENT_EXCEPTION.md) applies
only to this exact eight-hour run. It is not evidence of `NETWORK_PASS` and
cannot be reused or inherited by a future run.

## Keep paper-run identities separate

| Run/profile | Existing identity and documented status | Interpretation |
| --- | --- | --- |
| 1-hour | `spot-paper-42395522899-1`, `BTC_EUR_PAPER_1H_V1`; the retained reconciliation reports 60 cycles and 3,542,902 ms, ending at the cycle limit | A partial bounded run, not a full hour; its signal replay does not assess profitability. See [reconciliation](SPOT_PAPER_PILOT_42395522899_RECONCILIATION.md). |
| 4-hour | `BTC_EUR_PAPER_4H_V1`; a distinct workflow/profile documented in the [pilot preparation](SPOT_PAPER_PILOT.md) | Keep its dispatch and outcome separate; do not transfer its identity or result to the host run. |
| 8-hour host | `btc-eur-paper-host-8h-001`, `BTC_EUR_PAPER_HOST_8H_V1`; Northflank Job and source are bound above | Current assessment target; outcomes remain PENDING until independently assessed. |

These are different run identities and evidence scopes. Never rank their PnL
naively by nominal duration: coverage, observations, gaps, fills, inventory,
marks, and costs must first be reconciled, and unlike runs are not paired
strategy trials.

## Disposition after independent assessment

| Assessment | Next action |
| --- | --- |
| Evidence incomplete, untrusted, or inconsistent | Resolve the evidence/retrieval/integrity issue; do not infer an operational or strategy result. |
| Evidence is trusted and demonstrates an operational failure | Engineering remediation and review; no automatic restart or replacement run. |
| Operational evidence passes, but strategy evidence is insufficient | Consider the separately gated diagnostic paper evaluation below. |

An operational pass is not strategy validation. Negative PnL alone is not an
infrastructure failure; positive PnL alone does not establish strategy quality.
Preserve results and use the existing independent review and decision gates;
do not retrofit success thresholds or relabel incomplete evidence.

## Contingent next experiment: bounded 24-hour strategy versus cash

Only after the eight-hour evidence is independently assessed, and only after a
separately reviewed manifest and operating decision, consider one bounded
24-hour BTC/EUR paper evaluation. This is a preregistration proposal, not
permission to prepare a manifest, acquire data, launch, or change the runtime.
The existing eight-hour profile is not a 24-hour configuration. A future
review must establish that its separately reviewed bounds can actually support
the proposed window; any earlier bound makes the realized duration partial.
Use the existing host assessment/export process rather than a new readiness
framework.

Freeze the comparison before observing outcomes:

| Element | Preregistered treatment |
| --- | --- |
| Strategy | Existing frozen `BTC_EUR_SMA5_SMA20_V1` only: BTC/EUR spot, one-minute closed candles, SMA(5)/SMA(20) crossover, the existing 21-candle warm-up and decision cutoff, no shorting/leverage, and the existing simulated-capital and exposure limits. Do not tune it. |
| Control | Cash/no-trade from the same starting EUR capital, over the same UTC window and the identical accepted BTC/EUR observation timestamps. It submits no virtual fills and remains cash; no price return is imputed to cash. |
| Shared assumptions | Same capital, window, input observations, warm-up/cutoff, decision and execution-delay rules, spread filter, adverse-slippage assumption, fee assumption, and valuation timestamps/mark-age rules. Apply the existing pilot's reviewed assumptions unchanged: 50 bps fee and 10 bps adverse slippage per side, with the 50 bps entry-spread filter. These are model assumptions, not verified Kraken fees or executable costs. |
| Window | Maximum 86,400,000 ms from the separately recorded start boundary. Record the actual elapsed time and stop reason. Do not call a run that ends earlier a full 24-hour evaluation. |
| Reporting | For strategy and control, report net return/PnL, marked-equity drawdown, turnover, fees and modeled costs, exposure, cash/inventory, and terminal mark/mark age. State the denominator and valuation method. Predeclare fee-only sensitivity at 25/50/75 bps per side on the strategy's observed fills, with fill quantities and marks held fixed and slippage unchanged; this is arithmetic, not counterfactual fills or verified venue fees. A statistic with an undefined denominator or inadequate observations remains undefined; do not replace it with zero or a fabricated value. |

Use the exact existing signal/fill causality and mark rules; a signal close is
not a fill price. The control must share the same observation window and
valuation boundaries even though it has no strategy signals or fills. Report
missing/stale observations and unmarked inventory explicitly. A paired result
does not make the paper observations independent or establish general strategy
quality.

No challenger is proposed here. A challenger may be considered only if it has
an existing strategy passport, exact fixed parameters, and a preregistration
completed before outcomes are observed. Do not create or substitute an
unsupported strategy. Arena 8/16 bps are diagnostic assumptions, not verified
venue fees, and must not replace the current pilot assumptions.

## Operating, egress, and cost conditions

- No activation, manifest creation, extra data acquisition, restart, real order,
  or change to scripts, workflows, dashboards, or runtime is authorized by this
  proposal.
- Resolve the egress decision separately before any future run. The current
  one-run exception is not reusable. Do not assume that a previous exception,
  successful assessment, or existing host setup approves new egress.
- Include a cost worksheet in the separate operating review covering build,
  runtime, storage, and egress, with the evidence period/source and observed
  billing clearly distinguished from estimates. Reuse existing cost alerts;
  this proposal creates or changes none. USD 20 is a planning reference only,
  not a hard cap, authorization, or claim about incurred cost.
- Keep operational cost evidence separate from strategy PnL and from modeled
  transaction costs. Do not invent billing observations or infer a hard cap
  from an alert.

## Existing references and scope

- [One-hour/four-hour pilot definitions and prior identities](SPOT_PAPER_PILOT.md)
- [Retained one-hour reconciliation](SPOT_PAPER_PILOT_42395522899_RECONCILIATION.md)
- [Offline signal replay boundaries](SPOT_PAPER_SIGNAL_REPLAY.md)
- [Eight-hour host evidence/export/assessment process](SPOT_PAPER_HOST.md)
- [One-run host egress exception](SPOT_PAPER_HOST_DEPLOYMENT_EXCEPTION.md)
- [Readiness packet and decision gates](PAPER_READINESS_NEXT_PACKET.md)
- [Arena assumptions and diagnostic-only limits](PAPER_ARENA_PROTOCOL_20261016.md)

This proposal is documentation only. It reports no new assessment, replay,
performance, billing, or operational result.
