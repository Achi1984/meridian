# BTC/USD lives: disabled composition and start readiness

**Status: disabled candidate and synthetic acceptance only.** This package does
not start a host or provider acquisition, configure a deployment, place orders,
authorize spend, or establish strategy, operational, or production readiness.
The host entry point always throws `USD_LIVES_HOST_DISABLED`; both enablement
flags remain false. No numeric “lives” count or loss-reset rule is defined.
“Lives” is only a presentation of the existing USD capital and high-water
drawdown constraints.

## Composition boundary

`scripts/usd-paper-composition/host.mjs` reuses the native BTC/USD observation
shape and `runUsdOfflineStream` contract. For each new observation,
`runSyntheticUsdLivesFeedSample` calls one injected feed interface and supplies
the entire persisted observation prefix plus that single new item. The runner
validates the prefix, does not re-decide committed events, requests a decision
only for the new item, and appends the resulting event through the existing
durable USD account journal and its replayed guard. The supplied
`retainRestartTip` callback must hand off each returned tip; this code cannot
prove that a caller stores it independently or securely. Any feed, decision,
durable-append, or tip-handoff failure stops the caller. An ambiguous commit
remains UNKNOWN and must not be retried or reopened without separately reviewed
recovery. If a tip handoff rejects or has an unknown outcome after a journal
commit, the composition latches that store object as failed. Rewrapping the same
store cannot clear the latch; neither entry point will fetch, decide, append, or
retry tip retention again. The committed event remains in the journal. Recovery
requires a separately reviewed process/store recovery path.

The `runSyntheticUsdLivesFeedSample` and
`runSyntheticUsdLivesObservation` functions are fixture acceptance surfaces,
not ways to enable the host. They reject observations unless their declared
`evidenceKind` is `SYNTHETIC_FIXTURE`. That caller-supplied label does not prove
the source made no network request; the generic wrapper makes no network-count
claim. The acceptance command uses its own fixed local fixture feed, so that
command's zero-request result is bounded to that implementation. The existing
`scripts/usd-paper-feed/kraken-public.mjs` adapter remains separately injectable;
its public Kraken ticker timestamp is local receipt time and its
`OFFLINE_CALLER_ASSERTION` evidence is neither authenticated nor independently
verified.

Within one store session, the wrapper also pins the first feed object and
rejects replacement; it cannot establish that an arbitrary callback reuses
its transport's internal counters.

The disabled lives host's strategy identity remains `null` and `UNAPPROVED`.
The separate candidate composition binds a versioned SMA(5/20) proposal only
for offline evaluation; it does not change host configuration, invent another
signal, or approve the candidate. A future independent review must freeze the
exact BTC/USD input, closed-bar/warm-up and cutoff rules, decision-to-fill
timing, and identity before any operational use. The existing synthetic
acceptance harness remains available, but its callbacks are separate from the
new provider-shaped candidate path.

## Proposed causal candle and strategy composition

The versioned `fetchCausalSample()` API in
`scripts/usd-paper-feed/kraken-public.mjs` performs one bounded sample in this
order: native BTC/USD OHLC response, caller's candle decision, then native
BTC/USD ticker response. It returns separate closed-candle evidence and the
unchanged strict account observation. The candle evidence includes the native
instrument, one-minute timestamps, original decimal OHLC values, OHLC receipt
time, and response SHA-256. Unclosed bars are excluded; future bars, malformed
or non-USD pair keys, and invalid OHLC sequences fail closed. The legacy
`fetchObservation()` contract and request order remain unchanged.

`scripts/usd-paper-composition/sma-candidate.mjs` reuses only
`createStrategyState()` and `advanceStrategy()` from the existing spot-pilot
core. It is an explicit `PROPOSED_UNAPPROVED` BTC/USD candidate, not an
approved strategy and not the EUR feed, parser, ledger, fee schedule, or host.
It freezes a 21-closed-candle initial cutoff with no historical entry, uses
the core's duplicate/conflict/gap/multiple-missed-bar semantics, and records
the candle decision before the ticker request. The subsequent ticker is used
only for account valuation/fill. The candidate requires an explicit USD-cent
entry notional from its caller, bounded by the existing USD 100 maximum and
cash after modeled costs; it has no production sizing default. Exit signals
close the full existing position. No additional stop, spread policy, or forced
trade was introduced.

