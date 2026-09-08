# R27: first post-stop paper experiment

V2 is preserved after its drawdown stop. A separate V3 ledger is created only with at least 20 closed V2 trades, a reached drawdown limit, and no open V2 positions. No historical trades are reset or relabelled.

The deterministic analysis maps observed excess stop losses, negative expectancy, repeated entries and directional bundles to one frozen risk/score/cooldown/position parameter snapshot. These are hypotheses, not validated improvements. No optimization search or profitability claim is made. V3 still uses baseline READY signal candidates, but has its own risk gate and ledger.

V3 mutations are serialized in the single core process. This does not provide cross-process locking; do not run multiple core writers against the same ledger. Missing quotes preserve the last unrealized valuation. Opening fees are debited once. Entry rejection reasons persist. Same-side stop cooldown searches past intervening opposite-side trades.

At V3's own drawdown stop, STOPPED_REVIEW is latched, its stop analysis is saved, and existing positions continue to be managed. Recovery cannot silently restart entries. A further successor requires a separately validated hypothesis; this release implements V2 → V3 only, not unlimited automatic retries. Restarting fresh accounts indefinitely would hide aggregate losses. Parent and successor results remain separately visible.

Validation: 149 tests pass, including executable concurrent submission, fee accounting, stale quote, stop cooldown, invalid risk and durable stop-review tests; release checks pass. These verify implementation behavior, not trading edge. Prospective evaluation must include costs, all parent/successor losses and a common observation window.

Live execution and automatic promotion remain disabled. Baseline 6.2 strategy, retired ledgers and unrelated frozen research are unchanged.
