# Solana memecoin Paper prototype

This is an isolated, default-disabled research prototype. It is not a production
strategy, does not alter canonical Paper admission, and does not promote or
modify any existing strategy. Its deterministic stages are Scout → Filter →
Analyst → Risk authorization → simulated-only Executor → Logger. There are no
LLM agents, model calls, metadata-driven assignments, wallet access, signed
transactions, swaps, paid services, scheduler, or network activity at import or
test time.

The prepared one-shot manifest is
[`run-manifest.json`](../../../scripts/memecoin-paper/run-manifest.json). It is
not executable: `enabled` is false, the stop switch is engaged, start/end times
and run identity are unset, and mint/pool allowlists are empty. This task does
not start the planned eight-hour run. The ledger explicitly refuses restart
recovery; an interrupted run must not be resumed.

## Code and offline replay

- `scripts/memecoin-paper/stages.mjs`: deterministic discovery selection,
  evidence gates, candidate scoring, and bounded audit logging.
- `scripts/memecoin-paper/adapters.mjs`: offline-only parsers and a strict
  read-only RPC method allowlist. Its request interface always fails closed.
- `scripts/memecoin-paper/ledger.mjs`: fixed-point virtual cash/base-unit
  accounting, risk reservations, simulated fills and risk exits.
- `scripts/memecoin-paper/replay.mjs`: one integrated synthetic-fixture replay.
- `scripts/memecoin-paper/synthetic-fixtures.mjs`: unmistakably synthetic
  fixtures; never combine these with real discovery.
- `test/memecoin-paper.test.js`: offline contract and regression coverage.

Run the focused suite with:

```sh
node --test test/memecoin-paper.test.js
```

Print the deterministic, fixture-only replay report with:

```sh
node scripts/memecoin-paper/replay.mjs
```

The replay is plumbing evidence only. A passing synthetic candidate, score, or
fill is not real market evidence, alpha, or an execution-realistic result.

## Hard evidence gates

All required filter evidence must be verified, complete, no more than five
minutes old, no later than its candidate sample, and bound to the exact Solana
chain, selected pool, and quote mint. Each check returns `PASS`, `REJECT`, or
`UNKNOWN` with its reason and evidence source/time/slot/coverage. `UNKNOWN`
blocks entry and is not converted to zero or safety. Pool-specific LP proof must
be a verifiable burn or a lock whose expiry covers the proposed hold. Missing
market cap never falls back to FDV.

The implemented inclusive/strict boundaries are:

| Gate | Accepted boundary |
| --- | --- |
| Pair age (pair creation, not token age) | 30 minutes through 72 hours |
| Actual USD market cap | USD 300,000 through USD 20,000,000 |
| Liquidity | At least USD 40,000 |
| Trailing one-hour USD volume | At least USD 50,000 |
| Owner-aggregated top ten | At most 25% |
| Documented developer-associated holdings | At most 3% |
| Bundled-launch supply | At most 10% |
| One-hour price change | Strictly below +80% |

Mint and freeze authorities must each be revoked. Required extension evidence
must explicitly report no transfer fee, transfer hook, default-frozen state, or
permanent delegate; absent or unsupported extension data blocks. Prior-rug
evidence must be reviewed with complete history coverage and attributable
sources; unknown developer history is not a clean history. Top-ten holder
concentration requires unique-owner aggregation, a nonzero token-supply
denominator, and documented exclusions for the selected pool and burned supply.
Addresses or the RPC top-20 token-account list alone do not satisfy it.

Scout deduplicates by mint and deterministically selects one bound pool/quote
sample. The discovery report always says coverage is non-exhaustive. Profiles
and boosts are only discovery hints, not a new-pair feed or quality evidence.

## Score and entry policy

The proposed versioned weights, windows, units, normalizations, and smart-wallet
qualification requirements are specified in
[`score-spec.md`](score-spec.md). The score is a configurable experiment
parameter, not proven alpha. All six components are required; missing evidence
produces `SCORE_UNAVAILABLE`, with no redistribution or zero substitution.
Only a score of at least 70 after every hard gate passes is eligible for risk
authorization. A real smart-wallet allowlist/provenance is not configured, so
real scoring remains blocked.

Initial virtual capital is USD 1,000 (100,000 integer cents). An entry reserves
no more than the minimum of USD 80, 8% of current marked equity, and available
unreserved cash. Three distinct open/reserved mints is the maximum. No leverage,
shorting, pyramiding, or same-tick re-entry is supported. Reservations and
fills use stable event identities; repeated identities with changed payloads
are rejected. A mint cannot have more than one pending reservation. At fill,
the executor requires fresh complete marks for every open position, reruns the
daily gate and equity sizing, and will not exceed the then-current 8% cap.
Retryable missing marks or quote/cost evidence retain the reservation only
until its five-minute expiry; expiry, Vienna-day rollover, and a daily-loss
trip revoke it.

Token quantities are integer base units with validated decimals (0–18);
monetary totals and P&L use integer cents/BigInt. Rounding is conservative
downward and zero-quantity dust is unfilled. Entry and exit require explicit
nonnegative integer-cent assumptions for fee, spread, slippage, price impact,
and network costs. No defaults imply actual fees or fills. Marked gross/net
proceeds, realized/unrealized P&L, and cash remain separate. The modeled initial
stop is 6% below the modeled entry; a 6% trailing stop arms at +12% and only
moves up with observed high-water prices. A stop is not a guaranteed price:
gap-through exits use the later observed quote, not the stop. Quotes must be
later than the decision sample. Missing executable quotes/costs leave valuation
unavailable or the position unfilled.

The daily loss gate is a fixed USD 30 (3% of initial USD 1,000), measured
against each Europe/Vienna local day's opening marked equity and net costs; the
limit does not scale with gains or losses from prior days. Unknown marks block
entries. When the loss gate trips, the risk stage requests
risk-reducing simulated exits only where a fresh identity-bound hypothetical
executable quote and explicit costs are available; unresolved positions remain
open. This in-memory prototype cannot persist that gate safely across process
restarts; it declares restart unrecoverable and fails closed.
At run end, open positions remain open and are marked only if evidence permits;
no terminal liquidation is fabricated.

## Readiness and remaining blockers

See [`source-capabilities.md`](source-capabilities.md) for what the named public
sources expose and what remains unavailable. In particular, DexScreener pair
snapshots do not supply all authority, LP, unique-owner, dev-history,
bundled-launch, or qualified-wallet evidence. Solana's largest-accounts RPC
returns token accounts, not a full owner distribution. There is no validated
depth/executable quote or cost model. Therefore this code cannot support an
execution-realistic claim or an admissible real-data run today.

Before any later run, the owner must separately approve this exact manifest and
choose a fixed mint/pool allowlist and start/end times. Independent accounting,
security and full-source review must validate all evidence adapters, bounded
budgets, and either a durable atomic journal or a separately approved restart
protocol. No filter should be weakened to force trades; zero accepted coins is
a correct outcome when providers cannot supply the evidence.
