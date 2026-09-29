# Perpetual Taker Order Flow V1 — Provenance Audit

Status: **FROZEN AFTER IMMUTABLE DEVELOPMENT FAIL**  
Execution impact: **false**  
Temporal holdout: **UNTOUCHED / UNAUTHORIZED**

## Purpose

This audit records two implementation/process findings discovered after the first frozen DEVELOPMENT result of `PERPETUAL-TAKER-ORDER-FLOW-V1-FROZEN` had already been observed.

It does **not** alter the V1 strategy, rerun V1, reopen its gate, or authorize the temporal holdout. The failed DEVELOPMENT result remains immutable hypothesis-generation evidence only.

## Frozen run being audited

- Workflow run: **36609900324**
- Run commit: `88e7225eca567c516ea197c27254c82cb4775645`
- Engine blob: `580f8885118aa1bfcccd6c77a431d5b7835e8bba`
- Development runner blob: `e0a50903b5ba9f2d37af4526144ee8674b8d294a`
- Development collector blob: `d149e737dc7638c0b7025cf502235c4baac1508e`

Frozen DEVELOPMENT integrity evidence:

- periods: **102**
- eligible assets every week: **12/12**
- side count every week: **2**
- data-integrity failure: **false**
- holdout loaded: **false**
- post-development data loaded: **false**
- decision: **DEVELOPMENT_FAIL_RESEARCH_REDESIGN**
- holdout authorized: **false**

## Finding OFV1-PROV-001 — future exit availability queried before ranking

The frozen engine's `select_weights()` did this for every asset:

1. calculate the lagged 168-hour FLOW signal;
2. call `entry_exit_return(t)`, which requires both the entry open and the future exit open at `t+7d`;
3. keep the asset eligible only when both values are present;
4. rank the resulting rows by FLOW descending and symbol ascending.

The **future return value itself was not used as a ranking key**. The ranking key remained only lagged FLOW plus the symbol tie-break. However, future exit-price **availability** could in principle have changed eligibility if an exit observation were absent.

### Observed-run impact

The frozen DEVELOPMENT result reports exactly **12 eligible assets in every one of 102 periods**, with no data-integrity failure.

Therefore, in the observed frozen run:

- no asset was excluded because its future exit was missing;
- no cross-sectional membership changed because of that check;
- the ranking among all 12 assets remained the preregistered FLOW ranking.

Conclusion:

**PROCESS / PROVENANCE DEFECT — NO OBSERVED ELIGIBILITY OR RANKING IMPACT IN THE FROZEN DEVELOPMENT RUN.**

This conclusion is based on frozen run evidence. MERIDIAN will **not** rerun V1 after seeing the result merely to demonstrate an identical counterfactual output.

## Finding OFV1-PROV-002 — no engine-level holdout authorization gate

The generic V1 engine accepted a `TEMPORAL_HOLDOUT` stage without independently requiring canonical DEVELOPMENT-PASS evidence.

That was weaker than the protocol intent.

### Observed-run mitigation and impact

The first DEVELOPMENT data path was separately locked:

- the collector requested only **2023-01 through 2024-12**;
- its manifest recorded `stage=DEVELOPMENT`;
- `holdoutLoaded=false`;
- `postDevelopmentDataLoaded=false`;
- the DEVELOPMENT runner refused a non-DEVELOPMENT manifest;
- the runner refused any range other than `2023-01..2024-12`;
- the runner refused `holdoutLoaded != false`;
- the runner refused `postDevelopmentDataLoaded != false`.

The frozen DEVELOPMENT result records both holdout flags as false.

Conclusion:

**ENGINE GUARD MISSING — NO HOLDOUT CONTAMINATION OBSERVED.**

The 2025-01-11 through 2026-08-29 temporal holdout remains untouched and unauthorized.

## PR #330 disposition

PR #330 identified and implemented prospective protections:

- ranking based only on entry-time information;
- future exit validation only after weights are frozen;
- engine-level holdout authorization evidence.

However, the first V1 DEVELOPMENT PnL was already observed and frozen before those changes could be merged.

PR #330 is therefore **closed without merge**.

Its fixes may be reused as prospective safeguards in a separately frozen successor ruleset **before that successor's first PnL**. They must not be retrofitted into V1 to create a post-result "cleaner" rerun.

## Frozen V1 disposition

V1 remains:

- **IMMUTABLE_DEVELOPMENT_FAIL**
- **HYPOTHESIS_GENERATION_ONLY_FAILED_GATE**
- no rerun;
- no temporal holdout;
- no short-side removal;
- no asset removal;
- no 168-hour lookback change;
- no cost/gate relaxation;
- no Paper promotion;
- no live promotion.

The observed economics remain useful only as hypothesis-generation evidence: aggregate returns and the high-flow-minus-low-flow spread were positive, but the preregistered robustness gate failed on chronological breadth, the short side, asset breadth, and concentration.

## Successor rule

The next strategy step must begin with **fresh external evidence**.

Any Order Flow successor must:

1. be a separately named/frozen ruleset;
2. justify its economic structure before first PnL;
3. include entry-time-only selection invariants from the start;
4. include an engine-level validation/holdout authorization gate from the start;
5. use genuinely untouched evidence for its first validation;
6. never present the failed V1 DEVELOPMENT sample as independent evidence for successor design.

No execution-impact change is authorized.
