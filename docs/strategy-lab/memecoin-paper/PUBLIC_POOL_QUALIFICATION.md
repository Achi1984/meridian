# Public CPMM pool qualification receipt

**Disposition: UNKNOWN — no pool qualified.** This is a bounded technical
evidence attempt, not an allowlist change, trading recommendation, or entry
approval. No candidate identity is nominated.

## Attempt

- **Observed:** 2026-11-03 17:39:25 UTC (request start; UTC).
- **Source:** official public Raydium API v3 pool-list endpoint,
  `https://api-v3.raydium.io/pools/info/list`.
- **Request:** one unauthenticated `GET` to
  `https://api-v3.raydium.io/pools/info/list?poolType=all&poolSortField=default&sortType=desc&pageSize=100&page=1`.
- **Bounds:** 8-second connect timeout, 25-second total timeout, 1 MiB maximum
  response, no redirects, no retries. This was the sole public request
  (1 of the 20-request ceiling).
- **Result:** DNS resolution failed: `curl: (6) Could not resolve host:
  api-v3.raydium.io`. No HTTP response (`http_status=000`), no response bytes,
  no returned pool identities, and no response evidence hash. No further reads
  were made. In particular, public Solana account data was not requested.

This is an access limitation, not evidence that no eligible pool exists.

## Qualification findings

| Requirement | Result |
|---|---|
| Pool address, base/quote mints, decimals, and owner-qualified identity | **UNKNOWN** — no pool list response |
| Exact pinned CPMM program `CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C` and actual account/decoder binding | **UNKNOWN** — no pool account was read or decoded; generic Raydium “standard” classification would not establish CPMM |
| Original pair creation evidence and pair age of 30 minutes–72 hours | **UNKNOWN** — no source creation record or observation; token age is not a substitute |
| Actual market cap, USD 300,000–20,000,000 (not FDV) | **UNKNOWN** |
| Liquidity at least USD 40,000 | **UNKNOWN** |
| Trailing 1-hour volume at least USD 50,000 | **UNKNOWN** |
| 1-hour price rise below 80% | **UNKNOWN** |

No values, identities, or timestamps have been inferred from unavailable
evidence. The observation time above timestamps only the failed request, not a
pool or market snapshot. There is no candidate validity period or qualification
expiry to assign. Any future assessment must re-fetch and verify all evidence
as of its own UTC observation time; the 30-minute–72-hour pair-age window must
be evaluated then and rechecked before any later use.

## Independent gates still missing

This attempt provides no evidence for LP protection, holder census and pool/burn
exclusions, developer attribution or prior-rug history, bundled-launch supply,
qualified smart wallets, exact price/quote, or source trust/provenance. Each
remains **UNKNOWN** and separate from pool identity or market thresholds.

The checked-in runtime manifest and its empty `allowedMints` and `allowedPools`
were not changed. This receipt does not approve any candidate or runtime action.
