# Isolated paper volume rehearsal

Run the real mounted-volume rehearsal from the repository root:

```sh
node --test test/memecoin-paper-volume-rehearsal.test.js
```

The test builds the unchanged helper-only image from
[`Dockerfile.paper-volume-protection`](../../../Dockerfile.paper-volume-protection)
and uses only invocation-owned temporary bind directories. Containers have
network access disabled, a read-only root filesystem, and one writable bind at
`/var/data/meridian-paper`; no privileged flag, host PID namespace, or Docker
socket mount is used. It exercises the real repair, verify, repeated-repair,
wrong-mode rejection, and UID `1000:1000` child-data/fsync paths. The child
directory is checked with the production `verifyOwnedDataRoot` validation.
Sentinel bytes and metadata are compared around the helper invocations.

Subprocesses have time, output, and test-duration bounds. Containers and the
image are labeled with a unique invocation token and cleanup is limited to
resources with that label; temporary host directories are created and removed
by the test. If the Docker CLI or daemon is unavailable, the test is reported as
**skipped with a reason**, not passed. A hosted CI run must execute the test
without a skip to provide rehearsal evidence.

This is an isolated container/bind-mount rehearsal, not a Paper simulation or
an operation on a production host or Northflank volume. It does not establish
platform volume identity, exclusive administration, host or provider
durability, or permission to launch the helper against a live volume.
