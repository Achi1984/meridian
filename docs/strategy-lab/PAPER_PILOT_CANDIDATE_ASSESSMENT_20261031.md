# One-strategy Paper pilot: source assessment, 31 October 2026

**Disposition: no candidate is presently admitted to operational Paper.**
This source-only assessment recommends the frozen LowVol V2 line for the next
evidence-reconciliation packet, not for immediate trading. It does not select
operating parameters, change a frozen strategy, or grant execution authority.

Baseline inspected: `ad276e787078b5afdb2260a5f3e703bd9fd4da28` in
`Achi1984/meridian`. Existing documents and GitHub receipts were read; no strategy,
historical replay, market-data collection, performance computation, workflow,
provider, account or Paper process was run. The numerical findings below are
existing recorded decisions, not a newly reproduced assessment.

## Three concrete candidate lines

| Candidate | Existing implementation and evidence | What prevents a pilot | Engineering disposition |
| --- | --- | --- | --- |
| **Frozen Low-Volatility Rank-Weighted V2** | `research/low_volatility_rank_weighted_v2.py` plus existing holdout and prospective modules. `research/LOW-VOLATILITY-RANK-WEIGHTED-V2-HOLDOUT-EVIDENCE.md` records `HOLDOUT_PASS_PROSPECTIVE_PAPER_REVIEW_ONLY`, canonical run `37133809945`. The frozen reference is a market-neutral, 12-asset USD-M perpetual strategy, not H7 spot selection. | Fixed first-12 prospective weeks and independent complete/timely ledger review are still required. The inspected evidence branch contains no eligible completed weekly outcome. Historical 12h/36h timing-document and independent authority provenance remain unresolved in the receipt-verification report. Venue execution, costs, margin and operational admission remain separate. | **First evidence target:** reconcile the exact existing forward ledger and its source/authority provenance without rerunning, repairing or retuning it. Strongest inspected existing qualification evidence, but not eligible to start now. |
| **H1-B / H1-E spot trend cells** | `research/strategy-paper-arena.js` implements these isolated retrospective cells. `docs/strategy-lab/PAPER_ARENA_PROTOCOL_20261016.md` freezes daily close/SMA200/90-day rules; `PAPER_ARENA_DIAGNOSTIC_20261016.md` records a retained diagnostic and no independent validation. | Fixed-universe survivorship, actual execution costs and data availability, independent prospective evidence, trial-budget reconciliation and payoff-policy compatibility remain open. Portfolio-level no-stop replay is not a finite stop/target plan. | **Fallback engineering target only:** H1-B is the simpler existing spot rule path for a future separately specified signal-adapter fixture. Do not select H1-E from its diagnostic return or treat adaptation as qualification. No adapter or new validation is implemented here. |
| **H7-B / H7-R defensive spot cells** | Same Arena engine and frozen protocol; weekly low-volatility selection and daily eligibility exits are implemented as retrospective diagnostic cells. | Same independent-data/cost/policy gaps as H1, plus rank/retention and rebalance execution semantics. H7 is a different instrument, universe, signal and exposure design from frozen V2. | Retain for later comparative research. **Do not transfer LowVol V2's PASS to H7**, or select H7-B from the displayed diagnostic table. No additional pilot lane is justified now. |

This ranking is an engineering sequencing decision based on existing evidence
and implementation scope, not a profitability ranking or investment advice.
H9 remains blocked on dated-futures/two-leg data and is not a near-term pilot.
The other registry hypotheses are not implicitly accepted or rejected here.

## Current LowVol ledger observation

Read-only GitHub ref inspection returned:

- Branch: `research/low-volatility-rank-weighted-v2-prospective-evidence`
- Exact head: `b6b72a1bbf7696abde326793c80270fa77d12f26`
- Dated JSON snapshots in its tree: `2026-09-26T000000Z`,
  `2026-10-03T000000Z`, `2026-10-10T000000Z`.
- `research/prospective/low-volatility-rank-weighted-v2/LATEST.json` at that head
  identifies the 10 October boundary, `PROSPECTIVE_COLLECTING`,
  `completedObservations:0`, `eligibleGateObservations:0`, `timely:true`,
  `paperAuthorized:false`, `liveAuthorized:false`, `autoPromotion:false`.

No 17 or 24 October canonical outcome snapshot is present in the inspected
branch. The 31 October observation's collection window was not assumed closed.
Absence from this branch does not prove that no separate artifact exists, nor
establish why collection stopped or whether a workflow is currently enabled.
The existing workflow source declares Sunday collection attempts; no workflow
dispatch or settings change was made. Recent general run-list sampling yielded
no relevant run and is **not** a complete workflow-history audit.

The fixed prospective endpoint remains **2 January 2027, 00:00 UTC** under the
existing contract. Reaching that date alone will not create eligibility: missing
timely snapshots cannot be backfilled and relabelled as timely prospective
evidence. Neither the 12-week gate nor the missing ledger is waived by this
assessment. A new observation plan, if ultimately needed, requires its own
prospective decision and cannot rescue or rewrite the old fixed window.

