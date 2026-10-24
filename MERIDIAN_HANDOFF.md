> **Current routing and review rule — owner decision 2026-10-23**
> Resolve `mailboxIssue` from the live `MERIDIAN_LIVE_CHECKPOINT.json` before posting.
> This reviewed rollover candidate selects #942, predecessor #639, watchdog status
> comment6371625947, threshold200. Before merge the live checkpoint still selects #639;
> archive #639 only after the successor smoke succeeds. Earlier mailbox declarations
> and handoff snapshots below are historical; they do not override live routing.
> Final exact-head Claude GREEN_LIGHT after completed successful CI remains mandatory.
> Lead-only closure of SOURCE_GREEN/CI_PENDING does not replace that final review.
> Owner decision and literal quotes: #639/comment6371484899. #941 completed with all
> postchecks (receipt6371614438). #940 remains held until routing/smoke completion.
> SOURCE_AUDIT and all false authorization flags remain unchanged; no activation.

> Current Strategy Evidence Workspace correction — 2026-10-24.
> PR #940 is COMPLETE: merge `b5727493378814229267a7d881471172d0b606fb`;
> final Claude receipt #942/comment6380610504; pre-merge Release Safety
> 40020095282 attempt 2/job120790537195 succeeded. Exact-merge postchecks all
> succeeded: Safety40068725083, Runtime40068724996, Coordinator40068725175,
> Pages40068723395. Completion receipt: #942/comment6380786372.
> PR #946 remains Draft. Previously published correction commit:
> `fb844e012bc999e4939f4a9d02b5e5cc216be3dc`; fresh exact-head hosted CI and
> final independent reviews for the current correction remain pending. On prior
> candidate `b40b4ed1bae7059db1f4ed85c131e45a518d76ad`, Release Safety run
> 40072753537 attempt 2/job120813573164 succeeded (2738 passed, 0 failed,
> 0 skipped), while Claude #942/comment6381590041 returned REVISION_REQUIRED
> for the documentation allowlist and incomplete review coverage. This evidence
> applies only to that prior head; the current doc-scope correction needs fresh
> exact-head CI and complete-scope review. The earlier Safety40071135556 was
> `action_required` with zero jobs on prior head `7758e425`; it was not retried
> or approved. Earlier still, Safety40072536126 on `21bf62cd` was
> `action_required` with zero jobs; that status was superseded for prior-head CI
> evidence by the successful b40 run above. The preceding integration correction
> was limited to generated/synthetic presentation and fixture serving/CSP
> assertions; this correction changes documentation/continuity records only.
> No current-correction CI or review is claimed. No journal or market-data access,
> canonical execution, strategy PnL, scheduling, runtime
> activation, or Paper/Live execution occurred; all authority flags remain false.
> This supersedes the #940-held statement in the preceding 2026-10-23 snapshot;
> historical receipts and their provenance are retained. Carry final #946
> completion evidence into the next associated source PR; do not create a
> standalone continuity-only publication or claim this correction is acceptance.

