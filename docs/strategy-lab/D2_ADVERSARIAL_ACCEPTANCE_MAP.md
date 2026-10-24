# D2 historical bridge — adversarial acceptance map

**Preparation only; not a verdict, execution approval, or prerequisite to #905.**
This bounded challenge aid reflects published #905 snapshot
`c84d9f3926d13df9148875ad47ab618c8b9ecd60`, reviewed 2026-10-19. No captured
CSV (including headers) was read; no engine or strategy was run. Later code or
correction is not assumed.

## Read coverage and D1 carry-forward

Read `MERIDIAN_GO.md`; issue #904 and owner scope decision #905 comment
`6274060447`; bounded latest mailbox #639 items; `protocol.json` and
`EXECUTION_REQUEST.md` under `research/protocols/b1-7-20261018/`; B1
`captured-input.mjs`, `engine.mjs`, `validate.mjs`; supervisor, journal,
adapters and existing tests; and `docs/research/d1-20261019/verification.json`.
Inspected published #905 source/tests at the pinned snapshot, not a later head.
No tests or data verification were rerun.

D1 remains `VERIFIED_DRAFT_NOT_ADMITTED`: manifest `NOT_FROZEN`,
`sourceAuthenticity=NOT_ESTABLISHED`, `admitted=false`,
`strategyExecuted=false`, and `returnsComputed=false`
(`docs/research/d1-20261019/verification.json:2-6,112-116`). These are
byte/shape checks, not exchange authentication; reuse them without repeating
data verification.

## Case-to-evidence matrix

