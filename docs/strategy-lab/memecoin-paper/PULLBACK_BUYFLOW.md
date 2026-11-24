# Pullback with persistent buying · paper study

The strategy observes fresh Solana pools from the newcomer discovery sources independently of the momentum shortlist. A single observation per mint is admitted at 110–120 minutes of pool age. Require at least 5,000 USD of current pool liquidity and at least ten buys and sells combined over five minutes. Count transactions, not wallets. The strategy selects a negative one-hour USD price change and at least 60% buys. The comparator records every otherwise eligible entry using the same two-sided quote, size and exit convention. Positive volume acceleration is not required.

Each observation uses a hypothetical 20 USDC position and conservative exact-size quotes in both directions. Net immediate resale must be at least 19 USDC after both fees. The exit uses the first available exact-quantity quote at pool age 24 hours, with a 30-minute grace period. An unpriced position stays separate from realized P&L. These are fixed-size per-mint comparisons, not a cash-constrained portfolio. The ledger records realized net and the result without the best closed observation.

Run `python3 scripts/memecoin-paper/research/pullback_buyflow.py /path/to/ledger.json` repeatedly with the same file. The manual GitHub Actions workflow stores it on the paper-dashboard-data branch. Scheduling is opt-in through the repository variable PULLBACK_BUYFLOW_PAPER set to enabled. Delayed ticks can miss the entry or exit window. A single tick alone cannot follow newly observed positions to maturity.

## Historical evidence

Exploratory replay of the June–July 2026 Pumpfun Memecoin Corpus using the last snapshot in the ten minutes before two hours and the last in the thirty minutes before 24 hours, with prices from the same pool. Of 706 candidates with adequate counts, price history and entry liquidity, 624 had an endpoint. Of 143 signal candidates, 129 had an endpoint. Entry/exit quotes and fees cannot be reconstructed from these snapshots, so these results are gross price changes. The prospective worker additionally requires a quote and exits after the target time. Its discovery population can differ from the archive.

| Closed cohort | Count | At least 5× | At least 10× | Lost at least half | Median change |
|---|---:|---:|---:|---:|---:|
| Signal | 129 | 6 | 4 | 85 | −67.6% |
| Other comparable tokens | 495 | 14 | 5 | 351 | −72.3% |

The signal mean of +10.4% becomes −17.5% excluding its largest winner. For June the mean was −10.5% (59 cases), and for July +28.0% (70 cases). Removing each period's best case makes both means negative. This archive informed the rule. Evaluate new observations separately.

Dataset: https://huggingface.co/datasets/Slinky21/Pumpfun_Memecoin_Corpus
