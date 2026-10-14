# LowVol frozen-artifact receipt verification — 14 October 2026

**Op-ID:** `STRATEGY-RECEIPT-VERIFICATION-20261014`  
**Disposition:** `RECEIPTS_VERIFIED; TIMING_DOCUMENT_RECONCILIATION_OPEN; NO_PROMOTION`  
**Audit code head:** `3c9731180898b7c65e02f094e590204c48ff78ba`  
**Verifier SHA-256:** `69535afb17eb009fa2880a87c3cb9345dab01070bc26444044a4950157772cb5`  
**Base/main:** `386013c1e78c4be5ea5d6c89063c9c4b8dacda66`

## Executed receipt checks

GitHub Actions metadata confirmed all six pinned artifacts were available and bound to the runs/commits below. The offline verifier consumed the committed [manifest](lowvol-receipt-manifest-20261014.json) and 52 explicitly supplied local files (six ZIP byte streams and 46 payload files staged under `/tmp`; no raw archives were added to the repository).

`node scripts/strategy-evidence-receipts.mjs --manifest docs/strategy-lab/lowvol-receipt-manifest-20261014.json --input <expected-path>=<local-file> ...`

**Exact-head result:** `VERIFIED`, 52/52 inputs verified, 0 unavailable, 0 mismatches. For every archive and payload, observed SHA-256 and byte size equal the pinned expectation. The manifest includes all expected file names, sizes, digests, artifact IDs, run IDs and source commits.

**Tests at the audit head:** `node --test test/strategy-evidence-receipts.test.js` passed 12/12; `node --test test/*.test.js` passed 2,453/2,453; both changed JavaScript files passed `node --check`. The initial full-suite attempt lacked the lockfile’s existing `pg` install; after `npm ci` (0 vulnerabilities reported), the rerun passed.

| Artifact | Run / source commit / ID | Expected ZIP SHA-256 | Observed ZIP SHA-256 | Payload receipt |
|---|---|---|---|---|
| Development source | `37132394717` / `a30a789ce058b08452bb4597f4a92b3bd58383e1` / `11277247641` | `b62f7b3eadacc7c55a1d61006d645caea385dbd73c33854522c30624499e5556` | `b62f7b3eadacc7c55a1d61006d645caea385dbd73c33854522c30624499e5556` | 13/13 members; 12 assets match manifest; manifest SHA `770e7d452422793debc08c80f19f168c6da6ef487db6c9c2b2ce3726a05a8662`; source digest `c632e7a00c30625fc3efb7a58c400e9c9b481bb0c603aa95bf68e0be44ba6220` |
| Development result | `37132394717` / `a30a789ce058b08452bb4597f4a92b3bd58383e1` / `11277656738` | `e076f9424b4373621bec7502d9835945a00a1211716ba299057b7adcd7b22314` | `e076f9424b4373621bec7502d9835945a00a1211716ba299057b7adcd7b22314` | JSON `c72046db7aeb0e28a87e3e8e2c181b9d67f8ed9b8eae275c3b7f4037793a16bb`; Markdown `e0a2c60b690ddd0c3b5cf141e21208bf2f255de0f1952f1853f1df14fcbeec62`; summary metrics/gate fields match |
| Holdout source | `37133809945` / `b15bddb8f316b8d313dd8893a46654849db2a6cd` / `11278085201` | `8f9ed3953268ba985034ecd6db09a4a3e5900c835061ce6930b710320de50426` | `8f9ed3953268ba985034ecd6db09a4a3e5900c835061ce6930b710320de50426` | 13/13 members; 12 assets match manifest; manifest SHA `ed2ed862e62578dd0695a5d852e1e661ef2ee01dcc6d37f1e0e35b87168aa230`; source digest `cba10d070b2956d4ba293888f26dcd65c93875096aee22b5a7b7e457bbe5b76e` |
| Holdout result | `37133809945` / `b15bddb8f316b8d313dd8893a46654849db2a6cd` / `11277199985` | `7c96e9456d80f3eb61047f6c7f108dddddbf704409f6526643f5fa3f8e1106af` | `7c96e9456d80f3eb61047f6c7f108dddddbf704409f6526643f5fa3f8e1106af` | JSON `c88ab6074e3fc0777f3a69693d6e549a9b704f7a668b384a44d0e0db02a01dd0`; Markdown `24cdf3b1d54a943fa17645bcb77237b3082ba73e72dc196554ed13b767f24e7a`; summary metrics/gate fields match |
| Prospective source | `38125893276` / `a5ba7eca2004ce51ec98720955b5fcc3716f09ef` / `11697855479` | `c27f46bac87f3831bec139ef36cc659b7e77a9bce159f1f0f6b0dac7d6fe1ce8` | `c27f46bac87f3831bec139ef36cc659b7e77a9bce159f1f0f6b0dac7d6fe1ce8` | 13/13 members; 12 assets match manifest; manifest SHA `ac7cf72fb53771c4a75b46fe3c567feb48b3a2804718f59f14124eca2da078dc`; manifest payload SHA `c6eef111e3575bc77825c797d83d6d6b3aeabfaf0c8643165d14913176d77650` |
| Prospective snapshot | `38125893276` / `a5ba7eca2004ce51ec98720955b5fcc3716f09ef` / `11697446266` | `f942087ec71480be577cac9edbe7ec050f68683c41246b6453d942998c8d9394` | `f942087ec71480be577cac9edbe7ec050f68683c41246b6453d942998c8d9394` | JSON SHA `911cc803b1c89f77f478e9b94127f51192b182eaf8dc1ddb03a80c0bcba9ccc7`; source receipt/digest match; Git blob SHA `1d55ef64174c9dde449a3b7e54258ac0d653acb1` matches the snapshot at `b6b72a1` |

