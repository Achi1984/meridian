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
