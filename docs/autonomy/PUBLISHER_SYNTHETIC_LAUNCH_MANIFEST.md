# Synthetic TEST launch manifests

This source package connects immutable launch inputs to the existing parent
completion coordinator, supervisor, journal and same-transaction prewrite adapter.
It grants no operational authority and installs no workflow. Fresh direct human
approval remains a separate orchestration prerequisite. A GitHub comment authored
through an agent-capable owner session does not authenticate a human decision.

`publisher_launch_manifest.run_synthetic_attempt` accepts canonical bounded JSON
bytes plus an independently supplied integrity digest. It verifies exact runtime
dependency hashes, actual proposed workflow fixture bytes, baseline/catalog,
repository/environment/target, fixed root/cycle, direction-specific windows and
fixed LOGIN/NOLOGIN effects. The supplied decision must be explicitly synthetic.
All authority, authentication and production-target flags remain false.

The manifest distinguishes proposed workflow SHA256 from the **synthetic**
observed installed commit. It never treats the latter as proof of installation.
The selected release commit is separate from fixed dependency byte hashes;
the reviewed outer caller pins the manifest adapter itself, avoiding a source
hash cycle. No source commit provenance is authenticated here.

The manifest is generated once for each disposable test cycle. Its canonical
bytes are stored exclusively as `manifest.json` in an owner-only container beside
`attempts/`, leaving the existing coordinator's allowed files unchanged. A
container lock remains held across the coordinator call; the protected child
closes the inherited descriptor without unlocking the parent's shared lock.
Both directions require the same stored bytes. Coordinator operation IDs are
derived from manifest digest and direction, never accepted from caller bindings.

Baseline, transcript and decision inputs are copied before source reads. The
synthetic epoch is advanced by elapsed monotonic preparation time and checked
again immediately before the coordinator call. Activation and closure have
separate deadlines; an expired activation window does not invalidate a still-open
closure window. Expired closure requires reconciliation, not automatic extension.
This does not authenticate a wall clock or bound parent filesystem/fsync waits.

The existing disposable PG16 harness includes a ninth scenario for malformed
baseline binding, expired activation, changed stored manifest and permitted
closure after the activation deadline. The other eight scenarios remain. Its
new report fields are `canonicalSyntheticLaunchManifestExercised`,
`manifestDecisionAuthenticated=false`, `workflowInstallationObserved=false` and
`syntheticClockInputs=true`. A successful fixture proves only its stated local
observations. Actual runtime evidence must be recorded separately after execution.

Required unchanged staged workflow source:
`docs/autonomy/event-adapter/review-binding/fixtures/meridian-database-readiness.yml`,
SHA256 `1d934231bb3439c3808f9501c7ee78854f657fe6734ec9ded8f0e14ef09d6968`.
Retain all prior coordinator/prewrite/catalog/SQL/grant dependencies. This packet
does not modify historical helpers or that workflow fixture.

Before actual commissioning, a separately reviewed launcher must bind fresh direct
human approval to the precise effects, source, target and expiry; authenticate
fresh provider/workflow observations; supply trustworthy time, credentials and
an exclusive owner window; and implement the separately approved installation,
one dispatch and closure. Consumed Gate A/setup approvals cannot be reused.
Storage loss/root replacement, hostile same-user changes, privileged database
concurrency, external caller acknowledgement and stalled parent I/O retain the
existing coordinator limitations. No reset, rotation or reconciliation override
is added here.
