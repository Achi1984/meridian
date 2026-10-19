# D2 historical bridge — adversarial acceptance map

**Preparation only; not a verdict, execution approval, or prerequisite to #905.**
This is a bounded challenge aid for the Lead's review of the published #905
snapshot `aa47ec42c74501006a5e8b3b9c405ab78c01387c`, inspected 2026-10-19 UTC.
No captured CSV, including headers, was read; no engine or strategy was run.
Implementation claims below remain pending exact-final-head review and checks.

## Read coverage and D1 carry-forward

Read `/home/runner/work/meridian/meridian/MERIDIAN_GO.md`; issue #904 and
owner scope decision #905 comment `6274060447`; bounded latest #639 mailbox
items; frozen `/home/runner/work/meridian/meridian/research/protocols/b1-7-20261018/protocol.json`
and `/home/runner/work/meridian/meridian/research/protocols/b1-7-20261018/EXECUTION_REQUEST.md`;
B1 `/home/runner/work/meridian/meridian/scripts/research/b1-7/captured-input.mjs`,
`/home/runner/work/meridian/meridian/scripts/research/b1-7/engine.mjs`,
`/home/runner/work/meridian/meridian/scripts/research/b1-7/validate.mjs`;
`/home/runner/work/meridian/meridian/scripts/research-supervisor/{supervisor.py,journal.py,b1_adapter.mjs,historical_adapter.mjs,test_supervisor.py}`;
`/home/runner/work/meridian/meridian/test/b1-7-captured-input.test.js`; and
`/home/runner/work/meridian/meridian/docs/research/d1-20261019/verification.json`.
Inspected published #905 source/tests at the pinned head above, not an
unpublished or later version. No tests or data verification were rerun.

D1 remains `VERIFIED_DRAFT_NOT_ADMITTED`: manifest `NOT_FROZEN`,
`sourceAuthenticity=NOT_ESTABLISHED`, `admitted=false`,
`strategyExecuted=false`, and `returnsComputed=false`
(`/home/runner/work/meridian/meridian/docs/research/d1-20261019/verification.json:2-6,112-116`).
Hash/row checks are byte/shape evidence only, not exchange
authentication; reuse those findings rather than repeating data verification.

## Case-to-evidence matrix