> ## Current continuity reconciliation — 2026-10-21
>
> **Latest observed main:** `6aeb07c35aa1e45dbaf0e78fc97fd7b59170b6f7` (PR #927 source merge; postchecks pending).
> Verified main checkpoint: **2c3e3798b3296406a88988250ff54f272ae4bb91**
> Build: **10.0-r130**
> The verified checkpoint above is the last main with all applicable postchecks
> confirmed. PR #927 is source-merged at the newer observed main; its postchecks
> remain pending, so it is not yet fully accepted. PR #919 is open and unmerged;
> the continuity correction is pending independent review and fresh exact-head CI.
> Do not claim future CI success or merge.
>
> **Merged project work and evidence**
>
> | PR | Verified current status | Receipt |
> | --- | --- | --- |
> | #901 | Merged as `e0e7472f74a05cb2a9cedb1a758abe8816b93aa6`; all applicable postchecks succeeded. | PR #901 comment [6273433124](https://github.com/Achi1984/meridian/pull/901#issuecomment-6273433124); final receipt [#639/6273865905](https://github.com/Achi1984/meridian/issues/639#issuecomment-6273865905) |
> | #905 | Dormant historical-admission/profile source merged at `6bcaa74b35a7c093e67f144a03f82a6d77cdf9be`; independent source acceptance, not D2 approval. | [#639/6275925635](https://github.com/Achi1984/meridian/issues/639#issuecomment-6275925635), merge [#639/6275930095](https://github.com/Achi1984/meridian/issues/639#issuecomment-6275930095) |
> | #913 | Merged at `3c4af65bfe1368da608711bef37761d4cfd54f78`. | [#639/6299104780](https://github.com/Achi1984/meridian/issues/639#issuecomment-6299104780) |
> | #921 | Merged at `2e41968551325b69eeeed994b9d5a5df84252a5e`; all applicable postchecks succeeded. | [#639/6299885755](https://github.com/Achi1984/meridian/issues/639#issuecomment-6299885755) |
> | #916 | Merged at `c1ec1de5eec7307b1c91a5e133b5486f27fc5c88`; Release Safety, Runtime Smoke, Coordinator, and Pages all succeeded. | Completion [#639/6323341748](https://github.com/Achi1984/meridian/issues/639#issuecomment-6323341748); runs [39490979956](https://github.com/Achi1984/meridian/actions/runs/39490979956), [39490980085](https://github.com/Achi1984/meridian/actions/runs/39490980085), [39490979999](https://github.com/Achi1984/meridian/actions/runs/39490979999), [39490978159](https://github.com/Achi1984/meridian/actions/runs/39490978159) |
> | #923 | Merged at `2c3e3798b3296406a88988250ff54f272ae4bb91`; source-only review and pre-merge CI passed (2698/0/0); all four postchecks succeeded. Root cause for #922 remains unknown. | Merge/status receipt [#923/6324021896](https://github.com/Achi1984/meridian/pull/923#issuecomment-6324021896); Release Safety [39657036131](https://github.com/Achi1984/meridian/actions/runs/39657036131), Runtime Smoke [39657036159](https://github.com/Achi1984/meridian/actions/runs/39657036159), Coordinator [39657036338](https://github.com/Achi1984/meridian/actions/runs/39657036338), Pages [39657032229](https://github.com/Achi1984/meridian/actions/runs/39657032229) |
> | #925 | Metadata-only D2 candidate merged at `984e164ae9da021d3d7fadc578eb0cf0aeaa4413` from reviewed head `c26265fd4554a658f5584b842c79f39ac4c406d8`; Claude GREEN_LIGHT and all applicable postchecks are recorded. Still proposal-only, not admission or execution approval. | Lead relay of reviewer901 SOURCE GREEN [#925/6324017218](https://github.com/Achi1984/meridian/pull/925#issuecomment-6324017218); Copilot focused-test report [#925/6324009932](https://github.com/Achi1984/meridian/pull/925#issuecomment-6324009932); Claude [#639/6324706232](https://github.com/Achi1984/meridian/issues/639#issuecomment-6324706232); merge/postcheck receipt [#639/6324734993](https://github.com/Achi1984/meridian/issues/639#issuecomment-6324734993) |
> | #927 | Source merged at `6aeb07c35aa1e45dbaf0e78fc97fd7b59170b6f7`; pre-merge Safety passed 2704/0/0; postchecks are pending and the change is not yet fully accepted. #922 root cause remains not established. | Merge/status receipt [#927/6325242524](https://github.com/Achi1984/meridian/pull/927#issuecomment-6325242524); Safety [39664406698](https://github.com/Achi1984/meridian/actions/runs/39664406698) |
>
> **Active CI blocker:** #917’s source is accepted, but its exact-head Release
> Safety run [39491245043, attempt 2](https://github.com/Achi1984/meridian/actions/runs/39491245043)
> failed at `test_b1_exclusive_lock_after_child_failure_returns_unsettled_and_reaps_child`
> (`test_supervisor.py:803`): it did not observe a durable first-path start.
> Result was 2697 passed, 1 failed, 0 skipped; the B1 group ran 16 tests in
> 56.280 seconds and the wrapper took 97.228 seconds. The failure is an assertion,
> not a group timeout; the cause is not established. Owner failure receipt:
> [#639/6323451446](https://github.com/Achi1984/meridian/issues/639#issuecomment-6323451446).
> Do not blind-rerun, increase budgets, or change this documentation PR to repair
> that test.
>
> Issue #922 remains open with root cause `NOT_ESTABLISHED`. PR #923's
> bounded-diagnostics change is merged on main; it does not establish the
> original startup cause or claim a runtime fix.
>
> **D2 candidate lane:** Issue #924 / PR #925's deterministic metadata-only
> candidate artifact, including proposed ordered path identities, is merged on
> main at `984e164ae9da021d3d7fadc578eb0cf0aeaa4413` from reviewed head
> `c26265fd4554a658f5584b842c79f39ac4c406d8`. Independent source-only
> acceptance applies to candidate source commit `fc0fd0db4653630cae6c3f5a73607e02a9c9d24e`
> ([#925/6324017218](https://github.com/Achi1984/meridian/pull/925#issuecomment-6324017218));
> complete Claude GREEN_LIGHT is [#639/6324706232](https://github.com/Achi1984/meridian/issues/639#issuecomment-6324706232), and merge/postcheck receipt is [#639/6324734993](https://github.com/Achi1984/meridian/issues/639#issuecomment-6324734993).
> The candidate remains proposal-only, not admission or execution approval. The author-reported focused command
> `node --test test/b1-7-d2-candidate.test.js` at that SHA reported 6 passed,
> 0 failed, 0 skipped; the report also records import-no-write, isolated fixed-path
> CLI I/O, and tampered-input rejection checks ([#925/6324009932](https://github.com/Achi1984/meridian/pull/925#issuecomment-6324009932)).
> The correct receipt mapping is retained: `6324017218` is the Lead's source-green
> relay; `6324009932` is the Copilot 6/0/0 focused-test report. The reviewer did
> not claim independent test execution. Current D2 status remains
> `PROPOSAL_ONLY`, not an accepted final admission artifact.
>
> The exact proposed scope remains one trial, 44 ordered
> paths, 30-minute batch, 60-second path, 1 MiB output, existing 15/30 bp cost
> scenarios including the one-day delay, existing screen criteria, and the
> research-only `NO_FINITE_TRADE_STOP` exception. A genuine separate owner
> decision is not recorded. Input remains `NOT_FROZEN`; proposed ordered path
> identities in the merged #925 candidate are not final admission identities and
> are not accepted as frozen input.
> A final proposed profile identity is `NOT_FINAL`. The current inactive-profile
> digest is provenance only, never a final activated-profile identity. Source
> authenticity remains `NOT_ESTABLISHED`; trial-ledger completeness is `UNKNOWN`; execution-context,
> journal, and unused-attempt evidence is `NOT_VERIFIED`. No D1 reread, runtime
> probe, or execution is authorized.
>
> **Scope and preserved state:** The eight writable files in this continuity packet
> are:
> `docs/strategy-lab/D2_READINESS_RECONCILIATION.md`,
> `research/protocols/b1-7-20261018/EXECUTION_REQUEST.md`,
> `test/b1-7-engine.test.js`, `MERIDIAN_LIVE_CHECKPOINT.json`,
> `MERIDIAN_HANDOFF.md`, `MERIDIAN_RESUME.json`,
> `MERIDIAN_AGENT_STATE.json`, and `docs/MERIDIAN_CHAT_HANDOFF.md`. The Lead's
> same-correction scope extension is recorded at [#919/6324701311](https://github.com/Achi1984/meridian/pull/919#issuecomment-6324701311).
> Historical snapshots and original D1 evidence are
> preserved. Research authority flags remain false; infrastructure pause and
> disabled routing are unchanged. The next gate is independent full review and
> exact-head CI for the expanded scope. **No merge.**
>
> Earlier dated blocks below remain historical snapshots and are not current status.

> Current reconciliation — 2026-10-19, PR #901 main alignment.
> Verified main: `496360869171f0a29e3efbc7ec216ffc1833c6a0` (PR #900).
> PR #900 complete: independent Work review #639/6273568843, merge receipt
> #639/6273574381; postchecks SUCCESS: Safety39297340489, Smoke39297340509,
> Coordinator39297340538, Pages39297339543.
> PR #901 published at `f9367eb90fa127551f222e74a9e09c729284aa6a`;
> its CI2685/0 and Work review apply to the previous base only.
> Main integration preserves Arena source; fresh candidate publication, CI and
> independent integration review remain pending. Lead status6273433124;
> operation MERIDIAN-901-ALIGN-20261019-R1, one Lead writer.
> Copilot #903 delivery analysis needs independent review and current-state
> reconciliation before acceptance. Claude attempt failed without a verdict;
> the Work review is not a Claude verdict. No duplicate Claude request.
> D1 accepted, manifest NOT_FROZEN; no D2, recovery, Paper or Live authority.
> NEXT: publish aligned #901, verify CI and independent review before merge.
> Earlier reconciliation blocks below are preserved historical snapshots.

> Current reconciliation — 2026-10-19, Arena inspection source candidate.
> Accepted main: `6d6d2a8d09608ea972b017a40cae9ba0af984e9b` (PR #898).
> PR #898 complete, mailbox #639 receipt6273191124. Premerge
> CI39293826384/job118201076152 passed2676/0; postchecks all succeeded:
> Safety39294577029/job118203669911 (2676/0), Smoke39294576928,
> Coordinator39294577023, Pages39294576650.
> Arena metadata-only source at `2794314969c4b6ad351e0fcbd88745c07f7cff57`
> received independent source acceptance after two targeted correction loops.
> Publication, PR/progress-comment identifiers, fresh exact-head/base CI and
> final independent review remain pending; no remote publication is claimed.
> History publication is managed separately by the Lead. This packet changes
> no History files. Imported integrity is a claim, never source authentication.
> D1 stays accepted and NOT_FROZEN; D2, execution, recovery, Paper and Live
> remain blocked. No new scheduler, service, data acquisition or trading.
> NEXT: publish and independently accept Arena inspection. Mailbox #639 remains
> authoritative; earlier receipts below retain their historical provenance.

> Current reconciliation — 2026-10-19, PR #898 inspection candidate.
> Accepted main: `8ade1e56831f408dd35567fe5003699e95a606bf` (PR #897).
> PR #897 complete; mailbox #639 receipt6272919723. Postchecks succeeded:
> Safety39292525783/job118196563622, Smoke39292525893,
> Coordinator39292525725, Pages39292524400.
> PR #898 is aligned locally; fresh exact-head/base CI and independent review
> remain pending. Lead progress comment6271844753; no candidate publication claimed.
> D1 stays accepted and NOT_FROZEN. Inspection is generated-fixture read-only;
> no recovery, execution, scheduler, D2, Paper or Live activation.
> NEXT: publish and independently accept #898. History implementation stays queued.
> Earlier candidate statements below are preserved historical snapshots.

> Current reconciliation — 2026-10-19, M11 PR #897 source candidate.
> Verified main: `99e7de636edd741de2ad4813ecdaacaa11db87df` (PR #899).
> D1 #895 is closed/completed; acceptance receipt #895/comment6272425721.
> Seven-file technical verification is accepted; manifest stays NOT_FROZEN.
> Main postchecks all passed: Safety39290513335/job118189638386 (2666/0),
> Runtime39290513327, Coordinator39290513209, Pages39290512121.
> PR #897 is aligned locally; its new exact-head/base CI and independent review
> are pending. No publication or merge of this candidate is claimed here.
> The UI retains its explicitly dated earlier D1 receipt, including the historical
> integration-pending statement; it is not a live GitHub status.
> NEXT: publish and independently accept #897; Research-to-Arena metadata work
> stays queued until WIP clears. D2, strategy PnL, Paper and Live remain blocked;
> no scheduler, service, recovery, new data reads or trading activated.
> Mailbox #639 remains authoritative. Earlier receipts below are historical.

> Current Work receipt — 2026-10-19: source main observed
> `6f720373af5439af70c54e6cb2f1c17abaf8b877`, mailbox resolved to #639.
> D1 #895 technical verification and independent recomputation passed for seven
> pinned files / 955 synchronized dates each. Evidence:
> `docs/research/d1-20261019/README.md`. Candidate CI/final review pending;
> manifest NOT_FROZEN, no D2/Paper/Live. Current M11 plan:
> `docs/MERIDIAN_STAGE_ROADMAP.md`. Older snapshots below remain historical.

# MERIDIAN HANDOFF

## Current checkpoint — B12 public; source integration continues (2026-10-18)

Verified main is `ce20052f77c99b98b0966465c4dc18c6da77e819`. This is the
source basis of this local continuity candidate, not its own publication SHA.

- M11 B12 is public and complete at PR882 merge `94b2a682f003961f37c2ce07c6cae313c0ac0e26`.
  Exact CI39132625973 passed 2635 tests; combined Claude GREEN639/6251132456.
  Safety39138177731, Runtime39138177976, Coordinator39138177652 and Pages39138176581
  succeeded. Public desktop Cloud Browser check confirmed native Strategies,
  12 families, separate B1-7 and five Arena cards including H9 blocked
  (receipt882/6251381016). This is not physical-device/PWA/account or operational Paper proof.
- PR880 source/synthetic engine is complete; the formerly pending exact-merge
  Runtime39131410787 is SUCCESS. No real-data computation followed from that merge.
- PR885 screening tests are complete at `7816b80f8f94de1929d814a142c1bdf4361add8f`,
  reviewed head `211b031ab3d2f42470a6f46722bfa43627cfe121`; Claude GREEN639/6251396703
  covers the full three-file delta, retaining prior unchanged-engine review6250243642.
  CI39138242039/39138245546 passed 2650 tests; frozen140 unchanged. Postchecks
  Safety39138672542, Runtime39138672514, Coordinator39138672543 and Pages39138672026
  all succeeded. Receipt885/6251426568 retains its historical merge-time pending snapshot.
- PR884 merged at current main from `3e797dfdcd6dee4dfb1cc6630e8afd43a574a739`.
  Full nine-file Claude GREEN639/6251632595 (review run39140236165), exact
  CI39138731585 passed2651 tests; frozen140 unchanged. Receipt884/6251677672.
  All applicable postchecks succeeded: Safety39140543307 (job117713897879),
  Runtime39140543320, Coordinator39140543273 and Pages39140542535. Its corrected
  supervisor is an inactive synthetic hash-chain foundation, not a running service
  or integration with the real B1 engine. Caller source/data hash labels are not byte authentication.
- Issue886 is assigned to Copilot; draft PR887 on `copilot/b1-execution-session-loader-r1`
  is queued at initial observed head `0cdab5dbb96ab2cabaa56f33e925735ea135ed19`.
  It prepares a shared resumable engine session and verified-byte loader with generated
  fixtures only. It does not read captured market files or implement the future persistent
  child/ACK/result-channel bridge. Lead must reconcile its base and complete CI/review.

NEXT: review PR887's source/synthetic package against current main. Operational
Live-Paper remains the M11 priority, with supervisor integration, frozen input admission
and a concrete separately authorized research/Paper protocol still outstanding.
No captured-data reads, new acquisition, historical strategy run, scheduler/service
activation, orders or Paper/Live transition are authorized by this checkpoint.
SOURCE_AUDIT and all seven flags remain false; H9 remains blocked, historical CRV policy
unresolved and B1 no-stop CRV undefined. Publisher stays paused; native868 stays disabled.
The missed LowVol funding observation cannot be backfilled as timely evidence.

The dated sections below are historical snapshots; their pending statuses are superseded
only by the explicit current receipts above. Creation provenance and exact integer markers
are preserved.

## Historical checkpoint — B12 draft before publication (superseded)

Current integration base is `c42ded8b7d33312f1a0e232d26a28ed5f0e768b3` after PR880 R3 source/synthetic merge: reviewed head `219914105a589df68014372b4ea5bfdc8f1dcb36`, base `10f10f270a012b2f31679eec2fc2625813b5e18b`, CI39129332087 attempt2 (2625 passing), Claude GREEN639/6250243642. Safety39131410769, Coordinator39131410732 and Pages39131410231 passed; Runtime39131410787 remains pending at this checkpoint. No real data run or Paper/live activation occurred.

Lead B12 correction follows candidate `4effd608f7f5484d33bc12b1bcf15e6bfba31bb3`: separate unrelated historical provenance from imported results, retain H9 as blocked, and reconcile current-base continuity. Existing B12 screenshots are pre-correction historical evidence; new exact-head CI and Claude review are pending. PR884 has a reproduced SQLite-contention deadline defect under correction (884/6250470874), and is not an active service.

Short-term priority is operational Live-Paper in M11. Remaining integration gates include verified source bytes, hard supervised limits, direct screen boundary tests and a concrete research/Paper protocol. The missed LowVol funding observation cannot be backfilled as timely evidence. No execution flags or frozen strategy gates are changed.

The owner mandate is M11-only development: “Meridian 10 ist Geschichte wir sollten unsere Arbeit nur mehr in M11 stecken.” B11 is complete on
`10f10f270a012b2f31679eec2fc2625813b5e18b`: reviewed head `16a54904`,
base `1c7b6dccd886f57e866c7d359c091b1e72a193ea`, exact-head CI39125312551
(2607 passing), Claude GREEN mailbox639/6249670854, and successful postchecks
Safety39125964713, Runtime39125964717, Coordinator39125964588, Pages39125964078.
B12 issue #881 / draft PR #882 is an isolated M11 Strategies workspace on
`copilot/integrate-native-strategies-workspace`; initial implementation commit
`c835ae3d2dd0a28aa67e24e563213af771f7ac4e`. Focused M11 tests, four-width
synthetic Chrome acceptance, screenshots, frozen-source guard (140/0) and
continuity audit have passed. Exact-final-head CI and Claude review remain
pending; do not merge or activate. Acceptance notes: `docs/v11/B12_VISUAL_ACCEPTANCE.md`.

B10 PR875 is complete: reviewed head `b4a5084b98fe54c0c840d17806a76b5a465bf4c9`, base
`a8cde76ba3255a77049eb6318a61efaa127cedd0`, merge `1c7b6dccd886f57e866c7d359c091b1e72a193ea`,
Claude GREEN_LIGHT639/6249104892, exact-head CI39120883771 attempt2 (2600/2600),
and applicable postchecks Release Safety39122238945, Runtime39122238938,
Coordinator39122238969, Pages39122238564 (receipt PR875/6248789090 and mailbox639/6249191206).

- PR873 completed r130 Arena integration at `b75335da3805c0d509ff11f75ab0584d351f284e`.
  Receipt PR873/6248247986 and mailbox639/6248725056 record reviewed head
  `8a7c5eb2e437667ea05b6919431ec07c6a7fe96d`, 2592 passing exact-head tests,
  and all applicable postchecks successful. The earlier Visual QA ETIMEDOUT
  attempt is retained as historical; its unchanged-source retry passed.
- PR872 completed data integration at `a8cde76ba3255a77049eb6318a61efaa127cedd0`.
  Receipt PR872/6247247834 and mailbox639/6248819311 record reviewed head
  `f3a7218d4c3162738cd9b0d42ec9d187eba4f595`, CI39119255611 (2599/2599),
  and applicable postchecks successful. The historical CI39114588688 failure
  remains a failure on the earlier head; its timing assertion was corrected.
  Data coverage remains 448 common closes versus the 955 target; source
  authenticity and complete archive hashes are not established.
- B11 issue #876 / PR #877 is complete as recorded above. B12 adds native
  Strategies navigation and a source-bounded catalog/Arena; it does not change
  V10 files, exchange snapshots, research results, runtime permissions, or
  trading behavior.

Preserve V10/root/version.json/PWA identity, r130, SOURCE_AUDIT and all seven
false flags, H9 blocked, CRV unresolved, publisher paused, native868 disabled,
and the no-research/no-strategy-PnL/no-trading boundaries. Older pending
PR860/862/Arena/data statements below are retained as historical snapshots,
not current state. Creation provenance and both exact nanosecond markers remain
unchanged.

## Historical checkpoint — pending r130 integration snapshot (superseded)

Build: **10.0-r130** (candidate; not yet merged or published at that snapshot).
Source proposal PR870 head `b5d7d2a69dd5715580e9691cfcd566e694452baa` received independent GREEN_LIGHT in mailbox639/6248189652. Base main is `cbe9b5a34ed31e61746a656d49bb1b81bc637eec`. This integration only advances release/cache identity and continuity metadata; reviewed feature code is unchanged. The later PR873 completion receipt above supersedes the pending status.
Data PR872 was still shown at earlier head325c7755 in that snapshot. Its historical CI failure is not relabelled; the corrected integrated head and final checks are recorded above.

Earlier sections below are historical checkpoints.

## Historical source and runtime checkpoint after PR845 — superseded

Operation HANDOFF-845-CONSOLIDATE-20261017-01. Verified source main:
`1406845c8728a75652e10cd29c999494745c9034` (#845). Build **10.0-r129**.
This continuity candidate supersedes prior operational summaries. PR845 is
merged and COMPLETE; all four postchecks succeeded. Its own publication SHA
is not yet known. No runtime authorization is inferred.

- Prior consolidated handoff PR840 merged at
  `d5112c6f4a135847bc8b080fa402dfc46bc9a487`; final receipt639/6232870009
  COMPLETE. Safety39025397209, Smoke39025397222, Coordinator39025397213 and
  Pages39025396725 all SUCCESS.
- PR844 is merged and COMPLETE. All postchecks succeeded:
  39026385381, 39026385395, 39026385451 and 39026385137.
  The disposable local PostgreSQL16 fixture harness has real PG16 evidence
  (receipt6232998743). Its private Unix socket cluster is separate from Neon;
  catalog comparison and seven rollback-isolated negative cases are fixture
  evidence, not deployed-database equivalence or full trigger semantics.
- PR845 exact head `d6ee312ee4f46675a0ed412875d5aa083cc8c6e7`, base
  `92f9041397ab48c261a433ae76f380e3a154d598`, extends the shipped read-only
  inspector with stable internal foreign-key trigger identities and enabled/
  deferrability validation. It keeps hashed observations and explicit false
  schema-equivalence/activation flags. The harness now requires the disabled
  internal-FK negative to alter the shipped inspector inventory itself.
  Actual CPython3.14 tests passed19 inspector +20 harness; actual PostgreSQL16.15
  rejected all seven negative cases (receipt6233051417). Report SHA256:
  `a4084529a4c35d3e1275d5acf17639f1257f9fa40fc4aa78ef07dde5d5ee8896`.
  Cleanup inventory was empty (`[]`, receipt6233062084).
  Source review Mailbox639/comment6233053484 and runtime-evidence supplement
  6233072717 together returned final GREEN, closing request6233070622. Merge
  intent6233088291 preceded merge `1406845c8728a75652e10cd29c999494745c9034`.
  All postchecks SUCCESS: Safety39026876826, Smoke39026876821,
  Coordinator39026876861 and Pages39026876340. Final receipt6233127412 COMPLETE.
- Publisher setup remains PREPARED_NOLOGIN. The one-shot approval6231898914
  was consumed by the successful setup; completion6232054311 and corrected
  archive evidence6232007999 remain authoritative. No setup/recovery replay.
  Source merges and local fixture tests do not authorize LOGIN, credential
  rotation, workflow installation, dispatch, publication, trading or closure.
- Working method remains `docs/autonomy/AGENT_EFFICIENCY.md`: large bounded
  packages, bounded implementation subagents and the existing GitHub reviewer/CI
  within their permissions, exact evidence reuse and consolidated handoffs. Mandatory independent review and exact-head gates stay.
- Next: publish this consolidated continuity packet on the actual
  verified main with its own CI/review. Gate A remains incomplete: application
  triggers/functions/columns/constraints are still hashed observations without
  reference comparison. Next coherent source package: pinned fixture reference
  manifest plus strict inspector comparator; then all seven negative cases
  through that comparator in the private PG16 cluster; then an exact, separately
  reviewed/owner-approved read-only launch packet for deployed schema/grants.
  Avoid an observation-only credential-bearing run that would need repetition.
  The narrow target claim is pinned publisher fixture catalog match; universal
  schema equivalence and activation remain false. Gates B-D retain separate
  authorization. Local fixture success is not live-runtime readiness.

## Historical source and runtime checkpoint after PR843 — superseded

Operation HANDOFF-840-REBASE-20261017-02. Verified source main:
`be757e076aac3e43dcc3bd03c4387c0550098d74` (#843). Build **10.0-r129**.
This section supersedes older operational summaries below. PR840 R2 awaits
publication and its own exact-head CI/full-scope review after the completed
PR843 merge block; no publication SHA
is claimed for this four-file continuity candidate.

- PR841 merged the three-document commissioning source proposal. Full-scope
  GREEN_LIGHT6232174405; exact-head Release Safety39020140466,
  job117360147402:2577 pass. All four postchecks now succeeded: Release Safety
  39020575857 on the exact merge head, Runtime39020575867, Coordinator39020575859
  and Pages39020575389. FINAL_MERGE_STATUS6232198129 is now COMPLETE;
  companion receipt6232135507 records the completed source packet.
  `docs/autonomy/PUBLISHER_TEST_COMMISSIONING_20261017.md` requires a narrow,
  read-only full-schema/effective-grant inspection first. It is not execution
  ready for runtime: inspector PR842 merged at
  `ce773b46c80cb1de32bb2f6f8f1dd0b3b9544243` from reviewed head
  `4b9f34f0f027290d31240b9724e4c1e770e4e432`, based on the PR841 merge.
  The test-only0600 fixture fix passed independent review; the real guard is
  unchanged. Fresh directory `readonly-inspector-4b9f34f0` matched all eight
  source hashes. Actual Python3.14.2 tests passed16/16 in0.585s, exit0
  (PR842 receipt6232272047). The earlier head
  `c9b0240784bfbf6a808503196ea0cd2aeaa9eb38` returned15 PASS/1 FAIL because
  its synthetic resource fixture inherited default ACL mode0664 despite umask077;
  that historical failure is retained. Exact-head CI39021277272/job117363417019
  succeeded:2578 PASS, zero failures/cancelled/skipped, all named gates passed
  on Node20.20.2. Full GitHub Claude review PUBLISHER-READONLY-842-R2 was
  requested in Mailbox639/comment6232321604; full review6232323929 and
  dependency supplement6232377121 returned GREEN. Final receipt6232392891
  is COMPLETE together with receipt6232272047. All four postchecks succeeded:
  Safety39021975402, Smoke39021975406, Coordinator39021975419, Pages39021975153.
- Efficiency PR843 merged at `be757e076aac3e43dcc3bd03c4387c0550098d74`
  from head `2d9a5fe61022086805375fb667a8d16210bef6e6`,
  base `ce773b46c80cb1de32bb2f6f8f1dd0b3b9544243`. Its two files were read back
  and verified. CI39022048999/job117365641168 succeeded:2578 PASS, all steps
  passed. Full GitHub review AGENT-EFFICIENCY-843-R1 was requested in
  Mailbox639/comment6232463692 and returned GREEN6232466260. Final receipt
  6232488407 and companion6232405394 are COMPLETE. All postchecks succeeded:
  Safety39022680790 attempt2/job117369415872:2578 PASS, zero failures/skipped/
  cancelled, all steps SUCCESS; Coordinator39022680786, Smoke39022680804 and
  Pages39022680939 SUCCESS. Safety attempt1/job117367453660 had2572 PASS and
  six Chrome/CDP startup/connection timeout failures with a missing visual artifact.
  The single accepted retry passed on the unchanged source tree; the cause remains
  unproven. That failed attempt is preserved, not relabelled as successful.
  Owner mandate at2026-10-17T11:41:50+02:00
  (PR843/comment6232405394): "Speichere die Arbeitsweise ab und arbeite zukünftig
  so - go". Bootstrap working-method reference: `docs/autonomy/AGENT_EFFICIENCY.md`
  is now on main and adopted for future work: use its bounded-package/evidence-reuse
  contract without weakening existing gates. No credential access, LOGIN, workflow
  installation, dispatch or NOLOGIN closure is authorized by these source merges.
- PR839 merged from head `63ac7f6b3f2fa7092ac49a4e0ed2b74cca48fa3d`, base
  `f7d3f09c786dc85d1bb11c9a3233a6f1abd08cff`. Full-scope R2
  GREEN_LIGHT6231677150; exact-head Release Safety39015820662,
  job117347598614:2577 pass, zero fail/cancelled/skipped.
  FINAL_MERGE_STATUS6231690035 COMPLETE. All four postchecks succeeded:
  Release39017117794, Runtime39017117769, Coordinator39017117829,
  Pages39017117864. PR839 source packet complete.
- Owner exception6231581318 was consumed for that exact PR839 head only. It
  allowed review reliance on exact-tree hosted tests and independently executed
  local evidence rather than requiring Claude personally to execute head tests.
  Source review and exact-head CI remained mandatory. It changes no permanent
  review policy, workflow, tool permission or credential boundary. The permanent
  workflow fix remains unapproved; do not generalize this exception to future PRs.
- Stored Feather evidence consistency is now merged: six Node checks bind stored
  claims to current producer/helper/lock/input-manifest bytes and scope fields.
  Hosted2577 includes those six checks. Local nine Python tests and genuine
  independent report reproduction remain separate execution evidence; the static
  gate proves neither execution nor unavailable output-binary bytes. JSON836's
  strict1390-cell failure remains valid. Feather837's exact input-format parity
  is not signal/accounting/performance parity, holdout or profitability proof.
- The actual72 targeted tests passed (6231846832). Owner approved one setup
  attempt at2026-10-17T10:45:44+02:00 (6231898914); that approval is consumed.
  Reviewed literal launch hash d87fa27882cabc3d2fb8d60b176d651097cff404f3049cd5435dd60cb32d661b
  executed once at08:57:36Z (6232021281). Result6232023986 records
  AUTO_SETUP_PREPARED_NOLOGIN, SETUP_EXIT=0 and LAUNCH_OUTER_EXIT=0.
  This narrowly confirms six acknowledged TEST environment-secret writes and
  the supervised DB password transaction/cleanup; the three roles remain NOLOGIN.
  It proves neither password login nor live readiness, and authorizes no retry.
- Independent local postcheck passed: new active marker device45/inode1459374,
  UID1000, mode33152 (0600 regular), nlink1, size53,
  mtime=ctime1792227465428047843. Prior archive bytes verified unchanged.
  Reconciliation6232007999 corrects the archive operation to
  `7b9b75d21315ee2bd4b5acd895f9c556`; the old receipt6230893412's differing
  `7bb75d21315ee2bd4b5acd895f9c556e` is retained historically, not silently rewritten.
  Dependency comparison covered91+32 files; the earlier33 typo is corrected in
  result6232023986. These checks are not full runtime/OS byte attestation.
- GitHub metadata post-verification passed (6232054311), POST_METADATA_EXIT=0.
  Seven bounded GETs confirmed identities, protections and database binding;
  all six expected environment names occur exactly once, with zero repository
  target names. Creation/update timestamps match, spanning08:57:51–08:57:54Z.
  Together with the local marker/archive check, preparation postchecks are complete.
  This remains PREPARED_NOLOGIN only: no independent DB corroboration, password
  login, activation or workflow dispatch occurred. Stored secret-value equality
  and live readiness remain unproven. Preserve both marker and archive.

Priority remains the accepted roadmap831: publisher operational, first proven
autonomous development cycle, then controlled sustained operation. No new product
scope or feature expansion is introduced. ChatGPT leads bounded agents and
integration; Mailbox639, exact-head/base gates and independent review remain.
CV2 SOURCE_AUDIT/all seven flags false and r129 are unchanged.
NEXT: preserve the completed PR841 postchecks and PREPARED_NOLOGIN setup
checkpoint, and submit this rebased continuity update through its own source
review gates. PR843 postchecks are complete; publish this consolidated R2 packet
on verified main through its own exact-head CI and independent full-scope review.
The working-method contract is merged and adopted. No source merge alone makes
a runtime proposal execution ready. Any credential access,
DB corroboration, LOGIN, workflow installation/dispatch or NOLOGIN closure needs
its separately reviewed and approved scope; no consumed action may be repeated.

## Historical checkpoint after PR838 — superseded

Operation HANDOFF-839-PREPARE-20261017-01. Verified source main:
`f7d3f09c786dc85d1bb11c9a3233a6f1abd08cff` (#838). Build **10.0-r129**.
This section supersedes older operational summaries below. The next eight-file
candidate combines four Feather evidence-consistency files and four continuity
files; its publication SHA and new hosted CI result are not yet established.

- PR838 source proposal merged from head
  `45720cfe366e8de4d9db4907f48cb817a5439b7e`, base
  `0ff8667a5fab5df7634d81f677160c42a4dfe5ee`. Full six-file source-only
  GREEN_LIGHT6231388398; exact-head Release Safety39014393621,
  job117343371225:2571 pass. FINAL_MERGE_STATUS6231435476;
  all four postchecks succeeded: Release39015392147, Runtime39015392217,
  Pages39015391836 and Coordinator39015392112. PR838 source packet complete.
- The merged TEST setup documents are proposals, not runtime readiness or approval.
  Approval remains null, setupAuthorized false, setup not executed. Relevant
  real-toolchain launch review remains outstanding before a separate concrete
  owner approval and fresh operational gates. The earlier31 recovery fixture
  tests do not prove the new setup launch. Recovery6230893412 is complete,
  approval6230643903 consumed; never replay or remove its archive.
- Feather837 establishes exact input-format parity only:3200 rows and16000
  binary64 values, zero mismatch,16 primary Arrow calls and0 fallback. JSON836
  remains a strict1390-cell numeric failure. No strategy, signal/accounting or
  performance parity, holdout, profitability or promotion is established.
- The prospective four-file evidence-consistency packet is local evidence only:
  six Node checks passed, nine isolated Python tests passed, genuine upstream
  reproduction exited0 with byte-identical report. The generated report adds
  only its producer source hash; previous data results remain unchanged.
  Static checks bind stored claims to current source/lock/input manifest and
  preserve JSON failure. They cannot prove execution or verify unavailable
  Feather binary bytes; output hashes receive syntax/association checks only.
  No full hosted CI or merge is claimed for this new candidate.

Priority remains roadmap831: publisher operational -> first proven autonomous
development cycle -> controlled sustained operation. ChatGPT leads bounded agents,
integration and delegated merges. Mailbox639; exact-head/base CI, full independent
review and postmerge gates remain. CV2 SOURCE_AUDIT/all seven flags false, r129
unchanged; no trading or activation is authorized.
Runtime access is currently blocked by an Apple identity-verification generic
error. The targeted72 tests have not executed; setup has not executed. This
authentication blocker is separate from the completed source review and CI.
NEXT: publish the evidence-consistency/continuity candidate for its own exact-head
CI and full review. Restore the authorized session and complete the separate setup
launch evidence and review before requesting concrete execution approval.

## Historical checkpoint after PR837 — superseded

Operation HANDOFF-838-PREPARE-20261017-01. Verified source main:
`0ff8667a5fab5df7634d81f677160c42a4dfe5ee` (#837). Build **10.0-r129**.
This section supersedes older operational summaries below. The current six-file
candidate contains four continuity files and two source-only TEST setup proposal
documents; it has no claimed publication SHA or setup execution authority.

- PR837 merged from head `37fad9a5ac98b05f886a7f35562cfa954f8055cc`, base
  `61b2f00461ecb6b560fc454decce0ca83f62b06c`. Full eight-file independent
  GREEN_LIGHT6231176025; exact-head hosted Release Safety39012873646,
  job117338924782:2571 pass, zero fail/cancelled/skipped.
  FINAL_MERGE_STATUS6231263445. All required postchecks succeeded on the merge:
  Release39014125299, Runtime39014125293, Coordinator39014125291,
  Pages39014125002. Source packet complete.
- Feather diagnostic is now merged, with exact input-format parity only:
  3200 rows,16000 binary64 OHLCV values, zero differences;16 observed primary
  Arrow loads and0 fallback. Nine isolated Python tests and independent actual
  CLI reproduction passed; integration report/completion manifest byte-identical.
  These manual Python tests are separate from hosted Node CI. The prior JSON
  loader's1390/16000 numeric failure remains valid and is never relabeled.
  No signal/accounting/performance parity, holdout or profitability is established.
- Recovery remains complete6230893412, with final
  OWNER_RECOVERY_ARCHIVED_NO_SETUP_AUTHORIZED and outer exit0, independently
  verified archive operation `7bb75d21315ee2bd4b5acd895f9c556e`.
  Approval6230643903 is consumed. Do not replay recovery or remove its archive.
- Subsequent TEST setup is a two-document source-only candidate. Its approval
  field is null and setupAuthorized is false; nothing has executed. The source
  pins verified on61b2 remain valid unchanged after837; creation provenance is
  retained. Exact launch/source review, required CI and relevant toolchain checks
  precede separate concrete owner approval and fresh operational checks.
  Proposed effects are six environment secrets and passwords for three existing
  roles kept NOLOGIN. The plan acknowledges non-atomic provider/DB effects and
  provider logging, excludes retries/activation, and includes metadata plus
  marker/archive checks; optional DB corroboration needs a separately reviewed
  private read-only invocation. No secret-value equality or login proof is claimed.

Priority remains roadmap831: publisher operational -> first proven autonomous
development cycle -> controlled sustained operation. ChatGPT leads bounded agents,
integration and delegated merges. Mailbox639; exact-head/base CI, full review and
postchecks remain required. CV2 SOURCE_AUDIT/all seven flags false; no strategy
promotion or trading authority is introduced.
NEXT: publish the six-file setup proposal/continuity candidate for exact-head CI
and full independent review. Request the separate
concrete owner approval only after that scope is ready for execution review.

## Historical checkpoint after PR836 — superseded

Operation HANDOFF-837-PREPARE-20261017-01. Verified source main:
`61b2f00461ecb6b560fc454decce0ca83f62b06c` (#836). Build **10.0-r129**.
This section supersedes older operational summaries below. This handoff
candidate has no claimed publication SHA.

- PR836 merged from head `41440ce5a724d885c0e953a4d571eb194529cc55` and base
  `c1740225b9682534cf1fdaa0128053604e4b86da`. Combined full nine-file independent
  GREEN_LIGHT reviews6230966533 and6231035458. Exact-head hosted Release Safety
  39011628028/job117335191215 passed2571 tests, zero fail/cancelled/skipped.
  FINAL_MERGE_STATUS6231062545 COMPLETE. All required postchecks succeeded:
  Release39012695229, Runtime39012695196, Coordinator39012695212,
  Pages39012694761. Skipped mailbox runs are not counted.
  Local full-suite browser attempts were incomplete, not local green; successful
  hosted browser acceptance is separate evidence on the exact source tree.
- The merged JSON loader diagnostic retains its strict numeric failure:
  1390 of16000 OHLCV cells differ; all3200 rows preserved. Eight isolated Python
  contract tests passed. No tolerance was widened or strategy executed.
- The current four-file Feather candidate is locally independently reviewed,
  not merged:9 tests passed; actual unmodified upstream store/raw/public load
  preserved3200 rows and16000 binary64 OHLCV values exactly, with16 observed
  primary Arrow calls and0 fallback. This proves exact input-format parity only.
  Reproduction on the integrated candidate returned exit0 and byte-identical
  report/completion manifest; all five JSON dependencies remained byte-identical.
  JSON failure remains valid; no signal/accounting/performance parity or strategy
  profitability is established. The candidate requires its own exact-head gates.
- Recovery remains complete (6230893412), final
  OWNER_RECOVERY_ARCHIVED_NO_SETUP_AUTHORIZED and observed outer exit0.
  Independent archive inspection passed for operation
  `7bb75d21315ee2bd4b5acd895f9c556e`. Approval6230643903 is consumed; never replay.
  Provenance6230854680 is corroborated managed-platform origin, not exhaustive
  interpreter/stdlib/OS byte attestation. No subsequent setup has executed.
- Subsequent TEST setup scope and exact launch are documentation proposals only.
  Separate owner approval, source gates and fresh operational checks remain
  required. The plan preserves NOLOGIN and accounts for new secret metadata,
  a new attempt marker and the unchanged prior archive; it claims no secret-value
  equality, login success or operational readiness.

Priority remains roadmap831: publisher operational -> first proven autonomous
development cycle -> controlled sustained operation. ChatGPT leads bounded agent
assignments, integration and delegated merges; exact-head/base CI, full independent
review and postmerge gates remain. Mailbox639. CV2 stays SOURCE_AUDIT/all seven
flags false; no trading or strategy promotion is authorized.
NEXT: publish the Feather plus continuity candidate for its own exact-head CI
and full independent review. Review the concrete TEST setup proposal separately;
setup execution requires separate owner approval.

## Historical source/runtime snapshot after PR835 — superseded

Operation HANDOFF-835-CONTINUITY-20261017-01. Verified source main:
`c1740225b9682534cf1fdaa0128053604e4b86da` (#835). Build **10.0-r129**.
This section supersedes older operational summaries below. The publication SHA
of this handoff candidate is unknown until publication/readback.

- Recovery invocation #835 is merged and source-complete. Reviewed head
  `51c5a7485b89ba948b0661cc9fa668c1fbbd72ae`, base
  `80daf2b7a5cc2ae0af5b6792583999d69451282c`. Exact-head Release Safety
  39010594230/job117332117371 succeeded: 2571 pass, zero fail/cancelled/skipped.
  Full four-file R2 source review GREEN_LIGHT6230801877. All required postchecks
  succeeded: Release39011004056/job117333337616, Runtime39011003935,
  Coordinator39011003957, Pages39011003549; additional Asset Watch Mirror
  39011028345 also succeeded. FINAL_MERGE_STATUS6230822828.
- Actual Codespace CPython3.14.2 tests: 9 invocation fixtures +22 wrapper tests
  passed (issue829/comment6230767676). The earlier fixture failure was traced
  to baseline permissions0646; the test now creates0600. Production protections
  and the proposed2918-byte Python body remained unchanged. Synthetic test
  execution is not production recovery evidence.
- Approved production recovery completed once (issue829/comment6230893412):
  final OWNER_RECOVERY_ARCHIVED_NO_SETUP_AUTHORIZED and outer RECOVERY_EXIT=0.
  Independent read-only archive verification passed for operation
  `7bb75d21315ee2bd4b5acd895f9c556e`: original marker absent, archive directory0700
  owned by1000, files0600/nlink1, original inode/content preserved except ctime,
  byte-exact evidence schema and pins verified. Do not rerun the archive action.
- Owner approval6230643903 covered ARCHIVE_PUBLISHER_ATTEMPT_ONCE and has now
  been consumed by the completed action. Later setup was not executed and needs
  a separate concrete approval; neither source review nor archive success grants it.
- Runtime intent6230854680 records corroborated owner-controlled official-platform
  provenance, not full interpreter/stdlib/shared-library/OS byte attestation.
  Ten staged files were byte-checked (6230690862); dependency evidence6230628600
  covers89+15 package files against pinned official wheels, with stated exclusions.
  Earlier read-only reconciliation6230532439 remains historical point-in-time
  evidence; its unchanged-marker observation predates the completed archive.
- Freqtrade data bridge #833 remains merged with all postchecks successful.
  The subsequent five-file loader diagnostic is locally reviewed, not yet published
  or merged. Actual upstream raw/public loading preserved all3200 rows and failed
  the strict numeric parity gate:1390/16000 OHLCV cells differ, maximum absolute
  difference3.552713678800501e-15. No tolerance was widened. Public equals raw;
  a separate precise-float probe is diagnostic only, never replacement output.
  Loader numeric parity, signal/accounting parity, fresh holdout, forward evidence
  and strategy profitability remain unproven. No automatic strategy promotion.

Priority remains roadmap831: publisher operational -> first proven autonomous
development cycle -> controlled sustained operation. ChatGPT leads bounded
agent assignments, integration and delegated merges (6229644994); single writer,
exact-head/base CI, full independent review and postmerge gates remain. Mailbox639.
CV2 remains SOURCE_AUDIT/all seven flags false; runtime trading is not authorized.
NEXT: prepare the concrete subsequent setup scope for separate owner approval;
never replay the completed archive. Integrate the locally reviewed Freqtrade
strict-failure diagnostic with exact-head CI and independent review before merge.

## Historical source/runtime snapshot — superseded by current section

Operation HANDOFF-833-RUNTIME-20261017-01. Verified source main:
`6473022aebcaf795888cff18ff787bfc392a4107` (#833). Build **10.0-r129**.
This section supersedes older operational summaries below. The publication SHA
of this handoff candidate is not claimed before publication/readback.

- Recovery wrapper #830 merged at `d8a12f8dfeb25843d186111094e1cdc1fbb35b0d`.
  Full-scope Claude GREEN_LIGHT6230151464; all required postchecks succeeded:
  Release39006876899, Runtime39006876912, Coordinator39006876853,
  Pages39006876433. FINAL_MERGE_STATUS6230257540. Reviewed source is ready;
  actual marker recovery and a subsequent setup have NOT been performed.
- Freqtrade data bridge #833 merged at the source main above. Exact-head
  CI39008410841:2570PASS0FAIL; full-scope Claude GREEN_LIGHT6230496927.
  All postchecks succeeded: Release39008848892, Runtime39008848823,
  Coordinator39008848846, Pages39008848372. FINAL_MERGE_STATUS6230525372.
  Eight assets x400 saved daily candles exported with retained source volume.
  This is data preparation only: Freqtrade execution, signal/accounting parity,
  fresh holdout, forward evidence and strategy profitability remain unproven.
- Current runtime evidence: issue829/comment6230532439,
  RUNTIME-READONLY-20261017-02. Existing pinned reconciliation runner invoked
  once in the existing Codespace. Observed RECONCILE_READ_ONLY_CHECKS_PASSED
  and outer RECONCILE_EXIT=0; post-check marker unchanged. Provider -> supervised
  read-only DB -> provider checks passed at this point in time. No recovery,
  setup, role/credential mutation or marker change. Hashes and package metadata
  are not independent attestation of the entire installed runtime.
- Owner moved continuation here at08:04:42+02 and said at08:06:39+02
  "Wenn dann nur über dich". No separately owner-initiated setup reported;
  do not turn this into proof that no unrecorded assistant attempt ever occurred.
- Priority remains roadmap831: publisher operational -> first proven autonomous
  development cycle -> controlled sustained operation. Close bounded OSS work
  alongside it; then pinned Freqtrade loader/H1-B signal/accounting comparison.
  No extra trading frameworks or automatic strategy promotion.
- Concrete recovery-scope preparation:
  `docs/autonomy/PUBLISHER_RECOVERY_SCOPE_20261017.json`.
  It binds reviewed source and historical failed manifests, baseline, CLI/CA
  pins, marker and proposed action. It is a proposal, not owner approval or an
  executable/authenticating launcher. Fresh exclusive window, trusted runtime,
  bootstrap source verification, exact invocation review and separate concrete
  recovery approval remain required. A later setup requires another approval.

ChatGPT retains owner-delegated merge decisions (6229644994), single-writer,
exact-head/base CI, full independent review and postmerge gates. Mailbox639.
CV2 remains SOURCE_AUDIT/all seven flags false; runtime trading is not authorized.
NEXT: review this handoff/scope packet; prepare and verify the exact short-lived
recovery invocation, obtain its concrete owner approval, then archive once with
fresh reconciliation. Never repeat a failed/uncertain action automatically.

## Historical completion snapshot — superseded by current section

Operation: HANDOFF-824-825-20261017-01. Verified source main:
`bfebd17ddfa1d2d3b44a15126e28618a82cb81f2` (#828). Build **10.0-r129**.
This section supersedes all older operational summaries below. This handoff
candidate has no claimed publication SHA.

- Arena #824 merged at `ed60066fc58b4d60eddd727c24cae61c368720bb`.
  Full-scope review 6229617979; all six postchecks succeeded:
  Release39002934108, Runtime39002934109, Coordinator39002934102,
  Visual39002934147, Orchestration39002934170, Pages39002933046.
  FINAL_MERGE_STATUS6229668839. Retrospective offline diagnostic only;
  no forward/holdout/profitability proof, no runtime orders or auto-promotion.
- Publisher #825 merged at `8691381510039e2ad48b863ea5e66d6ad6cba462`. Full four-file review
  6229794718; premerge CI39003151050 succeeded (2561 pass, zero failures).
  Local19 fault tests passed CPython3.14.2 with pinned dependencies.
  FINAL_MERGE_STATUS6229853101. All four postmerge checks succeeded:
  Release39004204488, Runtime39004204504, Pages39004203840;
  Coordinator39004204485. Source packet complete.
- Read-only owner-path inspector #828 merged at the verified main above.
  Review6229960697; FINAL_MERGE_STATUS6229980850. Postchecks pending.
  No production caller, recovery or setup was added.
- The publisher primitive is inactive: no CLI or production caller.
  A future reviewed wrapper must establish canonical passwd-owner paths,
  authenticated approval/source evidence, fresh exclusivity and provider/DB
  reconciliation. Any propagated exception must be treated as uncertain.
  Real marker, credentials and DB were not touched.
- Owner instruction at 2026-10-17T06:31:42+02:00:
  “Du kannst selbst zukünftig über merges entscheiden - freigabe erteilt”.
  Recorded in mailbox639/comment6229644994. ChatGPT now decides future merges;
  older per-merge owner-confirmation requirements are superseded. Exact-head/base
  CI, full independent review, single writer, expected-head guards and successful
  postchecks remain mandatory. This delegates merge decisions only, not runtime
  recovery/setup, activation, trading, spending or schedule/credential changes.

- Owner working model at 2026-10-17T07:04:42+02:00: Christoph sets direction;
  ChatGPT is chief developer for architecture, coherent work packages, agent
  assignments, integration, quality and merge decisions. Agents implement bounded
  scopes or independently review; single-writer and runtime gates remain intact.

NEXT: verify #828 postchecks, complete #826 continuity review and prepare the separately reviewed
runtime wrapper. Concrete recovery and subsequent setup remain separately
owner-gated. CV2 remains SOURCE_AUDIT with all seven flags false; CRV unresolved.
Autonomous end-to-end live development remains unproven.

## Historical Arena candidate — superseded 2026-10-16

Build: **10.0-r129** (unmerged candidate). Canonical merged source remains
`0a32b25c5be4db4d0ae7d3473c664bd7c35e326d` (#821; all four postchecks passed,
FINAL_MERGE_STATUS 6214143240). Earlier current-summary sections below are
historical snapshots, superseded by the live checkpoint for current work.

Owner mandate at 22:35:21+02:00 authorizes isolated strategy Paper-arena integration
and evaluation with agents. Four offline virtual models (H1-B, H1-E, H7-B, H7-R)
plus H9 BLOCKED_DATA; no connected Paper/runtime orders or Live activation.
Source/rules receipts precede replay; historical output is diagnostic, not fresh
Holdout or forward proof. CRV compatibility remains unresolved, not waived.
All CV2 SOURCE_AUDIT authorization flags remain false; publisher recovery/setup
remain separately gated. See `docs/strategy-lab/PAPER_ARENA_PROTOCOL_20261016.md`.

NEXT: complete local engine/receipt/UI checks, exact-head CI and independent
full-scope review before a guarded merge. No candidate publication SHA is claimed.


## Historical handoff — 2026-10-16 (superseded)

This section is the current operational summary. Historical snapshots below are
retained for provenance, not as instructions or evidence of present state.

- Verified source main: `2736f9d1d98988858373c05c05a7d5a67cbca27b`; PR **#814**
  merged. FINAL_MERGE_STATUS: **6201503547**. Reviewed head
  `c9c3f9b489b3f16fb2e9d90738483f4948a317a0`, base
  `48275e8ac149806859d698e7b29cb375dee73ff3`; full-scope Claude review
  **6201457990 GREEN_LIGHT**. Exact-head Release Safety
  **38793459593/job 116648593675** succeeded: 2,525 passed, 0 failed,
  cancelled, skipped, or todo (Node **20.20.2**).
- PR **#814 source packet is complete**; this handoff refresh is still pending
  publication. All four required post-merge checks succeeded on
  `2736f9d1d98988858373c05c05a7d5a67cbca27b`: Release Safety **38801351055**,
  Runtime Smoke **38801351069**, Release Coordinator **38801351260**, and Pages
  **38801348792**. The future publication commit for this refresh is not yet known.
- Prior housekeeping evidence remains historical: #818 merged at
  `7dc94b9108e25d742bef7652fb7511c5cb5108ea` (FINAL_MERGE_STATUS **6199370528**;
  all five post-merge checks succeeded). #819 merged at
  `48275e8ac149806859d698e7b29cb375dee73ff3` (FINAL_MERGE_STATUS **6199797884**;
  Release Safety **38788973884**, Agent Orchestration **38788973900**, Release
  Coordinator **38788973917**, Runtime Smoke **38788973928**, and Pages
  **38788972716** all succeeded).
- Terminal build: **10.0-r128**; checkpoint protocol: **STREAM-SAFE-V8**.
- Active work: complete PR #821 on its revised candidate with exact-head CI and
  independent full-scope review, then lead-guarded publication. No infrastructure
  action is authorized by this refresh.
- Authoritative mailbox is now **#639**, predecessor **#571**; watchdog status
  comment is **6198924473**. Superseded rollover PR **#640** is closed.
  Successor read/delivery/response smoke **PASS**, response **6199499751** to request **6199490288**. Predecessor #571 is closed as completed historical archive (6199526147). Resolve routing from `MERIDIAN_LIVE_CHECKPOINT.json`.
- Four disabled Autopilot prompts now use checkpoint-driven routing (current
  mailbox **#639**) and remain disabled. The enabled management automation
  already uses dynamic routing. Read-only event pilot **#673** is unchanged.
- V2 remains **SOURCE_AUDIT**. Canonical execution, strategy PnL, Discovery,
  Validation, Holdout, Paper and Live authorization remain **false**.
- Trial-history coverage and authorized reproduction budget remain **UNKNOWN**;
  the #814 inventory is bounded/incomplete. No new empirical work, backtest, or
  strategy PnL is authorized or claimed.
- Publisher setup: failed owner attempt documented in #571 comment
  **6198795959**; the one-shot marker remains untouched. Mailbox comment
  **6199968669** records the owner continuation at **2026-10-16 09:26:47 +02:00**
  and a point-in-time **Stage 1 read-only reconciliation PASSED** using runner
  revision `f0204ec0781598d9fb368088021b33e738505ed4`. The recorded owner-window
  confirmation at **09:21:31 +02:00** was “nein parallel arbeitest nur du daran.”
  The earlier pause and browser-unavailable statements are historical and
  superseded. Provider/DB results are point-in-time only; long-term Codespace and
  current provider/DB state remain unknown. Sign-in was restored for that Stage 1
  session; ongoing browser state is unknown. No password/secret/LOGIN writes were
  reported, but absence of previously assigned role passwords is **NOT
  ESTABLISHED**. Stage 2 is **PLAN_ONLY**: CPython **3.14.2** tests, exact-head CI
  and independent full-scope review precede any concrete recovery approval.
  Marker retirement and a subsequent setup attempt remain separately
  owner-gated. No recovery implementation, marker retirement or setup attempt
  occurred; the first hosted watchdog PATCH remains unproven and the lead
  activation edit is not bot evidence. The publisher lane's next permitted step
  is Stage 2 plan review only, not runtime recovery.
- Decision records **6103358472**, **6178949360** and **6197277097** are resolved.
  Stale items **#653, #675 (issue), #686 and #690** are closed with readback.
  Clock-skew/#811 reconciliation: **6198817919**; retrospective
  FINAL_MERGE_STATUS for #782: **6198847209**.
- Owner approved **#818 housekeeping and WIP limit 3** at
  **2026-10-15 20:16:49 Europe/Vienna**: “Ja Freigabe erteilt”, recorded
  RESOLVED in comment **6199107184**. WIP is limited to three active packages;
  remaining proposals belong in backlog. Watchdog source routing is merged and active,
  but the first hosted watchdog PATCH remains unproven. The lead activation edit is not bot evidence. Do not infer
  Codespace shutdown from this handoff.

- Historical #814 run **38776991839**, head
  `43a351328159bf9526c6bba1f8ff93f91a2298cc`, attempt 1, remains
  `action_required`/not executed. Preserve it as historical blocked evidence;
  it was not retrospectively passed by the later #814 merge.
- Six further historical decisions were marked RESOLVED in place with existing quote/time evidence: 6171848445, 6187867522, 6175341101 (SUPERSEDED), 6177231926, 6177550606, 6178534667. No new authority granted.

### Resume and completion rules

Read the checkpoint-selected mailbox, current main and relevant CI before acting.
Mailbox **#639** is active; #571 is archived. All seven research/execution
authorization flags remain false; V2 remains **SOURCE_AUDIT**. Four disabled
Autopilot prompts remain disabled, management routing remains unchanged, and
read-only event pilot #673 is unchanged. WIP limit **3** and the #818 owner
approval history remain in force.

Immediate PR #821 closure requires exact-head CI and independent full-scope
review on the revised candidate, followed by lead-guarded publication. Do not
infer the publication commit from source main. After this handoff closure, the
publisher lane's next permitted step is Stage 2 plan review only, requiring
CPython 3.14.2 tests, exact-head CI and independent full-scope review before any
concrete recovery approval; marker retirement and a subsequent setup attempt
remain separately owner-gated. The strategy lane's next step is source-only
PR #823. None of these handoff statements authorizes runtime recovery or setup.

Validation evidence is commit-scoped. The earlier Node **v24.21.0** checks and
Node-20-unavailable notes are historical observations, superseded by the verified
official Node **v20.20.2** run on commit
`4cbdf5bf4a12a44bfbea61ca7cb26a26d98bf87d` (Python **3.12.3**). The official
Linux x64 archive passed Node.js `SHASUMS256.txt` verification
(`df770b2a6f130ed8627c9782c988fda9669fa23898329a61a871e32f965e007d`); binary
SHA-256 `6295488653f0d93b0a157841746fef7e72cc4328cfb60c4bbe0ca2668a836ffd`.
On that commit, `npm ci --ignore-scripts` passed; `node
scripts/continuity-audit.mjs` passed (r128); `node
scripts/frozen-research-guard.mjs` passed (140 checked, 0 mismatches);
`V11_A2_EVIDENCE_DIR=artifacts/v11-visual-qa node --test test/*.test.js`
passed (2,525/2,525); `node scripts/release-sync.mjs --check && node
scripts/release-check.mjs`, `node scripts/v10-ui-regression-check.mjs`, `node
scripts/privacy-check.mjs`, and `node scripts/secret-check.mjs` passed;
`python3 -B scripts/validate-agent-orchestration.py`, checkpoint JSON, and
`git diff --check` passed. Exact-head Release Safety **38806497445**, attempt 2,
job **116681553158**, also succeeded on that same commit. These results do not
cover later heads.

The intervening commit `9d2665d4e97fee4e5745553d93bb61ad81a23a00` added only
generated PNG/`.pyc` files; those exact generated paths were removed, and
Release Safety **38811069787** for that dirty head was `action_required`, not a
pass. On the cleaned candidate `95fd925aa3d7aed3b18411becee189a8c0934687`,
Node **v20.20.2** and Python **3.12.3** validation passed:
`python3 -m json.tool MERIDIAN_LIVE_CHECKPOINT.json`;
`node scripts/continuity-audit.mjs` (r128);
`node scripts/frozen-research-guard.mjs` (140 checked, 0 mismatches); and
`PYTHONDONTWRITEBYTECODE=1 python3 -B scripts/validate-agent-orchestration.py`
(GREEN). Node was selected with
`PATH=/tmp/meridian-node20-final/runtime/bin:$PATH`; bytecode was disabled and
`V11_A2_EVIDENCE_DIR=/tmp/meridian-node20-final/artifacts/v11-visual-qa`
kept any screenshot output outside the repository. No full suite was rerun on
that documentation-only candidate. Exact-head Release Safety
**38855226605**, attempt 2/job **116863146674**, succeeded on **95fd925**:
2,525 passed and 0 failed, cancelled, skipped or todo. Claude review
**6212356397** returned **REVISION_REQUIRED** on **95fd925**. Neither result
covers the corrected candidate; its exact-head CI and independent full-scope
review remain pending. No workflow dispatch/retry has been made.

On the corrected working tree derived from `95fd925`, the official Node
**v20.20.2** runtime archive was checksum-verified again. `python3 -m json.tool
MERIDIAN_LIVE_CHECKPOINT.json`, `node scripts/continuity-audit.mjs` (r128),
`node scripts/frozen-research-guard.mjs` (140 checked, 0 mismatches),
`PYTHONDONTWRITEBYTECODE=1 python3 -B scripts/validate-agent-orchestration.py`
(GREEN), and `git diff --check` all passed. The exact commands, runtime path,
archive checksum and Python **3.12.3** version are recorded in the checkpoint.
These are local working-tree checks, not exact-head CI; the revised candidate
still requires fresh CI and full-scope review. No full test suite or visual
artifact generation was run for this documentation-only correction.

---

## Historical archive — superseded operational snapshots


## Frozen / protected references
- Frozen legacy dashboard: `archive/v7.65-dashboard-frozen-20260905` at `8ddca55f194fb517a244cd45ae142cf28e2a8fd4`.
- Pre-cutover production rollback branch: `archive/v8-r11-production-pre-cutover` at `bdfc64f8cf588d5b4c3d6a3f4daebf019b8e7749`.
- Baseline `6.2.0 / 6.2-SIGNAL-V1` remains frozen.
- Paper/live execution, sizing, risk, exits and ledgers remain unchanged; live trading remains disabled.
- `server.js` remains untouched by v8 frontend work.
- v7.63/v7.64 canonical portfolio contracts remain authoritative.

## Production status — v8 LIVE
- Production root redirects deterministically to `./v8-clean/`, preserving query string and hash.
- Previous production root remains preserved on `archive/v8-r11-production-pre-cutover` for rollback.
- iPhone validation completed across CENTER / DEPOT / TRADE / PAPER / MORE with no legacy renderer/view collision.
- Persistent read-token state remains valid on production.

## Clean architecture invariants
- Exactly five real root views: CENTER / DEPOT / TRADE / PAPER / MORE.
- One deterministic navigation; no hidden legacy buttons.
- No legacy renderer/view ownership inside `v8-clean/`.
- Explicit read-only adapters use backend/API contracts; never scrape legacy DOM for values.
- No research auto-promotion.

## Production validation snapshot — 2026-09-05
- CENTER: total `$27.313`; Market `RISK-ON / SHORT-SQUEEZE`; Risk `WATCH`; BTC-S30 buffer `8.99%`; next action targets SAFE `>=12%`; Best Opportunity `NO READY SIGNAL`.
- DEPOT: total `$27.313` = Spot `$26.417` + Trading/Bots `$896`; canonical history rendered; top positions coherent.
- TRADE: BTC-S30 critical bot `8.99%`; HBAR-L3 `27.33%`; XRP-L5 `40.65%`; three active bots; Trading Equity `$896`.
- PAPER: `RESEARCH ONLY`; Baseline remains reference; no automatic promotion/execution impact.
- MORE: Market/Forecast/Research/Diagnostics/Settings render inside the real MORE view; token remains connected.

## Clean R1–R11 summary
- R1 CENTER: native five-view shell, private dashboard adapter.
- R2 DEPOT: canonical `spot + trading`, private history only.
- R3 TRADE: lowest-buffer bot drives DANGER/WATCH/SAFE and one next action.
- R4 PAPER: protected research board, no auto-promotion.
- R5 MORE: real fifth view, no legacy overlay.
- R6 Pages API binding to Northflank gateway.
- R7 persistent local read-token + canonical spot fallback repair.
- R8 mobile visual polish.
- R9 production identity (`v8.0 · PROD`).
- R10 DEPOT ranges `4H · 1T · 1W` plus HIGH/LOW.
- R11 chart mobile polish.

## Clean R12 — TRADE detail upgrade
- PR #58 merged after Release Safety run #704; main merge commit `41c13f864fd0bc9804d614c72941caad94f9e226`.
- Read-only disclosure cards for each active bot.
- Critical bot opens by default; other bots remain collapsed.
- Detail fields: Current Price, Break-even, Liquidation Price, PnL, Investment and Buffer.
- Fixed ladder: `DANGER <8%`, `WATCH 8–12%`, `SAFE >=12%`.
- Explicit SAFE path shows remaining percentage points to 12% or already SAFE.
- On read failure the canonical compact TRADE card remains intact.

## Clean R13 — TRADE data hygiene
- PR #59 merged; main merge commit `a405cd9b024b29f9a42fbcb26107a50400a7c10d`.
- Non-positive Break-even, Investment, Liquidation and Current prices render unavailable instead of fake `$0` values.
- PnL zero is accepted only when an actual PnL field is explicitly present on the protected bot object.
- No backend contract change, no invented values, no execution writes.

## Clean R14–R16 — production layout refinement
- R14 removes the redundant `MERIDIAN v8 · CUSTOMER VIEW` banner to reclaim vertical space.
- R15 establishes the approved CENTER mobile spacing rhythm; CENTER is now the visual reference and remains unchanged in R16.
- R16 (PR #62) is a presentation-only consistency pass across DEPOT, TRADE, PAPER and MORE.
- DEPOT gives the portfolio chart more width and clamps the long canonical-history source label so it no longer dominates the left 1D card.
- TRADE keeps every read-only bot detail while reducing vertical travel inside expanded cards.
- PAPER compresses model rows, opportunity-cost tiles and audit flags for faster scanning while preserving all research telemetry.
- MORE adopts the same tighter mobile card cadence.
- Release Safety passed before R16 merge; main merge commit `4c3d194e4322e4a45073054228b7785781bdb50a`.

## Clean R17 — TRADE placeholder correctness + DEPOT label cleanup
- PR #63 merged after Release Safety run #725; main merge commit `f1418d950eba90644b0db80ed00fdba5580073c3`.
- Root cause of visible `$0,0000` / `$0` placeholders: JavaScript formatters converted `null` to numeric zero via `Number(null)` even though normalization had correctly rejected the backend placeholder.
- R17 formatters reject `null`, `undefined` and empty-string values before numeric formatting, so unavailable Break-even / Investment / PnL fields render `—`.
- Explicit real zero PnL remains valid only when an actual PnL field exists on the protected bot object.
- DEPOT's technical `POSTGRES_*` history source identifier is presentation-only shortened to `Canonical History`; no history values or basis logic change.
- No backend contract, server.js, Baseline 6.2, Paper/live execution, sizing, risk, margin or order changes.

## Research v7.87 — Paperbot Deep Dive telemetry
- PR #64 merged; main merge commit `cfe357ef4c076c053603539c1b2218a5c116df44`.
- Adds research-only Baseline vs Challenger V2 cohort telemetry by SIDE / REGIME / SYMBOL plus descriptive temporal slices and linked opportunity cost.
- Sample adequacy is explicit (`n >= 8`).
- Known Challenger Baseline-READY dependency remains flagged; no promotion.

## Clean R18 — PAPER Cohort Board
- PR #65 merged to main at `d3fc44c7174f432c5e53680a52409d6e2882dfaa`.
- Read-only module `v8-clean/paper-cohort-r18.js` reads protected `/api/research-analytics` and surfaces Challenger V2 cohort evidence directly inside PAPER.
- Compact sections: SIDE / REGIME / ASSET, with Challenger expectancy, PF, delta expectancy and sample adequacy.
- No private values are committed; the board renders only runtime protected telemetry.
- No server.js, Baseline, execution, Pionex or research-promotion changes.

## Clean R18 — near-live Spot portfolio valuation
- PR #70 fixes a separate stale-price issue discovered from CENTER remaining at `$27.313` despite the existing 30-second visible-view refresh.
- Root cause: `/api/private/dashboard` returns persisted PostgreSQL private state and its `livePrices` field can itself be stale; repeated UI fetches therefore re-read the same prices.
- The browser now overlays fresh public Binance spot prices on protected dashboard GET responses before the existing canonical `spot + trading` valuation runs.
- Privacy rule: the adapter downloads the full public ticker table; held symbols, quantities and venues are never sent to Binance as holding-specific query parameters.
- Wrapped exposure aliases are preserved for pricing (`BETH -> ETH`, `OKSOL -> SOL`); USD/USDT/USDC/FDUSD/DAI are valued at 1 USD. Unsupported assets keep the existing holding/snapshot fallback rather than receiving invented prices.
- If the public market feed is unavailable, persisted `livePrices` are cleared for that read so stale prices are not mislabeled as live.
- Spot valuation is near-live at the existing 30-second visible-view cadence. Pionex/Trading equity remains the protected snapshot/manual value; the aggregate total is therefore not claimed to be fully exchange-live.
- R18 is read-only frontend valuation: no private write, no holdings mutation, no `server.js`, no Pionex-bot, no Baseline or execution change.

## Historical next steps
1. Validate R18 near-live Spot valuation on iPhone after production deployment; compare CENTER/DEPOT across at least two 30-second refreshes.
2. Continue Hybrid Alpha v7.96 as isolated RESEARCH ONLY; evaluate 30/60/90d and chronological folds before any further hypothesis.
3. Do not tune factors, drop assets, or hard-gate regimes after seeing the v7.94/v7.95 evidence.
4. Pionex bots remain unchanged unless explicitly re-opened by the user.

## Research isolation
- v7.86 Retest/Hold Breakout V2 remains research-only and separate.
- v7.79 prospective holdout remains locked/prospective.
- Meta Allocator remains research-only.
- v7.89–v7.96 Hybrid Alpha programme remains isolated research; no execution connection.
- No research result auto-promotes into Paper/live execution.


## SSOT UPDATE — Research closure 2026-09-06

This section supersedes earlier research next-step text where it conflicts.

- Hybrid Alpha v7.97 is complete on Draft PR #73 / head `6905f7d2bc2386f0b5390acaff121718a52ce065`. Low-liquidity `<0.50` risk attenuation by fixed `0.60` improves 30/60/90d aggregate PF, expectancy and DD without changing trade count, but 90d Fold 2 remains negative (PF `0.63`, EXP `-0.782R`). NO PROMOTION; stop threshold search.
- FIB V1 Draft PR #74: 1h primary and 15m fail; 4h discovery positive but not confirmatory. Head `c3cc6dd38ab5bdb54abbee4863e4e9d444cdb12f`.
- FIB V2 Draft PR #75: unchanged 4h unseen-year replication fails (n `791`, PF `0.89`, EXP `-0.059R`, DD `77.372R`). Head `b8fc8edf66394f4a2ab63b48f511e3a37a80b00d`.
- FIB V3 Draft PR #76: Daily anchors with 4h execution are materially stronger across three historical years. Primary n `190`, PF `1.34`, EXP `+0.150R`, DD `6.609R`; both sides and all folds positive; secondary yearly PF `1.38 / 1.43`. Gate still fails because SOL supplies `59.2%` of positive primary net R. Head `7b15a8b37431af317bc5d8b50ef960024b353982`. NO PROMOTION and no SOL-specific reaction.
- FIB V3 prospective holdout is locked on Draft PR #77 / head `3a5650a2c5b14276969bf5ef9c0dc818204f8d09`. Start `2026-09-06T14:15Z`; formal evaluation only after >=180 days and >=100 closed baskets; earliest `2027-03-05T14:15Z`. Initial status `NOT_ELIGIBLE`; zero prospective trades; six pre-cutoff carry-over baskets excluded.
- All FIB and Hybrid work remains isolated from production, Paper/live execution and Pionex.
- R18 physical iPhone validation across two ~30-second cycles remains pending and must not be marked complete without user observation.
- Next research must be structurally new and leakage-free; no additional threshold, pivot, asset, side, regime or FIB-level tuning.


## R18 iPhone validation — completed

Production screenshots supplied by the user at 20:18 show CENTER `$27,846` and DEPOT `$27,867`, versus the previously suspicious static value near `$27,313`. DEPOT reconciles as Spot `$26,972` + Trading/Bots `$896` ≈ `$27,868`, with one-dollar display rounding. The `$21` CENTER/DEPOT delta is only about `0.075%` and is plausible across independently timed refreshes.

Decision: R18 near-live spot valuation is validated on iPhone. Do not investigate backend execution or Pionex. Trading/Bots remains snapshot/manual, so the aggregate must not be described as fully exchange-live.

---

## SSOT UPDATE — 2026-09-07 · R19 / Elliott research closure

This update supersedes earlier current-status and next-step text where it conflicts.

- **Main:** `08686d71c62b1407c1be89c72387a0c137c15e53` after PR #91 (R19 Research Control Board), Release Safety #844 green on exact head.
- **R19:** 15/15 local architecture/UI tests passed. UI explicitly shows candidate states plus `EXECUTION NONE` and `AUTO-PROMOTION OFF`.
- **Hybrid v7.102:** rejected; PR #87; final head `11ac5349bc7d0d2de66233f954c72fed5d5d193f`; Evidence #2 run `34140663280`; artifact `10025793601`; Release Safety #834.
- **Elliott Wave-3 V1:** frozen near-pass, not promoted. 144 trades, PF 1.21, +0.088R expectancy, DD 8.814R; failed sample, breadth and concentration gates. PR #88; final head `a1283b68419bdb2a5d22ff2b49fff5b4109354db`; Evidence #2 run `34143541691`; artifact `10026843740`; Release Safety #837.
- **Elliott Wave-3 V2 unchanged historical replication:** 101 trades, PF 1.39, +0.158R expectancy, DD 9.514R; all five assets positive; only sample gate failed. Frozen confirmation, not a holdout and not promoted. PR #89; final head `465555c16bc0d64f69ba3afe1f29fcf3fe73c6ea`; Evidence #2 run `34145957770`; artifact `10027682729`; Release Safety #840.
- **Elliott Wave-5 V1:** rejected for insufficient opportunity count and unstable/weak side/window evidence. PR #90; final head `5f30cce5fc64778c83fcb03e33edc39dc3003f0c`; Evidence #2 run `34147347479`; artifact `10028158787`; Release Safety #843.
- **Guardrails unchanged:** Baseline 6.2 frozen, PAPER only, live off, no paper/live connection, `server.js` untouched, Pionex untouched.
- **Next:** physical-iPhone PAPER validation of R19 when deployed; keep Wave-3 and FIB V3 frozen; no immediate Elliott ABC/variant tuning series. Any new bot starts from a distinct predeclared hypothesis, gates, assets, windows and folds.


## Agent workflow handoff

Before starting new work, read `MERIDIAN_AGENT_WORKFLOW.md` together with CONTEXT / DECISIONS / HANDOFF.

Operational defaults:
- quality over speed
- user communicates only with Main Agent
- specialist -> independent reviewer -> max 3 revision loops -> Main Agent integration
- no merge without required GREEN LIGHT / available quality gates
- autonomous PR/merge remains allowed after gates pass
- iPhone review is mandatory for UI changes
- trading logic gets technical + methodology review
- live financial data uses a second source when technically possible
- if the runtime cannot instantiate the requested agent/model roles, do not fabricate them; disclose the actual verification level


## v9 r17 — Data Truth

r16 was physically validated on the user's iPhone. The next production checkpoint is r17 Data Truth.

Required invariants:
- tracked/reference bot rows remain visible for context but are non-actionable unless confidently live-matched
- Profit Lock requires live bot match + live PnL
- Risk Priority / NEXT ACTION cannot be driven by reference-only PnL
- exposure figures use known live capital only and disclose incompleteness
- market prices are cross-checked OKX + Binance when available
- null/blank remains unavailable, never zero
- negative money formatting uses absolute magnitude
- header reports MIXED when the page combines live market data with snapshots/reference data
- Research label distinguishes Profit Lock Lab engine r15 from the current app release


## v9 r18 — Source Freshness / Feed Coverage

r17 iPhone acceptance exposed the next blocker: only 2/25 tracked bots are present/matched in the private bot data while public price coverage is broad.

r18 requirements:
- private dashboard bot data is labelled snapshot/private, never assumed live
- `pionexRisk.updatedAt` or `snapshotAt` is required for trusted freshness
- action freshness window is 15 minutes
- generic `privateUpdatedAt` is not enough for trading actions
- stale snapshots produce SYNC/STALE and cannot drive Profit Lock, NEXT ACTION, Risk Priority or bot exposure
- Data Truth shows raw API rows, matched rows, unmatched rows, snapshot age, actionable rows, two-source price coverage
- if raw rows == matched rows but tracked > matched, backend coverage is the bottleneck; if raw rows > matched, matcher coverage is the bottleneck
- LIQ labels are explicitly scoped to liquidation status
- future authenticated Pionex risk patches are server-stamped when no section timestamp is provided


## v9 r19 — OKX Futures DCA migration

Newest authoritative OKX state is the user screenshot from 25.09.2026 06:22:
- previous INJ/XRP manual futures positions were closed
- active OKX items are two LONG 3x Futures DCA bots: INJ and XRP
- both use 65.32 USDC investment
- INJ: last 7.977, avg 7.908, TP 8.28, total PnL +0.1729 (+0.26%), safety 0/7
- XRP: last 1.5291, avg 1.5296, TP 1.5924, total PnL -0.014 (-0.03%), safety 0/9
- no estimated liquidation price is shown for either DCA bot; never infer one
- display these as OKX DCA snapshot rows, not old manual positions
- cross-check only market price through public feeds; account-specific bot fields remain screenshot-source
- known OKX bot equity is ~130.80 USDC, not guaranteed total account equity


## v9 r20 — Pionex Bot API read-only refresh

Root cause from r19 acceptance: private Pionex risk data was 23 days stale because no runtime producer refreshed it.

New module: `pionex-bot-auto-sync.js`
- starts from `scripts/start-gateway.mjs`
- read-only `GET /api/v1/bot/orders`
- default 5-minute cadence
- paginated running-order fetch
- supports futures_grid and future_hedge_grid rows
- normalizes range, leverage, liquidation, TP, USD investment only when trustworthy, and optional PnL fields
- never calls create/adjust/reduce/cancel
- successful sync stamps `pionexRisk.updatedAt/snapshotAt`
- failed sync preserves prior bot timestamp and rows while writing diagnostic status only
- missing credentials produce one startup diagnostic, no repeated private-state churn

Expected deployment secrets:
- `PIONEX_BOT_READ_API_KEY`
- `PIONEX_BOT_READ_API_SECRET`
Recommended Pionex permission: Bot reading only.

Frontend r20 Data Truth now shows PIONEX API, BOT ROWS, BOT MATCH, SNAPSHOT PNL, BOT SNAPSHOT AGE, ACTIONABLE, 2-SOURCE PRICE, UNMATCHED, BOT API, BOT SOURCE and PORTFOLIO source.

Important: until read-only Pionex credentials are configured in the runtime, r20 should show BOT API = OFF and continue refusing trading actions from stale bot data.


## v10 r22 — Deep-audit integrity follow-up

- Continues the v10 deep audit after r21 without changing trading rules, paper-bot parameters, execution, Pionex orders, or research promotion logic.
- Header live-status classes now have explicit semantic colors for SAFE / WATCH / DANGER / MUTED.
- MARKET two-source coverage counts only the currently rendered market universe, preventing transient numerator/denominator drift after tracked-asset changes.
- Forced BOTS refresh preserves the user's Asset Watch details open/closed state.
- Forced SCANNER refresh preserves expanded fresh/stale detail groups.
- CONFLICT/neutral scanner explanations use both long-adverse and short-adverse reason sets instead of presenting only one side.
- Requires Release Safety plus targeted r22 regression coverage before merge.


## v10 r23 — Portfolio source integrity

- COMMAND Pionex equity now follows the canonical private portfolio contract: `portfolio.pionexEquityUsd`, then the Pionex row in `portfolio.manualVenueBalances`.
- The old 80% magnitude heuristic is removed. Bot/COIN-M partial equity can no longer be promoted to an account total because it happens to be numerically close to the snapshot.
- Pionex source is explicitly a private portfolio snapshot, with provenance and timestamp carried through the model.
- If canonical private Pionex equity is missing, MERIDIAN fails closed to the existing screenshot fallback rather than guessing from `pionexRisk` or generic `pionex` fields.
- No trading logic, bot matching, execution, orders or research rules changed.


## v10 r24 — Portfolio null integrity

- Canonical holding valuation no longer lets `null` or blank quantity coerce to numeric zero.
- Missing quantity now falls through to explicit stored USD value (`value`, `valueUsd`, `usdValue`) rather than silently erasing it.
- An explicit quantity of zero remains zero and correctly overrides stale stored value.
- This enforces the existing Data Truth invariant: missing numeric data is unavailable, never zero.
- No trading logic, execution, bot state or research logic changed.


## v10 r25 — COMMAND portfolio SSOT reconciliation

- Continues the deep audit after r24.
- COMMAND headline now uses the same current canonical basis as DEPOT: Spot holdings + Pionex equity.
- Public Spot valuation reuses the privacy-safe all-ticker Binance overlay; no holding-specific symbol/quantity query is sent.
- If public Spot pricing fails, stale live prices are cleared and COMMAND falls back to a labelled private canonical snapshot instead of claiming fresh valuation.
- PostgreSQL portfolio history is diagnostic/historical only; current-vs-history delta is surfaced but history does not overwrite current valuation.
- OKX Futures DCA screenshot equity remains visible as reference and is explicitly outside the canonical total.
- Removed the COMMAND total dependency on the hard-coded Ledger snapshot and OKX DCA subtotal.
- No trading rules, Paper-bot parameters, execution logic, Pionex mutations or research promotion changed.


## v10 r26 — Portfolio provenance / coverage integrity

- Deep-audit continuation after r25.
- Portfolio math is unchanged: canonical total remains Spot + Pionex.
- Adds explicit Spot live-price coverage metadata (holding count, requested, resolved, feed freshness, complete/partial).
- COMMAND no longer calls the whole portfolio “CANONICAL CURRENT”.
- Complete Spot overlay + canonical private Pionex snapshot is labelled CANONICAL MIXED.
- Partial Spot coverage or screenshot Pionex fallback is labelled CANONICAL PARTIAL.
- No fresh Spot overlay is labelled PRIVATE CANONICAL SNAPSHOT.
- Spot resolved/requested coverage is shown in COMMAND; Pionex remains explicitly snapshot provenance.
- OKX DCA remains reference-only outside the canonical total.
- No trading-rule, Paper-bot, signal, leverage, execution or research-promotion change.


## v10 r27 — Pionex portfolio equity age provenance

- Continues the deep audit after runtime-verified r26.
- Adds a missing-aware, future-aware timestamp helper for snapshot provenance.
- COMMAND now shows the age of the selected Pionex portfolio-equity snapshot when an explicit equity timestamp exists.
- Missing source timestamp is shown as NO TIMESTAMP; a timestamp >30 seconds in the future is shown as FUTURE TIMESTAMP.
- KNOWN_SEED provenance is shown as STATIC SEED.
- Generic private dashboard update time is never substituted for Pionex equity update time.
- No arbitrary Pionex-equity stale cutoff is introduced; this release improves transparency only.
- Portfolio math remains Spot + Pionex and r26 coverage classification remains unchanged.
- No trading-rule, Paper-bot, signal, leverage, execution, Pionex mutation or research-promotion change.


## v10 r28 — Bot feed coverage SSOT

- Continues the deep audit after runtime-verified r27.
- Adds one shared botFeedCoverage helper in the v9 data engine.
- Coverage denominator is now the current supported private API rows, not the full historical Asset Watch/reference catalog.
- A fresh 3/3 supported-row match can be FRESH even if the reference catalog contains additional older entries.
- Any unmatched or ambiguous supported API row keeps coverage incomplete.
- v9 DATA TRUTH, v9 header/source state and v10 DATA GUARD now consume the same coverage contract.
- DATA TRUTH BOT MATCH now shows matched / supported live rows.
- No bot-matching thresholds, trading rules, Paper-bot parameters, risk calculations, leverage, execution or Pionex mutation paths changed.


## v10 r29 — Decision readiness SSOT

- Continues the deep audit after runtime-verified r28.
- Adds shared safetyReadyBot and decisionReadyBot helpers to the v9 data engine.
- DECISION READY requires: fresh trusted bot snapshot, safe match, usable Liq/safety data, PnL and fresh per-asset market intel.
- DATA TRUTH ACTIONABLE now uses the same decision-ready helper instead of the older weaker Match + PnL + Bot-Freshness check.
- v10 syncHealth consumes the same safety/decision helpers instead of re-deriving them independently.
- SAFETY READY remains intentionally available without PnL or fresh market intel when liquidation data is usable.
- No signal formula, risk threshold, Profit Lock rule, NEXT ACTION priority, Paper-bot parameter, leverage, execution or Pionex mutation path changed.


## v10 r30 — Bot timestamp provenance integrity

- Continues the deep audit after runtime-verified r29.
- Centralizes bot snapshot time state in botFeedTimeState.
- Bot freshness keeps the exact existing rules: trusted timestamp, no more than 15 minutes old, and no more than 5 minutes in the future.
- Untrusted fallback timestamps are displayed as NO TRUSTED TIMESTAMP instead of a misleading young age.
- Trusted timestamps beyond the existing +5 minute tolerance are displayed as FUTURE TIMESTAMP instead of <1 MIN.
- DATA TRUTH, stale Profit-Lock/action explanations and v10 DATA GUARD now use the same timestamp label.
- No trading-rule, matching, PnL, risk, Paper-bot, leverage, execution or Pionex mutation change.


## v10 r31 — Decision completeness SSOT

- Continues the deep audit after runtime-verified r30.
- Adds decisionComplete = matched > 0 + complete match coverage + decisionReady === matched.
- DATA GUARD shows DECISION READY only when every matched supported live row is decision-ready; otherwise nonzero readiness is PARTIAL READY.
- Header BOT READY and DATA GUARD now consume the same decisionComplete state.
- PROFIT WATCH / LOCK counts now use shared decisionReadyBot rows, preventing safety-incomplete rows from entering action summaries.
- No Profit Lock formula, signal/risk threshold, NEXT ACTION priority, Paper-bot parameter, leverage, execution or Pionex mutation change.


## v10 r32 — Header tone semantics

- Continues the deep audit after runtime-verified r31.
- Normalizes active v10 system-header tones to safe / watch / danger / muted.
- MARKET STALE now emits watch directly instead of legacy mixed.
- BOT REF now emits muted directly instead of legacy reference.
- COMMAND source strip and sticky header consume the readiness tone without local translation.
- Initial v10 shell statuses start as muted, matching the semantic CSS contract before runtime data arrives.
- Readiness labels and conditions are unchanged.
- No trading rules, signals, risk thresholds, Profit Lock, Paper-bot parameters, leverage, execution or Pionex mutation paths changed.


## v10 r33 — Exposure completeness SSOT

- Continues the deep audit after runtime-verified r32.
- Adds shared exposureIntegrity in the v9 data engine for global and per-asset exposure completeness.
- Current unmatched supported live rows now count as unknown exposure instead of disappearing from completeness checks.
- A same-asset unmatched live row makes that asset's hedge percentage unavailable.
- The existing hedgeLow threshold remains <15%; r33 only blocks that test when its denominator is incomplete.
- Global SHORT/LONG coverage becomes unavailable when any current live exposure row is unmatched or any matched row lacks USD investment.
- Active v10 pair cards and COMMAND live overview reuse the shared completeness helper and show PARTIAL rather than COMPLETE on incomplete exposure.
- Known matched exposure values remain identifiable as known values; no missing quantity is invented.
- No trading thresholds, Profit Lock percentages, Paper-bot parameters, leverage, execution or Pionex mutation paths changed.


## v10 r34 — Portfolio regime basis provenance

- Continues the deep audit after runtime-verified r33.
- Keeps the existing portfolioRegime/riskV2 scoring formulas exactly unchanged.
- Adds exposureComplete and COMPLETE/PARTIAL_EXPOSURE provenance to portfolioRegime.
- When exposure is incomplete, the retained COMMAND portfolio-regime pill is visibly labelled PARTIAL BASIS.
- The legacy regime strip also discloses PARTIAL BASIS and an incomplete exposure-basis note.
- Concentration thresholds remain 10/15/25%; avg-risk penalties remain 4/6; regime cutoffs remain +/-2.
- Active v10 NEXT ACTION remains independent of portfolioRegime.
- No trading rules, Profit Lock percentages, hedge threshold, Paper-bot parameters, leverage, execution or Pionex mutation paths changed.


## v10 r35 — Pair PnL completeness

- Continues the deep audit after runtime-verified r34.
- Adds shared pnlIntegrity(symbol) for asset-level PnL aggregation provenance.
- PAIR PNL USD is shown only when the bot snapshot is fresh, all current rows for that asset are matched, and every matched row has live PnL.
- Same-asset unmatched rows now make the aggregate unavailable instead of disappearing from the sum.
- Unmatched rows from other assets do not invalidate a complete asset pair.
- Incomplete cards explicitly show PnL-Summe unvollständig.
- Individual bot PnL logic, Decision Ready and all Profit Lock thresholds remain unchanged.
- No hedge threshold, market signal, Paper-bot parameter, leverage, execution or Pionex mutation path changed.


## v10 r36 — Pair PnL USD value integrity

- Continues the deep audit after runtime-verified r35.
- Tightens shared pnlIntegrity so Pair PnL requires a non-null USD value from botPnlUsd on every matched row.
- A percent-only PnL row without raw USD PnL or usable USD investment no longer counts as complete for PAIR PNL USD.
- Existing percent + investUsd derivation and validated raw USD PnL remain accepted.
- Active pair cards also verify every aggregate value is non-null before reducing the sum, preventing JavaScript null-to-zero coercion.
- Same-asset unmatched-row scoping from r35 is unchanged.
- Decision Ready and Profit Lock still use the existing generic live-PnL/percentage contract; their thresholds and behavior are unchanged.
- No hedge threshold, market signal, Paper-bot parameter, leverage, execution or Pionex mutation path changed.


## v10 r37 — Global NEXT ACTION coverage guard

- Continues the deep audit after runtime-verified r36.
- Global NEXT ACTION now requires complete supported bot coverage before emitting non-safety momentum/profit/HOLD guidance.
- Any unmatched or ambiguous supported current row changes non-safety NEXT ACTION to KEINE AKTION · DATEN PRÜFEN and shows matched/supported coverage.
- LIQ_RISK and PROTECTION_RISK remain ahead of the coverage guard so known liquidation/SL safety is never hidden.
- Existing DATA_STALE / MARKET_STALE / UNVERIFIED blocking remains unchanged.
- Pair-status formulas, risk/signal ranks, Profit Lock formulas and thresholds, hedge threshold, Paper-bot parameters, leverage and execution are unchanged.


## v10 r38 — Per-asset match completeness guard

- Continues the deep audit after runtime-verified r37.
- An asset pair can no longer show PROFIT LOCK / momentum RISK REVIEW / WATCH PROFIT / HOLD when another current live row for the same asset is unmatched or ambiguous.
- Same-asset incompleteness is labelled UNVERIFIED with an asset-scoped row count and ambiguous count when applicable.
- Unmatched rows for other assets do not invalidate the current pair.
- LIQ_RISK and explicit SL/protection risk stay ahead of this guard so known safety issues remain visible.
- r37 global NEXT ACTION coverage guard remains unchanged.
- No matcher threshold, signal/risk rank, Profit Lock formula, hedge threshold, Paper-bot parameter, leverage, execution or Pionex mutation path changed.


## Agent/release coordinator hardening

- Release ownership is now serialized through the Main Agent; subagents may not independently bump terminalBuild, open competing release PRs or merge to main.
- Every resumed/interrupted workflow begins with a live repo/PR/workflow preflight before any write.
- Terminal release branches must be exactly main+1 and use matching v10-rNN branch/build identity.
- The oldest open PR for a target revision owns that revision lease; later contenders fail Release Safety.
- Any branch commit invalidates earlier gate results; merges require green gates on the exact current head SHA.
- Immediately before merge, main/base/head/behind status/competing PRs/gates are re-read. If main advanced, the stale release is not merged and its scoped work moves to the next free revision.
- A post-main workflow closes stale open release PRs automatically.
- Superseded PR #204 was closed rather than reusing the already-consumed r37 release number.
- No trading/Paper/risk/leverage/execution logic is part of this process hardening.


## v10 r39 — OKX DCA reference equity provenance

- Continues the deep audit after runtime-verified r38 and the single-writer release coordinator hardening.
- Adds a complete/partial snapshot contract for OKX Futures DCA reference equity.
- Exact OKX DCA REF equity requires explicit investUsd and totalPnlUsd on every DCA row.
- Missing fields no longer enter the reference sum as implicit zero; explicit zero PnL remains valid.
- The stale manual OKX fallback is no longer used when the DCA snapshot is incomplete.
- COMMAND labels OKX DCA REF as REFERENCE COMPLETE or REFERENCE PARTIAL and reports missing investment/PnL counts when partial.
- OKX remains outside the canonical Spot + Pionex portfolio total.
- r37 global NEXT ACTION and r38 per-asset match-completeness guards are preserved unchanged.
- No trading rules, Profit Lock thresholds, hedge threshold, market signals, Paper-bot parameters, leverage, execution or Pionex mutation paths changed.


## v10 r40 — Unmatched live-row diagnostics

- Continues the deep audit after runtime-verified r39.
- Adds one shared privacy-safe unmatched-row details renderer to active v10 COMMAND and BOTS surfaces.
- Each unresolved live row identifies asset, side, leverage, NO CONFIDENT MATCH vs AMBIGUOUS MATCH, and only PnL/USD-capital availability flags.
- Bot IDs and private numeric values are intentionally not rendered in this diagnostic.
- BOTS preserves the unmatched-details disclosure state across forced refreshes.
- r37 global NEXT ACTION coverage guard and r38 per-asset match-completeness guard remain unchanged.
- No matcher thresholds, Profit Lock rules, hedge threshold, market signals, Paper-bot parameters, leverage, execution or Pionex mutation paths changed.
## v10 r41 — Read-only Pionex bot detail hydration

- Continues after merged r40 unmatched-row diagnostics.
- Keeps the existing Pionex Bot API list read, but no longer assumes list rows contain complete futures-grid risk data.
- Hydrates every supported active futures_grid / future_hedge_grid row through GET /api/v1/bot/orders/futuresGrid/order.
- Fails closed on missing/duplicate IDs, ID mismatch, incomplete details, truncated pagination or any detail-read error.
- Publishes listRows, supportedRows, detailRows and detailsComplete in the fresh Pionex risk snapshot.
- DATA TRUTH adds BOT DETAIL x/y separately from BOT MATCH.
- All Pionex calls remain GET-only; no create/adjust/reduce/cancel/transfer path is added.
- Existing r37 global coverage guard, r38 per-asset guard and r40 privacy-safe unmatched diagnostics remain unchanged.
- No matching threshold, Profit Lock rule, hedge threshold, market signal, portfolio math, Paper-bot parameter, leverage or execution behavior changes.

## Historical Pionex API configuration status — 28.09.2026

- The r41 read-only Pionex Bot API integration is implemented, but the user has confirmed that no Pionex API credentials have been created/configured yet.
- Until PIONEX_BOT_READ_API_KEY and PIONEX_BOT_READ_API_SECRET exist in the runtime secret store, MERIDIAN must treat Pionex Bot API as OFF / not configured.
- Do not claim live Pionex bot synchronization from GitHub connectivity alone. GitHub repository access and Pionex exchange credentials are separate concerns.
- Pionex credentials must never be committed to the repository. When created, use Bot-reading/read-only permissions and inject them only through the deployment/runtime secret store.
## v10 r42 — Pionex read-only account/futures integration

- Adds a shared GET-only HMAC client for Pionex private reads.
- Adds read-only Spot trading-account balance ingestion.
- Adds read-only Futures balance ingestion.
- Adds read-only current Futures position ingestion including side, size, mark/entry, unrealized PnL, margin, leverage and liquidation when Pionex returns them.
- Adds ACCOUNT API and FUT POS diagnostics to Data Truth, separate from BOT API/BOT DETAIL.
- Adds gateway readiness for normal Pionex reading vs Bot reading.
- Missing credentials stay OFF; read failures preserve the previous snapshot as stale.
- Adds PIONEX_READONLY_SETUP.md with least-privilege setup.
- No Pionex write endpoint, trading permission, transfer permission, leverage mutation or margin mutation is introduced.
- No trading rule, Profit Lock threshold, hedge rule, Paper-bot parameter, leverage or execution behavior changes.
## v10 r43 — Pionex Bot API live-read hotfix

- Explicitly filters running Bot API list reads to `futures_grid` and `future_hedge_grid`.
- Keeps the existing read-only GET detail hydration.
- Preserves `EMPTY_GUARD` when a previous live bot snapshot exists and the new supported result is zero.
- Adds privacy-safe aggregate list diagnostics for guard troubleshooting.
- During `EMPTY_GUARD`, UI row counts now show the current filtered API list result instead of the stale preserved snapshot count.
- No Pionex trading, bot trading, transfer, mutation, PaperBot, leverage, signal or execution behavior changes.
## v10 r44 — Pionex signed-query compatibility hotfix

- Replaces one repeated-array Bot API request with two scalar signed GET requests.
- Reads `futures_grid` and `future_hedge_grid` separately, then combines results before existing detail hydration.
- Keeps all existing privacy-safe diagnostics and `EMPTY_GUARD` behavior.
- No API credential changes required.
- No trading, Bot trading, transfer, PaperBot, leverage, signal or execution changes.
## v10 r45 — Pionex unfiltered bot discovery

- Reads all running bot orders with `GET /api/v1/bot/orders?status=running`.
- Omits `buOrderTypes` from the signed request.
- Applies the Futures allowlist locally: `futures_grid` and `future_hedge_grid`.
- Persists aggregate type/status counts so unsupported or legacy Pionex bot types are visible without exposing private row details.
- Keeps detail hydration and `EMPTY_GUARD` fail-closed behavior.
- No Pionex trading, Bot trading, transfer, PaperBot, leverage, signal, Profit Lock or execution changes.
## v10 r46 — Pionex read-only account position layer

- Keeps Bot API discovery and EMPTY_GUARD unchanged.
- Adds a separate POSITION API layer sourced from GET /uapi/v1/account/positions.
- Shows account-position asset, side, leverage, average price, mark price, liquidation price, size and unrealized PnL when fresh.
- Explicitly labels positions as not bot-matched; no Grid/TP/Profit-Lock action is derived from them.
- Adds account-position assets to the market-data universe.
- Gateway health exposes aggregate pionexAccountStatus, pionexFuturesPositionCount, pionexBotStatus and pionexBotListRows only.
- No API writes, trading permissions, Bot trading, transfer, PaperBot, leverage, signal, Profit Lock or execution changes.
## v10 r47 — Pionex Wallet Bot Account discovery

- Adds GET /api/v1/wallet/balancesFull to the existing read-only account sync.
- Wallet read is fail-soft; a Wallet permission/API failure does not break the working Futures POSITION API layer.
- Normalizes Bot Account and Trader Account category structure.
- BOTS UI shows BOT ACCOUNT API / WALLET DISCOVERY with category count, reported entry count, loaded list count and returned field names.
- Public gateway health exposes only aggregate/category structure metadata, not balances, position values or bot IDs.
- No automatic Wallet-to-bot mapping yet.
- No API writes, trading permissions, Bot trading, transfer, PaperBot, leverage, signal, Profit Lock or execution changes.
## v10 r48 — Wallet Bot detail hydration discovery

- Keeps r47 Wallet/Bot Account discovery and r46 Futures POSITION API intact.
- Privately normalizes TRADING_BOT and FUTURES_LITE wallet entries.
- Probes each unique buOrderId with GET /api/v1/bot/orders/futuresGrid/order at safe pacing.
- Stores successful detail payloads privately for later validation; individual failures are fail-soft.
- Public diagnostics expose only aggregate buOrderType/cateType counts and detail success/failure counts.
- Recognizes FUTURE_GRID_COIN_MARGINED as the documented Coin-M Futures Grid cateType.
- Does not promote probe results into bot decision readiness.
- No trading, Bot trading, transfer, PaperBot, leverage, signal, Profit Lock or execution changes.
## v10 r49 — validated Wallet live-bot fallback

- Builds `pionexAccount.walletBotRisk` from Wallet `futures_grid` entries whose direct Futures Grid detail reads succeeded.
- Requires all supported Wallet futures_grid candidates to detail-hydrate, normalize and have unique IDs before marking the Wallet risk snapshot complete.
- Selects fresh classic Bot API first; otherwise selects fresh complete Wallet detail risk.
- Enforces the existing 15-minute bot-feed freshness policy.
- Keeps the 3 observed `futures_lite` entries outside the supported live-bot layer.
- UI distinguishes active BOT SOURCE from the separately reported classic Bot API status.
- Public gateway health exposes aggregate readiness/counts only; private bot IDs/details stay private.
- No trading, Bot trading, transfer, PaperBot, leverage, signal, Profit Lock, hedge-threshold or execution changes.
## v10 r50 — Wallet risk normalization diagnostics

- r49 live evidence: Wallet discovery LIVE, 32/35 detail probes, but BOT SOURCE remains classic EMPTY_GUARD.
- Adds aggregate diagnostics around buildWalletBotRisk normalization.
- Shows RISK NORMALIZED n/m, reject reasons, status/trend counts, missing base count and returned detail field names.
- Public health receives aggregate diagnostics only; no IDs, balances, prices, investments or PnL values.
- Wallet source selection remains unchanged: it still requires fresh, complete Wallet risk.
- No trading, Bot trading, transfer, PaperBot, leverage, signal, Profit Lock, hedge-threshold or execution changes.
## v10 r51 — Pionex enum whitespace normalization

- Live r50 evidence: DETAIL PROBE 32/35; RISK NORMALIZED 0/32; status running 32; trends long 5 / short 27; missing base 0; reject reason normalizer_rejected 32.
- Root-cause mismatch: diagnostic normalization trimmed enum strings, production allowlist checks did not.
- r51 trims surrounding whitespace for buOrderType, status and trend before the existing allowlist checks.
- Supported bot types/statuses/directions are otherwise unchanged.
- No trading, Bot trading, transfer, PaperBot, leverage, signal, Profit Lock, hedge-threshold or execution changes.
## v10 r52 — exact Pionex normalizer stage diagnostics

- Live r51 evidence: DETAIL PROBE 32/35, RISK NORMALIZED 0/32 after a fresh sync.
- Adds shared inspectPionexBotOrder() used by the production normalizer and diagnostics.
- Shows TYPE / STATUS / SYMBOL / SIDE / ALL pass counts.
- Shows only coarse BASE/QUOTE classes: asset, stable_quote, missing, unresolved.
- No bot IDs, symbols, prices, balances, investment values or PnL exposed publicly.
- No source-selection, matching, trading, PaperBot, Profit Lock, hedge or execution changes.
## Streaming-safe execution hardening — 28.09.2026

A repeated ChatGPT UI streaming interruption was traced to orchestration pressure rather than lost repository state: long sequences of serial GitHub calls, repeated workflow polling, and unnecessarily large source/log payloads increased the chance of the response stream disconnecting while GitHub mutations had already completed.

Durable mitigation — STREAM-SAFE-V3:
- `node scripts/stream-safe-preflight.mjs` returns a compact resume checkpoint plus a deterministic `resumeToken`.
- Each interactive chat turn has a hard budget of **2 bundled tool phases or 120 seconds**, whichever comes first.
- Independent reads are parallelized inside one phase; serial one-by-one GitHub reads are prohibited when they can be batched.
- Same-status workflow polling is limited to **1 repeat**. If a gate is still running, end the chat turn with its run ID instead of continuing to poll.
- Tool output is capped below 8 KB per relevant payload; large logs/diffs/files are reduced to the smallest useful window.
- Every mutation is checkpointed by a durable SHA/PR/run/deploy identifier before the next phase.
- After interruption, repo state is authoritative: run preflight, compare the resume token, and never replay an already durable write.
- Long-running development is intentionally split into short resumable turns; the user may answer simply `Go` / `Fortsetzen`, with no need to restate context.

This is infrastructure/process-only. Terminal build, trading logic, PaperBots and execution behavior are unchanged.
## v10 r53 — inverse Coin-M symbol resolution

- Live r52 diagnostics: TYPE 32/32, STATUS 32/32, SIDE 32/32, SYMBOL 0/32; BASE stable_quote 32; QUOTE asset 32.
- Adds a strict inverse-only symbol fallback: stable base + asset quote -> symbol from quote.
- Normal/non-inverse bots still resolve symbol from base.
- Existing live-bot completeness, freshness, reference matching and action guards remain unchanged.
- No trading, Bot trading, transfer, PaperBot, leverage, signal, Profit Lock, hedge-threshold or execution changes.
## v10 r54 — preserve Wallet cateType

- Live r53 evidence: DETAIL PROBE 32/35, TYPE 32/32, STATUS 32/32, SIDE 32/32, SYMBOL 0/32, BASE stable_quote 32, QUOTE asset 32.
- Root cause in code: Wallet rows carried cateType=inverse, but buildWalletBotRisk omitted cateType from the internal summary.
- r54 carries Wallet cateType into the summary and preserves it across detail merge.
- The inverse quote->asset symbol fallback remains restricted to explicit inverse semantics.
- No trading, Bot trading, transfer, matching threshold, PaperBot, Profit Lock, hedge-threshold, leverage or execution changes.
## v10 r55 — live/reference match-stage diagnostics

- Live r54 evidence: BOT SOURCE WALLET DETAIL; RISK NORMALIZED 32/32; NORMALIZER ALL 32/32; SUPPORTED MATCH 0/32.
- Adds aggregate diagnostics for ASSET / SIDE / LEVERAGE / STRUCTURE / STRONG / ACCEPTED matching stages.
- Adds aggregate LIVE vs REFERENCE side distributions and field availability for leverage/lower/upper/BE/LIQ/TP.
- No bot IDs or private numeric position values are exposed by the new diagnostic.
- No matcher threshold, ambiguity rule, trading, PaperBot, Profit Lock, hedge or execution change.
## v10 r56 — economic-side diagnostics

- Input evidence from r55: ASSET 32/32; SIDE 24/32; LEVERAGE 10/32; STRUCTURE 2/32; STRONG 0; ACCEPTED 0.
- Live declared side distribution: SHORT 27 / LONG 5.
- Reference distribution: SHORT 10 / LONG 24.
- Live matching fields present on all 32 rows: leverage/lower/upper/BE/LIQ/TP.
- Adds aggregate ECON side from liquidation geometry, TREND↔ECON agreement/opposition, asset-only leverage/structure pass and ECON-side-to-reference pass counts.
- Diagnostic only: no side remap, threshold change, action unlock, PaperBot change or execution change.
## v10 r57 — API-native bot identity

- Initial 28.09.2026 BTC spot-check screenshots showed LONG bots, but current inventory can contain both LONG and SHORT bots; do not carry forward any global "no shorts" assumption.
- The DOT SHORT sample from 18:58 was closed immediately afterwards and is historical only. Use the fresher SUI pair from 19:05–19:06 as the current manual side-validation sample: SUI COIN-M SHORT 4x creation 1.0043, break-even 1.0252, liquidation 1.5636; SUI COIN-M LONG 4x creation 1.2463, break-even 1.2218, liquidation 0.6859. These screenshots are validation samples only, not a canonical bot inventory.
- The 27.09 Asset-Watch snapshot is stale and is no longer suitable as an identity gate.
- Complete fresh Wallet-detail rows with unique bot IDs can now identify themselves directly.
- Inverse Coin-M side is economically validated from direct positionOpenPrice/liquidationPrice when clear; original trend remains diagnostic.
- Asset Watch remains historical/reference only.
- No trading, transfer, PaperBot, Profit Lock, hedge-threshold, leverage or execution change.
- Missing PnL, capital, risk or fresh market data still blocks Decision Ready.


## v10 r58 — Coin-M reciprocal convention fix

- r57 live identity path is healthy: Wallet Detail is selected and 32/32 supported futures-grid rows normalize.
- Remaining defect isolated from live screenshots: quote-inverse Coin-M detail prices were still rendered in reciprocal API units, producing values such as BTC BE 0.000011999 / TP 0.000010526 and an inverted-looking LONG/SHORT distribution.
- r58 converts quote-inverse entry/range/LIQ/TP/SL into asset/USD before side/risk use, flips pair-direction trend into the asset perspective, and keeps raw trend only as diagnostics.
- Current SUI LONG 4x and SHORT 4x screenshots plus the BTC reciprocal sample are regression fixtures.
- Safety remains fail-closed: missing PnL or unverified LIQ still blocks Decision Ready; no execution or trading behavior is enabled.


## v10 r59 — post-r58 live acceptance

- r58 side/price normalization is live-confirmed: current SUI renders 1 LONG + 1 SHORT and the stop-loss/liquidation relationship is coherent.
- Wallet Detail currently supplies 28/28 API-native supported bot identities from 31 wallet source rows; Decision Ready remains 0 because PnL is still unavailable, which is intentional fail-closed behavior.
- r59 removes legacy COMMAND repaint duplicates, relabels leveraged exposure as NOTIONAL, and promotes fresh `pionexAccount.wallet.totalInUsdt` ahead of screenshot equity fallback.
- Do not infer total-profit figures from wallet `profit` until its unit/semantics are independently validated.


## v10 r60 — live acceptance follow-up

- r59 confirmed correct SUI 1 LONG + 1 SHORT, API NATIVE 28/28 and notional labels.
- Remaining stale-view defects are handled in r60: COMMAND rebuilds from current state on data sync; tab clicks force the v10 renderer after legacy navigation.
- Wallet diagnostics now expose TOTAL / BOT ACCOUNT / TRADER ACCOUNT plus wallet age to determine why canonical Pionex equity may still be unavailable.
- Missing totals remain `—`; no wallet profit field is treated as PnL.
- Execution and decision gates remain unchanged and fail-closed.


## v10 r61 — live acceptance follow-up

- r60 COMMAND refresh is confirmed live.
- BOTS still showed legacy v9 rendering after tab navigation; r61 adds a semantic `meridian:view` event from the source renderer and forces v10 decoration from it.
- Pionex portfolio source now prefers a fresh Wallet API total over an untimestamped/older private snapshot; newer fresh private snapshots remain valid.
- Market technical freshness remains independently fail-closed and is not changed by this patch.
- Execution impact remains false.


## v10 r62 — mobile stale-cache hardening

- Production r61 was verified by runtime smoke before the user still observed r60, proving the issue was a stale mobile/PWA shell rather than deployment state.
- r62 updates the PWA launch target, links the manifest, adds a no-store version probe/self-reload to the v10 shell, and extends runtime smoke to guard these invariants.
- r61 live evidence also showed BOTS still falling back to the legacy renderer; r62 now makes v10 own the bottom-tab onclick handlers and directly renders the selected v10 view after the bridge updates the underlying view.
- Existing clients already stuck on a pre-r62 shell require one cache-busted open. Once r62 is running, later stale builds can self-heal.
- Execution impact remains false.


## v10 r63 — portfolio reconciliation fix

- r62 navigation and Wallet API integration are live-confirmed.
- Current screenshots showed Pionex ~35.5k USD, OKX ~119 USD and Ledger ~799 USD; the ~68k MERIDIAN headline was caused by ~32.5k of stale historical holdings being repriced as if still owned.
- r63 production portfolio mode is STRICT_VENUE_SNAPSHOT:
  - Pionex = fresh Wallet API;
  - Ledger + OKX = current local venue references;
  - stale holdings = excluded;
  - holdings from a venue with a current venue total = superseded;
  - canonical total = fail-closed until both expected external venues are current.
- COMMAND contains a local-only Ledger + OKX reconcile action. No personal balances are committed.
- Expected current total after entering the 28.09.2026 screenshot values is approximately 36.4k–36.5k USD depending on the Pionex Wallet API timestamp.
- Execution impact remains false.


### r63 history note
Portfolio history capture is also fail-closed now: the backend will not append another canonical history point unless current Ledger + OKX venue authority is complete. Existing pre-r63 history may contain the stale-holdings basis, so COMMAND suppresses HIST Δ comparison until the history point itself reports STRICT_AUTHORITY.


## v10 r64 — Ledger auto valuation

- r63 live acceptance confirmed the corrected portfolio basis and exposed the remaining manual Ledger drift.
- r64 reuses the authenticated private Ledger holdings and values them browser-side from the existing Binance Spot all-ticker feed after a local 24h Ledger confirmation.
- The current r63 Ledger local reference can bootstrap the first confirmation, so an already reconciled device should switch automatically after r64 loads if private Ledger holdings are present.
- COMMAND now separates LEDGER AUTO, OKX and PIONEX. Ledger confirmation and OKX amount refresh are independent controls.
- The diagnostic label `TREND` is renamed to `API TREND` so it cannot be confused with economic LONG/SHORT side.
- History capture remains fail-closed until a server-side authority path is designed for the new local-only external basis.
- Execution impact remains false.


## v10 r65 — market stale remediation

- r64 live acceptance: portfolio is coherent, but technical market health can drop to `NO TIMESTAMP · 0/15` while private/Pionex data remains fresh.
- Root path identified: technical candles were still fetched directly by the iOS browser from OKX/Binance Futures.
- r65 adds protected `/api/private/market-klines` on the Northflank gateway with OKX -> Binance fallback and timestamp-preserving cache.
- v9 market adapter now requests the gateway first and only uses direct browser requests as fallback.
- Feed timestamps propagate through closed-candle normalization into `assetIntel.updatedAt` and `marketSyncedAt`; stale cache cannot masquerade as a new sample.
- COMMAND and MARKET show `MERIDIAN_GATEWAY`, `DIRECT_FALLBACK`, or `UNKNOWN` plus market errors.
- Execution impact remains false.


## v10 r66 — PnL blocker remediation

- r65 live screenshots: 28/28 API-native bot identity, 28/28 safety-ready, 0/28 decision-ready.
- Bot cards show valid capital/BE/TP/liq but blank PnL.
- Root cause: futures-grid detail normalization intentionally accepts only explicit USD-PnL fields, while the live inverse bot details do not expose one; Wallet bot entries do expose native `profit` + `investmentToken`.
- r66 preserves Pionex Wallet USD prices and converts inverse native profit only when token == normalized asset.
- UI adds `PNL USD READY`, PnL source counts, and separate `PNL miss` / `MKT miss` decision blockers.
- Expected live target after account sync + fresh market feed: 28/28 PnL-normalized and 28/28 decision-ready, unless a row genuinely lacks a valid wallet profit or market dataset.
- Execution impact remains false.


## v10 r67 — compact BOTS navigation

- r66 live acceptance confirms 28/28 PnL-ready and 28/28 decision-ready.
- Risk/Profit-Lock audit found no data-readiness blocker remaining: Profit Watch/Lock counts now derive from the same decision-ready rows and existing thresholds.
- Safety warnings continue to outrank Profit Lock; the SL-vs-liquidation check remains unchanged and is intentionally independent from PnL readiness.
- r67 changes only presentation: risk-sorted collapsible asset cards, critical asset auto-open, open-state persistence, compact healthy header and collapsed technical diagnostics.
- Per-bot detail fields remain available after opening an asset.
- Execution impact remains false.


## Agent handoff — secure Pionex Asset Watch bridge (DO NOT MERGE CONCURRENTLY)

- User request: Asset Watch bot values/limits should refresh from the existing read-only Pionex API path instead of relying on stale screenshots.
- This agent intentionally works on isolated branch `feat/pionex-asset-watch-bridge-agent` and MUST NOT merge while another release/agent merge is in progress.
- Adds protected `GET /api/private/asset-watch`; existing Bearer read auth remains mandatory. No public bot/portfolio endpoint is introduced.
- The response is sanitized: raw Pionex bot IDs, credentials, balances and unrelated private dashboard data are not exposed.
- Overwrite is fail-closed: consumers may replace the Asset Watch bot roster only when `usableForOverwrite === true` (fresh <=15 min, source sync OK, detail hydration complete). Otherwise retain the prior trusted snapshot.
- Preferred source is the direct Pionex bot detail sync; fresh Wallet bot detail is authenticated fallback.
- Bot refs are one-way hashed; snapshot fingerprint is stable across row ordering and changes when bot limits/values change.
- API fields exported for watch updates include side, leverage, range lower/upper, liquidation, TP, SL, grids, position size/open price, margin flags, investment and PnL when available.
- Important semantic guard: official Pionex Futures Grid detail exposes `positionOpenPrice`, not the UI break-even field. The bridge therefore exports `breakEvenPrice: null` and explicitly marks the screenshot break-even as retained reference until a direct authoritative source exists. Do not silently relabel entry/open price as break-even.
- Execution impact: false. No Pionex mutation endpoint, no trading action and no credential material added.
- Runtime smoke additionally asserts anonymous Asset Watch access remains HTTP 401.
- Main agent: rebase/reconcile after the current merge window, run full test/release gates, then merge only once no parallel agent is merging.


### Asset Watch bridge phase 2 — scoped automation link

- Because scheduled ChatGPT/web reads cannot attach MERIDIAN's normal Bearer header, the bridge now supports a separate revocable capability token scoped only to the sanitized Asset Watch endpoint.
- Full private Bearer auth is required to create/rotate/revoke this token. The server returns the plaintext once and stores only SHA-256.
- A scoped token can read only `GET /api/private/asset-watch?share=...`; it cannot read `/api/private/dashboard`, market-klines or any other private route, and it cannot mutate anything.
- BOTS > TECHNISCHE DETAILS contains explicit user controls to create/rotate, copy, and revoke the Asset Watch link. Token creation is never automatic.
- The UI keeps the plaintext link in memory only; it is not written into markup or localStorage by this feature. Refreshing the page forgets the plaintext, while the server-side hash remains valid until rotate/revoke.
- Asset Watch overwrite remains fail-closed on `usableForOverwrite === true`.
- Release Safety run #1429 is green on head `5c9f9c9dfaccde055cf22faee87e83088ece0888`.
- PR #248 stays draft/unmerged. Current main is one coordination checkpoint beyond this PR base and does not overlap these files; Main Agent still owns final rebase/merge timing.

---

## SSOT UPDATE — 2026-10-05 · Cross-Venue Funding Edge V1 source closure / V2 preregistration

- Cross-model governance is active: ChatGPT is Lead; Claude is independent Review Sub-Agent. Sensitive research PRs require Claude GREEN LIGHT on the exact PR HEAD-SHA plus green CI.
- PR #529 merged validator correctness on main `a52c56010b9a547061c82d37840f5335465b3754`.
- Post-merge Source Audit run `37270798106`: invariants SUCCESS, source FAILURE with `OKX_INVALID_FUNDING`. This is expected fail-closed evidence, not a source receipt or stage lock artifact.
- Blocker issue #528 records the authoritative-source incompatibility. No Cross-Venue Funding Edge V1 strategy PnL was calculated or inspected.
- User selected fail-closed option A: do not amend/rescue V1. V1 closes as `CROSS_VENUE_V1_SOURCE_FAIL`; all later V1 stages remain unauthorized.
- `CROSS-VENUE-FUNDING-EDGE-V2` is a new preregistered successor. It retains V1 economics/gates but preregisters generic venue-outage/off-grid integrity semantics.
- V2 is only `PREREGISTERED`. Its Source Audit remains disabled. The next allowed step is a separate V2 implementation/source-contract PR that freezes exact source boundaries and integrity-event construction before any V2 source audit or strategy PnL.
- Closed V1 source collection must not continue on main; the V1 source workflow is stage-gated and skips collection when `sourceAudit !== true`.

## SSOT UPDATE — 2026-10-05 · Active research lane / cross-model routing alignment

- Canonical main checkpoint before this governance update: `ae4d9f490a43972ad2fc3c768c8744849790ba22`.
- PR #530 is merged: Cross-Venue Funding Edge V1 is permanently `SOURCE_CLOSED`; V2 is `PREREGISTERED`.
- PR #532 is merged: the canonical V1 closure / V2 preregistration lineage is pinned by the global Frozen Research Guard.
- Active research lane is now explicitly `CROSS_VENUE_FUNDING_EDGE_V2`; Quarter-Hour Strategy V1 remains frozen/canonical but is **PAUSED** and must not be resumed implicitly.
- GPT-6 routing fields are Lead-internal target routing only. Claude is the independent cross-model reviewer and must match `MERIDIAN_LEAD_LEASE.json.subAgent`.
- Next allowed work: V2 implementation/source-contract only. V2 Source Audit, strategy PnL, Discovery, Paper and Live remain unauthorized.

## SSOT UPDATE — 2026-10-05 · Cross-Venue Funding Edge V2 source-audit authorization

- Canonical pre-transition main: `2e463a533e8d0a6de3b509620cb1af7da847acd5`.
- PR #535 is merged. V2 implementation/source contract, strict collector, accounting primitives, causal entry/recovery rules, coverage evidence and source-gate workflow are frozen in the global Frozen Research Guard.
- Post-merge V2 Source Gate run `37287414973`: invariants SUCCESS; source collection SKIPPED because `sourceAudit=false`.
- Release Safety run `37287414943`: SUCCESS. Runtime Smoke run `37287414927`: SUCCESS.
- This transition changes only the V2 research stage from `PREREGISTERED` to `SOURCE_AUDIT` and sets `sourceAudit:true`.
- Discovery, Validation, Holdout, strategy PnL, Paper and Live remain unauthorized.
- After reviewed merge, the frozen main-only V2 Source Gate may run the source collector automatically. The resulting run is source evidence only and cannot authorize a later stage.
- Any later transition requires a separate exact-head cross-model review.

## SSOT UPDATE — 2026-10-05 · Cross-Venue Funding Edge V2 canonical source audit result

- Canonical main/source commit: `63f93aa41b6e054b229309b6fd6fbc2447a92181`.
- Canonical V2 Source Gate run: `37290831222`, attempt `1`; source job `111700620728`.
- Attempt classification fixed pre-result: `FINAL_SOURCE_SEMANTIC_RESULT / SUCCESSFUL VALIDATOR RESULT`; no retry was used.
- Artifact: `11336541442` (`cross-venue-funding-edge-v2-source`), ZIP SHA-256 `97bf9772ed10e741d5a2a0de64ccde7e4dec703178f1b662796b0ce7f3258a32`, source package SHA-256 `a2bb7802a6c6b4298466d16e0225ef616fe36ae2d85ac4af9d020127be4ce91b`.
- Canonical source receipt digest: `822a42728e8f9c1da61059eb31d10fea9771adac34042dfede6fa9f3e63845d5`.
- Validator state: `VALID_WITH_INTEGRITY_EPISODES`; 5,019 common funding decision timestamps; strategy PnL calculated = false.
- Exactly three source-integrity events are preserved, all on OKX 2022-12-18: `FUNDING_GAP`, `MISSING_SCHEDULED_FUNDING` at 16:00 UTC, and authoritative `OFF_GRID_FUNDING` at 18:54 UTC.
- These events are expected under the frozen V2 semantics and do not invalidate the source contract. Their economic consequence depends on future causal position state and has not been evaluated.
- V2 remains at `SOURCE_AUDIT`; Discovery, Validation, Holdout, strategy PnL, Paper and Live remain unauthorized.
- Before any Discovery authorization, implement and review: strict boolean `entryActive`, deterministic degradation episode state machine, pending-entry/open-position wiring, independent cash/equity ledger, and generic causality tests.

## COORDINATION CHECKPOINT — 2026-10-05 · PR #542 current-base refresh

- While PR #542 awaited the independent Claude SOURCE_RECEIPT / DATA_CONTRACT review, canonical `main` advanced from `63f93aa41b6e054b229309b6fd6fbc2447a92181` to `d4a628fee5cf527e0218b99635d80b9cd91bd0ad` via the unrelated r113 COMMAND liquidation-distance UI change.
- The main advance touches only UI/version/tests and does not overlap the ten PR #542 source-evaluation/continuity files.
- This checkpoint intentionally changes no source evidence, receipt, data contract, stage lock, accounting or strategy logic. Its commit exists to force current-base PR CI and therefore invalidates the prior exact-head review request.
- A new exact-head Claude request is required before merge. V2 remains `SOURCE_AUDIT`; no Source Audit rerun and no strategy PnL.

## COORDINATION CHECKPOINT — 2026-10-05 · PR #542 current-base gate repair

- Current-base CI on exact HEAD `3a937befde11ea97d443073bd5ba16f73bf6440a` correctly failed Agent Orchestration Safety because r113 raised `version.json.terminalBuild` to `10.0-r113` while PR #542 still persisted top-level continuity build `10.0-r112`.
- Repair is continuity-only: align `MERIDIAN_RESUME.build`, `MERIDIAN_RESUME.sourceOfTruth.verifiedSha`, `MERIDIAN_AGENT_STATE.lastCheckpoint`, and the Chat Handoff build/checkpoint to current main `d4a628fee5cf527e0218b99635d80b9cd91bd0ad` / `10.0-r113`.
- Canonical V2 source lineage remains `63f93aa41b6e054b229309b6fd6fbc2447a92181`; source evidence, receipt digests, collector, data contract, stage lock, accounting, Frozen Guard pins and strategy semantics are unchanged.
- This repair creates a new exact HEAD and therefore requires Claude review loop 3/3 before merge. No Source Audit rerun and no strategy PnL.

## SSOT UPDATE — 2026-10-05 · V2 runner implementation candidate — NO PNL

- Branch: `research/cross-venue-funding-edge-v2-runner-contract`, based on main `dfa8b5e63afa74d28e21670cd9cbab0ae36a7e92`.
- Implements the Claude-reviewed pre-implementation design only: strict degradation/entry booleans, deterministic runner event ordering/state machine, split-isolation helper, self-locked runner entry, independent event-sourced ledger and synthetic causality/accounting regression tests.
- `reconcileCycleAccounting` is removed from the public V2 primitive surface; reconciliation now requires a verified `EVENT_SOURCED_V2` ledger plus independent analytic decomposition.
- Frozen Guard pins the updated V2 implementation/data-contract/core/tests plus the new runner/ledger modules and tests.
- Canonical V2 source lineage and receipt remain unchanged; the canonical source artifact is not read by these tests.
- Authoritative stage remains `SOURCE_AUDIT`; `discovery=false`, `validation=false`, `holdout=false`, `paper=false`, `live=false`.
- No canonical runner execution and no strategy PnL occurred.
- Next required gate: exact-head Claude review of the implementation candidate after green CI. Merge does not authorize Discovery; any Research-stage transition requires a separate reviewed PR.

## COORDINATION CHECKPOINT — 2026-10-05 · V2 runner candidate current-base checkpoint

- Candidate branch base main is `dfa8b5e63afa74d28e21670cd9cbab0ae36a7e92`; build remains `10.0-r113`.
- Top-level Resume / Agent-State / Chat-Handoff checkpoint is aligned to that main SHA before PR CI.
- Canonical V2 source lineage remains independently fixed at `63f93aa41b6e054b229309b6fd6fbc2447a92181` / run `37290831222` / receipt `822a42728e8f9c1da61059eb31d10fea9771adac34042dfede6fa9f3e63845d5`.
- This alignment changes no runner semantics, source evidence, stage lock, economics or PnL authorization.

## SSOT UPDATE — 2026-10-05 · V2 runner merged and diagnostic source confirmation

- PR #543 merged as `f188fe5af0eba4e486f6ec9193f0a8b7f6a3f530` after exact-head Claude `CV2-RUNNER-IMPL-R2` GREEN LIGHT on `101a7ac9cc7bde3c9003d162a2bb2ca820fa9c63`.
- Runner/state-machine and independent event-sourced ledger are now reviewed and frozen; no canonical runner execution or strategy PnL occurred.
- V2 remains `SOURCE_AUDIT`; `discovery/validation/holdout/paper/live` remain false.
- Post-merge Release Safety, Agent Orchestration, Runtime Smoke, Release Coordinator and Pages completed successfully.
- Main push triggered later-commit diagnostic V2 Source Gate run `37299638135`, attempt 1, artifact `11341850465`.
- Diagnostic receipt digest is exactly canonical: `822a42728e8f9c1da61059eb31d10fea9771adac34042dfede6fa9f3e63845d5`; therefore the frozen Authorization rule classifies this as a determinism confirmation, never replacement evidence.
- Diagnostic ZIP SHA-256 is `aa61864d36c5184e370b9412337e68ff560a4475db6bf1c46fa4f730ac7a3fc2`; diagnostic package SHA-256 is `15e7a656be11850ab67bd04af313663794445be9a2bcd0acb49195b76a53ed3a`.
- Structured diff against canonical package `a2bb7802a6c6b4298466d16e0225ef616fe36ae2d85ac4af9d020127be4ce91b` has exactly one difference: `provenance.collectedAt`. Data arrays, integrity events, source receipt and semantic digests are unchanged.
- Canonical source lineage remains run `37290831222`, attempt 1, commit `63f93aa41b6e054b229309b6fd6fbc2447a92181`, artifact `11336541442`; later run cannot replace it.
- Next gate: pre-implementation cross-model design review for the canonical Source→Runner event builder. Builder must prove causal construction, complete split streams through required fill horizons, strict runner inputs, and builder-level G16–G18 invariance before implementation.

## r115 continuity checkpoint — 2026-10-05

- Verified pre-checkpoint main: `c009326529e162f84bb985d0aca2de6cf5065c18`; build `10.0-r115`.
- V2 source seal (#545), runner boundary fix (#546), Event Builder (#547), Runner Adapter (#548), and synthetic Strategy/Driver (#549) are merged, reviewed, and frozen.
- Claude mailbox automation (#550) is merged; ChatGPT remains Lead and Merge-Owner; Issue #539 is read before each Meridian step.
- UI r114/r115 (#551/#552) is merged and post-merge gates are green.
- V2 stays `SOURCE_AUDIT`; canonical strategy execution, strategy PnL, Discovery, Validation, Holdout, Paper, and Live remain locked.
- Next Research action requires explicit user authorization and separate exact-head Claude review. No completed work above should be repeated.
- Funding-Carry Candidate A remains secondary and data-design is not authorized.
