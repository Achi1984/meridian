# GitHub reference-fence observation — 2026-10-12

Run: [Meridian create-only reference experiment](https://github.com/Achi1984/meridian/actions/runs/38281115194)

## What was observed

GitHub Actions run `38281115194` was a manual dispatch on `main`, attempt 1,
using workflow commit `fc706326c1af1ac63303d273467d2100ec83b3a3`. Its sole
`experiment` job completed successfully. The job logs show the approved probe
identity `meridian20261012race01`, a successful fetch of the probe script pinned
at `d5090798b23e5e19ea984d5391d65152732b2cc6`, and this script output:

```json
{"status":"OBSERVED_PASS","race":["REJECTED_422","CREATED_201"],"restart":"REJECTED_422"}
```

The pinned script submits two concurrent create requests for the same
`refs/heads/meridian-integration-tests/ref-race-meridian20261012race01`, targeting
`078c20f14a44ae21f81ea7eae0aabd06cb038031`. One response was HTTP 201 and was
accepted by the script only after its returned ref and object SHA matched the
request. The other response was HTTP 422, which the script labels
`REJECTED_422`. A separate fresh Python process then made one more create
request and received another HTTP 422. This is observed concurrent-create and
fresh-process behavior in this one run.

## Limits

The logs report the normalized outcomes, not the rejection response bodies or
reasons. In particular, HTTP 422 does not establish that either rejection was
specifically caused by an already-existing reference. The fresh process used
the same job, runner, probe identity, and inherited credential environment; it
was not a runner restart or an independent client. The run did not independently
read or verify the reference afterward.

This single observation does not prove universal linearizability, exactly-once
creation, permanent reference retention, or production readiness. It also does
not prove a complete autonomous development loop: no assignment, code change,
test/review cycle, pull request, or merge was exercised.
