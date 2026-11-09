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
a changed value fails before the next feed request. The account journal still does not retain campaign-wide
feed request/byte counters or strategy state/evidence. Reopened account handles
therefore remain blocked before provider acquisition, including when strategy
evidence is supplied. Missing or tampered strategy evidence cannot authorize
resume, and even valid evidence does not remove the feed-budget review gate.
Do not claim restartability until candle/strategy evidence and campaign
request/byte budgets survive verified restart.

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
  The adapter keeps request and raw-response byte counters only in that instance;
  those counters are not persisted in the account journal. A newly constructed
  adapter resets its counters. That reset is not renewed campaign allowance:
  no campaign-wide request/byte accounting exists here, so after a process
  restart do not acquire another sample until separately reviewed durable
  campaign-wide accounting is implemented. Within a process, the composition
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
- [ ] Implement and independently review a durable campaign-wide request and
  raw-response-byte budget that survives restart. Current Kraken counters are
  adapter-instance scoped, and current account checkpoints do not retain them;
  the composition fail-closes feed acquisition through any reopened account
  handle until this is resolved.
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
