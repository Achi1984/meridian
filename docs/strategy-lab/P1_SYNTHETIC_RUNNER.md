# P1 synthetic end-to-end adapter

This package connects the unchanged P1 `evaluateTrendPullback` signal to the
unchanged long-spot lifecycle, exact whole-lot risk sizing, EUR ledger, and local
durable journal. It operates on one explicit offline fixture step per call. It has
no CLI that loads market files, no market-data reader, no historical performance
run, no portfolio engine, no network, and no automatic execution loop. Synthetic
account arithmetic is a correctness check, never evidence of profitability.

Exports in `p1-synthetic-runner.mjs`:

- `createSyntheticP1Account({schemaVersion, synthetic, priceUnit, directory, symbol, cashMicros})`
- `advanceSyntheticP1({schemaVersion, synthetic, priceUnit, directory, symbol, expectedVersion, policy, step})`

Every header requires `schemaVersion: 'MERIDIAN_P1_SYNTHETIC_STEP_V1'`,
`synthetic: true`, `priceUnit: 'EUR_MICROS_PER_SYNTHETIC_LOT'`, an existing absolute
trusted local Linux directory, and a dedicated symbol matching
`SYNTH_[A-Z0-9_]{1,14}`. All object schemas are exact; all inputs must be ordinary
JSON-compatible objects. These labels express a trusted caller's fixture contract;
they cannot prove data authenticity or prevent a dishonest caller relabeling real
data. Actual historical datasets are not imported or read by the adapter/tests.

Cash and all three policy amounts are canonical unsigned decimal strings, at most
30 digits. The tests explicitly initialize `cashMicros: '10000000000'` (EUR10,000),
the authorized virtual research planning basis. Every step supplies all policy
fields: `riskBudgetMicros`, `remainingExposureMicros`,
`stressedExitPriceMicrosPerLot`, `feeBps` (integer 0–10,000). There are no risk,
exposure, fee, quote or account defaults. Cash is bounded by the actual journal
account. Exposure is a caller-supplied remaining budget for this dedicated account;
there is no cross-account or cross-instrument exposure allocator.

A `SIGNAL` step is exactly `{kind:'SIGNAL', bars, asOfMs, receivedAtMs, expiresAtMs}`.
It requires 201 complete contiguous daily bars in P1's unchanged exact OHLCV schema.
OHLC prices are positive safe-integer EUR micros **per one synthetic lot**; volume
retains P1's nonnegative finite-number contract. A lot is an abstract fixed fixture
unit, not an assumed exchange token amount, tick size or minimum order. Both bars
and quotes use the same unit. There is no USD/EUR conversion or claim that these
synthetic EUR bars correspond to authentic historical rates.

P1 receives the persisted position's actual entry timestamp when held. Future bar
receipt, incomplete candles, stale windows and original P1 signal failures reject.
`asOfMs` must not exceed `receivedAtMs`; receipt must also remain before the next
daily boundary after the last close, so a timely evaluation cannot be submitted as
a stale delayed entry. Neither bar availability nor P1
`signalAvailableAtMs` is backdated. The unchanged P1 evidence timestamp is retained
in returned diagnostics; lifecycle execution admission uses the later of that
timestamp and actual `receivedAtMs`. Quotes before or equal to actual signal receipt
cannot fill, even if their later receipt would pass lifecycle event ordering. This
only moves admission forward, never backdates P1 evidence. Receipt must be strictly
later than the last
accepted lifecycle event. Candidate entry stops are rounded down with `Math.floor`
to a positive safe integer (never rounding toward a tighter stop). The explicit
stressed exit must be at or below that rounded stop. The existing sizing checks
again on the eventual BUY; risk includes rounded entry and stressed-exit fees.
A modeled risk budget is not a guarantee against worse-than-stress stop gaps.

