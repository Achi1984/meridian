# Elliott source assessment — 14 October 2026

**Read-only source audit; frozen decisions retained; no empirical run or promotion.**
Current strategy snapshot: `Achi1984/meridian@de80e1d45e8a34f1e638cada07ca62dea25ad2db`. Nine targeted files were read: three current continuity/audit records, two frozen cores, one evidence runner, two result notes and the explicitly requested replication stopping rule. PR file listings were discovery aids; actual source reads use the frozen commits below. No market data, workflow artifact or numerical result was recalculated.

## Correction to the earlier shallow inventory

Elliott was not merely a v6.68–v6.74 shadow-indicator proposal. The later repository continuity record identifies **executed Wave-3 research, an older-year replication and rejected Wave-5 research** (E1). Actual implementations were recovered on the named frozen research heads, even though the current strategy tree has no Elliott-named core files. Absence from one current tree is not absence from repository research history. The earlier patch notes establish neither complete trial counts nor current strategy readiness.

| Line | Recorded outcome, not revalidated here | Disposition |
|---|---|---|
| Wave-3 V1, PR #88 | E1 reports 144 closed trades; sample below 150, breadth below 5 qualifying assets, excessive ETH concentration | Frozen near-pass; **not promoted, not tuned** |
| Wave-3 V2, PR #89 | E1/E7 report unchanged older-year replication; 101 trades below 120, seven of eight gates passed | **Formal sample failure**, closed replication, not a holdout and no promotion |
| Wave-5 V1, PR #90 | E1/E8 report 10 primary trades; insufficient sample and negative follow-up years | **Rejected**, keep closed; no tuning series |

Trade counts above are source-reported sample counts, **not variant counts**. V2 is documented as unchanged-rule replication; this audit has not proven byte identity of its engine nor independently authenticated/replayed its result artifacts. E7's positive narrative must not override its formal `historicallyReplicated=false` and `promotionPermitted=false`. E2/E3 subsequently retain Wave3 as unpromoted research and Wave5 as closed. E9 explicitly forbids enlarging intervals, lowering 120, combining periods to manufacture a pass, tuning V1, asset/side cherry-picking or new daily-context gates from observed cohorts.

E1 records workflow/artifact pointers: Wave3V1 run 34143541691 / artifact 10026843740; Wave3V2 run 34145957770 / artifact 10027682729; Wave5 run 34147347479 / artifact 10028158787. These pointers were **not downloaded or revalidated** in this packet. Their presence is evidence of recorded prior empirical work, not current empirical authorization.

## Recovered mechanics and availability

**Wave3 core (E4):** 4h bars, three left and three right pivot bars; strict comparison on the left and non-strict on the right; ambiguous high-and-low pivots skipped. A low/high/low sequence creates a long setup, the inverse a short. Wave1 must exceed a two-times-median prior true-range noise floor over up to 30 days; Wave2 retracement must be 0.382–0.786 and preserve the initial structure, with a prior same-side extreme check. Entry breaks Wave1; stop is Wave2; two half-position targets are 1.0 and 1.618 of Wave1 measured from Wave2. Pending invalidation, competing setups and already-active positions are explicit.

**Wave5 core (E5):** five alternating pivots, Wave2 retracement 0.382–0.786, Wave3 at least Wave1, Wave4 retracement 0.236–0.5, no Wave1/Wave4 overlap in the checked structure. It enters past Wave3, stops at Wave4, and uses half-position targets 0.618/1.0 of Wave1 measured from Wave4. This is a distinct already-tested structure, not an untried idea to silently register again.

For regular completed 4h inputs, both cores set pivot confirmation to rightmost confirmation-bar opening plus 4h, queue a candidate only at its confirmation index and require entry index strictly greater than creation index. Thus they **do not enter on the pivot's original historical candle**. This is a source-level chronological pattern; it is not proof of authentic historical receipt or corrected-data availability. Both normalize/coerce numbers, drop nonfinite rows and sort by timestamp. They do not provide today's strict positive-OHLC, duplicate/gap, bar-close, receipt or revision-provenance contract.

The inspected runner (E6) downloads Coinbase 1h candles and aggregates count-equals4 groups into 4h bars. That source-format choice is not Binance/OKX execution evidence. It labels results research-only, executionImpact false and promotionPermitted false. Daily context is included in grouped reporting. The runner was read, never invoked.

## Source concerns requiring isolation before reuse

1. **Daily context may be admitted 20 hours early.** E4 lines 6–8 and E5 lines 4/8 reuse a pivot function hardcoded to `+H4` for aggregated daily bars with width2. The confirmation day's complete daily high/low can therefore label context at day opening+4h, although the daily candle completes at+24h. Both loops admit that label using `confirmedAt<=b.t`. In the inspected cores, `dailyStructure` is **annotation**, not a condition for entry/exit; E6 uses it for cohort reporting. This demonstrates a source-level timing defect in context labeling, **not proof that every trade outcome is invalid**. It prevents endorsing context-conditioned findings or importing that label as a live filter without separate correction and validation.

