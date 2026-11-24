# Offline candidate intake and observation plan

`scripts/memecoin-paper/candidate-intake.mjs` accepts only an explicit,
caller-provided JSON file of bounded Dex-shaped pair snapshots. It performs no
discovery and makes no network requests. A snapshot's `originLabel` is a label
supplied by the caller, not authenticated provider provenance:
`CALLER_LABEL_ONLY_NOT_AUTHENTICATED`. Input claims such as `PASS`, `verified`,
and evidence flags are ignored.

The input object has this shape:

```json
{
  "originLabel": "operator-provided fixture",
  "snapshots": [
    {
      "sampledAt": 1793631600000,
      "pair": {
        "chainId": "solana",
        "pairAddress": "CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
        "baseToken": {"address": "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB"},
        "quoteToken": {"address": "DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD"},
        "pairCreatedAt": 1793628000000,
        "marketCap": 1000000,
        "fdv": 8000000,
        "liquidity": {"usd": 50000},
        "volume": {"h1": 60000},
        "txns": {"h1": {"buys": 8, "sells": 3}},
        "priceChange": {"h1": 20}
      }
    }
  ]
}
```

The file is capped at 1 MiB and 300 rows. Rows require valid Solana mint, pool,
and quote identities; an actual finite, nonnegative `marketCap`; and valid pair
and sample timestamps. `fdv` is never substituted for `marketCap`. At planning,
the sample must be no more than five minutes old and not future-dated. The
sample must already satisfy the 30-minute to 72-hour pair-age policy. The entire
requested eight-hour window must also start at least 30 minutes after pair
creation and end no later than 72 hours after pair creation. These are the
existing pair-age and market-cap bounds; freshness is checked again when a plan
is created and says nothing about validity during a later runtime.

An optional explicit identity must provide all three options: `--mint`, `--pool`,
and `--quote`. Without them, the deterministic choice is the newest sampled
record first, followed by lexical pool, quote, and mint order. Duplicate mints
are reduced to one pool; records from different pools are never combined.

## Reproducible local fixture

This creates one temporary snapshot from the checked-in provider fixture, stamps
it with the current time, and requests a start one minute later:

```sh
mkdir -p /tmp/meridian-candidate-intake
node --input-type=module <<'NODE'
import {readFileSync, writeFileSync} from "node:fs";
const now = Date.now();
const pair = JSON.parse(readFileSync(
  "test/fixtures/memecoin-paper-provider-evidence/dex-pair.json", "utf8"
)).pairs[0];
pair.pairCreatedAt = now - 60 * 60 * 1000;
writeFileSync("/tmp/meridian-candidate-intake/input.json", JSON.stringify({
  originLabel: "checked-in fixture; caller supplied",
  snapshots: [{sampledAt: now, pair}]
}));
NODE

node scripts/memecoin-paper/candidate-intake.mjs \
  --input /tmp/meridian-candidate-intake/input.json \
  --output /tmp/meridian-candidate-intake/run-config.json \
  --run-id local-intake-example \
  --start-at "$(node -p 'Date.now() + 60_000')"
```

The CLI prints a JSON summary with `OBSERVATION_PLAN_READY` only when an
observation config is created. It reports the selected identity, exact start/end
window, SHA-256 of canonical config bytes, a bounded list/count of rejection
reasons, caller-only provenance, and `executionAuthorized: false`. Its
`hardGateStatus` remains `UNKNOWN` while required evidence is absent. If no row
is eligible, the status is `OBSERVATION_PLAN_BLOCKED` and no config is written.

The output is exactly the existing `createRunConfig()` canonical JSON, created
with exclusive `0600` permissions. Existing files are not changed. The output
directory must already exist and every directory component must be a real
directory, not a symlink. The CLI only creates a config; it does not start the
pilot, invoke the ledger, make requests, authorize execution, or assert future
runtime validity. A ready observation plan is not a candidate qualification or
a trading claim.

On Linux, staging, publication, and cleanup are anchored to opened directory
handles. If publication succeeds but parent-directory durability cannot be
confirmed, the CLI reports `OBSERVATION_PLAN_PUBLISHED_DURABILITY_UNCERTAIN`
with the verified identity and config hash and exits nonzero. Inspect the
published file before retrying with the same output path. Safe publication
currently requires Linux `/proc/self/fd` directory handles.

## Evidence boundary and remaining real-data gaps

Candidate intake parses snapshots with the existing parser and applies the
existing pair-age and actual-market-cap thresholds. It also calls the existing
`filterCandidate()` with caller-only, explicitly unverified evidence. Supported
pair fields do not authenticate themselves, and missing risk evidence therefore
remains `UNKNOWN`, not `PASS`.

The separate integration proof uses `acquireProviderEvidence()` with an injected
transport for exactly one fixed Dex pair request and three allowlisted Solana
RPC methods. Tests verify normalization and the existing filter; there are no
retries or hidden requests. This test transport is not called by the CLI.

Real evidence is still missing for pool-specific LP burn/lock and duration,
owner-aggregated holder concentration, developer-associated holdings and
attributed rug history, bundled-launch supply, all six analyst score components,
qualified smart-wallet provenance, later quotes/depth, and validated execution
costs. Until supported real evidence is separately obtained and validated, the
hard gates and score remain unavailable; this package makes no qualification,
readiness, execution, or trading claim.

Run the focused intake and injected-provider proof with:

```sh
node --test test/memecoin-paper-candidate-intake.test.js
```
