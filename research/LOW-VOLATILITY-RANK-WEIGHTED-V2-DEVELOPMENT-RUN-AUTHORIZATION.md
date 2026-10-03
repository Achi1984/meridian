# Low-Volatility Rank-Weighted V2 — Corrected Development Run Authorization

Status: **CORRECTED FIRST VALID DEVELOPMENT EVALUATION AUTHORIZED / HOLDOUT SEALED / PAPER AND LIVE BLOCKED**  
Ruleset: `LOW-VOLATILITY-RANK-WEIGHTED-V2-FROZEN`  
Corrected implementation merge: `257fcd3fba441e3ccb4103ba8c1382185d22c9a0`  
Execution impact: **false**

## Why this rerun is authorized

The original authorized run at commit `3f894b14f03146c2e1032a7fa54263396973994e`, workflow **37131815781**, stopped before calculating any V2 strategy result:

- `dataIntegrityFailure=true`;
- error: `BTC:FUNDING_INTERNAL_GAP`;
- `result=null`;
- `stress=null`;
- Holdout evaluated: **false**.

Independent inspection of the exact official source artifact showed that all 12 assets had complete monotonic funding rows and that the largest interval-grid overshoot was only **16 ms**. The zero-tolerance coverage validator was therefore rejecting official timestamp jitter rather than detecting a missing funding event.

The technical correction is frozen in:

- correction document blob: `ad5694309438c80aac0717700b7772fd94bc8f89`;
- corrected engine blob: `87302fdc0c1880a35e1bfd663be8191d5f6be429`;
- corrected invariant-test blob: `8a5c044e76555ad11eaff0da9be2ef763a16329c`.

The fixed 1,000 ms tolerance applies only to funding coverage validation. Funding inclusion remains exactly `start < timestamp <= end`; all feature, portfolio, cost, date and gate rules are unchanged.

## Frozen corrected lineage

This rerun is authorized only for the exact reviewed lineage:

- V2 preregistration blob: `b8c644a5a15c321a1a52514dd05eb088288cd8f4`;
- V2 implementation contract blob: `90e070996c399d6d678a10b25e6b52cd0aac6335`;
- funding timestamp correction blob: `ad5694309438c80aac0717700b7772fd94bc8f89`;
- corrected V2 engine blob: `87302fdc0c1880a35e1bfd663be8191d5f6be429`;
- Development collector blob: `c084d8ec4a72a666818b9e8a9f5ca143788a0c9d`;
- Development runner blob: `e8f076258612407dd3676af94a7442c785ab53ba`;
- corrected invariant test blob: `8a5c044e76555ad11eaff0da9be2ef763a16329c`;
- workflow blob: `52bc76b5572b74cf4e7808e4f707e15bddda6769`;
- frozen parent V1 feature engine blob: `d161b6b4553d5a18fc7064570f4a4e956178d0c9`.

The frozen-research guard and synthetic invariants must pass before source collection.

## Authorized Development evaluation

Exactly the unchanged 48 weekly Development periods are authorized:

- first anchor: **2025-02-01T00:00:00Z**;
- last anchor: **2025-12-27T00:00:00Z**;
- terminal next-week open: **2026-01-03T00:00:00Z**.

Only the frozen rules may be evaluated:

- exact V1 28-day / 672-return Low-Volatility feature;
- 12 frozen assets;
- continuous average-rank dollar-neutral weights;
- gross exposure 1.0, net exposure 0;
- weekly open-to-open price returns;
- official public funding contribution;
- 10-bps baseline turnover cost;
- mandatory 20-bps stress cost;
- terminal close;
- exact preregistered Development gate.

Possible valid scientific decisions are exactly:

- `DEVELOPMENT_PASS_HOLDOUT_REQUIRED`;
- `DEVELOPMENT_FAIL_RESEARCH_STOP`.

## Explicit prohibitions

This corrected run may not:

- inspect or evaluate the untouched Holdout;
- alter any strategy, source, cost, date, asset or gate rule;
- retune after the Development result;
- rescue a scientific FAIL;
- authorize Paper or live execution.

If the corrected Development evaluation fails scientifically, V2 closes and Holdout remains untouched.

If it passes, only a separately reviewed and separately authorized Holdout stage may proceed.