The composition passes the complete persisted account-observation prefix plus
the new strict ticker observation to the existing USD offline runner, journal,
and guard. Candle/strategy evidence is a separate digest-bound record handed to
the caller's retention callback; it is not added to or represented as part of
the account schema. Callback acceptance does not prove durable, independently
verified retention. The evidence digest binds campaign, currency, candidate
strategy/source versions, cost version, and the explicit USD-cent notional.
Before acquisition the composition validates the store's campaign/currency/
strategy/cost binding and pins the notional for that in-process store session;
a changed value fails before the next feed request. The account journal still
does not retain campaign-wide feed counters or strategy state/evidence. The
separate durable budget below now retains acquisition allowance, but it does
not admit strategy/account restart. Reopened account handles remain blocked
before provider acquisition, including with a verified budget and supplied
strategy evidence. Missing or tampered strategy evidence cannot authorize
resume, and even valid evidence does not remove the existing review gate.
Do not claim candidate restartability or host readiness.

## Durable acquisition budget: resolved implementation scope

`scripts/usd-paper-feed/campaign-budget.mjs` provides the separate
`USD_CAMPAIGN_ACQUISITION_BUDGET_V1` sidecar. It reuses `CheckpointStore`'s
exclusive never-stolen lock, canonical checkpoint, predecessor hash, synced
pending marker, atomic rename, directory fsync, and exact readback. The USD
account schema is unchanged. Storage is bounded to 512 KiB and at most 1,537
records, including creation, sample attempts/completions, reservations and
body outcomes. The checkpoint binds the explicit candidate configuration
(campaign, USD currency, source/strategy/cost versions, notional cents), native
BTC/USD source identity, and all unchanged feed limits.

The optional feed argument is
`campaignBudget: { store, configuration, retainRestartTip }`. `store` must be a
`UsdCampaignBudget`; `configuration` is the explicit
`createUsdSmaCandidateConfiguration(notionalCents)` value. Construction validates
the binding without acquisition. Before each transport, the feed awaits a
durable reservation and the caller's tip-retention callback. Callback failure
latches the budget object, including through a new adapter. The callback must
independently retain every returned tip; this interface cannot prove its
storage is durable, trusted, or separate from the sidecar.

Each externally attempted request permanently charges 128 KiB and one request.
`usedBytes` records raw body chunk bytes actually observed before settlement,
including failed/non-2xx, malformed, truncated and oversized bodies.
`reservedBytes` retains the unused or unknown part of every charged allowance,
**including after successful finalization**; it is not refundable. `chargedBytes`
is requests times 128 KiB and is the admission ceiling, not the small actual
payload total. A chunk crossing the response ceiling is counted in full and
stops the campaign; thus known-used bytes can exceed that request's reservation.
After a crash, unread or unfinalized body bytes are unknown, not zero-consumption
evidence: their entire precharged reservation remains. Timeout/abort freezes the
known byte count; late completion cannot authorize another request, alter the
settled count, refund bytes, or finish a sample. There are no retries.

`createNew` requires a new dedicated directory; it cannot overwrite an existing
campaign sidecar. A fresh adapter using that sidecar cannot renew its allowance.
This assumes the caller preserves the campaign-to-sidecar location and trusted
tip channel; the module cannot detect a caller deleting all state or creating a
different directory. Deployment/path admission remains unimplemented.
`reopenExisting` without an independently supplied exact `expectedTip` is
inspection-only. A verified healthy tip permits budget-only continuation;
it never authorizes candidate/account acquisition. A pending sample or terminal
failure remains inspection-only even with its matching tip. A stale/rollback
tip, changed config/limits, corrupt state, or ambiguous pending publication is
rejected. `inspectUsdCampaignBudget` is read-only and can report UNKNOWN while a
crashed writer's lock remains. No automatic lock stealing, pending reconciliation,
refund, recovery, or reset is provided.

