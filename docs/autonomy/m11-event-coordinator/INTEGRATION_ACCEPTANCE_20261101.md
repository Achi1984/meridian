# Coordinator offline integration acceptance — 2026-11-01

Status: **SOURCE_COMPOSITION_ONLY / PUBLICATION_NOT_READY**. Synthetic input
only. Lead owns final integration, merge, hosted CI and independent review.

## Source provenance

Base: `main` at `c60bb6a`. Predecessor PRs #1046 and #1059 were left untouched
(no active writer; last updates 2026-10-30). PR #1059's empty changed-files
metadata is misleading: its branch ref (`6bb6d667…`) is one commit ahead of the
PR head `01259402…` ("Initial plan") and carries real source.

| Source commit | Content taken | Cherry-picked here |
| --- | --- | --- |
| `8169775de04887bcc5bdf4c46d49e7f4f10cf60b` | integration test, fake HTTP fixture, runtime integration doc (3 new files, absent from main) | clean |
| `6bb6d667cdf04cda4a470f3d3042e614b324f076` | projection receipt-stage labels, projection tests, STATUS_PROJECTION table, integration-test projection assertions | clean |

Already incorporated bytes: the status projection module, its test and doc were
byte-identical on main to the predecessor base (`01259402`); only the `6bb6d667`
deltas were absent and applied. Added here: a duplicate-delivery scenario and
refreshed (previously stale, #1044-dependent) integration documentation.

## Demonstrated behaviour (actual transport + backend + lifecycle)

- Persisted before dispatch: event order `CLAIM_CREATED, REVIEW_PENDING,
  dispatch, DISPATCH_ACKED`; the dispatch callback asserts stored `REVIEW_PENDING`.
- Lost ACK: `RECEIPT_POSTING` committed, ACK dropped, result `UNKNOWN`, no retry.
- Duplicate delivery: same-instance and reconstructed `start` return
  `ALREADY_CLAIMED`; canonical bytes and mutation/dispatch counters unchanged.
- Two-instance CAS: one shared expected head; one dispatches, loser `UNKNOWN`.
- Restart / read-only reconciliation: reconstructed runtime only looks up; FOUND
  stays `UNKNOWN`; projection issues GETs only, zero replace attempts.
- Late write after deadline: backend HTTP continues past the 500 ms runtime
  deadline; the fence lands late and recovery stays lookup-only.
- States: `UNKNOWN` for preparing/posting/delivery-unknown and unmapped stages;
  `BLOCKED` only for `REVIEWED` at `REVIEW_RESULT` with `REVISION_REQUIRED`;
  `DONE` only for stored `COMMITTED`/`RECEIPT_DELIVERED` (projection suite;
  unreachable through the runtime while publication is NOT_READY).
- No receipt repost: `receiptPosts` stays 0; no `COMMITTED` transition written.

## Result

One focused run after assembly (`node --test`): integration, status-projection,
runtime-composition, GitHub state transport, atomic backend and review
lifecycle suites — **147 tests, 147 pass, 0 fail, 0 cancelled, 0 skipped**
(~8.0 s). No full-suite run. No integration defect required a production fix.

## Known limits

- Hosted atomicity unproven; the fake compares `expectedHeadOid` locally.
- No shared cancellation between runtime deadline and backend HTTP; late commits
  are possible and fenced, not prevented.
- Consumed-version bindings are instance-local; restart safety rests on the
  stored posting fence, not an ABA defense.
- Reviewer/runtime evidence and lookup are synthetic test authority.
- Status output is an offline stored snapshot, never runtime attestation.
- No provider/hosted probes, credentials, workflow changes, receipt
  publication, rollout or trading.
