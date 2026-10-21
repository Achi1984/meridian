# D2 admission candidate — proposal only

`admission-candidate.json` is deterministic, metadata-only planning output. It
binds the existing D1 `manifestDraft` and accepted historical source pins to the
44 existing ordered path identities. It does not read captured data, run a
strategy or screen, freeze the production profile, create a receipt, or authorize
execution. The artifact is intentionally outside runtime admission and discovery
paths.

The recorded D1 verification and its file hashes are consumed as metadata; no
CSV is reopened. Provenance includes the exact metadata-file SHA-256 values,
source commit and source pins, plus the accepted source/profile, D1, and readiness
receipts. PR 919's accepted source snapshot is identified by head
`7990bbf328edd7eb4975d1f389241cbe873aa1a3`; its later scope expansion still
requires fresh independent review. Historical D1 status fields remain as
recorded; later acceptance is identified by the separate receipt references.

Regenerate from the repository root with:

```sh
node scripts/research/b1-7/prepare-d2-candidate.mjs
```

Importing the builder does not generate or write the artifact. The explicit CLI
accepts no arguments, reads only the fixed metadata/source allowlist and writes
only `admission-candidate.json`. Focused tests:

```sh
node --test test/b1-7-d2-candidate.test.js
```

**Unresolved owner gate:** D2 remains `DEFER`, the manifest remains
`NOT_FROZEN`, the genuine owner decision and approval receipt are absent, and
actual execution-context/journal evidence is `NOT_VERIFIED`. The proposed frozen
profile digest is a transient calculation, not a profile change or approval.
Source authenticity remains `NOT_ESTABLISHED`; trial-ledger completeness remains
`UNKNOWN` / `NOT_VERIFIED`; the screen is `NOT_RUN`. No D2, PnL, Paper, Live,
runtime, scheduler, or admission activation is authorized.
