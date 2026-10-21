# M11 D2 readiness reconciliation

**Operation:** `MERIDIAN-D2-READINESS-RECONCILIATION-R1`

**Decision:** D2 `DEFER`; selected manifest `NOT_FROZEN`; no D2 receipt, real-data execution, Paper, or Live permission.

## Reconciled evidence

- **R3 source acceptance is complete, execution is not approved.** PR #892 merged at `6f720373af5439af70c54e6cb2f1c17abaf8b877`; mailbox #639 comment [6255139258](https://github.com/Achi1984/meridian/issues/639#issuecomment-6255139258) records successful exact-head CI, independent source acceptance, and closed runtime gates. PR #905's dormant admission/profile source received an independent `GREEN_LIGHT` at [mailbox #639 comment 6275925635](https://github.com/Achi1984/meridian/issues/639#issuecomment-6275925635) and merged with postchecks at `6bcaa74b35a7c093e67f144a03f82a6d77cdf9be`, recorded at [comment 6275930095](https://github.com/Achi1984/meridian/issues/639#issuecomment-6275930095). These receipts accept source, not the proposed historical run.
- **D1 was separately authorized and technically verified.** The bounded D1-only authorization is recorded at [issue #895 comment 6271123620](https://github.com/Achi1984/meridian/issues/895#issuecomment-6271123620); its technical closure is [comment 6272425721](https://github.com/Achi1984/meridian/issues/895#issuecomment-6272425721). D1 did not freeze or admit the manifest and grants no D2 authority.
- `docs/research/d1-20261019/verification.json` records `VERIFIED_DRAFT_NOT_ADMITTED`, `manifestState: NOT_FROZEN`, `validation.ok: true`, `admitted: false`, `strategyExecuted: false`, and `returnsComputed: false`. Its `ciStatus: PENDING` and `independentReview: ... FINAL_CANDIDATE_REVIEW_PENDING` are historical values recorded when that verification file was produced. They must remain unchanged; later D1 acceptance is recorded separately in issue #895.
- The current reconciliation used metadata only. It did not read captured files, calculate selected-series identities or historical path IDs, create an admission artifact, or execute strategy/PnL.
- **Current candidate preparation is proposal-only, although its source is now merged.** Issue #924 / PR #925's deterministic metadata-only candidate artifact, including proposed ordered path identities, merged to main as `984e164ae9da021d3d7fadc578eb0cf0aeaa4413` from reviewed head `c26265fd4554a658f5584b842c79f39ac4c406d8`. Source-only acceptance applies to candidate source commit `fc0fd0db4653630cae6c3f5a73607e02a9c9d24e` ([PR comment 6324017218](https://github.com/Achi1984/meridian/pull/925#issuecomment-6324017218)); the author-reported focused test at that source is documented separately at [PR comment 6324009932](https://github.com/Achi1984/meridian/pull/925#issuecomment-6324009932). Preserve this mapping: `6324017218` relays reviewer901 SOURCE GREEN; `6324009932` is Copilot's 6-pass report. Complete Claude GREEN_LIGHT is [#639 comment 6324706232](https://github.com/Achi1984/meridian/issues/639#issuecomment-6324706232), and the merge/postcheck receipt is [#639 comment 6324734993](https://github.com/Achi1984/meridian/issues/639#issuecomment-6324734993). These accept the metadata-only source, not final admission identities, an admission receipt, or execution.
- **Main checkpoints and current work status:** `2c3e3798b3296406a88988250ff54f272ae4bb91` is the dated #923 checkpoint whose pre-merge CI reported 2698 passed, 0 failed, 0 skipped and whose four postchecks succeeded (Release Safety 39657036131, Runtime Smoke 39657036159, Coordinator 39657036338, Pages 39657032229). It remains the last fully verified main checkpoint. Latest observed main is `6aeb07c35aa1e45dbaf0e78fc97fd7b59170b6f7` after PR #927 source merge; its pre-merge Safety run reported 2704 passed, 0 failed, 0 skipped, but postchecks are pending, so #927 is not yet fully accepted. Its merge/status receipt is [#927 comment 6325242524](https://github.com/Achi1984/meridian/pull/927#issuecomment-6325242524). Issue #922 remains open and the original startup cause is not established. PR #919's continuity correction is pending independent review and fresh exact-head CI. The #905 hash below is its historical merge/source checkpoint, not current main.

## Current identity table

| Identity | Current recorded value | Meaning |
| --- | --- | --- |
| Protocol | `MERIDIAN-B1-7-PROTOCOL-R3-20261018`; SHA-256 `a78e1ae8c71c8f85baee5b51f5691643fc29136f636f19465c61f553afe09185` | Frozen protocol file identity |
| Implementation | `MERIDIAN-B1-7-ENGINE-R3`; accepted source bundle SHA-256 `ab73261f01b27b8655ffea7979fec03eb1a9bea667b6fc4cda8d77b75c4f3e06` | Source acceptance only; not execution approval |
| Inactive profile | `MERIDIAN-B1-7-HISTORICAL-ONE-SHOT-R1`; recorded canonical inactive-profile SHA-256 `160b73ff9c380b1231d0a1e4a88566493408f978857a3b13d71826852a413fc8` | Profile is `NOT_FROZEN`, with null input manifest and D2 receipt. This is not a final activated-profile digest. |
| Source identity | SHA-256 `3e3973847b2b37cffa11b2df1be0b832d3227692857ff4bb2631ca5ff48ad773` | Existing canonical source-hash-map identity |
| D1 manifest draft | Canonical SHA-256 `37fecaa0d003c9ec862fb57b3b312c0289c1dd370607ade99bac584d357f81a9` | Verified metadata identity only; not frozen or admitted |

The source basis is `1c7b6dccd886f57e866c7d359c091b1e72a193ea`. PR #905's historical merge/source checkpoint is `6bcaa74b35a7c093e67f144a03f82a6d77cdf9be`. The dated #923 checkpoint `2c3e3798b3296406a88988250ff54f272ae4bb91` remains the last fully verified main; latest observed main is `6aeb07c35aa1e45dbaf0e78fc97fd7b59170b6f7`, with #927 postchecks pending. Hash identities do not establish source authenticity, which remains `NOT_ESTABLISHED`.

## Remaining conjunctive gates

1. **Proposed admission artifact:** PR #925's metadata-only candidate source is merged, but the artifact is still a proposal, not an admitted artifact or receipt. Independently verify any final artifact's protocol, implementation, input-manifest and input identities, ordered path identities, and profile identity. Generated candidate identities are not final admission identities; final path identities must be bound only after the input identity is finalized.
2. **Separate genuine owner decision:** record an actual decision for the exact proposal: one trial and 44 ordered paths; 30-minute batch, 60-second per-path, and 1 MiB output limits; 15 bp baseline and 30 bp stress, including 30 bp plus one-day delay; the full screen in `EXECUTION_REQUEST.md`; and the research-only no-finite-stop exception. Source acceptance and D1 authorization are not this decision.
3. **Execution-context and journal verification:** verify the actual supervised execution context and journal status before any later execution proposal. This status is not verified here.

Until these gates are met, `DATA_ADMISSION_READY` remains `NOT_READY`,
`EXECUTION_AUTHORIZED` remains `FALSE`, the screen is `NOT_RUN`, and Paper
eligibility is `NOT_ELIGIBLE`. No real-data run, Paper, Live, or activation is
authorized.

## Milestones and handoff

1. **Evidence reconciliation — complete:** #892 and #905 source receipts, D1 authorization/technical closure, and immutable verification metadata are distinguished above.
2. **Internally consistent request — complete:** `research/protocols/b1-7-20261018/EXECUTION_REQUEST.md` records accepted source and D1 status without promoting either to admission or execution authority.
3. **Consolidated final-head, traceability, and unresolved-choices handoff — correction pending review:** the refreshed packet records #925 as merged metadata-only source and #927 as source-merged with postchecks pending. Traceability is listed above; final admission, genuine execution decision, and execution-context/journal verification remain unresolved. Independent delta review and fresh exact-head CI for this continuity correction are pending.
