# Paper volume protection helper

This source-only helper is a narrowly scoped mount-root permission repair for
`/var/data/meridian-paper`. It is not part of the normal Paper image, does not
import the application, and is disabled unless `--repair` is supplied. Even in
disabled mode the process drops supplementary groups and changes its real and
effective GID/UID to `1000:1000` before it reports its result.

The helper accepts only a mount owned by UID `0`, GID `1000`, with exact mode
`02775`. It opens the fixed directory without following a symlink, verifies the
exact mountpoint in `/proc/self/mountinfo`, and changes only that directory
descriptor to exact mode `03775`. It does not walk the directory, inspect run
files, change ownership, contact providers, or alter platform configuration.
The platform volume identity is independently operator-bound; mountinfo does
not verify that identity. `ALREADY_PROTECTED` is a current-state verification,
not evidence of a prior repair receipt.

The current operational report describes `/var/data/meridian-paper` as
UID `0`:GID `1000`, mode `02775`, with runtime UID `1000` and no application or
legacy acceptance directory. This source change does not perform a live
operation. The helper is deliberately limited to that expected metadata.

## Review and build

Review the source, focused tests, and exact image contents first. Build the
helper-only image from the repository root:

```sh
docker build --file Dockerfile.paper-volume-protection \
  --tag meridian-paper-volume-protection:reviewed .
```

The image contains Node 20 and the helper only. Its default invocation is
disabled; it still drops to UID/GID `1000:1000`, verifies the empty
supplementary-group set (Node may also report the primary GID in its group
list), emits a bounded `DISABLED` result, and exits. The image does not include
or start the Paper application.

## Approved activation

Do not run this against a live host or volume until the owner gives explicit,
scoped approval for this exact root launch. Before approval, the reviewed image
and code must be held for independent GitHub review. The platform administrator
must ensure the mount is stable and exclusively administered for the full
operation. Descriptor-bound mutation does not protect against a concurrent
platform administrator replacing or changing the mount.

Only after that approval, bind the independently verified platform volume at
the fixed target and run the explicit repair command with no network:

```sh
docker run --rm --network=none --user 0:0 \
  --mount type=volume,source=<operator-bound-volume>,target=/var/data/meridian-paper \
  meridian-paper-volume-protection:reviewed --repair
```

The platform volume name is a placeholder that must be resolved and verified
by the operator; it is not derived from mountinfo or accepted as helper input.
The only successful mutation result is `PROTECTION_APPLIED`, emitted after
descriptor and path readback agree on device, inode, owner, group, and exact
mode. `ALREADY_PROTECTED` means only that the exact target currently passes
readback. `BLOCKED` means preconditions failed. A write or readback ambiguity
returns `UNKNOWN`; do not retry automatically or roll back. Preserve all run
artifacts.

## Readback and return to normal image

After an applied result, use the same fixed mount and a separately approved
one-shot invocation to verify it again without permitting mutation:

```sh
docker run --rm --network=none --user 0:0 \
  --mount type=volume,source=<operator-bound-volume>,target=/var/data/meridian-paper \
  meridian-paper-volume-protection:reviewed --verify
```

A successful verify-only result is `ALREADY_PROTECTED` and reports UID `0`,
GID `1000`, and mode `03775` in its bounded volume summary. The helper does not
print filesystem paths or inspect run files. If the result is `UNKNOWN`, stop
and investigate without re-running the mutation.

Once review and operational checks are complete, stop using the temporary
helper image and return deployment to the normal `Dockerfile.paper` image and
its existing entrypoint. Do not use the helper image as an application
replacement. The sticky bit remains on the directory; do not clear it as an
automatic rollback. Any later permission change requires a separate reviewed,
explicitly approved operation.
