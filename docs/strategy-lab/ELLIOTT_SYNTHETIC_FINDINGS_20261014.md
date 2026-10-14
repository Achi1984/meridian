# Elliott frozen-core synthetic characterization — 14 October 2026

**Eight passing tests reproduce frozen behavior, including known defects. They are not a green strategy review.** This packet contains seven synthetic behavioral cases plus one source-integrity test. It does not cover all proposed forensic categories, repair the cores, evaluate market history or produce empirical strategy performance.

The test file imports only the public exported runners. No functions are instrumented, rewritten, exposed through source rewriting or replaced. The fixtures are deterministic artificial price paths made from piecewise-linear positive values at consecutive 4h timestamps. Every test path checks finite positive OHLC and valid OHLC bounds; flat bars deliberately remove intrabar ordering ambiguity in the central examples. These artificial paths do not represent real market observations.

## Frozen source provenance

| Original repository path | Frozen commit | Git blob SHA-1 | Byte-identical local copy |
|---|---|---|---|
| `elliott-wave-bot-v1.js` | `a1283b68419bdb2a5d22ff2b49fff5b4109354db` | `aa2eefd3dc9e2169a184c1ac625207c44102f8ca` | `docs/strategy-lab/fixtures/elliott-frozen-v1.mjs` |
| `elliott-wave5-bot-v1.js` | `5f30cce5fc64778c83fcb03e33edc39dc3003f0c` | `a5923b65ef439caf1a8766b6982ac46c2013e33b` | `docs/strategy-lab/fixtures/elliott-frozen-wave5.mjs` |

Repository: `Achi1984/meridian`. Only local filename extensions change to enable ES-module imports. Every byte of each source is preserved, including comments and final newline. The integrity test computes Git's SHA-1 over `blob <byte length>\0<bytes>` and compares to the pinned original blob. Copies are test fixtures, never a registration, deployment or runtime replacement.

## Synthetic expected behavior versus frozen actual behavior

All R values below are arithmetic within constructed fixtures, not historical PnL or a return forecast. An indicated reference exit is conditional arithmetic under the stated fill assumption; a derived target/stop level alone does not prove a fill. Executable limit prices can be derived, but order activation, price path, gap handling and actual fill modeling remain separate requirements.

| Case | Explicit fixture/reference expectation | Frozen output asserted |
|---|---|---|
| KD1: daily-context availability | A setup created at synthetic day 10 +8h cannot use that day's not-yet-complete daily OHLC. Appending later bars should not change its already-known annotation. | Prefix ending at bar 61 labels the setup `UNKNOWN`; the full path labels the identical setup `LONG`. Creation time, direction, trigger, stop and targets remain identical. The source's daily pivot confirmation uses +4h instead of the daily close +24h. |
| KD2: Wave5 target behind entry | Pivots are positive prices 100,110,105,135,120. Long entry is 136; stop 120; targets 126.18 and130 are below entry. The entry candle is flat at 136, so neither lower-price target is shown as traded on that candle. Conditional signed arithmetic at the two target prices would be negative. | Frozen runner closes on that entry candle as `TARGET_1.000`, reporting gross +0.494375R and net +0.444375R after its 0.05R constant. Conditional signed target arithmetic is -0.494375R before costs. The absolute-distance calculation reverses the economic sign and target-cross logic treats already-behind targets as reached. |
| KD3: stop gap | Wave3 entry 121, stop 110; next synthetic candle opens flat at 90. If a sell-stop executes at that opening, signed result is -31/11R (about -2.818R) before costs, not -1R. | Frozen gross result is exactly -1R and net -1.05R, regardless of the worse opening. This reproduces proxy gap-loss truncation, not a universal assertion of real stop execution. |
| KD4: residual loss after TP1 | Wave3 entry 121, target 130, original stop 110. Assuming half exits at 130 and the remaining half at 110, gross accounting is 0.5×9/11−0.5 = about -0.090909R. | After target crossing and later original-stop touch, runner labels `BREAKEVEN_AFTER_TP1` but reports only 0.5×9/11 = about +0.409091R, omitting exactly 0.5R of residual original-stop loss. Original stop remains 110. |
| KD5: break-even semantics | After the same first-target crossing, a subsequent candle at 120 is below entry 121 but above original stop 110. An actual entry-level break-even stop would have been crossed, subject to its fill model. | Wave3 retains an open position, `tp1Done:true`, stop 110; it has not actually relocated the remaining stop to entry. This independently clarifies the misleading later break-even label in KD4. |
| KD6: 4h pivot chronology | Wave2 pivot index 24 needs three completed right bars. No setup before completion of bar 27; entry must be a later bar. | No setup through index 26; pending setup at index 27, `createdAt=28×4h`; entry index 28. No entry on the pivot or confirmation index. |
| KD7: pivot ties | Left comparisons are strict, right comparisons non-strict. An equal-low plateau should therefore use the earliest qualifying point under these exact frozen rules. | Equal low at index 9 retains pivot 8; equal low at index 7 selects pivot 7. This is characterization of the chosen rule, not validation of its trading value. |

KD1 reproduces **annotation contamination through the exported Wave3 API**. It does not demonstrate a changed entry, exit or historical trade outcome. Source review previously identified the same +4h daily-context pattern in Wave5, but a separate Wave5 daily-context behavioral fixture has not been implemented here. No old reported statistics are recomputed or declared invalid by this packet.

## Coverage and remaining work

Command, run locally with no network calls:

`node --test test/elliott-frozen-characterization.test.js`

Result: **8/8 passed** (source integrity plus KD1–KD7). Passing means the assertions reproduced the expected frozen behavior, including accounting/time defects. There is no corrected engine, pass/fail investment gate or reviewed replacement fill simulator in this package.

Still uncovered: mirrored short paths, a separate Wave5 context fixture, Wave5 next-bar break-even and residual-loss paths, comprehensive same-bar stop/target permutations, duplicate/gap/receipt/revision admission, competing/active setup combinations, terminal open-position treatment, actual venue cost/funding models, corrected-core parity and authenticated historical artifact revalidation. Do not claim full forensic coverage or all 11 proposed categories.

Next bounded work is a separately reviewed correction specification that names assumptions and distinguishes reproducible defects from required execution-model design choices. Any corrected core must get a new identity and retain these frozen originals. Reconcile variant/trial budgets before an empirical comparison. Do not use this fixture success to reopen Wave5, tune Wave3, relax sample gates or launch an ABC/Wave series.

Wave3 remains frozen/unpromoted; Wave5 remains rejected. `completeLineageAudit` remains null. Execution, canonical empirical research, dispatch, Paper, Live and automatic-promotion authority remain false. No empirical trial is registered by these unit fixtures; this does not erase existing historical trials or reset any budget. The original cores and all historical evidence remain unchanged.
