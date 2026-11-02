# Bounded launch-history evidence

This packet adds an injected, read-only Solana history source and a versioned
facts classifier. It is isolated from the provider normalizer, candidate gates,
analyst, ledger, and runtime. Importing it performs no I/O. There is no ambient
`fetch`, caller-selected endpoint, credential, retry, live run, or spending path.
Tests use synthetic RPC-shaped fixtures only.

## Acquisition boundary

`acquireLaunchHistory()` requires a nonempty explicit subject set. Each subject
must carry a valid address, source label, and evidence ID; subjects are not
discovered or expanded by the collector. The caller also supplies inclusive,
nonnegative `startSlot`/`endSlot`, an injected transport and clock, and may
supply an `AbortSignal`.

The only requests are:

| Method | Fixed request |
|---|---|
| `getSignaturesForAddress` | Fixed Solana mainnet RPC origin; `finalized`; caller subject address; fixed bounded `limit`; optional server cursor `before` |
| `getTransaction` | Same fixed origin; only successful signatures within the declared slot interval; `finalized`, `jsonParsed`, and `maxSupportedTransactionVersion: 0` |

The source retains one receipt per declared subject, every signature record,
the exact page boundary/cursor and termination reason, successful transaction
data, and explicit RPC/null/missing/unsupported-version outcomes. Signatures
repeated within a subject stop pagination as `REPEATED_CURSOR`; signatures
repeated across different declared subjects are deduplicated and retain all
subject addresses. The result reports coverage only for those addresses and
that inclusive interval.

Default limits are 10 subjects, 100 signatures per page, 20 pages per subject,
2,000 signatures, 1,000 transactions, 2,100 requests, 1 MiB per response, 10 MiB
per invocation, 5,000 work units, 30 seconds elapsed, and a 5-second request
deadline. Fixed hard ceilings prevent callers from raising the bounds without
limit. Elapsed time uses a monotonic timer; timestamps still come from the
injected clock. Request and response origins are fixed, redirects rejected,
credentials omitted, and response bytes are streamed under both byte limits.
There are no retries. An injected transport is not authenticated merely because
its request object contains the fixed URL.

`coverage.complete` is true only when every declared subject reaches the lower
slot boundary or the RPC history is exhausted, and every successful in-range
signature has a supported, successfully retrieved transaction. A null page,
provider error, truncation, repeated cursor, missing transaction, unsupported
version, or failed transaction retrieval prevents a clean negative conclusion.
Positive transaction facts may still be reported from successfully retrieved
transactions in an otherwise incomplete receipt. A bounded scan is not proof
that an RPC operator has retained or returned globally complete chain history.
Retrieved transaction slots and first signatures are checked against the
requested signature record before a transaction is classified.

## Classifier facts

`classifyLaunchHistory()` accepts only the versioned source receipt and a
specific mint. Its sole supported program is the classic SPL Token Program,
`TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA`; Token-2022 and other token/pool
programs are not interpreted. Parsed instructions are accepted only from that
exact program ID, successful transactions, and the declared slot interval.

The versioned classifier records:

- The address set as `authorityAtInitialization` from a matching
  `initializeMint`/`initializeMint2` instruction. This is the initial mint
  authority in program data, not proof of the transaction's beneficial owner,
  the token's complete developer roster, or the current authority.
- Each matching `mintTo` destination token account and raw base-unit amount.
  When a matching `initializeAccount*` instruction in the same transaction
  states that account's owner, that direct account-owner relation is retained.
  These are observed mint-to facts, not an asserted complete set of initial
  recipients or a normalized supply percentage.
- Positive risk observations with evidence transaction IDs and a versioned
  predicate. `INITIAL_MINT_AUTHORITY_SET` is a fact about the initialization
  instruction; its uncertainty explicitly says it does not establish current
  authority or intent to rug.

