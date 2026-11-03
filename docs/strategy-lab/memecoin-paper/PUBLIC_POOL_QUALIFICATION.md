# Public CPMM pool qualification receipt

**Disposition: NOT QUALIFIED.** One actual CPMM pool identity was located and
bound to public on-chain account data, but original pair creation/age and market
gates remain **UNKNOWN**. This is a technical evidence target only, not an
owner-qualified allowlist nomination, trading recommendation, or entry approval.

## Attempt 1 — initial access failure

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

## Attempt 2 — bounded public evidence

### Raydium pool list

- **Observed:** 2026-11-03 18:17:48 UTC (request start).
- **Request:** unauthenticated `GET`
  `https://api-v3.raydium.io/pools/info/list?poolType=all&poolSortField=default&sortType=desc&pageSize=100&page=1`.
- **Bounds/result:** 8-second connect timeout, 25-second total timeout, 1 MiB
  response cap, no redirects/retries; HTTP 200, 209,372 bytes, zero redirects.
  SHA-256:
  `3f3c67ef0a2a6cf36fef92c47a6ad66380486021b62921166fe7df4be5c1f962`.
  The response contained 100 rows and `hasNextPage: true`; this is not an
  exhaustive pool census.
- **Deterministic technical target selection:** among the ten rows whose
  `programId` equalled the pinned CPMM program, inspect the row with a USDC quote,
  provider `openTime` in the requested age interval, and reported `tvl` above
  USD 40,000. This selects the HEDGE/USDC row below for account binding only; it
  does not assert eligibility or nominate it for an allowlist.

| Field | Public-list observation |
|---|---|
| Pool | `ishEsmyWEtrSksuaFP9xC16zy1w3ujV3idWACsNyriC` |
| API classification | `type: Standard`, `pooltype: ["Cpmm"]`; `programId: CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C` |
| Mint A | HEDGE `wDSAqt4tEZpDAwB9XY6ejkZvMFuT1zUMjUh67txeYhf`, classic Token Program, 6 decimals |
| Mint B / quote | USDC `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`, classic Token Program, 6 decimals |
| Provider `openTime` | `1793651039` = 2026-11-02 20:23:59 UTC; 21 h 53 m 49 s before the list request |
| Provider `tvl` | `62558.28`; not independently established as the required liquidity measure |

`openTime` is only the Raydium list field. It is not accepted as original pair
creation evidence, so the pair-age gate remains **UNKNOWN** despite its
in-window proxy value.

### Solana CPMM account binding

Used the existing bounded decoder in
`scripts/memecoin-paper/evidence-sources/raydium-cpmm.mjs`, pinned to
`raydium-cp-swap@3d69122790e97cd6aff24e8ba95940793773f58c` and decoder
`raydium-cpmm-pool-v1`. Both unauthenticated JSON-RPC `POST`s went only to
`https://api.mainnet-beta.solana.com/`, with `credentials: omit`,
`redirect: error`, finalized commitment, and no retry:

| Method | UTC request → response | Slot | Bytes | Response SHA-256 |
|---|---|---:|---:|---|
| `getAccountInfo(pool, {commitment:"finalized", encoding:"base64"})` | 18:19:08.897 → 18:19:09.257 | 464996916 | 1,107 | `a4a55f145b17df56162abfe14eb9104f24ddb9acefb7ec40d5371a98c9d3a7ea` |
| `getMultipleAccounts([pool, vault0, vault1, lpMint], {commitment:"finalized", encoding:"base64", minContextSlot:464996916})` | 18:19:09.261 → 18:19:09.293 | 464996916 | 2,140 | `26cfefa50d0703f5fce684da1adf3cd2a4b37387adc79cdc74d569a3913cce74` |

The decoder matched the pool owner to the pinned program, the 637-byte
`PoolState` layout/discriminator, sorted mints/programs/decimals, canonical
vault and LP-mint PDAs, both vault mint/authority bindings, and the LP mint.
The decoded pool-state SHA-256 is
`9d59a2516291c904904973eadb593dcc5e8d0ea796f079df68c7fe51fc8c8c4f`.
Both reads used the same context slot (zero slot skew). This is
`DECODED_UNVERIFIED`: response hashes bind observed bytes but do not authenticate
the RPC source or clock. Pool creator is not token-developer attribution, and
decoded LP state does not establish LP protection.

### Original pair creation history attempt

The public RPC read-only method `getSignaturesForAddress(pool,
{commitment:"finalized", limit:1000})` returned 1,000 signatures. Ten subsequent
cursor pages used the returned oldest signature as `before`, each with the same
1,000-row cap. Every successful page was full; the oldest returned block time
was still later than the provider `openTime`. The next page returned HTTP 429,
so pagination stopped immediately: no retry, no transaction read, and no
response body/hash for the 429. These results do not identify the creation
transaction or prove complete history.

