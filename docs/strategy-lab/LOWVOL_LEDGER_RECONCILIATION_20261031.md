# LowVol V2 prospective ledger reconciliation — 2026-10-31

Status: evidence-only supplement to Packet P1. No runtime correction, dispatch, rerun, settings change, provider data request, private source download, strategy execution, window reset or activation.

## Finding and boundary

The six scheduled runs inspected for the missing October 17 and October 24 cutoffs all failed during source collection, before snapshot generation, upload or ledger persistence. Their invariant jobs succeeded. This establishes a collection failure in those runs, not an absent schedule. The immediate errors were HTTP 404 for the cutoff-day kline archive on the first attempt and HTTP 404 for the October 10 daily funding archive on the later attempts. Provider-side reasons for those responses remain unknown.

Canonical evidence branch was independently read at `b6b72a1bbf7696abde326793c80270fa77d12f26`. Its snapshot JSON inventory contains only:

| Cutoff | Immutable blob | Eligibility |
|---|---|---|
| 2026-09-26 | 29047140426b9d7a575193be54d002a50f3ac2bd | pre-start diagnostic |
| 2026-10-03 | 00c97502a0e863ff7d2f5c868553eb172fba2803 | pre-start diagnostic |
| 2026-10-10 | 1d55ef64174c9dde449a3b7e54258ac0d653acb1 | start snapshot; zero completed eligible weeks |

