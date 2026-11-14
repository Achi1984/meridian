# BTC/EUR paired candidate: bounded offline preflight

`PRE` validation is source/receipt-only. Run it with:

```sh
node scripts/spot-paper-paired-acceptance/preflight.mjs \
  docs/operations/receipts/btc-eur-paired-diag-20261110-001.identity.json \
  ae924141854362257738322ac9a1022cd47e0b02
```

The validator proves only that the three account identities are deterministic,
unique, and bound to the candidate run ID. This is a source-bound identity
check, not proof that a host is globally unused. That latter fact requires an
independent host-side check.

Likewise, a local `sha256:<image-id>` is not a registry digest. The validator
accepts only a repository-qualified `repository@sha256:<digest>` value. A null
digest therefore remains a deterministic `BLOCKED` result with blocker
`registry-digest`; no local artifact can clear that gate. The validator never
contacts a provider or registry and never changes feed, launch, or activation
state. Activation is always reported false.

## Evidence extension (source-only, fail-closed)

The digest syntax check is not publication evidence. Before a future launch,
the receipt must carry an `externalEvidence` object containing two independent
records. These are inputs to the offline validator, not facts established by
it:

```json
{
  "externalEvidence": {
    "registryDigest": {
      "repositoryDigest": "registry.example/meridian/pair@sha256:<64 lowercase hex>",
      "evidenceRef": "<immutable attestation/receipt reference>",
      "verifier": "<independent verifier>",
      "observedAt": "<RFC3339 timestamp>"
    },
    "hostGlobalExclusivity": {
      "scope": "global",
      "candidateRunId": "btc-eur-paired-diag-20261110-001",
      "result": "CLEAR",
      "evidenceRef": "<host inventory/check receipt reference>",
      "verifier": "<independent verifier>",
      "observedAt": "<RFC3339 timestamp>"
    }
  }
}
```

The registry record must bind the exact accepted `repository@sha256:...`
string; a local image ID, mutable tag, empty reference, or unlinked attestation
does not qualify. The host record must explicitly cover the **global** host
scope and this exact `candidateRunId`; account-ID uniqueness is only a
source-bound identity check and cannot establish global exclusivity. Missing,
malformed, unparseable, mismatched, or non-`CLEAR` evidence leaves the
candidate `BLOCKED`. The validator requires an observation timestamp but does
not independently establish freshness; an approved operator must reject stale
evidence before launch. No digest, host-clearance, or readiness claim may be
written merely because a check was not run. This block does not perform a
registry/host query, push an image, activate a feed, or change a provider.
