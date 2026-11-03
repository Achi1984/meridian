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
SHA-256 of the exact response bytes. The canonical `timestampEvidenceDigest()`
binds the time-boundary fields accepted by the history-window bridge. Its event
array contains the `getBlockTime` responses; the `getSlot` and `getBlocks`
responses, full produced-slot enumeration, skipped ranges, and auxiliary request
and byte counts are included in the digest-bound coverage object. Work units
include the full slot-range scan. Before bridge construction, the pipeline
reserves two bounded auxiliary requests and their maximum response bytes from
the configured request/byte budgets, so the accepted bridge's existing
timestamp-event counters plus collector limits remain within the original run
budget. Time and slot response timestamps remain provider claims:
`sourceAuthentication` and archival completeness are `NOT_ESTABLISHED`.

The default per-window caps are 2,100 requests, 10 MiB cumulative response
bytes, 1 MiB per response, 5,000 work units, 15 seconds elapsed, and a 5-second
request timeout; the produced-slot range is capped at 2,500 slots. A source may
narrow these limits; raising them is bounded by the current launch-history hard
ceilings. The caller must pass the run's remaining global budget when the module
is integrated into a multi-candidate run; no composition budget or
cross-candidate state is changed here.

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
and decision times separately after bounded history acquisition, passes
`holdUntil`, and returns the canonical candidate with Analyst and source audit
receipts. Before assembly, a non-authoritative Analyst source-prefetch pass
invokes the actual price and census sources after obtaining history; their
results are cached by exact identity and request window. That pass returns no
Analyst packet and its temporary cutoff is never used for evaluation. The normal
builder then validates the same cached responses against the actual assembly
time, without repeating source reads or changing the candidate cutoff or
causality rules. History, price, census, and audit caches are evaluation-local,
so a callback that completes after its bounded wait cannot write into a later
evaluation. Concurrent evaluations on one pipeline instance are rejected. It
adds no candidate normalizer, ledger, quote, or execution schema.

Only the synthetic test mode can inject a collector fixture. The external mode
rejects fixture-labelled candidate/evidence and cannot inject a collector
fixture. The checked-in `acquireLaunchHistory()` still reports
`UNKNOWN_ARCHIVAL_OR_INDEX_TRUNCATION`, even after finite signature paging and
successful transaction retrieval; this source refuses to promote that result to
complete coverage. Thus fixture-trusted positive coverage is a test of the
handoff contract, not production readiness. An unavailable quote or any missing
cost remains no-entry.

The existing `EXTERNAL_READ_ONLY_INPUT` composition is unchanged: it continues
to normalize caller candidates as unverified, rejects caller adapters and clocks,
and supplies `null` entry and exit quotes. This work is not wired into that
composition. Before a future owner-approved integration, the module-owned
default-disabled path needs an exact reviewed manifest/source-policy binding,
an accepted internal clock policy, and the actual accepted quote and complete
cost interfaces. The source pipeline itself is not that authorization.

## Accepted interface dependency

The accepted history-window bridge from PR #1182 is present at the merged
`main` baseline (`dc04ab0aa800839e0b33120054d424c8bb4211f6`). The pipeline imports
that canonical `createHistoryWindowSource()` and its
`timestampEvidenceDigest()` contract; the timestamp module contains no second
bridge implementation. The current collector's archival result remains
`UNKNOWN`; successful integration through the bridge does not establish a
separately defensible global completeness policy.

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