## Preserved account and campaign limits

- Native BTC/USD and USD only; initial virtual capital remains USD 1,000.00.
- The existing USD 100.00 high-water drawdown threshold latches pause. The full
  loss and any overshoot remain visible; no reset, top-up, automatic resume, or
  forced liquidation is introduced. Pausing forbids added exposure; valid
  risk-reducing exits remain subject to the existing account contract.
- Existing modeled assumptions remain `BTC_USD_TAKER20_ADVERSE10_V1`:
  20 bps taker fee and 10 bps adverse slippage per side,
  `ASSUMED_COUNTERFACTUAL`, with venue/account applicability
  `NOT_VERIFIED`. The actual applicable fee tier and schedule remain unknown;
  the synthetic fee count is not actual-fee evidence.
- The existing account journal retains the complete prefix and permits at most
  256 events, 512 KiB canonical checkpoint bytes, and 24 hours from the first
  event. At one observation per minute, 256 events cover only about 4 hours 16
  minutes, not 24-hour readiness.
- The feed adapter instance separately allows at most 256 observations, 512
  HTTP requests, 128 KiB per response, 32 MiB aggregate response bytes, a
  5-second request timeout, a 10-second quote age, and one sample per minute.
  Its byte, request, time, or event budget may stop the campaign earlier than
  the journal bound.
  Legacy mode keeps counters only in the adapter instance and is not
  restart-safe campaign accounting. Explicit durable mode adds the separate
  irreversible reservation ceiling: at most 256 requests / 128 two-request
  sample attempts fit 32 MiB, even with tiny successful responses. Failures,
  unknown outcomes, timing or storage bounds can stop earlier. This is roughly
  2 hours 8 minutes at minute sampling, not 24-hour readiness; neither the
  256-observation ceiling nor the 512-request ceiling is increased.
  Within a process, the composition
  pins one feed object per store session and rejects replacement; the account
  store exposes whether a handle came from `createNew` or `reopenExisting`, so
  feed acquisition is also blocked through reopened handles, even if the journal
  has no events. An adapter failure or exhausted budget is terminal; recreating
  the adapter cannot extend a campaign. Stop on any failed admission, append,
  or handoff.
- The runner/account/store/guard remain the existing USD implementation; this
  composition creates no parallel ledger or guard and does not alter EUR-owned
  reports or files.

## Finite offline acceptance

From the repository root, run:

```sh
node scripts/usd-paper-composition/offline-acceptance.mjs
```

The command uses two generated `SYNTHETIC_FIXTURE` observations, a temporary
account journal, and a fixed synthetic entry/exit callback. It performs no
network requests and removes its temporary files. Its acceptance report is
limited to the following code-path checks; the in-memory tip handoff is not an
independent restart credential:

```json
{
  "schemaVersion": "USD_BTC_LIVES_OFFLINE_ACCEPTANCE_V1",
  "status": "PASS",
  "evidenceKind": "SYNTHETIC_FIXTURE_ONLY",
  "strategyStatus": "UNAPPROVED",
  "hostEnabled": false,
  "executionEnabled": false,
  "networkRequests": 0,
  "observations": 2,
  "completedRoundTrips": 1,
  "modeledFeesCentsCountedOnce": 36,
  "restartTipsRetainedInMemoryForAcceptanceOnly": 2,
  "profitability": "NOT_ASSESSED",
  "productionReadiness": "NOT_ASSESSED"
}
```

Run the focused composition, feed, and durable-account suites:

```sh
node --test test/usd-paper-composition.test.js \
  test/usd-paper-feed-kraken-public.test.js \
  test/usd-paper-campaign-budget.test.js \
  test/usd-paper-causal-candidate.test.js \
  test/paper-capital-challenge-account-store.test.js
```

These synthetic tests exercise default-disabled start, one-time modeled entry
and exit fees, zero trades, stale and wrong-currency rejection, drawdown latch
and overshoot, paused-entry denial with risk-reducing exit, journal exhaustion,
interrupted-writer UNKNOWN handling, mismatched and correct restart tips,
full-prefix continuation without redecision, causal candle timing, 21-bar
warm-up/crossover, missed bars, evidence tamper rejection, and finite
acceptance output. Provider fixtures use injected responses. None of these
checks reports profitability or production readiness.

