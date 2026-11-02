# Bounded paper source pipeline

This is a disabled, read-only acquisition and canonical-evaluation seam. It does
not activate the one-shot manifest, call a provider without injected transport,
hold credentials, create quotes, estimate costs, authorize execution, or modify
the external composition. `createTimeBoundarySource()` and
`createPaperSourcePipeline()` default to disabled.

## Time-boundary acquisition

An enabled time-boundary source requires an explicit inclusive `slotRange`,
injected transport and clock, and bounded limits. It uses the existing
`createBoundedHistoryRpcReader()` request/response path in
`launch-history-source.mjs`, including its fixed Solana RPC origin, redirect
rejection, omitted credentials, streamed response-byte caps, cancellation,
request timeout, and monotonic deadline. The only methods admitted by this
reader are:

1. `getSlot({commitment:"finalized"})`, which must anchor the full configured
   slot range;
2. `getBlocks(startSlot, endSlot, {commitment:"finalized"})`, which enumerates
   produced slots for that exact range; and
3. `getBlockTime(slot)` once for every enumerated produced slot.

`getBlocks` omissions are recorded as skipped-slot ranges. A missing, malformed,
unavailable, or regressing produced-slot timestamp makes the boundary result
`UNKNOWN`; it is never filled by interpolation. The source selects actual
before/after observations for the exclusive start and inclusive end and rejects
a slot range that does not straddle both fences. Four endpoint queries alone
are not treated as global coverage or monotonicity evidence.

Each successful RPC event records its fixed origin, method and parameters,
request/receipt times from the injected clock, consumed response bytes, and the
SHA-256 of the exact response bytes. The time-boundary receipt digest binds
those events, all produced-slot timestamps, skipped ranges, requested fences,
identity, coverage and cumulative counters. The history-window handoff subtracts
those request/byte/work counts and elapsed time before invoking the existing
launch-history collector. Time and slot response timestamps remain provider
claims: `sourceAuthentication` and archival completeness are
`NOT_ESTABLISHED`.

The default per-window caps are 960 requests, 8 MiB cumulative response bytes,
1 MiB per response, 5,000 work units, 15 seconds elapsed, and a 5-second
request timeout. A source may narrow these limits; raising them is bounded by
the current launch-history hard ceilings. The caller must pass the run's
remaining global budget when the module is integrated into a multi-candidate
run; no composition budget or cross-candidate state is changed here.

The collector's read-method addition is intentionally narrow: the bounded
reader admits `getBlocks` and `getBlockTime` for the new boundary source; `getSlot`
was already part of the launch-history collector. No other RPC method, endpoint,
provider, run-manifest entry, credential, or provider activation is added.

## Canonical handoff and trust boundary

`createPaperSourcePipeline()` composes the checked-in
`acquireLaunchHistory()` → `createHistoryWindowSource()` →
`buildAnalystWindowEvidence()` → `evaluateWithCanonicalMarketAdapter()` path,
using the repository's `adaptMarketEvidence()`. It retains the provider
candidate's `sampledAt` as candidate T, captures actual injected-clock assembly
and decision times separately, passes `holdUntil`, and returns the canonical
candidate with Analyst and source audit receipts. It adds no candidate
normalizer, ledger, quote, or execution schema.

Only the synthetic test mode can inject a collector fixture. The external mode
rejects fixture-labelled candidate/evidence and cannot inject a collector
fixture. The checked-in `acquireLaunchHistory()` still reports
`UNKNOWN_ARCHIVAL_OR_INDEX_TRUNCATION`, even after finite signature paging and
successful transaction retrieval; this source refuses to promote that result to
complete coverage. Thus fixture-trusted positive coverage is a test of the
handoff contract, not production readiness. An unavailable quote or any missing
cost remains no-entry.

The existing `EXTERNAL_READ_ONLY_INPUT` composition is unchanged: it continues
to strip caller verification and supply no quotes. This work is not wired into
that composition. Before a future owner-approved integration, the module-owned
path needs an exact reviewed manifest/source-policy binding, an accepted internal
clock policy, and the actual accepted quote and complete cost interfaces. The
source pipeline itself is not that authorization.

## Accepted interface dependency

The concrete history-window bridge interface was reviewed from PR #1182 at
`91072e375259c231a3edac9507a5553408d5dc29`. At this change's frozen head it is
still an open draft and is not on the checked-out `main` baseline. The new
modules use injected collector-shaped contract fixtures and do not import files
from that unmerged branch. The current collector's archival result remains
`UNKNOWN`; integration depends on an accepted bridge/collector revision with
matching raw-response digests and timestamp fields, plus a separately
defensible completeness policy.

## Remaining source and provider policy facts

- `scripts/memecoin-paper/run-manifest.json` remains disabled, with its stop
  switch engaged and empty mint/pool allowlists. No provider was called and no
  credential or paid entitlement was provisioned.
- The manifest's disabled Solana provider list does not include `getBlocks` or
  `getBlockTime`. The code-level allowlist above is limited to this disabled
  module seam; it does not amend or activate the run manifest.
- The checked-in Solana history collector explicitly reports archival/index
  truncation as `UNKNOWN`. RPC pagination exhaustion, empty pages, four time
  witnesses, or complete enumeration within a caller-bounded slot range do not
  establish global address-history completeness or provider authenticity.
- DexScreener's checked-in adapter supports current pair snapshots, not the
  required exact historical USD endpoints. A historical price/feed source,
  timestamp and staleness policy, quote-asset USD conversion, entitlement, and
  any key/paid-access policy remain unselected and unverified.
- The owner census is not a complete, authenticated owner enumeration with
  reviewed pool/burn exclusions. Developer attribution, complete prior-rug
  scope, bundle membership, and a reviewed qualified-wallet source/list remain
  unavailable or unapproved.
- No accepted source-bound quote and complete five-component cost estimate is
  supplied by this pipeline. Missing quote or cost must continue to produce no
  entry.

Focused offline verification:

```sh
node --test test/memecoin-paper-source-pipeline.test.js
node --test test/memecoin-paper-launch-history.test.js
```

Fixtures use RPC-shaped responses only; no endpoint was contacted.
