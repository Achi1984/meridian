# FIB DCA Futures Long — backtest validity checklist

Before any strategy result is promoted to MERIDIAN Paper:
1. Use only closed candles and confirmed swings.
2. No future pivot information may be used before confirmedAt.
3. Include fees and adverse slippage.
4. Include historical funding in the position holding interval.
5. Model venue-specific maintenance margin/liquidation before live use; generic approximation is diagnostic only.
6. Resolve ambiguous same-candle TP/SL/DCA ordering pessimistically or replay lower timeframe candles.
7. Select parameters on train only; report untouched out-of-sample test separately.
8. Require robustness across BTC, ETH, SOL and AVAX before extending to smaller alts.
9. Report parameter sensitivity; reject a result that depends on one narrow parameter combination.
10. Paper trade before any exchange-order integration.
