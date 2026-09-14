# R42 local integration

Status: implemented locally, not deployed. Production remains R41.

Four independent durable keys: r42_momentum, r42_pairs, r42_squeeze, r42_carry.
The collector runs separately from the existing engine every five minutes, with
single-flight protection. Only public GET market requests are used. Overview and
observer expose summaries, never position quantities. Existing ledgers are untouched.

Momentum and carry have executable bid/ask paper baskets. Both charge conservative
10 bps fees and 5 bps slippage per leg per side, plus signed perpetual funding.
Carry quantities are equal across spot and futures. Funding timestamps are retained
per basket for restart deduplication. Parameters are copied into each new ledger.
Each experiment starts with 10,000 simulated USD and 2,000 gross notional.
Basket loss limit is 100 USD; drawdown limit is 500 USD. These are sampled exit
triggers, not guaranteed maximum losses. Five-minute polling can overshoot stops.
Momentum time exit is seven days; carry time exit is thirty days.
Review pauses after 30 closed momentum baskets or 12 carry baskets. These are
review checkpoints, not statistical proof or promotion thresholds.

Pairs remains WAITING_DATA until an independently tested cointegration pipeline
exists. Squeeze remains WAITING_DATA until a suitable liquidation history/feed and
coverage checks exist. No substitute correlation or fabricated events are supplied.
Momentum uses equal-dollar long/short legs and rejects absolute residual beta above
0.10. This is approximate beta control, not exact market neutrality.

Data limitations:
- Full universe required for new entries; missing assets cannot silently change ranks.
- Daily closes must be contiguous and closed. Funding must cover the requested range.
- Funding histories hitting the 1000-row cap are rejected pending pagination support.
- Missing quotes or funding preserve open baskets as DATA_STALE and freeze the last
  valuation. Exit accounting resumes after complete data returns; this is not a
  simulation of guaranteed exchange-native stops during a data outage.
- Top-of-book prices do not model queue priority or market depth; fill realism needs
  further validation before any promotion discussion.
- Research GET status reads load persisted summaries; they do not run the collector.

Read-only live probe in this workspace: 2/8 assets returned complete request sets
(SOL, XRP); six failed. BTC history was unavailable, so momentum beta was unknown.
Neither returned carry row passed funding-history eligibility. No trades were
started, no production state changed. Data connectivity remains an acceptance gate.

## Collector correction, 2026-09-14

Endpoint-level probe found successful quote requests taking 8.8 and 11.9 seconds;
history requests exceeded a 12-second diagnostic timeout. The existing shared
8-second request timeout was therefore insufficient in this workspace. R42 now
uses its own 25-second timeout without changing the existing engine timeout.
History requests preserve successful siblings via allSettled; only two batch book
requests are made after history collection. Exchange quote timestamps are retained,
including future timestamps, which are rejected. Request and validation failures
are persisted and exposed in the R42 summaries. New entries require a complete,
valid universe; exits retain previously available per-asset data.

Post-fix read-only live probe: 8/8 funding datasets, 16/16 books, zero request errors,
zero data-validation errors. This is one successful end-to-end scan, not proof of
continuous availability. All 210 tests passed. No deployment or paper entries were
performed by this diagnostic probe. Pairs/squeeze remain blocked as described above.

Verification: unit tests cover funding deduplication, fees, equal carry quantities,
realized accounting, loss exits, sealed state, stale data preservation, missing
specialist evidence, history gaps, and isolated persistence under network failure.