Only P1 `ENTER_LONG_CANDIDATE` and `EXIT_LONG` produce events. An accepted signal
uses distinct deterministic IDs `p1e:SYMBOL:DAILY_CLOSE_MS` and
`p1s:SYMBOL:DAILY_CLOSE_MS`. **One signal per daily close** is intentional: changing
asOf, receipt, or revising that window's prices cannot reuse the old signal after
exit/restart. The journal retains the lifecycle's consumed IDs and last-exit
barrier. This conservative fixture adapter cannot issue a second same-day signal,
even if new information would otherwise alter the P1 action. A no-action/hold
result is returned with `changed:false`; it is not journaled, so its evaluation
receipt and bars are not auditable or durable. It still checks the expected journal
version. Future work must define an audit contract before historical research.

A pending entry keeps its original availability, expiry and stop; a new P1 signal
cannot replace it. Depending on P1 action and the existing lifecycle, a new candidate
rejects while busy; no-action merely returns without changing the pending state.
Expired pending entries are processed by the existing lifecycle on a subsequent
accepted event, not by an implicit clock. There is no timer or guaranteed exit
service. Quote age remains the existing 1,000ms maximum.

A `QUOTE` step is exactly
`{kind:'QUOTE', quoteAtMs, receivedAtMs, bid, ask}`. Quotes are positive safe-integer
prices in the declared unit. A deterministic quote event ID is the prefix `p1q:`
plus 60 hex characters of SHA-256 over a fixed-order array of symbol, quote time,
receipt time, bid and ask. It does not include version or risk policy, so retries
with altered versions/policy cannot rebook the same quote. Changed receipt times
still encounter lifecycle quote-time monotonicity. Quotes strictly later than
the lifecycle's admission timestamp (at least actual signal receipt) can BUY at ask; held-position stop/exit quotes SELL every held
lot at bid. No intermediate quotes are generated. An exit ignores zero entry risk
and exposure budgets, retaining fee validation. Quote spread and gap behavior are
explicit fixtures, not calibrated real-market slippage.

Inputs, including version, bars and risk policy, are snapshotted before filesystem
awaits. Read/replay validates the existing journal. Preview composition has no
effect and no authorized fill; commit performs the authoritative expected-version
check under the existing exclusive lock. Accepted events return durable version,
book and the corresponding hypothetical fill/sizing. Rejections preserve journal
bytes and return no fill. There is no retry on conflicts/locks, auto-expiry, lock
stealing or recovery. COMMIT_UNKNOWN returns no fill even if the durable journal
already contains a BUY: inspect/reconcile the saved version/event and retained lock
under the existing manual recovery contract before any further write. Its atomic
publication, Linux/trusted-filesystem assumptions, capacity limits, crash behavior
and lack of authenticated anti-rollback protection are inherited unchanged from
[SPOT_JOURNAL.md](SPOT_JOURNAL.md).

## Verification

`node --test test/p1-synthetic-runner.test.js` checks 13 bounded synthetic cases:
P1 candidate → delayed quote → exact sized EUR BUY; separate-process restart → next
P1 window EXIT → SELL; stop after restart and persistent old-window reentry denial;
equal-time non-fill and pre-/equal-receipt delayed-signal quote blocking; strict units/schema; future/incomplete/stale/backdated data;
stop rounding/stress mismatch; zero-risk entry rejection and unblocked stop;
version/ID replays; caller mutation; no-action byte preservation; post-rename
COMMIT_UNKNOWN with exactly one attempted publication and a retained lock.

Child-process tests assert `child.error === undefined` as well as zero exit status,
so a denied process spawn cannot masquerade as a restart test. They establish
observed local process behavior, not physical power-loss durability or correctness
on arbitrary storage. The adapter does not persist signal windows/provenance,
P1 code identity, policy selection rationale or evaluation trials; these remain
requirements for a separately authorized historical experimental contract. No
Discovery, Validation, Holdout, Paper or Live transition is implemented or granted.
