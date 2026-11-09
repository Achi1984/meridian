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
recovery.

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

The strategy identity is deliberately `null` and `UNAPPROVED`. The documented
SMA(5/20) baseline in `SPOT_PAPER_NEXT_EXPERIMENT_PROPOSAL.md` is conditional on
independently validated BTC/USD adapter/profile/ledger integration and is not
an approved frozen strategy. This candidate does not bind it, invent a new
signal, or claim a causal strategy. A future strategy review must freeze the
exact BTC/USD input, closed-bar/warm-up and cutoff rules, decision-to-fill
timing, and identity before use; it must prevent lookahead. Until then, only
explicitly synthetic decisions are accepted by the offline harness.

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
- The feed separately allows at most 256 observations, 512 HTTP requests,
  128 KiB per response, 32 MiB aggregate response bytes, a 5-second request
  timeout, a 10-second quote age, and one sample per minute. Its byte, request,
  time, or event budget may stop the campaign earlier than the journal bound.
  An adapter failure or exhausted budget is terminal; recreating the adapter
  cannot extend a campaign. Stop on any failed admission, append, or handoff.
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
  test/paper-capital-challenge-account-store.test.js
```

These synthetic tests exercise default-disabled start, one-time modeled entry
and exit fees, zero trades, stale and wrong-currency rejection, drawdown latch
and overshoot, paused-entry denial with risk-reducing exit, journal exhaustion,
interrupted-writer UNKNOWN handling, mismatched and correct restart tips,
full-prefix continuation without redecision, and finite acceptance output.
Provider fixtures use injected responses. None of these checks reports
profitability or production readiness.

## Start blockers and checklist

**Do not start or enable this candidate.** Every item below is a blocker; a
synthetic PASS does not satisfy any of them.

- [ ] Obtain technical and independent methodology review before integration.
- [ ] Approve and freeze an exact, causal native BTC/USD strategy identity and
  its bar, warm-up, cutoff, decision, and execution-delay contract. The current
  SMA(5/20) mention is a conditional comparator proposal, not approval.
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
- [ ] Complete explicit owner authorization, host admission, and separate
  operational/cost review before any future start. No such authorization is
  implied here.

Until every blocker is resolved in a separately reviewed change, leave
`enabled: false`, `executionEnabled: false`, and the strategy identity unset.