The source manifests declare 12/12 required assets for Development, Holdout and the prospective boundary, with public-source/stage/range metadata; every supplied per-asset payload hash matches its declaration and recorded source receipt. Both result JSONs’ exact hashes, Markdown hashes, runner prehashes, decisions, gate values and summary metric fields match the committed frozen summaries. This establishes receipt and summary consistency only; it is not independent strategy reproduction or profitability evidence.

The verifier deliberately reports `zipMemberVerification: NOT_PERFORMED`: it hashes supplied bytes and validates pre-extracted member paths but does not parse ZIPs. For this audit, Python’s standard-library `zipfile` separately checked each downloaded ZIP’s CRC, exact member list, unique/safe relative names, no symlink members, bounded sizes and member bytes before staging them under `/tmp`. ZIP parsing is not part of the verifier’s guarantee.

## Prospective timing provenance

- The pinned implementation contract at blob `d156db5409c94bc6cfface2a65e5fb6bef9a6f40` still says 12 hours after a Saturday 00:00 cutoff and a Saturday 01:15 UTC schedule.
- Engine commit [`ef7f25043a8d8b62a021a883f3bff33945d7064a`](https://github.com/Achi1984/meridian/commit/ef7f25043a8d8b62a021a883f3bff33945d7064a), timestamped 2026-10-03 18:19:34 UTC, changed the source limit from 12 to 36 hours. Workflow commit [`25f6d286b0d56a947c951329849cb0e0340b9cf8`](https://github.com/Achi1984/meridian/commit/25f6d286b0d56a947c951329849cb0e0340b9cf8), 2026-10-03 18:19:37 UTC, changed the schedule from Saturday 01:15 to Sunday 02:15. Both source changes predate the 2026-10-10 boundary by more than six days.
- PR #479 merged at 18:11:37 UTC, before those timing commits. PR #482 merged by the owner at 18:27:21 UTC and records the prospective start authorization and pinned source/workflow blobs. Its available review/comment endpoints do not explicitly reconcile the still-present 12h/Saturday contract against the 36h/Sunday rule. The merged start authorization is evidence for the authorized start; the source code alone is not authorization to supersede the conflicting document.
- Run `38125893276` collected the fixed `2026-10-10T00:00:00Z` cutoff at `2026-10-11T08:45:05.499Z`, 117,905,499 ms (32h45m05.499s) later. The snapshot says `timely=true` under the 36h source rule, has 0 completed and eligible observations, `dataIntegrityFailure=false`, and Paper/Live false. The exact evidence-branch JSON was added at `b6b72a1`; this bounded Git history and matching artifact/blob do not independently prove storage immutability. Runs `38149124458` and `38156356512` preserved that first-write snapshot and reported `timely=false`; the reason for their lateness is not established here.

**Timing disposition:** **timely under 36h source rule; older 12h document reconciliation status: unresolved.** This is not a retrospective relaxation: both timing source commits predate the fixed boundary. An explicit reconciliation is still required before relying on future `timely` flags.

## Checks not performed / remaining blockers

- No strategy evaluator, return/PnL recomputation, backtest, new market-data collection, canonical workflow, or Discovery/Validation/Holdout/Paper/Live execution was run. No profitability or raw-source economic-validity claim is made.
- No eligible prospective week had completed: the first ends 2026-10-17; the fixed first-12 endpoint remains 2027-01-02. Later ledger continuity and the later retries’ `timely=false` reason remain unverified.
- No independent proof of artifact-store immutability or complete raw-source economic validity is established by matching artifact hashes and declared source manifests.
- The older 12h/Saturday document has not been explicitly reconciled to the owner-merged 36h/Sunday start authorization. Actual fee/depth/slippage, margin/liquidation, venue/product access, EUR capital suitability, Paper observation, benchmark and Live controls remain separate blockers.

All execution and promotion authorizations remain unchanged and false. The receipt results close only the artifact hash, manifest, payload, and committed-summary consistency gaps.
