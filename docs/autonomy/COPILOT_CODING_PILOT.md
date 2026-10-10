# One-packet coding pilot — inactive preparation

Owner approval: 2026-10-10 19:34:38 Europe/Vienna, mailbox comment 6100312058.
Hard expiry: **2026-10-10T17:45:00Z (19:45 Vienna)**. Missing that window leaves
this packet inactive. Extending only a timestamp is not renewed authorization.

This is draft preparation awaiting review, not evidence of an operational chain.
PR653's successful CI completion predates this listener. GitHub does not replay
that event when a workflow is added. No synthetic dispatch, rerun, bootstrap,
schedule or deadline extension is authorized to manufacture delivery.

## One fixed independent packet

Only Release Safety workflow 347821227, `.github/workflows/backend-safety.yml`,
successful completed pull-request CI for PR653 at
`2b267ecc0f94565fe005156bf45e8f0ae139eb9b` can pass. Source attempts are compared
to the one authorized source run `38070967939`, attempt `2`; no other attempt or
run is accepted, even at the same head.
Fresh reads verify the open PR, same-repository non-fork head, main base, unchanged
control main with successful push Release Safety and Runtime Smoke checks, and
merged PR646/651 milestone identities. The packet starts from
control main independently of PR653 and may change exactly:

- `docs/v11/VERSION_HISTORY.md`
- `test/v11-version-history-ledger.test.js`

The requested ledger records the merged preview milestones truthfully: Meridian11
remains an isolated preview; the active terminal is Meridian10 r127. Generated
content is untrusted and requires human review. This pilot never executes generated
JavaScript, runs generated tests, activates runtime, or changes research/policy.

## Permission and trust boundaries

The trusted helper is fetched from `GITHUB_SHA` on default main, never from PR code
or the generated artifact. No repository checkout or arbitrary source execution
occurs. Claim and publisher jobs can write contents; only publisher can open a PR.
The separate generator has read-only repository permissions plus Copilot requests.
Its token therefore cannot push, create PRs, dispatch or merge. CLI 1.0.95 uses an
isolated configuration with the pinned-version verified `--available-tools=view`
plus `--excluded-tools=view` combination to remove tools; denials are defense in
depth, not a substitute for exclusion. MCP, custom instructions and remote sessions are off.
One bounded model invocation produces a JSON file map, not executable commands.

Before inference, an atomic create of the fixed branch
`pilot/version-history-ledger-20261010` claims the packet. A same-tree marker commit
binds control run, source run/attempt/head, main base and milestones. Existing claims,
lost responses and other unknown outcomes stop with no retry. The branch is retained
even after failure; neither history deletion nor a new run resets it. Administrative
deletion remains outside this guarantee. Do not delete/recreate claims.

The publisher checks the artifact ID from this run's producer output, artifact
name/run/head/digest/size, a single non-symlink ZIP member, strict JSON keys, packet
identity and exactly two paths. It never extracts archive paths or executes content.
GitHub credentials are not forwarded to the signed artifact-storage URL. Trusted
Git database calls create only fixed regular-file paths. The output commit parents
the claim; a checked non-force fast-forward rejects competing branch writers. PR
creation is once only, Draft only, with no mutation retry on uncertain results.

Deadline checks precede every API operation and model start. Model time is at most
90 seconds and the remaining window; timeout kills its process group. Network
operations can complete near the deadline, but no new mutation starts after expiry.
Expiry is checked before artifact upload, but the Actions upload may finish after
that check; retained transport is not a new model or repository mutation. This is
not hard cancellation of the entire GitHub job at cutoff. Job timeouts add outer
bounds. Account spending blocks stay unchanged; one CLI
invocation is not a guaranteed one provider request. No new secrets or paid API.

## Review and stopping

Require exact source review/CI and owner-scoped activation through Lead before any
merge of this workflow. If the deadline has passed, do not activate it. A Draft
output is not a merge decision; generated tests remain unexecuted until maintainer
review and CI approval. `GITHUB_TOKEN` PR CI may require maintainer approval.
No automatic merge, review bypass, or next-packet selection exists here.

At expiry disable the workflow. Preserve claim/artifact/run evidence and report
received events, gates, claim, generation and Draft outcomes separately. A failed
or partially completed publication consumes the packet; repair requires owner
decision. Offline mocks cannot prove live delivery, quota or model output quality.

Pinned upload action: official v4.6.2 commit
https://github.com/actions/upload-artifact/commit/ea165f8d65b6e75b540449e92b4886f43607fa02

Official references:
- https://docs.github.com/en/copilot/how-tos/copilot-cli/use-copilot-cli-in-actions
- https://docs.github.com/en/actions/concepts/security/github_token
- https://docs.github.com/en/rest/git/refs#create-a-reference
