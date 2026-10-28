# Synthetic Paper harness delivery receipt

Implemented the isolated, test-only BigInt accounting model in
`test-support/synthetic-paper/harness.mjs` with 13 Node acceptance tests in
`test/synthetic-paper-harness.test.js`.

## Exact fixture and deterministic example

Fixture arithmetic uses integer USD cents, integer whole shares, and integer
cents-per-share. A fee is an integer USD-cent amount. Multiplication is exact
(`whole shares × cents/share`); the fixture accepts no fractional shares and
performs no rounding. These units and numbers are test data, not operating
defaults. Every instance requires its own `synthetic-test:` identity, injected
clock, and finite cash, price, fee, quantity, event, attempt, identity, mark-age,
and projection bounds.

The accounting example starts with **$1,000.00**, buys **2 shares at $100.00**
with one **$1.00** fee, then marks at **$110.00**: cash is **$799.00**, holdings
are **2 shares**, booked fees are **$1.00**, and equity is **$1,019.00**. The fee
is already in cash and is not deducted again from equity. Reusing the fee
identity, altering a committed event digest, or breaking conservation does not
apply a second or partial account effect.

## Focused checks

```sh
node --check test-support/synthetic-paper/harness.mjs
node --test test/synthetic-paper-harness.test.js
```

Result: **13 tests passed, 0 failed**. The TAP run reported `# tests 13`,
`# pass 13`, and `# fail 0`. Representative fixed outputs include
`COMMITTED` for the valid accounting example, exact equity `101900n`,
`LATE_OR_PAST_EVENT` for past/equal/unproven ordering, `MARK_UNAVAILABLE` for
missing/stale valuation, `BOUND_EXCEEDED` at limit+1, and `UNKNOWN` for an
ambiguous commit or lost acknowledgment.

## Limits

This is an ephemeral in-memory fake journal, not a persistence or crash-durability
test. It uses no production/browser/server imports, filesystem, network, provider,
market/account data, strategy, dependency, scheduler, or operating clock.
Synthetic accounting transitions and projections remain scoped to
`SYNTHETIC_TEST_ONLY`; they create no forward count or performance evidence.
Production `WARMUP_ONLY` behavior and the 12 real-operation `REQUIRED_UNSET`
choice groups are unchanged. The harness does not implement reconciliation,
source authenticity, strategy qualification, admission, or Paper/Live operation.
