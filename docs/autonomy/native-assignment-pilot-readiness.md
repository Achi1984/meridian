# Native assignment pilot: local inactive packet

Runtime/dispatcher schema read at fc706326c1af1ac63303d273467d2100ec83b3a3.
The successful reference probe is an observation, not native assignment approval.
No source publication, issue creation, credential operation or live run is included.

Two independent stops remain in the specimen: receiver run_number 0 and
verified_user_token_auth=False. Configuration nulls
and expiry 0 additionally fail validation. No ready status is claimed.

## Exact pins before activation

- Create a fresh issue only after its text is finalized; read back its actual body,
  calculate SHA-256 over its UTF-8 bytes, and verify exact current assignees. Do not
  use issue 721, a consumed issue, or a prior SQLite task. Freeze its body afterward.
- Pin expected_main_sha to the actual post-installation main. Do not prefill it
  from this historical preparation SHA: merging the workflow changes main.
- Pin release_run_id, release_run_attempt and workflow_id from one completed,
  successful authoritative main-push MERIDIAN Release Safety run for that SHA.
  Name/path are fixed in config. Both actor and triggering_actor must equal
  authorization_identity. Event ID fields are only pins; runtime independently
  rereads run/issue/main before and after claiming. No latest-run selection.
- Source Release Safety attempt can be any specifically approved matching attempt;
  receiver workflow attempt is separately fixed to 1. Never confuse those identities.
- Owner sets a concrete short expiry timestamp (UTC Unix seconds) after the pilot
  window is known. Runtime uses real system time. No automatic renewal or replay.
- Bootstrap binding: after final workflow installation and its successful source
  Safety run, publish the completed config on an isolated reviewed commit without
  moving main. Owner-only first manual dispatch supplies that exact approved
  config_commit_sha. It must be lowercase 40-hex; it affects only the fixed config
  JSON path in the fixed repository, never executable source. The workflow also
  requires config.expected_main_sha == GITHUB_SHA before invoking runtime; runtime
  rereads authoritative main. Owner review of the supplied commit is an external
  approval boundary: syntax validity alone is not evidence of approval. Runtime
  and dispatcher remain pinned separately to fc706326c1af1ac63303d273467d2100ec83b3a3.
- Pin one exact receiver run number in place of 0; do not dynamically discover or
  authorize newest runs. Existing workflow history must be reconciled first.

## Credential capability: independent prerequisite

Lead must establish eligible user-to-server credential provenance (PAT/OAuth/App
user token), correct owner, repo scope, expiry and needed endpoint permissions
through the chosen secure credential path. A token prefix, existence of a secret,
or success at GET /user alone does not establish all these properties. Never
set verified_user_token_auth=True merely because a string is present. Actions
GITHUB_TOKEN and publisher App installation tokens are not eligible for native
Copilot assignment. The proposed secret name does not provision or verify it.
The job GITHUB_TOKEN is read-only and used solely for three pinned file GETs;
the separately approved user token must support authoritative reads, claim ref
creation and native issue assignment. Root determines minimum permissions and
verification evidence; no extra access is implicitly authorized by this packet.

## Bounded result and limitations

One manual receiver run; fixed repo and API host; three bounded source GETs plus
the dispatcher's maximum 12 requests. Normal GitHub-ref path makes 8 requests
(6 authoritative GETs, 1 claim POST, 1 assignment POST). No retries or redirects.
Socket timeout 10 seconds; job timeout 3 minutes; response limits inherited from
reviewed runtime; source fetch limited to 64 KiB/file; config limited to 4 KiB.
Keep the issue-specific claim forever, including UNKNOWN and stranded outcomes.
No lane switching/reassignment recovery. ASSIGNED means an API assignment result,
not finished development. Observe resulting draft PR independently; lead owns
tests/review/merge. Main is rechecked but base_branch is not an atomic SHA snapshot.
User-token mutations may trigger other GitHub workflows; unlike GITHUB_TOKEN,
event suppression cannot be assumed. Inspect issue-assignment and claim-ref
side effects plus retention rules before concrete activation approval.

This first pilot deliberately uses manual dispatch with a pinned successful
source run. It does not install event-driven continuation or recurring autonomy.

## Read-only side-effect inspection (fc706326)

Inspected the first 65 lines of all 78 repository workflow files at
fc706326c1af1ac63303d273467d2100ec83b3a3: no `issues` or `create` trigger and no
unfiltered `push` trigger found. The claim branch namespace is outside the
observed main/codex/research branch filters. Two workflow_run listeners target
Release Safety; resulting Copilot PR CI can reach those existing listeners, so
their independent guards must remain in place. This bounded source inspection
does not inspect GitHub App installations, external webhooks or repository rules.
Native assignment intentionally triggers Copilot itself. Do not claim zero side
effects. Reconcile exact current source and relevant run history before activation.

Owner reported secret setup complete at 19:17; this packet has neither read that
secret nor verified its existence, user identity, permissions or eligibility.
Optional next read-only credential check: a separately authorized fixed-host,
bounded GET /user using that secret could confirm the returned account identity,
without logging response/token. It does not alone prove fine-grained repository
scope, expiry, or native-assignment eligibility; retain the external provenance
and permission verification requirement. No credential check is implemented here.

Offline validation: four Node tests exercise input rejection, actual pre-secret
main comparison, capability-false no-transport behavior, executable-config-key
rejection, source pinning and inactive owner gate. No GitHub mutations performed.
