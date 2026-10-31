# Paper pilot source boundary — implementation prerequisites

Status: **SOURCE_AUDIT_ONLY — NO ADAPTER OR FORWARD ADMISSION**.

Inspected immutable source: `ad276e787078b5afdb2260a5f3e703bd9fd4da28`.
This packet reads code, not a provider or live market. It makes no availability,
authentication, closed-candle, clock, strategy-quality or runtime-readiness claim.
It changes no provider, operating choice, canonical schema or execution flag.

## Concrete decision

Do not connect the current dashboard market feed to simulated order execution.
It cannot supply the accepted Forward Paper event envelope. Adding `open` alone
would not repair the source identity, closure, provenance or causal-time gaps.
Do not fall back to the historical helper: it is backfill, not prospective data.

The smallest next source packet is a **reviewed adapter contract** for one
explicitly selected source/product. It must specify the actual producer evidence
for the existing canonical fields and closure/time obligations below. Only then
should an isolated pure validator and generated-fixture tests implement that
contract; no provider fetch or runtime wiring is part of that first module.

The canonical Forward Paper contract sections 1 and 10 currently limit the
prequalification implementation exception to the isolated synthetic accounting
harness. This packet therefore supplies no speculative validator or new producer
schema. A validator that accepts a caller's `closed: true` or provenance label
would provide false reassurance without a specified evidence boundary.

## Actual producer-to-consumer path

All line references refer to the immutable commit above.

| Path | Observed behavior | Consequence for Paper |
| --- | --- | --- |
| `server-gateway.js:10`, `:528` | Imports `marketKlinesSnapshot`; the protected GET `/api/private/market-klines` passes symbol/interval/limit directly to it and returns the snapshot. | This is the actual dashboard source route; its successful HTTP response is not event admission. No call was made by this audit. |
| `market-feed-gateway.js:35–43` | `normalizeRows` returns only `openTime`, `high`, `low`, `close`, `closeTime`, using `Number` coercion and finite filtering. | No `open`, exact-decimal representation, identity, closure proof or provenance survives. Null/empty numeric coercion is possible; finite is not positive/valid OHLC. |
| `market-feed-gateway.js:44–50` | The OKX mapping skips the array's open field and creates closeTime from start plus interval minus one; reverses rows. | A calculated boundary is not proof a candle closed. No producer closure evidence is retained. This is observed source mapping, not verification of the current provider API. |
| `market-feed-gateway.js:51–56` | The Binance mapping likewise omits open and coerces array values to numbers. | Full OHLC and lossless price strings are unavailable to the downstream consumer. |
| `market-feed-gateway.js:57–76` | Tries OKX then Binance, returns source label, transport, request/cache `fetchedAt`, `ageMs` and optional stale fallback. Cache key is symbol/interval/limit. | Automatic venue substitution and cache freshness are dashboard behavior, not the frozen source/product policy. Request age is not source event time; no run-start barrier or decision/fill causal proof exists. |
| `v9/v9.js:363–389` | Dashboard `marketKlines` consumes the protected route and again maps only HLC and times. It can make direct OKX/Binance fallback requests. | Correcting one server field would still lose it at this consumer. Do not import/self-boot this legacy runtime as a new Paper adapter. |
| `v9/v9.js:390–400` | `marketKlinesHistory` paginates Binance spot history with open/volume, numeric prices, timestamp deduplication, sorting and a local-clock close-time filter. | Historical spot bars are not the gateway's derivatives product. Backfill and local-clock filtering cannot establish prospective event arrival; never promote these bars to forward evidence. |
| `research/paper-edge-v1-data-contract.js:1–31` | Frozen historical universe/period, numeric canonicalization, receipts and cadence/coverage checks. | Useful historical lineage only. Its defaults, hashing and `paginationComplete` assertions neither select a pilot policy nor authenticate prospective events. |

The live-health test `test/runtime-market-feed-core-health.test.js` checks that
health probes use dashboard intervals/limits and expose metadata. It does not
establish a complete-OHLC feed, event closure, provenance or eligible fills.

## Adapter contract requirements using existing canonical fields

These are evidence obligations for `FORWARD_PAPER_V1_CONTRACT_SPEC.md` sections
3–5 and 10, not new operating-choice groups or an alternative wire schema.

