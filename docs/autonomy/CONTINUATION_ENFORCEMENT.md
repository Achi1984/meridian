# Continuation enforcement proposal

Status: **DESIGN ONLY — NOT ADOPTED, NOT ACTIVATED**. This document grants no authority, creates no credential, changes no settings and starts no work. Input is verified main `0e28cd177a3af0423092789647b439f60fed809f` and the complete 75-file [CI inventory](CONTINUATION_CI_INVENTORY.md). Parent review reports main unprotected and zero repository rulesets at its live check; this is a reported observation, not an independently repeated settings audit. Revalidate immediately before any activation. Default outcome until enforcement evidence exists is `SUSPENDED`.

## Threat and capability boundary

An application with repository contents write can write many branches and paths; PR write is not restricted to creating drafts. Repository-scoped installation tokens are not path-scoped or branch-scoped credentials. Omitting administration, workflows, actions write, checks write and statuses write reduces authority but does not establish a complete writer sandbox. A workflow's path filter controls when it runs, not where a token can write. Likewise, an allowlist in a script is cooperative enforcement unless every write crosses a trusted boundary that the writer cannot replace.

Proposed separation: a deterministic trusted controller validates the pinned policy and reserves a finite invocation, an unprivileged generator returns bounded data, an isolated publisher accepts only canonical validated output and may write one named branch and draft PR. The generator gets no publication credential or repository secret. The publisher executes no generated code, candidate tests, candidate workflow, candidate package scripts, or candidate cache restore. A separate unprivileged validation job checks candidate code. No model makes its own merge or budget decision.

The actual installed App capability list, installation repository list, token permission response, bypass list, effective protections and API denial behavior must be recorded before activation. This proposal does not claim an App already exists or is safely confined. App credentials stay outside candidate jobs, logs, artifacts and persistent checkout configuration. Token expiry and revocation bound exposure but do not repair missing branch protection.

## GitHub controls and protected material

GitHub has branch/tag rulesets and a separate push-ruleset feature. A branch ruleset selects refs, not arbitrary file paths. Push rulesets can restrict paths, subject to repository visibility and plan availability; do not assume this personal repository has that feature. CODEOWNERS plus required code-owner review controls merging into a protected branch, not all writes to those paths on feature branches. A branch naming convention is not a permission boundary.

| Surface | Proposed control | Required proof / remaining limitation |
|---|---|---|
| `main` | Required PR and exact-current-head checks from expected trusted sources; required independent review, stale-approval dismissal; prevent deletion/force-push; publisher absent from bypass | Export effective settings and test denied direct write/force update without mutating production. Review/merge authority must remain usable; do not apply blanket update restriction with no valid merger |
| Claim/budget ref, proposed `refs/heads/autonomy-claims` | Separate trusted coordinator identity as sole permitted updater, protected against deletion/force-push; atomic compare-and-swap ledger append | A contents-write publisher could otherwise forge reservations. Need proven separation or a protected external ledger; candidate branch cannot be ledger authority |
| Manifest, controller, workflows and policy on `main` | Protected-main PR/review controls; trusted controller loads exact approved commit and verifies expected hashes | Not a GitHub branch-path ACL. Publisher must not be able to alter trusted control material through another ref or select an unreviewed manifest |
| Candidate branch | Fixed package ID and approved base, canonical patch allowlist, no workflow/controller/policy/claims/manifest changes, no symlinks or executable generated transport; draft-only result | Publisher still has broader API capabilities unless server-side rules/credential broker enforce restrictions; record this residual risk explicitly |
| Status/check evidence | Required check source bound to reviewed App/workflow identity and exact head/base; no publisher status/check write | A check name alone is forgeable by a sufficiently privileged actor; candidate-controlled workflow success alone cannot authorize publication or merge |

Branch creation needs its own tested design. With `Restrict creations`, only bypass actors can create matching refs. An empty bypass list on `autonomy/**` can block the desired new candidate branch entirely. Giving the publisher bypass may also defeat other restrictions in the same ruleset. Do not deploy an all-branches empty-bypass ruleset and assume main and new branches still work. Review separate ref patterns and bypass scopes; test creation, update, deletion and force-update for each identity, plus ordinary reviewed main merge. If GitHub cannot express the needed separation in this repository, use a separately protected controller/ledger and trusted credential broker or keep the mode suspended; do not replace enforcement with prose.

## Cross-lane fencing