| Adversarial case | Existing enforcement / test; expected safe outcome | Specific evidence still missing or false-positive risk |
| --- | --- | --- |
| Denial before market-file I/O | Historical profile has `NOT_FROZEN`, null manifest/receipt (`scripts/research-supervisor/historical_run_profile.json:4,19-22`); loader checks admission before `loadSeriesFromRoot()` (`scripts/research/b1-7/captured-input.mjs:44-52,94-100`); test asserts blocked code and inert adapter (`test/b1-7-captured-input.test.js:90-114`). Expected: reject before opening captured files. | Test does not instrument opens. Also, direct adapter source-byte/profile verification occurs after `loadCapturedInputs()` (`scripts/research-supervisor/b1_adapter.mjs:89-108`); published review marks pre-I/O verification a blocker (#905 comment `6274768662`, #639 comment `6274788484`). Verify ordering on the corrected head before any future admission. |
| Missing, malformed, stale receipt | `inspectHistoricalAdmission` blocks null receipt and rejects malformed shape and mismatched identities (`scripts/research/b1-7/historical-admission.mjs:64-123`); tests construct malformed/accessor and altered digest/path candidates (`test/b1-7-captured-input.test.js:132-216`). Expected: no admission. | This exercises helper candidates, not every committed-profile state. Keep production profile default dormant and verify invalid persisted configuration fails closed. |
| Forged but well-shaped receipt | Receipt schema checks owner/decision/time and identity fields (`scripts/research/b1-7/historical-admission.mjs:8-12,117-123`; `scripts/research-supervisor/journal.py:331-349`). Expected: no claim that a schema-valid receipt authenticates its author. | Strings alone are not owner consent. Production reads committed immutable configuration; no caller-controlled production-admission bypass was demonstrated in the reviewed snapshot. Before later reviewed activation, Lead must verify genuine owner consent bound to the exact final identities. |
| Exact source / protocol / input / profile / path binding | Admission compares source, protocol, implementation, manifest, profile, trial and path bindings (`scripts/research/b1-7/historical-admission.mjs:89-112`); Python validates source pins and derived identities (`scripts/research-supervisor/journal.py:243-304`). Expected: mismatch blocks. | Published snapshot has a verified blocking identity defect: historical profile inherits synthetic input-bound path IDs (metadata-only D1 recomputation matched 0/44); engine path IDs include input identity (`scripts/research/b1-7/engine.mjs:605-623`). #905 correction `6274768662` directs deriving historical identities while preserving synthetic identity. Do not reuse or assume corrected pins; verify corrected exact-head identities. |
| Generated test hooks vs production root | Historical adapter invocation rejects test scenarios, while manifest override is in synthetic-only path (`scripts/research-supervisor/b1_adapter.mjs:77-107`); production loader has no caller-root argument (`scripts/research/b1-7/captured-input.mjs:27-29,94-100`). Expected: generated fixture cannot authorize or redirect production input. | Current tests prove fixture values/options do not unlock the missing production manifest (`test/b1-7-captured-input.test.js:68-114`), not all environment/root attacks. Require generated-temp-root negative tests only; never use generated fixtures to activate production root. |
| Synthetic / historical identity separation | Engine distinguishes `SYNTHETIC_FIXTURE` from `FROZEN_RESEARCH_INPUT` (`scripts/research/b1-7/engine.mjs:526-540`; `scripts/research/b1-7/validate.mjs:172-199`); journal checks corresponding result origin (`scripts/research-supervisor/journal.py:1325-1345`). Expected: synthetic output cannot be historical evidence. | Existing complete 44-path integration is synthetic (`scripts/research-supervisor/test_supervisor.py:176-215`). Published review confirms missing generated historical end-to-end coverage (#905 comment `6274768662`; #639 comment `6274788484`); do not infer historical integration from synthetic parity. |
| All 44 ordered paths and segments | Profile fixes 44 paths, 410 warmup / 180 development / 365 diagnostic (`scripts/research-supervisor/historical_run_profile.json:24-68`); journal enforces ordered IDs and 19/25 phase boundary (`scripts/research-supervisor/journal.py:1430-1443,1695-1715`). Expected: all paths in frozen order; warmup unscored. | Synthetic test checks order/count only (`scripts/research-supervisor/test_supervisor.py:176-206`). Historical path identities in the reviewed snapshot are blocked as above; verify they derive from historical input identity without changing descriptors/order. |
| Corrupt, substituted, partial result | Journal validates path payloads, digests, summary identities/counts and 44 committed paths (`scripts/research-supervisor/journal.py:1147-1222,1428-1559,1833-1888`); fault tests cover forged digest, duplicates, truncation, extra frames, output cap and false events (`scripts/research-supervisor/test_supervisor.py:537-566,788-796`). Expected: partial/invalid never counts as a completed screen. | Two verified snapshot blockers: early `INSUFFICIENT_EVIDENCE` failure summary retains synthetic authenticity while historical validation requires `NOT_ESTABLISHED`; and a legitimate completed 44-path result with screen `INSUFFICIENT_EVIDENCE` is rejected because completed historical screens accept only `PASS`/`NO_EDGE` (`b1_adapter.mjs:194-201,212`; `journal.py:1250-1265`; `engine.mjs:741-752`; #905 comment `6274768662`, #639 comment `6274788484`). Preserve evidence semantics without promoting either outcome. |
| Deadline, output bound, crash | Supervisor enforces deadlines, byte bounds and process-group termination (`scripts/research-supervisor/supervisor.py:317-340,440-455,556-630`); tests cover deadlines, floods, crashes and inherited pipes (`scripts/research-supervisor/test_supervisor.py:396-498,722-786,849-858`). Expected: durable failure/timeout; no retry or completion of partial work. | These are synthetic/fault-path tests, not historical integration. Confirm the same bounds and non-replayable uncertainty on corrected exact head. |
| Durable attempt marker, fence, repeat refusal | Journal binds claim/start/path transitions to owner/fence and consumes the attempt (`scripts/research-supervisor/journal.py:1590-1692,1695-1758`); crash/lost-ack tests preserve attempt/fence and reject restart (`scripts/research-supervisor/test_supervisor.py:396-447,849-858`). Expected: no second run; unknown stays unresolved pending separately authorized reconciliation. | Historical profile is tested dormant only (`scripts/research-supervisor/test_supervisor.py:101-119`). Historical timeout/fence/repeat integration remains unproven; no recovery authority is implied. |
| Historical labels, costs, stop, holdout and authenticity | Profile and validators pin historical diagnostic, non-holdout, assumed-cost, no-OKX-execution and `NOT_ESTABLISHED` labels (`scripts/research-supervisor/historical_run_profile.json:73-80`; `scripts/research-supervisor/journal.py:1250-1350`). No finite stop/CRV is explicit (`journal.py:1200-1205,1261-1279,1340-1350`). Expected: historical candidate at most; no fresh holdout, source-authenticity claim, finite CRV, measured fee, or Paper/Live authority. | Labels are assertions, not provenance. Verify completed, insufficient, failed, partial and compacted results preserve them. Assumed costs and no-stop limitation remain disclosed; a `PASS` is not significance or forward eligibility. |

## Engine / loader boundary

`protocol.json:44-51` specifies the engine's caller-supplied in-memory OHLC
interface and says the engine has no CSV loader or filesystem discovery. An
upstream captured-data loader can be a separate layer supplying validated
in-memory arrays; its existence alone does not establish a change to frozen
mathematics or a protocol contradiction. The reviewed #905 route does add that
loader (`scripts/research-supervisor/b1_adapter.mjs:89-94`). Before any later
admission, review that the loader's source/input identities, validation and
pre-I/O gates are bound to the exact final decision and that the engine still
receives only the frozen interface. Do not demand a protocol rewrite absent
evidence of an engine-interface or mathematical change.

## Handoff

Published #905 exact-head source/test review → exact-head CI and independent
verdict → Lead integration/postchecks → final identity-bound owner D2 decision
→ only then separately bounded historical execution and result assessment.
This map remains a review aid, not a prerequisite or acceptance of #905. A
historical `PASS` never grants Paper or Live.
