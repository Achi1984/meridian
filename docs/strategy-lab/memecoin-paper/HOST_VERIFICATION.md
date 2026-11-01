# Paper host verification procedure

**Disposition: source-level preparation only.** This procedure is for a later,
separately approved host-verification operation. No host is designated or
verified, no run is authorized, and no eight-hour run may start from this packet.
The run manifest, stop switch, scheduler, provider adapter, and operator command
are not enabled or implemented here.

## Offline harness

The harness exercises the existing `CheckpointStore` and
`PaperCheckpointSession` interfaces with a generated fixture. It does not add a
storage engine, readiness projection, provider access, strategy replay, or PnL
calculation. Importing the module is inert; execution requires this explicit
opt-in:

```sh
SYNTHETIC_TEST_ONLY=SYNTHETIC_TEST_ONLY node scripts/memecoin-paper/host-verification.mjs
node --test test/memecoin-paper-host-verification.test.js
```

The machine-readable result binds hashes of the observed source, config, and run
fixture bytes and keeps generated-fixture checks under `syntheticEvidence`.
`hostEvidence` is a separate, empty `NOT_PROVIDED` section. Every result says
`SYNTHETIC_ONLY`, `runtimeAuthorization: false`,
`hostDurability: NOT_VERIFIED`, and clock provenance `UNVERIFIED`. Hashes and
booleans are not authentication. The fixed fixture clock is test input, not a
trusted host clock.

Child-process termination checks observe the temporary filesystem after a child
exits and exercise the existing pending-publication behavior. They prove neither
power-loss recovery nor hardware, filesystem, volume, `fsync`, cross-host, or
hosted-runner durability. They also do not demonstrate autonomous operation for
eight hours. An ambiguous publication remains `UNKNOWN`; visible candidate bytes
do not establish durable acknowledgment, and uncertain records are not retried
or cleaned up as successful.

## Later manual host verification

This is an evidence-gathering sequence, not an executable launcher. The existing
checkpoint APIs support local store/session operations, explicit command times,
bounded readback, and read-only pending reconciliation. There is no supported
host provisioning, real provider probe, runtime activation, watchdog, stop
command, or operator-report command in this packet. Do not substitute invented
commands for those missing interfaces.

| Step | Prerequisite | Evidence to collect | Passing outcome | Stop condition |
|---|---|---|---|---|
| 1. Designate an eligible host through the owner’s separate process. | Written host identity, responsible operator, exact reviewed source/config/run identities, and explicit run authorization; none are supplied here. | Independently attributable host and owner authorization records, plus exact checkout/head and configuration identities. | These are separately reviewed and bound to the proposed run. | Missing/ambiguous authorization or identity; do not provision or run. |
| 2. Establish host and storage properties without modifying production data. | Host and storage owner approval; a disposable, explicitly owned test directory; supported filesystem/volume documentation. | Host/OS/filesystem/volume identity, mount and failure-domain details, supported file and directory flush semantics, and externally attributable recovery evidence. | Independent evidence supports the required persistence semantics for this exact host and volume. Local process-kill tests alone do not pass this gate. | Any unknown durability property, failed flush, shared/unreviewed volume, or evidence mismatch; retain test artifacts and stop. |
| 3. Establish clock authority. | A designated trusted time source and accepted skew, rollback, and forward-jump policy. | Source identity, synchronization/health evidence, observed offset and uncertainty, and operator-visible failure behavior. | The agreed clock policy is independently verified for this host and run window. The checkpoint’s supplied integer milliseconds do not establish this. | Clock source/policy absent, stale, outside tolerance, or unavailable; no run. |
| 4. Verify the existing store/session on the designated host using synthetic-only inputs. | Steps 1–3 not yet imply execution authority; use a new disposable directory under an explicitly owned path. Review the exact commands and paths before running. | Captured test output; source/config/run hashes; exact ACK sequence/hash/run identity; child exit/reaping records; unresolved pending/corrupt cases; cleanup inventory. | All focused cases pass and test files are removed only from their verified owned directory. Preserve unresolved `UNKNOWN` evidence; never infer power-loss durability. | Any timeout, unreaped child, unexpected file/symlink, hash/sequence/run mismatch, `UNKNOWN`, corruption, or cleanup-boundary failure; stop and preserve evidence. |
| 5. Obtain separate operational and owner decisions. | Verified provider/data capability, run controller and stop/report interfaces, exact bounded run configuration, and independent source/CI/review gates. These are external or not implemented. | Provider-specific supported evidence coverage and limits; cost/capacity approval if applicable; run-window/stop/incident procedures; final exact-head review and explicit owner decision. | All missing prerequisites are supplied and independently reviewed before any run request. | Any missing evidence, unsupported source/API, cost/capacity uncertainty, or absent owner approval; no activation. |

No evidence for a real host, durable volume, trusted clock authority, provider
coverage, capacity, cost, recovery rehearsal, stop controller, or operator report
is present in this repository packet. A full eight-hour operation remains a
separate later decision; there is no signoff here.