2. **Execution/payoff accounting is a historical proxy.** Both cores subtract a constant 0.05R cost; that is not validated two-sided venue fees, spread, slippage, funding or liquidity. Stops can be assigned -1R even with worse opening gaps. In E4 line 19, the post-TP1 original-stop test labels `BREAKEVEN_AFTER_TP1` and books only half the first target R without relocating the stop or charging the residual stop loss. This merits an isolated synthetic accounting test before any reuse; this packet neither changes the frozen engine nor adjusts old results. E5 includes a next-bar break-even check but still retains original-stop-first processing and proxy accounting, requiring its own path tests. Both cores also use absolute target-to-entry distance without checking that a target remains profitable relative to the filled entry (E4 lines 19–20; E5 lines 14–15). A gap beyond a target could therefore be credited as a positive target R; this is a source concern, not a reproduced event or quantified result impact.

3. **Strict input and availability admission is missing.** Finite/sorted input is not proof of contiguous 4h observations or complete daily sessions. Daily groups use a count of six 4h bars, not a verified exact timestamp set. A proposed modern adapter must explicitly validate times, duplicates, OHLC, completeness and publication/receipt assumptions; historical archive acquisition must never be backdated.

These findings are bounded to inspected source versions. They are not a fresh profitability verdict, a reason to tune a failing hypothesis, or evidence that unseen later fixes cannot exist.

## Concrete next specification, not permission to run

Keep Wave3 frozen and Wave5 rejected. No immediate ABC/Wave variant series, period extension or threshold relaxation. Budget and cumulative trial accounting remain unresolved; do not infer three variants merely from three version labels or erase empirical attempts because code lives on another branch.

Before considering reuse, prepare a separate **source-correction verification contract**: pin the exact frozen core/runner and result-artifact provenance; confirm V2 engine identity; distinguish 4h pivot confirmation from daily-context close; require explicit raw-bar/receipt admission; enumerate synthetic pivot-boundary, duplicate/gap, daily-context, gap-stop and partial-exit/break-even cases. Any accounting/timing correction must receive a new identity and retain original evidence rather than overwriting it. An empirical rerun, candidate registration or context filter would require separately reconciled budget, reviewed data/cost model and authorization.

No code changed, synthetic or empirical strategy execution performed, PnL recomputed, candidate registered, frozen threshold changed, or paper/live order issued. `completeLineageAudit` remains null; execution/canonical research/dispatch/paper/live/promotion authorizations remain false. The present source audit supplies lineage evidence to the broader 22-term assessment; it does not by itself complete that assessment.

## Pinned source inventory

| ID | Path | Commit | Git blob SHA |
|---|---|---|---|
| E1 | `MERIDIAN_RESUME_2026-09-07.md` | `de80e1d45e8a34f1e638cada07ca62dea25ad2db` | `f74a39304b736760abb1a50483f0de9acc8ccc17` |
| E2 | `docs/r31-bot-review-and-cost-policy.md` | `de80e1d45e8a34f1e638cada07ca62dea25ad2db` | `98f70512ae7b5adf45e6b4e4e7892bc7d76d2538` |
| E3 | `docs/r39-deep-audit.md` | `de80e1d45e8a34f1e638cada07ca62dea25ad2db` | `c6ff8e5c3f3406b75f6cc0cd088a408f9b08ffae` |
| E4 | `elliott-wave-bot-v1.js` | `a1283b68419bdb2a5d22ff2b49fff5b4109354db` | `aa2eefd3dc9e2169a184c1ac625207c44102f8ca` |
| E5 | `elliott-wave5-bot-v1.js` | `5f30cce5fc64778c83fcb03e33edc39dc3003f0c` | `a5923b65ef439caf1a8766b6982ac46c2013e33b` |
| E6 | `scripts/elliott-wave-bot-v1-evidence.mjs` | `a1283b68419bdb2a5d22ff2b49fff5b4109354db` | `6842b2cfaa6e4ee9711316b6c4645afba67e0df4` |
| E7 | `research/elliott-wave-bot-v2-replication-evidence-20260907.md` | `465555c16bc0d64f69ba3afe1f29fcf3fe73c6ea` | `e47281071c85865ce80558e004291f2d3e60fe46` |
| E8 | `research/elliott-wave5-bot-v1-evidence-20260907.md` | `5f30cce5fc64778c83fcb03e33edc39dc3003f0c` | `c33f7f51ced5f986a5288906c38b3b522cad9b09` |
| E9 | `research/elliott-wave-bot-v2-stopping-rule.md` | `465555c16bc0d64f69ba3afe1f29fcf3fe73c6ea` | `d8ff76965de7a624539e5911a5aa33c6a6be9fc5` |