| Adversarial case | Existing enforcement / test; expected safe outcome | Specific evidence still missing or false-positive risk |
| --- | --- | --- |
| Denial before market-file I/O | #905 profile is `NOT_FROZEN` with null manifest/receipt (`/home/runner/work/meridian/meridian/scripts/research-supervisor/historical_run_profile.json:4,19-22`); `loadCapturedInputs()` checks admission before `loadSeriesFromRoot()` (`/home/runner/work/meridian/meridian/scripts/research/b1-7/captured-input.mjs:44-52,94-100`); test asserts the blocked code and inert adapter (`/home/runner/work/meridian/meridian/test/b1-7-captured-input.test.js:90-114`). Expected: reject before any CSV open. | Test does not instrument filesystem opens; source order is evidence, not an exact-head execution trace. Verify denial for every entry route and that no read occurs before receipt/profile rejection. |
| Missing, malformed, stale receipt | `inspectHistoricalAdmission` blocks null receipt and rejects malformed structure, stale field bindings, wrong source and reordered paths (`/home/runner/work/meridian/meridian/scripts/research/b1-7/historical-admission.mjs:64-123`); generated tests cover null, malformed/accessor and mutated digest/path candidates (`/home/runner/work/meridian/meridian/test/b1-7-captured-input.test.js:132-216`). Expected: no admission. | Cases construct candidates in memory, not all persisted profile states. Confirm invalid timestamp, duplicate/extra path IDs, missing fields and malformed manifest fail at production entrypoints, not only this helper. |
| Forged but well-shaped receipt | Receipt fields bind owner/decision/time plus identities (`/home/runner/work/meridian/meridian/scripts/research/b1-7/historical-admission.mjs:8-12,117-123`; Python mirror `/home/runner/work/meridian/meridian/scripts/research-supervisor/journal.py:331-349`). Expected: only the actual owner D2 decision can authorize. | **Highest false-positive risk:** these checks validate caller-supplied strings and hashes; they do not authenticate who authored them or compare an exact owner-decision record. Tests reject malformed fakes but do not establish rejection of a correctly shaped fabricated receipt. Lead must verify receipt against the actual identity-bound owner decision; code checks alone are not authorization evidence. |
| Exact source / protocol / input / profile / path binding | Admission compares source commit, protocol and implementation hashes, manifest digest, run-profile digest, trial key and ordered path IDs (`/home/runner/work/meridian/meridian/scripts/research/b1-7/historical-admission.mjs:89-112`); Python profile checks source-file pins and derived identities (`/home/runner/work/meridian/meridian/scripts/research-supervisor/journal.py:243-304`). Expected: any changed identity blocks. | Tests mutate several identities and swap IDs, but no full historical admission is exercised with a real, frozen manifest. Independently recompute final-head source/profile/path identities; do not accept copied or stale pins. |
| Generated test hooks versus production root | `runB1Adapter` rejects test scenarios for the historical profile; test manifest override is in synthetic-only branch (`/home/runner/work/meridian/meridian/scripts/research-supervisor/b1_adapter.mjs:77-107`); production loader has no caller root parameter (`/home/runner/work/meridian/meridian/scripts/research/b1-7/captured-input.mjs:27-29,94-100`). Expected: generated fixture paths/hooks cannot supply production admission or redirect the real root. | Existing tests prove synthetic bytes/options do not unlock the currently missing manifest (`/home/runner/work/meridian/meridian/test/b1-7-captured-input.test.js:68-88`), not a complete adversarial matrix for `B1_RUN_PROFILE`, `NODE_ENV`, `B1_TEST_*`, or root substitution. Confirm those negative paths on exact final source with generated temporary roots only. |
| Synthetic / historical identity separation | Engine identities distinguish `SYNTHETIC_FIXTURE` from `FROZEN_RESEARCH_INPUT` and bind provenance (`/home/runner/work/meridian/meridian/scripts/research/b1-7/engine.mjs:526-540`; `/home/runner/work/meridian/meridian/scripts/research/b1-7/validate.mjs:172-199`); journal summary validation requires historical origin/labels versus synthetic origin (`/home/runner/work/meridian/meridian/scripts/research-supervisor/journal.py:1325-1345`). Expected: fixture output never represents historical data. | Existing end-to-end 44-path evidence is generated-fixture only (`/home/runner/work/meridian/meridian/scripts/research-supervisor/test_supervisor.py:176-215`). No historical run is permitted or evidenced here; final review must ensure every success/failure result preserves the distinction. |
| All 44 ordered paths and two scored segments | Frozen profile fixes 44 paths, 410 warmup / 180 development / 365 diagnostic and ordered variants/scenarios (`/home/runner/work/meridian/meridian/scripts/research-supervisor/historical_run_profile.json:24-68`); journal records ordered path IDs and phase boundary (`/home/runner/work/meridian/meridian/scripts/research-supervisor/journal.py:1430-1443,1695-1715`). Expected: exact manifest order, 19 development paths then 25 diagnostic paths; warmup is unscored. | Synthetic test checks 44 IDs/order and 19/25 phase labels (`/home/runner/work/meridian/meridian/scripts/research-supervisor/test_supervisor.py:176-206`); this does not demonstrate historical data execution. Confirm descriptor/order identities against the frozen protocol and final bridge pins; no path may be skipped, reordered, or substituted. |
| Corrupted, substituted, duplicate, or partial result | Journal validates path schemas/identity, ordered progress, payload digests, summary identities/counts and only completes with 44 committed paths (`/home/runner/work/meridian/meridian/scripts/research-supervisor/journal.py:1147-1222,1428-1559,1833-1888`). Fault tests cover forged digest, duplicate, truncation, extra frame, output cap and false events (`/home/runner/work/meridian/meridian/scripts/research-supervisor/test_supervisor.py:537-566,788-796`). Expected: invalid/partial/failed, never completed or ranked. | Fault evidence is synthetic-adapter testing. Exact-head review must check that historical results traverse the same validators and that partial/unknown states cannot be summarized as PASS. |
| Deadline, output bound, crash | Supervisor applies absolute path/batch deadlines, byte bounds and process-group termination (`/home/runner/work/meridian/meridian/scripts/research-supervisor/supervisor.py:317-340,440-455,556-630`); tests cover path/batch deadlines, output flood, child crash and inherited pipes (`/home/runner/work/meridian/meridian/scripts/research-supervisor/test_supervisor.py:396-498,722-786,849-858`). Expected: bounded child, durable timeout/failure, no retry or completion on partial work. | Existing tests exercise synthetic/fault adapters, not historical data. Recheck caps cover startup, finalization, all 44 paths, and result serialization on final head; a timed-out/uncertain process must remain non-replayable. |
| Attempt-once marker, fence, repeat refusal | Journal claim/start/path transitions bind owner/fence and consumed attempt (`/home/runner/work/meridian/meridian/scripts/research-supervisor/journal.py:1590-1692,1695-1758`); crash/lost-ack tests retain attempt/fence and refuse restart (`/home/runner/work/meridian/meridian/scripts/research-supervisor/test_supervisor.py:396-447,849-858`). Expected: same trial cannot rerun; unknown outcome stays unresolved until separately reconciled. | Historical profile stays dormant in its test (`/home/runner/work/meridian/meridian/scripts/research-supervisor/test_supervisor.py:101-119`); no historical claim/run/restart path has been exercised. Review durable database semantics and every failure boundary for the historical profile; do not infer recovery authority. |
| Historical labels and source authenticity | Profile and summary validator pin historical-diagnostic, non-holdout, assumed-cost, no-OKX-execution and `NOT_ESTABLISHED` labels (`/home/runner/work/meridian/meridian/scripts/research-supervisor/historical_run_profile.json:73-80`; `/home/runner/work/meridian/meridian/scripts/research-supervisor/journal.py:1250-1350`). Expected: all outcomes remain historical-only; no fresh holdout, no provenance upgrade, no Paper/Live authority. | Labels are assertions, not independent evidence of provenance. Verify completed, failed, partial and output-compacted paths preserve them and all authority fields remain false. D1's `NOT_ESTABLISHED` finding is unchanged. |
| No finite stop / assumed costs | Profile fixes `NO_FINITE_TRADE_STOP`, 15/30 bp assumptions and one-day delay (`/home/runner/work/meridian/meridian/scripts/research-supervisor/historical_run_profile.json:48-79`); protocol describes assumptions and CRV as undefined (`/home/runner/work/meridian/meridian/research/protocols/b1-7-20261018/protocol.json:154-157,205-209`); validators require no finite stop (`/home/runner/work/meridian/meridian/scripts/research-supervisor/journal.py:1200-1205,1261-1279,1340-1350`). Expected: no fabricated finite CRV, measured fees, or executable-fill claim. | Final report/result review must check values and narrative, not just enums; a `PASS` remains a historical candidate only, never significance, holdout or forward eligibility. |

## Frozen-protocol discrepancy

`/home/runner/work/meridian/meridian/research/protocols/b1-7-20261018/protocol.json`
says input is caller-supplied in-memory OHLC and explicitly
sets `filesystemDiscovery=false` and `csvLoader=false` (`protocol.json:44-51`); the #905
historical route instead calls `loadCapturedInputs()` to read pinned CSV files
(`/home/runner/work/meridian/meridian/scripts/research/b1-7/captured-input.mjs:94-100`,
`/home/runner/work/meridian/meridian/scripts/research-supervisor/b1_adapter.mjs:89-94`). This is a concrete
contract contradiction, not resolved by unchanged protocol hashes or by
`/home/runner/work/meridian/meridian/research/protocols/b1-7-20261018/EXECUTION_REQUEST.md`.
Do not alter the frozen protocol in this packet; the
Lead must explicitly reconcile the mismatch during source review before
calling the bridge protocol-consistent.

## Handoff

Published #905 exact-head source/test review → exact-head CI and independent
verdict → Lead source integration and postchecks → final identity-bound owner
D2 decision → only then separately bounded historical execution and result
assessment. This map neither blocks #905 nor grants execution; a historical
`PASS` never grants Paper or Live.