| Existing boundary | Required explicit evidence/behavior | Reject or keep unavailable |
| --- | --- | --- |
| Source and product identity | One selected provider, exact source/adapter/schema identity, instrument/product/settlement namespace and frozen configuration binding. Explicit provider response mapping verified before code. | A generic `BTC` or source label, automatic alternate venue/product, or hash alone. |
| Complete candle | Preserve exact positive decimal strings for open/high/low/close and safe integer times; validate high/low consistency, `openTimeMs < closeTimeMs`, interval, scale and frozen bounds. | Missing open; filling open from close; numeric coercion, exponent/NaN/infinity, unsupported scale or out-of-bound input. |
| Closedness | Map an independently defined producer closure assertion or accepted source-time rule to the canonical admission check. Preserve sufficient evidence to reproduce that decision. | A calculated closeTime or caller boolean without supported evidence. Current v1 does not contain a free-standing `closed` field to invent. |
| Separate clocks | Preserve `sourceEventTimeMs` and `localReceivedAtMs` independently. Establish the selected source/local clock mapping or acknowledged source barrier. | Replacing source time with fetch/cache time; merely comparing with `Date.now()`. |
| Identity and provenance | Source event identity is distinct from payload digest. Bind source stream/product/event ID, use/provenance and required provenance reference exactly as canonical v1 specifies. | Missing identities; synthetic/backfill represented as `PROSPECTIVE_SOURCE_EVENT`; a digest treated as authentication. |
| Event ordering and universe | Enforce chosen cadence, duplicate/conflict semantics, fresh closed observations and synchronized universe before any watermark advances. | Sorting or deduplicating away an invalid input; silent gaps, interpolation or partial universe. |
| Observation vs fill | A forward observation must follow its committed run-start fence. An eligible fill event must additionally be strictly later than the exact durable decision acknowledgement, under accepted causal proof. | An observation's close/open reused as a fill simply because it is present in an array. Equality is not future. |
| Failure/fallback | Source changes, stale data, closure/provenance absence and network unavailability remain explicit blocks. Choose any fallback policy as part of frozen source/product configuration. | Reusing dashboard fallback or cached rows as eligible forward events by default. |
| Synthetic use | Generated fixture validation may prove structural rejection/normalization only. Synthetic and historical inputs remain `WARMUP_ONLY` and cannot create forward account effects. | A pure validation PASS interpreted as qualified source, run admission or fill permission. |

Volume, depth and trade data are not newly added v1 candle fields here. A chosen
liquidity policy must separately establish its required inputs and accepted
representation; missing data cannot silently become zero or unlimited liquidity.

## Proposed pure-validator acceptance packet, after contract review

The future module should accept one explicit envelope and fixed, injected
validation policy/evidence results, return a bounded structural result without
network, storage, machine-clock reads, event mutation or strategy computation,
and never return runtime authorization. It must not itself claim to authenticate
opaque evidence. Exact type/shape and evidence-verifier interface await the
adapter contract, so no new exported API is chosen here.

Generated acceptance cases must cover:

1. Complete, correctly scoped candle retained without changing decimal strings
   or either timestamp; report structural validity only.
2. Missing open/high/low/close, nonpositive price, invalid decimal spelling,
   unsafe times and impossible OHLC rejected without substitution.
3. Calculated candle end without closure evidence, future/unclosed event,
   wrong interval and wrong source/product rejected.
4. Missing/unauthenticated provenance and identity rejected; synthetic/backfill
   cannot request forward use. A matching hash cannot override this result.
5. Source-time vs receipt-time inversion and event equality at required fences
   rejected; independently test run-start and decision/fill boundaries.
6. Identical duplicates have no second effect; conflicting identity, unordered
   input, cadence gaps and unsynchronized universe cannot advance state.
7. Exact frozen bounds succeed structurally; one-over rejects atomically with
   canonical reasons, without truncating or silently filtering records.
8. Stale-cache and alternate-source responses cannot inherit eligibility.
9. Any failure leaves original inputs, watermark and account unchanged; no
   interface permits an order, runtime start or promotion.

These are proposed future cases, **not executed tests**. No real provider call,
historical replay, P/L calculation or order was performed for this document.

## Handoff and ownership

One source owner should implement the eventual reviewed adapter/validator and
focused fixtures. Journal/recovery and candidate qualification are separate
owners and prerequisites. Lead integrates only after exact-source validation
and independent review; live availability/identity/clock verification and a
bounded pilot's admission remain separate explicit steps.

Do not patch the existing dashboard gateway merely to make a Paper readiness
label green. No new OKX, Binance or Pionex integration is selected by this packet;
the product decision to display Pionex alone is unchanged.