[Immutable ledger tree](https://github.com/Achi1984/meridian/tree/b6b72a1bbf7696abde326793c80270fa77d12f26/research/prospective/low-volatility-rank-weighted-v2/snapshots).
No October 17/24 snapshot is present there. This is not proof that no separate artifact exists anywhere. Date-bounded scheduled-run listings were complete within each queried page: October 18–19 returned 65/65 repository runs, October 25–26 returned 61/61; each contained the three relevant runs below. Other event types were not exhaustively searched.

## Run evidence

Workflow ID `374090027`, path `.github/workflows/low-volatility-rank-weighted-v2-prospective.yml`. All times UTC. Run date is October 18 for the October 17 cutoff and October 25 for the October 24 cutoff. Each run: completed/failure; invariant job success; snapshot job failure at step 4, `Collect public prospective source`; build snapshot, both artifact uploads and persistence skipped. All six artifact-metadata reads returned an empty artifact array.

| Cutoff | Run / source head | Created | Snapshot / invariant job | Bounded error / log time |
|---|---|---|---|---|
| 2026-10-17 | [39106744720](https://github.com/Achi1984/meridian/actions/runs/39106744720) / [921246e](https://github.com/Achi1984/meridian/commit/921246e61e07ff0624fb4a24c00a452246e9eb7f) | 07:11:35 | [117614141864](https://github.com/Achi1984/meridian/actions/runs/39106744720/job/117614141864) / 117614116865 | cutoff-day kline 2026-10-17: HTTP 404 / 07:12:03.994 |
| 2026-10-17 | [39128026775](https://github.com/Achi1984/meridian/actions/runs/39128026775) / [10f10f2](https://github.com/Achi1984/meridian/commit/10f10f270a012b2f31679eec2fc2625813b5e18b) | 12:37:01 | [117677193915](https://github.com/Achi1984/meridian/actions/runs/39128026775/job/117677193915) / 117677160808 | funding 2026-10-10: HTTP 404 / 12:37:28.761 |
| 2026-10-17 | [39136702862](https://github.com/Achi1984/meridian/actions/runs/39136702862) / [c42ded8](https://github.com/Achi1984/meridian/commit/c42ded8b7d33312f1a0e232d26a28ed5f0e768b3) | 14:35:46 | [117702593655](https://github.com/Achi1984/meridian/actions/runs/39136702862/job/117702593655) / 117702556060 | funding 2026-10-10: HTTP 404 / 14:36:16.100 |
| 2026-10-24 | [40173184603](https://github.com/Achi1984/meridian/actions/runs/40173184603) / [13b4388](https://github.com/Achi1984/meridian/commit/13b43881e93fe99b4c33cf3607b068e7d19bc452) | 07:32:58 | [121108224674](https://github.com/Achi1984/meridian/actions/runs/40173184603/job/121108224674) / 121108192705 | cutoff-day kline 2026-10-24: HTTP 404 / 07:33:30.653 |
| 2026-10-24 | [40196476784](https://github.com/Achi1984/meridian/actions/runs/40196476784) / [9d223cb](https://github.com/Achi1984/meridian/commit/9d223cb60115dbebdb5671b8782e0dd0763df972) | 13:11:27 | [121178312246](https://github.com/Achi1984/meridian/actions/runs/40196476784/job/121178312246) / 121178277812 | funding 2026-10-10: HTTP 404 / 13:11:58.790 |
| 2026-10-24 | [40204669458](https://github.com/Achi1984/meridian/actions/runs/40204669458) / [2a044ed](https://github.com/Achi1984/meridian/commit/2a044edb5011f415aaf972d206e5fcd6d010f52f) | 14:57:42 | [121203001191](https://github.com/Achi1984/meridian/actions/runs/40204669458/job/121203001191) / 121202963786 | funding 2026-10-10: HTTP 404 / 14:58:15.174 |

Exact bounded error templates (each followed by process exit code 1):

- `RuntimeError: official Binance Vision archive unavailable: https://data.binance.vision/data/futures/um/daily/klines/BTCUSDT/1h/BTCUSDT-1h-2026-10-17.zip: HTTP Error 404: Not Found`
- Same kline URL with `2026-10-24.zip` for October 25 first attempt.
- `RuntimeError: official Binance Vision archive unavailable: https://data.binance.vision/data/futures/um/daily/fundingRate/BTCUSDT/BTCUSDT-fundingRate-2026-10-10.zip: HTTP Error 404: Not Found` for all four later attempts.

The first run on each day started before Sunday 12:00 (the 36-hour deadline). The other two started after it; successful collection alone would not have made these late attempts timely. The reason for scheduling delay is not established.

Current workflow enabled/disabled state is unknown: the connector rejected the workflow-settings URL shape with HTTP 400. This is a tool capability limitation, not a GitHub disabled-state response. Existing scheduled runs establish activity on those historical dates.

## Source mechanism

Inspected source baseline: [ad276e787078b5afdb2260a5f3e703bd9fd4da28](https://github.com/Achi1984/meridian/commit/ad276e787078b5afdb2260a5f3e703bd9fd4da28). [Collector](https://github.com/Achi1984/meridian/blob/ad276e787078b5afdb2260a5f3e703bd9fd4da28/scripts/collect-low-volatility-rank-weighted-v2-prospective.py) line references:

| Lines | Observed contract |
|---|---|
| 22, 28 | Binance Vision base URL; prospective start October 10 00:00 UTC |
| 132–158 | Prior months use monthly archives; cutoff-month days use daily archives, including the cutoff date |
| 154–156 | Kline and funding daily URL construction; funding path is `daily/fundingRate/{symbol}/{symbol}-fundingRate-{ymd}.zip` |
| 162–172 | Every planned archive must load before rows are deduplicated/filtered |
| 221–229 | For BTC first, load and validate hourly continuity before funding |
| 231–235 | Funding loads only if cutoff is strictly later than prospective start; otherwise funding is empty |

Therefore the successful October 10 start snapshot did not exercise funding collection. The first eligible week did. This explains the test-coverage gap without proving that daily funding archives never exist. The module executes collection at top level; it must not be imported as an inspection shortcut.

[Workflow at baseline](https://github.com/Achi1984/meridian/blob/ad276e787078b5afdb2260a5f3e703bd9fd4da28/.github/workflows/low-volatility-rank-weighted-v2-prospective.yml), blob `d4935ee0b01917a84d46a9ea6919c467a8aaec03`, has Sunday 02:15, 08:15 and 11:15 UTC schedules. Current source has retries, not just the originally documented single Sunday schedule. Source collection precedes all snapshot uploads and first-write ledger persistence.

## 12-hour / Saturday versus 36-hour / Sunday receipt reconciliation

[Existing dated receipt audit](https://github.com/Achi1984/meridian/blob/ad276e787078b5afdb2260a5f3e703bd9fd4da28/docs/strategy-lab/LOWVOL_RECEIPT_VERIFICATION_20261014.md) records the following chronology; timestamps below are attributed to that receipt audit rather than newly re-fetched commit objects:

| Evidence | Immutable ref / dated fact | Interpretation |
|---|---|---|
| Older implementation description | blob `d156db5409c94bc6cfface2a65e5fb6bef9a6f40` | 12-hour deadline / Saturday 01:15 |
| Engine change | `ef7f25043a8d8b62a021a883f3bff33945d7064a`, October 3 18:19:34 | 12 → 36 hours |
| Schedule change | `25f6d286b0d56a947c951329849cb0e0340b9cf8`, October 3 18:19:37 | Saturday 01:15 → Sunday 02:15 |
| PR 481 merge | `1a34e9dae390ca91de59588b4b102da43579f527`, October 3 18:21:13 | precedes fixed prospective start |
| Authorization receipt | `30fa358e816dbeaf86b712c30ffb6b4845a4e1c6`, October 3 18:25:24; PR 482 merge `86a1c7f82c849e91c4d2c8db091b5347b330d4f9` at 18:27:21 | 36-hour/Sunday contract recorded before start |
| Start run | [38125893276](https://github.com/Achi1984/meridian/actions/runs/38125893276), created October 11 08:44:51, schedule/success | cutoff October 10; collected 08:45:05.499 Sunday; 32h45m late relative to cutoff, within 36h; zero completed weeks |

The pinned authorization file was independently read at `30fa358e816dbeaf86b712c30ffb6b4845a4e1c6`, blob `1d4ec4f2386005b7a5094ea3f4ea2d3143b9b9a7`: [receipt](https://github.com/Achi1984/meridian/blob/30fa358e816dbeaf86b712c30ffb6b4845a4e1c6/research/LOW-VOLATILITY-RANK-WEIGHTED-V2-PROSPECTIVE-START-AUTHORIZATION.md). It records October 10 start, 12 fixed weeks and January 2 endpoint, with no Paper/live activation. This supports a pre-start source-contract change, not a retrospective deadline extension. Direct human authorization/reviewer proof is not independently established by this reconciliation; PR 481/482 issue-comment lists were empty. The older 12-hour description still needs explicit historical annotation rather than silent overwrite.

## Smallest corrective proposal, not implemented

Producer documentation checked October 31:

- [Official public-data README](https://github.com/binance/binance-public-data) describes general daily/next-day and monthly/first-Monday archive publication. It does not establish the specific daily fundingRate archive convention used here. No assertion that funding is monthly-only is made.
- [Official Funding Rate History API](https://developers.binance.com/docs/derivatives/usds-margined-futures/market-data/rest-api/Get-Funding-Rate-History) documents `GET https://fapi.binance.com/fapi/v1/fundingRate`, symbol, inclusive startTime/endTime, ascending results, limit up to 1000, and fundingTime/fundingRate fields. It supplies a documented endpoint alternative, not proof of reachability from this runner or permission to change frozen evidence provenance.

Technical owner should prepare one source-only correction with fixture validation: separate pure archive planning from execution; make funding-source capability explicit; cover cutoff=start and cutoff>start; preserve fail-closed behavior for unavailable sources. A documented funding-history adapter can be proposed using bounded pagination, exact time filtering, deduplication and source receipts. It must not silently substitute for the frozen source. Historical receipts already record REST HTTP 451 in this environment, so do not assume this endpoint now works or bypass the restriction.

Do not simply replace daily with monthly paths: no verified producer convention here proves a current-month funding archive can meet the fixed 36-hour deadline. Do not extend the deadline to fit delivery. No endpoint was called and no archive was downloaded in this investigation.

## Disposition and next owner

Evidence owner: record **fixed-window evidence incomplete in the observed canonical ledger**, retain missing October 17 and October 24 observations, and annotate historical timing provenance with the dated receipts above. Missing past prospective weekly outcomes cannot be recreated by later collection, backfill, rerun or a repaired collector.

Technical owner: decide and document the permitted funding-source contract and a source-only corrective design with synthetic fixtures. Any source change requires explicit treatment of provenance; it does not repair the past frozen evidence. This packet makes no new prospective-window, activation, schedule or paper/live decision.

Validation performed: read-only source, Git tree, bounded run/job/log/artifact metadata and official producer documentation. No strategy P/L or performance testing. Repository-ready documentation only; publication not performed.

