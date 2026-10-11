# Main protection baseline — 2026-10-11

This is an observed configuration snapshot, not an authorization policy. Re-read live GitHub settings before relying on it.

## Observed protection

Ruleset `24878392` (`Meridian main protection`) was activated with explicit owner confirmation and verified through the GitHub UI and authenticated ruleset API at approximately 14:57 Europe/Vienna.

| Setting | Observed value |
| --- | --- |
| Target | `refs/heads/main` only |
| Enforcement | Active |
| Bypass actors | None |
| Pull request required | Yes |
| Required approving reviews | 0 |
| Dismiss stale approvals on new commits | Yes |
| Resolve review conversations before merging | Yes |
| Required status check | `syntax`, GitHub Actions integration `15368` |
| Branch must be up to date | Yes |
| Deletion and force-push restrictions | Enabled |

Evidence: [ruleset](https://github.com/Achi1984/meridian/settings/rules/24878392) and [lead status](https://github.com/Achi1984/meridian/pull/685#issuecomment-6109040285).

## Remaining approval gate

The repository's Copilot approval option is enabled without file-path restrictions. No automatic Copilot review ruleset was shown in its settings. Enabling this option is not proof that a particular review counts toward merge requirements.

The bounded review on PR #653 returned `COMMENTED` with a test-selector finding, not `APPROVED`. The fix was merged separately in #685. The old PR is not an integration candidate.

Required approving reviews remain zero, so GitHub does not yet enforce an independent approving review. The existing independent-agent review requirement still applies. A positive acceptance test must record the current PR head, submitted reviewer identity, native review state, and GitHub's evaluation under the intended approval requirement. A review of an old head, a comment, or a green CI run is insufficient.

This snapshot introduces no workflow, automatic review request, merge authorization, credential storage, publisher activation, spending permission, or trading permission. The event-driven development loop is not yet active.
