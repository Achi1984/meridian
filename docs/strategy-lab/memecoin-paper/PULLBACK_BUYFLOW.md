# Pullback with persistent buying · paper study

The strategy observes fresh Solana pools from the newcomer discovery sources independently of the momentum shortlist. A single observation per mint is admitted at 110–120 minutes of pool age. Require at least 5,000 USD of current pool liquidity and at least ten buys and sells combined over five minutes. Count transactions, not wallets. The strategy selects a negative one-hour USD price change and at least 60% buys. The comparator records every otherwise eligible entry using the same two-sided quote, size and exit convention. Positive volume acceleration is not required.

Each observation uses a hypothetical 20 USDC position and conservative exact-size quotes in both directions. Net immediate resale must be at least 19 USDC after both fees. The exit uses the first available exact-quantity quote at pool age 24 hours, with a 30-minute grace period. An unpriced position stays separate from realized P&L. These are fixed-size per-mint comparisons, not a cash-constrained portfolio. The ledger records realized net and the result without the best closed observation.

Run `python3 scripts/memecoin-paper/research/pullback_buyflow.py /path/to/ledger.json` repeatedly with the same file. The manual GitHub Actions workflow stores it on the paper-dashboard-data branch. Scheduling is enabled every ten minutes. Set PULLBACK_BUYFLOW_PAPER to disabled to pause it. Delayed ticks can miss the entry or exit window. A single tick alone cannot follow newly observed positions to maturity.

## Historical evidence

Exploratory replay of the June–July 2026 Pumpfun Memecoin Corpus using the last snapshot in the ten minutes before two hours and the last in the thirty minutes before 24 hours, with prices from the same pool. Of 706 candidates with adequate counts, price history and entry liquidity, 624 had an endpoint. Of 143 signal candidates, 129 had an endpoint. Entry/exit quotes and fees cannot be reconstructed from these snapshots, so these results are gross price changes. The prospective worker additionally requires a quote and exits after the target time. Its discovery population can differ from the archive.

| Closed cohort | Count | At least 5× | At least 10× | Lost at least half | Median change |
|---|---:|---:|---:|---:|---:|
| Signal | 129 | 6 | 4 | 85 | −67.6% |
| Other comparable tokens | 495 | 14 | 5 | 351 | −72.3% |

The signal mean of +10.4% becomes −17.5% excluding its largest winner. For June the mean was −10.5% (59 cases), and for July +28.0% (70 cases). Removing each period's best case makes both means negative. This archive informed the rule. Evaluate new observations separately.

Dataset: https://huggingface.co/datasets/Slinky21/Pumpfun_Memecoin_Corpus


## Prospective A/B/C comparison

A follows the selected entries to 24 hours of pool age. B rechecks the original quantity at +5 minutes (60 seconds of scheduling tolerance). Require a stable or higher resale bid and at least six buys out of ten trades or the equivalent 60% share with more trades. Buy a fresh 20 USDC quantity and apply the same net resale floor. Missed windows and unavailable observations stay separate from genuine skips. C shares the A entry and sells one quarter, rounded down to integer token units, on a fresh quote after the first sampled full-position net value reaches 40 USDC. The remainder is quoted at 24 hours. Charge one entry fee and one fee per sale. Failed partial quotes remain unpriced. A separate 48-hour mark follows the original quantity. Older A-only positions are excluded from B/C.

While there are tracked candidates the worker polls about every 30 seconds within a bounded 510-second run. Network reads, delayed or missing hosted runs can extend gaps. C records observed mark gaps and trigger and quote times. At entry, signed five-minute USD flow is diagnostic only; incomplete trade pages remain unknown. Weekly reporting uses entry cohorts, compares only observable outcomes, shows missed confirmations and unpriced exits separately, and credits zero exposure for genuine B skips on matched comparisons.
