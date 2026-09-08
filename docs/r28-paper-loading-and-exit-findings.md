# R28: loading and execution findings

Initial PAPER now requests status, V2, V3 and baseline only. It no longer waits for researchComparison over five ledgers or activity-summary. One button loads full analytics. The secondary PAPER module no longer independently fetches full analytics. Concurrent navigation calls share one pending PAPER load; token changes invalidate old responses. A failed required status request produces an explicit error, not a fabricated zero-performance bot.

The initial metrics use current equity, closed-trade count and server status aggregates. Initial DD is current peak-to-equity drawdown; full details include historical maximum. Zero-trade V3 has no displayed profit factor or expectancy. Subsequent refresh keeps existing content while requests are pending. No device-specific speedup is claimed without measured browser timings.

Executable exit tests confirm the existing sampler checks the sampled quote, not the path between quotes. A LONG with entry 100 and stop 90 filled at 87 loses 1.3R before costs. A sample at 95 cannot identify a prior unobserved stop touch. TP1 closes the complete position, so TP2 is only reached directly on a quote jump above TP2. These are implementation facts, not evidence that wider stops or partial exits improve expectancy.

Next research comparison: capture time-stamped quotes/candles around position life; replay identical entries and costs with explicit intra-bar ambiguity treatment. Compare sampled exits against observed stop touches, then compare full TP1 exit against a fixed partial-exit hypothesis. Evaluate all trades including losers on held-out data. Preserve V3 parameters and original ledgers during this comparison.

No trading engine or strategy parameters change in R28.
