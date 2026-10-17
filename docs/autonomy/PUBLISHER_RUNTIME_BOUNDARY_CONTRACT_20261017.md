# Publisher runtime boundary: read-only preparation

Packet PUBLISHER-OWNER-PATH-20261017-01, tracked in issue827.
The owner requested larger agent work packages at 2026-10-17T06:56:38+02:00.
Implementation and an independent design audit run separately; the lead owns
integration. GitHub Claude must review the exact integrated head after green CI.
This document and the path inspector do not authorize or perform recovery.

## What this packet establishes

The inspector derives the owner home from passwd, ignores environment HOME and
walks the absolute path using directory descriptors without following symlinks.
It checks owner/type/mode constraints, the fixed setup directory and the existing
marker, then rechecks that the names still reach the inspected directories.
It does not create or repair directories, change modes, move/delete a marker,
access provider/DB credentials or call setup. Tests use temporary fixtures only.
Read-only identity is evidence, not approval or a guarantee against same-UID
concurrent changes. There is no production caller in this packet.

## Minimal contract for a later recovery wrapper

1. The lead must establish concrete recovery approval through the existing trusted
   owner session or authenticated account evidence. A caller-supplied comment ID,
   copied text or boolean is not authentication. Bind the decision to the action,
   operation, canonical marker identity, reviewed source and exclusive window.
   When GitHub evidence is used, verify author identity and exact approved scope,
   not merely the displayed name. No new approval platform is required.
2. Verify exact source bytes against independently reviewed manifests before
   loading executable helpers. Cover the wrapper, inspection/recovery and
   reconciliation/setup helpers and their approved dependencies/provenance.
   Keep the failed-attempt manifest; hashing current files alone is insufficient.
3. Establish a fresh continuous exclusive window. Use the existing supervised
   provider -> DB -> provider reconciliation, requiring successful bounded status
   delivery and zero exit. Reinspect canonical names and marker before retirement.
   Changed target/source, lost exclusivity or restart invalidates that attempt's
   preparation. The historical Stage1 PASS is not current runtime evidence.
4. Invoke retirement at most once. Treat every propagated exception, signal,
   failed close/fsync or missing final output as requiring reconciliation.
   Explicitly control the future isolated wrapper's umask and verify evidence
   permissions. Do not repair, retry, clean up or switch algorithms on failure.
5. Check canonical/archive reachability before claiming completion. The current
   primitive verifies archive pathname identity before rename, but does not
   recheck that pathname after rename. Descriptor identity alone cannot exclude
   a detached archive. Same-UID exclusivity remains an operational prerequisite.
6. Preserve evidence regardless of outcome. Successful retirement does not
   authorize setup; a subsequent setup attempt needs its own concrete approval.

## Remaining validation boundaries

The inspector's offline tests establish only local path-handling properties.
Later wrapper tests must cover wrong author/action/operation/source/marker,
stale reconciliation, changed sibling sources, loss of exclusivity, failed second
provider observation, absent status/nonzero exit, restrictive umask, detached
archive, interruption and at-most-once retirement with no setup invocation.
No authentication, remote freshness, runtime recovery or autonomous end-to-end
cycle is proven by this packet. Existing setup and recovery guards stay intact.

Audit basis: scripts/publisher_marker_recovery.py, scripts/publisher_test_reconcile.py,
scripts/publisher_test_auto_setup.py, docs/autonomy/PUBLISHER_SETUP_RECOVERY.md,
docs/autonomy/PUBLISHER_AUTO_SETUP.md and the reviewed PR825 preparation document.