One epoch and one atomic owner record must govern every execution-impact lane. Workflow concurrency alone only coordinates participants using that group; it does not fence connectors, manual calls, different workflows, old runs or credentials already issued. An expiring lease is insufficient if stale holders can still write. Every mutation and model invocation must revalidate epoch, active owner, reservation and expiry at the trusted boundary; fail closed on incomplete reads, stale head/base, unknown identity or unknown ledger state.

| Lane | Before automated writing is enabled | Required fence | If it cannot participate |
|---|---|---|---|
| Event workflow | Exact event/run/attempt identity, approved control commit and eligible package | Shared atomic reservation + epoch checked before invocation and each publish operation | Disable event writer; do not fall back to unfenced direct calls |
| Hourly/autopilot | Identify actual schedule owner and every write-capable operation | Same epoch/ledger/controller, not a separate prompt-only lease | Suspend its writing and dispatch privileges, or suspend new event writer |
| Connector/ChatGPT lead | Existing connector may hold broad user authority | All automated mutations routed through same controller; explicit takeover changes epoch and drains old runs | Keep connector read-only during event ownership; if technically unenforceable, require supervised mode and do not claim safe autonomous concurrency |
| Manual/owner | Explicit maintenance takeover with recorded reason | Suspend new claims, cancel/drain active jobs, invalidate/revoke outstanding writer tokens, advance epoch, then perform maintenance | Remain suspended until reconciliation; owner admin power is an explicit trusted override, not a fence proven by software |
| Other existing jobs | Inventory includes telemetry contents writes, review issue writes, coordinator PR writes, status writes and OIDC | Prove disjoint resources and credentials or enroll/suspend conflicting writers; record exception scope | No global single-writer claim until conflicts are resolved |

Suspension must stop new reservations and model starts, prevent publication, and identify/drain already running or queued work. Merely disabling a trigger does not revoke issued credentials. Recovery requires reconciled ledger, branch/PR outcomes and current main; lost or ambiguous response stays consumed/blocked rather than retried blindly. No historical pilot deadline is extended by this document.

## Finite invocation budget

The authoritative execution budget is a **finite invocation ledger**, not a live Copilot credit counter or a workflow run number. Approved manifest fixes package IDs, maximum model invocations, deadline, per-call time/output bounds and allowed retries. Atomically reserve before contacting the model. Reservation binds epoch, package, invocation ordinal, source run ID/attempt, control hash and intended branch. Duplicate delivery, rerun, crash, timeout or ambiguous provider response must not produce another unreserved invocation; pending/unknown attempts consume capacity until manually reconciled, with no automatic refund. Invocation ledger must not be mutable by generator/publisher.

Credits and billing are a separate external accounting observation, potentially delayed. A finite call count does not prove a euro cap because cost per invocation varies. Preserve existing provider spending blocks, record account identity and fresh budget evidence, and suspend if those assumptions change. Do not claim that a displayed zero spend establishes a stop-usage control, or that an inaccessible remaining-credit API proves available budget. Additional API billing is not adopted here.

## Evidence gate for a later activation decision

This document is review material only. A later implementation needs a reviewed threat model and named controller/claim/publisher identities; exported effective protection and bypass settings; exact manifest/controller hashes; ledger storage with atomicity and denied unauthorized updates; cross-lane suspension or fence evidence; complete triggered-workflow secret/cache/OIDC analysis; and isolated negative tests of wrong ref/path, stale epoch, duplicate events, moved head/base, expired deadline and crash after invocation/publication. Test the normal branch-creation and reviewed-merge path as well as denied operations. No live credential or settings mutation is authorized by listing these requirements.

The CI inventory contains direct YAML facts only. Before activation, expand custom helper/script and third-party action analysis, establish actual enabled workflow state, and verify effective token permissions from run evidence. Unknown values remain blockers rather than inferred safe defaults. In particular, a workflow_run control may have secrets/write authority even when the predecessor did not; never execute predecessor code/artifacts in that privileged context.

## Official capability references

Documentation reviewed 2026-10-10. Links explain platform capabilities; they do not attest Meridian settings.

- [Available rules for rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets): branch creation/update restrictions, bypass identities, required reviews and expected status sources.
- [About rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets): branch/tag versus push rulesets and availability.
- [Creating repository rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/creating-rulesets-for-a-repository): push file restrictions are not branch path selectors.
- [Installation access tokens](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app): repository/permission narrowing and token lifetime; no path-scoped token claim.
- [Workflow syntax](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax): permission inheritance and trigger filters.
- [Workflow events](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows): workflow_run privilege and untrusted-code warning.
