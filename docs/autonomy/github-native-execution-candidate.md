# GitHub-native task execution candidate

This is an inactive source candidate. It installs no workflow, grants no
permissions, provisions no credential, and does not activate the CLI. Native
assignment still requires an independently verified GitHub user-to-server
token; an Actions or publisher App installation token is not suitable.

## Explicit fencing modes

The dispatcher retains its default `sqlite` mode. It continues to require the
existing durable `SQLiteAttemptJournal` and uses the existing operation-specific
claim ref. Missing or invalid journal state blocks execution; it never selects
the GitHub-ref mode as a fallback.

The opt-in `github_ref` mode is selected explicitly by the caller and rejects
SQLite journal arguments. Its permanent ref key is fixed to repository plus
issue number, independent of issue-body digest, authorization expiry, source
run, or control SHA. The issue-body digest and the existing authoritative run,
actor, workflow, event, main-SHA, issue-state, and expiry checks still validate
the specific approval before and after claiming.

For each invocation the candidate:

1. Validates the user-token capability, approval, event pins, and authoritative
   GitHub run, issue, and `main` state.
2. Sends at most one create-ref request for the fixed task ref. It does not GET
   the claim ref to infer ownership.
3. Proceeds only if that same invocation receives HTTP `201` and validates the
   response's exact ref, object type, and expected SHA. It repeats authoritative
   checks and expiry validation, then sends at most one assignment POST.
4. Stops for an existing-ref conflict (`409`), validation rejection (`422`),
   timeout, unexpected status, malformed response, or any other uncertain
   result. It never retries the assignment POST or deletes/resets a claim.

A lost create-ref response after persistence strands that task: a later
invocation sees a conflict and cannot recover ownership. A timeout before
persistence may allow a later invocation to receive the sole successful `201`.
An uncertain assignment response remains `UNKNOWN`; no retry is attempted.
These choices intentionally trade recovery for the bounded guarantee of at
most one client assignment POST for this repository/issue key.

## Proof boundary and operational prerequisites

The guarantee depends on GitHub create-ref having atomic uniqueness for
concurrent requests to the same ref, and on the ref never being deleted,
rewound, or reset. Those are architectural assumptions for this candidate,
not established here by tests or a live API experiment; integration review must
validate them before any activation. A race test with an in-memory atomic fake
only validates the caller's response-gating logic.

This is not a universal exactly-once, workflow-session, invocation-count, or
assignment-completion guarantee. It limits assignment POST eligibility through
one permanent remote ref, assuming its uniqueness and retention. It does not
prove how often Actions starts jobs or prevent external actors from deleting
the ref. Retain each ref indefinitely; do not add TTL, cleanup, or recovery by
reading the ref. A crash after a valid `201` but before assignment permanently
strands the task.

## Lane migration policy

Do not activate `github_ref` for a task previously consumed by SQLite, and do
not activate SQLite for a task already claimed in the GitHub-ref lane. There is
no automatic migration, cross-lane lookup, reset, or historical-claim
reconciliation. Reviewers must establish that the selected issue has no prior
consumed task/claim before choosing a lane. Do not change lanes to recover a
stranded or uncertain task.

The candidate has no live workflow installation or mutation test. Production
authorization, user-token provisioning, workflow/run integration, API
atomicity and retention validation, and owner activation remain separate gates.