The following sources must be reconciled rather than silently selecting the
more convenient rule:

- `research/LOW-VOLATILITY-RANK-WEIGHTED-V2-PROSPECTIVE-SHADOW-IMPLEMENTATION.md`
  records the older 12h/Saturday text and the fixed first-12-week gate.
- `research/LOW-VOLATILITY-RANK-WEIGHTED-V2-PROSPECTIVE-START-EVIDENCE.md`
  records the later 36h/Sunday source path and start record.
- `docs/strategy-lab/LOWVOL_RECEIPT_VERIFICATION_20261014.md` verifies existing
  artifact hashes/summary consistency while explicitly leaving documentary
  reconciliation and independently attributable authority provenance open.
  It does not independently reproduce the strategy or establish economic truth.

## Keep the failed D2 trial separate

Issue [#935 receipt 6448721244](https://github.com/Achi1984/meridian/issues/935#issuecomment-6448721244)
records one completed trial, 44 payloads and `NO_EDGE`.
[Receipt-level assessment 6449045864](https://github.com/Achi1984/meridian/issues/935#issuecomment-6449045864)
finds the reported screen consistent and says private result bytes have not been
independently reviewed. `MERIDIAN_LIVE_CHECKPOINT.json` →
`currentWork.d2NoEdge935` preserves this status.

Do not rerun or tune that trial to obtain a pass, and do not call this a failure
of all twelve hypotheses. Conversely, the older catalog's B1-7 text “Keine
Ergebnisse” and its dated historical evidence snapshot do not supersede the
27 October receipt. The old `D2_READINESS_RECONCILIATION.md` is a historical
pre-execution record; it is not current proof that the authorized trial never
happened. No D2 result is transferred into LowVol or either Arena line.

## Smallest useful next validation packet

**Packet P1 — LowVol ledger and authority reconciliation, read-only.**

1. Bind the exact frozen engine/holdout/preregistration identities and current
   evidence-branch commit. Preserve the existing receipt verifier's known
   limits; reuse hashes instead of recomputing strategy results.
2. Enumerate the expected already-due canonical cutoffs and compare them with
   the immutable branch paths. Inspect only the relevant existing workflow
   runs/artifacts and their collection times to explain each missing cutoff.
   Record absent, unavailable and contradictory evidence distinctly.
3. Resolve the provenance of the recorded pre-start 36h/Sunday decision versus
   frozen 12h/Saturday documentation from dated owner/reviewer receipts. Do not
   edit historical timestamps, snapshots or code to make evidence pass.
4. Produce a bounded disposition: `CONTINUE_EXISTING_EVIDENCE_ONLY` if the
   original contract and complete timely evidence are actually established,
   `FIXED_WINDOW_INCOMPLETE` if mandatory timely evidence is missing, or
   `UNRESOLVED` where access or authority proof remains unknown. None grants
   a workflow restart, new collection, Paper admission or retrospective repair.
5. Independent review accepts that reconciliation. Only then prepare a concrete
   owner decision if a future observation plan or collection recovery is needed.

**Parallel technical packet — strategy-independent durability.** Continue the
separately reviewed recovery-contract/journal work with generated fixtures.
This can close engineering gaps while qualification is unresolved; synthetic
bookkeeping cannot turn the candidate into a qualified strategy. Do not reuse
Arena binary-float account arithmetic as the exact-decimal operational journal.

## Contents of the later one-strategy start proposal

The final proposal must bind one exact qualified strategy/version and its
evidence, not a generic family. It must specify a verified source adapter and
instrument/product, prospective start/duration and review conditions, simulated
capital/currency, costs/liquidity, risk/stops/exposure/loss limits, event timing,
freshness/gaps/marks, compute bounds and recovery authority. All twelve groups
in `FORWARD_PAPER_V1_CONTRACT_SPEC.md` remain `REQUIRED_UNSET` here.

Do not copy Arena's 10,000 nominal USD/USDT, 8/16 bps, fixed universe or no-stop
policy into the proposal as operating defaults. Frozen LowVol's historical
10/20 bps and neutral exposure mechanics likewise do not validate a future
venue's cost or margin model. A changed risk or strategy rule is a new candidate,
not the old qualified identity. No money, leverage or stop recommendation is
made by this source assessment.

Acceptance before an operational start includes independently reviewed
qualification, full source/causal-time proof, durable receipt/account/fence
behavior, crash/restart checks, frozen configuration, explicit stop conditions
and the owner's separate bounded Paper admission. Live trading remains outside
this work. There is no justified launch date yet.

## Validation of this artifact

Source and receipt reads only; no strategy or fixture tests were run for this
documentation assessment. The proposal makes no new performance calculation,
no runtime readiness claim and no change to any authorization flag. Only this
document is intended for publication; local manifest/dependency material is not.
