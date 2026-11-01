# Release receipt reconciliation — 2026-11-01

Evidence-only continuity update. Mailbox #942 was inspected through comment
[6557001049](https://github.com/Achi1984/meridian/issues/942#issuecomment-6557001049)
at 10:56:35 UTC. Live `main` is
[`c60bb6a`](https://github.com/Achi1984/meridian/commit/c60bb6a2516ab88000ece3c339bcc740280a9ba7),
the merge of PR #1089. Suggested bodies below are drafts for the Lead; no final
receipt was posted here. Missing evidence is explicitly UNKNOWN/PENDING.

## Merged releases and existing evidence

| PR | Exact merge SHA | Existing test / postcheck evidence | Acceptance limit and receipt |
|---|---|---|---|
| #999 | `24faf87f03b2faf61c34db04f02d8e002f5fbb28` | Safety run [41054452077](https://github.com/Achi1984/meridian/actions/runs/41054452077), 3259/3259. Post-merge Safety 41055535083, Coordinator 41055535012, Pages 41055532367, VisualQA 41055534656 and Mirror 41055534983 succeeded; Runtime 41055534984 failed the strict Asset Watch receipt gate. | No live holdings verification. Failure preserved in [942/6523063310](https://github.com/Achi1984/meridian/issues/942#issuecomment-6523063310); PR [#999](https://github.com/Achi1984/meridian/pull/999). |
| #1050 | `9228dd0ad5c1ea2e3c61d97ccdec0b2f98f36ad5` | Safety run 41061863099/job 124083650100, 3266/3266. Exact-merge runtime/postcheck outcome is UNKNOWN in the receipts inspected for this update. | Original live rejection cause remained unproven; no runtime recovery claim. PR [#1050](https://github.com/Achi1984/meridian/pull/1050). |
| #1052 | `85add8bf55bc8ef75a59c1cfac1a7265153f298e` | 173 focused tests preceded the final category-boundary correction; nine subsequent offline chain checks passed. Exact-merge hosted CI and postchecks are UNKNOWN in the inspected receipt. | No live rejection-cause confirmation. PR [#1052](https://github.com/Achi1984/meridian/pull/1052). |
| #1063 | `44dc093067eff1dd004356944714df26950231db` | 67 focused synthetic tests passed. Exact-merge hosted CI/postchecks are UNKNOWN in the inspected receipt. | No live calls or deployment claimed. PR [#1063](https://github.com/Achi1984/meridian/pull/1063). |
| #1065 | `5b4c3e9b254a859902072c9c0a331e7345e2edbb` | 83 focused tests passed; final whitespace-boundary checks passed separately. Exact-merge hosted CI/postchecks are UNKNOWN in the inspected receipt. | No live reads or post-deploy resolution claimed. PR [#1065](https://github.com/Achi1984/meridian/pull/1065). |
| #1067 | `f2277526f35af3675f2d559293900d1988d6fcef` | Regression coverage is described in the PR; hosted CI/final review were pending in its body. Exact-merge CI/postchecks remain UNKNOWN here. | Eligibility predicates remained unchanged; no live acceptance claimed. PR [#1067](https://github.com/Achi1984/meridian/pull/1067). |
| #1077 | `073810c26441aa6bae6113f37cd1cd7162407e4c` | Candidate CI 41227552312/job 124614755038: 3367/3367. Exact-merge Safety 41229008658, Runtime 41229008622, Pages 41229008070, Coordinator 41229008599, Mirror 41229008613 and Northflank `living-railway-5977` succeeded. | Cloud Browser live acceptance is covered by the later desktop-only receipt below; not iPhone Safari. Postcheck receipt [942/6547532817](https://github.com/Achi1984/meridian/issues/942#issuecomment-6547532817). |
| #1078 | `fb51293011fa923a6427705ccfd30d667310e773` | Candidate CI 41229560124/job 124620718056: 3369/3369. Exact-merge Safety 41232767536, Runtime 41232767458, Pages 41232767038, Coordinator 41232767505, Mirror 41232767462 and Northflank `courageous-lace-1556` succeeded. | Cloud Browser live acceptance is desktop-only; not iPhone Safari. Postcheck receipt [942/6548075649](https://github.com/Achi1984/meridian/issues/942#issuecomment-6548075649). |
| #1079 | `a8c900881b0b19420e029567a8deadf0d4122b78` | Candidate CI 41234450466/job 124635185805: 3378/3378. Exact-merge Safety 41236878724, Runtime 41236878602, Pages 41236877685, Coordinator 41236878604 and Northflank `possible-thing-2079` succeeded; Mirror not applicable to changed paths. | Desktop Cloud Browser acceptance appears in [942/6549113883](https://github.com/Achi1984/meridian/issues/942#issuecomment-6549113883); not real iPhone Safari. Postcheck receipt [942/6548509596](https://github.com/Achi1984/meridian/issues/942#issuecomment-6548509596). |
| #1080 | `dcfd520c02987c546fc5d23db4a0491cc4a3d935` | Candidate CI 41238169321/job 124646236350: 3385/3385. Post-merge Safety 41240285652, Runtime 41240285689, Pages 41240285315, Coordinator 41240285688 and Northflank `dizzy-dog-3627` succeeded; Mirror not applicable. See [942/6548952462](https://github.com/Achi1984/meridian/issues/942#issuecomment-6548952462). | Desktop Cloud Browser acceptance, including rendered UI/history checks, is in [942/6549113883](https://github.com/Achi1984/meridian/issues/942#issuecomment-6549113883); not real iPhone Safari and no live zero-P/L bot was sampled. |
| #1082 | `87d69bb982c1261aa45f1b55a702cc413cd1ee7e` | Exact-pair CI 41246133570/job 124669862460: 3410/3410. Post-merge Safety 41249554147, Runtime 41249554005, Pages 41249553734 and Coordinator 41249554013 succeeded. | Source-only Paper preparation; no UI acceptance required, no Paper/runtime/provider activation. Receipts [PR comment 6550141588](https://github.com/Achi1984/meridian/pull/1082#issuecomment-6550141588) and [6550194276](https://github.com/Achi1984/meridian/pull/1082#issuecomment-6550194276). |
| #1087 | `5d851cb5b98faecab7ffec0712d40ac37a0a429e` | Candidate Safety 41289430452/job 124797393928: 3464/3464. Exact-merge postchecks are UNKNOWN in the inspected receipt; do not infer them from later main runs. | Private Ledger quantities were not saved; live browser acceptance and a separate write credential remain pending ([PR comment 6555698038](https://github.com/Achi1984/meridian/pull/1087#issuecomment-6555698038)). |
| #1089 | `c60bb6a2516ab88000ece3c339bcc740280a9ba7` | Earlier candidate Safety 41289701296/job 124798184255 had 3462 pass/1 fail; the later exact-pair CI 41291117410/job 124802416166 passed 3470/3470. Main Safety 41293348203, Runtime 41293348208 and Coordinator 41293348206 succeeded. Pages run 41293347696 attempt 1/job 124809105492 and attempt 2/job 124813148075 both failed deployment creation with HTTP 400 because prior deployment `adec0f21985f9b937039cff1751a94f74c71846e` was reported in progress. | Pages remains a hold; no successful deployment receipt. Both failed attempts and contradictory prior Pages API `succeed` read are preserved in [942/6556370642](https://github.com/Achi1984/meridian/issues/942#issuecomment-6556370642) and [942/6556203808](https://github.com/Achi1984/meridian/issues/942#issuecomment-6556203808). |

For #1077–1080, the actual Cloud Browser showed Pionex history and rendered UI
behaviour, but this was desktop-only, not real iPhone Safari. The receipt states
no private balances/references were published and no live zero-P/L bot was
sampled; confirmed-zero behavior is covered by automated tests only
([942/6549113883](https://github.com/Achi1984/meridian/issues/942#issuecomment-6549113883)).

## Open proposals — no merge SHA

| PR | Current head | Evidence and state | NEXT |
|---|---|---|---|
| #1090 | `5a874e9ef0282745bfd9a320ac6fe6b6dbcc330b` | Open, not merged. Exact-pair Safety 41293507578/job 124809463393: 3476/3476; final independent source review GREEN at [942/6556341901](https://github.com/Achi1984/meridian/issues/942#issuecomment-6556341901). No merge SHA exists. | Lead-controlled integration decision; no runtime or activation authority. |
| #1092 | `2e788edc522542d26e489d553be33fa44a680d62` | Open, inert Pages proposal only; local focused tests 7/7 and R1/R2 source/evidence responses exist. It adds no active workflow and does not clear the Pages hold. The bounded R3 review requested at [942/6556998549](https://github.com/Achi1984/meridian/issues/942#issuecomment-6556998549) was still in progress at [6557001049](https://github.com/Achi1984/meridian/issues/942#issuecomment-6557001049). | Keep inert; wait for R3 and the separate Pages decision. No activation. |
| #1093 | `a3a173e9e3f33a5a405771c72294faea70cfbfca` | Open, not merged. The PR reports 22 focused tests; earlier source GREEN is not evidence of independent full-run totals. R3 request [942/6556998549](https://github.com/Achi1984/meridian/issues/942#issuecomment-6556998549) asks to verify run 41294377989/job 124812037024 totals and remaining ledger/manifest coverage; it was still in progress at the cutoff. Full-run totals and R3 verdict are PENDING, not inferred. | Await bounded R3 evidence; no merge or activation. |

## Older recovery chain and proposed closure

The PRs #999, #1050, #1052, #1063, #1065 and #1067 are merged at the exact
SHAs above; they are not retroactively made successful by a later release.
The specific old recovery-chain blocker can only be proposed as
`SUPERSEDED` against actual successor evidence: PR #1069 merged at
`7b97cefdca80d6c04798cb5d82a7afcba182b49f`; Safety 41138851304 succeeded,
Runtime 41138851253 verified the exact deployed SHA, and Pages 41138850270,
Coordinator 41138851300 and Northflank `big-deer-5822` succeeded
([942/6540136819](https://github.com/Achi1984/meridian/issues/942#issuecomment-6540136819)).
This successor closes only the related pending strict Asset Watch recovery
status. It does not erase #999's failed Runtime 41055534984, fill unknown
postchecks for other historical PRs, or assert that all their feature outcomes
were superseded. No closure has been posted.

Suggested grouped recovery receipt:

```text
FINAL_MERGE_STATUS RECOVERY-999-1050-1052-1063-1065-1067 SUPERSEDED
release-class: recovery / source-status
state: SUPERSEDED_FOR_PENDING_STRICT_ASSET_WATCH_RECOVERY_ONLY
evidence: preserve each original merge SHA and its recorded test result; #999
Runtime 41055534984 remains FAILED. Exact successor #1069 merge
7b97cefdca80d6c04798cb5d82a7afcba182b49f has successful Safety, exact-SHA
Runtime, Pages, Coordinator and Northflank receipts at 942/6540136819.
UNKNOWN historical CI/postchecks remain UNKNOWN; no retroactive success claim.
NEXT: retain historical outcomes; no runtime/provider action.
```

## Suggested concise receipt bodies (not posted)

```text
FINAL_MERGE_STATUS PR1077-1080 POSTCHECKS_GREEN_DESKTOP_ACCEPTANCE_ONLY
release-class: UI
state: MERGED_POSTCHECKS_GREEN; desktop Cloud Browser acceptance recorded.
evidence: exact merge SHAs and per-PR CI/postchecks above; rendered acceptance
and visible history at 942/6549113883.
limit: earlier browser transport timeouts remain historical; later acceptance was
desktop-only, not real iPhone Safari. No sampled live zero-P/L bot or private balances.
NEXT: retain transport/mobile/zero-sample history; no authority or activation change.
```

```text
FINAL_MERGE_STATUS PR1082 COMPLETE
release-class: paper-preparation
state: MERGED_POSTCHECKS_COMPLETE; exact CI and four postchecks above.
evidence: 1082/6550141588, 1082/6550194276.
limit: preparation only; no reconciliation adoption, Paper/runtime/provider use.
NEXT: none for this source-only packet; separate authorization remains unchanged.
```

```text
FINAL_MERGE_STATUS PR1087 POSTCHECKS_AND_LIVE_ACCEPTANCE_PENDING
release-class: UI
state: MERGED; candidate Safety passed; exact-merge postchecks UNKNOWN.
evidence: 1087/6555698038; merge 5d851cb5b98faecab7ffec0712d40ac37a0a429e.
limit: private quantities not saved; live acceptance and write credential pending.
NEXT: complete only the existing bounded acceptance; no trading activation.
```

```text
FINAL_MERGE_STATUS PR1089 PAGES_POSTCHECK_FAILED
release-class: engineering / main postcheck
state: MERGED; candidate CI, Safety, Runtime and Coordinator succeeded; Pages
attempts 1 and 2 failed HTTP 400. Preserve the earlier candidate Safety failure
(41289701296) and contradictory predecessor API read; later CI success does not
erase those failures.
evidence: 1089/6556370642; run 41293347696/jobs 124809105492 and 124813148075.
NEXT: keep the Pages hold; no blind retry, cancellation, settings change or merge
of dependent work until the existing hold is reconciled.
```

```text
FINAL_MERGE_STATUS PR1090-1092-1093 SOURCE_PROPOSALS_OPEN
release-class: engineering / inert-proposals
state: OPEN_NOT_MERGED; #1090 exact-pair CI and source GREEN; #1092 remains
inert with R3 pending; #1093 full-run totals/R3 remain pending.
evidence: exact current heads and receipts above; 942/6556998549 is pending at
the inspected cutoff.
NEXT: await each bounded evidence/review result; keep Pages held and all
activation, OKX/Northflank and authority states unchanged.
```

## Continuity invariants

Mailbox #942, the watchdog binding, schedules, workflow files and all
authorization booleans are unchanged. Rollover remains a separately prepared
future routing operation and is not activated. No Paper/trading activation,
provider/runtime operation, external market-data use, extra spending, or
OKX/Northflank setup is performed here. The documented removed UI daily cap,
including the Owner quote and receipt 6112437050, remains removed; no obsolete
audit guidance is revived.