Observed direct instruction relations are kept separate from inferred common
control. “Verified” here means the returned parsed instruction directly states
the relation under the pinned program; it does not authenticate the RPC
operator, transaction bytes, or local clock. Common control is always `UNKNOWN`;
no relationship is inferred from co-occurrence, same-slot activity, or pool
creation. Same-slot mint observations are recorded with transaction IDs, but
the bundle metric remains `UNKNOWN` as to Jito bundle membership. Price-drop
data are not an input; the classifier cannot infer rug intent from price
movement.

## Remaining semantic decisions — proposals, not approvals

No result from this packet is mapped to `PASS`, a clean history, a developer
holding percentage, a rug rejection, or the existing bundle hard gate. In
particular, do not integrate these records into #1158 until its supply/context
correction and evidence mapping have been reviewed.

1. **Developer scope proposal:** define the only directly attributable
   launch-role address as the mint's initial authority from the first observed
   classic SPL Token `initializeMint*` transaction. Label it
   “initial mint authority,” not “all developer wallets.” Include no pool
   creator, funder, shared-slot peer, or inferred related wallet. Require a
   second explicitly declared subject request before inspecting that
   authority's history. This narrow choice follows the documented meaning of
   the initialization authority and avoids equating a pool creator with a
   token developer. It remains a proposal and is not sufficient to clear the
   developer gate.
2. **History interval proposal:** for a prior-history review, use
   `[0, capturedFinalizedEndSlot]` for each explicitly documented subject,
   with the end slot captured by the caller before acquisition. This defines
   chain history from genesis through that snapshot rather than silently
   choosing a rolling duration. The existing page/work ceilings still apply;
   any truncation or unavailable transaction leaves the negative result
   `UNKNOWN`. The RPC's `before` cursor is pagination, not evidence that an
   interval was globally complete. An owner must still choose and document
   whether this large interval is appropriate for the intended review.
3. **Rug-predicate proposal:** do not label a mint authority, token transfer,
   same-slot cluster, low price, or price drop a rug. Until an owner approves
   an evidence-backed, versioned predicate and complete subject scope, report
   attributable instruction facts only and leave `priorRugFinding` `UNKNOWN`.
   The positive authority observation in this packet is not a rug finding.
4. **Bundle proposal:** define a bundle as transactions with an independently
   source-verified Jito bundle ID and bundle status binding the exact member
   signatures; use the mint initialization slot as the launch window under
   review. Solana RPC slot equality alone is only a same-slot observation and
   never satisfies that definition. This packet has no Jito source, bundle
   IDs, or verified bundle denominator; the existing bundle metric therefore
   remains `UNKNOWN`.
5. **Recipient proposal:** define initial recipients only after an owner sets
   the included launch interval and source/denominator policy. Until then,
   report successful `mintTo` observations with transaction IDs and keep the
   complete initial-recipient set unavailable.

These are explicit proposals for review; none silently approves a developer
roster, historical window, rug predicate, bundle detector, or hard-gate mapping.

## Official source references

The instruction meanings and source method semantics are grounded in the
following public references (checked 2026-11-02; no RPC endpoint was contacted):

- Solana [Create a Mint](https://solana.com/docs/tokens/basics/create-mint)
  documents mint initialization, decimals, mint authority and optional freeze
  authority. The [SPL Token Program documentation](https://spl.solana.com/token)
  identifies the classic token program and its instruction family.
- Solana [`getSignaturesForAddress`](https://solana.com/docs/rpc/http/getsignaturesforaddress)
  documents address-scoped signature history and `before` pagination.
- Solana [`getTransaction`](https://solana.com/docs/rpc/http/gettransaction)
  documents transaction lookup and `maxSupportedTransactionVersion`.
- Jito [Low Latency Transaction Send](https://docs.jito.wtf/lowlatencytxnsend/)
  documents bundle submission and bundle identifiers. The source implemented
  here does not call Jito and cannot establish membership from a slot alone.

The standard Node test uses only generated fixtures:

```sh
node --test test/memecoin-paper-launch-history.test.js
```
