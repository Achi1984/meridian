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
ledger text is untrusted and requires human review. The model cannot supply JavaScript.
The helper inserts a fixed `TRUSTED_TEST` template and the publisher requires exact
byte equality. No denylist, regex or JavaScript parsing is used to authorize code.
Changing even a comment rejects publication. CI may subsequently execute this
reviewed template, never arbitrary model-written JavaScript. No runtime or research changes.

## Permission and trust boundaries

The trusted helper is fetched from `GITHUB_SHA` on default main, never from PR code
or the generated artifact. No repository checkout or arbitrary source execution
occurs. Claim and publisher jobs can write contents; only publisher can open a PR.
The separate generator has read-only repository permissions plus Copilot requests.
Its token therefore cannot push, create PRs, dispatch or merge. The process environment
is an allowlist: PATH, isolated COPILOT_HOME, no auto-update, telemetry opt-out, and
only this job's read-only GITHUB_TOKEN. Parent provider overrides, other credentials,
NODE_OPTIONS, BASH_ENV and permissive Copilot settings are not inherited.

CLI 1.0.95 is checked against a **local loopback HTTP stub**, with no credentials
and no actual model. A positive control must expose exactly `view`. The production
non-matching allowlist `--available-tools=meridian_no_tools` must expose no tools.
The stub records actual request tool names, returns a fixed literal response, and
accepts one bounded request per probe. Failure, extra tools, missing requests,
unexpected output or timeout blocks real generation. Each subprocess is bounded
by 20 seconds and the remaining pilot window. Pins are reread after this check.
MCP, custom instructions and remote sessions are off; denials remain defense in depth.
The sentinel is observed behavior of the pinned CLI, not a documented special value.
The runtime wire check is mandatory and cannot be replaced by a flag-string test.
This does not prove the GitHub-hosted model transport or future CLI versions; the
real end-to-end path remains an activation gate. One bounded real invocation emits
ledger JSON only; the test file is generated deterministically by trusted code.

Before inference, an atomic create of the fixed branch
`pilot/version-history-ledger-20261010` claims the packet. A same-tree marker commit
binds control run, source run/attempt/head, main base and milestones. Existing claims,
lost responses and other unknown outcomes stop with no retry. The branch is retained
even after failure; neither history deletion nor a new run resets it. Administrative
deletion remains outside this guarantee. Do not delete/recreate claims.

The publisher checks the artifact ID from this run's producer output, artifact
name/run/head/digest/size, a single non-symlink ZIP member, strict JSON keys, packet
identity and exactly two paths. It never extracts archive paths or executes content.
Artifact redirects must use HTTPS on port 443 under `.blob.core.windows.net` or
`.githubusercontent.com`. GitHub credentials are not forwarded to that storage URL. Trusted
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
output is not a merge decision; its fixed trusted test and untrusted ledger still
require maintainer review and CI approval. `GITHUB_TOKEN` PR CI may require maintainer approval.
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



## R2 local evidence (2026-10-10, after expiry)

This is inactive source hardening under the owner's 19:47:44 continuation request.
The production expiry and source pins above are unchanged. No real model request,
GitHub workflow dispatch, claim, output PR, merge or reactivation was performed.

Installed official npm `@github/copilot@1.0.95` with lifecycle scripts disabled;
`--no-auto-update --version` reported `GitHub Copilot CLI 1.0.95.`. The package
integrity was `sha512-TAYlgMwjTnHi04ZGRc6Z+41piGeUC6xuA8z7gWVc5qOTqJLi/B3vCVg9ttkwvxnahbTWjX8x0DORwrJMXOQxGg==`.
Token-free loopback probes observed:

| CLI filter | Actual request tools |
| --- | --- |
| `--available-tools=view` | `view` (positive control) |
| `--available-tools=view --excluded-tools=view` | `view` (unsafe old combination) |
| bare `--available-tools` | default tools (unsafe empty option) |
| `--available-tools=meridian_no_tools` | empty list |

The production helper's `verify_cli_tools` also passed using that actual binary.
For this local-only probe the in-memory deadline was set to `now + 80s`; the file,
workflow and repository deadline were not changed. This function neither calls
GitHub APIs nor supplies authentication. No paid provider was contacted.
The 11 targeted tests cover exact template admission, obfuscated-code rejection,
credential/environment stripping, failure-before-inference, artifact host limits,
claim races, stale/fork sources, deadlines and process-group termination.

GitHub's current documentation confirms that the available-tools allowlist takes
precedence over excluded-tools; do not restore the old combination:
https://docs.github.com/en/copilot/how-tos/copilot-cli/use-copilot-cli/allowing-tools

NEXT: independent exact-head R2 review and full CI. Then prepare a separately
approved activation window and fresh eligible event. The old completed attempt 2
cannot be replayed; extending a timestamp alone is insufficient. Do not merge this
expired experiment merely because source tests pass.
