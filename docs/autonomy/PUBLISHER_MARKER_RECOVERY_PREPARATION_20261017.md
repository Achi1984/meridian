# Publisher marker recovery: inactive source preparation

Operation ID: PUBLISHER-RECOVERY-SOURCE-20261017-01.
Original base: `0a32b25c5be4db4d0ae7d3473c664bd7c35e326d`.
Integration base: `ed60066fc58b4d60eddd727c24cae61c368720bb`.
Follow-up operation: PUBLISHER-RECOVERY-SOURCE-20261017-02.
Scope: four additive files, isolated branch, no runtime entry point or caller.
This records publication intent before the source mutation. Main and the
existing setup guard are unchanged. This is not a runtime recovery procedure.

## Problem and proposed primitive

The previous setup failed with `AUTO_SETUP_FAILED_NO_REMOTE_WRITES`. Its fixed
owner-home marker must remain until separately approved recovery. Stage 1's
read-only reconciliation was a point-in-time result, not current runtime proof.
Mailbox 639 comment 6199968669 records the Stage 2 plan and separate gates.

`scripts/publisher_marker_recovery.py` is an inert library with no CLI, network,
credentials, provider/DB calls, scheduler, or setup retry. Only offline tests
call it. It validates a supplied owner-only directory descriptor and the fixed
marker name, exact bytes, regular-file type, owner, mode, link count and saved
identity. It preserves evidence in an exclusive same-filesystem archive and
uses Linux `renameat2(RENAME_NOREPLACE)` to retain the original marker inode.
There is no copy/unlink or ordinary-rename fallback. It synchronizes evidence,
marker and directories and detects several concurrent substitutions.

The three outcomes distinguish no marker move, reconciliation required, and
archived marker with **no setup authorization**. Errors after archive creation
or an attempted archive creation or move remain uncertain. The creation attempt
is recorded before calling mkdir, so interruption after its side effect cannot
claim BLOCKED. Even an archive collision conservatively requires reconciliation.
Partial evidence is retained. No result
authorizes retry or deletion. Interruption requires read-only inspection.

## Deliberate integration limits

An open descriptor and caller-supplied comment IDs are not authentication or
authorization. Evidence explicitly labels references unauthenticated. The two
source SHA-256 fields are intended to bind reviewed source manifests; this
primitive neither assembles nor verifies those manifests. It cannot establish
that an approval covers the current operation or that reconciliation is fresh.

A future separately reviewed wrapper must resolve the canonical passwd owner
home and fixed `.meridian-owner-setup` directory without symlink traversal,
authenticate owner approval and source manifests, establish a fresh exclusive
window and provider/DB reconciliation, and bind all evidence to one operation.
That wrapper is not included. Linux no-replace support is required. Same-UID
concurrent or malicious writers cannot be excluded by descriptor checks; an
exclusive owner window remains a prerequisite. The tests exercise detectable
races; they do not prove race-free behavior under arbitrary same-UID writes.

## Verification and remaining gates

The Python suite uses only temporary directories and synthetic records. It
covers inode/content preservation, restrictive modes, repeat attempts,
archive collisions, symlinks, hardlinks, malformed records, stale identity,
partial/failed writes, every fsync boundary, unsupported/failed atomic rename,
interruption after rename, destination collision and concurrent marker swaps.
The Node bridge includes it in the existing `test/*.test.js` CI suite without
workflow changes. CI's Python version must not be represented as CPython 3.14.2
unless independently observed. The explicit local gate is:

```sh
uv run --python 3.14.2 --no-project python -I -B -m unittest discover -s test -p test_publisher_marker_recovery.py -v
```

Exact-head CI and independent full-scope review are still required. Production
integration, authenticated current evidence and a concrete separate owner
recovery approval remain outstanding. A later single setup attempt requires
another separate approval. No real marker, credentials or DB state were
accessed by these tests. Autonomous end-to-end live development remains
unproven; this packet only prepares one recovery component.