| Read | Start UTC | HTTP / rows | Oldest returned block time UTC | Response SHA-256 |
|---|---|---|---|---|
| Initial | 18:19:20 | 200 / 1,000 | 2026-11-03 15:59:22 | `65256d37141c63665053067f86a2771039cc2cca1d34bfecb0630221f4c02949` |
| Cursor 1 | 18:19:52.863 | 200 / 1,000 | 2026-11-03 14:56:14 | `173966666f069fc088fda44e53806d8a6a1ca65f7b3fb5fa0acf220373b53724` |
| Cursor 2 | 18:19:53.290 | 200 / 1,000 | 2026-11-03 14:45:20 | `802d78d15f58d548b25b7319145a73ecc7398fb92278dc9f916b04e313fe1f4a` |
| Cursor 3 | 18:19:53.557 | 200 / 1,000 | 2026-11-03 12:21:47 | `260799a63496e96d12ffc4c8ffae13dd5286fa681c0a714f650fb4aa95c69e` |
| Cursor 4 | 18:19:54.771 | 200 / 1,000 | 2026-11-03 07:55:32 | `235edd3ed36cf81b20ee44b9988197cf6cd3ba526040f6f898960059d06d26ec` |
| Cursor 5 | 18:19:55.457 | 200 / 1,000 | 2026-11-03 05:11:25 | `38900cbe612d81965f6168e03daefdbcda07669b9b79d311daa21c3b334247f2` |
| Cursor 6 | 18:19:56.193 | 200 / 1,000 | 2026-11-03 02:54:50 | `53950fc41c9141ce73f64d5841d9f2581f52676f078663f7631c9594f9dc6f4e` |
| Cursor 7 | 18:19:56.805 | 200 / 1,000 | 2026-11-03 01:22:56 | `e6b3444a2d29d58da7c62a0da1e241217ca3713f482fcdbeca1b9ba07beaa737` |
| Cursor 8 | 18:19:57.525 | 200 / 1,000 | 2026-11-03 00:37:29 | `967148b310b556e9ad1012d4091794e52a7b43628e9aa923ed5b23872861e3cd` |
| Cursor 9 | 18:19:58.178 | 200 / 1,000 | 2026-11-03 00:05:13 | `1d0fec2a01fc04fa05c1fe5f159a49f87e4d869eeac69b01c3072145fb153270` |
| Cursor 10 | 18:19:58.800 | 200 / 1,000 | 2026-11-02 23:23:49 | `909747e342bdcc328cd0a886eed9aa8921ff5ed4e0b8b467d3983b952fd2e2a2` |
| Cursor 11 | 18:19:59.400 | **429** | — | No body/hash retained |

The total bounded public-read count is 16 including the first-session DNS-failed
attempt: one Raydium list request, two decoder RPC requests, and twelve
signature-history requests in this session. No reads were made after the 429.

## Qualification findings

| Requirement | Result |
|---|---|
| Pool address, base/quote mints, decimals, and CPMM account binding | **OBSERVED, DECODED_UNVERIFIED** for the pool and identity above; not owner approval |
| Original pair creation evidence; pair age 30 minutes–72 hours | **UNKNOWN** — provider `openTime` is only a proxy; capped history did not reach creation and hit HTTP 429 |
| Actual market cap USD 300,000–20,000,000 (not FDV) | **UNKNOWN** — the list row supplied neither market cap nor FDV |
| Liquidity at least USD 40,000 | **UNKNOWN** — provider `tvl: 62558.28` is not independently established as the required liquidity measure |
| Trailing 1-hour volume at least USD 50,000 | **UNKNOWN** — only a `day.volume` value was returned |
| 1-hour price rise below 80% | **UNKNOWN** — no 1-hour change field was returned |

No unsupported values or timestamps are inferred. There is no qualification
validity period. A future assessment must re-fetch current pool, pair-creation,
account, and market evidence as of its own UTC observation time, verify the
30-minute–72-hour pair-age window, and recheck freshness before any later use.

## Independent gates still missing

This attempt provides no evidence for LP protection, holder census and pool/burn
exclusions, developer attribution or prior-rug history, bundled-launch supply,
qualified smart wallets, exact price/quote, or source trust/provenance. Each
remains **UNKNOWN** and separate from pool identity or market thresholds.

The checked-in runtime manifest and its empty `allowedMints` and `allowedPools`
were not changed. This receipt does not approve any candidate or runtime action.
