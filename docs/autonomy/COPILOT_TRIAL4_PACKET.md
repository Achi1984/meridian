# Proposed finite Trial4 — awaiting concrete activation approval

This is a preparation candidate, not activation authority. Do not trigger the source run until the final source/workflow commit has independent review, owner approval and green CI, and all controls below have been verified live. Immutable source anchoring is complete as recorded below; verify the pinned bytes against the final candidate before approval.

## Fixed packet

| Binding | Proposed value |
| --- | --- |
| Packet | `version-history-ledger-20261011-t4` |
| Output branch | `pilot/version-history-ledger-20261011-t4` |
| Source PR / head | #686 / `99eff9111d4ca42d8d89cd88ee5b2831c36282bb` |
| Source Release Safety run / attempt | `38141528699` / `2` |
| Deadline | 2026-10-11 15:00 UTC / 17:00 Europe/Vienna (`1791730800`) |
| Model invocation limit | One invocation, at most 90 seconds; no retry |
| Output | One App-authored Draft, no automatic review or merge |
| Documentation path | `docs/v11/VERSION_HISTORY_TRIAL4.md` |
| Trusted test path | `test/v11-version-history-ledger-trial4.test.js` |

The model generates only the isolated Trial4 ledger text for the existing #646/#651 milestone contract. The executable test is the exact trusted template and reads only the Trial4 ledger. Existing `VERSION_HISTORY.md` and its test are preserved. Immediately before the source rerun, verify externally that both new output paths and the fresh claim branch are absent at the exact reviewed control-main commit; only an authenticated 404 establishes absence. Existing paths, authentication/server errors or uncertain state stop this packet. Keep main and the source PR unchanged until the run stops; the helper repeatedly fences the exact main commit through publication. Do not reset Trial3 or Trial4 claims.

## Activation sequence

1. Verify the completed immutable source anchor `a34163015220d688c14cba044713ddc9684cab44` and the three SHA-256 pins recorded in the workflow against the actual helper, broker and runner bytes. Anchoring is already complete; no placeholder replacement remains. Preserve the existing loader test unchanged.
2. Obtain independent review and explicit owner approval for the exact activation changes, including the model invocation before the publisher environment gate. Keep additional paid usage disabled and verify available quota.
3. Reverify effective main protections with no bypass and the publisher environment restricted to main with owner approval. The lead has verified the active ruleset requires one approving review. For #686, Copilot submitted native `APPROVED` on exact head `99eff9111d4ca42d8d89cd88ee5b2831c36282bb`, and GitHub displayed one approving review under merge requirements. This observed acceptance does not approve this Trial4 candidate or a different head. The separate independent exact-head review gate remains required.
4. Merge only with exact-head CI/review and owner authorization. Wait until both Release Safety and Runtime Smoke push runs on that final control-main commit succeed. Reconcile the live source PR still open at the exact pinned head, source run still at attempt 1, fresh branch absent, and deadline still sufficient.
5. Rerun the pinned source CI once to produce attempt 2. The successful event may claim the packet and invoke the model before any environment approval. It does not authorize another model invocation if the packet fails or expires.
6. Approve the whole publisher job in the protected environment before expiry. The reviewed App runner validates artifact/evidence and installation identity, then mints a Meridian-only PR-write token for the fixed Draft POST and attempts revocation. Environment approval is a manual gate; this is not unattended operation.
7. Record the non-secret receipt, actual App Draft author/head/base, token scope/expiry/revocation result and automatic required CI start. A valid Draft or green offline tests alone do not prove all acceptance conditions. Do not request another model review or merge the output under this packet.

The existing control-attempt allowance (1 or 2) does not permit a second durable claim or paid retry. Existing claims, changed heads, failed checks, expired deadline, or ambiguous mint/POST/revocation stop the run for reconciliation. A missed window requires a separately reviewed proposal and owner decision, not an automatic deadline extension.

The source trigger cannot be reused after #686 closes, its head changes, or its run advances beyond the pinned attempt. Source attempts and control-workflow attempts are separate identities. The helper, workflow predicate and immutable publish helper must agree before activation.

## Immutable source anchor

The prepared loader references `a34163015220d688c14cba044713ddc9684cab44`. The final workflow records SHA-256 values for all three scripts; verify those bytes before approving this candidate. This anchor is source preparation only and does not change main or trigger a pilot.