### Finite durable-budget acceptance

The budget suite above prints this additional bounded fixture summary. It uses
four injected responses across a closed/reopened sidecar, independently supplied
in-memory expected tips, and a fresh adapter. It does not start the host, acquire
provider data, or claim a durable strategy-evidence channel:

```json
{
  "schemaVersion": "USD_CAMPAIGN_BUDGET_OFFLINE_ACCEPTANCE_V1",
  "status": "PASS",
  "evidenceKind": "SYNTHETIC_FIXTURE_ONLY",
  "strategyStatus": "PROPOSED_UNAPPROVED",
  "hostEnabled": false,
  "executionEnabled": false,
  "networkRequests": 0,
  "fixtureRequests": 4,
  "samplesAcrossVerifiedReopen": 2,
  "chargedBytes": 524288,
  "usedBytes": 497,
  "reservedBytes": 523791,
  "refundedBytes": 0,
  "maximumTwoRequestSamples": 128,
  "restartTipsRetainedInMemoryForAcceptanceOnly": true,
  "productionReadiness": "NOT_ASSESSED"
}
```

Additional fault fixtures cover process exit after reservation and during body
read/finalization, pending writes before/after rename, failures at every sample
write boundary, timeout and late completion, cancellation/deadline expiry while
awaiting reservation, overflow, non-2xx/partial bodies, mismatched tips/config,
rollback, concurrent ownership/reservations, and exhaustion across adapter
replacement and reopen. They also verify that a durable budget cannot remove
the reopened-account acquisition block or redecide persisted account events.
The tests replace global fetch with a rejecting sentinel and inject local
responses only. No EUR, active-host, account-schema, capital, drawdown or fee
configuration changes are part of this scope.

## Start blockers and checklist

**Do not start or enable this candidate.** Every item below is a blocker; a
synthetic PASS does not satisfy any of them.

- [ ] Obtain technical and independent methodology review before integration.
- [ ] Independently review and, if appropriate, approve/freeze the proposed
  causal native BTC/USD strategy identity and its bar, warm-up, cutoff,
  decision, and execution-delay contract. The SMA(5/20) candidate remains
  explicitly unapproved.
- [ ] Independently qualify native-USD quote provenance, timestamps, executable
  bid valuation, and source/venue applicability. The present adapter's local
  receipt time and caller assertion are insufficient.
- [ ] Verify the actual venue-, account-, and instrument-specific USD fee tier,
  fee schedule, liquidity, slippage, and other execution assumptions; the
  current modeled cost schedule is unverified.
- [ ] Establish an independently retained trusted restart-tip channel and a
  reviewed operator procedure for full-prefix replay, interrupted/unknown
  writes, and read-only recovery. Do not derive the expected tip from the
  journal being checked.
- [ ] Review a bounded continuation/stop plan that preserves complete history.
  The current 256-event minute-sampling ceiling is about 4 hours 16 minutes;
  there is no 24-hour readiness or reset/adapter-recreation escape.
- [ ] Independently review and admit the implemented durable campaign-wide
  budget, its irreversible reservations, location binding, trusted tip retention,
  crash stop/recovery policy, and finite offline evidence. Implementation and
  fixture acceptance are resolved here; operational admission is not. Legacy
  counters remain instance-scoped. The composition still fail-closes acquisition
  through every reopened account handle; removing that block is a separate
  strategy-evidence/restart admission review gate.
- [ ] Independently qualify and retain the actual closed-candle values and
  strategy evidence, bind the exact strategy/version to those inputs, and
  verify the adapter-to-decision evidence through restart. The staged source
  interface and generated provider-shaped tests do not establish provider
  qualification or durable evidence retention.
- [ ] Complete explicit owner authorization, host admission, and separate
  operational/cost review before any future start. No such authorization is
  implied here.

Until every blocker is resolved in a separately reviewed change, leave
`enabled: false`, `executionEnabled: false`, and the strategy identity unset.
