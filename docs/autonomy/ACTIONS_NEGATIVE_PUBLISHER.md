# Actions negative publisher — inactive architecture preparation

Owner approved preparation of decision #571 comment 6160988345 on 2026-10-14
at 06:47:45 Europe/Vienna. This changes the proposed publication architecture,
not any installed workflow, existing actor allowlist or execution authority.

## Concrete implementation in this packet

`event-adapter/review-binding/scripts/actions-publication-protocol.py` builds a
fixed POST request description for `Achi1984/meridian` issue **571**, validates
relationships in proposed publisher receipts and calculates state transitions.
It has no HTTP client, token handling, persistence or executable entrypoint.
It calls the existing negative-envelope validator (including its local Node
validation subprocess). The body is preserved exactly, limited to 8192 UTF-8
bytes in this mode, with complete unexecuted checks and REVISION_REQUIRED only.
All authentication, provenance, authority, durability, dispatch and merge flags
remain false, even for a self-consistent receipt. `bindingAllowed` and
`sendAllowed` are also false. No current receiver consumes these results.

The proposed control workflow path is
`.github/workflows/meridian-negative-publisher.yml`; **that file is not installed**.
The schema accepts only a first-attempt manual dispatch on main. Repository
numeric ID, workflow ID, immutable control SHA, run ID, publisher actor ID and
approval comment ID/digest must be independently pinned. Test IDs are fabricated
fixtures, never proposed production values. The control SHA differs from the
reviewed PR head; publisher-run evidence differs from the CI evidence in the
review envelope. Both are bound rather than conflated.

## Trust boundary for a later integration

1. A trusted launcher authenticates the owner approval and resolves the approved
   request/op, PR/head/base, policy, exact body digest and immutable control source.
   It checks approval freshness/revocation, current head/base and expiry before
   creating a run, then binds the returned run ID exactly once to that approval.
   A run ID cannot be known before dispatch; arbitrary model-supplied pins must
   never fill that gap. Current code checks relationships, not this authentication.
2. The isolated publisher job loads only reviewed control code. It must never
   check out/execute PR code or interpolate payload into shell commands. It has
   no model tools. A future job token would be GitHub's job-scoped credential,
   not the Claude action token. Proposed permissions are issues:write and the
   minimal read permissions required by trusted evidence fetches; none are enabled
   here. GitHub issues:write is repository-wide, so mailbox confinement belongs to
   reviewed publisher code and isolation, not to the token itself.
3. A separately authenticated durable store atomically reserves the operation
   before a send is possible. The key binds repository ID, mailbox, request and op;
   the intent digest additionally binds every pin, policy/scope and body digest.
   Changed run, body or control source under the same request/op conflicts rather
   than acquiring a fresh key. Only the live winner of that atomic claim may send
   once. A reconstructed RESERVED state is never permission to send again.
4. After POST returns a comment ID, the publisher independently reads the comment
   through the GitHub API, checks exact original bytes, numeric actor, repository,
   issue and unchanged timestamps, then records that ID in its authenticated
   ledger. After run completion a separate read-only receiver fetches the exact
   run, original comment and final ledger link. The API records alone cannot prove
   which workflow posted a comment: the Actions bot is shared. A payload's own
   run ID, JSON digest or alleged attestation is not an authenticated ledger.
5. Receiver integration requires a new explicitly selected Actions transport
   contract. Do not feed this actor into the existing Claude-only binder or
   silently expand its allowlist. Publication provenance establishes delivery,
   not that Claude authored the supplied test body or executed any review/check.
   Its only allowed disposition remains NON_GREEN_REVIEW with no action authority.

## At-most-once and recovery

The pure transition helper proposes ABSENT -> RESERVED, then RESERVED ->
CONFIRMED on verified receipt or RESERVED -> AMBIGUOUS on uncertainty. Every
proposal requires external atomic persistence. Two processes can compute the
same proposal: **the helper does not arbitrate concurrent claims**. Existing
RESERVED, CONFIRMED and AMBIGUOUS states never permit a second reservation.

Any timeout, process loss, unexpected HTTP response, failed readback or failed
ledger finalization stops the operation; no automatic HTTP retry, rerun or
new-attempt recovery. A crash before POST may therefore lose a publication.
At-most-once deliberately sacrifices delivery. If persisting AMBIGUOUS fails,
the durable RESERVED record must still block replay. A later investigation may
read evidence but cannot grant resending under the same consumed operation.
POST redirects must be disabled; credentials must never follow another host.

An empty history search, workflow success, concurrency group, local SQLite file
on an ephemeral runner or uploaded artifact is **not** a durable atomic claim.
There is no approved production ledger backend in this packet. Selecting and
authenticating one is an integration prerequisite, not something this module
pretends to implement. The receiver's ledger arguments are explicitly untrusted
claims until that adapter exists. Snapshot timestamps cannot detect every prior
edit or establish workflow origin; no stronger claim is made here.

## Validation and next integration gate

Run `python3 -B -m unittest discover -s docs/autonomy/event-adapter/review-binding/test -p 'test_*.py'`.
Tests cover fixed destination/body, strict pins, boolean IDs, reruns, run versus
PR head substitution, comment edits/target/actor changes, missing or mismatched
ledger links, stable operation keys, terminal-state replay and false authority.
These are protocol tests; no real concurrency, GitHub publication or authentication
test has occurred. Normal prose review and existing envelope/binder behavior are
unchanged. Removing these unused files reverses this preparation only.

Before a live test, provide exact reviewed workflow/adapter source, an authenticated
durable claim backend with concurrency/crash tests, an independently authenticated
receipt chain and owner-approved bounded execution parameters. Do not install a
partial transport or use a model call to discover these capabilities by trial.
This packet itself needs no activation and cannot perform trades or merge work.
