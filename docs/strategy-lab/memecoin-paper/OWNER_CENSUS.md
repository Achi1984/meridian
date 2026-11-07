# Bounded Paper token-account owner census

This isolated, read-only module builds one fixed `getProgramAccounts` request and
requires an injected transport and clock. Importing it performs no I/O, and it has
no ambient `fetch` or caller-supplied URL, method, or headers, nor any retry,
pagination, runner, host, or trading integration. Its only request target is the
fixed Solana mainnet-beta JSON-RPC origin. Tests use generated account bytes and
an in-memory transport.

## Input and request contract

`acquireOwnerCensus({identity, manifest, transport, clock, signal, mintEvidence,
poolExclusionEvidence})` requires:

- A Solana identity with valid 32-byte base58 `mint`, `pool`, and `quote`.
- `mintEvidence` in the shape returned by the existing offline
  `decodeMintSafetyEvidence()`. The decoded owner program, mint binding, supply,
  slot, and observation time are checked. That decoder labels RPC input as
  `CALLER_INJECTED_RPC_DATA_NOT_AUTHENTICATED`; this adapter does not upgrade
  that provenance.
- An injected `transport(request, {credentials, redirect, signal})` and clock.
- A manifest `bounds` object with exactly these integer limits:

| Bound | Maximum | Meaning |
| --- | ---: | --- |
| `maxRequests` | 1 | Exactly one planned request; retries and pagination are not used |
| `maxResponseBytes` | 8,388,608 | Streamed response bytes, checked before each chunk is retained |
| `maxAccounts` | 20,000 | Maximum accounts in the whole returned array |
| `maxDecodeWork` | 4,000,000 | Cumulative bounded account-key and account-data decode work units |
| `maxElapsedMs` | 30,000 | Request and response acquisition deadline |
| `maxSlotSkew` | 10,000 | Absolute slot difference from the separate mint evidence |
| `maxTimeSkewMs` | 300,000 | Absolute observation-time difference from mint evidence |
| `maxEvidenceAgeMs` | 3,600,000 | Maximum age at completion for mint and census evidence |

The generated request is `POST https://api.mainnet-beta.solana.com`, uses
`credentials: "omit"` and `redirect: "error"`, and contains only
`getProgramAccounts(programId, {commitment:"finalized", encoding:"base64",
withContext:true, filters:[{memcmp:{offset:0, bytes:mint}}]})`. The filter is
mint-only. It deliberately omits `dataSize`, which could silently skip extended
accounts. Response bodies must be streams and are rejected if the full response
exceeds the configured byte bound. Non-2xx responses, including 429, malformed
data, timeout, abort, and budget exhaustion return `UNKNOWN`; there is no retry or
claim of pagination.

Stream consumption also caps total reads at 65,536 and consecutive empty reads
at 256. Empty chunks are not retained, and every 64 reads yields to the timer
queue so immediately ready chunks cannot starve the deadline. Cancellation is
checked before and after each read race. Oversized declared content lengths are
rejected before reading. Rejected bodies are cancelled on a best-effort basis;
cancellation errors are consumed and cancellation promises are never awaited.

## Supported account layouts and aggregation

Only the legacy SPL Token program and Token-2022 are recognized. An account must
be exactly the 165-byte base layout, have matching program ownership, the
requested mint at byte offset 0, a valid initialized/frozen account state, valid
option tags, a valid token-account owner at offset 32, and a little-endian `u64`
amount at offset 64. Token-2022 mint evidence with extensions and account data
longer or shorter than 165 bytes are unsupported and remain `UNKNOWN`; extension
balances and other modified layouts are not inferred.

Amounts are aggregated by the decoded token-account `owner` field with
`BigInt`; the token-account pubkey is not treated as an owner. Duplicate account
pubkeys, malformed program ownership, identity mismatch, and malformed bytes
invalidate the whole response. The aggregate is returned only after the entire
bounded response has been consumed and the sum of all account amounts equals the
separately supplied mint supply.

`accountCoverage: "RECONCILED_RPC_RESPONSE_ONLY"` means only that this complete
response fit the local limits and reconciled to the supplied mint-supply value.
It is **not** authenticated or cryptographically complete census evidence:
`coverage.complete` and `filterEvidence.verified` remain false, status remains
`UNKNOWN`, and no `top10OwnerPct` value is produced. `getProgramAccounts` response
completeness and RPC source behavior are trusted, not proven by this module.
Finalized commitment and matching slots do not authenticate the RPC operator or
make distinct reads atomic.

## Exclusions and authority

No supported reviewed pool/vault exclusion decoder is available in this package.
Caller-supplied `poolExclusionEvidence`, including a claimed `PASS`, `verified`
flag, or address list, is ignored and cannot reduce any owner balance. No owner
concentration PASS is emitted. Burned supply is already reflected in mint supply;
the module does not subtract it again. Developer association is separate and
always `UNKNOWN`; the largest owner is not developer attribution.

Every result preserves the bound identity, available slot/time, fixed source and
request provenance, limits/coverage status, and
`executionAuthorized: false`. This module does not claim endpoint capacity,
availability, production readiness, paid access, or billing behavior. A later
network integration would require separate review; current Paper assembly and
provider allowlists are unchanged.

## Official references

Documentation and layout references reviewed **2026-11-02**:

- Solana RPC [`getProgramAccounts`](https://solana.com/docs/rpc/http/getprogramaccounts)
  documents the program account query, commitment, encoding, filters including
  `memcmp`, and context slot response.
- Classic SPL Token account state is defined by the official
  [`solana-program/token` interface state source at commit
  `737788ff5bcc3f1f44cfb222f25483187650be76`](https://github.com/solana-program/token/blob/737788ff5bcc3f1f44cfb222f25483187650be76/interface/src/state.rs).
- Token-2022 base state and extension framing are defined by the official
  [`token-2022` interface state source at commit
  `986b3aa58cbcc40dea12b369912017a4066804e7`](https://github.com/solana-program/token-2022/blob/986b3aa58cbcc40dea12b369912017a4066804e7/interface/src/state.rs)
  and its [extension module](https://github.com/solana-program/token-2022/blob/986b3aa58cbcc40dea12b369912017a4066804e7/interface/src/extension/mod.rs).
- Supplementary [SPL Token account](https://spl.solana.com/token#token-account)
  and [Token-2022 extension](https://spl.solana.com/token-2022/extensions)
  documentation.

## Reproducible offline example

Run the generated-only example and focused cases:

```sh
node --test test/memecoin-paper-owner-census.test.js
```

The test injects in-memory JSON-RPC responses and a fixed clock; it makes no
network request. It demonstrates that three token accounts can aggregate to two
actual owners, that the owner sums reconcile to mint supply, and that this still
does not pass the existing `filterCandidate` owner gate.
